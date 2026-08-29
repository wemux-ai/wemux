/**
 * [INPUT]: Executor persistence, cluster ownership, presence updates, and live WebSocket instances.
 * [OUTPUT]: The control plane's executor registry, socket lookup, and connection lifecycle operations.
 * [POS]: Authoritative in-process executor connection state for control-plane routing.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createHash, randomBytes } from 'node:crypto'
import type { ClusterNode, ExecutorDescriptor, ExecutorLatencySnapshot, ExecutorPairingCodeRecord, ExecutorPairRequest, ExecutorTelemetrySnapshot, ExecutorVisibility, WorkerMeshStatus, WorkerProjectBinding } from '@shared/types'
import { clusterConfig } from '../cluster/config'
import { markDistributedTaskLost, syncDistributedTaskEvent } from '../cluster/task-sync'
import { createExecutionEvent } from '../storage/execution-event-store'
import { track } from '../services/telemetry-service'
import { CLUSTER_NODE_STALE_TIMEOUT_MS, ensureCurrentNodeRecord, getNodeFresh, listExecutorDistributedTasks, markStaleClusterNodesOffline, updateDistributedTask } from '../storage/distributed-task-store'
import { isPostgresConfigured } from '../storage/postgres/db'
import { consumePersistedExecutorPairingCode, createPersistedExecutorPairingCode } from '../storage/postgres/executor-pairing-code-store'
import { getCommercialGate } from '../services/gate/commercial-gate'
import {
  claimPersistedExecutorConnection,
  deletePersistedExecutor,
  forceReleasePersistedExecutorConnection,
  getPersistedExecutor,
  listPersistedExecutors,
  listPersistedExecutorsFresh,
  releasePersistedExecutorConnection,
  savePersistedExecutor,
} from '../storage/postgres/executor-store'

type ExecutorSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: () => void
  /** ws 原生实例才有；半开连接用 close() 可能永远发不出握手帧，terminate 能立即释放 */
  terminate?: () => void
}

type ExecutorSecretRecord = {
  tokenHash: string
  previewProxySecret: string
}

type ExecutorPresenceRecord = {
  runningTaskIds: string[]
  queuedTaskIds: string[]
  lastHeartbeatAt: string
  telemetry?: ExecutorTelemetrySnapshot
  latency?: ExecutorLatencySnapshot
  mesh?: WorkerMeshStatus
}

const executors = new Map<string, ExecutorDescriptor>()
const executorSecrets = new Map<string, ExecutorSecretRecord>()
const executorSockets = new Map<string, ExecutorSocket>()
const replacedExecutorSockets = new WeakSet<ExecutorSocket>()
const executorPresence = new Map<string, ExecutorPresenceRecord>()
const executorProjectBindings = new Map<string, WorkerProjectBinding[]>()
const staleWorkNotifications = new Set<string>()
let offlineListener: ((executorId: string, reason: string) => void) | null = null
let onlineListener: ((executorId: string) => void) | null = null

const EXECUTOR_STALE_TIMEOUT_MS = 45_000

// 心跳类软字段（lastSeenAt / localServerPort / preview ingress 探测结果等）
// 不需要每次心跳都落库：worker 每 15s 心跳一次，而 storage_change 触发器会把
// 每次 executors 写入放大为全量缓存刷新（nodes/workspaces/tasks 全表重建），
// 高频落库正是 preview 内存持续上涨的燃料。心跳持久化统一限频到 60s。
const EXECUTOR_HEARTBEAT_PERSIST_THROTTLE_MS = 60_000
const lastHeartbeatPersistAt = new Map<string, number>()

// 这些字段变化时即使处于节流窗口也必须立即落库（影响路由/归属/能力）。
const EXECUTOR_CRITICAL_PATCH_FIELDS: (keyof ExecutorDescriptor)[] = [
  'status',
  'capabilities',
  'labels',
  'workspaceRoot',
  'maxConcurrency',
  'sshPubkey',
  'previewExposureMode',
  'previewIngressPort',
  'previewIngressBaseUrl',
]

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const nowIso = () => new Date().toISOString()

