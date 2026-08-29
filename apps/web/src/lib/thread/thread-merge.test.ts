import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import {
  buildWorkspaceSessionEventsPageFixture,
  buildWorkspaceSessionHistoryFixture,
} from '@shared/workspace-session-history-test-fixtures'
import type { ConversationMessageRecord, ConversationRecord } from '../api'
import type { ChatTimelineEvent } from '../workspace-session-chat-ui'
import { mapWorkspaceSessionHistoryEventsToTimeline } from '../workspace-session-chat-ui'
import {
  appendConversationMessages,
  buildConversationPayload,
  conversationContainsLatestMessage,
  filterKnownWorkspaceSessionHistoryEvents,
  filterQueuedMessagesAlreadyInConversation,
  isConversationCacheFresh,
  mergeHistorySnapshotTimeline,
  prependConversationMessages,
  prependHistoryPageTimeline,
  resolveIncomingTaskChatSessionSnapshot,
  settleOptimisticMessages,
  upsertOptimisticMessage,
} from './thread-merge'

const conversation: ConversationRecord = {
  id: 'conversation-1',
  title: 'Task Chat',
  kind: 'task',
  chatMode: 'direct',
  status: 'active',
  externalSyncMode: 'internal',
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z',
}

const buildMessage = (id: string, createdAt: string): ConversationMessageRecord => ({
  id,
  conversationId: conversation.id,
  role: id.startsWith('user') ? 'user' : 'assistant',
  content: id,
  contentType: 'markdown',
  createdAt,
})

const buildSessionSnapshot = (messageCount: number, latestMessageAt?: string): TaskChatSessionSnapshot => ({
  protocol: {
    version: 'v1alpha1',
    stream: 'task-chat-ws',
    history: 'conversation-http',
    queue: 'http-resource',
  },
  scope: {
    mode: 'workspace',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
  },
  runtime: {
    agentRunningStatus: 'idle',
    currentStep: '',
    needsHumanConfirm: false,
  },
  conversation: {
    conversationId: conversation.id,
    messageCount,
    latestMessageAt,
  },
  queue: {
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    status: 'empty',
    items: [],
  },
})

test('prependConversationMessages keeps chronological order without duplicates', () => {
  const olderMessages = [
    buildMessage('user-1', '2026-05-08T00:00:00.000Z'),
    buildMessage('assistant-1', '2026-05-08T00:00:01.000Z'),
  ]
  const currentMessages = [
    buildMessage('assistant-1', '2026-05-08T00:00:01.000Z'),
    buildMessage('user-2', '2026-05-08T00:00:02.000Z'),
  ]

  assert.deepEqual(
    prependConversationMessages(currentMessages, olderMessages).map((message) => message.id),
    ['user-1', 'assistant-1', 'user-2'],
  )
})

test('appendConversationMessages adds only newer unique messages', () => {
  const currentMessages = [
    buildMessage('user-1', '2026-05-08T00:00:00.000Z'),
    buildMessage('assistant-1', '2026-05-08T00:00:01.000Z'),
  ]
  const nextMessages = [
    buildMessage('assistant-1', '2026-05-08T00:00:01.000Z'),
    buildMessage('user-2', '2026-05-08T00:00:02.000Z'),
  ]

  assert.deepEqual(
    appendConversationMessages(currentMessages, nextMessages).map((message) => message.id),
    ['user-1', 'assistant-1', 'user-2'],
  )
})

test('isConversationCacheFresh requires matching message count and latest timestamp', () => {
  const payload = buildConversationPayload(
    conversation,
    [
      buildMessage('user-1', '2026-05-08T00:00:00.000Z'),
      buildMessage('assistant-1', '2026-05-08T00:00:01.000Z'),
    ],
    2,
    false,
  )

  assert.equal(
    isConversationCacheFresh(payload, buildSessionSnapshot(2, '2026-05-08T00:00:01.000Z')),
    true,
  )
  assert.equal(
    isConversationCacheFresh(payload, buildSessionSnapshot(3, '2026-05-08T00:00:02.000Z')),
    false,
  )
})

