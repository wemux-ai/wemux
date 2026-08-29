const STORAGE_KEY = 'vibemux.workspace-group-chat.preferences'

export type WorkspaceGroupChatTargetPreference = {
  kind: 'agent' | 'group' | 'dm'
  id: string
}

export type PersistedWorkspaceGroupChatPreferences = {
  workspaceId?: string
  selectedTarget?: WorkspaceGroupChatTargetPreference
  groupsByWorkspaceId: Record<string, string>
  sessionsByGroupId: Record<string, string>
  readMessageCountsBySessionId: Record<string, number>
}

const createEmptyPreferences = (): PersistedWorkspaceGroupChatPreferences => ({
  groupsByWorkspaceId: {},
  sessionsByGroupId: {},
  readMessageCountsBySessionId: {},
})

const normalizeId = (value?: string | null) => value?.trim() || ''

const normalizeTarget = (value: unknown): WorkspaceGroupChatTargetPreference | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const kind = 'kind' in value ? value.kind : undefined
  const id = 'id' in value ? value.id : undefined
  if ((kind !== 'agent' && kind !== 'group' && kind !== 'dm') || typeof id !== 'string') {
    return undefined
  }

  const normalizedId = normalizeId(id)
  if (!normalizedId) {
    return undefined
  }

  return {
    kind,
    id: normalizedId,
  }
}

const normalizeRecord = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  return Object.entries(value).reduce<Record<string, string>>((result, [key, rawValue]) => {
    const normalizedKey = normalizeId(key)
    const normalizedValue = typeof rawValue === 'string' ? normalizeId(rawValue) : ''
    if (!normalizedKey || !normalizedValue) {
      return result
    }

    result[normalizedKey] = normalizedValue
    return result
  }, {})
}

const normalizeMessageCountRecord = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  return Object.entries(value).reduce<Record<string, number>>((result, [key, rawValue]) => {
    const normalizedKey = normalizeId(key)
    const normalizedValue = typeof rawValue === 'number' && Number.isFinite(rawValue)
      ? Math.max(0, Math.floor(rawValue))
      : -1
    if (!normalizedKey || normalizedValue < 0) {
      return result
    }

    result[normalizedKey] = normalizedValue
    return result
  }, {})
}

export const readWorkspaceGroupChatPreferences = (): PersistedWorkspaceGroupChatPreferences => {
  if (typeof window === 'undefined') {
    return createEmptyPreferences()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createEmptyPreferences()
    }

    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceGroupChatPreferences>
    return {
      workspaceId: typeof parsed.workspaceId === 'string' ? normalizeId(parsed.workspaceId) || undefined : undefined,
      selectedTarget: normalizeTarget(parsed.selectedTarget),
      groupsByWorkspaceId: normalizeRecord(parsed.groupsByWorkspaceId),
      sessionsByGroupId: normalizeRecord(parsed.sessionsByGroupId),
      readMessageCountsBySessionId: normalizeMessageCountRecord(parsed.readMessageCountsBySessionId),
    }
  } catch {
    return createEmptyPreferences()
  }
}

export const writeWorkspaceGroupChatPreferences = (preferences: PersistedWorkspaceGroupChatPreferences) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Ignore storage failures so the group chat UI stays interactive.
  }
}

export const getPersistedWorkspaceGroupId = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  workspaceId?: string,
) => {
  const normalizedWorkspaceId = normalizeId(workspaceId)
  if (!normalizedWorkspaceId) {
    return ''
  }

  return preferences.groupsByWorkspaceId[normalizedWorkspaceId] || ''
}

export const getPersistedWorkspaceGroupSessionId = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  groupId?: string,
) => {
  const normalizedGroupId = normalizeId(groupId)
  if (!normalizedGroupId) {
    return ''
  }

  return preferences.sessionsByGroupId[normalizedGroupId] || ''
}

export const setPersistedWorkspaceGroupChatWorkspace = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  workspaceId?: string,
) => {
  const normalizedWorkspaceId = normalizeId(workspaceId)
  const nextWorkspaceId = normalizedWorkspaceId || undefined
  if (preferences.workspaceId === nextWorkspaceId) {
    return preferences
  }

  return {
    ...preferences,
    workspaceId: nextWorkspaceId,
  }
}

export const setPersistedWorkspaceGroupChatTarget = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  target?: WorkspaceGroupChatTargetPreference | null,
) => {
  const normalizedTarget = normalizeTarget(target)
  if (
    preferences.selectedTarget?.kind === normalizedTarget?.kind
    && preferences.selectedTarget?.id === normalizedTarget?.id
  ) {
    return preferences
  }

  return {
    ...preferences,
    selectedTarget: normalizedTarget,
  }
}

export const setPersistedWorkspaceGroupChatGroup = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  workspaceId?: string,
  groupId?: string,
) => {
  const normalizedWorkspaceId = normalizeId(workspaceId)
  const normalizedGroupId = normalizeId(groupId)
  if (!normalizedWorkspaceId || !normalizedGroupId) {
    return preferences
  }

  if (preferences.groupsByWorkspaceId[normalizedWorkspaceId] === normalizedGroupId) {
    return preferences
  }

  return {
    ...preferences,
    groupsByWorkspaceId: {
      ...preferences.groupsByWorkspaceId,
      [normalizedWorkspaceId]: normalizedGroupId,
    },
  }
}

export const setPersistedWorkspaceGroupChatSession = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  groupId?: string,
  sessionId?: string,
) => {
  const normalizedGroupId = normalizeId(groupId)
  const normalizedSessionId = normalizeId(sessionId)
  if (!normalizedGroupId || !normalizedSessionId) {
    return preferences
  }

  if (preferences.sessionsByGroupId[normalizedGroupId] === normalizedSessionId) {
    return preferences
  }

  return {
    ...preferences,
    sessionsByGroupId: {
      ...preferences.sessionsByGroupId,
      [normalizedGroupId]: normalizedSessionId,
    },
  }
}

export const getPersistedWorkspaceGroupChatUnreadCount = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  sessionId?: string,
  messageCount = 0,
) => {
  const normalizedSessionId = normalizeId(sessionId)
  if (!normalizedSessionId) {
    return 0
  }

  const readMessageCount = preferences.readMessageCountsBySessionId[normalizedSessionId]
  if (typeof readMessageCount !== 'number') {
    return 0
  }

  return Math.max(0, Math.floor(messageCount) - readMessageCount)
}

export const setPersistedWorkspaceGroupChatSessionReadMessageCount = (
  preferences: PersistedWorkspaceGroupChatPreferences,
  sessionId?: string,
  messageCount = 0,
) => {
  const normalizedSessionId = normalizeId(sessionId)
  const normalizedMessageCount = Number.isFinite(messageCount) ? Math.max(0, Math.floor(messageCount)) : 0
  if (!normalizedSessionId || preferences.readMessageCountsBySessionId[normalizedSessionId] === normalizedMessageCount) {
    return preferences
  }

  return {
    ...preferences,
    readMessageCountsBySessionId: {
      ...preferences.readMessageCountsBySessionId,
      [normalizedSessionId]: normalizedMessageCount,
    },
  }
}
