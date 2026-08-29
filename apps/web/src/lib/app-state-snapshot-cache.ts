import type { AppState } from '@shared/types'

export type AppStateSnapshotFocus = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

export type AppStateSnapshotScope = 'default' | 'workspaces' | 'kanban'

export type AppStateSnapshotCacheEntry = {
  state: AppState
  stateHash: string
  updatedAt: number
}

export const MAX_APP_STATE_SNAPSHOT_CACHE_SIZE = 8
export const APP_STATE_SNAPSHOT_CACHE_TTL_MS = 5 * 60_000

const normalizeKeyPart = (value?: string) => value?.trim() || ''

export const buildAppStateSnapshotCacheKey = (params: {
  userId: string
  scope: AppStateSnapshotScope
  focus: AppStateSnapshotFocus
}) => [
  normalizeKeyPart(params.userId),
  params.scope,
  normalizeKeyPart(params.focus.taskId),
  normalizeKeyPart(params.focus.workspaceId),
  normalizeKeyPart(params.focus.workspaceSessionId),
].join('|')

export const readAppStateSnapshotCache = (
  cache: Map<string, AppStateSnapshotCacheEntry>,
  key: string,
  now = Date.now(),
) => {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }

  if (entry.updatedAt + APP_STATE_SNAPSHOT_CACHE_TTL_MS <= now) {
    cache.delete(key)
    return null
  }

  cache.delete(key)
  cache.set(key, entry)
  return entry
}

export const writeAppStateSnapshotCache = (
  cache: Map<string, AppStateSnapshotCacheEntry>,
  key: string,
  entry: AppStateSnapshotCacheEntry,
  maxSize = MAX_APP_STATE_SNAPSHOT_CACHE_SIZE,
) => {
  cache.delete(key)
  cache.set(key, entry)

  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
  }
}
