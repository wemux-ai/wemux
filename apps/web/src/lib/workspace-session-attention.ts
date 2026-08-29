import type { WorkspaceSession } from '@shared/types'
import {
  createWorkspaceSessionUnreadStoreSnapshot,
  normalizeWorkspaceSessionUnreadStoreSnapshot,
  type WorkspaceSessionAttentionAckState,
  type WorkspaceSessionAttentionState,
  type WorkspaceSessionAttentionTone,
  type WorkspaceSessionManualUnreadState,
  type WorkspaceSessionUnreadStoreSnapshot,
  type WorkspaceSessionUnreadStoreState,
} from '@shared/workspace-session-unread'
import { getWorkspaceSessionDisplayStatus } from './workspace-session-status'

const SESSION_ATTENTION_STORAGE_KEY = 'vibemux.workspace.session-attention'
const SESSION_ATTENTION_ACK_STORAGE_KEY = 'vibemux.workspace.session-attention-ack'
const SESSION_MANUAL_UNREAD_STORAGE_KEY = 'vibemux.workspace.session-manual-unread'
const SESSION_UNREAD_STORE_META_STORAGE_KEY = 'vibemux.workspace.session-unread-store-meta'
const WORKSPACE_SESSION_ATTENTION_SYNC_EVENT = 'vibemux:workspace-session-attention-sync'

export type {
  WorkspaceSessionAttentionAckState,
  WorkspaceSessionAttentionState,
  WorkspaceSessionAttentionTone,
  WorkspaceSessionManualUnreadState,
  WorkspaceSessionUnreadStoreSnapshot,
  WorkspaceSessionUnreadStoreState,
} from '@shared/workspace-session-unread'

type WorkspaceSessionAttentionToneInput = Pick<WorkspaceSession, 'agentRunningStatus' | 'needsHumanConfirm' | 'runtimeStatus'>
type WorkspaceSessionAttentionSignatureInput = WorkspaceSessionAttentionToneInput & Pick<WorkspaceSession, 'runtimeSequence' | 'createdAt'> & Partial<Pick<WorkspaceSession, 'lastRuntimeEventAt' | 'runtimeStartedAt'>>
type WorkspaceSessionAttentionInput = WorkspaceSessionAttentionSignatureInput & Pick<WorkspaceSession, 'id'>

export const getWorkspaceSessionAttentionTone = (
  session: WorkspaceSessionAttentionToneInput,
): WorkspaceSessionAttentionTone | null => {
  const displayStatus = getWorkspaceSessionDisplayStatus(session)
  if (displayStatus === 'attention' || displayStatus === 'complete' || displayStatus === 'error') {
    return displayStatus
  }

  return null
}

export const getWorkspaceSessionAttentionSignature = (
  session: WorkspaceSessionAttentionSignatureInput,
) => {
  const tone = getWorkspaceSessionAttentionTone(session)
  if (!tone) {
    return null
  }

  const runtimeSequence = Number.isFinite(session.runtimeSequence) ? session.runtimeSequence : 0
  const lastEventAt = session.lastRuntimeEventAt?.trim()
    || session.runtimeStartedAt?.trim()
    || session.createdAt.trim()

  return `${tone}:${runtimeSequence}:${lastEventAt}`
}

const readWorkspaceSessionStorageRecord = (
  storageKey: string,
) => {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
    )
  } catch {
    return {}
  }
}

export const readWorkspaceSessionAttentionState = (): WorkspaceSessionAttentionState => {
  return readWorkspaceSessionStorageRecord(SESSION_ATTENTION_STORAGE_KEY)
}

const writeWorkspaceSessionStorageState = (
  storageKey: string,
  state: Record<string, string>,
  options: { notify?: boolean } = {},
) => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const previousRaw = window.localStorage.getItem(storageKey)
    const nextRaw = Object.keys(state).length === 0
      ? null
      : JSON.stringify(state)

    if (previousRaw === nextRaw) {
      return false
    }

    if (nextRaw === null) {
      window.localStorage.removeItem(storageKey)
    } else {
      window.localStorage.setItem(storageKey, nextRaw)
    }

    if (options.notify !== false) {
      notifyWorkspaceSessionAttentionSync()
    }
    return true
  } catch {
    // Ignore storage failures so the session list stays interactive.
    return false
  }
}

export const writeWorkspaceSessionAttentionState = (
  state: WorkspaceSessionAttentionState,
) => {
  writeWorkspaceSessionStorageState(SESSION_ATTENTION_STORAGE_KEY, state)
}

export const readWorkspaceSessionAttentionAckState = (): WorkspaceSessionAttentionAckState => {
  return readWorkspaceSessionStorageRecord(SESSION_ATTENTION_ACK_STORAGE_KEY)
}

