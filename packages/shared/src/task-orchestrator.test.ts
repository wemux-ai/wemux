import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveExecutionCenter } from './task-orchestrator'

test('deriveExecutionCenter is stable when no review timestamp exists', () => {
  const first = deriveExecutionCenter([])
  const second = deriveExecutionCenter([])

  assert.deepEqual(first, second)
  assert.equal(first.lastReviewAt, '')
})
