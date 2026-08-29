/**
 * [INPUT]: feedback 客服会话（kind='feedback'）与 support.reply 收件箱条目
 * [OUTPUT]: 超时未读升级提醒投递（未回复升级 + 未读升级）
 * [POS]: 客服 SLA 升级扫描；幂等靠 dedupeKey，由 server-background-services 定时驱动（withPostgresLease）
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { isNotNull } from 'drizzle-orm'
import type { FeedbackMessage } from '@shared/types'
import { getAllUsers } from '../repositories/auth'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { feedbackItems } from '../storage/postgres/schema'
import {
  getConversation,
  listConversationMessages,
  listConversations,
} from '../storage/conversation-store'
import { getInboxItemByDedupeKey, publishInboxItem } from './inbox-service'

/** 超时未读升级阈值：默认 60 分钟。 */
export const FEEDBACK_ESCALATION_MS = 60 * 60_000

const byCreatedAtDesc = (left: { createdAt: string }, right: { createdAt: string }) =>
  new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()

/** Admin 侧栏只提示仍等待管理员回复、且已超过 SLA 的会话。 */
export const isFeedbackAwaitingAdminReply = (
  messages: Array<Pick<FeedbackMessage, 'role' | 'createdAt'>>,
  now = new Date(),
) => {
  const last = [...messages].sort(byCreatedAtDesc)[0]
  if (!last || last.role !== 'user') {
    return false
  }
  return now.getTime() - new Date(last.createdAt).getTime() >= FEEDBACK_ESCALATION_MS
}

const listInternalAdminIds = (): string[] => getAllUsers()
  .filter((user) => user.isInternal === true)
  .map((user) => user.id)

/**
 * 未回复升级：最后一条是用户消息且超时 → 给所有内部 admin 投递升级提醒。
 * 注意：不携带 scope.feedbackId / replyTo，避免 admin 点击跳转到用户侧 /feedback 造成 403。
 */
const escalateUnreplied = async (params: {
  feedbackId: string
  feedbackTitle: string
  userMessageContent: string
  userMessageId: string
  userMessageCreatedAt: string
}) => {
  const adminIds = listInternalAdminIds()
  if (adminIds.length === 0) {
    return
  }
  const preview = params.userMessageContent.length > 160
    ? `${params.userMessageContent.slice(0, 160)}…`
    : params.userMessageContent
  await Promise.all(adminIds.map((adminId) => publishInboxItem({
    recipientType: 'user',
    recipientId: adminId,
    kind: 'directive',
    reason: 'generic_event',
    // Admin SLA 升级保留作审计；产品收件箱查询会过滤，由 /admin/feedback 处理。
    eventType: 'support.escalation.admin',
    actor: { type: 'system', name: '系统' },
    title: `待回复：${params.feedbackTitle}`,
    body: `用户消息已超过 ${FEEDBACK_ESCALATION_MS / 60_000} 分钟未回复：${preview}`,
    scope: {},
    groupKey: `feedback:${params.feedbackId}`,
    replyTo: { kind: 'none' },
    dedupeKey: `support-escalation:unreplied:${params.feedbackId}:${params.userMessageId}`,
    createdAt: params.userMessageCreatedAt,
  })))
}

/**
 * 未读升级：最后一条是创始人回复且超时、且对应 support.reply 收件箱条目未被用户标读
 * → 投递用户升级提醒（点击跳回反馈会话）。
 */
const escalateUnread = async (params: {
  feedbackId: string
  feedbackTitle: string
  replyContent: string
  replyMessageId: string
  replyCreatedAt: string
  userId: string
}) => {
  const preview = params.replyContent.length > 160
    ? `${params.replyContent.slice(0, 160)}…`
    : params.replyContent
  await publishInboxItem({
    recipientType: 'user',
    recipientId: params.userId,
    kind: 'directive',
    reason: 'replied',
    eventType: 'support.escalation',
    actor: { type: 'system', name: '系统' },
    title: `创始人回复了「${params.feedbackTitle}」，快去看看吧`,
    body: preview,
    scope: { feedbackId: params.feedbackId },
    groupKey: `feedback:${params.feedbackId}`,
    replyTo: { kind: 'feedback_item', feedbackId: params.feedbackId },
    dedupeKey: `support-escalation:unread:${params.feedbackId}:${params.replyMessageId}`,
    createdAt: params.replyCreatedAt,
  })
}

/**
 * 扫描所有 feedback 客服会话，按最后一条消息做超时未读升级判断。
 * 幂等：每条消息只升级一次（dedupeKey 天然去重，重复扫描无副作用）。
 */
export const scanFeedbackEscalations = async (now: Date = new Date()) => {
  const db = getDrizzleDb()
  const rows = await db.select().from(feedbackItems).where(isNotNull(feedbackItems.conversationId))
  if (rows.length === 0) {
    return
  }

  // 只处理仍存在的 feedback 会话，避免孤儿数据
  const feedbackConversationIds = new Set(
    listConversations().filter((conversation) => conversation.kind === 'feedback').map((conversation) => conversation.id),
  )

  for (const row of rows) {
    if (!row.conversationId || !feedbackConversationIds.has(row.conversationId)) {
      continue
    }
    const conversation = getConversation(row.conversationId)
    if (!conversation) {
      continue
    }
    const messages = listConversationMessages(conversation.id)
    const last = [...messages].sort(byCreatedAtDesc)[0]
    if (!last) {
      continue
    }
    const elapsedMs = now.getTime() - new Date(last.createdAt).getTime()
    if (elapsedMs < FEEDBACK_ESCALATION_MS) {
      continue
    }

    if (last.role === 'user') {
      await escalateUnreplied({
        feedbackId: row.id,
        feedbackTitle: row.title,
        userMessageContent: last.content,
        userMessageId: last.id,
        userMessageCreatedAt: last.createdAt,
      })
      continue
    }

    if (last.role === 'assistant' && row.userId) {
      const replyItem = await getInboxItemByDedupeKey({
        recipientType: 'user',
        recipientId: row.userId,
        dedupeKey: `support-reply:${row.id}:${last.id}`,
      })
      // 回复提醒已被用户标读 → 视为已看到，不升级
      if (replyItem?.readAt) {
        continue
      }
      await escalateUnread({
        feedbackId: row.id,
        feedbackTitle: row.title,
        replyContent: last.content,
        replyMessageId: last.id,
        replyCreatedAt: last.createdAt,
        userId: row.userId,
      })
    }
  }
}
