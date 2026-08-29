import { mergeAgentRuntimeSettings } from '@shared/agent-config'
import { findMatchingAgentExecutionModelOption } from '@shared/model-profile'
import { withOpenCodeExecutionModel } from '@shared/opencode-execution-config'
import { normalizeTaskChatMessageRuntimeConfig, type TaskChatMessageRuntimeConfig } from '@shared/task-chat-session'
import { buildWorkspaceTaskExecutionView, mergeWorkspaceSession, resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import type { AgentRuntimeSettings, AppState, Project, Task, WorkspaceSession } from '@shared/types'
import { getAuthorizedTask, withState } from '../../routes/shared'
import {
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getScopedWorkspaceForProject,
  getWorkspaceSessionRecordForTaskContext,
  upsertWorkspaceSessionInState,
} from '../../routes/task-route-support'
import { loadState, saveTask, saveWorkspaceSession } from '../../storage/app-state-store'
import { getServerAgentSettings } from '../server-agent'
import { loadTaskModelOptionsFromExecutor } from './workspace-executor'
import { getCommercialGate } from '../../services/gate/commercial-gate'

type TaskChatRuntimeContext = {
  state: AppState
  task: Task
  project: Project
}

const normalizeOptionalString = (value?: string) => {
  return value?.trim() || undefined
}

const normalizeSelection = (value?: string[]) => {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean))).sort((left, right) => {
    return left.localeCompare(right)
  })
}

