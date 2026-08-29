import assert from 'node:assert/strict'
import test from 'node:test'
import { PRIMARY_CHAT_AGENT_ID } from './chat-route-helpers'
import {
  readMainChatPreferences,
  resolveMainChatSessionSelectedModel,
} from './chat-session-preferences'

const STORAGE_KEY = 'vibemux.main-chat.session-preferences'

const createLocalStorage = () => {
  const store = new Map<string, string>()

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

const installWindow = () => {
  const previousWindow = globalThis.window
  const nextWindow = {
    localStorage: createLocalStorage(),
  } as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })

  return {
    localStorage: nextWindow.localStorage,
    restore: () => {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        })
        return
      }

      delete (globalThis as { window?: Window }).window
    },
  }
}

test('readMainChatPreferences normalizes persisted session agent and model values', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    lastSelectedAgentId: '  agent-last  ',
    sessions: {
      '  session-1  ': {
        agentId: '  agent-1  ',
        executionModel: '  openai/gpt-5  ',
      },
      'session-2': {
        agentId: 42,
        executionModel: ['invalid'],
      },
      '   ': {
        agentId: 'ignored',
      },
    },
  }))

  assert.deepEqual(readMainChatPreferences(), {
    lastSelectedAgentId: 'agent-last',
    sessions: {
      'session-1': {
        agentId: 'agent-1',
        executionModel: 'openai/gpt-5',
      },
      'session-2': {
        agentId: PRIMARY_CHAT_AGENT_ID,
        executionModel: undefined,
      },
    },
  })
})

test('resolveMainChatSessionSelectedModel prefers the current session over stale persisted model state', () => {
  assert.equal(resolveMainChatSessionSelectedModel(
    { executionModel: undefined },
    { executionModel: 'openai/gpt-5' },
  ), '')

  assert.equal(resolveMainChatSessionSelectedModel(
    undefined,
    { executionModel: 'openai/gpt-5' },
  ), 'openai/gpt-5')
})
