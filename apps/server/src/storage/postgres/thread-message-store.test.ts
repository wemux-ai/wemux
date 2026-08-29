import assert from 'node:assert/strict'
import test from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import type { MainChatSession } from '@shared/types'

import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { appMeta, conversations, messages } from './schema'
import {
  FREE_MESSAGE_RETENTION_DAYS,
  applyMessageRetention,
  backfillMainChatThreads,
  readBackfillSkippedSessions,
  flushThreadWrites,
  getMainChatThreadMessages,
  resetThreadStoreSnapshot,
  syncMainChatThreads,
} from './thread-message-store'

const THREAD_ID = 'test-thread-mirror-1'
const OTHER_THREAD_ID = 'test-thread-mirror-2'
const ALL_THREAD_IDS = [THREAD_ID, OTHER_THREAD_ID]

const buildSession = (overrides: Partial<MainChatSession> = {}): MainChatSession => ({
  id: THREAD_ID,
  title: '镜像测试会话',
  messages: [{
    id: `${THREAD_ID}-message-1`,
    role: 'user',
    content: 'hello mirror',
    createdAt: '2026-08-03T00:00:00.000Z',
  }],
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
})

const clearBackfillMarker = async () => {
  await getDrizzleDb().delete(appMeta).where(eq(appMeta.key, 'mainChatThreadBackfillCompletedAt'))
}

const cleanup = async () => {
  const db = getDrizzleDb()
  await db.delete(messages).where(inArray(messages.conversationId, ALL_THREAD_IDS))
  await db.delete(conversations).where(inArray(conversations.id, ALL_THREAD_IDS))
}

/**
 * 等待 syncMainChatThreads 内部的 fire-and-forget 写入落地。
 * 必须连 messages 表一起等：P0 给 writeMessages 加了一段独立事务
 * （advisory lock + seq 分配），conversations 行落地和 messages 行落地不再是同一时刻。
 */
const flushMirror = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    const db = getDrizzleDb()
    const [conversationRows, messageRows] = await Promise.all([
      db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.id, ALL_THREAD_IDS)),
      db.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, ALL_THREAD_IDS)),
    ])
    if (conversationRows.length > 0 && messageRows.length > 0) {
      return
    }
  }
}

test('syncMainChatThreads writes a thread and its message parts', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  syncMainChatThreads([buildSession({
    customAgentId: 'agent-mirror-1',
    executorId: 'executor-mirror-1',
    messages: [{
      id: `${THREAD_ID}-message-1`,
      role: 'assistant',
      content: 'mirrored answer',
      createdAt: '2026-08-03T00:00:01.000Z',
      reasoning: ['thinking hard'],
      toolCalls: [{
        id: 'tool-mirror-1',
        name: 'read',
        args: '{"path":"a.ts"}',
        result: 'ok',
        startedAt: '2026-08-03T00:00:00.500Z',
        finishedAt: '2026-08-03T00:00:00.900Z',
      }],
    }],
  })])
  await flushMirror()

  const db = getDrizzleDb()
  const [conversationRow] = await db
    .select()
    .from(conversations)
    .where(inArray(conversations.id, [THREAD_ID]))
  assert.equal(conversationRow.kind, 'main')
  assert.equal(conversationRow.title, '镜像测试会话')
  assert.equal(conversationRow.orchestratorAgentId, 'agent-mirror-1')
  assert.equal(conversationRow.executorId, 'executor-mirror-1')

  const [messageRow] = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, [THREAD_ID]))
  assert.equal(messageRow.role, 'assistant')
  assert.equal(messageRow.content, 'mirrored answer')
  assert.deepEqual((messageRow.partsJson ?? []).map((part) => part.type), [
    'reasoning',
    'tool_call',
    'tool_result',
    'text',
  ])

  await cleanup()
})

test('syncMainChatThreads upserts a streaming message in place', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  const streaming = buildSession({
    messages: [{
      id: `${THREAD_ID}-message-1`,
      role: 'assistant',
      content: 'par',
      createdAt: '2026-08-03T00:00:01.000Z',
    }],
  })
  syncMainChatThreads([streaming])
  await flushMirror()

  syncMainChatThreads([{
    ...streaming,
    updatedAt: '2026-08-03T00:00:02.000Z',
    messages: [{
      id: `${THREAD_ID}-message-1`,
      role: 'assistant',
      content: 'partial answer complete',
      createdAt: '2026-08-03T00:00:01.000Z',
    }],
  }])
  await new Promise((resolve) => setTimeout(resolve, 250))

  const rows = await getDrizzleDb()
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(inArray(messages.conversationId, [THREAD_ID]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, 'partial answer complete')

  await cleanup()
})

