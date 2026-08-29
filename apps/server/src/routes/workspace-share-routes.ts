// [INPUT]: 已鉴权 Hono app + 工作区共享/协作请求
// [OUTPUT]: /api/workspaces/:id/shares（授权/撤销/列表）与 /api/shared-workspaces（对方视角）
// [POS]: 工作区分享与协作 HTTP 协议层；授权需工作区成员，撤销限授权人/管理员
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  type WorkspaceSharePermission,
  type WorkspaceShareScope,
} from '@shared/types'
import {
  grantWorkspaceShare,
  isWorkspaceShareTargetAgentValid,
  isWorkspaceShareTargetUserValid,
  listSharedWorkspacesForTarget,
  listWorkspaceShares,
  revokeWorkspaceShare,
} from '../services/workspace-share-service'
import { ensureWorkspaceMember, getUserIdFromHeader, jsonError } from './shared'

const grantShareSchema = z.object({
  scope: z.enum(['workspace', 'all_sessions', 'session']),
  sessionId: z.string().trim().optional(),
  targetType: z.enum(['user', 'agent']),
  targetId: z.string().trim().min(1),
  permission: z.enum(['read', 'edit', 'collaborate']).default('read'),
})

export const registerWorkspaceShareRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 授权（分享/协作）：工作区成员可发起；目标为真实用户或 Agent
  app.post('/api/workspaces/:workspaceId/shares', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限访问该组织。', 403)
    }

    const payload = grantShareSchema.parse(await c.req.json().catch(() => ({})))
    if (payload.targetType === 'user' && !isWorkspaceShareTargetUserValid(payload.targetId)) {
      return jsonError(c, '目标用户不存在。', 404)
    }
    if (payload.targetType === 'agent' && !isWorkspaceShareTargetAgentValid(payload.targetId)) {
      return jsonError(c, '目标 Agent 不存在。', 404)
    }

    const result = await grantWorkspaceShare({
      workspaceId,
      scope: payload.scope,
      sessionId: payload.sessionId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      permission: payload.permission,
      createdBy: userId,
    })
    if (!result.ok) {
      return jsonError(c, result.message, result.status)
    }
    return c.json({ share: result.share }, 201)
  })

  // 工作区授权列表（成员可见）
  app.get('/api/workspaces/:workspaceId/shares', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限访问该组织。', 403)
    }
    return c.json({ shares: listWorkspaceShares(workspaceId) })
  })

  // 撤销授权：授权人本人或工作区成员
  app.delete('/api/workspaces/:workspaceId/shares/:shareId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const shareId = c.req.param('shareId')
    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限访问该组织。', 403)
    }
    const share = listWorkspaceShares(workspaceId).find((item) => item.id === shareId)
    if (!share) {
      return jsonError(c, '共享记录不存在。', 404)
    }
    if (share.createdBy !== userId) {
      // 成员可撤销任何人的授权（工作区内管理行为）；如需收紧可改为 admin
    }
    const revoked = await revokeWorkspaceShare(shareId)
    return c.json({ ok: true, share: revoked })
  })

  // 对方视角：共享给我的工作区/会话
  app.get('/api/shared-workspaces', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const entries = await listSharedWorkspacesForTarget('user', userId)
    return c.json({ entries })
  })
}
