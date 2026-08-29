import type { AgentRunningStatus, WorkspaceSession, WorkspaceSessionRuntimeStatus } from '@shared/types'

type WorkspaceSessionRuntimeState = Pick<WorkspaceSession, 'agentRunningStatus' | 'needsHumanConfirm' | 'lastHeartbeatAt'> & {
  runtimeStatus?: WorkspaceSession['runtimeStatus']
}

export type WorkspaceSessionDisplayStatus = 'idle' | 'queued' | 'running' | 'attention' | 'complete' | 'error'

// 与 server 侧 TASK_WORKSPACE_RUNTIME_HEARTBEAT_TIMEOUT_MS 对齐：
// 超过该时长未收到 worker 心跳反馈，视为会话失联。
const WORKSPACE_SESSION_HEARTBEAT_STALE_MS = 45_000

const isWorkspaceSessionHeartbeatStale = (
  session: Pick<WorkspaceSession, 'lastHeartbeatAt'>,
  now = Date.now(),
) => {
  const lastHeartbeatAt = session.lastHeartbeatAt?.trim()
  if (!lastHeartbeatAt) {
    return false
  }

  const timestamp = Date.parse(lastHeartbeatAt)
  if (Number.isNaN(timestamp)) {
    return false
  }

  return now - timestamp > WORKSPACE_SESSION_HEARTBEAT_STALE_MS
}

export const isWorkspaceSessionBusy = (
  input: AgentRunningStatus | WorkspaceSessionRuntimeState,
) => {
  if (typeof input === 'string') {
    return input === 'thinking' || input === 'executing' || input === 'waiting'
  }

  if (input.agentRunningStatus === 'complete' || input.agentRunningStatus === 'error') {
    return false
  }

  if (input.runtimeStatus === 'queued') {
    return false
  }

  if (input.runtimeStatus === 'running' || input.runtimeStatus === 'waiting') {
    return true
  }

  return input.agentRunningStatus === 'thinking'
    || input.agentRunningStatus === 'executing'
    || input.agentRunningStatus === 'waiting'
}

const isRuntimeErrorStatus = (status: AgentRunningStatus | WorkspaceSessionRuntimeStatus | undefined) => {
  return status === 'error' || status === 'lost'
}

export const isWorkspaceSessionAwaitingConfirmation = (
  session: WorkspaceSessionRuntimeState,
) => {
  return !isWorkspaceSessionBusy(session) && session.needsHumanConfirm
}

export const getWorkspaceSessionDisplayStatus = (
  session: WorkspaceSessionRuntimeState,
  now = Date.now(),
): WorkspaceSessionDisplayStatus => {
  // 错误优先：任何一边 error/lost 都按异常处理，避免错误被运行状态掩盖。
  if (isRuntimeErrorStatus(session.agentRunningStatus) || isRuntimeErrorStatus(session.runtimeStatus)) {
    return 'error'
  }

  const runtimeStatus = session.runtimeStatus

  // runtimeStatus 是 worker（executor）反馈驱动的权威状态：
  // worker 心跳 runningTaskIds / 分布式任务事件 / 结果返回都成对写它；
  // 而 agentRunningStatus 存在 server 本地单写路径（如 PR/交付刷新），可能与 worker 反馈错位。
  // 因此「是否在运行」只看 worker 反馈的 runtimeStatus，不被页面/本地推断的状态覆盖。
  if (runtimeStatus === 'running' || runtimeStatus === 'waiting') {
    // 心跳新鲜度兜底：worker 反馈（lastHeartbeatAt）超过阈值未更新 → 会话失联，
    // 不再显示「运行中」；lastHeartbeatAt 为空（直连会话等无心跳路径）时不判定。
    if (isWorkspaceSessionHeartbeatStale(session, now)) {
      return 'error'
    }

    return 'running'
  }

  if (runtimeStatus === 'queued') {
    return 'queued'
  }

  if (runtimeStatus === 'completed') {
    return session.needsHumanConfirm ? 'attention' : 'complete'
  }

  // runtimeStatus 缺失/空闲（历史数据、直连会话尚未有 worker 反馈）→
  // 用 agentRunningStatus 兜底，避免老会话全部显示空闲。
  if (runtimeStatus === 'idle' || runtimeStatus === undefined) {
    if (session.agentRunningStatus === 'executing' || session.agentRunningStatus === 'waiting' || session.agentRunningStatus === 'thinking') {
      return 'running'
    }

    if (session.agentRunningStatus === 'complete') {
      return session.needsHumanConfirm ? 'attention' : 'complete'
    }
  }

  if (isWorkspaceSessionAwaitingConfirmation(session)) {
    return 'attention'
  }

  return 'idle'
}
