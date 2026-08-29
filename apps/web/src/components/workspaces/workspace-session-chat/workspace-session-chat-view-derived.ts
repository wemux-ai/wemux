import { useMemo } from 'react'
import type { TaskChatQueueEntry, TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { AgentRunningStatus, ExecutionLog, ExecutorRecord, Task, ToolCall } from '@shared/types'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import {
  getWorkspaceSessionDisplayStatus,
  isWorkspaceSessionBusy,
} from '../../../lib/workspace-session-status'
import {
  aggregateTimelineForDisplay,
  resolveTaskChatQueueStatusMessage,
  shouldShowSystemLog,
} from './workspace-session-chat-helpers'

type TaskChatViewDerivedParams = {
  chatSession: TaskChatSessionSnapshot | null
  executors: ExecutorRecord[]
  liveStatus: AgentRunningStatus
  liveStep: string
  liveTools: ToolCall[]
  preparingWorkspace: boolean
  queuedMessages: TaskChatQueueEntry[]
  socketStatus: 'connecting' | 'open' | 'closed' | 'error'
  task: Task
  timeline: ChatTimelineEvent[]
  workspaceId?: string
  workspaceSessionId?: string
}

const OFFLINE_QUEUE_STATUS_MESSAGE = '执行器当前离线，消息已保留在队列中，等待恢复后自动发送。'

export const resolveWorkspaceSessionQueuePending = (params: {
  preparingWorkspace: boolean
  queuedMessages: TaskChatQueueEntry[]
}) => {
  return params.preparingWorkspace || params.queuedMessages.length > 0
}

export const resolveWorkspaceSessionQueueStatusMessage = (params: {
  chatSession: TaskChatSessionSnapshot | null
  displayStep: string
  executors: ExecutorRecord[]
  queuedMessages?: TaskChatQueueEntry[]
  remoteRuntimeStatus?: TaskChatSessionSnapshot['runtime']['runtimeStatus']
}) => {
  const queuedByRuntime = resolveTaskChatQueueStatusMessage(params.remoteRuntimeStatus, params.displayStep)
  if (queuedByRuntime) {
    return queuedByRuntime
  }

  const visibleQueuedMessages = params.queuedMessages ?? params.chatSession?.queue.items ?? []
  const queuePending = visibleQueuedMessages.length > 0
  if (!queuePending) {
    return ''
  }

  const executorId = params.chatSession?.runtime.executorNodeId?.trim()
    || params.chatSession?.runtime.runtimeOwnerExecutorId?.trim()
    || ''
  if (!executorId) {
    return ''
  }

  const executor = params.executors.find((item) => item.executorId === executorId)
  return executor && executor.status !== 'online'
    ? OFFLINE_QUEUE_STATUS_MESSAGE
    : ''
}

export const resolveWorkspaceSessionChatViewRuntime = (params: {
  liveStatus: AgentRunningStatus
  liveStep: string
  remoteSessionStatus: AgentRunningStatus
  remoteRuntimeStatus?: TaskChatSessionSnapshot['runtime']['runtimeStatus']
  remoteStep?: string
}) => {
  const liveSessionBusy = isWorkspaceSessionBusy(params.liveStatus)
  const remoteRuntimeTerminal = params.remoteRuntimeStatus === 'completed'
    || params.remoteRuntimeStatus === 'error'
    || params.remoteRuntimeStatus === 'lost'
    || params.remoteRuntimeStatus === 'cancelled'
  const remoteSessionTerminal = params.remoteSessionStatus === 'complete'
    || params.remoteSessionStatus === 'error'
  const preferLiveRuntime = liveSessionBusy
    && params.remoteRuntimeStatus !== 'queued'
    && !remoteRuntimeTerminal
    && !remoteSessionTerminal

  return {
    agentRunningStatus: preferLiveRuntime ? params.liveStatus : params.remoteSessionStatus,
    runtimeStatus: preferLiveRuntime ? undefined : params.remoteRuntimeStatus,
    currentStep: preferLiveRuntime ? params.liveStep : (params.remoteStep ?? params.liveStep),
  }
}

export const resolveVisibleWorkspaceSessionSystemLogs = (params: {
  logs: ExecutionLog[]
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  return params.logs.filter((log: ExecutionLog) => {
    if (log.role !== 'system' && log.role !== 'review') {
      return false
    }

    if (!shouldShowSystemLog(log)) {
      return false
    }

    if (params.workspaceId) {
      if (log.workspaceId !== params.workspaceId) {
        return false
      }

      if (params.workspaceSessionId) {
        return log.workspaceSessionId === params.workspaceSessionId
      }

      return !log.workspaceSessionId
    }

    return !log.workspaceId
  })
}

export function useTaskChatViewDerived({
  chatSession,
  executors,
  liveStatus,
  liveStep,
  liveTools,
  preparingWorkspace,
  queuedMessages,
  socketStatus,
  task,
  timeline,
  workspaceId,
  workspaceSessionId,
}: TaskChatViewDerivedParams) {
  const systemLogs = useMemo(() => {
    return resolveVisibleWorkspaceSessionSystemLogs({
      logs: task.logs,
      workspaceId,
      workspaceSessionId,
    })
  }, [task.logs, workspaceId, workspaceSessionId])

  const visibleTools = useMemo(() => {
    return (liveTools ?? []).filter((tool) => {
      return workspaceId ? tool.workspaceId === workspaceId : !tool.workspaceId
    })
  }, [liveTools, workspaceId])

  const remoteSessionStatus = chatSession?.runtime.agentRunningStatus ?? liveStatus
  const remoteRuntimeStatus = chatSession?.runtime.runtimeStatus
  const effectiveRuntime = resolveWorkspaceSessionChatViewRuntime({
    liveStatus,
    liveStep,
    remoteSessionStatus,
    remoteRuntimeStatus,
    remoteStep: chatSession?.runtime.currentStep,
  })
  const displayStatus = getWorkspaceSessionDisplayStatus({
    agentRunningStatus: effectiveRuntime.agentRunningStatus,
    needsHumanConfirm: chatSession?.runtime.needsHumanConfirm ?? task.needsHumanConfirm,
    runtimeStatus: effectiveRuntime.runtimeStatus,
  })
  const displayStep = effectiveRuntime.currentStep
  const isSessionBusy = isWorkspaceSessionBusy({
    agentRunningStatus: effectiveRuntime.agentRunningStatus,
    needsHumanConfirm: chatSession?.runtime.needsHumanConfirm ?? task.needsHumanConfirm,
    runtimeStatus: effectiveRuntime.runtimeStatus,
  })
  const isSocketOpen = socketStatus === 'open'
  const queuePending = resolveWorkspaceSessionQueuePending({ preparingWorkspace, queuedMessages })
  const queueStatusMessage = resolveWorkspaceSessionQueueStatusMessage({
    chatSession,
    displayStep,
    executors,
    queuedMessages,
    remoteRuntimeStatus,
  })
  const sessionQueued = displayStatus === 'queued'
  const awaitingConfirmation = displayStatus === 'attention'

  const displayTimeline = useMemo(() => {
    return aggregateTimelineForDisplay(timeline, isSessionBusy)
  }, [isSessionBusy, timeline])

  const visibleMessages = useMemo(() => {
    return displayTimeline.flatMap((turn) => {
      const assistantMessages = turn.entries
        .filter((entry) => entry.kind === 'assistant')
        .map((entry) => entry.message)
      return turn.user ? [turn.user, ...assistantMessages] : assistantMessages
    })
  }, [displayTimeline])

  const liveBadgeTone =
    !isSocketOpen
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : sessionQueued || awaitingConfirmation
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : queuePending && !isSessionBusy
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        : displayStatus === 'error'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          : isSessionBusy
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            : 'border-zinc-800 bg-zinc-950 text-zinc-300'

  return {
    displayStatus,
    displayStep,
    displayTimeline,
    isSessionBusy,
    isSocketOpen,
    liveBadgeTone,
    queueStatusMessage,
    queuePending,
    sessionQueued,
    systemLogs,
    visibleMessages,
    visibleTools,
  }
}
