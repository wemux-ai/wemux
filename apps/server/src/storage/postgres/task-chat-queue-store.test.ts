import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTaskChatSessionKey } from '@shared/task-chat-session'

import { closePostgres, isPostgresConfigured, query } from './db'
import {
  acquireTaskChatSessionLeaseDb,
  claimTaskChatQueueItemDb,
  completeTaskChatQueueItemDb,
  enqueueTaskChatQueueItemDb,
  refreshTaskChatQueueMirror,
  releaseTaskChatQueueItemDb,
  releaseTaskChatSessionLeaseDb,
  renewTaskChatSessionLeaseDb,
  resetTaskChatQueueMirrorForTests,
  sweepExpiredTaskChatQueueClaimsDb,
} from './task-chat-queue-store'

const testIfPostgres = isPostgresConfigured() ? test : test.skip

const queueIds = new Set<string>()
const leaseKeys = new Set<string>()

const buildEntry = (overrides: Partial<Parameters<typeof enqueueTaskChatQueueItemDb>[0]> = {}) => {
  const id = overrides.id ?? `queue-test-${crypto.randomUUID()}`
  queueIds.add(id)
  return {
    id,
    sessionKey: buildTaskChatSessionKey('task-test', 'workspace-test', 'session-test'),
    taskId: 'task-test',
    workspaceId: 'workspace-test',
    workspaceSessionId: 'session-test',
    message: '多节点队列测试消息',
    createdAt: new Date().toISOString(),
    createdBy: 'user-test',
    retryCount: 0,
    ...overrides,
  }
}

const cleanupQueue = async () => {
  for (const id of queueIds) {
    await query('DELETE FROM task_chat_queue_items WHERE id = $1', [id])
  }
  for (const sessionKey of leaseKeys) {
    await query('DELETE FROM task_chat_session_leases WHERE session_key = $1', [sessionKey])
  }
  queueIds.clear()
  leaseKeys.clear()
  resetTaskChatQueueMirrorForTests()
}

test.afterEach(cleanupQueue)

test.after(async () => {
  await closePostgres()
})

testIfPostgres('enqueue writes a pending row and refreshes the mirror', async () => {
  const entry = buildEntry()
  const enqueued = await enqueueTaskChatQueueItemDb(entry)

  assert.equal(enqueued.id, entry.id)
  const rows = await query('SELECT status FROM task_chat_queue_items WHERE id = $1', [entry.id])
  assert.equal(rows.rows[0]?.status, 'pending')

  await refreshTaskChatQueueMirror()
  const { listPendingTaskChatQueueEntriesFromMirror } = await import('./task-chat-queue-store')
  const pending = listPendingTaskChatQueueEntriesFromMirror(entry.sessionKey)
  assert.equal(pending.some((item) => item.id === entry.id), true)
})

testIfPostgres('enqueue dedupes by session_key + dedupe_key under concurrency', async () => {
  const sessionKey = buildTaskChatSessionKey('task-test', 'workspace-test', 'session-test')
  const dedupeKey = 'dedupe-test-key'
  const first = buildEntry({ sessionKey, dedupeKey, message: '第一条' })
  const second = buildEntry({ sessionKey, dedupeKey, message: '第二条' })

  const [firstResult, secondResult] = await Promise.all([
    enqueueTaskChatQueueItemDb(first),
    enqueueTaskChatQueueItemDb(second),
  ])

  assert.equal(firstResult.id === secondResult.id, true, 'concurrent dedupe must resolve to one entry')
  const rows = await query(
    'SELECT COUNT(*)::int AS count FROM task_chat_queue_items WHERE session_key = $1 AND dedupe_key = $2',
    [sessionKey, dedupeKey],
  )
  assert.equal(rows.rows[0]?.count, 1)
})

testIfPostgres('only the queue head can be claimed and concurrent claims have a single winner', async () => {
  const sessionKey = buildTaskChatSessionKey('task-test', 'workspace-test', 'session-test')
  const first = buildEntry({ sessionKey, createdAt: '2026-01-01T00:00:00.000Z' })
  const second = buildEntry({ sessionKey, createdAt: '2026-01-02T00:00:00.000Z' })
  await enqueueTaskChatQueueItemDb(first)
  await enqueueTaskChatQueueItemDb(second)

  // 跳过队头直接 claim 第二个：必须失败（保持「队头优先」语义）。
  const skippedHead = await claimTaskChatQueueItemDb({ sessionKey, queueId: second.id })
  assert.equal(skippedHead, null)

  // 并发 claim 队头：只有一个赢家。
  const [claimA, claimB] = await Promise.all([
    claimTaskChatQueueItemDb({ sessionKey, queueId: first.id, claimedBy: 'node-a' }),
    claimTaskChatQueueItemDb({ sessionKey, queueId: first.id, claimedBy: 'node-b' }),
  ])
  const winners = [claimA, claimB].filter(Boolean)
  assert.equal(winners.length, 1)
  const winner = winners[0]
  assert.equal(winner?.id, first.id)
  assert.equal(winner?.claimId.length > 0, true)

  const rows = await query('SELECT status FROM task_chat_queue_items WHERE id = $1', [first.id])
  assert.equal(rows.rows[0]?.status, 'claimed')
})

