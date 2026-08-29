import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGroupChatInboxGroupKey,
  buildTaskInboxGroupKey,
  countUnreadInboxGroups,
  countsTowardInboxBadge,
  INBOX_QUERY_SCOPES,
  isInboxWakingKind,
  resolveInboxSection,
  type InboxItem,
} from './inbox'

const NOW = '2026-07-27T00:00:00.000Z'

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 'item-1',
  recipientType: 'user',
  recipientId: 'user-1',
  kind: 'mention',
  reason: 'mentioned',
  eventType: 'task.comment.mentioned',
  actorType: 'agent',
  actorId: 'agent-1',
  actorName: 'CEO Agent',
  title: '更新 README',
  body: '请确认结果。',
  scope: { taskId: 'task-1' },
  groupKey: 'task:task-1',
  replyTo: { kind: 'task_comment', taskId: 'task-1' },
  traceId: 'trace-1',
  chainStartedAt: '2026-07-26T00:00:00.000Z',
  hopCount: 0,
  dedupeKey: 'task-comment:comment-1',
  createdAt: '2026-07-26T00:00:00.000Z',
  ...overrides,
})

test('all 只是读取范围，不是 item 的归属', () => {
  // 每条 item 永远落在唯一一个真实 section 上，所以「全部」视图能逐行标出归属。
  const sections = [
    resolveInboxSection(item(), NOW),
    resolveInboxSection(item({ kind: 'observe' }), NOW),
    resolveInboxSection(item({ snoozedUntil: '2026-07-28T00:00:00.000Z' }), NOW),
    resolveInboxSection(item({ archivedAt: '2026-07-26T12:00:00.000Z' }), NOW),
  ]
  assert.deepEqual(sections, ['action', 'following', 'snoozed', 'archived'])
  assert.equal(sections.includes('all' as never), false)
  assert.equal(INBOX_QUERY_SCOPES.includes('all'), true)
  // 读取范围是 section 的超集。
  for (const section of sections) assert.equal(INBOX_QUERY_SCOPES.includes(section), true)
})

test('唤醒型只有 directive / mention / handoff', () => {
  assert.equal(isInboxWakingKind('directive'), true)
  assert.equal(isInboxWakingKind('mention'), true)
  assert.equal(isInboxWakingKind('handoff'), true)
  assert.equal(isInboxWakingKind('observe'), false)
})

test('未读的待处理项计入 badge', () => {
  assert.equal(countsTowardInboxBadge(item(), NOW), true)
})

test('observe 不计入 badge：badge 只表示有事等你处理', () => {
  assert.equal(countsTowardInboxBadge(item({ kind: 'observe', reason: 'subscribed' }), NOW), false)
})

test('已读与已归档都不计入 badge', () => {
  assert.equal(countsTowardInboxBadge(item({ readAt: NOW }), NOW), false)
  assert.equal(countsTowardInboxBadge(item({ archivedAt: NOW }), NOW), false)
})

test('snooze 未到期不计入，到期后重新计入', () => {
  assert.equal(countsTowardInboxBadge(item({ snoozedUntil: '2026-07-27T01:00:00.000Z' }), NOW), false)
  assert.equal(countsTowardInboxBadge(item({ snoozedUntil: '2026-07-26T23:00:00.000Z' }), NOW), true)
})

test('badge 按 group 计数，同一任务的多条只算一次', () => {
  const items = [
    item({ id: 'a', groupKey: 'task:task-1' }),
    item({ id: 'b', groupKey: 'task:task-1' }),
    item({ id: 'c', groupKey: 'task:task-1' }),
    item({ id: 'd', groupKey: 'task:task-2' }),
  ]
  assert.equal(countUnreadInboxGroups(items, NOW), 2)
})

test('observe 项不会把 group 顶进 badge 计数', () => {
  const items = [
    item({ id: 'a', groupKey: 'task:task-1', kind: 'observe', reason: 'subscribed' }),
    item({ id: 'b', groupKey: 'task:task-2' }),
  ]
  assert.equal(countUnreadInboxGroups(items, NOW), 1)
})

test('section prioritizes archived and snoozed before kind', () => {
  assert.equal(resolveInboxSection(item(), NOW), 'action')
  assert.equal(resolveInboxSection(item({ kind: 'observe', reason: 'subscribed' }), NOW), 'following')
  assert.equal(resolveInboxSection(item({ snoozedUntil: '2026-07-27T01:00:00.000Z' }), NOW), 'snoozed')
  assert.equal(resolveInboxSection(item({ archivedAt: NOW, snoozedUntil: '2026-07-27T01:00:00.000Z' }), NOW), 'archived')
})

test('group key 构造稳定', () => {
  assert.equal(buildTaskInboxGroupKey('task-1'), 'task:task-1')
  assert.equal(buildGroupChatInboxGroupKey('group-1'), 'group:group-1')
})
