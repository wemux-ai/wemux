import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationMessageRecord } from './api'
import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'
import { buildWorkspaceSessionHistoryFixture } from '@shared/workspace-session-history-test-fixtures'
import {
  mapConversationMessagesToTimelineEvents,
  mapWorkspaceSessionHistoryEventsToTimeline,
  taskChatDataPartSchemas,
} from './workspace-session-chat-ui'

test('task chat stream parsing preserves an Agent-authored user message identity', () => {
  const event = taskChatDataPartSchemas.timeline_event.parse({
    id: 'turn-agent-user',
    ts: '2026-07-23T08:00:00.000Z',
    turnId: 'turn-agent',
    seq: 1,
    kind: 'user_message',
    messageId: 'user-agent',
    text: '请在工作区更新 PRD。',
    authorId: 'agent-research',
    author: {
      type: 'agent',
      id: 'agent-research',
      name: 'Research Agent',
      avatarUrl: '/avatars/research-agent.png',
    },
  })

  assert.equal(event.kind, 'user_message')
  if (event.kind === 'user_message') {
    assert.deepEqual(event.author, {
      type: 'agent',
      id: 'agent-research',
      name: 'Research Agent',
      avatarUrl: '/avatars/research-agent.png',
    })
  }
})

test('mapConversationMessagesToTimelineEvents preserves assistant execution model metadata', () => {
  const messages: ConversationMessageRecord[] = [
    {
      id: 'assistant-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      content: '已处理',
      contentType: 'json',
      createdAt: '2026-05-12T08:00:00.000Z',
      externalRef: {
        timelineEvent: {
          id: 'turn-1-assistant-1',
          ts: '2026-05-12T08:00:00.000Z',
          turnId: 'turn-1',
          seq: 2,
          kind: 'assistant_message',
          messageId: 'assistant-1',
          text: '已处理',
        },
        executionModel: 'openai/gpt-5.5',
      },
    },
  ]

  const events = mapConversationMessagesToTimelineEvents(messages)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.kind, 'assistant_message')
  if (events[0]?.kind === 'assistant_message') {
    assert.equal(events[0].executionModel, 'openai/gpt-5.5')
  }
})

test('mapConversationMessagesToTimelineEvents preserves lifecycle-only workspace preparation turns', () => {
  const messages: ConversationMessageRecord[] = [
    {
      id: 'system-prepare',
      conversationId: 'conversation-1',
      role: 'system',
      content: '正在准备工作目录：/tmp/worktree',
      contentType: 'json',
      createdAt: '2026-06-03T08:00:00.000Z',
      externalRef: {
        timelineEvent: {
          id: 'turn-prepare-system',
          ts: '2026-06-03T08:00:00.000Z',
          turnId: 'turn-prepare',
          seq: 1,
          kind: 'system_message',
          message: '正在准备工作目录：/tmp/worktree',
        },
      },
    },
    {
      id: 'status-complete',
      conversationId: 'conversation-1',
      role: 'system',
      content: '已完成',
      contentType: 'json',
      createdAt: '2026-06-03T08:00:01.000Z',
      externalRef: {
        timelineEvent: {
          id: 'turn-prepare-status',
          ts: '2026-06-03T08:00:01.000Z',
          turnId: 'turn-prepare',
          seq: 2,
          kind: 'status',
          status: 'complete',
          step: '工作区目录准备完成',
        },
      },
    },
    {
      id: 'user-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: '你好',
      contentType: 'markdown',
      createdAt: '2026-06-03T08:01:00.000Z',
    },
  ]

  const events = mapConversationMessagesToTimelineEvents(messages)
  assert.deepEqual(events.map((event) => event.kind), ['system_message', 'status', 'user_message'])
})

test('mapConversationMessagesToTimelineEvents preserves lifecycle system messages inside user turns', () => {
  const messages: ConversationMessageRecord[] = [
    {
      id: 'user-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: '你好',
      contentType: 'markdown',
      createdAt: '2026-06-03T08:01:00.000Z',
      externalRef: {
        timelineEvent: {
          id: 'turn-1-user',
          ts: '2026-06-03T08:01:00.000Z',
          turnId: 'turn-1',
          seq: 1,
          kind: 'user_message',
          messageId: 'user-1',
          text: '你好',
        },
      },
    },
    {
      id: 'system-prepare',
      conversationId: 'conversation-1',
      role: 'system',
      content: '正在准备工作目录：/tmp/worktree',
      contentType: 'json',
      createdAt: '2026-06-03T08:01:01.000Z',
      externalRef: {
        timelineEvent: {
          id: 'turn-1-system',
          ts: '2026-06-03T08:01:01.000Z',
          turnId: 'turn-1',
          seq: 2,
          kind: 'system_message',
          message: '正在准备工作目录：/tmp/worktree',
        },
      },
    },
    {
      id: 'status-executing',
      conversationId: 'conversation-1',
      role: 'system',
      content: '执行中',
      contentType: 'json',
      createdAt: '2026-06-03T08:01:02.000Z',
      externalRef: {
        timelineEvent: {
          id: 'turn-1-status',
          ts: '2026-06-03T08:01:02.000Z',
          turnId: 'turn-1',
          seq: 3,
          kind: 'status',
          status: 'executing',
          step: '正在处理',
        },
      },
    },
  ]

  const events = mapConversationMessagesToTimelineEvents(messages)
  assert.deepEqual(events.map((event) => event.kind), ['user_message', 'system_message', 'status'])
})

