// [INPUT]: 已鉴权 Hono app + requireAuth；社区渠道配置（meta）与二维码上传
// [OUTPUT]: /api/site/community-channels（公开）、/api/site/community/wechat-qr/:filename（公开）、/api/admin/settings/community-channels（owner）
// [POS]: 社区渠道（Telegram / 飞书 / 微信群二维码）公开读取与超管配置 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { getUserById } from '../repositories/auth'
import { getMeta, saveMeta } from '../storage/app-state-store'
import { saveAuditLog } from '../storage/governance-store'
import { streamObject, uploadObject } from '../services/object-storage'
import { getUserIdFromHeader, jsonError } from './shared'
import { resolveAdminAccess } from './admin-routes'

const COMMUNITY_CHANNELS_META_KEY = 'settings:community-channels'

export type CommunityChannelsConfig = {
  telegramUrl?: string
  feishuUrl?: string
  wechatQrUrl?: string
}

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())
const isSafeImageUrl = (value: string) => value.trim().startsWith('/') || isAbsoluteHttpUrl(value)

/** 配置校验：Telegram / 飞书必须是 http(s) 链接；微信群二维码允许链接或相对路径。
 * 返回错误消息；null 表示合法。 */
export const validateCommunityChannels = (value: CommunityChannelsConfig): string | null => {
  if (value.telegramUrl && !isAbsoluteHttpUrl(value.telegramUrl)) {
    return 'Telegram 链接必须是 http(s) 地址。'
  }
  if (value.feishuUrl && !isAbsoluteHttpUrl(value.feishuUrl)) {
    return '飞书群链接必须是 http(s) 地址。'
  }
  if (value.wechatQrUrl && !isSafeImageUrl(value.wechatQrUrl)) {
    return '微信群二维码必须是 http(s) 图片地址或相对路径。'
  }
  return null
}

const QR_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
const MAX_QR_IMAGE_SIZE = 5 * 1024 * 1024

const toWechatQrObjectKey = (filename: string) => `community/wechat-qr/${filename}`
const toWechatQrPublicUrl = (filename: string) => `/api/site/community/wechat-qr/${filename}`

const WECHAT_QR_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/

const adminAudit = (actorId: string, eventType: string, payload: Record<string, unknown>) => {
  saveAuditLog({
    id: crypto.randomUUID(),
    eventType,
    actorType: 'user',
    actorId,
    payload,
    createdAt: new Date().toISOString(),
  })
}

export const registerCommunityChannelRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const requireOwner: MiddlewareHandler = async (c, next) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const access = resolveAdminAccess(getUserById(userId))
    if (access.role !== 'owner') {
      return c.json({ message: '仅总管理员（owner）可配置社区渠道。' }, 403)
    }
    await next()
  }

  // ---------- 公开读取（登录页 / 落地页 / 侧栏弹窗共用，无需鉴权） ----------

  app.get('/api/site/community-channels', async (c) => {
    const stored = getMeta<CommunityChannelsConfig>(COMMUNITY_CHANNELS_META_KEY, {})
    const channels: CommunityChannelsConfig = {}
    for (const key of ['telegramUrl', 'feishuUrl', 'wechatQrUrl'] as const) {
      if (typeof stored[key] === 'string') {
        channels[key] = stored[key]
      }
    }
    return c.json({ channels })
  })

  app.get('/api/site/community/wechat-qr/:filename', async (c) => {
    const filename = c.req.param('filename')
    if (!WECHAT_QR_FILENAME_PATTERN.test(filename)) {
      return jsonError(c, '二维码不存在', 404)
    }
    const response = await streamObject(toWechatQrObjectKey(filename))
    if (response.status !== 404) {
      return response
    }
    return jsonError(c, '二维码不存在', 404)
  })

  // ---------- 超管配置（owner） ----------

  app.get('/api/admin/settings/community-channels', requireAuth, requireOwner, async (c) => {
    const stored = getMeta<CommunityChannelsConfig>(COMMUNITY_CHANNELS_META_KEY, {})
    const channels: CommunityChannelsConfig = {}
    for (const key of ['telegramUrl', 'feishuUrl', 'wechatQrUrl'] as const) {
      if (typeof stored[key] === 'string') {
        channels[key] = stored[key]
      }
    }
    return c.json({ channels, ok: true })
  })

  app.put('/api/admin/settings/community-channels', requireAuth, requireOwner, async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const payload = z.object({
      telegramUrl: z.string().trim().optional(),
      feishuUrl: z.string().trim().optional(),
      wechatQrUrl: z.string().trim().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    const next: CommunityChannelsConfig = {
      telegramUrl: payload.telegramUrl ?? '',
      feishuUrl: payload.feishuUrl ?? '',
      wechatQrUrl: payload.wechatQrUrl ?? '',
    }
    const validationError = validateCommunityChannels(next)
    if (validationError) {
      return c.json({ message: validationError }, 400)
    }

    saveMeta(COMMUNITY_CHANNELS_META_KEY, next)
    adminAudit(actorId, 'admin_community_channels_updated', { ...next })
    return c.json({ channels: next, ok: true })
  })

  app.post('/api/admin/settings/community-channels/qr-upload', requireAuth, requireOwner, async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const formData = await c.req.formData().catch(() => null)
    const file = formData?.get('file')
    if (!(file instanceof File)) {
      return c.json({ message: '请选择要上传的二维码图片。' }, 400)
    }
    const extension = QR_IMAGE_TYPES.get(file.type)
    if (!extension) {
      return c.json({ message: '仅支持 JPG、PNG、WebP 或 GIF 图片。' }, 400)
    }
    if (file.size > MAX_QR_IMAGE_SIZE) {
      return c.json({ message: '二维码图片大小不能超过 5MB。' }, 400)
    }

    const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`
    await uploadObject(toWechatQrObjectKey(filename), await file.arrayBuffer(), { contentType: file.type })
    const url = toWechatQrPublicUrl(filename)
    adminAudit(actorId, 'admin_community_wechat_qr_uploaded', { filename })
    return c.json({ url, ok: true })
  })
}
