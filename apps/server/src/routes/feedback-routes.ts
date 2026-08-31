// [INPUT]: 已鉴权 Hono app + requireAuth；web 反馈表单、客服会话与 admin 反馈管理请求
// [OUTPUT]: /api/feedback /api/feedback/mine /api/feedback/:id /api/feedback/:id/messages
//           /api/admin/feedback /api/admin/feedback/attention-count /api/admin/feedback/:id /api/admin/feedback/:id/reply /api/telemetry/events
// [POS]: 用户反馈 + 客服会话（与创始人直接沟通）的 HTTP 协议层；消息走统一 conversation 模型，回复提醒走统一收件箱
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { FeedbackItem, FeedbackMessageRole, FeedbackStatus, FeedbackType } from '@shared/types'
import { publishInboxItem } from '../services/inbox-service'
import { isFeedbackAwaitingAdminReply } from '../services/feedback-escalation-service'
import { getUserById } from '../repositories/auth'
import { track } from '../services/telemetry-service'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { inboxItems } from '../storage/postgres/schema'
import {
  appendFeedbackMessage,
  buildFeedbackReplyInboxItem,
  extractFeedbackAttachments,
  listFeedbackMessages,
  resolveLastReply,
  type FeedbackConversationPersistence,
} from '../services/feedback-support-service'
import {
  createFeedbackItem,
  getFeedbackItem,
  listFeedbackItems,
  updateFeedbackConversation,
  updateFeedbackRouting,
  updateFeedbackStatus,
} from '../storage/postgres/feedback-store'
import { ingestFeedback } from '../services/feedback-ingest-service'
import { FeedbackPromotionError, promoteFeedbackToIssue } from '../services/feedback-promotion-service'
import { normalizeFeedback } from '../services/feedback-normalization-service'
import { draftFeedbackReply, reviewOutboundReply } from '../services/feedback-reply-review-service'
import { getUserIdFromHeader } from './shared'
import { resolveAdminAccess } from './admin-routes'

const feedbackAttachmentsSchema = z.array(z.object({
  kind: z.literal('drive'),
  driveFileId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
})).max(9)

const feedbackSubmitSchema = z.object({
  type: z.enum(['bug', 'feature', 'chat']),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  attachments: feedbackAttachmentsSchema.optional(),
  /** 同意将本条反馈脱敏后公开为社区提案（默认 false）。 */
  consentPublic: z.boolean().optional(),
})

const feedbackAdminUpdateSchema = z.object({
  status: z.enum(['open', 'triaged', 'closed']).optional(),
  routing: z.enum(['none', 'internal', 'community']).optional(),
}).refine((v) => v.status !== undefined || v.routing !== undefined, { message: '缺少要更新的字段' })

const feedbackPromoteSchema = z.object({
  scope: z.enum(['internal', 'community']),
})
const feedbackMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  attachments: feedbackAttachmentsSchema.optional(),
  /** 高风险审查的二次确认（admin 看过原因后仍要发送）。 */
  reviewed: z.boolean().optional(),
})

