import assert from 'node:assert/strict'
import test from 'node:test'

import type { TaskAgentActivityRecord } from '../../lib/api'

import {
  getTaskCommentActiveAgentActivities,
  getTaskCommentLinkedAgentActivity,
} from './task-comment-agent-activity'

const activity = (
  id: string,
  status: TaskAgentActivityRecord['status'],
  overrides: Partial<TaskAgentActivityRecord> = {},
): TaskAgentActivityRecord => ({
  id,
  agentId: `agent-${id}`,
  agentName: `Agent ${id}`,
  eventType: 'task.comment.mentioned',
  triggerKind: 'mention',
  triggerActorType: 'user',
  includedCommentIds: [],
  coalescedCommentCount: 0,
  attempt: 1,
  retrySource: 'initial',
  status,
  result: null,
  startedAt: null,
  completedAt: null,
  createdAt: `2026-07-24T00:00:0${id.length}.000Z`,
  ...overrides,
})

test('comment Agent status includes direct and coalesced active activities', () => {
  const result = getTaskCommentActiveAgentActivities([
    activity('pending', 'pending', { commentId: 'comment-1' }),
    activity('waiting', 'waiting', { includedCommentIds: ['comment-1'] }),
    activity('running', 'running', { commentId: 'comment-1' }),
    activity('completed', 'completed', { commentId: 'comment-1' }),
    activity('other', 'running', { commentId: 'comment-2' }),
  ], 'comment-1')

  assert.deepEqual(result.map((item) => item.id), ['running', 'waiting', 'pending'])
})

test('Agent comments resolve the exact run from their event idempotency key', () => {
  const activities = [
    activity('event-progress', 'running'),
    activity('event-delivery', 'completed'),
  ]

  assert.equal(
    getTaskCommentLinkedAgentActivity(
      activities,
      'task-agent-event-comment:event-progress',
    )?.id,
    'event-progress',
  )
  assert.equal(
    getTaskCommentLinkedAgentActivity(
      activities,
      'task-delivery:event-delivery',
    )?.id,
    'event-delivery',
  )
  assert.equal(getTaskCommentLinkedAgentActivity(activities, 'manual-comment'), undefined)
})
