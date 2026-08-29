// [INPUT]: Authenticated server state and route-level domain identifiers.
// [OUTPUT]: Shared authorization, validation, state projection, and route support helpers.
// [POS]: Server route boundary; task authorization resolves persisted tasks and session-only runtime adapters.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Context } from 'hono'
import { z } from 'zod'
import { attachTaskResultDelivery } from '@shared/distributed-task-result'
import { DEFAULT_AGENT_SETTINGS, DEFAULT_WORKER_UPDATE_SETTINGS, mergeAgentRuntimeSettings } from '@shared/agent-config'
import { DEFAULT_WORKSPACE_OPEN_SETTINGS, WORKSPACE_OPEN_TARGETS } from '@shared/workspace-open-command'
import { normalizeMainChatSessionState, summarizeMainChatSessionsInState } from '@shared/main-chat-session'
import { normalizeTaskChatAttachments, TASK_COMMENT_ATTACHMENT_LIMIT } from '@shared/task-chat-attachment'
import { TASK_COMMENT_REACTION_EMOJIS } from '@shared/task-comment-reaction'
import { normalizeOpenCodeExecutionConfig } from '@shared/opencode-execution-config'
import { toProjectCommandPresetFromEnvironment } from '@shared/project-environment-template'
import { sortProjectsByDisplayOrder } from '@shared/project-workspace-order'
import {
  TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from '@shared/task-input-limits'
import { deriveExecutionCenter } from '@shared/task-orchestrator'
import { applyWorkspaceCodeStateToSession, resolveWorkspaceAutoCommitEnabled } from '@shared/task-workspace'
import { buildWorkspaceSessionRuntimeTask } from '@shared/workspace-session-runtime-task'
import { resolveWorkspaceShareAccess } from '../storage/postgres/workspace-share-store'
import type { AppResources, AppState, DistributedTask, Project, ProjectBinding, ProjectCommandPreset, Task } from '@shared/types'
import { clusterConfig } from '../cluster/config'
import { syncDistributedTaskEvent, syncDistributedTaskResult } from '../cluster/task-sync'
import { resolveUserProjectGitIdentity, sanitizeTaskGitIdentity } from '../control-plane/task-git-identity'
import { getTeamMemberRole, isProjectAccessible, parseTokenUserId, parseTokenUserIdAsync } from '../repositories/auth'
import { getWorkspaceMemberRole } from '../repositories/workspace'
import { filterVisibleMcpServers } from '../services/primary-agent-mcp'
import { broadcastState } from '../services/state-stream'
import { resolveModelProfileRuntime } from '../services/model-profile-service'
import { resolveTaskRuntimeCapabilitySnapshot } from '../services/custom-agent-runtime'
import { listWorkspaces } from '../storage/distributed-task-store'
import {
  SERVER_AGENT_TYPES,
  getServerAgentDefaultModel,
  getServerAgentSettings,
} from '../services/server-agent'
import { syncBoardStateToLegacyStorage } from '../storage/board-sync'
import { updateDistributedTask } from '../storage/distributed-task-store'
import { getStateResources, hydrateClusterState, saveStateMeta } from '../storage/app-state-store'

const serverAgentTypeSchema = z.enum(SERVER_AGENT_TYPES)
const openCodeExecutionConfigSchema = z.object({
  model: z.string().trim().optional(),
  agent: z.string().trim().optional(),
  variant: z.string().trim().optional(),
  permissionPolicy: z.string().trim().optional(),
  env: z.record(z.string()).optional(),
  provider: z.record(z.unknown()).optional(),
}).transform((value) => normalizeOpenCodeExecutionConfig(value))

export const sanitizeDistributedTaskForClient = (task: DistributedTask): DistributedTask => ({
  ...task,
  runtimeEnv: undefined,
})

export const getUserIdFromHeader = (c: Context): string | null => {
  const authenticatedUserId = c.get('userId') as string | undefined
  if (authenticatedUserId) {
    return authenticatedUserId
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  return parseTokenUserId(authHeader.slice(7))
}

export const getUserIdFromHeaderAsync = async (c: Context): Promise<string | null> => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  return parseTokenUserIdAsync(authHeader.slice(7))
}

export const getRawToken = (c: Context): string | null => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  return authHeader.slice(7)
}

const resolveDefaultDistributedTaskPublishPolicy = (project: Project): DistributedTask['publishPolicy'] => {
  const versionControl = project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')
  return versionControl === 'git-remote' ? 'pull-request' : 'none'
}

export const ensureClusterToken = (c: Context) => {
  if (!clusterConfig.sharedToken) {
    return true
  }

  const token = c.req.header('x-cluster-token') || c.req.query('token')
  return token === clusterConfig.sharedToken
}

