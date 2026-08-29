// [INPUT]: Hono app 核心参数
// [OUTPUT]: 系统路由核心（注册基础路由的公共部分）
// [POS]: 系统路由核心（system-routes 共享逻辑）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { registerAgentSystemRoutes } from './system-routes/agent-routes'
import { registerChannelSystemRoutes } from './system-routes/channel-routes'
import { registerRuntimeSystemRoutes } from './system-routes/runtime-routes'

export const registerSystemRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  registerRuntimeSystemRoutes(app, requireAuth)
  registerChannelSystemRoutes(app, requireAuth)
  registerAgentSystemRoutes(app, requireAuth)
}