test('syncMainChatThreads removes a thread that disappeared from state', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  syncMainChatThreads([
    buildSession(),
    buildSession({ id: OTHER_THREAD_ID, messages: [{
      id: `${OTHER_THREAD_ID}-message-1`,
      role: 'user',
      content: 'second thread',
      createdAt: '2026-08-03T00:00:00.000Z',
    }] }),
  ])
  await flushMirror()
  await new Promise((resolve) => setTimeout(resolve, 150))

  syncMainChatThreads([buildSession()])
  await new Promise((resolve) => setTimeout(resolve, 250))

  const rows = await getDrizzleDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, ALL_THREAD_IDS))
  assert.deepEqual(rows.map((row) => row.id), [THREAD_ID])

  const orphanMessages = await getDrizzleDb()
    .select({ id: messages.id })
    .from(messages)
    .where(inArray(messages.conversationId, [OTHER_THREAD_ID]))
  assert.deepEqual(orphanMessages, [])

  await cleanup()
})

test('backfillMainChatThreads migrates blob sessions and is idempotent', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()
  await clearBackfillMarker()

  const first = await backfillMainChatThreads([buildSession({
    messages: [
      { id: `${THREAD_ID}-m1`, role: 'user', content: '问', createdAt: '2026-08-04T00:00:00.000Z' },
      { id: `${THREAD_ID}-m2`, role: 'assistant', content: '答', createdAt: '2026-08-04T00:00:00.000Z' },
    ],
  })])

  assert.equal(first.status, 'completed')
  assert.equal(first.sessionCount, 1)
  assert.equal(first.messageCount, 2)

  const rows = await getDrizzleDb()
    .select({ id: messages.id, seq: messages.seq })
    .from(messages)
    .where(inArray(messages.conversationId, [THREAD_ID]))
  assert.equal(rows.length, 2)

  // 二次调用必须跳过，且不依赖「表里有没有行」，而是看显式完成标记。
  const second = await backfillMainChatThreads([buildSession()])
  assert.equal(second.status, 'skipped-already-done')

  await cleanup()
  await clearBackfillMarker()
})

test('backfillMainChatThreads redoes the whole batch when the marker is absent', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()
  await clearBackfillMarker()

  // 模拟「上次只写进 1 个会话就崩溃、标记未落」的状态。
  await backfillMainChatThreads([buildSession({ id: THREAD_ID })])
  await clearBackfillMarker()
  resetThreadStoreSnapshot()

  const redo = await backfillMainChatThreads([
    buildSession({ id: THREAD_ID }),
    buildSession({ id: OTHER_THREAD_ID, messages: [{
      id: `${OTHER_THREAD_ID}-m1`, role: 'user', content: '第二个会话', createdAt: '2026-08-04T00:00:00.000Z',
    }] }),
  ])

  assert.equal(redo.status, 'completed')
  assert.equal(redo.sessionCount, 2)

  const rows = await getDrizzleDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, ALL_THREAD_IDS))
  assert.equal(rows.length, 2)

  await cleanup()
  await clearBackfillMarker()
})

test('applyMessageRetention deletes expired messages but keeps recent ones', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  const now = new Date('2026-08-04T00:00:00.000Z')
  const expired = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString()
  const fresh = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()

  syncMainChatThreads([buildSession({
    updatedAt: fresh,
    messages: [
      { id: `${THREAD_ID}-old`, role: 'user', content: '过期', createdAt: expired },
      { id: `${THREAD_ID}-new`, role: 'user', content: '保留', createdAt: fresh },
    ],
  })])
  await flushThreadWrites()

  const report = await applyMessageRetention(now)
  assert.equal(report.deletedMessageCount, 1)
  assert.equal(report.deletedThreadCount, 0)

  const remaining = await getDrizzleDb()
    .select({ id: messages.id })
    .from(messages)
    .where(inArray(messages.conversationId, [THREAD_ID]))
  assert.deepEqual(remaining.map((row) => row.id), [`${THREAD_ID}-new`])

  await cleanup()
})

