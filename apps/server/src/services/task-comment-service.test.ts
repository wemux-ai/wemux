import assert from 'node:assert/strict'
import test from 'node:test'
import { writeCustomAgentConfig } from '@shared/custom-agent'
import type { AgentRecord, Task, TaskComment } from '@shared/types'
import {
  appendTaskComment,
  appendTaskDeliveryComment,
  buildAgentEventCommentIdempotencyKey,
  buildTaskDeliveryCommentIdempotencyKey,
  deleteTaskComment,
  editTaskComment,
  expandTaskCommentSpecialMentions,
  normalizeLegacyTaskCommentAuthors,
  resolveTaskCommentAgentRoute,
  setTaskCommentReaction,
  setTaskCommentResolution,
} from './task-comment-service'
import { buildTaskCommentInboxItem } from './task-comment-inbox'
import { encodeInboxEvent } from './inbox-stream'
import { isSelfDelivery } from './inbox-service'

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: 'Task',
  assigneeAgentId: 'agent-owner',
  comments: [{
    id: 'agent-comment',
    authorType: 'agent',
    authorId: 'agent-replier',
    content: '请确认结果。',
    createdAt: '2026-07-21T00:00:00.000Z',
  }],
} as Task

const comment = (overrides: Partial<TaskComment>): TaskComment => ({
  id: 'comment-1',
  content: '继续处理',
  createdAt: '2026-07-21T00:01:00.000Z',
  ...overrides,
})

test('explicit Agent mentions are the only Agent comment route', () => {
  assert.deepEqual(resolveTaskCommentAgentRoute(task, comment({
    mentions: [{ targetType: 'agent', targetId: 'agent-mentioned', targetName: 'Mentioned' }],
  })), {
    ids: ['agent-mentioned'],
    triggerKind: 'mention',
  })
})

test('human-only mentions notify people without starting an Agent', () => {
  assert.deepEqual(resolveTaskCommentAgentRoute(task, comment({
    mentions: [{ targetType: 'user', targetId: 'user-1', targetName: 'User' }],
  })), {
    ids: [],
    triggerKind: 'human_mention',
  })
})

// Removing the generic self-delivery interception put the guard on each producer.
// The subscriber fan-out is the one that silently regressed, so pin it here.
test('a commenter who also follows the task does not get an observe item for their own comment', () => {
  const author = { type: 'user' as const, id: 'user-1', name: 'Author' }
  assert.equal(isSelfDelivery({ recipientType: 'user', recipientId: 'user-1', actor: author }), true)
  assert.equal(isSelfDelivery({ recipientType: 'user', recipientId: 'user-2', actor: author }), false)
})

test('@all and Agent groups expand into atomic user and Agent targets', () => {
  assert.deepEqual(expandTaskCommentSpecialMentions([
    { targetType: 'all', targetId: 'project-members' },
    { targetType: 'agent_group', targetId: 'squad-1' },
  ], ['user-1', 'user-2'], [{ id: 'squad-1', memberIds: ['agent-1', 'agent-2'] }]), [
    { targetType: 'user', targetId: 'user-1' },
    { targetType: 'user', targetId: 'user-2' },
    { targetType: 'agent', targetId: 'agent-1' },
    { targetType: 'agent', targetId: 'agent-2' },
  ])
})

test('reply metadata alone does not start the parent Agent or task assignee', () => {
  assert.deepEqual(resolveTaskCommentAgentRoute(task, comment({ parentCommentId: 'agent-comment' })), {
    ids: [],
    triggerKind: 'none',
  })
})

test('plain task comments do not start the task assignee', () => {
  assert.deepEqual(resolveTaskCommentAgentRoute(task, comment({})), {
    ids: [],
    triggerKind: 'none',
  })
})

test('comment idempotency keeps a retried request from appending twice', () => {
  const first = appendTaskComment(task, { type: 'user', id: 'user-1' }, 'hello', { idempotencyKey: 'request-1' })
  const second = appendTaskComment(first, { type: 'user', id: 'user-1' }, 'hello', { idempotencyKey: 'request-1' })

  assert.equal(first.comments.length, task.comments.length + 1)
  assert.equal(second.comments.length, first.comments.length)
})

