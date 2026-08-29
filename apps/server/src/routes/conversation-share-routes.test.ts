import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { MainChatSession } from '@shared/types'
import { createToken } from '../repositories/auth'
import { createWorkspaceGroupConversation, addConversationMember } from '../control-plane/conversation-service'
import { setConversationVisibility, shareSession } from '../services/conversation-share-service'
import { uiStateCache } from '../storage/postgres/app-state-store-core-cache'
import { getShare, initConversationStore } from '../storage/conversation-store'
import { registerConversationShareRoutes } from './conversation-share-routes'

const buildMainChatSession = (id: string, visibility?: 'public' | 'private'): MainChatSession => ({
  id,
  title: id,
  messages: [],
  visibility,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const requireAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: '未登录' }, 401)
  }
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerConversationShareRoutes(app, requireAuth)
  return app
}

test('revoking a share as a non-editor is denied and does not mutate the share', async () => {
  await initConversationStore().catch(() => {})

  const ownerId = `user-owner-${crypto.randomUUID()}`
  const outsiderId = `user-outsider-${crypto.randomUUID()}`

  const conversation = createWorkspaceGroupConversation({
    workspaceId: `workspace-${crypto.randomUUID()}`,
    title: 'Revoke authorization test group',
    createdBy: ownerId,
  })
  setConversationVisibility(conversation.id, 'private')

  const shareResult = shareSession({
    sourceKind: 'conversation',
    sourceId: conversation.id,
    targetType: 'agent',
    targetId: 'agent-outsider',
    createdBy: ownerId,
  })
  assert.equal(shareResult.ok, true)
  if (!shareResult.ok) {
    return
  }

  const app = createApp()
  const response = await app.request(`/api/sessions/shares/${shareResult.share.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${createToken(outsiderId)}`,
    },
  })

  assert.equal(response.status, 403)

  const shareAfterAttempt = getShare(shareResult.share.id)
  assert.equal(shareAfterAttempt?.revokedAt, undefined)
})

test('revoking a main_chat-sourced share as a non-owner is denied and does not mutate the share', async () => {
  await initConversationStore().catch(() => {})

  const ownerId = `user-owner-${crypto.randomUUID()}`
  const outsiderId = `user-outsider-${crypto.randomUUID()}`

  const session = buildMainChatSession(`main-chat-${crypto.randomUUID()}`, 'private')
  uiStateCache.mainChatSessions.push(session)

  const shareResult = shareSession({
    sourceKind: 'main_chat',
    sourceId: session.id,
    targetType: 'agent',
    targetId: 'agent-outsider',
    createdBy: ownerId,
  })
  assert.equal(shareResult.ok, true)
  if (!shareResult.ok) {
    return
  }

  const app = createApp()
  const response = await app.request(`/api/sessions/shares/${shareResult.share.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${createToken(outsiderId)}`,
    },
  })

  assert.equal(response.status, 403)

  const shareAfterAttempt = getShare(shareResult.share.id)
  assert.equal(shareAfterAttempt?.revokedAt, undefined)
})

test('main_chat sessions default to public access for any authenticated user', async () => {
  await initConversationStore().catch(() => {})

  const viewerId = `user-viewer-${crypto.randomUUID()}`
  const session = buildMainChatSession(`main-chat-${crypto.randomUUID()}`)
  uiStateCache.mainChatSessions.push(session)

  const app = createApp()
  const response = await app.request(`/api/sessions/main_chat/${session.id}/shares`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${createToken(viewerId)}`,
    },
  })

  assert.equal(response.status, 200)
})

test('setting a main_chat session private blocks access for non-owners without a share', async () => {
  await initConversationStore().catch(() => {})

  const ownerId = `user-owner-${crypto.randomUUID()}`
  const outsiderId = `user-outsider-${crypto.randomUUID()}`
  const session = buildMainChatSession(`main-chat-${crypto.randomUUID()}`)
  uiStateCache.mainChatSessions.push(session)

  const app = createApp()
  const setPrivateResponse = await app.request(`/api/sessions/main_chat/${session.id}/visibility`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${createToken(ownerId)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ visibility: 'private' }),
  })
  assert.equal(setPrivateResponse.status, 200)

  const outsiderResponse = await app.request(`/api/sessions/main_chat/${session.id}/shares`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${createToken(outsiderId)}`,
    },
  })
  assert.equal(outsiderResponse.status, 403)
})

test('BUG-7：工作区群聊成员可以生成分享链接（isConversationVisible 覆盖 group chat）', async () => {
  await initConversationStore().catch(() => {})

  const ownerId = `user-owner-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId: `workspace-${crypto.randomUUID()}`,
    title: 'Group share test',
    createdBy: ownerId,
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'user', memberId: ownerId })

  const app = createApp()
  const response = await app.request(`/api/conversations/${conversation.id}/share`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${createToken(ownerId)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessScope: 'link' }),
  })
  assert.equal(response.status, 201)
})

test('BUG-7：工作区群聊非成员生成分享链接仍被拒绝 403', async () => {
  await initConversationStore().catch(() => {})

  const ownerId = `user-owner-${crypto.randomUUID()}`
  const outsiderId = `user-outsider-${crypto.randomUUID()}`
  const conversation = createWorkspaceGroupConversation({
    workspaceId: `workspace-${crypto.randomUUID()}`,
    title: 'Group share denied test',
    createdBy: ownerId,
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'user', memberId: ownerId })

  const app = createApp()
  const response = await app.request(`/api/conversations/${conversation.id}/share`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${createToken(outsiderId)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessScope: 'link' }),
  })
  assert.equal(response.status, 403)
})
