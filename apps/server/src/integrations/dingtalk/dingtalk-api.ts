// [INPUT]: 钉钉企业内部应用凭证、Stream 网关与机器人发送请求。
// [OUTPUT]: access_token、Stream 连接、机器人单聊发送、Stream 事件解析。
// [POS]: 钉钉渠道的协议/REST 层；WebSocket 长连接在 stream.ts。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export const DINGTALK_TOKEN_URL = 'https://oapi.dingtalk.com/gettoken'
export const DINGTALK_GATEWAY_URL = 'https://api.dingtalk.com/v1.0/gateway/connections/open'
export const DINGTALK_ROBOT_SEND_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend'

/** 机器人消息回调 topic。 */
export const DINGTALK_TOPIC_ROBOT = '/v1.0/im/bot/messages/get'

export type DingtalkStreamEvent = {
  specVersion: string
  type: string
  headers: {
    appId: string
    connectionId: string
    contentType: string
    messageId: string
    time: string
    topic: string
    eventType?: string
    eventId?: string
    eventCorpId?: string
  }
  data: string
}

/** 机器人单聊消息 data（JSON 字符串内）。 */
export type DingtalkRobotMessage = {
  conversationId: string
  chatbotCorpId: string
  chatbotUserId: string
  msgId: string
  senderNick: string
  isAdmin: boolean
  senderStaffId: string
  sessionWebhook?: string
  msgtype?: string
  text?: { content: string }
  msgtime?: number
  createAt?: number
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

/** 获取企业内部应用 access_token（2h 有效，进程内缓存）。 */
export const getDingtalkAccessToken = async (appKey: string, appSecret: string): Promise<{ ok: boolean; token?: string; message?: string }> => {
  const key = `${appKey}:${appSecret}`
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return { ok: true, token: cached.token }
  }
  try {
    const url = `${DINGTALK_TOKEN_URL}?appkey=${encodeURIComponent(appKey)}&appsecret=${encodeURIComponent(appSecret)}`
    const response = await fetch(url)
    const payload = await response.json() as { errcode?: number; errmsg?: string; access_token?: string; expire_in?: number }
    if (payload.errcode !== 0 || !payload.access_token) {
      return { ok: false, message: payload.errmsg || `gettoken errcode=${payload.errcode}` }
    }
    const expiresAt = Date.now() + (payload.expire_in ?? 7200) * 1000
    tokenCache.set(key, { token: payload.access_token, expiresAt })
    return { ok: true, token: payload.access_token }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '获取钉钉 access_token 失败。' }
  }
}

/** 打开 Stream 网关连接（返回 wss endpoint + ticket，组装 ws URL）。 */
export const openDingtalkStreamConnection = async (params: {
  appKey: string
  appSecret: string
}): Promise<{ ok: boolean; wsUrl?: string; message?: string }> => {
  const tokenResult = await getDingtalkAccessToken(params.appKey, params.appSecret)
  if (!tokenResult.ok || !tokenResult.token) {
    return { ok: false, message: tokenResult.message || '获取 access_token 失败。' }
  }
  try {
    const response = await fetch(DINGTALK_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': tokenResult.token,
      },
      body: JSON.stringify({
        clientId: params.appKey,
        clientSecret: params.appSecret,
        subscriptions: [{ type: 'EVENT', topic: '*' }],
        ua: 'wemux/0.3.116',
      }),
    })
    const payload = await response.json() as { endpoint?: string; ticket?: string; code?: string; message?: string }
    if (!payload.endpoint || !payload.ticket) {
      return { ok: false, message: payload.message || `gateway open 失败（code=${payload.code}）` }
    }
    return { ok: true, wsUrl: `${payload.endpoint}?ticket=${encodeURIComponent(payload.ticket)}` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '打开钉钉 Stream 网关失败。' }
  }
}

/** 解析 WS 下发的 Stream 事件 JSON。 */
export const parseDingtalkStreamEvent = (raw: string): DingtalkStreamEvent | null => {
  try {
    const parsed = JSON.parse(raw) as DingtalkStreamEvent
    if (parsed.type !== 'EVENT' || !parsed.headers?.topic) return null
    return parsed
  } catch {
    return null
  }
}

/** 解析机器人消息事件 data（JSON 字符串）为统一文本消息。 */
export const parseDingtalkRobotMessage = (event: DingtalkStreamEvent): { message: DingtalkRobotMessage; text: string } | null => {
  if (event.headers.topic !== DINGTALK_TOPIC_ROBOT) return null
  try {
    const message = JSON.parse(event.data) as DingtalkRobotMessage
    if (!message.msgId || !message.senderStaffId) return null
    const text = message.msgtype === 'text' ? message.text?.content?.trim() || '' : ''
    if (!text) return null
    return { message, text }
  } catch {
    return null
  }
}

/** 机器人单聊发送文本（oToMessages/batchSend）。 */
export const sendDingtalkOtMessage = async (params: {
  appKey: string
  appSecret: string
  robotCode: string
  userIds: string[]
  content: string
}): Promise<{ ok: boolean; message?: string }> => {
  const tokenResult = await getDingtalkAccessToken(params.appKey, params.appSecret)
  if (!tokenResult.ok || !tokenResult.token) {
    return { ok: false, message: tokenResult.message || '获取 access_token 失败。' }
  }
  try {
    const response = await fetch(DINGTALK_ROBOT_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': tokenResult.token,
      },
      body: JSON.stringify({
        robotCode: params.robotCode,
        userIds: params.userIds,
        msgKey: 'sampleText',
        msgParam: JSON.stringify({ content: params.content }),
      }),
    })
    const payload = await response.json() as { code?: string; message?: string }
    if (payload.code && payload.code !== '0') {
      return { ok: false, message: payload.message || `机器人发送失败（code=${payload.code}）` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '钉钉机器人发送失败。' }
  }
}
