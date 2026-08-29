// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: workspace-session props, cached/remote runtime snapshots, and transcript synchronization state
// OUTPUT: scoped runtime/timeline synchronization effects with live-state conflict resolution
// POS: synchronization boundary between /workspaces session state and the live chat surface

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import {
  isWorkspaceSessionTurnDeletedEvent,
  type WorkspaceSessionRuntimeSnapshot,
  type WorkspaceSessionEventRecord,
} from '@shared/workspace-session-history'
import type {
  AgentRunningStatus,
  ExecutionModelOption,
  Task,
  WorkspaceSession,
  ToolCall,
} from '@shared/types'
import type { AgentRecord, ConversationMessageRecord } from '../../../lib/api'
import { api } from '../../../lib/api'
import { workspaceQueryKeys } from '../../../lib/workspace-query-keys'
import { getCachedTaskConversation } from '../../../lib/workspace-session-chat-cache'
import { loadAvailableAgents } from '../../../lib/use-available-agents'
import {
  mapConversationMessagesToTimelineEvents,
  mapTaskToTimelineEvents,
  type ChatTimelineEvent,
} from '../../../lib/workspace-session-chat-ui'
import {
  conversationContainsLatestMessage,
  INITIAL_CONVERSATION_TURN_WINDOW,
  isConversationCacheFresh,
  resolveIncomingTaskChatSessionSnapshot,
} from '../../../lib/thread/thread-merge'
import { prependNotice, type NoticeItem, type TimelineTurnDisplay } from './workspace-session-chat-helpers'
import {
  resolveTimelineAutoScrollMode,
  shouldResolvePendingInitialScroll,
  useWorkspaceSessionTranscriptScrollController,
} from './workspace-session-chat-transcript-scroll'
import { traceWorkspaceSessionChat } from './workspace-session-chat-trace'
import type { WorkspaceSessionChatProps } from './workspace-session-chat-types'

export {
  resolveTimelineAutoScrollMode,
  shouldResolvePendingInitialScroll,
} from './workspace-session-chat-transcript-scroll'

const MODEL_OPTIONS_CACHE_TTL_MS = 60_000
const RUNTIME_MODEL_REFRESH_DELAY_MS = 2_000
const WORKSPACE_SESSION_CHAT_REST_CACHE_TTL_MS = 10_000

type TaskChatSyncEffectsParams = Pick<
  WorkspaceSessionChatProps,
  | 'onTaskUpdate'
  | 'open'
  | 'task'
  | 'workspaceId'
  | 'workspaceSession'
  | 'workspaceSessionId'
> & {
  applyCachedSession: TaskChatSessionSnapshot | null
  applyConversationPayload: (payload: Awaited<ReturnType<typeof api.getTaskConversation>>) => void
  autoScrollToBottom: (mode?: 'instant' | 'smooth') => void
  chatSession: TaskChatSessionSnapshot | null
  conversationCountRef: MutableRefObject<number | null>
  conversationLoaded: boolean
  conversationMessages: ConversationMessageRecord[]
  displayStatus: string
  displayStep: string
  displayTimeline: TimelineTurnDisplay[]
  historyLastSessionSeqRef: MutableRefObject<number>
  injectedTesterContextIdsRef: MutableRefObject<string[]>
  isSessionBusy: boolean
  liveSessionRevisionRef: MutableRefObject<number>
  messageScopeRef: MutableRefObject<string>
  modelAgentType: Task['agentType']
  modelExecutorId: string
  noticesLength: number
  onTaskUpdateRef: MutableRefObject<(task: Task) => void>
  preflightOpen: boolean
  queuedMessagesLength: number
  rememberHistoryEvents: (events: WorkspaceSessionEventRecord[]) => void
  refreshSessionView: (options?: {
    mode?: 'append-after-latest' | 'replace-latest'
    preserveMessagesOnError?: boolean
    limit?: number
    recentTurns?: number
  }) => Promise<void>
  buildWorkspaceHistoryTimeline: (events: WorkspaceSessionEventRecord[]) => ChatTimelineEvent[]
  resetTimeline: () => void
  resumeAutoScroll: () => void
  scrollToBottom: (behavior?: 'instant' | 'smooth') => void
  setAvailableAgents: Dispatch<SetStateAction<AgentRecord[]>>
  setChatSession: Dispatch<SetStateAction<TaskChatSessionSnapshot | null>>
  setConversationHasMoreBefore: Dispatch<SetStateAction<boolean>>
  setConversationLoaded: Dispatch<SetStateAction<boolean>>
  setConversationMessages: Dispatch<SetStateAction<ConversationMessageRecord[]>>
  setDefaultModel: Dispatch<SetStateAction<string>>
  setHistoryHasMoreBefore: Dispatch<SetStateAction<boolean>>
  setInitialTranscriptReady: Dispatch<SetStateAction<boolean>>
  setLiveStatus: Dispatch<SetStateAction<AgentRunningStatus>>
  setLiveStep: Dispatch<SetStateAction<string>>
  setLiveTools: Dispatch<SetStateAction<ToolCall[]>>
  setModelLoading: Dispatch<SetStateAction<boolean>>
  setModelOptions: Dispatch<SetStateAction<ExecutionModelOption[]>>
  setNotices: Dispatch<SetStateAction<NoticeItem[]>>
  setPreflightModel: Dispatch<SetStateAction<string>>
  setSocketStatus: Dispatch<SetStateAction<'connecting' | 'open' | 'closed' | 'error'>>
  setTimeline: Dispatch<SetStateAction<ChatTimelineEvent[]>>
  socketLastEventIdRef: MutableRefObject<string | null>
  socketStatus: 'connecting' | 'open' | 'closed' | 'error'
  systemLogsLength: number
  taskRef: MutableRefObject<Task>
  workspaceSessionInitialHistoryLimit: number
}

