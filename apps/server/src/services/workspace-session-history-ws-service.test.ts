import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'
import {
  clearWorkspaceSessionHistoryWsStateForTests,
  publishWorkspaceSessionHistoryEvent,
  registerWorkspaceSessionHistoryWsConnection,
  unregisterWorkspaceSessionHistoryWsConnection,
} from './workspace-session-history-ws-service'

type MockSocket = {
  OPEN: number
  readyState: number
  sent: string[]
  send: (data: string) => void
  close: () => void
}

const createSocket = (): MockSocket => ({
  OPEN: 1,
  readyState: 1,
  sent: [],
  send(data: string) {
    this.sent.push(data)
  },
  close() {
    this.readyState = 3
  },
})

test.afterEach(() => {
  clearWorkspaceSessionHistoryWsStateForTests()
})

const buildUserEvent = (sessionId: string, sessionSeq: number): WorkspaceSessionEventRecord => ({
  id: `event-${sessionSeq}`,
  sessionId,
  turnId: `turn-${sessionSeq}`,
  sessionSeq,
  turnSeq: 1,
  createdAt: `2026-05-17T00:00:${String(sessionSeq % 60).padStart(2, '0')}.000Z`,
  visibility: 'transcript',
  kind: 'user_message',
  payload: {
    messageId: `message-${sessionSeq}`,
    text: `message-${sessionSeq}`,
  },
})

test('registerWorkspaceSessionHistoryWsConnection dedupes repeated initial events in snapshot replay', () => {
  const sessionId = 'session-history-ws-dedupe-initial'
  const seedSocket = createSocket()
  const firstEvent = buildUserEvent(sessionId, 1)

  const firstSubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: seedSocket,
    initialEvents: [firstEvent],
  })
  unregisterWorkspaceSessionHistoryWsConnection(sessionId, firstSubscriberId)

  const replaySocket = createSocket()
  const replaySubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: replaySocket,
    initialEvents: [firstEvent],
  })

  const snapshotMessage = replaySocket.sent
    .map((raw) => JSON.parse(raw))
    .find((message) => message.type === 'workspace_session_history.snapshot')
  assert.ok(snapshotMessage)
  assert.equal(snapshotMessage.events.length, 1)
  assert.equal(snapshotMessage.events[0]?.id, firstEvent.id)

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, replaySubscriberId)
})

test('registerWorkspaceSessionHistoryWsConnection includes snapshot pagination metadata', () => {
  const sessionId = 'session-history-ws-page-meta'
  const socket = createSocket()
  const subscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket,
    initialEvents: [buildUserEvent(sessionId, 41), buildUserEvent(sessionId, 42)],
    initialHasMoreBefore: true,
    initialHasMoreAfter: false,
    initialTotalCount: 42,
  })

  const snapshotMessage = socket.sent
    .map((raw) => JSON.parse(raw))
    .find((message) => message.type === 'workspace_session_history.snapshot')
  assert.ok(snapshotMessage)
  assert.equal(snapshotMessage.hasMoreBefore, true)
  assert.equal(snapshotMessage.hasMoreAfter, false)
  assert.equal(snapshotMessage.totalCount, 2)

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
})

test('registerWorkspaceSessionHistoryWsConnection keeps cached pagination metadata during empty resume', () => {
  const sessionId = 'session-history-ws-empty-resume'
  const seedSocket = createSocket()
  const seedSubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: seedSocket,
    initialEvents: [buildUserEvent(sessionId, 41), buildUserEvent(sessionId, 42)],
    initialHasMoreBefore: true,
    initialTotalCount: 42,
  })
  unregisterWorkspaceSessionHistoryWsConnection(sessionId, seedSubscriberId)

  const resumeSocket = createSocket()
  const resumeSubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: resumeSocket,
    lastSessionSeq: 42,
    initialEvents: [],
    initialHasMoreBefore: false,
    initialTotalCount: 42,
  })

  const snapshotMessage = resumeSocket.sent
    .map((raw) => JSON.parse(raw))
    .find((message) => message.type === 'workspace_session_history.snapshot')
  assert.ok(snapshotMessage)
  assert.equal(snapshotMessage.hasMoreBefore, true)
  assert.equal(snapshotMessage.totalCount, 2)

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, resumeSubscriberId)
})

