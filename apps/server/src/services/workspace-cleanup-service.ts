// [INPUT]: 工作区清理请求
// [OUTPUT]: 清理结果
// [POS]: 工作区清理服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AppState, Project, WorkspaceSession, Workspace, WorkspaceRecord } from '@shared/types'
import { resolveTaskWorktreePath } from '@shared/workspace-paths'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsService } from '../control-plane/executor-ws-service'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { resolveWorkspaceWorkingDirectoryMode } from '../routes/task-route-support'
import { createWorkspaceOperationTimelineWriter, recordWorkspaceSessionSystemMessage } from './workspace-session-operation-timeline'

type WorkspaceCleanupResult = {
  ok: true
  detail?: string
} | {
  ok: false
  message: string
}

const isExecutorUnavailableError = (message: string) => (
  message.includes('执行器当前未在线')
  || message.includes('执行器清理工作目录超时')
)

export const cleanupWorkspaceWorktrees = async (params: {
  state: AppState
  project: Project
  workspace: WorkspaceRecord
  sessions: WorkspaceSession[]
  userId?: string
  deleteLocalBranch?: boolean
  deleteRemoteBranch?: boolean
}): Promise<WorkspaceCleanupResult> => {
  if (params.project.versionControl === 'none') {
    return { ok: true as const }
  }

  if (params.sessions.length === 0) {
    return { ok: true as const }
  }

  const executorId = params.workspace.executorNodeId?.trim() || ''
  if (!executorId) {
    return {
      ok: true as const,
      detail: '原执行节点记录已丢失，已跳过本地隔离目录清理。',
    }
  }

  const persistedExecutor = executorRegistry.getExecutor(executorId)
  if (!persistedExecutor) {
    return {
      ok: true as const,
      detail: '原执行节点已不存在，已跳过本地隔离目录清理。',
    }
  }

  const executorWorkspaceRoot = executorRegistry.getExecutor(executorId)?.workspaceRoot?.trim()
  const workspaceRoot = executorWorkspaceRoot || params.state.config.workspaceRoot
  const repoPath = params.workspace.repoPath?.trim() || undefined
  const repoUrl = params.project.gitUrl?.trim() || undefined
  const shouldDeleteRemoteBranch = Boolean(params.deleteRemoteBranch)
  const shouldDeleteLocalBranch = shouldDeleteRemoteBranch || Boolean(params.deleteLocalBranch)
  const gitIdentity = shouldDeleteRemoteBranch && params.userId
    ? await resolveUserProjectGitIdentity({
        userId: params.userId,
        projectId: params.project.id,
        mode: 'personal',
        repoUrl: params.project.gitUrl,
      }).catch(() => undefined)
    : undefined
  const cleanedBranchKeys = new Set<string>()
  const taskIdByWorkspaceId = new Map(params.state.taskWorkspaceBindings
    .filter((binding) => binding.status === 'active')
    .map((binding) => [binding.workspaceId, binding.taskId] as const))

  for (const session of params.sessions) {
    const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(params.workspace as Workspace, session)
    const worktreePath = resolveTaskWorktreePath(workspaceRoot, params.project, {
      id: session.id,
      workspaceId: session.workspaceId,
      worktreeId: session.worktreeId,
      ownerUserId: params.workspace.ownerUserId ?? params.userId,
    })
    const normalizedBranchName = session.branchName?.trim() || ''
    const canDeleteManagedBranch = (
      workingDirectoryMode === 'worktree'
      && (normalizedBranchName.startsWith('wemux/') || normalizedBranchName.startsWith('vibemux/'))
    )
    const branchCleanupKey = canDeleteManagedBranch ? `${worktreePath}:${normalizedBranchName}` : ''
    const allowBranchCleanup = Boolean(
      canDeleteManagedBranch
      && branchCleanupKey
      && !cleanedBranchKeys.has(branchCleanupKey),
    )
    const timelineScope = {
      taskId: taskIdByWorkspaceId.get(session.workspaceId) ?? session.id,
      workspaceId: params.workspace.id,
      workspaceSessionId: session.id,
      turnId: `workspace-cleanup:${session.id}`,
    }
    recordWorkspaceSessionSystemMessage(
      timelineScope,
      workingDirectoryMode === 'original-dir'
        ? '正在清理工作区：原始目录模式会保留项目目录。'
        : `正在清理工作区目录：${worktreePath}`,
    )
    const result = await executorWsService.requestWorktreeCleanup(executorId, {
      workspaceId: params.workspace.id,
      ownerUserId: params.workspace.ownerUserId ?? params.userId,
      repoPath,
      repoUrl,
      worktreePath,
      workingDirectoryMode,
      branchName: allowBranchCleanup ? normalizedBranchName : undefined,
      deleteLocalBranch: allowBranchCleanup ? shouldDeleteLocalBranch : false,
      deleteRemoteBranch: allowBranchCleanup ? shouldDeleteRemoteBranch : false,
      gitIdentity,
      onOperationEvent: createWorkspaceOperationTimelineWriter(timelineScope),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '清理隔离目录失败。',
    }))
    recordWorkspaceSessionSystemMessage(
      timelineScope,
      result.ok
        ? result.message
        : `工作区目录清理失败：${result.message}`,
    )

    if (!result.ok) {
      if (isExecutorUnavailableError(result.message)) {
        return {
          ok: true as const,
          detail: '原执行节点当前不可用，已跳过本地隔离目录清理。',
        }
      }

      return {
        ok: false as const,
        message: `清理本地隔离目录失败：${result.message}`,
      }
    }

    if (allowBranchCleanup) {
      cleanedBranchKeys.add(branchCleanupKey)
    }
  }

  return { ok: true as const }
}
