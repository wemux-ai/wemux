/**
 * [INPUT]: Conversation-scoped message events from group chat producers (message append, reaction toggle, delete).
 * [OUTPUT]: Per-conversation incremental WebSocket subscription with seq-based cursor replay.
 * [POS]: Conversation real-time delivery boundary; mirrors main-chat-ws-service pattern, grouped by conversationId.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { ConversationMessageRecord } from '@shared/types'
import { getConversation } from '../storage/conversation-store'
import { publishRealtimeEvent } from '../storage/postgres/realtime-event-store'

export type ConversationWsSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

export type ConversationWsEventType = 'message.created' | 'message.reaction.changed' | 'message.deleted'

export interface ConversationWsEvent {
  id: string
  conversationId: string
  seq: number
  type: ConversationWsEventType
  payload: Record<string, unknown>
  createdAt: string
}

export type ConversationWsServerMessage =
  | { type: 'conversation.snapshot'; conversationId: string; events: ConversationWsEvent[] }
  | { type: 'conversation.event'; conversationId: string; event: ConversationWsEvent }
  | { type: 'conversation.subscribed'; conversationId: string; resumed: boolean }
  | { type: 'conversation.error'; message: string }

type Subscriber = {
  id: string
  conversationId: string
  socket: ConversationWsSocket
}

const subscribers = new Map<string, Map<string, Subscriber>>()
const conversationStates = new Map<string, { events: ConversationWsEvent[]; cleanupTimer: ReturnType<typeof setTimeout> | null }>()
const REPLAY_LIMIT = 400
const CONVERSATION_STATE_RETENTION_MS = 30_000
let globalSeq = 0

const isSocketOpen = (socket: ConversationWsSocket | null | undefined) => {
  if (!socket) {
    return false
  }
  return socket.readyState === 1 || socket.readyState === socket.OPEN
}

const getConversationState = (conversationId: string) => {
  const existing = conversationStates.get(conversationId)
  if (existing) {
    return existing
  }
  const nextState = { events: [] as ConversationWsEvent[], cleanupTimer: null as ReturnType<typeof setTimeout> | null }
  conversationStates.set(conversationId, nextState)
  return nextState
}

const clearStateCleanupTimer = (state: { cleanupTimer: ReturnType<typeof setTimeout> | null }) => {
  if (!state.cleanupTimer) {
    return
  }
  clearTimeout(state.cleanupTimer)
  state.cleanupTimer = null
}

const scheduleStateCleanup = (conversationId: string, state: { cleanupTimer: ReturnType<typeof setTimeout> | null }) => {
  clearStateCleanupTimer(state)
  const timer = setTimeout(() => {
    const scopedSubscribers = subscribers.get(conversationId)
    if (scopedSubscribers && scopedSubscribers.size > 0) {
      state.cleanupTimer = null
      return
    }
    conversationStates.delete(conversationId)
  }, CONVERSATION_STATE_RETENTION_MS)
  timer.unref?.()
  state.cleanupTimer = timer
}

const mergeConversationStateEvents = (
  currentEvents: ConversationWsEvent[],
  incomingEvents: ConversationWsEvent[],
) => {
  if (incomingEvents.length === 0) {
    return currentEvents
  }

  const dedupedEvents = new Map<string, ConversationWsEvent>()
  for (const event of [...currentEvents, ...incomingEvents]) {
    dedupedEvents.set(event.id, event)
  }

  return [...dedupedEvents.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-REPLAY_LIMIT)
}

const getReplayEvents = (conversationId: string, lastSeq?: number) => {
  const state = conversationStates.get(conversationId)
  if (!state) {
    return { events: [] as ConversationWsEvent[], resumed: false }
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

export const sendConversationWsMessage = (
  socket: ConversationWsSocket,
  message: ConversationWsServerMessage,
) => {
  socket.send(JSON.stringify(message))
}

export const registerConversationWsConnection = (params: {
  conversationId: string
  socket: ConversationWsSocket
  lastSeq?: number
  initialEvents?: ConversationWsEvent[]
}) => {
  const id = crypto.randomUUID()
  const scopedSubscribers = subscribers.get(params.conversationId) ?? new Map<string, Subscriber>()
  scopedSubscribers.set(id, {
    id,
    conversationId: params.conversationId,
    socket: params.socket,
  })
  subscribers.set(params.conversationId, scopedSubscribers)

  const state = getConversationState(params.conversationId)
  clearStateCleanupTimer(state)
  if (params.initialEvents?.length) {
    state.events = mergeConversationStateEvents(state.events, params.initialEvents)
  }

  const replay = getReplayEvents(params.conversationId, params.lastSeq)
  if (!replay.resumed && isSocketOpen(params.socket)) {
    sendConversationWsMessage(params.socket, {
      type: 'conversation.snapshot',
      conversationId: params.conversationId,
      events: state.events,
    })
  } else {
    for (const event of replay.events) {
      if (!isSocketOpen(params.socket)) {
        break
      }
      sendConversationWsMessage(params.socket, {
        type: 'conversation.event',
        conversationId: params.conversationId,
        event,
      })
    }
  }

  if (isSocketOpen(params.socket)) {
    sendConversationWsMessage(params.socket, {
      type: 'conversation.subscribed',
      conversationId: params.conversationId,
      resumed: replay.resumed,
    })
  }

  return id
}

export const unregisterConversationWsConnection = (conversationId: string, subscriberId: string) => {
  const scopedSubscribers = subscribers.get(conversationId)
  if (!scopedSubscribers) {
    return
  }
  scopedSubscribers.delete(subscriberId)
  if (scopedSubscribers.size === 0) {
    subscribers.delete(conversationId)
    const state = conversationStates.get(conversationId)
    if (state) {
      scheduleStateCleanup(conversationId, state)
    }
  }
}

export const publishConversationEvent = (
  conversationId: string,
  eventType: ConversationWsEventType,
  payload: Record<string, unknown>,
) => {
  const seq = ++globalSeq
  const event: ConversationWsEvent = {
    id: crypto.randomUUID(),
    conversationId,
    seq,
    type: eventType,
    payload,
    createdAt: new Date().toISOString(),
  }

  const state = getConversationState(conversationId)
  state.events = mergeConversationStateEvents(state.events, [event])
  conversationStates.set(conversationId, state)

  void publishRealtimeEvent({
    topic: 'conversation.event',
    eventKey: `conversation:event:${event.id}`,
    payload: { conversationId, event },
  }).catch((error) => {
    console.error('[conversation-ws] failed to persist realtime event', error)
  })

  pushConversationWsEvent(conversationId, event)
}

/**
 * 跨节点转发入口：远端节点消费 realtime_events 后调用，只推送不重新生成/publish，避免事件环。
 */
