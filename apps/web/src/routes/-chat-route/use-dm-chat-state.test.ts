import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationMessage } from '../../components/chat/conversation-types'
import { reconcileDmRealtimeMessage, settleDmOptimisticMessage } from './use-dm-chat-state'

const baseMessage = (id: string, text: string): ConversationMessage => ({
  id,
  role: 'user',
  text,
  createdAt: '2026-08-19T02:54:00.000Z',
  authorType: 'user',
  authorId: 'user-1',
})

test('settleDmOptimisticMessage replaces optimistic bubble when WS has not arrived yet', () => {
  const optimisticId = 'dm-optimistic-1'
  const current = [baseMessage('msg-0', '123'), baseMessage(optimisticId, 'aaa')]
  const confirmed = baseMessage('msg-1', 'aaa')

  const next = settleDmOptimisticMessage(current, optimisticId, confirmed)

  assert.deepEqual(next.map((message) => message.id), ['msg-0', 'msg-1'])
})

test('settleDmOptimisticMessage drops optimistic bubble when WS echo already appended confirmed message', () => {
  const optimisticId = 'dm-optimistic-1'
  const confirmed = baseMessage('msg-1', 'aaa')
  const current = [baseMessage('msg-0', '123'), baseMessage(optimisticId, 'aaa'), confirmed]

  const next = settleDmOptimisticMessage(current, optimisticId, confirmed)

  assert.deepEqual(next.map((message) => message.id), ['msg-0', 'msg-1'])
})

test('reconcileDmRealtimeMessage replaces the optimistic bubble on an early WS echo', () => {
  const clientMessageId = '11111111-1111-4111-8111-111111111111'
  const current = [baseMessage('msg-0', '123'), baseMessage(`dm-optimistic-${clientMessageId}`, 'aaa')]
  const next = reconcileDmRealtimeMessage(current, {
    id: 'msg-1',
    conversationId: 'conversation-1',
    role: 'user',
    senderId: 'user-1',
    content: 'aaa',
    contentType: 'text',
    createdAt: '2026-08-19T02:55:00.000Z',
    externalRef: { clientMessageId },
  })

  assert.deepEqual(next.map((message) => message.id), ['msg-0', 'msg-1'])
})
