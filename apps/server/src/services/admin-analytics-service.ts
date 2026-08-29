// [INPUT]: Postgres 就绪 + drizzle 聚合表（users/executors/tasks）+ telemetry 事件。
// [OUTPUT]: 管理后台总览指标（平台总数 / 交付趋势 / 遥测漏斗 / 每日活跃用户 / 留存 / 最近事件）。
// [POS]: admin analytics 服务层；供 HTTP /api/admin/analytics 与 MCP admin.analytics 共用。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, count, countDistinct, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { authEvents, executors, tasks, telemetryEvents, usageEvents, users } from '../storage/postgres/schema'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { countTelemetryByType, countTelemetryDaily, listTelemetryEvents } from '../storage/postgres/telemetry-store'

export type DailyActiveUsersRow = {
  date: string
  loginUsers: number
  eventUsers: number
  executionUsers: number
}

export type RetentionSnapshot = {
  /** 最近 30 天注册用户数（cohort 池） */
  cohort: number
  /** 注册次日仍有登录的去重用户占比（0-100） */
  d1: number
  /** 注册第 7 天仍有登录的去重用户占比（0-100） */
  d7: number
}

const buildDailyDateKeys = (days: number, now = new Date()) => {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: days }, (_, index) => (
    new Date(end - (days - index - 1) * 86_400_000).toISOString().slice(0, 10)
  ))
}

export const buildDailyActiveUsers = async (days = 14): Promise<DailyActiveUsersRow[]> => {
  const db = getDrizzleDb()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const loginDate = sql<string>`substring(${authEvents.createdAt} from 1 for 10)`
  const eventDate = sql<string>`substring(${telemetryEvents.createdAt} from 1 for 10)`
  const executionDate = sql<string>`substring(${usageEvents.createdAt} from 1 for 10)`

  const [loginRows, eventRows, executionRows] = await Promise.all([
    db
      .select({ date: loginDate, value: countDistinct(authEvents.userId) })
      .from(authEvents)
      .where(and(gte(authEvents.createdAt, since), eq(authEvents.eventType, 'login_success')))
      .groupBy(loginDate),
    db
      .select({ date: eventDate, value: countDistinct(telemetryEvents.userId) })
      .from(telemetryEvents)
      .where(gte(telemetryEvents.createdAt, since))
      .groupBy(eventDate),
    db
      .select({ date: executionDate, value: countDistinct(usageEvents.userId) })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since))
      .groupBy(executionDate),
  ])

  const byDate = new Map<string, { loginUsers: number; eventUsers: number; executionUsers: number }>()
  const ensure = (date: string) => {
    const current = byDate.get(date) ?? { loginUsers: 0, eventUsers: 0, executionUsers: 0 }
    byDate.set(date, current)
    return current
  }
  for (const row of loginRows) ensure(row.date).loginUsers = Number(row.value)
  for (const row of eventRows) ensure(row.date).eventUsers = Number(row.value)
  for (const row of executionRows) ensure(row.date).executionUsers = Number(row.value)

  return buildDailyDateKeys(days).map((date) => ({
    date,
    ...(byDate.get(date) ?? { loginUsers: 0, eventUsers: 0, executionUsers: 0 }),
  }))
}

/**
 * 次留 / 7 留：最近 30 天注册用户中，注册次日起仍有 login_success 的去重占比。
 * 用「登录成功」作为活跃信号，口径简单可靠（不依赖 telemetry 埋点覆盖率）。
 */
