import assert from 'node:assert/strict'
import test from 'node:test'
import { safeLocalStorageSetItem, safeSessionStorageSetItem } from './browser-storage'

type StorageMockOptions = {
  setItem?: (key: string, value: string, store: Map<string, string>) => void
}

const createStorage = (options?: StorageMockOptions) => {
  const store = new Map<string, string>()

  return {
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
  } as Storage
}

const installWindow = (options?: {
  localStorage?: Storage
  sessionStorage?: Storage
}) => {
  const previousWindow = globalThis.window
  const nextWindow = {
    localStorage: options?.localStorage ?? createStorage(),
    sessionStorage: options?.sessionStorage ?? createStorage(),
  } as unknown as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })

  return () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
      return
    }

    delete (globalThis as { window?: Window }).window
  }
}

test('safeLocalStorageSetItem clears recoverable task chat caches and retries quota failures', (t) => {
  let firstAttempt = true
  const localStorage = createStorage({
    setItem: (key, _value, store) => {
      if (key !== 'target-key' || !firstAttempt) {
        return
      }

      firstAttempt = false
      if (store.has('vibemux-task-chat-conversation:task-1::workspace::latest')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    },
  })
  localStorage.setItem('vibemux-task-chat-conversation:task-1::workspace::latest', '{"messages":["cached"]}')
  const restore = installWindow({ localStorage })
  t.after(restore)

  assert.equal(safeLocalStorageSetItem('target-key', 'value', {
    clearRecoverableLocalStorageOnQuota: true,
  }), true)
  assert.equal(localStorage.getItem('target-key'), 'value')
  assert.equal(localStorage.getItem('vibemux-task-chat-conversation:task-1::workspace::latest'), null)
})

test('safeSessionStorageSetItem returns false when storage still cannot accept writes', (t) => {
  const restore = installWindow({
    sessionStorage: createStorage({
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      },
    }),
  })
  t.after(restore)

  assert.equal(safeSessionStorageSetItem('session-key', 'value'), false)
})
