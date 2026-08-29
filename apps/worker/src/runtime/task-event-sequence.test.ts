import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkerTaskEventSequence } from './task-event-sequence'

test('worker task event sequence resumes after the server-accepted sequence', () => {
  const nextSequence = createWorkerTaskEventSequence(8)

  assert.equal(nextSequence(), 9)
  assert.equal(nextSequence(), 10)
})
