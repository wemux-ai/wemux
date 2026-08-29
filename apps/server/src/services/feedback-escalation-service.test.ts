import assert from 'node:assert/strict'
import test from 'node:test'
import { eq } from 'drizzle-orm'

import { ensurePasswordUserProfile } from '../repositories/auth'
import { createFeedbackItem } from '../storage/postgres/feedback-store'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { inboxItems } from '../storage/postgres/schema'
import {
  getConversation,
  initConversationStore,
  saveConversation,
  saveConversationMember,
  saveConversationMessage,
} from '../storage/conversation-store'
import {
  buildFeedbackConversation,
  buildFeedbackMessage,
  buildFeedbackOwnerMember,
} from './feedback-support-service'
import {
  FEEDBACK_ESCALATION_MS,
  scanFeedbackEscalations,
} from './feedback-escalation-service'
import {
  countUnreadGroups,
  getInboxItemByDedupeKey,
  listInboxGroups,
  markInboxItemRead,
  publishInboxItem,
} from './inbox-service'

const hourAgo = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString()

const ensureInternalAdmin = async () => {
  const email = `esc-admin-${crypto.randomUUID()}@vibemux.test`
  return ensurePasswordUserProfile({ email, password: 'test-pass-1', name: 'Esc Admin', isInternal: true })
}

const ensureUser = async (email: string, name: string) => {
  return ensurePasswordUserProfile({ email, password: 'test-pass-1', name, isInternal: false })
}

const countItemsByDedupeKey = async (recipientId: string, dedupeKey: string) => {
  // dedupeKey 有 (recipientType, recipientId, dedupeKey) 唯一约束：存在即 1 条
  const exact = await getInboxItemByDedupeKey({ recipientType: 'user', recipientId, dedupeKey })
  return exact ? 1 : 0
}

test('未回复升级：用户消息超 60 分钟未回复 → 给内部 admin 投递升级提醒', async () => {
  await initConversationStore().catch(() => {})
  const admin = await ensureInternalAdmin()
  const user = await ensureUser(`esc-user-${crypto.randomUUID()}@vibemux.test`, 'Esc User')

  const feedbackId = `feedback:esc-unreplied-${crypto.randomUUID()}`
  const conversation = buildFeedbackConversation({ title: '未回复升级测试', createdBy: user.id })
  saveConversation(conversation)
  saveConversationMember(buildFeedbackOwnerMember({ conversationId: conversation.id, userId: user.id }))
  const userMessage = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: user.id,
    content: '这个 Bug 什么时候修？',
    createdAt: hourAgo(61),
  })
  saveConversationMessage(userMessage)
  await createFeedbackItem({
    id: feedbackId,
    type: 'bug',
    title: '未回复升级测试',
    body: '这个 Bug 什么时候修？',
    userId: user.id,
    userEmail: user.email,
    conversationId: conversation.id,
    createdAt: hourAgo(61),
  })

  await scanFeedbackEscalations()

  const escalated = await getInboxItemByDedupeKey({
    recipientType: 'user',
    recipientId: admin.id,
    dedupeKey: `support-escalation:unreplied:${feedbackId}:${userMessage.id}`,
  })
  assert.ok(escalated, '内部 admin 应收到未回复升级提醒')
  assert.equal(escalated!.eventType, 'support.escalation.admin')
  assert.ok(escalated!.title.includes('未回复升级测试'))

  const inbox = await listInboxGroups({ recipientId: admin.id, section: 'all' })
  assert.equal(inbox.groups.some((group) => group.groupKey === `feedback:${feedbackId}`), false)
  assert.equal(await countUnreadGroups(admin.id), 0)
})

test('未超时（59 分钟）不触发升级', async () => {
  await initConversationStore().catch(() => {})
  const admin = await ensureInternalAdmin()
  const user = await ensureUser(`esc-fresh-${crypto.randomUUID()}@vibemux.test`, 'Fresh User')

  const feedbackId = `feedback:esc-fresh-${crypto.randomUUID()}`
  const conversation = buildFeedbackConversation({ title: '未超时测试', createdBy: user.id })
  saveConversation(conversation)
  saveConversationMember(buildFeedbackOwnerMember({ conversationId: conversation.id, userId: user.id }))
  const userMessage = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: user.id,
    content: '还没超时',
    createdAt: hourAgo(59),
  })
  saveConversationMessage(userMessage)
  await createFeedbackItem({
    id: feedbackId,
    type: 'feature',
    title: '未超时测试',
    body: '还没超时',
    userId: user.id,
    userEmail: user.email,
    conversationId: conversation.id,
    createdAt: hourAgo(59),
  })

  await scanFeedbackEscalations()

  const escalated = await getInboxItemByDedupeKey({
    recipientType: 'user',
    recipientId: admin.id,
    dedupeKey: `support-escalation:unreplied:${feedbackId}:${userMessage.id}`,
  })
  assert.equal(escalated, null, '未超时不应触发升级')
})