testIfPostgres('complete removes the claimed row and release restores with retry budget', async () => {
  const sessionKey = buildTaskChatSessionKey('task-test', 'workspace-test', 'session-test')
  const entry = buildEntry({ sessionKey })
  await enqueueTaskChatQueueItemDb(entry)

  // 完整流转：release 两次都在重试预算内，第三次直接丢弃。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextClaim = await claimTaskChatQueueItemDb({ sessionKey, queueId: entry.id })
    assert.ok(nextClaim, `attempt ${attempt} should be claimable`)
    const released = await releaseTaskChatQueueItemDb({
      sessionKey,
      queueId: entry.id,
      claimId: nextClaim.claimId,
    })
    if (attempt < 2) {
      assert.equal(released.dropped, false)
      assert.equal(released.restoredItem?.retryCount, attempt + 1)
    } else {
      assert.equal(released.dropped, true)
      assert.equal(released.restoredItem, null)
    }
  }

  const remaining = await query('SELECT COUNT(*)::int AS count FROM task_chat_queue_items WHERE id = $1', [entry.id])
  assert.equal(remaining.rows[0]?.count, 0)

  // complete 路径：claim 后 complete 直接删除。
  const secondEntry = buildEntry({ sessionKey })
  await enqueueTaskChatQueueItemDb(secondEntry)
  const secondClaim = await claimTaskChatQueueItemDb({ sessionKey, queueId: secondEntry.id })
  assert.ok(secondClaim)
  await completeTaskChatQueueItemDb({ sessionKey, queueId: secondEntry.id, claimId: secondClaim.claimId })
  const afterComplete = await query('SELECT COUNT(*)::int AS count FROM task_chat_queue_items WHERE id = $1', [secondEntry.id])
  assert.equal(afterComplete.rows[0]?.count, 0)
})

testIfPostgres('expired claims are swept back to pending without losing the item', async () => {
  const sessionKey = buildTaskChatSessionKey('task-test', 'workspace-test', 'session-test')
  const entry = buildEntry({ sessionKey })
  await enqueueTaskChatQueueItemDb(entry)
  const claim = await claimTaskChatQueueItemDb({
    sessionKey,
    queueId: entry.id,
    claimedBy: 'node-dead',
    claimTimeoutMs: 100,
  })
  assert.ok(claim)

  await new Promise((resolve) => setTimeout(resolve, 150))
  const restored = await sweepExpiredTaskChatQueueClaimsDb()

  assert.equal(restored.some((target) => target.workspaceSessionId === 'session-test'), true)
  const rows = await query('SELECT status, retry_count, claim_id FROM task_chat_queue_items WHERE id = $1', [entry.id])
  assert.equal(rows.rows[0]?.status, 'pending')
  assert.equal(rows.rows[0]?.claim_id, null)
  // 过期恢复不消耗重试预算（与历史语义一致）。
  assert.equal(rows.rows[0]?.retry_count, 0)

  const reclaimed = await claimTaskChatQueueItemDb({ sessionKey, queueId: entry.id })
  assert.ok(reclaimed, 'swept item must be claimable again')
})

testIfPostgres('session execution lease is mutually exclusive and recoverable after expiry', async () => {
  const sessionKey = buildTaskChatSessionKey('task-test', 'workspace-test', 'session-test')
  leaseKeys.add(sessionKey)

  const first = await acquireTaskChatSessionLeaseDb({ sessionKey, ttlMs: 200 })
  assert.ok(first)

  // 持有期间第二个节点拿不到。
  const blocked = await acquireTaskChatSessionLeaseDb({ sessionKey })
  assert.equal(blocked, null)

  // 续租生效（续租前不失效）。
  assert.equal(await renewTaskChatSessionLeaseDb({ sessionKey, leaseId: first.leaseId, ttlMs: 400 }), true)

  // 主动释放后立即可再获取。
  await releaseTaskChatSessionLeaseDb({ sessionKey, leaseId: first.leaseId })
  const afterRelease = await acquireTaskChatSessionLeaseDb({ sessionKey, ttlMs: 100 })
  assert.ok(afterRelease)

  // 过期后另一节点可接管。
  await new Promise((resolve) => setTimeout(resolve, 150))
  const takeover = await acquireTaskChatSessionLeaseDb({ sessionKey, ttlMs: 60_000 })
  assert.ok(takeover)
  assert.notEqual(takeover.leaseId, afterRelease.leaseId)
  await releaseTaskChatSessionLeaseDb({ sessionKey, leaseId: takeover.leaseId })
})