export const shouldPreserveLiveTimeline = (
  currentTimeline: ChatTimelineEvent[],
  nextTimeline: ChatTimelineEvent[],
) => {
  if (currentTimeline.length === 0) {
    return false
  }

  // Keep richer live events until persisted history catches up, otherwise
  // a stale HTTP/session snapshot can erase a just-streamed assistant reply.
  return currentTimeline.some((event) => event.kind !== 'status' && !isTimelineEventCoveredByHistory(event, nextTimeline))
}

const resolveTimelineEventStableSignature = (event: ChatTimelineEvent) => {
  if (event.kind === 'user_message') {
    return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.messageId}|${event.text}`
  }

  if (event.kind === 'assistant_message') {
    return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.messageId}|${event.text}`
  }

  if (event.kind === 'system_message' || event.kind === 'delivery_result' || event.kind === 'error') {
    return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.message}`
  }

  if (event.kind === 'thinking') {
    return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.partId}|${event.text}`
  }

  if (event.kind === 'tool_call') {
    return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.toolCall.id}|${event.toolCall.finishedAt ?? ''}`
  }

  if (event.kind === 'interaction') {
    return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.interaction.id}|${event.interaction.status}|${event.interaction.title}|${event.interaction.prompt ?? ''}`
  }

  return `${event.id}|${event.kind}|${event.turnId}|${event.seq}|${event.status}|${event.step}`
}

export const areTimelineEventsRenderEquivalent = (
  currentTimeline: ChatTimelineEvent[],
  nextTimeline: ChatTimelineEvent[],
) => {
  if (currentTimeline.length !== nextTimeline.length) {
    return false
  }

  return currentTimeline.every((event, index) => {
    const nextEvent = nextTimeline[index]
    return nextEvent
      ? resolveTimelineEventStableSignature(event) === resolveTimelineEventStableSignature(nextEvent)
      : false
  })
}

const normalizeTimelineText = (value: string) => value.trim().replace(/\s+/g, ' ')

