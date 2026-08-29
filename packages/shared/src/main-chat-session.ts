// [INPUT]: 主聊天会话输入
// [OUTPUT]: 会话契约
// [POS]: 主聊天会话类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AppState } from './types/app-state'
import type { MainChatSession } from './types/task-domain'

const DEFAULT_MAIN_CHAT_SESSION_PREVIEW_MESSAGES = 1
const DEFAULT_MAIN_CHAT_SESSION_PREVIEW_CONTENT_LENGTH = 600
const MAIN_CHAT_SESSION_LATEST_PREVIEW_LENGTH = 140
const normalizePinnedAt = (value?: string | null) => value?.trim() || undefined

/**
 * Single-line preview of the newest user/assistant message. Kept short because
 * it ships for every session in list payloads, including summarized ones that
 * carry no messages at all.
 */
export const buildMainChatSessionLatestPreview = (
  session: Pick<MainChatSession, 'messages'>,
  maxLength = MAIN_CHAT_SESSION_LATEST_PREVIEW_LENGTH,
) => {
  const messages = session.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue
    }

    const normalized = message.content.replace(/\s+/g, ' ').trim()
    if (normalized) {
      return normalized.length <= maxLength
        ? normalized
        : `${normalized.slice(0, maxLength).trimEnd()}...`
    }
  }

  return ''
}

const truncateMainChatPreviewContent = (content: string, maxLength: number) => {
  if (content.length <= maxLength) {
    return content
  }

  return `${content.slice(0, maxLength).trimEnd()}...`
}

export const summarizeMainChatSession = (
  session: MainChatSession,
  options?: {
    previewMessages?: number
    previewContentLength?: number
  },
): MainChatSession => {
  const previewMessages = Math.max(0, options?.previewMessages ?? DEFAULT_MAIN_CHAT_SESSION_PREVIEW_MESSAGES)
  const previewContentLength = Math.max(80, options?.previewContentLength ?? DEFAULT_MAIN_CHAT_SESSION_PREVIEW_CONTENT_LENGTH)
  const messages = session.messages ?? []
  const messageCount = messages.length
  const latestMessagePreview = buildMainChatSessionLatestPreview(session)
  const { messages: _messages, ...sessionWithoutMessages } = session

  if (previewMessages === 0) {
    return {
      ...sessionWithoutMessages,
      messagesLoaded: messageCount === 0,
      messageCount,
      latestMessagePreview,
    }
  }

  if (messageCount <= previewMessages) {
    return {
      ...session,
      messagesLoaded: true,
      messageCount,
      latestMessagePreview,
    }
  }

  return {
    ...sessionWithoutMessages,
    latestMessagePreview,
    messages: messages.slice(-previewMessages).map((message) => ({
      ...message,
      content: truncateMainChatPreviewContent(message.content, previewContentLength),
      attachments: undefined,
      reasoning: undefined,
      toolCalls: undefined,
    })),
    messagesLoaded: false,
    messageCount,
  }
}

export const summarizeMainChatSessions = (
  sessions: MainChatSession[],
  options?: Parameters<typeof summarizeMainChatSession>[1],
) => sessions.map((session) => summarizeMainChatSession(session, options))

export const summarizeMainChatSessionsInState = <T extends Pick<AppState, 'mainChatSessions' | 'selectedMainChatSessionId'> & object>(
  state: T,
  options?: Parameters<typeof summarizeMainChatSession>[1],
): T => {
  const summarizedSessions = summarizeMainChatSessions(state.mainChatSessions, options)
  return {
    ...state,
    mainChatSessions: summarizedSessions,
  } as T
}

export const isMainChatSessionPinned = (session: Pick<MainChatSession, 'pinnedAt'>) => {
  return Boolean(normalizePinnedAt(session.pinnedAt))
}

/**
 * 判断主聊天会话是否属于指定组织。
 * - session.workspaceId 有值 → 必须匹配该 workspace。
 * - session.workspaceId 为空（老数据 / 外部渠道私人会话）→ 全局兼容，任何 workspace 可见。
 */
export const isMainChatSessionVisibleInWorkspace = (
  session: Pick<MainChatSession, 'workspaceId'>,
  workspaceId?: string,
) => {
  const normalizedWorkspaceId = workspaceId?.trim()
  if (!normalizedWorkspaceId) {
    return true
  }

  const sessionWorkspaceId = session.workspaceId?.trim()
  return !sessionWorkspaceId || sessionWorkspaceId === normalizedWorkspaceId
}

export const setMainChatSessionPinned = <T extends Pick<MainChatSession, 'pinnedAt'> & object>(
  session: T,
  pinned: boolean,
  pinnedAt = new Date().toISOString(),
): T => {
  const currentPinnedAt = normalizePinnedAt(session.pinnedAt)
  // 清除时必须返回 null（而非 undefined）：HTTP/WS 序列化会丢掉 undefined 键，
  // 前端 replaceEqualDeep 会把缺失键当作「未变更」而保留旧值，导致取消置顶不生效。
  const nextPinnedAt = pinned ? currentPinnedAt ?? pinnedAt : null
  if (currentPinnedAt === nextPinnedAt) {
    return session
  }

  return {
    ...session,
    pinnedAt: nextPinnedAt,
  } as T
}

export const sortMainChatSessions = <T extends Pick<MainChatSession, 'pinnedAt'>>(
  sessions: readonly T[],
): T[] => {
  return sessions
    .map((session, index) => ({
      session,
      index,
      pinnedAt: normalizePinnedAt(session.pinnedAt),
    }))
    .sort((left, right) => {
      const leftPinned = Boolean(left.pinnedAt)
      const rightPinned = Boolean(right.pinnedAt)
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1
      }

      if (leftPinned && rightPinned) {
        const pinnedCompare = right.pinnedAt!.localeCompare(left.pinnedAt!)
        if (pinnedCompare !== 0) {
          return pinnedCompare
        }
      }

      return left.index - right.index
    })
    .map(({ session }) => session)
}

export const normalizeMainChatSessionState = <T extends Pick<AppState, 'mainChatSessions'> & object>(
  state: T,
): T => {
  const sortedSessions = sortMainChatSessions(state.mainChatSessions)
  const unchanged = sortedSessions.length === state.mainChatSessions.length
    && sortedSessions.every((session, index) => session === state.mainChatSessions[index])

  if (unchanged) {
    return state
  }

  return {
    ...state,
    mainChatSessions: [...sortedSessions],
  } as T
}
