/**
 * [INPUT]: Authenticated Inbox SSE（SSE） + conversation WS（群聊/任务会话）+ main-chat WS（主对话）。
 * [OUTPUT]: 统一实时事件流：连接生命周期、断线重连（指数退避）、按 topic 订阅/退订、事件去重。
 * [POS]: 前端统一实时客户端（feature P1）。协议保持现状（WS/SSE 不合并），连接管理收敛到单例；
 *        消费方通过 subscribe* 拿到 unsubscribe，通过 on/off 订阅统一事件流（通知矩阵用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { InboxItem } from '@shared/inbox'
import { authFetch } from '../api/client'
import { resolveApiUrl, resolveApiWebSocketUrl } from '../runtime-config'
import { parseInboxStreamEvent, splitInboxStreamBuffer } from '../inbox-stream'

/** 群聊/任务会话 WS 增量事件（/api/conversations/:id/ws）。 */
export interface ConversationWsEvent {
  id: string
  conversationId: string
  seq: number
  type: 'message.created' | 'message.reaction.changed' | 'message.deleted'
  payload: Record<string, unknown>
  createdAt: string
}

/** 主对话 WS 增量事件（/api/ai/sessions/:id/ws）。 */
export interface MainChatWsEvent {
  id: string
  threadId: string
  seq: number
  type: 'delta' | 'reasoning' | 'tool' | 'status' | 'message_saved'
  payload: Record<string, unknown>
  createdAt: string
}

/** 统一事件流。通知矩阵（notifier）订阅其中 inbox/conversation 事件；UI 消费方走 subscribe* 回调。 */
export type RealtimeEvent =
  | { type: 'inbox.connected'; connected: boolean }
  | { type: 'inbox.item.created'; item: InboxItem; unreadGroups?: number }
  | { type: 'inbox.event'; event: string }
  | { type: 'conversation.event'; conversationId: string; event: ConversationWsEvent }
  | { type: 'conversation.subscribed'; conversationId: string; resumed: boolean }
  | { type: 'main_chat.event'; sessionId: string; event: MainChatWsEvent }
  | { type: 'main_chat.subscribed'; sessionId: string; resumed: boolean }

type RealtimeListener = (event: RealtimeEvent) => void

export interface ConversationSubscriptionHandlers {
  onEvent?: (event: ConversationWsEvent) => void
  /** 断线期间事件缓冲已过期（resumed=false）时触发 HTTP 冷加载兜底。 */
  onNeedsRefresh?: () => void
}

export interface MainChatSubscriptionHandlers {
  onEvent?: (event: MainChatWsEvent) => void
  onNeedsRefresh?: () => void
}

export interface InboxSubscriptionHandlers {
  onConnectedChange?: (connected: boolean) => void
  onItemCreated?: (item: InboxItem, unreadGroups?: number) => void
  /** 任意 inbox.* 事件（含 ping 以外的非 item 事件），消费方用于安排列表刷新。 */
  onInboxEvent?: (event: string) => void
}

/** 当前页面正在查看的会话上下文（通知矩阵「不在该会话时弹」规则用）。 */
export type RealtimeActiveView = {
  conversationId?: string
  workspaceSessionId?: string
}

const RECONNECT_BASE_DELAY_MS = 2000
const RECONNECT_MAX_DELAY_MS = 30_000
const INBOX_RECONNECT_DELAY_MS = 1500

