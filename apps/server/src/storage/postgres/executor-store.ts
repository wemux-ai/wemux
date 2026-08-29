import { existsSync, readFileSync, rmSync } from 'node:fs'
import { and, desc, eq } from 'drizzle-orm'
import type { ExecutorDescriptor } from '@shared/types'
import { getExecutorRegistryPath } from '../../lib/runtime-paths'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { executors } from './schema'

type ExecutorRow = typeof executors.$inferSelect

type PersistedRegistryFile = {
  executors?: Array<[string, ExecutorDescriptor]>
  secrets?: Array<[string, { tokenHash: string }]>
}

const cache = new Map<string, { executor: ExecutorDescriptor; tokenHash: string; previewProxySecret?: string }>()

const mapRow = (row: ExecutorRow): { executor: ExecutorDescriptor; tokenHash: string; previewProxySecret?: string } => ({
  executor: {
    executorId: row.id,
    machineId: row.machineId,
    machineName: row.machineName,
    name: row.name,
    connectedNodeId: row.connectedNodeId ?? undefined,
    previewExposureMode: row.previewExposureMode ?? undefined,
    previewIngressPort: row.previewIngressPort ?? undefined,
    previewIngressBaseUrl: row.previewIngressBaseUrl ?? undefined,
    previewIngressDetectedPublicIp: row.previewIngressDetectedPublicIp ?? undefined,
    previewIngressDetectedLanIp: row.previewIngressDetectedLanIp ?? undefined,
    previewIngressReachable: typeof row.previewIngressReachable === 'boolean' ? row.previewIngressReachable : undefined,
    previewIngressLastCheckedAt: row.previewIngressLastCheckedAt ?? undefined,
    previewIngressLastError: row.previewIngressLastError ?? undefined,
    executorSource: row.executorSource ?? 'customer-worker',
    managedBy: row.managedBy ?? 'user',
    runtimeClass: row.runtimeClass ?? 'user-worker',
    billingClass: row.billingClass ?? 'standard',
    note: row.note ?? undefined,
    ownerUserId: row.ownerUserId,
    teamId: row.teamId ?? undefined,
    workspaceIds: Array.isArray(row.workspaceIdsJson)
      ? row.workspaceIdsJson.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : (row.teamId ? [row.teamId] : []),
    visibility: row.visibility,
    status: row.status,
    workspaceRoot: row.workspaceRoot,
    maxConcurrency: row.maxConcurrency,
    capabilities: Array.isArray(row.capabilitiesJson) ? row.capabilitiesJson : [],
    labels: Array.isArray(row.labelsJson) ? row.labelsJson : [],
    sshPubkey: row.sshPubkey ?? undefined,
    platform: row.platform ?? undefined,
    version: row.version ?? undefined,
    lastSeenAt: row.lastSeenAt ?? undefined,
    createdAt: row.createdAt,
  },
  tokenHash: row.tokenHash,
  previewProxySecret: row.previewProxySecret ?? undefined,
})

