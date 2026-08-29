// [INPUT]: Feishu app credentials and inbound-message identifiers.
// [OUTPUT]: Feishu webhook, context-message retrieval, text/card reply, patch, and reaction API results.
// [POS]: Server-side Feishu transport adapter; it does not own channel orchestration.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import { createDecipheriv, createHash } from 'node:crypto'

interface FeishuTextMessage {
  msg_type: 'text'
  content: {
    text: string
  }
}

export type FeishuAppSendConfig = {
  appId: string
  appSecret: string
}

export type FeishuAppContextMessage = {
  message_id?: string
  msg_type?: string
  create_time?: string
  parent_id?: string
  root_id?: string
  thread_id?: string
  sender?: {
    id?: string
    sender_type?: string
  }
  body?: {
    content?: string
  }
}

type FeishuAppMessageResult = {
  message_id?: string
  reaction_id?: string
}

const botOpenIdsByAppId = new Map<string, string>()

const postFeishuWebhook = async (webhookUrl: string, text: string): Promise<{ ok: boolean; message?: string }> => {
  if (!webhookUrl.trim()) {
    return { ok: false, message: '飞书 Webhook 未配置' }
  }

  try {
    const payload: FeishuTextMessage = {
      msg_type: 'text',
      content: { text },
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { ok: false, message: `飞书通知发送失败: ${response.status}` }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '飞书通知发送失败' }
  }
}

const getFeishuAppAccessToken = async (config: FeishuAppSendConfig) => {
  const appId = config.appId.trim()
  const appSecret = config.appSecret.trim()
  if (!appId || !appSecret) {
    return { ok: false as const, message: '飞书 App ID / App Secret 未配置' }
  }

  try {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    })
    const payload = await response.json().catch(() => ({})) as {
      code?: number
      msg?: string
      app_access_token?: string
      tenant_access_token?: string
    }
    const token = String(payload.app_access_token || payload.tenant_access_token || '').trim()
    if (!response.ok || !token) {
      return { ok: false as const, message: payload.msg || `飞书 access token 获取失败 (${response.status})` }
    }

    return { ok: true as const, token }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : '飞书 access token 获取失败',
    }
  }
}

export const getFeishuBotOpenId = async (config: FeishuAppSendConfig) => {
  const appId = config.appId.trim()
  const cached = botOpenIdsByAppId.get(appId)
  if (cached) {
    return { ok: true as const, openId: cached }
  }

  const tokenResult = await getFeishuAppAccessToken(config)
  if (!tokenResult.ok) {
    return tokenResult
  }

  try {
    const response = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    })
    const payload = await response.json().catch(() => ({})) as {
      code?: number
      msg?: string
      bot?: { open_id?: string }
      data?: { bot?: { open_id?: string } }
    }
    const openId = payload.bot?.open_id?.trim() || payload.data?.bot?.open_id?.trim() || ''
    if (!response.ok || payload.code !== 0 || !openId) {
      return { ok: false as const, message: payload.msg || `飞书机器人信息获取失败 (${response.status})` }
    }

    botOpenIdsByAppId.set(appId, openId)
    return { ok: true as const, openId }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : '飞书机器人信息获取失败',
    }
  }
}

const requestFeishuAppMessage = async (
  config: FeishuAppSendConfig,
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body: Record<string, unknown> | undefined,
  failureMessage: string,
) => {
  const tokenResult = await getFeishuAppAccessToken(config)
  if (!tokenResult.ok) {
    return tokenResult
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await response.json().catch(() => ({})) as { code?: number; msg?: string; data?: FeishuAppMessageResult }
    if (!response.ok || payload.code !== 0) {
      return {
        ok: false as const,
        message: payload.msg || `${failureMessage} (${response.status})`,
      }
    }

    return {
      ok: true as const,
      messageId: payload.data?.message_id,
      reactionId: payload.data?.reaction_id,
    }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : failureMessage,
    }
  }
}

const getFeishuAppContextMessages = async (
  config: FeishuAppSendConfig,
  url: string,
  failureMessage: string,
) => {
  const tokenResult = await getFeishuAppAccessToken(config)
  if (!tokenResult.ok) {
    return tokenResult
  }

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    })
    const payload = await response.json().catch(() => ({})) as {
      code?: number
      msg?: string
      data?: { items?: FeishuAppContextMessage[] }
    }
    if (!response.ok || payload.code !== 0) {
      return { ok: false as const, message: payload.msg || `${failureMessage} (${response.status})` }
    }

    return { ok: true as const, messages: payload.data?.items ?? [] }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : failureMessage }
  }
}

export const getFeishuAppContextMessage = async (
  config: FeishuAppSendConfig,
  messageId: string,
) => {
  const normalizedMessageId = messageId.trim()
  if (!normalizedMessageId) {
    return { ok: false as const, message: '飞书消息 ID 为空' }
  }

  const result = await getFeishuAppContextMessages(
    config,
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(normalizedMessageId)}?user_id_type=open_id`,
    '飞书上下文消息读取失败',
  )
  if (!result.ok) return result
  const message = result.messages[0]
  return message
    ? { ok: true as const, message }
    : { ok: false as const, message: '飞书上下文消息不存在或不可读取' }
}

export const listFeishuAppContextMessages = async (
  config: FeishuAppSendConfig,
  params: {
    containerId: string
    containerIdType: 'chat' | 'thread'
    endTime?: number
    pageSize?: number
  },
) => {
  const containerId = params.containerId.trim()
  if (!containerId) {
    return { ok: false as const, message: '飞书上下文容器 ID 为空' }
  }

  const query = new URLSearchParams({
    container_id_type: params.containerIdType,
    container_id: containerId,
    sort_type: 'ByCreateTimeDesc',
    page_size: String(Math.min(50, Math.max(1, params.pageSize ?? 10))),
    user_id_type: 'open_id',
  })
  if (params.endTime && params.endTime > 0) query.set('end_time', String(Math.floor(params.endTime)))
  return getFeishuAppContextMessages(
    config,
    `https://open.feishu.cn/open-apis/im/v1/messages?${query.toString()}`,
    '飞书会话上下文读取失败',
  )
}

