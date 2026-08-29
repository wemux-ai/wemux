/**
 * [INPUT]: DM conversation list, unread cursors, and the unified realtime client.
 * [OUTPUT]: DM conversation state: list, selection, messages, send, and per-conversation WS subscriptions.
 * [POS]: `/chat` DM surface state; subscribes to ALL DM conversations so unread badges and reminders are real-time.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { useAppDialog } from '../../components/ui/app-dialog-provider'
import type { DmConversationListItem } from '../../lib/api/methods/collaboration'
import { realtimeClient } from '../../lib/realtime/useRealtime'
import { useConversationUnreadState } from '../../lib/use-conversation-unread-state'
import { useSmoothAutoScroll } from '../../lib/use-smooth-auto-scroll'
import {
  dmConversationCache,
  readDmConversationCache,
  writeDmConversationCache,
} from '../../lib/chat-sidebar-cache'
import type { Language } from '../../lib/i18n'
import { text } from './chat-route-helpers'
import type { ConversationMessage } from '../../components/chat/conversation-types'
import type { ConversationMessageRecord } from '@shared/types'
import { appendConversationMessages } from '../../lib/thread/thread-merge'

const toRenderMessage = (message: ConversationMessageRecord): ConversationMessage => ({
  id: message.id,
  role: message.role === 'user' ? 'user' : 'assistant',
  text: message.content,
  createdAt: message.createdAt,
  // DM 双方都是真实用户，作者类型恒为 user（渲染层据此决定左右气泡）。
  authorType: 'user',
  authorId: message.senderId,
  authorName: message.externalRef?.senderName ? String(message.externalRef.senderName) : undefined,
  ...(message.replyToMessageId ? { sourceId: message.replyToMessageId } : {}),
  // @文档 引用（externalRef.referencedDocs，reference_doc）
  ...(Array.isArray(message.externalRef?.referencedDocs) && (message.externalRef?.referencedDocs as unknown[]).length > 0
    ? { referencedDocs: message.externalRef?.referencedDocs as Array<{ id: string; name: string; workspaceId: string | null }> }
    : {}),
})

const readClientMessageId = (message: ConversationMessageRecord) => {
  const value = message.externalRef?.clientMessageId
  return typeof value === 'string' ? value.trim() : ''
}

/** WS 回声先于 HTTP 响应时：只移除乐观气泡；否则把乐观气泡替换成服务端消息。 */
export const settleDmOptimisticMessage = (
  current: ConversationMessage[],
  optimisticId: string,
  confirmed: ConversationMessage,
): ConversationMessage[] => {
  const hasConfirmed = current.some((item) => item.id === confirmed.id)
  if (hasConfirmed) {
    return current.filter((item) => item.id !== optimisticId)
  }
  return current.map((item) => item.id === optimisticId ? confirmed : item)
}

/** WS 回声可能早于发送接口响应；按 clientMessageId 替换临时气泡，避免短暂双显。 */
export const reconcileDmRealtimeMessage = (
  current: ConversationMessage[],
  incoming: ConversationMessageRecord,
) => {
  const confirmed = toRenderMessage(incoming)
  const clientMessageId = readClientMessageId(incoming)
  const optimisticId = clientMessageId ? `dm-optimistic-${clientMessageId}` : ''
  if (optimisticId && current.some((item) => item.id === optimisticId)) {
    return settleDmOptimisticMessage(current, optimisticId, confirmed)
  }

  return appendConversationMessages(current, [confirmed])
}