test('mapWorkspaceSessionHistoryEventsToTimeline drops turn deleted tombstones from visible timeline', () => {
  const events: WorkspaceSessionEventRecord[] = [
    {
      id: 'event-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      sessionSeq: 1,
      turnSeq: 1,
      visibility: 'transcript',
      kind: 'user_message',
      createdAt: '2026-05-17T08:00:00.000Z',
      payload: {
        messageId: 'message-1',
        text: '继续',
      },
    },
    {
      id: 'event-2',
      sessionId: 'session-1',
      turnId: 'turn-1',
      sessionSeq: 2,
      turnSeq: 2,
      visibility: 'hidden',
      kind: 'turn_deleted',
      createdAt: '2026-05-17T08:01:00.000Z',
      payload: {
        deletedTurnId: 'turn-1',
        deletedMessageId: 'message-1',
      },
    },
  ]

  const timeline = mapWorkspaceSessionHistoryEventsToTimeline(events)
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0]?.kind, 'user_message')
})

test('mapWorkspaceSessionHistoryEventsToTimeline preserves lifecycle-only status turns', () => {
  const events: WorkspaceSessionEventRecord[] = [
    {
      id: 'event-lifecycle',
      sessionId: 'session-1',
      turnId: 'turn-lifecycle',
      sessionSeq: 1,
      turnSeq: 1,
      visibility: 'transcript',
      kind: 'system_message',
      createdAt: '2026-06-03T08:00:00.000Z',
      payload: {
        message: 'worktree 创建完成：/tmp/worktree，分支 vibemux/test',
      },
    },
    {
      id: 'event-lifecycle-status',
      sessionId: 'session-1',
      turnId: 'turn-lifecycle',
      sessionSeq: 2,
      turnSeq: 2,
      visibility: 'transcript',
      kind: 'status',
      createdAt: '2026-06-03T08:00:01.000Z',
      payload: {
        status: 'complete',
        step: '工作区目录准备完成',
      },
    },
  ]

  const timeline = mapWorkspaceSessionHistoryEventsToTimeline(events)
  assert.deepEqual(timeline.map((event) => event.kind), ['system_message', 'status'])
})

test('mapWorkspaceSessionHistoryEventsToTimeline hides orphan workspace lifecycle system messages', () => {
  const events: WorkspaceSessionEventRecord[] = [
    {
      id: 'event-orphan-lifecycle',
      sessionId: 'session-1',
      turnId: 'system:event-orphan-lifecycle',
      sessionSeq: 1,
      turnSeq: 1,
      visibility: 'diagnostic',
      kind: 'system_message',
      createdAt: '2026-06-03T08:00:00.000Z',
      payload: {
        message: '正在检查原始项目目录：/tmp/project',
      },
    },
    {
      id: 'event-normal-system',
      sessionId: 'session-1',
      turnId: 'turn-1',
      sessionSeq: 2,
      turnSeq: 1,
      visibility: 'transcript',
      kind: 'system_message',
      createdAt: '2026-06-03T08:01:00.000Z',
      payload: {
        message: '用户主动停止，本次回复已中止。',
      },
    },
  ]

  const timeline = mapWorkspaceSessionHistoryEventsToTimeline(events)
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0]?.id, 'event-normal-system')
})

test('mapWorkspaceSessionHistoryEventsToTimeline keeps long history ordered for large workspace sessions', () => {
  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId: 'session-map-long-history',
    turnCount: 220,
    deletedTurnIndexes: [7, 19, 58, 144],
  })

  const timeline = mapWorkspaceSessionHistoryEventsToTimeline(fixture.events)
  const expectedVisibleEventCount = fixture.events.filter((event) => event.kind !== 'turn_deleted').length

  assert.equal(timeline.length, expectedVisibleEventCount)
  assert.equal(timeline[0]?.id, 'event-user-1')
  assert.equal(timeline.at(-1)?.id, `event-status-${fixture.turns.length}`)

  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1]!
    const current = timeline[index]!
    const previousTs = new Date(previous.ts).getTime()
    const currentTs = new Date(current.ts).getTime()
    assert.equal(previousTs <= currentTs, true)
    if (previousTs === currentTs) {
      assert.equal(previous.seq <= current.seq, true)
    }
  }
})
