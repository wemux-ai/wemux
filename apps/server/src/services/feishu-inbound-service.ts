// [INPUT]: A normalized Feishu message event from HTTP callback or long connection.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical Feishu inbound orchestration; transports only decode and forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import { readCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../integrations/agent/service'
import {
  addFeishuMessageReaction,
  deleteFeishuMessageReaction,
  getFeishuAppContextMessage,
  getFeishuBotOpenId,
  listFeishuAppContextMessages,
  patchFeishuAppInteractiveCard,
  replyFeishuAppInteractiveCard,
  replyFeishuAppTextMessage,
} from '../integrations/feishu'
import { buildFeishuReplyCard, createFeishuReplyCardUpdater } from '../integrations/feishu/reply-card'
import { enrichFeishuThreadContext } from '../integrations/feishu/thread-context'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

export type FeishuInboundEvent = {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string }
    sender_type?: string
  }
  message?: {
    content?: string
    chat_id?: string
    chat_type?: string
    message_id?: string
    message_type?: string
    parent_id?: string
    root_id?: string
    thread_id?: string
    create_time?: string
    mentions?: Array<{ id?: { open_id?: string }; mentioned_type?: string }>
  }
}
type FeishuMention = NonNullable<NonNullable<FeishuInboundEvent['message']>['mentions']>[number]

