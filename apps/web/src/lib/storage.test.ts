import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearCreateTaskDraft,
  loadCreateTaskDraft,
  saveCreateTaskDraft,
} from './storage'

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

const installStorageGlobals = (localStorage: Storage) => {
  const previousWindow = globalThis.window
  const previousLocalStorage = globalThis.localStorage
  const nextWindow = {
    localStorage,
  } as Window & typeof globalThis

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: nextWindow,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage,
  })

  return () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
    } else {
      delete (globalThis as { window?: Window }).window
    }

    if (previousLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: previousLocalStorage,
      })
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage
    }
  }
}

test('saveCreateTaskDraft clears recoverable caches and retries after localStorage quota failures', (t) => {
  let firstAttempt = true
  const localStorage = createStorage({
    setItem: (key, _value, store) => {
      if (!key.startsWith('vibemux-create-task-draft:') || !firstAttempt) {
        return
      }

      firstAttempt = false
      if (store.has('vibemux-task-chat-composer:task-1::workspace::latest')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    },
  })
  localStorage.setItem('vibemux-task-chat-composer:task-1::workspace::latest', '{"input":"cached"}')
  const restore = installStorageGlobals(localStorage)
  t.after(() => {
    clearCreateTaskDraft('project-retry')
    restore()
  })

  assert.doesNotThrow(() => {
    saveCreateTaskDraft('project-retry', {
      title: 'Retry draft',
      description: 'Persist after cleanup',
      acceptanceCriteria: '',
      requirementType: 'task',
      priority: 'medium',
      assigneeId: '',
    })
  })

  assert.equal(localStorage.getItem('vibemux-task-chat-composer:task-1::workspace::latest'), null)
  assert.match(localStorage.getItem('vibemux-create-task-draft:project-retry') ?? '', /Persist after cleanup/)
})

test('saveCreateTaskDraft keeps the draft readable in memory when localStorage cannot persist it', (t) => {
  const localStorage = createStorage({
    setItem: (key) => {
      if (key.startsWith('vibemux-create-task-draft:')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    },
  })
  const restore = installStorageGlobals(localStorage)
  t.after(() => {
    clearCreateTaskDraft('project-memory')
    restore()
  })

  assert.doesNotThrow(() => {
    saveCreateTaskDraft('project-memory', {
      title: 'Large draft',
      description: 'draft that should stay available in memory',
      acceptanceCriteria: 'keep working without crashing',
      requirementType: 'requirement',
      priority: 'high',
      assigneeId: 'user-1',
    })
  })

  const draft = loadCreateTaskDraft('project-memory')
  assert.equal(localStorage.getItem('vibemux-create-task-draft:project-memory'), null)
  assert.deepEqual(draft, {
    savedAt: draft?.savedAt,
    projectId: 'project-memory',
    title: 'Large draft',
    description: 'draft that should stay available in memory',
    acceptanceCriteria: 'keep working without crashing',
    requirementType: 'requirement',
    priority: 'high',
    assigneeId: 'user-1',
  })
})
