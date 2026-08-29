// [INPUT]: A normalized WeCom callback message from the HTTP callback transport.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical WeCom inbound orchestration; transports only forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../integrations/agent/service'
import { sendWecomAppMessage, type WecomCallbackMessage } from '../integrations/wecom/wecom-api'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

type WecomInboundErrorStatus = 400 | 404 | 503
export type WecomInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  error?: { status: WecomInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()

/** 每个 Agent 最近一次入站对端 userid（供 channel.send 主动推送定位目标）。 */
const lastPeers = new Map<string, string>()

export const getWecomLastPeer = (agentId: string) => lastPeers.get(agentId)?.trim() || ''

export const setWecomLastPeer = (agentId: string, userId: string) => {
  const peer = userId.trim()
  if (!peer) return
  lastPeers.set(agentId, peer)
}

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? '企业微信会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

const wasHandled = (agentId: string, msgId: string) => {
  const now = Date.now()
  for (const [key, handledAt] of handledMessages) {
    if (now - handledAt > DEDUPE_TTL_MS) handledMessages.delete(key)
  }
  const key = `${agentId}:${msgId}`
  if (handledMessages.has(key)) return true
  handledMessages.set(key, now)
  return false
}

export const processWecomInboundMessage = async ({
  agentId,
  workspaceId,
  message,
}: {
  agentId: string
  workspaceId?: string
  message: WecomCallbackMessage
}): Promise<WecomInboundResult> => {
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const wecom = readCustomAgentConfig(agent.config).channels.wecom
  if (!wecom.enabled || !wecom.corpId.trim() || !wecom.agentId.trim() || !wecom.secret.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 未启用企业微信渠道。' } }
  }
  if (message.msgType !== 'text') return { ok: true, ignored: true, reason: 'unsupported_message_type' }
  const text = message.content?.trim() || ''
  if (!text || !message.msgId || !message.fromUserName) {
    return { ok: true, ignored: true, reason: 'invalid_message' }
  }
  if (wasHandled(agentId, message.msgId)) return { ok: true, ignored: true, reason: 'duplicate' }
  setWecomLastPeer(agentId, message.fromUserName)

  const ownerUserId = resolveAgentOwnerUserId(agent)
  if (!ownerUserId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 还没有绑定可用拥有者。' } }
  }
  const session = ensureAgentChannelSession({
    state: ensureMainChatState(loadState(), ownerUserId),
    agentId,
    ownerUserId,
    workspaceId,
    title: buildTitle(text),
    sourceChannel: 'wecom',
    externalConversationId: `wecom:${message.fromUserName}`,
    externalUserId: message.fromUserName,
    externalChatId: message.fromUserName,
  })
  if (!session.executorId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 所属用户没有可用执行节点。' } }
  }

  const config = {
    corpId: wecom.corpId.trim(),
    agentId: wecom.agentId.trim(),
    secret: wecom.secret.trim(),
  }

  void runMainChatResponse({
    state: session.state,
    userId: ownerUserId,
    message: text,
    sessionId: session.session.id,
  })
    .then(async (response) => {
      const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
      const result = await sendWecomAppMessage({
        ...config,
        touser: message.fromUserName,
        content: reply,
      })
      if (!result.ok) console.error('[wecom] Failed to reply to inbound message:', result.message)
    })
    .catch(async (error) => {
      const fallback = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[wecom] Failed to generate inbound response:', error)
      const result = await sendWecomAppMessage({
        ...config,
        touser: message.fromUserName,
        content: fallback,
      })
      if (!result.ok) console.error('[wecom] Failed to reply with inbound error:', result.message)
    })

  return { ok: true, sessionId: session.session.id }
}