test('equivalent Agent event comment is promoted into one threaded delivery comment', () => {
  const source = appendTaskComment(
    task,
    { type: 'agent', id: 'agent-owner', name: 'Owner Agent' },
    '结果已完成。\n测试通过。',
    {
      idempotencyKey: buildAgentEventCommentIdempotencyKey('event-1'),
      parentCommentId: 'comment-trigger',
    },
  )
  const result = appendTaskDeliveryComment({
    task: source,
    author: { type: 'agent', id: 'agent-owner', name: 'Owner Agent' },
    content: '结果已完成。  测试通过。',
    eventId: 'event-1',
    parentCommentId: 'comment-trigger',
  })

  assert.equal(result.created, false)
  assert.equal(result.promoted, true)
  assert.equal(result.task.comments.length, source.comments.length)
  assert.equal(result.comment?.parentCommentId, 'comment-trigger')
  assert.equal(result.comment?.idempotencyKey, buildTaskDeliveryCommentIdempotencyKey('event-1'))
})

test('different progress and delivery content remain separate comments in the same thread', () => {
  const source = appendTaskComment(
    task,
    { type: 'agent', id: 'agent-owner', name: 'Owner Agent' },
    '正在等待测试结果。',
    {
      idempotencyKey: buildAgentEventCommentIdempotencyKey('event-2'),
      parentCommentId: 'comment-trigger',
    },
  )
  const result = appendTaskDeliveryComment({
    task: source,
    author: { type: 'agent', id: 'agent-owner', name: 'Owner Agent' },
    content: '测试完成，可以验收。',
    eventId: 'event-2',
    parentCommentId: 'comment-trigger',
  })

  assert.equal(result.created, true)
  assert.equal(result.promoted, false)
  assert.equal(result.task.comments.length, source.comments.length + 1)
  assert.equal(result.comment?.parentCommentId, 'comment-trigger')
  assert.equal(result.comment?.idempotencyKey, buildTaskDeliveryCommentIdempotencyKey('event-2'))
})

test('human comment authors automatically follow the task while Agent authors do not', () => {
  const humanComment = appendTaskComment({ ...task, subscriberIds: [] }, { type: 'user', id: 'user-1' }, 'hello')
  assert.deepEqual(humanComment.subscriberIds, ['user-1'])

  const agentComment = appendTaskComment({ ...task, subscriberIds: [] }, { type: 'agent', id: 'agent-1' }, 'done')
  assert.deepEqual(agentComment.subscriberIds, [])
})

test('comments persist attachments and allow attachment-only content', () => {
  const attachment = {
    id: 'attachment-1',
    url: '/uploads/attachments/attachment-1.txt',
    filename: 'notes.txt',
    contentType: 'text/plain',
  }
  const nextTask = appendTaskComment(task, { type: 'user', id: 'user-1' }, '', { attachments: [attachment] })
  assert.equal(nextTask.comments.at(-1)?.content, '')
  assert.deepEqual(nextTask.comments.at(-1)?.attachments, [attachment])
})

test('comment authors can edit content and mentions without replacing the comment identity', () => {
  const source = {
    ...task,
    comments: [comment({
      authorType: 'user',
      authorId: 'user-1',
      mentions: [{ targetType: 'agent', targetId: 'agent-1', targetName: 'Agent 1' }],
    })],
  }
  const result = editTaskComment({
    task: source,
    commentId: 'comment-1',
    authorId: 'user-1',
    content: '  更新后的评论  ',
    mentions: [{ targetType: 'user', targetId: 'user-2', targetName: 'User 2' }],
    attachments: [{ id: 'attachment-1', url: '/uploads/attachments/a.txt', filename: 'a.txt', contentType: 'text/plain' }],
  })

  assert.equal(result.error, undefined)
  assert.equal(result.comment?.id, 'comment-1')
  assert.equal(result.comment?.content, '更新后的评论')
  assert.equal(result.comment?.createdAt, source.comments[0]?.createdAt)
  assert.ok(result.comment?.editedAt)
  assert.deepEqual(result.comment?.mentions, [{ targetType: 'user', targetId: 'user-2', targetName: 'User 2' }])
  assert.equal(result.comment?.attachments?.[0]?.filename, 'a.txt')
})

test('comment edits reject non-authors and deleted comments', () => {
  const source = {
    ...task,
    comments: [comment({ authorType: 'user', authorId: 'user-1' })],
  }
  const forbidden = editTaskComment({
    task: source,
    commentId: 'comment-1',
    authorId: 'user-2',
    content: '越权修改',
    mentions: [],
  })
  assert.equal(forbidden.error, 'forbidden')
  assert.equal(forbidden.task, source)

  const deleted = deleteTaskComment({ task: source, commentId: 'comment-1', authorId: 'user-1' })
  const editDeleted = editTaskComment({
    task: deleted.task,
    commentId: 'comment-1',
    authorId: 'user-1',
    content: '恢复内容',
    mentions: [],
  })
  assert.equal(editDeleted.error, 'deleted')
})

