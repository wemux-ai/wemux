import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getStoredCollaborationWorkspaceId,
  setStoredCollaborationWorkspaceId,
} from './collaboration-workspace'

type StorageMockOptions = {
  setItem?: (key: string, value: string, store: Map<string, string>) => void
}

const createStorage = (options?: StorageMockOptions) => {
  const store = new Map<string, string>()

  const storage = {
    get length() {
      return store.size
    },
    clear: () => {
      store.clear()
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      options?.setItem?.(key, value, store)
      store.set(key, value)
    },
  }

  return storage as Storage
}

const installWindow = (options?: {
  localStorage?: Storage
  sessionStorage?: Storage
}) => {
  const previousWindow = globalThis.window
  const nextWindow = {
    localStorage: options?.localStorage ?? createStorage(),
    sessionStorage: options?.sessionStorage ?? createStorage(),
    dispatchEvent: () => true,
  } as unknown as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })

  return {
    localStorage: nextWindow.localStorage,
    sessionStorage: nextWindow.sessionStorage,
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

test('setStoredCollaborationWorkspaceId persists to localStorage when space is available', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  setStoredCollaborationWorkspaceId(' workspace-a ')

  assert.equal(localStorage.getItem('vibemux.collaboration-workspace-id'), 'workspace-a')
  assert.equal(getStoredCollaborationWorkspaceId(), 'workspace-a')
})

test('setStoredCollaborationWorkspaceId clears recoverable chat caches and retries localStorage on quota errors', (t) => {
  let firstAttempt = true
  const localStorage = createStorage({
    setItem: (key, _value, store) => {
      if (key !== 'vibemux.collaboration-workspace-id' || !firstAttempt) {
        return
      }

      firstAttempt = false
      if (store.has('vibemux-task-chat-conversation:task-1::workspace::latest')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    },
  })
  localStorage.setItem('vibemux-task-chat-conversation:task-1::workspace::latest', '{"messages":["cached"]}')
  const { restore } = installWindow({ localStorage })
  t.after(restore)

  assert.doesNotThrow(() => {
    setStoredCollaborationWorkspaceId('workspace-b')
  })

  assert.equal(localStorage.getItem('vibemux.collaboration-workspace-id'), 'workspace-b')
  assert.equal(localStorage.getItem('vibemux-task-chat-conversation:task-1::workspace::latest'), null)
})

test('setStoredCollaborationWorkspaceId falls back to sessionStorage when localStorage still cannot accept writes', (t) => {
  const localStorage = createStorage({
    setItem: (key) => {
      if (key === 'vibemux.collaboration-workspace-id') {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    },
  })
  localStorage.setItem('vibemux.collaboration-workspace-id:stale', 'old')
  const { sessionStorage, restore } = installWindow({ localStorage })
  t.after(restore)

  assert.doesNotThrow(() => {
    setStoredCollaborationWorkspaceId('workspace-c')
  })

  assert.equal(localStorage.getItem('vibemux.collaboration-workspace-id'), null)
  assert.equal(sessionStorage.getItem('vibemux.session.collaboration-workspace-id'), 'workspace-c')
  assert.equal(getStoredCollaborationWorkspaceId(), 'workspace-c')
})
