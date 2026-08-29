// [INPUT]: 终端请求（create/attach/close）与 executor 状态
// [OUTPUT]: 终端会话运行时事件
// [POS]: 远程终端运行时（server 侧）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkspaceTerminalSessionDescriptor } from '@shared/types'
import { resolveWorkspaceWorkerId } from '@shared/task-workspace'
import { isWorkspaceRuntimeSnapshotFresh } from '@shared/workspace-runtime'
import { loadState, saveWorkspaceSession } from '../storage/app-state-store'
import { listWorkspaces } from '../storage/distributed-task-store'

export const TERMINAL_RUNTIME_PERSIST_REFRESH_MS = 30_000

export const syncExecutorWorkspaceTerminalRuntimeSummaries = (
  executorId: string,
  terminalSessions: WorkspaceTerminalSessionDescriptor[],
  reportedAt: string,
) => {
  const workspaceTerminalCount = new Map<string, number>()
  for (const session of terminalSessions) {
    if (
      session.executorId !== executorId
      || session.scope !== 'workspace'
      || !session.workspaceId
      || session.exitedAt
    ) {
      continue
    }

    workspaceTerminalCount.set(session.workspaceId, (workspaceTerminalCount.get(session.workspaceId) ?? 0) + 1)
  }

  const workspaceExecutorById = new Map(listWorkspaces().map((workspace) => [workspace.id, resolveWorkspaceWorkerId(workspace)] as const))
  const state = loadState()
  const reportedAtMs = Date.parse(reportedAt)
  const nowMs = Number.isFinite(reportedAtMs) ? reportedAtMs : Date.now()

  for (const session of state.workspaceSessions) {
    const workspaceExecutorId = workspaceExecutorById.get(session.workspaceId)
    if (workspaceExecutorId !== executorId) {
      continue
    }

    const sessionCount = workspaceTerminalCount.get(session.workspaceId) ?? 0
    const nextStatus = sessionCount > 0 ? 'open' : 'closed'
    const previous = session.runtimeSummary?.terminal
    const shouldRefreshOpenSnapshot = sessionCount > 0
      && !isWorkspaceRuntimeSnapshotFresh(previous?.reportedAt, nowMs, TERMINAL_RUNTIME_PERSIST_REFRESH_MS)
    const shouldPersist = !previous
      || previous.status !== nextStatus
      || previous.sessionCount !== sessionCount
      || previous.executorId !== executorId
      || shouldRefreshOpenSnapshot

    if (!shouldPersist) {
      continue
    }

    saveWorkspaceSession({
      ...session,
      runtimeSummary: {
        ...session.runtimeSummary,
        terminal: {
          status: nextStatus,
          sessionCount,
          executorId,
          reportedAt,
        },
      },
    })
  }
}
