// [INPUT]: 无
// [OUTPUT]: 内置头像 url 列表与随机选取的验证
// [POS]: 验证随机默认头像返回 20 个内置头像之一（落库稳定的契约）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'

import { BUILT_IN_AGENT_AVATAR_URLS, randomBuiltInAgentAvatarUrl } from './agent-avatars'

test('内置头像共 20 个且 url 连续', () => {
  assert.equal(BUILT_IN_AGENT_AVATAR_URLS.length, 20)
  assert.equal(BUILT_IN_AGENT_AVATAR_URLS[0], '/agents/avatars/agent-01.png')
  assert.equal(BUILT_IN_AGENT_AVATAR_URLS[19], '/agents/avatars/agent-20.png')
})

test('随机头像返回内置集合之一', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const url = randomBuiltInAgentAvatarUrl()
    assert.ok(BUILT_IN_AGENT_AVATAR_URLS.includes(url as never), `非法头像 url: ${url}`)
    seen.add(url)
  }
  // 200 次采样应覆盖不止一个头像（证明确有随机性）
  assert.ok(seen.size > 1)
})
