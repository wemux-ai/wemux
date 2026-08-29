// [INPUT]: 社区版实例的匿名使用上报 POST（公开路由，无鉴权）
// [OUTPUT]: /api/community-usage/report 接收端点；仅当 WEMUX_COMMUNITY_USAGE_COLLECTOR_ENABLED=1 时启用
// [POS]: 官网 collector HTTP 协议层；zod 白名单校验 + IP 滑窗限流，自托管实例默认 404 不暴露
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { Hono } from 'hono'
import { z } from 'zod'
import { getEnv } from '@shared/env'
import {
  COMMUNITY_USAGE_SCHEMA_VERSION,
  isValidCommunityUsageInstallId,
} from '@shared/types/community-usage'
import { insertCommunityUsageReport } from '../storage/postgres/community-usage-store'

const reportSchema = z.object({
  schemaVersion: z.literal(COMMUNITY_USAGE_SCHEMA_VERSION),
  installId: z.string().refine(isValidCommunityUsageInstallId, 'installId must be a uuid'),
  version: z.string().max(64),
  os: z.string().max(64),
  deploymentMode: z.string().max(64).optional(),
  reportedAt: z.string().datetime(),
  counters: z.object({
    usersTotal: z.number(),
    teamsTotal: z.number(),
    tasksTotal: z.number(),
    conversationsTotal: z.number(),
    agentRunsTotal: z.number(),
  }),
})

/** 内存滑窗限流：每 IP 每小时最多 30 条，防刷库。进程重启清零即可（限流是尽力而为）。 */
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const rateBuckets = new Map<string, number[]>()

const isRateLimited = (ip: string, now = Date.now()): boolean => {
  const hits = (rateBuckets.get(ip) ?? []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(ip, hits)
    return true
  }
  hits.push(now)
  rateBuckets.set(ip, hits)
  if (rateBuckets.size > 10_000) {
    for (const [key, timestamps] of rateBuckets) {
      if (timestamps.every((ts) => now - ts >= RATE_LIMIT_WINDOW_MS)) {
        rateBuckets.delete(key)
      }
    }
  }
  return false
}

export const registerCommunityUsageRoutes = (app: Hono) => {
  app.post('/api/community-usage/report', async (c) => {
    if (getEnv('WEMUX_COMMUNITY_USAGE_COLLECTOR_ENABLED') !== '1') {
      return c.json({ message: 'Not found' }, 404)
    }
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (isRateLimited(ip)) {
      return c.json({ message: 'Too many requests' }, 429)
    }

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ message: 'Invalid JSON' }, 400)
    }
    const parsed = reportSchema.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({ message: 'Invalid payload' }, 400)
    }

    // 落库前 store 内部会再清洗一遍 counters：collector 不信任任何上游数字。
    await insertCommunityUsageReport({ ...parsed.data, id: crypto.randomUUID() }, new Date().toISOString())
    return c.json({ ok: true })
  })
}
