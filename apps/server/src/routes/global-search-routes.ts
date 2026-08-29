// [INPUT]: 已鉴权 Hono app + requireAuth 中间件
// [OUTPUT]: GET /api/search 全局搜索 HTTP 协议层
// [POS]: 全局搜索路由；参数校验 zod，业务在 global-search-service（SQL ILIKE + 用户作用域）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { GLOBAL_SEARCH_TYPES } from '@shared/types'
import { globalSearch } from '../services/global-search-service'
import { getUserIdFromHeader, jsonError } from './shared'

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(GLOBAL_SEARCH_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
})

export const registerGlobalSearchRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/search', requireAuth, async (c) => {
    const parsed = searchQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return jsonError(c, '参数错误。', 400)
    }

    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return jsonError(c, '未登录。', 401)
    }

    const results = await globalSearch({
      query: parsed.data.q,
      userId,
      type: parsed.data.type,
      limit: parsed.data.limit,
    })
    return c.json({ query: parsed.data.q, results })
  })
}
