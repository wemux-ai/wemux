import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '@shared/types'
import type { ChatBubbleMessage } from '../../routes/-chat-route/chat-route-types'
import { appendPendingChatBubbleMessages } from './custom-agent-chat-panel'

const bubble = (id: string, role: 'user' | 'assistant', timelineOrder: number): ChatBubbleMessage => ({
  id,
  role,
  content: '已有消息',
  createdAt: '2026-07-21T00:00:00.000Z',
  timelineOrder,
})

const optimisticUser = (clientMessageId: string): ChatMessage => ({
  id: `pending:${clientMessageId}`,
  role: 'user',
  content: '帮我看看',
  createdAt: '2026-07-21T00:01:00.000Z',
})

test('pending adapter passes through when there is no optimistic message', () => {
  const base = [bubble('m1', 'user', 1), bubble('m2', 'assistant', 2)]
  assert.equal(appendPendingChatBubbleMessages(base, [], true), base)
})

test('pending adapter appends optimistic user bubbles with clientMessageId-derived ids', () => {
  const merged = appendPendingChatBubbleMessages(
    [bubble('m1', 'assistant', 1)],
    [optimisticUser('client-1')],
    false,
  )

  assert.equal(merged.length, 2)
  assert.equal(merged[1]?.id, 'pending:client-1')
  assert.equal(merged[1]?.role, 'user')
  assert.equal(merged[1]?.content, '帮我看看')
  assert.equal(merged[1]?.timelineOrder, 2)
  assert.equal(merged[1]?.streaming, false)
})

test('pending adapter appends a streaming assistant working bubble when streaming', () => {
  const merged = appendPendingChatBubbleMessages(
    [bubble('m1', 'user', 1)],
    [optimisticUser('client-2')],
    true,
  )

  assert.equal(merged.length, 3)
  assert.equal(merged[1]?.id, 'pending:client-2')
  assert.equal(merged[1]?.role, 'user')
  assert.equal(merged[2]?.id, 'pending:client-2:assistant')
  assert.equal(merged[2]?.role, 'assistant')
  assert.equal(merged[2]?.content, '')
  assert.equal(merged[2]?.streaming, true)
  assert.equal(merged[2]?.timelineOrder, 3)
})
