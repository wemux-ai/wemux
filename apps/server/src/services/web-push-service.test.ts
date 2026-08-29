import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInboxPushDelivery } from './web-push-service'
import type { InboxItem } from '@shared/inbox'

const createInboxItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'inbox-1',
  recipientType: 'user',
  recipientId: 'user-1',
  kind: 'mention',
  reason: 'mentioned',
  eventType: 'task.comment.mentioned',
  actorType: 'user',
  actorId: 'user-2',
  actorName: 'Alice',
  title: '任务标题',
  body: '请看一下这个方案',
  scope: {},
  groupKey: 'task:task-1',
  replyTo: { kind: 'task_comment', taskId: 'task-1' },
  traceId: 'trace-1',
  chainStartedAt: '2026-08-13T00:00:00.000Z',
  hopCount: 0,
  dedupeKey: 'task-comment:c1',
  createdAt: '2026-08-13T00:00:00.000Z',
  ...overrides,
})

test('buildInboxPushDelivery maps waking inbox items to inboxMention push', () => {
  const delivery = buildInboxPushDelivery(createInboxItem({ scope: { taskId: 'task-1' } }))

  assert.ok(delivery)
  assert.equal(delivery.notificationType, 'inboxMention')
  assert.equal(delivery.payload.title, '收件箱：任务标题')
  assert.match(delivery.payload.body ?? '', /Alice/)
})

test('buildInboxPushDelivery maps terminal task items to taskCompletion push', () => {
  const delivery = buildInboxPushDelivery(createInboxItem({
    kind: 'handoff',
    reason: 'workspace_completed',
    eventType: 'workspace.session.completed',
    scope: { taskId: 'task-1', workspaceSessionId: 'session-9' },
    title: 'Ship realtime notifications',
  }))

  assert.ok(delivery)
  assert.equal(delivery.notificationType, 'taskCompletion')
  assert.equal(delivery.payload.title, '任务已完成')
  assert.equal(delivery.payload.tag, 'task-complete:task-1')
})

test('buildInboxPushDelivery ignores non-waking and non-terminal items', () => {
  assert.equal(buildInboxPushDelivery(createInboxItem({ kind: 'observe', reason: 'subscribed' })), null)
})
