import assert from 'node:assert/strict'
import test from 'node:test'

import type { Task } from '@shared/types'
import { buildTaskAssignmentInboxItem } from './task-assignment-inbox'

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: '更新 readme',
  description: '更新安装步骤',
  updatedAt: '2026-07-27T12:00:00.000Z',
} as Task

const actor = { type: 'user' as const, id: 'user-1', name: 'Alice' }

test('指派给人是 directive：必须计入 badge，不能是 observe', () => {
  const item = buildTaskAssignmentInboxItem({ task, assigneeUserId: 'user-2', actor })
  assert.equal(item.kind, 'directive')
  assert.equal(item.reason, 'assigned')
  assert.equal(item.recipientType, 'user')
  assert.equal(item.recipientId, 'user-2')
})

test('与任务评论同组：指派和后续讨论在收件箱里是同一条线', () => {
  const item = buildTaskAssignmentInboxItem({ task, assigneeUserId: 'user-2', actor })
  assert.equal(item.groupKey, 'task:task-1')
  assert.deepEqual(item.scope, { projectId: 'project-1', taskId: 'task-1' })
})

test('可以直接在收件箱回信到任务评论', () => {
  const item = buildTaskAssignmentInboxItem({ task, assigneeUserId: 'user-2', actor })
  assert.deepEqual(item.replyTo, { kind: 'task_comment', taskId: 'task-1' })
})

test('dedupeKey 带 updatedAt：重复指派同一人只投一次，换人再换回来会重新投', () => {
  const first = buildTaskAssignmentInboxItem({ task, assigneeUserId: 'user-2', actor })
  const same = buildTaskAssignmentInboxItem({ task, assigneeUserId: 'user-2', actor })
  assert.equal(first.dedupeKey, same.dedupeKey)

  const otherUser = buildTaskAssignmentInboxItem({ task, assigneeUserId: 'user-3', actor })
  assert.notEqual(first.dedupeKey, otherUser.dedupeKey)

  const reassigned = buildTaskAssignmentInboxItem({
    task: { ...task, updatedAt: '2026-07-27T13:00:00.000Z' },
    assigneeUserId: 'user-2',
    actor,
  })
  assert.notEqual(first.dedupeKey, reassigned.dedupeKey)
})

test('Agent 指派给它的所有者也要投递：actor 是 Agent，不是被指派的人', () => {
  const item = buildTaskAssignmentInboxItem({
    task,
    assigneeUserId: 'user-1',
    actor: { type: 'agent', id: 'agent-1', name: 'CEO' },
  })
  assert.equal(item.actor.type, 'agent')
  assert.equal(item.actor.id, 'agent-1')
  assert.equal(item.recipientId, 'user-1')
  assert.equal(item.kind, 'directive')
})

test('没有描述时用兜底正文，不投空白 item', () => {
  const item = buildTaskAssignmentInboxItem({
    task: { ...task, description: '   ' } as Task,
    assigneeUserId: 'user-2',
    actor,
  })
  assert.equal(item.body, '任务已指派给你。')
})
