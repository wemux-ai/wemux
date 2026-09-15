import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCustomAgentModelRequest } from './use-custom-agent-detail-state'

test('Agent model discovery targets the selected execution node', () => {
  assert.deepEqual(resolveCustomAgentModelRequest({
    defaultExecutorId: '  worker-local  ',
    preferredRuntime: 'Codex',
  }), {
    agentType: 'Codex',
    executorId: 'worker-local',
  })
})

test('Agent model discovery omits an empty execution node', () => {
  assert.deepEqual(resolveCustomAgentModelRequest({
    defaultExecutorId: '   ',
    preferredRuntime: 'Pi',
  }), {
    agentType: 'Pi',
    executorId: undefined,
  })
})
