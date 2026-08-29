import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskAgentActivityRecord } from '../../lib/api'
import { formatAgentActivityElapsed, parseTaskAgentActivityStreamEvent, resolveAgentActivityRetryDefault, splitTaskAgentActivities } from './task-agent-execution-log'

const activity = (id: string, status: TaskAgentActivityRecord['status'], createdAt: string): TaskAgentActivityRecord => ({
  id,
  agentId: 'agent-1',
  agentName: 'Agent',
  eventType: 'task.comment.created',
  triggerKind: 'assignee',
  triggerActorType: 'user',
  triggerActorId: 'user-1',
  triggerActorName: 'Alice',
  actingUserId: 'user-1',
  actingUserName: 'Alice',
  includedCommentIds: [],
  coalescedCommentCount: 0,
  attempt: 1,
  retrySource: 'initial',
  status,
  result: null,
  startedAt: null,
  completedAt: null,
  createdAt,
})

test('puts active runs first by execution state and keeps past runs newest first', () => {
  const split = splitTaskAgentActivities([
    activity('completed-old', 'completed', '2026-07-20T00:00:00.000Z'),
    activity('pending', 'pending', '2026-07-21T00:01:00.000Z'),
    activity('running', 'running', '2026-07-21T00:00:00.000Z'),
    activity('failed-new', 'failed', '2026-07-21T00:02:00.000Z'),
  ])

  assert.deepEqual(split.active.map((item) => item.id), ['running', 'pending'])
  assert.deepEqual(split.past.map((item) => item.id), ['failed-new', 'completed-old'])
})

test('formats a running duration as a stable elapsed clock', () => {
  assert.equal(formatAgentActivityElapsed('2026-07-21T00:00:00.000Z', Date.parse('2026-07-21T01:02:03.000Z')), '1:02:03')
})

test('uses the server retry recommendation and otherwise resumes the prior session', () => {
  assert.equal(resolveAgentActivityRetryDefault({}), 'resume')
  assert.equal(resolveAgentActivityRetryDefault({ recommendedRetrySessionMode: 'fresh' }), 'fresh')
})

test('parses transcript invalidations from the task Agent SSE stream', () => {
  assert.deepEqual(parseTaskAgentActivityStreamEvent('event: transcript\ndata: {"taskId":"task-1","eventId":"event-1","updatedAt":"now"}'), {
    event: 'transcript',
    data: { taskId: 'task-1', eventId: 'event-1', updatedAt: 'now' },
  })
  assert.equal(parseTaskAgentActivityStreamEvent('event: transcript\ndata: not-json'), null)
})