const areStringArraysEqual = (left?: string[], right?: string[]) => {
  const normalizedLeft = normalizeSelection(left)
  const normalizedRight = normalizeSelection(right)
  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

const areRuntimeSettingsEqual = (
  left: AgentRuntimeSettings | undefined,
  right: AgentRuntimeSettings | undefined,
) => {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

const loadTaskChatRuntimeContext = (userId: string, taskId: string): TaskChatRuntimeContext => {
  const state = loadState()
  const taskResult = getAuthorizedTask(state, userId, taskId)
  if (!taskResult.task || !taskResult.project) {
    throw new Error(taskResult.message)
  }

  return {
    state,
    task: taskResult.task,
    project: taskResult.project,
  }
}

const getScopedWorkspaceSession = (
  task: Task,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
  if (!workspaceId) {
    return null
  }

  return getWorkspaceSessionRecordForTaskContext(task.id, workspaceId, workspaceSessionId)
}

const resolveScopedAgentType = (
  task: Task,
  workspaceSession?: WorkspaceSession | null,
) => {
  return workspaceSession?.agentType ?? task.agentType
}

const resolveScopedExecutionModel = (
  task: Task,
  workspaceSession?: WorkspaceSession | null,
) => {
  return workspaceSession?.executionModel ?? task.executionModel
}

const resolveScopedRuntimeSettings = (
  state: AppState,
  agentType: Task['agentType'],
  workspaceSession?: WorkspaceSession | null,
) => {
  return mergeAgentRuntimeSettings(
    agentType,
    getServerAgentSettings(state.config, agentType),
    workspaceSession?.agentSettings,
  )
}

const resolveRuntimeConfigWorkspaceWorkerId = (
  workspace: { executorNodeId?: string | null } | null | undefined,
  runtimeConfig: TaskChatMessageRuntimeConfig,
) => {
  const workspaceWorkerId = resolveWorkspaceWorkerId(workspace)
  const requestedExecutorId = normalizeOptionalString(runtimeConfig.executorNodeId)
  if (requestedExecutorId && requestedExecutorId !== workspaceWorkerId) {
    throw new Error('执行节点属于工作区，请先在工作区设置中切换当前节点。')
  }
  return workspaceWorkerId
}

const persistTaskChatRuntimeState = async (
  state: AppState,
  userId: string,
) => {
  await withState(state, undefined, userId)
}

const ensurePersistedTaskWorkspaceBindingState = (
  context: TaskChatRuntimeContext,
  workspaceId: string,
  updatedAt: string,
) => context.state.tasks.some((task) => task.id === context.task.id)
  ? ensureTaskWorkspaceBindingState({
      task: context.task,
      workspaceId,
      updatedAt,
    })
  : null

const applyAgentTypeAndExecutor = async (params: {
  userId: string
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
  runtimeConfig: TaskChatMessageRuntimeConfig
}) => {
  console.info('[task-chat-runtime-config][agent-executor][request]', JSON.stringify({
    userId: params.userId,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    runtimeAgentType: params.runtimeConfig.agentType,
    runtimeExecutorNodeId: normalizeOptionalString(params.runtimeConfig.executorNodeId) ?? '',
    runtimeExecutionModel: normalizeOptionalString(params.runtimeConfig.executionModel) ?? '',
  }))
  const context = loadTaskChatRuntimeContext(params.userId, params.taskId)
  const workspaceId = normalizeOptionalString(params.workspaceId)
  const workspaceSessionId = normalizeOptionalString(params.workspaceSessionId)
  const scopedWorkspace = workspaceId
    ? getScopedWorkspaceForProject(params.userId, context.project, workspaceId)
    : undefined
  if (workspaceId && !scopedWorkspace) {
    throw new Error('工作区不存在或不可见。')
  }

  const currentSession = getScopedWorkspaceSession(context.task, workspaceId, workspaceSessionId)
  const currentAgentType = resolveScopedAgentType(context.task, currentSession)
  const currentExecutionModel = resolveScopedExecutionModel(context.task, currentSession)
  const preferredExecutorId = workspaceId
    ? resolveRuntimeConfigWorkspaceWorkerId(scopedWorkspace, params.runtimeConfig)
    : normalizeOptionalString(params.runtimeConfig.executorNodeId)
      || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace?.executorNodeId)
  const shouldUpdateAgentType = params.runtimeConfig.agentType !== currentAgentType

  if (!shouldUpdateAgentType) {
    return
  }

  let nextExecutionModel = currentExecutionModel?.trim() || undefined
  if (params.runtimeConfig.agentType !== currentAgentType) {
    const modelsResult = await loadTaskModelOptionsFromExecutor(
      params.userId,
      context.task,
      preferredExecutorId,
      params.runtimeConfig.agentType,
    )
    nextExecutionModel = modelsResult.ok && nextExecutionModel
      ? findMatchingAgentExecutionModelOption(params.runtimeConfig.agentType, modelsResult.models, nextExecutionModel)?.id || undefined
      : undefined
  }

  const timestamp = new Date().toISOString()
  const bindingState = workspaceId
    ? ensurePersistedTaskWorkspaceBindingState(context, workspaceId, timestamp)
    : null
  const baseTask = bindingState?.task ?? context.task
  const nextTask: Task = {
    ...baseTask,
    agentType: workspaceId ? baseTask.agentType : params.runtimeConfig.agentType,
    executionModel: workspaceId ? baseTask.executionModel : nextExecutionModel,
    opencodeConfig: workspaceId
      ? baseTask.opencodeConfig
      : params.runtimeConfig.agentType === 'OpenCode'
        ? withOpenCodeExecutionModel(context.task.opencodeConfig, nextExecutionModel)
        : context.task.opencodeConfig,
    updatedAt: timestamp,
  }

  const nextSession = workspaceId
    ? (() => {
        const session = ensureWorkspaceSessionRecord({
          task: nextTask,
          workspaceId,
          executorNodeId: preferredExecutorId,
          workspace: scopedWorkspace,
          workspaceSessionId,
        })
        return mergeWorkspaceSession(nextTask, session, {
          agentType: params.runtimeConfig.agentType,
          executionModel: nextExecutionModel,
          executorNodeId: preferredExecutorId,
          runtimeOwnerExecutorId: preferredExecutorId,
          opencodeConfig: params.runtimeConfig.agentType === 'OpenCode'
            ? withOpenCodeExecutionModel(session.opencodeConfig ?? context.task.opencodeConfig, nextExecutionModel)
            : session.opencodeConfig ?? context.task.opencodeConfig,
          updatedAt: timestamp,
        })
      })()
    : null

  saveTask(nextTask)
  if (nextSession) {
    saveWorkspaceSession(nextSession)
  }
  console.info('[task-chat-runtime-config][agent-executor][saved]', JSON.stringify({
    userId: params.userId,
    taskId: params.taskId,
    workspaceId,
    workspaceSessionId: nextSession?.id ?? workspaceSessionId ?? '',
    savedSessionExecutorNodeId: nextSession?.executorNodeId ?? '',
    savedSessionRuntimeOwnerExecutorId: nextSession?.runtimeOwnerExecutorId ?? '',
    savedSessionWorktreeStatus: nextSession?.worktreeStatus ?? '',
    savedSessionRuntimeStatus: nextSession?.runtimeStatus ?? '',
    savedSessionAgentSessionId: nextSession?.agentSessionId ?? '',
    savedSessionOpencodeSessionId: nextSession?.opencodeSessionId ?? '',
  }))

  const tasks = context.state.tasks.map((item) => (item.id === params.taskId ? nextTask : item))
  const nextState: AppState = nextSession
    ? upsertWorkspaceSessionInState({
        ...context.state,
        tasks,
      }, nextSession)
    : {
        ...context.state,
        tasks,
      }
  await persistTaskChatRuntimeState(nextState, params.userId)
}

const applyExecutionModel = async (params: {
  userId: string
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
  runtimeConfig: TaskChatMessageRuntimeConfig
}) => {
  const context = loadTaskChatRuntimeContext(params.userId, params.taskId)
  const workspaceId = normalizeOptionalString(params.workspaceId)
  const workspaceSessionId = normalizeOptionalString(params.workspaceSessionId)
  const requestedModel = normalizeOptionalString(params.runtimeConfig.executionModel)
  const scopedWorkspace = workspaceId
    ? getScopedWorkspaceForProject(params.userId, context.project, workspaceId)
    : undefined
  if (workspaceId && !scopedWorkspace) {
    throw new Error('工作区不存在或不可见。')
  }

  const currentSession = getScopedWorkspaceSession(context.task, workspaceId, workspaceSessionId)
  const effectiveAgentType = resolveScopedAgentType(context.task, currentSession)
  const currentExecutionModel = resolveScopedExecutionModel(context.task, currentSession)?.trim() || undefined
  if ((requestedModel ?? '') === (currentExecutionModel ?? '')) {
    return
  }

  if (requestedModel) {
    if (getCommercialGate().isPremiumExecutionModel(requestedModel)) {
      const featureAccess = await getCommercialGate().resolveBillingFeatureAccess(params.userId, 'premium_models')
      if (!featureAccess.allowed) {
        throw new Error(featureAccess.message)
      }
    }

    const executorId = workspaceId
      ? resolveRuntimeConfigWorkspaceWorkerId(scopedWorkspace, params.runtimeConfig)
      : normalizeOptionalString(params.runtimeConfig.executorNodeId)
        || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace?.executorNodeId)
    const modelsResult = await loadTaskModelOptionsFromExecutor(
      params.userId,
      context.task,
      executorId,
      effectiveAgentType,
    )
    if (!modelsResult.ok) {
      throw new Error(modelsResult.message)
    }

    if (!findMatchingAgentExecutionModelOption(effectiveAgentType, modelsResult.models, requestedModel)) {
      throw new Error('所选模型当前不可用。')
    }
  }

  const timestamp = new Date().toISOString()
  const bindingState = workspaceId
    ? ensurePersistedTaskWorkspaceBindingState(context, workspaceId, timestamp)
    : null
  const baseTask = bindingState?.task ?? context.task
  const nextTask: Task = {
    ...baseTask,
    executionModel: workspaceId ? baseTask.executionModel : requestedModel,
    opencodeConfig: workspaceId
      ? baseTask.opencodeConfig
      : effectiveAgentType === 'OpenCode'
        ? withOpenCodeExecutionModel(context.task.opencodeConfig, requestedModel)
        : context.task.opencodeConfig,
    updatedAt: timestamp,
  }

  const nextSession = workspaceId
    ? (() => {
        const session = ensureWorkspaceSessionRecord({
          task: nextTask,
          workspaceId,
          executorNodeId: resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace?.executorNodeId),
          workspace: scopedWorkspace,
          workspaceSessionId,
        })

        return mergeWorkspaceSession(nextTask, session, {
          executionModel: requestedModel,
          opencodeConfig: effectiveAgentType === 'OpenCode'
            ? withOpenCodeExecutionModel(session.opencodeConfig ?? context.task.opencodeConfig, requestedModel)
            : session.opencodeConfig ?? context.task.opencodeConfig,
          updatedAt: timestamp,
        })
      })()
    : null

  saveTask(nextTask)
  if (nextSession) {
    saveWorkspaceSession(nextSession)
  }

  const tasks = context.state.tasks.map((item) => (item.id === params.taskId ? nextTask : item))
  const nextState: AppState = nextSession
    ? upsertWorkspaceSessionInState({
        ...context.state,
        tasks,
      }, nextSession)
    : {
        ...context.state,
        tasks,
      }
  await persistTaskChatRuntimeState(nextState, params.userId)
}

