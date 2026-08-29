import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { Task } from '@shared/types'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import {
  areTimelineEventsRenderEquivalent,
  resolveTimelineAutoScrollMode,
  resolveScopedLiveRuntimeState,
  resolveHydratedTaskChatSessionSnapshot,
  resolveHydratedWorkspaceSessionRuntimeSnapshot,
  shouldApplyScopedLiveRuntimeState,
  shouldPreserveLiveTimeline,
  shouldResolvePendingInitialScroll,
} from './workspace-session-chat-sync-effects'

const buildAssistantEvent = (id: string): Extract<ChatTimelineEvent, { kind: 'assistant_message' }> => ({
  id,
  ts: '2026-04-30T00:00:00.000Z',
  turnId: 'turn-1',
  seq: 2,
  kind: 'assistant_message',
  messageId: id,
  text: 'Pi reply',
})

test('shouldPreserveLiveTimeline keeps live assistant events when fallback data is stale', () => {
  const currentTimeline: ChatTimelineEvent[] = [
    {
      id: 'status-1',
      ts: '2026-04-30T00:00:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'status',
      status: 'executing',
      step: 'Pi 正在执行工具与生成回复',
    },
    buildAssistantEvent('assistant-1'),
  ]

  const nextTimeline: ChatTimelineEvent[] = [
    {
      id: 'status-1',
      ts: '2026-04-30T00:00:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'status',
      status: 'executing',
      step: 'Pi 正在执行工具与生成回复',
    },
  ]

  assert.equal(shouldPreserveLiveTimeline(currentTimeline, nextTimeline), true)
})

test('shouldPreserveLiveTimeline yields to persisted history once assistant events catch up', () => {
  const assistantEvent = buildAssistantEvent('assistant-1')
  const currentTimeline: ChatTimelineEvent[] = [assistantEvent]
  const nextTimeline: ChatTimelineEvent[] = [assistantEvent]

  assert.equal(shouldPreserveLiveTimeline(currentTimeline, nextTimeline), false)
})

test('shouldPreserveLiveTimeline yields when history has the same user turn with a different message id', () => {
  const currentTimeline: ChatTimelineEvent[] = [
    {
      id: 'turn:turn-1:user:user:turn-1',
      ts: '2026-04-30T00:00:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'user:turn-1',
      text: '你会什么',
    },
  ]
  const nextTimeline: ChatTimelineEvent[] = [
    {
      id: 'persisted-user-message-id',
      ts: '2026-04-30T00:00:01.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'conversation-message-id',
      text: '你会什么',
    },
  ]

  assert.equal(shouldPreserveLiveTimeline(currentTimeline, nextTimeline), false)
})

test('areTimelineEventsRenderEquivalent treats identical history payloads as no-op renders', () => {
  const currentTimeline: ChatTimelineEvent[] = [
    {
      id: 'event-user-1',
      ts: '2026-04-30T00:00:00.000Z',
      turnId: 'turn-1',
      seq: 1,
      kind: 'user_message',
      messageId: 'message-user-1',
      text: '你好',
    },
    buildAssistantEvent('assistant-1'),
  ]
  const nextTimeline = currentTimeline.map((event) => ({ ...event }))

  assert.equal(areTimelineEventsRenderEquivalent(currentTimeline, nextTimeline), true)
})

test('areTimelineEventsRenderEquivalent detects changed assistant content', () => {
  const currentTimeline: ChatTimelineEvent[] = [buildAssistantEvent('assistant-1')]
  const nextTimeline: ChatTimelineEvent[] = [{
    ...buildAssistantEvent('assistant-1'),
    text: 'Pi reply updated',
  }]

  assert.equal(areTimelineEventsRenderEquivalent(currentTimeline, nextTimeline), false)
})

test('shouldResolvePendingInitialScroll waits for real content when no cache has loaded yet', () => {
  assert.equal(shouldResolvePendingInitialScroll({
    conversationLoaded: false,
    conversationMessageCount: 0,
    displayTimelineLength: 0,
    hasResolvedInitialWorkspaceHistory: true,
    isWorkspaceHistoryMode: false,
    isSessionBusy: false,
    noticesLength: 0,
    queuedMessagesLength: 0,
    systemLogsLength: 0,
  }), false)
})

test('shouldResolvePendingInitialScroll unlocks auto-follow for first live stream chunk', () => {
  assert.equal(shouldResolvePendingInitialScroll({
    conversationLoaded: false,
    conversationMessageCount: 0,
    displayTimelineLength: 1,
    hasResolvedInitialWorkspaceHistory: true,
    isWorkspaceHistoryMode: false,
    isSessionBusy: true,
    noticesLength: 0,
    queuedMessagesLength: 0,
    systemLogsLength: 0,
  }), true)
})

