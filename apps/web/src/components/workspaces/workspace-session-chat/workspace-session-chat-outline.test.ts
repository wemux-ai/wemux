import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationMessageRecord } from '../../../lib/api'
import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'
import {
  mapConversationMessagesToOutlineItems,
  mapWorkspaceSessionEventsToOutlineItems,
  mergeTaskChatOutlineItems,
} from './workspace-session-chat-outline'

test('mapWorkspaceSessionEventsToOutlineItems excludes deleted turns from outline history', () => {
  const events: WorkspaceSessionEventRecord[] = [
    {
      id: 'event-user-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      sessionSeq: 1,
      turnSeq: 1,
      createdAt: '2026-05-20T10:00:00.000Z',
      visibility: 'transcript',
      kind: 'user_message',
      payload: {
        messageId: 'message-user-1',
        text: '第一条用户消息',
      },
    },
    {
      id: 'event-user-2',
      sessionId: 'session-1',
      turnId: 'turn-2',
      sessionSeq: 2,
      turnSeq: 1,
      createdAt: '2026-05-20T10:01:00.000Z',
      visibility: 'transcript',
      kind: 'user_message',
      payload: {
        messageId: 'message-user-2',
        text: '第二条用户消息',
      },
    },
    {
      id: 'event-delete-2',
      sessionId: 'session-1',
      turnId: 'turn-2',
      sessionSeq: 3,
      turnSeq: 2,
      createdAt: '2026-05-20T10:02:00.000Z',
      visibility: 'hidden',
      kind: 'turn_deleted',
      payload: {
        deletedTurnId: 'turn-2',
        deletedMessageId: 'message-user-2',
      },
    },
  ]

  const items = mapWorkspaceSessionEventsToOutlineItems(events)

  assert.deepEqual(items.map((item) => item.turnId), ['turn-1'])
  assert.equal(items[0]?.messageId, 'message-user-1')
})

test('mapConversationMessagesToOutlineItems keeps user turns in chronological order', () => {
  const messages: ConversationMessageRecord[] = [
    {
      id: 'message-user-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: '你好',
      contentType: 'text',
      createdAt: '2026-05-20T10:00:00.000Z',
    },
    {
      id: 'message-assistant-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: '你好，有什么我可以帮忙的？',
      contentType: 'text',
      createdAt: '2026-05-20T10:00:05.000Z',
    },
    {
      id: 'message-user-2',
      conversationId: 'conversation-1',
      role: 'user',
      content: '帮我看看这个工作区',
      contentType: 'text',
      createdAt: '2026-05-20T10:01:00.000Z',
    },
  ]

  const items = mapConversationMessagesToOutlineItems(messages)

  assert.deepEqual(items.map((item) => item.messageId), ['message-user-1', 'message-user-2'])
})

test('mergeTaskChatOutlineItems preserves full history while refreshing visible turn state', () => {
  const merged = mergeTaskChatOutlineItems(
    [
      {
        anchorId: 'anchor-1',
        turnId: 'turn-1',
        messageId: 'message-1',
        text: '第一条',
        isCurrent: false,
      },
      {
        anchorId: 'anchor-2',
        turnId: 'turn-2',
        messageId: 'message-2',
        text: '第二条',
        isCurrent: false,
      },
    ],
    [
      {
        anchorId: 'anchor-2',
        turnId: 'turn-2',
        messageId: 'message-2',
        text: '第二条',
        isCurrent: true,
      },
      {
        anchorId: 'anchor-3',
        turnId: 'turn-3',
        messageId: 'message-3',
        text: '第三条',
        isCurrent: false,
      },
    ],
  )

  assert.deepEqual(merged.map((item) => item.turnId), ['turn-1', 'turn-2', 'turn-3'])
  assert.equal(merged[1]?.isCurrent, true)
})
