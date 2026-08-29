/**
 * [INPUT]: FeedbackItem + 客服会话/消息/收件箱投递意图
 * [OUTPUT]: feedback 客服会话的建会话/追加消息/消息列表/最近回复解析/收件箱 item 构造
 * [POS]: 反馈 × 客服（与创始人直接沟通）的服务层；消息复用统一 conversation 模型，
 *        conversation-store 为内存 cache + 异步持久化（无 DB 亦可单测）；DB 回写由调用方注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type {
  ConversationMessageRecord,
  ConversationRecord,
  FeedbackAttachment,
  FeedbackItem,
  FeedbackMessage,
  FeedbackMessageRole,
} from '@shared/types'
import type { InboxPublishInput } from './inbox-service'
import {
  getConversation,
  listConversationMessages,
  saveConversation,
  saveConversationMember,
  saveConversationMessage,
  type ConversationMemberRecord,
} from '../storage/conversation-store'

export type FeedbackConversationPersistence = {
  updateConversationId: (feedbackId: string, conversationId: string) => Promise<unknown>
}

export const buildFeedbackConversation = (params: {
  title: string
  createdBy: string
  createdAt?: string
}): ConversationRecord => {
  const now = params.createdAt ?? new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: params.title,
    kind: 'feedback',
    chatMode: 'direct',
    status: 'active',
    externalSyncMode: 'internal',
    createdBy: params.createdBy,
    visibility: 'private',
    createdAt: now,
    updatedAt: now,
  }
}

export const buildFeedbackOwnerMember = (params: {
  conversationId: string
  userId: string
  joinedAt?: string
}): ConversationMemberRecord => {
  const now = params.joinedAt ?? new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    conversationId: params.conversationId,
    memberType: 'user',
    memberId: params.userId,
    role: 'owner',
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

export const buildFeedbackMessage = (params: {
  conversationId: string
  role: FeedbackMessageRole
  senderId: string
  authorName?: string
  content: string
  attachments?: FeedbackAttachment[]
  createdAt?: string
}): ConversationMessageRecord => ({
  id: crypto.randomUUID(),
  conversationId: params.conversationId,
  role: params.role,
  senderId: params.senderId,
  authorName: params.authorName,
  content: params.content,
  contentType: 'text',
  externalRef: params.attachments?.length ? { feedbackAttachments: params.attachments } : undefined,
  createdAt: params.createdAt ?? new Date().toISOString(),
})

/** 回信地址：创始人回复后，用户收件箱条目点击应跳回该反馈会话。 */
export const buildFeedbackReplyInboxItem = (params: {
  feedback: FeedbackItem
  adminName: string
  adminUserId?: string
  replyContent: string
  replyMessageId: string
  createdAt?: string
}): InboxPublishInput => {
  const { feedback, adminName, adminUserId, replyContent, replyMessageId } = params
  return {
    recipientType: 'user',
    recipientId: feedback.userId ?? '',
    kind: 'directive',
    reason: 'replied',
    eventType: 'support.reply',
    actor: { type: 'user', id: adminUserId, name: adminName },
    title: `创始人回复：${feedback.title}`,
    body: replyContent.length > 300 ? `${replyContent.slice(0, 300)}…` : replyContent,
    scope: { feedbackId: feedback.id },
    groupKey: `feedback:${feedback.id}`,
    replyTo: { kind: 'feedback_item', feedbackId: feedback.id },
    dedupeKey: `support-reply:${feedback.id}:${replyMessageId}`,
    createdAt: params.createdAt,
  }
}

/**
 * 保证 feedback 有一条可写的客服会话：已存在则复用，否则创建并回写 conversationId。
 * 回写依赖 DB，由调用方注入（routes 传 feedback-store，测试可传 noop）。
 */
export const ensureFeedbackConversation = async (
  feedback: FeedbackItem,
  createdBy: string,
  persistence?: FeedbackConversationPersistence,
): Promise<string> => {
  if (feedback.conversationId && getConversation(feedback.conversationId)) {
    return feedback.conversationId
  }

  const conversation = buildFeedbackConversation({ title: feedback.title, createdBy })
  saveConversation(conversation)
  saveConversationMember(buildFeedbackOwnerMember({
    conversationId: conversation.id,
    userId: createdBy,
  }))
  await persistence?.updateConversationId(feedback.id, conversation.id)
  return conversation.id
}

export const appendFeedbackMessage = async (params: {
  feedback: FeedbackItem
  role: FeedbackMessageRole
  senderId: string
  authorName?: string
  content: string
  attachments?: FeedbackAttachment[]
  persistence?: FeedbackConversationPersistence
}): Promise<ConversationMessageRecord> => {
  const conversationId = await ensureFeedbackConversation(
    params.feedback,
    params.feedback.userId || params.senderId,
    params.persistence,
  )
  const message = buildFeedbackMessage({
    conversationId,
    role: params.role,
    senderId: params.senderId,
    authorName: params.authorName,
    content: params.content,
    attachments: params.attachments,
  })
  saveConversationMessage(message)
  return message
}

export const listFeedbackMessages = (feedback: FeedbackItem): FeedbackMessage[] => {
  if (!feedback.conversationId) {
    return []
  }
  const conversation = getConversation(feedback.conversationId)
  if (!conversation) {
    return []
  }
  return listConversationMessages(conversation.id).map((message) => ({
    id: message.id,
    feedbackId: feedback.id,
    role: message.role === 'assistant' || message.role === 'user' || message.role === 'system'
      ? message.role
      : 'user',
    senderId: message.senderId,
    senderName: message.authorName,
    content: message.content,
    attachments: extractFeedbackAttachments(message.externalRef),
    createdAt: message.createdAt,
  }))
}

export const extractFeedbackAttachments = (externalRef: Record<string, unknown> | undefined): FeedbackAttachment[] | undefined => {
  const value = externalRef?.feedbackAttachments
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.filter((entry): entry is FeedbackAttachment => {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null
    return Boolean(record?.kind === 'drive' && typeof record?.driveFileId === 'string' && typeof record?.name === 'string')
  })
}

export const resolveLastReply = (
  feedback: FeedbackItem,
): Pick<FeedbackItem, 'lastReplyAt' | 'lastReplyPreview'> => {
  if (!feedback.conversationId) {
    return {}
  }
  const conversation = getConversation(feedback.conversationId)
  if (!conversation) {
    return {}
  }
  const lastAssistant = [...listConversationMessages(conversation.id)]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (!lastAssistant) {
    return {}
  }
  return {
    lastReplyAt: lastAssistant.createdAt,
    lastReplyPreview: lastAssistant.content.length > 160
      ? `${lastAssistant.content.slice(0, 160)}…`
      : lastAssistant.content,
  }
}
