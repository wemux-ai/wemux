import assert from 'node:assert/strict'
import test from 'node:test'
import { getExecutorHeartbeatVersionPatch } from './executor-ws-message-handler'

test('heartbeat version patch updates a stale executor version', () => {
  assert.deepEqual(getExecutorHeartbeatVersionPatch('0.3.110'), {
    version: '0.3.110',
  })
})

test('heartbeat version patch preserves the stored version for legacy workers', () => {
  assert.deepEqual(getExecutorHeartbeatVersionPatch(), {})
  assert.deepEqual(getExecutorHeartbeatVersionPatch('   '), {})
})
