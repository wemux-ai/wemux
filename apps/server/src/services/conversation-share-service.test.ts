import test from 'node:test'
import assert from 'node:assert/strict'

import type { MainChatSession } from '@shared/types'
import { resolveConversationAccess, resolveMainChatSessionAccess } from '../control-plane/conversation-access'
import { addConversationMember, createWorkspaceGroupConversation, removeConversationMember } from '../control-plane/conversation-service'
import { issueShareLink, resolveShareToken, revokeShare, shareSession } from './conversation-share-service'
import { initConversationStore } from '../storage/conversation-store'
import { uiStateCache } from '../storage/postgres/app-state-store-core-cache'

const buildMainChatSession = (id: string, visibility?: 'public' | 'private'): MainChatSession => ({
  id,
  title: id,
  messages: [],
  visibility,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

test('resolveConversationAccess grants member access and denies after removal without a share', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-access-1',
    title: 'Access test group',
    createdBy: 'user-owner',
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'agent', memberId: 'agent-1' })

  const memberAccess = await resolveConversationAccess({
    conversationId: conversation.id,
    viewer: { type: 'agent', id: 'agent-1' },
  })
  assert.equal(memberAccess.ok, true)
  assert.equal(memberAccess.ok && memberAccess.level, 'member')

  removeConversationMember(conversation.id, 'agent', 'agent-1')

  const removedAccess = await resolveConversationAccess({
    conversationId: conversation.id,
    viewer: { type: 'agent', id: 'agent-1' },
  })
  assert.equal(removedAccess.ok, false)
})

test('resolveConversationAccess grants share-based access, and revoking the share removes it', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-access-2',
    title: 'Share test group',
    createdBy: 'user-owner',
  })

  const shareResult = shareSession({
    sourceKind: 'conversation',
    sourceId: conversation.id,
    targetType: 'agent',
    targetId: 'agent-outsider',
    createdBy: 'user-owner',
  })
  assert.equal(shareResult.ok, true)

  const shareAccess = await resolveConversationAccess({
    conversationId: conversation.id,
    viewer: { type: 'agent', id: 'agent-outsider' },
  })
  assert.equal(shareAccess.ok, true)
  assert.equal(shareAccess.ok && shareAccess.level, 'share')

  assert.equal(shareResult.ok, true)
  if (shareResult.ok) {
    revokeShare(shareResult.share.id)
  }

  const revokedAccess = await resolveConversationAccess({
    conversationId: conversation.id,
    viewer: { type: 'agent', id: 'agent-outsider' },
  })
  assert.equal(revokedAccess.ok, false)
})

test('issueShareLink and resolveShareToken round-trip, and revoking the link invalidates the token', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-access-3',
    title: 'Link share test group',
    createdBy: 'user-owner',
  })

  const issued = issueShareLink({
    sourceKind: 'conversation',
    sourceId: conversation.id,
    createdBy: 'user-owner',
  })
  assert.equal(issued.ok, true)
  if (!issued.ok) {
    return
  }

  const resolved = resolveShareToken(issued.token)
  assert.equal(resolved.ok, true)
  assert.equal(resolved.ok && resolved.sourceKind === 'conversation' && resolved.conversation.id, conversation.id)

  revokeShare(issued.share.id)

  const afterRevoke = resolveShareToken(issued.token)
  assert.equal(afterRevoke.ok, false)
})

test('shareSession rejects a main_chat sourceId that does not exist', () => {
  const result = shareSession({
    sourceKind: 'main_chat',
    sourceId: 'does-not-exist',
    targetType: 'agent',
    targetId: 'agent-outsider',
    createdBy: 'user-owner',
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.status, 404)
})

test('shareSession grants share-based access to a main_chat session, and revoking the share removes it', () => {
  const session = buildMainChatSession('main-chat-share-1', 'private')
  uiStateCache.mainChatSessions.push(session)

  const shareResult = shareSession({
    sourceKind: 'main_chat',
    sourceId: session.id,
    targetType: 'agent',
    targetId: 'agent-outsider',
    createdBy: 'user-owner',
  })
  assert.equal(shareResult.ok, true)

  const shareAccess = resolveMainChatSessionAccess({
    sessionId: session.id,
    viewer: { type: 'agent', id: 'agent-outsider' },
  })
  assert.equal(shareAccess.ok, true)
  assert.equal(shareAccess.ok && shareAccess.level, 'share')

  if (shareResult.ok) {
    revokeShare(shareResult.share.id)
  }

  const revokedAccess = resolveMainChatSessionAccess({
    sessionId: session.id,
    viewer: { type: 'agent', id: 'agent-outsider' },
  })
  assert.equal(revokedAccess.ok, false)
})

test('issueShareLink and resolveShareToken round-trip for a main_chat session', () => {
  const session = buildMainChatSession('main-chat-share-2', 'private')
  uiStateCache.mainChatSessions.push(session)

  const issued = issueShareLink({
    sourceKind: 'main_chat',
    sourceId: session.id,
    createdBy: 'user-owner',
  })
  assert.equal(issued.ok, true)
  if (!issued.ok) {
    return
  }

  const resolved = resolveShareToken(issued.token)
  assert.equal(resolved.ok, true)
  assert.equal(resolved.ok && resolved.sourceKind === 'main_chat' && resolved.mainChatSession.id, session.id)

  revokeShare(issued.share.id)

  const afterRevoke = resolveShareToken(issued.token)
  assert.equal(afterRevoke.ok, false)
})

test('issueShareLink blocks workspace_session source kind (embed links are unsupported)', () => {
  const issued = issueShareLink({
    sourceKind: 'workspace_session',
    sourceId: 'workspace-session-any',
    createdBy: 'user-owner',
  })
  assert.equal(issued.ok, false)
  assert.equal(issued.ok ? '' : issued.status, 403)
})

test('shareSession rejects a workspace_session sourceId that does not exist', () => {
  const result = shareSession({
    sourceKind: 'workspace_session',
    sourceId: 'workspace-session-missing',
    targetType: 'user',
    targetId: 'user-1',
    createdBy: 'user-owner',
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok ? '' : result.status, 404)
})
