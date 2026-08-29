// [INPUT]: 微信入站媒体明文（已解密）与下载请求。
// [OUTPUT]: 对象存储上传 / HMAC 下载 token / 免鉴权流式下载。
// [POS]: WeChat 渠道入站媒体附件存储层（复用 object-storage；图片属「非代码文件对象」，符合安全红线）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { createHmac, timingSafeEqual } from 'node:crypto'
import { resolveSharedTokenSecret } from './token-secret'
import { uploadObject, streamObject } from './object-storage'

const WECHAT_MEDIA_PREFIX = 'channel-media/wechat'
/** 下载 URL 时效：24 小时（executor 物化附件在会话执行时下载）。 */
export const WECHAT_MEDIA_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export const buildWechatMediaObjectKey = (agentId: string, messageId: number, ext: string) => {
  const safeExt = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin'
  return `${WECHAT_MEDIA_PREFIX}/${agentId.slice(0, 24)}/${messageId}.${safeExt}`
}

export const uploadWechatMediaObject = async (params: {
  agentId: string
  messageId: number
  ext: string
  buf: Buffer
  contentType: string
}) => {
  const key = buildWechatMediaObjectKey(params.agentId, params.messageId, params.ext)
  await uploadObject(key, params.buf, { contentType: params.contentType, cacheControl: 'private, max-age=0' })
  return key
}

const signWechatMediaPayload = (payload: string, secret: string) => {
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 48)
}

/** 生成微信媒体下载 token（无状态 HMAC：payload = issuedAt:agentId:messageId:ext）。 */
export const buildWechatMediaToken = (params: {
  agentId: string
  messageId: number
  ext: string
  issuedAt?: number
}) => {
  const secret = resolveSharedTokenSecret()
  if (!secret) return ''
  const issuedAt = params.issuedAt ?? Date.now()
  const safeExt = /^[a-z0-9]{1,8}$/i.test(params.ext) ? params.ext.toLowerCase() : 'bin'
  const payload = `${issuedAt}:${params.agentId}:${params.messageId}:${safeExt}`
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signWechatMediaPayload(payload, secret)}`
}

/** 校验并解析微信媒体 token（HMAC timing-safe + 时效）。 */
export const parseWechatMediaToken = (
  token: string,
  now = Date.now(),
): { agentId: string; messageId: number; ext: string; issuedAt: number } | null => {
  const secret = resolveSharedTokenSecret()
  if (!secret || !token) return null
  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0) return null

  const payloadPart = token.slice(0, dotIndex)
  const signaturePart = token.slice(dotIndex + 1)
  let payload: string
  try {
    payload = Buffer.from(payloadPart, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expectedSignature = signWechatMediaPayload(payload, secret)
  const signatureBuffer = Buffer.from(signaturePart)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null
  }

  const [issuedAtRaw, agentId, messageIdRaw, ext] = payload.split(':')
  const issuedAt = Number(issuedAtRaw)
  const messageId = Number(messageIdRaw)
  if (!Number.isFinite(issuedAt) || !agentId || !Number.isFinite(messageId) || !ext) {
    return null
  }
  if (now - issuedAt > WECHAT_MEDIA_TOKEN_TTL_MS) {
    return null
  }
  return { agentId, messageId, ext, issuedAt }
}

/** 流式下载对象（供免鉴权下载端点使用）。 */
export const streamWechatMediaObject = (key: string) => streamObject(key)
