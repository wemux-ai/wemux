// [INPUT]: 已鉴权任务请求、工作区会话上下文、任务聊天队列与执行调度服务
// [OUTPUT]: 任务交互 HTTP API；包含独立 AgentTaskRun transcript、评论维护/反应，聊天入队请求快速返回
// [POS]: server 控制面的任务交互协议层，不直接承担 worker 本地执行职责
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { mergeAgentRuntimeSettings } from '@shared/agent-config'
import { getImportableExecutorAgentSessionEntries } from '@shared/executor-agent-session'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import { findMatchingAgentExecutionModelOption } from '@shared/model-profile'
import { withOpenCodeExecutionModel } from '@shared/opencode-execution-config'
import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import { toggleMessageReaction } from '@shared/message-reactions'
import { normalizeTaskChatContextRefs } from '@shared/task-chat-context'
import { buildTaskChatSessionKey, normalizeTaskChatMessageRuntimeConfig } from '@shared/task-chat-session'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import { mergeWorkspaceSession, resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import type { WorkspaceSessionEventRecord, WorkspaceSessionTurnRecord } from '@shared/workspace-session-history'
import type { AppState, ExecutorAgentSessionDetail, Task, WorkspaceSessionRuntimeStatus } from '@shared/types'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import {
  buildTaskChatQueueTurnId,
  buildTaskChatSessionSnapshot,
  enqueueTaskChatMessage,
  removeTaskChatQueueEntry,
} from '../control-plane/task-chat-service'
import { appendTaskConversationMessage, deleteConversationMessagesByAnchor, getTaskConversationWithMessages, importTaskConversationMessages } from '../control-plane/conversation-service'
import { executorWsRequests } from '../control-plane/executor-ws-requests'
import { getUserById, isProjectAccessible } from '../repositories/auth'
import { loadState, saveTaskAndWait, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { publishTaskChatPart } from '../services/task-chat-broadcast-service'
import { validateProjectExecutorPathAccess } from '../services/project-executor-ownership'
import { recordTaskObservation } from '../services/task-observation-service'
import { cancelAgentEvent, listTaskAgentActivities, publishAgentEvent, resolveAgentDispatchReadiness, retryAgentEvent, selectAgentEventTranscriptMessages } from '../services/agent-event-runtime'
import { createTaskAgentActivityStream } from '../services/task-agent-activity-stream'
import { resolveTaskAgentAssignment } from '../services/task-agent-assignment-service'
import { recordTaskAssignmentHistory } from '../services/task-assignment-history-service'
import { deliverHumanTaskAssignment, deliverTaskAssignment, resolveTaskAssignmentActor } from '../services/task-assignment-delivery-service'
import { appendTaskComment, deleteTaskComment, editTaskComment, previewTaskCommentEvent, publishTaskCommentEvent, resolveTaskCommentMentions, setTaskCommentReaction, setTaskCommentResolution } from '../services/task-comment-service'
import { setTaskSubscriber } from '../services/task-subscriber-service'
import { getServerAgentSettings } from '../services/server-agent'
import { buildTaskConversationHandoffSnapshot } from '../services/conversation-handoff'
import {
  getWorkspaceSessionHistoryProjection,
  persistWorkspaceSessionTurnHistory,
  workspaceSessionHasPersistedHistory,
} from '../storage/postgres/workspace-session-history-store'
import { listProjectBindings } from '../storage/distributed-task-store'
import { resolveUserWorkspaceShareAccess } from '../services/workspace-share-service'
import {
  executeTaskChatTurn,
  getTaskChatWorkspaceIfVisible,
  isTaskChatRuntimeBusy,
  isTaskChatQueueDrainBlocked,
  markTaskChatRuntimeStopped,
  loadTaskModelOptionsFromExecutor,
  publishTaskChatSessionUpdate,
  resolveWorkspaceChatDispatchAvailability,
  resolveScopedRuntimeTask,
  releaseTaskChatExecutionLease,
  scheduleTaskChatQueueDrain,
  stopTaskChatExecutionAcrossNodes,
  tryAcquireTaskChatExecutionLease,
} from '../services/task-chat-dispatch'
import { isTokenQuotaLimitError } from '../services/token-quota-service'
import { getAuthorizedTask, getUserIdFromHeader, jsonError, publishState, taskAgentActivityRetrySchema, taskAgentManagedSchema, taskAgentSchema, taskAgentSettingsSchema, taskAssignedAgentStartSchema, taskAssigneeSchema, taskCommentEditSchema, taskCommentReactionSchema, taskCommentResolutionSchema, taskCommentSchema, taskMcpSettingsSchema, taskModelSchema, taskSubscriberSchema, withClusterState, withState } from './shared'
import { getAgentTaskRun } from '../storage/postgres/agent-task-run-store'
import { getCommercialGate } from '../services/gate/commercial-gate'
import {
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getWorkspaceSessionRecordForTaskContext,
  upsertTaskWorkspaceBindingInState,
  upsertWorkspaceSessionInState,
} from './task-route-support'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'

const taskObservationSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
  kind: z.enum(['action', 'terminal', 'browser-console', 'network', 'screenshot']),
  level: z.enum(['info', 'success', 'warning', 'error']).optional(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).optional(),
  url: z.string().trim().url().max(2000).optional(),
  attachments: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const taskConversationQuerySchema = z.object({
  recentTurns: z.coerce.number().int().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  beforeMessageId: z.string().trim().min(1).optional(),
  afterMessageId: z.string().trim().min(1).optional(),
})

const taskImportAgentSessionQuerySchema = z.object({
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().min(1).optional(),
  executorId: z.string().trim().min(1).optional(),
  source: z.enum(['claude', 'opencode', 'codex', 'pi']).optional(),
  sessionId: z.string().trim().min(1).optional(),
})

const taskImportAgentSessionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().min(1).optional(),
  executorId: z.string().trim().min(1).optional(),
  source: z.enum(['claude', 'opencode', 'codex', 'pi']),
  sessionId: z.string().trim().min(1),
})

const normalizeTaskChatSnapshot = <T extends ReturnType<typeof buildTaskChatSessionSnapshot>>(snapshot: T, workspaceId?: string, workspaceSessionId?: string) => {
  return {
    ...snapshot,
    scope: {
      ...snapshot.scope,
      workspaceId,
      workspaceSessionId,
    },
    queue: {
      ...snapshot.queue,
      items: snapshot.queue.items.map((item) => ({
        ...item,
        workspaceId,
        workspaceSessionId,
      })),
    },
  }
}

const resolveTaskAgentExecutorNodeId = async (params: {
  state: AppState
  userId: string
  workspaceId?: string
  projectWorkspaceId?: string
  executorNodeId?: string
}) => {
  const executorNodeId = params.executorNodeId?.trim()
  if (!isManagedCloudAutoExecutorId(executorNodeId)) {
    return executorNodeId
  }

  getManagedCloudGate().ensureDevOnlyAccess()
  await getManagedCloudGate().ensureUsageAccess({
    state: params.state,
    userId: params.userId,
  })

  const result = await getManagedCloudGate().ensureExecutor({
    config: params.state.config,
    ownerUserId: params.userId,
    workspaceId: params.projectWorkspaceId?.trim() || params.workspaceId?.trim() || undefined,
    projects: params.state.projects,
  })
  return result.executor.executorId
}

const queueTaskChatMessage = async (params: {
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
  dedupeKey?: string
  message: string
  attachments?: ReturnType<typeof normalizeTaskChatAttachments>
  contextRefs?: ReturnType<typeof normalizeTaskChatContextRefs>
  runtimeConfig?: ReturnType<typeof normalizeTaskChatMessageRuntimeConfig>
  createdBy: string
}) => {
  await enqueueTaskChatMessage({
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    dedupeKey: params.dedupeKey,
    message: params.message,
    attachments: params.attachments,
    contextRefs: params.contextRefs,
    runtimeConfig: params.runtimeConfig,
    createdBy: params.createdBy,
  })
}

