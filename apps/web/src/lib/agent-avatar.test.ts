import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILT_IN_AGENT_AVATARS, getBuiltInAgentAvatarUrl } from './agent-avatar'

test('exposes all 20 replacement Agent avatars', () => {
  assert.equal(BUILT_IN_AGENT_AVATARS.length, 20)
  assert.deepEqual(
    BUILT_IN_AGENT_AVATARS.map((avatar) => avatar.url),
    Array.from({ length: 20 }, (_, index) => `/agents/avatars/agent-${String(index + 1).padStart(2, '0')}.png`),
  )
  assert.equal(new Set(BUILT_IN_AGENT_AVATARS.map((avatar) => avatar.url)).size, 20)
})

test('keeps legacy template identifiers on the replacement avatars', () => {
  assert.equal(getBuiltInAgentAvatarUrl('engineering'), '/agents/avatars/agent-01.png')
  assert.equal(getBuiltInAgentAvatarUrl('research'), '/agents/avatars/agent-03.png')
})
