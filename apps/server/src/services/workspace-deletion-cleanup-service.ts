// [INPUT]: 删除请求
// [OUTPUT]: 关联清理
// [POS]: 工作区删除清理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AppState, Project, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import { cleanupWorkspaceWorktrees } from './workspace-cleanup-service'
import { cleanupWorkspaceRuntimeResources, summarizeWorkspaceRuntimeCleanup } from './workspace-runtime-cleanup-service'

type WorkspaceDeletionCleanupParams = {
  state: AppState
  project: Project
  workspace: WorkspaceRecord
  workspaceSessions: WorkspaceSession[]
  userId: string
  deleteLocalBranch?: boolean
  deleteRemoteBranch?: boolean
}

type WorkspaceDeletionCleanupDependencies = {
  cleanupRuntimeResources?: typeof cleanupWorkspaceRuntimeResources
  cleanupWorktrees?: typeof cleanupWorkspaceWorktrees
  schedule?: (task: () => void) => void
  logError?: (message: string, error?: unknown) => void
  logWarn?: (message: string, detail?: string) => void
}

export const runWorkspaceDeletionCleanup = async (
  params: WorkspaceDeletionCleanupParams,
  dependencies: WorkspaceDeletionCleanupDependencies = {},
) => {
  const cleanupRuntimeResources = dependencies.cleanupRuntimeResources ?? cleanupWorkspaceRuntimeResources
  const cleanupWorktrees = dependencies.cleanupWorktrees ?? cleanupWorkspaceWorktrees
  const logWarn = dependencies.logWarn ?? ((message: string, detail?: string) => {
    console.warn(message, detail ?? '')
  })

  const runtimeCleanupSummary = await cleanupRuntimeResources({
    state: params.state,
    project: params.project,
    userId: params.userId,
    workspace: params.workspace,
  })
  const runtimeCleanupDetail = summarizeWorkspaceRuntimeCleanup(runtimeCleanupSummary)
  if (runtimeCleanupDetail) {
    logWarn('[workspace-delete] background runtime cleanup summary', runtimeCleanupDetail)
  }

  const worktreeCleanupResult = await cleanupWorktrees({
    state: params.state,
    project: params.project,
    workspace: params.workspace,
    sessions: params.workspaceSessions,
    userId: params.userId,
    deleteLocalBranch: params.deleteLocalBranch,
    deleteRemoteBranch: params.deleteRemoteBranch,
  })
  if (!worktreeCleanupResult.ok) {
    throw new Error(worktreeCleanupResult.message)
  }
  if (worktreeCleanupResult.detail) {
    logWarn('[workspace-delete] background worktree cleanup summary', worktreeCleanupResult.detail)
  }
}

export const scheduleWorkspaceDeletionCleanup = (
  params: WorkspaceDeletionCleanupParams,
  dependencies: WorkspaceDeletionCleanupDependencies = {},
) => {
  const schedule = dependencies.schedule ?? queueMicrotask
  const logError = dependencies.logError ?? ((message: string, error?: unknown) => {
    console.error(message, error)
  })

  schedule(() => {
    void runWorkspaceDeletionCleanup(params, dependencies).catch((error) => {
      logError('[workspace-delete] background cleanup failed', error)
    })
  })
}