const applyAgentSettings = async (params: {
  userId: string
  taskId: string
  workspaceId: string
  workspaceSessionId?: string
  runtimeConfig: TaskChatMessageRuntimeConfig
}) => {
  if (!params.runtimeConfig.agentSettings) {
    return
  }

  const context = loadTaskChatRuntimeContext(params.userId, params.taskId)
  const scopedWorkspace = getScopedWorkspaceForProject(params.userId, context.project, params.workspaceId)
  if (!scopedWorkspace) {
    throw new Error('工作区不存在或不可见。')
  }
  const workspaceWorkerId = resolveRuntimeConfigWorkspaceWorkerId(scopedWorkspace, params.runtimeConfig)

  const bindingTask = ensurePersistedTaskWorkspaceBindingState(
    context,
    params.workspaceId,
    new Date().toISOString(),
  )?.task ?? context.task
  const existingSession = getScopedWorkspaceSession(bindingTask, params.workspaceId, params.workspaceSessionId)
  const currentSession = ensureWorkspaceSessionRecord({
    task: bindingTask,
    workspaceId: params.workspaceId,
    executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(existingSession, scopedWorkspace.executorNodeId),
    workspace: scopedWorkspace,
    workspaceSessionId: params.workspaceSessionId,
  })
  const effectiveAgentType = currentSession.agentType ?? scopedWorkspace.agentType ?? context.task.agentType
  if (effectiveAgentType !== params.runtimeConfig.agentType) {
    throw new Error('请先切换到当前执行端，再修改该执行端参数。')
  }

  const nextRuntimeSettings = mergeAgentRuntimeSettings(
    effectiveAgentType,
    getServerAgentSettings(context.state.config, effectiveAgentType),
    params.runtimeConfig.agentSettings,
  )
  const currentRuntimeSettings = resolveScopedRuntimeSettings(context.state, effectiveAgentType, currentSession)
  if (areRuntimeSettingsEqual(currentRuntimeSettings, nextRuntimeSettings)) {
    return
  }

  const timestamp = new Date().toISOString()
  const nextSession = mergeWorkspaceSession(context.task, currentSession, {
    executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
    runtimeOwnerExecutorId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
    agentSettings: nextRuntimeSettings,
    updatedAt: timestamp,
  })

  saveWorkspaceSession(nextSession)
  const nextState = upsertWorkspaceSessionInState(context.state, nextSession)
  await persistTaskChatRuntimeState(nextState, params.userId)
}

