import assert from 'node:assert/strict'
import test from 'node:test'

import type { FeedbackItem } from '@shared/types'
import { initConversationStore, getConversation } from '../storage/conversation-store'
import {
  appendFeedbackMessage,
  buildFeedbackReplyInboxItem,
  listFeedbackMessages,
  resolveLastReply,
  type FeedbackConversationPersistence,
} from './feedback-support-service'

const makeFeedback = (overrides: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: 'feedback:1',
  type: 'bug',
  title: 'Worker 配对失败',
  body: '提示配对码无效',
  status: 'open',
  userId: 'user-1',
  userEmail: 'user@example.com',
  createdAt: '2026-08-11T12:00:00.000Z',
  updatedAt: '2026-08-11T12:00:00.000Z',
  ...overrides,
})

/** 模拟 DB 回写 conversationId：append 之后调用方持久化，后续 append 复用同一会话。 */
const makePersistence = () => {
  const persisted = new Map<string, string>()
  const persistence: FeedbackConversationPersistence = {
    updateConversationId: async (feedbackId, conversationId) => {
      persisted.set(feedbackId, conversationId)
    },
  }
  return {
    persistence,
    readBack: (feedback: FeedbackItem): FeedbackItem => {
      const conversationId = persisted.get(feedback.id)
      return conversationId ? { ...feedback, conversationId } : feedback
    },
  }
}

test('buildFeedbackReplyInboxItem 构造「创始人回复」的收件箱投递意图', () => {
  const item = buildFeedbackReplyInboxItem({
    feedback: makeFeedback(),
    adminName: '创始人',
    adminUserId: 'admin-1',
    replyContent: '我们已定位问题，稍后修复。',
    replyMessageId: 'msg-1',
  })

  assert.equal(item.recipientType, 'user')
  assert.equal(item.recipientId, 'user-1')
  assert.equal(item.kind, 'directive')
  assert.equal(item.reason, 'replied')
  assert.equal(item.eventType, 'support.reply')
  assert.equal(item.actor.name, '创始人')
  assert.equal(item.actor.id, 'admin-1')
  assert.deepEqual(item.scope, { feedbackId: 'feedback:1' })
  assert.equal(item.groupKey, 'feedback:feedback:1')
  assert.deepEqual(item.replyTo, { kind: 'feedback_item', feedbackId: 'feedback:1' })
  assert.equal(item.dedupeKey, 'support-reply:feedback:1:msg-1')
  assert.equal(item.title, '创始人回复：Worker 配对失败')
})

test('buildFeedbackReplyInboxItem 长回复截断为预览', () => {
  const longContent = 'x'.repeat(400)
  const item = buildFeedbackReplyInboxItem({
    feedback: makeFeedback(),
    adminName: '创始人',
    replyContent: longContent,
    replyMessageId: 'msg-2',
  })
  assert.equal(item.body.length, 301)
  assert.ok(item.body.endsWith('…'))
})

test('用户发首条消息：惰性创建 feedback 会话并回写 conversationId', async () => {
  await initConversationStore().catch(() => {})
  const { persistence, readBack } = makePersistence()

  const feedback = makeFeedback()
  const message = await appendFeedbackMessage({
    feedback,
    role: 'user',
    senderId: 'user-1',
    authorName: 'Alice',
    content: '提示配对码无效',
    persistence,
  })

  const persistedFeedback = readBack(feedback)
  assert.ok(persistedFeedback.conversationId, 'conversationId 应被回写')
  assert.equal(message.conversationId, persistedFeedback.conversationId)
  const conversation = getConversation(persistedFeedback.conversationId!)
  assert.equal(conversation?.kind, 'feedback')
  assert.equal(conversation?.title, 'Worker 配对失败')
  assert.equal(conversation?.visibility, 'private')

  const messages = listFeedbackMessages(persistedFeedback)
  assert.equal(messages.length, 1)
  assert.equal(messages[0]!.role, 'user')
  assert.equal(messages[0]!.senderName, 'Alice')
  assert.equal(messages[0]!.content, '提示配对码无效')

  // 用户消息不是「创始人回复」，resolveLastReply 应为空
  assert.deepEqual(resolveLastReply(persistedFeedback), {})
})

test('同一反馈继续聊天：复用已有会话，不新建', async () => {
  await initConversationStore().catch(() => {})
  const { persistence, readBack } = makePersistence()

  const feedback = makeFeedback()
  await appendFeedbackMessage({
    feedback,
    role: 'user',
    senderId: 'user-1',
    content: '第一条',
    persistence,
  })
  const persisted = readBack(feedback)

  const second = await appendFeedbackMessage({
    feedback: persisted,
    role: 'user',
    senderId: 'user-1',
    content: '第二条',
    persistence,
  })
  assert.equal(second.conversationId, persisted.conversationId, '应复用同一会话')

  const messages = listFeedbackMessages(persisted)
  assert.equal(messages.length, 2)
  assert.equal(messages[1]!.content, '第二条')
})

test('创始人回复后：resolveLastReply 返回最新回复预览', async () => {
  await initConversationStore().catch(() => {})
  const { persistence, readBack } = makePersistence()

  const feedback = makeFeedback()
  await appendFeedbackMessage({
    feedback,
    role: 'user',
    senderId: 'user-1',
    content: '帮忙看下',
    persistence,
  })
  const persisted = readBack(feedback)

  const reply = await appendFeedbackMessage({
    feedback: persisted,
    role: 'assistant',
    senderId: 'admin-1',
    authorName: '创始人',
    content: '收到，正在排查，今天内给结论。',
    persistence,
  })
  assert.equal(reply.role, 'assistant')

  const lastReply = resolveLastReply(persisted)
  assert.equal(lastReply.lastReplyAt, reply.createdAt)
  assert.equal(lastReply.lastReplyPreview, '收到，正在排查，今天内给结论。')

  const messages = listFeedbackMessages(persisted)
  const assistant = messages.find((message) => message.role === 'assistant')
  assert.equal(assistant?.senderName, '创始人')
})

test('历史数据无会话：append 后消息可读', async () => {
  await initConversationStore().catch(() => {})
  const { persistence, readBack } = makePersistence()

  const feedback = makeFeedback({ id: 'feedback:legacy', conversationId: undefined })
  await appendFeedbackMessage({
    feedback,
    role: 'user',
    senderId: 'user-1',
    content: '旧工单继续沟通',
    persistence,
  })
  const persisted = readBack(feedback)
  assert.ok(persisted.conversationId)
  assert.equal(listFeedbackMessages(persisted).length, 1)
})
