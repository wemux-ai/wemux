import assert from 'node:assert/strict'
import test from 'node:test'

import { appendTaskAssignmentHistory } from './task-history'
import type { Task } from './types'

test('appendTaskAssignmentHistory stores structured actor and assignee snapshots', () => {
  const task = { history: [] } as unknown as Task
  const nextTask = appendTaskAssignmentHistory(task, {
    actor: { type: 'user', id: 'user-1', name: 'Alice' },
    assignee: { type: 'agent', id: 'agent-1', name: 'Builder' },
    at: '2026-07-23T10:00:00.000Z',
  })

  assert.deepEqual(nextTask.history[0], {
    id: nextTask.history[0]?.id,
    label: '指派给 Builder',
    at: '2026-07-23T10:00:00.000Z',
    kind: 'assignment',
    actor: { type: 'user', id: 'user-1', name: 'Alice' },
    assignee: { type: 'agent', id: 'agent-1', name: 'Builder' },
  })
})

test('appendTaskAssignmentHistory records clearing the assignee without inventing a target', () => {
  const task = { history: [] } as unknown as Task
  const nextTask = appendTaskAssignmentHistory(task, {
    actor: { type: 'user', id: 'user-1', name: 'Alice' },
    at: '2026-07-23T10:05:00.000Z',
  })

  assert.equal(nextTask.history[0]?.kind, 'assignment')
  assert.equal(nextTask.history[0]?.label, '已清除负责人')
  assert.equal(nextTask.history[0]?.assignee, undefined)
})
