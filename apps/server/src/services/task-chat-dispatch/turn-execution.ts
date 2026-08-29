// [INPUT]: Persisted task chat queue entries, task/workspace execution state, and runtime configuration.
// [OUTPUT]: Authorized task turn execution, queue draining, persistence, and realtime updates.
// [POS]: Task chat execution orchestrator; workspace sessions never substitute for missing tasks.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatContextRef } from '@shared/task-chat-context'
import { buildTaskChatSessionKey, type TaskChatMessageRuntimeConfig } from '@shared/task-chat-session'
import { touchTaskStatus } from '@shared/task-status-flow'
import { buildWorkspaceTaskExecutionView, resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import type { AppState, CreatorIdentity, Project, Task, TaskExecutionResult, TaskRun, WorkspaceSession } from '@shared/types'
import type { ChatTimelineEvent } from '@shared/timeline'
import {
  buildTaskChatQueueTurnId,
  buildTaskChatSessionSnapshot,
  claimTaskChatQueueEntry,
  completeTaskChatQueueClaim,
  listTaskChatQueueEntries,
  releaseTaskChatQueueClaim,
} from '../../control-plane/task-chat-service'
import { appendTaskConversationMessage } from '../../control-plane/conversation-service'
import { executorRegistry } from '../../control-plane/executor-registry'
import { createTimelineCollector, createUserMessageEvent, type TaskChatStreamWriter, writeFinalTextResult, writeTimelineEvent } from '../../integrations/opencode/task-chat-stream'
import { isProjectAccessible } from '../../repositories/auth'
import { ensureTokenQuotaAccess } from '../token-quota-service'
import { getAuthorizedTask, withState } from '../../routes/shared'
import {
  getScopedWorkspaceForProject,
  getWorkspaceSessionRecordForTaskContext,
  persistTaskConversationTurn,
  resolveUserCreatorIdentity,
  upsertWorkspaceSessionInState,
} from '../../routes/task-route-support'
import { getTaskRun, loadState, saveTask, saveTaskAndWait, saveTaskRun, saveWorkspaceSession, saveWorkspaceSessionAndWait } from '../../storage/app-state-store'
import { getWorkspace, listWorkspaces } from '../../storage/distributed-task-store'
import { persistWorkspaceSessionTurnHistory } from '../../storage/postgres/workspace-session-history-store'
import {
  registerTaskChatQueueDrainScheduler,
  refreshTaskChatQueueMirror,
  type TaskChatSessionLease,
} from '../../storage/postgres/task-chat-queue-store'
import { registerProjectPullRequestContext } from '../project-pull-request-review-service'
import {
  activeTaskChatDrainSessions,
  bindTaskChatExecutionAbortSignal,
  isTaskChatExecutionActive,
  isTaskChatRuntimeBusy,
  normalizeTaskChatSessionSnapshot,
  pendingTaskChatDrainSessions,
  publishTaskChatSessionUpdate,
  publishTaskChatTaskUpdate,
  publishTaskChatTimelineEvent,
  releaseTaskChatExecutionLease,
  renewTaskChatExecutionLease,
  resolveScopedRuntimeTask,
  tryAcquireTaskChatExecutionLease,
} from './runtime-state'
import {
  applyTaskMessageResult,
  applyWorkspaceMessageResult,
  buildFailedWorkspaceMessageResult,
  buildPendingTask,
  buildPendingWorkspaceSession,
  ensureWorkspaceResultAssistantTimeline,
  handoffSubagentTurnToParent,
  markAgentCreatedPullRequestResult,
} from './result-utils'
import { applyRuntimeSelectionToWorkspaceSession, applyTaskChatMessageRuntimeConfig } from './runtime-config-apply'
import type { ExecuteTaskChatTurnResult, TaskChatQueueClaim, TaskMessageResult } from './types'
import {
  buildWorkerOnlyTaskDetailResult,
  ensureWorkspaceChatTaskReady,
  resolveWorkspaceChatDispatchAvailabilityAsync,
  runWorkspaceMessageViaExecutor,
} from './workspace-executor'
import { getServerAgentLabel } from '../server-agent'
import { getCommercialGate } from '../../services/gate/commercial-gate'
import { getManagedCloudGate } from '../gate/managed-cloud-gate'

const hasSharedWorktreeSessionConflict = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (!workspaceId || !workspaceSessionId) {
    return false
  }

  const state = loadState()
  const currentSession = state.workspaceSessions.find((session) => {
    return session.workspaceId === workspaceId
      && session.id === workspaceSessionId
  })
  if (!currentSession || currentSession.forkMode !== 'local') {
    return false
  }

  const sharedWorktreeId = currentSession.worktreeId
  return state.workspaceSessions.some((session) => {
    if (session.workspaceId !== workspaceId || session.id === currentSession.id) {
      return false
    }
    if (session.status === 'archived' || session.worktreeId !== sharedWorktreeId) {
      return false
    }
    if (session.agentRunningStatus === 'thinking' || session.agentRunningStatus === 'executing' || session.agentRunningStatus === 'waiting') {
      return true
    }

    return isTaskChatExecutionActive({
      taskId: task.id,
      workspaceId,
      workspaceSessionId: session.id,
    })
  })
}

const resolveTaskChatActorUserId = (projectId: string, createdBy?: string, fallbackCreatedById?: string) => {
  if (createdBy && isProjectAccessible(createdBy, projectId)) {
    return createdBy
  }

  if (fallbackCreatedById && isProjectAccessible(fallbackCreatedById, projectId)) {
    return fallbackCreatedById
  }

  return null
}

