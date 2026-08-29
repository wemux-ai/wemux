// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Workspace lifecycle events plus distributed workspace-run start/progress/result state.
// [OUTPUT]: Persisted workspace-session transcript events and runtime snapshots scoped to one run turn.
// [POS]: Shared history boundary for page, MCP, and assigned-Agent workspace execution flows.

import type {
  AgentRunningStatus,
  ExecutorWorkspaceOperationEvent,
  ModelTokenUsage,
  TaskExecutionResult,
  WorkspaceSessionRuntimeStatus,
} from '@shared/types'
import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionRuntimeQueueStatus,
} from '@shared/workspace-session-history'
import {
  appendWorkspaceSessionSystemMessage,
  persistWorkspaceSessionTurnHistory,
  upsertWorkspaceSessionRuntimeSnapshot,
} from '../storage/postgres/workspace-session-history-store'

export type WorkspaceSessionTimelineScope = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  turnId?: string
}

type WorkspaceRunTimelineScope = Required<Pick<
  WorkspaceSessionTimelineScope,
  'taskId' | 'workspaceId' | 'workspaceSessionId'
>> & {
  taskRunId: string
}

const buildWorkspaceRunRuntime = (params: WorkspaceRunTimelineScope & {
  agentRunningStatus: AgentRunningStatus
  runtimeStatus: WorkspaceSessionRuntimeStatus
  currentStep: string
  queueStatus: WorkspaceSessionRuntimeQueueStatus
  updatedAt: string
  lastEventSeq?: number
}) => ({
  sessionId: params.workspaceSessionId,
  taskId: params.taskId,
  workspaceId: params.workspaceId,
  agentRunningStatus: params.agentRunningStatus,
  runtimeStatus: params.runtimeStatus,
  currentStep: params.currentStep,
  queueStatus: params.queueStatus,
  activeToolCalls: [],
  lastEventSeq: params.lastEventSeq ?? 0,
  updatedAt: params.updatedAt,
})

export const startWorkspaceRunTimeline = async (params: WorkspaceRunTimelineScope & {
  prompt: string
  currentStep: string
  startedAt: string
  createdBy?: string
}) => {
  const userMessageId = `workspace-run:${params.taskRunId}:user`
  const events: WorkspaceSessionEventRecord[] = [
    {
      id: userMessageId,
      sessionId: params.workspaceSessionId,
      turnId: params.taskRunId,
      sessionSeq: 0,
      turnSeq: 1,
      createdAt: params.startedAt,
      visibility: 'transcript',
      kind: 'user_message',
      payload: {
        messageId: userMessageId,
        text: params.prompt,
        authorId: params.createdBy,
      },
    },
    {
      id: `workspace-run:${params.taskRunId}:queued`,
      sessionId: params.workspaceSessionId,
      turnId: params.taskRunId,
      sessionSeq: 0,
      turnSeq: 2,
      createdAt: params.startedAt,
      visibility: 'transcript',
      kind: 'status',
      payload: { status: 'thinking', step: params.currentStep },
    },
  ]

  await persistWorkspaceSessionTurnHistory({
    sessionId: params.workspaceSessionId,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    turn: {
      id: params.taskRunId,
      sessionId: params.workspaceSessionId,
      status: 'running',
      startedAt: params.startedAt,
      eventCount: events.length,
    },
    events,
    runtime: buildWorkspaceRunRuntime({
      ...params,
      agentRunningStatus: 'thinking',
      runtimeStatus: 'queued',
      queueStatus: 'queued',
      updatedAt: params.startedAt,
    }),
  })
}

export const recordWorkspaceRunTimelineProgress = async (params: WorkspaceRunTimelineScope & {
  eventId?: string
  message: string
  at: string
  agentRunningStatus: AgentRunningStatus
  runtimeStatus: WorkspaceSessionRuntimeStatus
  queueStatus: WorkspaceSessionRuntimeQueueStatus
}) => {
  const event = await appendWorkspaceSessionSystemMessage({
    sessionId: params.workspaceSessionId,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    turnId: params.taskRunId,
    eventId: params.eventId,
    visibility: 'transcript',
    message: params.message,
    createdAt: params.at,
  }) as Extract<WorkspaceSessionEventRecord, { kind: 'system_message' }> | null
  await upsertWorkspaceSessionRuntimeSnapshot(buildWorkspaceRunRuntime({
    ...params,
    currentStep: params.message,
    updatedAt: params.at,
    lastEventSeq: event?.sessionSeq,
  }))
}