type FeishuInboundErrorStatus = 400 | 404 | 502 | 503
export type FeishuInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  workingReactionAdded?: boolean
  error?: { status: FeishuInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()
const workingReactions = ['Typing', 'OneSecond'] as const

const parseText = (content?: string) => {
  if (!content?.trim()) return ''
  try {
    const parsed = JSON.parse(content) as { text?: string }
    return typeof parsed.text === 'string' ? parsed.text.replace(/@_user_\d+/g, '').trim() : ''
  } catch {
    return ''
  }
}

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? '外部会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

const wasHandled = (agentId: string, messageId: string) => {
  const now = Date.now()
  for (const [key, handledAt] of handledMessages) {
    if (now - handledAt > DEDUPE_TTL_MS) handledMessages.delete(key)
  }
  const key = `${agentId}:${messageId}`
  if (handledMessages.has(key)) return true
  // ponytail: process-local dedupe is enough for the current single-server channel runtime.
  handledMessages.set(key, now)
  return false
}

export const isFeishuBotMentioned = (mentions: FeishuMention[] | undefined, botOpenId: string) => (
  mentions?.some((mention) => mention.mentioned_type === 'bot' && mention.id?.open_id === botOpenId) ?? false
)

export const isFeishuUserMessage = (senderType?: string) => senderType === 'user'

export const processFeishuInboundEvent = async ({ agentId, workspaceId, event }: { agentId: string; workspaceId?: string; event: unknown }): Promise<FeishuInboundResult> => {
  const data = event as FeishuInboundEvent
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const feishu = readCustomAgentConfig(agent.config).channels.feishu
  if (!feishu.enabled) return { ok: false, error: { status: 400, message: '当前 Agent 未启用飞书渠道。' } }

  const message = data.message
  if (message?.message_type !== 'text') return { ok: true, ignored: true, reason: 'unsupported_message_type' }
  if (!isFeishuUserMessage(data.sender?.sender_type)) return { ok: true, ignored: true, reason: 'non_user_sender' }

  const senderOpenId = data.sender?.sender_id?.open_id?.trim() || ''
  const senderUserId = data.sender?.sender_id?.user_id?.trim() || senderOpenId
  const messageId = message.message_id?.trim() || ''
  const chatType = message.chat_type?.trim() || 'p2p'
  const chatId = message.chat_id?.trim() || ''
  const parentId = message.parent_id?.trim() || ''
  const rootId = message.root_id?.trim() || ''
  const threadId = message.thread_id?.trim() || ''
  const createTime = message.create_time?.trim() || ''
  const text = parseText(message.content)
  if (!senderUserId || !messageId || !text) return { ok: true, ignored: true, reason: 'invalid_message' }
  if (!feishu.appId.trim() || !feishu.appSecret.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 的飞书 App ID / App Secret 未配置。' } }
  }

  const config = { appId: feishu.appId, appSecret: feishu.appSecret }
  if (chatType === 'group') {
    const bot = await getFeishuBotOpenId(config)
    if (!bot.ok) return { ok: false, error: { status: 502, message: bot.message || '飞书机器人身份获取失败。' } }
    if (!isFeishuBotMentioned(message.mentions, bot.openId)) return { ok: true, ignored: true, reason: 'bot_not_mentioned' }
  }
  if (wasHandled(agentId, messageId)) return { ok: true, ignored: true, reason: 'duplicate' }

  const threadContext = await enrichFeishuThreadContext({
    chatId,
    chatType,
    createTime,
    messageId,
    parentId,
    rootId,
    senderId: senderUserId,
    text,
    threadId,
  }, {
    getMessage: (contextMessageId) => getFeishuAppContextMessage(config, contextMessageId),
    listMessages: (params) => listFeishuAppContextMessages(config, params),
  })

  const ownerUserId = resolveAgentOwnerUserId(agent)
  if (!ownerUserId) return { ok: false, error: { status: 503, message: '当前 Agent 还没有绑定可用拥有者。' } }
  const session = ensureAgentChannelSession({
    state: ensureMainChatState(loadState(), ownerUserId),
    agentId,
    ownerUserId,
    workspaceId,
    title: buildTitle(text),
    sourceChannel: 'feishu',
    externalConversationId: threadContext.externalConversationId,
    externalUserId: senderUserId,
    externalChatId: chatId || undefined,
    externalThreadId: threadContext.externalThreadId,
  })
  if (!session.executorId) return { ok: false, error: { status: 503, message: '当前 Agent 所属用户没有可用执行节点。' } }

  const reaction = await addFeishuMessageReaction(config, {
    messageId,
    emojiType: workingReactions[Math.floor(Math.random() * workingReactions.length)],
  })
  if (!reaction.ok) console.warn('[feishu] Failed to add working reaction:', reaction.message)
  const workingReactionId = reaction.ok ? reaction.reactionId?.trim() : ''
  let workingReactionCleared = false
  const clearWorkingReaction = async () => {
    if (!workingReactionId || workingReactionCleared) return
    workingReactionCleared = true
    const result = await deleteFeishuMessageReaction(config, { messageId, reactionId: workingReactionId })
    if (!result.ok) console.warn('[feishu] Failed to remove working reaction:', result.message)
  }

  const initialCard = await replyFeishuAppInteractiveCard(config, {
    messageId,
    card: buildFeishuReplyCard({ status: 'thinking' }),
    replyInThread: threadContext.replyInThread,
  })
  const cardMessageId = initialCard.ok ? initialCard.messageId?.trim() : ''
  const cardUpdater = cardMessageId
    ? createFeishuReplyCardUpdater({
        patch: (card) => patchFeishuAppInteractiveCard(config, { messageId: cardMessageId, card }),
        onError: (errorMessage) => console.warn('[feishu] Failed to update reply card:', errorMessage),
      })
    : null
  if (!cardUpdater) {
    console.warn(
      '[feishu] Failed to create reply card:',
      initialCard.ok ? 'missing card message ID' : initialCard.message,
    )
  }

  void runMainChatResponse({
    state: session.state,
    userId: ownerUserId,
    message: threadContext.message,
    sessionId: session.session.id,
    onEvent: cardUpdater?.onEvent,
  })
    .then(async (response) => {
      await clearWorkingReaction()
      const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
      if (cardUpdater) {
        const updated = await cardUpdater.finish(response.status === 200 ? 'complete' : 'error', reply)
        if (updated) return
      }
      const result = await replyFeishuAppTextMessage(config, {
        messageId,
        text: reply,
        replyInThread: threadContext.replyInThread,
      })
      if (!result.ok) console.error('[feishu] Failed to reply to inbound message:', result.message)
    })
    .catch(async (error) => {
      await clearWorkingReaction()
      const message = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[feishu] Failed to generate inbound response:', error)
      if (cardUpdater) {
        const updated = await cardUpdater.finish('error', message)
        if (updated) return
      }
      const result = await replyFeishuAppTextMessage(config, {
        messageId,
        text: message,
        replyInThread: threadContext.replyInThread,
      })
      if (!result.ok) console.error('[feishu] Failed to reply with inbound error:', result.message)
    })

  return { ok: true, sessionId: session.session.id, workingReactionAdded: reaction.ok }
}