export const writeWorkspaceSessionAttentionAckState = (
  state: WorkspaceSessionAttentionAckState,
) => {
  writeWorkspaceSessionStorageState(SESSION_ATTENTION_ACK_STORAGE_KEY, state)
}

export const readWorkspaceSessionManualUnreadState = (): WorkspaceSessionManualUnreadState => {
  return readWorkspaceSessionStorageRecord(SESSION_MANUAL_UNREAD_STORAGE_KEY)
}

export const writeWorkspaceSessionManualUnreadState = (
  state: WorkspaceSessionManualUnreadState,
) => {
  writeWorkspaceSessionStorageState(SESSION_MANUAL_UNREAD_STORAGE_KEY, state)
}

const readWorkspaceSessionUnreadStoreUpdatedAt = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const raw = window.localStorage.getItem(SESSION_UNREAD_STORE_META_STORAGE_KEY)
    if (!raw) {
      return ''
    }

    const parsed = JSON.parse(raw) as { updatedAt?: unknown }
    return typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : ''
  } catch {
    return ''
  }
}

const writeWorkspaceSessionUnreadStoreUpdatedAt = (
  updatedAt: string,
  options: { notify?: boolean } = {},
) => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const previousRaw = window.localStorage.getItem(SESSION_UNREAD_STORE_META_STORAGE_KEY)
    const nextUpdatedAt = updatedAt.trim()
    const nextRaw = nextUpdatedAt
      ? JSON.stringify({ updatedAt: nextUpdatedAt })
      : null

    if (previousRaw === nextRaw) {
      return false
    }

    if (nextRaw === null) {
      window.localStorage.removeItem(SESSION_UNREAD_STORE_META_STORAGE_KEY)
    } else {
      window.localStorage.setItem(SESSION_UNREAD_STORE_META_STORAGE_KEY, nextRaw)
    }

    if (options.notify !== false) {
      notifyWorkspaceSessionAttentionSync()
    }
    return true
  } catch {
    return false
  }
}

export const readWorkspaceSessionUnreadStoreState = (): WorkspaceSessionUnreadStoreState => ({
  sessionAttentionById: readWorkspaceSessionAttentionState(),
  acknowledgedSessionAttentionById: readWorkspaceSessionAttentionAckState(),
  manuallyUnreadSessionAttentionById: readWorkspaceSessionManualUnreadState(),
})

export const readWorkspaceSessionUnreadStoreSnapshot = (): WorkspaceSessionUnreadStoreSnapshot => {
  const snapshot = createWorkspaceSessionUnreadStoreSnapshot(
    readWorkspaceSessionUnreadStoreState(),
    readWorkspaceSessionUnreadStoreUpdatedAt(),
  )

  return normalizeWorkspaceSessionUnreadStoreSnapshot(snapshot)
}

export const writeWorkspaceSessionUnreadStoreSnapshot = (
  snapshot: WorkspaceSessionUnreadStoreSnapshot,
) => {
  const normalizedSnapshot = normalizeWorkspaceSessionUnreadStoreSnapshot(snapshot)
  const didChange = [
    writeWorkspaceSessionStorageState(SESSION_ATTENTION_STORAGE_KEY, normalizedSnapshot.sessionAttentionById, { notify: false }),
    writeWorkspaceSessionStorageState(SESSION_ATTENTION_ACK_STORAGE_KEY, normalizedSnapshot.acknowledgedSessionAttentionById, { notify: false }),
    writeWorkspaceSessionStorageState(SESSION_MANUAL_UNREAD_STORAGE_KEY, normalizedSnapshot.manuallyUnreadSessionAttentionById, { notify: false }),
    writeWorkspaceSessionUnreadStoreUpdatedAt(normalizedSnapshot.updatedAt, { notify: false }),
  ].some(Boolean)

  if (didChange) {
    notifyWorkspaceSessionAttentionSync()
  }
}

const notifyWorkspaceSessionAttentionSync = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(WORKSPACE_SESSION_ATTENTION_SYNC_EVENT))
}

export const subscribeWorkspaceSessionAttentionSync = (listener: () => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleSync = () => {
    listener()
  }
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === SESSION_ATTENTION_STORAGE_KEY
      || event.key === SESSION_ATTENTION_ACK_STORAGE_KEY
      || event.key === SESSION_MANUAL_UNREAD_STORAGE_KEY
      || event.key === SESSION_UNREAD_STORE_META_STORAGE_KEY
    ) {
      listener()
    }
  }

  window.addEventListener(WORKSPACE_SESSION_ATTENTION_SYNC_EVENT, handleSync)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(WORKSPACE_SESSION_ATTENTION_SYNC_EVENT, handleSync)
    window.removeEventListener('storage', handleStorage)
  }
}