export const sendFeishuAppTextMessage = async (
  config: FeishuAppSendConfig,
  params: {
    receiveId: string
    receiveIdType: 'open_id' | 'user_id' | 'chat_id'
    text: string
  },
) => {
  return requestFeishuAppMessage(
    config,
    'POST',
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${params.receiveIdType}`,
    {
      receive_id: params.receiveId.trim(),
      msg_type: 'text',
      content: JSON.stringify({ text: params.text }),
    },
    '飞书消息发送失败',
  )
}

export const replyFeishuAppTextMessage = async (
  config: FeishuAppSendConfig,
  params: {
    messageId: string
    text: string
    replyInThread?: boolean
  },
) => {
  const messageId = params.messageId.trim()
  if (!messageId) {
    return { ok: false as const, message: '飞书原消息 ID 为空' }
  }

  return requestFeishuAppMessage(
    config,
    'POST',
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    {
      msg_type: 'text',
      content: JSON.stringify({ text: params.text }),
      ...(params.replyInThread ? { reply_in_thread: true } : {}),
    },
    '飞书消息回复失败',
  )
}

export const replyFeishuAppInteractiveCard = async (
  config: FeishuAppSendConfig,
  params: {
    messageId: string
    card: Record<string, unknown>
    replyInThread?: boolean
  },
) => {
  const messageId = params.messageId.trim()
  if (!messageId) {
    return { ok: false as const, message: '飞书原消息 ID 为空' }
  }

  return requestFeishuAppMessage(
    config,
    'POST',
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
    {
      msg_type: 'interactive',
      content: JSON.stringify(params.card),
      ...(params.replyInThread ? { reply_in_thread: true } : {}),
    },
    '飞书卡片回复失败',
  )
}

export const patchFeishuAppInteractiveCard = async (
  config: FeishuAppSendConfig,
  params: {
    messageId: string
    card: Record<string, unknown>
  },
) => {
  const messageId = params.messageId.trim()
  if (!messageId) {
    return { ok: false as const, message: '飞书卡片消息 ID 为空' }
  }

  return requestFeishuAppMessage(
    config,
    'PATCH',
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
    { content: JSON.stringify(params.card) },
    '飞书卡片更新失败',
  )
}

export const addFeishuMessageReaction = async (
  config: FeishuAppSendConfig,
  params: {
    messageId: string
    emojiType: string
  },
) => {
  const messageId = params.messageId.trim()
  const emojiType = params.emojiType.trim()
  if (!messageId || !emojiType) {
    return { ok: false as const, message: '飞书原消息 ID 或表情类型为空' }
  }

  return requestFeishuAppMessage(
    config,
    'POST',
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      reaction_type: { emoji_type: emojiType },
    },
    '飞书消息表情添加失败',
  )
}

export const deleteFeishuMessageReaction = async (
  config: FeishuAppSendConfig,
  params: {
    messageId: string
    reactionId: string
  },
) => {
  const messageId = params.messageId.trim()
  const reactionId = params.reactionId.trim()
  if (!messageId || !reactionId) {
    return { ok: false as const, message: '飞书原消息 ID 或表情 ID 为空' }
  }

  return requestFeishuAppMessage(
    config,
    'DELETE',
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reactionId)}`,
    undefined,
    '飞书消息表情删除失败',
  )
}

const unpadPkcs7Buffer = (value: Buffer) => {
  const pad = value[value.length - 1]
  if (!pad || pad > 16) {
    return value
  }

  return value.subarray(0, value.length - pad)
}

export const decryptFeishuEventPayload = (encryptKey: string, encryptedText: string) => {
  const normalizedKey = encryptKey.trim()
  const normalizedEncryptedText = encryptedText.trim()
  if (!normalizedKey || !normalizedEncryptedText) {
    return { ok: false as const, message: '飞书 Encrypt Key 或加密内容为空' }
  }

  try {
    const encrypted = Buffer.from(normalizedEncryptedText, 'base64')
    const iv = encrypted.subarray(0, 16)
    const cipherText = encrypted.subarray(16)
    const aesKey = createHash('sha256').update(normalizedKey, 'utf8').digest()
    const decipher = createDecipheriv('aes-256-cbc', aesKey, iv)
    decipher.setAutoPadding(false)
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()])
    const plainText = unpadPkcs7Buffer(decrypted).toString('utf8')
    return { ok: true as const, payload: JSON.parse(plainText) as Record<string, unknown> }
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : '飞书加密回调解密失败',
    }
  }
}

export const sendFeishuMessageToWebhook = async (webhookUrl: string, text: string) => {
  return postFeishuWebhook(webhookUrl, text)
}
