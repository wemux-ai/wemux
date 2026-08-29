// [INPUT]: 运行时输入
// [OUTPUT]: 运行时契约
// [POS]: 工作区运行时类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { isRecord } from './utils'
import type { WorkspaceEnvironmentStatusSnapshot } from './task-environment'

export const WORKSPACE_RUNTIME_SUMMARY_STALE_MS = 75_000

export type WorkspaceRuntimeSource =
  | 'worker-heartbeat'
  | 'worker-probe'
  | 'server-probe'
  | 'user-action'

export type WorkspaceTerminalRuntimeStatus = 'open' | 'closed' | 'stale'

export interface WorkspaceTerminalRuntimeSnapshot {
  status: WorkspaceTerminalRuntimeStatus
  sessionCount: number
  reportedAt: string
  executorId?: string
}

export interface WorkspaceEnvironmentRuntimeSnapshot extends WorkspaceEnvironmentStatusSnapshot {
  source: WorkspaceRuntimeSource
  workspaceSessionId?: string
  reportedByExecutorId?: string
}

export interface WorkspaceAgentRuntimeSummary {
  runningCount: number
  queuedCount: number
  waitingCount: number
  latestWorkspaceSessionId?: string
}

export interface WorkspaceSessionRuntimeSummary {
  terminal?: WorkspaceTerminalRuntimeSnapshot
  environment?: WorkspaceEnvironmentRuntimeSnapshot
}

export interface WorkspaceRuntimeSummary {
  terminal?: WorkspaceTerminalRuntimeSnapshot
  environment?: WorkspaceEnvironmentRuntimeSnapshot
  agent?: WorkspaceAgentRuntimeSummary
}

const normalizeIsoString = (value: unknown) => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
)

const isWorkspaceRuntimeSource = (value: unknown): value is WorkspaceRuntimeSource => (
  value === 'worker-heartbeat'
  || value === 'worker-probe'
  || value === 'server-probe'
  || value === 'user-action'
)

const isWorkspaceTerminalRuntimeStatus = (value: unknown): value is WorkspaceTerminalRuntimeStatus => (
  value === 'open' || value === 'closed' || value === 'stale'
)

const isWorkspaceEnvironmentStatus = (value: unknown): value is WorkspaceEnvironmentStatusSnapshot['status'] => (
  value === 'unsupported'
  || value === 'checking'
  || value === 'starting'
  || value === 'running'
  || value === 'stopping'
  || value === 'stopped'
  || value === 'unreachable'
  || value === 'error'
)

export const isWorkspaceRuntimeSnapshotFresh = (
  reportedAt: string | undefined,
  nowMs = Date.now(),
  staleMs = WORKSPACE_RUNTIME_SUMMARY_STALE_MS,
) => {
  if (!reportedAt) {
    return false
  }

  const reportedAtMs = Date.parse(reportedAt)
  return Number.isFinite(reportedAtMs) && nowMs - reportedAtMs <= staleMs
}

export const resolveWorkspaceTerminalRuntimeStatus = (
  snapshot: WorkspaceTerminalRuntimeSnapshot | undefined,
  nowMs = Date.now(),
): WorkspaceTerminalRuntimeStatus | undefined => {
  if (!snapshot) {
    return undefined
  }

  if (snapshot.status === 'open' && !isWorkspaceRuntimeSnapshotFresh(snapshot.reportedAt, nowMs)) {
    return 'stale'
  }

  return snapshot.status
}

export const isWorkspaceEnvironmentRuntimeVisible = (
  snapshot: WorkspaceEnvironmentRuntimeSnapshot | WorkspaceEnvironmentStatusSnapshot | undefined,
  nowMs = Date.now(),
) => {
  if (!snapshot || !isWorkspaceRuntimeSnapshotFresh(snapshot.checkedAt, nowMs)) {
    return false
  }

  return snapshot.status === 'running'
    || snapshot.status === 'starting'
    || snapshot.status === 'checking'
    || snapshot.status === 'stopping'
}

export const normalizeWorkspaceTerminalRuntimeSnapshot = (value: unknown): WorkspaceTerminalRuntimeSnapshot | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const reportedAt = normalizeIsoString(value.reportedAt)
  const status = isWorkspaceTerminalRuntimeStatus(value.status) ? value.status : undefined
  if (!reportedAt || !status) {
    return undefined
  }

  const sessionCount = typeof value.sessionCount === 'number' && Number.isFinite(value.sessionCount)
    ? Math.max(0, Math.floor(value.sessionCount))
    : 0

  return {
    status,
    sessionCount,
    reportedAt,
    executorId: normalizeIsoString(value.executorId),
  }
}

export const normalizeWorkspaceEnvironmentRuntimeSnapshot = (value: unknown): WorkspaceEnvironmentRuntimeSnapshot | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const checkedAt = normalizeIsoString(value.checkedAt)
  const status = isWorkspaceEnvironmentStatus(value.status) ? value.status : undefined
  const message = normalizeIsoString(value.message)
  const source = isWorkspaceRuntimeSource(value.source) ? value.source : undefined
  if (!checkedAt || !status || !message || !source) {
    return undefined
  }

  return {
    status,
    message,
    checkedAt,
    source,
    url: normalizeIsoString(value.url),
    httpStatus: typeof value.httpStatus === 'number' && Number.isFinite(value.httpStatus) ? value.httpStatus : undefined,
    workspaceSessionId: normalizeIsoString(value.workspaceSessionId),
    reportedByExecutorId: normalizeIsoString(value.reportedByExecutorId),
  }
}

export const normalizeWorkspaceSessionRuntimeSummary = (value: unknown): WorkspaceSessionRuntimeSummary | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const terminal = normalizeWorkspaceTerminalRuntimeSnapshot(value.terminal)
  const environment = normalizeWorkspaceEnvironmentRuntimeSnapshot(value.environment)
  if (!terminal && !environment) {
    return undefined
  }

  return {
    terminal,
    environment,
  }
}