export type WorkspaceSessionUnreadOptions = {
  sessionAttentionById?: WorkspaceSessionAttentionState
  acknowledgedSessionAttentionById?: WorkspaceSessionAttentionAckState
  manuallyUnreadSessionAttentionById?: WorkspaceSessionManualUnreadState
}

export const getWorkspaceSessionUnreadTone = (
  session: WorkspaceSessionAttentionInput,
  options: WorkspaceSessionUnreadOptions = {},
): WorkspaceSessionAttentionTone | null => {
  const attentionSignature = getWorkspaceSessionAttentionSignature(session)
  const attentionTone = getWorkspaceSessionAttentionTone(session)
  if (!attentionSignature || !attentionTone) {
    return null
  }

  if (options.manuallyUnreadSessionAttentionById?.[session.id] === attentionSignature) {
    return attentionTone
  }

  if (options.acknowledgedSessionAttentionById?.[session.id] === attentionSignature) {
    return null
  }

  if (attentionTone === 'attention' || attentionTone === 'error') {
    return attentionTone
  }

  const storedAttentionSignature = options.sessionAttentionById?.[session.id]
  if (storedAttentionSignature === attentionSignature || storedAttentionSignature === attentionTone) {
    return attentionTone
  }

  return null
}

export const isWorkspaceSessionUnread = (
  session: WorkspaceSessionAttentionInput,
  options: WorkspaceSessionUnreadOptions = {},
) => {
  return getWorkspaceSessionUnreadTone(session, options) !== null
}

export const markWorkspaceSessionUnread = (
  session: WorkspaceSessionAttentionInput,
) => {
  const attentionSignature = getWorkspaceSessionAttentionSignature(session)
  if (!attentionSignature) {
    return false
  }

  const currentSnapshot = readWorkspaceSessionUnreadStoreSnapshot()
  if (currentSnapshot.manuallyUnreadSessionAttentionById[session.id] === attentionSignature) {
    return true
  }

  const nextManualUnreadState = {
    ...currentSnapshot.manuallyUnreadSessionAttentionById,
    [session.id]: attentionSignature,
  }

  writeWorkspaceSessionUnreadStoreSnapshot({
    ...currentSnapshot,
    manuallyUnreadSessionAttentionById: nextManualUnreadState,
    updatedAt: new Date().toISOString(),
  })

  return true
}

export const markWorkspaceSessionRead = (
  session: WorkspaceSessionAttentionInput,
) => {
  const currentSnapshot = readWorkspaceSessionUnreadStoreSnapshot()
  const currentSessionAttention = currentSnapshot.sessionAttentionById[session.id]
  const currentAcknowledgedAttention = currentSnapshot.acknowledgedSessionAttentionById[session.id]
  const currentManualUnreadAttention = currentSnapshot.manuallyUnreadSessionAttentionById[session.id]
  const attentionSignature = getWorkspaceSessionAttentionSignature(session)

  if (!attentionSignature) {
    if (!currentSessionAttention && !currentAcknowledgedAttention && !currentManualUnreadAttention) {
      return false
    }

    const nextSessionAttentionState = { ...currentSnapshot.sessionAttentionById }
    const nextAcknowledgedState = { ...currentSnapshot.acknowledgedSessionAttentionById }
    const nextManualUnreadState = { ...currentSnapshot.manuallyUnreadSessionAttentionById }

    delete nextSessionAttentionState[session.id]
    delete nextAcknowledgedState[session.id]
    delete nextManualUnreadState[session.id]

    writeWorkspaceSessionUnreadStoreSnapshot({
      ...currentSnapshot,
      sessionAttentionById: nextSessionAttentionState,
      acknowledgedSessionAttentionById: nextAcknowledgedState,
      manuallyUnreadSessionAttentionById: nextManualUnreadState,
      updatedAt: new Date().toISOString(),
    })
    return true
  }

  if (
    currentSessionAttention === undefined
    && currentAcknowledgedAttention === attentionSignature
    && currentManualUnreadAttention === undefined
  ) {
    return false
  }

  const nextSessionAttentionState = { ...currentSnapshot.sessionAttentionById }
  const nextAcknowledgedState = {
    ...currentSnapshot.acknowledgedSessionAttentionById,
    [session.id]: attentionSignature,
  }
  const nextManualUnreadState = { ...currentSnapshot.manuallyUnreadSessionAttentionById }

  delete nextSessionAttentionState[session.id]
  delete nextManualUnreadState[session.id]

  writeWorkspaceSessionUnreadStoreSnapshot({
    ...currentSnapshot,
    sessionAttentionById: nextSessionAttentionState,
    acknowledgedSessionAttentionById: nextAcknowledgedState,
    manuallyUnreadSessionAttentionById: nextManualUnreadState,
    updatedAt: new Date().toISOString(),
  })

  return true
}
