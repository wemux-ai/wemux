import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceSessionHistoryFixture,
  type WorkspaceSessionHistoryFixture,
} from '@shared/workspace-session-history-test-fixtures'
import type {
  WorkspaceSessionRuntimeSnapshot,
  WorkspaceSessionTurnRecord,
} from '@shared/workspace-session-history'
import { toolCallHasOmittedPersistenceContent } from '@shared/tool-call-persistence'
import { clearWorkspaceSessionHistoryWsStateForTests } from '../../services/workspace-session-history-ws-service'
import { closePostgres, isPostgresConfigured, query } from './db'
import {
  getWorkspaceSessionRuntimeSnapshot,
  listWorkspaceSessionEvents,
  listWorkspaceSessionTurns,
  persistWorkspaceSessionTurnHistory,
  workspaceSessionHasPersistedHistory,
} from './workspace-session-history-store'

const testIfPostgres = isPostgresConfigured() ? test : test.skip
const createdSessionIds = new Set<string>()

const cleanupWorkspaceSessionHistory = async (sessionId: string) => {
  await query('DELETE FROM workspace_session_history_runtime WHERE session_id = $1', [sessionId])
  await query('DELETE FROM workspace_session_history_turns WHERE session_id = $1', [sessionId])
  await query('DELETE FROM workspace_session_history_events WHERE session_id = $1', [sessionId])
}

const persistWorkspaceSessionHistoryFixture = async (fixture: WorkspaceSessionHistoryFixture) => {
  const taskId = `task-${fixture.sessionId}`
  const workspaceId = `workspace-${fixture.sessionId}`
  const eventsByTurnId = new Map<string, WorkspaceSessionHistoryFixture['events']>()

  for (const event of fixture.events) {
    const scopedEvents = eventsByTurnId.get(event.turnId) ?? []
    scopedEvents.push(event)
    eventsByTurnId.set(event.turnId, scopedEvents)
  }

  for (const turn of fixture.turns) {
    const turnEvents = eventsByTurnId.get(turn.turnId) ?? []
    const lastTurnEvent = turnEvents.at(-1)
    const turnRecord: WorkspaceSessionTurnRecord = {
      id: turn.turnId,
      sessionId: fixture.sessionId,
      status: 'completed',
      startedAt: turnEvents[0]?.createdAt ?? new Date().toISOString(),
      finishedAt: lastTurnEvent?.createdAt ?? new Date().toISOString(),
      eventCount: turnEvents.length,
      usage: {
        inputTokens: turn.index * 10,
        outputTokens: turn.index * 5,
        totalTokens: turn.index * 15,
      },
    }
    const runtime: WorkspaceSessionRuntimeSnapshot = {
      sessionId: fixture.sessionId,
      taskId,
      workspaceId,
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      currentStep: `turn ${turn.index} complete`,
      queueStatus: 'idle',
      activeToolCalls: [],
      lastEventSeq: 0,
      lastEventAt: lastTurnEvent?.createdAt,
      updatedAt: lastTurnEvent?.createdAt ?? new Date().toISOString(),
    }

    await persistWorkspaceSessionTurnHistory({
      sessionId: fixture.sessionId,
      taskId,
      workspaceId,
      turn: turnRecord,
      events: turnEvents,
      runtime,
    })
  }
}

test.afterEach(async () => {
  clearWorkspaceSessionHistoryWsStateForTests()
  for (const sessionId of createdSessionIds) {
    await cleanupWorkspaceSessionHistory(sessionId)
  }
  createdSessionIds.clear()
})

test.after(async () => {
  clearWorkspaceSessionHistoryWsStateForTests()
  await closePostgres()
})