const readAuthToken = () => {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

const isLoggedOut = () => {
  return typeof window !== 'undefined' && !localStorage.getItem('auth_token')
}

type ConversationServerMessage =
  | { type: 'conversation.snapshot'; conversationId: string; events: ConversationWsEvent[] }
  | { type: 'conversation.event'; conversationId: string; event: ConversationWsEvent }
  | { type: 'conversation.subscribed'; conversationId: string; resumed: boolean }
  | { type: 'conversation.error'; message: string }

type MainChatServerMessage =
  | { type: 'main_chat.snapshot'; threadId: string; events: MainChatWsEvent[]; hasMoreBefore: boolean; totalCount: number }
  | { type: 'main_chat.event'; threadId: string; event: MainChatWsEvent }
  | { type: 'main_chat.subscribed'; threadId: string; resumed: boolean }
  | { type: 'main_chat.error'; message: string }

type ConversationChannel = {
  refCount: number
  handlers: Set<ConversationSubscriptionHandlers>
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connectCleanup?: () => void
  hasConnectedBefore: boolean
  reconnectAttempt: number
  lastSeq: number
}

type MainChatChannel = {
  refCount: number
  handlers: Set<MainChatSubscriptionHandlers>
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connectCleanup?: () => void
  hasConnectedBefore: boolean
  reconnectAttempt: number
  lastSeq: number
}

type InboxChannel = {
  refCount: number
  handlers: Set<InboxSubscriptionHandlers>
  controller: AbortController | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connectCleanup?: () => void
  connected: boolean
}

export class RealtimeClient {
  private readonly listeners = new Set<RealtimeListener>()
  private readonly inboxChannel: InboxChannel = {
    refCount: 0,
    handlers: new Set(),
    controller: null,
    reconnectTimer: null,
    connected: false,
  }
  private readonly conversationChannels = new Map<string, ConversationChannel>()
  private readonly mainChatChannels = new Map<string, MainChatChannel>()
  private activeView: RealtimeActiveView = {}

  on(listener: RealtimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: RealtimeEvent) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // 单个监听器异常不打断事件分发。
      }
    }
  }

  /** 通知矩阵「不在该会话时弹」规则：页面当前正在查看的会话。 */
  setActiveView(view: RealtimeActiveView) {
    this.activeView = view
  }

  getActiveView(): RealtimeActiveView {
    return this.activeView
  }

  // ---- Inbox SSE ----

  subscribeInbox(handlers: InboxSubscriptionHandlers): () => void {
    const channel = this.inboxChannel
    channel.handlers.add(handlers)
    channel.refCount += 1
    if (channel.refCount === 1) {
      this.connectInbox()
    }

    return () => {
      channel.handlers.delete(handlers)
      channel.refCount -= 1
      if (channel.refCount === 0) {
        this.disconnectInbox()
      }
    }
  }

  private connectInbox() {
    const channel = this.inboxChannel
    let cancelled = false
    const controller = new AbortController()
    channel.controller = controller

    const emitConnected = (connected: boolean) => {
      if (channel.connected === connected) {
        return
      }
      channel.connected = connected
      this.emit({ type: 'inbox.connected', connected })
      for (const handler of channel.handlers) {
        handler.onConnectedChange?.(connected)
      }
    }

    const handleRawEvent = (rawEvent: string) => {
      const parsed = parseInboxStreamEvent(rawEvent)
      if (!parsed || parsed.event === 'ping') {
        return
      }
      const payload = readInboxStreamPayload(parsed.data)
      if (parsed.event === 'inbox.item.created' && payload.item) {
        const item = payload.item
        this.emit({ type: 'inbox.item.created', item, unreadGroups: payload.unreadGroups })
        for (const handler of channel.handlers) {
          handler.onItemCreated?.(item, payload.unreadGroups)
        }
        return
      }
      this.emit({ type: 'inbox.event', event: parsed.event })
      for (const handler of channel.handlers) {
        handler.onInboxEvent?.(parsed.event)
      }
    }

    const connect = async () => {
      if (channel.refCount <= 0) {
        return
      }
      try {
        const response = await authFetch(resolveApiUrl('/api/inbox/stream'), { signal: controller.signal })
        if (!response.ok || !response.body) {
          throw new Error(`Inbox stream failed: ${response.status}`)
        }
        emitConnected(true)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          buffer += decoder.decode(value, { stream: true })
          const split = splitInboxStreamBuffer(buffer)
          buffer = split.remainder
          split.events.forEach(handleRawEvent)
        }
      } catch {
        // 网络/鉴权失败：走统一重连；provider 主动关闭（unsubscribe）时不重连。
      } finally {
        emitConnected(false)
      }
      if (!cancelled && channel.refCount > 0) {
        channel.reconnectTimer = setTimeout(() => void connect(), INBOX_RECONNECT_DELAY_MS)
      }
    }

    void connect()

    channel.connectCleanup = () => {
      cancelled = true
      controller.abort()
    }
  }

  private disconnectInbox() {
    const channel = this.inboxChannel
    if (channel.reconnectTimer !== null) {
      clearTimeout(channel.reconnectTimer)
      channel.reconnectTimer = null
    }
    channel.connectCleanup?.()
    channel.connectCleanup = undefined
    channel.controller = null
    channel.connected = false
    channel.handlers.clear()
    this.emit({ type: 'inbox.connected', connected: false })
  }

  // ---- Conversation WS ----

  subscribeConversation(conversationId: string, handlers: ConversationSubscriptionHandlers): () => void {
    let channel = this.conversationChannels.get(conversationId)
    if (!channel) {
      channel = {
        refCount: 0,
        handlers: new Set(),
        ws: null,
        reconnectTimer: null,
        hasConnectedBefore: false,
        reconnectAttempt: 0,
        lastSeq: 0,
      }
      this.conversationChannels.set(conversationId, channel)
    }
    channel.handlers.add(handlers)
    channel.refCount += 1
    if (channel.refCount === 1) {
      this.connectConversation(conversationId, channel)
    }

    return () => {
      channel!.handlers.delete(handlers)
      channel!.refCount -= 1
      if (channel!.refCount === 0) {
        this.disconnectConversation(conversationId)
      }
    }
  }

  private connectConversation(conversationId: string, channel: ConversationChannel) {
    let cancelled = false

    const connect = () => {
      if (cancelled || channel.refCount <= 0) {
        return
      }

      const token = readAuthToken()
      if (!token) {
        return
      }

      const isReconnect = channel.hasConnectedBefore
      channel.hasConnectedBefore = true

      const baseUrl = resolveApiWebSocketUrl(`/api/conversations/${conversationId}/ws`)
      const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : undefined)
      url.searchParams.set('token', token)
      if (channel.lastSeq > 0) {
        url.searchParams.set('lastSeq', String(channel.lastSeq))
      }

      const socket = new WebSocket(url.toString())
      channel.ws = socket

      socket.onopen = () => {
        channel.reconnectAttempt = 0
      }

      socket.onmessage = (event) => {
        if (cancelled) {
          return
        }

        const raw = String(event.data ?? '').trim()
        if (!raw || raw === 'pong') {
          return
        }

        try {
          const message = JSON.parse(raw) as ConversationServerMessage
          if (message.type === 'conversation.event') {
            const seq = message.event.seq
            if (typeof seq === 'number' && seq > channel.lastSeq) {
              channel.lastSeq = seq
            }
            this.emit({ type: 'conversation.event', conversationId, event: message.event })
            for (const handler of channel.handlers) {
              handler.onEvent?.(message.event)
            }
          } else if (message.type === 'conversation.subscribed') {
            this.emit({ type: 'conversation.subscribed', conversationId, resumed: message.resumed })
            if (!message.resumed && isReconnect) {
              for (const handler of channel.handlers) {
                handler.onNeedsRefresh?.()
              }
            }
          }
        } catch {
          // ignore malformed frames
        }
      }

      socket.onclose = () => {
        if (cancelled) {
          return
        }
        channel.ws = null

        if (isLoggedOut()) {
          return
        }

        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** channel.reconnectAttempt, RECONNECT_MAX_DELAY_MS)
        channel.reconnectAttempt += 1
        channel.reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    channel.connectCleanup = () => {
      cancelled = true
      if (channel.reconnectTimer) {
        clearTimeout(channel.reconnectTimer)
        channel.reconnectTimer = null
      }
      channel.ws?.close()
      channel.ws = null
    }
  }

  private disconnectConversation(conversationId: string) {
    const channel = this.conversationChannels.get(conversationId)
    if (!channel) {
      return
    }
    channel.connectCleanup?.()
    channel.connectCleanup = undefined
    channel.handlers.clear()
    this.conversationChannels.delete(conversationId)
  }

  // ---- Main chat WS ----

  subscribeMainChat(sessionId: string, handlers: MainChatSubscriptionHandlers): () => void {
    let channel = this.mainChatChannels.get(sessionId)
    if (!channel) {
      channel = {
        refCount: 0,
        handlers: new Set(),
        ws: null,
        reconnectTimer: null,
        hasConnectedBefore: false,
        reconnectAttempt: 0,
        lastSeq: 0,
      }
      this.mainChatChannels.set(sessionId, channel)
    }
    channel.handlers.add(handlers)
    channel.refCount += 1
    if (channel.refCount === 1) {
      this.connectMainChat(sessionId, channel)
    }

    return () => {
      channel!.handlers.delete(handlers)
      channel!.refCount -= 1
      if (channel!.refCount === 0) {
        this.disconnectMainChat(sessionId)
      }
    }
  }

  private connectMainChat(sessionId: string, channel: MainChatChannel) {
    let cancelled = false

    const connect = () => {
      if (cancelled || channel.refCount <= 0) {
        return
      }

      const token = readAuthToken()
      if (!token) {
        return
      }

      const isReconnect = channel.hasConnectedBefore
      channel.hasConnectedBefore = true

      const baseUrl = resolveApiWebSocketUrl(`/api/ai/sessions/${sessionId}/ws`)
      const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : undefined)
      url.searchParams.set('token', token)
      if (channel.lastSeq > 0) {
        url.searchParams.set('lastSeq', String(channel.lastSeq))
      }

      const socket = new WebSocket(url.toString())
      channel.ws = socket

      socket.onopen = () => {
        channel.reconnectAttempt = 0
      }

      socket.onmessage = (event) => {
        if (cancelled) {
          return
        }

        const raw = String(event.data ?? '').trim()
        if (!raw || raw === 'pong') {
          return
        }

        try {
          const message = JSON.parse(raw) as MainChatServerMessage
          if (message.type === 'main_chat.event') {
            const seq = message.event.seq
            if (typeof seq === 'number' && seq > channel.lastSeq) {
              channel.lastSeq = seq
            }
            this.emit({ type: 'main_chat.event', sessionId, event: message.event })
            for (const handler of channel.handlers) {
              handler.onEvent?.(message.event)
            }
          } else if (message.type === 'main_chat.subscribed') {
            this.emit({ type: 'main_chat.subscribed', sessionId, resumed: message.resumed })
            if (!message.resumed && isReconnect) {
              for (const handler of channel.handlers) {
                handler.onNeedsRefresh?.()
              }
            }
          }
        } catch {
          // ignore malformed frames
        }
      }

      socket.onclose = () => {
        if (cancelled) {
          return
        }
        channel.ws = null

        if (isLoggedOut()) {
          return
        }

        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** channel.reconnectAttempt, RECONNECT_MAX_DELAY_MS)
        channel.reconnectAttempt += 1
        channel.reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()

    channel.connectCleanup = () => {
      cancelled = true
      if (channel.reconnectTimer) {
        clearTimeout(channel.reconnectTimer)
        channel.reconnectTimer = null
      }
      channel.ws?.close()
      channel.ws = null
    }
  }

  private disconnectMainChat(sessionId: string) {
    const channel = this.mainChatChannels.get(sessionId)
    if (!channel) {
      return
    }
    channel.connectCleanup?.()
    channel.connectCleanup = undefined
    channel.handlers.clear()
    this.mainChatChannels.delete(sessionId)
  }
}

const readInboxStreamPayload = (value: unknown): { item?: InboxItem; unreadGroups?: number } => {
  if (!value || typeof value !== 'object') return {}
  const payload = value as { item?: unknown; unreadGroups?: unknown }
  return {
    item: payload.item && typeof payload.item === 'object' ? payload.item as InboxItem : undefined,
    unreadGroups: typeof payload.unreadGroups === 'number' ? payload.unreadGroups : undefined,
  }
}

export const realtimeClient = new RealtimeClient()