test('未读升级：创始人回复超 60 分钟且 support.reply 未读 → 用户升级提醒', async () => {
  await initConversationStore().catch(() => {})
  const user = await ensureUser(`esc-unread-${crypto.randomUUID()}@vibemux.test`, 'Unread User')

  const feedbackId = `feedback:esc-unread-${crypto.randomUUID()}`
  const conversation = buildFeedbackConversation({ title: '未读升级测试', createdBy: user.id })
  saveConversation(conversation)
  saveConversationMember(buildFeedbackOwnerMember({ conversationId: conversation.id, userId: user.id }))
  const userMessage = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: user.id,
    content: '请回复我',
    createdAt: hourAgo(120),
  })
  saveConversationMessage(userMessage)
  const reply = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'assistant',
    senderId: 'admin-esc',
    authorName: '创始人',
    content: '已修复，请验证。',
    createdAt: hourAgo(61),
  })
  saveConversationMessage(reply)
  await createFeedbackItem({
    id: feedbackId,
    type: 'bug',
    title: '未读升级测试',
    body: '请回复我',
    userId: user.id,
    userEmail: user.email,
    conversationId: conversation.id,
    createdAt: hourAgo(120),
  })

  // 模拟 admin 已回复时投递的 support.reply 收件箱条目（未读）
  await publishInboxItem({
    recipientType: 'user',
    recipientId: user.id,
    kind: 'directive',
    reason: 'replied',
    eventType: 'support.reply',
    actor: { type: 'user', id: 'admin-esc', name: '创始人' },
    title: `创始人回复：未读升级测试`,
    body: '已修复，请验证。',
    scope: { feedbackId },
    groupKey: `feedback:${feedbackId}`,
    replyTo: { kind: 'feedback_item', feedbackId },
    dedupeKey: `support-reply:${feedbackId}:${reply.id}`,
  })

  await scanFeedbackEscalations()

  const escalated = await getInboxItemByDedupeKey({
    recipientType: 'user',
    recipientId: user.id,
    dedupeKey: `support-escalation:unread:${feedbackId}:${reply.id}`,
  })
  assert.ok(escalated, '用户应收到未读升级提醒')
  assert.equal(escalated!.eventType, 'support.escalation')
  assert.deepEqual(escalated!.replyTo, { kind: 'feedback_item', feedbackId })
})

test('support.reply 已读 → 不触发未读升级', async () => {
  await initConversationStore().catch(() => {})
  const user = await ensureUser(`esc-read-${crypto.randomUUID()}@vibemux.test`, 'Read User')

  const feedbackId = `feedback:esc-read-${crypto.randomUUID()}`
  const conversation = buildFeedbackConversation({ title: '已读测试', createdBy: user.id })
  saveConversation(conversation)
  saveConversationMember(buildFeedbackOwnerMember({ conversationId: conversation.id, userId: user.id }))
  const userMessage = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: user.id,
    content: '请求',
    createdAt: hourAgo(120),
  })
  saveConversationMessage(userMessage)
  const reply = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'assistant',
    senderId: 'admin-esc',
    authorName: '创始人',
    content: '收到。',
    createdAt: hourAgo(61),
  })
  saveConversationMessage(reply)
  await createFeedbackItem({
    id: feedbackId,
    type: 'bug',
    title: '已读测试',
    body: '请求',
    userId: user.id,
    userEmail: user.email,
    conversationId: conversation.id,
    createdAt: hourAgo(120),
  })

  const replyItem = await publishInboxItem({
    recipientType: 'user',
    recipientId: user.id,
    kind: 'directive',
    reason: 'replied',
    eventType: 'support.reply',
    actor: { type: 'user', id: 'admin-esc', name: '创始人' },
    title: `创始人回复：已读测试`,
    body: '收到。',
    scope: { feedbackId },
    groupKey: `feedback:${feedbackId}`,
    replyTo: { kind: 'feedback_item', feedbackId },
    dedupeKey: `support-reply:${feedbackId}:${reply.id}`,
  })
  await markInboxItemRead(user.id, replyItem.item.id, 'user')

  await scanFeedbackEscalations()

  const escalated = await getInboxItemByDedupeKey({
    recipientType: 'user',
    recipientId: user.id,
    dedupeKey: `support-escalation:unread:${feedbackId}:${reply.id}`,
  })
  assert.equal(escalated, null, '回复已读不应触发未读升级')
})

test('幂等：重复扫描同一消息不重复投递升级', async () => {
  await initConversationStore().catch(() => {})
  const admin = await ensureInternalAdmin()
  const user = await ensureUser(`esc-idem-${crypto.randomUUID()}@vibemux.test`, 'Idem User')

  const feedbackId = `feedback:esc-idem-${crypto.randomUUID()}`
  const conversation = buildFeedbackConversation({ title: '幂等测试', createdBy: user.id })
  saveConversation(conversation)
  saveConversationMember(buildFeedbackOwnerMember({ conversationId: conversation.id, userId: user.id }))
  const userMessage = buildFeedbackMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: user.id,
    content: '会重复吗？',
    createdAt: hourAgo(70),
  })
  saveConversationMessage(userMessage)
  await createFeedbackItem({
    id: feedbackId,
    type: 'feature',
    title: '幂等测试',
    body: '会重复吗？',
    userId: user.id,
    userEmail: user.email,
    conversationId: conversation.id,
    createdAt: hourAgo(70),
  })

  await scanFeedbackEscalations()
  await scanFeedbackEscalations()

  const dedupeKey = `support-escalation:unreplied:${feedbackId}:${userMessage.id}`
  // dedupeKey 唯一约束 + onConflictDoNothing 保证同 key 只落一条
  assert.equal(await countItemsByDedupeKey(admin.id, dedupeKey), 1)
  assert.equal(FEEDBACK_ESCALATION_MS, 60 * 60_000)
  assert.ok(getConversation(conversation.id))
})
