import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ConversationMessageRecord } from '../../../lib/api'
import { api } from '../../../lib/api'
import { workspaceQueryKeys } from '../../../lib/workspace-query-keys'
import { buildConversationPayload, CONVERSATION_PAGE_SIZE, prependConversationMessages } from '../../../lib/thread/thread-merge'
import type { TaskChatOutlineItem } from './workspace-session-chat-outline'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import { setCachedTaskConversation } from '../../../lib/workspace-session-chat-cache'

const WORKSPACE_SESSION_HISTORY_PAGE_SIZE = 50

type UseWorkspaceTranscriptHistoryStateParams = {
  historyHasMoreBefore: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  sessionSync: {
    prependHistoryEvents: (events: Awaited<ReturnType<typeof api.getWorkspaceSessionEvents>>['events']) => void
    resolveHistorySessionSeq: (eventId: string) => number | undefined
  }
  setHistoryHasMoreBefore: (value: boolean) => void
  timeline: ChatTimelineEvent[]
  workspaceId: string
  workspaceSessionId: string
}

type UseLegacyConversationHistoryStateParams = {
  conversationHasMoreBefore: boolean
  conversationMessagesLength: number
  conversationMessagesRef: MutableRefObject<ConversationMessageRecord[]>
  scrollRef: RefObject<HTMLDivElement | null>
  setConversationHasMoreBefore: (value: boolean) => void
  setConversationLoaded: (value: boolean) => void
  setConversationMessages: (value: ConversationMessageRecord[]) => void
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
}

type UseTaskChatHistoryStateParams = {
  conversationHasMoreBefore: boolean
  conversationMessagesLength: number
  conversationMessagesRef: MutableRefObject<ConversationMessageRecord[]>
  historyHasMoreBefore: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  sessionSync: {
    prependHistoryEvents: (events: Awaited<ReturnType<typeof api.getWorkspaceSessionEvents>>['events']) => void
    resolveHistorySessionSeq: (eventId: string) => number | undefined
  }
  setConversationHasMoreBefore: (value: boolean) => void
  setConversationLoaded: (value: boolean) => void
  setConversationMessages: (value: ConversationMessageRecord[]) => void
  setHistoryHasMoreBefore: (value: boolean) => void
  taskId: string
  timeline: ChatTimelineEvent[]
  workspaceId?: string
  workspaceSessionId?: string
}

