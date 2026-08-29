import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FLOATING_CHAT_ENABLED_STORAGE_KEY,
  isFloatingChatEnabled,
  setFloatingChatEnabled,
  subscribeFloatingChatEnabled,
} from './floating-chat-visibility'

const createFakeStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

test('floating chat is enabled by default without any stored value', () => {
  assert.equal(isFloatingChatEnabled(), true)
})

test('disabled flag persists and can be re-enabled', () => {
  const storage = createFakeStorage()
  ;(globalThis as { window?: unknown }).window = { localStorage: storage }

  try {
    assert.equal(isFloatingChatEnabled(), true)

    setFloatingChatEnabled(false)
    assert.equal(storage.getItem(FLOATING_CHAT_ENABLED_STORAGE_KEY), '0')
    assert.equal(isFloatingChatEnabled(), false)

    setFloatingChatEnabled(true)
    assert.equal(storage.getItem(FLOATING_CHAT_ENABLED_STORAGE_KEY), null)
    assert.equal(isFloatingChatEnabled(), true)
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('subscribers are notified on change and can unsubscribe', () => {
  const seen: boolean[] = []
  const unsubscribe = subscribeFloatingChatEnabled((enabled) => {
    seen.push(enabled)
  })

  setFloatingChatEnabled(false)
  setFloatingChatEnabled(true)
  unsubscribe()
  setFloatingChatEnabled(false)

  assert.deepEqual(seen, [false, true])
})
