import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaskChatSessionKey } from '@shared/task-chat-session'

import {
  claimTaskChatQueueState,
  createEmptyStoredTaskChatQueueState,
  enqueueTaskChatQueueState,
  releaseTaskChatQueueClaimState,
  removeTaskChatQueueEntriesForWorkspaceSessionState,
  removeTaskChatQueueEntriesForWorkspaceState,
} from './task-chat-service'

const createQueueEntry = (overrides: Parameters<typeof enqueueTaskChatQueueState>[1]) => ({
  ...overrides,
})

test('enqueueTaskChatQueueState dedupes pending entries by session and dedupe key', () => {
  const first = createQueueEntry({
    id: 'queue-1',
    sessionKey: 'task-1:workspace-1:session-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    dedupeKey: 'workspace-initial:task-1:workspace-1:session-1',
    message: '修复创建工作区首条消息重复发送',
    createdAt: '2026-06-09T00:00:00.000Z',
    createdBy: 'user-1',
  })
  const duplicate = createQueueEntry({
    ...first,
    id: 'queue-2',
    createdAt: '2026-06-09T00:00:01.000Z',
  })

  const state = enqueueTaskChatQueueState(createEmptyStoredTaskChatQueueState(), first)
  const nextState = enqueueTaskChatQueueState(state, duplicate)

  assert.equal(nextState.pending.length, 1)
  assert.equal(nextState.pending[0]?.id, 'queue-1')
})

test('enqueueTaskChatQueueState dedupes against inflight entries', () => {
  const sessionKey = 'task-1:workspace-1:session-1'
  const dedupeKey = 'workspace-initial:task-1:workspace-1:session-1'
  const state = {
    pending: [],
    inflight: [{
      id: 'queue-1',
      sessionKey,
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      dedupeKey,
      message: '修复创建工作区首条消息重复发送',
      createdAt: '2026-06-09T00:00:00.000Z',
      createdBy: 'user-1',
      claimId: 'claim-1',
      claimedAt: '2026-06-09T00:00:02.000Z',
      claimedBy: 'server-drain',
    }],
  }
  const nextState = enqueueTaskChatQueueState(state, {
    id: 'queue-2',
    sessionKey,
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    dedupeKey,
    message: '修复创建工作区首条消息重复发送',
    createdAt: '2026-06-09T00:00:03.000Z',
    createdBy: 'user-1',
  })

  assert.equal(nextState.pending.length, 0)
  assert.equal(nextState.inflight.length, 1)
  assert.equal(nextState.inflight[0]?.id, 'queue-1')
})

test('workspace task run metadata survives the standard queue claim', () => {
  const entry = createQueueEntry({
    id: 'run-1',
    sessionKey: buildTaskChatSessionKey('task-1', 'workspace-1', 'session-1'),
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    taskRunId: 'run-1',
    requestedByAgentId: 'agent-1',
    sourceAgentEventId: 'event-1',
    author: {
      type: 'agent',
      id: 'agent-1',
      name: 'Research Agent',
      avatarUrl: '/avatars/research-agent.png',
    },
    message: '在工作区会话中执行',
    createdAt: '2026-07-23T00:00:00.000Z',
    createdBy: 'user-1',
  })
  const state = enqueueTaskChatQueueState(createEmptyStoredTaskChatQueueState(), entry)
  const claimed = claimTaskChatQueueState(state, {
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    queueId: 'run-1',
  })
  const claim = claimed.claim

  assert.equal(claim?.taskRunId, 'run-1')
  assert.equal(claim?.requestedByAgentId, 'agent-1')
  assert.equal(claim?.sourceAgentEventId, 'event-1')
  assert.deepEqual(claim?.author, {
    type: 'agent',
    id: 'agent-1',
    name: 'Research Agent',
    avatarUrl: '/avatars/research-agent.png',
  })
  assert.ok(claim)

  const released = releaseTaskChatQueueClaimState(claimed.state, {
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    queueId: 'run-1',
    claimId: claim.claimId,
  })
  assert.equal(released.restoredItem?.taskRunId, 'run-1')
  assert.equal(released.restoredItem?.requestedByAgentId, 'agent-1')
  assert.equal(released.restoredItem?.sourceAgentEventId, 'event-1')
  assert.deepEqual(released.restoredItem?.author, {
    type: 'agent',
    id: 'agent-1',
    name: 'Research Agent',
    avatarUrl: '/avatars/research-agent.png',
  })
})

