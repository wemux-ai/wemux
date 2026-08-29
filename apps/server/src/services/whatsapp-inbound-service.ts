// [INPUT]: A normalized WhatsApp message from the Cloud API webhook transport.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical WhatsApp inbound orchestration; transports only forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../integrations/agent/service'
import { sendWhatsappTextMessage, type WhatsappInboundMessage } from '../integrations/whatsapp/whatsapp-api'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

type WhatsappInboundErrorStatus = 400 | 404 | 503
export type WhatsappInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  error?: { status: WhatsappInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()

/** 每个 Agent 最近一次入站对端手机号（供 channel.send 主动推送定位目标）。 */
const lastPeers = new Map<string, string>()

export const getWhatsappLastPeer = (agentId: string) => lastPeers.get(agentId)?.trim() || ''

export const setWhatsappLastPeer = (agentId: string, phoneNumber: string) => {
  const peer = phoneNumber.trim()
  if (!peer) return
  lastPeers.set(agentId, peer)
}

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? 'WhatsApp 会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
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

export const processWhatsappInboundMessage = async ({
  agentId,
  workspaceId,
  message,
}: {
  agentId: string
  workspaceId?: string
  message: WhatsappInboundMessage
}): Promise<WhatsappInboundResult> => {
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const whatsapp = readCustomAgentConfig(agent.config).channels.whatsapp
  if (!whatsapp.enabled || !whatsapp.phoneNumberId.trim() || !whatsapp.accessToken.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 未启用 WhatsApp 渠道。' } }
  }
  if (wasHandled(agentId, message.messageId)) return { ok: true, ignored: true, reason: 'duplicate' }
  setWhatsappLastPeer(agentId, message.from)

  const ownerUserId = resolveAgentOwnerUserId(agent)
  if (!ownerUserId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 还没有绑定可用拥有者。' } }
  }
  const session = ensureAgentChannelSession({
    state: ensureMainChatState(loadState(), ownerUserId),
    agentId,
    ownerUserId,
    workspaceId,
    title: buildTitle(message.text),
    sourceChannel: 'whatsapp',
    externalConversationId: `whatsapp:${message.from}`,
    externalUserId: message.from,
    externalChatId: message.from,
  })
  if (!session.executorId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 所属用户没有可用执行节点。' } }
  }

  const config = {
    phoneNumberId: whatsapp.phoneNumberId.trim(),
    accessToken: whatsapp.accessToken.trim(),
  }

  void runMainChatResponse({
    state: session.state,
    userId: ownerUserId,
    message: message.text,
    sessionId: session.session.id,
  })
    .then(async (response) => {
      const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
      const result = await sendWhatsappTextMessage({ ...config, to: message.from, text: reply })
      if (!result.ok) console.error('[whatsapp] Failed to reply to inbound message:', result.message)
    })
    .catch(async (error) => {
      const fallback = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[whatsapp] Failed to generate inbound response:', error)
      const result = await sendWhatsappTextMessage({ ...config, to: message.from, text: fallback })
      if (!result.ok) console.error('[whatsapp] Failed to reply with inbound error:', result.message)
    })

  return { ok: true, sessionId: session.session.id }
}
