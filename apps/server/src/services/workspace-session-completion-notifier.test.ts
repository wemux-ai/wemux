import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedTask, WorkspaceSession } from '@shared/types'
import {
  buildWorkspaceSessionAttentionEvent,
  buildWorkspaceTurnAttentionEvent,
  resolveWorkspaceSessionAttentionTone,
} from './workspace-session-completion-notifier'

const session = {
  id: 'session-1',
  workspaceId: 'workspace-1',
  title: 'Implementation',
  runtimeStatus: 'completed',
  runtimeSequence: 7,
  currentStep: 'Finished tests',
} as WorkspaceSession

const distributedTask = {
  id: 'distributed-1',
  originTaskId: 'task-1',
  originTaskRunId: 'run-1',
  workspaceId: 'workspace-1',
  workspaceSessionId: 'session-1',
  projectId: 'project-1',
  requestedByUserId: 'user-1',
  requestedByAgentId: 'agent-1',
  sourceAgentEventId: 'event-assigned',
  status: 'completed',
  result: {
    summary: 'Implemented the requested change.',
    filesChanged: ['src/index.ts'],
    commitShas: ['abc123'],
  },
} as DistributedTask

test('workspace completion targets the requesting Agent with exact execution references', () => {
  const event = buildWorkspaceSessionAttentionEvent({
    tone: 'complete',
    session,
    distributedTask,
  })

  assert.equal(event?.targetAgentId, 'agent-1')
  assert.equal(event?.actingUserId, 'user-1')
  assert.equal(event?.sourceAgentEventId, 'event-assigned')
  assert.deepEqual(event?.scope, {
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    distributedTaskId: 'distributed-1',
    taskRunId: 'run-1',
  })
  assert.equal(event?.idempotencyKey, 'workspace-run:distributed-1:terminal')
  assert.deepEqual(event?.payload?.filesChanged, ['src/index.ts'])
})

test('workspace terminal outcomes share one dedupe key while waits use runtime sequence', () => {
  const failed = buildWorkspaceSessionAttentionEvent({
    tone: 'error',
    session: { ...session, runtimeStatus: 'error' },
    distributedTask: { ...distributedTask, status: 'failed' },
  })
  const waiting = buildWorkspaceSessionAttentionEvent({
    tone: 'attention',
    session: { ...session, runtimeStatus: 'waiting', runtimeSequence: 8 },
    distributedTask: { ...distributedTask, status: 'executing' },
  })

  assert.equal(failed?.idempotencyKey, 'workspace-run:distributed-1:terminal')
  assert.equal(waiting?.idempotencyKey, 'workspace-run:distributed-1:waiting:8')
})

test('completed execution stays terminal when the task still needs human review', () => {
  const completedSession = {
    ...session,
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
  } as WorkspaceSession
  const tone = resolveWorkspaceSessionAttentionTone({
    session: completedSession,
    distributedTask,
  })
  const event = tone
    ? buildWorkspaceSessionAttentionEvent({
        tone,
        session: completedSession,
        distributedTask,
      })
    : null

  assert.equal(tone, 'complete')
  assert.equal(event?.type, 'workspace.session.completed')
  assert.equal(event?.idempotencyKey, 'workspace-run:distributed-1:terminal')
})

test('non-terminal confirmation still produces a waiting attention', () => {
  const waitingSession = {
    ...session,
    agentRunningStatus: 'waiting',
    runtimeStatus: 'waiting',
    runtimeSequence: 8,
    needsHumanConfirm: true,
  } as WorkspaceSession
  const executingTask = {
    ...distributedTask,
    status: 'executing',
    result: undefined,
  } as DistributedTask
  const tone = resolveWorkspaceSessionAttentionTone({
    session: waitingSession,
    distributedTask: executingTask,
  })
  const event = tone
    ? buildWorkspaceSessionAttentionEvent({
        tone,
        session: waitingSession,
        distributedTask: executingTask,
      })
    : null

  assert.equal(tone, 'attention')
  assert.equal(event?.type, 'workspace.session.waiting')
  assert.equal(event?.idempotencyKey, 'workspace-run:distributed-1:waiting:8')
})

test('manual or legacy executions do not create Agent Attention', () => {
  assert.equal(buildWorkspaceSessionAttentionEvent({
    tone: 'complete',
    session,
    distributedTask: { ...distributedTask, requestedByAgentId: undefined },
  }), null)
})

test('workspace chat runs target the requesting Agent without a distributed task scope', () => {
  const event = buildWorkspaceTurnAttentionEvent({
    tone: 'complete',
    session,
    taskRunId: 'run-2',
    requestedByUserId: 'user-1',
    requestedByAgentId: 'agent-1',
    sourceAgentEventId: 'event-2',
    taskId: 'task-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    result: {
      summary: 'Completed through workspace chat.',
      filesChanged: ['README.md'],
    },
  })

  assert.deepEqual(event?.scope, {
    projectId: 'project-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    workspaceSessionId: 'session-1',
    taskRunId: 'run-2',
  })
  assert.equal(event?.idempotencyKey, 'workspace-run:run-2:terminal')
  assert.equal('distributedTaskStatus' in (event?.payload ?? {}), false)
})
