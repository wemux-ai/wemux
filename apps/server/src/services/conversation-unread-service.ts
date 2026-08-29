/**
 * [INPUT]: 会话（conversation）已读游标请求 + messages 表。
 * [OUTPUT]: 会话未读计数（他人消息、createdAt > lastReadAt）与已读标记（upsert）。
 * [POS]: 会话未读服务（feature P2）。与 workspace-session-unread-store 并列，覆盖群聊/任务会话。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, count, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { conversationReadState, conversations, messages } from '../storage/postgres/schema'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'

/**
 * 统计用户在各会话的未读数（按会话分组）。
 * 未读 = senderId 非空且非本人、createdAt 严格大于该用户已读游标的消息数。
 * 无已读游标的会话（从未打开过）也计未读，但只统计会话创建之后的他人消息，
 * 避免把更早的历史一并算进来（私聊/群聊首次收到消息必须显示未读 badge）。
 */
export const countConversationUnread = async (params: {
  userId: string
  conversationIds: string[]
}): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {}
  const ids = [...new Set(params.conversationIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) {
    return counts
  }

  await ensurePostgresReady()
  const db = getDrizzleDb()
  const rows = await db.select({
    conversationId: messages.conversationId,
    unreadCount: count(),
  }).from(messages).leftJoin(conversationReadState, and(
    eq(conversationReadState.conversationId, messages.conversationId),
    eq(conversationReadState.userId, params.userId),
  )).leftJoin(conversations, eq(conversations.id, messages.conversationId)).where(and(
    inArray(messages.conversationId, ids),
    isNotNull(messages.senderId),
    ne(messages.senderId, params.userId),
    or(
      // 从未打开过（无已读游标）：只统计会话创建后的他人消息。
      and(
        isNull(conversationReadState.lastReadAt),
        sql`${messages.createdAt} > ${conversations.createdAt}`,
      ),
      // 有已读游标：只统计严格晚于游标的他人消息。
      sql`${messages.createdAt} > ${conversationReadState.lastReadAt}`,
    ),
  )).groupBy(messages.conversationId)

  for (const row of rows) {
    if (row.unreadCount > 0) {
      counts[row.conversationId] = row.unreadCount
    }
  }

  return counts
}

/** 标记会话已读（upsert 游标）。传入 lastReadAt（会话最新消息时间）或默认当前时间。 */
export const markConversationRead = async (params: {
  userId: string
  conversationId: string
  lastReadAt?: string
}): Promise<void> => {
  const conversationId = params.conversationId.trim()
  if (!conversationId) {
    return
  }
  const now = new Date().toISOString()
  const lastReadAt = params.lastReadAt?.trim() || now

  await ensurePostgresReady()
  const db = getDrizzleDb()
  await db.insert(conversationReadState).values({
    id: crypto.randomUUID(),
    userId: params.userId,
    conversationId,
    lastReadAt,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [conversationReadState.userId, conversationReadState.conversationId],
    set: {
      lastReadAt,
      updatedAt: now,
    },
  })
}
