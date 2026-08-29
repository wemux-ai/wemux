import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldPushWorkspaceSessionUnreadRemoteSnapshot,
  shouldClearSelectedWorkspaceSessionManualUnread,
  shouldPullWorkspaceSessionUnreadRemoteSnapshot,
} from './use-workspace-session-unread-state'

test('clears manual unread when the selected workspace session is opened for the first time', () => {
  assert.equal(
    shouldClearSelectedWorkspaceSessionManualUnread({
      previousSelectedWorkspaceSessionId: null,
      selectedWorkspaceSessionId: 'session-1',
      attentionSignature: 'complete:3:2026-05-12T01:00:00.000Z',
      manuallyUnreadSessionAttentionById: {
        'session-1': 'complete:3:2026-05-12T01:00:00.000Z',
      },
    }),
    true,
  )
})

test('clears manual unread when switching into another workspace session', () => {
  assert.equal(
    shouldClearSelectedWorkspaceSessionManualUnread({
      previousSelectedWorkspaceSessionId: 'session-2',
      selectedWorkspaceSessionId: 'session-1',
      attentionSignature: 'complete:3:2026-05-12T01:00:00.000Z',
      manuallyUnreadSessionAttentionById: {
        'session-1': 'complete:3:2026-05-12T01:00:00.000Z',
      },
    }),
    true,
  )
})

test('keeps manual unread when the same workspace session remains selected', () => {
  assert.equal(
    shouldClearSelectedWorkspaceSessionManualUnread({
      previousSelectedWorkspaceSessionId: 'session-1',
      selectedWorkspaceSessionId: 'session-1',
      attentionSignature: 'complete:3:2026-05-12T01:00:00.000Z',
      manuallyUnreadSessionAttentionById: {
        'session-1': 'complete:3:2026-05-12T01:00:00.000Z',
      },
    }),
    false,
  )
})

test('skips remote unread pull while another pull is pending', () => {
  assert.equal(
    shouldPullWorkspaceSessionUnreadRemoteSnapshot({
      now: 20_000,
      lastPullAt: 0,
      cooldownMs: 10_000,
      pending: true,
    }),
    false,
  )
})

test('throttles remote unread focus pulls shortly after initial sync', () => {
  assert.equal(
    shouldPullWorkspaceSessionUnreadRemoteSnapshot({
      now: 1_000,
      lastPullAt: 0,
      cooldownMs: 10_000,
    }),
    false,
  )
  assert.equal(
    shouldPullWorkspaceSessionUnreadRemoteSnapshot({
      now: 1_000,
      lastPullAt: 0,
      cooldownMs: 10_000,
      force: true,
    }),
    true,
  )
})

test('skips remote unread push when only updatedAt changed', () => {
  const snapshot = {
    sessionAttentionById: {},
    acknowledgedSessionAttentionById: {
      'session-1': 'complete:1:2026-06-09T00:00:00.000Z',
    },
    manuallyUnreadSessionAttentionById: {},
    updatedAt: '2026-06-09T00:00:01.000Z',
  }

  assert.equal(
    shouldPushWorkspaceSessionUnreadRemoteSnapshot({
      ready: true,
      snapshot,
      lastRemoteUpdatedAt: '2026-06-09T00:00:00.000Z',
      lastRemoteStateKey: JSON.stringify({
        sessionAttentionById: {},
        acknowledgedSessionAttentionById: {
          'session-1': 'complete:1:2026-06-09T00:00:00.000Z',
        },
        manuallyUnreadSessionAttentionById: {},
      }),
    }),
    false,
  )
})

test('pushes remote unread snapshot when content changed', () => {
  assert.equal(
    shouldPushWorkspaceSessionUnreadRemoteSnapshot({
      ready: true,
      snapshot: {
        sessionAttentionById: {},
        acknowledgedSessionAttentionById: {
          'session-1': 'complete:1:2026-06-09T00:00:00.000Z',
        },
        manuallyUnreadSessionAttentionById: {},
        updatedAt: '2026-06-09T00:00:01.000Z',
      },
      lastRemoteUpdatedAt: '2026-06-09T00:00:00.000Z',
      lastRemoteStateKey: JSON.stringify({
        sessionAttentionById: {},
        acknowledgedSessionAttentionById: {},
        manuallyUnreadSessionAttentionById: {},
      }),
    }),
    true,
  )
})