test('conversationContainsLatestMessage accepts partial history when latest edge matches', () => {
  const messages = [
    buildMessage('user-9', '2026-05-08T00:00:08.000Z'),
    buildMessage('assistant-9', '2026-05-08T00:00:09.000Z'),
  ]

  assert.equal(
    conversationContainsLatestMessage(messages, buildSessionSnapshot(100, '2026-05-08T00:00:09.000Z')),
    true,
  )
  assert.equal(
    conversationContainsLatestMessage(messages, buildSessionSnapshot(101, '2026-05-08T00:00:10.000Z')),
    false,
  )
})

test('filterQueuedMessagesAlreadyInConversation hides queue items with persisted turn ids', () => {
  const queued = [{
    id: 'queue-1',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    message: '调研一下 Rivet Sandbox',
    createdAt: '2026-05-08T00:00:01.000Z',
  }]
  const messages = [{
    ...buildMessage('user-1', '2026-05-08T00:00:02.000Z'),
    content: '调研一下 Rivet Sandbox',
    externalRef: {
      turnId: 'task-chat-queue:queue-1',
    },
  }]

  assert.deepEqual(filterQueuedMessagesAlreadyInConversation(queued, messages), [])
})

test('filterQueuedMessagesAlreadyInConversation hides queue items that already rendered as matching user messages', () => {
  const queued = [{
    id: 'queue-1',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    message: '调研一下 Rivet Sandbox',
    attachments: [{
      id: 'attachment-1',
      url: '/attachments/attachment-1',
      filename: 'screenshot.png',
      contentType: 'image/png',
    }],
    createdAt: '2026-05-08T00:00:01.000Z',
  }]
  const messages = [{
    ...buildMessage('user-1', '2026-05-08T00:00:02.000Z'),
    content: ' 调研一下   Rivet Sandbox ',
    externalRef: {
      attachments: [{
        id: 'attachment-1',
        url: '/attachments/attachment-1',
        filename: 'screenshot.png',
        contentType: 'image/png',
      }],
    },
  }]

  assert.deepEqual(filterQueuedMessagesAlreadyInConversation(queued, messages), [])
})

test('filterQueuedMessagesAlreadyInConversation hides queue items that already rendered in the realtime timeline', () => {
  const queued = [{
    id: 'queue-1',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    message: '创建一个 Next.js 项目',
    attachments: [{
      id: 'attachment-1',
      url: '/attachments/attachment-1',
      filename: 'screenshot.png',
      contentType: 'image/png',
    }],
    createdAt: '2026-05-08T00:00:01.000Z',
  }]

  assert.deepEqual(filterQueuedMessagesAlreadyInConversation(queued, [], [{
    id: 'event-1',
    ts: '2026-05-08T00:00:02.000Z',
    turnId: 'task-chat-queue:queue-1',
    seq: 0,
    kind: 'user_message',
    messageId: 'message-1',
    text: '创建一个 Next.js 项目',
    attachments: [{
      id: 'attachment-1',
      url: '/attachments/attachment-1',
      filename: 'screenshot.png',
      contentType: 'image/png',
    }],
  }]), [])
})

const buildWorkspaceSnapshot = (
  runtime: Partial<TaskChatSessionSnapshot['runtime']> = {},
): TaskChatSessionSnapshot => ({
  protocol: {
    version: 'v1alpha1',
    stream: 'task-chat-ws',
    history: 'conversation-http',
    queue: 'http-resource',
  },
  scope: {
    mode: 'workspace',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
  },
  runtime: {
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    currentStep: 'Claude Code 正在执行工具与生成回复',
    needsHumanConfirm: false,
    ...runtime,
  },
  conversation: {
    conversationId: 'conversation-1',
    messageCount: 2,
    latestMessageAt: '2026-05-11T07:00:00.000Z',
  },
  queue: {
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    status: 'empty',
    items: [],
  },
})

test('resolveIncomingTaskChatSessionSnapshot keeps optimistic running session over stale completed snapshot', () => {
  const optimisticSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'thinking',
    runtimeStatus: 'running',
    currentStep: '正在提交消息',
    runtimeSequence: 9,
  })
  const staleCompletedSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '已完成',
    runtimeSequence: 8,
  })

  assert.equal(resolveIncomingTaskChatSessionSnapshot(optimisticSession, staleCompletedSession), optimisticSession)
})

