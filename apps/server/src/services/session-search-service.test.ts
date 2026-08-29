import test from 'node:test'
import assert from 'node:assert/strict'

import { addConversationMember, appendConversationMessage, createWorkspaceGroupConversation, removeConversationMember } from '../control-plane/conversation-service'
import { searchSessions } from './session-search-service'
import { initConversationStore } from '../storage/conversation-store'

test('searchSessions matches by conversation title', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-search-title',
    title: 'Roadmap planning sync',
    createdBy: 'user-owner',
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'user', memberId: 'user-owner' })

  const hits = await searchSessions({ query: 'roadmap', viewer: { type: 'user', id: 'user-owner' } })

  assert.equal(hits.length, 1)
  assert.equal(hits[0].conversation.id, conversation.id)
})

test('searchSessions matches by message content and returns matched snippets', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-search-content',
    title: 'Untitled group',
    createdBy: 'user-owner',
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'user', memberId: 'user-owner' })
  appendConversationMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: 'user-owner',
    content: 'let us discuss the quarterly budget numbers',
  })

  const hits = await searchSessions({ query: 'budget', viewer: { type: 'user', id: 'user-owner' } })

  assert.equal(hits.length, 1)
  assert.equal(hits[0].matchedMessages.length, 1)
  assert.match(hits[0].matchedMessages[0].content, /budget/)
})

test('searchSessions excludes conversations the viewer cannot access', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-search-noaccess',
    title: 'Secret budget review',
    createdBy: 'user-owner',
  })

  const hits = await searchSessions({ query: 'secret budget', viewer: { type: 'agent', id: 'agent-outsider' } })

  assert.equal(hits.length, 0)
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('searchSessions hides messages sent outside a member\'s active window', async () => {
  await initConversationStore().catch(() => {})

  const conversation = createWorkspaceGroupConversation({
    workspaceId: 'workspace-search-window',
    title: 'Window group',
    createdBy: 'user-owner',
  })
  addConversationMember({ conversationId: conversation.id, memberType: 'agent', memberId: 'agent-1' })
  await wait(2)

  appendConversationMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: 'user-owner',
    content: 'discuss zeppelin launch plans before agent joins',
  })
  await wait(2)

  removeConversationMember(conversation.id, 'agent', 'agent-1')
  await wait(2)
  addConversationMember({ conversationId: conversation.id, memberType: 'agent', memberId: 'agent-1' })
  await wait(2)

  appendConversationMessage({
    conversationId: conversation.id,
    role: 'user',
    senderId: 'user-owner',
    content: 'zeppelin launch is postponed to next week',
  })

  const hits = await searchSessions({ query: 'zeppelin', viewer: { type: 'agent', id: 'agent-1' } })

  assert.equal(hits.length, 1)
  assert.equal(hits[0].matchedMessages.length, 1)
  assert.match(hits[0].matchedMessages[0].content, /postponed/)
})