const isDeferredWorkspaceTimelineEvent = (event: ChatTimelineEvent) => {
  if (event.kind === 'error' || event.kind === 'system_message') {
    return true
  }

  return event.kind === 'status'
    && (event.status === 'complete' || event.status === 'error' || event.status === 'idle')
}

const loadQueuedTaskChatContext = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  createdBy?: string
}) => {
  const state = loadState()
  const task = params.taskId ? state.tasks.find((item) => item.id === params.taskId) : null
  if (!task) {
    const actorUserId = params.createdBy?.trim()
    if (!actorUserId) {
      return null
    }

    const taskId = params.taskId?.trim()
    if (!taskId) {
      return null
    }
    const taskResult = getAuthorizedTask(state, actorUserId, taskId)
    if (!taskResult.task || !taskResult.project) {
      return null
    }

    return {
      state,
      userId: actorUserId,
      task: taskResult.task,
      project: taskResult.project,
    }
  }

  const project = state.projects.find((item) => item.id === task.projectId)
  if (!project) {
    return null
  }

  const actorUserId = resolveTaskChatActorUserId(project.id, params.createdBy, project.createdById)
  if (!actorUserId) {
    return null
  }

  const taskResult = getAuthorizedTask(state, actorUserId, task.id)
  if (!taskResult.task || !taskResult.project) {
    return null
  }

  return {
    state,
    userId: actorUserId,
    task: taskResult.task,
    project: taskResult.project,
  }
}

export const resolveQueuedTaskChatDrainContext = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const nextQueued = listTaskChatQueueEntries(params.taskId, params.workspaceId, params.workspaceSessionId)[0]
  if (!nextQueued) {
    return null
  }

  const context = loadQueuedTaskChatContext({
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    createdBy: nextQueued.createdBy,
  })
  if (!context) {
    return null
  }

  return {
    context,
    nextQueued,
    scopedRuntimeTask: resolveScopedRuntimeTask(context.task, params.workspaceId, params.workspaceSessionId),
  }
}

const resolveWorkspaceTaskRunStatus = (
  result: TaskMessageResult,
): TaskRun['status'] => {
  if (result.agentRunningStatus === 'waiting') return 'executing'
  if (result.agentRunningStatus === 'idle') return 'cancelled'
  return result.ok ? 'completed' : 'failed'
}

const buildWorkspaceTaskRunResult = (params: {
  taskRun: TaskRun
  taskId: string
  session?: WorkspaceSession
  result: TaskMessageResult
  completedAt: string
  status: Extract<TaskExecutionResult['status'], 'completed' | 'failed' | 'cancelled'>
}): TaskExecutionResult => {
  const startedAtMs = Date.parse(params.taskRun.createdAt)
  const completedAtMs = Date.parse(params.completedAt)
  return {
    taskId: params.taskId,
    status: params.status,
    returnMode: params.taskRun.returnMode ?? 'summary',
    summary: params.result.output,
    output: params.result.output,
    filesChanged: params.result.filesChanged ?? [],
    changeSummary: params.result.changeSummary,
    remoteBranchName: params.result.remoteBranchName,
    commitShas: params.result.commitShas,
    startedAt: params.taskRun.createdAt,
    completedAt: params.completedAt,
    durationSec: Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
      ? Math.max(0, Math.round((completedAtMs - startedAtMs) / 1000))
      : 0,
    executorNodeId: params.taskRun.executorNodeId
      ?? params.session?.runtimeOwnerExecutorId
      ?? params.session?.executorNodeId
      ?? '',
    workspaceId: params.taskRun.workspaceId ?? params.session?.workspaceId,
    workspaceSessionId: params.taskRun.workspaceSessionId ?? params.session?.id,
    agentSessionId: params.result.agentSessionId ?? params.result.opencodeSessionId,
    opencodeSessionId: params.result.opencodeSessionId ?? params.result.agentSessionId,
    usage: params.result.usage,
    delivery: params.result.delivery,
  }
}

const publishQueuedWorkspaceTurnAttention = async (params: {
  task: Task
  project: Project
  session: WorkspaceSession
  taskRunId: string
  requestedByUserId: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  result: TaskMessageResult
}) => {
  if (!params.requestedByAgentId) return
  const {
    buildWorkspaceTurnAttentionEvent,
    publishWorkspaceTurnAttentionIfAvailable,
    resolveWorkspaceSessionAttentionTone,
  } = await import('../workspace-session-completion-notifier')
  const tone = resolveWorkspaceSessionAttentionTone({ session: params.session })
  if (!tone) return

  await publishWorkspaceTurnAttentionIfAvailable(buildWorkspaceTurnAttentionEvent({
    tone,
    session: params.session,
    taskRunId: params.taskRunId,
    requestedByUserId: params.requestedByUserId,
    requestedByAgentId: params.requestedByAgentId,
    sourceAgentEventId: params.sourceAgentEventId,
    task: params.task,
    project: params.project,
    workspace: getWorkspace(params.session.workspaceId),
    result: {
      summary: params.result.output,
      filesChanged: params.result.filesChanged,
      changeSummary: params.result.changeSummary,
      commitShas: params.result.commitShas,
    },
    errorMessage: params.result.ok ? undefined : params.result.output,
  }))
}