test('resolveIncomingTaskChatSessionSnapshot keeps queued messages from an older runtime snapshot', () => {
  const optimisticSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'thinking',
    runtimeStatus: 'running',
    currentStep: '消息已提交，等待会话处理',
    runtimeSequence: 9,
  })
  const queuedSession = {
    ...buildWorkspaceSnapshot({
      agentRunningStatus: 'executing',
      runtimeStatus: 'running',
      currentStep: '正在处理上一条消息',
      runtimeSequence: 8,
    }),
    queue: {
      sessionKey: 'task:task-1:workspace:workspace-1::session-1',
      status: 'queued' as const,
      items: [{
        id: 'queue-1',
        sessionKey: 'task:task-1:workspace:workspace-1::session-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-1',
        message: 'queued message',
        createdAt: '2026-05-11T07:00:01.000Z',
      }],
    },
  }

  const resolved = resolveIncomingTaskChatSessionSnapshot(optimisticSession, queuedSession)

  assert.ok(resolved)
  assert.equal(resolved.runtime.runtimeSequence, 9)
  assert.equal(resolved.queue.status, 'queued')
  assert.deepEqual(resolved.queue.items.map((item) => item.id), ['queue-1'])
})

test('resolveIncomingTaskChatSessionSnapshot accepts queue removals from an older runtime snapshot', () => {
  const busySession = {
    ...buildWorkspaceSnapshot({
      agentRunningStatus: 'thinking',
      runtimeStatus: 'running',
      currentStep: '消息已提交，等待会话处理',
      runtimeSequence: 9,
    }),
    queue: {
      sessionKey: 'task:task-1:workspace:workspace-1::session-1',
      status: 'queued' as const,
      items: [{
        id: 'queue-1',
        sessionKey: 'task:task-1:workspace:workspace-1::session-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        workspaceSessionId: 'session-1',
        message: 'queued message',
        createdAt: '2026-05-11T07:00:01.000Z',
      }],
    },
  }
  const queueRemovedSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    currentStep: '正在处理上一条消息',
    runtimeSequence: 8,
  })

  const resolved = resolveIncomingTaskChatSessionSnapshot(busySession, queueRemovedSession)

  assert.ok(resolved)
  assert.equal(resolved.runtime.runtimeSequence, 9)
  assert.equal(resolved.queue.status, 'empty')
  assert.deepEqual(resolved.queue.items, [])
})

test('resolveIncomingTaskChatSessionSnapshot accepts newer completed snapshot for the current turn', () => {
  const optimisticSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'thinking',
    runtimeStatus: 'running',
    currentStep: '正在处理工作区对话',
    runtimeSequence: 9,
  })
  const completedSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '工作区对话已完成',
    runtimeSequence: 10,
  })

  assert.equal(resolveIncomingTaskChatSessionSnapshot(optimisticSession, completedSession), completedSession)
})

test('mergeHistorySnapshotTimeline keeps older loaded history when reconnect snapshot only contains recent events', () => {
  const olderUserEvent: ChatTimelineEvent = {
    id: 'event-older-user',
    ts: '2026-05-11T00:00:00.000Z',
    turnId: 'turn-older',
    seq: 1,
    kind: 'user_message',
    messageId: 'message-older-user',
    text: 'older user',
  }
  const olderAssistantEvent: ChatTimelineEvent = {
    id: 'event-older-assistant',
    ts: '2026-05-11T00:00:01.000Z',
    turnId: 'turn-older',
    seq: 2,
    kind: 'assistant_message',
    messageId: 'message-older-assistant',
    text: 'older assistant',
  }
  const recentUserEvent: ChatTimelineEvent = {
    id: 'event-recent-user',
    ts: '2026-05-12T00:00:00.000Z',
    turnId: 'turn-recent',
    seq: 1,
    kind: 'user_message',
    messageId: 'message-recent-user',
    text: 'recent user',
  }

  const merged = mergeHistorySnapshotTimeline(
    [olderUserEvent, olderAssistantEvent, recentUserEvent],
    [recentUserEvent],
  )

  assert.deepEqual(merged.map((event) => event.id), [
    'event-older-user',
    'event-older-assistant',
    'event-recent-user',
  ])
})

