/**
 * [INPUT]: 工作区任务聊天快照、历史记录、WebSocket 消息与父级状态回调
 * [OUTPUT]: 工作区聊天实时同步 Hook，以及可测试的快照协调与回放判定函数
 * [POS]: /workspace 时间线的数据同步边界，合并持久化历史与订阅完成后的实时增量
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { TaskChatPart } from '@shared/task-chat-part'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { TaskChatWsClientMessage, TaskChatWsServerMessage } from '@shared/task-chat-ws'
import { isStatusEvent, isToolCallEvent, upsertTimelineEvent } from '@shared/timeline'
import {
  isWorkspaceSessionTurnDeletedEvent,
  type WorkspaceSessionEventRecord,
  type WorkspaceSessionRuntimeSnapshot,
} from '@shared/workspace-session-history'
import type { WorkspaceSessionHistoryWsServerMessage } from '@shared/workspace-session-history-ws'
import type {
  AgentRunningStatus,
  AppState,
  ExecutionLog,
  Task,
  ToolCall,
  WorkspaceSessionRuntimeStatus,
} from '@shared/types'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import type { ConversationMessageRecord, TaskConversationPayload } from '../../../lib/api'
import { api } from '../../../lib/api'
import { workspaceQueryKeys } from '../../../lib/workspace-query-keys'
import {
  getCachedTaskConversation,
  setCachedTaskChatSession,
  setCachedTaskConversation,
} from '../../../lib/workspace-session-chat-cache'
import {
  taskChatDataPartSchemas,
  type ChatTimelineEvent,
} from '../../../lib/workspace-session-chat-ui'
import { parseWorkspaceSessionHistoryWsMessage } from '../../../lib/workspace-session-history-ws'
import { getWorkspaceSessionChatWsPart, parseWorkspaceSessionChatWsMessage } from '../../../lib/workspace-session-chat-ws'
import { resolveApiWebSocketUrl } from '../../../lib/runtime-config'
import { useWorkbenchResource } from '../workbench-resource-registry'
import {
  appendConversationMessages,
  buildConversationPayload,
  filterKnownWorkspaceSessionHistoryEvents,
  getConversationLatestMessageAt,
  INITIAL_CONVERSATION_TURN_WINDOW,
  mergeHistorySnapshotTimeline,
  mergeWorkspaceSessionHistoryEvents,
  prependHistoryPageTimeline,
  resolveIncomingTaskChatSessionSnapshot,
} from '../../../lib/thread/thread-merge'
import {
  buildWorkspaceHistoryTimeline as buildWorkspaceHistoryTimelineBase,
} from './workspace-session-chat-history-timeline'
import {
  formatObservationNotice,
  normalizeChatErrorMessage,
  prependNotice,
  resolveUpdatedTaskFromState,
  TASK_CHAT_SOCKET_NOT_READY_MESSAGE,
  type NoticeItem,
} from './workspace-session-chat-helpers'
import { traceWorkspaceSessionChat } from './workspace-session-chat-trace'
import type { WorkspaceSessionChatProps } from './workspace-session-chat-types'

type TaskChatSocketSyncParams = Pick<
  WorkspaceSessionChatProps,
  | 'onTaskUpdate'
  | 'onWorkspaceSessionChange'
  | 'open'
  | 'task'
  | 'workspaceId'
  | 'workspaceSession'
  | 'workspaceSessionId'
> & {
  chatSession: TaskChatSessionSnapshot | null
  chatSocketRef: MutableRefObject<WebSocket | null>
  conversationMessagesRef: MutableRefObject<ConversationMessageRecord[]>
  historyLastSessionSeqRef: MutableRefObject<number>
  liveSessionRevisionRef: MutableRefObject<number>
  onTaskUpdateRef: MutableRefObject<(task: Task) => void>
  setChatSession: Dispatch<SetStateAction<TaskChatSessionSnapshot | null>>
  setConversationHasMoreBefore: Dispatch<SetStateAction<boolean>>
  setConversationLoaded: Dispatch<SetStateAction<boolean>>
  setConversationMessages: Dispatch<SetStateAction<ConversationMessageRecord[]>>
  setHistoryHasMoreBefore: Dispatch<SetStateAction<boolean>>
  setLiveStatus: Dispatch<SetStateAction<AgentRunningStatus>>
  setLiveStep: Dispatch<SetStateAction<string>>
  setLiveTools: Dispatch<SetStateAction<ToolCall[]>>
  setNotices: Dispatch<SetStateAction<NoticeItem[]>>
  setSocketStatus: Dispatch<SetStateAction<'connecting' | 'open' | 'closed' | 'error'>>
  setTimeline: Dispatch<SetStateAction<ChatTimelineEvent[]>>
  socketLastEventIdRef: MutableRefObject<string | null>
  taskRef: MutableRefObject<Task>
  workspaceSessionInitialHistoryLimit: number
}

const TASK_CHAT_ACK_TIMEOUT_MS = 15_000
const LIVE_TEXT_TRACE_MIN_INTERVAL_MS = 500
const LIVE_TEXT_TRACE_MIN_LENGTH_DELTA = 240

type WorkspaceRuntimeTaskPatch = Partial<Task> & {
  runtimeStatus?: WorkspaceSessionRuntimeStatus
}

const isWorkspaceSessionLiveStatusBusy = (status: AgentRunningStatus) => {
  return status === 'thinking' || status === 'executing' || status === 'waiting'
}

export const shouldApplyTaskChatWsStreamMessage = (
  message: TaskChatWsServerMessage,
  awaitingInitialSubscription: boolean,
) => {
  if (!awaitingInitialSubscription) {
    return true
  }

  return message.type !== 'task_chat.snapshot' && message.type !== 'task_chat.event'
}

const resolveWorkspaceRuntimeStatusFromTaskStatus = (
  agentRunningStatus: AgentRunningStatus,
  previousRuntimeStatus?: WorkspaceSessionRuntimeStatus,
): WorkspaceSessionRuntimeStatus | undefined => {
  if (agentRunningStatus === 'waiting') {
    return 'waiting'
  }

  if (agentRunningStatus === 'complete') {
    return 'completed'
  }

  if (agentRunningStatus === 'error') {
    return 'error'
  }

  if (agentRunningStatus === 'idle') {
    return 'idle'
  }

  return previousRuntimeStatus === 'queued' ? 'queued' : 'running'
}

export const reconcileWorkspaceSessionSnapshotFromTaskPart = (
  snapshot: TaskChatSessionSnapshot | null,
  taskPart: {
    agentRunningStatus: AgentRunningStatus
    currentStep: string
    needsHumanConfirm?: boolean
  },
) => {
  if (!snapshot || snapshot.scope.mode !== 'workspace') {
    return snapshot
  }

  const nextRuntimeStatus = resolveWorkspaceRuntimeStatusFromTaskStatus(
    taskPart.agentRunningStatus,
    snapshot.runtime.runtimeStatus,
  )
  const nextNeedsHumanConfirm = taskPart.needsHumanConfirm ?? snapshot.runtime.needsHumanConfirm

  if (
    snapshot.runtime.agentRunningStatus === taskPart.agentRunningStatus
    && snapshot.runtime.currentStep === taskPart.currentStep
    && snapshot.runtime.runtimeStatus === nextRuntimeStatus
    && snapshot.runtime.needsHumanConfirm === nextNeedsHumanConfirm
  ) {
    return snapshot
  }

  return {
    ...snapshot,
    runtime: {
      ...snapshot.runtime,
      agentRunningStatus: taskPart.agentRunningStatus,
      runtimeStatus: nextRuntimeStatus,
      currentStep: taskPart.currentStep,
      needsHumanConfirm: nextNeedsHumanConfirm,
    },
  }
}

export const reconcileOptimisticWorkspaceSessionSnapshotFromTaskPart = (
  snapshot: TaskChatSessionSnapshot | null,
  taskPart: {
    agentRunningStatus: AgentRunningStatus
    currentStep: string
    needsHumanConfirm?: boolean
  },
) => {
  const reconciled = reconcileWorkspaceSessionSnapshotFromTaskPart(snapshot, taskPart)
  if (!reconciled || reconciled.scope.mode !== 'workspace') {
    return reconciled
  }

  const currentRuntimeSequence = snapshot?.runtime.runtimeSequence
  return {
    ...reconciled,
    runtime: {
      ...reconciled.runtime,
      runtimeSequence: typeof currentRuntimeSequence === 'number'
        ? currentRuntimeSequence + 1
        : reconciled.runtime.runtimeSequence,
    },
  }
}

export const restoreWorkspaceSessionSnapshotRuntime = (
  current: TaskChatSessionSnapshot | null,
  previous: TaskChatSessionSnapshot | null,
) => {
  if (!current || !previous || current.scope.sessionKey !== previous.scope.sessionKey) {
    return current
  }

  return {
    ...current,
    runtime: previous.runtime,
  }
}

export const buildWorkspaceRuntimeTaskPatchFromSnapshot = (
  runtime: WorkspaceSessionRuntimeSnapshot,
): WorkspaceRuntimeTaskPatch => {
  const patch: WorkspaceRuntimeTaskPatch = {
    agentRunningStatus: runtime.agentRunningStatus,
    currentStep: runtime.currentStep,
    updatedAt: runtime.updatedAt,
  }

  if (runtime.runtimeStatus) {
    patch.runtimeStatus = runtime.runtimeStatus
  }

  return patch
}

export function useTaskChatSocketSync({
  chatSession,
  chatSocketRef,
  conversationMessagesRef,
  historyLastSessionSeqRef,
  liveSessionRevisionRef,
  onTaskUpdate,
  onTaskUpdateRef,
  onWorkspaceSessionChange,
  open,
  setChatSession,
  setConversationHasMoreBefore,
  setConversationLoaded,
  setConversationMessages,
  setHistoryHasMoreBefore,
  setLiveStatus,
  setLiveStep,
  setLiveTools,
  setNotices,
  setSocketStatus,
  setTimeline,
  socketLastEventIdRef,
  task,
  taskRef,
  workspaceSessionInitialHistoryLimit,
  workspaceId,
  workspaceSessionId,
}: TaskChatSocketSyncParams) {
  const queryClient = useQueryClient()
  const historyEventSeqByIdRef = useRef(new Map<string, number>())
  const deletedHistoryTurnIdsRef = useRef(new Set<string>())
  const liveTextTraceByEventIdRef = useRef(new Map<string, { at: number; textLength: number }>())
  const [pageVisible, setPageVisible] = useState(() => {
    if (typeof document === 'undefined') {
      return true
    }
    return document.visibilityState === 'visible'
  })
  const socketResourceStatus = useWorkbenchResource({
    resourceKey: `chat:${task.id}:${workspaceId || 'default'}:${workspaceSessionId || 'latest'}`,
    type: 'socket',
    active: open && pageVisible,
  })
  const pendingSocketRequestsRef = useRef(new Map<string, {
    resolve: (message: Extract<TaskChatWsServerMessage, { type: 'task_chat.ack' }>) => void
    reject: (error: Error) => void
    timeoutId: number
  }>())

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const updatePageVisible = () => {
      setPageVisible(document.visibilityState === 'visible')
    }

    updatePageVisible()
    document.addEventListener('visibilitychange', updatePageVisible)
    window.addEventListener('focus', updatePageVisible)

    return () => {
      document.removeEventListener('visibilitychange', updatePageVisible)
      window.removeEventListener('focus', updatePageVisible)
    }
  }, [])

  useEffect(() => {
    if (!chatSession) {
      return
    }

    setCachedTaskChatSession(task.id, workspaceId, workspaceSessionId, chatSession)
    queryClient.setQueryData(
      workspaceQueryKeys.chatSession(task.id, workspaceId, workspaceSessionId),
      chatSession,
    )
  }, [chatSession, queryClient, task.id, workspaceId, workspaceSessionId])

  const rememberHistoryEvents = useCallback((events: WorkspaceSessionEventRecord[]) => {
    if (events.length === 0) {
      return
    }

    traceWorkspaceSessionChat('remember-history-events', {
      taskId: task.id,
      workspaceId,
      workspaceSessionId,
      eventCount: events.length,
      firstSessionSeq: events[0]?.sessionSeq ?? null,
      lastSessionSeq: events.at(-1)?.sessionSeq ?? null,
      previousLastSessionSeq: historyLastSessionSeqRef.current,
    })
    for (const event of events) {
      historyEventSeqByIdRef.current.set(event.id, event.sessionSeq)
      if (isWorkspaceSessionTurnDeletedEvent(event)) {
        deletedHistoryTurnIdsRef.current.add(event.payload.deletedTurnId)
      }
      if (event.sessionSeq > historyLastSessionSeqRef.current) {
        historyLastSessionSeqRef.current = event.sessionSeq
      }
    }
    if (workspaceId && workspaceSessionId) {
      queryClient.setQueryData(
        workspaceQueryKeys.historyEvents(workspaceId, workspaceSessionId),
        (current: WorkspaceSessionEventRecord[] | undefined) => mergeWorkspaceSessionHistoryEvents(current, events),
      )
      void queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.historyEventsScope(workspaceId, workspaceSessionId),
      })
    }
  }, [historyLastSessionSeqRef, queryClient, workspaceId, workspaceSessionId])

  const filterDeletedHistoryTimeline = useCallback((timeline: ChatTimelineEvent[]) => {
    if (deletedHistoryTurnIdsRef.current.size === 0) {
      return timeline
    }

    return timeline.filter((event) => !deletedHistoryTurnIdsRef.current.has(event.turnId))
  }, [])

  const buildWorkspaceHistoryTimeline = useCallback((events: WorkspaceSessionEventRecord[]) => {
    return buildWorkspaceHistoryTimelineBase({
      events,
      deletedTurnIds: deletedHistoryTurnIdsRef.current,
    })
  }, [])

  const syncTaskRuntime = useCallback((patch: WorkspaceRuntimeTaskPatch) => {
    const currentTask = taskRef.current
    onTaskUpdateRef.current({
      ...currentTask,
      ...patch,
      toolCalls: patch.toolCalls ?? currentTask.toolCalls ?? [],
      logs: patch.logs ?? currentTask.logs,
    })
  }, [onTaskUpdateRef, taskRef])

  const applyWorkspaceSessionRuntime = useCallback((runtime: WorkspaceSessionRuntimeSnapshot) => {
    if (runtime.lastEventSeq > 0 && runtime.lastEventSeq < historyLastSessionSeqRef.current) {
      return
    }

    setLiveStatus(runtime.agentRunningStatus)
    setLiveStep(runtime.currentStep)
    setLiveTools(runtime.activeToolCalls ?? [])
    historyLastSessionSeqRef.current = Math.max(historyLastSessionSeqRef.current, runtime.lastEventSeq ?? 0)
  }, [historyLastSessionSeqRef, setLiveStatus, setLiveStep, setLiveTools])

  const prependHistoryEvents = useCallback((events: WorkspaceSessionEventRecord[]) => {
    if (events.length === 0) {
      return
    }

    rememberHistoryEvents(events)
    const historyTimeline = buildWorkspaceHistoryTimeline(events)
    setTimeline((current) => prependHistoryPageTimeline(
      current,
      historyTimeline,
      (eventId) => historyEventSeqByIdRef.current.get(eventId),
    ))
  }, [buildWorkspaceHistoryTimeline, rememberHistoryEvents, setTimeline])

  const resolveHistorySessionSeq = useCallback((eventId: string) => {
    return historyEventSeqByIdRef.current.get(eventId)
  }, [])

  const applyConversationPayload = useCallback((payload: TaskConversationPayload) => {
    const hasMoreBefore = payload.hasMoreBefore || payload.totalMessageCount > payload.messages.length
    const nextPayload = buildConversationPayload(payload.conversation, payload.messages, payload.totalMessageCount, hasMoreBefore)
    conversationMessagesRef.current = payload.messages
    setConversationLoaded(true)
    setConversationHasMoreBefore(hasMoreBefore)
    setConversationMessages(payload.messages)
    setCachedTaskConversation(
      task.id,
      workspaceId,
      workspaceSessionId,
      nextPayload,
    )
    queryClient.setQueryData(
      workspaceQueryKeys.conversation(task.id, workspaceId, workspaceSessionId),
      nextPayload,
    )
    if (!workspaceId || !workspaceSessionId) {
      return
    }
  }, [queryClient, setConversationHasMoreBefore, setConversationLoaded, setConversationMessages, setTimeline, task.id, workspaceId, workspaceSessionId])

  const refreshWorkspaceHistoryView = useCallback(async (options?: {
    preserveMessagesOnError?: boolean
    limit?: number
  }) => {
    if (!workspaceId || !workspaceSessionId) {
      return
    }

    try {
      const limit = options?.limit ?? workspaceSessionInitialHistoryLimit
      const response = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.historySnapshot(workspaceId, workspaceSessionId, `initial:${limit}`),
        queryFn: () => api.getWorkspaceSessionSnapshot(workspaceId, workspaceSessionId, {
          limit,
          visibility: 'transcript',
        }),
        staleTime: 0,
      })

      const historyEventsPage = response.history
      const deletedTurnIds = new Set(
        historyEventsPage.events
          .filter(isWorkspaceSessionTurnDeletedEvent)
          .map((event) => event.payload.deletedTurnId),
      )

      rememberHistoryEvents(historyEventsPage.events)
      setHistoryHasMoreBefore(historyEventsPage.hasMoreBefore)
      setTimeline(buildWorkspaceHistoryTimeline(
        historyEventsPage.events.filter((event) => !deletedTurnIds.has(event.turnId)),
      ))

      if (response.runtime) {
        applyWorkspaceSessionRuntime(response.runtime)
      }
    } catch {
      if (!options?.preserveMessagesOnError) {
        setHistoryHasMoreBefore(false)
      }
    }
  }, [
    applyWorkspaceSessionRuntime,
    buildWorkspaceHistoryTimeline,
    queryClient,
    rememberHistoryEvents,
    setHistoryHasMoreBefore,
    setTimeline,
    workspaceId,
    workspaceSessionId,
    workspaceSessionInitialHistoryLimit,
  ])

  const refreshSessionView = useCallback(async (options?: {
    mode?: 'append-after-latest' | 'replace-latest'
    preserveMessagesOnError?: boolean
    limit?: number
    recentTurns?: number
  }) => {
    if (workspaceId && workspaceSessionId) {
      await refreshWorkspaceHistoryView(options)
      return
    }

    const cachedConversation = getCachedTaskConversation(task.id, workspaceId, workspaceSessionId)
    const currentConversationMessages = conversationMessagesRef.current

    try {
      if (options?.mode === 'append-after-latest') {
        const latestMessageId = currentConversationMessages.at(-1)?.id
        if (latestMessageId) {
          const response = await queryClient.fetchQuery({
            queryKey: workspaceQueryKeys.conversation(task.id, workspaceId, workspaceSessionId, `after:${latestMessageId}`),
            queryFn: () => api.getTaskConversation(task.id, workspaceId, workspaceSessionId, {
              afterMessageId: latestMessageId,
            }),
            staleTime: 0,
          })
          const latestLoadedMessageAt = getConversationLatestMessageAt(currentConversationMessages)
          const expectedLatestMessageAt = chatSession?.conversation.latestMessageAt?.trim() || ''
          if (response.messages.length === 0 && expectedLatestMessageAt && expectedLatestMessageAt !== (latestLoadedMessageAt ?? '')) {
            const recentTurns = options?.recentTurns ?? INITIAL_CONVERSATION_TURN_WINDOW
            const fallback = await queryClient.fetchQuery({
              queryKey: workspaceQueryKeys.conversation(task.id, workspaceId, workspaceSessionId, `recent:${recentTurns}`),
              queryFn: () => api.getTaskConversation(task.id, workspaceId, workspaceSessionId, {
                recentTurns,
              }),
              staleTime: 0,
            })
            applyConversationPayload(fallback)
            return
          }

          const nextMessages = appendConversationMessages(currentConversationMessages, response.messages)
          const hasMoreBefore = response.totalMessageCount > nextMessages.length
          conversationMessagesRef.current = nextMessages
          setConversationLoaded(true)
          setConversationHasMoreBefore(hasMoreBefore)
          setConversationMessages(nextMessages)
          const nextPayload = buildConversationPayload(response.conversation, nextMessages, response.totalMessageCount, hasMoreBefore)
          setCachedTaskConversation(task.id, workspaceId, workspaceSessionId, nextPayload)
          queryClient.setQueryData(workspaceQueryKeys.conversation(task.id, workspaceId, workspaceSessionId), nextPayload)
          return
        }
      }

      const recentTurns = options?.recentTurns ?? INITIAL_CONVERSATION_TURN_WINDOW
      const response = await queryClient.fetchQuery({
        queryKey: workspaceQueryKeys.conversation(task.id, workspaceId, workspaceSessionId, `recent:${recentTurns}`),
        queryFn: () => api.getTaskConversation(task.id, workspaceId, workspaceSessionId, {
          recentTurns,
        }),
        staleTime: 0,
      })
      applyConversationPayload(response)
    } catch {
      setConversationLoaded(true)
      setConversationHasMoreBefore(cachedConversation?.hasMoreBefore ?? false)
      if (cachedConversation) {
        conversationMessagesRef.current = cachedConversation.messages
        setConversationMessages(cachedConversation.messages)
        return
      }

      if (!options?.preserveMessagesOnError) {
        conversationMessagesRef.current = []
        setConversationMessages([])
      }
    }
  }, [
    applyConversationPayload,
    chatSession?.conversation.latestMessageAt,
    conversationMessagesRef,
    queryClient,
    refreshWorkspaceHistoryView,
    setConversationHasMoreBefore,
    setConversationLoaded,
    setConversationMessages,
    task.id,
    workspaceId,
    workspaceSessionId,
  ])

  const syncScopedTaskFromState = useCallback((state: AppState, targetWorkspaceSessionId?: string) => {
    const nextTask = resolveUpdatedTaskFromState(state, task.id, workspaceId, targetWorkspaceSessionId)
    if (!nextTask) {
      return null
    }

    if (workspaceId && targetWorkspaceSessionId && onWorkspaceSessionChange) {
      onWorkspaceSessionChange({
        workspaceSessionId: targetWorkspaceSessionId,
        state,
        task: nextTask,
      })
      return nextTask
    }

    onTaskUpdate(nextTask)
    return nextTask
  }, [onTaskUpdate, onWorkspaceSessionChange, task.id, workspaceId])

  const notifySocketIssue = useCallback((rawMessage: string) => {
    const message = normalizeChatErrorMessage(rawMessage || '任务详情对话失败')
    setNotices((prev) => prependNotice(prev, {
      id: crypto.randomUUID(),
      level: 'warning',
      message,
    }))
    toast.error(message)
  }, [setNotices])

  const applyHistoryMessage = useCallback((message: WorkspaceSessionHistoryWsServerMessage) => {
    if (message.type === 'workspace_session_history.snapshot') {
      const previousLastSessionSeq = historyLastSessionSeqRef.current
      const previousKnownEventIds = new Set(historyEventSeqByIdRef.current.keys())
      const newSnapshotEvents = filterKnownWorkspaceSessionHistoryEvents(message.events, previousKnownEventIds)
      const hasNewSnapshotEvents = newSnapshotEvents.length > 0
      traceWorkspaceSessionChat('history-ws-snapshot', {
        taskId: task.id,
        workspaceId,
        workspaceSessionId,
        eventCount: message.events.length,
        newEventCount: newSnapshotEvents.length,
        firstSessionSeq: message.events[0]?.sessionSeq ?? null,
        lastSessionSeq: message.events.at(-1)?.sessionSeq ?? null,
        previousLastSessionSeq,
        hasNewSnapshotEvents,
        hasRuntime: Boolean(message.runtime),
        hasMoreBefore: message.hasMoreBefore ?? null,
        totalCount: message.totalCount ?? null,
      })
      rememberHistoryEvents(newSnapshotEvents)
      const hasMoreBefore = typeof message.hasMoreBefore === 'boolean'
        ? message.hasMoreBefore
        : (message.events[0]?.sessionSeq ?? 1) > 1
      setHistoryHasMoreBefore(hasMoreBefore)
      if (hasNewSnapshotEvents) {
        setTimeline((currentTimeline) => {
          const nextTimeline = buildWorkspaceHistoryTimeline(newSnapshotEvents)
          const hasNewDeletedTurnEvent = newSnapshotEvents.some(isWorkspaceSessionTurnDeletedEvent)
          if (nextTimeline.length === 0) {
            if (hasNewDeletedTurnEvent) {
              return filterDeletedHistoryTimeline(currentTimeline)
            }
            return currentTimeline
          }
          traceWorkspaceSessionChat('timeline-source', {
            source: 'history-ws-snapshot',
            taskId: task.id,
            workspaceId,
            workspaceSessionId,
            currentTimelineLength: currentTimeline.length,
            nextTimelineLength: nextTimeline.length,
            newEventCount: newSnapshotEvents.length,
          })
          return filterDeletedHistoryTimeline(mergeHistorySnapshotTimeline(currentTimeline, nextTimeline))
        })
      } else {
        traceWorkspaceSessionChat('history-ws-snapshot-skip-timeline', {
          taskId: task.id,
          workspaceId,
          workspaceSessionId,
          previousLastSessionSeq,
          eventCount: message.events.length,
          reason: 'known-events',
        })
      }
      if (message.runtime) {
        applyWorkspaceSessionRuntime(message.runtime)
      }
      return
    }

    if (message.type === 'workspace_session_history.event') {
      const historyEvent = message.event
      traceWorkspaceSessionChat('history-ws-event', {
        taskId: task.id,
        workspaceId,
        workspaceSessionId,
        kind: historyEvent.kind,
        sessionSeq: historyEvent.sessionSeq,
        turnSeq: historyEvent.turnSeq,
        turnId: historyEvent.turnId,
      })
      rememberHistoryEvents([historyEvent])
      if (isWorkspaceSessionTurnDeletedEvent(historyEvent)) {
        setTimeline((prev) => prev.filter((event) => event.turnId !== historyEvent.payload.deletedTurnId))
        return
      }

      const [nextTimelineEvent] = buildWorkspaceHistoryTimeline([historyEvent])
      if (nextTimelineEvent) {
        traceWorkspaceSessionChat('timeline-source', {
          source: 'history-ws-event',
          taskId: task.id,
          workspaceId,
          workspaceSessionId,
          kind: nextTimelineEvent.kind,
          eventId: nextTimelineEvent.id,
          turnId: nextTimelineEvent.turnId,
        })
        setTimeline((prev) => upsertTimelineEvent(prev, nextTimelineEvent))
      }
      return
    }

    if (message.type === 'workspace_session_history.runtime') {
      traceWorkspaceSessionChat('history-ws-runtime', {
        taskId: task.id,
        workspaceId,
        workspaceSessionId,
        status: message.runtime.agentRunningStatus,
        runtimeStatus: message.runtime.runtimeStatus,
        lastEventSeq: message.runtime.lastEventSeq,
      })
      applyWorkspaceSessionRuntime(message.runtime)
      return
    }

    if (message.type === 'workspace_session_history.error') {
      notifySocketIssue(message.message)
    }
  }, [
    applyWorkspaceSessionRuntime,
    buildWorkspaceHistoryTimeline,
    filterDeletedHistoryTimeline,
    notifySocketIssue,
    rememberHistoryEvents,
    setHistoryHasMoreBefore,
    setTimeline,
  ])

  const applyIncomingPart = useCallback((part: {
    type: 'data-timeline_event' | 'data-task' | 'data-session' | 'data-notice' | 'data-observation'
    data: unknown
  }) => {
    if (part.type === 'data-timeline_event') {
      const event = part.data as ChatTimelineEvent
      const textLength = event.kind === 'assistant_message'
        ? event.text.length
        : event.kind === 'user_message'
          ? event.text.length
          : event.kind === 'thinking'
            ? event.text.length
            : undefined
      const shouldTraceLiveEvent = typeof textLength !== 'number' || (() => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const previous = liveTextTraceByEventIdRef.current.get(event.id)
        if (
          previous
          && now - previous.at < LIVE_TEXT_TRACE_MIN_INTERVAL_MS
          && Math.abs(textLength - previous.textLength) < LIVE_TEXT_TRACE_MIN_LENGTH_DELTA
        ) {
          return false
        }

        liveTextTraceByEventIdRef.current.set(event.id, { at: now, textLength })
        return true
      })()
      if (shouldTraceLiveEvent) {
        traceWorkspaceSessionChat('task-chat-live-event', {
          taskId: task.id,
          workspaceId,
          workspaceSessionId,
          kind: event.kind,
          eventId: event.id,
          turnId: event.turnId,
          seq: event.seq,
          textLength,
        })
      }
      setTimeline((prev) => upsertTimelineEvent(prev, event))

      if (isStatusEvent(event)) {
        setLiveStatus(event.status)
        setLiveStep(event.step)
        if (!isWorkspaceSessionLiveStatusBusy(event.status)) {
          setLiveTools([])
        }
        setChatSession((current) => reconcileWorkspaceSessionSnapshotFromTaskPart(current, {
          agentRunningStatus: event.status,
          currentStep: event.step,
          needsHumanConfirm: false,
        }))
      }

      if (isToolCallEvent(event)) {
        setLiveTools((prev) => {
          const next = new Map(prev.map((tool) => [tool.id, tool]))
          next.set(event.toolCall.id, event.toolCall)
          return [...next.values()]
        })
      }

      return
    }

    if (part.type === 'data-task') {
      liveSessionRevisionRef.current += 1
      const currentTask = taskRef.current
      const taskPart = part.data as {
        id: string
        agentRunningStatus: AgentRunningStatus
        currentStep: string
        needsHumanConfirm?: boolean
        toolCalls?: ToolCall[]
        logs?: ExecutionLog[]
      }
      const nextTask = {
        ...currentTask,
        ...taskPart,
        toolCalls: taskPart.toolCalls ?? currentTask.toolCalls ?? [],
        logs: taskPart.logs ?? currentTask.logs,
      }
      setLiveStatus(taskPart.agentRunningStatus)
      setLiveStep(taskPart.currentStep)
      setLiveTools(isWorkspaceSessionLiveStatusBusy(taskPart.agentRunningStatus) ? (taskPart.toolCalls ?? []) : [])
      setChatSession((current) => reconcileWorkspaceSessionSnapshotFromTaskPart(current, taskPart))
      onTaskUpdateRef.current(nextTask)
      return
    }

    if (part.type === 'data-session') {
      liveSessionRevisionRef.current += 1
      setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(current, part.data as TaskChatSessionSnapshot))
      return
    }

    if (part.type === 'data-observation') {
      setNotices((prev) => prependNotice(prev, formatObservationNotice(part.data as TaskSubagentObservation)))
      void refreshSessionView({
        mode: conversationMessagesRef.current.length > 0 ? 'append-after-latest' : 'replace-latest',
        preserveMessagesOnError: true,
        recentTurns: INITIAL_CONVERSATION_TURN_WINDOW,
      })
      return
    }

    const noticePart = part.data as NoticeItem
    setNotices((prev) => prependNotice(prev, {
      id: crypto.randomUUID(),
      level: noticePart.level,
      message: noticePart.message,
    }))
  }, [
    conversationMessagesRef,
    onTaskUpdateRef,
    refreshSessionView,
    setChatSession,
    setLiveStatus,
    setLiveStep,
    setLiveTools,
    setNotices,
    setTimeline,
    taskRef,
    liveSessionRevisionRef,
  ])

  const applyChatPart = useCallback((part: TaskChatPart) => {
    const schema = taskChatDataPartSchemas[part.type as keyof typeof taskChatDataPartSchemas]
    if (!schema) {
      return
    }

    const parsed = schema.safeParse(part.data)
    if (!parsed.success) {
      return
    }

    applyIncomingPart({
      type: `data-${part.type}` as 'data-timeline_event' | 'data-task' | 'data-session' | 'data-notice' | 'data-observation',
      data: parsed.data,
    })
  }, [applyIncomingPart])

  const sendSocketMessage = useCallback((message: TaskChatWsClientMessage) => {
    const socket = chatSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      notifySocketIssue(TASK_CHAT_SOCKET_NOT_READY_MESSAGE)
      return false
    }

    socket.send(JSON.stringify(message))
    return true
  }, [chatSocketRef, notifySocketIssue])

  const settlePendingSocketRequest = useCallback((
    requestId: string,
    result:
      | { type: 'resolve'; message: Extract<TaskChatWsServerMessage, { type: 'task_chat.ack' }> }
      | { type: 'reject'; error: Error },
  ) => {
    const pendingRequest = pendingSocketRequestsRef.current.get(requestId)
    if (!pendingRequest) {
      return false
    }

    pendingSocketRequestsRef.current.delete(requestId)
    window.clearTimeout(pendingRequest.timeoutId)

    if (result.type === 'resolve') {
      pendingRequest.resolve(result.message)
    } else {
      pendingRequest.reject(result.error)
    }

    return true
  }, [])

  const rejectAllPendingSocketRequests = useCallback((rawMessage: string) => {
    const message = normalizeChatErrorMessage(rawMessage)
    for (const [requestId, pendingRequest] of pendingSocketRequestsRef.current.entries()) {
      window.clearTimeout(pendingRequest.timeoutId)
      pendingRequest.reject(new Error(message))
      pendingSocketRequestsRef.current.delete(requestId)
    }
  }, [])

  const sendSocketMessageWithAck = useCallback((
    message: TaskChatWsClientMessage & { requestId: string },
  ) => {
    const socket = chatSocketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(TASK_CHAT_SOCKET_NOT_READY_MESSAGE))
    }

    const requestId = message.requestId.trim()
    if (!requestId) {
      return Promise.reject(new Error('缺少实时消息 requestId，无法确认发送结果。'))
    }

    return new Promise<Extract<TaskChatWsServerMessage, { type: 'task_chat.ack' }>>((resolve, reject) => {
      const existingRequest = pendingSocketRequestsRef.current.get(requestId)
      if (existingRequest) {
        window.clearTimeout(existingRequest.timeoutId)
        existingRequest.reject(new Error('上一条实时发送确认已失效，请重试。'))
        pendingSocketRequestsRef.current.delete(requestId)
      }

      const timeoutId = window.setTimeout(() => {
        pendingSocketRequestsRef.current.delete(requestId)
        reject(new Error('发送请求超时，请检查实时连接后重试。'))
      }, TASK_CHAT_ACK_TIMEOUT_MS)

      pendingSocketRequestsRef.current.set(requestId, {
        resolve,
        reject,
        timeoutId,
      })

      try {
        socket.send(JSON.stringify(message))
      } catch (error) {
        settlePendingSocketRequest(requestId, {
          type: 'reject',
          error: new Error(
            normalizeChatErrorMessage(error instanceof Error ? error.message : '实时消息发送失败，请重试。'),
          ),
        })
      }
    })
  }, [chatSocketRef, settlePendingSocketRequest])

  useEffect(() => {
    if (socketResourceStatus !== 'active') {
      setSocketStatus('closed')
      return
    }

    let cancelled = false
    let initialConnectTimer: number | null = null
    let reconnectTimer: number | null = null

    const scheduleReconnect = () => {
      if (cancelled) {
        return
      }

      reconnectTimer = window.setTimeout(() => {
        connect()
      }, 1500)
    }

    const connect = () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
      if (!token) {
        setSocketStatus('error')
        notifySocketIssue('未登录，无法建立任务聊天实时连接。')
        return
      }

      const baseUrl = resolveApiWebSocketUrl(`/api/tasks/${task.id}/chat-ws`)
      const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : undefined)
      url.searchParams.set('token', token)
      if (workspaceId) {
        url.searchParams.set('workspaceId', workspaceId)
      }
      if (workspaceSessionId) {
        url.searchParams.set('workspaceSessionId', workspaceSessionId)
      }
      if (socketLastEventIdRef.current) {
        url.searchParams.set('lastEventId', socketLastEventIdRef.current)
      }

      const socket = new WebSocket(url.toString())
      let awaitingInitialSubscription = true
      chatSocketRef.current = socket
      setSocketStatus('connecting')

      socket.addEventListener('open', () => {
        if (cancelled) {
          socket.close()
          return
        }

        setSocketStatus('open')
      })

      socket.addEventListener('message', (event) => {
        let message: TaskChatWsServerMessage

        try {
          message = parseWorkspaceSessionChatWsMessage(String(event.data))
        } catch {
          return
        }

        if (message.type === 'task_chat.event') {
          socketLastEventIdRef.current = message.eventId
        }

        if (message.type === 'task_chat.subscribed') {
          awaitingInitialSubscription = false
          return
        }

        const chatPart = getWorkspaceSessionChatWsPart(message)
        if (chatPart) {
          if (shouldApplyTaskChatWsStreamMessage(message, awaitingInitialSubscription)) {
            applyChatPart(chatPart)
          }
          return
        }

        if (message.type === 'task_chat.ack') {
          const handledPendingRequest = settlePendingSocketRequest(message.requestId, message.status === 'error'
            ? {
                type: 'reject',
                error: new Error(normalizeChatErrorMessage(message.message || '消息发送失败，请稍后重试。')),
              }
            : {
                type: 'resolve',
                message,
              })
          if (handledPendingRequest) {
            return
          }

          const ackMessage = message.message
          if ((message.status === 'queued' || message.status === 'noop') && ackMessage) {
            setNotices((prev) => prependNotice(prev, {
              id: crypto.randomUUID(),
              level: 'info',
              message: ackMessage,
            }))
          }
          if (message.status === 'error' && ackMessage) {
            notifySocketIssue(ackMessage)
          }
          return
        }

        if (message.type === 'task_chat.error') {
          if (message.requestId) {
            const handledPendingRequest = settlePendingSocketRequest(message.requestId, {
              type: 'reject',
              error: new Error(normalizeChatErrorMessage(message.message || '任务详情对话失败')),
            })
            if (handledPendingRequest) {
              return
            }
          }

          notifySocketIssue(message.message)
        }
      })

      socket.addEventListener('close', () => {
        if (chatSocketRef.current === socket) {
          chatSocketRef.current = null
        }
        rejectAllPendingSocketRequests('实时连接已断开，请重试。')
        if (cancelled) {
          return
        }

        setSocketStatus('closed')
        scheduleReconnect()
      })

      socket.addEventListener('error', () => {
        if (cancelled) {
          return
        }

        setSocketStatus('error')
      })
    }

    // In React 18 StrictMode dev builds, effects mount/unmount once before the real mount.
    // Deferring the first socket creation avoids opening a connection that gets closed during that probe.
    initialConnectTimer = window.setTimeout(() => {
      initialConnectTimer = null
      connect()
    }, 0)

    return () => {
      cancelled = true
      liveTextTraceByEventIdRef.current.clear()
      if (initialConnectTimer) {
        window.clearTimeout(initialConnectTimer)
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }
      rejectAllPendingSocketRequests('实时连接已断开，请重试。')
      chatSocketRef.current?.close()
      chatSocketRef.current = null
    }
  }, [
    applyChatPart,
    chatSocketRef,
    notifySocketIssue,
    rejectAllPendingSocketRequests,
    settlePendingSocketRequest,
    setNotices,
    setSocketStatus,
    socketLastEventIdRef,
    socketResourceStatus,
    task.id,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    if (socketResourceStatus !== 'active' || !workspaceId || !workspaceSessionId) {
      return
    }

    let cancelled = false
    let initialConnectTimer: number | null = null
    let reconnectTimer: number | null = null
    let socket: WebSocket | null = null

    const scheduleReconnect = () => {
      if (cancelled) {
        return
      }
      reconnectTimer = window.setTimeout(connect, 1500)
    }

    const connect = () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
      if (!token) {
        return
      }

      const baseUrl = resolveApiWebSocketUrl(`/api/workspaces/${workspaceId}/sessions/${workspaceSessionId}/history-ws`)
      const url = new URL(baseUrl, typeof window !== 'undefined' ? window.location.origin : undefined)
      url.searchParams.set('token', token)
      if (historyLastSessionSeqRef.current > 0) {
        url.searchParams.set('lastSessionSeq', String(historyLastSessionSeqRef.current))
      } else {
        url.searchParams.set('limit', String(workspaceSessionInitialHistoryLimit))
      }
      url.searchParams.set('visibility', 'transcript')

      socket = new WebSocket(url.toString())
      socket.addEventListener('message', (event) => {
        let message: WorkspaceSessionHistoryWsServerMessage
        try {
          message = parseWorkspaceSessionHistoryWsMessage(String(event.data))
        } catch {
          return
        }
        applyHistoryMessage(message)
      })
      socket.addEventListener('close', () => {
        if (cancelled) {
          return
        }
        scheduleReconnect()
      })
    }

    initialConnectTimer = window.setTimeout(() => {
      initialConnectTimer = null
      connect()
    }, 0)

    return () => {
      cancelled = true
      if (initialConnectTimer) {
        window.clearTimeout(initialConnectTimer)
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [
    applyHistoryMessage,
    historyLastSessionSeqRef,
    socketResourceStatus,
    workspaceSessionInitialHistoryLimit,
    workspaceId,
    workspaceSessionId,
  ])

  return {
    applyConversationPayload,
    buildWorkspaceHistoryTimeline,
    notifySocketIssue,
    prependHistoryEvents,
    refreshSessionView,
    refreshWorkspaceHistoryView,
    rememberHistoryEvents,
    resolveHistorySessionSeq,
    sendSocketMessage,
    sendSocketMessageWithAck,
    syncScopedTaskFromState,
    syncTaskRuntime,
  }
}