const telemetryEventSchema = z.object({
  eventType: z.enum([
    'signup_completed',
    'invite_used',
    'onboarding_completed',
    'worker_paired',
    'task_created',
    'task_first_review',
    'feedback_submitted',
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
})

/**
 * 反馈 admin 准入：与 admin-routes 统一（role(owner/admin) 为权威，
 * isInternal 为兼容位，WEMUX_ADMIN_EMAILS env 白名单可部署层指定）。
 * 修复前只认 isInternal，env 白名单/role 管理员在前端能进 admin 而接口 403，表现为「反馈接收不到」。
 */
const isFeedbackAdmin = (userId: string | null): boolean => {
  if (!userId) {
    return false
  }
  return resolveAdminAccess(getUserById(userId)).allowed
}

const resolveAdminName = (userId: string): string => {
  const user = getUserById(userId)
  return user?.name?.trim() || '创始人'
}

/** 客服会话的 conversationId 回写依赖 DB，由 routes 注入 feedback-store 实现。 */
const conversationPersistence: FeedbackConversationPersistence = {
  updateConversationId: async (feedbackId, conversationId) => {
    await updateFeedbackConversation(feedbackId, conversationId)
  },
}

/**
 * 客服会话（统一 conversation 模型，kind='feedback'）。
 * 保证 feedback 有一条可写的会话：已存在则复用，否则惰性创建并回写 conversationId。
 */

export const registerFeedbackRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 用户提交反馈（bug / 功能建议）→ 同时开启「与创始人直接沟通」会话
  app.post('/api/feedback', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const parsed = feedbackSubmitSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '反馈内容不合法', issues: parsed.error.flatten() }, 400)
    }

    const user = getUserById(userId)
    const { item } = await ingestFeedback({
      source: 'product',
      type: parsed.data.type,
      title: parsed.data.title,
      body: parsed.data.body,
      userId,
      userEmail: user?.email ?? null,
      consentPublic: parsed.data.consentPublic ?? false,
    })

    await appendFeedbackMessage({
      feedback: item,
      role: 'user',
      senderId: userId,
      authorName: user?.name?.trim() || undefined,
      content: parsed.data.body,
      attachments: parsed.data.attachments,
      persistence: conversationPersistence,
    })

    const refreshed = await getFeedbackItem(item.id)
    // 反馈本身也是一条运营事件
    void track({ eventType: 'feedback_submitted', userId, payload: { type: parsed.data.type, feedbackId: item.id } })

    return c.json({ feedback: refreshed ?? item }, 201)
  })

  // 用户查看自己提交的反馈（含创始人最近回复预览）
  app.get('/api/feedback/mine', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const items = await listFeedbackItems({ userId, limit: 100 })
    return c.json({
      feedback: items.map((item) => ({ ...item, ...resolveLastReply(item) })),
    })
  })


  app.post('/api/feedback/:id/messages', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const item = await getFeedbackItem(c.req.param('id'))
    if (!item) {
      return c.json({ message: '反馈不存在' }, 404)
    }
    if (item.userId !== userId) {
      return c.json({ message: '无权访问该反馈。' }, 403)
    }

    const parsed = feedbackMessageSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '消息内容不合法', issues: parsed.error.flatten() }, 400)
    }

    if (item.status === 'closed') {
      await updateFeedbackStatus(item.id, 'open')
    }
    const user = getUserById(userId)
    const message = await appendFeedbackMessage({
      feedback: item,
      role: 'user',
      senderId: userId,
      authorName: user?.name?.trim() || undefined,
      content: parsed.data.content,
      attachments: parsed.data.attachments,
      persistence: conversationPersistence,
    })

    const refreshed = await getFeedbackItem(item.id)
    return c.json({
      feedback: refreshed ? { ...refreshed, ...resolveLastReply(refreshed) } : item,
      message: {
        id: message.id,
        feedbackId: item.id,
        role: 'user' as const,
        senderId: message.senderId,
        senderName: message.authorName,
        content: message.content,
        attachments: extractFeedbackAttachments(message.externalRef),
        createdAt: message.createdAt,
      },
    })
  })

  // 用户与创始人的长聊天会话（每用户单一长上下文线程；无则返回 null）
  app.get('/api/feedback/chat', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const [chat] = await listFeedbackItems({ userId, type: 'chat', limit: 1 })
    if (!chat) {
      return c.json({ feedback: null, messages: [] })
    }
    return c.json({ feedback: { ...chat, ...resolveLastReply(chat) }, messages: listFeedbackMessages(chat) })
  })

  // 发送与创始人的聊天消息：确保单一 chat 会话，追加消息
  app.post('/api/feedback/chat/send', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const parsed = feedbackMessageSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '消息内容不合法', issues: parsed.error.flatten() }, 400)
    }
    const user = getUserById(userId)
    let chat = (await listFeedbackItems({ userId, type: 'chat', limit: 1 }))[0]
    if (!chat) {
      chat = await createFeedbackItem({
        id: `feedback:${crypto.randomUUID()}`,
        type: 'chat',
        title: '与创始人沟通',
        body: parsed.data.content || (parsed.data.attachments?.[0]?.name ?? ''),
        userId,
        userEmail: user?.email ?? null,
        createdAt: new Date().toISOString(),
      })
    }
    const message = await appendFeedbackMessage({
      feedback: chat,
      role: 'user',
      senderId: userId,
      authorName: user?.name?.trim() || undefined,
      content: parsed.data.content,
      attachments: parsed.data.attachments,
      persistence: conversationPersistence,
    })
    const refreshed = await getFeedbackItem(chat.id)
    return c.json({
      feedback: refreshed ? { ...refreshed, ...resolveLastReply(refreshed) } : chat,
      message: {
        id: message.id,
        feedbackId: chat.id,
        role: 'user' as const,
        senderId: message.senderId,
        senderName: message.authorName,
        content: message.content,
        attachments: extractFeedbackAttachments(message.externalRef),
        createdAt: message.createdAt,
      },
    })
  })

  // 问号红点：未读的创始人回复/升级提醒数（不进全局收件箱列表）
  app.get('/api/feedback/unread-count', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const rows = await getDrizzleDb().select({ id: inboxItems.id }).from(inboxItems).where(and(
      eq(inboxItems.recipientType, 'user'),
      eq(inboxItems.recipientId, userId),
      isNull(inboxItems.readAt),
      isNull(inboxItems.archivedAt),
      inArray(inboxItems.eventType, ['support.reply', 'support.escalation']),
    ))
    return c.json({ count: rows.length })
  })

  // 用户打开单个反馈会话（校验归属）
  // 注意：必须在 /chat、/unread-count 等静态 GET 路由之后注册，否则参数路由抢先匹配静态路径（404「反馈不存在」）
  app.get('/api/feedback/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const item = await getFeedbackItem(c.req.param('id'))
    if (!item) {
      return c.json({ message: '反馈不存在' }, 404)
    }
    if (item.userId !== userId) {
      return c.json({ message: '无权访问该反馈。' }, 403)
    }

    return c.json({ feedback: { ...item, ...resolveLastReply(item) }, messages: listFeedbackMessages(item) })
  })

  // 打开问号弹窗后：标已读全部创始人回复/升级提醒
  app.post('/api/feedback/read-replies', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    await getDrizzleDb().update(inboxItems).set({ readAt: new Date().toISOString() }).where(and(
      eq(inboxItems.recipientType, 'user'),
      eq(inboxItems.recipientId, userId),
      isNull(inboxItems.readAt),
      inArray(inboxItems.eventType, ['support.reply', 'support.escalation']),
    ))
    return c.json({ ok: true })
  })

  // 管理员反馈列表
  app.get('/api/admin/feedback', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以查看反馈。' }, 403)
    }

    const type = c.req.query('type') as FeedbackType | undefined
    const status = c.req.query('status') as FeedbackStatus | undefined
    const items = await listFeedbackItems({ type, status, limit: 300 })
    return c.json({ feedback: items })
  })

  // Admin 专属待办数：最后一条用户消息超过 SLA 且仍未获回复的反馈。
  app.get('/api/admin/feedback/attention-count', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以查看反馈。' }, 403)
    }

    const items = await listFeedbackItems({ limit: 300 })
    const count = items.filter((item) => isFeedbackAwaitingAdminReply(listFeedbackMessages(item))).length
    return c.json({ count })
  })

  // 管理员打开单个反馈会话（工单 + 消息 + 用户身份）
  app.get('/api/admin/feedback/:id', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以查看反馈。' }, 403)
    }

    const item = await getFeedbackItem(c.req.param('id'))
    if (!item) {
      return c.json({ message: '反馈不存在' }, 404)
    }

    return c.json({ feedback: item, messages: listFeedbackMessages(item) })
  })

  // 管理员回复用户（写入会话 + 更新工单 + 投递用户收件箱提醒）
  app.post('/api/admin/feedback/:id/reply', requireAuth, async (c) => {
    const adminUserId = getUserIdFromHeader(c)
    if (!isFeedbackAdmin(adminUserId)) {
      return c.json({ message: '只有内部管理员可以回复反馈。' }, 403)
    }

    const item = await getFeedbackItem(c.req.param('id'))
    if (!item) {
      return c.json({ message: '反馈不存在' }, 404)
    }

    const parsed = feedbackMessageSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '消息内容不合法', issues: parsed.error.flatten() }, 400)
    }

    const adminName = resolveAdminName(adminUserId!)

    // 发送前审查（规则兜底 + 可选 LLM）：high 风险未二次确认时拒绝发送
    const review = await reviewOutboundReply(parsed.data.content, {
      item,
      history: listFeedbackMessages(item),
    })
    if (review.risk === 'high' && !parsed.data.reviewed) {
      return c.json({ message: `回复存在高风险内容，确认后重试：${review.reasons.join('；')}`, review }, 409)
    }

    const message = await appendFeedbackMessage({
      feedback: item,
      role: 'assistant',
      senderId: adminUserId!,
      authorName: adminName,
      content: parsed.data.content,
      persistence: conversationPersistence,
    })

    if (item.status === 'open') {
      await updateFeedbackStatus(item.id, 'triaged')
    }

    // 回复提醒：站内统一收件箱（用户侧 badge / SSE）
    if (item.userId) {
      await publishInboxItem({
        recipientType: 'user',
        recipientId: item.userId,
        kind: 'directive',
        reason: 'replied',
        eventType: 'support.reply',
        actor: { type: 'user', id: adminUserId ?? undefined, name: adminName },
        title: `创始人回复：${item.title}`,
        body: parsed.data.content.length > 300
          ? `${parsed.data.content.slice(0, 300)}…`
          : parsed.data.content,
        scope: { feedbackId: item.id },
        groupKey: `feedback:${item.id}`,
        replyTo: { kind: 'feedback_item', feedbackId: item.id },
        dedupeKey: `support-reply:${item.id}:${message.id}`,
      })
    }

    const refreshed = await getFeedbackItem(item.id)
    return c.json({
      feedback: refreshed ?? item,
      review,
      message: {
        id: message.id,
        feedbackId: item.id,
        role: 'assistant' as const,
        senderId: message.senderId,
        senderName: message.authorName,
        content: message.content,
        attachments: extractFeedbackAttachments(message.externalRef),
        createdAt: message.createdAt,
      },
    })
  })

  // 管理员更新反馈状态/分诊去向
  app.patch('/api/admin/feedback/:id', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以处理反馈。' }, 403)
    }

    const parsed = feedbackAdminUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '更新内容不合法', issues: parsed.error.flatten() }, 400)
    }

    const id = c.req.param('id')
    let item = parsed.data.status !== undefined ? await updateFeedbackStatus(id, parsed.data.status) : null
    if (parsed.data.routing !== undefined) {
      item = await updateFeedbackRouting(id, parsed.data.routing)
    }
    if (!item) {
      return c.json({ message: '反馈不存在' }, 404)
    }

    return c.json({ feedback: item })
  })

  // 管理员把反馈 promote 成 GitHub issue（internal=受限维护队列 / community=公开仓）
  app.post('/api/admin/feedback/:id/promote', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以处理反馈。' }, 403)
    }

    const parsed = feedbackPromoteSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '参数不合法', issues: parsed.error.flatten() }, 400)
    }

    try {
      const feedback = await promoteFeedbackToIssue(c.req.param('id'), parsed.data.scope)
      return c.json({ feedback })
    } catch (error) {
      if (error instanceof FeedbackPromotionError) {
        return c.json({ message: error.message }, error.status)
      }
      throw error
    }
  })

  // 管理员触发 AI 规范化（规则兜底 + 可选 LLM 增强），写回 normalized
  app.post('/api/admin/feedback/:id/normalize', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以处理反馈。' }, 403)
    }

    const parsed = z.object({ forceLlm: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '参数不合法', issues: parsed.error.flatten() }, 400)
    }

    const feedback = await normalizeFeedback(c.req.param('id'), { forceLlm: parsed.data.forceLlm })
    if (!feedback) {
      return c.json({ message: '反馈不存在' }, 404)
    }
    return c.json({ feedback })
  })

  // 管理员让 AI 起草回复草稿（无模型配置时返回 draft: null）
  app.post('/api/admin/feedback/:id/draft-reply', requireAuth, async (c) => {
    if (!isFeedbackAdmin(getUserIdFromHeader(c))) {
      return c.json({ message: '只有内部管理员可以处理反馈。' }, 403)
    }

    const item = await getFeedbackItem(c.req.param('id'))
    if (!item) {
      return c.json({ message: '反馈不存在' }, 404)
    }

    const draft = await draftFeedbackReply({
      item,
      history: listFeedbackMessages(item),
    })
    return c.json({ draft, model: draft !== null })
  })

  // 前端页面事件上报（自有 telemetry，不外发第三方）
  app.post('/api/telemetry/events', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const parsed = telemetryEventSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ message: '事件不合法', issues: parsed.error.flatten() }, 400)
    }

    await track({ eventType: parsed.data.eventType, userId, payload: parsed.data.payload })
    return c.json({ ok: true })
  })
}
