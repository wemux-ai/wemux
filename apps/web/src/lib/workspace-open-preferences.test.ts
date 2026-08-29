import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getStoredWorkspaceOpenTarget,
  setStoredWorkspaceOpenTarget,
} from './workspace-open-preferences'

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
  } as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })

  return {
    localStorage: nextWindow.localStorage,
    sessionStorage: nextWindow.sessionStorage,
    restore: () => {
      setStoredWorkspaceOpenTarget(null)
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

test('getStoredWorkspaceOpenTarget falls back to the configured default when storage is empty', (t) => {
  const { restore } = installWindow()
  t.after(restore)

  assert.equal(getStoredWorkspaceOpenTarget('vscode'), 'vscode')
})

test('setStoredWorkspaceOpenTarget persists the last opened target and normalizes subsequent reads', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  setStoredWorkspaceOpenTarget('cursor')

  assert.equal(localStorage.getItem('vibemux.workspace-open.last-target'), 'cursor')
  assert.equal(getStoredWorkspaceOpenTarget('vscode'), 'cursor')
})

test('setStoredWorkspaceOpenTarget falls back to sessionStorage when localStorage cannot accept writes', (t) => {
  const localStorage = createStorage({
    setItem: (key) => {
      if (key === 'vibemux.workspace-open.last-target') {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    },
  })
  const { sessionStorage, restore } = installWindow({ localStorage })
  t.after(restore)

  setStoredWorkspaceOpenTarget('warp')

  assert.equal(localStorage.getItem('vibemux.workspace-open.last-target'), null)
  assert.equal(sessionStorage.getItem('vibemux.session.workspace-open.last-target'), 'warp')
  assert.equal(getStoredWorkspaceOpenTarget('vscode'), 'warp')
})