const applyMcpSettings = async (params: {
  userId: string
  taskId: string
  workspaceId: string
  workspaceSessionId?: string
  runtimeConfig: TaskChatMessageRuntimeConfig
}) => {
  if (!params.runtimeConfig.enabledMcpServerIds) {
    return
  }

  const context = loadTaskChatRuntimeContext(params.userId, params.taskId)
  const scopedWorkspace = getScopedWorkspaceForProject(params.userId, context.project, params.workspaceId)
  if (!scopedWorkspace) {
    throw new Error('工作区不存在或不可见。')
  }
  const workspaceWorkerId = resolveRuntimeConfigWorkspaceWorkerId(scopedWorkspace, params.runtimeConfig)

  const bindingTask = ensurePersistedTaskWorkspaceBindingState(
    context,
    params.workspaceId,
    new Date().toISOString(),
  )?.task ?? context.task
  const existingSession = getScopedWorkspaceSession(bindingTask, params.workspaceId, params.workspaceSessionId)
  const currentSession = ensureWorkspaceSessionRecord({
    task: bindingTask,
    workspaceId: params.workspaceId,
    executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(existingSession, scopedWorkspace.executorNodeId),
    workspace: scopedWorkspace,
    workspaceSessionId: params.workspaceSessionId,
  })
  const enabledMcpServerIds = normalizeSelection(params.runtimeConfig.enabledMcpServerIds)
  if (areStringArraysEqual(currentSession.enabledMcpServerIds, enabledMcpServerIds)) {
    return
  }

  const nextSession = mergeWorkspaceSession(context.task, currentSession, {
    runtimeOwnerExecutorId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
    enabledMcpServerIds,
    updatedAt: new Date().toISOString(),
  })

  saveWorkspaceSession(nextSession)
  const nextState = upsertWorkspaceSessionInState(context.state, nextSession)
  await persistTaskChatRuntimeState(nextState, params.userId)
}