export const buildRetention = async (): Promise<RetentionSnapshot> => {
  const db = getDrizzleDb()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const result = await db.execute(sql`
    WITH cohort AS (
      SELECT id, created_at FROM users WHERE created_at >= ${since}
    ),
    retained_d1 AS (
      SELECT DISTINCT a.user_id
      FROM auth_events a
      JOIN cohort c ON c.id = a.user_id
      WHERE a.event_type = 'login_success'
        AND a.created_at::timestamptz >= (c.created_at::timestamptz + interval '1 day')
        AND a.created_at::timestamptz < (c.created_at::timestamptz + interval '2 day')
    ),
    retained_d7 AS (
      SELECT DISTINCT a.user_id
      FROM auth_events a
      JOIN cohort c ON c.id = a.user_id
      WHERE a.event_type = 'login_success'
        AND a.created_at::timestamptz >= (c.created_at::timestamptz + interval '7 day')
        AND a.created_at::timestamptz < (c.created_at::timestamptz + interval '8 day')
    )
    SELECT
      (SELECT count(*)::int FROM cohort) AS cohort,
      (SELECT count(*)::int FROM retained_d1) AS d1,
      (SELECT count(*)::int FROM retained_d7) AS d7
  `)

  const row = result.rows[0] as { cohort: number; d1: number; d7: number } | undefined
  const cohort = Number(row?.cohort ?? 0)
  const d1 = cohort > 0 ? Math.round((Number(row?.d1 ?? 0) / cohort) * 100) : 0
  const d7 = cohort > 0 ? Math.round((Number(row?.d7 ?? 0) / cohort) * 100) : 0
  return { cohort, d1, d7 }
}

export type RetentionCurveRow = {
  date: string
  cohort: number
  /** null = 该 cohort 的测量窗口尚未到期（数据不完整） */
  d1: number | null
  d7: number | null
}

const DAY_MS = 86_400_000

/**
 * 留存曲线：按注册日分 cohort，算每个 cohort 的次日（D1）/ 7 日（D7）登录留存率。
 * 使用 JS 聚合（cohort 规模小），登录事件预取 days+8 天窗口。
 */
export const buildRetentionCurve = async (days = 30): Promise<RetentionCurveRow[]> => {
  const db = getDrizzleDb()
  const now = Date.now()
  const since = new Date(now - days * DAY_MS).toISOString()
  const loginSince = new Date(now - (days + 8) * DAY_MS).toISOString()

  const [userRows, loginRows] = await Promise.all([
    db
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(gte(users.createdAt, since)),
    db
      .select({ userId: authEvents.userId, createdAt: authEvents.createdAt })
      .from(authEvents)
      .where(and(eq(authEvents.eventType, 'login_success'), gte(authEvents.createdAt, loginSince))),
  ])

  const cohortByDate = new Map<string, string[]>()
  for (const row of userRows) {
    const date = row.createdAt.slice(0, 10)
    const list = cohortByDate.get(date) ?? []
    list.push(row.id)
    cohortByDate.set(date, list)
  }

  const loginTimestampsByUser = new Map<string, number[]>()
  for (const row of loginRows) {
    if (!row.userId) continue
    const timestamp = Date.parse(row.createdAt)
    if (!Number.isFinite(timestamp)) continue
    const list = loginTimestampsByUser.get(row.userId) ?? []
    list.push(timestamp)
    loginTimestampsByUser.set(row.userId, list)
  }

  return buildDailyDateKeys(days).map((date) => {
    const ids = cohortByDate.get(date) ?? []
    if (ids.length === 0) {
      return { date, cohort: 0, d1: null, d7: null }
    }
    const dayStart = Date.parse(`${date}T00:00:00.000Z`)
    const d1Measurable = dayStart + 2 * DAY_MS <= now
    const d7Measurable = dayStart + 8 * DAY_MS <= now
    let d1Count = 0
    let d7Count = 0
    for (const id of ids) {
      const timestamps = loginTimestampsByUser.get(id) ?? []
      if (d1Measurable && timestamps.some((ts) => ts >= dayStart + DAY_MS && ts < dayStart + 2 * DAY_MS)) d1Count += 1
      if (d7Measurable && timestamps.some((ts) => ts >= dayStart + 7 * DAY_MS && ts < dayStart + 8 * DAY_MS)) d7Count += 1
    }
    return {
      date,
      cohort: ids.length,
      d1: d1Measurable ? Math.round((d1Count / ids.length) * 100) : null,
      d7: d7Measurable ? Math.round((d7Count / ids.length) * 100) : null,
    }
  })
}

export type DailyTasksRow = {
  date: string
  created: number
  delivered: number
}

