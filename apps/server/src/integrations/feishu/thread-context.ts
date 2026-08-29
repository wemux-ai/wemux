// [INPUT]: A Feishu @-mention plus parent/root/thread identifiers and context-message API results.
// [OUTPUT]: A bounded, chronological prompt context and a thread-scoped external conversation identity.
// [POS]: Feishu inbound context enrichment; it never decides whether a message should trigger the Agent.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import type { FeishuAppContextMessage } from './index'

const RECENT_GROUP_CONTEXT_SIZE = 10
const THREAD_CONTEXT_SIZE = 30

export type FeishuThreadContextInput = {
  chatId: string
  chatType: string
  createTime?: string
  messageId: string
  parentId?: string
  rootId?: string
  senderId: string
  text: string
  threadId?: string
}

type FeishuThreadContextClient = {
  getMessage: (messageId: string) => Promise<
    | { ok: true; message: FeishuAppContextMessage }
    | { ok: false; message?: string }
  >
  listMessages: (params: {
    containerId: string
    containerIdType: 'chat' | 'thread'
    endTime?: number
    pageSize: number
  }) => Promise<
    | { ok: true; messages: FeishuAppContextMessage[] }
    | { ok: false; message?: string }
  >
}

const parseText = (content?: string) => {
  if (!content?.trim()) return ''
  try {
    const parsed = JSON.parse(content) as { text?: string }
    return typeof parsed.text === 'string' ? parsed.text.replace(/@_user_\d+/g, '').trim() : ''
  } catch {
    return ''
  }
}

const timestamp = (value?: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const contextMessageId = (message: FeishuAppContextMessage) => message.message_id?.trim() || ''

const renderContextLine = (message: FeishuAppContextMessage) => {
  const text = parseText(message.body?.content)
  if (!text) return ''
  const speaker = message.sender?.sender_type === 'app' ? '机器人' : '群成员'
  return `[${speaker}] ${text}`
}

const getContextScopeId = (input: FeishuThreadContextInput) => (
  input.threadId?.trim() || input.rootId?.trim() || input.parentId?.trim() || ''
)

export const buildFeishuExternalConversationId = (input: FeishuThreadContextInput) => {
  if (input.chatType === 'group' && input.chatId) {
    const scopeId = getContextScopeId(input)
    return scopeId ? `feishu:group:${input.chatId}:thread:${scopeId}` : `feishu:group:${input.chatId}`
  }
  return `feishu:p2p:${input.senderId}`
}

const collectReplyAnchors = async (input: FeishuThreadContextInput, client: FeishuThreadContextClient) => {
  const ids = [...new Set([
    input.rootId?.trim() || '',
    input.parentId?.trim() || '',
  ].filter(Boolean))]
  const results = await Promise.all(ids.map((messageId) => client.getMessage(messageId)))
  return results
    .filter((result): result is { ok: true; message: FeishuAppContextMessage } => result.ok)
    .map((result) => result.message)
    .sort((left, right) => timestamp(left.create_time) - timestamp(right.create_time))
}

export const enrichFeishuThreadContext = async (
  input: FeishuThreadContextInput,
  client: FeishuThreadContextClient,
) => {
  const [ancestors, surrounding] = await Promise.all([
    collectReplyAnchors(input, client),
    input.threadId?.trim()
      ? client.listMessages({
          containerId: input.threadId,
          containerIdType: 'thread',
          endTime: timestamp(input.createTime) / 1_000 || undefined,
          pageSize: THREAD_CONTEXT_SIZE,
        })
      : input.chatType === 'group' && input.chatId
        ? client.listMessages({
            containerId: input.chatId,
            containerIdType: 'chat',
            endTime: timestamp(input.createTime) / 1_000 || undefined,
            pageSize: RECENT_GROUP_CONTEXT_SIZE,
          })
        : Promise.resolve({ ok: true as const, messages: [] }),
  ])
  const ancestorIds = new Set(ancestors.map(contextMessageId).filter(Boolean))
  const surroundingMessages = surrounding.ok
    ? surrounding.messages
      .filter((message) => {
        const messageId = contextMessageId(message)
        return messageId && messageId !== input.messageId && !ancestorIds.has(messageId)
      })
      .sort((left, right) => timestamp(left.create_time) - timestamp(right.create_time))
    : []
  const ancestorLines = ancestors.map(renderContextLine).filter(Boolean)
  const surroundingLines = surroundingMessages.map(renderContextLine).filter(Boolean)
  const blocks = [
    surroundingLines.length > 0
      ? `<feishu_recent_context>\n${surroundingLines.join('\n')}\n</feishu_recent_context>`
      : '',
    ancestorLines.length > 0
      ? `<feishu_reply_chain>\n${ancestorLines.join('\n')}\n</feishu_reply_chain>`
      : '',
    `[当前消息] ${input.text}`,
  ].filter(Boolean)

  return {
    externalConversationId: buildFeishuExternalConversationId(input),
    externalThreadId: getContextScopeId(input) || undefined,
    message: blocks.join('\n\n'),
    replyInThread: Boolean(input.threadId?.trim()),
  }
}