const applyPublishSettings = async (params: {
  userId: string
  taskId: string
  workspaceId: string
  workspaceSessionId?: string
  runtimeConfig: TaskChatMessageRuntimeConfig
}) => {
  if (!params.runtimeConfig.publishPolicy && !params.runtimeConfig.gitAuthPreference) {
    return
  }

  const context = loadTaskChatRuntimeContext(params.userId, params.taskId)
  const scopedWorkspace = getScopedWorkspaceForProject(params.userId, context.project, params.workspaceId)
  if (!scopedWorkspace) {
    throw new Error('工作区不存在或不可见。')
  }
  const workspaceWorkerId = resolveRuntimeConfigWorkspaceWorkerId(scopedWorkspace, params.runtimeConfig)

  const bindingTask = ensurePersistedTaskWorkspaceBindingState(
    context,
    params.workspaceId,
    new Date().toISOString(),
  )?.task ?? context.task
  const existingSession = getScopedWorkspaceSession(bindingTask, params.workspaceId, params.workspaceSessionId)
  const currentSession = ensureWorkspaceSessionRecord({
    task: bindingTask,
    workspaceId: params.workspaceId,
    executorNodeId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(existingSession, scopedWorkspace.executorNodeId),
    workspace: scopedWorkspace,
    workspaceSessionId: params.workspaceSessionId,
  })

  const nextPublishPolicy = params.runtimeConfig.publishPolicy ?? currentSession.publishPolicy ?? 'pull-request'
  const nextGitAuthPreference = params.runtimeConfig.gitAuthPreference ?? currentSession.gitAuthPreference ?? 'project-default'
  if (
    currentSession.publishPolicy === nextPublishPolicy
    && currentSession.gitAuthPreference === nextGitAuthPreference
  ) {
    return
  }

  const nextSession = mergeWorkspaceSession(context.task, currentSession, {
    runtimeOwnerExecutorId: workspaceWorkerId || resolveWorkspaceSessionExecutorId(currentSession, scopedWorkspace.executorNodeId),
    publishPolicy: nextPublishPolicy,
    gitAuthPreference: nextGitAuthPreference,
    updatedAt: new Date().toISOString(),
  })

  saveWorkspaceSession(nextSession)
  const nextState = upsertWorkspaceSessionInState(context.state, nextSession)
  await persistTaskChatRuntimeState(nextState, params.userId)
}