test('releaseTaskChatQueueClaimState drops the entry after the retry budget is exhausted', () => {
  const entry = createQueueEntry({
    id: 'queue-1',
    sessionKey: buildTaskChatSessionKey('task-1', 'workspace-1', 'session-1'),
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    message: '重试超出上限后丢弃',
    createdAt: '2026-07-23T00:00:00.000Z',
    createdBy: 'user-1',
  })

  let state = enqueueTaskChatQueueState(createEmptyStoredTaskChatQueueState(), entry)

  const claimAndRelease = () => {
    const claimed = claimTaskChatQueueState(state, {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      queueId: 'queue-1',
    })
    assert.ok(claimed.claim, 'expected the queue entry to be claimable')
    const released = releaseTaskChatQueueClaimState(claimed.state, {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceSessionId: 'session-1',
      queueId: 'queue-1',
      claimId: claimed.claim.claimId,
    })
    state = released.state
    return released
  }

  const first = claimAndRelease()
  assert.equal(first.dropped, false)
  assert.equal(first.restoredItem?.retryCount, 1)
  assert.equal(state.pending.length, 1)

  const second = claimAndRelease()
  assert.equal(second.dropped, false)
  assert.equal(second.restoredItem?.retryCount, 2)
  assert.equal(state.pending.length, 1)

  const third = claimAndRelease()
  assert.equal(third.dropped, true)
  assert.equal(third.restoredItem, null)
  assert.equal(state.pending.length, 0)
  assert.equal(state.inflight.length, 0)
})

test('removeTaskChatQueueEntriesForWorkspaceSessionState clears pending and inflight entries of the session', () => {
  const sessionKey = 'task-1:workspace-1:session-1'
  const entry = createQueueEntry({
    id: 'queue-1',
    sessionKey,
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    message: '排队消息',
    createdAt: '2026-07-23T00:00:00.000Z',
    createdBy: 'user-1',
  })
  const otherEntry = createQueueEntry({
    ...entry,
    id: 'queue-2',
    workspaceSessionId: 'session-2',
    createdAt: '2026-07-23T00:00:01.000Z',
  })
  const state = enqueueTaskChatQueueState(
    enqueueTaskChatQueueState(createEmptyStoredTaskChatQueueState(), entry),
    otherEntry,
  )
  const withInflight = claimTaskChatQueueState(state, {
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    queueId: 'queue-1',
  })
  const next = removeTaskChatQueueEntriesForWorkspaceSessionState(withInflight.state, {
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
  })

  assert.equal(next.pending.length, 1)
  assert.equal(next.pending[0]?.id, 'queue-2')
  assert.equal(next.inflight.length, 0)
})

test('removeTaskChatQueueEntriesForWorkspaceState clears all entries of the workspace', () => {
  const sessionKey = 'task-1:workspace-1:session-1'
  const entry = createQueueEntry({
    id: 'queue-1',
    sessionKey,
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    message: '排队消息',
    createdAt: '2026-07-23T00:00:00.000Z',
    createdBy: 'user-1',
  })
  const otherEntry = createQueueEntry({
    ...entry,
    id: 'queue-2',
    sessionKey: 'task-1:workspace-2:session-1',
    workspaceId: 'workspace-2',
    workspaceSessionId: 'session-1',
    createdAt: '2026-07-23T00:00:01.000Z',
  })
  const state = enqueueTaskChatQueueState(
    enqueueTaskChatQueueState(createEmptyStoredTaskChatQueueState(), entry),
    otherEntry,
  )
  const next = removeTaskChatQueueEntriesForWorkspaceState(state, { workspaceId: 'workspace-1' })

  assert.equal(next.pending.length, 1)
  assert.equal(next.pending[0]?.id, 'queue-2')
})
