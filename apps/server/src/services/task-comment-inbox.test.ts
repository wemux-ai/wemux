import assert from 'node:assert/strict'
import test from 'node:test'

import type { Task, TaskComment } from '@shared/types'
import { buildTaskCommentInboxItem } from './task-comment-inbox'

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: '更新 readme',
} as Task

const comment: TaskComment = {
  id: 'c1',
  authorType: 'user',
  authorId: 'user-1',
  content: '看一下安装步骤',
  createdAt: '2026-07-27T12:00:00.000Z',
}

const author = { type: 'user' as const, id: 'user-1', name: 'Alice' }

test('被 @ 是 mention：计入 badge', () => {
  const item = buildTaskCommentInboxItem({
    task,
    comment,
    author,
    targetUserId: 'user-2',
    trigger: 'mentioned',
  })
  assert.equal(item.kind, 'mention')
  assert.equal(item.reason, 'mentioned')
  assert.equal(item.recipientId, 'user-2')
})

test('关注者收到的是 observe：进收件箱但不点亮 badge', () => {
  const item = buildTaskCommentInboxItem({
    task,
    comment,
    author,
    targetUserId: 'user-3',
    trigger: 'subscribed',
  })
  assert.equal(item.kind, 'observe')
  assert.equal(item.reason, 'subscribed')
})

test('与任务指派同组：讨论和指派在收件箱里是同一条线', () => {
  const item = buildTaskCommentInboxItem({
    task,
    comment,
    author,
    targetUserId: 'user-2',
    trigger: 'mentioned',
  })
  assert.equal(item.groupKey, 'task:task-1')
  assert.deepEqual(item.scope, { projectId: 'project-1', taskId: 'task-1', commentId: 'c1' })
})

test('回信地址指向父评论，顶层评论则指向自己', () => {
  const topLevel = buildTaskCommentInboxItem({
    task,
    comment,
    author,
    targetUserId: 'user-2',
    trigger: 'mentioned',
  })
  assert.deepEqual(topLevel.replyTo, { kind: 'task_comment', taskId: 'task-1', parentCommentId: 'c1' })

  const reply = buildTaskCommentInboxItem({
    task,
    comment: { ...comment, id: 'c2', parentCommentId: 'c1' },
    author,
    targetUserId: 'user-2',
    trigger: 'mentioned',
  })
  assert.deepEqual(reply.replyTo, { kind: 'task_comment', taskId: 'task-1', parentCommentId: 'c1' })
})

test('dedupeKey 按评论去重：同一条评论对同一人只投一次', () => {
  const first = buildTaskCommentInboxItem({
    task, comment, author, targetUserId: 'user-2', trigger: 'mentioned',
  })
  const again = buildTaskCommentInboxItem({
    task, comment, author, targetUserId: 'user-2', trigger: 'subscribed',
  })
  // 同一条评论的 dedupeKey 与 trigger 无关：优先级最高的那次投递胜出。
  assert.equal(first.dedupeKey, again.dedupeKey)
})