export const applyRuntimeSelectionToWorkspaceSession = (params: {
  task: Task
  session: WorkspaceSession
  runtimeConfig: Pick<TaskChatMessageRuntimeConfig, 'agentType' | 'executionModel'>
  updatedAt: string
}) => mergeWorkspaceSession(params.task, params.session, {
  agentType: params.runtimeConfig.agentType,
  executionModel: normalizeOptionalString(params.runtimeConfig.executionModel),
  updatedAt: params.updatedAt,
})

const finalizeWorkspaceRuntimeSelection = async (params: {
  userId: string
  taskId: string
  workspaceId: string
  workspaceSessionId?: string
  runtimeConfig: TaskChatMessageRuntimeConfig
}): Promise<TaskChatRuntimeContext> => {
  const context = loadTaskChatRuntimeContext(params.userId, params.taskId)
  const currentSession = getScopedWorkspaceSession(context.task, params.workspaceId, params.workspaceSessionId)
  if (!currentSession) {
    return context
  }

  const nextSession = applyRuntimeSelectionToWorkspaceSession({
    task: context.task,
    session: currentSession,
    runtimeConfig: params.runtimeConfig,
    updatedAt: new Date().toISOString(),
  })
  saveWorkspaceSession(nextSession)
  const nextState = upsertWorkspaceSessionInState(context.state, nextSession)
  await persistTaskChatRuntimeState(nextState, params.userId)

  return {
    state: nextState,
    task: buildWorkspaceTaskExecutionView(context.task, nextSession),
    project: context.project,
  }
}

export const applyTaskChatMessageRuntimeConfig = async (params: {
  userId: string
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
  runtimeConfig?: TaskChatMessageRuntimeConfig
}) => {
  const runtimeConfig = normalizeTaskChatMessageRuntimeConfig(params.runtimeConfig)
  if (!runtimeConfig) {
    return loadTaskChatRuntimeContext(params.userId, params.taskId)
  }

  const workspaceId = normalizeOptionalString(params.workspaceId)
  const workspaceSessionId = normalizeOptionalString(params.workspaceSessionId)

  await applyAgentTypeAndExecutor({
    userId: params.userId,
    taskId: params.taskId,
    workspaceId,
    workspaceSessionId,
    runtimeConfig,
  })
  await applyExecutionModel({
    userId: params.userId,
    taskId: params.taskId,
    workspaceId,
    workspaceSessionId,
    runtimeConfig,
  })

  if (workspaceId) {
    await applyAgentSettings({
      userId: params.userId,
      taskId: params.taskId,
      workspaceId,
      workspaceSessionId,
      runtimeConfig,
    })
    await applyMcpSettings({
      userId: params.userId,
      taskId: params.taskId,
      workspaceId,
      workspaceSessionId,
      runtimeConfig,
    })
    await applyPublishSettings({
      userId: params.userId,
      taskId: params.taskId,
      workspaceId,
      workspaceSessionId,
      runtimeConfig,
    })

    return finalizeWorkspaceRuntimeSelection({
      userId: params.userId,
      taskId: params.taskId,
      workspaceId,
      workspaceSessionId,
      runtimeConfig,
    })
  }

  return loadTaskChatRuntimeContext(params.userId, params.taskId)
}
