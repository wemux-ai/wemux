import { isWorkspaceOpenTarget, type WorkspaceOpenTarget } from '@shared/workspace-open-command'
import { safeLocalStorageSetItem, safeSessionStorageSetItem } from './browser-storage'

const WORKSPACE_OPEN_TARGET_STORAGE_KEY = 'vibemux.workspace-open.last-target'
const WORKSPACE_OPEN_TARGET_SESSION_STORAGE_KEY = 'vibemux.session.workspace-open.last-target'

let inMemoryWorkspaceOpenTarget = ''

const normalizeWorkspaceOpenTarget = (target?: string | null) => {
  const normalizedTarget = target?.trim() || ''
  return isWorkspaceOpenTarget(normalizedTarget) ? normalizedTarget : ''
}

const readStorageValue = (storage: Storage | undefined, key: string) => {
  if (!storage) {
    return ''
  }

  try {
    return normalizeWorkspaceOpenTarget(storage.getItem(key))
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
    // Ignore storage cleanup failures so the toolbar stays interactive.
  }
}

const persistWorkspaceOpenTargetWithFallback = (target: WorkspaceOpenTarget) => {
  if (typeof window === 'undefined') {
    inMemoryWorkspaceOpenTarget = target
    return
  }

  if (safeLocalStorageSetItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY, target, {
    clearRecoverableLocalStorageOnQuota: true,
  })) {
    removeStorageValue(window.sessionStorage, WORKSPACE_OPEN_TARGET_SESSION_STORAGE_KEY)
    inMemoryWorkspaceOpenTarget = target
    return
  }

  removeStorageValue(window.localStorage, WORKSPACE_OPEN_TARGET_STORAGE_KEY)
  safeSessionStorageSetItem(WORKSPACE_OPEN_TARGET_SESSION_STORAGE_KEY, target)
  inMemoryWorkspaceOpenTarget = target
}

export const getStoredWorkspaceOpenTarget = (fallbackTarget: WorkspaceOpenTarget) => {
  const storedTarget = typeof window === 'undefined'
    ? inMemoryWorkspaceOpenTarget
    : (
        readStorageValue(window.sessionStorage, WORKSPACE_OPEN_TARGET_SESSION_STORAGE_KEY)
        || readStorageValue(window.localStorage, WORKSPACE_OPEN_TARGET_STORAGE_KEY)
        || inMemoryWorkspaceOpenTarget
      )

  return normalizeWorkspaceOpenTarget(storedTarget) || fallbackTarget
}

export const setStoredWorkspaceOpenTarget = (target?: WorkspaceOpenTarget | null) => {
  const normalizedTarget = normalizeWorkspaceOpenTarget(target)

  if (typeof window === 'undefined') {
    inMemoryWorkspaceOpenTarget = normalizedTarget
    return
  }

  if (normalizedTarget) {
    persistWorkspaceOpenTargetWithFallback(normalizedTarget)
    return
  }

  removeStorageValue(window.localStorage, WORKSPACE_OPEN_TARGET_STORAGE_KEY)
  removeStorageValue(window.sessionStorage, WORKSPACE_OPEN_TARGET_SESSION_STORAGE_KEY)
  inMemoryWorkspaceOpenTarget = ''
}
