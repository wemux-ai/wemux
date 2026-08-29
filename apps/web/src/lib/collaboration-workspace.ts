import type { CollaborationWorkspace } from './api'
import { safeLocalStorageSetItem, safeSessionStorageSetItem } from './browser-storage'

const COLLABORATION_WORKSPACE_STORAGE_KEY = 'vibemux.collaboration-workspace-id'
const COLLABORATION_WORKSPACE_SESSION_STORAGE_KEY = 'vibemux.session.collaboration-workspace-id'

export const COLLABORATION_WORKSPACE_CHANGE_EVENT = 'vibemux:collaboration-workspace-change'

const normalizeWorkspaceId = (workspaceId?: string | null) => workspaceId?.trim() || ''
let inMemoryWorkspaceId = ''

const readStorageValue = (storage: Storage | undefined, key: string) => {
  if (!storage) {
    return ''
  }

  try {
    return normalizeWorkspaceId(storage.getItem(key))
  } catch {
    return ''
  }
}

const removeStorageValue = (storage: Storage | undefined, key: string) => {
  if (!storage) {
    return
  }

  try {
    storage.removeItem(key)
  } catch {
    // Ignore storage cleanup failures so workspace selection keeps working.
  }
}

const persistWorkspaceIdWithFallback = (workspaceId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  if (safeLocalStorageSetItem(COLLABORATION_WORKSPACE_STORAGE_KEY, workspaceId, {
    clearRecoverableLocalStorageOnQuota: true,
  })) {
    removeStorageValue(window.sessionStorage, COLLABORATION_WORKSPACE_SESSION_STORAGE_KEY)
    inMemoryWorkspaceId = workspaceId
    return
  }

  removeStorageValue(window.localStorage, COLLABORATION_WORKSPACE_STORAGE_KEY)
  safeSessionStorageSetItem(COLLABORATION_WORKSPACE_SESSION_STORAGE_KEY, workspaceId)
  inMemoryWorkspaceId = workspaceId
}

export const getStoredCollaborationWorkspaceId = () => {
  if (typeof window === 'undefined') {
    return inMemoryWorkspaceId
  }

  return (
    readStorageValue(window.sessionStorage, COLLABORATION_WORKSPACE_SESSION_STORAGE_KEY)
    || readStorageValue(window.localStorage, COLLABORATION_WORKSPACE_STORAGE_KEY)
    || inMemoryWorkspaceId
  )
}

export const setStoredCollaborationWorkspaceId = (workspaceId?: string | null) => {
  if (typeof window === 'undefined') {
    inMemoryWorkspaceId = normalizeWorkspaceId(workspaceId)
    return
  }

  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
  if (normalizedWorkspaceId) {
    persistWorkspaceIdWithFallback(normalizedWorkspaceId)
  } else {
    removeStorageValue(window.localStorage, COLLABORATION_WORKSPACE_STORAGE_KEY)
    removeStorageValue(window.sessionStorage, COLLABORATION_WORKSPACE_SESSION_STORAGE_KEY)
    inMemoryWorkspaceId = ''
  }

  window.dispatchEvent(new CustomEvent(COLLABORATION_WORKSPACE_CHANGE_EVENT, {
    detail: { workspaceId: normalizedWorkspaceId },
  }))
}

export const resolveCollaborationWorkspaceId = (
  workspaces: CollaborationWorkspace[],
  preferredWorkspaceId?: string | null,
) => {
  const normalizedWorkspaceId = normalizeWorkspaceId(preferredWorkspaceId)
  if (normalizedWorkspaceId && workspaces.some((workspace) => workspace.id === normalizedWorkspaceId)) {
    return normalizedWorkspaceId
  }

  return workspaces[0]?.id || ''
}

export const resolveCollaborationWorkspace = (
  workspaces: CollaborationWorkspace[],
  preferredWorkspaceId?: string | null,
) => {
  const workspaceId = resolveCollaborationWorkspaceId(workspaces, preferredWorkspaceId)
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null
}
