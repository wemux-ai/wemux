// [INPUT]: reporter 侧原始计数、collector 侧未知来源 JSON
// [OUTPUT]: 社区版匿名使用上报的类型契约与 counters 清洗纯函数
// [POS]: shared 契约层；web/server 两端共用，纯函数可 node:test 覆盖
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

/** 上报 payload 结构版本；字段变更必须升版本并在 collector 兼容处理。 */
export const COMMUNITY_USAGE_SCHEMA_VERSION = 1

/** 官网 collector 默认端点；可用 WEMUX_USAGE_REPORTING_ENDPOINT 覆盖。 */
export const DEFAULT_COMMUNITY_USAGE_ENDPOINT = 'https://wemux.ai/api/community-usage/report'

/** 聚合计数白名单：只有这五个数字会离开自托管实例，内容类数据永远进不了 payload。 */
export interface CommunityUsageCounters {
  usersTotal: number
  teamsTotal: number
  tasksTotal: number
  conversationsTotal: number
  agentRunsTotal: number
}

export interface CommunityUsageReportPayload {
  schemaVersion: number
  installId: string
  version: string
  os: string
  /** 部署形态（docker/source/railway…）；仅来自部署方显式 env，可为空。 */
  deploymentMode?: string
  reportedAt: string
  counters: CommunityUsageCounters
}

const COUNTER_KEYS: Array<keyof CommunityUsageCounters> = [
  'usersTotal',
  'teamsTotal',
  'tasksTotal',
  'conversationsTotal',
  'agentRunsTotal',
]

/**
 * 把任意来源的 counters 清洗成非负整数（非法/缺失归零，超界截断）。
 * collector 落库前的唯一信任路径：宁可丢精度也不收脏数。
 */
export const sanitizeCommunityUsageCounters = (raw: unknown): CommunityUsageCounters => {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const clean = {} as CommunityUsageCounters
  for (const key of COUNTER_KEYS) {
    const value = Number(source[key])
    if (!Number.isFinite(value) || value <= 0) {
      clean[key] = 0
    } else {
      clean[key] = Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
    }
  }
  return clean
}

/** installId 只允许 UUID 形态（36 位十六进制-连字符），防注入与脏数据。 */
export const isValidCommunityUsageInstallId = (value: unknown): value is string => {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/** 看板 latestCounters：跨安装实例求和后的聚合计数（键名与单实例 counters 区分）。 */
export interface AdminCommunityUsageCounters {
  users: number
  teams: number
  tasks: number
  conversations: number
  agentRuns: number
}

/** admin 看板聚合响应（collector 侧，GET /api/admin/community-usage）。 */
export interface AdminCommunityUsageSummary {
  totals: {
    installs: number
    active7d: number
    active30d: number
    new7d: number
    reports: number
  }
  versions: Array<{ version: string; installs: number }>
  latestCounters: AdminCommunityUsageCounters
  dailyReports: Array<{ date: string; reports: number; installs: number }>
  recentInstalls: Array<{
    installId: string
    version: string
    os: string
    firstSeenAt: string
    lastSeenAt: string
    reports: number
  } & CommunityUsageCounters>
}