const isSocketAlive = (socket: ExecutorSocket | null | undefined) => {
  if (!socket) {
    return false
  }

  return socket.readyState === 1 || socket.readyState === socket.OPEN
}

const buildPairingCode = () => randomBytes(4).toString('hex').toUpperCase()

const buildExecutorToken = () => randomBytes(24).toString('base64url')

const buildPreviewProxySecret = () => randomBytes(32).toString('base64url')

const normalizeWorkspaceIds = (workspaceIds?: string[], teamId?: string) => {
  const values = workspaceIds ?? (teamId ? [teamId] : [])
  return Array.from(new Set(values.map((value) => value?.trim() || '').filter(Boolean)))
}

const normalizeExecutorDescriptor = (executor: ExecutorDescriptor): ExecutorDescriptor => ({
  ...executor,
  workspaceIds: normalizeWorkspaceIds(executor.workspaceIds, executor.teamId),
  previewExposureMode: executor.previewExposureMode ?? 'private',
  previewIngressPort: executor.previewIngressPort ?? 38080,
  executorSource: executor.executorSource ?? 'customer-worker',
  managedBy: executor.managedBy ?? 'user',
  runtimeClass: executor.runtimeClass ?? 'user-worker',
  billingClass: executor.billingClass ?? 'standard',
})

const persistExecutorState = (executorId: string) => {
  const executor = executors.get(executorId)
  const secret = executorSecrets.get(executorId)
  if (!executor || !secret) {
    return
  }

  savePersistedExecutor(executor, secret.tokenHash, secret.previewProxySecret)
}

const hydrateRegistryFromStore = (): void => {
  if (executors.size > 0 || executorSecrets.size > 0) {
    return
  }

  for (const entry of listPersistedExecutors()) {
    executors.set(entry.executor.executorId, normalizeExecutorDescriptor(entry.executor))
    executorSecrets.set(entry.executor.executorId, {
      tokenHash: entry.tokenHash,
      previewProxySecret: entry.previewProxySecret || buildPreviewProxySecret(),
    })
  }
}

const findExecutorByMachine = (ownerUserId: string, machineId: string) => {
  for (const executor of executors.values()) {
    if (executor.ownerUserId === ownerUserId && executor.machineId === machineId) {
      return executor
    }
  }

  return null
}

const normalizeProjectBindings = (bindings?: WorkerProjectBinding[]) => {
  const seen = new Set<string>()
  const normalized: WorkerProjectBinding[] = []

  for (const binding of bindings ?? []) {
    const localPath = binding.localPath?.trim() || ''
    if (!localPath) {
      continue
    }

    const normalizedBinding: WorkerProjectBinding = {
      projectId: binding.projectId?.trim() || undefined,
      repoUrl: binding.repoUrl?.trim() || undefined,
      localPath,
    }
    const dedupeKey = `${normalizedBinding.projectId || ''}::${normalizedBinding.repoUrl || ''}::${normalizedBinding.localPath}`
    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    normalized.push(normalizedBinding)
  }

  return normalized
}

