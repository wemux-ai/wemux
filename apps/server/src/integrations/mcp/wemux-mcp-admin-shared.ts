// [INPUT]: 已鉴权 MCP 上下文（userId）+ 可注入的 getUserById 实现。
// [OUTPUT]: admin.* / admin.ops.* MCP 工具共用的准入 helper 与审计写入口。
// [POS]: 管理面板 MCP 权限边界；复用 admin-routes 的 resolveAdminAccess（owner/admin/isInternal）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getUserById, type UserRole } from '../../repositories/auth'
import { saveAuditLog } from '../../storage/governance-store'
import { resolveAdminAccess } from '../../routes/admin-routes'
import { ErrorCode, McpError } from './sdk'
import type { WemuxMcpContext } from './wemux-mcp-context'

export type McpAdminToolsOptions = {
  /** 测试/特殊场景注入：覆盖真实 getUserById。 */
  getUserById?: (id: string) => { role?: UserRole; isInternal?: boolean } | null | undefined
}

/**
 * MCP admin 准入（纯函数，可单测）：复用 admin-routes 的 resolveAdminAccess。
 * getUserByIdImpl 可注入，默认读 repositories/auth。
 */
export const resolveMcpAdminAccess = (
  userId: string,
  getUserByIdImpl: (id: string) => { role?: UserRole; isInternal?: boolean } | null | undefined = getUserById,
): { allowed: boolean; role: 'admin' | 'owner' | 'user' } => {
  if (!userId) {
    return { allowed: false, role: 'user' }
  }
  return resolveAdminAccess(getUserByIdImpl(userId))
}

/** 每次调用防线：非 admin 抛错；minRole='owner' 时仅 owner 放行。 */
export const requireMcpAdmin = (
  ctx: Pick<WemuxMcpContext, 'userId'>,
  minRole: 'admin' | 'owner' = 'admin',
  getUserByIdImpl: (id: string) => { role?: UserRole; isInternal?: boolean } | null | undefined = getUserById,
): 'admin' | 'owner' => {
  const access = resolveMcpAdminAccess(ctx.userId, getUserByIdImpl)
  if (!access.allowed) {
    throw new McpError(ErrorCode.InvalidParams, '仅平台管理员可调用 admin.* 工具。')
  }
  if (minRole === 'owner' && access.role !== 'owner') {
    throw new McpError(ErrorCode.InvalidParams, '该操作仅总管理员（owner）可执行。')
  }
  return access.role as 'admin' | 'owner'
}

/** MCP admin 写操作统一审计入口（与 HTTP admin 操作同一审计链）。 */
export const auditMcpAdminAction = (actorId: string, eventType: string, payload: Record<string, unknown>) => {
  saveAuditLog({
    id: crypto.randomUUID(),
    eventType,
    actorType: 'user',
    actorId,
    payload,
    createdAt: new Date().toISOString(),
  })
}
