import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldRunIdleWorkerAutoUpdate } from './daemon-auto-update'

test('shouldRunIdleWorkerAutoUpdate requires a paired worker', () => {
  assert.equal(
    shouldRunIdleWorkerAutoUpdate({
      connected: false,
      paired: false,
      queuedTaskCount: 0,
      runningTaskCount: 0,
    }),
    false,
  )
})

test('shouldRunIdleWorkerAutoUpdate allows disconnected paired idle workers', () => {
  assert.equal(
    shouldRunIdleWorkerAutoUpdate({
      connected: false,
      paired: true,
      queuedTaskCount: 0,
      runningTaskCount: 0,
    }),
    true,
  )
})

test('shouldRunIdleWorkerAutoUpdate requires no running work', () => {
  assert.equal(
    shouldRunIdleWorkerAutoUpdate({
      connected: true,
      paired: true,
      queuedTaskCount: 1,
      runningTaskCount: 0,
    }),
    false,
  )
  assert.equal(
    shouldRunIdleWorkerAutoUpdate({
      connected: true,
      paired: true,
      queuedTaskCount: 0,
      runningTaskCount: 1,
    }),
    false,
  )
})

test('shouldRunIdleWorkerAutoUpdate allows connected idle workers', () => {
  assert.equal(
    shouldRunIdleWorkerAutoUpdate({
      connected: true,
      paired: true,
      queuedTaskCount: 0,
      runningTaskCount: 0,
    }),
    true,
  )
})