test('applyMessageRetention drops a thread only when it is empty and itself expired', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  const now = new Date('2026-08-04T00:00:00.000Z')
  const expired = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000).toISOString()

  syncMainChatThreads([buildSession({
    createdAt: expired,
    updatedAt: expired,
    messages: [{ id: `${THREAD_ID}-old`, role: 'user', content: '过期', createdAt: expired }],
  })])
  await flushThreadWrites()

  const report = await applyMessageRetention(now)
  assert.equal(report.deletedMessageCount, 1)
  assert.equal(report.deletedThreadCount, 1)

  const rows = await getDrizzleDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, [THREAD_ID]))
  assert.deepEqual(rows, [])
})

test('applyMessageRetention keeps a recent thread that has no messages', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  const now = new Date('2026-08-04T00:00:00.000Z')
  const fresh = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()

  syncMainChatThreads([buildSession({ createdAt: fresh, updatedAt: fresh, messages: [] })])
  await flushThreadWrites()

  const report = await applyMessageRetention(now)
  assert.equal(report.deletedThreadCount, 0)

  const rows = await getDrizzleDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, [THREAD_ID]))
  assert.equal(rows.length, 1)

  await cleanup()
})

test('the free message retention window stays at 180 days（R8.3 v4 定稿）', () => {
  // 免费用户统一 6 个月保留期，是产品定稿（v4），改动需要产品决策。
  assert.equal(FREE_MESSAGE_RETENTION_DAYS, 180)
})

test('backfill isolates a failing session and records it instead of blocking startup', async () => {
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()
  await clearBackfillMarker()
  await getDrizzleDb().delete(appMeta).where(eq(appMeta.key, 'mainChatThreadBackfillSkipped'))

  // id 为 null 会违反 conversations.id 的 NOT NULL；另一个会话必须照常迁入。
  const poison = buildSession({ id: null as unknown as string })
  const healthy = buildSession({
    id: OTHER_THREAD_ID,
    messages: [{ id: `${OTHER_THREAD_ID}-m1`, role: 'user', content: '正常会话', createdAt: '2026-08-04T00:00:00.000Z' }],
  })

  const report = await backfillMainChatThreads([poison, healthy])

  assert.equal(report.status, 'completed')
  assert.equal(report.sessionCount, 1)
  assert.equal(report.skipped.length, 1)

  const rows = await getDrizzleDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, [OTHER_THREAD_ID]))
  assert.deepEqual(rows.map((row) => row.id), [OTHER_THREAD_ID])

  // 跳过记录必须可查，不能只在日志里。
  const persisted = await readBackfillSkippedSessions()
  assert.equal(persisted.length, 1)

  await cleanup()
  await clearBackfillMarker()
  await getDrizzleDb().delete(appMeta).where(eq(appMeta.key, 'mainChatThreadBackfillSkipped'))
})

test('new message after retention pruning gets a seq greater than all surviving messages', async () => {
  // 复现缺陷 §4.2-1：保留期裁剪删掉前 k 条后，新消息的 seq 不应与幸存消息冲突。
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  const recent = '2026-08-03T00:00:00.000Z'
  const expired = '2020-01-01T00:00:00.000Z'

  // 写入 3 条消息：1 条过期 + 2 条近期。
  syncMainChatThreads([buildSession({
    updatedAt: recent,
    messages: [
      { id: `${THREAD_ID}-old`, role: 'user', content: '过期', createdAt: expired },
      { id: `${THREAD_ID}-m2`, role: 'assistant', content: '保留A', createdAt: recent },
      { id: `${THREAD_ID}-m3`, role: 'assistant', content: '保留B', createdAt: recent },
    ],
  })])
  await flushThreadWrites()

  // 保留期裁剪：删除过期消息。
  const now = new Date('2026-08-04T00:00:00.000Z')
  const retention = await applyMessageRetention(now)
  assert.equal(retention.deletedMessageCount, 1)

  // 追加一条新消息，触发 syncMainChatThreads。
  syncMainChatThreads([buildSession({
    updatedAt: recent,
    messages: [
      { id: `${THREAD_ID}-m2`, role: 'assistant', content: '保留A', createdAt: recent },
      { id: `${THREAD_ID}-m3`, role: 'assistant', content: '保留B', createdAt: recent },
      { id: `${THREAD_ID}-new`, role: 'user', content: '新消息', createdAt: '2026-08-03T00:01:00.000Z' },
    ],
  })])
  await flushThreadWrites()

  // 断言：所有消息 seq 唯一，新消息排在末尾。
  const rows = await getDrizzleDb()
    .select({ id: messages.id, seq: messages.seq })
    .from(messages)
    .where(inArray(messages.conversationId, [THREAD_ID]))
    .orderBy(messages.seq)

  assert.equal(rows.length, 3, 'should have 3 messages (2 surviving + 1 new)')
  assert.deepEqual(
    rows.map((r) => r.id),
    [`${THREAD_ID}-m2`, `${THREAD_ID}-m3`, `${THREAD_ID}-new`],
  )
  // seq 严格递增，无重复。
  const seqValues = rows.map((r) => r.seq)
  assert.ok(seqValues[0] < seqValues[1], 'seq should be strictly increasing')
  assert.ok(seqValues[1] < seqValues[2], 'seq should be strictly increasing')

  await cleanup()
})

