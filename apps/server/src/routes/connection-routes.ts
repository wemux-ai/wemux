/**
 * [INPUT]: 已鉴权 Hono app，用户连接（好友）请求。
 * [OUTPUT]: /api/connections* 路由：发起/接受/拒绝/取消、好友列表、待处理请求。
 * [POS]: 跨协作空间连接协议层；可见性规则见 user-visibility-service。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { publishInboxItem } from '../services/inbox-service'
import {
  acceptConnection,
  cancelConnection,
  findConnection,
  listAcceptedConnections,
  listPendingRequestsFor,
  listPendingSentBy,
  rejectConnection,
  requestConnection,
} from '../storage/postgres/connection-store'
import { getUserById } from '../storage/postgres/auth-store'
import { getUserIdFromHeader, jsonError } from './shared'
import { findSharedWorkspaceId, isWorkspaceMember } from '../repositories/workspace'

export const CONNECTION_REQUEST_EVENT_TYPE = 'user.connection.requested'
export const CONNECTION_ACCEPTED_EVENT_TYPE = 'user.connection.accepted'
export const TEAM_INVITATION_EVENT_TYPE = 'team.invitation.sent'

const buildConnectionGroupKey = (requesterId: string) => `connection:${requesterId}`

const mapUserBrief = (userId: string, workspaceId?: string | null) => {
  const user = getUserById(userId)
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    username: user.username ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    workspaceId: workspaceId ?? undefined,
  }
}

const findConnectionPublic = (userA: string, userB: string, workspaceId?: string) => findConnection(userA, userB, workspaceId)

export const registerConnectionRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 我与某用户的关系状态（好友按钮用）：none / pending_sent / pending_received / connected。
  app.get('/api/connections/status/:userId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    if (!getUserById(targetUserId)) {
      return jsonError(c, '用户不存在。', 404)
    }
    if (targetUserId === userId) {
      return c.json({ status: 'self' })
    }
    const row = await findConnectionPublic(userId, targetUserId, workspaceId)
    if (!row) {
      return c.json({ status: 'none' })
    }
    if (row.status === 'accepted') {
      return c.json({ status: 'connected' })
    }
    return c.json({ status: row.requesterId === userId ? 'pending_sent' : 'pending_received' })
  })

  // 我的好友列表（accepted，双向）。
  app.get('/api/connections', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const rows = await listAcceptedConnections(userId, workspaceId)
    const users = rows
      .map((row) => mapUserBrief(row.requesterId === userId ? row.addresseeId : row.requesterId, row.workspaceId))
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
    return c.json({ users })
  })

  // 发给我的待处理好友请求。
  app.get('/api/connections/requests', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const rows = await listPendingRequestsFor(userId, workspaceId)
    const users = rows
      .map((row) => mapUserBrief(row.requesterId, row.workspaceId))
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
    return c.json({ users })
  })

  // 我发出的待处理好友请求。
  app.get('/api/connections/requests/sent', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const rows = await listPendingSentBy(userId, workspaceId)
    const users = rows
      .map((row) => mapUserBrief(row.addresseeId, row.workspaceId))
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
    return c.json({ users })
  })

  // 发起好友请求（对已注册用户；请求方不需要先可见对方——建立关系就是可见性来源）。
  app.post('/api/connections/requests', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({ userId: z.string().trim().min(1), workspaceId: z.string().trim().min(1).optional() }).parse(await c.req.json().catch(() => ({})))
    const targetUserId = payload.userId
    if (targetUserId === userId) {
      return jsonError(c, '不能添加自己为好友。', 400)
    }
    const targetUser = getUserById(targetUserId)
    if (!targetUser) {
      return jsonError(c, '用户不存在。', 404)
    }

    const workspaceId = payload.workspaceId || await findSharedWorkspaceId(userId, targetUserId)
    if (!workspaceId || !(await isWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限在该组织添加好友。', 403)
    }
    const result = await requestConnection(userId, targetUserId, workspaceId)
    if (result.created) {
      const currentUser = getUserById(userId)
      await publishInboxItem({
        recipientType: 'user',
        recipientId: targetUserId,
        kind: 'mention',
        reason: 'mentioned',
        eventType: CONNECTION_REQUEST_EVENT_TYPE,
        actor: { type: 'user', id: userId, name: currentUser?.name || currentUser?.email || '用户' },
        title: currentUser?.name || currentUser?.email || '好友请求',
        body: '请求添加你为好友',
        scope: {},
        groupKey: buildConnectionGroupKey(userId),
        replyTo: { kind: 'none' },
        dedupeKey: `connection-request:${userId}:${targetUserId}`,
        createdAt: new Date().toISOString(),
      }).catch(() => undefined)
    }
    return c.json({ ok: true, created: result.created })
  })

  // 接受好友请求（我作为 addressee）。
  app.post('/api/connections/requests/:requesterId/accept', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const requesterId = c.req.param('requesterId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const updated = await acceptConnection(userId, requesterId, workspaceId)
    if (!updated) {
      return jsonError(c, '请求不存在或已处理。', 404)
    }
    // 通知发起方：已接受。
    const currentUser = getUserById(userId)
    await publishInboxItem({
      recipientType: 'user',
      recipientId: requesterId,
      kind: 'mention',
      reason: 'mentioned',
      eventType: CONNECTION_ACCEPTED_EVENT_TYPE,
      actor: { type: 'user', id: userId, name: currentUser?.name || currentUser?.email || '用户' },
      title: currentUser?.name || currentUser?.email || '好友请求已接受',
      body: '已接受你的好友请求',
      scope: {},
      groupKey: buildConnectionGroupKey(userId),
      replyTo: { kind: 'none' },
      dedupeKey: `connection-accepted:${userId}:${requesterId}`,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined)
    return c.json({ ok: true })
  })

  // 拒绝好友请求。
  app.post('/api/connections/requests/:requesterId/reject', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const requesterId = c.req.param('requesterId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const removed = await rejectConnection(userId, requesterId, workspaceId)
    if (!removed) {
      return jsonError(c, '请求不存在或已处理。', 404)
    }
    return c.json({ ok: true })
  })

  // 取消我发出的好友请求。
  app.post('/api/connections/requests/:addresseeId/cancel', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const addresseeId = c.req.param('addresseeId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const removed = await cancelConnection(userId, addresseeId, workspaceId)
    if (!removed) {
      return jsonError(c, '请求不存在或已处理。', 404)
    }
    return c.json({ ok: true })
  })
}