test('comment deletion is soft, preserves replies, and is idempotent for its author', () => {
  const source = {
    ...task,
    comments: [
      comment({
        authorType: 'user',
        authorId: 'user-1',
        mentions: [{ targetType: 'agent', targetId: 'agent-1', targetName: 'Agent 1' }],
        attachments: [{ id: 'attachment-1', url: '/uploads/attachments/a.txt', filename: 'a.txt' }],
      }),
      comment({ id: 'reply-1', parentCommentId: 'comment-1', authorType: 'agent', authorId: 'agent-1' }),
    ],
  }
  const first = deleteTaskComment({ task: source, commentId: 'comment-1', authorId: 'user-1' })

  assert.equal(first.error, undefined)
  assert.equal(first.comment?.content, '')
  assert.deepEqual(first.comment?.mentions, [])
  assert.deepEqual(first.comment?.attachments, [])
  assert.ok(first.comment?.deletedAt)
  assert.equal(first.task.comments[1]?.parentCommentId, 'comment-1')

  const second = deleteTaskComment({ task: first.task, commentId: 'comment-1', authorId: 'user-1' })
  assert.equal(second.task, first.task)
  assert.equal(second.comment?.deletedAt, first.comment?.deletedAt)
})

test('comment reactions are user-scoped, idempotent, and removed when the final user leaves', () => {
  const source = {
    ...task,
    comments: [comment({ authorType: 'user', authorId: 'user-1' })],
  }
  const first = setTaskCommentReaction({
    task: source,
    commentId: 'comment-1',
    userId: 'user-1',
    emoji: '👍',
    active: true,
  })
  assert.deepEqual(first.comment?.reactions, [{ emoji: '👍', userIds: ['user-1'] }])

  const duplicate = setTaskCommentReaction({
    task: first.task,
    commentId: 'comment-1',
    userId: 'user-1',
    emoji: '👍',
    active: true,
  })
  assert.equal(duplicate.task, first.task)

  const joined = setTaskCommentReaction({
    task: duplicate.task,
    commentId: 'comment-1',
    userId: 'user-2',
    emoji: '👍',
    active: true,
  })
  assert.deepEqual(joined.comment?.reactions, [{ emoji: '👍', userIds: ['user-1', 'user-2'] }])

  const left = setTaskCommentReaction({
    task: joined.task,
    commentId: 'comment-1',
    userId: 'user-1',
    emoji: '👍',
    active: false,
  })
  const empty = setTaskCommentReaction({
    task: left.task,
    commentId: 'comment-1',
    userId: 'user-2',
    emoji: '👍',
    active: false,
  })
  assert.deepEqual(empty.comment?.reactions, [])
})

test('deleted comments reject new reactions', () => {
  const source = {
    ...task,
    comments: [comment({ authorType: 'user', authorId: 'user-1', deletedAt: '2026-07-22T00:00:00.000Z' })],
  }
  const result = setTaskCommentReaction({
    task: source,
    commentId: 'comment-1',
    userId: 'user-2',
    emoji: '👀',
    active: true,
  })
  assert.equal(result.error, 'deleted')
  assert.equal(result.task, source)
})

test('comment resolution is reversible and resolving a reply updates its root thread', () => {
  const source = {
    ...task,
    comments: [
      comment({ id: 'root-1', authorType: 'user', authorId: 'user-1' }),
      comment({ id: 'reply-1', parentCommentId: 'root-1', authorType: 'user', authorId: 'user-2' }),
    ],
  }
  const resolved = setTaskCommentResolution({
    task: source,
    commentId: 'reply-1',
    userId: 'user-2',
    resolved: true,
  })
  assert.equal(resolved.comment?.id, 'root-1')
  assert.equal(resolved.comment?.resolvedByUserId, 'user-2')
  assert.ok(resolved.comment?.resolvedAt)
  assert.equal(resolved.task.comments[1]?.resolvedAt, undefined)

  const reopened = setTaskCommentResolution({
    task: resolved.task,
    commentId: 'root-1',
    userId: 'user-1',
    resolved: false,
  })
  assert.equal(reopened.comment?.resolvedAt, undefined)
  assert.equal(reopened.comment?.resolvedByUserId, undefined)
})

test('deleted root comments reject resolution changes', () => {
  const source = {
    ...task,
    comments: [comment({ id: 'root-1', deletedAt: '2026-07-22T00:00:00.000Z' })],
  }
  assert.equal(setTaskCommentResolution({
    task: source,
    commentId: 'root-1',
    userId: 'user-1',
    resolved: true,
  }).error, 'deleted')
})

