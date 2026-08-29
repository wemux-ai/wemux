import assert from 'node:assert/strict'
import test from 'node:test'
import type { Task } from '@shared/types'
import { setTaskSubscriber } from './task-subscriber-service'

const task = {
  id: 'task-1',
  projectId: 'project-1',
  subscriberIds: ['user-1'],
  updatedAt: '2026-07-22T00:00:00.000Z',
} as Task

test('task subscriptions add and remove users idempotently', () => {
  const added = setTaskSubscriber({ task, userId: 'user-2', subscribed: true })
  assert.deepEqual(added.subscriberIds, ['user-1', 'user-2'])
  assert.notEqual(added.updatedAt, task.updatedAt)

  const duplicate = setTaskSubscriber({ task: added, userId: 'user-2', subscribed: true })
  assert.equal(duplicate, added)

  const removed = setTaskSubscriber({ task: duplicate, userId: 'user-1', subscribed: false })
  assert.deepEqual(removed.subscriberIds, ['user-2'])

  const absent = setTaskSubscriber({ task: removed, userId: 'user-1', subscribed: false })
  assert.equal(absent, removed)
})

test('task subscription mutation normalizes historical duplicate ids', () => {
  const duplicated = { ...task, subscriberIds: ['user-1', 'user-1'] }
  const added = setTaskSubscriber({ task: duplicated, userId: 'user-2', subscribed: true })
  assert.deepEqual(added.subscriberIds, ['user-1', 'user-2'])
})
