import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMarketingLlmsTxt } from './marketing-llms'

test('buildMarketingLlmsTxt lists the public product, comparison, and documentation entry points', () => {
  const llmsTxt = buildMarketingLlmsTxt()

  assert.match(llmsTxt, /^# wemux\n/m)
  assert.match(llmsTxt, /## Product and docs/)
  assert.match(llmsTxt, /https:\/\/wemux\.ai\/docs\/worker-install/)
  assert.match(llmsTxt, /## Comparison pages/)
  assert.match(llmsTxt, /https:\/\/wemux\.ai\/compare\/best-cursor-alternative-for-teams/)
  assert.match(llmsTxt, /## Topics/)
})
