import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { TaskChatWsServerMessage } from '@shared/task-chat-ws'
import { upsertTimelineEvent } from '@shared/timeline'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import { isWorkspaceSessionBusy } from '../../../lib/workspace-session-status'
import {
  buildWorkspaceRuntimeTaskPatchFromSnapshot,
  reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart,
  reconcileWorkspaceSessionSnapshotFromTaskPart,
  restoreWorkspaceSessionSnapshotRuntime,
  shouldApplyTaskChatWsStreamMessage,
} from './workspace-session-chat-socket-sync'

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

const buildTaskChatEventMessage = (): Extract<TaskChatWsServerMessage, { type: 'task_chat.event' }> => ({
  type: 'task_chat.event',
  sessionKey: 'task:task-1:workspace:workspace-1::session-1',
  eventId: 'event-1',
  sentAt: '2026-05-11T07:00:00.000Z',
  part: {
    type: 'timeline_event',
    data: {
      id: 'assistant-1',
      ts: '2026-05-11T07:00:00.000Z',
      kind: 'assistant_message',
      turnId: 'turn-1',
      seq: 1,
      messageId: 'message-1',
      text: '已完成的回答',
    },
  },
})

test('shouldApplyTaskChatWsStreamMessage ignores handshake replay until subscribed', () => {
  assert.equal(shouldApplyTaskChatWsStreamMessage(buildTaskChatEventMessage(), true), false)
  assert.equal(shouldApplyTaskChatWsStreamMessage({
    type: 'task_chat.snapshot',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    part: buildTaskChatEventMessage().part,
  }, true), false)
})

test('shouldApplyTaskChatWsStreamMessage applies stream events only after subscribed', () => {
  assert.equal(shouldApplyTaskChatWsStreamMessage(buildTaskChatEventMessage(), false), true)
  assert.equal(shouldApplyTaskChatWsStreamMessage({
    type: 'task_chat.snapshot',
    sessionKey: 'task:task-1:workspace:workspace-1::session-1',
    part: buildTaskChatEventMessage().part,
  }, false), true)
})

test('buildWorkspaceRuntimeTaskPatchFromSnapshot carries completed runtime status to parent state', () => {
  const patch = buildWorkspaceRuntimeTaskPatchFromSnapshot({
    sessionId: 'session-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '工作区对话已完成',
    queueStatus: 'idle',
    activeToolCalls: [],
    lastEventSeq: 12,
    lastEventAt: '2026-05-11T07:00:00.000Z',
    updatedAt: '2026-05-11T07:01:00.000Z',
  })

  assert.deepEqual(patch, {
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '工作区对话已完成',
    updatedAt: '2026-05-11T07:01:00.000Z',
  })
})

test('reconcileWorkspaceSessionSnapshotFromTaskPart closes stale running workspace snapshots on completion', () => {
  const reconciled = reconcileWorkspaceSessionSnapshotFromTaskPart(
    buildWorkspaceSnapshot(),
    {
      agentRunningStatus: 'complete',
      currentStep: '工作区对话已完成',
      needsHumanConfirm: true,
    },
  )

  assert.ok(reconciled)
  assert.equal(reconciled.runtime.agentRunningStatus, 'complete')
  assert.equal(reconciled.runtime.runtimeStatus, 'completed')
  assert.equal(reconciled.runtime.currentStep, '工作区对话已完成')
  assert.equal(reconciled.runtime.needsHumanConfirm, true)
  assert.equal(isWorkspaceSessionBusy(reconciled.runtime), false)
})

test('reconcileWorkspaceSessionSnapshotFromTaskPart preserves queued runtime until execution really starts', () => {
  const reconciled = reconcileWorkspaceSessionSnapshotFromTaskPart(
    buildWorkspaceSnapshot({
      agentRunningStatus: 'thinking',
      runtimeStatus: 'queued',
      currentStep: '执行节点执行队列已满，当前会话正在排队，等待空闲槽位后自动开始。',
    }),
    {
      agentRunningStatus: 'thinking',
      currentStep: '执行节点执行队列已满，当前会话正在排队，等待空闲槽位后自动开始。',
    },
  )

  assert.ok(reconciled)
  assert.equal(reconciled.runtime.runtimeStatus, 'queued')
})

test('reconcileWorkspaceSessionSnapshotFromTaskPart reopens a completed workspace snapshot for a new pending turn', () => {
  const reconciled = reconcileWorkspaceSessionSnapshotFromTaskPart(
    buildWorkspaceSnapshot({
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      currentStep: '已完成',
    }),
    {
      agentRunningStatus: 'thinking',
      currentStep: '正在提交消息',
      needsHumanConfirm: false,
    },
  )

  assert.ok(reconciled)
  assert.equal(reconciled.runtime.agentRunningStatus, 'thinking')
  assert.equal(reconciled.runtime.runtimeStatus, 'running')
  assert.equal(reconciled.runtime.currentStep, '正在提交消息')
  assert.equal(isWorkspaceSessionBusy(reconciled.runtime), true)
})

test('reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart advances runtime sequence for a new local turn', () => {
  const reconciled = reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart(
    buildWorkspaceSnapshot({
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      currentStep: '已完成',
      runtimeSequence: 8,
    }),
    {
      agentRunningStatus: 'thinking',
      currentStep: '正在提交消息',
      needsHumanConfirm: false,
    },
  )

  assert.ok(reconciled)
  assert.equal(reconciled.runtime.agentRunningStatus, 'thinking')
  assert.equal(reconciled.runtime.runtimeStatus, 'running')
  assert.equal(reconciled.runtime.runtimeSequence, 9)
})

test('restoreWorkspaceSessionSnapshotRuntime rolls back optimistic runtime while keeping queue updates', () => {
  const completedSession = buildWorkspaceSnapshot({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    currentStep: '工作区对话已完成',
    runtimeSequence: 8,
  })
  const queuedOptimisticSession = {
    ...buildWorkspaceSnapshot({
      agentRunningStatus: 'thinking',
      runtimeStatus: 'running',
      currentStep: '正在提交消息',
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

  const restored = restoreWorkspaceSessionSnapshotRuntime(queuedOptimisticSession, completedSession)

  assert.ok(restored)
  assert.equal(restored.runtime.agentRunningStatus, 'complete')
  assert.equal(restored.runtime.runtimeStatus, 'completed')
  assert.equal(restored.runtime.currentStep, '工作区对话已完成')
  assert.equal(restored.queue.status, 'queued')
  assert.deepEqual(restored.queue.items.map((item) => item.id), ['queue-1'])
})

test('upsertTimelineEvent updates a streaming assistant bubble in place', () => {
  const firstChunk: ChatTimelineEvent = {
    id: 'turn:turn-1:assistant:assistant-1:segment:0',
    ts: '2026-05-23T08:00:00.000Z',
    turnId: 'turn-1',
    seq: 2,
    kind: 'assistant_message',
    messageId: 'assistant-1:segment:0',
    text: '正在',
  }
  const secondChunk: ChatTimelineEvent = {
    ...firstChunk,
    ts: '2026-05-23T08:00:01.000Z',
    text: '正在处理',
  }

  const timeline = upsertTimelineEvent(
    upsertTimelineEvent([], firstChunk),
    secondChunk,
  )

  assert.equal(timeline.length, 1)
  assert.equal(timeline[0]?.kind, 'assistant_message')
  if (timeline[0]?.kind === 'assistant_message') {
    assert.equal(timeline[0].text, '正在处理')
  }
})
