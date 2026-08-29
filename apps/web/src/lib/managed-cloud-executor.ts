import { MANAGED_CLOUD_AUTO_EXECUTOR_ID, isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import type { ExecutorRecord } from '@shared/types'
import type { ManagedCloudRuntimeStatus } from './api'
import { isManagedCloudDevOnlyEnabled } from './runtime-config'

export const createManagedCloudExecutorOption = (runtime: ManagedCloudRuntimeStatus | null): ExecutorRecord => {
  const timestamp = new Date().toISOString()
  const boxRuntimeLabel = runtime?.providerName === 'ascii-box-cli' || runtime?.providerName === 'ascii-box-sdk' ? 'ASCII Box' : 'BoxLite'
  const machineName = runtime?.isolationMode === 'container'
    ? (runtime.poolSize > 1
        ? 'Hosted Cloud · Remote Container Pool'
        : runtime.hostMode === 'remote-cloudflare-sandbox'
          ? 'Hosted Cloud · Cloudflare Sandbox'
          : runtime.hostMode === 'remote-docker-host'
            ? 'Hosted Cloud · Remote Container Host'
            : runtime.hostMode === 'remote-boxlite-host'
              ? `Hosted Cloud · Remote ${boxRuntimeLabel} Host`
            : 'Hosted Cloud · Local Docker Runtime')
    : 'Hosted Cloud'

  return {
    executorId: MANAGED_CLOUD_AUTO_EXECUTOR_ID,
    machineId: MANAGED_CLOUD_AUTO_EXECUTOR_ID,
    machineName,
    name: 'Hosted Cloud',
    executorSource: 'managed-cloud',
    managedBy: 'vibemux',
    runtimeClass: 'managed-worker',
    billingClass: 'managed',
    ownerUserId: '',
    visibility: 'private',
    status: 'online',
    workspaceRoot: '',
    maxConcurrency: 2,
    capabilities: ['code-execution', 'git-operations'],
    labels: ['official', 'cloud', 'virtual'],
    createdAt: timestamp,
    lastSeenAt: timestamp,
    presence: {
      runningTaskIds: [],
      queuedTaskIds: [],
      lastHeartbeatAt: timestamp,
    },
  }
}

export const hasManagedCloudExecutor = (executors: ExecutorRecord[]) => {
  if (!isManagedCloudDevOnlyEnabled()) {
    return false
  }

  return executors.some((executor) => executor.executorSource === 'managed-cloud' || executor.managedBy === 'vibemux')
}

export const isManagedCloudExecutorRecord = (executor?: ExecutorRecord | null) => {
  return Boolean(executor && (executor.executorSource === 'managed-cloud' || executor.managedBy === 'vibemux'))
}

/**
 * 托管云节点按需拉起：空闲自动停止后用户一用即恢复。
 * 展示层把托管云节点视为“有效在线”，避免用户误以为节点不可用。
 */
export const isExecutorEffectivelyOnline = (executor?: {
  status?: string
  executorSource?: string
  managedBy?: string
} | null) => {
  if (!executor) {
    return false
  }
  if (executor.status === 'online') {
    return true
  }
  return isManagedCloudExecutorRecord(executor as ExecutorRecord)
}

/**
 * Agent 的有效可用性：运行中心跳在线；或绑定/默认执行节点落在托管云节点（按需可用）。
 * - 显式 defaultExecutorId 是托管云节点记录 → 视为在线
 * - 未配置 defaultExecutorId 或为 managed-cloud:auto → 走系统默认（托管云节点）→ 视为在线
 */
export const isAgentEffectivelyOnline = (params: {
  agentStatus?: string
  defaultExecutorId?: string
  executors?: ExecutorRecord[]
}): boolean => {
  if (params.agentStatus === 'online') {
    return true
  }
  if (params.agentStatus === 'error') {
    return false
  }

  const defaultExecutorId = params.defaultExecutorId?.trim()
  if (!defaultExecutorId || isManagedCloudAutoExecutorId(defaultExecutorId)) {
    return true
  }

  const executor = (params.executors ?? []).find((item) => item.executorId === defaultExecutorId)
  return isExecutorEffectivelyOnline(executor)
}

export const normalizeManagedCloudExecutorForDisplay = (
  executor: ExecutorRecord,
  runtime: ManagedCloudRuntimeStatus | null,
): ExecutorRecord => {
  if (!isManagedCloudDevOnlyEnabled()) {
    return executor
  }

  if (!isManagedCloudExecutorRecord(executor)) {
    return executor
  }

  if (!runtime?.available) {
    return executor
  }

  if (executor.status === 'online') {
    return executor
  }

  return {
    ...executor,
    status: 'online',
  }
}

export const buildExecutorOptionsWithManagedCloud = (
  executors: ExecutorRecord[],
  runtime: ManagedCloudRuntimeStatus | null,
  options?: {
    includeOffline?: boolean
  },
) => {
  const includeOffline = options?.includeOffline ?? false

  if (!isManagedCloudDevOnlyEnabled()) {
    return executors.filter((executor) => (
      (executor.status === 'online' || executor.status === 'paired' || (includeOffline && executor.status === 'offline'))
      && !isManagedCloudExecutorRecord(executor)
    ))
  }

  const normalizedExecutors = executors.map((executor) => normalizeManagedCloudExecutorForDisplay(executor, runtime))
  const visibleExecutors = normalizedExecutors.filter((executor) => (
    executor.status === 'online'
    || executor.status === 'paired'
    || (includeOffline && executor.status === 'offline')
    || isManagedCloudExecutorRecord(executor)
  ))
  if (hasManagedCloudExecutor(visibleExecutors)) {
    return visibleExecutors
  }

  if (!runtime?.available) {
    return visibleExecutors
  }

  return [createManagedCloudExecutorOption(runtime), ...visibleExecutors]
}
