/**
 * [INPUT]: Railway project/environment/deployment facts and local resource bindings.
 * [OUTPUT]: Shared contracts for linking Railway deployments to Wemux context.
 * [POS]: Pure cross-app domain boundary; remote deployment facts remain in provider-specific records.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export type RailwayResourceType = 'deployment'

export type RailwayResourceBindingStatus = 'suggested' | 'confirmed' | 'rejected'

export type RailwayResourceBindingRole = 'delivery' | 'reference' | 'review' | 'execution'

export type RailwayResourceBindingSource =
  | 'agent_output'
  | 'branch_match'
  | 'manual'
  | 'railway_webhook'
  | 'legacy_migration'

export type RailwayResourceBindingTarget = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

export type RailwayResourceBinding = RailwayResourceBindingTarget & {
  id: string
  provider: 'railway'
  resourceType: RailwayResourceType
  resourceId: string
  projectId: string
  role: RailwayResourceBindingRole
  status: RailwayResourceBindingStatus
  source: RailwayResourceBindingSource
  confidence?: number
  createdByUserId?: string
  createdAt: string
  updatedAt: string
}

export type RailwayResourceBindingUpsertInput = RailwayResourceBindingTarget & {
  provider?: 'railway'
  resourceType: RailwayResourceType
  resourceId: string
  projectId: string
  role?: RailwayResourceBindingRole
  status?: RailwayResourceBindingStatus
  source: RailwayResourceBindingSource
  confidence?: number
  createdByUserId?: string
}

export type RailwayResourceBindingFilter = {
  projectId?: string
  projectIds?: string[]
  resourceType?: RailwayResourceType
  resourceId?: string
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  status?: RailwayResourceBindingStatus
}

export interface RailwayResourceBindingListResponse {
  bindings: RailwayResourceBinding[]
}

export type RailwayConnectionStatus = 'connected' | 'error' | 'disconnected'

/** web/server 两端都理解的连接摘要契约（不含 token）。 */
export type RailwayConnectionSummary = {
  id: string
  userId: string
  accountEmail?: string
  accountName?: string
  status: RailwayConnectionStatus
  lastSyncedAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
  hasToken: boolean
}

/** Railway 部署状态枚举（与 Railway GraphQL `Deployment.status` 对齐）。 */
export const RAILWAY_DEPLOYMENT_STATUSES = [
  'BUILDING',
  'CRASHED',
  'DEPLOYING',
  'FAILED',
  'INITIALIZING',
  'NEEDS_APPROVAL',
  'QUEUED',
  'REMOVED',
  'REMOVING',
  'SKIPPED',
  'SLEEPING',
  'SUCCESS',
  'WAITING',
] as const

export type RailwayDeploymentStatus = (typeof RAILWAY_DEPLOYMENT_STATUSES)[number]

export type RailwayDeploymentStatusGroup =
  | 'success'
  | 'failed'
  | 'building'
  | 'sleeping'
  | 'removed'

export type RailwayDeploymentSummary = {
  /** Railway deployment id。 */
  id: string
  railwayProjectId: string
  environmentId: string
  environmentName: string
  isEphemeral: boolean
  prNumber?: number
  prTitle?: string
  prRepo?: string
  branch?: string
  baseBranch?: string
  serviceId?: string
  serviceName?: string
  status: RailwayDeploymentStatus
  url?: string
  staticUrl?: string
  isLatest: boolean
  syncedAt: string
  updatedAt: string
}

export const isRailwayDeploymentStatus = (
  value: string | null | undefined,
): value is RailwayDeploymentStatus => (
  Boolean(value) && (RAILWAY_DEPLOYMENT_STATUSES as readonly string[]).includes(value as string)
)

/** 归一化部署状态到展示分组（web badge 据此选 tone/icon，server 可复用判断）。 */
export const resolveRailwayDeploymentStatusGroup = (
  status: RailwayDeploymentStatus | string | null | undefined,
): RailwayDeploymentStatusGroup => {
  switch (status) {
    case 'SUCCESS':
      return 'success'
    case 'FAILED':
    case 'CRASHED':
      return 'failed'
    case 'BUILDING':
    case 'DEPLOYING':
    case 'QUEUED':
    case 'WAITING':
    case 'INITIALIZING':
    case 'NEEDS_APPROVAL':
      return 'building'
    case 'SLEEPING':
      return 'sleeping'
    case 'REMOVED':
    case 'REMOVING':
    case 'SKIPPED':
    default:
      return 'removed'
  }
}

export const isRailwayDeploymentActive = (
  status: RailwayDeploymentStatus | string | null | undefined,
) => {
  const group = resolveRailwayDeploymentStatusGroup(status)
  return group !== 'removed'
}

export const buildRailwayResourceId = (params: {
  railwayProjectId: string
  environmentId: string
  deploymentId: string
}) => [
  'railway',
  params.railwayProjectId.trim(),
  params.environmentId.trim(),
  params.deploymentId.trim(),
].join(':')

export const buildRailwayResourceBindingContextKey = (
  target: RailwayResourceBindingTarget,
) => {
  const taskId = target.taskId?.trim() || ''
  const workspaceId = target.workspaceId?.trim() || ''
  const workspaceSessionId = target.workspaceSessionId?.trim() || ''

  if (!taskId && !workspaceId && !workspaceSessionId) {
    throw new Error('Railway resource binding requires a task, workspace, or workspace session target.')
  }

  return [
    `task:${taskId}`,
    `workspace:${workspaceId}`,
    `session:${workspaceSessionId}`,
  ].join('|')
}

export const resolveRailwayResourceBindingStatus = (
  current: RailwayResourceBindingStatus | undefined,
  incoming: RailwayResourceBindingStatus,
) => {
  if (!current || incoming === 'confirmed' || incoming === 'rejected') {
    return incoming
  }

  return current
}

export const isActiveRailwayResourceBinding = (
  binding: Pick<RailwayResourceBinding, 'status'>,
) => binding.status !== 'rejected'
