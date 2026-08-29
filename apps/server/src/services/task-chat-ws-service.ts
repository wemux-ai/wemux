// [INPUT]: WS 连接事件
// [OUTPUT]: 会话推送
// [POS]: 任务对话 WS 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatPart } from '@shared/task-chat-part'
import type { TaskChatWsServerMessage } from '@shared/task-chat-ws'

type TaskChatWsSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

type TaskChatWsSubscriber = {
  id: string
  sessionKey: string
  socket: TaskChatWsSocket
}

type TaskChatWsEntry = {
  id: string
  sentAt: string
  part: TaskChatPart
}

type TaskChatWsSessionState = {
  nextEventId: number
  entries: TaskChatWsEntry[]
}

const subscribers = new Map<string, Map<string, TaskChatWsSubscriber>>()
const sessionStates = new Map<string, TaskChatWsSessionState>()
const TASK_CHAT_WS_REPLAY_LIMIT = 400

const isSocketOpen = (socket: TaskChatWsSocket | null | undefined) => {
  if (!socket) {
    return false
  }

  return socket.readyState === 1 || socket.readyState === socket.OPEN
}

export const sendTaskChatWsMessage = (socket: TaskChatWsSocket, message: TaskChatWsServerMessage) => {
  socket.send(JSON.stringify(message))
}

const getTaskChatWsSessionState = (sessionKey: string): TaskChatWsSessionState => {
  const existing = sessionStates.get(sessionKey)
  if (existing) {
    return existing
  }

  const nextState: TaskChatWsSessionState = {
    nextEventId: 1,
    entries: [],
  }
  sessionStates.set(sessionKey, nextState)
  return nextState
}

const appendTaskChatWsEntry = (sessionKey: string, part: TaskChatPart) => {
  const state = getTaskChatWsSessionState(sessionKey)
  const entry: TaskChatWsEntry = {
    id: String(state.nextEventId++),
    sentAt: new Date().toISOString(),
    part,
  }

  state.entries = [...state.entries, entry].slice(-TASK_CHAT_WS_REPLAY_LIMIT)
  sessionStates.set(sessionKey, state)
  return entry
}

const getReplayEntries = (sessionKey: string, lastEventId?: string) => {
  const state = sessionStates.get(sessionKey)
  if (!state || state.entries.length === 0) {
    return {
      entries: [] as TaskChatWsEntry[],
      resumed: false,
    }
  }

  if (!lastEventId) {
    return {
      entries: state.entries,
      resumed: false,
    }
  }

  const lastIndex = state.entries.findIndex((entry) => entry.id === lastEventId)
  if (lastIndex === -1) {
    return {
      entries: state.entries,
      resumed: false,
    }
  }

  return {
    entries: state.entries.slice(lastIndex + 1),
    resumed: true,
  }
}

export const unregisterTaskChatWsConnection = (sessionKey: string, subscriberId: string) => {
  const scopedSubscribers = subscribers.get(sessionKey)
  const subscriber = scopedSubscribers?.get(subscriberId)
  if (!subscriber || !scopedSubscribers) {
    return
  }

  scopedSubscribers.delete(subscriberId)
  if (scopedSubscribers.size === 0) {
    subscribers.delete(sessionKey)
  }
}

export const registerTaskChatWsConnection = (params: {
  sessionKey: string
  socket: TaskChatWsSocket
  lastEventId?: string
  initialParts?: TaskChatPart[]
}) => {
  const id = crypto.randomUUID()
  const scopedSubscribers = subscribers.get(params.sessionKey) ?? new Map<string, TaskChatWsSubscriber>()
  scopedSubscribers.set(id, {
    id,
    sessionKey: params.sessionKey,
    socket: params.socket,
  })
  subscribers.set(params.sessionKey, scopedSubscribers)

  const replay = getReplayEntries(params.sessionKey, params.lastEventId)
  if (!replay.resumed) {
    for (const part of params.initialParts ?? []) {
      if (!isSocketOpen(params.socket)) {
        break
      }

      sendTaskChatWsMessage(params.socket, {
        type: 'task_chat.snapshot',
        sessionKey: params.sessionKey,
        part,
      })
    }
  }

  for (const entry of replay.entries) {
    if (!isSocketOpen(params.socket)) {
      break
    }

    sendTaskChatWsMessage(params.socket, {
      type: 'task_chat.event',
      sessionKey: params.sessionKey,
      eventId: entry.id,
      sentAt: entry.sentAt,
      part: entry.part,
    })
  }

  if (isSocketOpen(params.socket)) {
    sendTaskChatWsMessage(params.socket, {
      type: 'task_chat.subscribed',
      sessionKey: params.sessionKey,
      resumed: replay.resumed,
    })
  }

  return id
}

export const publishTaskChatWsPart = (sessionKey: string, part: TaskChatPart) => {
  const entry = appendTaskChatWsEntry(sessionKey, part)
  const scopedSubscribers = subscribers.get(sessionKey)
  if (!scopedSubscribers) {
    return
  }

  for (const [subscriberId, subscriber] of scopedSubscribers.entries()) {
    if (!isSocketOpen(subscriber.socket)) {
      unregisterTaskChatWsConnection(sessionKey, subscriberId)
      continue
    }

    try {
      sendTaskChatWsMessage(subscriber.socket, {
        type: 'task_chat.event',
        sessionKey,
        eventId: entry.id,
        sentAt: entry.sentAt,
        part: entry.part,
      })
    } catch {
      unregisterTaskChatWsConnection(sessionKey, subscriberId)
    }
  }
}