const markExecutorOffline = async (executorId: string, reason: string, options?: { force?: boolean }) => {
  const executor = executors.get(executorId)
  if (!executor) {
    return
  }

  const at = nowIso()
  const released = options?.force
    ? await forceReleasePersistedExecutorConnection({
        executorId,
        nodeId: executor.connectedNodeId?.trim() || clusterConfig.nodeId,
        at,
      })
    : await releasePersistedExecutorConnection({
        executorId,
        nodeId: clusterConfig.nodeId,
        at,
      })
  if (!released) {
    return
  }
  const previousPresence = executorPresence.get(executorId)

  // 执行器已离线：清除心跳节流状态，避免离线后残留 Map 条目。
  lastHeartbeatPersistAt.delete(executorId)

  executors.set(executorId, normalizeExecutorDescriptor(released.executor))
  executorPresence.set(executorId, {
    runningTaskIds: previousPresence?.runningTaskIds ?? [],
    queuedTaskIds: previousPresence?.queuedTaskIds ?? [],
    lastHeartbeatAt: previousPresence?.lastHeartbeatAt ?? at,
    telemetry: previousPresence?.telemetry,
    latency: previousPresence?.latency,
    mesh: previousPresence?.mesh,
  })
  createExecutionEvent({
    eventType: 'disconnect',
    severity: 'connection',
    isFailure: true,
    executorId: executor.executorId,
    executorName: executor.name,
    ownerUserId: executor.ownerUserId,
    teamId: executor.teamId,
    message: reason,
    payload: {
      executorId: executor.executorId,
      reason,
    },
    layer: 'connection',
  })
  const shouldRequeueDispatchLease = reason.includes('heartbeat timed out')
  for (const task of listExecutorDistributedTasks(executorId)) {
    if (task.status === 'assigned' || task.status === 'preparing') {
      if (!shouldRequeueDispatchLease) {
        continue
      }
      updateDistributedTask({
        ...task,
        status: 'queued',
        leaseExpiresAt: undefined,
        updatedAt: at,
      })
      syncDistributedTaskEvent({
        taskId: task.id,
        status: 'queued',
        message: `${reason}，任务回到控制面队列。`,
        at,
      })
      continue
    }

    if (shouldRequeueDispatchLease && ['executing', 'syncing_back'].includes(task.status)) {
      markDistributedTaskLost(task, reason)
    }
  }

  if (shouldRequeueDispatchLease) {
    staleWorkNotifications.add(executorId)
    offlineListener?.(executorId, reason)
  }
}

const hasFreshPresence = (presence: ExecutorPresenceRecord | undefined) => {
  if (!presence) {
    return false
  }

  return Date.now() - new Date(presence.lastHeartbeatAt).getTime() <= EXECUTOR_STALE_TIMEOUT_MS
}

/**
 * 心跳超时的执行器 socket 可能处于 TCP 半开状态（worker 断网/拔线不会触发 close 事件），
 * 只从注册表删引用会让底层连接与缓冲区滞留到 OS 超时，累积导致内存爬升。
 * 这里主动终止：worker 若仍存活会自动重连（onOpen 已记录 reconnect 事件）。
 */
const forceCloseExecutorSocket = (socket: ExecutorSocket | null | undefined) => {
  if (!isSocketAlive(socket)) {
    return
  }
  try {
    if (typeof socket?.terminate === 'function') {
      socket.terminate()
      return
    }
    socket?.close()
  } catch (error) {
    console.error('[executor-registry] failed to force-close stale executor socket', error)
  }
}

const syncExecutorLiveness = (executorId: string) => {
  const executor = executors.get(executorId)
  if (!executor || executor.status !== 'online') {
    return executor ?? null
  }

  if (executor.connectedNodeId && executor.connectedNodeId !== clusterConfig.nodeId) {
    return executor
  }

  const socket = executorSockets.get(executorId)
  const presence = executorPresence.get(executorId)
  if (isSocketAlive(socket) && hasFreshPresence(presence)) {
    return executor
  }

  executorSockets.delete(executorId)
  forceCloseExecutorSocket(socket)
  void markExecutorOffline(
    executorId,
    presence && !hasFreshPresence(presence)
      ? 'executor heartbeat timed out'
      : 'executor websocket unavailable',
  )
  return executors.get(executorId) ?? null
}

const markExecutorStaleWorkLost = (executorId: string) => {
  if (staleWorkNotifications.has(executorId)) {
    return
  }

  const executor = executors.get(executorId)
  if (executor?.connectedNodeId && executor.connectedNodeId !== clusterConfig.nodeId) {
    return
  }

  const presence = executorPresence.get(executorId)
  if (hasFreshPresence(presence)) {
    return
  }

  const reason = 'executor heartbeat timed out'
  const activeTasks = listExecutorDistributedTasks(executorId).filter((task) => ['executing', 'syncing_back'].includes(task.status))
  for (const task of activeTasks) {
    markDistributedTaskLost(task, reason)
  }

  staleWorkNotifications.add(executorId)
  offlineListener?.(executorId, reason)
}

// 集群节点心跳窗口定义在 distributed-task-store（单一来源），此处直接复用。
export const isClusterNodeHeartbeatFresh = (node: ClusterNode | null) => {
  if (!node) {
    return false
  }

  return Date.now() - new Date(node.lastHeartbeatAt).getTime() <= CLUSTER_NODE_STALE_TIMEOUT_MS
}

