// [INPUT]: community-usage-routes 的上报写入、admin-routes 的看板聚合请求
// [OUTPUT]: community_usage_reports 表落库与社区版遥测聚合（安装数/活跃/版本分布/counter 汇总/最近安装）
// [POS]: 社区版使用上报 collector 唯一读写路径；追加式存储，趋势由相邻报告推导
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { sql } from 'drizzle-orm'
import type { AdminCommunityUsageSummary, CommunityUsageReportPayload } from '@shared/types'
import { sanitizeCommunityUsageCounters } from '@shared/types/community-usage'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'

const toNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 追加一条匿名使用报告；id 由本函数生成（uuid），重复 id 静默忽略。 */
export const insertCommunityUsageReport = async (
  payload: Omit<CommunityUsageReportPayload, 'id'> & { id?: string },
  receivedAt: string,
): Promise<void> => {
  await ensurePostgresReady()
  const counters = sanitizeCommunityUsageCounters(payload.counters)
  await getDrizzleDb().execute(sql`
    INSERT INTO community_usage_reports (
      id, install_id, schema_version, app_version, os, deployment_mode,
      users_total, teams_total, tasks_total, conversations_total, agent_runs_total, received_at
    ) VALUES (
      ${payload.id ?? crypto.randomUUID()}, ${payload.installId}, ${payload.schemaVersion}, ${payload.version},
      ${payload.os}, ${payload.deploymentMode ?? ''},
      ${counters.usersTotal}, ${counters.teamsTotal}, ${counters.tasksTotal},
      ${counters.conversationsTotal}, ${counters.agentRunsTotal}, ${receivedAt}
    )
    ON CONFLICT (id) DO NOTHING
  `)
}

interface InstallLatestRow {
  install_id: string
  app_version: string
  os: string
  users_total: number
  teams_total: number
  tasks_total: number
  conversations_total: number
  agent_runs_total: number
  last_seen_at: string
  first_seen_at: string
  reports: number
}

const mapInstallRow = (row: InstallLatestRow) => ({
  installId: row.install_id,
  version: row.app_version || 'unknown',
  os: row.os,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  reports: toNumber(row.reports),
  usersTotal: toNumber(row.users_total),
  teamsTotal: toNumber(row.teams_total),
  tasksTotal: toNumber(row.tasks_total),
  conversationsTotal: toNumber(row.conversations_total),
  agentRunsTotal: toNumber(row.agent_runs_total),
})

/** 最新一次报告 per install：活跃/版本/counter 汇总都以它为准。 */
const queryLatestPerInstall = () => sql`
  SELECT DISTINCT ON (install_id)
    install_id, app_version, os,
    users_total, teams_total, tasks_total, conversations_total, agent_runs_total,
    received_at AS last_seen_at
  FROM community_usage_reports
  ORDER BY install_id, received_at DESC
`

/** admin 看板聚合：一次查询拼齐全部视图数据。 */
export const aggregateCommunityUsage = async (): Promise<AdminCommunityUsageSummary> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()

  const latestResult = await db.execute(sql`
    WITH latest AS (${queryLatestPerInstall()}),
    first_seen AS (
      SELECT install_id, MIN(received_at) AS first_seen_at, COUNT(*)::int AS reports
      FROM community_usage_reports GROUP BY install_id
    )
    SELECT latest.*, COALESCE(first_seen.first_seen_at, latest.last_seen_at) AS first_seen_at,
           COALESCE(first_seen.reports, 1) AS reports
    FROM latest LEFT JOIN first_seen ON latest.install_id = first_seen.install_id
    ORDER BY first_seen_at DESC
  `)
  const installs = (latestResult.rows ?? []) as unknown as InstallLatestRow[]
  const mapped = installs.map(mapInstallRow)

  const now = Date.now()
  const dayMs = 86_400_000
  const withinDays = (iso: string, days: number) => {
    const ts = Date.parse(iso)
    return Number.isFinite(ts) && now - ts <= days * dayMs
  }

  const reportsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(DISTINCT CASE WHEN received_at >= ${new Date(now - 7 * dayMs).toISOString()} THEN install_id END)::int AS active7d,
           COUNT(DISTINCT CASE WHEN received_at >= ${new Date(now - 30 * dayMs).toISOString()} THEN install_id END)::int AS active30d
    FROM community_usage_reports
  `)
  const reportTotals = (reportsResult.rows?.[0] ?? {}) as { total?: number; active7d?: number; active30d?: number }

  const dailyResult = await db.execute(sql`
    SELECT substring(received_at FROM 1 FOR 10) AS date,
           COUNT(*)::int AS reports,
           COUNT(DISTINCT install_id)::int AS installs
    FROM community_usage_reports
    WHERE received_at >= ${new Date(now - 30 * dayMs).toISOString()}
    GROUP BY 1 ORDER BY 1 ASC
  `)

  const versionMap = new Map<string, number>()
  for (const item of mapped) {
    versionMap.set(item.version, (versionMap.get(item.version) ?? 0) + 1)
  }

  return {
    totals: {
      installs: mapped.length,
      active7d: toNumber(reportTotals.active7d),
      active30d: toNumber(reportTotals.active30d),
      new7d: mapped.filter((item) => withinDays(item.firstSeenAt, 7)).length,
      reports: toNumber(reportTotals.total),
    },
    versions: [...versionMap.entries()]
      .map(([version, count]) => ({ version, installs: count }))
      .sort((a, b) => b.installs - a.installs),
    latestCounters: {
      users: mapped.reduce((sum, item) => sum + item.usersTotal, 0),
      teams: mapped.reduce((sum, item) => sum + item.teamsTotal, 0),
      tasks: mapped.reduce((sum, item) => sum + item.tasksTotal, 0),
      conversations: mapped.reduce((sum, item) => sum + item.conversationsTotal, 0),
      agentRuns: mapped.reduce((sum, item) => sum + item.agentRunsTotal, 0),
    },
    dailyReports: ((dailyResult.rows ?? []) as Array<{ date: string; reports: number; installs: number }>).map((row) => ({
      date: row.date,
      reports: toNumber(row.reports),
      installs: toNumber(row.installs),
    })),
    recentInstalls: mapped.slice(0, 50),
  }
}