const isTimelineEventCoveredByHistory = (
  event: ChatTimelineEvent,
  nextTimeline: ChatTimelineEvent[],
) => {
  if (nextTimeline.some((item) => item.id === event.id)) {
    return true
  }

  if (event.kind === 'user_message') {
    const eventText = normalizeTimelineText(event.text)
    return nextTimeline.some((item) => {
      return item.kind === 'user_message'
        && normalizeTimelineText(item.text) === eventText
    })
  }

  if (event.kind === 'assistant_message') {
    const eventText = normalizeTimelineText(event.text)
    return nextTimeline.some((item) => {
      return item.kind === 'assistant_message'
        && item.turnId === event.turnId
        && normalizeTimelineText(item.text) === eventText
    })
  }

  if (event.kind === 'thinking') {
    const eventText = normalizeTimelineText(event.text)
    return nextTimeline.some((item) => {
      return item.kind === 'thinking'
        && item.turnId === event.turnId
        && (item.partId === event.partId || normalizeTimelineText(item.text) === eventText)
    })
  }

  if (event.kind === 'tool_call') {
    return nextTimeline.some((item) => item.kind === 'tool_call' && item.toolCall.id === event.toolCall.id)
  }

  if (event.kind === 'interaction') {
    return nextTimeline.some((item) => {
      return item.kind === 'interaction'
        && item.turnId === event.turnId
        && item.interaction.id === event.interaction.id
    })
  }

  if (event.kind === 'error') {
    return nextTimeline.some((item) => {
      return item.kind === 'error'
        && item.turnId === event.turnId
        && normalizeTimelineText(item.message) === normalizeTimelineText(event.message)
    })
  }

  return false
}

type WorkspaceSessionHistorySnapshotResult =
  | { status: 'fulfilled'; value: Awaited<ReturnType<typeof api.getWorkspaceSessionSnapshot>> }
  | { status: 'rejected'; reason: unknown }

export const resolveHydratedTaskChatSessionSnapshot = (params: {
  currentSnapshot: TaskChatSessionSnapshot | null
  fetchedSnapshot: TaskChatSessionSnapshot
  requestLiveSessionRevision: number
  currentLiveSessionRevision: number
}) => {
  if (params.requestLiveSessionRevision !== params.currentLiveSessionRevision) {
    return params.currentSnapshot
  }

  return params.fetchedSnapshot
}

export const resolveHydratedWorkspaceSessionRuntimeSnapshot = (params: {
  fetchedRuntime: WorkspaceSessionRuntimeSnapshot
  requestLiveSessionRevision: number
  currentLiveSessionRevision: number
}) => {
  if (params.requestLiveSessionRevision !== params.currentLiveSessionRevision) {
    return null
  }

  return params.fetchedRuntime
}

export const resolveScopedLiveRuntimeState = (params: {
  task: Task
  workspaceSession?: WorkspaceSession | null
  cachedSessionSnapshot: TaskChatSessionSnapshot | null
  workspaceSessionId?: string
}) => {
  const { cachedSessionSnapshot, task, workspaceSession, workspaceSessionId } = params

  if (workspaceSessionId) {
    if (workspaceSession) {
      return {
        status: workspaceSession.agentRunningStatus,
        step: workspaceSession.currentStep,
        tools: [] as ToolCall[],
      }
    }

    if (cachedSessionSnapshot?.runtime) {
      return {
        status: cachedSessionSnapshot.runtime.agentRunningStatus,
        step: cachedSessionSnapshot.runtime.currentStep,
        tools: [] as ToolCall[],
      }
    }
  }

  return {
    status: task.agentRunningStatus,
    step: task.currentStep,
    tools: task.toolCalls ?? [],
  }
}

export const shouldApplyScopedLiveRuntimeState = (params: {
  currentSessionBusy: boolean
  nextStatus: AgentRunningStatus
}) => {
  return !params.currentSessionBusy
    || params.nextStatus === 'complete'
    || params.nextStatus === 'error'
}