test('shouldResolvePendingInitialScroll unlocks after an empty workspace history page resolves', () => {
  assert.equal(shouldResolvePendingInitialScroll({
    conversationLoaded: true,
    conversationMessageCount: 0,
    displayTimelineLength: 0,
    hasResolvedInitialWorkspaceHistory: true,
    isWorkspaceHistoryMode: true,
    isSessionBusy: false,
    noticesLength: 0,
    queuedMessagesLength: 0,
    systemLogsLength: 0,
  }), true)
})

test('shouldResolvePendingInitialScroll waits until initial workspace history hydration finishes', () => {
  assert.equal(shouldResolvePendingInitialScroll({
    conversationLoaded: true,
    conversationMessageCount: 8,
    displayTimelineLength: 8,
    hasResolvedInitialWorkspaceHistory: false,
    isWorkspaceHistoryMode: false,
    isSessionBusy: false,
    noticesLength: 0,
    queuedMessagesLength: 0,
    systemLogsLength: 0,
  }), false)
})

test('resolveTimelineAutoScrollMode uses instant while the session is busy', () => {
  assert.equal(resolveTimelineAutoScrollMode({
    isSessionBusy: true,
    displayTimeline: [],
  }), 'instant')
})

test('resolveTimelineAutoScrollMode uses instant while an assistant message is streaming', () => {
  assert.equal(resolveTimelineAutoScrollMode({
    isSessionBusy: false,
    displayTimeline: [{
      id: 'turn-1',
      isCurrent: true,
      entries: [{
        kind: 'assistant',
        id: 'assistant-entry-1',
        message: {
          id: 'assistant-message-1',
          role: 'assistant',
          text: 'streaming',
          streaming: true,
        },
      }],
    }],
  }), 'instant')
})

test('resolveTimelineAutoScrollMode keeps smooth for settled history changes', () => {
  assert.equal(resolveTimelineAutoScrollMode({
    isSessionBusy: false,
    displayTimeline: [],
  }), 'smooth')
})

test('resolveScopedLiveRuntimeState prefers target workspace session runtime when switching history sessions', () => {
  const resolved = resolveScopedLiveRuntimeState({
    task: {
      agentRunningStatus: 'executing',
      currentStep: '当前主会话还在运行',
      toolCalls: [{
        id: 'tool-1',
        name: 'shell',
        args: 'pwd',
        startedAt: '2026-05-12T00:00:00.000Z',
      }],
    } as unknown as Task,
    workspaceSession: {
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: '历史会话',
      titleOrigin: 'manual',
      status: 'active',
      sessionKind: 'primary',
      sessionRole: 'general',
      sessionOrigin: 'manual',
      worktreeId: 'worktree-1',
      branchName: 'feature/test',
      worktreeStatus: 'created',
      workingDirectoryMode: 'worktree',
      needsHumanConfirm: false,
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      runtimeSequence: 3,
      currentStep: '已完成',
      lastActiveAt: '2026-05-12T00:00:00.000Z',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    cachedSessionSnapshot: null,
    workspaceSessionId: 'session-1',
  })

  assert.deepEqual(resolved, {
    status: 'complete',
    step: '已完成',
    tools: [],
  })
})

test('shouldApplyScopedLiveRuntimeState lets a completed server session settle local executing state', () => {
  assert.equal(shouldApplyScopedLiveRuntimeState({
    currentSessionBusy: true,
    nextStatus: 'complete',
  }), true)
})

test('shouldApplyScopedLiveRuntimeState keeps live progress when the incoming snapshot is still running', () => {
  assert.equal(shouldApplyScopedLiveRuntimeState({
    currentSessionBusy: true,
    nextStatus: 'executing',
  }), false)
})

const buildSessionSnapshot = (params: {
  runtimeSequence: number
  queueIds: string[]
}): TaskChatSessionSnapshot => ({
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
    agentRunningStatus: params.queueIds.length > 0 ? 'thinking' : 'executing',
    runtimeStatus: params.queueIds.length > 0 ? 'queued' : 'running',
    currentStep: params.queueIds.length > 0 ? '消息等待处理中' : '正在处理消息',
    needsHumanConfirm: false,
    runtimeSequence: params.runtimeSequence,
  },
  conversation: {
    conversationId: 'conversation-1',
    messageCount: 1,
    latestMessageAt: '2026-05-12T00:00:00.000Z',
  },
  queue: {
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    status: params.queueIds.length > 0 ? 'queued' : 'empty',
    items: params.queueIds.map((queueId, index) => ({
      id: queueId,
      sessionKey: 'task:task-1:workspace:workspace-1::session-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      message: `message-${queueId}`,
      createdAt: `2026-05-12T00:00:0${index}.000Z`,
    })),
  },
})