export const getScopedState = (
  state: AppState,
  userId: string,
  options?: {
    mainChat?: 'full' | 'summary'
    scope?: 'default' | 'workspaces' | 'kanban'
    focus?: {
      taskId?: string
      workspaceId?: string
      workspaceSessionId?: string
    }
  },
): AppState => {
  const projects = sortProjectsByDisplayOrder(
    state.projects.filter((project) => (
      isProjectAccessible(userId, project.id)
      // 共享协作人兜底：项目所属协作工作区有生效授权时，项目及其工作区对用户可见
      || (project.workspaceId?.trim() ? resolveWorkspaceShareAccess(userId, project.workspaceId).ok : false)
    )),
  )
  const projectIds = new Set(projects.map((project) => project.id))
  // playground 虚拟项目通过 isProjectAccessible 放行进入 scopedState（详情页/任务关联需要真实 project），
  // 是否在 UI 展示由 web 侧过滤（项目列表/选择器显式排除）
  const visibleProjectIds = projectIds
  const tasks = state.tasks.filter((task) => visibleProjectIds.has(task.projectId))
  const projectBindings = state.projectBindings.filter((binding) => projectIds.has(binding.projectId))
  const distributedTasks = state.distributedTasks
    .filter((task) => visibleProjectIds.has(task.projectId))
    .map(sanitizeDistributedTaskForClient)
  const workspaceIds = new Set(
    listWorkspaces()
      .filter((workspace) => visibleProjectIds.has(workspace.projectId))
      .map((workspace) => workspace.id),
  )
  const taskIds = new Set(tasks.map((task) => task.id))
  const taskWorkspaceBindings = state.taskWorkspaceBindings.filter((binding) => taskIds.has(binding.taskId))
  // 共享协作人按授权范围过滤会话：会话级授权只暴露授权会话（避免元数据泄漏），
  // 项目成员/整个工作区/所有会话授权保持全部可见。
  const workspaceByProjectId = new Map<string, Set<string>>()
  const collabWorkspaceByProjectId = new Map<string, string>()
  for (const project of state.projects) {
    if (project.workspaceId?.trim()) {
      collabWorkspaceByProjectId.set(project.id, project.workspaceId)
    }
  }
  for (const workspace of listWorkspaces()) {
    const existing = workspaceByProjectId.get(workspace.projectId)
    if (existing) {
      existing.add(workspace.id)
    } else {
      workspaceByProjectId.set(workspace.projectId, new Set([workspace.id]))
    }
  }
  const sessionScopedSharedIds = new Set<string>()
  const sharedOnlyWorkspaceIds = new Set<string>()
  for (const project of state.projects) {
    const collabWorkspaceId = project.workspaceId?.trim()
    if (!collabWorkspaceId || isProjectAccessible(userId, project.id)) {
      continue
    }
    const projectWorkspaceIds = workspaceByProjectId.get(project.id)
    if (!projectWorkspaceIds) {
      continue
    }
    const workspaceAccess = resolveWorkspaceShareAccess(userId, collabWorkspaceId)
    if (workspaceAccess.ok) {
      // 整个工作区/所有会话授权：该工作区全部会话可见
      continue
    }
    for (const session of state.workspaceSessions) {
      if (!projectWorkspaceIds.has(session.workspaceId)) {
        continue
      }
      const sessionAccess = resolveWorkspaceShareAccess(userId, collabWorkspaceId, session.id)
      if (sessionAccess.ok) {
        sessionScopedSharedIds.add(session.id)
        sharedOnlyWorkspaceIds.add(session.workspaceId)
      }
    }
  }
  const workspaceSessions = state.workspaceSessions.filter((session) => {
    if (!workspaceIds.has(session.workspaceId)) {
      return false
    }
    if (sessionScopedSharedIds.has(session.id)) {
      return true
    }
    if (sharedOnlyWorkspaceIds.has(session.workspaceId)) {
      return false
    }
    return true
  })
  const selectedProjectId = projectIds.has(state.selectedProjectId) ? state.selectedProjectId : projects[0]?.id ?? ''
  const selectedTaskId = taskIds.has(state.selectedTaskId) ? state.selectedTaskId : tasks[0]?.id ?? ''

  const scopedState = {
    ...state,
    config: {
      ...state.config,
      mcpServers: filterVisibleMcpServers(state.config.mcpServers, userId),
    },
    projects,
    tasks,
    projectBindings,
    distributedTasks,
    taskWorkspaceBindings,
    workspaceSessions,
    mainChatSessions: state.mainChatSessions,
    selectedMainChatSessionId: state.selectedMainChatSessionId,
    selectedProjectId,
    selectedTaskId,
    executionCenter: deriveExecutionCenter(tasks, state.executionCenter),
  }

  const summarizedState = options?.mainChat === 'summary'
    ? summarizeMainChatSessionsInState(scopedState, { previewMessages: 0 })
    : scopedState

  if (options?.scope === 'workspaces') {
    return summarizeWorkspacesPageState(summarizedState, options.focus)
  }

  if (options?.scope === 'kanban') {
    return summarizeKanbanPageState(summarizedState)
  }

  return summarizedState
}

