// [INPUT]: WS 订阅（lastSessionSeq）
// [OUTPUT]: 事件推送
// [POS]: 会话历史 WS 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionEventVisibility,
  WorkspaceSessionRuntimeSnapshot,
} from '@shared/workspace-session-history'
import type { WorkspaceSessionHistoryWsServerMessage } from '@shared/workspace-session-history-ws'
import { publishRealtimeEvent } from '../storage/postgres/realtime-event-store'

type WorkspaceSessionHistoryWsSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

type Subscriber = {
  id: string
  sessionId: string
  socket: WorkspaceSessionHistoryWsSocket
  visibility: WorkspaceSessionEventVisibility | 'all'
}

type SessionState = {
  events: WorkspaceSessionEventRecord[]
  runtime: WorkspaceSessionRuntimeSnapshot | null
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  totalCount: number
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const subscribers = new Map<string, Map<string, Subscriber>>()
const sessionStates = new Map<string, SessionState>()
const REPLAY_LIMIT = 400
const SESSION_STATE_RETENTION_MS = 30_000

const matchesSubscriberVisibility = (
  event: WorkspaceSessionEventRecord,
  visibility: WorkspaceSessionEventVisibility | 'all',
) => visibility === 'all'
  ? true
  : event.visibility === visibility

const filterWorkspaceSessionEventsForSubscriber = (
  events: WorkspaceSessionEventRecord[],
  visibility: WorkspaceSessionEventVisibility | 'all',
) => visibility === 'all'
  ? events
  : events.filter((event) => matchesSubscriberVisibility(event, visibility))

const mergeSessionStateEvents = (
  currentEvents: WorkspaceSessionEventRecord[],
  incomingEvents: WorkspaceSessionEventRecord[],
) => {
  if (incomingEvents.length === 0) {
    return currentEvents
  }

  const dedupedEvents = new Map<string, WorkspaceSessionEventRecord>()
  for (const event of [...currentEvents, ...incomingEvents]) {
    dedupedEvents.set(event.id, event)
  }

  return [...dedupedEvents.values()]
    .sort((left, right) => left.sessionSeq - right.sessionSeq)
    .slice(-REPLAY_LIMIT)
}

const isSocketOpen = (socket: WorkspaceSessionHistoryWsSocket | null | undefined) => {
  if (!socket) {
    return false
  }
  return socket.readyState === 1 || socket.readyState === socket.OPEN
}

export const sendWorkspaceSessionHistoryWsMessage = (
  socket: WorkspaceSessionHistoryWsSocket,
  message: WorkspaceSessionHistoryWsServerMessage,
) => {
  socket.send(JSON.stringify(message))
}

const getSessionState = (sessionId: string) => {
  const existing = sessionStates.get(sessionId)
  if (existing) {
    return existing
  }
  const nextState: SessionState = {
    events: [],
    runtime: null,
    hasMoreBefore: false,
    hasMoreAfter: false,
    totalCount: 0,
    cleanupTimer: null,
  }
  sessionStates.set(sessionId, nextState)
  return nextState
}

const clearSessionStateCleanupTimer = (state: SessionState) => {
  if (!state.cleanupTimer) {
    return
  }

  clearTimeout(state.cleanupTimer)
  state.cleanupTimer = null
}

const scheduleSessionStateCleanup = (sessionId: string, state: SessionState) => {
  clearSessionStateCleanupTimer(state)
  const timer = setTimeout(() => {
    const scopedSubscribers = subscribers.get(sessionId)
    if (scopedSubscribers && scopedSubscribers.size > 0) {
      state.cleanupTimer = null
      return
    }
    sessionStates.delete(sessionId)
  }, SESSION_STATE_RETENTION_MS)
  timer.unref?.()
  state.cleanupTimer = timer
}

const getReplayEvents = (sessionId: string, lastSessionSeq?: number) => {
  const state = sessionStates.get(sessionId)
  if (!state) {
    return { events: [] as WorkspaceSessionEventRecord[], resumed: false }
  }
  if (typeof lastSessionSeq !== 'number') {
    return { events: state.events, resumed: false }
  }

  const nextEvents = state.events.filter((event) => event.sessionSeq > lastSessionSeq)
  return {
    events: nextEvents,
    resumed: nextEvents.length > 0,
  }
}

export const registerWorkspaceSessionHistoryWsConnection = (params: {
  sessionId: string
  socket: WorkspaceSessionHistoryWsSocket
  visibility?: WorkspaceSessionEventVisibility | 'all'
  lastSessionSeq?: number
  initialRuntime?: WorkspaceSessionRuntimeSnapshot | null
  initialEvents?: WorkspaceSessionEventRecord[]
  initialHasMoreBefore?: boolean
  initialHasMoreAfter?: boolean
  initialTotalCount?: number
}) => {
  const id = crypto.randomUUID()
  const scopedSubscribers = subscribers.get(params.sessionId) ?? new Map<string, Subscriber>()
  scopedSubscribers.set(id, {
    id,
    sessionId: params.sessionId,
    socket: params.socket,
    visibility: params.visibility ?? 'transcript',
  })
  subscribers.set(params.sessionId, scopedSubscribers)

  const state = getSessionState(params.sessionId)
  clearSessionStateCleanupTimer(state)
  if (params.initialRuntime) {
    state.runtime = params.initialRuntime
  }
  if (params.initialEvents?.length) {
    state.events = mergeSessionStateEvents(state.events, params.initialEvents)
  }
  const initialPageCanDescribeSnapshot = typeof params.lastSessionSeq !== 'number' || Boolean(params.initialEvents?.length)
  state.hasMoreBefore = initialPageCanDescribeSnapshot && typeof params.initialHasMoreBefore === 'boolean'
    ? params.initialHasMoreBefore
    : state.hasMoreBefore || (state.events[0]?.sessionSeq ?? 1) > 1
  state.hasMoreAfter = params.initialHasMoreAfter ?? state.hasMoreAfter
  state.totalCount = params.initialTotalCount ?? Math.max(state.totalCount, state.events.at(-1)?.sessionSeq ?? state.events.length)

  const replay = getReplayEvents(params.sessionId, params.lastSessionSeq)
  const subscriberVisibility = params.visibility ?? 'transcript'
  const visibleSnapshotEvents = filterWorkspaceSessionEventsForSubscriber(state.events, subscriberVisibility)
  const visibleReplayEvents = filterWorkspaceSessionEventsForSubscriber(replay.events, subscriberVisibility)
  if (!replay.resumed && isSocketOpen(params.socket)) {
    console.info('[workspace-session-history][ws-service] snapshot', JSON.stringify({
      sessionId: params.sessionId,
      lastSessionSeq: params.lastSessionSeq ?? null,
      eventCount: visibleSnapshotEvents.length,
      runtimeLastEventSeq: state.runtime?.lastEventSeq ?? null,
    }))
    sendWorkspaceSessionHistoryWsMessage(params.socket, {
      type: 'workspace_session_history.snapshot',
      sessionId: params.sessionId,
      runtime: state.runtime,
      events: visibleSnapshotEvents,
      hasMoreBefore: state.hasMoreBefore,
      hasMoreAfter: state.hasMoreAfter,
      totalCount: visibleSnapshotEvents.length,
    })
  } else {
    console.info('[workspace-session-history][ws-service] replay', JSON.stringify({
      sessionId: params.sessionId,
      lastSessionSeq: params.lastSessionSeq ?? null,
      replayEventCount: visibleReplayEvents.length,
      runtimeLastEventSeq: state.runtime?.lastEventSeq ?? null,
    }))
    for (const event of visibleReplayEvents) {
      if (!isSocketOpen(params.socket)) {
        break
      }
      sendWorkspaceSessionHistoryWsMessage(params.socket, {
        type: 'workspace_session_history.event',
        sessionId: params.sessionId,
        event,
      })
    }
    if (state.runtime && isSocketOpen(params.socket)) {
      sendWorkspaceSessionHistoryWsMessage(params.socket, {
        type: 'workspace_session_history.runtime',
        sessionId: params.sessionId,
        runtime: state.runtime,
      })
    }
  }

  if (isSocketOpen(params.socket)) {
    sendWorkspaceSessionHistoryWsMessage(params.socket, {
      type: 'workspace_session_history.subscribed',
      sessionId: params.sessionId,
      resumed: replay.resumed,
    })
  }

  return id
}

export const unregisterWorkspaceSessionHistoryWsConnection = (sessionId: string, subscriberId: string) => {
  const scopedSubscribers = subscribers.get(sessionId)
  if (!scopedSubscribers) {
    return
  }
  scopedSubscribers.delete(subscriberId)
  if (scopedSubscribers.size === 0) {
    subscribers.delete(sessionId)
    const state = sessionStates.get(sessionId)
    if (state) {
      scheduleSessionStateCleanup(sessionId, state)
    }
  }
}

export const publishWorkspaceSessionHistoryEvent = (sessionId: string, event: WorkspaceSessionEventRecord) => {
  const state = getSessionState(sessionId)
  state.events = mergeSessionStateEvents(state.events, [event])
  state.hasMoreBefore = state.hasMoreBefore || (state.events[0]?.sessionSeq ?? 1) > 1
  state.hasMoreAfter = false
  state.totalCount = Math.max(state.totalCount, event.sessionSeq, state.events.length)
  sessionStates.set(sessionId, state)

  void publishRealtimeEvent({
    topic: 'workspace-history.event',
    eventKey: `workspace-history:event:${event.id}`,
    payload: { sessionId, event },
  }).catch((error) => {
    console.error('[workspace-session-history] failed to persist realtime event', error)
  })

  const scopedSubscribers = subscribers.get(sessionId)
  if (!scopedSubscribers) {
    return
  }

  for (const [subscriberId, subscriber] of scopedSubscribers.entries()) {
    if (!isSocketOpen(subscriber.socket)) {
      unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
      continue
    }
    try {
      if (!matchesSubscriberVisibility(event, subscriber.visibility)) {
        continue
      }
      sendWorkspaceSessionHistoryWsMessage(subscriber.socket, {
        type: 'workspace_session_history.event',
        sessionId,
        event,
      })
    } catch {
      unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
    }
  }

}

export const clearWorkspaceSessionHistoryWsStateForTests = () => {
  for (const state of sessionStates.values()) {
    clearSessionStateCleanupTimer(state)
  }
  subscribers.clear()
  sessionStates.clear()
}

export const publishWorkspaceSessionHistoryRuntime = (sessionId: string, runtime: WorkspaceSessionRuntimeSnapshot) => {
  const state = getSessionState(sessionId)
  state.runtime = runtime
  sessionStates.set(sessionId, state)

  void publishRealtimeEvent({
    topic: 'workspace-history.runtime',
    eventKey: `workspace-history:runtime:${sessionId}:${runtime.lastEventSeq}:${runtime.updatedAt}`,
    payload: { sessionId, runtime },
  }).catch((error) => {
    console.error('[workspace-session-history] failed to persist realtime runtime', error)
  })

  const scopedSubscribers = subscribers.get(sessionId)
  if (!scopedSubscribers) {
    return
  }

  for (const [subscriberId, subscriber] of scopedSubscribers.entries()) {
    if (!isSocketOpen(subscriber.socket)) {
      unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
      continue
    }
    try {
      sendWorkspaceSessionHistoryWsMessage(subscriber.socket, {
        type: 'workspace_session_history.runtime',
        sessionId,
        runtime,
      })
    } catch {
      unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
    }
  }

}