/** 每日任务创建 vs 交付（交付 = status 流转到 done，用 completedAt）。 */
export const buildDailyTasks = async (days = 30): Promise<DailyTasksRow[]> => {
  const db = getDrizzleDb()
  const since = new Date(Date.now() - days * DAY_MS).toISOString()

  const createdDate = sql<string>`substring(${tasks.createdAt} from 1 for 10)`
  const deliveredDate = sql<string>`substring(${tasks.completedAt} from 1 for 10)`

  const [createdRows, deliveredRows] = await Promise.all([
    db
      .select({ date: createdDate, value: count() })
      .from(tasks)
      .where(gte(tasks.createdAt, since))
      .groupBy(createdDate),
    db
      .select({ date: deliveredDate, value: count() })
      .from(tasks)
      .where(gte(tasks.completedAt, since))
      .groupBy(deliveredDate),
  ])

  const byDate = new Map<string, { created: number; delivered: number }>()
  const ensure = (date: string) => {
    const current = byDate.get(date) ?? { created: 0, delivered: 0 }
    byDate.set(date, current)
    return current
  }
  for (const row of createdRows) ensure(row.date).created = Number(row.value)
  for (const row of deliveredRows) ensure(row.date).delivered = Number(row.value)

  return buildDailyDateKeys(days).map((date) => ({
    date,
    ...(byDate.get(date) ?? { created: 0, delivered: 0 }),
  }))
}

export type AdminAnalyticsSnapshot = {
  totals: {
    users: number
    executors: number
    onlineExecutors: number
    tasks: number
    deliveries: number
  }
  funnel: Awaited<ReturnType<typeof countTelemetryByType>>
  dailyDeliveries: Array<{ date: string; count: number }>
  dailyEvents: Awaited<ReturnType<typeof countTelemetryDaily>>
  dailyActiveUsers: DailyActiveUsersRow[]
  retention: RetentionSnapshot
  retentionCurve: RetentionCurveRow[]
  dailyTasks: DailyTasksRow[]
  recentEvents: Awaited<ReturnType<typeof listTelemetryEvents>>
}

export const buildAdminAnalytics = async (days = 14): Promise<AdminAnalyticsSnapshot> => {
  const db = getDrizzleDb()
  const [userCountRow] = await db.select({ value: count() }).from(users)
  const [executorCountRow] = await db.select({ value: count() }).from(executors)
  const [onlineExecutorRow] = await db
    .select({ value: count() })
    .from(executors)
    .where(eq(executors.status, 'online'))
  const [taskCountRow] = await db.select({ value: count() }).from(tasks)
  const [deliveryCountRow] = await db
    .select({ value: count() })
    .from(tasks)
    .where(inArray(tasks.status, ['in_review', 'done']))

  // 每日交付数（趋势图窗口与 DAU 窗口对齐）
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const dailyDeliveryRows = await db
    .select({
      date: sql<string>`substring(${tasks.createdAt} from 1 for 10)`,
      value: count(),
    })
    .from(tasks)
    .where(and(gte(tasks.createdAt, since), inArray(tasks.status, ['in_review', 'done'])))
    .groupBy(sql`substring(${tasks.createdAt} from 1 for 10)`)
    .orderBy(desc(sql`substring(${tasks.createdAt} from 1 for 10)`))

  const [funnel, dailyEvents, recentEvents, dailyActiveUsers, retention, retentionCurve, dailyTasks] = await Promise.all([
    countTelemetryByType(),
    countTelemetryDaily({ since }),
    listTelemetryEvents(60),
    buildDailyActiveUsers(days),
    buildRetention(),
    buildRetentionCurve(30),
    buildDailyTasks(days),
  ])

  return {
    totals: {
      users: Number(userCountRow?.value ?? 0),
      executors: Number(executorCountRow?.value ?? 0),
      onlineExecutors: Number(onlineExecutorRow?.value ?? 0),
      tasks: Number(taskCountRow?.value ?? 0),
      deliveries: Number(deliveryCountRow?.value ?? 0),
    },
    funnel,
    dailyDeliveries: dailyDeliveryRows.map((row) => ({ date: row.date, count: Number(row.value) })),
    dailyEvents,
    dailyActiveUsers,
    retention,
    retentionCurve,
    dailyTasks,
    recentEvents,
  }
}
