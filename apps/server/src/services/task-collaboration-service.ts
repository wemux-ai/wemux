// [INPUT]: Authorized user/task scope, optional creator actor, and task chat/session operations.
// [OUTPUT]: Task collaboration mutations, including creator-preserving subtask creation.
// [POS]: Server task-collaboration service shared by HTTP and MCP adapters.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { findMatchingAgentExecutionModelOption } from '@shared/model-profile'
import { createExecutionLog, createTaskFromRequirement, deriveExecutionCenter } from '@shared/task-orchestrator'
import { appendTaskAssignmentHistory } from '@shared/task-history'
import { withOpenCodeExecutionModel } from '@shared/opencode-execution-config'
import { normalizeTaskChatAttachments, type TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import { mergeWorkspaceSession, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { AppState, CreatorIdentity, Task } from '@shared/types'
import {
  buildTaskChatSessionSnapshot,
  enqueueTaskChatMessage,
} from '../control-plane/task-chat-service'
import { getTaskConversationWithMessages } from '../control-plane/conversation-service'
import { getUserById } from '../repositories/auth'
import { getAuthorizedTask, withClusterState, withState } from '../routes/shared'
import {
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getScopedWorkspaceForProject,
  getWorkspaceSessionRecordForTaskContext,
  listActiveTaskWorkspaceBindings,
  listWorkspaceSessionsForTaskContext,
  upsertWorkspaceSessionInState,
} from '../routes/task-route-support'
import {
  executeTaskChatTurn,
  getTaskChatWorkspaceIfVisible,
  isTaskChatQueueDrainBlocked,
  resolveWorkspaceChatDispatchAvailabilityAsync,
  loadTaskModelOptionsFromExecutor,
  scheduleTaskChatQueueDrain,
  tryAcquireTaskChatExecutionLease,
} from './task-chat-dispatch'
import {
  loadState,
  saveTask,
  saveWorkspaceSession,
} from '../storage/app-state-store'
import type { ServerAgentType } from './server-agent'

const normalizeTaskChatSnapshot = (
  snapshot: TaskChatSessionSnapshot,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
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

export const createSubtaskForUser = async (params: {
  userId: string
  createdBy?: CreatorIdentity
  parentTaskId: string
  description: string
  title?: string
  agentManaged?: 'ai' | 'none'
  agentType?: ServerAgentType
  executionModel?: string
  acceptanceCriteria?: string
  assigneeId?: string
}) => {
  const state = loadState()
  const parentResult = getAuthorizedTask(state, params.userId, params.parentTaskId)
  if (!parentResult.task || !parentResult.project) {
    return {
      ok: false as const,
      status: parentResult.status,
      message: parentResult.message,
    }
  }

  const project = parentResult.project
  let subtask = createTaskFromRequirement(
    project,
    params.description,
    'medium',
    params.title,
    params.agentManaged,
    params.agentType as Task['agentType'] | undefined,
    params.executionModel,
    undefined,
    state.config,
  )

  subtask = {
    ...subtask,
    createdBy: params.createdBy,
    parentTaskId: parentResult.task.id,
    assigneeId: params.assigneeId?.trim() || undefined,
    acceptanceCriteria: params.acceptanceCriteria?.trim() || undefined,
    currentStep: '子任务已创建，等待选择工作区并开始执行。',
    logs: [...parentResult.task.logs, createExecutionLog('system', `已从父任务 ${parentResult.task.title} 拆分为子任务。`)],
  }
  if (subtask.assigneeId) {
    const assignee = getUserById(subtask.assigneeId)
    subtask = appendTaskAssignmentHistory(subtask, {
      actor: params.createdBy,
      assignee: {
        type: 'user',
        id: subtask.assigneeId,
        name: assignee?.name || subtask.assigneeId,
        avatarUrl: assignee?.avatarUrl,
      },
      at: subtask.createdAt,
    })
  }

  let nextSubtask = subtask
  saveTask(nextSubtask)
  const inheritedBindings = listActiveTaskWorkspaceBindings(parentResult.task.id).flatMap((binding) => {
    const workspace = getScopedWorkspaceForProject(params.userId, project, binding.workspaceId)
    if (!workspace) {
      return []
    }

    const bindingState = ensureTaskWorkspaceBindingState({
      task: nextSubtask,
      workspaceId: binding.workspaceId,
      updatedAt: new Date().toISOString(),
    })
    nextSubtask = bindingState.task
    const nextBinding = bindingState.binding
    const nextSession = ensureWorkspaceSessionRecord({
      task: nextSubtask,
      workspaceId: binding.workspaceId,
      executorNodeId: workspace.executorNodeId,
      workspace,
    })
    saveTask(nextSubtask)
    saveWorkspaceSession(nextSession)
    return [{ binding: nextBinding, session: nextSession }]
  })

  const nextWorkspaceSessions = [...inheritedBindings.map((item) => item.session), ...state.workspaceSessions]
  const nextState: AppState = {
    ...state,
    tasks: [nextSubtask, ...state.tasks],
    taskWorkspaceBindings: [...inheritedBindings.map((item) => item.binding), ...state.taskWorkspaceBindings],
    workspaceSessions: nextWorkspaceSessions,
    selectedTaskId: nextSubtask.id,
    selectedProjectId: project.id,
    executionCenter: deriveExecutionCenter([nextSubtask, ...state.tasks], state.executionCenter),
  }
  await withState(withClusterState(nextState), `已创建子任务 ${nextSubtask.title}。`, params.userId)

  return {
    ok: true as const,
    task: nextSubtask,
    inheritedWorkspaceCount: inheritedBindings.length,
  }
}

export const listTaskChatSessionsForUser = (params: {
  userId: string
  taskId: string
  workspaceId?: string
}) => {
  const state = loadState()
  const taskResult = getAuthorizedTask(state, params.userId, params.taskId)
  if (!taskResult.task || !taskResult.project) {
    return {
      ok: false as const,
      status: taskResult.status,
      message: taskResult.message,
    }
  }

  if (params.workspaceId && !getTaskChatWorkspaceIfVisible(params.userId, taskResult.project, params.workspaceId)) {
    return {
      ok: false as const,
      status: 404 as const,
      message: '工作区不存在或无权访问。',
    }
  }

  const sessions = listWorkspaceSessionsForTaskContext(params.taskId, params.workspaceId)
  return {
    ok: true as const,
    sessions,
  }
}

export const getTaskChatSessionSnapshotForUser = (params: {
  userId: string
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
  recentTurns?: number
}) => {
  const state = loadState()
  const taskResult = getAuthorizedTask(state, params.userId, params.taskId)
  if (!taskResult.task || !taskResult.project) {
    return {
      ok: false as const,
      status: taskResult.status,
      message: taskResult.message,
    }
  }

  if (params.workspaceId && !getTaskChatWorkspaceIfVisible(params.userId, taskResult.project, params.workspaceId)) {
    return {
      ok: false as const,
      status: 404 as const,
      message: '工作区不存在或无权访问。',
    }
  }

  const snapshot = normalizeTaskChatSnapshot(buildTaskChatSessionSnapshot({
    task: taskResult.task,
    project: taskResult.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  }), params.workspaceId, params.workspaceSessionId)

  if (snapshot.queue.status === 'queued' && !isTaskChatQueueDrainBlocked(taskResult.task, params.workspaceId, params.workspaceSessionId)) {
    scheduleTaskChatQueueDrain({
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
    })
  }

  return {
    ok: true as const,
    snapshot,
    conversation: getTaskConversationWithMessages(
      taskResult.task,
      taskResult.project,
      params.workspaceId,
      params.workspaceSessionId,
      { recentTurns: params.recentTurns },
    ),
  }
}

export const sendTaskChatMessageForUser = async (params: {
  userId: string
  taskId: string
  message: string
  attachments?: TaskChatAttachment[]
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const normalizedMessage = params.message.trim()
  if (!normalizedMessage) {
    return {
      ok: false as const,
      status: 400 as const,
      message: '消息不能为空。',
    }
  }

  const state = loadState()
  const taskResult = getAuthorizedTask(state, params.userId, params.taskId)
  if (!taskResult.task || !taskResult.project) {
    return {
      ok: false as const,
      status: taskResult.status,
      message: taskResult.message,
    }
  }

  if (params.workspaceId && !getTaskChatWorkspaceIfVisible(params.userId, taskResult.project, params.workspaceId)) {
    return {
      ok: false as const,
      status: 404 as const,
      message: '工作区不存在或无权访问。',
    }
  }

  const dispatchAvailability = await resolveWorkspaceChatDispatchAvailabilityAsync({
    state,
    userId: params.userId,
    task: taskResult.task,
    project: taskResult.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })
  if (!dispatchAvailability.ready && !dispatchAvailability.shouldQueue) {
    return {
      ok: false as const,
      status: 400 as const,
      message: dispatchAvailability.message || '当前工作区暂不可发送消息。',
    }
  }

  const runtimeBlocked = !dispatchAvailability.ready
    || isTaskChatQueueDrainBlocked(taskResult.task, params.workspaceId, params.workspaceSessionId)
  const executionLease = runtimeBlocked
    ? null
    : await tryAcquireTaskChatExecutionLease({
        taskId: params.taskId,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId,
      })

  if (!executionLease) {
    await enqueueTaskChatMessage({
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
      message: normalizedMessage,
      attachments: normalizeTaskChatAttachments(params.attachments),
      createdBy: params.userId,
    })
    scheduleTaskChatQueueDrain({
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
    })

    const snapshot = getTaskChatSessionSnapshotForUser({
      userId: params.userId,
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
    })
    return {
      ok: true as const,
      queued: true,
      message: dispatchAvailability.message || '消息已入队。',
      snapshot: snapshot.ok ? snapshot.snapshot : null,
    }
  }

  const execution = await executeTaskChatTurn({
    state,
    userId: params.userId,
    task: taskResult.task,
    project: taskResult.project,
    message: normalizedMessage,
    attachments: normalizeTaskChatAttachments(params.attachments),
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    turnId: crypto.randomUUID(),
    executionSlotAlreadyAcquired: true,
    sessionLease: executionLease,
  })

  const snapshot = getTaskChatSessionSnapshotForUser({
    userId: params.userId,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  return {
    ok: execution.result.ok,
    queued: false,
    message: execution.result.ok ? '消息已发送。' : '消息发送失败。',
    result: execution.result,
    snapshot: snapshot.ok ? snapshot.snapshot : null,
  }
}

export const updateTaskModelForUser = async (params: {
  userId: string
  taskId: string
  executionModel?: string
  executorNodeId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const state = loadState()
  const taskResult = getAuthorizedTask(state, params.userId, params.taskId)
  if (!taskResult.task || !taskResult.project) {
    return {
      ok: false as const,
      status: taskResult.status,
      message: taskResult.message,
    }
  }

  const requestedModel = params.executionModel?.trim() || undefined
  const scopedWorkspace = params.workspaceId
    ? getTaskChatWorkspaceIfVisible(params.userId, taskResult.project, params.workspaceId)
    : undefined
  const scopedWorkspaceSession = params.workspaceId
    ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, params.workspaceId, params.workspaceSessionId)
    : null
  const effectiveAgentType = scopedWorkspace?.agentType ?? taskResult.task.agentType

  if (requestedModel) {
    const modelsResult = await loadTaskModelOptionsFromExecutor(
      params.userId,
      taskResult.task,
      params.executorNodeId || resolveWorkspaceSessionExecutorId(scopedWorkspaceSession, scopedWorkspace?.executorNodeId),
      effectiveAgentType,
    )
    if (!modelsResult.ok) {
      return {
        ok: false as const,
        status: modelsResult.status,
        message: modelsResult.message,
      }
    }

    const isAvailable = Boolean(findMatchingAgentExecutionModelOption(effectiveAgentType, modelsResult.models, requestedModel))
    if (!isAvailable) {
      return {
        ok: false as const,
        status: 400 as const,
        message: '所选模型当前不可用。',
      }
    }
  }

  const timestamp = new Date().toISOString()
  const bindingState = params.workspaceId
    ? ensureTaskWorkspaceBindingState({
        task: taskResult.task,
        workspaceId: params.workspaceId,
        updatedAt: timestamp,
      })
    : null
  const baseTask = bindingState?.task ?? taskResult.task
  const nextTask: Task = {
    ...baseTask,
    executionModel: params.workspaceId ? baseTask.executionModel : requestedModel,
    opencodeConfig: params.workspaceId
      ? baseTask.opencodeConfig
      : effectiveAgentType === 'OpenCode'
        ? withOpenCodeExecutionModel(taskResult.task.opencodeConfig, requestedModel)
        : taskResult.task.opencodeConfig,
    updatedAt: timestamp,
  }

  const nextSession = params.workspaceId
    ? (() => {
        if (!scopedWorkspace) {
          return null
        }
        return mergeWorkspaceSession(nextTask, ensureWorkspaceSessionRecord({
          task: nextTask,
          workspaceId: params.workspaceId,
          executorNodeId: resolveWorkspaceSessionExecutorId(scopedWorkspaceSession, scopedWorkspace.executorNodeId),
          workspace: scopedWorkspace,
          workspaceSessionId: params.workspaceSessionId,
        }), {
          executionModel: requestedModel,
          opencodeConfig: effectiveAgentType === 'OpenCode'
            ? withOpenCodeExecutionModel(taskResult.task.opencodeConfig, requestedModel)
            : taskResult.task.opencodeConfig,
          updatedAt: timestamp,
        })
      })()
    : null

  saveTask(nextTask)
  if (nextSession) {
    saveWorkspaceSession(nextSession)
  }

  const tasks = state.tasks.map((item) => (item.id === params.taskId ? nextTask : item))
  const nextState: AppState = nextSession
    ? upsertWorkspaceSessionInState({
        ...state,
        tasks,
      }, nextSession)
    : {
        ...state,
        tasks,
      }
  await withState(nextState, requestedModel ? '任务模型已更新。' : '已切换为默认模型。', params.userId)

  return {
    ok: true as const,
    task: nextTask,
    session: nextSession,
    message: requestedModel ? '任务模型已更新。' : '已切换为默认模型。',
  }
}

export const updateTaskAgentForUser = async (params: {
  userId: string
  taskId: string
  agentType: ServerAgentType
  executorNodeId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const state = loadState()
  const taskResult = getAuthorizedTask(state, params.userId, params.taskId)
  if (!taskResult.task || !taskResult.project) {
    return {
      ok: false as const,
      status: taskResult.status,
      message: taskResult.message,
    }
  }

  const scopedWorkspace = params.workspaceId
    ? getTaskChatWorkspaceIfVisible(params.userId, taskResult.project, params.workspaceId)
    : undefined
  if (params.workspaceId && !scopedWorkspace) {
    return {
      ok: false as const,
      status: 404 as const,
      message: '工作区不存在或不可见。',
    }
  }

  const timestamp = new Date().toISOString()
  const currentSession = params.workspaceId
    ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, params.workspaceId, params.workspaceSessionId)
    : null
  const currentAgentType = currentSession?.agentType ?? taskResult.task.agentType
  const currentExecutionModel = currentSession?.executionModel ?? taskResult.task.executionModel
  const preferredExecutorId = params.executorNodeId?.trim()
    || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace?.executorNodeId)

  let nextExecutionModel = currentExecutionModel?.trim() || undefined
  if (params.agentType !== currentAgentType) {
    const modelsResult = await loadTaskModelOptionsFromExecutor(
      params.userId,
      taskResult.task,
      preferredExecutorId,
      params.agentType,
    )
    nextExecutionModel = modelsResult.ok && nextExecutionModel
      ? findMatchingAgentExecutionModelOption(params.agentType, modelsResult.models, nextExecutionModel)?.id || undefined
      : undefined
  }

  const bindingState = params.workspaceId
    ? ensureTaskWorkspaceBindingState({
        task: taskResult.task,
        workspaceId: params.workspaceId,
        updatedAt: timestamp,
      })
    : null
  const baseTask = bindingState?.task ?? taskResult.task
  const nextTask: Task = {
    ...baseTask,
    agentType: params.workspaceId ? baseTask.agentType : params.agentType,
    executionModel: params.workspaceId ? baseTask.executionModel : nextExecutionModel,
    opencodeConfig: params.workspaceId
      ? baseTask.opencodeConfig
      : params.agentType === 'OpenCode'
        ? withOpenCodeExecutionModel(taskResult.task.opencodeConfig, nextExecutionModel)
        : taskResult.task.opencodeConfig,
    updatedAt: timestamp,
  }

  const nextSession = params.workspaceId
    ? (() => {
        const session = ensureWorkspaceSessionRecord({
          task: nextTask,
          workspaceId: params.workspaceId,
          executorNodeId: preferredExecutorId,
          workspace: scopedWorkspace,
          workspaceSessionId: params.workspaceSessionId,
        })

        return mergeWorkspaceSession(nextTask, session, {
          agentType: params.agentType,
          executionModel: nextExecutionModel,
          executorNodeId: preferredExecutorId,
          runtimeOwnerExecutorId: preferredExecutorId,
          opencodeConfig: params.agentType === 'OpenCode'
            ? withOpenCodeExecutionModel(session.opencodeConfig ?? taskResult.task.opencodeConfig, nextExecutionModel)
            : session.opencodeConfig ?? taskResult.task.opencodeConfig,
          updatedAt: timestamp,
        })
      })()
    : null

  saveTask(nextTask)
  if (nextSession) {
    saveWorkspaceSession(nextSession)
  }

  const tasks = state.tasks.map((item) => (item.id === params.taskId ? nextTask : item))
  const nextState: AppState = nextSession
    ? upsertWorkspaceSessionInState({
        ...state,
        tasks,
      }, nextSession)
    : {
        ...state,
        tasks,
      }
  await withState(nextState, nextExecutionModel ? '执行端已更新。' : '执行端已更新，模型已回退到默认值。', params.userId)

  return {
    ok: true as const,
    task: nextTask,
    session: nextSession,
    message: nextExecutionModel ? '执行端已更新。' : '执行端已更新，模型已回退到默认值。',
  }
}
