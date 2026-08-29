// [INPUT]: 已鉴权 Hono app + Agent 宇宙图谱请求
// [OUTPUT]: /api/agent-universe/graph（Agent 宇宙图谱；数据范围 = getUserAgents 用户隔离）
// [POS]: Agent 宇宙 HTTP 协议层（feature）；鉴权 requireAuth；工作区筛选可选；
//        路径避开 /api/agents/:id 冲突（注册顺序无关，独立前缀）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { getUserIdFromHeader } from './shared'
import { getAgentUniverseGraph } from '../services/agent-universe-service'

export const registerAgentUniverseRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // Agent 宇宙图谱（全局、跨工作区）；?workspaceId= 可选筛选子图
  app.get('/api/agent-universe/graph', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const graph = await getAgentUniverseGraph(userId, workspaceId)
    return c.json({ graph })
  })
}
