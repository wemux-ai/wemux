// [INPUT]: telemetry-service 的 track() 调用点
// [OUTPUT]: telemetry_events 表的落库与查询
// [POS]: Postgres repository for telemetry_events; 自有 analytics 唯一写路径
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm'
import type { TelemetryEventRecord, TelemetryEventType } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { telemetryEvents } from './schema'

type TelemetryRow = typeof telemetryEvents.$inferSelect

export const persistTelemetryEvent = async (record: TelemetryEventRecord): Promise<void> => {
  await ensurePostgresReady()
  const row: TelemetryRow = {
    id: record.id,
    eventType: record.eventType,
    userId: record.userId ?? null,
    teamId: record.teamId ?? null,
    projectId: record.projectId ?? null,
    workspaceId: record.workspaceId ?? null,
    taskId: record.taskId ?? null,
    executorNodeId: record.executorNodeId ?? null,
    payloadJson: record.payload ?? null,
    createdAt: record.createdAt,
  }
  await getDrizzleDb().insert(telemetryEvents).values(row).onConflictDoNothing()
}

export const listTelemetryEvents = async (limit = 100): Promise<TelemetryEventRecord[]> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(telemetryEvents)
    .orderBy(desc(telemetryEvents.createdAt))
    .limit(limit)
  return rows.map(mapRow)
}

const mapRow = (row: TelemetryRow): TelemetryEventRecord => ({
  id: row.id,
  eventType: row.eventType,
  userId: row.userId ?? undefined,
  teamId: row.teamId ?? undefined,
  projectId: row.projectId ?? undefined,
  workspaceId: row.workspaceId ?? undefined,
  taskId: row.taskId ?? undefined,
  executorNodeId: row.executorNodeId ?? undefined,
  payload: row.payloadJson ?? undefined,
  createdAt: row.createdAt,
})

/** 按事件类型计数（可选时间下限）。 */
export const countTelemetryByType = async (options: { since?: string } = {}): Promise<Array<{ eventType: TelemetryEventType; count: number }>> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const where = options.since ? gte(telemetryEvents.createdAt, options.since) : undefined
  const rows = await db
    .select({
      eventType: telemetryEvents.eventType,
      count: count(),
    })
    .from(telemetryEvents)
    .where(where)
    .groupBy(telemetryEvents.eventType)
    .orderBy(desc(count()))
  return rows.map((row) => ({ eventType: row.eventType as TelemetryEventType, count: Number(row.count) }))
}

/** 每天事件数（用于趋势图）。 */
export const countTelemetryDaily = async (options: { since?: string; eventType?: TelemetryEventType } = {}): Promise<Array<{ date: string; count: number }>> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const conditions = []
  if (options.since) {
    conditions.push(gte(telemetryEvents.createdAt, options.since))
  }
  if (options.eventType) {
    conditions.push(eq(telemetryEvents.eventType, options.eventType))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined
  const rows = await db
    .select({
      date: sql<string>`substring(${telemetryEvents.createdAt} from 1 for 10)`,
      count: count(),
    })
    .from(telemetryEvents)
    .where(where)
    .groupBy(sql`substring(${telemetryEvents.createdAt} from 1 for 10)`)
    .orderBy(asc(sql`substring(${telemetryEvents.createdAt} from 1 for 10)`))
  return rows.map((row) => ({ date: row.date, count: Number(row.count) }))
}
