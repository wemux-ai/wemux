// [INPUT]: openrouter-oauth 纯函数验证需求（不依赖 DB / 网络）。
// [OUTPUT]: PKCE 生成、授权链接、pending verifier TTL/单次消费、免费模型过滤的断言。
// [POS]: OpenRouter OAuth 接入服务单测；交换与登记等 IO 路径不在本文件覆盖。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildOpenRouterAuthorizeUrl,
  filterOpenRouterFreeModels,
  generatePkcePair,
  rememberOpenRouterVerifier,
  takeOpenRouterVerifier,
} from './openrouter-oauth'

test('generatePkcePair 产出 S256 配对', () => {
  const { codeVerifier, codeChallenge } = generatePkcePair()
  assert.ok(codeVerifier.length >= 43)
  const expected = createHash('sha256').update(codeVerifier).digest('base64url')
  assert.equal(codeChallenge, expected)
})

test('buildOpenRouterAuthorizeUrl 使用 headless 模式（无 callback_url，强制 PKCE）', () => {
  const url = new URL(buildOpenRouterAuthorizeUrl('challenge-abc'))
  assert.equal(url.origin + url.pathname, 'https://openrouter.ai/auth')
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('callback_url'), null)
  assert.ok(url.searchParams.get('key_label'))
})

test('pending verifier 过期后不可消费', () => {
  rememberOpenRouterVerifier('user-expired', 'verifier-1', 1000)
  assert.equal(takeOpenRouterVerifier('user-expired', 1000 + 10 * 60 * 1000), null)
})

test('pending verifier 单次消费且未过期可用', () => {
  const now = 50_000
  rememberOpenRouterVerifier('user-ok', 'verifier-2', now)
  assert.equal(takeOpenRouterVerifier('user-other', now + 1000), null)
  assert.equal(takeOpenRouterVerifier('user-ok', now + 1000), 'verifier-2')
  assert.equal(takeOpenRouterVerifier('user-ok', now + 2000), null)
})

test('filterOpenRouterFreeModels 只留 :free、按上下文降序并截断', () => {
  const entries = [
    { id: 'openai/gpt-5', name: 'GPT-5', context_length: 400_000 },
    { id: 'a/one:free', name: 'One Free', context_length: 64_000 },
    { id: 'b/two:free', name: 'Two Free', context_length: 1_000_000 },
    { id: 'c/three:free' },
    'not-an-object',
    null,
    { id: 'd/four:free', name: 'Four Free', context_length: 256_000 },
  ]
  const filtered = filterOpenRouterFreeModels(entries, 2)
  assert.deepEqual(filtered, [
    { modelId: 'b/two:free', label: 'Two Free' },
    { modelId: 'd/four:free', label: 'Four Free' },
  ])
  // 无 context_length 时排最后、name 缺省回退到 modelId
  const all = filterOpenRouterFreeModels(entries, 24)
  assert.equal(all[all.length - 1].label, 'c/three:free')
})
