import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { initialServerState } from '../storage/postgres/app-state-seed'
import { broadcastState, createStateStream } from './state-stream'

const readEvent = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const result = await reader.read()
  return new TextDecoder().decode(result.value)
}

test('state stream emits project workspace invalidations even when scoped state is unchanged', async () => {
  const state = structuredClone(initialServerState)
  const reader = createStateStream((snapshot) => snapshot, () => state).getReader()
  await readEvent(reader)

  broadcastState(state, { invalidation: 'project-workspaces' })

  const invalidation = await readEvent(reader)
  assert.match(invalidation, /event: invalidate/)
  assert.match(invalidation, /"scope":"project-workspaces"/)
  await reader.cancel()
})

test('state stream emits the state snapshot before its related resource invalidation', async () => {
  const state = structuredClone(initialServerState)
  const reader = createStateStream((snapshot) => snapshot, () => state).getReader()
  await readEvent(reader)

  const nextState = {
    ...state,
    selectedProjectId: 'project-beta',
  }
  broadcastState(nextState, { invalidation: 'project-workspaces' })

  assert.match(await readEvent(reader), /event: state/)
  assert.match(await readEvent(reader), /event: invalidate/)
  await reader.cancel()
})

test('slow consumers cannot accumulate an unbounded backlog of multi-megabyte states', async (t) => {
  const state = { ...structuredClone(initialServerState), selectedProjectId: 'x'.repeat(2 * 1024 * 1024) }
  let selections = 0
  const reader = createStateStream((snapshot) => { selections += 1; return snapshot }, () => state).getReader()
  t.after(() => reader.cancel().catch(() => undefined))
  const failure = reader.closed.catch((error: Error) => error)
  await readEvent(reader)
  // Hold the reader open without reading: the transport has stopped draining.
  for (let i = 0; i < 5; i += 1) {
    broadcastState({ ...state, selectedTaskId: `task-${i}` })
    await delay(150)
  }
  const error = await Promise.race([failure, delay(500).then(() => undefined)])
  assert.match(error instanceof Error ? error.message : '', /too slow/)
  await assert.rejects(reader.read(), /too slow/)
  const selectedBeforeBroadcast = selections
  broadcastState({ ...state, selectedTaskId: 'after-disconnect' })
  await delay(150)
  assert.equal(selections, selectedBeforeBroadcast, 'disconnected consumers must be removed from fanout')
})

test('a slow consumer disconnect does not interrupt a healthy subscriber', async (t) => {
  const state = { ...structuredClone(initialServerState), selectedProjectId: 'x'.repeat(2 * 1024 * 1024) }
  const slow = createStateStream((snapshot) => snapshot, () => state).getReader()
  const healthy = createStateStream((snapshot) => snapshot, () => state).getReader()
  t.after(() => Promise.all([slow.cancel().catch(() => undefined), healthy.cancel().catch(() => undefined)]))
  const failure = slow.closed.catch((error: Error) => error)
  await readEvent(slow)
  await readEvent(healthy)
  for (let i = 0; i < 5; i += 1) {
    broadcastState({ ...state, selectedTaskId: `task-${i}` }, { invalidation: 'project-workspaces' })
    assert.match(await readEvent(healthy), new RegExp(`"selectedTaskId":"task-${i}"`))
    assert.match(await readEvent(healthy), /event: invalidate/)
  }
  assert.match((await failure as Error).message, /too slow/)
})

test('aborting the request discards queued state and unregisters the subscriber', async () => {
  const abort = new AbortController()
  const state = structuredClone(initialServerState)
  let selections = 0
  const reader = createStateStream((snapshot) => { selections += 1; return snapshot }, () => state, { signal: abort.signal }).getReader()
  const failure = reader.closed.catch((error: Error) => error)
  abort.abort()
  assert.match((await failure as Error).message, /aborted/)
  await assert.rejects(reader.read(), /aborted/)
  broadcastState({ ...state, selectedTaskId: 'after-abort' })
  await delay(150)
  assert.equal(selections, 1)
})

test('already aborted requests never subscribe or load state', async () => {
  const reader = createStateStream(() => { throw new Error('must not select') }, () => {
    throw new Error('must not load')
  }, { signal: AbortSignal.abort() }).getReader()
  await assert.rejects(reader.read(), /aborted/)
})

test('snapshot failures unregister subscribers rather than leaking heartbeat timers', async () => {
  const state = structuredClone(initialServerState)
  let selections = 0
  const reader = createStateStream(() => { selections += 1; throw new Error('broken snapshot') }, () => state).getReader()
  await assert.rejects(reader.read(), /snapshot failed/)
  broadcastState(state)
  await delay(150)
  assert.equal(selections, 1)
})