test('publishWorkspaceSessionHistoryEvent does not duplicate cached replay events when the same event is published twice', () => {
  const sessionId = 'session-history-ws-dedupe-publish'
  const seedSocket = createSocket()
  const event = buildUserEvent(sessionId, 2)

  const seedSubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: seedSocket,
  })
  publishWorkspaceSessionHistoryEvent(sessionId, event)
  publishWorkspaceSessionHistoryEvent(sessionId, event)
  unregisterWorkspaceSessionHistoryWsConnection(sessionId, seedSubscriberId)

  const replaySocket = createSocket()
  const replaySubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: replaySocket,
  })

  const snapshotMessage = replaySocket.sent
    .map((raw) => JSON.parse(raw))
    .find((message) => message.type === 'workspace_session_history.snapshot')
  assert.ok(snapshotMessage)
  assert.equal(snapshotMessage.events.length, 1)
  assert.equal(snapshotMessage.events[0]?.id, event.id)

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, replaySubscriberId)
})

test('registerWorkspaceSessionHistoryWsConnection clears scheduled cleanup when a session reconnects', async () => {
  const sessionId = 'session-history-ws-reconnect'
  const initialSocket = createSocket()
  const initialSubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: initialSocket,
    initialEvents: [buildUserEvent(sessionId, 1)],
  })

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, initialSubscriberId)

  await new Promise((resolve) => setTimeout(resolve, 0))

  const replaySocket = createSocket()
  const replaySubscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket: replaySocket,
  })

  const snapshotMessage = replaySocket.sent
    .map((raw) => JSON.parse(raw))
    .find((message) => message.type === 'workspace_session_history.snapshot')
  assert.ok(snapshotMessage)
  assert.equal(snapshotMessage.events.length, 1)

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, replaySubscriberId)
})

test('registerWorkspaceSessionHistoryWsConnection filters diagnostic events from transcript subscribers', () => {
  const sessionId = 'session-history-ws-transcript-filter'
  const socket = createSocket()
  const subscriberId = registerWorkspaceSessionHistoryWsConnection({
    sessionId,
    socket,
    visibility: 'transcript',
    initialEvents: [
      buildUserEvent(sessionId, 1),
      {
        id: 'event-system-2',
        sessionId,
        turnId: 'system:event-system-2',
        sessionSeq: 2,
        turnSeq: 1,
        visibility: 'diagnostic',
        kind: 'system_message',
        createdAt: '2026-05-17T00:00:02.000Z',
        payload: {
          message: '正在检查原始项目目录：/tmp/project',
        },
      },
    ],
  })

  const snapshotMessage = socket.sent
    .map((raw) => JSON.parse(raw))
    .find((message) => message.type === 'workspace_session_history.snapshot')
  assert.ok(snapshotMessage)
  assert.deepEqual(snapshotMessage.events.map((event: { id: string }) => event.id), ['event-1'])
  assert.equal(snapshotMessage.totalCount, 1)

  publishWorkspaceSessionHistoryEvent(sessionId, {
    id: 'event-system-3',
    sessionId,
    turnId: 'system:event-system-3',
    sessionSeq: 3,
    turnSeq: 1,
    visibility: 'diagnostic',
    kind: 'system_message',
    createdAt: '2026-05-17T00:00:03.000Z',
    payload: {
      message: '原始项目目录已准备：/tmp/project',
    },
  })

  const eventMessages = socket.sent
    .map((raw) => JSON.parse(raw))
    .filter((message) => message.type === 'workspace_session_history.event')
  assert.equal(eventMessages.length, 0)

  unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
})
