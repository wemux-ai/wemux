import assert from 'node:assert/strict'
import test from 'node:test'
import { eq } from 'drizzle-orm'

import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { conversationReadState, conversations, messages } from '../storage/postgres/schema'
import { countConversationUnread, markConversationRead } from './conversation-unread-service'

const CONV = 'test-unread-conv'
const ME = 'test-unread-me'
const PEER = 'test-unread-peer'

const cleanup = async () => {
  const db = getDrizzleDb()
  await db.delete(messages).where(eq(messages.conversationId, CONV))
  await db.delete(conversationReadState).where(eq(conversationReadState.conversationId, CONV))
  await db.delete(conversations).where(eq(conversations.id, CONV))
}

const seedConversation = async (createdAt: string) => {
  await getDrizzleDb().insert(conversations).values({
    id: CONV,
    title: '未读测试会话',
    kind: 'dm',
    chatMode: 'direct',
    status: 'active',
    externalSyncMode: 'internal',
    createdAt,
    updatedAt: createdAt,
  })
}

const insertMessage = async (id: string, senderId: string | null, content: string, createdAt: string, seq: number) => {
  await getDrizzleDb().insert(messages).values({
    id,
    conversationId: CONV,
    senderId,
    content,
    contentType: 'text',
    seq,
    createdAt,
  })
}

test('countConversationUnread: 无已读游标的会话也计未读（只统计会话创建后的他人消息）', async () => {
  await ensurePostgresReady()
  await cleanup()
  await seedConversation('2026-08-01T00:00:00.000Z')
  await insertMessage('m1', PEER, '你好', '2026-08-02T00:00:00.000Z', 1)
  await insertMessage('m2', PEER, '第二条', '2026-08-03T00:00:00.000Z', 2)
  await insertMessage('m3', ME, '自己的消息不计', '2026-08-04T00:00:00.000Z', 3)

  const counts = await countConversationUnread({ userId: ME, conversationIds: [CONV] })
  assert.equal(counts[CONV], 2)

  await cleanup()
})

test('countConversationUnread: 有已读游标只统计严格晚于游标的他人消息', async () => {
  await ensurePostgresReady()
  await cleanup()
  await seedConversation('2026-08-01T00:00:00.000Z')
  await insertMessage('m1', PEER, '已读', '2026-08-02T00:00:00.000Z', 1)
  await markConversationRead({ userId: ME, conversationId: CONV, lastReadAt: '2026-08-02T00:00:00.000Z' })
  await insertMessage('m2', PEER, '新消息', '2026-08-03T00:00:00.000Z', 2)

  const counts = await countConversationUnread({ userId: ME, conversationIds: [CONV] })
  assert.equal(counts[CONV], 1)

  await cleanup()
})