testIfPostgres('listWorkspaceSessionEvents paginates long persisted workspace history without gaps', async () => {
  const sessionId = `workspace-history-store-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId,
    turnCount: 100,
    thinkingEvery: 2,
    toolCallEvery: 3,
    statusEvery: 1,
  })
  await persistWorkspaceSessionHistoryFixture(fixture)

  assert.equal(await workspaceSessionHasPersistedHistory(sessionId), true)

  const latestPage = await listWorkspaceSessionEvents({
    sessionId,
    limit: 120,
  })
  assert.equal(latestPage.totalCount, fixture.events.length)
  assert.equal(latestPage.events.length >= 120, true)
  assert.equal(latestPage.hasMoreBefore, true)
  assert.equal(latestPage.hasMoreAfter, false)
  assert.equal(latestPage.events[0]?.sessionSeq, fixture.events.length - latestPage.events.length + 1)
  assert.equal(latestPage.events.at(-1)?.sessionSeq, fixture.events.length)

  const olderPage = await listWorkspaceSessionEvents({
    sessionId,
    beforeSessionSeq: latestPage.events[0]?.sessionSeq,
    limit: 120,
  })
  assert.equal(olderPage.events.length >= 120, true)
  assert.equal(olderPage.hasMoreBefore, true)
  assert.equal(olderPage.hasMoreAfter, true)
  assert.equal(olderPage.events.at(-1)?.sessionSeq, latestPage.events[0]!.sessionSeq - 1)

  const oldestPage = await listWorkspaceSessionEvents({
    sessionId,
    beforeSessionSeq: olderPage.events[0]?.sessionSeq,
    limit: 200,
  })
  assert.equal(oldestPage.events.length, olderPage.events[0]!.sessionSeq - 1)
  assert.equal(oldestPage.hasMoreBefore, false)
  assert.equal(oldestPage.hasMoreAfter, true)
  assert.equal(oldestPage.events[0]?.sessionSeq, 1)
  assert.equal(oldestPage.events.at(-1)?.sessionSeq, olderPage.events[0]!.sessionSeq - 1)

  const forwardPage = await listWorkspaceSessionEvents({
    sessionId,
    afterSessionSeq: olderPage.events.at(-1)?.sessionSeq,
    limit: 500,
  })
  assert.deepEqual(
    forwardPage.events.map((event) => event.id),
    latestPage.events.map((event) => event.id),
  )

  const emptyIncrementalPage = await listWorkspaceSessionEvents({
    sessionId,
    afterSessionSeq: latestPage.events.at(-1)?.sessionSeq,
    limit: 120,
  })
  assert.equal(emptyIncrementalPage.events.length, 0)
  assert.equal(emptyIncrementalPage.hasMoreAfter, false)
})

testIfPostgres('listWorkspaceSessionEvents filters diagnostic system events out of transcript pages', async () => {
  const sessionId = `workspace-history-transcript-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const taskId = `task-${sessionId}`
  const workspaceId = `workspace-${sessionId}`
  const createdAt = new Date().toISOString()

  await persistWorkspaceSessionTurnHistory({
    sessionId,
    taskId,
    workspaceId,
    turn: {
      id: 'turn-1',
      sessionId,
      status: 'completed',
      startedAt: createdAt,
      finishedAt: createdAt,
      eventCount: 2,
    } satisfies WorkspaceSessionTurnRecord,
    events: [
      {
        id: 'event-user-1',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 1,
        turnSeq: 1,
        visibility: 'transcript',
        kind: 'user_message',
        createdAt,
        payload: {
          messageId: 'message-user-1',
          text: '帮我改一下',
        },
      },
      {
        id: 'event-assistant-1',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 2,
        turnSeq: 2,
        visibility: 'transcript',
        kind: 'assistant_message',
        createdAt,
        payload: {
          messageId: 'message-assistant-1',
          text: '我来处理',
        },
      },
    ],
    runtime: {
      sessionId,
      taskId,
      workspaceId,
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      currentStep: 'done',
      queueStatus: 'idle',
      activeToolCalls: [],
      lastEventSeq: 0,
      lastEventAt: createdAt,
      updatedAt: createdAt,
    } satisfies WorkspaceSessionRuntimeSnapshot,
  })

  await query(
    `INSERT INTO workspace_session_history_events (
      id, session_id, task_id, workspace_id, turn_id, session_seq, turn_seq, kind, visibility, created_at, payload_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      'event-system-diagnostic-1',
      sessionId,
      taskId,
      workspaceId,
      'system:event-system-diagnostic-1',
      3,
      1,
      'system_message',
      'diagnostic',
      createdAt,
      JSON.stringify({ message: '正在检查原始项目目录：/tmp/project' }),
    ],
  )

  const transcriptPage = await listWorkspaceSessionEvents({
    sessionId,
    limit: 20,
    visibility: 'transcript',
  })
  const allPage = await listWorkspaceSessionEvents({
    sessionId,
    limit: 20,
    visibility: 'all',
  })

  assert.deepEqual(transcriptPage.events.map((event) => event.id), ['event-user-1', 'event-assistant-1'])
  assert.equal(transcriptPage.totalCount, 2)
  assert.deepEqual(allPage.events.map((event) => event.id), ['event-user-1', 'event-assistant-1', 'event-system-diagnostic-1'])
  assert.equal(allPage.totalCount, 3)
})

testIfPostgres('persistWorkspaceSessionTurnHistory stores long session turns and runtime snapshots consistently', async () => {
  const sessionId = `workspace-history-runtime-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId,
    turnCount: 90,
    thinkingEvery: 2,
    toolCallEvery: 3,
    statusEvery: 1,
  })
  await persistWorkspaceSessionHistoryFixture(fixture)

  const turns = await listWorkspaceSessionTurns(sessionId, 200)
  assert.equal(turns.length, fixture.turns.length)
  assert.equal(turns[0]?.id, fixture.turns.at(-1)?.turnId)
  assert.equal(turns.at(-1)?.id, fixture.turns[0]?.turnId)
  assert.deepEqual(turns[0]?.usage, {
    inputTokens: fixture.turns.length * 10,
    outputTokens: fixture.turns.length * 5,
    totalTokens: fixture.turns.length * 15,
  })
  assert.deepEqual(turns.at(-1)?.usage, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  })

  const runtime = await getWorkspaceSessionRuntimeSnapshot(sessionId)
  assert.ok(runtime)
  assert.equal(runtime?.lastEventSeq, fixture.events.length)
  assert.equal(runtime?.agentRunningStatus, 'complete')
  assert.equal(runtime?.runtimeStatus, 'completed')
  assert.equal(runtime?.queueStatus, 'idle')
})