test('retention pruning is not undone by the next mirror sync', async () => {
  // 复现缺陷 §4.2-2：裁剪后快照精确摘除被删条目，下一次 sync 不会把已删消息写回。
  await ensurePostgresReady()
  resetThreadStoreSnapshot()
  await cleanup()

  const recent = '2026-08-03T00:00:00.000Z'
  const expired = '2020-01-01T00:00:00.000Z'

  // 初始同步：1 条过期 + 1 条近期。
  syncMainChatThreads([buildSession({
    updatedAt: recent,
    messages: [
      { id: `${THREAD_ID}-old`, role: 'user', content: '过期', createdAt: expired },
      { id: `${THREAD_ID}-keep`, role: 'assistant', content: '保留', createdAt: recent },
    ],
  })])
  await flushThreadWrites()

  // 保留期裁剪：删除过期消息。
  const now = new Date('2026-08-04T00:00:00.000Z')
  await applyMessageRetention(now)

  // 再次触发 syncMainChatThreads（同一批会话，模拟其它字段变化触发写入）。
  syncMainChatThreads([buildSession({
    updatedAt: '2026-08-03T00:01:00.000Z',
    messages: [
      { id: `${THREAD_ID}-keep`, role: 'assistant', content: '保留', createdAt: recent },
    ],
  })])
  await flushThreadWrites()

  // 断言：被裁剪的消息没有重新出现。
  const rows = await getDrizzleDb()
    .select({ id: messages.id })
    .from(messages)
    .where(inArray(messages.conversationId, [THREAD_ID]))

  assert.deepEqual(
    rows.map((r) => r.id),
    [`${THREAD_ID}-keep`],
    'deleted message should not reappear after mirror sync',
  )

  await cleanup()
})

test('cold load returns messages with thread-local seq cursors for pagination', async () => {
  resetThreadStoreSnapshot()
  await cleanup()

  const session = buildSession({
    messages: [
      { id: `${THREAD_ID}-m1`, role: 'user', content: '第一条', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: `${THREAD_ID}-m2`, role: 'assistant', content: '回复', createdAt: '2026-08-03T00:00:01.000Z' },
      { id: `${THREAD_ID}-m3`, role: 'user', content: '第三条', createdAt: '2026-08-03T00:00:02.000Z' },
    ],
  })
  syncMainChatThreads([session])
  await flushThreadWrites()

  const full = await getMainChatThreadMessages({ threadId: THREAD_ID })
  assert.deepEqual((full.messages ?? []).map((message) => message.seq), [1, 2, 3])
  assert.equal(full.totalMessageCount, 3)
  assert.equal(full.hasMoreBefore, false)

  // beforeSeq 游标：取 seq < 3 的旧消息（P3b 客户端翻页用 seq 做游标）。
  const older = await getMainChatThreadMessages({ threadId: THREAD_ID, beforeSeq: 3 })
  assert.deepEqual((older.messages ?? []).map((message) => message.seq), [1, 2])
  assert.equal(older.hasMoreBefore, false)

  await cleanup()
})
