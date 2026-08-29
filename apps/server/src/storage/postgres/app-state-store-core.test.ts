import assert from 'node:assert/strict'
import test from 'node:test'
import type { MainChatSession } from '@shared/types'
import { getMainChatSessionById, setMainChatSessionVisibility } from './app-state-store-core'
import { uiStateCache } from './app-state-store-core-cache'

const buildSession = (id: string, overrides: Partial<MainChatSession> = {}): MainChatSession => ({
  id,
  title: overrides.title ?? id,
  messages: overrides.messages ?? [],
  visibility: overrides.visibility,
  createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
})

test('getMainChatSessionById returns a cloned session or null when missing', () => {
  const session = buildSession('main-chat-lookup-1')
  uiStateCache.mainChatSessions.push(session)

  const found = getMainChatSessionById(session.id)
  assert.ok(found)
  assert.equal(found?.id, session.id)
  assert.notEqual(found, session)

  assert.equal(getMainChatSessionById('does-not-exist'), null)
})

test('setMainChatSessionVisibility mutates the cached session and returns null for unknown ids', () => {
  const session = buildSession('main-chat-visibility-1')
  uiStateCache.mainChatSessions.push(session)

  const updated = setMainChatSessionVisibility(session.id, 'private')
  assert.ok(updated)
  assert.equal(updated?.visibility, 'private')

  const persisted = getMainChatSessionById(session.id)
  assert.equal(persisted?.visibility, 'private')

  assert.equal(setMainChatSessionVisibility('does-not-exist', 'public'), null)
})
