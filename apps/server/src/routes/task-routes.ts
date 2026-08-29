/**
 * [INPUT]: Authenticated task HTTP requests, task/workspace stores, and worker control-plane services.
 * [OUTPUT]: Creator-attributed task CRUD, execution, status, Git, interaction, and worktree HTTP routes.
 * [POS]: Task route composition root; delegates workspace-management and worker execution details to dedicated modules.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { withOpenCodeExecutionModel } from '@shared/opencode-execution-config'
import { advanceTask, buildAssistantReply, createExecutionLog, createTaskFromRequirement, deriveExecutionCenter, retryTask } from '@shared/task-orchestrator'
import { mergeWorkspaceSession, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { AppState, ChatMessage, Project, Task, TaskStatus, Workspace, WorkspacePreviewSummary } from '@shared/types'
import { resolveTaskWorktreePath } from '@shared/workspace-paths'
import { appendTaskConversationMessage, copyTaskConversationScope } from '../control-plane/conversation-service'
import { executorRegistry } from '../control-plane/executor-registry'
import { scheduleProjectVersionControlRefreshFromExecutor } from '../control-plane/executor-repo-service'
import { executorWsService } from '../control-plane/executor-ws-service'
import { recordTaskStatusChange } from '../control-plane/governance-service'
import { isTelegramEnabled, notifyTaskUpdate } from '../integrations/telegram'
import { getAgentTask } from '../repositories/agent'
import { createWorkRecord } from '../repositories/profile-store'
import { getUserById, isProjectAccessible } from '../repositories/auth'
import { computeAndPersistAgentHealthScore } from '../services/agent-health-score'
import { publishAgentEvent, publishAgentEventWithOutcome, resolveAgentDispatchReadiness } from '../services/agent-event-runtime'
import { resolveTaskAgentAssignment } from '../services/task-agent-assignment-service'
import { deliverHumanTaskAssignment, deliverTaskAssignment, resolveTaskAssignmentActor } from '../services/task-assignment-delivery-service'
import { recordTaskAssignmentHistory } from '../services/task-assignment-history-service'
import { createTaskRecord } from '../services/task-creation-service'
import {
  findQuickCreatedTask,
  resolveTaskQuickCreateOriginId,
  taskQuickCreateRequestSchema,
  TASK_QUICK_CREATE_EVENT_TYPE,
} from '../services/task-quick-create-service'
import { executeTaskOnWorkspace } from '../services/task-execution-service'
import { findBestProject, generateProjectContext, getProjectsWithContext } from '../repositories/project-selector'
import { listWorkspacePresenceByWorkspaceId, recordWorkspacePresence } from '../services/workspace-presence-service'
import { previewSessionService } from '../services/preview-session-service'
import { resolveAllPreviewSourceBindings } from '../services/preview-session-record'
import { isTaskChatExecutionActive, isTaskChatRuntimeBusy } from '../services/task-chat-dispatch/runtime-state'
import {
  deleteTaskWorkspaceBindings,
  listTaskRuns,
  loadState,
  saveProject,
  saveTaskAndWait,
  saveTaskWorkspaceBindingAndWait,
  saveWorkspaceSessionAndWait,
} from '../storage/app-state-store'
import { deleteWorkspaces, getDistributedTask, getWorkspace, listProjectBindings, saveWorkspace } from '../storage/distributed-task-store'
import { getAgentTaskRun } from '../storage/postgres/agent-task-run-store'
import { getAuthorizedProject, getAuthorizedTask, getScopedState, getUserIdFromHeader, jsonError, moveSchema, taskExecutionSchema, taskSchema, taskUpdateSchema, taskWorkspaceBindingSchema, withClusterState, withState } from './shared'
import { createApiTiming, timedJson } from './api-timing'
import { registerTaskInteractionRoutes } from './task-interaction-routes'
import {
  detachWorkspaceIdsFromTask,
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getScopedWorkspaceForProject,
  getWorkspaceSessionRecordForTaskContext,
  getWorkspaceBranchSnapshot,
  listActiveTaskWorkspaceBindings,
  listWorkspaceSessionsForTaskContext,
  listProjectWorkspacesForUser,
  rememberRecentBaseBranch,
  resolveUserCreatorIdentity,
  upsertTaskWorkspaceBindingInState,
  upsertWorkspaceSessionInState,
} from './task-route-support'
import { registerTaskGitRoutes } from './task-git-routes'
import { registerTaskWorktreeRoutes } from './task-worktree-routes'
import { registerWorkspaceManagementRoutes } from './workspace-management-routes'
import { getCommercialGate } from '../services/gate/commercial-gate'

const workspacePresenceSchema = z.object({
  state: z.enum(['viewing', 'working']).optional().default('viewing'),
  workspaceSessionId: z.string().trim().min(1).optional(),
})

const resolveWorkspaceSessionRuntimeTemplate = (params: {
  task: Task
  workspaceId: string
  workspaceSessionId?: string
  createNewSession: boolean
}) => {
  if (!params.createNewSession) {
    return getWorkspaceSessionRecordForTaskContext(params.task.id, params.workspaceId, params.workspaceSessionId)
  }

  if (params.workspaceSessionId) {
    return getWorkspaceSessionRecordForTaskContext(params.task.id, params.workspaceId, params.workspaceSessionId)
  }

  return listWorkspaceSessionsForTaskContext(params.task.id, params.workspaceId)[0] ?? null
}

export const registerTaskRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.post('/api/tasks/quick-create', requireAuth, async (c) => {
    const payload = taskQuickCreateRequestSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const billingAccess = await getCommercialGate().resolveUserBillingAccess(userId, 'create_task')
    if (!billingAccess.allowed) {
      return c.json({ message: billingAccess.message, billingAccess }, 402)
    }

    const readiness = resolveAgentDispatchReadiness(payload.creatorAgentId, userId)
    if (!readiness.ok) {
      return c.json({ message: readiness.message }, 409)
    }

    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const authorizedProjects = scopedState.projects.filter((project) => resolveTaskAgentAssignment({
      project,
      userId,
      assigneeAgentId: payload.creatorAgentId,
    }).ok)
    if (authorizedProjects.length === 0) {
      return c.json({ message: '当前 Agent 没有可用于创建任务的项目。' }, 403)
    }
    const fixedProjectId = payload.projectSelection.mode === 'fixed'
      ? payload.projectSelection.projectId
      : undefined
    if (fixedProjectId && !authorizedProjects.some((project) => project.id === fixedProjectId)) {
      return c.json({ message: '当前 Agent 无权在所选项目中创建任务。' }, 403)
    }

    const requestKey = payload.idempotencyKey || crypto.randomUUID()
    const [dispatch] = publishAgentEventWithOutcome({
      type: TASK_QUICK_CREATE_EVENT_TYPE,
      targetAgentId: payload.creatorAgentId,
      actingUserId: userId,
      actor: { type: 'user', id: userId },
      scope: payload.projectSelection.mode === 'fixed'
        ? { projectId: payload.projectSelection.projectId }
        : {},
      payload: {
        quickCreate: payload,
        authorizedProjects: authorizedProjects.map((project) => ({ id: project.id, name: project.name })),
      },
      conversationKey: `task-quick-create:${requestKey}`,
      idempotencyKey: `task-quick-create:${userId}:${requestKey}`,
    })
    if (!dispatch) {
      return c.json({ message: '未能创建 Agent 任务。' }, 409)
    }
    const run = getAgentTaskRun(dispatch.task.id)
    return c.json({
      creationRunId: dispatch.task.id,
      agentTaskRunId: run?.id,
      status: dispatch.task.status,
      dispatchStatus: dispatch.status,
    }, 202)
  })

  // 轻量可见任务摘要（供「分享到聊天」等会话选择器使用）
  app.get('/api/tasks/summaries', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) return jsonError(c, '无权访问。', 403)
    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const tasks = scopedState.tasks
      .slice()
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 50)
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        updatedAt: task.updatedAt,
      }))
    return c.json({ tasks })
  })

  app.get('/api/tasks/quick-create/:id', requireAuth, (c) => {
    const userId = getUserIdFromHeader(c)!
    const creationRunId = c.req.param('id')
    const eventTask = getAgentTask(creationRunId)
    if (!eventTask || eventTask.type !== TASK_QUICK_CREATE_EVENT_TYPE) {
      return c.json({ message: '创建任务运行不存在。' }, 404)
    }
    if (eventTask.payload.actingUserId !== userId) {
      return c.json({ message: '无权查看该创建任务运行。' }, 403)
    }

    const state = loadState()
    const originId = resolveTaskQuickCreateOriginId(eventTask)
    const task = findQuickCreatedTask(state.tasks, originId)
    const run = getAgentTaskRun(eventTask.id)
    return c.json({
      creationRunId,
      agentTaskRunId: run?.id,
      status: eventTask.status,
      failureCode: run?.failureCode,
      failureMessage: run?.failureMessage,
      task: task && isProjectAccessible(userId, task.projectId) ? task : undefined,
    })
  })

  app.post('/api/tasks', requireAuth, async (c) => {
    const payload = taskSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const billingAccess = await getCommercialGate().resolveUserBillingAccess(userId, 'create_task')
    if (!billingAccess.allowed) {
      return c.json({ message: billingAccess.message, billingAccess }, 402)
    }
    console.log('[create-task] 收到创建任务请求', { description: payload.description, projectId: payload.projectId, agentType: payload.agentType, agentManaged: payload.agentManaged, userId })
    const state = loadState()
    const scopedState = getScopedState(state, userId)

    let project = payload.projectId
      ? scopedState.projects.find((item) => item.id === payload.projectId)
      : undefined

    if (payload.projectId && !project) {
      return c.json({ message: '无权限访问项目。' }, 403)
    }

    if (!project) {
      const projectsWithContext = getProjectsWithContext(userId)
      const bestMatch = findBestProject(payload.description, projectsWithContext)

      if (bestMatch) {
        project = scopedState.projects.find((item) => item.id === bestMatch.id)
        console.log('[create-task] AI 自动选择项目', { projectName: project?.name, score: 'matched' })
      }
    }

    if (!project) {
      project = scopedState.projects[0]
    }

    if (!project) return c.json({ message: '当前账号下暂无可用项目，请先创建项目。' }, 400)

    const agentAssignment = resolveTaskAgentAssignment({
      project,
      userId,
      assigneeAgentId: payload.assigneeAgentId,
      assigneeAgentGroupId: payload.assigneeAgentGroupId,
    })
    if (!agentAssignment.ok) return c.json({ message: agentAssignment.message }, agentAssignment.status)
    const resolvedAssigneeAgentId = agentAssignment.agentId

    if (payload.parentTaskId) {
      const parentTask = scopedState.tasks.find((item) => item.id === payload.parentTaskId)
      if (!parentTask || parentTask.projectId !== project.id) {
        return c.json({ message: '父任务不存在，或不属于当前项目。' }, 400)
      }
    }

    const requirementType = payload.requirementType ?? 'task'
    const initialStatus: TaskStatus = requirementType === 'requirement'
      ? 'backlog'
      : payload.status ?? 'todo'
    if (resolvedAssigneeAgentId && initialStatus !== 'backlog' && payload.assignmentStartMode === 'now') {
      const readiness = resolveAgentDispatchReadiness(resolvedAssigneeAgentId, userId)
      if (!readiness.ok) {
        return c.json({ message: readiness.message }, 409)
      }
    }
    const baseBranchHint = payload.baseBranchHint?.trim() || payload.baseBranch?.trim() || project.recentBaseBranches?.[0] || project.defaultBranch || 'main'
    const initialChatMessage = payload.chatMessage?.trim() || ''
    const creator = resolveUserCreatorIdentity(userId)
    if (!creator) {
      return c.json({ message: '当前用户不存在，无法创建任务。' }, 401)
    }
    let task = createTaskRecord({
      project,
      config: state.config,
      actingUserId: userId,
      creator,
      description: payload.description,
      title: payload.title,
      parentTaskId: payload.parentTaskId,
      assigneeId: payload.assigneeId,
      assigneeAgentId: resolvedAssigneeAgentId,
      assigneeAgentGroupId: agentAssignment.agentGroupId,
      status: initialStatus,
      acceptanceCriteria: payload.acceptanceCriteria,
      priority: payload.priority,
      startedAt: payload.startedAt,
      dueAt: payload.dueAt,
      draftId: payload.draftId,
      draftSavedAt: payload.draftSavedAt,
      recommendedTitle: payload.recommendedTitle,
      baseBranchHint,
      requirementType,
      agentManaged: payload.agentManaged,
      agentType: payload.agentType,
      executionModel: payload.executionModel,
      opencodeConfig: payload.opencodeConfig,
    })
    task = {
      ...task,
      logs: initialChatMessage && initialChatMessage !== task.description
        ? [createExecutionLog('user', initialChatMessage), ...task.logs.filter((log) => log.role !== 'user')]
        : task.logs,
    }

    let nextProject = project
    const updateNextState = (nextTask: Task): AppState => {
      return {
        ...state,
        projects: state.projects.map((item) => (item.id === nextProject.id ? nextProject : item)),
        tasks: [nextTask, ...state.tasks],
        selectedTaskId: nextTask.id,
        selectedProjectId: nextProject.id,
        executionCenter: deriveExecutionCenter([nextTask, ...state.tasks], state.executionCenter),
      }
    }

    const projectContext = generateProjectContext(getProjectsWithContext(userId))
    const creationLabel = requirementType === 'requirement' ? '新需求已记录到 Backlog。' : '任务已创建。'
    const buildMessage = () => (nextProject.id === payload.projectId
      ? creationLabel
      : `AI 自动选择项目「${nextProject.name}」${requirementType === 'requirement' ? '记录需求' : '创建任务'}。\n\n可选项目：\n${projectContext}`)
    // 指派的判定、唤醒与留痕都在 deliverTaskAssignment 里；这里只负责调它。
    const deliverAssignment = async (assignedTask: Task) => {
      const actor = resolveTaskAssignmentActor({ userId })
      if (assignedTask.assigneeAgentId) {
        await deliverTaskAssignment({
          task: assignedTask,
          actor,
          startMode: payload.assignmentStartMode,
          actingUserId: userId,
          handoffPrompt: payload.handoffPrompt,
          assigneeAgentGroupTitle: agentAssignment.agentGroupTitle,
        })
        return assignedTask
      }
      if (!assignedTask.assigneeId) return assignedTask
      // 建任务时指派给人原先完全静默：既不投收件箱也不自动关注。
      const delivery = await deliverHumanTaskAssignment({
        task: assignedTask,
        assigneeUserId: assignedTask.assigneeId,
        actor,
      })
      return delivery.task
    }

    if (requirementType === 'requirement') {
      nextProject = rememberRecentBaseBranch(project, baseBranchHint)
      const requirementTask: Task = {
        ...task,
        executionMode: 'auto',
        gitIdentityMode: undefined,
        currentStep: '需求已录入，等待排期或转成可执行任务。',
        logs: [...task.logs, createExecutionLog('system', '已按新需求录入 Backlog，暂不派发给 worker。')],
      }

      // 先投递：自动关注会改 subscriberIds，落库要用投递后的 task。
      const deliveredRequirement = await deliverAssignment(requirementTask)
      await saveTaskAndWait(deliveredRequirement)
      return c.json(await withState(withClusterState(updateNextState(deliveredRequirement)), buildMessage(), userId))
    }
    task = {
      ...task,
      assigneeId: resolvedAssigneeAgentId ? undefined : payload.assigneeId,
      status: initialStatus,
      executionMode: 'auto',
      gitIdentityMode: undefined,
      baseBranch: undefined,
      currentStep: initialStatus === 'backlog'
        ? '任务已加入 Backlog，等待排期。'
        : '任务已创建，等待选择工作区并开始执行。',
      logs: [
        ...task.logs,
        createExecutionLog('system', initialStatus === 'backlog'
          ? '任务已加入 Backlog，暂不启动 Agent。'
          : '任务已创建。请先选择工作区、起始分支，再启动执行。'),
      ],
    }

    console.log('[create-task] 创建的任务', { taskId: task.id, status: task.status, agentType: task.agentType, agentManaged: task.agentManaged, projectName: project.name })
    const deliveredTask = await deliverAssignment(task)
    await saveTaskAndWait(deliveredTask)
    // 工作记录：任务派发（旁路，不阻塞创建）
    void createWorkRecord({
      actorType: task.assigneeAgentId ? 'agent' : 'user',
      actorId: task.assigneeAgentId ?? userId,
      recordType: 'task_dispatched',
      targetType: 'task',
      targetId: deliveredTask.id,
      title: deliveredTask.title,
      metadataJson: { projectId: deliveredTask.projectId, status: deliveredTask.status },
    }).catch(() => {})
    return c.json(await withState(withClusterState(updateNextState(deliveredTask)), buildMessage(), userId))
  })

  app.post('/api/tasks/:id/execute', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const billingAccess = await getCommercialGate().resolveUserBillingAccess(userId, 'execute_task')
    if (!billingAccess.allowed) {
      return c.json({ message: billingAccess.message, billingAccess }, 402)
    }
    const quotaAccess = await getCommercialGate().resolveFreeExecutionQuotaAccess(userId)
    if (!quotaAccess.allowed) {
      return c.json({ message: quotaAccess.message, billingQuotaAccess: quotaAccess }, 429)
    }
    const rawPayload = await c.req.json()
    const payload = taskExecutionSchema.parse(rawPayload)
    const workspaceSessionId = typeof rawPayload?.workspaceSessionId === 'string' ? rawPayload.workspaceSessionId.trim() || undefined : undefined
    const createNewSession = rawPayload?.createNewSession === true
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const result = await executeTaskOnWorkspace({
      state,
      userId,
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: payload.workspaceId,
      workspaceSessionId,
      createNewSession,
      delegatedPrompt: payload.delegatedPrompt,
      baseBranch: payload.baseBranch,
      returnMode: payload.returnMode,
      syncBackStrategy: payload.syncBackStrategy,
      gitIdentityMode: payload.gitIdentityMode,
    })
    if (!result.ok) {
      return c.json({ message: result.message }, result.status)
    }

    const baseState: AppState = {
      ...state,
      projects: state.projects.map((item) => (item.id === result.project.id ? result.project : item)),
      tasks: state.tasks.map((item) => (item.id === result.task.id ? result.task : item)),
      selectedTaskId: result.task.id,
      selectedProjectId: result.project.id,
      executionCenter: deriveExecutionCenter(state.tasks.map((item) => (item.id === result.task.id ? result.task : item)), state.executionCenter),
    }
    const nextState = upsertWorkspaceSessionInState(upsertTaskWorkspaceBindingInState(baseState, result.binding), result.session)

    return c.json(await withState(withClusterState(nextState), result.message, userId))
  })

  app.put('/api/tasks/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = taskUpdateSchema.parse(await c.req.json())
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const updatedAt = new Date().toISOString()
    const nextStartedAt = payload.startedAt !== undefined
      ? payload.startedAt ?? undefined
      : taskResult.task.startedAt
    const nextDueAt = payload.dueAt !== undefined
      ? payload.dueAt ?? undefined
      : taskResult.task.dueAt
    const nextTask: Task = {
      ...taskResult.task,
      title: payload.title?.trim() || taskResult.task.title,
      description: payload.description.trim(),
      acceptanceCriteria: payload.acceptanceCriteria?.trim() || undefined,
      priority: payload.priority,
      startedAt: nextStartedAt,
      dueAt: nextDueAt,
      updatedAt,
    }

    await saveTaskAndWait(nextTask)

    const tasks = state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item))
    return c.json(await withState({
      ...state,
      tasks,
      executionCenter: deriveExecutionCenter(tasks, state.executionCenter),
    }, '任务已更新。', userId))
  })

  app.post('/api/tasks/:id/workspaces', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const rawPayload = await c.req.json()
    const payload = taskWorkspaceBindingSchema.parse(rawPayload)
    const includeResources = rawPayload?.includeResources !== false
    const workspaceSessionId = typeof rawPayload?.workspaceSessionId === 'string' ? rawPayload.workspaceSessionId.trim() || undefined : undefined
    const createNewSession = rawPayload?.createNewSession === true
    const workingDirectoryMode = rawPayload?.workingDirectoryMode === 'original-dir' || rawPayload?.workingDirectoryMode === 'worktree'
      ? rawPayload.workingDirectoryMode
      : undefined
    const customAgentId = typeof rawPayload?.customAgentId === 'string' ? rawPayload.customAgentId.trim() || undefined : undefined
    const customAgentName = typeof rawPayload?.customAgentName === 'string' ? rawPayload.customAgentName.trim() || undefined : undefined
    const title = typeof rawPayload?.title === 'string' ? rawPayload.title.trim() || undefined : undefined
    const titleOrigin = rawPayload?.titleOrigin === 'manual' || rawPayload?.titleOrigin === 'ai'
      ? rawPayload.titleOrigin
      : undefined
    const agentInvocationMode = rawPayload?.agentInvocationMode === 'mention' || rawPayload?.agentInvocationMode === 'delegate'
      ? rawPayload.agentInvocationMode
      : undefined
    const sessionKind = rawPayload?.sessionKind === 'subagent' ? 'subagent' : rawPayload?.sessionKind === 'primary' ? 'primary' : undefined
    const sessionRole = rawPayload?.sessionRole === 'tester'
      || rawPayload?.sessionRole === 'doc-writer'
      || rawPayload?.sessionRole === 'reviewer'
      || rawPayload?.sessionRole === 'researcher'
      || rawPayload?.sessionRole === 'general'
      ? rawPayload.sessionRole
      : undefined
    const parentSessionId = typeof rawPayload?.parentSessionId === 'string' ? rawPayload.parentSessionId.trim() || undefined : undefined
    const rootSessionId = typeof rawPayload?.rootSessionId === 'string' ? rawPayload.rootSessionId.trim() || undefined : undefined
    const delegatedPrompt = typeof rawPayload?.delegatedPrompt === 'string' ? rawPayload.delegatedPrompt.trim() || undefined : undefined
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const workspace = getScopedWorkspaceForProject(userId, taskResult.project, payload.workspaceId)
    if (!workspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    const existingBinding = listActiveTaskWorkspaceBindings(taskResult.task.id).find((binding) => binding.workspaceId === payload.workspaceId)
    const bindingState = existingBinding
      ? { binding: existingBinding, task: taskResult.task, created: false }
      : ensureTaskWorkspaceBindingState({
          task: taskResult.task,
          workspaceId: payload.workspaceId,
          updatedAt: new Date().toISOString(),
        })
    const binding = bindingState.binding
    const runtimeTemplate = resolveWorkspaceSessionRuntimeTemplate({
      task: taskResult.task,
      workspaceId: payload.workspaceId,
      workspaceSessionId,
      createNewSession,
    })
    const requestedAgentType = payload.agentType ?? runtimeTemplate?.agentType ?? workspace.agentType
    const requestedExecutionModel = requestedAgentType === (runtimeTemplate?.agentType ?? workspace.agentType)
      ? runtimeTemplate?.executionModel
      : undefined
    const requestedExecutorNodeId = resolveWorkspaceSessionExecutorId(runtimeTemplate, workspace.executorNodeId)
    const sessionTask = {
      ...bindingState.task,
      agentType: requestedAgentType,
      executionModel: requestedExecutionModel,
      opencodeConfig: requestedAgentType === 'OpenCode'
        ? withOpenCodeExecutionModel(bindingState.task.opencodeConfig, requestedExecutionModel)
        : bindingState.task.opencodeConfig,
    }
    const ensuredSession = ensureWorkspaceSessionRecord({
      task: sessionTask,
      workspaceId: payload.workspaceId,
      executorNodeId: requestedExecutorNodeId,
      workspace,
      workspaceSessionId,
      createNewSession,
      title,
      titleOrigin,
      customAgentId,
      customAgentName,
      agentInvocationMode,
      sessionKind,
      sessionRole,
      parentSessionId,
      rootSessionId,
      delegatedPrompt,
      workingDirectoryMode,
    })
    const session = mergeWorkspaceSession(sessionTask, ensuredSession, {
      agentType: requestedAgentType,
      executionModel: requestedExecutionModel,
      executorNodeId: requestedExecutorNodeId,
      runtimeOwnerExecutorId: requestedExecutorNodeId,
      title,
      titleOrigin,
      customAgentId,
      customAgentName,
      agentInvocationMode,
      sessionKind,
      sessionRole,
      parentSessionId,
      rootSessionId,
      delegatedPrompt,
      agentSettings: runtimeTemplate?.agentSettings,
      enabledMcpServerIds: runtimeTemplate?.enabledMcpServerIds,
      opencodeConfig: requestedAgentType === 'OpenCode'
        ? withOpenCodeExecutionModel(runtimeTemplate?.opencodeConfig ?? ensuredSession.opencodeConfig, requestedExecutionModel)
        : runtimeTemplate?.opencodeConfig,
      gitIdentityMode: runtimeTemplate?.gitIdentityMode,
      mountedSkillNames: createNewSession
        ? ensuredSession.mountedSkillNames
        : (runtimeTemplate?.mountedSkillNames ?? ensuredSession.mountedSkillNames),
      mountedMcpServerNames: createNewSession
        ? ensuredSession.mountedMcpServerNames
        : (runtimeTemplate?.mountedMcpServerNames ?? ensuredSession.mountedMcpServerNames),
      baseBranch: payload.baseBranch?.trim() || runtimeTemplate?.baseBranch || ensuredSession.baseBranch,
      workingDirectoryMode: workingDirectoryMode ?? runtimeTemplate?.workingDirectoryMode ?? ensuredSession.workingDirectoryMode,
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    })
    const linkedWorkspaceIds = [
      payload.workspaceId,
    ]
    const alreadyBound = Boolean(existingBinding)
    const nextTask: Task = {
      ...bindingState.task,
      updatedAt: new Date().toISOString(),
      logs: alreadyBound
        ? bindingState.task.logs
        : [...bindingState.task.logs, createExecutionLog('system', `已关联工作区 ${workspace.name}。`, workspace.id)],
    }
    await saveTaskAndWait(nextTask)
    await saveTaskWorkspaceBindingAndWait(binding)
    await saveWorkspaceSessionAndWait(session)

    copyTaskConversationScope({
      task: nextTask,
      project: taskResult.project,
      targetWorkspaceId: payload.workspaceId,
      targetWorkspaceSessionId: session.id,
    })

    const nextState = upsertWorkspaceSessionInState(upsertTaskWorkspaceBindingInState({
      ...state,
      tasks: state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)),
    }, binding), session)

    const response = await withState(
      withClusterState(nextState),
      `已关联工作区 ${workspace.name}。`,
      userId,
      { includeResources },
    )
    return c.json({
      ...response,
      workspaceSessionId: session.id,
      workspaceSession: session,
    })
  })

  registerWorkspaceManagementRoutes(app, requireAuth)

  app.post('/api/tasks/:id/subtasks', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = taskSchema.parse({ ...(await c.req.json()), parentTaskId: c.req.param('id') })
    const state = loadState()
    const parentResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!parentResult.task || !parentResult.project) return jsonError(c, parentResult.message, parentResult.status)

    const project = parentResult.project
    const agentAssignment = resolveTaskAgentAssignment({
      project,
      userId,
      assigneeAgentId: payload.assigneeAgentId,
      assigneeAgentGroupId: payload.assigneeAgentGroupId,
    })
    if (!agentAssignment.ok) return c.json({ message: agentAssignment.message }, agentAssignment.status)
    const resolvedAssigneeAgentId = agentAssignment.agentId
    if (resolvedAssigneeAgentId && (payload.status ?? 'todo') !== 'backlog' && payload.assignmentStartMode === 'now') {
      const readiness = resolveAgentDispatchReadiness(resolvedAssigneeAgentId, userId)
      if (!readiness.ok) {
        return c.json({ message: readiness.message }, 409)
      }
    }
    let subtask = createTaskFromRequirement(
      project,
      payload.description,
      'medium',
      payload.title,
      payload.agentManaged,
      payload.agentType,
      payload.executionModel,
      undefined,
      state.config,
      payload.opencodeConfig,
    )
    const creator = resolveUserCreatorIdentity(userId)

    subtask = {
      ...subtask,
      createdBy: creator,
      parentTaskId: parentResult.task.id,
      assigneeId: resolvedAssigneeAgentId ? undefined : payload.assigneeId,
      assigneeAgentId: resolvedAssigneeAgentId,
      assigneeAgentGroupId: agentAssignment.agentGroupId,
      status: payload.status ?? 'todo',
      acceptanceCriteria: payload.acceptanceCriteria?.trim() || undefined,
      priority: payload.priority ?? parentResult.task.priority,
      startedAt: payload.startedAt,
      dueAt: payload.dueAt,
      currentStep: '子任务已创建，等待选择工作区并开始执行。',
      logs: [...parentResult.task.logs, createExecutionLog('system', `已从父任务 ${parentResult.task.title} 拆分为子任务。`)],
    }
    if (subtask.assigneeId || subtask.assigneeAgentId) {
      subtask = recordTaskAssignmentHistory({
        task: subtask,
        actorUserId: userId,
        assigneeId: subtask.assigneeId,
        assigneeAgentId: subtask.assigneeAgentId,
        at: subtask.createdAt,
      })
    }

    let nextSubtask = subtask
    // 指派判定与投递统一走 deliverTaskAssignment；指派给人原先在这里同样静默。
    const subtaskActor = resolveTaskAssignmentActor({ userId })
    if (nextSubtask.assigneeAgentId) {
      await deliverTaskAssignment({
        task: nextSubtask,
        actor: subtaskActor,
        startMode: payload.assignmentStartMode,
        actingUserId: userId,
        handoffPrompt: payload.handoffPrompt,
        assigneeAgentGroupTitle: agentAssignment.agentGroupTitle,
      })
    } else if (nextSubtask.assigneeId) {
      const delivery = await deliverHumanTaskAssignment({
        task: nextSubtask,
        assigneeUserId: nextSubtask.assigneeId,
        actor: subtaskActor,
      })
      nextSubtask = delivery.task
    }
    await saveTaskAndWait(nextSubtask)
    const inheritedBindings = listActiveTaskWorkspaceBindings(parentResult.task.id).flatMap((binding) => {
      const workspace = getScopedWorkspaceForProject(userId, project, binding.workspaceId)
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
      })
      return [{ binding: nextBinding, session: nextSession }]
    })
    // 继承的工作区绑定逐条落库（等待 commit 后再返回）。
    for (const item of inheritedBindings) {
      await saveTaskAndWait(nextSubtask)
      await saveWorkspaceSessionAndWait(item.session)
    }
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

    return c.json(await withState(withClusterState(nextState), `已创建子任务 ${nextSubtask.title}。`, userId))
  })

  app.get('/api/tasks/:id/runs', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    return c.json({ runs: listTaskRuns(taskResult.task.id) })
  })

  app.get('/api/projects/:id/workspaces', requireAuth, async (c) => {
    const projectId = c.req.param('id')
    const timingMeta = {
      route: '/api/projects/:id/workspaces',
      method: 'GET',
      projectId,
    }
    const timing = createApiTiming(c, timingMeta)
    const authState = timing.measureSync('auth/state', () => {
      const userId = getUserIdFromHeader(c)!
      const state = loadState()
      const projectResult = getAuthorizedProject(state, userId, projectId)

      return { projectResult, userId }
    })
    const { projectResult, userId } = authState
    if (!projectResult.project) {
      return timedJson(c, timing, 404, { message: '项目不存在或无权访问。' }, timingMeta)
    }

    timing.measureSync('repo probe', () => scheduleProjectVersionControlRefreshFromExecutor(userId, projectResult.project))
    const workspaces = timing.measureSync('workspace list build', () => listProjectWorkspacesForUser(userId, projectResult.project))
    return timedJson(c, timing, 200, { project: projectResult.project, workspaces }, timingMeta)
  })

  app.get('/api/workspaces/directory', requireAuth, async (c) => {
    const timingMeta = {
      route: '/api/workspaces/directory',
      method: 'GET',
    }
    const timing = createApiTiming(c, timingMeta)
    const authState = timing.measureSync('auth/state', () => {
      const userId = getUserIdFromHeader(c)!
      const state = loadState()
      const searchParams = new URL(c.req.url).searchParams
      const includeArchived = searchParams.get('includeArchived') === '1'
      const projectIds = [
        ...searchParams.getAll('projectId'),
        ...searchParams.getAll('projectIds').flatMap((value) => value.split(',')),
      ]
        .map((projectId) => projectId.trim())
        .filter(Boolean)
        .filter((projectId, index, values) => values.indexOf(projectId) === index)
        .slice(0, 100)
      const projects = projectIds
        .map((projectId) => getAuthorizedProject(state, userId, projectId).project)
        .filter((project): project is Project => Boolean(project))

      return { includeArchived, projectIds, projects, userId }
    })
    const { includeArchived, projectIds, projects, userId } = authState
    if (!projectIds.length) {
      return timedJson(c, timing, 200, {
        projects: [],
        workspacesByProject: {},
        archivedWorkspaceCountByProject: {},
        presenceByWorkspaceId: {},
        previewByWorkspaceId: {},
      }, {
        ...timingMeta,
        detail: {
          requested_project_count: 0,
          authorized_project_count: 0,
          workspace_count: 0,
        },
      })
    }

    timing.measureSync('repo probe', () => {
      for (const project of projects) {
        scheduleProjectVersionControlRefreshFromExecutor(userId, project)
      }
    })
    const workspaceDirectory = timing.measureSync('workspace list build', () => {
      const workspacesByProject: Record<string, Workspace[]> = {}
      const archivedWorkspaceCountByProject: Record<string, number> = {}

      for (const project of projects) {
        const projectWorkspaces = listProjectWorkspacesForUser(userId, project)
        archivedWorkspaceCountByProject[project.id] = projectWorkspaces.filter((workspace) => workspace.status === 'archived').length
        workspacesByProject[project.id] = includeArchived
          ? projectWorkspaces
          : projectWorkspaces.filter((workspace) => workspace.status !== 'archived')
      }

      return {
        archivedWorkspaceCountByProject,
        workspacesByProject,
      }
    })
    const { archivedWorkspaceCountByProject, workspacesByProject } = workspaceDirectory
    const workspaceIds = Object.values(workspacesByProject)
      .flat()
      .map((workspace) => workspace.id)
    const presenceByWorkspaceId = await timing.measure('DB query', () => {
      return listWorkspacePresenceByWorkspaceId(workspaceIds)
    })
    const previewByWorkspaceId = timing.measureSync('workspace list build', () => {
      const result: Record<string, WorkspacePreviewSummary> = {}
      const sessions = previewSessionService.listActiveSessionsForWorkspaces(workspaceIds)
      for (const [workspaceId, session] of sessions) {
        const bindings = resolveAllPreviewSourceBindings(session)
        const seenPreviewSourcePorts = new Set<string>()
        const sources = bindings
          .filter((binding) => binding.publicUrl)
          .map((binding, index) => ({
            publicUrl: binding.publicUrl,
            previewHost: binding.publicHost,
            appUrl: binding.appUrl,
            port: binding.port,
            note: binding.note?.trim() || undefined,
            primary: index === 0,
          }))
          .filter((source) => {
            const identity = source.port ? `port:${source.port}` : `url:${source.publicUrl}`
            if (seenPreviewSourcePorts.has(identity)) {
              return false
            }
            seenPreviewSourcePorts.add(identity)
            return true
          })
          .map((source, index) => ({
            ...source,
            primary: index === 0,
          }))
        if (!sources.length) {
          continue
        }
        result[workspaceId] = {
          previewId: session.id,
          remoteTransport: session.accessMode === 'public-proxy' ? 'gateway' : 'tunnel',
          sources,
        }
      }
      return result
    })

    return timedJson(c, timing, 200, {
      projects,
      workspacesByProject,
      archivedWorkspaceCountByProject,
      presenceByWorkspaceId,
      previewByWorkspaceId,
    }, {
      ...timingMeta,
      detail: {
        requested_project_count: projectIds.length,
        authorized_project_count: projects.length,
        workspace_count: Object.values(workspacesByProject).reduce((count, workspaces) => count + workspaces.length, 0),
      },
    })
  })

  app.post('/api/workspaces/:id/presence', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const parsed = workspacePresenceSchema.safeParse(body)
    if (!parsed.success) {
      return jsonError(c, '工作区停留状态无效。', 400)
    }

    const state = loadState()
    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      return jsonError(c, '工作区不存在。', 404)
    }

    const project = state.projects.find((item) => item.id === workspace.projectId)
    if (!project) {
      return jsonError(c, '项目不存在。', 404)
    }

    const visibleWorkspace = listProjectWorkspacesForUser(userId, project)
      .find((item) => item.id === workspaceId)
    if (!visibleWorkspace) {
      return jsonError(c, '无权访问该工作区。', 403)
    }

    const presence = await recordWorkspacePresence({
      workspaceId,
      userId,
      state: parsed.data.state,
      activeWorkspaceSessionId: parsed.data.workspaceSessionId,
    })

    return c.json({ presence })
  })

  app.get('/api/workspaces/:id/branches', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const workspaceId = c.req.param('id')
    const taskId = c.req.query('taskId')?.trim() || ''
    const workspaceSessionId = c.req.query('workspaceSessionId')?.trim() || ''
    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      return c.json({ message: '工作区不存在。' }, 404)
    }

    const scopedState = getScopedState(state, userId)
    const project = scopedState.projects.find((item) => item.id === workspace.projectId)
    if (!project) {
      return c.json({ message: '项目不存在或无权访问。' }, 404)
    }

    const scopedWorkspace = getScopedWorkspaceForProject(userId, project, workspaceId)
    if (!scopedWorkspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }

    if (workspaceSessionId && !taskId) {
      return c.json({ message: '缺少任务 ID，无法定位工作区会话。' }, 400)
    }
    const workspaceSessionTaskResult = taskId
      ? getAuthorizedTask(state, userId, taskId)
      : null
    if (taskId && (!workspaceSessionTaskResult?.task || workspaceSessionTaskResult.task.projectId !== project.id)) {
      return c.json({ message: '任务不存在或无权访问。' }, 404)
    }
    const workspaceSession = workspaceSessionId && workspaceSessionTaskResult?.task
      ? getWorkspaceSessionRecordForTaskContext(workspaceSessionTaskResult.task.id, workspaceId, workspaceSessionId)
      : null
    if (workspaceSessionId && !workspaceSession) {
      return c.json({ message: '工作区会话不存在或无权访问。' }, 404)
    }

    return c.json(await getWorkspaceBranchSnapshot(userId, project, scopedWorkspace, workspaceSession))
  })

  app.post('/api/tasks/:id/advance', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    console.log('[advance] 收到推进请求', { taskId })
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    const task = taskResult.task
    console.log('[advance] 当前任务状态', { taskId, status: task.status, agentType: task.agentType })

    if (task.executionMode !== 'local') {
      return c.json(await withState(withClusterState(state), '远程 worker 任务会自动调度执行，无需再通过 server 端手动推进。', userId))
    }

    return c.json({ message: 'server 端本地代码任务执行已停用，请改为创建 remote worker 任务。' }, 409)
  })

  app.post('/api/tasks/:id/retry', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    const nextTask = retryTask(taskResult.task)
    await saveTaskAndWait(nextTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    const nextState: AppState = {
      ...state,
      tasks,
      executionCenter: deriveExecutionCenter(tasks, state.executionCenter),
    }
    return c.json(await withState(nextState, '已请求任务重试。', userId))
  })

  app.post('/api/tasks/:id/move', requireAuth, async (c) => {
    const payload = moveSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    const timestamp = new Date().toISOString()

    const nextTask = {
      ...taskResult.task,
      status: payload.status as TaskStatus,
      startedAt: payload.status === 'in_progress'
        ? (taskResult.task.startedAt ?? timestamp)
        : taskResult.task.startedAt,
      updatedAt: timestamp,
      history: [...taskResult.task.history, { id: crypto.randomUUID(), label: payload.status, at: timestamp }],
    }

    if (
      taskResult.task.status === 'backlog'
      && nextTask.status !== 'backlog'
      && nextTask.assigneeAgentId
    ) {
      const readiness = resolveAgentDispatchReadiness(nextTask.assigneeAgentId, userId)
      if (!readiness.ok) {
        return c.json({ message: readiness.message }, 409)
      }
    }

    await saveTaskAndWait(nextTask)

    // 画像联动：任务完成 → 自动写工作记录 + 更新 Agent 健康评分（旁路，不阻塞主流程）
    if (nextTask.status === 'done' && taskResult.task.status !== 'done') {
      const actorType = nextTask.assigneeAgentId ? 'agent' : 'user'
      const actorId = nextTask.assigneeAgentId ?? userId
      void createWorkRecord({
        actorType,
        actorId,
        recordType: 'task_completed',
        targetType: 'task',
        targetId: nextTask.id,
        title: nextTask.title,
        metadataJson: { projectId: nextTask.projectId, previousStatus: taskResult.task.status },
      }).catch(() => {})
      if (actorType === 'agent') {
        void computeAndPersistAgentHealthScore(actorId).catch(() => {})
      }
    }

    if (
      taskResult.task.status === 'backlog'
      && nextTask.status !== 'backlog'
      && nextTask.assigneeAgentId
    ) {
      publishAgentEvent({
        type: 'task.status.changed',
        targetAgentId: nextTask.assigneeAgentId,
        actingUserId: userId,
        actor: { type: 'user', id: userId },
        scope: { projectId: nextTask.projectId, taskId: nextTask.id },
        payload: {
          previousStatus: taskResult.task.status,
          status: nextTask.status,
          title: nextTask.title,
          assigneeAgentGroupId: nextTask.assigneeAgentGroupId,
        },
        conversationKey: `task:${nextTask.id}`,
        idempotencyKey: `task-status:${nextTask.id}:${taskResult.task.status}:${nextTask.status}:${timestamp}`,
      })
    }

    // 调度大脑（feature P0-2）：状态变更上报已收敛到 recordTaskStatusChange（下方调用），此处移除直接上报避免重复

    if (taskResult.project) {
      const { conversation } = appendTaskConversationMessage({
        task: nextTask,
        project: taskResult.project,
        role: 'system',
        content: `任务状态已从 ${taskResult.task.status} 变更为 ${payload.status}。`,
      })

      recordTaskStatusChange({
        task: nextTask,
        project: taskResult.project,
        fromStatus: taskResult.task.status,
        toStatus: payload.status as TaskStatus,
        actorUserId: userId,
        conversationId: conversation.id,
      })
    }

    if (isTelegramEnabled()) {
      notifyTaskUpdate(nextTask, `任务状态已变更为: ${payload.status}`)
    }

    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    const nextState: AppState = {
      ...state,
      tasks,
      executionCenter: deriveExecutionCenter(tasks, state.executionCenter),
    }
    return c.json(await withState(nextState, '任务状态已变更。', userId))
  })

  registerTaskGitRoutes(app, requireAuth)
  registerTaskInteractionRoutes(app, requireAuth)
  registerTaskWorktreeRoutes(app, requireAuth)
}
