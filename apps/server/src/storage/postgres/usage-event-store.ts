// [INPUT]: 统一 token 用量事件（recordUsageEvent 调用点）。
// [OUTPUT]: usage_events 表的幂等落库与查询。
// [POS]: Postgres repository for usage_events; the only read/write path to the unified token usage event table.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import type { UsageEventBillingStatus, UsageEventRecord } from '@shared/usage-events'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { usageEvents } from './schema'

type UsageEventRow = typeof usageEvents.$inferSelect

const mapRow = (row: UsageEventRow): UsageEventRecord => ({
  id: row.id,
  runKind: row.runKind,
  runId: row.runId,
  userId: row.userId,
  agentId: row.agentId ?? undefined,
  agentName: row.agentName ?? undefined,
  conversationId: row.conversationId ?? undefined,
  workspaceId: row.workspaceId ?? undefined,
  workspaceSessionId: row.workspaceSessionId ?? undefined,
  taskId: row.taskId ?? undefined,
  projectId: row.projectId ?? undefined,
  executorNodeId: row.executorNodeId ?? undefined,
  providerId: row.providerId ?? undefined,
  modelId: row.modelId ?? undefined,
  executionModel: row.executionModel ?? undefined,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  reasoningTokens: row.reasoningTokens,
  cacheReadTokens: row.cacheReadTokens,
  cacheWriteTokens: row.cacheWriteTokens,
  totalTokens: row.totalTokens,
  createdAt: row.createdAt,
  billingStatus: row.billingStatus,
})

const mapToRow = (record: UsageEventRecord): UsageEventRow => ({
  id: record.id,
  runKind: record.runKind,
  runId: record.runId,
  userId: record.userId,
  agentId: record.agentId ?? null,
  agentName: record.agentName ?? null,
  conversationId: record.conversationId ?? null,
  workspaceId: record.workspaceId ?? null,
  workspaceSessionId: record.workspaceSessionId ?? null,
  taskId: record.taskId ?? null,
  projectId: record.projectId ?? null,
  executorNodeId: record.executorNodeId ?? null,
  providerId: record.providerId ?? null,
  modelId: record.modelId ?? null,
  executionModel: record.executionModel ?? null,
  inputTokens: record.inputTokens,
  outputTokens: record.outputTokens,
  reasoningTokens: record.reasoningTokens,
  cacheReadTokens: record.cacheReadTokens,
  cacheWriteTokens: record.cacheWriteTokens,
  totalTokens: record.totalTokens,
  createdAt: record.createdAt,
  billingStatus: record.billingStatus ?? 'none',
})

/** 幂等写入：同一 (runKind, runId) 只落一次，重复调用直接忽略。 */
export const persistUsageEvent = async (record: UsageEventRecord) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(usageEvents)
    .values(mapToRow(record))
    .onConflictDoNothing({
      target: [usageEvents.runKind, usageEvents.runId],
    })
}

export type UsageEventQuery = {
  userId?: string
  userIds?: string[]
  agentId?: string
  workspaceId?: string
  workspaceSessionId?: string
  taskId?: string
  since?: string
  until?: string
  limit?: number
  /** 仅返回指定结算状态。 */
  billingStatus?: UsageEventBillingStatus
  /** 仅返回指定 providerId（官方托管结算按网关 provider 过滤）。 */
  providerId?: string
  /** 仅返回命中的任一 providerId（多网关结算用）。 */
  providerIds?: string[]
  /** 排序：默认 desc（新→旧，用量看板用）；结算扫描用 asc（旧→新）。 */
  order?: 'asc' | 'desc'
}

export const listUsageEvents = async (query: UsageEventQuery = {}): Promise<UsageEventRecord[]> => {
  await ensurePostgresReady()
  const conditions = []
  if (query.userId) {
    conditions.push(eq(usageEvents.userId, query.userId))
  }
  if (query.userIds?.length) {
    conditions.push(inArray(usageEvents.userId, query.userIds))
  }
  if (query.agentId) {
    conditions.push(eq(usageEvents.agentId, query.agentId))
  }
  if (query.workspaceId) {
    conditions.push(eq(usageEvents.workspaceId, query.workspaceId))
  }
  if (query.workspaceSessionId) {
    conditions.push(eq(usageEvents.workspaceSessionId, query.workspaceSessionId))
  }
  if (query.taskId) {
    conditions.push(eq(usageEvents.taskId, query.taskId))
  }
  if (query.billingStatus) {
    conditions.push(eq(usageEvents.billingStatus, query.billingStatus))
  }
  if (query.providerId) {
    conditions.push(eq(usageEvents.providerId, query.providerId))
  }
  if (query.providerIds?.length) {
    conditions.push(inArray(usageEvents.providerId, query.providerIds))
  }
  if (query.since) {
    conditions.push(gte(usageEvents.createdAt, query.since))
  }
  if (query.until) {
    conditions.push(lte(usageEvents.createdAt, query.until))
  }

  const orderBy = query.order === 'asc'
    ? [asc(usageEvents.createdAt), asc(usageEvents.id)]
    : [desc(usageEvents.createdAt)]
  const rows = query.limit !== undefined
    ? await getDrizzleDb()
        .select()
        .from(usageEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(...orderBy)
        .limit(query.limit)
    : await getDrizzleDb()
        .select()
        .from(usageEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(...orderBy)

  return rows.map(mapRow)
}

/** 标记用量事件为已结算（官方托管积分结算完成后调用）。 */
export const markUsageEventsSettled = async (usageEventIds: string[], status: UsageEventBillingStatus = 'hosted_settled') => {
  if (usageEventIds.length === 0) {
    return
  }
  await ensurePostgresReady()
  await getDrizzleDb()
    .update(usageEvents)
    .set({ billingStatus: status })
    .where(inArray(usageEvents.id, usageEventIds))
}
