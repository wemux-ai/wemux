import assert from 'node:assert/strict'
import test from 'node:test'
import { unwrapOpenCodeEvent } from './opencode-event'

test('unwrapOpenCodeEvent accepts the legacy top-level event shape', () => {
  assert.deepEqual(
    unwrapOpenCodeEvent({
      type: 'message.updated',
      properties: { info: { id: 'msg-1' } },
    }),
    {
      type: 'message.updated',
      properties: { info: { id: 'msg-1' } },
    },
  )
})

test('unwrapOpenCodeEvent accepts the wrapped global event shape', () => {
  assert.deepEqual(
    unwrapOpenCodeEvent({
      directory: '/tmp/demo',
      payload: {
        type: 'message.part.updated',
        properties: { part: { id: 'part-1' } },
      },
    }),
    {
      type: 'message.part.updated',
      properties: { part: { id: 'part-1' } },
    },
  )
})

test('unwrapOpenCodeEvent returns null for malformed payloads', () => {
  assert.equal(unwrapOpenCodeEvent({ directory: '/tmp/demo' }), null)
})