export const publishConversationWsEvent = (
  conversationId: string,
  event: ConversationWsEvent,
) => {
  const state = getConversationState(conversationId)
  state.events = mergeConversationStateEvents(state.events, [event])
  conversationStates.set(conversationId, state)
  pushConversationWsEvent(conversationId, event)
}

const pushConversationWsEvent = (
  conversationId: string,
  event: ConversationWsEvent,
) => {
  const scopedSubscribers = subscribers.get(conversationId)
  if (!scopedSubscribers) {
    return
  }

  for (const [subscriberId, subscriber] of scopedSubscribers.entries()) {
    if (!isSocketOpen(subscriber.socket)) {
      unregisterConversationWsConnection(conversationId, subscriberId)
      continue
    }
    try {
      sendConversationWsMessage(subscriber.socket, {
        type: 'conversation.event',
        conversationId,
        event,
      })
    } catch {
      unregisterConversationWsConnection(conversationId, subscriberId)
    }
  }
}

/** 事件构造 helper：消息创建。message 为群聊/任务会话落库形状。 */
export const publishConversationMessageCreated = (
  conversationId: string,
  message: ConversationMessageRecord,
) => {
  // 带上会话类型（dm / workspace / task…），前端据此区分私聊与群聊消息的通知语义。
  const conversationKind = getConversation(conversationId)?.kind ?? ''
  publishConversationEvent(conversationId, 'message.created', { message, conversationKind })
}

export const publishConversationMessageReactionChanged = (params: {
  conversationId: string
  messageId: string
  reactions: ConversationMessageRecord['reactions']
}) => {
  publishConversationEvent(params.conversationId, 'message.reaction.changed', {
    messageId: params.messageId,
    reactions: params.reactions ?? [],
  })
}

export const clearConversationWsStateForTests = () => {
  for (const state of conversationStates.values()) {
    clearStateCleanupTimer(state)
  }
  subscribers.clear()
  conversationStates.clear()
  globalSeq = 0
}
