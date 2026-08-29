// [INPUT]: Public Telegram and Feishu webhook events plus authenticated channel settings.
// [OUTPUT]: Channel configuration responses and normalized messages sent to main-chat sessions.
// [POS]: HTTP boundary for external IM channels; channel transports live in integrations/.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { readCustomAgentConfig, isCustomAgentVisibleInWorkspace, writeCustomAgentConfig } from '@shared/custom-agent'
import { agentService } from '../../integrations/agent/service'
import { decryptFeishuEventPayload } from '../../integrations/feishu'
import { syncFeishuLongConnections } from '../../integrations/feishu/long-connection-service'
import { beginFeishuQrBinding, cancelFeishuQrBindings, getFeishuQrBindingStatus } from '../../integrations/feishu/qr-binding-service'
import { beginWechatQrBinding, cancelWechatQrBindings, getWechatQrBindingStatus, submitWechatVerifyCode } from '../../integrations/wechat-ilink/qr-binding-service'
import { syncWechatLongPolling } from '../../integrations/wechat-ilink/long-polling-service'
import { processWechatInboundMessage } from '../../services/wechat-inbound-service'
import { syncDiscordGateways } from '../../integrations/discord/gateway'
import { syncSlackSockets } from '../../integrations/slack/socket-mode'
import { syncDingtalkStreams } from '../../integrations/dingtalk/stream'
import { buildWechatMediaObjectKey, parseWechatMediaToken, streamWechatMediaObject } from '../../services/wechat-media-storage'
import { buildWecomCallbackSignature, decryptWecomEchoStr, decryptWecomCallbackPayload, extractWecomEncrypt, parseWecomCallbackMessage } from '../../integrations/wecom/wecom-api'
import { processWecomInboundMessage } from '../../services/wecom-inbound-service'
import { parseWhatsappWebhookPayload, verifyWhatsappWebhook } from '../../integrations/whatsapp/whatsapp-api'
import { processWhatsappInboundMessage } from '../../services/whatsapp-inbound-service'
import { processFeishuInboundEvent } from '../../services/feishu-inbound-service'
import { deleteTelegramWebhookWithConfig, getMe, getTelegramWebhookInfoWithConfig, isTelegramEnabled, processTelegramUpdate, sendTelegramMessageWithConfig } from '../../integrations/telegram'
import { resolveAgentOwnerUserId, ensureAgentChannelSession } from '../../services/agent-channel-session-service'
import { loadState } from '../../storage/app-state-store'
import { getUserIdFromHeader } from '../shared'
import { ensureMainChatState, runMainChatResponse } from '../project-main-chat'
import {
  buildAgentChannelPayload,
  buildAgentWebhookUrls,
  buildExternalConversationTitle,
  buildTelegramExternalConversationId,
  resolveCustomChannelAgent,
  syncAgentChannelBindings,
} from './helpers'

