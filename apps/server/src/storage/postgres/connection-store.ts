/**
 * [INPUT]: 组织范围内的用户连接（好友）请求与状态变更。
 * [OUTPUT]: user_connections 表读写：发起/接受/拒绝/取消、列表、同空间双向可见性判定。
 * [POS]: 外部联系人关系存储层；可见性组合规则（空间成员 ∪ 本空间已连接）在路由层/workspace repository。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, eq, or } from 'drizzle-orm'
import { getDrizzleDb } from './drizzle-db'
import { userConnections } from './schema-core'

export type UserConnectionRow = typeof userConnections.$inferSelect

export type UserConnectionStatus = 'pending' | 'accepted'

const pairKey = (userA: string, userB: string) => [userA, userB].sort().join(':')

/** 查询一个空间内的关系记录（双向对称匹配，pending 只存发起方向）。 */
export const findConnection = async (userA: string, userB: string, workspaceId?: string): Promise<UserConnectionRow | null> => {
  const workspaceCondition = workspaceId?.trim()
    ? eq(userConnections.workspaceId, workspaceId.trim())
    : undefined
  const [row] = await getDrizzleDb().select().from(userConnections).where(and(
    workspaceCondition,
    or(
      and(eq(userConnections.requesterId, userA), eq(userConnections.addresseeId, userB)),
      and(eq(userConnections.requesterId, userB), eq(userConnections.addresseeId, userA)),
    ),
  )).limit(1)
  return row ?? null
}

/** 发起好友请求；已存在关系时返回现有记录（幂等）。 */
export const requestConnection = async (requesterId: string, addresseeId: string, workspaceId: string) => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) {
    throw new Error('好友请求必须指定协作空间。')
  }
  const existing = await findConnection(requesterId, addresseeId, normalizedWorkspaceId)
  if (existing) {
    return { row: existing, created: false }
  }
  const now = new Date().toISOString()
  const row = {
    id: crypto.randomUUID(),
    workspaceId: normalizedWorkspaceId,
    requesterId,
    addresseeId,
    status: 'pending' as const,
    createdAt: now,
    respondedAt: null,
  }
  await getDrizzleDb().insert(userConnections).values(row)
  return { row, created: true }
}

/** 接受好友请求（addressee 视角）；只有 pending 且自己是 addressee 时有效。 */
export const acceptConnection = async (addresseeId: string, requesterId: string, workspaceId?: string) => {
  const existing = await findConnection(requesterId, addresseeId, workspaceId)
  if (!existing || existing.addresseeId !== addresseeId || existing.status !== 'pending') {
    return null
  }
  const updated = { ...existing, status: 'accepted' as const, respondedAt: new Date().toISOString() }
  await getDrizzleDb().update(userConnections)
    .set({ status: 'accepted', respondedAt: updated.respondedAt })
    .where(eq(userConnections.id, existing.id))
  return updated
}

/** 拒绝好友请求（addressee 视角）；删除记录，双方恢复不可见。 */
export const rejectConnection = async (addresseeId: string, requesterId: string, workspaceId?: string) => {
  const existing = await findConnection(requesterId, addresseeId, workspaceId)
  if (!existing || existing.addresseeId !== addresseeId || existing.status !== 'pending') {
    return null
  }
  await getDrizzleDb().delete(userConnections).where(eq(userConnections.id, existing.id))
  return existing
}

/** 取消自己发出的好友请求。 */
export const cancelConnection = async (requesterId: string, addresseeId: string, workspaceId?: string) => {
  const existing = await findConnection(requesterId, addresseeId, workspaceId)
  if (!existing || existing.requesterId !== requesterId || existing.status !== 'pending') {
    return null
  }
  await getDrizzleDb().delete(userConnections).where(eq(userConnections.id, existing.id))
  return existing
}

/** 已连接的好友列表（双向 accepted）。 */
export const listAcceptedConnections = async (userId: string, workspaceId?: string): Promise<UserConnectionRow[]> => {
  const workspaceCondition = workspaceId?.trim()
    ? eq(userConnections.workspaceId, workspaceId.trim())
    : undefined
  return getDrizzleDb().select().from(userConnections).where(and(
    workspaceCondition,
    or(eq(userConnections.requesterId, userId), eq(userConnections.addresseeId, userId)),
    eq(userConnections.status, 'accepted'),
  ))
}

/** 发给我的待处理请求（我作为 addressee）。 */
export const listPendingRequestsFor = async (userId: string, workspaceId?: string): Promise<UserConnectionRow[]> => {
  const workspaceCondition = workspaceId?.trim()
    ? eq(userConnections.workspaceId, workspaceId.trim())
    : undefined
  return getDrizzleDb().select().from(userConnections).where(and(
    workspaceCondition,
    eq(userConnections.addresseeId, userId),
    eq(userConnections.status, 'pending'),
  ))
}

/** 我发出的待处理请求。 */
export const listPendingSentBy = async (userId: string, workspaceId?: string): Promise<UserConnectionRow[]> => {
  const workspaceCondition = workspaceId?.trim()
    ? eq(userConnections.workspaceId, workspaceId.trim())
    : undefined
  return getDrizzleDb().select().from(userConnections).where(and(
    workspaceCondition,
    eq(userConnections.requesterId, userId),
    eq(userConnections.status, 'pending'),
  ))
}

/** 是否已连接（accepted，双向对称）。 */
export const areConnected = async (userA: string, userB: string, workspaceId?: string) => {
  if (!userA.trim() || !userB.trim()) return false
  if (userA === userB) return true
  const row = await findConnection(userA, userB, workspaceId)
  return Boolean(row && row.status === 'accepted')
}

/** 内存缓存版 pair key（同一对用户多次查询用；仅进程内）。 */
export const connectionPairKey = pairKey
