import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  AgentRunningStatus,
  ExecutionModelOption,
  Task,
  ToolCall,
} from '@shared/types'
import type { AgentRecord, ConversationMessageRecord } from '../../../lib/api'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import type { TimelineTurnDisplay } from './workspace-session-chat-helpers'
import { useTaskChatSocketSync } from './workspace-session-chat-socket-sync'
import { useTaskChatSyncEffects } from './workspace-session-chat-sync-effects'
import type { NoticeItem } from './workspace-session-chat-helpers'
import type { WorkspaceSessionChatProps } from './workspace-session-chat-types'

type TaskChatSessionSyncParams = Pick<
  WorkspaceSessionChatProps,
  | 'onTaskUpdate'
  | 'onWorkspaceSessionChange'
  | 'open'
  | 'task'
  | 'workspaceId'
  | 'workspaceSession'
  | 'workspaceSessionId'
> & {
  applyCachedSession: TaskChatSessionSnapshot | null
  autoScrollToBottom: (mode?: 'instant' | 'smooth') => void
  chatSession: TaskChatSessionSnapshot | null
  chatSocketRef: MutableRefObject<WebSocket | null>
  conversationCountRef: MutableRefObject<number | null>
  conversationLoaded: boolean
  conversationMessages: ConversationMessageRecord[]
  conversationMessagesRef: MutableRefObject<ConversationMessageRecord[]>
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
  resetTimeline: () => void
  resumeAutoScroll: () => void
  scrollToBottom: (behavior?: 'instant' | 'smooth') => void
  setAvailableAgents: Dispatch<SetStateAction<AgentRecord[]>>
  setChatSession: Dispatch<SetStateAction<TaskChatSessionSnapshot | null>>
  setConversationHasMoreBefore: Dispatch<SetStateAction<boolean>>
  setConversationLoaded: Dispatch<SetStateAction<boolean>>
  setConversationMessages: Dispatch<SetStateAction<ConversationMessageRecord[]>>
  setDefaultModel: Dispatch<SetStateAction<string>>
  setInitialTranscriptReady: Dispatch<SetStateAction<boolean>>
  setHistoryHasMoreBefore: Dispatch<SetStateAction<boolean>>
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

export function useTaskChatSessionSync(params: TaskChatSessionSyncParams) {
  const socketSync = useTaskChatSocketSync({
    chatSession: params.chatSession,
    chatSocketRef: params.chatSocketRef,
    conversationMessagesRef: params.conversationMessagesRef,
    historyLastSessionSeqRef: params.historyLastSessionSeqRef,
    liveSessionRevisionRef: params.liveSessionRevisionRef,
    onTaskUpdate: params.onTaskUpdate,
    onTaskUpdateRef: params.onTaskUpdateRef,
    onWorkspaceSessionChange: params.onWorkspaceSessionChange,
    open: params.open,
    setChatSession: params.setChatSession,
    setConversationHasMoreBefore: params.setConversationHasMoreBefore,
    setConversationLoaded: params.setConversationLoaded,
    setConversationMessages: params.setConversationMessages,
    setHistoryHasMoreBefore: params.setHistoryHasMoreBefore,
    setLiveStatus: params.setLiveStatus,
    setLiveStep: params.setLiveStep,
    setLiveTools: params.setLiveTools,
    setNotices: params.setNotices,
    setSocketStatus: params.setSocketStatus,
    setTimeline: params.setTimeline,
    socketLastEventIdRef: params.socketLastEventIdRef,
    task: params.task,
    taskRef: params.taskRef,
    workspaceSessionInitialHistoryLimit: params.workspaceSessionInitialHistoryLimit,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  useTaskChatSyncEffects({
    applyCachedSession: params.applyCachedSession,
    applyConversationPayload: socketSync.applyConversationPayload,
    autoScrollToBottom: params.autoScrollToBottom,
    chatSession: params.chatSession,
    conversationCountRef: params.conversationCountRef,
    conversationLoaded: params.conversationLoaded,
    conversationMessages: params.conversationMessages,
    displayStatus: params.displayStatus,
    displayStep: params.displayStep,
    displayTimeline: params.displayTimeline,
    historyLastSessionSeqRef: params.historyLastSessionSeqRef,
    injectedTesterContextIdsRef: params.injectedTesterContextIdsRef,
    isSessionBusy: params.isSessionBusy,
    liveSessionRevisionRef: params.liveSessionRevisionRef,
    messageScopeRef: params.messageScopeRef,
    modelAgentType: params.modelAgentType,
    modelExecutorId: params.modelExecutorId,
    noticesLength: params.noticesLength,
    onTaskUpdate: params.onTaskUpdate,
    onTaskUpdateRef: params.onTaskUpdateRef,
    open: params.open,
    preflightOpen: params.preflightOpen,
    queuedMessagesLength: params.queuedMessagesLength,
    buildWorkspaceHistoryTimeline: socketSync.buildWorkspaceHistoryTimeline,
    rememberHistoryEvents: socketSync.rememberHistoryEvents,
    refreshSessionView: socketSync.refreshSessionView,
    resetTimeline: params.resetTimeline,
    resumeAutoScroll: params.resumeAutoScroll,
    scrollToBottom: params.scrollToBottom,
    setAvailableAgents: params.setAvailableAgents,
    setChatSession: params.setChatSession,
    setConversationHasMoreBefore: params.setConversationHasMoreBefore,
    setConversationLoaded: params.setConversationLoaded,
    setConversationMessages: params.setConversationMessages,
    setDefaultModel: params.setDefaultModel,
    setHistoryHasMoreBefore: params.setHistoryHasMoreBefore,
    setInitialTranscriptReady: params.setInitialTranscriptReady,
    setLiveStatus: params.setLiveStatus,
    setLiveStep: params.setLiveStep,
    setLiveTools: params.setLiveTools,
    setModelLoading: params.setModelLoading,
    setModelOptions: params.setModelOptions,
    setNotices: params.setNotices,
    setPreflightModel: params.setPreflightModel,
    setSocketStatus: params.setSocketStatus,
    setTimeline: params.setTimeline,
    socketLastEventIdRef: params.socketLastEventIdRef,
    socketStatus: params.socketStatus,
    systemLogsLength: params.systemLogsLength,
    task: params.task,
    taskRef: params.taskRef,
    workspaceSessionInitialHistoryLimit: params.workspaceSessionInitialHistoryLimit,
    workspaceId: params.workspaceId,
    workspaceSession: params.workspaceSession,
    workspaceSessionId: params.workspaceSessionId,
  })

  return {
    notifySocketIssue: socketSync.notifySocketIssue,
    prependHistoryEvents: socketSync.prependHistoryEvents,
    refreshSessionView: socketSync.refreshSessionView,
    refreshWorkspaceHistoryView: socketSync.refreshWorkspaceHistoryView,
    rememberHistoryEvents: socketSync.rememberHistoryEvents,
    resolveHistorySessionSeq: socketSync.resolveHistorySessionSeq,
    sendSocketMessage: socketSync.sendSocketMessage,
    sendSocketMessageWithAck: socketSync.sendSocketMessageWithAck,
    syncScopedTaskFromState: socketSync.syncScopedTaskFromState,
    syncTaskRuntime: socketSync.syncTaskRuntime,
  }
}
