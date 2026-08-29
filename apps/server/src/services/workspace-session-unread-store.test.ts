import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeWorkspaceSessionUnreadStoreSnapshotForSave } from './workspace-session-unread-store'

test('mergeWorkspaceSessionUnreadStoreSnapshotForSave preserves acknowledged attention from other devices', () => {
  const mergedSnapshot = mergeWorkspaceSessionUnreadStoreSnapshotForSave({
    currentSnapshot: {
      updatedAt: '2026-05-19T08:00:00.000Z',
      sessionAttentionById: {},
      acknowledgedSessionAttentionById: {
        'workspace-session-1': 'error:4:2026-05-19T07:55:00.000Z',
      },
      manuallyUnreadSessionAttentionById: {},
    },
    incomingSnapshot: {
      updatedAt: '2026-05-19T08:05:00.000Z',
      sessionAttentionById: {},
      acknowledgedSessionAttentionById: {},
      manuallyUnreadSessionAttentionById: {},
    },
  })

  assert.deepEqual(mergedSnapshot.acknowledgedSessionAttentionById, {
    'workspace-session-1': 'error:4:2026-05-19T07:55:00.000Z',
  })
  assert.equal(mergedSnapshot.updatedAt, '2026-05-19T08:05:00.000Z')
})
