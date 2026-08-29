// [INPUT]: 运行时清理请求
// [OUTPUT]: 清理结果
// [POS]: 工作区运行时清理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { AppState, Project, WorkspaceSession, WorkspaceRecord } from '@shared/types'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsRequests } from '../control-plane/executor-ws-requests'
import { executorWsService } from '../control-plane/executor-ws-service'
import { previewSessionService } from './preview-session-service'
import { resolveScopedRuntimeEnvironment } from './runtime-environment-service'
import { getWorkspaceEnvironmentTemplate } from './workspace-environment-template-service'
import { runPreviewEnvironmentCommand } from '../routes/preview-routes'
import {
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd as resolveWorkspaceSessionCwdPath,
} from '../routes/task-route-support'

const DESKTOP_PREVIEW_PURPOSE = 'desktop' as const

type CleanupWorkspaceRuntimeResourcesParams = {
  state: AppState
  project: Project
  userId: string
  workspace: WorkspaceRecord
}

type CleanupWorkspaceRuntimeResourcesSummary = {
  closedPreviewCount: number
  stoppedDesktopCount: number
  closedTerminalCount: number
  warnings: string[]
}

const buildTaskMap = (state: AppState) => new Map(state.tasks.map((task) => [task.id, task] as const))

const buildWorkspaceSessionMap = (state: AppState, workspaceId: string) => (
  new Map(state.workspaceSessions
    .filter((session) => session.workspaceId === workspaceId)
    .map((session) => [session.id, session] as const))
)

const closePreviewTunnel = (previewSessionId: string, executorId: string) => {
  executorWsService.dispatchTask(executorId, {
    type: 'preview.tunnel.close',
    previewSessionId,
    at: new Date().toISOString(),
  })
}

const resolveWorkspaceRuntimeSessionCwd = (params: {
  project: Project
  workspace: WorkspaceRecord
  workspaceSession: WorkspaceSession
  executorId: string
}) => {
  const workspaceRoot = executorRegistry.getExecutor(params.executorId)?.workspaceRoot
  const effectiveSession = resolveEffectiveWorkspaceWorktreeSession(params.project.id, params.workspaceSession, params.workspace.executorNodeId)
  return resolveWorkspaceSessionCwdPath(workspaceRoot, params.project, effectiveSession, params.workspace)
}

const closeAppPreviewForTaskWorkspace = async (params: {
  project: Project
  taskId: string
  userId: string
  workspace: WorkspaceRecord
  workspaceSessionById: Map<string, WorkspaceSession>
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  summary: CleanupWorkspaceRuntimeResourcesSummary
}) => {
  const previewSession = previewSessionService.getOwnerSessionForTaskWorkspace({
    taskId: params.taskId,
    workspaceId: params.workspace.id,
    ownerUserId: params.userId,
  })
  if (!previewSession) {
    return
  }

  const workspaceSession = params.workspaceSessionById.get(previewSession.workspaceSessionId)
  if (workspaceSession) {
    const cwd = resolveWorkspaceRuntimeSessionCwd({
      project: params.project,
      workspace: params.workspace,
      workspaceSession,
      executorId: previewSession.executorId,
    })
    const workspaceEnvironmentTemplate = await getWorkspaceEnvironmentTemplate(params.workspace.id)
    const preview = cwd ? resolveProjectEnvironmentPreview({
      project: params.project,
      session: workspaceSession,
      cwd,
      workspaceEnvironmentTemplate,
    }) : null

    if (cwd && preview?.stopCommand?.trim()) {
      await runPreviewEnvironmentCommand({
        executorId: previewSession.executorId,
        command: preview.stopCommand,
        cwd,
        runtimeEnvironment: params.runtimeEnvironment,
      }).catch((error) => {
        params.summary.warnings.push(error instanceof Error ? error.message : '停止 Preview 环境失败。')
      })
    }
  }

  closePreviewTunnel(previewSession.id, previewSession.executorId)
  previewSessionService.close(previewSession.id, 'stopped_by_user')
  params.summary.closedPreviewCount += 1
}

