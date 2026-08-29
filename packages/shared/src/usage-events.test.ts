import assert from 'node:assert/strict'
import test from 'node:test'
import { toUsageEventTokenCounts, usageEventDedupeKey } from './usage-events'

test('toUsageEventTokenCounts normalizes ModelTokenUsage into six non-null counts', () => {
  assert.deepEqual(
    toUsageEventTokenCounts({
      inputTokens: 1500,
      outputTokens: 400,
      reasoningTokens: 200,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      totalTokens: 2100,
    }),
    {
      inputTokens: 1500,
      outputTokens: 400,
      reasoningTokens: 200,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      totalTokens: 2100,
    },
  )
})

test('toUsageEventTokenCounts returns zero counts for missing or null usage', () => {
  assert.deepEqual(toUsageEventTokenCounts(undefined), {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  })
  assert.deepEqual(toUsageEventTokenCounts(null), {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  })
  assert.deepEqual(toUsageEventTokenCounts({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }), {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  })
})

test('usageEventDedupeKey combines runKind and runId', () => {
  assert.equal(usageEventDedupeKey({ runKind: 'task', runId: 'run-1' }), 'task:run-1')
})
