/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: 线程 id（切换时重置内部状态）+ 可选初始页（路由重挂载时的缓存种子，无则空加载）
 *         + 调用方注入的加载器与增量（传输不进 hook）
 * [OUTPUT]: 线程消息状态：已确认 messages、乐观队列 optimisticMessages、加载态与
 *           四个操作方法（loadHistory / applyIncoming / applyOptimistic / settleOptimistic）
 * [POS]: P2 收敛的客户端线程状态层；合并与乐观队列算法全部委托 thread-merge.ts 纯函数，
 *        自身只是 React 薄壳。timeline/分页游标在 /chat 路由接入时再补。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  appendConversationMessages,
  prependConversationMessages,
  settleOptimisticMessages,
  upsertOptimisticMessage,
  type OptimisticQueuedMessage,
} from './thread-merge'

export interface ThreadHistoryPage<TMessage extends { id: string }> {
  messages: TMessage[]
  hasMoreBefore: boolean
}

/** 初始页：仅用于挂载/切换瞬间的即时渲染（如路由级缓存种子），冷加载仍由调用方发起。 */
export interface UseThreadInitialPage<TMessage extends { id: string }> extends ThreadHistoryPage<TMessage> {}

export interface UseThreadResult<TMessage extends { id: string }> {
  /** 已确认（服务端/冷加载）的消息，按 id 去重合并。 */
  messages: TMessage[]
  /** 乐观队列中尚未销账的消息（发送中的用户消息），按 clientMessageId 去重。 */
  optimisticMessages: TMessage[]
  isLoadingHistory: boolean
  /** 是否还能向更早历史翻页（服务端 hasMoreBefore）。 */
  hasMoreBefore: boolean
  /** 冷加载：替换整份消息列表（loader 返回最新快照 + 分页信息）。 */
  loadHistory: (loader: () => Promise<ThreadHistoryPage<TMessage>>) => Promise<void>
  /** 加载更早历史：loader 返回旧一页，按 id 去重前插到列表头；调用方自行闭包游标。 */
  loadMoreBefore: (loader: () => Promise<ThreadHistoryPage<TMessage>>) => Promise<void>
  /** 增量合并：新到的消息（WS 增量 / done 快照）按 id 去重并到已确认列表。 */
  applyIncoming: (incoming: TMessage[]) => void
  /** 发送前登记乐观消息；同 clientMessageId 重复调用会整体替换。 */
  applyOptimistic: (message: TMessage, clientMessageId: string) => void
  /** 服务端已回显确认后销账，乐观气泡让位给真实消息。 */
  settleOptimistic: (clientMessageId: string) => void
}

/**
 * 线程级消息状态 hook。`threadId` 变化时整体重置（messages 清空、乐观队列清空），
 * 有 `initialPage`（缓存种子）时重置为种子内容而非空列表；
 * 调用方负责在切换后重新冷加载。传输完全由调用方注入：本 hook 不发请求、不连 WS。
 */
export function useThread<TMessage extends { id: string }>(
  threadId: string | undefined,
  initialPage?: UseThreadInitialPage<TMessage>,
): UseThreadResult<TMessage> {
  const [messages, setMessages] = useState<TMessage[]>(() => initialPage?.messages ?? [])
  const [optimisticQueue, setOptimisticQueue] = useState<OptimisticQueuedMessage<TMessage>[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [hasMoreBefore, setHasMoreBefore] = useState(() => initialPage?.hasMoreBefore ?? false)
  const threadIdRef = useRef(threadId)
  const loadGenerationRef = useRef(0)

  if (threadIdRef.current !== threadId) {
    threadIdRef.current = threadId
    // 会话切换：代际 +1，丢弃仍在途的旧会话加载结果；
    // 有初始页（缓存种子）时直接先渲染它，避免空加载闪烁。
    loadGenerationRef.current += 1
    setMessages(initialPage?.messages ?? [])
    setOptimisticQueue([])
    setHasMoreBefore(initialPage?.hasMoreBefore ?? false)
  }

  const optimisticMessages = useMemo(
    () => optimisticQueue.map((item) => item.message),
    [optimisticQueue],
  )

  const loadHistory = useCallback(async (loader: () => Promise<ThreadHistoryPage<TMessage>>) => {
    const generation = loadGenerationRef.current
    setIsLoadingHistory(true)
    try {
      const page = await loader()
      // 加载期间线程已切换：过期结果直接丢弃，不写进新线程状态。
      if (loadGenerationRef.current !== generation) {
        return
      }
      setMessages(page.messages)
      setHasMoreBefore(page.hasMoreBefore)
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoadingHistory(false)
      }
    }
  }, [])

  const loadMoreBefore = useCallback(async (loader: () => Promise<ThreadHistoryPage<TMessage>>) => {
    const generation = loadGenerationRef.current
    const page = await loader()
    if (loadGenerationRef.current !== generation) {
      return
    }
    if (page.messages.length === 0) {
      setHasMoreBefore(false)
      return
    }
    setMessages((current) => prependConversationMessages(current, page.messages))
    setHasMoreBefore(page.hasMoreBefore)
    // 加载更早不翻转 loading 态：调用方（面板/路由）各自维护 loadingOlder 指示。
  }, [])

  const applyIncoming = useCallback((incoming: TMessage[]) => {
    if (incoming.length === 0) {
      return
    }

    setMessages((current) => appendConversationMessages(current, incoming))
  }, [])

  const applyOptimistic = useCallback((message: TMessage, clientMessageId: string) => {
    setOptimisticQueue((current) => upsertOptimisticMessage(current, message, clientMessageId))
  }, [])

  const settleOptimistic = useCallback((clientMessageId: string) => {
    setOptimisticQueue((current) => settleOptimisticMessages(current, clientMessageId))
  }, [])

  return {
    messages,
    optimisticMessages,
    isLoadingHistory,
    hasMoreBefore,
    loadHistory,
    loadMoreBefore,
    applyIncoming,
    applyOptimistic,
    settleOptimistic,
  }
}
