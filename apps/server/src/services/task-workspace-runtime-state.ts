// [INPUT]: 任务工作区运行时状态
// [OUTPUT]: 状态快照
// [POS]: 任务工作区运行时状态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { DistributedTask, WorkspaceSession, WorkspaceSessionRuntimeStatus } from '@shared/types'

export const TASK_WORKSPACE_RUNTIME_HEARTBEAT_TIMEOUT_MS = 45_000

const ACTIVE_DISTRIBUTED_TASK_STATUSES = new Set<DistributedTask['status']>([
  'assigned',
  'preparing',
  'executing',
  'syncing_back',
])

export const isWorkspaceSessionRuntimeTerminal = (status: WorkspaceSessionRuntimeStatus) => {
  return status === 'idle' || status === 'completed' || status === 'error' || status === 'lost' || status === 'cancelled'
}

export const isWorkspaceSessionRuntimeHeartbeatFresh = (
  session: Pick<WorkspaceSession, 'lastHeartbeatAt' | 'runtimeStatus'>,
  now = Date.now(),
) => {
  if (session.runtimeStatus !== 'running' && session.runtimeStatus !== 'waiting') {
    return false
  }

  if (!session.lastHeartbeatAt) {
    return false
  }

  const lastHeartbeatAt = Date.parse(session.lastHeartbeatAt)
  if (Number.isNaN(lastHeartbeatAt)) {
    return false
  }

  return now - lastHeartbeatAt <= TASK_WORKSPACE_RUNTIME_HEARTBEAT_TIMEOUT_MS
}

export const resolveEffectiveWorkspaceRuntimeStatus = (
  session: Pick<WorkspaceSession, 'runtimeStatus' | 'lastHeartbeatAt'>,
  now = Date.now(),
): WorkspaceSessionRuntimeStatus => {
  if ((session.runtimeStatus === 'running' || session.runtimeStatus === 'waiting') && !isWorkspaceSessionRuntimeHeartbeatFresh(session, now)) {
    return 'lost'
  }

  return session.runtimeStatus
}

export const toAgentRunningStatusFromRuntimeStatus = (status: WorkspaceSessionRuntimeStatus) => {
  if (status === 'queued') return 'thinking' as const
  if (status === 'running') return 'executing' as const
  if (status === 'waiting') return 'waiting' as const
  if (status === 'completed') return 'complete' as const
  if (status === 'error' || status === 'lost') return 'error' as const
  return 'idle' as const
}

export const toWorkspaceSessionRuntimeStatusFromDistributedStatus = (status: DistributedTask['status']): WorkspaceSessionRuntimeStatus => {
  if (status === 'queued' || status === 'draft') return 'queued'
  if (status === 'assigned' || status === 'preparing' || status === 'executing' || status === 'syncing_back') return 'running'
  if (status === 'completed') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed' || status === 'timed_out') return 'error'
  return 'lost'
}

export const hasActiveDistributedTaskRuntime = (distributedTask: DistributedTask | null | undefined) => {
  if (!distributedTask) {
    return false
  }

  return ACTIVE_DISTRIBUTED_TASK_STATUSES.has(distributedTask.status)
}