/**
 * 回收“归属节点已失联”的孤立执行器在线状态。
 *
 * 单节点部署时 server 容器重建（新 nodeId）后，旧容器持有的执行器连接会遗留
 * connectedNodeId 指向已死亡的节点；而 syncExecutorLiveness 对非本节点归属的执行器
 * 会无条件跳过（避免误抢其他在线节点的执行器），导致这些执行器永久显示 online，
 * 但所有控制面请求（模型同步/仓库准备/任务执行）都报“执行节点当前不在线”。
 *
 * 这里先持久化本节点心跳，再用 getNodeFresh 读取归属节点的真实心跳：
 * 只有当归属节点确认不存在/心跳超时才强制回收，正常在线节点不受影响。
 */
const reconcileOrphanedExecutorConnections = async () => {
  if (isPostgresConfigured()) {
    ensureCurrentNodeRecord()
  }

  for (const executorId of executors.keys()) {
    const executor = executors.get(executorId)
    const connectedNodeId = executor?.connectedNodeId?.trim()
    if (!executor || !connectedNodeId || connectedNodeId === clusterConfig.nodeId) {
      continue
    }

    const owningNode = await getNodeFresh(connectedNodeId).catch(() => null)
    if (isClusterNodeHeartbeatFresh(owningNode)) {
      continue
    }

    // 归属节点已失联：仅当本节点确实没有该执行器的活动 socket 时才强制回收。
    const socket = executorSockets.get(executorId)
    if (isSocketAlive(socket)) {
      continue
    }

    executorSockets.delete(executorId)
    void markExecutorOffline(
      executorId,
      'executor 归属节点失联（heartbeat timed out），已回收在线状态。',
      { force: true },
    )
  }
}

const executorLivenessInterval = setInterval(() => {
  void (async () => {
    if (isPostgresConfigured()) {
      await markStaleClusterNodesOffline()
    }
    await reconcileOrphanedExecutorConnections()
    hydrateRegistryFromStore()
    for (const executorId of executors.keys()) {
      syncExecutorLiveness(executorId)
      markExecutorStaleWorkLost(executorId)
    }
  })().catch((error) => {
    console.error('[executor-registry] liveness loop failed', error)
  })
}, 15_000)

executorLivenessInterval.unref?.()

