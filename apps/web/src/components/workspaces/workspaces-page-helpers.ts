import type { WorkspaceEnvironmentRuntimeStatus, WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import type { ExecutorAgentSessionSummary } from '@shared/types'
import type { WorkspaceRouteSearch } from '../../routes/-workspace-route-shared'

export const GIT_WORKING_TREE_REFRESH_MS = 15_000

export const buildImportAgentSessionKey = (session: Pick<ExecutorAgentSessionSummary, 'source' | 'id'>) => `${session.source}:${session.id}`

const getWorkspaceEnvironmentStatusPriority = (status: WorkspaceEnvironmentRuntimeStatus) => {
  if (status === 'running') return 5
  if (status === 'starting' || status === 'checking') return 4
  if (status === 'stopping') return 3
  if (status === 'error' || status === 'unreachable') return 2
  if (status === 'stopped') return 1
  return 0
}

export const pickWorkspaceEnvironmentStatus = (
  current: WorkspaceEnvironmentStatusSnapshot | undefined,
  next: WorkspaceEnvironmentStatusSnapshot,
) => {
  if (!current) {
    return next
  }

  const currentPriority = getWorkspaceEnvironmentStatusPriority(current.status)
  const nextPriority = getWorkspaceEnvironmentStatusPriority(next.status)
  if (nextPriority !== currentPriority) {
    return nextPriority > currentPriority ? next : current
  }

  return next.checkedAt.localeCompare(current.checkedAt) >= 0 ? next : current
}

const normalizeRuntimePath = (value?: string) => {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalized) {
    return ''
  }

  return normalized === '' ? '/' : normalized
}

export const areRuntimePathsRelated = (left?: string, right?: string) => {
  const normalizedLeft = normalizeRuntimePath(left)
  const normalizedRight = normalizeRuntimePath(right)
  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`)
}

export const areWorkspaceRouteSearchEqual = (left: WorkspaceRouteSearch, right: WorkspaceRouteSearch) => {
  return left.projectId === right.projectId
    && left.taskId === right.taskId
    && left.workspaceId === right.workspaceId
    && left.workspaceSessionId === right.workspaceSessionId
    && left.launchId === right.launchId
    && left.autoEnvironmentInstall === right.autoEnvironmentInstall
    && left.panel === right.panel
    && left.terminal === right.terminal
    && left.mobileView === right.mobileView
    && left.create === right.create
}
