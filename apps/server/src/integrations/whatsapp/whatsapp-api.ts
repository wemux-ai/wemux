// [INPUT]: WhatsApp Business Cloud API 凭证、webhook 回调与 Graph 请求。
// [OUTPUT]: webhook 验证、消息回调解析、文本消息发送。
// [POS]: WhatsApp 渠道的协议/REST 层；HTTP 回调接线在 channel-routes。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const WHATSAPP_GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export type WhatsappInboundMessage = {
  from: string
  messageId: string
  text: string
  messageType: string
  profileName: string
}

/**
 * 解析 Cloud API webhook 消息回调 payload：
 * { entry: [{ changes: [{ value: { messages: [{ from, id, type, text: { body } }], contacts: [...] } }] }] }
 */
export const parseWhatsappWebhookPayload = (payload: unknown): WhatsappInboundMessage[] => {
  const data = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from?: string
            id?: string
            type?: string
            text?: { body?: string }
          }>
          contacts?: Array<{ profile?: { name?: string } }>
        }
      }>
    }>
  }
  const messages: WhatsappInboundMessage[] = []
  for (const entry of data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value?.messages) continue
      const profileName = value.contacts?.[0]?.profile?.name?.trim() || 'whatsapp-user'
      for (const message of value.messages) {
        const from = message.from?.trim() || ''
        const messageId = message.id?.trim() || ''
        const type = message.type?.trim() || ''
        if (!from || !messageId) continue
        const text = type === 'text' ? message.text?.body?.trim() || '' : ''
        if (!text) continue
        messages.push({ from, messageId, text, messageType: type, profileName })
      }
    }
  }
  return messages
}

/** webhook 验证：校验 hub.verify_token 后返回 hub.challenge。 */
export const verifyWhatsappWebhook = (params: {
  verifyToken: string
  mode?: string
  token?: string
  challenge?: string
}): { ok: boolean; challenge?: string; message?: string } => {
  if (params.mode !== 'subscribe') {
    return { ok: false, message: 'mode 必须是 subscribe。' }
  }
  if (!params.token || params.token !== params.verifyToken) {
    return { ok: false, message: 'verify_token 不匹配。' }
  }
  if (!params.challenge) {
    return { ok: false, message: '缺少 hub.challenge。' }
  }
  return { ok: true, challenge: params.challenge }
}

/** 发送文本消息（Graph API messages 端点）。 */
export const sendWhatsappTextMessage = async (params: {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
}): Promise<{ ok: boolean; message?: string }> => {
  try {
    const response = await fetch(`${WHATSAPP_GRAPH_BASE}/${encodeURIComponent(params.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'text',
        text: { body: params.text },
      }),
    })
    const payload = await response.json() as { error?: { message?: string }; messages?: Array<{ id?: string }> }
    if (!response.ok || payload.error) {
      return { ok: false, message: payload.error?.message || `WhatsApp HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'WhatsApp 消息发送失败。' }
  }
}
