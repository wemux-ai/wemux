// [INPUT]: 会话切换上下文
// [OUTPUT]: handoff 摘要（近期消息/摘要）
// [POS]: 会话 handoff 摘要构建
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ConversationHandoffSnapshot, ConversationMessageRecord } from '@shared/types'

const HANDOFF_RECENT_MESSAGE_LIMIT = 6
const HANDOFF_SUMMARY_LINE_LIMIT = 4
const HANDOFF_PROMPT_CONTENT_LIMIT = 1200

type HandoffMessage = {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

type TaskConversationMessage = {
  role: ConversationMessageRecord['role']
  content: string
  createdAt: string
}

const normalizePromptContent = (content: string, limit = HANDOFF_PROMPT_CONTENT_LIMIT) => {
  const normalized = content.trim().replace(/\s+/g, ' ')
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}

const formatHistoryMessage = (message: Pick<HandoffMessage, 'role' | 'content'>, prefix?: string) => {
  const label = message.role === 'user' ? '用户' : '助手'
  const normalizedPrefix = prefix?.trim()
  return `${normalizedPrefix ? `${normalizedPrefix}${label}` : label}：${normalizePromptContent(message.content)}`
}

const mergeConsecutiveMessages = (messages: HandoffMessage[]) => {
  return messages.reduce<HandoffMessage[]>((result, message) => {
    const normalizedContent = normalizePromptContent(message.content)
    if (!normalizedContent) {
      return result
    }

    const previous = result.at(-1)
    if (previous?.role === message.role) {
      previous.content = normalizePromptContent(`${previous.content}\n${normalizedContent}`)
      previous.createdAt = message.createdAt
      return result
    }

    result.push({
      role: message.role,
      content: normalizedContent,
      createdAt: message.createdAt,
    })
    return result
  }, [])
}

export const buildConversationHandoffSnapshot = (messages?: HandoffMessage[]): ConversationHandoffSnapshot | undefined => {
  const normalizedMessages = mergeConsecutiveMessages(
    (messages ?? []).filter((message) => message.content.trim() && message.createdAt.trim()),
  )

  if (normalizedMessages.length === 0) {
    return undefined
  }

  const recentMessages = normalizedMessages.slice(-HANDOFF_RECENT_MESSAGE_LIMIT).map((message) => ({
    role: message.role,
    content: normalizePromptContent(message.content),
    createdAt: message.createdAt,
  }))
  const summarySource = normalizedMessages
    .slice(0, Math.max(0, normalizedMessages.length - HANDOFF_RECENT_MESSAGE_LIMIT))
    .slice(-HANDOFF_SUMMARY_LINE_LIMIT)
  const latestUserMessage = normalizedMessages
    .slice()
    .reverse()
    .find((message) => message.role === 'user')
  const latestAssistantMessage = normalizedMessages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant')

  return {
    updatedAt: normalizedMessages.at(-1)?.createdAt ?? new Date().toISOString(),
    messageCount: normalizedMessages.length,
    latestUserMessage: latestUserMessage ? normalizePromptContent(latestUserMessage.content) : undefined,
    latestAssistantMessage: latestAssistantMessage ? normalizePromptContent(latestAssistantMessage.content) : undefined,
    summaryLines: summarySource.map((message) => formatHistoryMessage(message, '较早')),
    recentMessages,
  }
}

export const buildTaskConversationHandoffSnapshot = (
  messages?: TaskConversationMessage[],
): ConversationHandoffSnapshot | undefined => {
  const normalizedMessages = (messages ?? []).flatMap<HandoffMessage>((message) => {
    if (message.role === 'user') {
      return [{
        role: 'user',
        content: message.content,
        createdAt: message.createdAt,
      }]
    }

    if (message.role === 'assistant') {
      return [{
        role: 'assistant',
        content: message.content,
        createdAt: message.createdAt,
      }]
    }

    return []
  })

  return buildConversationHandoffSnapshot(normalizedMessages)
}

export const buildConversationHandoffPromptSection = (handoffSnapshot?: ConversationHandoffSnapshot) => {
  if (!handoffSnapshot) {
    return ''
  }

  const sections: string[] = []
  if (handoffSnapshot.summaryLines.length > 0) {
    sections.push('--- 较早对话摘要 ---', ...handoffSnapshot.summaryLines)
  }
  if (handoffSnapshot.recentMessages.length > 0) {
    sections.push('--- 最近对话 ---', ...handoffSnapshot.recentMessages.map((message) => formatHistoryMessage(message)))
  }

  return sections.join('\n')
}

export const buildUserMessagePromptWithHandoff = (
  message: string,
  handoffSnapshot?: ConversationHandoffSnapshot,
) => {
  const historySection = buildConversationHandoffPromptSection(handoffSnapshot)
  if (!historySection) {
    return message
  }

  return [
    historySection,
    '',
    `用户消息：${message}`,
  ].join('\n')
}