testIfPostgres('persistWorkspaceSessionTurnHistory merges a prewritten running user turn with later assistant events', async () => {
  const sessionId = `workspace-history-merge-running-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const taskId = `task-${sessionId}`
  const workspaceId = `workspace-${sessionId}`
  const startedAt = '2026-06-18T10:00:00.000Z'
  const finishedAt = '2026-06-18T10:00:05.000Z'

  await persistWorkspaceSessionTurnHistory({
    sessionId,
    taskId,
    workspaceId,
    turn: {
      id: 'turn-1',
      sessionId,
      status: 'running',
      startedAt,
      eventCount: 1,
    },
    events: [
      {
        id: 'event-user-1',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 0,
        turnSeq: 1,
        visibility: 'transcript',
        kind: 'user_message',
        createdAt: startedAt,
        payload: {
          messageId: 'message-user-1',
          text: '现在正式跑迁移',
        },
      },
    ],
    runtime: {
      sessionId,
      taskId,
      workspaceId,
      agentRunningStatus: 'thinking',
      runtimeStatus: 'running',
      currentStep: '正在处理工作区对话',
      queueStatus: 'running',
      activeToolCalls: [],
      lastEventSeq: 0,
      lastEventAt: startedAt,
      updatedAt: startedAt,
    } satisfies WorkspaceSessionRuntimeSnapshot,
  })

  await persistWorkspaceSessionTurnHistory({
    sessionId,
    taskId,
    workspaceId,
    turn: {
      id: 'turn-1',
      sessionId,
      status: 'completed',
      startedAt,
      finishedAt,
      eventCount: 3,
    },
    events: [
      {
        id: 'event-user-1',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 0,
        turnSeq: 1,
        visibility: 'transcript',
        kind: 'user_message',
        createdAt: startedAt,
        payload: {
          messageId: 'message-user-1',
          text: '现在正式跑迁移',
        },
      },
      {
        id: 'event-status-1',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 0,
        turnSeq: 2,
        visibility: 'transcript',
        kind: 'status',
        createdAt: finishedAt,
        payload: {
          status: 'complete',
          step: '工作区对话已完成',
        },
      },
      {
        id: 'event-assistant-1',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 0,
        turnSeq: 3,
        visibility: 'transcript',
        kind: 'assistant_message',
        createdAt: finishedAt,
        payload: {
          messageId: 'message-assistant-1',
          text: '可以，继续正式迁移。',
        },
      },
    ],
    runtime: {
      sessionId,
      taskId,
      workspaceId,
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      currentStep: '工作区对话已完成',
      queueStatus: 'idle',
      activeToolCalls: [],
      lastEventSeq: 0,
      lastEventAt: finishedAt,
      updatedAt: finishedAt,
    } satisfies WorkspaceSessionRuntimeSnapshot,
  })

  const turns = await listWorkspaceSessionTurns(sessionId, 10)
  assert.equal(turns.length, 1)
  assert.equal(turns[0]?.status, 'completed')
  assert.equal(turns[0]?.eventCount, 3)

  const events = await listWorkspaceSessionEvents({ sessionId, limit: 10 })
  assert.deepEqual(events.events.map((event) => event.id), ['event-user-1', 'event-status-1', 'event-assistant-1'])
  assert.equal(events.totalCount, 3)
})

testIfPostgres('listWorkspaceSessionEvents stays gap-free across 1000-turn workspace histories', async () => {
  const sessionId = `workspace-history-gapfree-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId,
    turnCount: 1000,
    thinkingEvery: 2,
    toolCallEvery: 3,
    statusEvery: 1,
    deletedTurnIndexes: [9, 87, 144, 366, 721],
  })
  await persistWorkspaceSessionHistoryFixture(fixture)

  const transcriptEvents = fixture.events.filter((event) => event.visibility === 'transcript')
  const collectedIds: string[] = []
  let beforeSessionSeq: number | undefined
  let pageCount = 0

  while (true) {
    const page = await listWorkspaceSessionEvents({
      sessionId,
      beforeSessionSeq,
      limit: 180,
    })

    pageCount += 1
    collectedIds.unshift(...page.events.map((event) => event.id))

    if (!page.hasMoreBefore || page.events.length === 0) {
      break
    }

    beforeSessionSeq = page.events[0]?.sessionSeq
  }

  assert.equal(pageCount > 1, true)
  assert.equal(collectedIds.length, transcriptEvents.length)
  assert.deepEqual(collectedIds, transcriptEvents.map((event) => event.id))
})

