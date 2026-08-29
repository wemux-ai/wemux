import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canAcceptWorkerTaskResult,
  createTaskSyncSerializer,
  isNewerWorkerTaskEvent,
  persistBeforeBroadcast,
} from './task-sync'

test('worker task events accept legacy messages without a sequence', () => {
  assert.equal(isNewerWorkerTaskEvent({ workerEventSequence: 8 }), true)
})

test('worker task events only advance with a larger sequence', () => {
  assert.equal(isNewerWorkerTaskEvent({ workerEventSequence: 8 }, 9), true)
  assert.equal(isNewerWorkerTaskEvent({ workerEventSequence: 8 }, 8), false)
  assert.equal(isNewerWorkerTaskEvent({ workerEventSequence: 8 }, 7), false)
})

test('worker task events tolerate a fresh run and reject invalid sequence values', () => {
  assert.equal(isNewerWorkerTaskEvent({}, 1), true)
  assert.equal(isNewerWorkerTaskEvent({}, 0), false)
  assert.equal(isNewerWorkerTaskEvent({}, -1), false)
  assert.equal(isNewerWorkerTaskEvent({}, 1.5), false)
  assert.equal(isNewerWorkerTaskEvent({}, Number.NaN), false)
  assert.equal(isNewerWorkerTaskEvent({}, Number.POSITIVE_INFINITY), false)
  assert.equal(isNewerWorkerTaskEvent({}, '2' as unknown as number), false)
})

test('lost worker tasks only accept a newer sequenced result', () => {
  assert.equal(canAcceptWorkerTaskResult({ status: 'lost', workerEventSequence: 4 }, 5), true)
  assert.equal(canAcceptWorkerTaskResult({ status: 'lost', workerEventSequence: 4 }, 4), false)
  assert.equal(canAcceptWorkerTaskResult({ status: 'lost', workerEventSequence: 4 }), false)
  assert.equal(canAcceptWorkerTaskResult({ status: 'completed', workerEventSequence: 4 }, 5), false)
})

test('distributed task persistence completes before state is broadcast', async () => {
  const steps: string[] = []
  let resolvePersistence = () => {}
  const persistence = new Promise<void>((resolve) => {
    resolvePersistence = resolve
  })
  const result = persistBeforeBroadcast([() => persistence], () => steps.push('broadcast'))

  await Promise.resolve()
  assert.deepEqual(steps, [])
  resolvePersistence()
  await result
  assert.deepEqual(steps, ['broadcast'])
})

test('distributed task persistence failure prevents state broadcast', async () => {
  let broadcastCount = 0
  await assert.rejects(
    persistBeforeBroadcast([() => Promise.reject(new Error('database unavailable'))], () => {
      broadcastCount += 1
    }),
    /database unavailable/,
  )
  assert.equal(broadcastCount, 0)
})

test('distributed task events and results are serialized per task', async () => {
  const serialize = createTaskSyncSerializer()
  const steps: string[] = []
  let releaseFirst = () => {}
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const first = serialize('task-1', async () => {
    steps.push('event:start')
    await firstGate
    steps.push('event:end')
  })
  const second = serialize('task-1', async () => {
    steps.push('result:start')
  })

  await Promise.resolve()
  assert.deepEqual(steps, ['event:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(steps, ['event:start', 'event:end', 'result:start'])
})
