import test from 'node:test'
import assert from 'node:assert/strict'

import type { MainChatSession } from '@shared/types'
import { filterMessagesForMembership, resolveMainChatSessionAccess } from './conversation-access'
import type { ConversationMemberRecord, ConversationMessageRecord } from '../storage/conversation-store'
import { uiStateCache } from '../storage/postgres/app-state-store-core-cache'

const buildMessage = (id: string, createdAt: string): ConversationMessageRecord => ({
  id,
  conversationId: 'conversation-1',
  role: 'user',
  content: id,
  contentType: 'text',
  createdAt,
})

const buildMembership = (joinedAt: string, leftAt?: string): ConversationMemberRecord => ({
  id: 'member-1',
  conversationId: 'conversation-1',
  memberType: 'agent',
  memberId: 'agent-1',
  role: 'member',
  joinedAt,
  leftAt,
  createdAt: joinedAt,
  updatedAt: leftAt ?? joinedAt,
})

test('filterMessagesForMembership hides messages sent before the agent joined and after it left', () => {
  const messages = [
    buildMessage('message-a', '2026-01-01T00:00:00.000Z'),
    buildMessage('message-b', '2026-01-01T01:00:00.000Z'),
    buildMessage('message-c', '2026-01-01T02:00:00.000Z'),
    buildMessage('message-d', '2026-01-01T03:00:00.000Z'),
  ]

  const membership = buildMembership('2026-01-01T01:00:00.000Z', '2026-01-01T02:00:00.000Z')
  const visible = filterMessagesForMembership(messages, membership)

  assert.deepEqual(visible.map((message) => message.id), ['message-b'])
})

test('filterMessagesForMembership still hides the earlier window after the agent rejoins', () => {
  const messages = [
    buildMessage('message-a', '2026-01-01T00:00:00.000Z'),
    buildMessage('message-b', '2026-01-01T01:00:00.000Z'),
    buildMessage('message-c', '2026-01-01T02:00:00.000Z'),
    buildMessage('message-d', '2026-01-01T03:00:00.000Z'),
  ]

  const rejoinedMembership = buildMembership('2026-01-01T03:00:00.000Z')
  const visible = filterMessagesForMembership(messages, rejoinedMembership)

  assert.deepEqual(visible.map((message) => message.id), ['message-d'])
})

test('filterMessagesForMembership returns all messages when membership is undefined', () => {
  const messages = [buildMessage('message-a', '2026-01-01T00:00:00.000Z')]
  assert.deepEqual(filterMessagesForMembership(messages, undefined), messages)
})

const buildMainChatSession = (id: string, visibility?: 'public' | 'private'): MainChatSession => ({
  id,
  title: id,
  messages: [],
  visibility,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

test('resolveMainChatSessionAccess grants access by default (public) and denies once set private', () => {
  const session = buildMainChatSession('main-chat-access-1')
  uiStateCache.mainChatSessions.push(session)

  const publicAccess = resolveMainChatSessionAccess({
    sessionId: session.id,
    viewer: { type: 'user', id: 'user-outsider' },
  })
  assert.equal(publicAccess.ok, true)
  assert.equal(publicAccess.ok && publicAccess.level, 'public')

  const index = uiStateCache.mainChatSessions.findIndex((s) => s.id === session.id)
  uiStateCache.mainChatSessions[index] = { ...session, visibility: 'private' }

  const deniedAccess = resolveMainChatSessionAccess({
    sessionId: session.id,
    viewer: { type: 'user', id: 'user-outsider' },
  })
  assert.equal(deniedAccess.ok, false)
})

test('resolveMainChatSessionAccess returns 404 for a missing session', () => {
  const result = resolveMainChatSessionAccess({
    sessionId: 'does-not-exist',
    viewer: { type: 'user', id: 'user-outsider' },
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.status, 404)
})