const persistExecutor = async (executor: ExecutorDescriptor, tokenHash: string, previewProxySecret?: string) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(executors)
    .values({
      id: executor.executorId,
      machineId: executor.machineId,
      machineName: executor.machineName,
      name: executor.name,
      connectedNodeId: executor.connectedNodeId ?? null,
      previewExposureMode: executor.previewExposureMode ?? null,
      previewIngressPort: executor.previewIngressPort ?? null,
      previewIngressBaseUrl: executor.previewIngressBaseUrl ?? null,
      previewIngressDetectedPublicIp: executor.previewIngressDetectedPublicIp ?? null,
      previewIngressDetectedLanIp: executor.previewIngressDetectedLanIp ?? null,
      previewIngressReachable: executor.previewIngressReachable ?? null,
      previewIngressLastCheckedAt: executor.previewIngressLastCheckedAt ?? null,
      previewIngressLastError: executor.previewIngressLastError ?? null,
      previewProxySecret: previewProxySecret ?? null,
      executorSource: executor.executorSource ?? 'customer-worker',
      managedBy: executor.managedBy ?? 'user',
      runtimeClass: executor.runtimeClass ?? 'user-worker',
      billingClass: executor.billingClass ?? 'standard',
      note: executor.note ?? null,
      ownerUserId: executor.ownerUserId,
      teamId: executor.teamId ?? null,
      workspaceIdsJson: executor.workspaceIds ?? (executor.teamId ? [executor.teamId] : []),
      visibility: executor.visibility,
      status: executor.status,
      workspaceRoot: executor.workspaceRoot,
      maxConcurrency: executor.maxConcurrency,
      capabilitiesJson: executor.capabilities,
      labelsJson: executor.labels,
      sshPubkey: executor.sshPubkey ?? null,
      platform: executor.platform ?? null,
      version: executor.version ?? null,
      lastSeenAt: executor.lastSeenAt ?? null,
      createdAt: executor.createdAt,
      updatedAt: now,
      tokenHash,
    })
    .onConflictDoUpdate({
      target: executors.id,
      set: {
        machineId: executor.machineId,
        machineName: executor.machineName,
        name: executor.name,
        // 连接归属字段（connectedNodeId / status / lastSeenAt）由 claim/release 独占管理，
        // 不得在这里被异步写入的旧描述符覆盖，否则会破坏连接归属并触发断连风暴。
        previewExposureMode: executor.previewExposureMode ?? null,
        previewIngressPort: executor.previewIngressPort ?? null,
        previewIngressBaseUrl: executor.previewIngressBaseUrl ?? null,
        previewIngressDetectedPublicIp: executor.previewIngressDetectedPublicIp ?? null,
        previewIngressDetectedLanIp: executor.previewIngressDetectedLanIp ?? null,
        previewIngressReachable: executor.previewIngressReachable ?? null,
        previewIngressLastCheckedAt: executor.previewIngressLastCheckedAt ?? null,
        previewIngressLastError: executor.previewIngressLastError ?? null,
        previewProxySecret: previewProxySecret ?? null,
        executorSource: executor.executorSource ?? 'customer-worker',
        managedBy: executor.managedBy ?? 'user',
        runtimeClass: executor.runtimeClass ?? 'user-worker',
        billingClass: executor.billingClass ?? 'standard',
        note: executor.note ?? null,
        ownerUserId: executor.ownerUserId,
        teamId: executor.teamId ?? null,
        workspaceIdsJson: executor.workspaceIds ?? (executor.teamId ? [executor.teamId] : []),
        visibility: executor.visibility,
        workspaceRoot: executor.workspaceRoot,
        maxConcurrency: executor.maxConcurrency,
        capabilitiesJson: executor.capabilities,
        labelsJson: executor.labels,
        sshPubkey: executor.sshPubkey ?? null,
        platform: executor.platform ?? null,
        version: executor.version ?? null,
        updatedAt: now,
        tokenHash,
      },
    })
}

const loadLegacyRegistryFile = () => {
  const filePath = getExecutorRegistryPath()
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as PersistedRegistryFile
  } catch (error) {
    console.error('[executor-store] failed to read legacy executor registry', error)
    return null
  }
}

const migrateLegacyRegistryFile = async () => {
  const filePath = getExecutorRegistryPath()
  const legacy = loadLegacyRegistryFile()
  if (!legacy) {
    return
  }

  const tokenHashes = new Map(legacy.secrets ?? [])
  for (const [, executor] of legacy.executors ?? []) {
    const secret = tokenHashes.get(executor.executorId)
    if (!secret?.tokenHash) {
      continue
    }

    const normalized: ExecutorDescriptor = {
      ...executor,
      status: executor.status === 'online' ? 'offline' : executor.status,
    }
    cache.set(executor.executorId, { executor: normalized, tokenHash: secret.tokenHash })
    await persistExecutor(normalized, secret.tokenHash)
  }

  rmSync(filePath, { force: true })
}

export const refreshExecutorStore = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(executors)
    .orderBy(desc(executors.createdAt))
  cache.clear()
  for (const row of rows) {
    const persisted = mapRow(row)
    cache.set(persisted.executor.executorId, persisted)
  }
}

