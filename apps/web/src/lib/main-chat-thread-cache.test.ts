import assert from 'node:assert/strict'
import test from 'node:test'

import type { ChatMessage } from '@shared/types'
import {
  MAIN_CHAT_THREAD_CACHE_TTL_MS,
  invalidateMainChatThreadCache,
  readMainChatThreadCache,
  writeMainChatThreadCache,
} from './main-chat-thread-cache'

const createMessage = (id: string, seq: number): ChatMessage => ({
  id,
  seq,
  role: 'user',
  content: `message-${id}`,
  createdAt: new Date(1000 + seq).toISOString(),
} as ChatMessage)

test('readMainChatThreadCache returns null for unknown session', () => {
  const cache = new Map()
  assert.equal(readMainChatThreadCache(cache, 'session-unknown', 1000), null)
})

test('writeMainChatThreadCache then readMainChatThreadCache round-trips', () => {
  const cache = new Map()
  writeMainChatThreadCache(cache, 'session-a', {
    messages: [createMessage('m1', 1), createMessage('m2', 2)],
    hasMoreBefore: false,
  }, 1000)

  const entry = readMainChatThreadCache(cache, 'session-a', 2000)
  assert.equal(entry?.messages.length, 2)
  assert.equal(entry?.hasMoreBefore, false)
})

test('readMainChatThreadCache removes expired entries', () => {
  const cache = new Map()
  writeMainChatThreadCache(cache, 'expired', { messages: [createMessage('m1', 1)], hasMoreBefore: false }, 10)

  assert.equal(
    readMainChatThreadCache(cache, 'expired', 10 + MAIN_CHAT_THREAD_CACHE_TTL_MS),
    null,
  )
  assert.equal(cache.size, 0)
})

test('writeMainChatThreadCache evicts the least recently used entry', () => {
  const cache = new Map()
  writeMainChatThreadCache(cache, 'a', { messages: [createMessage('m1', 1)], hasMoreBefore: true }, 1, 2)
  writeMainChatThreadCache(cache, 'b', { messages: [createMessage('m2', 2)], hasMoreBefore: true }, 2, 2)

  // 读 a 把 a 挪到末尾（LRU 刷新）。
  assert.equal(readMainChatThreadCache(cache, 'a', 3)?.messages[0]?.id, 'm1')
  writeMainChatThreadCache(cache, 'c', { messages: [createMessage('m3', 3)], hasMoreBefore: true }, 4, 2)

  assert.deepEqual([...cache.keys()], ['a', 'c'])
})

test('writeMainChatThreadCache replaces the existing entry in place', () => {
  const cache = new Map()
  writeMainChatThreadCache(cache, 'session-a', { messages: [createMessage('m1', 1)], hasMoreBefore: true }, 1000)
  writeMainChatThreadCache(cache, 'session-a', { messages: [createMessage('m1', 1), createMessage('m2', 2)], hasMoreBefore: false }, 2000)

  const entry = readMainChatThreadCache(cache, 'session-a', 3000)
  assert.equal(entry?.messages.length, 2)
  assert.equal(entry?.hasMoreBefore, false)
})

test('invalidateMainChatThreadCache removes the entry', () => {
  const cache = new Map()
  writeMainChatThreadCache(cache, 'session-a', { messages: [createMessage('m1', 1)], hasMoreBefore: true }, 1000)

  invalidateMainChatThreadCache(cache, 'session-a')
  assert.equal(readMainChatThreadCache(cache, 'session-a', 2000), null)
})