test('resolveScopedLiveRuntimeState keeps completed workspace session over stale running task status', () => {
  const resolved = resolveScopedLiveRuntimeState({
    task: {
      agentRunningStatus: 'executing',
      currentStep: '当前任务级状态仍在运行',
      toolCalls: [{
        id: 'tool-1',
        name: 'shell',
        args: 'pwd',
        startedAt: '2026-05-12T00:00:00.000Z',
      }],
    } as unknown as Task,
    workspaceSession: {
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: '已完成会话',
      titleOrigin: 'manual',
      status: 'active',
      sessionKind: 'primary',
      sessionRole: 'general',
      sessionOrigin: 'manual',
      worktreeId: 'worktree-1',
      branchName: 'feature/test',
      worktreeStatus: 'created',
      workingDirectoryMode: 'worktree',
      needsHumanConfirm: false,
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      runtimeSequence: 4,
      currentStep: '已完成',
      lastActiveAt: '2026-05-12T00:00:00.000Z',
      createdAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-12T00:00:00.000Z',
    },
    cachedSessionSnapshot: buildSessionSnapshot({
      runtimeSequence: 3,
      queueIds: [],
    }),
    workspaceSessionId: 'session-1',
  })

  assert.deepEqual(resolved, {
    status: 'complete',
    step: '已完成',
    tools: [],
  })
})

const buildRuntimeSnapshot = (params: {
  agentRunningStatus: 'idle' | 'thinking' | 'executing' | 'waiting' | 'complete' | 'error'
  runtimeStatus: 'idle' | 'queued' | 'running' | 'waiting' | 'completed' | 'error' | 'lost' | 'cancelled'
  currentStep: string
  lastEventSeq: number
}) => ({
  sessionId: 'session-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  agentRunningStatus: params.agentRunningStatus,
  runtimeStatus: params.runtimeStatus,
  currentStep: params.currentStep,
  queueStatus: params.runtimeStatus === 'queued' ? 'queued' as const : params.runtimeStatus === 'running' ? 'running' as const : 'idle' as const,
  activeToolCalls: [],
  lastEventSeq: params.lastEventSeq,
  updatedAt: '2026-05-12T00:00:00.000Z',
})

test('resolveHydratedTaskChatSessionSnapshot keeps live session state when HTTP hydration returns stale data', () => {
  const liveSnapshot = buildSessionSnapshot({
    runtimeSequence: 2,
    queueIds: ['queue-2'],
  })
  const staleHydratedSnapshot = buildSessionSnapshot({
    runtimeSequence: 1,
    queueIds: ['queue-1', 'queue-2'],
  })

  assert.equal(resolveHydratedTaskChatSessionSnapshot({
    currentSnapshot: liveSnapshot,
    fetchedSnapshot: staleHydratedSnapshot,
    requestLiveSessionRevision: 0,
    currentLiveSessionRevision: 1,
  }), liveSnapshot)
})

test('resolveHydratedTaskChatSessionSnapshot applies HTTP hydration when no live update raced with it', () => {
  const currentSnapshot = buildSessionSnapshot({
    runtimeSequence: 1,
    queueIds: ['queue-1', 'queue-2'],
  })
  const hydratedSnapshot = buildSessionSnapshot({
    runtimeSequence: 2,
    queueIds: ['queue-2'],
  })

  assert.equal(resolveHydratedTaskChatSessionSnapshot({
    currentSnapshot,
    fetchedSnapshot: hydratedSnapshot,
    requestLiveSessionRevision: 3,
    currentLiveSessionRevision: 3,
  }), hydratedSnapshot)
})

test('resolveHydratedWorkspaceSessionRuntimeSnapshot ignores stale HTTP runtime after a live update', () => {
  const staleRuntime = buildRuntimeSnapshot({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '已完成',
    lastEventSeq: 12,
  })

  assert.equal(resolveHydratedWorkspaceSessionRuntimeSnapshot({
    fetchedRuntime: staleRuntime,
    requestLiveSessionRevision: 0,
    currentLiveSessionRevision: 1,
  }), null)
})

test('resolveHydratedWorkspaceSessionRuntimeSnapshot applies HTTP runtime when no live update raced with it', () => {
  const runtime = buildRuntimeSnapshot({
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    currentStep: '正在处理',
    lastEventSeq: 13,
  })

  assert.equal(resolveHydratedWorkspaceSessionRuntimeSnapshot({
    fetchedRuntime: runtime,
    requestLiveSessionRevision: 2,
    currentLiveSessionRevision: 2,
  }), runtime)
})
