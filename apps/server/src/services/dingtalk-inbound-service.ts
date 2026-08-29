// [INPUT]: A normalized DingTalk robot message from the stream transport.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical DingTalk inbound orchestration; transports only forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../integrations/agent/service'
import { sendDingtalkOtMessage, type DingtalkRobotMessage } from '../integrations/dingtalk/dingtalk-api'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

type DingtalkInboundErrorStatus = 400 | 404 | 503
export type DingtalkInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  error?: { status: DingtalkInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? '钉钉会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
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

export const processDingtalkInboundMessage = async ({
  agentId,
  workspaceId,
  message,
  text,
}: {
  agentId: string
  workspaceId?: string
  message: DingtalkRobotMessage
  text: string
}): Promise<DingtalkInboundResult> => {
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const dingtalk = readCustomAgentConfig(agent.config).channels.dingtalk
  if (!dingtalk.enabled || !dingtalk.appKey.trim() || !dingtalk.appSecret.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 未启用钉钉渠道。' } }
  }
  if (wasHandled(agentId, message.msgId)) return { ok: true, ignored: true, reason: 'duplicate' }

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
    sourceChannel: 'dingtalk',
    externalConversationId: `dingtalk:${message.senderStaffId}`,
    externalUserId: message.senderStaffId,
    externalChatId: message.conversationId || message.senderStaffId,
  })
  if (!session.executorId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 所属用户没有可用执行节点。' } }
  }

  const config = {
    appKey: dingtalk.appKey.trim(),
    appSecret: dingtalk.appSecret.trim(),
    robotCode: dingtalk.appKey.trim(),
  }

  void runMainChatResponse({
    state: session.state,
    userId: ownerUserId,
    message: text,
    sessionId: session.session.id,
  })
    .then(async (response) => {
      const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
      const result = await sendDingtalkOtMessage({
        ...config,
        userIds: [message.senderStaffId],
        content: reply,
      })
      if (!result.ok) console.error('[dingtalk] Failed to reply to inbound message:', result.message)
    })
    .catch(async (error) => {
      const fallback = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[dingtalk] Failed to generate inbound response:', error)
      const result = await sendDingtalkOtMessage({
        ...config,
        userIds: [message.senderStaffId],
        content: fallback,
      })
      if (!result.ok) console.error('[dingtalk] Failed to reply with inbound error:', result.message)
    })

  return { ok: true, sessionId: session.session.id }
}
