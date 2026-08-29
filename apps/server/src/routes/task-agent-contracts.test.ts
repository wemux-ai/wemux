import assert from 'node:assert/strict'
import test from 'node:test'
import { taskAgentActivityRetrySchema, taskAssignedAgentStartSchema, taskAssigneeSchema, taskCommentEditSchema, taskCommentReactionSchema, taskCommentResolutionSchema, taskCommentSchema, taskSchema, taskSubscriberSchema } from './shared'

test('task assignment and comment schemas preserve Agent dispatch intent', () => {
  const task = taskSchema.parse({
    projectId: 'project-1',
    description: 'Implement mention routing',
    status: 'backlog',
    assigneeAgentId: 'agent-1',
    assignmentStartMode: 'parked',
    handoffPrompt: 'Only inspect the comment path.',
    idempotencyKey: 'create-1',
  })
  assert.equal(task.status, 'backlog')
  assert.equal(task.assignmentStartMode, 'parked')

  const assignment = taskAssigneeSchema.parse({
    assigneeAgentId: 'agent-1',
    startMode: 'now',
    handoffPrompt: 'Keep the change scoped.',
    idempotencyKey: 'assign-1',
  })
  assert.equal(assignment.startMode, 'now')

  const squadAssignment = taskAssigneeSchema.parse({
    assigneeAgentGroupId: 'squad-1',
    startMode: 'now',
  })
  assert.equal(squadAssignment.assigneeAgentGroupId, 'squad-1')
  assert.equal(taskAssigneeSchema.safeParse({
    assigneeAgentId: 'agent-1',
    assigneeAgentGroupId: 'squad-1',
  }).success, false)

  const comment = taskCommentSchema.parse({
    content: '@Agent please handle this',
    parentCommentId: 'comment-1',
    mentions: [{ targetType: 'agent', targetId: 'agent-1' }],
    attachments: [{ id: 'attachment-1', url: '/uploads/attachments/a.txt', filename: 'a.txt', contentType: 'text/plain' }],
    idempotencyKey: 'comment-request-1',
  })
  assert.equal(comment.mentions[0]?.targetId, 'agent-1')
  assert.equal(comment.attachments[0]?.filename, 'a.txt')
  assert.equal(taskCommentSchema.safeParse({ content: '', attachments: [] }).success, false)
  assert.equal(taskCommentSchema.safeParse({
    content: '',
    attachments: [{ id: 'attachment-1', url: '/uploads/attachments/a.txt', filename: 'a.txt' }],
  }).success, true)

  const editedComment = taskCommentEditSchema.parse({
    content: '@Agent updated request',
    mentions: [{ targetType: 'agent', targetId: 'agent-1' }],
  })
  assert.equal(editedComment.content, '@Agent updated request')
  assert.equal(taskCommentEditSchema.safeParse({ content: '   ', attachments: [] }).success, false)
  assert.deepEqual(taskCommentReactionSchema.parse({ emoji: '👍', active: true }), { emoji: '👍', active: true })
  assert.equal(taskCommentReactionSchema.safeParse({ emoji: '🔥', active: true }).success, false)
  assert.deepEqual(taskCommentResolutionSchema.parse({ resolved: true }), { resolved: true })
  assert.equal(taskCommentResolutionSchema.safeParse({ resolved: 'yes' }).success, false)
  assert.deepEqual(taskSubscriberSchema.parse({ userId: 'user-1', subscribed: true }), { userId: 'user-1', subscribed: true })

  assert.equal(taskAgentActivityRetrySchema.parse({}).sessionMode, 'resume')
  assert.equal(taskAgentActivityRetrySchema.parse({ sessionMode: 'fresh' }).sessionMode, 'fresh')
  assert.equal(taskAgentActivityRetrySchema.safeParse({ sessionMode: 'unknown' }).success, false)

  assert.deepEqual(taskAssignedAgentStartSchema.parse({
    handoffPrompt: 'Start from the latest acceptance criteria.',
    idempotencyKey: 'start-1',
  }), {
    handoffPrompt: 'Start from the latest acceptance criteria.',
    idempotencyKey: 'start-1',
  })
  assert.equal(taskAssignedAgentStartSchema.safeParse({ handoffPrompt: 'x'.repeat(4001) }).success, false)
})