export const registerChannelSystemRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/agents/:id/channel/webhook-url', requireAuth, async (c) => {
    const agentId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    return c.json({
      webhookUrls: buildAgentWebhookUrls(c.req.url, agentId, workspaceId),
    })
  })

  app.get('/api/agents/:id/channel', requireAuth, async (c) => {
    const agentId = c.req.param('id')
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    const webhookInfoResult = resolved.profile.channels.telegram.botToken.trim()
      ? await getTelegramWebhookInfoWithConfig(resolved.profile.channels.telegram.botToken)
      : null

    return c.json(buildAgentChannelPayload({
      requestUrl: c.req.url,
      agentId,
      profile: resolved.profile,
      telegramWebhookInfo: webhookInfoResult?.ok ? webhookInfoResult.info : null,
    }))
  })

  app.put('/api/agents/:id/channel', requireAuth, async (c) => {
    const agentId = c.req.param('id')
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    const payload = z.object({
      channels: z.record(z.unknown()),
    }).parse(await c.req.json())

    const nextConfig = writeCustomAgentConfig(resolved.agent.config, {
      ...resolved.profile,
      channels: payload.channels,
    })
    const updated = agentService.updateAgent(agentId, {
      name: resolved.agent.name,
      type: resolved.agent.type,
      endpoint: resolved.agent.endpoint,
      config: nextConfig,
      ownerUserId: resolved.agent.ownerUserId,
    })
    if (!updated) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    const nextProfile = readCustomAgentConfig(updated.config)
    const syncStatus = await syncAgentChannelBindings({
      requestUrl: c.req.url,
      agentId,
      profile: nextProfile,
      previousProfile: resolved.profile,
    })
    // 统一重同步各长连接/长轮询渠道（飞书/微信/Discord/Slack/钉钉）
    syncFeishuLongConnections()
    syncWechatLongPolling()
    syncDiscordGateways()
    syncSlackSockets()
    syncDingtalkStreams()
    const webhookInfoResult = nextProfile.channels.telegram.botToken.trim()
      ? await getTelegramWebhookInfoWithConfig(nextProfile.channels.telegram.botToken)
      : null

    return c.json({
      agent: updated,
      ...buildAgentChannelPayload({
        requestUrl: c.req.url,
        agentId,
        profile: nextProfile,
        syncStatus,
        telegramWebhookInfo: webhookInfoResult?.ok ? webhookInfoResult.info : null,
      }),
      message: syncStatus.warnings.length > 0 ? '渠道配置已保存，但有部分同步警告。' : '渠道配置已保存。',
    })
  })

  app.post('/api/agents/:id/channel/feishu/connect', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const resolved = resolveCustomChannelAgent(c.req.param('id'), userId)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)
    try {
      return c.json(await beginFeishuQrBinding(resolved.agent, userId))
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '飞书二维码生成失败。' }, 502)
    }
  })

  app.get('/api/agents/:id/channel/feishu/connect/:sessionId', requireAuth, (c) => {
    const result = getFeishuQrBindingStatus(c.req.param('id'), c.req.param('sessionId'), getUserIdFromHeader(c)!)
    return result ? c.json(result) : c.json({ message: '绑定会话不存在或已过期。' }, 404)
  })

  app.delete('/api/agents/:id/channel/feishu/connect', requireAuth, (c) => {
    const agentId = c.req.param('id')
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)

    cancelFeishuQrBindings(agentId)
    const updated = agentService.updateAgent(agentId, {
      name: resolved.agent.name,
      type: resolved.agent.type,
      endpoint: resolved.agent.endpoint,
      ownerUserId: resolved.agent.ownerUserId,
      config: writeCustomAgentConfig(resolved.agent.config, {
        ...resolved.profile,
        channels: {
          ...resolved.profile.channels,
          feishu: {
            enabled: false,
            connectionMode: 'manual',
            appId: '',
            appSecret: '',
            encryptKey: '',
            verificationToken: '',
          },
        },
      }),
    })
    if (!updated) return c.json({ message: 'Agent 不存在。' }, 404)

    syncFeishuLongConnections()
    const profile = readCustomAgentConfig(updated.config)
    return c.json({
      ok: true,
      agent: updated,
      ...buildAgentChannelPayload({ requestUrl: c.req.url, agentId, profile }),
      message: '飞书连接已断开，wemux 中保存的飞书凭据已清除。',
    })
  })

  app.post('/api/agents/:id/channel/wechat/connect', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const resolved = resolveCustomChannelAgent(c.req.param('id'), userId)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)
    try {
      return c.json(await beginWechatQrBinding(resolved.agent.id, userId))
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '微信二维码生成失败。' }, 502)
    }
  })

  app.get('/api/agents/:id/channel/wechat/connect/:sessionId', requireAuth, (c) => {
    const result = getWechatQrBindingStatus(c.req.param('id'), c.req.param('sessionId'), getUserIdFromHeader(c)!)
    return result ? c.json(result) : c.json({ message: '绑定会话不存在或已过期。' }, 404)
  })

  app.post('/api/agents/:id/channel/wechat/connect/:sessionId/verify-code', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({ verifyCode: z.string().trim().min(1).max(16) }).parse(await c.req.json())
    const result = submitWechatVerifyCode(c.req.param('id'), c.req.param('sessionId'), userId, payload.verifyCode)
    if (!result) return c.json({ message: '绑定会话不存在或已过期。' }, 404)
    return result.ok ? c.json(result) : c.json({ message: result.message }, 400)
  })

  app.delete('/api/agents/:id/channel/wechat/connect', requireAuth, (c) => {
    const agentId = c.req.param('id')
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)

    cancelWechatQrBindings(agentId)
    const updated = agentService.updateAgent(agentId, {
      name: resolved.agent.name,
      type: resolved.agent.type,
      endpoint: resolved.agent.endpoint,
      ownerUserId: resolved.agent.ownerUserId,
      config: writeCustomAgentConfig(resolved.agent.config, {
        ...resolved.profile,
        channels: {
          ...resolved.profile.channels,
          wechat: {
            enabled: false,
            botToken: '',
            botId: '',
            wechatUserId: '',
            baseUrl: '',
          },
        },
      }),
    })
    if (!updated) return c.json({ message: 'Agent 不存在。' }, 404)

    syncWechatLongPolling()
    const profile = readCustomAgentConfig(updated.config)
    return c.json({
      ok: true,
      agent: updated,
      ...buildAgentChannelPayload({ requestUrl: c.req.url, agentId, profile }),
      message: '微信连接已断开，wemux 中保存的微信凭证已清除。',
    })
  })

  app.delete('/api/agents/:id/channel/telegram/webhook', requireAuth, async (c) => {
    const agentId = c.req.param('id')
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }

    const botToken = resolved.profile.channels.telegram.botToken.trim()
    if (!botToken) {
      return c.json({ ok: false, message: '当前 Agent 未配置 Telegram Bot Token。' }, 400)
    }

    const result = await deleteTelegramWebhookWithConfig(botToken)
    if (!result.ok) {
      return c.json({ ok: false, message: result.message || 'Telegram webhook 删除失败。' }, 502)
    }

    return c.json({ ok: true, message: 'Telegram webhook 已删除。' })
  })

  // 微信渠道入站媒体下载（免鉴权，HMAC token + 24h 时效；executor 物化附件时使用）
  app.get('/api/channel/wechat/media/:token/download', async (c) => {
    const parsed = parseWechatMediaToken(c.req.param('token'))
    if (!parsed) return c.json({ message: '链接无效或已过期。' }, 403)
    const key = buildWechatMediaObjectKey(parsed.agentId, parsed.messageId, parsed.ext)
    const response = await streamWechatMediaObject(key)
    if (response.status === 404) return c.json({ message: '媒体不存在。' }, 404)
    return response
  })

  app.post('/api/agents/:id/channel/telegram/deep-link', requireAuth, async (c) => {
    const agentId = c.req.param('id')
    const resolved = resolveCustomChannelAgent(agentId, getUserIdFromHeader(c)!)
    if (!resolved) {
      return c.json({ message: 'Agent 不存在。' }, 404)
    }
    const botToken = resolved.profile.channels.telegram.botToken.trim()
    if (!botToken) {
      return c.json({ message: '当前 Agent 未配置 Telegram Bot Token。' }, 400)
    }
    const me = await getMe(botToken)
    if (!me.ok || !me.username) {
      return c.json({ message: me.message || '无法获取 Bot 用户名。' }, 502)
    }
    return c.json({ deepLinkUrl: `https://t.me/${me.username}?start=bind_${agentId}` })
  })

  // 企业微信回调：GET = URL 验证（返回解密后的 echostr），POST = 消息推送（验签 + 解密 + 入站）
  app.get('/api/channel/wecom/:agentId/callback', async (c) => {
    const agentId = c.req.param('agentId')
    const resolved = resolveCustomChannelAgent(agentId)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)
    const wecom = resolved.profile.channels.wecom
    if (!wecom.enabled || !wecom.callbackToken.trim() || !wecom.encodingAesKey.trim()) {
      return c.json({ message: '当前 Agent 未启用企业微信渠道或回调参数未配置。' }, 400)
    }
    const msgSignature = c.req.query('msg_signature')?.trim() || ''
    const timestamp = c.req.query('timestamp')?.trim() || ''
    const nonce = c.req.query('nonce')?.trim() || ''
    const echostr = c.req.query('echostr')?.trim() || ''
    if (!msgSignature || !timestamp || !nonce || !echostr) {
      return c.json({ message: '回调参数缺失。' }, 400)
    }
    const expected = buildWecomCallbackSignature(wecom.callbackToken, timestamp, nonce, echostr)
    if (expected !== msgSignature) {
      return c.json({ message: 'msg_signature 校验失败。' }, 401)
    }
    const result = decryptWecomEchoStr(wecom.encodingAesKey, echostr, wecom.corpId)
    if (!result.ok) {
      return c.json({ message: result.message || 'echostr 解密失败。' }, 400)
    }
    return c.text(result.echostr || '')
  })

  app.post('/api/channel/wecom/:agentId/callback', async (c) => {
    const agentId = c.req.param('agentId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const resolved = resolveCustomChannelAgent(agentId)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)
    const wecom = resolved.profile.channels.wecom
    if (!wecom.enabled || !wecom.callbackToken.trim() || !wecom.encodingAesKey.trim()) {
      return c.json({ message: '当前 Agent 未启用企业微信渠道或回调参数未配置。' }, 400)
    }
    const msgSignature = c.req.query('msg_signature')?.trim() || ''
    const timestamp = c.req.query('timestamp')?.trim() || ''
    const nonce = c.req.query('nonce')?.trim() || ''
    const xml = await c.req.text().catch(() => '')
    const encrypted = extractWecomEncrypt(xml)
    if (!msgSignature || !timestamp || !nonce || !encrypted) {
      return c.json({ message: '回调参数缺失。' }, 400)
    }
    const expected = buildWecomCallbackSignature(wecom.callbackToken, timestamp, nonce, encrypted)
    if (expected !== msgSignature) {
      return c.json({ message: 'msg_signature 校验失败。' }, 401)
    }
    const decrypted = decryptWecomCallbackPayload(wecom.encodingAesKey, encrypted, wecom.corpId)
    if ('error' in decrypted) {
      return c.json({ message: decrypted.error }, 400)
    }
    const message = parseWecomCallbackMessage(decrypted.message)
    if (!message) {
      return c.json({ ok: true, ignored: true })
    }
    const result = await processWecomInboundMessage({ agentId, workspaceId, message })
    if (result.error) {
      return c.json({ ok: false, message: result.error.message }, result.error.status)
    }
    return c.json(result)
  })

  // WhatsApp Cloud API webhook：GET = 验证（返回 hub.challenge），POST = 消息回调
  app.get('/api/channel/whatsapp/:agentId/webhook', async (c) => {
    const agentId = c.req.param('agentId')
    const resolved = resolveCustomChannelAgent(agentId)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)
    const whatsapp = resolved.profile.channels.whatsapp
    if (!whatsapp.enabled || !whatsapp.verifyToken.trim()) {
      return c.json({ message: '当前 Agent 未启用 WhatsApp 渠道或未配置验证令牌。' }, 400)
    }
    const result = verifyWhatsappWebhook({
      verifyToken: whatsapp.verifyToken.trim(),
      mode: c.req.query('hub.mode')?.trim(),
      token: c.req.query('hub.verify_token')?.trim(),
      challenge: c.req.query('hub.challenge')?.trim(),
    })
    if (!result.ok) return c.json({ message: result.message }, 403)
    return c.text(result.challenge || '')
  })

  app.post('/api/channel/whatsapp/:agentId/webhook', async (c) => {
    const agentId = c.req.param('agentId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const resolved = resolveCustomChannelAgent(agentId)
    if (!resolved) return c.json({ message: 'Agent 不存在。' }, 404)
    const whatsapp = resolved.profile.channels.whatsapp
    if (!whatsapp.enabled || !whatsapp.phoneNumberId.trim() || !whatsapp.accessToken.trim()) {
      return c.json({ message: '当前 Agent 未启用 WhatsApp 渠道。' }, 400)
    }
    const payload = await c.req.json().catch(() => ({}))
    const messages = parseWhatsappWebhookPayload(payload)
    if (messages.length === 0) {
      // Meta 要求 webhook 快速 200；无文本消息（媒体/状态更新等）直接确认
      return c.json({ ok: true, ignored: true })
    }
    for (const message of messages) {
      const result = await processWhatsappInboundMessage({ agentId, workspaceId, message })
      if (result.error) {
        console.warn(`[whatsapp] Inbound failed for ${agentId}:`, result.error.message)
      }
    }
    return c.json({ ok: true })
  })

  app.post('/api/channel/telegram/:agentId/webhook', async (c) => {
    const agentId = c.req.param('agentId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const resolved = resolveCustomChannelAgent(agentId)
    if (!resolved) {
      return c.json({ ok: false, message: 'Agent 不存在。' }, 404)
    }

    if (workspaceId) {
      const ownerUserId = resolveAgentOwnerUserId(resolved.agent)
      const accessible = isCustomAgentVisibleInWorkspace(resolved.profile, {
        userId: ownerUserId || '',
        ownerUserId: resolved.agent.ownerUserId,
        workspaceId,
      })
      if (!accessible) {
        return c.json({ ok: false, message: 'Agent 未归属当前组织。' }, 403)
      }
    }

    const telegram = resolved.profile.channels.telegram
    if (!telegram.enabled || !telegram.botToken.trim()) {
      return c.json({ ok: false, message: '当前 Agent 未启用 Telegram 渠道。' }, 400)
    }

    const expectedSecret = telegram.webhookSecret.trim()
    const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token')?.trim() || ''
    if (expectedSecret && secret !== expectedSecret) {
      return c.json({ ok: false, message: 'Telegram webhook secret 不匹配。' }, 401)
    }

    const update = await c.req.json().catch(() => ({})) as {
      message?: {
        text?: string
        chat?: { id: number }
        message_thread_id?: number
      }
    }
    const text = update.message?.text?.trim() || ''
    const chatId = update.message?.chat?.id
    const threadId = update.message?.message_thread_id
    if (typeof chatId !== 'number') {
      return c.json({ ok: true, ignored: true })
    }

    // 深链一键绑定：用户点 t.me/<bot>?start=bind_<agentId> 并点 Start 后，这里把 chatId 写入 Agent 配置
    const deepLinkMatch = /^\/start\s+bind_([A-Za-z0-9_-]+)$/i.exec(text)
    if (deepLinkMatch) {
      if (deepLinkMatch[1] !== agentId) {
        return c.json({ ok: true, ignored: true })
      }
      const updated = agentService.updateAgent(agentId, {
        name: resolved.agent.name,
        type: resolved.agent.type,
        endpoint: resolved.agent.endpoint,
        ownerUserId: resolved.agent.ownerUserId,
        config: writeCustomAgentConfig(resolved.agent.config, {
          ...resolved.profile,
          channels: {
            ...resolved.profile.channels,
            telegram: {
              ...resolved.profile.channels.telegram,
              enabled: true,
              chatId: String(chatId),
            },
          },
        }),
      })
      if (!updated) {
        return c.json({ ok: false, message: 'Agent 不存在。' }, 404)
      }
      const bound = await sendTelegramMessageWithConfig({
        botToken: telegram.botToken,
        chatId: String(chatId),
        threadId: threadId ? String(threadId) : undefined,
      }, '绑定成功！你现在可以从 Telegram 与这个 Agent 对话。')
      return c.json({ ok: true, bound: true, sendResult: bound.ok ? 'sent' : bound.message })
    }

    if (!text) {
      return c.json({ ok: true, ignored: true })
    }

    const ownerUserId = resolveAgentOwnerUserId(resolved.agent)
    if (!ownerUserId) {
      return c.json({ ok: false, message: '当前 Agent 还没有绑定可用拥有者。' }, 503)
    }

    const sessionResult = ensureAgentChannelSession({
      state: ensureMainChatState(loadState(), ownerUserId),
      agentId,
      ownerUserId,
      workspaceId,
      title: buildExternalConversationTitle(text),
      sourceChannel: 'telegram',
      externalConversationId: buildTelegramExternalConversationId(chatId, threadId),
      externalChatId: String(chatId),
      externalThreadId: threadId ? String(threadId) : undefined,
    })

    if (!sessionResult.executorId) {
      return c.json({ ok: false, message: '当前 Agent 所属用户没有可用执行节点。' }, 503)
    }

    const response = await runMainChatResponse({
      state: sessionResult.state,
      userId: ownerUserId,
      message: text,
      sessionId: sessionResult.session.id,
    })

    const reply = response.message?.trim() || '我已经收到消息，但暂时没有可返回的内容。'
    const sendResult = await sendTelegramMessageWithConfig({
      botToken: telegram.botToken,
      chatId: String(chatId),
      threadId: threadId ? String(threadId) : undefined,
    }, reply)
    if (!sendResult.ok) {
      return c.json({ ok: false, message: sendResult.message || 'Telegram 消息发送失败。' }, 502)
    }

    return c.json({ ok: true, sessionId: sessionResult.session.id })
  })

  app.post('/api/channel/feishu/:agentId/webhook', async (c) => {
    const agentId = c.req.param('agentId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const resolved = resolveCustomChannelAgent(agentId)
    if (!resolved) {
      return c.json({ ok: false, message: 'Agent 不存在。' }, 404)
    }

    if (workspaceId) {
      const ownerUserId = resolveAgentOwnerUserId(resolved.agent)
      const accessible = isCustomAgentVisibleInWorkspace(resolved.profile, {
        userId: ownerUserId || '',
        ownerUserId: resolved.agent.ownerUserId,
        workspaceId,
      })
      if (!accessible) {
        return c.json({ ok: false, message: 'Agent 未归属当前组织。' }, 403)
      }
    }

    const feishu = resolved.profile.channels.feishu
    if (!feishu.enabled) {
      return c.json({ ok: false, message: '当前 Agent 未启用飞书渠道。' }, 400)
    }

    let body = await c.req.json().catch(() => ({})) as {
      challenge?: string
      token?: string
      header?: {
        event_type?: string
        token?: string
      }
      event?: {
        sender?: {
          sender_id?: {
            open_id?: string
            user_id?: string
          }
          sender_type?: string
        }
        message?: {
          content?: string
          chat_id?: string
          chat_type?: string
          message_id?: string
          message_type?: string
          mentions?: Array<{
            id?: { open_id?: string }
            mentioned_type?: string
          }>
        }
      }
      encrypt?: string
    }

    if (typeof body.encrypt === 'string' && body.encrypt.trim()) {
      if (!feishu.encryptKey.trim()) {
        return c.json({ ok: false, message: '当前 Agent 的飞书 Encrypt Key 未配置。' }, 400)
      }

      const decrypted = decryptFeishuEventPayload(feishu.encryptKey, body.encrypt)
      if (!decrypted.ok) {
        return c.json({ ok: false, message: decrypted.message }, 400)
      }

      body = decrypted.payload as typeof body
    }

    const requestToken = body.token?.trim() || body.header?.token?.trim() || ''
    if (feishu.verificationToken.trim() && requestToken !== feishu.verificationToken.trim()) {
      return c.json({ ok: false, message: '飞书 verification token 不匹配。' }, 401)
    }

    if (body.challenge) {
      return c.json({ challenge: body.challenge })
    }

    if (body.header?.event_type !== 'im.message.receive_v1') {
      return c.json({ ok: true, ignored: true })
    }

    const result = await processFeishuInboundEvent({ agentId, workspaceId, event: body.event })
    if (result.error) {
      return c.json({ ok: false, message: result.error.message }, result.error.status)
    }
    return c.json(result)
  })

  app.post('/api/telegram/webhook', async (c) => {
    if (!isTelegramEnabled()) {
      return c.json({ ok: false, message: 'Telegram bot not configured' }, 400)
    }

    const update = await c.req.json()
    await processTelegramUpdate(update)
    return c.json({ ok: true })
  })

}
