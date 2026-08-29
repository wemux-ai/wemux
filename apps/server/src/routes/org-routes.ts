// [INPUT]: 已鉴权 Hono app + 时间线/图谱请求
// [OUTPUT]: /api/org/graph、/api/users/:userId/timeline、/api/users/:userId/card、/api/agents/:agentId/timeline
// [POS]: 组织 HTTP 协议层；时间线第一版所有人可见；图谱按 workspace 成员隔离
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { getUserIdFromHeader, jsonError } from './shared'
import { isWorkspaceMember } from '../repositories/workspace'
import { getOrgGraph } from '../services/org-graph-service'
import { getAgentTimeline, getUserCardSummary, getUserTimeline, resolveRangeStart, type TimelineRange } from '../services/timeline-service'

const timelineRangeSchema = z.enum(['today', '7d']).default('today')

export const registerOrgRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 关系图谱（按 workspace 过滤，仅成员）
  app.get('/api/org/graph', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')
    if (!workspaceId) return jsonError(c, '缺少 workspaceId。', 400)
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '不是该组织成员。', 403)
    }
    const graph = await getOrgGraph(workspaceId)
    return c.json({ graph })
  })

  // 用户时间线（第一版所有人可见；范围 today | 7d）
  app.get('/api/users/:userId/timeline', requireAuth, async (c) => {
    const targetUserId = c.req.param('userId')
    const parsed = timelineRangeSchema.safeParse(c.req.query('range'))
    const range: TimelineRange = parsed.success ? parsed.data : 'today'
    const timeline = await getUserTimeline(targetUserId, range)
    return c.json({ timeline })
  })

  // 用户卡片摘要（Popover 卡片数据，第一版所有人可见）
  app.get('/api/users/:userId/card', requireAuth, async (c) => {
    const targetUserId = c.req.param('userId')
    const summary = await getUserCardSummary(targetUserId)
    if (!summary) return jsonError(c, '用户不存在。', 404)
    return c.json({ summary })
  })

  // Agent 时间线（与用户时间线同构；第一版所有人可见）
  app.get('/api/agents/:agentId/timeline', requireAuth, async (c) => {
    const agentId = c.req.param('agentId')
    const parsed = timelineRangeSchema.safeParse(c.req.query('range'))
    const range: TimelineRange = parsed.success ? parsed.data : 'today'
    const timeline = await getAgentTimeline(agentId, range)
    return c.json({ timeline })
  })

  // 时间范围辅助（测试/调试：返回 range 起点）
  app.get('/api/org/range-start', requireAuth, async (c) => {
    const parsed = timelineRangeSchema.safeParse(c.req.query('range'))
    const range: TimelineRange = parsed.success ? parsed.data : 'today'
    return c.json({ range, from: resolveRangeStart(range) })
  })
}
