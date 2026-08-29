/**
 * [INPUT]: env VAPID keys（可选）+ app-state meta 持久化。
 * [OUTPUT]: web-push 密钥解析/生成 + 订阅 CRUD + 按用户推送投递（失败重试、410 清理）。
 * [POS]: Web Push 服务层（feature P3）。密钥优先 env（VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY），
 *        缺失时首次生成并持久化到 app meta（与 SECRET_ENCRYPTION_KEY 同模式）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import webpush from 'web-push'
import { and, eq } from 'drizzle-orm'
import type { InboxItem } from '@shared/inbox'
import { getUserNotificationSettings } from './user-notification-settings-service'
import { getMeta, saveMeta } from '../storage/app-state-store'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { pushSubscriptions } from '../storage/postgres/schema'

export type PushSubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
}

export type PushNotificationPayload = {
  title: string
  body: string
  /** 通知去重/替换 tag（SW showNotification 用）。 */
  tag: string
  /** 点击通知跳转路径（SW notificationclick 用）。 */
  url?: string
}

const VAPID_KEYS_META_KEY = 'web_push_vapid_keys'
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:no-reply@vibemux.app'

type VapidKeys = {
  publicKey: string
  privateKey: string
}

let cachedVapidKeys: VapidKeys | null = null

export const resolveVapidKeys = (): VapidKeys => {
  if (cachedVapidKeys) {
    return cachedVapidKeys
  }

  const envPublicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (envPublicKey && envPrivateKey) {
    cachedVapidKeys = { publicKey: envPublicKey, privateKey: envPrivateKey }
    return cachedVapidKeys
  }

  const stored = getMeta<Partial<VapidKeys> | null>(VAPID_KEYS_META_KEY, null)
  if (stored?.publicKey && stored.privateKey) {
    cachedVapidKeys = { publicKey: stored.publicKey, privateKey: stored.privateKey }
    return cachedVapidKeys
  }

  const generated = webpush.generateVAPIDKeys()
  cachedVapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey }
  saveMeta(VAPID_KEYS_META_KEY, cachedVapidKeys)
  return cachedVapidKeys
}

export const resolveVapidPublicKey = () => resolveVapidKeys().publicKey

const configureWebPush = () => {
  const keys = resolveVapidKeys()
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey)
}

// ---- 订阅 CRUD ----

const mapRow = (row: typeof pushSubscriptions.$inferSelect) => ({
  id: row.id,
  userId: row.userId,
  endpoint: row.endpoint,
  p256dh: row.p256dh,
  auth: row.auth,
  userAgent: row.userAgent,
  lastUsedAt: row.lastUsedAt,
  createdAt: row.createdAt,
})

export const listPushSubscriptions = async (userId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt)
  return rows.map(mapRow)
}

/** 同一 endpoint 幂等 upsert（浏览器重新订阅会带相同 endpoint）。 */
export const upsertPushSubscription = async (userId: string, input: PushSubscriptionInput) => {
  await ensurePostgresReady()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await getDrizzleDb().insert(pushSubscriptions).values({
    id,
    userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent ?? null,
    lastUsedAt: now,
    createdAt: now,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      lastUsedAt: now,
    },
  })
  return mapRow((await getDrizzleDb().select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, input.endpoint)).limit(1))[0])
}

export const deletePushSubscriptionByEndpoint = async (userId: string, endpoint: string) => {
  await ensurePostgresReady()
  await getDrizzleDb().delete(pushSubscriptions).where(and(
    eq(pushSubscriptions.userId, userId),
    eq(pushSubscriptions.endpoint, endpoint),
  ))
}

export const deletePushSubscriptionById = async (userId: string, id: string) => {
  await ensurePostgresReady()
  await getDrizzleDb().delete(pushSubscriptions).where(and(
    eq(pushSubscriptions.userId, userId),
    eq(pushSubscriptions.id, id),
  ))
}

// ---- 推送投递 ----

const buildSubscriptionObject = (row: Awaited<ReturnType<typeof listPushSubscriptions>>[number]) => ({
  endpoint: row.endpoint,
  keys: {
    p256dh: row.p256dh,
    auth: row.auth,
  },
})

/**
 * 给用户的所有订阅发一条 push。失败处理：410/404（订阅过期）删除该订阅，其余静默。
 * 调用方负责按设置矩阵决定是否调用（browserEnabled 才推）。
 */
