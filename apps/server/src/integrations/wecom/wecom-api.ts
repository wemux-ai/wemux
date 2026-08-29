// [INPUT]: 企业微信（WeCom）自建应用凭证、回调加密参数与 REST 请求。
// [OUTPUT]: 回调签名校验/AES 解密、access_token 缓存、应用消息发送。
// [POS]: 企业微信渠道的协议/REST 层；HTTP 回调接线在 channel-routes。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

export const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin'

// ---------------------------------------------------------------------------
// 回调加解密（微信企业微信官方 WXBizMsgCrypt 规范）
// ---------------------------------------------------------------------------

/** 归一化 EncodingAESKey（43 位 → 补齐 base64 → 32 字节 AES key）。 */
export const normalizeWecomEncodingAesKey = (encodingAesKey: string): Buffer | null => {
  const trimmed = encodingAesKey.trim()
  if (!/^[A-Za-z0-9+/]{43}$/.test(trimmed)) return null
  return Buffer.from(`${trimmed}=`, 'base64')
}

/**
 * 回调签名：SHA1(排序拼接 token/timestamp/nonce/encrypted)。
 * 用于 URL 验证（echostr 签名）与消息推送（Encrypt 签名）。
 */
export const buildWecomCallbackSignature = (token: string, timestamp: string, nonce: string, encrypted: string): string => {
  const parts = [token, timestamp, nonce, encrypted].sort()
  const joined = parts.join('')
  return createHash('sha1').update(joined, 'utf8').digest('hex')
}

/** AES-256-CBC 解密（PKCS7），并解析 随机串(16)+消息长度(4)+消息+corpid 格式。 */
export const decryptWecomCallbackPayload = (
  encodingAesKey: string,
  encrypted: string,
  expectedCorpId: string,
): { message: string; corpId: string; random: string } | { error: string } => {
  const aesKey = normalizeWecomEncodingAesKey(encodingAesKey)
  if (!aesKey) return { error: 'EncodingAESKey 格式非法（需 43 位 base64）。' }
  let ciphertext: Buffer
  try {
    ciphertext = Buffer.from(encrypted, 'base64')
  } catch {
    return { error: '密文不是合法 base64。' }
  }
  try {
    const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
    decipher.setAutoPadding(false)
    const raw = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    // 去掉 PKCS7 填充
    const pad = raw[raw.length - 1]
    const unpadded = pad >= 1 && pad <= 32 ? raw.subarray(0, raw.length - pad) : raw
    const random = unpadded.subarray(0, 16).toString('utf8')
    const msgLen = unpadded.readUInt32BE(16)
    const message = unpadded.subarray(20, 20 + msgLen).toString('utf8')
    const corpId = unpadded.subarray(20 + msgLen).toString('utf8')
    if (!message || corpId !== expectedCorpId) {
      return { error: '回调解密失败：corpid 不匹配或消息为空。' }
    }
    return { message, corpId, random }
  } catch (error) {
    return { error: error instanceof Error ? `回调解密失败：${error.message}` : '回调解密失败。' }
  }
}

/** URL 验证：对 echostr 解密后返回明文随机串。 */
export const decryptWecomEchoStr = (
  encodingAesKey: string,
  echostr: string,
  corpId: string,
): { ok: boolean; echostr?: string; message?: string } => {
  const result = decryptWecomCallbackPayload(encodingAesKey, echostr, corpId)
  if ('error' in result) return { ok: false, message: result.error }
  return { ok: true, echostr: result.message }
}

