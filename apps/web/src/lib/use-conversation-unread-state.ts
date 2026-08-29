/**
 * [INPUT]: 会话（conversation）列表 + 当前活跃会话 + 统一实时事件流。
 * [OUTPUT]: 会话未读计数（服务端统计）+ 已读标记 + WS 新消息本地增量。
 * [POS]: 会话未读前端状态（feature P2）。服务端游标为权威；WS message.created 做本地增量避免重拉。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useRealtimeEvents } from './realtime/useRealtime'

const CONVERSATION_UNREAD_REFRESH_INTERVAL_MS = 60_000

type UseConversationUnreadStateParams = {
  conversationIds: string[]
  /** 当前正在查看的会话 id（该会话收到新消息视为已读，其余 +1）。 */
  activeConversationId?: string
}

export const useConversationUnreadState = (params: UseConversationUnreadStateParams) => {
  const [unreadByConversationId, setUnreadByConversationId] = useState<Record<string, number>>({})
  const conversationIdSetKey = params.conversationIds.slice().sort().join('|')
  const activeConversationIdRef = useRef(params.activeConversationId)
  activeConversationIdRef.current = params.activeConversationId

  const refresh = useCallback(async () => {
    try {
      // 显式传会话 id（覆盖主对话 kind='main' 与群聊 session）；空列表时回退到 scoped 全部。
      const ids = conversationIdSetKey ? conversationIdSetKey.split('|').filter(Boolean) : []
      const response = await api.getConversationUnreadCounts(ids.length > 0 ? ids : undefined)
      setUnreadByConversationId(response.counts)
    } catch {
      // 拉取失败保持现有未读展示。
    }
  }, [conversationIdSetKey])

  // 初始拉取 + 会话列表变化重拉。
  useEffect(() => {
    void refresh()
  }, [refresh, conversationIdSetKey])

  // 定时刷新（多设备/其他标签页已读同步的兜底）。
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), CONVERSATION_UNREAD_REFRESH_INTERVAL_MS)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  // WS 新消息 → 本地增量：非活跃会话 +1；活跃会话视为已读（游标推进由打开会话时 markRead 承担）。
  useRealtimeEvents((event) => {
    if (event.type !== 'conversation.event' || event.event.type !== 'message.created') {
      return
    }
    const conversationId = event.conversationId
    if (conversationId === activeConversationIdRef.current) {
      return
    }
    setUnreadByConversationId((current) => ({
      ...current,
      [conversationId]: (current[conversationId] ?? 0) + 1,
    }))
  })

  const markRead = useCallback(async (conversationId: string, lastReadAt?: string) => {
    setUnreadByConversationId((current) => ({
      ...current,
      [conversationId]: 0,
    }))
    try {
      await api.markConversationRead(conversationId, lastReadAt)
    } catch {
      // 已读标记失败不阻塞 UI；下次刷新会纠正。
    }
  }, [])

  return {
    unreadByConversationId,
    refresh,
    markRead,
  }
}
