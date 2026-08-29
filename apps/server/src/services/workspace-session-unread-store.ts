// [INPUT]: 未读快照请求
// [OUTPUT]: 存取
// [POS]: 会话未读 store
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  compareWorkspaceSessionUnreadStoreSnapshotUpdatedAt,
  createWorkspaceSessionUnreadStoreSnapshot,
  normalizeWorkspaceSessionUnreadStoreSnapshot,
  type WorkspaceSessionUnreadStoreSnapshot,
} from '@shared/workspace-session-unread'
import { getMeta, saveMeta } from '../storage/app-state-store'

const WORKSPACE_SESSION_UNREAD_META_KEY_PREFIX = 'workspace_session_unread_store:'

const buildWorkspaceSessionUnreadMetaKey = (userId: string) => `${WORKSPACE_SESSION_UNREAD_META_KEY_PREFIX}${userId}`

export const mergeWorkspaceSessionUnreadStoreSnapshotForSave = (params: {
  currentSnapshot: WorkspaceSessionUnreadStoreSnapshot
  incomingSnapshot: WorkspaceSessionUnreadStoreSnapshot
}): WorkspaceSessionUnreadStoreSnapshot => {
  return normalizeWorkspaceSessionUnreadStoreSnapshot({
    ...params.incomingSnapshot,
    acknowledgedSessionAttentionById: {
      ...params.currentSnapshot.acknowledgedSessionAttentionById,
      ...params.incomingSnapshot.acknowledgedSessionAttentionById,
    },
  })
}

export const getWorkspaceSessionUnreadStoreSnapshotForUser = (
  userId: string,
) => {
  return normalizeWorkspaceSessionUnreadStoreSnapshot(
    getMeta<WorkspaceSessionUnreadStoreSnapshot | null>(
      buildWorkspaceSessionUnreadMetaKey(userId),
      createWorkspaceSessionUnreadStoreSnapshot(),
    ),
  )
}

export const saveWorkspaceSessionUnreadStoreSnapshotForUser = (
  userId: string,
  snapshot: WorkspaceSessionUnreadStoreSnapshot,
) => {
  const normalizedSnapshot = normalizeWorkspaceSessionUnreadStoreSnapshot(snapshot)
  const currentSnapshot = getWorkspaceSessionUnreadStoreSnapshotForUser(userId)

  if (compareWorkspaceSessionUnreadStoreSnapshotUpdatedAt(normalizedSnapshot, currentSnapshot) < 0) {
    return {
      applied: false,
      snapshot: currentSnapshot,
    }
  }

  const mergedSnapshot = mergeWorkspaceSessionUnreadStoreSnapshotForSave({
    currentSnapshot,
    incomingSnapshot: normalizedSnapshot,
  })

  saveMeta(buildWorkspaceSessionUnreadMetaKey(userId), mergedSnapshot)

  return {
    applied: true,
    snapshot: mergedSnapshot,
  }
}
