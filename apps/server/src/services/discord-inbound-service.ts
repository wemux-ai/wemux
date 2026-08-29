// [INPUT]: A normalized Discord message event from the gateway transport.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical Discord inbound orchestration; transports only forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../integrations/agent/service'
import { sendDiscordMessage, type DiscordMessageEvent } from '../integrations/discord/discord-api'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

type DiscordInboundErrorStatus = 400 | 404 | 503
export type DiscordInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  error?: { status: DiscordInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? 'Discord 会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

const wasHandled = (agentId: string, messageId: string) => {
  const now = Date.now()
  for (const [key, handledAt] of handledMessages) {
    if (now - handledAt > DEDUPE_TTL_MS) handledMessages.delete(key)
  }
  const key = `${agentId}:${messageId}`
  if (handledMessages.has(key)) return true
  handledMessages.set(key, now)
  return false
}

export const processDiscordInboundMessage = async ({
  agentId,
  workspaceId,
  event,
}: {
  agentId: string
  workspaceId?: string
  event: DiscordMessageEvent
}): Promise<DiscordInboundResult> => {
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const discord = readCustomAgentConfig(agent.config).channels.discord
  if (!discord.enabled || !discord.botToken.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 未启用 Discord 渠道。' } }
  }
  if (event.isBot) return { ok: true, ignored: true, reason: 'bot_message' }
  // guildId 限定：配置了限定服务器但消息来自其他服务器时忽略
  if (discord.guildId.trim() && event.guildId && event.guildId !== discord.guildId.trim()) {
    return { ok: true, ignored: true, reason: 'guild_not_allowed' }
  }
  if (wasHandled(agentId, event.messageId)) return { ok: true, ignored: true, reason: 'duplicate' }

  const ownerUserId = resolveAgentOwnerUserId(agent)
  if (!ownerUserId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 还没有绑定可用拥有者。' } }
  }
  const session = ensureAgentChannelSession({
    state: ensureMainChatState(loadState(), ownerUserId),
    agentId,
    ownerUserId,
    workspaceId,
    title: buildTitle(event.text),
    sourceChannel: 'discord',
    externalConversationId: `discord:${event.channelId}`,
    externalUserId: event.authorId,
    externalChatId: event.channelId,
  })
  if (!session.executorId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 所属用户没有可用执行节点。' } }
  }

  void runMainChatResponse({
    state: session.state,
    userId: ownerUserId,
    message: event.text,
    sessionId: session.session.id,
  })
    .then(async (response) => {
      const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
      const result = await sendDiscordMessage({
        botToken: discord.botToken.trim(),
        channelId: event.channelId,
        content: reply,
      })
      if (!result.ok) console.error('[discord] Failed to reply to inbound message:', result.message)
    })
    .catch(async (error) => {
      const fallback = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[discord] Failed to generate inbound response:', error)
      const result = await sendDiscordMessage({
        botToken: discord.botToken.trim(),
        channelId: event.channelId,
        content: fallback,
      })
      if (!result.ok) console.error('[discord] Failed to reply with inbound error:', result.message)
    })

  return { ok: true, sessionId: session.session.id }
}
