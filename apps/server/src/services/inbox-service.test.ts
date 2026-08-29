import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildInboxItem,
  isSelfDelivery,
  SUPPORT_CHANNEL_EVENT_TYPES,
  type InboxPublishInput,
} from './inbox-service'

const input = (overrides: Partial<InboxPublishInput> = {}): InboxPublishInput => ({
  recipientType: 'user',
  recipientId: 'user-1',
  kind: 'mention',
  reason: 'mentioned',
  eventType: 'task.comment.mentioned',
  actor: { type: 'user', id: 'user-2', name: 'Alice' },
  title: '更新 README',
  body: '@user-1 看一下安装步骤',
  scope: { projectId: 'project-1', taskId: 'task-1', commentId: 'comment-1' },
  groupKey: 'task:task-1',
  replyTo: { kind: 'task_comment', taskId: 'task-1', parentCommentId: 'comment-1' },
  dedupeKey: 'comment-mention:comment-1:user-1',
  ...overrides,
})

test('buildInboxItem preserves the caller supplied identity and causal metadata', () => {
  const item = buildInboxItem(input({
    itemId: 'item-1',
    traceId: 'trace-1',
    chainStartedAt: '2026-07-27T00:00:00.000Z',
    sourceInboxItemId: 'item-0',
    hopCount: 2,
    createdAt: '2026-07-27T00:05:00.000Z',
  }))

  assert.equal(item.id, 'item-1')
  assert.equal(item.traceId, 'trace-1')
  assert.equal(item.chainStartedAt, '2026-07-27T00:00:00.000Z')
  assert.equal(item.sourceInboxItemId, 'item-0')
  assert.equal(item.hopCount, 2)
  assert.equal(item.createdAt, '2026-07-27T00:05:00.000Z')
})

test('buildInboxItem starts a fresh trace at hop zero when no upstream item exists', () => {
  const item = buildInboxItem(input())

  assert.ok(item.id)
  assert.ok(item.traceId)
  assert.equal(item.hopCount, 0)
  assert.equal(item.sourceInboxItemId, undefined)
  // A chain that starts here is its own origin, so the chain clock starts now.
  assert.ok(Number.isFinite(new Date(item.chainStartedAt).getTime()))
})

test('buildInboxItem defaults chainStartedAt to the supplied createdAt', () => {
  const item = buildInboxItem(input({ createdAt: '2026-07-27T01:02:03.000Z' }))
  assert.equal(item.chainStartedAt, '2026-07-27T01:02:03.000Z')
})

test('buildInboxItem never leaves an item unattributed', () => {
  assert.equal(buildInboxItem(input()).actorName, 'Alice')
  assert.equal(buildInboxItem(input({ actor: { type: 'agent', id: 'agent-1' } })).actorName, 'Agent')
  assert.equal(buildInboxItem(input({ actor: { type: 'system' } })).actorName, '系统')
  assert.equal(buildInboxItem(input({ actor: { type: 'user', id: 'user-2' } })).actorName, '团队成员')
  assert.equal(buildInboxItem(input({ actor: { type: 'user', id: 'user-2', name: '   ' } })).actorName, '团队成员')
})

test('buildInboxItem blanks placeholder identifiers instead of persisting whitespace', () => {
  const item = buildInboxItem(input({
    itemId: '  ',
    traceId: '  ',
    sourceInboxItemId: '  ',
    actor: { type: 'user', id: '  ', name: 'Alice' },
  }))

  assert.notEqual(item.id.trim(), '')
  assert.notEqual(item.traceId.trim(), '')
  assert.equal(item.sourceInboxItemId, undefined)
  assert.equal(item.actorId, undefined)
})

test('buildInboxItem carries scope and replyTo through untouched', () => {
  const item = buildInboxItem(input())
  assert.deepEqual(item.scope, { projectId: 'project-1', taskId: 'task-1', commentId: 'comment-1' })
  assert.deepEqual(item.replyTo, { kind: 'task_comment', taskId: 'task-1', parentCommentId: 'comment-1' })
  assert.equal(item.dedupeKey, 'comment-mention:comment-1:user-1')
})

test('isSelfDelivery only fires when the actor is the recipient itself', () => {
  assert.equal(isSelfDelivery({
    recipientType: 'agent',
    recipientId: 'agent-1',
    actor: { type: 'agent', id: 'agent-1' },
  }), true)
  assert.equal(isSelfDelivery({
    recipientType: 'agent',
    recipientId: 'agent-1',
    actor: { type: 'agent', id: 'agent-2' },
  }), false)
  // Same id across different recipient kinds is a different mailbox.
  assert.equal(isSelfDelivery({
    recipientType: 'user',
    recipientId: 'shared-id',
    actor: { type: 'agent', id: 'shared-id' },
  }), false)
})

test('Admin feedback escalations stay out of the product Inbox channel', () => {
  assert.ok(SUPPORT_CHANNEL_EVENT_TYPES.includes('support.escalation.admin'))
})
