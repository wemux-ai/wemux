import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildTaskChatScopeKey,
  getCachedTaskChatComposer,
  setCachedTaskChatComposer,
} from './workspace-session-chat-cache'

const STORAGE_KEY_PREFIX = 'vibemux-task-chat-composer:'

const createLocalStorage = (options?: { setItem?: (key: string, value: string) => void }) => {
  const store = new Map<string, string>()

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      options?.setItem?.(key, value)
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

test('setCachedTaskChatComposer persists image drafts for the same workspace session scope', (t) => {
  const { restore } = installWindow()
  t.after(restore)

  setCachedTaskChatComposer('task-images', 'workspace-a', 'session-a', {
    input: 'compare these screenshots',
    history: ['first prompt', 'first prompt', 'second prompt'],
    images: [
      {
        id: ' image-1 ',
        url: ' /media/task-images/1 ',
        filename: ' before.png ',
        contentType: ' image/png ',
      },
    ],
    contextRefs: [],
  })

  assert.deepEqual(getCachedTaskChatComposer('task-images', 'workspace-a', 'session-a'), {
    input: 'compare these screenshots',
    history: ['first prompt', 'second prompt'],
    images: [{
      id: 'image-1',
      kind: 'file',
      url: '/media/task-images/1',
      filename: 'before.png',
      contentType: 'image/png',
    }],
    contextRefs: [],
  })
})

test('getCachedTaskChatComposer keeps backward compatibility with old drafts that had no images', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${buildTaskChatScopeKey('task-legacy', 'workspace-b', 'session-b')}`,
    JSON.stringify({
      input: 'legacy draft',
      history: ['legacy prompt'],
    }),
  )

  assert.deepEqual(getCachedTaskChatComposer('task-legacy', 'workspace-b', 'session-b'), {
    input: 'legacy draft',
    history: ['legacy prompt'],
    images: [],
    contextRefs: [],
  })
})

test('setCachedTaskChatComposer ignores storage quota failures and keeps the in-memory draft', (t) => {
  const previousWindow = globalThis.window
  const nextWindow = {
    localStorage: createLocalStorage({
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      },
    }),
  } as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })

  t.after(() => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
      return
    }

    delete (globalThis as { window?: Window }).window
  })

  assert.doesNotThrow(() => {
    setCachedTaskChatComposer('task-quota', 'workspace-c', 'session-c', {
      input: 'draft that should stay in memory',
      history: ['recent prompt'],
      images: [],
      contextRefs: [],
    })
  })

  assert.deepEqual(getCachedTaskChatComposer('task-quota', 'workspace-c', 'session-c'), {
    input: 'draft that should stay in memory',
    history: ['recent prompt'],
    images: [],
    contextRefs: [],
  })
})