testIfPostgres('listWorkspaceSessionEvents expands backward pages to include a full leading turn', async () => {
  const sessionId = `workspace-history-full-turn-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const fixture = buildWorkspaceSessionHistoryFixture({
    sessionId,
    turnCount: 6,
    thinkingEvery: 1,
    toolCallEvery: 1,
    statusEvery: 1,
  })
  await persistWorkspaceSessionHistoryFixture(fixture)

  const latestPage = await listWorkspaceSessionEvents({
    sessionId,
    limit: 5,
  })

  const leadingTurnId = latestPage.events[0]?.turnId
  assert.ok(leadingTurnId)
  const expectedLeadingTurnEvents = fixture.events.filter((event) => event.turnId === leadingTurnId)
  assert.equal(
    latestPage.events.filter((event) => event.turnId === leadingTurnId).length,
    expectedLeadingTurnEvents.length,
  )

  const olderPage = await listWorkspaceSessionEvents({
    sessionId,
    beforeSessionSeq: latestPage.events[0]?.sessionSeq,
    limit: 2,
  })
  const olderLeadingTurnId = olderPage.events[0]?.turnId
  assert.ok(olderLeadingTurnId)
  const expectedOlderLeadingTurnEvents = fixture.events.filter((event) => event.turnId === olderLeadingTurnId)
  assert.equal(
    olderPage.events.filter((event) => event.turnId === olderLeadingTurnId).length,
    expectedOlderLeadingTurnEvents.length,
  )
})

testIfPostgres('persistWorkspaceSessionTurnHistory omits tool payload bodies before history persistence', async () => {
  const sessionId = `workspace-history-tool-truncation-${crypto.randomUUID()}`
  createdSessionIds.add(sessionId)

  const taskId = `task-${sessionId}`
  const workspaceId = `workspace-${sessionId}`
  const oversized = 'x'.repeat(8_000)
  const createdAt = new Date().toISOString()

  await persistWorkspaceSessionTurnHistory({
    sessionId,
    taskId,
    workspaceId,
    turn: {
      id: 'turn-1',
      sessionId,
      status: 'completed',
      startedAt: createdAt,
      finishedAt: createdAt,
      eventCount: 3,
    } satisfies WorkspaceSessionTurnRecord,
    events: [
      {
        id: 'event-user',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 1,
        turnSeq: 1,
        visibility: 'transcript',
        kind: 'user_message',
        createdAt,
        payload: {
          messageId: 'message-user',
          text: '继续',
        },
      },
      {
        id: 'event-tool',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 2,
        turnSeq: 2,
        visibility: 'transcript',
        kind: 'tool_call',
        createdAt,
        payload: {
          toolCall: {
            id: 'tool-1',
            name: 'Read',
            args: oversized,
            result: oversized,
            startedAt: createdAt,
            finishedAt: createdAt,
          },
        },
      },
      {
        id: 'event-status',
        sessionId,
        turnId: 'turn-1',
        sessionSeq: 3,
        turnSeq: 3,
        visibility: 'transcript',
        kind: 'status',
        createdAt,
        payload: {
          status: 'complete',
          step: 'done',
        },
      },
    ],
    runtime: {
      sessionId,
      taskId,
      workspaceId,
      agentRunningStatus: 'complete',
      runtimeStatus: 'completed',
      currentStep: 'done',
      queueStatus: 'idle',
      activeToolCalls: [
        {
          id: 'tool-runtime-1',
          name: 'Read',
          args: oversized,
          result: oversized,
          startedAt: createdAt,
          finishedAt: createdAt,
        },
      ],
      lastEventSeq: 0,
      lastEventAt: createdAt,
      updatedAt: createdAt,
    } satisfies WorkspaceSessionRuntimeSnapshot,
  })

  const page = await listWorkspaceSessionEvents({ sessionId, limit: 20 })
  const toolEvent = page.events.find((event) => event.kind === 'tool_call')
  assert.ok(toolEvent)
  if (toolEvent?.kind === 'tool_call') {
    assert.equal(toolCallHasOmittedPersistenceContent(toolEvent.payload.toolCall), true)
    assert.equal(toolEvent.payload.toolCall.result, undefined)
    assert.equal(toolEvent.payload.toolCall.args?.includes('[tool_call_persistence_meta]') ?? false, true)
  }

  const runtime = await getWorkspaceSessionRuntimeSnapshot(sessionId)
  assert.ok(runtime)
  assert.equal(toolCallHasOmittedPersistenceContent(runtime?.activeToolCalls[0] ?? { args: '', result: '' }), true)
})