test('comment mention inbox item is user-scoped and suppresses self delivery', () => {
  const taskComment = comment({ authorType: 'user', authorId: 'user-1', authorName: 'Alice' })
  const item = buildTaskCommentInboxItem({
    task,
    comment: taskComment,
    author: { type: 'user', id: 'user-1', name: 'Alice' },
    targetUserId: 'user-2',
    trigger: 'mentioned',
  })

  assert.equal(item.recipientId, 'user-2')
  assert.equal(item.recipientType, 'user')
  assert.equal(item.scope.taskId, 'task-1')
  assert.equal(item.scope.commentId, taskComment.id)
  assert.equal(item.groupKey, 'task:task-1')
  assert.equal(item.dedupeKey, `task-comment:${taskComment.id}`)
  assert.equal(isSelfDelivery(item), false)

  assert.equal(isSelfDelivery(buildTaskCommentInboxItem({
    task,
    comment: taskComment,
    author: { type: 'user', id: 'user-1', name: 'Alice' },
    targetUserId: 'user-1',
    trigger: 'mentioned',
  })), true)
})

test('mention wakes the badge while a pure subscription stays observe-only', () => {
  const taskComment = comment({ authorType: 'user', authorId: 'user-1' })
  const base = { task, comment: taskComment, author: { type: 'user' as const, id: 'user-1' }, targetUserId: 'user-2' }

  const mentioned = buildTaskCommentInboxItem({ ...base, trigger: 'mentioned' })
  assert.equal(mentioned.kind, 'mention')
  assert.equal(mentioned.reason, 'mentioned')

  const subscribed = buildTaskCommentInboxItem({ ...base, trigger: 'subscribed' })
  assert.equal(subscribed.kind, 'observe')
  assert.equal(subscribed.reason, 'subscribed')
})

test('comment inbox item carries a task_comment reply address', () => {
  const item = buildTaskCommentInboxItem({
    task,
    comment: comment({ authorType: 'user', authorId: 'user-1', parentCommentId: 'root-1' }),
    author: { type: 'user', id: 'user-1' },
    targetUserId: 'user-2',
    trigger: 'replied',
  })
  assert.deepEqual(item.replyTo, { kind: 'task_comment', taskId: 'task-1', parentCommentId: 'root-1' })
})

test('attachment-only comment inbox items include a useful file summary', () => {
  const item = buildTaskCommentInboxItem({
    task,
    comment: comment({
      authorType: 'user',
      authorId: 'user-1',
      content: '',
      attachments: [{ id: 'attachment-1', url: '/uploads/attachments/spec.pdf', filename: 'spec.pdf' }],
    }),
    author: { type: 'user', id: 'user-1', name: 'Alice' },
    targetUserId: 'user-2',
    trigger: 'mentioned',
  })
  assert.equal(item.body, '[附件] spec.pdf')
})

test('inbox SSE emits a named invalidation event', () => {
  const event = new TextDecoder().decode(encodeInboxEvent('notification', { at: 'now' }))
  assert.equal(event, 'event: notification\ndata: {"at":"now"}\n\n')
})

test('legacy Agent entry comments use the task assignee or project owners first Agent without name guessing', () => {
  const legacyTask = {
    ...task,
    assigneeAgentId: undefined,
    comments: [comment({
      authorType: 'agent',
      authorId: 'legacy-main',
      authorName: 'Agent 入口',
    })],
  }
  const ownersFirstAgent = {
    id: 'owners-first-agent',
    name: 'My Renamed Agent',
    type: 'custom',
    status: 'offline',
    endpoint: null,
    ownerUserId: 'owner-1',
    config: writeCustomAgentConfig({}, { avatarUrl: 'https://example.com/owner.png' }),
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    lastHeartbeatAt: null,
    workDir: '',
    workDirStatus: 'missing',
  } satisfies AgentRecord
  const otherUsersAgent = {
    id: 'other-agent',
    name: 'CEO Agent',
    type: 'custom',
    status: 'offline',
    endpoint: null,
    ownerUserId: 'owner-2',
    config: {},
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    lastHeartbeatAt: null,
    workDir: '',
    workDirStatus: 'missing',
  } satisfies AgentRecord

  const normalized = normalizeLegacyTaskCommentAuthors({
    task: legacyTask,
    agents: [otherUsersAgent, ownersFirstAgent],
    projectOwnerUserId: 'owner-1',
  })

  assert.deepEqual(normalized.comments[0], {
    ...legacyTask.comments[0],
    authorType: 'agent',
    authorId: 'owners-first-agent',
    authorName: 'My Renamed Agent',
    authorAvatarUrl: 'https://example.com/owner.png',
  })
})
