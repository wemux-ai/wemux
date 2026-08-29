// [INPUT]: 未读输入
// [OUTPUT]: 未读契约
// [POS]: 会话未读类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WorkspaceSessionAttentionTone = 'attention' | 'complete' | 'error'
export type WorkspaceSessionAttentionState = Record<string, string>
export type WorkspaceSessionAttentionAckState = Record<string, string>
export type WorkspaceSessionManualUnreadState = Record<string, string>

export type WorkspaceSessionUnreadStoreState = {
  sessionAttentionById: WorkspaceSessionAttentionState
  acknowledgedSessionAttentionById: WorkspaceSessionAttentionAckState
  manuallyUnreadSessionAttentionById: WorkspaceSessionManualUnreadState
}

export type WorkspaceSessionUnreadStoreSnapshot = WorkspaceSessionUnreadStoreState & {
  updatedAt: string
}

const normalizeStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
  )
}

export const createEmptyWorkspaceSessionUnreadStoreState = (): WorkspaceSessionUnreadStoreState => ({
  sessionAttentionById: {},
  acknowledgedSessionAttentionById: {},
  manuallyUnreadSessionAttentionById: {},
})

export const normalizeWorkspaceSessionUnreadStoreState = (
  value?: Partial<WorkspaceSessionUnreadStoreState> | null,
): WorkspaceSessionUnreadStoreState => ({
  sessionAttentionById: normalizeStringRecord(value?.sessionAttentionById),
  acknowledgedSessionAttentionById: normalizeStringRecord(value?.acknowledgedSessionAttentionById),
  manuallyUnreadSessionAttentionById: normalizeStringRecord(value?.manuallyUnreadSessionAttentionById),
})

export const createWorkspaceSessionUnreadStoreSnapshot = (
  state: WorkspaceSessionUnreadStoreState = createEmptyWorkspaceSessionUnreadStoreState(),
  updatedAt = '',
): WorkspaceSessionUnreadStoreSnapshot => ({
  ...normalizeWorkspaceSessionUnreadStoreState(state),
  updatedAt: updatedAt.trim(),
})

export const normalizeWorkspaceSessionUnreadStoreSnapshot = (
  value?: Partial<WorkspaceSessionUnreadStoreSnapshot> | null,
): WorkspaceSessionUnreadStoreSnapshot => {
  const state = normalizeWorkspaceSessionUnreadStoreState(value)
  return createWorkspaceSessionUnreadStoreSnapshot(state, value?.updatedAt)
}

const hasRecordChanged = (
  current: Record<string, string>,
  next: Record<string, string>,
) => {
  const currentKeys = Object.keys(current)
  const nextKeys = Object.keys(next)

  return currentKeys.length !== nextKeys.length || nextKeys.some((key) => current[key] !== next[key])
}

export const hasWorkspaceSessionUnreadStoreStateChanged = (
  current: WorkspaceSessionUnreadStoreState,
  next: WorkspaceSessionUnreadStoreState,
) => {
  return (
    hasRecordChanged(current.sessionAttentionById, next.sessionAttentionById)
    || hasRecordChanged(current.acknowledgedSessionAttentionById, next.acknowledgedSessionAttentionById)
    || hasRecordChanged(current.manuallyUnreadSessionAttentionById, next.manuallyUnreadSessionAttentionById)
  )
}

export const compareWorkspaceSessionUnreadStoreSnapshotUpdatedAt = (
  left: Pick<WorkspaceSessionUnreadStoreSnapshot, 'updatedAt'>,
  right: Pick<WorkspaceSessionUnreadStoreSnapshot, 'updatedAt'>,
) => {
  const leftUpdatedAt = left.updatedAt.trim()
  const rightUpdatedAt = right.updatedAt.trim()

  if (leftUpdatedAt === rightUpdatedAt) {
    return 0
  }

  if (!leftUpdatedAt) {
    return -1
  }

  if (!rightUpdatedAt) {
    return 1
  }

  return leftUpdatedAt.localeCompare(rightUpdatedAt)
}
