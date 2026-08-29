import assert from 'node:assert/strict'
import test from 'node:test'
import type { DmConversationListItem } from '../../lib/api/methods/collaboration'
import { filterWorkspaceVisibleDmConversations } from './chat-target-visibility'

const conversation = (id: string, peerUserId: string, workspaceId?: string): DmConversationListItem => ({
  conversation: {
    id,
    workspaceId,
    title: 'DM',
    kind: 'dm',
    chatMode: 'direct',
    status: 'active',
    externalSyncMode: 'internal',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  },
  peer: { userId: peerUserId, name: peerUserId },
  messageCount: 0,
})

test('workspace-visible DMs retain only the current workspace member conversation', () => {
  const visible = filterWorkspaceVisibleDmConversations({
    conversations: [conversation('dm-kyro', 'rail-user', 'workspace-kyro')],
    workspaceId: 'workspace-test-lab',
    friends: [],
  })

  assert.deepEqual(visible, [])
})

test('confirmed friends remain visible across workspaces', () => {
  const visible = filterWorkspaceVisibleDmConversations({
    conversations: [conversation('dm-kyro', 'rail-user', 'workspace-kyro')],
    workspaceId: 'workspace-test-lab',
    friends: [{ id: 'rail-user', name: 'Rail user' }],
  })

  assert.deepEqual(visible.map((item) => item.conversation.id), ['dm-kyro'])
})

test('workspace DMs remain visible in their originating workspace without friendship', () => {
  const visible = filterWorkspaceVisibleDmConversations({
    conversations: [conversation('dm-kyro', 'rail-user', 'workspace-kyro')],
    workspaceId: 'workspace-kyro',
    friends: [],
  })

  assert.deepEqual(visible.map((item) => item.conversation.id), ['dm-kyro'])
})