const persistQueuedWorkspaceSessionUserTurn = async (params: {
  task: Task
  workspaceId: string
  workspaceSessionId: string
  queuedEntry: Awaited<ReturnType<typeof enqueueTaskChatMessage>>
  userId: string
  message: string
  attachments: ReturnType<typeof normalizeTaskChatAttachments>
  currentStep: string
}) => {
  const turnId = buildTaskChatQueueTurnId(params.queuedEntry.id)
  const timestamp = params.queuedEntry.createdAt
  const userMessageEvent: Extract<WorkspaceSessionEventRecord, { kind: 'user_message' }> = {
    id: `user:${turnId}`,
    sessionId: params.workspaceSessionId,
    turnId,
    sessionSeq: 0,
    turnSeq: 1,
    createdAt: timestamp,
    visibility: 'transcript',
    kind: 'user_message',
    payload: {
      messageId: `user:${turnId}`,
      text: params.message,
      authorId: params.userId,
      ...(params.attachments.length ? { attachments: params.attachments } : {}),
    },
  }
  const turn: WorkspaceSessionTurnRecord = {
    id: turnId,
    sessionId: params.workspaceSessionId,
    status: 'running',
    startedAt: timestamp,
    eventCount: 1,
  }

  await persistWorkspaceSessionTurnHistory({
    sessionId: params.workspaceSessionId,
    taskId: params.task.id,
    workspaceId: params.workspaceId,
    turn,
    events: [userMessageEvent],
    runtime: {
      sessionId: params.workspaceSessionId,
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      agentRunningStatus: params.task.agentRunningStatus,
      runtimeStatus: 'running',
      currentStep: params.currentStep,
      queueStatus: 'queued',
      activeToolCalls: [],
      lastEventSeq: 0,
      lastEventAt: timestamp,
      updatedAt: timestamp,
    },
  })

  return getWorkspaceSessionHistoryProjection(params.workspaceSessionId)
}

const publishTaskChatSessionSnapshot = (params: {
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
  task: Task
  project: AppState['projects'][number]
}) => {
  const snapshot = normalizeTaskChatSnapshot(buildTaskChatSessionSnapshot({
    task: params.task,
    project: params.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  }), params.workspaceId, params.workspaceSessionId)

  publishTaskChatPart(buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId), {
    type: 'session',
    data: snapshot,
  })

  return snapshot
}

const resolveWorkspaceSessionImportTarget = (
  userId: string,
  project: AppState['projects'][number],
  taskId: string,
  workspaceId: string,
  workspaceSessionId?: string,
  executorId?: string,
) => {
  const workspace = getTaskChatWorkspaceIfVisible(userId, project, workspaceId)
  if (!workspace) {
    return { workspace: null, workspaceSession: null, executor: null, status: 404 as const, message: '工作区不存在或无权访问。' }
  }

  const normalizedWorkspaceSessionId = workspaceSessionId?.trim()
  const workspaceSession = normalizedWorkspaceSessionId
    ? getWorkspaceSessionRecordForTaskContext(taskId, workspaceId, normalizedWorkspaceSessionId)
    : null
  if (normalizedWorkspaceSessionId && !workspaceSession) {
    return { workspace, workspaceSession: null, executor: null, status: 404 as const, message: '工作区会话不存在。' }
  }

  const resolvedExecutorId = executorId?.trim()
    || resolveWorkspaceSessionExecutorId(workspaceSession, workspace.executorNodeId)
    || ''
  if (!resolvedExecutorId) {
    return { workspace, workspaceSession, executor: null, status: 400 as const, message: '当前工作区没有可用的执行节点。' }
  }

  const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === resolvedExecutorId) ?? null
  if (!executor) {
    return { workspace, workspaceSession, executor: null, status: 404 as const, message: '执行节点不存在或无权访问。' }
  }

  return { workspace, workspaceSession, executor, status: 200 as const, message: '' }
}

const buildImportedWorkspaceSessionTitle = (session: Pick<ExecutorAgentSessionDetail, 'source' | 'title'>) => {
  const explicitTitle = session.title.trim()
  if (explicitTitle) {
    return explicitTitle
  }

  switch (session.source) {
    case 'claude':
      return '导入会话 · Claude Code'
    case 'opencode':
      return '导入会话 · OpenCode'
    case 'codex':
      return '导入会话 · Codex'
    case 'pi':
      return '导入会话 · Pi'
    default:
      return '导入会话'
  }
}

let publishStateQueue = Promise.resolve()

const publishStateInBackground = (state: AppState) => {
  publishStateQueue = publishStateQueue
    .catch(() => undefined)
    .then(async () => {
      await publishState(state)
    })
    .catch((error) => {
      console.error('[task-interaction-routes] publish state failed', error)
    })
}

