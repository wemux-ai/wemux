import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceChatAgentOption, WorkspaceChatGroupSessionDetail } from '../../lib/api'
import {
  extractGroupMessageAttachments,
  getFirstMentionedWorkspaceGroupAgent,
  getMentionedWorkspaceGroupAgents,
  getWorkspaceGroupMessageAgent,
  reconcileGroupRealtimeMessage,
} from './workspace-group-chat-panel'

const agents: WorkspaceChatAgentOption[] = [
  {
    id: 'general-agent',
    name: 'General Agent',
    role: 'General',
    avatarUrl: '/avatars/general.png',
    status: 'online',
    kind: 'custom',
  },
  {
    id: 'ceo-agent',
    name: 'CEO Agent',
    role: 'CEO',
    avatarUrl: '/avatars/ceo.png',
    status: 'online',
    kind: 'custom',
  },
]

test('uses the first mentioned Agent as the active group-chat responder', () => {
  const responder = getFirstMentionedWorkspaceGroupAgent(
    '请 @CEO Agent 先回复，再让 @General Agent 补充。',
    agents,
  )

  assert.equal(responder?.id, 'ceo-agent')
})

test('only treats complete @Agent tokens as group-chat Agent mentions', () => {
  assert.deepEqual(
    getMentionedWorkspaceGroupAgents('@CEO Agent then @General Agent.', agents).map((agent) => agent.id),
    ['ceo-agent', 'general-agent'],
  )
  assert.deepEqual(getMentionedWorkspaceGroupAgents('@CEO Agentic', agents), [])
})

test('resolves a group-chat message Agent from its persisted sender identity', () => {
  const message = {
    id: 'message-1',
    conversationId: 'conversation-1',
    role: 'assistant' as const,
    senderId: 'stale-agent-id',
    content: '已完成。',
    contentType: 'text' as const,
    createdAt: '2026-07-21T00:00:00.000Z',
    externalRef: { agentId: 'general-agent', agentName: 'General Agent' },
  } satisfies WorkspaceChatGroupSessionDetail['messages'][number]

  assert.equal(getWorkspaceGroupMessageAgent(agents, message)?.avatarUrl, '/avatars/general.png')
})

test('extracts Drive attachments from externalRef.attachments (群聊附件空气泡 BUG-6 回归)', () => {
  const message = {
    id: 'message-2',
    conversationId: 'conversation-1',
    role: 'user' as const,
    senderId: 'user-1',
    content: '',
    contentType: 'json' as const,
    createdAt: '2026-07-21T00:00:00.000Z',
    externalRef: {
      attachments: [{
        id: 'drive-file-1',
        url: '/api/drive-attachments/token/download',
        filename: 'voice18-attachment-test.txt',
        contentType: 'text/plain',
        kind: 'drive',
        driveFileId: 'file-1',
      }],
    },
  } satisfies WorkspaceChatGroupSessionDetail['messages'][number]

  const attachments = extractGroupMessageAttachments(message)
  assert.equal(attachments.length, 1)
  assert.equal(attachments[0].filename, 'voice18-attachment-test.txt')
  assert.equal(attachments[0].kind, 'drive')
  assert.equal(attachments[0].driveFileId, 'file-1')
})

test('returns empty attachments when externalRef has none', () => {
  const message = {
    id: 'message-3',
    conversationId: 'conversation-1',
    role: 'user' as const,
    senderId: 'user-1',
    content: 'hello',
    contentType: 'text' as const,
    createdAt: '2026-07-21T00:00:00.000Z',
  } satisfies WorkspaceChatGroupSessionDetail['messages'][number]

  assert.deepEqual(extractGroupMessageAttachments(message), [])
})

test('reconcileGroupRealtimeMessage replaces the optimistic bubble on an early WS echo', () => {
  const clientMessageId = '11111111-1111-4111-8111-111111111111'
  const optimistic = {
    id: `user-${clientMessageId}`,
    conversationId: 'conversation-1',
    role: 'user' as const,
    senderId: 'user-1',
    content: 'hello',
    contentType: 'text' as const,
    createdAt: '2026-08-19T02:54:00.000Z',
  }
  const confirmed = {
    ...optimistic,
    id: 'message-4',
    externalRef: { clientMessageId },
  }

  const next = reconcileGroupRealtimeMessage([optimistic], confirmed)

  assert.deepEqual(next.map((message) => message.id), ['message-4'])
})