const closeDesktopPreviewForTaskWorkspace = async (params: {
  taskId: string
  userId: string
  workspace: WorkspaceRecord
  summary: CleanupWorkspaceRuntimeResourcesSummary
}) => {
  const previewSession = previewSessionService.getOwnerSessionForTaskWorkspace({
    taskId: params.taskId,
    workspaceId: params.workspace.id,
    ownerUserId: params.userId,
    purpose: DESKTOP_PREVIEW_PURPOSE,
  })
  if (!previewSession) {
    return
  }

  await executorWsRequests.requestDesktopSandbox(previewSession.executorId, {
    request: { operation: 'stop' },
  }).catch((error) => {
    params.summary.warnings.push(error instanceof Error ? error.message : '停止 Desktop Sandbox 失败。')
  })

  closePreviewTunnel(previewSession.id, previewSession.executorId)
  previewSessionService.close(previewSession.id, 'stopped_by_user')
  params.summary.stoppedDesktopCount += 1
}

const closeWorkspaceTerminalSessions = async (params: {
  executorId: string
  summary: CleanupWorkspaceRuntimeResourcesSummary
  workspaceId: string
}) => {
  const listed = await executorWsRequests.requestTerminalSessionList(params.executorId, {
    scope: 'workspace',
    workspaceId: params.workspaceId,
  }).catch((error) => {
    params.summary.warnings.push(error instanceof Error ? error.message : '读取终端会话失败。')
    return null
  })
  if (!listed?.ok) {
    if (listed?.message) {
      params.summary.warnings.push(listed.message)
    }
    return
  }

  for (const session of listed.sessions) {
    const closed = await executorWsService.closeTerminalSession({
      executorId: params.executorId,
      terminalId: session.terminalId,
      scope: 'workspace',
      workspaceId: params.workspaceId,
    }).catch((error) => {
      params.summary.warnings.push(error instanceof Error ? error.message : `关闭终端 ${session.terminalId} 失败。`)
      return null
    })
    if (closed?.closed) {
      params.summary.closedTerminalCount += 1
    }
  }
}

export const summarizeWorkspaceRuntimeCleanup = (summary: CleanupWorkspaceRuntimeResourcesSummary) => {
  const parts: string[] = []
  if (summary.closedPreviewCount > 0) {
    parts.push(`已关闭 ${summary.closedPreviewCount} 个 Preview`)
  }
  if (summary.stoppedDesktopCount > 0) {
    parts.push(`已停止 ${summary.stoppedDesktopCount} 个 Desktop Sandbox`)
  }
  if (summary.closedTerminalCount > 0) {
    parts.push(`已关闭 ${summary.closedTerminalCount} 个终端会话`)
  }
  if (summary.warnings.length > 0) {
    parts.push('部分运行资源未能完全清理')
  }
  return parts.join('，')
}

export const cleanupWorkspaceRuntimeResources = async (
  params: CleanupWorkspaceRuntimeResourcesParams,
) => {
  const summary: CleanupWorkspaceRuntimeResourcesSummary = {
    closedPreviewCount: 0,
    stoppedDesktopCount: 0,
    closedTerminalCount: 0,
    warnings: [],
  }
  const taskById = buildTaskMap(params.state)
  const workspaceSessionById = buildWorkspaceSessionMap(params.state, params.workspace.id)
  const runtimeEnvironment = await resolveScopedRuntimeEnvironment({ workspaceId: params.workspace.id })
    .then((result) => result?.payload)
    .catch(() => undefined)
  const taskIds = Array.from(new Set(
    params.state.taskWorkspaceBindings
      .filter((binding) => binding.workspaceId === params.workspace.id)
      .map((binding) => binding.taskId),
  ))

  for (const taskId of taskIds) {
    const task = taskById.get(taskId)
    if (!task) {
      continue
    }

    await closeAppPreviewForTaskWorkspace({
      project: params.project,
      taskId,
      userId: params.userId,
      workspace: params.workspace,
      workspaceSessionById,
      runtimeEnvironment,
      summary,
    })
    await closeDesktopPreviewForTaskWorkspace({
      taskId,
      userId: params.userId,
      workspace: params.workspace,
      summary,
    })
  }

  const executorIds = Array.from(new Set([
    params.workspace.executorNodeId?.trim() || '',
    ...params.state.workspaceSessions
      .filter((session) => session.workspaceId === params.workspace.id)
      .flatMap((session) => [
        session.runtimeOwnerExecutorId?.trim() || '',
        session.executorNodeId?.trim() || '',
      ]),
  ].filter(Boolean)))

  for (const executorId of executorIds) {
    await closeWorkspaceTerminalSessions({
      executorId,
      summary,
      workspaceId: params.workspace.id,
    })
  }

  return summary
}