export const registerTaskInteractionRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.post('/api/tasks/:id/acknowledge-confirmation', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    if (!taskResult.task.needsHumanConfirm) {
      return c.json(await withState(state, undefined, userId))
    }

    const nextTask: Task = {
      ...taskResult.task,
      needsHumanConfirm: false,
      updatedAt: new Date().toISOString(),
    }

    await saveTaskAndWait(nextTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    const nextState: AppState = {
      ...state,
      tasks,
    }

    return c.json(await withState(nextState, undefined, userId))
  })

  app.post('/api/tasks/:id/send', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const { message, attachments } = await c.req.json().catch(() => ({ message: '', attachments: [] }))
    const normalizedAttachments = normalizeTaskChatAttachments(attachments)
    if (!message?.trim()) return c.json({ message: '消息不能为空。' }, 400)

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    console.log('[task-send] start', JSON.stringify({
      taskId,
      projectId: taskResult.project.id,
      messagePreview: message.slice(0, 200),
    }))

    const runtimeBlocked = isTaskChatQueueDrainBlocked(taskResult.task, undefined)
    const executionLease = runtimeBlocked
      ? null
      : await tryAcquireTaskChatExecutionLease({ taskId })
    if (!executionLease) {
      await queueTaskChatMessage({
        taskId,
        message: message.trim(),
        attachments: normalizedAttachments,
        createdBy: userId,
      })
      scheduleTaskChatQueueDrain({ taskId })
      return c.json(await withState(loadState(), '消息已入队。', userId))
    }

    const freeQuotaAccess = await getCommercialGate().resolveFreeExecutionQuotaAccess(userId)
    if (!freeQuotaAccess.allowed) {
      await releaseTaskChatExecutionLease({ taskId, lease: executionLease })
      return c.json({ message: freeQuotaAccess.message }, 429)
    }

    let execution
    try {
      execution = await executeTaskChatTurn({
        state,
        userId,
        task: taskResult.task,
        project: taskResult.project,
        message: message.trim(),
        attachments: normalizedAttachments,
        turnId: crypto.randomUUID(),
        executionSlotAlreadyAcquired: true,
        sessionLease: executionLease,
      })
    } catch (error) {
      // Token 配额超限：明确 429 提示，避免落入通用 500。
      if (isTokenQuotaLimitError(error)) {
        await releaseTaskChatExecutionLease({ taskId, lease: executionLease })
        return c.json({ message: error.message }, 429)
      }
      throw error
    }

    console.log('[task-send] result', JSON.stringify({
      taskId,
      ok: execution.result.ok,
      opencodeSessionId: execution.result.opencodeSessionId,
      currentStep: execution.result.currentStep,
      agentRunningStatus: execution.result.agentRunningStatus,
      outputPreview: (execution.result.output ?? '').slice(0, 300),
    }))

    return c.json({
      ...execution.responseState,
      message: execution.result.ok ? '消息已发送。' : '消息发送失败。',
    })
  })

  app.get('/api/tasks/:id/models', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const executorId = c.req.query('executorId')?.trim() || undefined
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || undefined

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) {
      return jsonError(c, taskResult.message, taskResult.status)
    }

    const workspace = workspaceId
      ? getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)
      : undefined
    const workspaceSession = workspaceId
      ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, workspaceId, workspaceSessionId)
      : null
    const result = await loadTaskModelOptionsFromExecutor(
      userId,
      taskResult.task,
      executorId || resolveWorkspaceSessionExecutorId(workspaceSession, workspace?.executorNodeId),
      workspaceSession?.agentType ?? workspace?.agentType,
    )

    if (!result.ok) {
      return c.json({ message: result.message }, result.status)
    }

    return c.json(result)
  })

  app.post('/api/tasks/:id/model', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const rawPayload = await c.req.json().catch(() => ({ executionModel: '' }))
    const payload = taskModelSchema.parse(rawPayload)
    const compact = c.req.query('compact') === '1'
    const requestedModel = payload.executionModel?.trim() || undefined
    const scopedWorkspaceId = payload.workspaceId?.trim() || undefined
    const scopedWorkspaceSessionId = typeof rawPayload?.workspaceSessionId === 'string' ? rawPayload.workspaceSessionId.trim() || undefined : undefined

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    const scopedWorkspace = scopedWorkspaceId
      ? getTaskChatWorkspaceIfVisible(userId, taskResult.project, scopedWorkspaceId)
      : undefined
    if (scopedWorkspaceId && !scopedWorkspace) {
      return c.json({ message: '工作区不存在或不可见。' }, 404)
    }
    const requestedExecutorId = payload.executorNodeId?.trim() || undefined
    const workspaceWorkerId = resolveWorkspaceWorkerId(scopedWorkspace)
    if (scopedWorkspaceId && requestedExecutorId && requestedExecutorId !== workspaceWorkerId) {
      return c.json({ message: '执行节点属于工作区，请先在工作区设置中切换当前节点。' }, 409)
    }
    const scopedWorkspaceSession = scopedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, scopedWorkspaceId, scopedWorkspaceSessionId)
      : null
    const effectiveAgentType = scopedWorkspaceSession?.agentType ?? scopedWorkspace?.agentType ?? taskResult.task.agentType
    const effectiveOpencodeConfig = scopedWorkspaceSession?.opencodeConfig ?? taskResult.task.opencodeConfig

    if (requestedModel) {
      if (getCommercialGate().isPremiumExecutionModel(requestedModel)) {
        const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(userId, 'premium_models')
        if (!featureAccess.allowed) {
          return c.json({ message: featureAccess.message, billingFeatureAccess: featureAccess }, 402)
        }
      }

      const modelsResult = await loadTaskModelOptionsFromExecutor(
        userId,
        taskResult.task,
        scopedWorkspaceId
          ? workspaceWorkerId
          : requestedExecutorId || resolveWorkspaceSessionExecutorId(scopedWorkspaceSession, scopedWorkspace?.executorNodeId),
        effectiveAgentType,
      )
      if (!modelsResult.ok) {
        return c.json({ message: modelsResult.message }, modelsResult.status)
      }

      const isAvailable = Boolean(findMatchingAgentExecutionModelOption(effectiveAgentType, modelsResult.models, requestedModel))
      if (!isAvailable) {
        return c.json({ message: '所选模型当前不可用。' }, 400)
      }
    }

    const timestamp = new Date().toISOString()
    const bindingState = scopedWorkspaceId
      ? ensureTaskWorkspaceBindingState({
          task: taskResult.task,
          workspaceId: scopedWorkspaceId,
          updatedAt: timestamp,
        })
      : null
    const baseTask = bindingState?.task ?? taskResult.task
    const nextTask: Task = {
      ...baseTask,
      executionModel: scopedWorkspaceId ? baseTask.executionModel : requestedModel,
      opencodeConfig: scopedWorkspaceId
        ? baseTask.opencodeConfig
        : effectiveAgentType === 'OpenCode'
          ? withOpenCodeExecutionModel(effectiveOpencodeConfig, requestedModel)
          : effectiveOpencodeConfig,
      updatedAt: timestamp,
    }

    const nextSession = scopedWorkspaceId
      ? (() => {
          if (!scopedWorkspace) {
            return null
          }

          return mergeWorkspaceSession(nextTask, ensureWorkspaceSessionRecord({
            task: nextTask,
            workspaceId: scopedWorkspaceId,
            executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(scopedWorkspaceSession, scopedWorkspace.executorNodeId),
            workspace: scopedWorkspace,
            workspaceSessionId: scopedWorkspaceSessionId,
          }), {
            executionModel: requestedModel,
            opencodeConfig: effectiveAgentType === 'OpenCode'
              ? withOpenCodeExecutionModel(effectiveOpencodeConfig, requestedModel)
              : effectiveOpencodeConfig,
            updatedAt: timestamp,
          })
        })()
      : null

    await saveTaskAndWait(nextTask)
    if (nextSession) {
      await saveWorkspaceSessionAndWait(nextSession)
    }
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    const nextState: AppState = nextSession
      ? upsertWorkspaceSessionInState({
          ...state,
          tasks,
        }, nextSession)
      : {
          ...state,
          tasks,
        }
    const message = requestedModel ? '任务模型已更新。' : '已切换为默认模型。'
    publishStateInBackground(nextState)
    if (compact) {
      return c.json({
        message,
        task: nextTask,
        workspaceSession: nextSession,
        workspaceSessionId: nextSession?.id,
      })
    }

    return c.json(await withState(nextState, message, userId))
  })

  app.post('/api/tasks/:id/agent', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const rawPayload = await c.req.json().catch(() => ({ agentType: 'OpenCode' }))
    const payload = taskAgentSchema.parse(rawPayload)
    const scopedWorkspaceId = payload.workspaceId?.trim() || undefined
    const scopedWorkspaceSessionId = typeof rawPayload?.workspaceSessionId === 'string' ? rawPayload.workspaceSessionId.trim() || undefined : undefined

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const scopedWorkspace = scopedWorkspaceId
      ? getTaskChatWorkspaceIfVisible(userId, taskResult.project, scopedWorkspaceId)
      : undefined
    if (scopedWorkspaceId && !scopedWorkspace) {
      return c.json({ message: '工作区不存在或不可见。' }, 404)
    }

    const timestamp = new Date().toISOString()
    const currentSession = scopedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, scopedWorkspaceId, scopedWorkspaceSessionId)
      : null
    const currentAgentType = currentSession?.agentType ?? taskResult.task.agentType
    const currentExecutionModel = currentSession?.executionModel ?? taskResult.task.executionModel
    const requestedExecutorId = payload.executorNodeId?.trim() || undefined
    const workspaceWorkerId = resolveWorkspaceWorkerId(scopedWorkspace)
    if (scopedWorkspaceId && requestedExecutorId && requestedExecutorId !== workspaceWorkerId) {
      return c.json({ message: '执行节点属于工作区，请先在工作区设置中切换当前节点。' }, 409)
    }

    let preferredExecutorId: string | undefined = scopedWorkspaceId
      ? workspaceWorkerId
      : requestedExecutorId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace?.executorNodeId)
    console.info('[task-agent-route][executor-switch][request]', JSON.stringify({
      userId,
      taskId,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
      payloadAgentType: payload.agentType,
      payloadExecutorNodeId: payload.executorNodeId?.trim() || '',
      currentSessionExecutorNodeId: currentSession?.executorNodeId ?? '',
      currentSessionRuntimeOwnerExecutorId: currentSession?.runtimeOwnerExecutorId ?? '',
      scopedWorkspaceExecutorNodeId: scopedWorkspace?.executorNodeId ?? '',
      initialPreferredExecutorId: preferredExecutorId ?? '',
    }))
    try {
      preferredExecutorId = await resolveTaskAgentExecutorNodeId({
        state,
        userId,
        workspaceId: scopedWorkspaceId,
        projectWorkspaceId: taskResult.project.workspaceId,
        executorNodeId: preferredExecutorId,
      })
    } catch (error) {
      console.warn('[task-agent-route][executor-switch][resolve-failed]', JSON.stringify({
        userId,
        taskId,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        requestedExecutorNodeId: payload.executorNodeId?.trim() || '',
        initialPreferredExecutorId: preferredExecutorId ?? '',
        error: error instanceof Error ? error.message : String(error),
      }))
      return c.json({ message: error instanceof Error ? error.message : '官方云节点暂不可用。' }, getManagedCloudGate().isUsageLimitError(error) ? 402 : 400)
    }
    console.info('[task-agent-route][executor-switch][resolved]', JSON.stringify({
      userId,
      taskId,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
      requestedExecutorNodeId: payload.executorNodeId?.trim() || '',
      resolvedPreferredExecutorId: preferredExecutorId ?? '',
    }))

    if (preferredExecutorId) {
      const matchedExecutor = listVisibleExecutorsForUser(userId).find((executor) => executor.executorId === preferredExecutorId)
      if (!getManagedCloudGate().isExecutorAllowed(matchedExecutor)) {
        return c.json({ message: getManagedCloudGate().devOnlyMessage }, 403)
      }
      const pathAccess = validateProjectExecutorPathAccess({
        project: taskResult.project,
        executorId: preferredExecutorId,
        bindings: listProjectBindings(),
        executors: listVisibleExecutorsForUser(userId),
      })
      if (!pathAccess.ok) {
        return c.json({ message: pathAccess.message }, 409)
      }
    }

    const nextExecutionModel = payload.agentType === currentAgentType
      ? currentExecutionModel?.trim() || undefined
      : undefined

    const bindingState = scopedWorkspaceId
      ? ensureTaskWorkspaceBindingState({
          task: taskResult.task,
          workspaceId: scopedWorkspaceId,
          updatedAt: timestamp,
        })
      : null
    const baseTask = bindingState?.task ?? taskResult.task
    const nextTask: Task = {
      ...baseTask,
      agentType: scopedWorkspaceId ? baseTask.agentType : payload.agentType,
      executionModel: scopedWorkspaceId ? baseTask.executionModel : nextExecutionModel,
      opencodeConfig: scopedWorkspaceId
        ? baseTask.opencodeConfig
        : payload.agentType === 'OpenCode'
          ? withOpenCodeExecutionModel(taskResult.task.opencodeConfig, nextExecutionModel)
          : taskResult.task.opencodeConfig,
      updatedAt: timestamp,
    }

    const nextSession = scopedWorkspaceId
      ? (() => {
          const session = ensureWorkspaceSessionRecord({
            task: nextTask,
            workspaceId: scopedWorkspaceId,
            executorNodeId: preferredExecutorId,
            workspace: scopedWorkspace,
            workspaceSessionId: scopedWorkspaceSessionId,
          })
          return mergeWorkspaceSession(nextTask, session, {
            agentType: payload.agentType,
            executionModel: nextExecutionModel,
            executorNodeId: preferredExecutorId,
            runtimeOwnerExecutorId: preferredExecutorId,
            opencodeConfig: payload.agentType === 'OpenCode'
              ? withOpenCodeExecutionModel(session.opencodeConfig ?? taskResult.task.opencodeConfig, nextExecutionModel)
              : session.opencodeConfig ?? taskResult.task.opencodeConfig,
            updatedAt: timestamp,
          })
        })()
      : null

    await saveTaskAndWait(nextTask)
    if (nextSession) {
      await saveWorkspaceSessionAndWait(nextSession)
    }
    console.info('[task-agent-route][executor-switch][saved]', JSON.stringify({
      userId,
      taskId,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: nextSession?.id ?? scopedWorkspaceSessionId ?? '',
      requestedExecutorNodeId: payload.executorNodeId?.trim() || '',
      savedSessionExecutorNodeId: nextSession?.executorNodeId ?? '',
      savedSessionRuntimeOwnerExecutorId: nextSession?.runtimeOwnerExecutorId ?? '',
      scopedWorkspaceExecutorNodeId: scopedWorkspace?.executorNodeId ?? '',
      taskAgentType: nextTask.agentType,
      taskExecutionModel: nextTask.executionModel ?? '',
    }))
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    const nextState: AppState = nextSession
      ? upsertWorkspaceSessionInState({
          ...state,
          tasks,
        }, nextSession)
      : {
          ...state,
          tasks,
        }

    const message = nextExecutionModel
      ? '执行端已更新。'
      : '执行端已更新，模型已回退到默认值。'
    publishStateInBackground(nextState)
    return c.json({
      message,
      task: nextTask,
      workspaceSession: nextSession,
      workspaceSessionId: nextSession?.id,
    })
  })

  app.post('/api/tasks/:id/agent-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskAgentSettingsSchema.parse(await c.req.json().catch(() => ({
      agentType: 'OpenCode',
      workspaceId: '',
      workspaceSessionId: '',
      agentSettings: {},
    })))
    const compact = c.req.query('compact') === '1'

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const scopedWorkspaceId = payload.workspaceId.trim()
    const scopedWorkspace = getTaskChatWorkspaceIfVisible(userId, taskResult.project, scopedWorkspaceId)
    if (!scopedWorkspace) {
      return c.json({ message: '工作区不存在或不可见。' }, 404)
    }
    const workspaceWorkerId = resolveWorkspaceWorkerId(scopedWorkspace)
    const requestedExecutorId = payload.executorNodeId?.trim() || undefined
    if (requestedExecutorId && requestedExecutorId !== workspaceWorkerId) {
      return c.json({ message: '执行节点属于工作区，请先在工作区设置中切换当前节点。' }, 409)
    }

    const bindingState = ensureTaskWorkspaceBindingState({
      task: taskResult.task,
      workspaceId: scopedWorkspaceId,
      updatedAt: new Date().toISOString(),
    })
    const existingSession = getWorkspaceSessionRecordForTaskContext(
      bindingState.task.id,
      scopedWorkspaceId,
      payload.workspaceSessionId?.trim() || undefined,
    )
    const currentSession = ensureWorkspaceSessionRecord({
      task: bindingState.task,
      workspaceId: scopedWorkspaceId,
      executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(existingSession, scopedWorkspace.executorNodeId),
      workspace: scopedWorkspace,
      workspaceSessionId: payload.workspaceSessionId?.trim() || undefined,
    })
    const effectiveAgentType = currentSession.agentType ?? scopedWorkspace.agentType ?? taskResult.task.agentType
    if (payload.agentType !== effectiveAgentType) {
      return c.json({ message: '请先切换到当前执行端，再修改该执行端参数。' }, 400)
    }

    const timestamp = new Date().toISOString()
    const nextSession = mergeWorkspaceSession(taskResult.task, currentSession, {
      executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
      runtimeOwnerExecutorId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
      agentSettings: mergeAgentRuntimeSettings(
        effectiveAgentType,
        getServerAgentSettings(state.config, effectiveAgentType),
        payload.agentSettings,
      ),
      updatedAt: timestamp,
    })

    await saveWorkspaceSessionAndWait(nextSession)
    const nextState = upsertWorkspaceSessionInState(state, nextSession)
    publishStateInBackground(nextState)
    if (compact) {
      return c.json({
        message: '工作区会话参数已更新。',
        task: bindingState.task,
        workspaceSession: nextSession,
        workspaceSessionId: nextSession.id,
      })
    }

    return c.json(await withState(nextState, '工作区会话参数已更新。', userId))
  })

  app.post('/api/tasks/:id/mcp-settings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskMcpSettingsSchema.parse(await c.req.json().catch(() => ({
      workspaceId: '',
      workspaceSessionId: '',
      enabledMcpServerIds: [],
    })))
    const compact = c.req.query('compact') === '1'

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const scopedWorkspace = getTaskChatWorkspaceIfVisible(userId, taskResult.project, payload.workspaceId)
    if (!scopedWorkspace) {
      return c.json({ message: '工作区不存在或不可见。' }, 404)
    }

    const bindingState = ensureTaskWorkspaceBindingState({
      task: taskResult.task,
      workspaceId: payload.workspaceId,
      updatedAt: new Date().toISOString(),
    })
    const existingSession = getWorkspaceSessionRecordForTaskContext(
      bindingState.task.id,
      payload.workspaceId,
      payload.workspaceSessionId?.trim() || undefined,
    )
    const currentSession = ensureWorkspaceSessionRecord({
      task: bindingState.task,
      workspaceId: payload.workspaceId,
      executorNodeId: resolveWorkspaceSessionExecutorId(existingSession, scopedWorkspace.executorNodeId),
      workspace: scopedWorkspace,
      workspaceSessionId: payload.workspaceSessionId?.trim() || undefined,
    })
    const enabledMcpServerIds = Array.from(new Set(payload.enabledMcpServerIds.map((item) => item.trim()).filter(Boolean)))
    const timestamp = new Date().toISOString()
    const nextSession = mergeWorkspaceSession(taskResult.task, currentSession, {
      runtimeOwnerExecutorId: resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
      enabledMcpServerIds,
      updatedAt: timestamp,
    })

    await saveWorkspaceSessionAndWait(nextSession)
    const nextState = upsertWorkspaceSessionInState(state, nextSession)
    publishStateInBackground(nextState)
    if (compact) {
      return c.json({
        message: '工作区 MCP 设置已更新。',
        task: bindingState.task,
        workspaceSession: nextSession,
        workspaceSessionId: nextSession.id,
      })
    }

    return c.json(await withState(nextState, '工作区 MCP 设置已更新。', userId))
  })

  app.post('/api/tasks/:id/agent-managed', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskAgentManagedSchema.parse(await c.req.json().catch(() => ({ agentManaged: 'none' })))

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const nextTask: Task = {
      ...taskResult.task,
      agentManaged: payload.agentManaged,
      updatedAt: new Date().toISOString(),
    }

    await saveTaskAndWait(nextTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    return c.json(await withState({ ...state, tasks }, payload.agentManaged === 'ai' ? '已开启 AI 托管。' : '已关闭 AI 托管。', userId))
  })

  app.post('/api/tasks/:id/assignee', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskAssigneeSchema.parse(await c.req.json().catch(() => ({ assigneeId: null })))

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    const agentAssignment = resolveTaskAgentAssignment({
      project: taskResult.project,
      userId,
      assigneeAgentId: payload.assigneeAgentId?.trim() || undefined,
      assigneeAgentGroupId: payload.assigneeAgentGroupId?.trim() || undefined,
    })
    if (!agentAssignment.ok) return c.json({ message: agentAssignment.message }, agentAssignment.status)
    const nextAssigneeAgentId = agentAssignment.agentId
    const nextAssigneeAgentGroupId = agentAssignment.agentGroupId
    const nextAssigneeId = nextAssigneeAgentId ? undefined : payload.assigneeId?.trim() || undefined

    if (nextAssigneeId) {
      const assignee = getUserById(nextAssigneeId)
      if (!assignee) {
        return c.json({ message: '负责人不存在。' }, 404)
      }

      if (!isProjectAccessible(nextAssigneeId, taskResult.project.id)) {
        return c.json({ message: '该负责人当前无权访问此项目。' }, 400)
      }
    }

    if (nextAssigneeAgentId) {
      if (
        (nextAssigneeAgentId !== taskResult.task.assigneeAgentId
          || nextAssigneeAgentGroupId !== taskResult.task.assigneeAgentGroupId)
        && taskResult.task.status !== 'backlog'
        && payload.startMode === 'now'
      ) {
        const readiness = resolveAgentDispatchReadiness(nextAssigneeAgentId, userId)
        if (!readiness.ok) {
          return c.json({ message: readiness.message }, 409)
        }
      }
    }

    const updatedAt = new Date().toISOString()
    const assignmentChanged = nextAssigneeId !== taskResult.task.assigneeId
      || nextAssigneeAgentId !== taskResult.task.assigneeAgentId
      || nextAssigneeAgentGroupId !== taskResult.task.assigneeAgentGroupId
    const updatedTask: Task = {
      ...taskResult.task,
      assigneeId: nextAssigneeId,
      assigneeAgentId: nextAssigneeAgentId,
      assigneeAgentGroupId: nextAssigneeAgentGroupId,
      updatedAt,
    }
    const nextTask = assignmentChanged
      ? recordTaskAssignmentHistory({
          task: updatedTask,
          actorUserId: userId,
          assigneeId: nextAssigneeId,
          assigneeAgentId: nextAssigneeAgentId,
          at: updatedAt,
        })
      : updatedTask

    // 指派给人也要进收件箱：Agent 走 deliverTaskAssignment，人只有这一条路径。
    const assignmentDelivery = nextAssigneeId && nextAssigneeId !== taskResult.task.assigneeId
      ? await deliverHumanTaskAssignment({
          task: nextTask,
          assigneeUserId: nextAssigneeId,
          actor: resolveTaskAssignmentActor({ userId }),
          at: updatedAt,
        })
      : null
    const persistedTask = assignmentDelivery?.task ?? nextTask

    await saveTaskAndWait(persistedTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? persistedTask : item))
    const nextState: AppState = {
      ...state,
      tasks,
    }

    // 「有没有变化」的判定交给 policy：它同时比 agentId 和 groupId，
    // 所以换队但 leader 不变的情况不会被误判成没变化。
    if (nextAssigneeAgentId) {
      await deliverTaskAssignment({
        task: persistedTask,
        actor: resolveTaskAssignmentActor({ userId }),
        startMode: payload.startMode,
        previousAssigneeAgentId: taskResult.task.assigneeAgentId,
        previousAssigneeAgentGroupId: taskResult.task.assigneeAgentGroupId,
        actingUserId: userId,
        handoffPrompt: payload.handoffPrompt,
        assigneeAgentGroupTitle: agentAssignment.agentGroupTitle,
      })
    }

    const message = nextAssigneeAgentGroupId
      ? '任务已指派给 Squad，由负责人接单协调。'
      : nextAssigneeAgentId
        ? '任务已指派给 Agent。'
        : nextAssigneeId
          ? '任务负责人已更新。'
          : '已清除任务负责人。'
    return c.json(await withState(nextState, message, userId))
  })

  app.post('/api/tasks/:id/agent-run', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const input = taskAssignedAgentStartSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!input.success) return c.json({ message: 'Agent 启动参数无效。' }, 400)

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (!taskResult.task.assigneeAgentId) {
      return c.json({ message: '请先给任务指派一个 Agent。' }, 409)
    }
    if (taskResult.task.status === 'backlog') {
      return c.json({ message: 'Backlog 任务不能启动 Agent，请先调整任务状态。' }, 409)
    }

    const assignment = resolveTaskAgentAssignment({
      project: taskResult.project,
      userId,
      assigneeAgentId: taskResult.task.assigneeAgentId,
    })
    if (!assignment.ok) return c.json({ message: assignment.message }, assignment.status)
    const assigneeAgentId = assignment.agentId
    if (!assigneeAgentId) return c.json({ message: '请先给任务指派一个 Agent。' }, 409)
    const activeActivity = listTaskAgentActivities(taskId).find((activity) => (
      activity.agentId === assigneeAgentId
      && (activity.status === 'pending' || activity.status === 'running' || activity.status === 'waiting')
    ))
    if (activeActivity) {
      return c.json({ message: '该 Agent 已在处理这个任务。' }, 409)
    }

    const readiness = resolveAgentDispatchReadiness(assigneeAgentId, userId)
    if (!readiness.ok) return c.json({ message: readiness.message }, 409)

    publishAgentEvent({
      type: 'task.started',
      targetAgentId: assigneeAgentId,
      actingUserId: userId,
      actor: { type: 'user', id: userId },
      scope: { projectId: taskResult.task.projectId, taskId },
      payload: {
        title: taskResult.task.title,
        description: taskResult.task.description,
        status: taskResult.task.status,
        handoffPrompt: input.data.handoffPrompt,
        triggerKind: 'manual_start',
      },
      conversationKey: `task:${taskId}`,
      idempotencyKey: input.data.idempotencyKey || `task-started:${taskId}:${assigneeAgentId}:${crypto.randomUUID()}`,
    })

    return c.json({
      message: 'Agent 已加入执行队列。',
      activities: listTaskAgentActivities(taskId),
    })
  })

  app.post('/api/tasks/:id/comments', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskCommentSchema.parse(await c.req.json().catch(() => ({ content: '' })))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    if (payload.parentCommentId && !taskResult.task.comments.some((comment) => comment.id === payload.parentCommentId)) {
      return c.json({ message: '回复的评论不存在。' }, 400)
    }

    const author = getUserById(userId)
    const commentAuthor = { type: 'user' as const, id: userId, name: author?.name, avatarUrl: author?.avatarUrl }
    const resolvedMentions = resolveTaskCommentMentions({
      task: taskResult.task,
      author: commentAuthor,
      mentions: payload.mentions,
      projectWorkspaceId: taskResult.project?.workspaceId,
    })
    const nextTask = appendTaskComment(taskResult.task, commentAuthor, payload.content, {
      parentCommentId: payload.parentCommentId,
      mentions: resolvedMentions.mentions,
      attachments: payload.attachments,
      idempotencyKey: payload.idempotencyKey,
    })
    const comment = payload.idempotencyKey
      ? nextTask.comments.find((item) => item.idempotencyKey === payload.idempotencyKey)
      : nextTask.comments.at(-1)
    if (!comment) {
      return c.json({ message: '评论保存失败。' }, 500)
    }

    if (nextTask !== taskResult.task) await saveTaskAndWait(nextTask)
    const commentDispatches = await publishTaskCommentEvent(nextTask, commentAuthor, comment, resolvedMentions.outcomes)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    return c.json({
      ...(await withState({ ...state, tasks }, '评论已添加。', userId)),
      comment,
      commentDispatches,
    })
  })

  app.post('/api/tasks/:id/comments/preview', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const input = taskCommentSchema.safeParse(await c.req.json().catch(() => ({ content: '' })))
    if (!input.success) return c.json({ message: '评论预览参数无效。' }, 400)

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    if (input.data.parentCommentId && !taskResult.task.comments.some((comment) => comment.id === input.data.parentCommentId)) {
      return c.json({ message: '回复的评论不存在。' }, 400)
    }

    const author = getUserById(userId)
    const commentAuthor = { type: 'user' as const, id: userId, name: author?.name, avatarUrl: author?.avatarUrl }
    const resolvedMentions = resolveTaskCommentMentions({
      task: taskResult.task,
      author: commentAuthor,
      mentions: input.data.mentions,
      projectWorkspaceId: taskResult.project?.workspaceId,
    })
    const previewComment: Task['comments'][number] = {
      id: 'preview',
      authorType: 'user',
      authorId: userId,
      authorName: author?.name,
      parentCommentId: input.data.parentCommentId,
      mentions: resolvedMentions.mentions,
      attachments: input.data.attachments,
      content: input.data.content,
      createdAt: new Date().toISOString(),
    }

    return c.json({
      commentDispatches: previewTaskCommentEvent(
        taskResult.task,
        commentAuthor,
        previewComment,
        resolvedMentions.outcomes,
      ),
    })
  })

  app.patch('/api/tasks/:id/comments/:commentId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const commentId = c.req.param('commentId')
    const payload = taskCommentEditSchema.parse(await c.req.json().catch(() => ({ content: '' })))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const author = getUserById(userId)
    const commentAuthor = { type: 'user' as const, id: userId, name: author?.name, avatarUrl: author?.avatarUrl }
    const currentComment = taskResult.task.comments.find((comment) => comment.id === commentId)
    const mentions = payload.mentions
      ? resolveTaskCommentMentions({
          task: taskResult.task,
          author: commentAuthor,
          mentions: payload.mentions,
          projectWorkspaceId: taskResult.project?.workspaceId,
        }).mentions
      : currentComment?.mentions ?? []
    const result = editTaskComment({
      task: taskResult.task,
      commentId,
      authorId: userId,
      content: payload.content,
      mentions,
      attachments: payload.attachments,
    })
    if (result.error === 'not_found') return c.json({ message: '评论不存在。' }, 404)
    if (result.error === 'forbidden') return c.json({ message: '只能编辑自己留下的评论。' }, 403)
    if (result.error === 'deleted') return c.json({ message: '已删除的评论不能编辑。' }, 409)
    if (result.error === 'empty' || !result.comment) return c.json({ message: '评论内容不能为空。' }, 400)

    if (result.task !== taskResult.task) await saveTaskAndWait(result.task)
    const tasks = state.tasks.map((item) => (item.id === taskId ? result.task : item))
    return c.json({
      ...(await withState({ ...state, tasks }, '评论已更新。', userId)),
      comment: result.comment,
    })
  })

  app.delete('/api/tasks/:id/comments/:commentId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const commentId = c.req.param('commentId')
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const result = deleteTaskComment({ task: taskResult.task, commentId, authorId: userId })
    if (result.error === 'not_found') return c.json({ message: '评论不存在。' }, 404)
    if (result.error === 'forbidden') return c.json({ message: '只能删除自己留下的评论。' }, 403)
    if (!result.comment) return c.json({ message: '评论删除失败。' }, 500)

    if (result.task !== taskResult.task) await saveTaskAndWait(result.task)
    const tasks = state.tasks.map((item) => (item.id === taskId ? result.task : item))
    return c.json({
      ...(await withState({ ...state, tasks }, '评论已删除。', userId)),
      comment: result.comment,
    })
  })

  app.put('/api/tasks/:id/comments/:commentId/reaction', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const commentId = c.req.param('commentId')
    const payload = taskCommentReactionSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const result = setTaskCommentReaction({
      task: taskResult.task,
      commentId,
      userId,
      emoji: payload.emoji,
      active: payload.active,
    })
    if (result.error === 'not_found') return c.json({ message: '评论不存在。' }, 404)
    if (result.error === 'deleted') return c.json({ message: '不能回应已删除的评论。' }, 409)
    if (!result.comment) return c.json({ message: '评论回应保存失败。' }, 500)

    if (result.task !== taskResult.task) await saveTaskAndWait(result.task)
    const tasks = state.tasks.map((item) => (item.id === taskId ? result.task : item))
    return c.json({
      ...(await withState({ ...state, tasks }, payload.active ? '已添加回应。' : '已移除回应。', userId)),
      comment: result.comment,
    })
  })

  // R8.5 任务级表情反应（自由 emoji）：toggleMessageReaction 复用。
  app.put('/api/tasks/:id/reaction', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = z.object({
      emoji: z.string().trim().min(1).max(32),
      active: z.boolean(),
    }).parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const nextReactions = toggleMessageReaction(taskResult.task.reactions, payload.emoji, userId, payload.active)
    const nextTask: Task = {
      ...taskResult.task,
      reactions: nextReactions.length ? nextReactions : undefined,
      updatedAt: new Date().toISOString(),
    }
    await saveTaskAndWait(nextTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    return c.json({
      ...(await withState({ ...state, tasks }, payload.active ? '已添加回应。' : '已移除回应。', userId)),
      reactions: nextReactions,
    })
  })

  app.put('/api/tasks/:id/comments/:commentId/resolution', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const commentId = c.req.param('commentId')
    const input = taskCommentResolutionSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!input.success) return c.json({ message: '评论解决状态无效。' }, 400)

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    const result = setTaskCommentResolution({
      task: taskResult.task,
      commentId,
      userId,
      resolved: input.data.resolved,
    })
    if (result.error === 'not_found') return c.json({ message: '评论线程不存在。' }, 404)
    if (result.error === 'deleted') return c.json({ message: '已删除的评论线程不能修改解决状态。' }, 409)
    if (!result.comment) return c.json({ message: '评论解决状态保存失败。' }, 500)

    if (result.task !== taskResult.task) await saveTaskAndWait(result.task)
    const tasks = state.tasks.map((item) => (item.id === taskId ? result.task : item))
    return c.json({
      ...(await withState(
        { ...state, tasks },
        input.data.resolved ? '评论线程已解决。' : '评论线程已重新打开。',
        userId,
      )),
      comment: result.comment,
    })
  })

  app.put('/api/tasks/:id/subscriber', requireAuth, async (c) => {
    const actingUserId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskSubscriberSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, actingUserId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const target = getUserById(payload.userId)
    if (!target || !isProjectAccessible(payload.userId, taskResult.task.projectId)) {
      return c.json({ message: '订阅者不存在或无权访问该项目。' }, 400)
    }
    if (payload.userId !== actingUserId && !taskResult.project) {
      return c.json({ message: '无权管理其他任务订阅者。' }, 403)
    }

    const nextTask = setTaskSubscriber({
      task: taskResult.task,
      userId: payload.userId,
      subscribed: payload.subscribed,
    })
    if (nextTask !== taskResult.task) await saveTaskAndWait(nextTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    return c.json(await withState(
      { ...state, tasks },
      payload.subscribed ? '已关注任务。' : '已取消关注任务。',
      actingUserId,
    ))
  })

  app.get('/api/tasks/:id/agent-activities', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(loadState(), userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    return c.json({ activities: listTaskAgentActivities(taskId) })
  })

  app.get('/api/tasks/:id/agent-activities/stream', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(loadState(), userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    return new Response(createTaskAgentActivityStream(taskId), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  })

  app.get('/api/tasks/:id/agent-activities/:eventId/transcript', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const eventId = c.req.param('eventId')
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const activity = listTaskAgentActivities(taskId).find((item) => item.id === eventId)
    if (!activity) {
      return c.json({ message: 'Agent 执行活动不存在。' }, 404)
    }
    const run = getAgentTaskRun(eventId)
    if (run?.transcript.length) {
      let lastAssistantIndex = -1
      for (let index = run.transcript.length - 1; index >= 0; index -= 1) {
        if (run.transcript[index]?.role === 'assistant') {
          lastAssistantIndex = index
          break
        }
      }
      const messages = run.usage && lastAssistantIndex >= 0
        ? run.transcript.map((message, index) => (
            index === lastAssistantIndex && !message.usage ? { ...message, usage: run.usage } : message
          ))
        : run.transcript
      return c.json({
        session: {
          id: activity.conversationSessionId ?? run.id,
          title: `${activity.agentName} · Agent Task Run`,
          customAgentId: activity.agentId,
          agentRunningStatus: activity.status === 'running' ? 'executing' : 'idle',
          currentStep: run.failureMessage ?? '',
          messages,
          messagesLoaded: true,
          messageCount: messages.length,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        },
      })
    }
    if (!activity.conversationSessionId) {
      return c.json({ message: '这轮 Agent 执行还没有可查看的过程。' }, 404)
    }
    const session = state.mainChatSessions.find((item) => item.id === activity.conversationSessionId)
    if (!session) return c.json({ message: 'Agent 执行过程不存在。' }, 404)
    const messages = selectAgentEventTranscriptMessages(session.messages ?? [], eventId)

    return c.json({
      session: {
        id: session.id,
        title: session.title,
        customAgentId: session.customAgentId,
        agentRunningStatus: session.agentRunningStatus,
        currentStep: session.currentStep,
        messages,
        messagesLoaded: true,
        messageCount: messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    })
  })

  app.post('/api/tasks/:id/agent-activities/:eventId/cancel', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const eventId = c.req.param('eventId')
    const taskResult = getAuthorizedTask(loadState(), userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    if (!listTaskAgentActivities(taskId).some((activity) => activity.id === eventId)) {
      return c.json({ message: 'Agent 执行活动不存在。' }, 404)
    }
    if (!cancelAgentEvent(eventId)) {
      return c.json({ message: '当前 Agent 执行状态不能取消。' }, 409)
    }
    return c.json({ activities: listTaskAgentActivities(taskId) })
  })

  app.post('/api/tasks/:id/agent-activities/:eventId/retry', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const eventId = c.req.param('eventId')
    const input = taskAgentActivityRetrySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!input.success) return c.json({ message: '重试会话模式无效。' }, 400)
    const taskResult = getAuthorizedTask(loadState(), userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    const activity = listTaskAgentActivities(taskId).find((item) => item.id === eventId)
    if (!activity) return c.json({ message: 'Agent 执行活动不存在。' }, 404)

    const readiness = resolveAgentDispatchReadiness(activity.agentId, userId)
    if (!readiness.ok) return c.json({ message: readiness.message }, 409)
    if (!retryAgentEvent(eventId, userId, input.data.sessionMode)) {
      return c.json({ message: '当前 Agent 执行状态不能重试。' }, 409)
    }
    return c.json({ activities: listTaskAgentActivities(taskId) })
  })

  app.get('/api/tasks/:id/conversation', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || undefined
    const query = taskConversationQuerySchema.parse(c.req.query())
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const payload = getTaskConversationWithMessages(taskResult.task, taskResult.project, workspaceId, workspaceSessionId, {
      afterMessageId: query.afterMessageId,
      beforeMessageId: query.beforeMessageId,
      limit: query.limit,
      recentTurns: query.recentTurns,
    })
    return c.json(payload)
  })

  app.get('/api/tasks/:id/importable-agent-sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const query = taskImportAgentSessionQuerySchema.parse(c.req.query())
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const target = resolveWorkspaceSessionImportTarget(
      userId,
      taskResult.project,
      taskId,
      query.workspaceId,
      query.workspaceSessionId,
      query.executorId,
    )
    if (!target.executor || !target.workspace) {
      return c.json({ ok: false, message: target.message }, target.status)
    }

    try {
      const result = await executorWsRequests.requestAgentSessionList(target.executor.executorId)
      return c.json({
        ...result,
        executorId: target.executor.executorId,
        executorName: target.executor.name,
        workspaceId: target.workspace.id,
        workspaceSessionId: target.workspaceSession?.id,
      }, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '读取节点聊天记录失败。' }, 503)
    }
  })

  app.get('/api/tasks/:id/importable-agent-session', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const query = taskImportAgentSessionQuerySchema.parse(c.req.query())
    if (!query.source || !query.sessionId) {
      return c.json({ ok: false, message: 'source 和 sessionId 不能为空。' }, 400)
    }

    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const target = resolveWorkspaceSessionImportTarget(
      userId,
      taskResult.project,
      taskId,
      query.workspaceId,
      query.workspaceSessionId,
      query.executorId,
    )
    if (!target.executor || !target.workspace) {
      return c.json({ ok: false, message: target.message }, target.status)
    }

    try {
      const result = await executorWsRequests.requestAgentSessionRead(target.executor.executorId, {
        source: query.source,
        sessionId: query.sessionId,
      })

      return c.json({
        ...result,
        session: result.session,
        executorId: target.executor.executorId,
        executorName: target.executor.name,
        workspaceId: target.workspace.id,
        workspaceSessionId: target.workspaceSession?.id,
      }, result.ok ? 200 : 404)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '读取节点聊天记录详情失败。' }, 503)
    }
  })

  app.get('/api/tasks/:id/chat-session', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || undefined
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)) {
      return jsonError(c, '工作区不存在或无权访问。', 404)
    }

    const snapshot = normalizeTaskChatSnapshot(buildTaskChatSessionSnapshot({
      task: taskResult.task,
      project: taskResult.project,
      workspaceId,
      workspaceSessionId,
    }), workspaceId, workspaceSessionId)

    if (snapshot.queue.status === 'queued' && !isTaskChatQueueDrainBlocked(taskResult.task, workspaceId, workspaceSessionId)) {
      scheduleTaskChatQueueDrain({
        taskId,
        workspaceId,
        workspaceSessionId,
      })
    }

    return c.json(snapshot)
  })

  app.post('/api/tasks/:id/import-agent-session', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const payload = taskImportAgentSessionSchema.parse(await c.req.json().catch(() => ({})))
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const target = resolveWorkspaceSessionImportTarget(
      userId,
      taskResult.project,
      taskId,
      payload.workspaceId,
      undefined,
      payload.executorId,
    )
    if (!target.executor || !target.workspace) {
      return c.json({ ok: false, message: target.message }, target.status)
    }

    try {
      const result = await executorWsRequests.requestAgentSessionRead(target.executor.executorId, {
        source: payload.source,
        sessionId: payload.sessionId,
      })
      if (!result.ok || !result.session) {
        return c.json({ ok: false, message: result.message || '节点聊天记录不存在。' }, 404)
      }

      const importableMessageCount = getImportableExecutorAgentSessionEntries(result.session.entries).length
      if (importableMessageCount < 1) {
        return c.json({
          ok: false,
          message: '该节点会话里没有可导入的用户或助手消息。',
          skippedCount: result.session.entries.length,
        }, 400)
      }

      const updatedAt = new Date().toISOString()
      const bindingState = ensureTaskWorkspaceBindingState({
        task: taskResult.task,
        workspaceId: payload.workspaceId,
        updatedAt,
      })
      const importedWorkspaceSession = ensureWorkspaceSessionRecord({
        task: bindingState.task,
        workspaceId: payload.workspaceId,
        executorNodeId: target.executor.executorId,
        workspace: target.workspace,
        createNewSession: true,
        title: buildImportedWorkspaceSessionTitle(result.session),
        titleOrigin: 'system',
        sessionKind: 'primary',
        sessionRole: target.workspaceSession?.sessionRole ?? 'general',
        sessionOrigin: 'manual',
        workingDirectoryMode: target.workspaceSession?.workingDirectoryMode,
      })

      const imported = importTaskConversationMessages({
        task: bindingState.task,
        project: taskResult.project,
        workspaceId: payload.workspaceId,
        workspaceSessionId: importedWorkspaceSession.id,
        executorId: target.executor.executorId,
        session: result.session,
      })

      const importedConversation = getTaskConversationWithMessages(
        bindingState.task,
        taskResult.project,
        payload.workspaceId,
        importedWorkspaceSession.id,
      )
      const nextWorkspaceSession = mergeWorkspaceSession(bindingState.task, importedWorkspaceSession, {
        handoffSnapshot: buildTaskConversationHandoffSnapshot(importedConversation.messages),
        lastActiveAt: importedConversation.messages.at(-1)?.createdAt ?? updatedAt,
        updatedAt,
      })
      await saveWorkspaceSessionAndWait(nextWorkspaceSession)

      const nextState = upsertWorkspaceSessionInState(
        upsertTaskWorkspaceBindingInState({
          ...state,
          tasks: state.tasks.map((item) => (item.id === bindingState.task.id ? bindingState.task : item)),
        }, bindingState.binding),
        nextWorkspaceSession,
      )

      const snapshot = publishTaskChatSessionSnapshot({
        taskId,
        workspaceId: payload.workspaceId,
        workspaceSessionId: nextWorkspaceSession.id,
        task: bindingState.task,
        project: taskResult.project,
      })

      const response = await withState(
        withClusterState(nextState),
        `已导入 ${imported.importedCount} 条聊天记录，并创建新会话。`,
        userId,
      )

      return c.json({
        ...response,
        ok: true,
        executorId: target.executor.executorId,
        executorName: target.executor.name,
        workspaceId: payload.workspaceId,
        workspaceSessionId: nextWorkspaceSession.id,
        workspaceSession: nextWorkspaceSession,
        source: payload.source,
        sessionId: payload.sessionId,
        sessionTitle: result.session.title,
        importedCount: imported.importedCount,
        skippedCount: imported.skippedCount,
        snapshot,
      })
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '导入节点聊天记录失败。' }, 503)
    }
  })

  app.post('/api/tasks/:id/observations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    const payload = taskObservationSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (payload.workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, payload.workspaceId)) {
      return jsonError(c, '工作区不存在或无权访问。', 404)
    }

    const workspaceSession = payload.workspaceId
      ? getWorkspaceSessionRecordForTaskContext(taskId, payload.workspaceId, payload.workspaceSessionId)
      : null
    if (payload.workspaceId && !workspaceSession) {
      return jsonError(c, '工作区会话不存在。', 404)
    }

    const attachments = normalizeTaskChatAttachments(payload.attachments)
    const observation: TaskSubagentObservation = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      kind: payload.kind,
      level: payload.level ?? 'info',
      title: payload.title,
      detail: payload.detail?.trim() || undefined,
      url: payload.url?.trim() || attachments[0]?.url || undefined,
      attachments,
      metadata: payload.metadata,
    }

    recordTaskObservation({
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: payload.workspaceId,
      workspaceSessionId: workspaceSession?.id,
      observation,
    })

    return c.json(await withState(loadState(), '测试观测已记录。', userId))
  })

  app.post('/api/tasks/:id/chat-stop', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const { workspaceId, workspaceSessionId } = await c.req.json().catch(() => ({ workspaceId: '', workspaceSessionId: '' }))
    const scopedWorkspaceId = workspaceId?.trim() || undefined
    const scopedWorkspaceSessionId = workspaceSessionId?.trim() || undefined
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (scopedWorkspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, scopedWorkspaceId)) {
      return jsonError(c, '工作区不存在或无权访问。', 404)
    }

    const stopResult = await stopTaskChatExecutionAcrossNodes({
      taskId,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
    })
    const scopedRuntimeTask = resolveScopedRuntimeTask(taskResult.task, scopedWorkspaceId, scopedWorkspaceSessionId)
    const runtimeStatus = 'runtimeStatus' in scopedRuntimeTask
      ? scopedRuntimeTask.runtimeStatus as WorkspaceSessionRuntimeStatus
      : undefined
    const accepted = stopResult.stopped || isTaskChatRuntimeBusy(scopedRuntimeTask.agentRunningStatus, runtimeStatus)
    const stoppedRuntime = accepted
      ? markTaskChatRuntimeStopped({
          task: taskResult.task,
          workspaceId: scopedWorkspaceId,
          workspaceSessionId: scopedWorkspaceSessionId,
        })
      : { task: taskResult.task }
    if (accepted) {
      publishTaskChatSessionUpdate(
        taskId,
        scopedWorkspaceId,
        scopedWorkspaceSessionId,
        stoppedRuntime.task,
        taskResult.project,
      )
    }

    return c.json(normalizeTaskChatSnapshot(buildTaskChatSessionSnapshot({
      task: stoppedRuntime.task,
      project: taskResult.project,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
    }), scopedWorkspaceId, scopedWorkspaceSessionId))
  })

  app.post('/api/tasks/:id/chat-queue', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const {
      message,
      workspaceId,
      workspaceSessionId,
      attachments,
      contextRefs,
      runtimeConfig,
      deferUntilWorkspaceReady,
      dedupeKey,
    } = await c.req.json().catch(() => ({ message: '', workspaceId: '', workspaceSessionId: '', attachments: [], contextRefs: [], runtimeConfig: undefined, deferUntilWorkspaceReady: false, dedupeKey: undefined }))
    const normalizedMessage = message?.trim() || ''
    const normalizedAttachments = normalizeTaskChatAttachments(attachments)
    const normalizedContextRefs = normalizeTaskChatContextRefs(contextRefs)
    const normalizedRuntimeConfig = normalizeTaskChatMessageRuntimeConfig(runtimeConfig)
    const scopedWorkspaceId = workspaceId?.trim() || undefined
    const scopedWorkspaceSessionId = workspaceSessionId?.trim() || undefined
    const shouldDeferUntilWorkspaceReady = deferUntilWorkspaceReady === true
    if (!normalizedMessage && normalizedAttachments.length === 0) {
      return c.json({ message: '消息不能为空。' }, 400)
    }

    const taskResult = getAuthorizedTask(state, userId, taskId)
    let authorizedProject = taskResult.project
    if (!authorizedProject) {
      // 共享协作人兜底：对项目所属协作工作区有 edit/collaborate 授权且会话匹配时可发送
      const targetTask = taskResult.task ?? state.tasks.find((item) => item.id === taskId)
      const collabWorkspaceId = targetTask ? state.projects.find((item) => item.id === targetTask.projectId)?.workspaceId : undefined
      if (targetTask && collabWorkspaceId?.trim()) {
        const access = resolveUserWorkspaceShareAccess(userId, collabWorkspaceId, scopedWorkspaceSessionId)
        const canSend = access.ok && (access.permission === 'edit' || access.permission === 'collaborate')
        if (canSend) {
          authorizedProject = state.projects.find((item) => item.id === targetTask.projectId) ?? null
        }
      }
      if (!authorizedProject) return jsonError(c, taskResult.message, taskResult.status === 200 ? 403 : taskResult.status)
    }
    const task = taskResult.task ?? (authorizedProject ? state.tasks.find((item) => item.id === taskId && item.projectId === authorizedProject.id) : undefined)
    if (!task || !authorizedProject) return jsonError(c, taskResult.message, taskResult.status === 200 ? 403 : taskResult.status)
    if (scopedWorkspaceId && !getTaskChatWorkspaceIfVisible(userId, authorizedProject, scopedWorkspaceId)) {
      return jsonError(c, '工作区不存在或无权访问。', 404)
    }

    const queuedEntry = await enqueueTaskChatMessage({
      taskId,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
      dedupeKey: typeof dedupeKey === 'string' ? dedupeKey.trim() || undefined : undefined,
      message: normalizedMessage,
      attachments: normalizedAttachments,
      contextRefs: normalizedContextRefs,
      runtimeConfig: normalizedRuntimeConfig,
      createdBy: userId,
    })
    const deferredWorkspaceSession = shouldDeferUntilWorkspaceReady && scopedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(taskId, scopedWorkspaceId, scopedWorkspaceSessionId)
      : null
    const deferredWorkspaceReady = !shouldDeferUntilWorkspaceReady
      || !scopedWorkspaceId
      || deferredWorkspaceSession?.workingDirectoryMode === 'original-dir'
      || deferredWorkspaceSession?.worktreeStatus === 'created'

    const dispatchAvailability = resolveWorkspaceChatDispatchAvailability({
      state,
      userId,
      task: task,
      project: authorizedProject,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
    })

    const shouldPersistQueuedUserTurn = scopedWorkspaceId && scopedWorkspaceSessionId && (
      (shouldDeferUntilWorkspaceReady && !deferredWorkspaceReady)
      || !dispatchAvailability.ready
    )
    let queuedWorkspaceSessionProjection: Awaited<ReturnType<typeof getWorkspaceSessionHistoryProjection>> = null
    if (shouldPersistQueuedUserTurn) {
      appendTaskConversationMessage({
        task: task,
        project: authorizedProject,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        role: 'user',
        senderId: userId,
        content: normalizedMessage,
        externalRef: {
          turnId: buildTaskChatQueueTurnId(queuedEntry.id),
          queuedWhileWorkspacePreparing: shouldDeferUntilWorkspaceReady && !deferredWorkspaceReady,
          queuedByDispatchAvailability: !dispatchAvailability.ready,
          ...(normalizedAttachments.length ? { attachments: normalizedAttachments } : {}),
        },
      })
      queuedWorkspaceSessionProjection = await persistQueuedWorkspaceSessionUserTurn({
        task: task,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
        queuedEntry,
        userId,
        message: normalizedMessage,
        attachments: normalizedAttachments,
        currentStep: dispatchAvailability.message || task.currentStep || '消息已入队，等待工作区准备完成。',
      }).catch((error) => {
        console.error('[task-chat-queue] persist queued workspace history failed', error)
        return null
      })
      if (queuedWorkspaceSessionProjection && deferredWorkspaceSession) {
        await saveWorkspaceSessionAndWait(mergeWorkspaceSession(task, deferredWorkspaceSession, {
          historyProjection: queuedWorkspaceSessionProjection,
          lastActiveAt: queuedWorkspaceSessionProjection.lastEventAt ?? deferredWorkspaceSession.lastActiveAt,
          updatedAt: queuedWorkspaceSessionProjection.updatedAt,
        }))
      }
    }

    const snapshot = publishTaskChatSessionSnapshot({
      taskId,
      workspaceId: scopedWorkspaceId,
      workspaceSessionId: scopedWorkspaceSessionId,
      task: task,
      project: authorizedProject,
    })
    if (deferredWorkspaceReady) {
      scheduleTaskChatQueueDrain({
        taskId,
        workspaceId: scopedWorkspaceId,
        workspaceSessionId: scopedWorkspaceSessionId,
      })
    }

    return c.json({
      snapshot,
      message: dispatchAvailability.message || (shouldDeferUntilWorkspaceReady && !deferredWorkspaceReady ? '消息已发送，工作区准备完成后会自动开始执行。' : '消息已入队。'),
    })
  })

  app.delete('/api/tasks/:id/messages/:messageId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const messageId = c.req.param('messageId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || undefined
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)) {
      return jsonError(c, '工作区不存在或无权访问。', 404)
    }
    if (workspaceId && workspaceSessionId && await workspaceSessionHasPersistedHistory(workspaceSessionId)) {
      return c.json({ message: '当前工作区会话已切换到新历史链路，暂不支持通过旧 conversation 接口删除消息。' }, 409)
    }

    const snapshot = buildTaskChatSessionSnapshot({
      task: taskResult.task,
      project: taskResult.project,
      workspaceId,
      workspaceSessionId,
    })
    const conversationId = snapshot.conversation.conversationId
    if (!conversationId) {
      return jsonError(c, '当前会话缺少 conversationId，无法删除消息。', 400)
    }

    deleteConversationMessagesByAnchor(conversationId, messageId)

    const nextSnapshot = publishTaskChatSessionSnapshot({
      taskId,
      workspaceId,
      workspaceSessionId,
      task: taskResult.task,
      project: taskResult.project,
    })

    return c.json(nextSnapshot)
  })

  app.delete('/api/tasks/:id/chat-queue/:queueId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const queueId = c.req.param('queueId')
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || undefined
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (workspaceId && !getTaskChatWorkspaceIfVisible(userId, taskResult.project, workspaceId)) {
      return jsonError(c, '工作区不存在或无权访问。', 404)
    }

    await removeTaskChatQueueEntry({
      taskId,
      workspaceId,
      workspaceSessionId,
      queueId,
    })

    const snapshot = publishTaskChatSessionSnapshot({
      taskId,
      workspaceId,
      workspaceSessionId,
      task: taskResult.task,
      project: taskResult.project,
    })

    return c.json(snapshot)
  })
}
