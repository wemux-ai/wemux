import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentEventInboxItem, checkInboxLoopGuard } from './agent-event-inbox'
import { selectRunnableAgentEvents } from './agent-event-runtime'
import type { AgentTask } from '../repositories/agent'

test('assignment maps to a waking directive scoped to the task', () => {
  const item = buildAgentEventInboxItem({
    agentId: 'agent-1',
    actorName: 'Alice',
    event: {
      type: 'task.assigned',
      targetAgentId: 'agent-1',
      actor: { type: 'user', id: 'user-1' },
      scope: { projectId: 'project-1', taskId: 'task-1' },
      payload: { title: '更新 README', description: '更新安装步骤' },
      conversationKey: 'task:task-1',
      idempotencyKey: 'assignment-1',
    },
    itemId: 'item-1',
  })

  assert.equal(item.kind, 'directive')
  assert.equal(item.reason, 'assigned')
  assert.equal(item.groupKey, 'task:task-1')
  assert.equal(item.actor.name, 'Alice')
  assert.deepEqual(item.replyTo, { kind: 'task_comment', taskId: 'task-1' })
  assert.equal(item.traceId, 'item-1')
})

test('workspace completion maps to a handoff', () => {
  const item = buildAgentEventInboxItem({
    agentId: 'agent-1',
    event: {
      type: 'workspace.session.completed',
      actor: { type: 'system' },
      scope: { taskId: 'task-1', workspaceId: 'workspace-1', workspaceSessionId: 'session-1' },
      payload: { title: '工作区完成' },
    },
  })
  assert.equal(item.kind, 'handoff')
  assert.equal(item.reason, 'workspace_completed')
})

test('causal metadata propagates through A2A', () => {
  const item = buildAgentEventInboxItem({
    agentId: 'agent-2',
    event: {
      type: 'agent.handoff.requested',
      actor: { type: 'agent', id: 'agent-1' },
      payload: { request: '复核测试结果' },
      sourceInboxItemId: 'source-1',
      traceId: 'trace-1',
      chainStartedAt: '2026-07-27T00:00:00.000Z',
      hopCount: 3,
      replyTo: { kind: 'inbox_item', itemId: 'source-1' },
    },
  })
  assert.equal(item.sourceInboxItemId, 'source-1')
  assert.equal(item.traceId, 'trace-1')
  assert.equal(item.hopCount, 3)
  assert.deepEqual(item.replyTo, { kind: 'inbox_item', itemId: 'source-1' })
})

test('scheduler serializes a thread, allows cross-thread work, and caps each Agent at three', () => {
  const task = (id: string, agentId: string, conversationKey: string): AgentTask => ({
    id,
    agentId,
    type: 'task.assigned',
    payload: {
      kind: 'agent_event',
      actor: { type: 'system' },
      scope: {},
      payload: {},
      conversationKey,
      attempt: 1,
      retrySource: 'initial',
      autoRetryCount: 0,
    },
    status: 'pending',
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-07-27T00:00:00.000Z',
  })
  const selected = selectRunnableAgentEvents([
    task('a1', 'agent-a', 'task:1'),
    task('a1-duplicate', 'agent-a', 'task:1'),
    task('a2', 'agent-a', 'task:2'),
    task('a3', 'agent-a', 'task:3'),
    task('a4', 'agent-a', 'task:4'),
    task('b1', 'agent-b', 'task:1'),
  ])
  assert.deepEqual(selected.map((entry) => entry.id), ['a1', 'a2', 'a3', 'b1'])
})

test('loop guard rejects depth, fanout and stale chains', () => {
  const now = Date.parse('2026-07-27T01:00:00.000Z')
  assert.equal(checkInboxLoopGuard({ hopCount: 8, fanoutCount: 0, chainStartedAt: '2026-07-27T00:59:00.000Z', now }).ok, false)
  assert.equal(checkInboxLoopGuard({ hopCount: 0, fanoutCount: 4, chainStartedAt: '2026-07-27T00:59:00.000Z', now }).ok, false)
  assert.equal(checkInboxLoopGuard({ hopCount: 0, fanoutCount: 0, chainStartedAt: '2026-07-27T00:00:00.000Z', now }).ok, false)
  assert.equal(checkInboxLoopGuard({ hopCount: 1, fanoutCount: 1, chainStartedAt: '2026-07-27T00:59:00.000Z', now }).ok, true)
})
