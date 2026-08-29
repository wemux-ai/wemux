// [INPUT]: A normalized WeChat iLink message from the long-polling transport.
// [OUTPUT]: One shared inbound result plus asynchronous Agent reply delivery.
// [POS]: Canonical WeChat iLink inbound orchestration; transports only forward events here.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { agentService } from '../integrations/agent/service'
import { extractWeixinText, extractWeixinVoiceText, sendWeixinMessage, summarizeWeixinMedia, pickWeixinMediaItem, downloadWeixinMedia, ILINK_DEFAULT_BASE_URL, type WeixinMessage } from '../integrations/wechat-ilink/ilink-api'
import { buildWechatMediaToken, uploadWechatMediaObject } from './wechat-media-storage'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { ensureAgentChannelSession, resolveAgentOwnerUserId } from './agent-channel-session-service'

type WechatInboundErrorStatus = 400 | 404 | 502 | 503
export type WechatInboundResult = {
  ok: boolean
  ignored?: boolean
  reason?: string
  sessionId?: string
  error?: { status: WechatInboundErrorStatus; message: string }
}

const DEDUPE_TTL_MS = 5 * 60_000
const handledMessages = new Map<string, number>()

const buildTitle = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return !normalized ? '微信会话' : normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

const wasHandled = (agentId: string, messageId: number) => {
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

export const processWechatInboundMessage = async ({
  agentId,
  workspaceId,
  message,
}: {
  agentId: string
  workspaceId?: string
  message: WeixinMessage
}): Promise<WechatInboundResult> => {
  const agent = agentService.getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false, error: { status: 404, message: 'Agent 不存在。' } }
  }
  const wechat = readCustomAgentConfig(agent.config).channels.wechat
  if (!wechat.enabled || !wechat.botToken.trim()) {
    return { ok: false, error: { status: 400, message: '当前 Agent 未启用微信渠道。' } }
  }

  const fromUserId = message.from_user_id?.trim() || ''
  const messageId = message.message_id
  // 文本 → 语音转写（iLink 服务端转写）→ 媒体类型提示
  const text = extractWeixinText(message)
    || extractWeixinVoiceText(message)
    || summarizeWeixinMedia(message)
  if (!fromUserId || !messageId || !text) {
    return { ok: true, ignored: true, reason: 'invalid_message' }
  }
  if (wasHandled(agentId, messageId)) {
    return { ok: true, ignored: true, reason: 'duplicate' }
  }

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
    sourceChannel: 'wechat',
    externalConversationId: `wechat:${fromUserId}`,
    externalUserId: fromUserId,
    externalChatId: fromUserId,
  })
  if (!session.executorId) {
    return { ok: false, error: { status: 503, message: '当前 Agent 所属用户没有可用执行节点。' } }
  }

  const config = {
    baseUrl: wechat.baseUrl.trim() || ILINK_DEFAULT_BASE_URL,
    token: wechat.botToken.trim(),
  }

  // 入站媒体：下载 + AES 解密 → 对象存储 → 作为附件交给 Agent（图片/视频等非代码文件符合对象存储红线）
  const attachments: TaskChatAttachment[] = []
  const media = pickWeixinMediaItem(message)
  if (media) {
    try {
      const plaintext = await downloadWeixinMedia({ item: media.item })
      if (plaintext) {
        const key = await uploadWechatMediaObject({
          agentId,
          messageId,
          ext: media.ext,
          buf: plaintext,
          contentType: media.kind === 'image' ? 'image/png' : media.kind === 'video' ? 'video/mp4' : 'application/octet-stream',
        })
        const token = buildWechatMediaToken({ agentId, messageId, ext: media.ext })
        if (token) {
          attachments.push({
            id: `wechat-media-${agentId}-${messageId}`,
            url: `/api/channel/wechat/media/${token}/download`,
            filename: `wechat-${messageId}.${media.ext}`,
            contentType: media.kind === 'image' ? 'image/png' : media.kind === 'video' ? 'video/mp4' : undefined,
          })
        }
      }
    } catch (error) {
      console.warn('[wechat-ilink] Failed to decode inbound media:', error)
    }
  }

  void runMainChatResponse({
    state: session.state,
    userId: ownerUserId,
    message: text,
    attachments: attachments.length > 0 ? attachments : undefined,
    sessionId: session.session.id,
  })
    .then(async (response) => {
      const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
      const result = await sendWeixinMessage({
        ...config,
        toUserId: fromUserId,
        contextToken: message.context_token,
        itemList: [{ type: 1, text_item: { text: reply } }],
      })
      if (result.ret !== 0) {
        console.error('[wechat-ilink] Failed to reply to inbound message:', result.errcode, result.errmsg)
      }
    })
    .catch(async (error) => {
      const fallback = error instanceof Error ? error.message : 'Agent 处理消息失败。'
      console.error('[wechat-ilink] Failed to generate inbound response:', error)
      const result = await sendWeixinMessage({
        ...config,
        toUserId: fromUserId,
        contextToken: message.context_token,
        itemList: [{ type: 1, text_item: { text: fallback } }],
      })
      if (result.ret !== 0) {
        console.error('[wechat-ilink] Failed to reply with inbound error:', result.errcode, result.errmsg)
      }
    })

  return { ok: true, sessionId: session.session.id }
}
