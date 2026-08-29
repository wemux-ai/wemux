/**
 * [INPUT]: 飞书事件回调 / Discord interaction 的原始 payload
 * [OUTPUT]: 反馈意图（FeedbackIngestInput 主体）或 null（非反馈消息）
 * [POS]: 渠道入站解析层——平台事件 → 统一反馈意图；纯函数可测，不依赖网络/DB
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { FeedbackOriginRef, FeedbackSource, FeedbackType } from '@shared/types'

export type ChannelFeedbackIntent = {
  source: FeedbackSource
  originRef: FeedbackOriginRef
  type: FeedbackType
  title: string
  body: string
}

/** 飞书消息事件里 content 是 JSON 字符串（{"text":"..."}）。 */
const parseFeishuTextContent = (content?: string): string => {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as { text?: string }
    return typeof parsed.text === 'string' ? parsed.text : ''
  } catch {
    return content
  }
}

const buildTitleFromBody = (body: string): string => {
  const firstLine = body.split('\n')[0]?.trim() ?? ''
  return firstLine.slice(0, 80) || '（飞书反馈）'
}

/**
 * 飞书 im.message.receive_v1 事件 → 反馈意图。
 * 规则：私聊（p2p）消息全收；群聊仅收以「反馈/feedback」开头的消息，避免闲聊污染收件箱。
 */
export const extractFeishuFeedbackIntent = (event: {
  header?: { event_type?: string }
  event?: {
    message?: {
      message_id?: string
      chat_id?: string
      chat_type?: string
      content?: string
      sender?: { id?: string }
    }
    sender?: { sender_id?: { open_id?: string }; sender_type?: string }
  }
}): ChannelFeedbackIntent | null => {
  if (event.header?.event_type !== 'im.message.receive_v1') return null
  const message = event.event?.message
  if (!message?.message_id || !message.chat_id) return null

  const chatType = message.chat_type ?? ''
  const text = parseFeishuTextContent(message.content).trim()
  if (!text) return null

  const isP2p = chatType === 'p2p'
  const feedbackPrefixed = /^(反馈|feedback)[:：\s]/i.test(text)
  if (!isP2p && !feedbackPrefixed) return null

  const body = isP2p ? text : text.replace(/^(反馈|feedback)[:：\s]/i, '').trim()
  if (!body) return null

  const openId = message.sender?.id ?? event.event?.sender?.sender_id?.open_id
  return {
    source: 'feishu',
    originRef: { channel: message.chat_id, messageId: message.message_id, senderName: openId },
    type: 'feature',
    title: buildTitleFromBody(body),
    body,
  }
}

export type DiscordInteraction = {
  type?: number
  id?: string
  token?: string
  member?: { user?: { username?: string } }
  data?: {
    name?: string
    options?: Array<{ name?: string; value?: string | number }>
  }
}

/** Discord interaction → 反馈意图。目前支持 /feedback 斜杠命令（title/body/type 三个 option）。 */
export const extractDiscordFeedbackIntent = (interaction: DiscordInteraction): ChannelFeedbackIntent | null => {
  if (interaction.type !== 2) return null // APPLICATION_COMMAND
  if (interaction.data?.name !== 'feedback') return null

  const options: Record<string, string> = {}
  for (const option of interaction.data?.options ?? []) {
    if (option.name && typeof option.value === 'string') {
      options[option.name] = option.value
    }
  }

  const body = (options.body ?? '').trim()
  if (!body) return null

  const rawType = (options.type ?? '').toLowerCase()
  const type: FeedbackType = rawType === 'bug' ? 'bug' : rawType === 'chat' ? 'chat' : 'feature'
  const title = (options.title ?? '').trim().slice(0, 200) || buildTitleFromBody(body)

  return {
    source: 'discord',
    originRef: {
      channel: interaction.id ?? 'discord',
      messageId: interaction.token ?? `interaction-${interaction.id ?? 'unknown'}`,
      senderName: interaction.member?.user?.username,
    },
    type,
    title,
    body,
  }
}