function useWorkspaceTranscriptHistoryState({
  historyHasMoreBefore,
  scrollRef,
  sessionSync,
  setHistoryHasMoreBefore,
  timeline,
  workspaceId,
  workspaceSessionId,
}: UseWorkspaceTranscriptHistoryStateParams) {
  const queryClient = useQueryClient()
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false)
  const historyHasMoreBeforeRef = useRef(historyHasMoreBefore)
  const timelineRef = useRef<ChatTimelineEvent[]>(timeline)
  const transcriptWindowRestoreRef = useRef<{ previousHeight: number; previousTop: number } | null>(null)
  const loadOlderWorkspaceTranscriptPageRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    historyHasMoreBeforeRef.current = historyHasMoreBefore
  }, [historyHasMoreBefore])

  useEffect(() => {
    timelineRef.current = timeline
  }, [timeline])

  useLayoutEffect(() => {
    const pendingRestore = transcriptWindowRestoreRef.current
    if (!pendingRestore) {
      return
    }

    const node = scrollRef.current
    if (!node) {
      transcriptWindowRestoreRef.current = null
      return
    }

    const heightDelta = node.scrollHeight - pendingRestore.previousHeight
    node.scrollTop = pendingRestore.previousTop + heightDelta
    transcriptWindowRestoreRef.current = null
  }, [scrollRef, workspaceId, workspaceSessionId, timeline.length])

  const loadOlderWorkspaceTranscriptPage = useCallback(async () => {
    if (!historyHasMoreBefore || loadingOlderHistory) {
      return
    }

    const earliestHistoryEvent = timeline[0]
    const earliestSessionSeq = earliestHistoryEvent
      ? sessionSync.resolveHistorySessionSeq(earliestHistoryEvent.id)
      : undefined
    if (typeof earliestSessionSeq !== 'number') {
      return
    }

    const node = scrollRef.current
    if (node) {
      transcriptWindowRestoreRef.current = {
        previousHeight: node.scrollHeight,
        previousTop: node.scrollTop,
      }
    }

    setLoadingOlderHistory(true)
    try {
      const response = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.historyEvents(workspaceId, workspaceSessionId, `before:${earliestSessionSeq}:limit:${WORKSPACE_SESSION_HISTORY_PAGE_SIZE}`),
        queryFn: () => api.getWorkspaceSessionEvents(workspaceId, workspaceSessionId, {
          beforeSessionSeq: earliestSessionSeq,
          limit: WORKSPACE_SESSION_HISTORY_PAGE_SIZE,
          visibility: 'transcript',
        }),
        staleTime: 60_000,
      })
      sessionSync.prependHistoryEvents(response.events)
      setHistoryHasMoreBefore(response.hasMoreBefore)
    } catch {
      transcriptWindowRestoreRef.current = null
    } finally {
      setLoadingOlderHistory(false)
    }
  }, [
    historyHasMoreBefore,
    loadingOlderHistory,
    queryClient,
    scrollRef,
    sessionSync,
    setHistoryHasMoreBefore,
    timeline,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    loadOlderWorkspaceTranscriptPageRef.current = loadOlderWorkspaceTranscriptPage
  }, [loadOlderWorkspaceTranscriptPage])

  const ensureOutlineItemVisible = useCallback(async (item: TaskChatOutlineItem) => {
    while (
      historyHasMoreBeforeRef.current
      && !timelineRef.current.some((event) => event.kind === 'user_message' && event.turnId === item.turnId)
    ) {
      await loadOlderWorkspaceTranscriptPageRef.current()
    }

    return timelineRef.current.some((event) => event.kind === 'user_message' && event.turnId === item.turnId)
  }, [])

  const resetWorkspaceTranscriptHistoryState = useCallback(() => {
    setHistoryHasMoreBefore(false)
    setLoadingOlderHistory(false)
    historyHasMoreBeforeRef.current = false
    timelineRef.current = []
    transcriptWindowRestoreRef.current = null
  }, [setHistoryHasMoreBefore])

  return {
    ensureOutlineItemVisible,
    loadOlderTranscriptPage: loadOlderWorkspaceTranscriptPage,
    loadingOlderHistory,
    loadingOlderConversation: false,
    resetHistoryState: resetWorkspaceTranscriptHistoryState,
  }
}

