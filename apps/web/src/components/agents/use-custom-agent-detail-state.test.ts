import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCustomAgentRuntimeChange, resolveCustomAgentModelRequest } from './use-custom-agent-detail-state'

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

test('changing the Agent runtime clears the model from the previous runtime', () => {
  const draft = {
    preferredRuntime: 'Codex' as const,
    preferredModel: 'custom/gpt-5.6-sol',
    name: 'CEO Agent',
  }

  assert.deepEqual(applyCustomAgentRuntimeChange(draft, 'ClaudeCode'), {
    preferredRuntime: 'ClaudeCode',
    preferredModel: '',
    name: 'CEO Agent',
  })
  assert.equal(applyCustomAgentRuntimeChange(draft, 'Codex'), draft)
})
