import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getWorkspaceSessionAttentionSignature,
  getWorkspaceSessionUnreadTone,
  markWorkspaceSessionRead,
  markWorkspaceSessionUnread,
  readWorkspaceSessionAttentionAckState,
  readWorkspaceSessionManualUnreadState,
  writeWorkspaceSessionUnreadStoreSnapshot,
} from './workspace-session-attention'

const STORAGE_KEY = 'vibemux.workspace.session-manual-unread'

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
  const nextWindowMock = {
    addEventListener: () => {},
    dispatchEvent: () => true,
    localStorage: createLocalStorage(),
    removeEventListener: () => {},
  }
  const nextWindow = nextWindowMock as unknown as Window & typeof globalThis

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

test('getWorkspaceSessionAttentionSignature includes tone and runtime event identity', () => {
  assert.equal(getWorkspaceSessionAttentionSignature({
    agentRunningStatus: 'complete',
    needsHumanConfirm: false,
    runtimeStatus: 'completed',
    runtimeSequence: 7,
    createdAt: '2026-05-10T09:00:00.000Z',
    lastRuntimeEventAt: '2026-05-10T10:00:00.000Z',
  }), 'complete:7:2026-05-10T10:00:00.000Z')
})

test('getWorkspaceSessionAttentionSignature falls back to stable session timestamps', () => {
  assert.equal(getWorkspaceSessionAttentionSignature({
    agentRunningStatus: 'complete',
    needsHumanConfirm: false,
    runtimeStatus: 'completed',
    runtimeSequence: 2,
    createdAt: '2026-05-10T09:30:00.000Z',
    runtimeStartedAt: '2026-05-10T09:45:00.000Z',
  }), 'complete:2:2026-05-10T09:45:00.000Z')
})

test('markWorkspaceSessionUnread stores manual unread state for the current signature', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  const marked = markWorkspaceSessionUnread({
    id: 'session-1',
    agentRunningStatus: 'complete',
    needsHumanConfirm: false,
    runtimeStatus: 'completed',
    runtimeSequence: 3,
    createdAt: '2026-05-10T10:30:00.000Z',
    lastRuntimeEventAt: '2026-05-10T11:00:00.000Z',
  })

  assert.equal(marked, true)
  assert.deepEqual(readWorkspaceSessionManualUnreadState(), {
    'session-1': 'complete:3:2026-05-10T11:00:00.000Z',
  })
  assert.equal(
    localStorage.getItem(STORAGE_KEY),
    JSON.stringify({
      'session-1': 'complete:3:2026-05-10T11:00:00.000Z',
    }),
  )
})

test('markWorkspaceSessionRead acknowledges the signature and clears manual unread state', (t) => {
  const { restore } = installWindow()
  t.after(restore)

  writeWorkspaceSessionUnreadStoreSnapshot({
    sessionAttentionById: {
      'session-1': 'attention:3:2026-05-10T11:00:00.000Z',
    },
    acknowledgedSessionAttentionById: {},
    manuallyUnreadSessionAttentionById: {
      'session-1': 'attention:3:2026-05-10T11:00:00.000Z',
    },
    updatedAt: '2026-05-10T11:30:00.000Z',
  })

  const marked = markWorkspaceSessionRead({
    id: 'session-1',
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
    runtimeStatus: 'completed',
    runtimeSequence: 3,
    createdAt: '2026-05-10T10:30:00.000Z',
    lastRuntimeEventAt: '2026-05-10T11:00:00.000Z',
  })

  assert.equal(marked, true)
  assert.deepEqual(readWorkspaceSessionAttentionAckState(), {
    'session-1': 'attention:3:2026-05-10T11:00:00.000Z',
  })
  assert.deepEqual(readWorkspaceSessionManualUnreadState(), {})
})

test('attention sessions stay unread until they are acknowledged', () => {
  const session = {
    id: 'session-attention',
    agentRunningStatus: 'complete' as const,
    needsHumanConfirm: true,
    runtimeStatus: 'completed' as const,
    runtimeSequence: 9,
    createdAt: '2026-05-10T11:30:00.000Z',
    lastRuntimeEventAt: '2026-05-10T12:00:00.000Z',
  }

  assert.equal(getWorkspaceSessionUnreadTone(session), 'attention')
  assert.equal(getWorkspaceSessionUnreadTone(session, {
    acknowledgedSessionAttentionById: {
      'session-attention': 'attention:9:2026-05-10T12:00:00.000Z',
    },
  }), null)
})

test('error sessions stay unread until they are acknowledged', () => {
  const session = {
    id: 'session-error',
    agentRunningStatus: 'complete' as const,
    needsHumanConfirm: false,
    runtimeStatus: 'lost' as const,
    runtimeSequence: 11,
    createdAt: '2026-05-10T13:30:00.000Z',
    lastRuntimeEventAt: '2026-05-10T14:00:00.000Z',
  }

  assert.equal(getWorkspaceSessionUnreadTone(session), 'error')
  assert.equal(getWorkspaceSessionUnreadTone(session, {
    acknowledgedSessionAttentionById: {
      'session-error': 'error:11:2026-05-10T14:00:00.000Z',
    },
  }), null)
})

test('completed sessions only stay unread when they were surfaced or manually marked', () => {
  const session = {
    id: 'session-complete',
    agentRunningStatus: 'complete' as const,
    needsHumanConfirm: false,
    runtimeStatus: 'completed' as const,
    runtimeSequence: 4,
    createdAt: '2026-05-10T12:30:00.000Z',
    lastRuntimeEventAt: '2026-05-10T13:00:00.000Z',
  }

  assert.equal(getWorkspaceSessionUnreadTone(session), null)
  assert.equal(getWorkspaceSessionUnreadTone(session, {
    sessionAttentionById: {
      'session-complete': 'complete',
    },
  }), 'complete')
  assert.equal(getWorkspaceSessionUnreadTone(session, {
    acknowledgedSessionAttentionById: {
      'session-complete': 'complete:4:2026-05-10T13:00:00.000Z',
    },
    manuallyUnreadSessionAttentionById: {
      'session-complete': 'complete:4:2026-05-10T13:00:00.000Z',
    },
  }), 'complete')
})