export const initExecutorStore = async () => {
  await refreshExecutorStore()

  if (cache.size === 0) {
    await migrateLegacyRegistryFile()
  }
}

export const listPersistedExecutors = () => {
  return Array.from(cache.values())
    .map((entry) => cloneJson(entry))
    .sort((left, right) => right.executor.createdAt.localeCompare(left.executor.createdAt))
}

export const listPersistedExecutorsFresh = async () => {
  await refreshExecutorStore()

  return Array.from(cache.values())
    .map((entry) => cloneJson(entry))
    .sort((left, right) => right.executor.createdAt.localeCompare(left.executor.createdAt))
}

export const getPersistedExecutor = (executorId: string) => {
  const entry = cache.get(executorId)
  return entry ? cloneJson(entry) : null
}

export const getPersistedExecutorFresh = async (executorId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(executors)
    .where(eq(executors.id, executorId))
    .limit(1)
  const row = rows[0]
  if (!row) {
    cache.delete(executorId)
    return null
  }

  const persisted = mapRow(row)
  cache.set(executorId, persisted)
  return cloneJson(persisted)
}

export const claimPersistedExecutorConnection = async (params: {
  executorId: string
  nodeId: string
  at: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(executors)
    .set({
      connectedNodeId: params.nodeId,
      status: 'online',
      lastSeenAt: params.at,
      updatedAt: params.at,
    })
    .where(eq(executors.id, params.executorId))
    .returning()
  if (!rows[0]) {
    return null
  }

  const persisted = mapRow(rows[0])
  cache.set(params.executorId, persisted)
  return cloneJson(persisted)
}

export const releasePersistedExecutorConnection = async (params: {
  executorId: string
  nodeId: string
  at: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(executors)
    .set({
      connectedNodeId: null,
      status: 'offline',
      lastSeenAt: params.at,
      updatedAt: params.at,
    })
    .where(and(
      eq(executors.id, params.executorId),
      eq(executors.connectedNodeId, params.nodeId),
    ))
    .returning()
  if (!rows[0]) {
    return null
  }

  const persisted = mapRow(rows[0])
  cache.set(params.executorId, persisted)
  return cloneJson(persisted)
}

/**
 * 强制释放执行器连接归属（带条件防误抢）。
 * 仅用于归属节点已失联/死亡的孤立执行器回收：
 * 只有当记录里的 connectedNodeId 仍是传入的失联节点时才清除，
 * 避免执行器已重连到其他在线节点后我们再把在线状态改回 offline。
 * 正常断开仍走 releasePersistedExecutorConnection 的节点匹配。
 */
export const forceReleasePersistedExecutorConnection = async (params: {
  executorId: string
  nodeId: string
  at: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .update(executors)
    .set({
      connectedNodeId: null,
      status: 'offline',
      lastSeenAt: params.at,
      updatedAt: params.at,
    })
    .where(and(
      eq(executors.id, params.executorId),
      eq(executors.connectedNodeId, params.nodeId),
    ))
    .returning()
  if (!rows[0]) {
    return null
  }

  const persisted = mapRow(rows[0])
  cache.set(params.executorId, persisted)
  return cloneJson(persisted)
}

export const savePersistedExecutor = (executor: ExecutorDescriptor, tokenHash: string, previewProxySecret?: string) => {
  cache.set(executor.executorId, cloneJson({ executor, tokenHash, previewProxySecret }))
  schedulePersistence(`save-executor:${executor.executorId}`, persistExecutor(executor, tokenHash, previewProxySecret))
}

export const deletePersistedExecutor = (executorId: string) => {
  const existing = cache.get(executorId)
  if (!existing) {
    return null
  }

  cache.delete(executorId)
  schedulePersistence(`delete-executor:${executorId}`, (async () => {
    await ensurePostgresReady()
    await getDrizzleDb().delete(executors).where(eq(executors.id, executorId))
  })())
  return cloneJson(existing)
}
