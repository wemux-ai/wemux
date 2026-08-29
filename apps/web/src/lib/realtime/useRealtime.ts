/**
 * [INPUT]: realtime-client 单例 + 页面订阅意图。
 * [OUTPUT]: React 薄封装：useRealtimeConversation / useRealtimeMainChat / useRealtimeInbox / useRealtimeEvents / useRealtimeActiveView。
 * [POS]: 统一实时客户端的 React 接入层；消费方只描述「要订阅什么」，连接生命周期归 realtime-client。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useRef } from 'react'
import {
  realtimeClient,
  type ConversationSubscriptionHandlers,
  type InboxSubscriptionHandlers,
  type MainChatSubscriptionHandlers,
  type RealtimeActiveView,
  type RealtimeEvent,
} from './realtime-client'

export { realtimeClient }
export type {
  ConversationWsEvent,
  MainChatWsEvent,
  RealtimeActiveView,
  RealtimeEvent,
} from './realtime-client'

/** 群聊/任务会话 WS 订阅（对齐原 use-conversation-ws-sync：handlers 引用稳定，identity 变化不重连）。 */
export function useRealtimeConversation(
  conversationId: string | undefined,
  handlers: ConversationSubscriptionHandlers,
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!conversationId) {
      return
    }

    return realtimeClient.subscribeConversation(conversationId, {
      onEvent: (event) => handlersRef.current.onEvent?.(event),
      onNeedsRefresh: () => handlersRef.current.onNeedsRefresh?.(),
    })
  }, [conversationId])
}

/** 主对话 WS 订阅（对齐原 use-main-chat-ws-sync）。 */
export function useRealtimeMainChat(
  sessionId: string | undefined,
  handlers: MainChatSubscriptionHandlers,
) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!sessionId) {
      return
    }

    return realtimeClient.subscribeMainChat(sessionId, {
      onEvent: (event) => handlersRef.current.onEvent?.(event),
      onNeedsRefresh: () => handlersRef.current.onNeedsRefresh?.(),
    })
  }, [sessionId])
}

/** 收件箱 SSE 订阅（InboxProvider 等全局消费方）。 */
export function useRealtimeInbox(handlers: InboxSubscriptionHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    return realtimeClient.subscribeInbox({
      onConnectedChange: (connected) => handlersRef.current.onConnectedChange?.(connected),
      onItemCreated: (item, unreadGroups) => handlersRef.current.onItemCreated?.(item, unreadGroups),
      onInboxEvent: (event) => handlersRef.current.onInboxEvent?.(event),
    })
  }, [])
}

/** 订阅统一实时事件流（通知矩阵等全局监听者）。 */
export function useRealtimeEvents(listener: (event: RealtimeEvent) => void) {
  const listenerRef = useRef(listener)
  listenerRef.current = listener

  useEffect(() => {
    return realtimeClient.on((event) => listenerRef.current(event))
  }, [])
}

/** 声明当前页面正在查看的会话（通知矩阵「不在该会话时弹」规则）。 */
export function useRealtimeActiveView(view: RealtimeActiveView) {
  useEffect(() => {
    realtimeClient.setActiveView(view)
    return () => {
      realtimeClient.setActiveView({})
    }
  }, [view.conversationId, view.workspaceSessionId])
}
