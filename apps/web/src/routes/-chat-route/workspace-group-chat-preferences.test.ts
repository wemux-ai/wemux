import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPersistedWorkspaceGroupChatUnreadCount,
  getPersistedWorkspaceGroupId,
  getPersistedWorkspaceGroupSessionId,
  readWorkspaceGroupChatPreferences,
  setPersistedWorkspaceGroupChatGroup,
  setPersistedWorkspaceGroupChatSessionReadMessageCount,
  setPersistedWorkspaceGroupChatSession,
  setPersistedWorkspaceGroupChatTarget,
  setPersistedWorkspaceGroupChatWorkspace,
} from './workspace-group-chat-preferences'

const STORAGE_KEY = 'vibemux.workspace-group-chat.preferences'

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

test('readWorkspaceGroupChatPreferences normalizes persisted workspace, group, session, and target ids', (t) => {
  const { localStorage, restore } = installWindow()
  t.after(restore)

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    workspaceId: '  workspace-2  ',
    selectedTarget: {
      kind: 'group',
      id: '  group-2  ',
    },
    groupsByWorkspaceId: {
      ' workspace-1 ': ' group-1 ',
      '   ': 'ignored',
    },
    sessionsByGroupId: {
      ' group-1 ': ' session-1 ',
      ' group-2 ': ['invalid'],
    },
  }))

  assert.deepEqual(readWorkspaceGroupChatPreferences(), {
    workspaceId: 'workspace-2',
    selectedTarget: {
      kind: 'group',
      id: 'group-2',
    },
    groupsByWorkspaceId: {
      'workspace-1': 'group-1',
    },
    sessionsByGroupId: {
      'group-1': 'session-1',
    },
    readMessageCountsBySessionId: {},
  })
})

test('workspace group chat preference updaters store the last valid workspace, group, session, and target selection', () => {
  const withWorkspace = setPersistedWorkspaceGroupChatWorkspace({
    groupsByWorkspaceId: {},
    sessionsByGroupId: {},
    readMessageCountsBySessionId: {},
  }, ' workspace-9 ')

  const withGroup = setPersistedWorkspaceGroupChatGroup(withWorkspace, 'workspace-9', 'group-9')
  const withSession = setPersistedWorkspaceGroupChatSession(withGroup, 'group-9', 'session-9')
  const withTarget = setPersistedWorkspaceGroupChatTarget(withSession, {
    kind: 'group',
    id: ' group-9 ',
  })

  assert.equal(withTarget.workspaceId, 'workspace-9')
  assert.equal(getPersistedWorkspaceGroupId(withTarget, 'workspace-9'), 'group-9')
  assert.equal(getPersistedWorkspaceGroupSessionId(withTarget, 'group-9'), 'session-9')
  assert.deepEqual(withTarget.selectedTarget, {
    kind: 'group',
    id: 'group-9',
  })
})

test('tracks unread group-chat messages from the persisted read message count', () => {
  const preferences = setPersistedWorkspaceGroupChatSessionReadMessageCount({
    groupsByWorkspaceId: {},
    sessionsByGroupId: {},
    readMessageCountsBySessionId: {},
  }, ' session-9 ', 3)

  assert.equal(getPersistedWorkspaceGroupChatUnreadCount(preferences, 'session-9', 5), 2)
  assert.equal(getPersistedWorkspaceGroupChatUnreadCount(preferences, 'unknown-session', 5), 0)
})
