import assert from 'node:assert/strict'
import test from 'node:test'
import { bindMainChatExecutionAbortSignal, stopMainChatExecution } from './main-chat-runtime-state'

test('stopMainChatExecution aborts the bound signal with user_stop', () => {
  const binding = bindMainChatExecutionAbortSignal({
    userId: 'user-1',
    sessionId: 'session-1',
  })

  assert.equal(stopMainChatExecution({ userId: 'user-1', sessionId: 'session-1' }), true)
  assert.equal(binding.signal.aborted, true)
  assert.equal(binding.signal.reason, 'user_stop')

  binding.cleanup()
  assert.equal(stopMainChatExecution({ userId: 'user-1', sessionId: 'session-1' }), false)
})