export const executorRegistry = {
  async refreshPersistedState() {
    const persistedEntries = await listPersistedExecutorsFresh()
    const persistedIds = new Set(persistedEntries.map((entry) => entry.executor.executorId))

    for (const entry of persistedEntries) {
      const executorId = entry.executor.executorId
      const localSocket = executorSockets.get(executorId)
      if (localSocket && entry.executor.connectedNodeId !== clusterConfig.nodeId) {
        executorSockets.delete(executorId)
        localSocket.close()
      }
      executors.set(executorId, normalizeExecutorDescriptor(entry.executor))
      executorSecrets.set(executorId, {
        tokenHash: entry.tokenHash,
        previewProxySecret: entry.previewProxySecret || buildPreviewProxySecret(),
      })
    }

    for (const executorId of executors.keys()) {
      if (persistedIds.has(executorId)) {
        continue
      }
      executorSockets.get(executorId)?.close()
      executors.delete(executorId)
      executorSecrets.delete(executorId)
      executorSockets.delete(executorId)
      executorPresence.delete(executorId)
      executorProjectBindings.delete(executorId)
    }
  },

  async createPairingCode(params: {
    ownerUserId: string
    teamId?: string
    workspaceIds?: string[]
    visibility: ExecutorVisibility
    previewExposureMode?: 'private' | 'public-ingress'
    label?: string
    ttlMinutes?: number
  }) {
    hydrateRegistryFromStore()
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + (params.ttlMinutes ?? 10) * 60_000).toISOString()
    const record: ExecutorPairingCodeRecord = {
      pairingCode: buildPairingCode(),
      ownerUserId: params.ownerUserId,
      teamId: params.teamId,
      workspaceIds: normalizeWorkspaceIds(params.workspaceIds, params.teamId),
      visibility: params.visibility,
      previewExposureMode: params.previewExposureMode ?? 'private',
      label: params.label,
      createdAt,
      expiresAt,
    }

    await createPersistedExecutorPairingCode(record)
    return record
  },

  async exchangePairingCode(request: ExecutorPairRequest) {
    hydrateRegistryFromStore()
    const createdAt = nowIso()
    const pairingResult = await consumePersistedExecutorPairingCode(request.pairingCode, createdAt)
    if (pairingResult.status === 'missing') {
      return { ok: false as const, message: '配对码不存在。' }
    }
    const pairing = pairingResult.record

    if (pairingResult.status === 'used') {
      return { ok: false as const, message: '配对码已使用。', ownerUserId: pairing.ownerUserId, teamId: pairing.teamId }
    }

    if (pairingResult.status === 'expired') {
      return { ok: false as const, message: '配对码已过期。', ownerUserId: pairing.ownerUserId, teamId: pairing.teamId }
    }

    const executorToken = buildExecutorToken()
    const persistedExecutors = await listPersistedExecutorsFresh()
    const visibleExecutors = persistedExecutors.map((entry) => entry.executor)
    const reusedExecutor = visibleExecutors.find((executor) => (
      executor.ownerUserId === pairing.ownerUserId
      && executor.machineId === request.machineId
    )) ?? null
    if (pairing.visibility === 'private') {
      const quotaAccess = getCommercialGate().buildFreePrivateExecutorQuotaAccess(
        pairing.ownerUserId,
        visibleExecutors,
        { machineId: request.machineId },
      )
      if (!quotaAccess.allowed) {
        return {
          ok: false as const,
          message: quotaAccess.message,
          ownerUserId: pairing.ownerUserId,
          teamId: pairing.teamId,
        }
      }
    }
    const displayName = pairing.label?.trim() || request.name.trim() || request.machineName
    const executorId = reusedExecutor?.executorId ?? crypto.randomUUID()
    const reusedSecret = reusedExecutor ? executorSecrets.get(reusedExecutor.executorId) : null
    const executor: ExecutorDescriptor = {
      executorId,
      machineId: request.machineId,
      machineName: request.machineName,
      name: displayName,
      previewExposureMode: reusedExecutor?.previewExposureMode ?? pairing.previewExposureMode ?? 'private',
      previewIngressPort: reusedExecutor?.previewIngressPort ?? 38080,
      previewIngressBaseUrl: reusedExecutor?.previewIngressBaseUrl,
      previewIngressDetectedPublicIp: reusedExecutor?.previewIngressDetectedPublicIp,
      previewIngressDetectedLanIp: reusedExecutor?.previewIngressDetectedLanIp,
      previewIngressReachable: reusedExecutor?.previewIngressReachable,
      previewIngressLastCheckedAt: reusedExecutor?.previewIngressLastCheckedAt,
      previewIngressLastError: reusedExecutor?.previewIngressLastError,
      executorSource: reusedExecutor?.executorSource ?? 'customer-worker',
      managedBy: reusedExecutor?.managedBy ?? 'user',
      runtimeClass: reusedExecutor?.runtimeClass ?? 'user-worker',
      billingClass: reusedExecutor?.billingClass ?? 'standard',
      note: reusedExecutor?.note,
      ownerUserId: pairing.ownerUserId,
      teamId: pairing.teamId,
      workspaceIds: normalizeWorkspaceIds(pairing.workspaceIds, pairing.teamId),
      connectedNodeId: undefined,
      visibility: pairing.visibility,
      status: 'paired',
      workspaceRoot: request.workspaceRoot,
      maxConcurrency: request.maxConcurrency,
      capabilities: request.capabilities,
      labels: request.labels,
      platform: request.platform,
      version: request.version,
      createdAt: reusedExecutor?.createdAt ?? createdAt,
      lastSeenAt: createdAt,
    }

    const previousSocket = executorSockets.get(executorId)
    if (previousSocket) {
      previousSocket.close()
      executorSockets.delete(executorId)
    }

    executors.set(executorId, normalizeExecutorDescriptor(executor))
    executorSecrets.set(executorId, {
      tokenHash: hashToken(executorToken),
      previewProxySecret: reusedSecret?.previewProxySecret || buildPreviewProxySecret(),
    })
    executorPresence.set(executorId, {
      runningTaskIds: [],
      queuedTaskIds: [],
      lastHeartbeatAt: createdAt,
    })
    persistExecutorState(executorId)

    // 产品一手 telemetry：worker 首次配对 / 复用配对都记录，供激活漏斗与运营看板使用
    void track({
      eventType: 'worker_paired',
      userId: pairing.ownerUserId,
      teamId: pairing.teamId ?? undefined,
      executorNodeId: executorId,
      payload: { reused: Boolean(reusedExecutor) },
    })

    return {
      ok: true as const,
      executorId,
      executorToken,
      executor,
    }
  },

  authenticateExecutorToken(token: string) {
    hydrateRegistryFromStore()
    const tokenHash = hashToken(token)
    for (const [executorId, secret] of executorSecrets.entries()) {
      if (secret.tokenHash !== tokenHash) {
        continue
      }

      return executors.get(executorId) ?? null
    }

    return null
  },

  getPreviewProxySecret(executorId: string) {
    hydrateRegistryFromStore()
    const secret = executorSecrets.get(executorId)?.previewProxySecret?.trim() || ''
    if (secret) {
      return secret
    }

    const executor = executors.get(executorId)
    const current = executorSecrets.get(executorId)
    if (!executor || !current) {
      return ''
    }

    const nextSecret = buildPreviewProxySecret()
    executorSecrets.set(executorId, {
      ...current,
      previewProxySecret: nextSecret,
    })
    persistExecutorState(executorId)
    return nextSecret
  },

  upsertExecutor(executorId: string, patch: Partial<ExecutorDescriptor>) {
    hydrateRegistryFromStore()
    const current = executors.get(executorId)
    if (!current) {
      return null
    }

    const next: ExecutorDescriptor = {
      ...current,
      ...patch,
      executorId: current.executorId,
    }

    executors.set(executorId, normalizeExecutorDescriptor(next))
    persistExecutorState(executorId)
    return executors.get(executorId) ?? null
  },

  /**
   * 心跳专用更新：worker 每 15s 上报一次，但 executors 落库限频到 60s，
   * 避免每次心跳都触发 storage_change → 全量缓存刷新（内存放大循环）。
   * 关键字段（status/capabilities/workspaceRoot/preview 配置等）变化时立即落库。
   */
  updateExecutorHeartbeat(executorId: string, patch: Partial<ExecutorDescriptor>) {
    hydrateRegistryFromStore()
    const current = executors.get(executorId)
    if (!current) {
      return null
    }

    const next: ExecutorDescriptor = {
      ...current,
      ...patch,
      executorId: current.executorId,
    }
    executors.set(executorId, normalizeExecutorDescriptor(next))

    const criticalChanged = EXECUTOR_CRITICAL_PATCH_FIELDS.some((field) => (
      patch[field] !== undefined && patch[field] !== current[field]
    ))
    const now = Date.now()
    const lastPersistAt = lastHeartbeatPersistAt.get(executorId) ?? 0
    if (criticalChanged || now - lastPersistAt >= EXECUTOR_HEARTBEAT_PERSIST_THROTTLE_MS) {
      lastHeartbeatPersistAt.set(executorId, now)
      persistExecutorState(executorId)
    }
    return executors.get(executorId) ?? null
  },

  createManagedExecutor(params: {
    ownerUserId: string
    teamId?: string
    workspaceIds?: string[]
    visibility: ExecutorVisibility
    machineId: string
    machineName: string
    name: string
    workspaceRoot: string
    maxConcurrency: number
    capabilities: string[]
    labels: string[]
    note?: string
    platform?: string
    version?: string
  }) {
    hydrateRegistryFromStore()
    const createdAt = nowIso()
    const existing = findExecutorByMachine(params.ownerUserId, params.machineId)
    const executorId = existing?.executorId ?? crypto.randomUUID()
    const executor = normalizeExecutorDescriptor({
      executorId,
      machineId: params.machineId,
      machineName: params.machineName,
      name: params.name,
      previewExposureMode: existing?.previewExposureMode ?? 'private',
      previewIngressPort: existing?.previewIngressPort ?? 38080,
      previewIngressBaseUrl: existing?.previewIngressBaseUrl,
      previewIngressDetectedPublicIp: existing?.previewIngressDetectedPublicIp,
      previewIngressDetectedLanIp: existing?.previewIngressDetectedLanIp,
      previewIngressReachable: existing?.previewIngressReachable,
      previewIngressLastCheckedAt: existing?.previewIngressLastCheckedAt,
      previewIngressLastError: existing?.previewIngressLastError,
      executorSource: 'managed-cloud',
      managedBy: 'vibemux',
      runtimeClass: 'managed-worker',
      billingClass: 'managed',
      note: params.note ?? existing?.note,
      ownerUserId: params.ownerUserId,
      teamId: params.teamId,
      workspaceIds: normalizeWorkspaceIds(params.workspaceIds, params.teamId),
      connectedNodeId: existing?.status === 'online' ? existing.connectedNodeId : undefined,
      visibility: params.visibility,
      status: existing?.status === 'online' ? 'online' : 'offline',
      workspaceRoot: params.workspaceRoot,
      maxConcurrency: params.maxConcurrency,
      capabilities: params.capabilities,
      labels: params.labels,
      platform: params.platform,
      version: params.version,
      createdAt: existing?.createdAt ?? createdAt,
      lastSeenAt: existing?.lastSeenAt ?? createdAt,
    })
    const executorToken = buildExecutorToken()

    executors.set(executorId, executor)
    executorSecrets.set(executorId, {
      tokenHash: hashToken(executorToken),
      previewProxySecret: executorSecrets.get(executorId)?.previewProxySecret || buildPreviewProxySecret(),
    })
    executorPresence.set(executorId, executorPresence.get(executorId) ?? {
      runningTaskIds: [],
      queuedTaskIds: [],
      lastHeartbeatAt: createdAt,
    })
    persistExecutorState(executorId)

    return {
      executor,
      executorId,
      executorToken,
      created: !existing,
    }
  },

  rotateExecutorToken(executorId: string) {
    hydrateRegistryFromStore()
    const executor = executors.get(executorId)
    if (!executor) {
      return null
    }

    const executorToken = buildExecutorToken()
    executorSecrets.set(executorId, {
      tokenHash: hashToken(executorToken),
      previewProxySecret: executorSecrets.get(executorId)?.previewProxySecret || buildPreviewProxySecret(),
    })
    persistExecutorState(executorId)
    return {
      executor,
      executorToken,
    }
  },

  async registerSocket(executorId: string, socket: ExecutorSocket) {
    hydrateRegistryFromStore()
    const previousStatus = executors.get(executorId)?.status
    const previous = executorSockets.get(executorId)
    if (previous && previous !== socket) {
      replacedExecutorSockets.add(previous)
      previous.close()
    }

    executorSockets.set(executorId, socket)
    staleWorkNotifications.delete(executorId)
    executorPresence.set(executorId, {
      runningTaskIds: executorPresence.get(executorId)?.runningTaskIds ?? [],
      queuedTaskIds: executorPresence.get(executorId)?.queuedTaskIds ?? [],
      lastHeartbeatAt: nowIso(),
      telemetry: executorPresence.get(executorId)?.telemetry,
      latency: executorPresence.get(executorId)?.latency,
      mesh: executorPresence.get(executorId)?.mesh,
    })
    const connectedAt = nowIso()
    const persisted = await claimPersistedExecutorConnection({
      executorId,
      nodeId: clusterConfig.nodeId,
      at: connectedAt,
    })
    if (!persisted) {
      executorSockets.delete(executorId)
      throw new Error('执行器不存在，无法登记连接归属。')
    }
    const next = normalizeExecutorDescriptor(persisted.executor)
    executors.set(executorId, next)
    if (previousStatus !== 'online') {
      onlineListener?.(executorId)
    }
    return next
  },

  async unregisterSocket(executorId: string, socket: ExecutorSocket) {
    hydrateRegistryFromStore()
    const current = executorSockets.get(executorId)
    if (current === socket) {
      executorSockets.delete(executorId)
      await markExecutorOffline(executorId, 'executor websocket disconnected')
    }
  },

  shouldHandleSocketClose(socket: ExecutorSocket) {
    return !replacedExecutorSockets.has(socket)
  },

  updatePresence(input: {
    executorId: string
    runningTaskIds?: string[]
    queuedTaskIds?: string[]
    lastHeartbeatAt: string
    telemetry?: ExecutorTelemetrySnapshot
    latency?: ExecutorLatencySnapshot
    mesh?: WorkerMeshStatus
    projectBindings?: WorkerProjectBinding[]
  }) {
    hydrateRegistryFromStore()
    const current = executorPresence.get(input.executorId)
    executorPresence.set(input.executorId, {
      runningTaskIds: input.runningTaskIds ? [...input.runningTaskIds] : current?.runningTaskIds ?? [],
      queuedTaskIds: input.queuedTaskIds ? [...input.queuedTaskIds] : current?.queuedTaskIds ?? [],
      lastHeartbeatAt: input.lastHeartbeatAt,
      telemetry: input.telemetry ?? current?.telemetry,
      latency: input.latency ?? current?.latency,
      mesh: input.mesh ?? current?.mesh,
    })
    if (input.projectBindings) {
      executorProjectBindings.set(input.executorId, normalizeProjectBindings(input.projectBindings))
    }
  },

  updateLatency(executorId: string, latency: ExecutorLatencySnapshot) {
    hydrateRegistryFromStore()
    const current = executorPresence.get(executorId)
    executorPresence.set(executorId, {
      runningTaskIds: current?.runningTaskIds ?? [],
      queuedTaskIds: current?.queuedTaskIds ?? [],
      lastHeartbeatAt: current?.lastHeartbeatAt ?? nowIso(),
      telemetry: current?.telemetry,
      latency,
      mesh: current?.mesh,
    })
  },

  getPresence(executorId: string) {
    hydrateRegistryFromStore()
    return executorPresence.get(executorId) ?? null
  },

  getSocket(executorId: string) {
    hydrateRegistryFromStore()
    syncExecutorLiveness(executorId)
    const socket = executorSockets.get(executorId)
    return isSocketAlive(socket) ? socket : null
  },

  getRegisteredSocket(executorId: string) {
    hydrateRegistryFromStore()
    return executorSockets.get(executorId) ?? null
  },

  listExecutors() {
    hydrateRegistryFromStore()
    for (const executorId of executors.keys()) {
      syncExecutorLiveness(executorId)
    }
    return Array.from(executors.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  },

  listExecutorsWithPresence() {
    return this.listExecutors().map((executor) => ({
      ...executor,
      presence: executorPresence.get(executor.executorId) ?? {
        runningTaskIds: [],
        queuedTaskIds: [],
        lastHeartbeatAt: executor.lastSeenAt ?? executor.createdAt,
        telemetry: undefined,
        latency: undefined,
        mesh: undefined,
      },
    }))
  },

  getExecutor(executorId: string) {
    hydrateRegistryFromStore()
    syncExecutorLiveness(executorId)
    return executors.get(executorId) ?? getPersistedExecutor(executorId)?.executor ?? null
  },

  setProjectBindings(executorId: string, bindings?: WorkerProjectBinding[]) {
    hydrateRegistryFromStore()
    executorProjectBindings.set(executorId, normalizeProjectBindings(bindings))
  },

  getProjectBindings(executorId: string) {
    hydrateRegistryFromStore()
    return executorProjectBindings.get(executorId) ?? []
  },

  deleteExecutor(executorId: string) {
    hydrateRegistryFromStore()
    const executor = executors.get(executorId)
    if (!executor) {
      return null
    }

    const socket = executorSockets.get(executorId)
    executorSockets.delete(executorId)
    executorPresence.delete(executorId)
    executorProjectBindings.delete(executorId)
    executorSecrets.delete(executorId)
    executors.delete(executorId)
    lastHeartbeatPersistAt.delete(executorId)
    deletePersistedExecutor(executorId)
    socket?.close()
    return executor
  },

  onExecutorOffline(listener: (executorId: string, reason: string) => void) {
    offlineListener = listener
  },

  onExecutorOnline(listener: (executorId: string) => void) {
    onlineListener = listener
  },
}