export const sendPushToUser = async (params: {
  userId: string
  payload: PushNotificationPayload
  /** 仅发给最近 N 条活跃订阅，防堆积（默认全部）。 */
  limit?: number
}): Promise<{ sent: number; removed: number }> => {
  let subscriptions = await listPushSubscriptions(params.userId)
  if (params.limit && params.limit > 0) {
    subscriptions = subscriptions.slice(-params.limit)
  }
  if (subscriptions.length === 0) {
    return { sent: 0, removed: 0 }
  }

  configureWebPush()
  const { payload } = params
  let sent = 0
  let removed = 0

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        buildSubscriptionObject(subscription),
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          tag: payload.tag,
          url: payload.url ?? '/',
        }),
      )
      sent += 1
      await getDrizzleDb().update(pushSubscriptions)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(pushSubscriptions.id, subscription.id))
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 0
      if (statusCode === 410 || statusCode === 404) {
        await getDrizzleDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id))
        removed += 1
      }
    }
  }))

  return { sent, removed }
}

// ---- 收件箱事件 → 推送映射（与前端 notifier 对齐） ----

export const DM_INBOX_EVENT_TYPE = 'dm.message'
export const CONNECTION_REQUEST_EVENT_TYPE = 'user.connection.requested'
export const CONNECTION_ACCEPTED_EVENT_TYPE = 'user.connection.accepted'
export const TEAM_INVITATION_EVENT_TYPE = 'team.invitation.sent'
const TASK_TERMINAL_INBOX_REASONS = new Set(['workspace_completed', 'workspace_failed', 'status_changed'])

/** 把 inbox item 映射为通知矩阵类别 + 推送文案（与前端 buildInboxItemNotification 语义一致）。 */
export const buildInboxPushDelivery = (item: InboxItem): {
  notificationType: 'inboxMention' | 'groupChatMention' | 'taskCompletion'
  payload: PushNotificationPayload
} | null => {
  if (item.scope.taskId && TASK_TERMINAL_INBOX_REASONS.has(item.reason)) {
    const failed = item.reason === 'workspace_failed'
    return {
      notificationType: 'taskCompletion',
      payload: {
        title: failed ? '任务失败' : '任务已完成',
        body: item.title.trim(),
        tag: `task-complete:${item.scope.taskId}`,
        url: item.scope.taskId ? `/workspaces?taskId=${item.scope.taskId}` : undefined,
      },
    }
  }

  if (item.kind !== 'mention' && item.kind !== 'directive' && item.kind !== 'handoff') {
    return null
  }

  // 私聊（DM）新消息：跳回 /chat 的对应私聊目标。
  if (item.eventType === DM_INBOX_EVENT_TYPE) {
    return {
      notificationType: 'inboxMention',
      payload: {
        title: `私聊：${item.title}`,
        body: `${item.actorName}：${item.body}`.slice(0, 140),
        tag: `inbox:${item.id}`,
        url: item.actorType === 'user' && item.actorId
          ? `/chat?dmPeer=${item.actorId}`
          : '/chat',
      },
    }
  }

  // 好友请求 / 已接受 / 协作空间加入邀请：跳设置页连接管理或邀请确认页。
  if (
    item.eventType === CONNECTION_REQUEST_EVENT_TYPE
    || item.eventType === CONNECTION_ACCEPTED_EVENT_TYPE
    || item.eventType === TEAM_INVITATION_EVENT_TYPE
  ) {
    const isInvitation = item.eventType === TEAM_INVITATION_EVENT_TYPE
    return {
      notificationType: 'inboxMention',
      payload: {
        title: isInvitation ? `加入邀请：${item.title}` : `好友请求：${item.title}`,
        body: `${item.actorName}：${item.body}`.slice(0, 140),
        tag: `inbox:${item.id}`,
        url: isInvitation && item.scope.invitationToken
          ? `/invite/${item.scope.invitationToken}`
          : '/settings?section=connections',
      },
    }
  }

  return {
    notificationType: 'inboxMention',
    payload: {
      title: `收件箱：${item.title}`,
      body: `${item.actorName}：${item.body}`.slice(0, 140),
      tag: `inbox:${item.id}`,
      url: item.scope.taskId
        ? `/workspaces?taskId=${item.scope.taskId}`
        : '/inbox',
    },
  }
}

/** inbox 新 item → 按设置矩阵浏览器类别推送（fire-and-forget，不阻塞投递主流程）。 */
export const notifyInboxPushIfEnabled = (item: InboxItem) => {
  const delivery = buildInboxPushDelivery(item)
  if (!delivery) {
    return
  }
  const settings = getUserNotificationSettings(item.recipientId)
  const category = settings[delivery.notificationType]
  if (!category.browserEnabled) {
    return
  }
  void sendPushToUser({
    userId: item.recipientId,
    payload: delivery.payload,
    limit: 4,
  }).catch(() => undefined)
}
