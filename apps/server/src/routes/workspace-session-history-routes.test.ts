import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkspaceSessionDeleteTurnHttpResult } from './workspace-session-history-routes'

test('resolveWorkspaceSessionDeleteTurnHttpResult maps successful delete to deleted payload', () => {
  const response = resolveWorkspaceSessionDeleteTurnHttpResult({
    ok: true,
    event: {
      id: 'event-1',
      sessionId: 'workspace-session-1',
      turnId: 'turn-1',
      sessionSeq: 4,
      turnSeq: 2,
      createdAt: '2026-05-17T00:00:04.000Z',
      visibility: 'hidden',
      kind: 'turn_deleted',
      payload: {
        deletedTurnId: 'turn-1',
        deletedMessageId: 'message-1',
      },
    },
    runtime: {
      sessionId: 'workspace-session-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      agentRunningStatus: 'idle',
      runtimeStatus: 'idle',
      currentStep: '',
      queueStatus: 'idle',
      activeToolCalls: [],
      lastEventSeq: 4,
      lastEventAt: '2026-05-17T00:00:04.000Z',
      updatedAt: '2026-05-17T00:00:04.000Z',
    },
  })

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      status: 'deleted',
      event: {
        id: 'event-1',
        sessionId: 'workspace-session-1',
        turnId: 'turn-1',
        sessionSeq: 4,
        turnSeq: 2,
        createdAt: '2026-05-17T00:00:04.000Z',
        visibility: 'hidden',
        kind: 'turn_deleted',
        payload: {
          deletedTurnId: 'turn-1',
          deletedMessageId: 'message-1',
        },
      },
      runtime: {
        sessionId: 'workspace-session-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        agentRunningStatus: 'idle',
        runtimeStatus: 'idle',
        currentStep: '',
        queueStatus: 'idle',
        activeToolCalls: [],
        lastEventSeq: 4,
        lastEventAt: '2026-05-17T00:00:04.000Z',
        updatedAt: '2026-05-17T00:00:04.000Z',
      },
    },
  })
})

test('resolveWorkspaceSessionDeleteTurnHttpResult maps already deleted turns to noop', () => {
  const response = resolveWorkspaceSessionDeleteTurnHttpResult({
    ok: false,
    reason: 'already_deleted',
  })

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      status: 'noop',
    },
  })
})

test('resolveWorkspaceSessionDeleteTurnHttpResult maps not latest and answered turns to clear 409 messages', () => {
  assert.deepEqual(
    resolveWorkspaceSessionDeleteTurnHttpResult({
      ok: false,
      reason: 'not_latest',
    }),
    {
      status: 409,
      body: {
        message: '当前仅支持删除最新一轮尚未继续展开的用户消息。',
      },
    },
  )

  assert.deepEqual(
    resolveWorkspaceSessionDeleteTurnHttpResult({
      ok: false,
      reason: 'has_assistant_output',
    }),
    {
      status: 409,
      body: {
        message: '这一轮已经产生回复或工具输出，暂不支持直接删除。',
      },
    },
  )
})

test('resolveWorkspaceSessionDeleteTurnHttpResult maps missing turns to 404', () => {
  const response = resolveWorkspaceSessionDeleteTurnHttpResult({
    ok: false,
    reason: 'not_found',
  })

  assert.deepEqual(response, {
    status: 404,
    body: {
      message: '目标工作区回合不存在。',
    },
  })
})
