// [INPUT]: 已鉴权 Hono app + requireAuth；native 端推送 token 注册/注销请求
// [OUTPUT]: /api/device-tokens（POST 注册 / DELETE 注销 / GET 列表）
// [POS]: 推送设备注册的 HTTP 协议层；实际 APNs/FCM 发送由后续批接入（无凭据前不发送）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  deleteDeviceToken,
  listDeviceTokens,
  upsertDeviceToken,
} from '../storage/postgres/device-tokens-store'
import { notifyUserPush, LogPushProvider } from '../services/push-gateway'
import { getUserIdFromHeader } from './shared'

const deviceTokenSchema = z.object({
  platform: z.enum(['android', 'ios']),
  token: z.string().trim().min(10).max(1024),
})

export const registerDeviceTokenRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 注册/刷新设备推送 token（幂等 upsert）
  app.post('/api/device-tokens', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const body = await c.req.json().catch(() => null)
    const parsed = deviceTokenSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ message: '设备 token 不合法', issues: parsed.error.flatten() }, 400)
    }
    const token = await upsertDeviceToken({
      userId,
      platform: parsed.data.platform,
      token: parsed.data.token,
    })
    return c.json({ token }, 201)
  })

  // 注销设备 token（退出登录/卸载时调用）
  app.delete('/api/device-tokens/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const id = c.req.param('id')?.trim()
    if (!id) {
      return c.json({ message: 'token ID 缺失' }, 400)
    }
    const removed = await deleteDeviceToken(userId, id)
    if (!removed) {
      return c.json({ message: 'token 不存在' }, 404)
    }
    return c.json({ removed: true })
  })

  // 设备 token 列表（诊断/管理用）
  app.get('/api/device-tokens', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const tokens = await listDeviceTokens(userId)
    return c.json({ tokens })
  })

  // 测试推送（feature 衔接：验证端侧 token 可达；真实发送由 provider 配置决定）
  app.post('/api/device-tokens/test', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const result = await notifyUserPush({
      userId,
      eventType: 'meeting.segment.valuable',
      payload: { segmentId: `test-${crypto.randomUUID().slice(0, 8)}`, transcript: '这是一条测试推送。' },
      providers: [new LogPushProvider('ios'), new LogPushProvider('android')],
    })
    return c.json({ result })
  })
}