test('filterKnownWorkspaceSessionHistoryEvents drops already remembered history snapshot events', () => {
  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId: 'session-known-history',
    turnCount: 3,
  })
  const knownEventIds = new Set(fixture.events.slice(0, 4).map((event) => event.id))

  const unknownEvents = filterKnownWorkspaceSessionHistoryEvents(fixture.events, knownEventIds)

  assert.deepEqual(unknownEvents.map((event) => event.id), fixture.events.slice(4).map((event) => event.id))
})

test('mergeHistorySnapshotTimeline preserves long loaded history when reconnect snapshot overlaps only recent events', () => {
  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId: 'session-merge-long-history',
    turnCount: 180,
  })
  const fullTimeline = mapWorkspaceSessionHistoryEventsToTimeline(fixture.events)
  const reconnectPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    limit: 140,
  })
  const reconnectTimeline = mapWorkspaceSessionHistoryEventsToTimeline(reconnectPage.events)

  const merged = mergeHistorySnapshotTimeline(fullTimeline, reconnectTimeline)

  assert.equal(merged.length, fullTimeline.length)
  assert.equal(merged[0]?.id, fullTimeline[0]?.id)
  assert.equal(merged.at(-1)?.id, fullTimeline.at(-1)?.id)
})

test('prependHistoryPageTimeline keeps long older pages ordered and dedupes overlap', () => {
  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId: 'session-prepend-long-history',
    turnCount: 200,
  })
  const latestPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    limit: 120,
  })
  const olderPage = buildWorkspaceSessionEventsPageFixture({
    sessionId: fixture.sessionId,
    events: fixture.events,
    beforeSessionSeq: latestPage.events[0]?.sessionSeq,
    limit: 120,
  })

  const latestTimeline = mapWorkspaceSessionHistoryEventsToTimeline(latestPage.events)
  const olderTimeline = mapWorkspaceSessionHistoryEventsToTimeline([
    ...olderPage.events,
    latestPage.events[0]!,
  ])
  const eventSeqById = new Map(fixture.events.map((event) => [event.id, event.sessionSeq]))

  const merged = prependHistoryPageTimeline(
    latestTimeline,
    olderTimeline,
    (eventId) => eventSeqById.get(eventId),
  )

  const expectedTimeline = mapWorkspaceSessionHistoryEventsToTimeline([
    ...olderPage.events,
    ...latestPage.events,
  ])
  assert.deepEqual(merged.map((event) => event.id), expectedTimeline.map((event) => event.id))
})

test('upsertOptimisticMessage inserts and replaces by clientMessageId', () => {
  const first = { id: 'pending:client-1', role: 'user' as const, content: '第一条' }
  const queue = upsertOptimisticMessage([], first, 'client-1')
  assert.equal(queue.length, 1)
  assert.equal(queue[0]?.message.id, 'pending:client-1')

  const second = { id: 'pending:client-2', role: 'user' as const, content: '第二条' }
  const withTwo = upsertOptimisticMessage(queue, second, 'client-2')
  assert.equal(withTwo.length, 2)

  // 同 clientMessageId 整体替换（同一发送的乐观气泡只保留一份）
  const replaced = upsertOptimisticMessage(withTwo, { ...first, content: '第一条（重发）' }, 'client-1')
  assert.equal(replaced.length, 2)
  assert.equal(replaced[0]?.message.content, '第一条（重发）')
})

test('settleOptimisticMessages removes the entry with the matching clientMessageId', () => {
  const queue = [
    { clientMessageId: 'client-1', message: { id: 'pending:client-1', role: 'user' as const, content: 'a' } },
    { clientMessageId: 'client-2', message: { id: 'pending:client-2', role: 'user' as const, content: 'b' } },
  ]

  const settled = settleOptimisticMessages(queue, 'client-1')
  assert.equal(settled.length, 1)
  assert.equal(settled[0]?.clientMessageId, 'client-2')

  // 空 id 不销账（防御分支）
  assert.equal(settleOptimisticMessages(queue, '').length, 2)
  assert.equal(settleOptimisticMessages(queue, 'unknown').length, 2)
})