const truncateStateText = (value: string | undefined, maxLength: number) => {
  if (!value || value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trimEnd()}...`
}

const summarizeTaskResultDeliveryForWorkspaces = (
  delivery: NonNullable<Task['result']>['delivery'],
): NonNullable<Task['result']>['delivery'] => {
  if (!delivery) {
    return undefined
  }

  return {
    mode: delivery.mode,
    branch: delivery.branch
      ? {
          branchName: delivery.branch.branchName,
          repoUrl: '',
          baseBranch: delivery.branch.baseBranch,
          pushed: delivery.branch.pushed,
          suggestedNextStep: '',
          reason: truncateStateText(delivery.branch.reason, 240),
        }
      : undefined,
    pullRequest: delivery.pullRequest
      ? {
          ready: delivery.pullRequest.ready,
          remoteReady: delivery.pullRequest.remoteReady,
          repoUrl: '',
          title: '',
          description: '',
          baseBranch: delivery.pullRequest.baseBranch,
          compareBranch: delivery.pullRequest.compareBranch,
          number: delivery.pullRequest.number,
          url: delivery.pullRequest.url,
          state: delivery.pullRequest.state,
          reason: truncateStateText(delivery.pullRequest.reason, 240),
        }
      : undefined,
    syncFailureReason: truncateStateText(delivery.syncFailureReason, 240),
  }
}

const summarizeTaskResultForWorkspaces = (result: Task['result'], detailLevel: 'list' | 'detail' = 'detail'): Task['result'] => {
  if (!result) {
    return undefined
  }

  return {
    ...result,
    summary: truncateStateText(result.summary, detailLevel === 'detail' ? 600 : 160) ?? '',
    output: undefined,
    filesChanged: [],
    commitShas: undefined,
    delivery: summarizeTaskResultDeliveryForWorkspaces(result.delivery),
    usage: result.usage
      ? {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
          totalTokens: result.usage.totalTokens,
        }
      : undefined,
  }
}

const summarizeTaskForWorkspaces = (task: Task): Task => ({
  ...task,
  acceptanceCriteria: undefined,
  draftId: undefined,
  draftSavedAt: undefined,
  recommendedTitle: undefined,
  description: truncateStateText(task.description, 1200) ?? '',
  opencodeConfig: undefined,
  result: summarizeTaskResultForWorkspaces(task.result),
  comments: [],
  logs: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  executionHistory: task.executionHistory.slice(-3).map((run) => ({
    ...run,
    summary: truncateStateText(run.summary, 400),
    result: summarizeTaskResultForWorkspaces(run.result),
  })),
  toolCalls: task.toolCalls.slice(-5).map((tool) => ({
    ...tool,
    args: truncateStateText(tool.args, 400) ?? '',
    result: truncateStateText(tool.result, 400),
  })),
})

const summarizeTaskForWorkspacesList = (task: Task): Task => ({
  ...task,
  acceptanceCriteria: undefined,
  draftId: undefined,
  draftSavedAt: undefined,
  recommendedTitle: undefined,
  description: truncateStateText(task.description, 240) ?? '',
  opencodeConfig: undefined,
  result: summarizeTaskResultForWorkspaces(task.result, 'list'),
  comments: [],
  logs: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  executionHistory: [],
  toolCalls: [],
})

const summarizeDistributedTaskForWorkspaces = (task: DistributedTask): DistributedTask => ({
  ...task,
  agentSettings: undefined,
  mcpServers: undefined,
  runtimeSkillPackages: undefined,
  opencodeConfig: undefined,
  gitIdentity: undefined,
  description: truncateStateText(task.description, 800) ?? '',
  result: summarizeTaskResultForWorkspaces(task.result),
})

const summarizeWorkspaceSessionForWorkspaces = (
  session: AppState['workspaceSessions'][number],
): AppState['workspaceSessions'][number] => ({
  ...session,
  runtimeContinuations: undefined,
  handoffSnapshot: undefined,
  delegatedPrompt: truncateStateText(session.delegatedPrompt, 500),
  historyProjection: session.historyProjection
    ? {
        ...session.historyProjection,
        latestUserMessagePreview: truncateStateText(session.historyProjection.latestUserMessagePreview, 240),
        latestAssistantMessagePreview: truncateStateText(session.historyProjection.latestAssistantMessagePreview, 240),
        latestPreviewText: truncateStateText(session.historyProjection.latestPreviewText, 240),
      }
    : undefined,
})

const summarizeWorkspaceSessionHistoryProjectionForWorkspacesList = (
  projection: AppState['workspaceSessions'][number]['historyProjection'],
): AppState['workspaceSessions'][number]['historyProjection'] => {
  if (!projection) {
    return undefined
  }

  const {
    sessionId: _sessionId,
    taskId: _taskId,
    workspaceId: _workspaceId,
    latestTurnId: _latestTurnId,
    latestUserMessageId: _latestUserMessageId,
    latestAssistantMessageId: _latestAssistantMessageId,
    lastPersistedTurnStartedAt: _lastPersistedTurnStartedAt,
    lastPersistedTurnFinishedAt: _lastPersistedTurnFinishedAt,
    ...listProjection
  } = projection

  return {
    ...listProjection,
    latestUserMessagePreview: truncateStateText(projection.latestUserMessagePreview, 120),
    latestAssistantMessagePreview: truncateStateText(projection.latestAssistantMessagePreview, 120),
    latestPreviewText: truncateStateText(projection.latestPreviewText, 120),
  } as AppState['workspaceSessions'][number]['historyProjection']
}

const summarizeWorkspaceSessionForWorkspacesList = (
  session: AppState['workspaceSessions'][number],
  workspaceById?: Map<string, ReturnType<typeof listWorkspaces>[number]>,
): AppState['workspaceSessions'][number] => {
  const workspace = workspaceById?.get(session.workspaceId)
  const sessionView = workspace ? applyWorkspaceCodeStateToSession(session, workspace) : session

  return {
    id: session.id,
    workspaceId: session.workspaceId,
    displayOrder: session.displayOrder,
    pinnedAt: session.pinnedAt,
    title: session.title,
    titleOrigin: session.titleOrigin,
    status: session.status,
    sessionKind: session.sessionKind,
    sessionRole: session.sessionRole,
    sessionOrigin: session.sessionOrigin,
    forkMode: session.forkMode,
    forkedFromSessionId: session.forkedFromSessionId,
    forkRevision: session.forkRevision,
    executorNodeId: session.executorNodeId,
    agentType: session.agentType,
    agentSettings: undefined,
    opencodeConfig: undefined,
    worktreeId: sessionView.worktreeId,
    branchName: sessionView.branchName,
    worktreeStatus: sessionView.worktreeStatus,
    workingDirectoryMode: sessionView.workingDirectoryMode,
    needsHumanConfirm: session.needsHumanConfirm,
    agentRunningStatus: session.agentRunningStatus,
    runtimeStatus: session.runtimeStatus,
    runtimeStartedAt: session.runtimeStartedAt,
    lastRuntimeEventAt: session.lastRuntimeEventAt,
    runtimeSummary: undefined,
    deliverySummary: session.deliverySummary,
    runtimeSequence: session.runtimeSequence,
    currentStep: truncateStateText(session.currentStep, 120) ?? '',
    lastActiveAt: session.lastActiveAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    runtimeContinuations: undefined,
    handoffSnapshot: undefined,
    delegatedPrompt: undefined,
    historyProjection: summarizeWorkspaceSessionHistoryProjectionForWorkspacesList(session.historyProjection),
  }
}

const summarizeConfigForWorkspaces = (config: AppState['config']): AppState['config'] => ({
  ...config,
  opencodeConfigContent: '',
  codexConfigContent: '',
  codexAuthContent: '',
  claudeCodeConfigContent: '',
})

const summarizeKanbanPageState = (state: AppState): AppState => ({
  ...state,
  nodes: [],
  mainChatSessions: [],
  selectedMainChatSessionId: '',
})

const summarizeWorkspacesPageState = (
  state: AppState,
  focus?: {
    taskId?: string
    workspaceId?: string
    workspaceSessionId?: string
  },
): AppState => {
  const focusedTaskId = focus?.taskId?.trim() || ''
  const focusedWorkspaceId = focus?.workspaceId?.trim() || ''
  const focusedWorkspaceSessionId = focus?.workspaceSessionId?.trim() || ''
  const workspaceById = new Map(listWorkspaces().map((workspace) => [workspace.id, workspace] as const))

  return {
    ...state,
    config: summarizeConfigForWorkspaces(state.config),
    nodes: [],
    mainChatSessions: [],
    selectedMainChatSessionId: '',
    tasks: state.tasks.map((task) => (
      focusedTaskId && task.id === focusedTaskId
        ? summarizeTaskForWorkspaces(task)
        : summarizeTaskForWorkspacesList(task)
    )),
    distributedTasks: state.distributedTasks.map(summarizeDistributedTaskForWorkspaces),
    workspaceSessions: state.workspaceSessions.map((session) => (
      (focusedWorkspaceSessionId && session.id === focusedWorkspaceSessionId)
      || (focusedWorkspaceId && session.workspaceId === focusedWorkspaceId)
        ? summarizeWorkspaceSessionForWorkspaces(session)
        : summarizeWorkspaceSessionForWorkspacesList(session, workspaceById)
    )),
  }
}

export const getAuthorizedProject = (state: AppState, userId: string, projectId: string) => {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) {
    return { project: null, status: 404 as const, message: '项目不存在。' }
  }

  if (!isProjectAccessible(userId, projectId)) {
    return { project: null, status: 403 as const, message: '无权限访问项目。' }
  }

  return { project, status: 200 as const, message: '' }
}

export const getAuthorizedTask = (state: AppState, userId: string, taskId: string) => {
  const workspaceSession = state.workspaceSessions.find((session) => session.id === taskId && session.status !== 'archived')
  if (workspaceSession) {
    const workspace = listWorkspaces().find((item) => item.id === workspaceSession.workspaceId)
    const project = workspace ? state.projects.find((item) => item.id === workspace.projectId) : null
    if (!workspace || !project) {
      return { task: null, project: null, status: 404 as const, message: '工作区会话不存在。' }
    }

    const projectResult = getAuthorizedProject(state, userId, project.id)
    if (!projectResult.project) {
      return { task: null, project: null, status: projectResult.status, message: projectResult.message }
    }

    return {
      task: {
        ...buildWorkspaceSessionRuntimeTask({
          project,
          sessionId: workspaceSession.id,
          title: workspaceSession.title,
          agentType: workspaceSession.agentType ?? workspace.agentType,
          executionModel: workspaceSession.executionModel,
          baseBranch: workspaceSession.baseBranch || workspace.suggestedBaseBranch || project.defaultBranch,
          currentStep: workspaceSession.currentStep,
          createdAt: workspaceSession.createdAt,
          updatedAt: workspaceSession.updatedAt,
        }),
        agentRunningStatus: workspaceSession.agentRunningStatus,
        needsHumanConfirm: workspaceSession.needsHumanConfirm,
      },
      project: projectResult.project,
      status: 200 as const,
      message: '',
    }
  }

  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) {
    return { task: null, project: null, status: 404 as const, message: '任务不存在。' }
  }

  const projectResult = getAuthorizedProject(state, userId, task.projectId)
  if (!projectResult.project) {
    return { task: null, project: null, status: projectResult.status, message: projectResult.message }
  }

  return { task, project: projectResult.project, status: 200 as const, message: '' }
}

export const ensureTeamMember = (teamId: string, userId: string) => getTeamMemberRole(teamId, userId) !== null

export const ensureWorkspaceMember = async (workspaceId: string, userId: string) => {
  return (await getWorkspaceMemberRole(workspaceId, userId)) !== null
}

export const ensureWorkspaceAdmin = async (workspaceId: string, userId: string) => {
  const role = await getWorkspaceMemberRole(workspaceId, userId)
  return role === 'owner' || role === 'admin'
}

export const jsonError = (c: Context, message: string, status: 400 | 401 | 403 | 404 | 409 | 500 | 502) => c.json({ message }, status)

export const projectEnvironmentTemplateSchema = z.object({
  installCommand: z.string().trim().optional(),
  buildCommand: z.string().trim().optional(),
  testCommand: z.string().trim().optional(),
  lintCommand: z.string().trim().optional(),
  branchNamePattern: z.string().trim().optional(),
  startCommandTemplate: z.string().trim().optional(),
  stopCommandTemplate: z.string().trim().optional(),
  nukeCommandTemplate: z.string().trim().optional(),
  appPort: z.string().trim().optional(),
  healthPath: z.string().trim().optional(),
  logsCommandTemplate: z.string().trim().optional(),
  ports: z.array(z.object({
    id: z.string().trim().min(1),
    domain: z.string().trim().optional(),
    port: z.string().trim().min(1),
    note: z.string().trim().optional(),
    type: z.enum(['generated', 'custom']).optional(),
  })).optional(),
  previewDomainBindings: z.array(z.object({
    id: z.string().trim().min(1),
    domain: z.string().trim().optional(),
    port: z.number().int().min(1).max(65535),
    note: z.string().trim().optional(),
    type: z.enum(['generated', 'custom']).optional(),
  })).optional(),
  configPath: z.string().trim().optional(),
  source: z.enum(['manual', 'vibemux-yml']),
  imported: z.object({
    installCommand: z.string().trim().optional(),
    buildCommand: z.string().trim().optional(),
    testCommand: z.string().trim().optional(),
    lintCommand: z.string().trim().optional(),
    branchNamePattern: z.string().trim().optional(),
    startCommandTemplate: z.string().trim().optional(),
    stopCommandTemplate: z.string().trim().optional(),
    nukeCommandTemplate: z.string().trim().optional(),
    appPort: z.string().trim().optional(),
    healthPath: z.string().trim().optional(),
    logsCommandTemplate: z.string().trim().optional(),
    ports: z.array(z.object({
      id: z.string().trim().min(1),
      domain: z.string().trim().optional(),
      port: z.string().trim().min(1),
      note: z.string().trim().optional(),
      type: z.enum(['generated', 'custom']).optional(),
    })).optional(),
    previewDomainBindings: z.array(z.object({
      id: z.string().trim().min(1),
      domain: z.string().trim().optional(),
      port: z.number().int().min(1).max(65535),
      note: z.string().trim().optional(),
      type: z.enum(['generated', 'custom']).optional(),
    })).optional(),
    configPath: z.string().trim().optional(),
  }).optional(),
})

export const projectSchema = z.object({
  name: z.string().min(1),
  gitUrl: z.string(),
  color: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  visibility: z.enum(['private', 'workspace']).optional(),
  rootPath: z.string().trim().optional(),
  versionControl: z.enum(['none', 'git-local', 'git-remote']).optional(),
  defaultBranch: z.string().trim().optional(),
  environmentTemplate: projectEnvironmentTemplateSchema.nullable().optional(),
  recentBaseBranches: z.array(z.string().trim().min(1)).optional(),
})

export const cloneSchema = z.object({
  name: z.string().min(1),
  gitUrl: z.string().min(1),
  color: z.string().trim().optional(),
  pathHint: z.string().trim().optional(),
})

export const taskSchema = z.object({
  projectId: z.string().min(1),
  parentTaskId: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).max(TASK_DESCRIPTION_MAX_LENGTH),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled']).optional(),
  title: z.string().trim().max(TASK_TITLE_MAX_LENGTH).optional(),
  startedAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  acceptanceCriteria: z.string().trim().max(TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH).optional(),
  draftId: z.string().trim().optional(),
  draftSavedAt: z.string().trim().optional(),
  recommendedTitle: z.string().trim().optional(),
  baseBranchHint: z.string().trim().optional(),
  requirementType: z.enum(['task', 'requirement']).optional(),
  assigneeId: z.string().optional(),
  assigneeAgentId: z.string().trim().optional(),
  assigneeAgentGroupId: z.string().trim().optional(),
  assignmentStartMode: z.enum(['now', 'parked']).optional().default('now'),
  handoffPrompt: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  chatMessage: z.string().optional(),
  agentManaged: z.enum(['ai', 'none']).optional(),
  agentType: serverAgentTypeSchema.optional(),
  executionModel: z.string().min(1).optional(),
  opencodeConfig: openCodeExecutionConfigSchema.optional(),
  executionMode: z.enum(['local', 'remote', 'auto']).optional(),
  preferredExecutorId: z.string().trim().min(1).optional(),
  returnMode: z.enum(['summary', 'branch', 'commit']).optional(),
  syncBackStrategy: z.enum(['none', 'pull-branch']).optional(),
  gitIdentityMode: z.enum(['personal']).optional(),
  baseBranch: z.string().trim().min(1).optional(),
}).refine((value) => [value.assigneeId, value.assigneeAgentId, value.assigneeAgentGroupId].filter(Boolean).length <= 1, {
  message: '人类、Agent 与 Squad 负责人只能设置一个。',
})

export const taskWorkspaceBindingSchema = z.object({
  workspaceId: z.string().trim().min(1),
  baseBranch: z.string().trim().min(1).optional(),
  agentType: serverAgentTypeSchema.optional(),
})

const taskCommentMentionTargetSchema = z.object({
  targetType: z.enum(['user', 'agent', 'all', 'agent_group']),
  targetId: z.string().trim().min(1),
})

export const taskCommentSchema = z.object({
  content: z.string().trim().default(''),
  parentCommentId: z.string().trim().min(1).optional(),
  mentions: z.array(taskCommentMentionTargetSchema).max(20).optional().default([]),
  attachments: z.unknown().transform(normalizeTaskChatAttachments).refine((attachments) => attachments.length <= TASK_COMMENT_ATTACHMENT_LIMIT, {
    message: `单条评论最多 ${TASK_COMMENT_ATTACHMENT_LIMIT} 个附件。`,
  }).optional().default([]),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).refine((value) => Boolean(value.content || value.attachments.length), {
  message: '评论内容和附件不能同时为空。',
  path: ['content'],
})

export const taskCommentEditSchema = z.object({
  content: z.string().trim().default(''),
  mentions: z.array(taskCommentMentionTargetSchema).max(20).optional(),
  attachments: z.unknown().transform(normalizeTaskChatAttachments).refine((attachments) => attachments.length <= TASK_COMMENT_ATTACHMENT_LIMIT, {
    message: `单条评论最多 ${TASK_COMMENT_ATTACHMENT_LIMIT} 个附件。`,
  }).optional(),
}).refine((value) => Boolean(value.content || value.attachments === undefined || value.attachments.length), {
  message: '评论内容和附件不能同时为空。',
  path: ['content'],
})

export const taskCommentReactionSchema = z.object({
  emoji: z.enum(TASK_COMMENT_REACTION_EMOJIS),
  active: z.boolean(),
})

export const taskCommentResolutionSchema = z.object({
  resolved: z.boolean(),
})

export const taskSubscriberSchema = z.object({
  userId: z.string().trim().min(1),
  subscribed: z.boolean(),
})

export const taskAgentActivityRetrySchema = z.object({
  sessionMode: z.enum(['resume', 'fresh']).optional().default('resume'),
})

export const taskAssignedAgentStartSchema = z.object({
  handoffPrompt: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
})

export const taskExecutionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  delegatedPrompt: z.string().trim().min(1).max(4000).optional(),
  baseBranch: z.string().trim().min(1).optional(),
  returnMode: z.enum(['summary', 'branch', 'commit']).optional(),
  syncBackStrategy: z.enum(['none', 'pull-branch']).optional(),
  gitIdentityMode: z.enum(['personal']).optional(),
})

const automationVariableSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().nullable().optional(),
  type: z.enum(['text', 'number', 'boolean', 'select']).default('text'),
  required: z.boolean().default(true),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  options: z.array(z.string().trim().min(1)).optional(),
})

const automationTaskTemplateSchema = z.object({
  acceptanceCriteria: z.string().trim().optional(),
  initialChatMessage: z.string().trim().optional(),
  customTitleMode: z.enum(['fixed', 'template']).optional(),
})

export const automationSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('medium'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  agentType: serverAgentTypeSchema.default('OpenCode'),
  executionModel: z.string().trim().optional(),
  opencodeConfig: openCodeExecutionConfigSchema.optional(),
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().optional(),
  baseBranch: z.string().trim().optional(),
  returnMode: z.enum(['summary', 'branch', 'commit']).default('commit'),
  syncBackStrategy: z.enum(['none', 'pull-branch']).default('none'),
  gitIdentityMode: z.enum(['personal']).default('personal'),
  concurrencyPolicy: z.enum(['skip_if_active', 'coalesce_if_active', 'always_enqueue']).default('coalesce_if_active'),
  catchUpPolicy: z.enum(['skip_missed', 'enqueue_missed_with_cap']).default('skip_missed'),
  taskTemplate: automationTaskTemplateSchema.optional(),
  variables: z.array(automationVariableSchema).default([]),
})

export const automationUpdateSchema = automationSchema.partial()

export const automationTriggerSchema = z.object({
  kind: z.enum(['schedule', 'webhook', 'api']),
  label: z.string().trim().optional(),
  cronExpression: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  signingMode: z.enum(['bearer', 'hmac_sha256']).optional(),
  replayWindowSec: z.number().int().min(30).max(86400).optional(),
  enabled: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.kind === 'schedule') {
    if (!value.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cronExpression'],
        message: 'schedule trigger 需要 cronExpression。',
      })
    }
  }
})

export const automationTriggerUpdateSchema = z.object({
  label: z.string().trim().optional(),
  cronExpression: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  signingMode: z.enum(['bearer', 'hmac_sha256']).optional(),
  replayWindowSec: z.number().int().min(30).max(86400).optional(),
  enabled: z.boolean().optional(),
})

export const automationRunSchema = z.object({
  triggerId: z.string().trim().optional(),
  payload: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().trim().optional(),
})

export const projectBindingSchema = z.object({
  projectId: z.string().min(1),
  nodeId: z.string().min(1),
  pathHint: z.string().trim().optional().default(''),
})

export const distributedTaskSchema = z.object({
  originTaskId: z.string().min(1),
  projectId: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['none', 'low', 'medium', 'high']).default('medium'),
  timeoutSec: z.number().int().positive().max(7200).default(1800),
  executorNodeId: z.string().min(1).optional(),
  returnMode: z.enum(['summary', 'branch', 'commit']).default('summary'),
  syncBackStrategy: z.enum(['none', 'pull-branch']).default('none'),
  gitIdentityMode: z.enum(['personal']).default('personal'),
})

export const settingsSchema = z.object({
  opencodeConfigContent: z.string().optional().default(''),
  codexConfigContent: z.string().optional().default(''),
  codexAuthContent: z.string().optional().default(''),
  claudeCodeConfigContent: z.string().optional().default(''),
  claudeCodeCredentialsContent: z.string().optional().default(''),
  defaultModel: z.string().optional().default(''),
  mcpServers: z.array(z.object({
    id: z.string().trim().optional(),
    name: z.string().trim().min(1),
    target: z.string().trim().min(1),
    transport: z.enum(['http', 'sse', 'stdio', 'custom']).optional().default('http'),
    enabled: z.boolean().optional().default(true),
    capabilityMode: z.enum(['resources', 'resources+tools']).optional().default('resources'),
    visibility: z.enum(['private', 'workspace', 'team']).optional(),
    workspaceId: z.string().trim().optional(),
    ownerUserId: z.string().trim().optional(),
    managedBySystem: z.boolean().optional(),
  })).optional().default([]),
  agentSettings: z.object({
    OpenCode: z.object({
      _runtime: z.literal('OpenCode').optional().default('OpenCode'),
      defaultModel: z.string().optional().default(DEFAULT_AGENT_SETTINGS.OpenCode.defaultModel),
      agent: z.string().optional().default(DEFAULT_AGENT_SETTINGS.OpenCode.agent),
      permissionPolicy: z.string().optional().default(DEFAULT_AGENT_SETTINGS.OpenCode.permissionPolicy),
    }).optional().default(DEFAULT_AGENT_SETTINGS.OpenCode),
    Codex: z.object({
      _runtime: z.literal('Codex').optional().default('Codex'),
      defaultModel: z.string().optional().default(DEFAULT_AGENT_SETTINGS.Codex.defaultModel),
      sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional().default(DEFAULT_AGENT_SETTINGS.Codex.sandbox),
      approval: z.enum(['untrusted', 'on-failure', 'on-request', 'never']).optional().default(DEFAULT_AGENT_SETTINGS.Codex.approval),
      reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional().default(DEFAULT_AGENT_SETTINGS.Codex.reasoningEffort),
      reasoningSummary: z.enum(['auto', 'concise', 'detailed', 'none']).optional().default(DEFAULT_AGENT_SETTINGS.Codex.reasoningSummary),
    }).optional().default(DEFAULT_AGENT_SETTINGS.Codex),
    ClaudeCode: z.object({
      _runtime: z.literal('ClaudeCode').optional().default('ClaudeCode'),
      defaultModel: z.string().optional().default(DEFAULT_AGENT_SETTINGS.ClaudeCode.defaultModel),
      permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions']).optional().default(DEFAULT_AGENT_SETTINGS.ClaudeCode.permissionMode),
      planMode: z.boolean().optional().default(DEFAULT_AGENT_SETTINGS.ClaudeCode.planMode),
    }).optional().default(DEFAULT_AGENT_SETTINGS.ClaudeCode),
    Pi: z.object({
      _runtime: z.literal('Pi').optional().default('Pi'),
      defaultModel: z.string().optional().default(DEFAULT_AGENT_SETTINGS.Pi.defaultModel),
      agentDir: z.string().optional().default(DEFAULT_AGENT_SETTINGS.Pi.agentDir || ''),
    }).optional().default(DEFAULT_AGENT_SETTINGS.Pi),
  }).optional().default(DEFAULT_AGENT_SETTINGS),
  workspaceExecutionDefaults: z.object({
    executorNodeId: z.string().trim().optional().default(''),
    agentType: serverAgentTypeSchema.optional(),
    executionModel: z.string().trim().optional().default(''),
  }).optional().default({ executorNodeId: '', executionModel: '' }),
  workerUpdateSettings: z.object({
    exitMode: z.enum(['manual', 'auto']).optional().default(DEFAULT_WORKER_UPDATE_SETTINGS.exitMode),
  }).optional().default(DEFAULT_WORKER_UPDATE_SETTINGS),
  workspaceOpenSettings: z.object({
    defaultTarget: z.enum(WORKSPACE_OPEN_TARGETS).optional().default(DEFAULT_WORKSPACE_OPEN_SETTINGS.defaultTarget),
    customCommand: z.string().optional().default(DEFAULT_WORKSPACE_OPEN_SETTINGS.customCommand),
  }).optional().default(DEFAULT_WORKSPACE_OPEN_SETTINGS),
})

export const moveSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked']),
})

export const taskModelSchema = z.object({
  executionModel: z.string().trim().optional(),
  opencodeConfig: openCodeExecutionConfigSchema.optional(),
  executorNodeId: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
})

export const taskAgentSchema = z.object({
  agentType: serverAgentTypeSchema,
  executorNodeId: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  workspaceSessionId: z.string().trim().optional(),
})

export const taskAgentSettingsSchema = z.object({
  agentType: serverAgentTypeSchema,
  executorNodeId: z.string().trim().optional(),
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().optional(),
  agentSettings: z.record(z.unknown()).optional().default({}),
})

export const taskMcpSettingsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().optional(),
  enabledMcpServerIds: z.array(z.string().trim().min(1)).optional().default([]),
})

export const taskAgentManagedSchema = z.object({
  agentManaged: z.enum(['ai', 'none']),
})

export const taskAssigneeSchema = z.object({
  assigneeId: z.string().trim().optional().nullable(),
  assigneeAgentId: z.string().trim().optional().nullable(),
  assigneeAgentGroupId: z.string().trim().optional().nullable(),
  startMode: z.enum(['now', 'parked']).optional().default('now'),
  handoffPrompt: z.string().trim().max(4000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).refine((value) => [value.assigneeId, value.assigneeAgentId, value.assigneeAgentGroupId].filter(Boolean).length <= 1, {
  message: '人类、Agent 与 Squad 负责人只能设置一个。',
})

export const taskUpdateSchema = z.object({
  title: z.string().trim().max(TASK_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().min(1).max(TASK_DESCRIPTION_MAX_LENGTH),
  acceptanceCriteria: z.string().trim().max(TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH).optional(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  startedAt: z.string().datetime().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
})

export const pathSchema = z.object({
  localPath: z.string().min(1),
})

export const aiChatSchema = z.object({
  message: z.string().trim().optional().default(''),
  sessionId: z.string().trim().optional(),
  attachments: z.unknown().optional(),
  clientMessageId: z.string().uuid().optional(),
  replyToMessageId: z.string().trim().optional(),
}).transform((payload) => ({
  message: payload.message,
  sessionId: payload.sessionId?.trim() || undefined,
  attachments: normalizeTaskChatAttachments(payload.attachments),
  clientMessageId: payload.clientMessageId,
  replyToMessageId: payload.replyToMessageId?.trim() || undefined,
})).refine((payload) => payload.message.length > 0 || payload.attachments.length > 0, {
  message: '消息不能为空。',
})

export const agentSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  endpoint: z.string().optional(),
  config: z.record(z.unknown()).optional(),
})

export const agentUpdateSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  endpoint: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
})

export const cronSchema = z.object({
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
})

export const cronUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  cronExpression: z.string().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

/** 心跳计划的 payload 结构校验（宽松 passthrough，只约束已知成本/时区字段）。 */
export const heartbeatPayloadSchema = z.object({
  kind: z.literal('heartbeat').optional(),
  instructions: z.string().max(2000).optional(),
  timezone: z.enum(['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles', 'America/New_York']).optional(),
  activeWindow: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.enum(['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles', 'America/New_York']),
  }).optional(),
  dailyLimit: z.number().int().min(1).max(1000).optional(),
}).passthrough()

export const validateHeartbeatPayload = (payload: unknown): string | null => {
  const result = heartbeatPayloadSchema.safeParse(payload)
  if (result.success) return null
  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

export const withState = async (
  state: AppState,
  message?: string,
  userId?: string,
  options?: {
    includeResources?: boolean
  },
) => {
  const normalizedState = normalizeMainChatSessionState(state)
  saveStateMeta(normalizedState)
  await syncBoardStateToLegacyStorage(normalizedState)
  broadcastState(normalizedState)
  const scopedState = userId ? getScopedState(normalizedState, userId) : normalizedState
  if (options?.includeResources === false) {
    return { state: scopedState, message }
  }

  const resources: AppResources = {
    ...getStateResources(),
    projects: scopedState.projects,
    tasks: scopedState.tasks,
    nodes: scopedState.nodes,
    projectBindings: scopedState.projectBindings,
    distributedTasks: scopedState.distributedTasks,
    taskWorkspaceBindings: scopedState.taskWorkspaceBindings,
    workspaceSessions: scopedState.workspaceSessions,
    mainChatSessions: scopedState.mainChatSessions,
  }
  return { state: scopedState, resources, message }
}

export const withClusterState = (state: AppState) => hydrateClusterState(state)

export const publishState = async (state: AppState) => {
  const normalizedState = normalizeMainChatSessionState(state)
  saveStateMeta(normalizedState)
  await syncBoardStateToLegacyStorage(normalizedState)
  broadcastState(normalizedState)
}

export const buildProjectBinding = (project: Project, nodeId: string, pathHint?: string): ProjectBinding => {
  const timestamp = new Date().toISOString()
  const normalizedPathHint = pathHint?.trim() || undefined
  return {
    projectId: project.id,
    nodeId,
    repoUrl: project.gitUrl,
    defaultBranch: project.defaultBranch ?? 'main',
    pathHint: normalizedPathHint,
    mode: normalizedPathHint ? 'manual' : 'auto',
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const resolveTaskCommandPreset = (project: Project): ProjectCommandPreset | undefined => {
  return toProjectCommandPresetFromEnvironment(project)
}

export const createDistributedTaskRecord = async (params: {
  project: Project
  task: Task
  config: AppState['config']
  userId: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  taskRunId?: string
  workspaceId?: string
  workspaceSessionId?: string
  workspaceBranchName?: string
  executionPath?: string
  baseRef?: string
  description: string
  runtimeSkillPackages?: DistributedTask['runtimeSkillPackages']
  mcpServers?: DistributedTask['mcpServers']
  initialStatus?: DistributedTask['status']
  priority: DistributedTask['priority']
  timeoutSec: number
  executorNodeId?: string
  returnMode: DistributedTask['returnMode']
  syncBackStrategy: DistributedTask['syncBackStrategy']
  gitIdentityMode: DistributedTask['gitIdentityMode']
  publishPolicy?: DistributedTask['publishPolicy']
  gitAuthPreference?: DistributedTask['gitAuthPreference']
  autoCommitEnabled?: boolean
}): Promise<DistributedTask> => {
  const modelRuntime = await resolveModelProfileRuntime({
    userId: params.userId,
    agentType: params.task.agentType,
    executionModel: params.task.executionModel,
    fallbackExecutionModel: getServerAgentDefaultModel(params.config, params.task.agentType),
    workspaceId: params.workspaceId,
  })
  const baseAgentSettings = getServerAgentSettings(params.config, params.task.agentType)
  const agentSettings = modelRuntime.runtimeSettings
    ? mergeAgentRuntimeSettings(params.task.agentType, baseAgentSettings, modelRuntime.runtimeSettings)
    : baseAgentSettings
  const resolvedGitIdentity = await resolveUserProjectGitIdentity({
    userId: params.userId,
    projectId: params.project.id,
    mode: params.gitIdentityMode,
    repoUrl: params.project.gitUrl,
    gitAuthPreference: params.gitAuthPreference,
  })
  const capabilitySnapshot = resolveTaskRuntimeCapabilitySnapshot({
    projectId: params.project.id,
    workspaceId: params.workspaceId,
    userId: params.userId,
    runtimeEnv: modelRuntime.runtimeEnv,
    runtimeSkillPackages: params.runtimeSkillPackages,
    mcpServers: params.mcpServers ?? filterVisibleMcpServers(params.config.mcpServers, params.userId),
    opencodeConfig: params.task.opencodeConfig,
  })

  return {
    id: crypto.randomUUID(),
    originTaskId: params.task.id,
    originTaskRunId: params.taskRunId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    workspaceBranchName: params.workspaceBranchName?.trim() || undefined,
    projectId: params.project.id,
    rootPath: params.executionPath?.trim() || params.project.rootPath?.trim() || undefined,
    versionControl: params.project.versionControl ?? (params.project.gitUrl.trim() ? 'git-remote' : 'none'),
    requestedByUserId: params.userId,
    requestedByAgentId: params.requestedByAgentId?.trim() || undefined,
    sourceAgentEventId: params.sourceAgentEventId?.trim() || undefined,
    agentType: params.task.agentType,
    agentSettings,
    mcpServers: capabilitySnapshot.mcpServers,
    runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
    runtimeEnv: capabilitySnapshot.runtimeEnv,
    executionModel: modelRuntime.executionModel ?? params.task.executionModel,
    opencodeConfig: capabilitySnapshot.opencodeConfig,
    workingDirectoryMode: (params.task as Task & { workingDirectoryMode?: DistributedTask['workingDirectoryMode'] }).workingDirectoryMode ?? 'worktree',
    autoCommitEnabled: resolveWorkspaceAutoCommitEnabled({
      workingDirectoryMode: (params.task as Task & { workingDirectoryMode?: DistributedTask['workingDirectoryMode'] }).workingDirectoryMode ?? 'worktree',
      autoCommitEnabled: params.autoCommitEnabled,
    }),
    repoUrl: params.project.gitUrl,
    defaultBranch: params.baseRef?.trim() || (params.project.defaultBranch ?? 'main'),
    baseCommit: params.baseRef?.trim() || (params.project.defaultBranch ?? 'main'),
    description: params.description,
    commandPreset: resolveTaskCommandPreset(params.project),
    status: params.initialStatus ?? (params.executorNodeId ? 'assigned' : 'queued'),
    priority: params.priority,
    timeoutSec: params.timeoutSec,
    originNodeId: clusterConfig.nodeId,
    executorNodeId: params.executorNodeId,
    returnMode: params.returnMode,
    syncBackStrategy: params.syncBackStrategy,
    gitIdentityMode: params.gitIdentityMode,
    publishPolicy: params.publishPolicy ?? resolveDefaultDistributedTaskPublishPolicy(params.project),
    gitAuthPreference: params.gitAuthPreference ?? 'project-default',
    gitIdentity: sanitizeTaskGitIdentity(resolvedGitIdentity),
    idempotencyKey: crypto.randomUUID(),
    retryCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export const isDistributedTaskTerminal = (status: DistributedTask['status']) => ['completed', 'failed', 'cancelled', 'timed_out', 'lost'].includes(status)

export const resetDistributedTask = (task: DistributedTask, executorNodeId: string, message: string) => {
  const at = new Date().toISOString()
  const nextTask: DistributedTask = {
    ...task,
    executorNodeId,
    status: 'queued',
    retryCount: task.retryCount + 1,
    idempotencyKey: crypto.randomUUID(),
    workerEventSequence: undefined,
    startedAt: undefined,
    completedAt: undefined,
    leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
    errorMessage: undefined,
    result: undefined,
    updatedAt: at,
  }

  updateDistributedTask(nextTask)
  syncDistributedTaskEvent({ taskId: nextTask.id, status: 'queued', message, at })
  return nextTask
}

export const cancelDistributedTask = (task: DistributedTask, message: string) => {
  const at = new Date().toISOString()
  const nextTask: DistributedTask = {
    ...task,
    status: 'cancelled',
    completedAt: at,
    leaseExpiresAt: undefined,
    errorMessage: message,
    result: attachTaskResultDelivery({
      taskId: task.id,
      status: 'cancelled',
      returnMode: task.returnMode,
      summary: message,
      filesChanged: task.result?.filesChanged ?? [],
      remoteBranchName: task.result?.remoteBranchName,
      commitShas: task.result?.commitShas,
      startedAt: task.startedAt ?? at,
      completedAt: at,
      durationSec: task.startedAt ? Math.max(0, Math.round((new Date(at).getTime() - new Date(task.startedAt).getTime()) / 1000)) : 0,
      executorNodeId: task.executorNodeId ?? '',
    }, {
      repoUrl: task.repoUrl,
      baseBranch: task.defaultBranch,
      taskDescription: task.description,
    }),
    updatedAt: at,
  }

  syncDistributedTaskResult(nextTask)
  return nextTask
}
