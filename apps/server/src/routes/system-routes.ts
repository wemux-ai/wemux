// [INPUT]: Hono app
// [OUTPUT]: 系统级路由（健康/版本/诊断等）
// [POS]: 系统级 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export { registerSystemRoutes } from './system-routes-core'
