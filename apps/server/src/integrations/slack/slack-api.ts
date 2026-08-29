// [INPUT]: Slack App 凭证、Socket Mode envelope 与 REST 请求。
// [OUTPUT]: REST 出站（chat.postMessage）+ Socket Mode 连接 + 入站事件解析。
// [POS]: Slack 渠道的 REST/协议层；WebSocket 长连接在 socket-mode.ts。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const SLACK_API_BASE = 'https://slack.com/api'

export type SlackMessageEvent = {
  channelId: string
  userId: string
  userName: string
  text: string
  isBot: boolean
  isDm: boolean
  ts: string
  threadTs?: string
}

/** 解析 Socket Mode events_api envelope 为统一入站消息。 */
export const parseSlackEventEnvelope = (envelope: unknown): SlackMessageEvent | null => {
  const data = envelope as {
    type?: string
    payload?: {
      event?: {
        type?: string
        subtype?: string
        text?: string
        user?: string
        channel?: string
        ts?: string
        thread_ts?: string
        bot_id?: string
      }
    }
  }
  if (data.type !== 'events_api') return null
  const event = data.payload?.event
  if (!event || event.type !== 'message') return null
  // 忽略 bot 消息、消息更新/删除、子类型编辑
  if (event.bot_id || event.subtype === 'message_changed' || event.subtype === 'message_deleted') return null
  const text = event.text?.trim() || ''
  if (!text) return null
  const isDm = !String(event.channel || '').startsWith('C') || false
  return {
    channelId: event.channel || '',
    userId: event.user || '',
    userName: 'slack-user',
    text,
    isBot: false,
    isDm,
    ts: event.ts || '',
    threadTs: event.thread_ts,
  }
}

/** REST 发送消息（文本）。 */
export const sendSlackMessage = async (params: {
  botToken: string
  channelId: string
  text: string
  threadTs?: string
}): Promise<{ ok: boolean; message?: string }> => {
  try {
    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.botToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: params.channelId,
        text: params.text,
        ...(params.threadTs ? { thread_ts: params.threadTs } : {}),
      }),
    })
    const payload = await response.json() as { ok?: boolean; error?: string }
    if (!payload.ok) {
      return { ok: false, message: payload.error || `Slack HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Slack 消息发送失败。' }
  }
}

/** Socket Mode 建立连接（apps.connections.open，用 app token 换取 wss URL）。 */
export const openSlackSocketModeConnection = async (appToken: string): Promise<{ ok: boolean; url?: string; message?: string }> => {
  try {
    const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appToken.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const payload = await response.json() as { ok?: boolean; url?: string; error?: string }
    if (!payload.ok) {
      return { ok: false, message: payload.error || `apps.connections.open HTTP ${response.status}` }
    }
    return { ok: true, url: payload.url }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Slack Socket Mode 连接失败。' }
  }
}

/** 验证 bot token（auth.test）。 */
export const testSlackBotToken = async (botToken: string): Promise<{ ok: boolean; teamName?: string; message?: string }> => {
  try {
    const response = await fetch(`${SLACK_API_BASE}/auth.test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken.trim()}` },
    })
    const payload = await response.json() as { ok?: boolean; team?: string; error?: string }
    if (!payload.ok) {
      return { ok: false, message: payload.error || `auth.test HTTP ${response.status}` }
    }
    return { ok: true, teamName: payload.team }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Slack token 校验失败。' }
  }
}
