/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Agent 的 Main Chat 会话列表，以及左栏的搜索词与来源筛选。
 * [OUTPUT]: 分成「有内容」与「空会话」两组的可渲染条目，空组默认在 UI 中折叠。
 * [POS]: Agent 详情页会话左栏的纯逻辑层，与渲染解耦以便单测。
 */
import type { MainChatSession } from '@shared/types'

export type AgentSessionSourceKind = 'web' | 'feishu' | 'telegram' | 'channel'
export type AgentSessionSourceFilter = 'all' | AgentSessionSourceKind

export interface AgentSessionListItem {
  session: MainChatSession
  sourceKind: AgentSessionSourceKind
  /** 末条消息摘要；无内容时为空串，由调用方套用 i18n 兜底文案。 */
  preview: string
  isEmpty: boolean
}

export interface GroupedAgentSessions {
  substantive: AgentSessionListItem[]
  empty: AgentSessionListItem[]
  /** 通过搜索与来源筛选的总条数（两组之和）。 */
  totalMatched: number
  hasQuery: boolean
}

export const resolveAgentSessionSourceKind = (session: MainChatSession): AgentSessionSourceKind => {
  if (session.sourceChannel === 'feishu') {
    return 'feishu'
  }

  if (session.sourceChannel === 'telegram') {
    return 'telegram'
  }

  // 其余外部渠道（微信 iLink / Discord / Slack / 企微 / WhatsApp / 钉钉）统一归为「渠道」
  if (session.sourceChannel) {
    return 'channel'
  }

  return 'web'
}

/**
 * 判定一条会话是否「空」。
 *
 * 在新架构下，消息通过 WS 增量订阅 + 游标分页获取，
 * 不再依赖 messagesLoaded 判断是否已加载。
 * 使用 messageCount 和本地消息内容判断。
 */
export const isAgentSessionEmpty = (session: MainChatSession): boolean => {
  if ((session.messageCount ?? 0) > 0) {
    return false
  }

  return !(session.messages ?? []).some((message) => {
    if (message.role === 'user') {
      return true
    }

    return Boolean(message.content?.trim()) || (message.attachments?.length ?? 0) > 0
  })
}

const resolveSessionPreview = (session: MainChatSession): string => {
  const messages = session.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content?.trim()
    if (content) {
      return content
    }
  }

  // Summarized list payloads carry no messages, only the derived preview.
  return session.latestMessagePreview?.trim() ?? ''
}

const matchesSessionQuery = (session: MainChatSession, normalizedQuery: string): boolean => {
  if (!normalizedQuery) {
    return true
  }

  if (session.title.toLowerCase().includes(normalizedQuery)) {
    return true
  }

  // 未加载完的会话只能搜到已有的那部分消息，这是可接受的降级。
  return (session.messages ?? []).some((message) => message.content?.toLowerCase().includes(normalizedQuery))
}

export const groupAgentSessions = ({
  sessions,
  query = '',
  sourceFilter = 'all',
  activeSessionId = '',
}: {
  sessions: MainChatSession[]
  query?: string
  sourceFilter?: AgentSessionSourceFilter
  /** 当前选中的会话永不折叠，避免选中项从列表里消失。 */
  activeSessionId?: string
}): GroupedAgentSessions => {
  const normalizedQuery = query.trim().toLowerCase()
  const substantive: AgentSessionListItem[] = []
  const empty: AgentSessionListItem[] = []

  for (const session of sessions) {
    const sourceKind = resolveAgentSessionSourceKind(session)
    if (sourceFilter !== 'all' && sourceKind !== sourceFilter) {
      continue
    }

    if (!matchesSessionQuery(session, normalizedQuery)) {
      continue
    }

    // 置顶与当前选中的会话始终留在主列表里。
    const pinned = Boolean(session.pinnedAt?.trim())
    const isEmpty = isAgentSessionEmpty(session)
      && !pinned
      && session.id !== activeSessionId

    const item: AgentSessionListItem = {
      session,
      sourceKind,
      preview: resolveSessionPreview(session),
      isEmpty,
    }

    if (isEmpty) {
      empty.push(item)
    } else {
      substantive.push(item)
    }
  }

  return {
    substantive,
    empty,
    totalMatched: substantive.length + empty.length,
    hasQuery: Boolean(normalizedQuery),
  }
}
