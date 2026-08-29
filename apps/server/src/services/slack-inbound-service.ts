// [INPUT]: A normalized Slack message event from the socket-mode transport.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical Slack inbound orchestration; transports only forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../integrations/agent/service'
import { sendSlackMessage, type SlackMessageEvent } from '../integrations/slack/slack-api'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

type SlackInboundErrorStatus = 400 | 404 | 503
export type SlackInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  error?: { status: SlackInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? 'Slack 会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

const wasHandled = (agentId: string, ts: string) => {
  const now = Date.now()
  for (const [key, handledAt] of handledMessages) {
    if (now - handledAt > DEDUPE_TTL_MS) handledMessages.delete(key)
  }
  const key = `${agentId}:${ts}`
  if (handledMessages.has(key)) return true
  handledMessages.set(key, now)
  return false
}

export const processSlackInboundMessage = async ({
  agentId,
  workspaceId,
  event,
}: {
  agentId: string
  workspaceId?: string
  event: SlackMessageEvent
}): Promise<SlackInboundResult> => {
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const slack = readCustomAgentConfig(agent.config).channels.slack
  if (!slack.enabled || !slack.botToken.trim() || !slack.appToken.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 未启用 Slack 渠道。' } }
  }
  if (event.isBot) return { ok: true, ignored: true, reason: 'bot_message' }
  if (!event.ts) return { ok: true, ignored: true, reason: 'missing_ts' }
  if (wasHandled(agentId, event.ts)) return { ok: true, ignored: true, reason: 'duplicate' }

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
    sourceChannel: 'slack',
    externalConversationId: `slack:${event.channelId}`,
    externalUserId: event.userId,
    externalChatId: event.channelId,
    externalThreadId: event.threadTs,
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
      const result = await sendSlackMessage({
        botToken: slack.botToken.trim(),
        channelId: event.channelId,
        text: reply,
        threadTs: event.threadTs,
      })
      if (!result.ok) console.error('[slack] Failed to reply to inbound message:', result.message)
    })
    .catch(async (error) => {
      const fallback = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[slack] Failed to generate inbound response:', error)
      const result = await sendSlackMessage({
        botToken: slack.botToken.trim(),
        channelId: event.channelId,
        text: fallback,
        threadTs: event.threadTs,
      })
      if (!result.ok) console.error('[slack] Failed to reply with inbound error:', result.message)
    })

  return { ok: true, sessionId: session.session.id }
}