const persistWorkspaceFailureTurnAsync = async (params: {
  task: Task
  project: Project
  userId: string
  workspaceId: string
  workspaceSessionId?: string
  userMessage: string
  attachments?: TaskChatAttachment[]
  errorMessage: string
  turnId?: string
  taskRunId?: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  author?: CreatorIdentity
}) => {
  const result = buildFailedWorkspaceMessageResult(params.errorMessage, params.turnId?.trim() || crypto.randomUUID())
  const nextTask: Task = {
    ...touchTaskStatus(params.task, new Date().toISOString()),
    needsHumanConfirm: false,
    agentRunningStatus: result.agentRunningStatus ?? 'error',
    currentStep: result.currentStep ?? '工作区对话失败',
  }
  const latestWorkspaceSession = getWorkspaceSessionRecordForTaskContext(
    params.task.id,
    params.workspaceId,
    params.workspaceSessionId,
  )
  const nextSession = latestWorkspaceSession
    ? applyWorkspaceMessageResult(nextTask, latestWorkspaceSession, result)
    : undefined

  await saveTaskAndWait(nextTask)
  if (nextSession) {
    await saveWorkspaceSessionAndWait(nextSession)
  }

  const taskRun = params.taskRunId ? getTaskRun(params.taskRunId) : null
  if (taskRun) {
    const completedAt = nextSession?.updatedAt ?? nextTask.updatedAt
    saveTaskRun({
      ...taskRun,
      status: 'failed',
      summary: result.output,
      result: buildWorkspaceTaskRunResult({
        taskRun,
        taskId: params.task.id,
        session: nextSession,
        result,
        completedAt,
        status: 'failed',
      }),
      updatedAt: completedAt,
    })
  }

  await persistTaskConversationTurn({
    project: params.project,
    task: nextTask,
    userId: params.userId,
    author: params.author,
    userMessage: params.userMessage,
    attachments: params.attachments,
    result,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  publishTaskChatTaskUpdate(nextTask.id, params.workspaceId, params.workspaceSessionId, {
    id: nextTask.id,
    agentRunningStatus: nextTask.agentRunningStatus,
    currentStep: nextTask.currentStep,
    toolCalls: nextTask.toolCalls,
    logs: nextTask.logs,
  })
  publishTaskChatSessionUpdate(nextTask.id, params.workspaceId, params.workspaceSessionId, nextTask, params.project)
  for (const event of result.conversationTimeline ?? []) {
    publishTaskChatTimelineEvent(nextTask.id, params.workspaceId, params.workspaceSessionId, event)
  }

  if (nextSession && taskRun && params.requestedByAgentId) {
    await publishQueuedWorkspaceTurnAttention({
      task: nextTask,
      project: params.project,
      session: nextSession,
      taskRunId: taskRun.id,
      requestedByUserId: params.userId,
      requestedByAgentId: params.requestedByAgentId,
      sourceAgentEventId: params.sourceAgentEventId,
      result,
    })
  }
}

export const persistWorkspaceFailureTurn = (params: Parameters<typeof persistWorkspaceFailureTurnAsync>[0]) => {
  void persistWorkspaceFailureTurnAsync(params).catch((error) => {
    console.error('[task-chat] persist workspace failure turn failed', error)
  })
}

const scheduleQueuedTaskChatDrainForExecutor = (executorId: string) => {
  const state = loadState()
  const taskIdByWorkspaceId = new Map(
    state.taskWorkspaceBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => [binding.workspaceId, binding.taskId] as const),
  )
  const workspaceWorkerIdById = new Map(
    listWorkspaces().map((workspace) => [workspace.id, resolveWorkspaceWorkerId(workspace)] as const),
  )
  const scheduledSessionKeys = new Set<string>()

  for (const session of state.workspaceSessions) {
    const sessionWorkspaceWorkerId = workspaceWorkerIdById.get(session.workspaceId)
    if (session.status === 'archived' || (sessionWorkspaceWorkerId || resolveWorkspaceSessionExecutorId(session)) !== executorId) {
      continue
    }

    const taskId = taskIdByWorkspaceId.get(session.workspaceId) ?? session.id

    if (listTaskChatQueueEntries(taskId, session.workspaceId, session.id).length === 0) {
      continue
    }

    const sessionKey = buildTaskChatSessionKey(taskId, session.workspaceId, session.id)
    if (scheduledSessionKeys.has(sessionKey)) {
      continue
    }

    scheduledSessionKeys.add(sessionKey)
    scheduleTaskChatQueueDrain({
      taskId,
      workspaceId: session.workspaceId,
      workspaceSessionId: session.id,
    })
  }
}

const persistPendingWorkspaceUserTurn = async (params: {
  task: Task
  project: Project
  userId: string
  workspaceId: string
  workspaceSessionId: string
  turnId: string
  userEvent: Extract<ChatTimelineEvent, { kind: 'user_message' }>
  currentStep: string
}) => {
  const author = params.userEvent.author ?? resolveUserCreatorIdentity(params.userId) ?? {
    type: 'user' as const,
    id: params.userId,
    name: params.userId,
  }
  appendTaskConversationMessage({
    task: params.task,
    project: params.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    role: author.type === 'user' ? 'user' : 'assistant',
    senderId: author.id,
    content: params.userEvent.text,
    contentType: 'json',
    externalRef: {
      turnId: params.turnId,
      ...(params.userEvent.attachments?.length ? { attachments: params.userEvent.attachments } : {}),
      timelineEvent: params.userEvent,
    },
  })

  await persistWorkspaceSessionTurnHistory({
    sessionId: params.workspaceSessionId,
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    turn: {
      id: params.turnId,
      sessionId: params.workspaceSessionId,
      status: 'running',
      startedAt: params.userEvent.ts,
      eventCount: 1,
    },
    events: [{
      id: params.userEvent.id,
      sessionId: params.workspaceSessionId,
      turnId: params.turnId,
      sessionSeq: 0,
      turnSeq: params.userEvent.seq,
      visibility: 'transcript',
      kind: 'user_message',
      createdAt: params.userEvent.ts,
      payload: {
        messageId: params.userEvent.messageId,
        text: params.userEvent.text,
        authorId: params.userEvent.authorId,
        author: params.userEvent.author,
        attachments: params.userEvent.attachments,
      },
    }],
    runtime: {
      sessionId: params.workspaceSessionId,
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      agentRunningStatus: 'thinking',
      runtimeStatus: 'running',
      currentStep: params.currentStep,
      queueStatus: 'running',
      activeToolCalls: [],
      lastEventSeq: 0,
      lastEventAt: params.userEvent.ts,
      updatedAt: params.userEvent.ts,
    },
  })
}

export const executeTaskChatTurn = async (params: {
  state: AppState
  userId: string
  task: Task
  project: Project
  message: string
  attachments?: TaskChatAttachment[]
  contextRefs?: TaskChatContextRef[]
  workspaceId?: string
  workspaceSessionId?: string
  launchId?: string
  turnId?: string
  queueClaim?: TaskChatQueueClaim
  writer?: TaskChatStreamWriter
  signal?: AbortSignal
  executionSlotAlreadyAcquired?: boolean
  sessionLease?: TaskChatSessionLease | null
  runtimeConfig?: TaskChatMessageRuntimeConfig
}): Promise<ExecuteTaskChatTurnResult> => {
  const normalizedMessage = params.message.trim()
  const scopedWorkspaceId = params.workspaceId?.trim() || undefined
  const scopedWorkspaceSessionId = params.workspaceSessionId?.trim() || undefined
  const timestamp = new Date().toISOString()
  const effectiveTurnId = params.turnId?.trim() || crypto.randomUUID()
  const billingSessionKey = buildTaskChatSessionKey(params.task.id, scopedWorkspaceId, scopedWorkspaceSessionId)
  const effectiveLease = params.sessionLease
    ? params.sessionLease
    : await tryAcquireTaskChatExecutionLease({
        taskId: params.task.id,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
      })
  let claimCompleted = false
  let billingCompleted = false
  let billingSessionToken: string | undefined
  let executionLeaseReleased = false
  let queueDrainScheduled = false

  const renewalTimer = effectiveLease
    ? setInterval(() => {
        void renewTaskChatExecutionLease(effectiveLease).catch((error) => {
          console.error('[task-chat] session lease renewal failed', {
            sessionKey: effectiveLease.sessionKey,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }, 60_000)
    : null
  renewalTimer?.unref?.()

  const releaseExecutionLease = async () => {
    if (executionLeaseReleased) {
      return
    }

    executionLeaseReleased = true
    if (renewalTimer) {
      clearInterval(renewalTimer)
    }
    try {
      await releaseTaskChatExecutionLease({
        taskId: params.task.id,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        lease: effectiveLease,
      })
    } catch (error) {
      console.error('[task-chat] session lease release failed', {
        sessionKey: effectiveLease?.sessionKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const scheduleQueueDrain = () => {
    if (queueDrainScheduled) {
      return
    }

    queueDrainScheduled = true
    void scheduleTaskChatQueueDrain({
      taskId: params.task.id,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
    })
  }

  if (!effectiveLease) {
    throw new Error('当前会话已有消息在处理中。')
  }

  try {
    // Token 配额控制：block 且当前周期超限时拒绝新的执行（warn 不阻断），
    // 覆盖 workspace turn 与 task chat 两类执行（main chat 在 requestMainChatExecutorReply 已检查）。
    await ensureTokenQuotaAccess(params.userId)

    billingSessionToken = (await getCommercialGate().startFreeExecutionSession({
      userId: params.userId,
      sessionKey: billingSessionKey,
      kind: 'task_chat',
      enforceLimit: false,
    })).token

    const initialPendingTask = buildPendingTask(
      params.task,
      normalizedMessage,
      timestamp,
      params.launchId || undefined,
      scopedWorkspaceId,
      scopedWorkspaceSessionId,
    )
    const initialWorkspaceSession = scopedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(
        params.task.id,
        scopedWorkspaceId,
        scopedWorkspaceSessionId,
      )
      : undefined
    const initialPendingSession = scopedWorkspaceId && initialWorkspaceSession
      ? buildPendingWorkspaceSession(
        params.task,
        initialWorkspaceSession,
        timestamp,
        resolveWorkspaceSessionExecutorId(initialWorkspaceSession),
      )
      : undefined
    const initialEffectiveWorkspaceSessionId = initialPendingSession?.id ?? scopedWorkspaceSessionId
    const turnAuthor = params.queueClaim?.author ?? resolveUserCreatorIdentity(params.userId) ?? {
      type: 'user' as const,
      id: params.userId,
      name: params.userId,
    }
    const userEvent = createUserMessageEvent(
      createTimelineCollector(effectiveTurnId),
      `user:${effectiveTurnId}`,
      normalizedMessage,
      timestamp,
      params.attachments,
      {
        authorId: turnAuthor.id,
        author: turnAuthor,
      },
    ) as Extract<ChatTimelineEvent, { kind: 'user_message' }>

    if (scopedWorkspaceId && initialEffectiveWorkspaceSessionId) {
      await persistPendingWorkspaceUserTurn({
        task: initialPendingTask,
        project: params.project,
        userId: params.userId,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: initialEffectiveWorkspaceSessionId,
        turnId: effectiveTurnId,
        userEvent,
        currentStep: initialPendingTask.currentStep,
      })
    }

    const workspacePreparation = scopedWorkspaceId
      ? await ensureWorkspaceChatTaskReady({
        state: params.state,
        userId: params.userId,
        task: initialPendingTask,
        project: params.project,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        turnId: effectiveTurnId,
      })
      : { task: initialPendingTask, session: undefined, cwd: undefined, error: undefined }

    const pendingTask = buildPendingTask(
      workspacePreparation.task,
      normalizedMessage,
      timestamp,
      params.launchId || undefined,
      scopedWorkspaceId,
      scopedWorkspaceSessionId,
    )
    const pendingSession = scopedWorkspaceId && workspacePreparation.session
      ? (() => {
          const selectedSession = params.runtimeConfig
            ? applyRuntimeSelectionToWorkspaceSession({
                task: workspacePreparation.task,
                session: workspacePreparation.session,
                runtimeConfig: params.runtimeConfig,
                updatedAt: timestamp,
              })
            : workspacePreparation.session
          return buildPendingWorkspaceSession(
            workspacePreparation.task,
            selectedSession,
            timestamp,
            resolveWorkspaceSessionExecutorId(selectedSession),
          )
        })()
      : undefined

    try {
      await saveTaskAndWait(pendingTask)
      if (pendingSession) {
        await saveWorkspaceSessionAndWait(pendingSession)
      }

      const pendingStateSource = loadState()
      const pendingTasks = pendingStateSource.tasks.map((item) => (item.id === pendingTask.id ? pendingTask : item))
      const pendingState = pendingSession
        ? upsertWorkspaceSessionInState({ ...pendingStateSource, tasks: pendingTasks }, pendingSession)
        : { ...pendingStateSource, tasks: pendingTasks }
      await withState(pendingState, undefined, params.userId)
    } catch (error) {
      if (params.queueClaim && !claimCompleted) {
        await releaseTaskChatQueueClaim({
          taskId: pendingTask.id,
          workspaceId: scopedWorkspaceId,
          workspaceSessionId: scopedWorkspaceSessionId,
          queueId: params.queueClaim.id,
          claimId: params.queueClaim.claimId,
        })
      }
      throw error
    }

    // Realtime workspace chat must publish to the actual persisted session key.
    // Newly created or recovered sessions can differ from the optional request id.
    const effectiveWorkspaceSessionId = pendingSession?.id ?? scopedWorkspaceSessionId

    publishTaskChatTaskUpdate(pendingTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId, {
      id: pendingTask.id,
      agentRunningStatus: pendingTask.agentRunningStatus,
      currentStep: pendingTask.currentStep,
      toolCalls: pendingTask.toolCalls,
      logs: pendingTask.logs,
    })
    publishTaskChatSessionUpdate(pendingTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId, pendingTask, params.project)

    publishTaskChatTimelineEvent(pendingTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId, userEvent)

    if (params.writer) {
      params.writer.write({
        type: 'data-session',
        data: normalizeTaskChatSessionSnapshot(buildTaskChatSessionSnapshot({
          task: pendingTask,
          project: params.project,
          workspaceId: scopedWorkspaceId,
          workspaceSessionId: effectiveWorkspaceSessionId,
        }), scopedWorkspaceId, effectiveWorkspaceSessionId),
        transient: true,
      })
      writeTimelineEvent(params.writer, userEvent)
    }

    const executionBinding = bindTaskChatExecutionAbortSignal([
      buildTaskChatSessionKey(pendingTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId),
      buildTaskChatSessionKey(pendingTask.id, scopedWorkspaceId, scopedWorkspaceSessionId),
    ], params.signal)

    const rawResult: TaskMessageResult = await (async () => {
      try {
        return workspacePreparation.error
          ? workspacePreparation.error
          : scopedWorkspaceId
            ? await runWorkspaceMessageViaExecutor({
              state: params.state,
              userId: params.userId,
              task: pendingTask,
              project: params.project,
              workspaceId: scopedWorkspaceId,
              workspaceSessionId: effectiveWorkspaceSessionId,
              session: pendingSession!,
              cwd: workspacePreparation.cwd!,
              message: normalizedMessage,
              attachments: params.attachments,
              contextRefs: params.contextRefs,
              turnId: effectiveTurnId,
              writer: params.writer,
              signal: executionBinding.signal,
            })
            : buildWorkerOnlyTaskDetailResult(pendingTask.agentType)
      } finally {
        executionBinding.cleanup()
      }
    })()
    const resultWithAssistantTimeline = scopedWorkspaceId
      ? ensureWorkspaceResultAssistantTimeline(
          rawResult,
          getServerAgentLabel((pendingSession?.agentType ?? pendingTask.agentType) as Task['agentType']),
        )
      : rawResult
    const result = scopedWorkspaceId && pendingSession
      ? markAgentCreatedPullRequestResult({
          result: resultWithAssistantTimeline,
          task: pendingTask,
          project: params.project,
          session: pendingSession,
        }).result
      : resultWithAssistantTimeline
    const agentPullRequest = result.delivery?.pullRequest
    if (
      scopedWorkspaceId
      && pendingSession
      && agentPullRequest
      && typeof agentPullRequest.number === 'number'
    ) {
      const pullRequestState = agentPullRequest.state === 'open'
        || agentPullRequest.state === 'merged'
        || agentPullRequest.state === 'closed'
        ? agentPullRequest.state
        : 'unknown'
      await registerProjectPullRequestContext({
        project: params.project,
        taskId: pendingTask.id,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: pendingSession.id,
        userId: params.userId,
        source: 'agent_output',
        role: 'delivery',
        pullRequest: {
          number: agentPullRequest.number,
          url: agentPullRequest.url,
          title: agentPullRequest.title,
          body: agentPullRequest.description,
          state: pullRequestState,
          baseBranch: agentPullRequest.baseBranch,
          compareBranch: agentPullRequest.compareBranch,
        },
      }).catch((error) => {
        console.error('[task-chat] failed to register agent-created pull request context', {
          taskId: pendingTask.id,
          workspaceId: scopedWorkspaceId,
          workspaceSessionId: pendingSession.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
    const rawTimelineEventIds = new Set((rawResult.conversationTimeline ?? []).map((event) => event.id))
    const synthesizedTimelineEvents = (result.conversationTimeline ?? []).filter((event) => !rawTimelineEventIds.has(event.id))
    const deferredTimelineEvents = (rawResult.conversationTimeline ?? []).filter(isDeferredWorkspaceTimelineEvent)
    const finalTimelineEvents = [...new Map(
      [...deferredTimelineEvents, ...synthesizedTimelineEvents].map((event) => [event.id, event]),
    ).values()]

    const latestWorkspaceSession = scopedWorkspaceId && pendingSession
      ? getWorkspaceSessionRecordForTaskContext(pendingTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId) ?? pendingSession
      : undefined
    const staleWorkspaceRuntimeResult = Boolean(
      scopedWorkspaceId
      && pendingSession
      && latestWorkspaceSession
      && latestWorkspaceSession.runtimeSequence > pendingSession.runtimeSequence,
    )

    const nextTask: Task = staleWorkspaceRuntimeResult
      ? (loadState().tasks.find((item) => item.id === pendingTask.id) ?? pendingTask)
      : scopedWorkspaceId
      ? {
          ...touchTaskStatus(pendingTask, new Date().toISOString()),
          needsHumanConfirm: result.ok,
          agentRunningStatus: result.agentRunningStatus ?? (result.ok ? 'complete' : 'error'),
          currentStep: result.currentStep ?? (result.ok ? '工作区对话已完成' : '工作区对话失败'),
        }
      : applyTaskMessageResult(pendingTask, result, scopedWorkspaceId)

    if (params.writer && !scopedWorkspaceId) {
      writeFinalTextResult(params.writer, result)
    }

    const nextSession = scopedWorkspaceId && latestWorkspaceSession && !staleWorkspaceRuntimeResult
      ? applyWorkspaceMessageResult(pendingTask, latestWorkspaceSession, result)
      : undefined
    if (nextSession && pendingSession?.runtimeStartedAt) {
      const usageRecord = getManagedCloudGate().buildUsageRecord({
        state: params.state,
        userId: params.userId,
        session: nextSession,
        startedAt: pendingSession.runtimeStartedAt,
        endedAt: nextSession.lastRuntimeEventAt ?? nextSession.updatedAt,
        ok: result.ok,
        id: `turn:${effectiveTurnId}`,
      })
      if (usageRecord) {
        getManagedCloudGate().recordUsage(usageRecord)
      }
    }

    const linkedTaskRunId = params.queueClaim?.taskRunId ?? result.taskRunId
    const linkedTaskRun = linkedTaskRunId ? getTaskRun(linkedTaskRunId) : null
    if (linkedTaskRun) {
      const status = params.queueClaim?.taskRunId
        ? resolveWorkspaceTaskRunStatus(result)
        : linkedTaskRun.status
      const terminalStatus = status === 'completed' || status === 'failed' || status === 'cancelled'
        ? status
        : null
      saveTaskRun({
        ...linkedTaskRun,
        status,
        agentSessionId: result.agentSessionId ?? result.opencodeSessionId ?? linkedTaskRun.agentSessionId ?? linkedTaskRun.opencodeSessionId,
        opencodeSessionId: result.opencodeSessionId ?? linkedTaskRun.opencodeSessionId,
        executionModel: result.executionModel ?? nextSession?.executionModel ?? pendingTask.executionModel ?? linkedTaskRun.executionModel,
        usage: result.usage ?? linkedTaskRun.usage,
        summary: result.output,
        result: terminalStatus
          ? buildWorkspaceTaskRunResult({
              taskRun: linkedTaskRun,
              taskId: pendingTask.id,
              session: nextSession,
              result,
              completedAt: nextTask.updatedAt,
              status: terminalStatus,
            })
          : linkedTaskRun.result,
        updatedAt: nextTask.updatedAt,
      })
    }

    if (nextSession) {
      handoffSubagentTurnToParent({
        task: nextTask,
        project: params.project,
        session: nextSession,
        result,
      })
    }

    if (!staleWorkspaceRuntimeResult) {
      await saveTaskAndWait(nextTask)
      if (nextSession) {
        await saveWorkspaceSessionAndWait(nextSession)
      }
    }

    await persistTaskConversationTurn({
      project: params.project,
      task: pendingTask,
      userId: params.userId,
      author: turnAuthor,
      userMessage: normalizedMessage,
      attachments: params.attachments,
      result,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: effectiveWorkspaceSessionId,
    })

    if (nextSession && linkedTaskRun && params.queueClaim?.requestedByAgentId) {
      await publishQueuedWorkspaceTurnAttention({
        task: nextTask,
        project: params.project,
        session: nextSession,
        taskRunId: linkedTaskRun.id,
        requestedByUserId: params.userId,
        requestedByAgentId: params.queueClaim.requestedByAgentId,
        sourceAgentEventId: params.queueClaim.sourceAgentEventId,
        result,
      })
    }

    const finalStateSource = loadState()
    const nextTasks = finalStateSource.tasks.map((item) => (item.id === nextTask.id ? nextTask : item))
    const nextState = staleWorkspaceRuntimeResult
      ? finalStateSource
      : nextSession
      ? upsertWorkspaceSessionInState({ ...finalStateSource, tasks: nextTasks }, nextSession)
      : { ...finalStateSource, tasks: nextTasks }
    let responseState = await withState(nextState, undefined, params.userId)

    if (params.queueClaim && !claimCompleted) {
      await completeTaskChatQueueClaim({
        taskId: nextTask.id,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        queueId: params.queueClaim.id,
        claimId: params.queueClaim.claimId,
      })
      claimCompleted = true
      responseState = await withState(loadState(), undefined, params.userId)
    }

    await releaseExecutionLease()

    const broadcastTask = scopedWorkspaceId && latestWorkspaceSession
      ? buildWorkspaceTaskExecutionView(nextTask, nextSession ?? latestWorkspaceSession)
      : nextTask
    publishTaskChatTaskUpdate(nextTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId, {
      id: broadcastTask.id,
      agentRunningStatus: broadcastTask.agentRunningStatus,
      currentStep: broadcastTask.currentStep,
      toolCalls: broadcastTask.toolCalls,
      logs: broadcastTask.logs,
    })
    publishTaskChatSessionUpdate(nextTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId, nextTask, params.project)

    if (params.writer) {
      const responseWorkspaceSession = nextSession ?? (staleWorkspaceRuntimeResult ? latestWorkspaceSession : undefined)
      params.writer.write({
        type: 'data-task',
        data: responseWorkspaceSession ? buildWorkspaceTaskExecutionView(nextTask, responseWorkspaceSession) : nextTask,
        transient: true,
      })
      params.writer.write({
        type: 'data-session',
        data: normalizeTaskChatSessionSnapshot(buildTaskChatSessionSnapshot({
          task: nextTask,
          project: params.project,
          workspaceId: scopedWorkspaceId,
          workspaceSessionId: effectiveWorkspaceSessionId,
        }), scopedWorkspaceId, effectiveWorkspaceSessionId),
        transient: true,
      })
    }
    for (const event of finalTimelineEvents) {
      publishTaskChatTimelineEvent(nextTask.id, scopedWorkspaceId, effectiveWorkspaceSessionId, event)
      if (params.writer) {
        writeTimelineEvent(params.writer, event)
      }
    }
    scheduleQueueDrain()

    billingCompleted = result.ok

    return {
      pendingTask,
      pendingSession,
      nextTask,
      nextSession,
      result,
      responseState,
    }
  } catch (error) {
    if (params.queueClaim && !claimCompleted) {
      await releaseTaskChatQueueClaim({
        taskId: params.task.id,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        queueId: params.queueClaim.id,
        claimId: params.queueClaim.claimId,
      })
    }
    throw error
  } finally {
    await releaseExecutionLease()
    scheduleQueueDrain()
    if (billingSessionToken) {
      await getCommercialGate().finishFreeExecutionSession({
        token: billingSessionToken,
        completed: billingCompleted,
        eventId: effectiveTurnId,
      })
    }
  }
}

const runTaskChatQueueDrain = async (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  while (true) {
    const drainContext = resolveQueuedTaskChatDrainContext(params)
    if (!drainContext) {
      return
    }

    if (isTaskChatRuntimeBusy(drainContext.scopedRuntimeTask.agentRunningStatus)) {
      return
    }

    const executionLease = await tryAcquireTaskChatExecutionLease({
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
    })
    if (!executionLease) {
      return
    }

    let executionHandedOff = false

    try {
      const { nextQueued, context } = drainContext

      const dispatchAvailability = await resolveWorkspaceChatDispatchAvailabilityAsync({
        state: context.state,
        userId: context.userId,
        task: context.task,
        project: context.project,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId,
      })
      if (!dispatchAvailability.ready) {
        return
      }

      const claim = await claimTaskChatQueueEntry({
        taskId: params.taskId,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId,
        queueId: nextQueued.id,
        claimedBy: 'server-drain',
      })
      if (!claim) {
        // 其他节点已 claim 队头：内联刷新镜像避免基于陈旧队头空转。
        await refreshTaskChatQueueMirror()
        continue
      }
      if (claim.taskRunId) {
        const taskRun = getTaskRun(claim.taskRunId)
        if (taskRun) {
          saveTaskRun({
            ...taskRun,
            status: 'executing',
            updatedAt: new Date().toISOString(),
          })
        }
      }
      publishTaskChatSessionUpdate(params.taskId || context.task.id, params.workspaceId, params.workspaceSessionId, context.task, context.project)

      try {
        const runtimeContext = await applyTaskChatMessageRuntimeConfig({
          userId: context.userId,
          taskId: params.taskId || context.task.id,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId,
          runtimeConfig: claim.runtimeConfig,
        })
        executionHandedOff = true
        await executeTaskChatTurn({
          state: runtimeContext.state,
          userId: context.userId,
          task: runtimeContext.task,
          project: runtimeContext.project,
          message: claim.message,
          attachments: claim.attachments,
          contextRefs: claim.contextRefs,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId,
          turnId: buildTaskChatQueueTurnId(claim.id),
          queueClaim: {
            id: claim.id,
            claimId: claim.claimId,
            contextRefs: claim.contextRefs,
            taskRunId: claim.taskRunId,
            requestedByAgentId: claim.requestedByAgentId,
            sourceAgentEventId: claim.sourceAgentEventId,
            author: claim.author,
          },
          runtimeConfig: claim.runtimeConfig,
          executionSlotAlreadyAcquired: true,
          sessionLease: executionLease,
        })
      } catch (error) {
        let queueDroppedAfterRetries = false
        if (!executionHandedOff) {
          if (claim.taskRunId) {
            await completeTaskChatQueueClaim({
              taskId: params.taskId,
              workspaceId: params.workspaceId,
              workspaceSessionId: params.workspaceSessionId,
              queueId: claim.id,
              claimId: claim.claimId,
            })
          } else {
            const releaseResult = await releaseTaskChatQueueClaim({
              taskId: params.taskId,
              workspaceId: params.workspaceId,
              workspaceSessionId: params.workspaceSessionId,
              queueId: claim.id,
              claimId: claim.claimId,
            })
            queueDroppedAfterRetries = releaseResult.dropped
          }
          if (params.workspaceId) {
            persistWorkspaceFailureTurn({
              task: context.task,
              project: context.project,
              userId: context.userId,
              workspaceId: params.workspaceId,
              workspaceSessionId: params.workspaceSessionId,
              userMessage: claim.message,
              attachments: claim.attachments,
              errorMessage: error instanceof Error ? error.message : String(error),
              taskRunId: claim.taskRunId,
              requestedByAgentId: claim.requestedByAgentId,
              sourceAgentEventId: claim.sourceAgentEventId,
              author: claim.author,
            })
          }
        }
        console.error('[task-chat-queue-drain] execute-failed', JSON.stringify({
          taskId: params.taskId,
          workspaceId: params.workspaceId ?? null,
          queueId: claim.id,
          retryCount: claim.retryCount ?? 0,
          droppedAfterRetries: queueDroppedAfterRetries,
          error: error instanceof Error ? error.message : String(error),
        }))
        return
      }
    } finally {
      if (!executionHandedOff) {
        await releaseTaskChatExecutionLease({
          taskId: params.taskId,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId,
          lease: executionLease,
        })
      }
    }
  }
}

export const scheduleTaskChatQueueDrain = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  if (activeTaskChatDrainSessions.has(sessionKey)) {
    pendingTaskChatDrainSessions.add(sessionKey)
    return
  }

  activeTaskChatDrainSessions.add(sessionKey)
  void (async () => {
    try {
      do {
        pendingTaskChatDrainSessions.delete(sessionKey)
        await runTaskChatQueueDrain(params)
      } while (pendingTaskChatDrainSessions.has(sessionKey))
    } finally {
      activeTaskChatDrainSessions.delete(sessionKey)
      pendingTaskChatDrainSessions.delete(sessionKey)
    }
  })()
}

export const getTaskChatWorkspaceIfVisible = (userId: string, project: Project, workspaceId: string) => {
  return getScopedWorkspaceForProject(userId, project, workspaceId)
}

export const isTaskChatQueueDrainBlocked = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (isTaskChatExecutionActive({ taskId: task.id, workspaceId, workspaceSessionId })) {
    return true
  }

  if (workspaceId) {
    const workspaceSession = loadState().workspaceSessions.find((item) => {
      return item.workspaceId === workspaceId
        && (!workspaceSessionId || item.id === workspaceSessionId)
        && item.status !== 'archived'
    })
    const workspace = getWorkspace(workspaceId)
    const executorId = resolveWorkspaceWorkerId(workspace) || resolveWorkspaceSessionExecutorId(workspaceSession)
    if (executorId && (executorRegistry.getExecutor(executorId)?.status !== 'online' || !executorRegistry.getSocket(executorId))) {
      return true
    }
  }

  if (hasSharedWorktreeSessionConflict(task, workspaceId, workspaceSessionId)) {
    return true
  }

  const scopedTask = resolveScopedRuntimeTask(task, workspaceId, workspaceSessionId)
  return isTaskChatRuntimeBusy(scopedTask.agentRunningStatus)
}

executorRegistry.onExecutorOnline((executorId) => {
  scheduleQueuedTaskChatDrainForExecutor(executorId)
})

// 过期 claim 被任一节点清扫恢复后，在本节点调度 drain（无 executor 连接的节点会自然失败退出）。
registerTaskChatQueueDrainScheduler(({ taskId, workspaceId, workspaceSessionId }) => {
  scheduleTaskChatQueueDrain({ taskId, workspaceId, workspaceSessionId })
})
