import assert from 'node:assert/strict'
import test from 'node:test'

import type { AppState } from '@shared/types'
import {
  APP_STATE_SNAPSHOT_CACHE_TTL_MS,
  buildAppStateSnapshotCacheKey,
  readAppStateSnapshotCache,
  writeAppStateSnapshotCache,
  type AppStateSnapshotCacheEntry,
} from './app-state-snapshot-cache'

const createEntry = (id: string, updatedAt: number): AppStateSnapshotCacheEntry => ({
  state: { id } as unknown as AppState,
  stateHash: `hash-${id}`,
  updatedAt,
})

test('buildAppStateSnapshotCacheKey isolates users and workspace focus', () => {
  assert.notEqual(
    buildAppStateSnapshotCacheKey({
      userId: 'user-a',
      scope: 'workspaces',
      focus: { workspaceId: 'workspace-1' },
    }),
    buildAppStateSnapshotCacheKey({
      userId: 'user-b',
      scope: 'workspaces',
      focus: { workspaceId: 'workspace-1' },
    }),
  )
  assert.notEqual(
    buildAppStateSnapshotCacheKey({
      userId: 'user-a',
      scope: 'workspaces',
      focus: { workspaceId: 'workspace-1' },
    }),
    buildAppStateSnapshotCacheKey({
      userId: 'user-a',
      scope: 'workspaces',
      focus: { workspaceId: 'workspace-2' },
    }),
  )
})

test('writeAppStateSnapshotCache evicts the least recently used entry', () => {
  const cache = new Map<string, AppStateSnapshotCacheEntry>()
  writeAppStateSnapshotCache(cache, 'a', createEntry('a', 1), 2)
  writeAppStateSnapshotCache(cache, 'b', createEntry('b', 2), 2)

  assert.equal(readAppStateSnapshotCache(cache, 'a', 3)?.stateHash, 'hash-a')
  writeAppStateSnapshotCache(cache, 'c', createEntry('c', 3), 2)

  assert.deepEqual([...cache.keys()], ['a', 'c'])
})

test('readAppStateSnapshotCache removes expired entries', () => {
  const cache = new Map<string, AppStateSnapshotCacheEntry>()
  writeAppStateSnapshotCache(cache, 'expired', createEntry('expired', 10))

  assert.equal(readAppStateSnapshotCache(cache, 'expired', 10 + APP_STATE_SNAPSHOT_CACHE_TTL_MS), null)
  assert.equal(cache.size, 0)
})
