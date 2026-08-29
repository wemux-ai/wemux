/**
 * [INPUT]: 飞书事件回调 / Discord interaction 的入站请求（带平台验签）
 * [OUTPUT]: 渠道反馈 → ingestFeedback；未配置凭据时显式 503；验签失败 401
 * [POS]: 全渠道收件箱的入站 HTTP 表面；解析与意图判定在 feedback-channel-intents（纯函数）
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import type { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { getEnv } from '@shared/env'
import { ingestFeedback } from '../services/feedback-ingest-service'
import { extractDiscordFeedbackIntent, extractFeishuFeedbackIntent } from '../services/feedback-channel-intents'
import { decryptFeishuEventPayload } from '../integrations/feishu'

// —— 平台验签 ——

/** 飞书事件订阅签名（v1）：X-Lark-Signature = v1_<ts>_<nonce>_<sha256hex>，digest = sha256(ts + nonce + encryptKey + rawBody)。 */
const verifyFeishuSignature = (encryptKey: string, rawBody: string, signature: string | undefined): boolean => {
  if (!signature) return false
  const match = signature.trim().match(/^(?:v1_)?(\d+)_([^_]+)_([a-f0-9]{64})$/i)
  if (!match) return false
  const [, timestamp, nonce, digest] = match
  const computed = createHash('sha256').update(`${timestamp}${nonce}${encryptKey}${rawBody}`).digest('hex')
  return computed === digest.toLowerCase()
}

/** Discord interaction 验签：Ed25519(publicKey, timestamp + rawBody)。public key 为 32 字节 hex。 */
const verifyDiscordSignature = (publicKeyHex: string, rawBody: string, signature: string | undefined, timestamp: string | undefined): boolean => {
  if (!signature || !timestamp) return false
  try {
    const rawKey = Buffer.from(publicKeyHex.trim(), 'hex')
    if (rawKey.length !== 32) return false
    // SPKI 包装：DER 头 + 32 字节 Ed25519 公钥
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey])
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    return verify(null, Buffer.from(`${timestamp}${rawBody}`), key, Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

export const registerFeedbackChannelRoutes = (app: Hono, _requireAuth: MiddlewareHandler) => {
  // 飞书事件订阅回调：URL 验证（challenge）+ im.message.receive_v1 → 反馈收件箱
  app.post('/api/channels/feishu/events', async (c) => {
    const encryptKey = getEnv('WEMUX_FEEDBACK_FEISHU_ENCRYPT_KEY')?.trim()
    if (!encryptKey) {
      return c.json({ message: '飞书反馈渠道未配置（WEMUX_FEEDBACK_FEISHU_ENCRYPT_KEY）' }, 503)
    }

    const rawBody = await c.req.text()
    if (!verifyFeishuSignature(encryptKey, rawBody, c.req.header('X-Lark-Signature'))) {
      return c.json({ message: '签名校验失败' }, 401)
    }

    const body = JSON.parse(rawBody) as Record<string, unknown>

    // URL 验证：明文 challenge 直接回显
    if (body.type === 'url_verification' && typeof body.challenge === 'string') {
      return c.json({ challenge: body.challenge })
    }

    // 加密事件：解密后解析
    let payload: Record<string, unknown> = body
    if (typeof body.encrypt === 'string') {
      const decrypted = decryptFeishuEventPayload(encryptKey, body.encrypt)
      if (!decrypted.ok) return c.json({ message: decrypted.message }, 400)
      payload = decrypted.payload
    }

    const intent = extractFeishuFeedbackIntent(payload as Parameters<typeof extractFeishuFeedbackIntent>[0])
    if (intent) {
      await ingestFeedback({ ...intent, consentPublic: false }).catch((error: unknown) => {
        console.error('[feedback-channel] 飞书反馈入库失败', error instanceof Error ? error.message : error)
      })
    }
    // 飞书要求立即 ack，无论是否命中反馈
    return c.json({})
  })

  // Discord interaction 回调：PING 保活 + /feedback 命令 → 反馈收件箱
  app.post('/api/channels/discord/interactions', async (c) => {
    const publicKey = getEnv('WEMUX_FEEDBACK_DISCORD_PUBLIC_KEY')?.trim()
    if (!publicKey) {
      return c.json({ message: 'Discord 反馈渠道未配置（WEMUX_FEEDBACK_DISCORD_PUBLIC_KEY）' }, 503)
    }

    const rawBody = await c.req.text()
    if (!verifyDiscordSignature(publicKey, rawBody, c.req.header('X-Signature-Ed25519'), c.req.header('X-Signature-Timestamp'))) {
      return c.json({ message: '签名校验失败' }, 401)
    }

    const interaction = JSON.parse(rawBody) as Record<string, unknown>
    if (interaction.type === 1) {
      return c.json({ type: 1 }) // PING → PONG
    }

    const intent = extractDiscordFeedbackIntent(interaction as Parameters<typeof extractDiscordFeedbackIntent>[0])
    if (!intent) {
      return c.json({ type: 4, data: { content: '用法：/feedback 标题:... 内容:...', flags: 64 } })
    }

    const result = await ingestFeedback({ ...intent, consentPublic: false }).catch(() => null)
    const content = result ? `✅ 已收到反馈 ${result.item.id.slice(0, 12)}，我们会认真查看。` : '❌ 反馈提交失败，请稍后重试。'
    return c.json({ type: 4, data: { content, flags: 64 } })
  })
}