export function useTaskChatSyncEffects({
  applyCachedSession,
  applyConversationPayload,
  autoScrollToBottom,
  chatSession,
  conversationCountRef,
  conversationLoaded,
  conversationMessages,
  displayStatus,
  displayStep,
  displayTimeline,
  historyLastSessionSeqRef,
  injectedTesterContextIdsRef,
  isSessionBusy,
  liveSessionRevisionRef,
  messageScopeRef,
  modelAgentType,
  modelExecutorId,
  noticesLength,
  onTaskUpdate,
  onTaskUpdateRef,
  open,
  preflightOpen,
  queuedMessagesLength,
  rememberHistoryEvents,
  refreshSessionView,
  buildWorkspaceHistoryTimeline,
  resetTimeline,
  resumeAutoScroll,
  scrollToBottom,
  setAvailableAgents,
  setChatSession,
  setConversationHasMoreBefore,
  setConversationLoaded,
  setConversationMessages,
  setDefaultModel,
  setHistoryHasMoreBefore,
  setInitialTranscriptReady,
  setLiveStatus,
  setLiveStep,
  setLiveTools,
  setModelLoading,
  setModelOptions,
  setNotices,
  setPreflightModel,
  setSocketStatus,
  setTimeline,
  socketLastEventIdRef,
  socketStatus,
  systemLogsLength,
  task,
  taskRef,
  workspaceSessionInitialHistoryLimit,
  workspaceId,
  workspaceSession,
  workspaceSessionId,
}: TaskChatSyncEffectsParams) {
  const queryClient = useQueryClient()
  const workspaceHistorySnapshotRequestRef = useRef(new Map<string, Promise<WorkspaceSessionHistorySnapshotResult>>())
  const refreshSessionViewRef = useRef(refreshSessionView)
  const conversationMessagesRef = useRef(conversationMessages)
  conversationMessagesRef.current = conversationMessages
  const workspaceHistoryHydrationScopeKey = `${task.id}:${workspaceId || 'default'}:${workspaceSessionId || 'latest'}`
  const initialWorkspaceHistoryHydrationScopeKeyRef = useRef(workspaceHistoryHydrationScopeKey)
  const [initialWorkspaceHistoryHydrated, setInitialWorkspaceHistoryHydrated] = useState(() => !(workspaceId && workspaceSessionId))
  const hasResolvedInitialWorkspaceHistory = !workspaceId || !workspaceSessionId
    || (
      initialWorkspaceHistoryHydrationScopeKeyRef.current === workspaceHistoryHydrationScopeKey
      && initialWorkspaceHistoryHydrated
    )

  useEffect(() => {
    refreshSessionViewRef.current = refreshSessionView
  }, [refreshSessionView])

  useEffect(() => {
    taskRef.current = task
  }, [task, taskRef])

  useEffect(() => {
    onTaskUpdateRef.current = onTaskUpdate
  }, [onTaskUpdate, onTaskUpdateRef])

  useEffect(() => {
    let cancelled = false

    const loadAgents = async () => {
      try {
        const agents = await loadAvailableAgents()
        if (!cancelled) {
          setAvailableAgents(agents.filter((agent) => agent.type.trim().toLowerCase() !== 'main'))
        }
      } catch {
        if (!cancelled) {
          setAvailableAgents([])
        }
      }
    }

    void loadAgents()

    return () => {
      cancelled = true
    }
  }, [setAvailableAgents])

  useEffect(() => {
    initialWorkspaceHistoryHydrationScopeKeyRef.current = workspaceHistoryHydrationScopeKey
    setInitialWorkspaceHistoryHydrated(!(workspaceId && workspaceSessionId))
  }, [workspaceHistoryHydrationScopeKey, workspaceId, workspaceSessionId])

  useWorkspaceSessionTranscriptScrollController({
    autoScrollToBottom,
    conversationLoaded,
    conversationMessageCount: conversationMessages.length,
    displayStatus,
    displayStep,
    displayTimeline,
    hasResolvedInitialWorkspaceHistory,
    isWorkspaceHistoryMode: Boolean(workspaceId && workspaceSessionId),
    isSessionBusy,
    noticesLength,
    open,
    queuedMessagesLength,
    resumeAutoScroll,
    scrollToBottom,
    setInitialTranscriptReady,
    systemLogsLength,
    taskId: task.id,
    workspaceId,
    workspaceSessionId,
  })

  useEffect(() => {
    const nextScope = `${task.id}:${workspaceId || 'default'}:${workspaceSessionId || 'latest'}`
    if (messageScopeRef.current === nextScope) {
      return
    }

    traceWorkspaceSessionChat('scope-change-reset', {
      taskId: task.id,
      workspaceId,
      workspaceSessionId,
      previousScope: messageScopeRef.current,
      nextScope,
      taskStatus: task.agentRunningStatus,
      workspaceSessionStatus: workspaceSession?.agentRunningStatus,
    })
    messageScopeRef.current = nextScope
    conversationCountRef.current = null
    socketLastEventIdRef.current = null
    liveSessionRevisionRef.current = 0
    injectedTesterContextIdsRef.current = []
    setSocketStatus('closed')
    const nextLiveRuntime = resolveScopedLiveRuntimeState({
      cachedSessionSnapshot: applyCachedSession,
      task,
      workspaceSession,
      workspaceSessionId,
    })
    setLiveStatus(nextLiveRuntime.status)
    setLiveStep(nextLiveRuntime.step)
    setLiveTools(nextLiveRuntime.tools)
    resetTimeline()
  }, [
    applyCachedSession,
    conversationCountRef,
    injectedTesterContextIdsRef,
    liveSessionRevisionRef,
    messageScopeRef,
    resetTimeline,
    setSocketStatus,
    setLiveStatus,
    setLiveStep,
    setLiveTools,
    socketLastEventIdRef,
    task.id,
    task.agentRunningStatus,
    task.currentStep,
    task.toolCalls,
    workspaceId,
    workspaceSession,
    workspaceSessionId,
  ])

  useEffect(() => {
    if (isSessionBusy) {
      return
    }

    if (workspaceId && workspaceSessionId) {
      return
    }

    if (conversationLoaded) {
      if (!conversationContainsLatestMessage(conversationMessages, chatSession)) {
        return
      }

      const nextTimeline = mapConversationMessagesToTimelineEvents(conversationMessages)
      traceWorkspaceSessionChat('timeline-source', {
        source: 'legacy-conversation',
        taskId: task.id,
        workspaceId,
        workspaceSessionId,
        nextTimelineLength: nextTimeline.length,
        conversationMessageCount: conversationMessages.length,
        hasResolvedInitialWorkspaceHistory,
      })
      setTimeline((currentTimeline) => {
        if (shouldPreserveLiveTimeline(currentTimeline, nextTimeline)) {
          return currentTimeline
        }

        return areTimelineEventsRenderEquivalent(currentTimeline, nextTimeline)
          ? currentTimeline
          : nextTimeline
      })
      return
    }

    const nextTimeline = mapTaskToTimelineEvents(task, workspaceId, workspaceSessionId)
    traceWorkspaceSessionChat('timeline-source', {
      source: 'task-fallback',
      taskId: task.id,
      workspaceId,
      workspaceSessionId,
      nextTimelineLength: nextTimeline.length,
      hasResolvedInitialWorkspaceHistory,
    })
    setTimeline((currentTimeline) => {
      if (shouldPreserveLiveTimeline(currentTimeline, nextTimeline)) {
        return currentTimeline
      }

      return areTimelineEventsRenderEquivalent(currentTimeline, nextTimeline)
        ? currentTimeline
        : nextTimeline
    })
  }, [
    chatSession,
    conversationLoaded,
    conversationMessages,
    hasResolvedInitialWorkspaceHistory,
    isSessionBusy,
    setTimeline,
    task,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    const nextLiveRuntime = resolveScopedLiveRuntimeState({
      cachedSessionSnapshot: chatSession,
      task,
      workspaceSession,
      workspaceSessionId,
    })
    if (!shouldApplyScopedLiveRuntimeState({
      currentSessionBusy: isSessionBusy,
      nextStatus: nextLiveRuntime.status,
    })) {
      return
    }

    setLiveStatus(nextLiveRuntime.status)
    setLiveStep(nextLiveRuntime.step)
    setLiveTools(nextLiveRuntime.tools)
  }, [
    chatSession,
    isSessionBusy,
    setLiveStatus,
    setLiveStep,
    setLiveTools,
    task,
    workspaceSession,
    workspaceSessionId,
  ])

  useEffect(() => {
    let cancelled = false
    const cachedConversation = getCachedTaskConversation(task.id, workspaceId, workspaceSessionId)

    setConversationLoaded(Boolean(cachedConversation))
    setConversationHasMoreBefore(cachedConversation?.hasMoreBefore ?? false)
    setConversationMessages(cachedConversation?.messages ?? [])
    setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(current, applyCachedSession))

    const loadConversationAndSession = async () => {
      const requestLiveSessionRevision = liveSessionRevisionRef.current
      if (workspaceId && workspaceSessionId) {
        const historyOptionsKey = `initial:${workspaceSessionInitialHistoryLimit}`
        const historyRequestScopeKey = `${workspaceHistoryHydrationScopeKey}:${historyOptionsKey}`
        let historySnapshotRequest = workspaceHistorySnapshotRequestRef.current.get(historyRequestScopeKey)
        if (!historySnapshotRequest) {
          traceWorkspaceSessionChat('rest-history-request', {
            taskId: task.id,
            workspaceId,
            workspaceSessionId,
            limit: workspaceSessionInitialHistoryLimit,
            hasCachedConversation: Boolean(cachedConversation),
          })
          historySnapshotRequest = queryClient.fetchQuery({
            queryKey: workspaceQueryKeys.historySnapshot(workspaceId, workspaceSessionId, historyOptionsKey),
            queryFn: () => api.getWorkspaceSessionSnapshot(workspaceId, workspaceSessionId, {
              limit: workspaceSessionInitialHistoryLimit,
              visibility: 'transcript',
            }),
            staleTime: WORKSPACE_SESSION_CHAT_REST_CACHE_TTL_MS,
          }).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          )
          workspaceHistorySnapshotRequestRef.current.set(historyRequestScopeKey, historySnapshotRequest)
          void historySnapshotRequest.finally(() => {
            if (workspaceHistorySnapshotRequestRef.current.get(historyRequestScopeKey) === historySnapshotRequest) {
              workspaceHistorySnapshotRequestRef.current.delete(historyRequestScopeKey)
            }
          })
        } else {
          traceWorkspaceSessionChat('rest-history-request-join', {
            taskId: task.id,
            workspaceId,
            workspaceSessionId,
            limit: workspaceSessionInitialHistoryLimit,
          })
        }

        const historySnapshotResult = await historySnapshotRequest

        if (cancelled) {
          return
        }

        const historyEventsPage = historySnapshotResult.status === 'fulfilled'
          ? historySnapshotResult.value.history
          : null
        traceWorkspaceSessionChat('rest-history-result', {
          taskId: task.id,
          workspaceId,
          workspaceSessionId,
          status: historySnapshotResult.status,
          eventCount: historyEventsPage?.events.length ?? 0,
          firstSessionSeq: historyEventsPage?.events[0]?.sessionSeq ?? null,
          lastSessionSeq: historyEventsPage?.events.at(-1)?.sessionSeq ?? null,
          hasRuntime: historySnapshotResult.status === 'fulfilled'
            ? Boolean(historySnapshotResult.value.runtime)
            : false,
        })
        if (historyEventsPage) {
          rememberHistoryEvents(historyEventsPage.events)
          const historyTimeline = buildWorkspaceHistoryTimeline(historyEventsPage.events)
          traceWorkspaceSessionChat('timeline-source', {
            source: 'rest-history',
            taskId: task.id,
            workspaceId,
            workspaceSessionId,
            nextTimelineLength: historyTimeline.length,
            eventCount: historyEventsPage.events.length,
            lastSessionSeq: historyEventsPage.events.at(-1)?.sessionSeq ?? null,
          })
          setTimeline((currentTimeline) => {
            if (shouldPreserveLiveTimeline(currentTimeline, historyTimeline)) {
              return currentTimeline
            }

            return areTimelineEventsRenderEquivalent(currentTimeline, historyTimeline)
              ? currentTimeline
              : historyTimeline
          })
          historyLastSessionSeqRef.current = Math.max(
            historyLastSessionSeqRef.current,
            historyEventsPage.events.at(-1)?.sessionSeq ?? 0,
          )
          setConversationHasMoreBefore(historyEventsPage.hasMoreBefore)
          setHistoryHasMoreBefore(historyEventsPage.hasMoreBefore)
        }
        if (historySnapshotResult.status === 'fulfilled' && historySnapshotResult.value.runtime) {
          const hydratedRuntime = resolveHydratedWorkspaceSessionRuntimeSnapshot({
            fetchedRuntime: historySnapshotResult.value.runtime,
            requestLiveSessionRevision,
            currentLiveSessionRevision: liveSessionRevisionRef.current,
          })
          if (hydratedRuntime) {
            setLiveStatus(hydratedRuntime.agentRunningStatus)
            setLiveStep(hydratedRuntime.currentStep)
            setLiveTools(hydratedRuntime.activeToolCalls ?? [])
          }
        }

        if (!cancelled) {
          setInitialWorkspaceHistoryHydrated(true)
        }
        if (!cachedConversation) {
          setConversationLoaded(true)
          setConversationHasMoreBefore(false)
          setConversationMessages([])
        }
        setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(current, applyCachedSession))
        return
      } else {
        setInitialWorkspaceHistoryHydrated(true)
      }

      if (!cachedConversation) {
        const conversationOptionsKey = `recent:${INITIAL_CONVERSATION_TURN_WINDOW}`
        const [conversationResult, sessionResult] = await Promise.allSettled([
          queryClient.fetchQuery({
            queryKey: workspaceQueryKeys.conversation(task.id, workspaceId, workspaceSessionId, conversationOptionsKey),
            queryFn: () => api.getTaskConversation(task.id, workspaceId, workspaceSessionId, {
              recentTurns: INITIAL_CONVERSATION_TURN_WINDOW,
            }),
            staleTime: WORKSPACE_SESSION_CHAT_REST_CACHE_TTL_MS,
          }),
          queryClient.fetchQuery({
            queryKey: workspaceQueryKeys.chatSession(task.id, workspaceId, workspaceSessionId),
            queryFn: () => api.getTaskChatSession(task.id, workspaceId, workspaceSessionId),
            staleTime: WORKSPACE_SESSION_CHAT_REST_CACHE_TTL_MS,
          }),
        ])

        if (cancelled) {
          return
        }

        if (conversationResult.status === 'fulfilled') {
          applyConversationPayload(conversationResult.value)
        } else {
          setConversationLoaded(true)
          setConversationHasMoreBefore(false)
          setConversationMessages([])
        }

        if (sessionResult.status === 'fulfilled') {
          setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(
            current,
            resolveHydratedTaskChatSessionSnapshot({
              currentSnapshot: current,
              fetchedSnapshot: sessionResult.value,
              requestLiveSessionRevision,
              currentLiveSessionRevision: liveSessionRevisionRef.current,
            }),
          ))
        } else if (requestLiveSessionRevision === liveSessionRevisionRef.current) {
          setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(current, applyCachedSession))
        }
        return
      }

      let sessionSnapshot = applyCachedSession
      try {
        sessionSnapshot = await queryClient.fetchQuery({
          queryKey: workspaceQueryKeys.chatSession(task.id, workspaceId, workspaceSessionId),
          queryFn: () => api.getTaskChatSession(task.id, workspaceId, workspaceSessionId),
          staleTime: WORKSPACE_SESSION_CHAT_REST_CACHE_TTL_MS,
        })
      } catch {
        sessionSnapshot = applyCachedSession
      }

      if (cancelled) {
        return
      }

      if (sessionSnapshot) {
        setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(
          current,
          resolveHydratedTaskChatSessionSnapshot({
            currentSnapshot: current,
            fetchedSnapshot: sessionSnapshot,
            requestLiveSessionRevision,
            currentLiveSessionRevision: liveSessionRevisionRef.current,
          }),
        ))
      } else {
        setChatSession((current) => resolveIncomingTaskChatSessionSnapshot(current, sessionSnapshot))
      }

      if (isConversationCacheFresh(cachedConversation, sessionSnapshot)) {
        return
      }

      await refreshSessionViewRef.current({
        mode: cachedConversation.messages.length > 0 ? 'append-after-latest' : 'replace-latest',
        preserveMessagesOnError: true,
        recentTurns: INITIAL_CONVERSATION_TURN_WINDOW,
      })

      if (cancelled) {
        return
      }
    }

    void loadConversationAndSession()

    return () => {
      cancelled = true
    }
  }, [
    applyCachedSession,
    applyConversationPayload,
    buildWorkspaceHistoryTimeline,
    liveSessionRevisionRef,
    rememberHistoryEvents,
    queryClient,
    setChatSession,
    setConversationHasMoreBefore,
    setConversationLoaded,
    setConversationMessages,
    setHistoryHasMoreBefore,
    setLiveStatus,
    setLiveStep,
    setLiveTools,
    task.id,
    workspaceHistoryHydrationScopeKey,
    workspaceSessionInitialHistoryLimit,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    if (workspaceId && workspaceSessionId) {
      return
    }

    const messageCount = chatSession?.conversation.messageCount
    if (!conversationLoaded || typeof messageCount !== 'number') {
      return
    }

    const previousMessageCount = conversationCountRef.current
    conversationCountRef.current = messageCount

    if (!conversationContainsLatestMessage(conversationMessages, chatSession)) {
      void refreshSessionView({
        mode: conversationMessages.length > 0 ? 'append-after-latest' : 'replace-latest',
        preserveMessagesOnError: true,
        recentTurns: INITIAL_CONVERSATION_TURN_WINDOW,
      })
      return
    }

    if (previousMessageCount === null || messageCount <= previousMessageCount || socketStatus !== 'open') {
      return
    }

    void refreshSessionView({
      mode: conversationMessages.length > 0 ? 'append-after-latest' : 'replace-latest',
      preserveMessagesOnError: true,
      recentTurns: INITIAL_CONVERSATION_TURN_WINDOW,
    })
  }, [
    chatSession,
    chatSession?.conversation.messageCount,
    conversationCountRef,
    conversationLoaded,
    conversationMessages,
    refreshSessionView,
    socketStatus,
    workspaceId,
    workspaceSessionId,
  ])

  useEffect(() => {
    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined

    // 首次返回带 runtimePending 时，worker 运行时模型仍在后台导出：
    // 稍后带 waitRuntime 补拉一次完整列表（不阻塞 UI，失败则保留模型库内容）。
    const scheduleRuntimeModelRefresh = () => {
      if (refreshTimer) {
        return
      }
      refreshTimer = setTimeout(() => {
        if (cancelled) {
          return
        }
        void api.listAgentModels(modelAgentType, modelExecutorId || undefined, { waitRuntime: true })
          .then((refreshed) => {
            if (cancelled || refreshed.runtimePending) {
              return
            }
            queryClient.setQueryData(
              workspaceQueryKeys.agentModels(modelAgentType, modelExecutorId || undefined),
              refreshed,
            )
            setModelOptions(refreshed.models)
            setDefaultModel(refreshed.defaultModel ?? '')
            if (preflightOpen) {
              setPreflightModel((current) => resolveMatchingAgentExecutionModelOptionId(modelAgentType, refreshed.models, current))
            }
          })
          .catch(() => {
            // 保持模型库列表；下次切换 Agent/执行节点时会重新加载。
          })
      }, RUNTIME_MODEL_REFRESH_DELAY_MS)
    }

    const loadModels = async () => {
      if ((modelAgentType === 'OpenCode' || modelAgentType === 'Pi') && !modelExecutorId) {
        setModelOptions([])
        setDefaultModel('')
        return
      }

      setModelLoading(true)
      try {
        const response = await queryClient.fetchQuery({
          queryKey: workspaceQueryKeys.agentModels(modelAgentType, modelExecutorId),
          queryFn: () => api.listAgentModels(modelAgentType, modelExecutorId || undefined),
          staleTime: MODEL_OPTIONS_CACHE_TTL_MS,
        })
        if (cancelled) {
          return
        }

        setModelOptions(response.models)
        setDefaultModel(response.defaultModel ?? '')
        if (preflightOpen) {
          setPreflightModel((current) => resolveMatchingAgentExecutionModelOptionId(modelAgentType, response.models, current))
        }
        if (response.runtimePending) {
          scheduleRuntimeModelRefresh()
        }
      } catch (error) {
        if (!cancelled) {
          setModelOptions([])
          setDefaultModel('')
          setNotices((prev) => prependNotice(prev, {
            id: crypto.randomUUID(),
            level: 'warning',
            message: error instanceof Error ? error.message : '模型列表加载失败。',
          }))
        }
      } finally {
        if (!cancelled) {
          setModelLoading(false)
        }
      }
    }

    void loadModels()

    return () => {
      cancelled = true
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
    }
  }, [
    modelAgentType,
    modelExecutorId,
    preflightOpen,
    queryClient,
    setDefaultModel,
    setModelLoading,
    setModelOptions,
    setNotices,
    setPreflightModel,
  ])

}