export function useDmChatState({ language }: { language: Language }) {
  const [dmConversations, setDmConversations] = useState<DmConversationListItem[]>([])
  const { confirm } = useAppDialog()
  const [selectedDmId, setSelectedDmId] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [replyToMessageId, setReplyToMessageId] = useState('')
  const [composerValue, setComposerValue] = useState('')
  const [creatingSessionForPeer, setCreatingSessionForPeer] = useState('')
  const currentUserId = useRef('')
  const sendingRef = useRef(false)
  const { autoScrollToBottom, resumeAutoScroll, scrollRef } = useSmoothAutoScroll({ threshold: 56 })

  useEffect(() => {
    if (selectedDmId) {
      resumeAutoScroll()
      autoScrollToBottom('instant')
    }
  }, [autoScrollToBottom, resumeAutoScroll, selectedDmId])

  useEffect(() => {
    autoScrollToBottom('smooth')
  }, [autoScrollToBottom, messages.length, sending])

  const conversationIds = useMemo(() => dmConversations.map((item) => item.conversation.id), [dmConversations])
  const { unreadByConversationId, markRead } = useConversationUnreadState({
    conversationIds,
    activeConversationId: selectedDmId || undefined,
  })

  const selectedDmIdRef = useRef('')
  selectedDmIdRef.current = selectedDmId
  const dmSubscriptionCleanupsRef = useRef<Map<string, () => void>>(new Map())

  const selectedDm = useMemo(() => (
    dmConversations.find((item) => item.conversation.id === selectedDmId) ?? null
  ), [dmConversations, selectedDmId])

  const loadDmConversations = useCallback(async () => {
    // 路由重挂载时先用缓存种出私聊列表，后台静默刷新保持最新。
    const cachedConversations = readDmConversationCache(dmConversationCache)
    if (cachedConversations) {
      setDmConversations(cachedConversations)
    }
    try {
      const response = await api.listDmConversations()
      writeDmConversationCache(dmConversationCache, response.conversations)
      setDmConversations(response.conversations)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '私聊列表加载失败', 'Failed to load direct messages'))
    }
  }, [language])

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoading(true)
    try {
      const detail = await api.getConversationDetail(conversationId)
      setMessages(detail.messages.map(toRenderMessage))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '私聊消息加载失败', 'Failed to load messages'))
    } finally {
      setLoading(false)
    }
  }, [])

  // 会话 WS 实时订阅：所有私聊会话都订阅（不只在打开时才连）。
  // 活跃会话新消息直接追加 + 推进服务端已读游标；非活跃会话刷新列表（最新消息/排序/未读预览），
  // 未读 badge 由 useConversationUnreadState 对 conversation.event 实时 +1。
  useEffect(() => {
    const cleanups = dmSubscriptionCleanupsRef.current
    const desiredIds = new Set(conversationIds)

    for (const [conversationId, cleanup] of cleanups) {
      if (!desiredIds.has(conversationId)) {
        cleanup()
        cleanups.delete(conversationId)
      }
    }
    for (const conversationId of desiredIds) {
      if (cleanups.has(conversationId)) {
        continue
      }
      cleanups.set(conversationId, realtimeClient.subscribeConversation(conversationId, {
        onEvent: (event) => {
          if (event.type === 'message.created') {
            const message = (event.payload as { message?: ConversationMessageRecord }).message
            if (!message) {
              return
            }
            if (conversationId === selectedDmIdRef.current) {
              setMessages((current) => reconcileDmRealtimeMessage(current, message))
              // 打开着的会话收到新消息也推进服务端已读游标，避免刷新后重新标未读。
              void markRead(conversationId, message.createdAt)
            } else {
              // 非活跃会话：刷新列表（最新消息预览/排序），badge 增量由 unread hook 承担。
              void loadDmConversations()
            }
            return
          }

          // 表情/点赞变更：同步本地渲染（乐观覆盖由面板负责）。
          if (event.type === 'message.reaction.changed') {
            const payload = event.payload as { messageId?: string }
            if (payload.messageId && conversationId === selectedDmIdRef.current) {
              void loadMessages(conversationId)
            }
          }
        },
        onNeedsRefresh: () => {
          if (conversationId === selectedDmIdRef.current) {
            void loadMessages(conversationId)
          }
        },
      }))
    }
  }, [conversationIds, loadDmConversations, loadMessages, markRead])

  // 卸载时统一退订。
  useEffect(() => {
    const cleanups = dmSubscriptionCleanupsRef.current
    return () => {
      for (const cleanup of cleanups.values()) {
        cleanup()
      }
      cleanups.clear()
    }
  }, [])

  const selectDm = useCallback((conversationId: string) => {
    setSelectedDmId(conversationId)
    setMessages([])
    void loadMessages(conversationId)
  }, [loadMessages])

  /** 打开会话视为已读（游标推进）。 */
  useEffect(() => {
    if (!selectedDmId) {
      return
    }
    void markRead(selectedDmId)
  }, [markRead, selectedDmId])

  /** 会话切换时重置回复态。 */
  useEffect(() => {
    setReplyToMessageId('')
  }, [selectedDmId])

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed || !selectedDmId || sendingRef.current) {
      return
    }
    const replyTo = replyToMessageId.trim() || undefined
    const clientMessageId = crypto.randomUUID()
    sendingRef.current = true
    setSending(true)
    const optimistic: ConversationMessage = {
      id: `dm-optimistic-${clientMessageId}`,
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
      authorType: 'user',
      authorId: currentUserId.current || '__me__',
    }
    setMessages((current) => [...current, optimistic])
    setReplyToMessageId('')
    try {
      const response = await api.sendConversationMessage(selectedDmId, {
        content: trimmed,
        ...(replyTo ? { replyToMessageId: replyTo } : {}),
        clientMessageId,
      })
      const confirmed = toRenderMessage(response.message)
      setMessages((current) => settleDmOptimisticMessage(current, optimistic.id, confirmed))
      // 刷新列表（最新消息/排序）。
      await loadDmConversations()
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== optimistic.id))
      toast.error(error instanceof Error ? error.message : text(language, '发送失败', 'Failed to send'))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [language, loadDmConversations, replyToMessageId, selectedDmId])

  /** 会话重命名：更新列表与会话缓存（侧边栏标题即时生效）。 */
  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    try {
      const response = await api.renameConversation(conversationId, title)
      setDmConversations((current) => current.map((item) => (
        item.conversation.id === conversationId
          ? { ...item, conversation: response.conversation }
          : item
      )))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '重命名失败', 'Failed to rename'))
      return false
    }
  }, [language])

  /** 会话置顶 / 取消置顶：更新列表（侧边栏顺序与图标即时生效）。 */
  const toggleDmConversationPinned = useCallback(async (conversationId: string, pinned: boolean) => {
    try {
      const response = await api.updateConversationPinned(conversationId, pinned)
      setDmConversations((current) => current.map((item) => (
        item.conversation.id === conversationId
          ? { ...item, conversation: response.conversation }
          : item
      )))
      toast.success(pinned
        ? text(language, '会话已置顶', 'Conversation pinned')
        : text(language, '会话已取消置顶', 'Conversation unpinned'))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新置顶失败', 'Failed to update pin'))
      return false
    }
  }, [language])

  /** 删除私聊会话（带确认）：清列表、退出选中态。 */
  const deleteDmConversation = useCallback(async (conversationId: string) => {
    const confirmed = await confirm({
      title: text(language, '删除这个私聊？', 'Delete this direct message?'),
      description: text(language, '会话与其中所有消息将被删除，且不可恢复。', 'The conversation and all its messages will be deleted permanently.'),
      confirmText: text(language, '删除会话', 'Delete conversation'),
      cancelText: text(language, '取消', 'Cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }
    try {
      await api.deleteConversation(conversationId)
      setDmConversations((current) => current.filter((item) => item.conversation.id !== conversationId))
      if (selectedDmId === conversationId) {
        setSelectedDmId('')
        setMessages([])
      }
      toast.success(text(language, '会话已删除', 'Conversation deleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '删除会话失败', 'Failed to delete conversation'))
    }
  }, [confirm, language, selectedDmId])

  /** 飞书式发起私聊：跨空间用户搜索 → get-or-create → 选中。 */
  const startDm = useCallback(async (peerUserId: string, workspaceId?: string) => {
    try {
      const response = await api.ensureDmConversation(peerUserId, workspaceId)
      await loadDmConversations()
      setSelectedDmId(response.conversation.id)
      await loadMessages(response.conversation.id)
      return response.conversation.id
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '发起私聊失败', 'Failed to start direct message'))
      return ''
    }
  }, [language, loadDmConversations, loadMessages])

  /** 选中私聊对象：定位其最近会话；当前已在该对象的会话中则跳过（幂等）。 */
  const selectPeer = useCallback((peerUserId: string) => {
    const peerItems = dmConversations.filter((item) => item.peer?.userId === peerUserId)
    if (peerItems.length === 0) {
      return
    }
    const current = dmConversations.find((item) => item.conversation.id === selectedDmId)
    if (current && current.peer?.userId === peerUserId) {
      return
    }
    const latest = [...peerItems].sort((a, b) => (
      (b.latestMessage?.createdAt || b.conversation.updatedAt || '')
        .localeCompare(a.latestMessage?.createdAt || a.conversation.updatedAt || '')
    ))[0]
    selectDm(latest.conversation.id)
  }, [dmConversations, selectDm, selectedDmId])

  /** 新建会话：同一私聊对象可开多个会话（类似 Agent 主对话「新建会话」）。 */
  const createDmSession = useCallback(async (peerUserId: string) => {
    if (creatingSessionForPeer) {
      return ''
    }
    const peer = dmConversations.find((item) => item.peer?.userId === peerUserId)?.peer
    const count = dmConversations.filter((item) => item.peer?.userId === peerUserId).length
    const title = peer
      ? `与 ${peer.name} 的私聊${count > 0 ? ` ${count + 1}` : ''}`
      : undefined
    setCreatingSessionForPeer(peerUserId)
    try {
      const response = await api.ensureDmConversation(peerUserId, undefined, { createNew: true, title })
      await loadDmConversations()
      setSelectedDmId(response.conversation.id)
      await loadMessages(response.conversation.id)
      return response.conversation.id
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '新建会话失败', 'Failed to create session'))
      return ''
    } finally {
      setCreatingSessionForPeer('')
    }
  }, [creatingSessionForPeer, dmConversations, language, loadDmConversations, loadMessages])

  useEffect(() => {
    void loadDmConversations()
  }, [loadDmConversations])

  return {
    autoScrollToBottom,
    composerValue,
    conversationsByPeer: (peerUserId: string) => dmConversations.filter((item) => item.peer?.userId === peerUserId),
    createDmSession,
    creatingSessionForPeer,
    deleteDmConversation,
    dmConversations,
    loading,
    messages,
    replyToMessageId,
    resumeAutoScroll,
    renameConversation,
    scrollRef,
    selectedDm,
    selectedDmId,
    sending,
    setComposerValue,
    setCurrentUserId: (userId: string) => { currentUserId.current = userId },
    setReplyToMessageId,
    selectDm,
    selectPeer,
    sendMessage,
    startDm,
    toggleDmConversationPinned,
    unreadByConversationId,
  }
}

export type DmChatState = ReturnType<typeof useDmChatState>
