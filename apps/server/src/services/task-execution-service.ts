// [INPUT]: Authorized task/workspace execution requests and persisted application state.
// [OUTPUT]: Validated task run, binding, and standard workspace-chat queue state.
// [POS]: Server orchestration boundary that routes every caller through the workspace-session message flow.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createExecutionLog } from '@shared/task-orchestrator'
import { findMatchingAgentExecutionModelOption } from '@shared/model-profile'
import type { TaskChatQueueEntry } from '@shared/task-chat-session'
import { mergeWorkspaceSession, resolveWorkspaceExecutionPreference, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type {
  AppState,
  CreatorIdentity,
  DistributedReturnMode,
  SyncBackStrategy,
  Project,
  Task,
  TaskRun,
  TaskWorkspaceBinding,
  WorkspaceSession,
  WorkingDirectoryMode,
  Workspace,
} from '@shared/types'
import { canUserUseExecutorForProject, listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { refreshProjectVersionControlFromExecutor } from '../control-plane/executor-repo-service'
import { enqueueTaskChatMessage } from '../control-plane/task-chat-service'
import { validateProjectExecutorPathAccess } from './project-executor-ownership'
import { isDistributedTaskTerminal } from '../routes/shared'
import {
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getScopedWorkspaceForProject,
  getWorkspaceBranchSnapshot,
  hasOriginalDirSessionConflict,
  rememberRecentBaseBranch,
  resolveUserCreatorIdentity,
} from '../routes/task-route-support'
import { getDistributedTask, listProjectBindings } from '../storage/distributed-task-store'
import { saveTask, saveTaskRun, saveTaskWorkspaceBinding, saveWorkspaceSession } from '../storage/app-state-store'
import { loadTaskModelOptionsFromExecutor } from './task-chat-dispatch/workspace-executor'
import { scheduleTaskChatQueueDrain } from './task-chat-dispatch/turn-execution'

export type ExecuteTaskOnWorkspaceInput = {
  state: AppState
  userId: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  messageAuthor?: CreatorIdentity
  task: Task
  project: Project
  workspaceId: string
  workspaceSessionId?: string
  workingDirectoryMode?: WorkingDirectoryMode
  createNewSession?: boolean
  delegatedPrompt?: string
  baseBranch?: string
  returnMode?: DistributedReturnMode
  syncBackStrategy?: SyncBackStrategy
  gitIdentityMode?: 'personal'
  agentType?: Task['agentType']
  executionModel?: string
}

export type ExecuteTaskOnWorkspaceResult =
  | {
      ok: false
      status: 400 | 404 | 409
      message: string
    }
  | {
      ok: true
      message: string
      project: Project
      task: Task
      workspace: Workspace
      binding: TaskWorkspaceBinding
      session: WorkspaceSession
      taskRun: TaskRun
      queueEntry: TaskChatQueueEntry
    }

export const resolveTaskExecutionPrompt = (params: {
  taskDescription: string
  delegatedPrompt?: string
  sessionDelegatedPrompt?: string
}) => (
  params.delegatedPrompt?.trim()
  || params.sessionDelegatedPrompt?.trim()
  || params.taskDescription
)

export const executeTaskOnWorkspace = async (params: ExecuteTaskOnWorkspaceInput): Promise<ExecuteTaskOnWorkspaceResult> => {
  if (params.task.requirementType === 'requirement') {
    return { ok: false, status: 400, message: '需求项暂不支持直接执行，请先转成可执行任务。' }
  }

  const existingSession = params.state.workspaceSessions
    .filter((session) => session.workspaceId === params.workspaceId)
    .find((session) => (params.workspaceSessionId ? session.id === params.workspaceSessionId : true))
  if (existingSession?.distributedTaskId) {
    const existingDistributedTask = getDistributedTask(existingSession.distributedTaskId)
    if (existingDistributedTask && !isDistributedTaskTerminal(existingDistributedTask.status)) {
      return { ok: false, status: 400, message: '当前工作区已经有执行中的任务，请等待完成后再重新执行。' }
    }
  }

  const workspace = getScopedWorkspaceForProject(params.userId, params.project, params.workspaceId)
  if (!workspace) {
    return { ok: false, status: 404, message: '工作区不存在或无权访问。' }
  }

  const workspaceSessionExecutorId = resolveWorkspaceSessionExecutorId(existingSession, workspace.executorNodeId)
  const project = await refreshProjectVersionControlFromExecutor(params.userId, params.project, workspaceSessionExecutorId)
  const versionControl = project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')
  const executorAccess = canUserUseExecutorForProject({
    userId: params.userId,
    projectId: project.id,
    executorId: workspaceSessionExecutorId,
  })
  if (!executorAccess.ok) {
    return { ok: false, status: 400, message: executorAccess.message }
  }
  const pathAccess = validateProjectExecutorPathAccess({
    project,
    executorId: workspaceSessionExecutorId,
    bindings: listProjectBindings(),
    executors: listVisibleExecutorsForUser(params.userId),
  })
  if (!pathAccess.ok) {
    return { ok: false, status: 409, message: pathAccess.message }
  }

  const executionPreference = resolveWorkspaceExecutionPreference({
    workspaceId: workspace.id,
    executorNodeId: workspaceSessionExecutorId,
    sessions: params.state.workspaceSessions,
    currentSession: existingSession,
    explicitAgentType: params.agentType ?? params.task.agentType,
    explicitExecutionModel: params.executionModel ?? params.task.executionModel,
    defaults: params.state.config.workspaceExecutionDefaults,
  })
  if (!executionPreference) {
    return { ok: false, status: 400, message: '当前工作区没有可用的执行配置。请先在模型设置中选择默认执行节点、Coding Agent 和模型。' }
  }
  const selectedAgentType = executionPreference.agentType
  const requestedExecutionModel = executionPreference.executionModel
  const modelsResult = await loadTaskModelOptionsFromExecutor(
    params.userId,
    params.task,
    workspaceSessionExecutorId,
    selectedAgentType,
  )
  if (!modelsResult.ok) {
    return { ok: false, status: 400, message: `无法确认 ${selectedAgentType} 的可用模型：${modelsResult.message}` }
  }
  const matchedExecutionModel = requestedExecutionModel
    ? findMatchingAgentExecutionModelOption(selectedAgentType, modelsResult.models, requestedExecutionModel)
    : undefined
  if (requestedExecutionModel && !matchedExecutionModel) {
    return { ok: false, status: 400, message: `模型 ${requestedExecutionModel} 当前无法用于 ${selectedAgentType}。请先在工作区选择该执行节点实际可用的 Coding 模型。` }
  }
  const executionModel = matchedExecutionModel?.id || modelsResult.defaultModel?.trim()
  if (!executionModel) {
    return { ok: false, status: 400, message: `${selectedAgentType} 没有可验证的默认 Coding 模型。请先在工作区选择 Agent 和模型后再执行。` }
  }
  const task = {
    ...params.task,
    agentType: selectedAgentType,
    executionModel,
  }

  const requestedBaseBranch = params.baseBranch?.trim()
  const branchSnapshot = requestedBaseBranch || versionControl === 'none'
    ? null
    : await getWorkspaceBranchSnapshot(params.userId, project, workspace, existingSession)
  const candidateBaseBranch = (
    requestedBaseBranch
    || task.baseBranchHint?.trim()
    || workspace.suggestedBaseBranch
    || branchSnapshot?.defaultBranch
    || project.defaultBranch
    || 'main'
  ).trim()
  const selectedBaseBranch = branchSnapshot?.ok && branchSnapshot.branches.length > 0
    ? branchSnapshot.branches.includes(candidateBaseBranch)
      ? candidateBaseBranch
      : requestedBaseBranch
        ? candidateBaseBranch
        : branchSnapshot.defaultBranch
    : candidateBaseBranch

  if (versionControl !== 'none' && branchSnapshot?.ok && branchSnapshot.branches.length > 0 && !branchSnapshot.branches.includes(selectedBaseBranch)) {
    return {
      ok: false,
      status: 400,
      message: `起始分支 ${selectedBaseBranch} 不存在，请从仓库已有分支中选择。当前可用分支：${branchSnapshot.branches.join(', ')}`,
    }
  }

  const returnMode = versionControl === 'none' ? 'summary' : (params.returnMode ?? 'commit')
  const bindingState = ensureTaskWorkspaceBindingState({
    task,
    workspaceId: workspace.id,
    updatedAt: new Date().toISOString(),
  })
  const binding = bindingState.binding
  const session = ensureWorkspaceSessionRecord({
    task: bindingState.task,
    workspaceId: workspace.id,
    executorNodeId: workspaceSessionExecutorId,
    workspace,
    workspaceSessionId: params.workspaceSessionId,
    workingDirectoryMode: params.workingDirectoryMode,
    createNewSession: params.createNewSession,
  })
  if (hasOriginalDirSessionConflict({
    state: params.state,
    workspaceId: workspace.id,
    currentSessionId: session.id,
  })) {
    return { ok: false, status: 409, message: '原始目录模式下同一工作区同一时间只允许一个会话准备或执行。' }
  }

  const delegatedPrompt = params.delegatedPrompt?.trim() || undefined
  const executionSession = mergeWorkspaceSession(bindingState.task, session, {
    agentType: selectedAgentType,
    executionModel,
    ...(delegatedPrompt ? { delegatedPrompt } : {}),
  })
  const executionPrompt = resolveTaskExecutionPrompt({
    taskDescription: task.description,
    delegatedPrompt,
    sessionDelegatedPrompt: executionSession.delegatedPrompt,
  })
  const taskRun: TaskRun = {
    id: crypto.randomUUID(),
    taskId: bindingState.task.id,
    projectId: project.id,
    workspaceId: workspace.id,
    executorNodeId: workspaceSessionExecutorId,
    baseBranch: selectedBaseBranch,
    returnMode,
    gitIdentityMode: params.gitIdentityMode ?? 'personal',
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const persistedTaskRun: TaskRun = {
    ...taskRun,
    workspaceSessionId: executionSession.id,
    executionModel,
    updatedAt: new Date().toISOString(),
  }
  saveTaskRun(persistedTaskRun)

  const nextProject = rememberRecentBaseBranch(project, selectedBaseBranch)
  const executionMessage = versionControl === 'none'
    ? (executorAccess.executor.status === 'online'
        ? `已在工作区 ${workspace.name} 排队执行，将直接在项目目录中运行。`
        : `工作区 ${workspace.name} 所在执行节点 ${executorAccess.executor.name} 当前离线，任务已排队，待节点上线后会直接在项目目录中运行。`)
    : (executorAccess.executor.status === 'online'
        ? `已在工作区 ${workspace.name} 排队执行，起始分支 ${selectedBaseBranch}。`
        : `工作区 ${workspace.name} 所在执行节点 ${executorAccess.executor.name} 当前离线，任务已排队，待节点上线后从 ${selectedBaseBranch} 开始执行。`)

  const updatedAt = new Date().toISOString()
  const nextTask: Task = {
    ...bindingState.task,
    baseBranch: selectedBaseBranch,
    executionMode: 'remote',
    currentStep: executionMessage,
    updatedAt,
    logs: [...bindingState.task.logs, createExecutionLog('system', executionMessage)],
  }
  const nextSession = mergeWorkspaceSession(bindingState.task, executionSession, {
    executorNodeId: workspaceSessionExecutorId,
    runtimeOwnerExecutorId: workspaceSessionExecutorId,
    agentType: selectedAgentType,
    executionModel,
    gitIdentityMode: params.gitIdentityMode ?? 'personal',
    distributedTaskId: undefined,
    baseBranch: selectedBaseBranch,
    agentRunningStatus: 'idle',
    runtimeStatus: 'queued',
    runtimeStartedAt: undefined,
    lastHeartbeatAt: undefined,
    lastRuntimeEventAt: updatedAt,
    terminalReason: undefined,
    runtimeSequence: executionSession.runtimeSequence + 1,
    currentStep: executionMessage,
    needsHumanConfirm: false,
    updatedAt,
    lastActiveAt: updatedAt,
  })

  saveTask(nextTask)
  saveTaskWorkspaceBinding(binding)
  saveWorkspaceSession(nextSession)
  const queueEntry = await enqueueTaskChatMessage({
    id: taskRun.id,
    taskId: nextTask.id,
    workspaceId: workspace.id,
    workspaceSessionId: nextSession.id,
    taskRunId: taskRun.id,
    requestedByAgentId: params.requestedByAgentId,
    sourceAgentEventId: params.sourceAgentEventId,
    author: params.messageAuthor ?? resolveUserCreatorIdentity(params.userId),
    dedupeKey: `task-run:${taskRun.id}`,
    message: executionPrompt,
    createdBy: params.userId,
  })
  scheduleTaskChatQueueDrain({
    taskId: nextTask.id,
    workspaceId: workspace.id,
    workspaceSessionId: nextSession.id,
  })

  return {
    ok: true,
    message: executionMessage,
    project: nextProject,
    task: nextTask,
    workspace,
    binding,
    session: nextSession,
    taskRun: persistedTaskRun,
    queueEntry,
  }
}