const resolveWorkspaceRunTurnStatus = (status: TaskExecutionResult['status']) => {
  if (status === 'completed') return 'completed' as const
  if (status === 'cancelled') return 'cancelled' as const
  return 'error' as const
}

export const finishWorkspaceRunTimeline = async (params: WorkspaceRunTimelineScope & {
  agentType: string
  result: TaskExecutionResult
  summary: string
  output: string
  startedAt: string
  finishedAt: string
  sequence?: number
  usage?: ModelTokenUsage
}) => {
  const success = params.result.status === 'completed'
  const terminalStatus: AgentRunningStatus = params.result.status === 'cancelled'
    ? 'idle'
    : success ? 'complete' : 'error'
  const runtimeStatus: WorkspaceSessionRuntimeStatus = params.result.status === 'cancelled'
    ? 'cancelled'
    : success ? 'completed' : 'error'
  const turnSeq = (params.sequence ?? 0) + 3
  const events: WorkspaceSessionEventRecord[] = [
    success
      ? {
          id: `workspace-run:${params.taskRunId}:assistant`,
          sessionId: params.workspaceSessionId,
          turnId: params.taskRunId,
          sessionSeq: 0,
          turnSeq,
          createdAt: params.finishedAt,
          visibility: 'transcript',
          kind: 'assistant_message',
          payload: {
            messageId: `workspace-run:${params.taskRunId}:assistant`,
            text: params.output || params.summary,
            authorName: params.agentType,
          },
        }
      : {
          id: `workspace-run:${params.taskRunId}:error`,
          sessionId: params.workspaceSessionId,
          turnId: params.taskRunId,
          sessionSeq: 0,
          turnSeq,
          createdAt: params.finishedAt,
          visibility: 'transcript',
          kind: 'error',
          payload: { message: params.summary },
        },
    {
      id: `workspace-run:${params.taskRunId}:terminal`,
      sessionId: params.workspaceSessionId,
      turnId: params.taskRunId,
      sessionSeq: 0,
      turnSeq: turnSeq + 1,
      createdAt: params.finishedAt,
      visibility: 'transcript',
      kind: 'status',
      payload: { status: terminalStatus, step: params.summary },
    },
  ]

  await persistWorkspaceSessionTurnHistory({
    sessionId: params.workspaceSessionId,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    turn: {
      id: params.taskRunId,
      sessionId: params.workspaceSessionId,
      status: resolveWorkspaceRunTurnStatus(params.result.status),
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
      eventCount: events.length,
      usage: params.usage,
    },
    events,
    runtime: buildWorkspaceRunRuntime({
      ...params,
      agentRunningStatus: terminalStatus,
      runtimeStatus,
      currentStep: params.summary,
      queueStatus: 'idle',
      updatedAt: params.finishedAt,
    }),
  })
}

const hasTimelineScope = (
  scope: WorkspaceSessionTimelineScope,
): scope is Required<WorkspaceSessionTimelineScope> => Boolean(
  scope.taskId?.trim()
  && scope.workspaceId?.trim()
  && scope.workspaceSessionId?.trim(),
)

export const recordWorkspaceSessionSystemMessage = (
  scope: WorkspaceSessionTimelineScope,
  message: string,
  createdAt?: string,
) => {
  if (!hasTimelineScope(scope)) {
    return
  }

  void appendWorkspaceSessionSystemMessage({
    taskId: scope.taskId.trim(),
    workspaceId: scope.workspaceId.trim(),
    sessionId: scope.workspaceSessionId.trim(),
    turnId: scope.turnId?.trim() || undefined,
    message,
    createdAt,
  }).catch((error) => {
    console.error('[workspace-session-history] append system message failed', error)
  })
}

export const createWorkspaceOperationTimelineWriter = (scope: WorkspaceSessionTimelineScope) => {
  if (!hasTimelineScope(scope)) {
    return undefined
  }

  return (event: ExecutorWorkspaceOperationEvent) => {
    recordWorkspaceSessionSystemMessage(scope, event.message, event.at)
  }
}
