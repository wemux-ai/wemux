import assert from 'node:assert/strict'
import test from 'node:test'
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