/** AES-256-CBC 加密（企业回调回复场景备用；当前回复走 message/send API）。 */
export const encryptWecomCallbackPayload = (encodingAesKey: string, message: string, corpId: string): { ok: boolean; encrypted?: string; message?: string } => {
  const aesKey = normalizeWecomEncodingAesKey(encodingAesKey)
  if (!aesKey) return { ok: false, message: 'EncodingAESKey 格式非法。' }
  const msgBuf = Buffer.from(message, 'utf8')
  const random = randomBytes(16)
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(msgBuf.length, 0)
  const plaintext = Buffer.concat([random, lenBuf, msgBuf, Buffer.from(corpId, 'utf8')])
  // PKCS7 填充到 32 字节块
  const blockSize = 32
  const pad = blockSize - (plaintext.length % blockSize)
  const padded = Buffer.concat([plaintext, Buffer.alloc(pad, pad)])
  try {
    const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
    cipher.setAutoPadding(false)
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
    return { ok: true, encrypted: encrypted.toString('base64') }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '加密失败。' }
  }
}

// ---------------------------------------------------------------------------
// XML 解析（企业微信回调 XML 结构固定，正则提取足够）
// ---------------------------------------------------------------------------

export type WecomCallbackMessage = {
  toUserName: string
  fromUserName: string
  createTime: string
  msgType: string
  /** text 消息内容 */
  content: string
  msgId: string
  /** 事件（subscribe 等）Event 字段 */
  event?: string
}

const xmlTag = (xml: string, tag: string) => {
  const match = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? (match[1] ?? match[2] ?? '').trim() : ''
}

/** 提取回调 XML 的 <Encrypt> 密文。 */
export const extractWecomEncrypt = (xml: string): string => {
  return xmlTag(xml, 'Encrypt')
}

/** 解析解密后的业务 XML 消息。 */
export const parseWecomCallbackMessage = (xml: string): WecomCallbackMessage | null => {
  const msgType = xmlTag(xml, 'MsgType')
  const fromUserName = xmlTag(xml, 'FromUserName')
  if (!msgType || !fromUserName) return null
  return {
    toUserName: xmlTag(xml, 'ToUserName'),
    fromUserName,
    createTime: xmlTag(xml, 'CreateTime'),
    msgType,
    content: xmlTag(xml, 'Content'),
    msgId: xmlTag(xml, 'MsgId'),
    event: xmlTag(xml, 'Event') || undefined,
  }
}

// ---------------------------------------------------------------------------
// REST：access_token + 应用消息发送
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

/** 获取 access_token（2h 有效，进程内缓存，提前 5 分钟过期）。 */
export const getWecomAccessToken = async (corpId: string, secret: string): Promise<{ ok: boolean; token?: string; message?: string }> => {
  const key = `${corpId}:${secret}`
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) {
    return { ok: true, token: cached.token }
  }
  try {
    const url = `${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`
    const response = await fetch(url)
    const payload = await response.json() as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number }
    if (payload.errcode !== 0 || !payload.access_token) {
      return { ok: false, message: payload.errmsg || `gettoken errcode=${payload.errcode}` }
    }
    const expiresAt = Date.now() + (payload.expires_in ?? 7200) * 1000
    tokenCache.set(key, { token: payload.access_token, expiresAt })
    return { ok: true, token: payload.access_token }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '获取 access_token 失败。' }
  }
}

/** 发送应用文本消息（touser 支持 | 分隔多用户）。 */
export const sendWecomAppMessage = async (params: {
  corpId: string
  agentId: string
  secret: string
  touser: string
  content: string
}): Promise<{ ok: boolean; message?: string }> => {
  const tokenResult = await getWecomAccessToken(params.corpId, params.secret)
  if (!tokenResult.ok || !tokenResult.token) {
    return { ok: false, message: tokenResult.message || '获取 access_token 失败。' }
  }
  try {
    const response = await fetch(`${WECOM_API_BASE}/message/send?access_token=${encodeURIComponent(tokenResult.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: params.touser,
        msgtype: 'text',
        agentid: Number(params.agentId),
        text: { content: params.content },
      }),
    })
    const payload = await response.json() as { errcode?: number; errmsg?: string }
    if (payload.errcode !== 0) {
      return { ok: false, message: payload.errmsg || `message/send errcode=${payload.errcode}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '企业微信消息发送失败。' }
  }
}
