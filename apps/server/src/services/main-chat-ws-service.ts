/**
 * [INPUT]: Main chat thread events from streamMainChatResponse and other producers.
 * [OUTPUT]: Per-thread incremental WebSocket subscription with seq-based cursor replay.
 * [POS]: Main chat real-time delivery boundary; mirrors workspace-session-history-ws-service pattern.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { ChatMessage } from '@shared/types'
import { publishRealtimeEvent } from '../storage/postgres/realtime-event-store'

export type MainChatWsSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

export type MainChatWsEventType = 'delta' | 'reasoning' | 'tool' | 'status' | 'message_saved'

export interface MainChatWsEvent {
  id: string
  threadId: string
  seq: number
  type: MainChatWsEventType
  payload: Record<string, unknown>
  createdAt: string
}

export type MainChatWsServerMessage =
  | { type: 'main_chat.snapshot'; threadId: string; events: MainChatWsEvent[]; hasMoreBefore: boolean; totalCount: number }
  | { type: 'main_chat.event'; threadId: string; event: MainChatWsEvent }
  | { type: 'main_chat.subscribed'; threadId: string; resumed: boolean }
  | { type: 'main_chat.error'; message: string }

type Subscriber = {
  id: string
  threadId: string
  socket: MainChatWsSocket
}

type ThreadState = {
  events: MainChatWsEvent[]
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const subscribers = new Map<string, Map<string, Subscriber>>()
const threadStates = new Map<string, ThreadState>()
const REPLAY_LIMIT = 400
const THREAD_STATE_RETENTION_MS = 30_000
let globalSeq = 0

const isSocketOpen = (socket: MainChatWsSocket | null | undefined) => {
  if (!socket) {
    return false
  }
  return socket.readyState === 1 || socket.readyState === socket.OPEN
}

const getThreadState = (threadId: string) => {
  const existing = threadStates.get(threadId)
  if (existing) {
    return existing
  }
  const nextState: ThreadState = {
    events: [],
    cleanupTimer: null,
  }
  threadStates.set(threadId, nextState)
  return nextState
}

const clearThreadStateCleanupTimer = (state: ThreadState) => {
  if (!state.cleanupTimer) {
    return
  }
  clearTimeout(state.cleanupTimer)
  state.cleanupTimer = null
}

const scheduleThreadStateCleanup = (threadId: string, state: ThreadState) => {
  clearThreadStateCleanupTimer(state)
  const timer = setTimeout(() => {
    const scopedSubscribers = subscribers.get(threadId)
    if (scopedSubscribers && scopedSubscribers.size > 0) {
      state.cleanupTimer = null
      return
    }
    threadStates.delete(threadId)
  }, THREAD_STATE_RETENTION_MS)
  timer.unref?.()
  state.cleanupTimer = timer
}

const mergeThreadStateEvents = (
  currentEvents: MainChatWsEvent[],
  incomingEvents: MainChatWsEvent[],
) => {
  if (incomingEvents.length === 0) {
    return currentEvents
  }

  const dedupedEvents = new Map<string, MainChatWsEvent>()
  for (const event of [...currentEvents, ...incomingEvents]) {
    dedupedEvents.set(event.id, event)
  }

  return [...dedupedEvents.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-REPLAY_LIMIT)
}

const getReplayEvents = (threadId: string, lastSeq?: number) => {
  const state = threadStates.get(threadId)
  if (!state) {
    return { events: [] as MainChatWsEvent[], resumed: false }
  }
  if (typeof lastSeq !== 'number') {
    return { events: state.events, resumed: false }
  }

  const nextEvents = state.events.filter((event) => event.seq > lastSeq)
  return {
    events: nextEvents,
    resumed: nextEvents.length > 0,
  }
}

export const sendMainChatWsMessage = (
  socket: MainChatWsSocket,
  message: MainChatWsServerMessage,
) => {
  socket.send(JSON.stringify(message))
}

export const registerMainChatWsConnection = (params: {
  threadId: string
  socket: MainChatWsSocket
  lastSeq?: number
  initialEvents?: MainChatWsEvent[]
  initialHasMoreBefore?: boolean
  initialTotalCount?: number
}) => {
  const id = crypto.randomUUID()
  const scopedSubscribers = subscribers.get(params.threadId) ?? new Map<string, Subscriber>()
  scopedSubscribers.set(id, {
    id,
    threadId: params.threadId,
    socket: params.socket,
  })
  subscribers.set(params.threadId, scopedSubscribers)

  const state = getThreadState(params.threadId)
  clearThreadStateCleanupTimer(state)
  if (params.initialEvents?.length) {
    state.events = mergeThreadStateEvents(state.events, params.initialEvents)
  }

  const replay = getReplayEvents(params.threadId, params.lastSeq)
  if (!replay.resumed && isSocketOpen(params.socket)) {
    sendMainChatWsMessage(params.socket, {
      type: 'main_chat.snapshot',
      threadId: params.threadId,
      events: state.events,
      hasMoreBefore: params.initialHasMoreBefore ?? (state.events[0]?.seq ?? 1) > 1,
      totalCount: params.initialTotalCount ?? state.events.length,
    })
  } else {
    for (const event of replay.events) {
      if (!isSocketOpen(params.socket)) {
        break
      }
      sendMainChatWsMessage(params.socket, {
        type: 'main_chat.event',
        threadId: params.threadId,
        event,
      })
    }
  }

  if (isSocketOpen(params.socket)) {
    sendMainChatWsMessage(params.socket, {
      type: 'main_chat.subscribed',
      threadId: params.threadId,
      resumed: replay.resumed,
    })
  }

  return id
}

export const unregisterMainChatWsConnection = (threadId: string, subscriberId: string) => {
  const scopedSubscribers = subscribers.get(threadId)
  if (!scopedSubscribers) {
    return
  }
  scopedSubscribers.delete(subscriberId)
  if (scopedSubscribers.size === 0) {
    subscribers.delete(threadId)
    const state = threadStates.get(threadId)
    if (state) {
      scheduleThreadStateCleanup(threadId, state)
    }
  }
}

export const publishMainChatEvent = (
  threadId: string,
  eventType: MainChatWsEventType,
  payload: Record<string, unknown>,
) => {
  const seq = ++globalSeq
  const event: MainChatWsEvent = {
    id: crypto.randomUUID(),
    threadId,
    seq,
    type: eventType,
    payload,
    createdAt: new Date().toISOString(),
  }

  const state = getThreadState(threadId)
  state.events = mergeThreadStateEvents(state.events, [event])
  threadStates.set(threadId, state)

  void publishRealtimeEvent({
    topic: 'main-chat.event',
    eventKey: `main-chat:event:${event.id}`,
    payload: { threadId, event },
  }).catch((error) => {
    console.error('[main-chat-ws] failed to persist realtime event', error)
  })

  const scopedSubscribers = subscribers.get(threadId)
  if (!scopedSubscribers) {
    return
  }

  for (const [subscriberId, subscriber] of scopedSubscribers.entries()) {
    if (!isSocketOpen(subscriber.socket)) {
      unregisterMainChatWsConnection(threadId, subscriberId)
      continue
    }
    try {
      sendMainChatWsMessage(subscriber.socket, {
        type: 'main_chat.event',
        threadId,
        event,
      })
    } catch {
      unregisterMainChatWsConnection(threadId, subscriberId)
    }
  }
}

export const clearMainChatWsStateForTests = () => {
  for (const state of threadStates.values()) {
    clearThreadStateCleanupTimer(state)
  }
  subscribers.clear()
  threadStates.clear()
  globalSeq = 0
}