function useLegacyConversationHistoryState({
  conversationHasMoreBefore,
  conversationMessagesLength,
  conversationMessagesRef,
  scrollRef,
  setConversationHasMoreBefore,
  setConversationLoaded,
  setConversationMessages,
  taskId,
  workspaceId,
  workspaceSessionId,
}: UseLegacyConversationHistoryStateParams) {
  const queryClient = useQueryClient()
  const [loadingOlderConversation, setLoadingOlderConversation] = useState(false)
  const conversationHasMoreBeforeRef = useRef(conversationHasMoreBefore)
  const transcriptWindowRestoreRef = useRef<{ previousHeight: number; previousTop: number } | null>(null)
  const loadOlderLegacyTranscriptPageRef = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    conversationHasMoreBeforeRef.current = conversationHasMoreBefore
  }, [conversationHasMoreBefore])

  useLayoutEffect(() => {
    const pendingRestore = transcriptWindowRestoreRef.current
    if (!pendingRestore) {
      return
    }

    const node = scrollRef.current
    if (!node) {
      transcriptWindowRestoreRef.current = null
      return
    }

    const heightDelta = node.scrollHeight - pendingRestore.previousHeight
    node.scrollTop = pendingRestore.previousTop + heightDelta
    transcriptWindowRestoreRef.current = null
  }, [conversationMessagesLength, scrollRef, taskId, workspaceId, workspaceSessionId])

  const loadOlderLegacyTranscriptPage = useCallback(async () => {
    if (loadingOlderConversation || !conversationHasMoreBefore) {
      return
    }

    const oldestMessageId = conversationMessagesRef.current[0]?.id
    if (!oldestMessageId) {
      return
    }

    const node = scrollRef.current
    if (node) {
      transcriptWindowRestoreRef.current = {
        previousHeight: node.scrollHeight,
        previousTop: node.scrollTop,
      }
    }

    setLoadingOlderConversation(true)
    try {
      const response = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.conversation(taskId, workspaceId, workspaceSessionId, `before:${oldestMessageId}:limit:${CONVERSATION_PAGE_SIZE}`),
        queryFn: () => api.getTaskConversation(taskId, workspaceId, workspaceSessionId, {
          beforeMessageId: oldestMessageId,
          limit: CONVERSATION_PAGE_SIZE,
        }),
        staleTime: 60_000,
      })
      const nextMessages = prependConversationMessages(conversationMessagesRef.current, response.messages)
      const hasMoreBefore = response.totalMessageCount > nextMessages.length

      conversationMessagesRef.current = nextMessages
      setConversationLoaded(true)
      setConversationHasMoreBefore(hasMoreBefore)
      setConversationMessages(nextMessages)
      const nextPayload = buildConversationPayload(
        response.conversation,
        nextMessages,
        response.totalMessageCount,
        hasMoreBefore,
      )
      setCachedTaskConversation(taskId, workspaceId, workspaceSessionId, nextPayload)
      queryClient.setQueryData(
        workspaceQueryKeys.conversation(taskId, workspaceId, workspaceSessionId),
        nextPayload,
      )
    } catch {
      transcriptWindowRestoreRef.current = null
    } finally {
      setLoadingOlderConversation(false)
    }
  }, [
    conversationHasMoreBefore,
    conversationMessagesRef,
    loadingOlderConversation,
    queryClient,
    scrollRef,
    setConversationHasMoreBefore,
    setConversationLoaded,
    setConversationMessages,
    taskId,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    loadOlderLegacyTranscriptPageRef.current = loadOlderLegacyTranscriptPage
  }, [loadOlderLegacyTranscriptPage])

  const ensureOutlineItemVisible = useCallback(async (item: TaskChatOutlineItem) => {
    while (
      conversationHasMoreBeforeRef.current
      && !conversationMessagesRef.current.some((message) => message.id === item.messageId)
    ) {
      await loadOlderLegacyTranscriptPageRef.current()
    }

    return conversationMessagesRef.current.some((message) => message.id === item.messageId)
  }, [conversationMessagesRef])

  return {
    ensureOutlineItemVisible,
    loadOlderTranscriptPage: loadOlderLegacyTranscriptPage,
    loadingOlderHistory: false,
    loadingOlderConversation,
    resetHistoryState: () => undefined,
  }
}

export function useTaskChatHistoryState(params: UseTaskChatHistoryStateParams) {
  const workspaceTranscriptHistoryState = useWorkspaceTranscriptHistoryState({
    historyHasMoreBefore: params.historyHasMoreBefore,
    scrollRef: params.scrollRef,
    sessionSync: params.sessionSync,
    setHistoryHasMoreBefore: params.setHistoryHasMoreBefore,
    timeline: params.timeline,
    workspaceId: params.workspaceId ?? '',
    workspaceSessionId: params.workspaceSessionId ?? '',
  })

  const legacyConversationHistoryState = useLegacyConversationHistoryState({
    conversationHasMoreBefore: params.conversationHasMoreBefore,
    conversationMessagesLength: params.conversationMessagesLength,
    conversationMessagesRef: params.conversationMessagesRef,
    scrollRef: params.scrollRef,
    setConversationHasMoreBefore: params.setConversationHasMoreBefore,
    setConversationLoaded: params.setConversationLoaded,
    setConversationMessages: params.setConversationMessages,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  return params.workspaceId && params.workspaceSessionId
    ? workspaceTranscriptHistoryState
    : legacyConversationHistoryState
}
