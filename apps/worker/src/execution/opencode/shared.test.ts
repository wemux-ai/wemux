import assert from 'node:assert/strict'
import test from 'node:test'
import { applyOpenCodePartTextDelta, createOpenCodeSessionErrorEvent, extractOpencodeAssistantUsage } from './shared'

test('applyOpenCodePartTextDelta accumulates OpenCode text deltas by message and part', () => {
  const state = new Map<string, Map<string, string>>()

  assert.deepEqual(
    applyOpenCodePartTextDelta(state, {
      sessionID: 'session-1',
      messageID: 'message-1',
      partID: 'part-1',
      field: 'text',
      delta: 'hello',
    }),
    {
      id: 'part-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'text',
      text: 'hello',
    },
  )

  assert.deepEqual(
    applyOpenCodePartTextDelta(state, {
      sessionID: 'session-1',
      messageID: 'message-1',
      partID: 'part-1',
      field: 'text',
      delta: ' world',
    }),
    {
      id: 'part-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'text',
      text: 'hello world',
    },
  )
})

test('applyOpenCodePartTextDelta ignores non-text deltas', () => {
  const state = new Map<string, Map<string, string>>()

  assert.equal(
    applyOpenCodePartTextDelta(state, {
      messageID: 'message-1',
      partID: 'part-1',
      field: 'metadata',
      delta: 'ignored',
    }),
    undefined,
  )
  assert.equal(state.size, 0)
})

test('createOpenCodeSessionErrorEvent includes server-compatible error fields', () => {
  assert.deepEqual(
    createOpenCodeSessionErrorEvent('session-1', 'OpenCode prompt failed'),
    {
      type: 'session.error',
      properties: {
        sessionID: 'session-1',
        error: 'OpenCode prompt failed',
        message: 'OpenCode prompt failed',
      },
    },
  )
})

test('extractOpencodeAssistantUsage maps OpenCode tokens to ModelTokenUsage', () => {
  assert.deepEqual(
    extractOpencodeAssistantUsage({
      id: 'message-1',
      sessionID: 'session-1',
      role: 'assistant',
      modelID: 'claude-3-7-sonnet',
      providerID: 'anthropic',
      cost: 0.0123,
      tokens: {
        input: 1500,
        output: 400,
        reasoning: 200,
        cache: { read: 800, write: 100 },
      },
    }),
    {
      inputTokens: 1500,
      outputTokens: 400,
      reasoningTokens: 200,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      // 真实消耗口径：input + output + reasoning；cache 不计入总量。
      totalTokens: 2100,
    },
  )
})

test('extractOpencodeAssistantUsage returns undefined for missing or zero tokens', () => {
  assert.equal(extractOpencodeAssistantUsage(undefined), undefined)
  assert.equal(extractOpencodeAssistantUsage({ id: 'm', role: 'assistant' }), undefined)
  assert.equal(
    extractOpencodeAssistantUsage({ id: 'm', role: 'assistant', tokens: { input: 0, output: 0 } }),
    undefined,
  )
})

test('extractOpencodeAssistantUsage normalizes partial and fractional token counts', () => {
  const usage = extractOpencodeAssistantUsage({
    id: 'm',
    role: 'assistant',
    tokens: { input: 100.4, output: 0, cache: { read: 0, write: 0 } },
  })
  assert.deepEqual(usage, {
    inputTokens: 100,
    outputTokens: 0,
    reasoningTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    totalTokens: 100,
  })
})
