// [INPUT]: Authenticated workspace requests, persisted app state, and worker control-plane services.
// [OUTPUT]: Workspace lifecycle, session, environment, transfer, archive, and deletion HTTP routes.
// [POS]: Server workspace control plane; sessions are independent from workspace-level task bindings.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { buildDisplayOrderPatch, resolveNextDisplayOrder } from '@shared/project-workspace-order'
import { isManagedCloudAutoExecutorId, MANAGED_CLOUD_AUTO_EXECUTOR_ID } from '@shared/managed-cloud'
import { isPlaygroundProjectId, PLAYGROUND_PROJECT_ID, PLAYGROUND_PROJECT_NAME } from '@shared/playground-workspace'
import { resolveEffectiveProjectEnvironmentTemplate, resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import { validateProjectEnvironmentPreviewPorts } from '@shared/types'
import { createExecutionLog, deriveExecutionCenter } from '@shared/task-orchestrator'
import { buildWorkspaceSessionRuntimeTask } from '@shared/workspace-session-runtime-task'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { applyWorkspaceCodeStateToSession, buildWorkspaceTaskExecutionView, createWorkspaceSession, mergeWorkspaceSession, rebindWorkspaceSessionToExecutor, resolveNextWorkspaceSessionDisplayOrder, resolveWorkspaceSessionExecutorId, resolveWorkspaceAutoCommitEnabled, resolveWorkspaceCodeBaseBranch, resolveWorkspaceCodeBranchName, setWorkspaceSessionPinned, sortWorkspaceSessions } from '@shared/task-workspace'
import type { WorkspaceSessionEventRecord, WorkspaceSessionRuntimeSnapshot, WorkspaceSessionTurnRecord } from '@shared/workspace-session-history'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { AgentRuntimeSettings, AppState, ExecutorRecord, Project, Task, TaskRuntimeGitIdentity, WorkspaceSession, Workspace, WorkspaceRecord } from '@shared/types'
import { canUserUseExecutorForProject, listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { enqueueTaskChatMessage, listTaskChatQueueEntriesForWorkspaceSession, removeTaskChatQueueEntriesForWorkspace, removeTaskChatQueueEntriesForWorkspaceSession } from '../control-plane/task-chat-service'
import { validateProjectExecutorPathAccess } from '../services/project-executor-ownership'
import { stopTaskChatExecutionAcrossNodes, markTaskChatRuntimeStopped, isWorkspaceSessionExecutionActive } from '../services/task-chat-dispatch/runtime-state'
import { appendTaskConversationMessage, forkTaskConversationUntilMessage } from '../control-plane/conversation-service'
import { detectProjectRuntimeEnvironmentFile } from '../control-plane/project-environment-service'
import { refreshProjectVersionControlFromExecutor } from '../control-plane/executor-repo-service'
import { executorRegistry } from '../control-plane/executor-registry'
import { resolveUserProjectGitIdentityDiagnostic } from '../control-plane/task-git-identity'
import type { GitIdentityDiagnostic } from '../control-plane/task-git-identity'
import { executorWsService } from '../control-plane/executor-ws-service'
import { autoImportProjectRuntimeEnvironment } from '../services/project-runtime-environment-import-service'
import { buildSessionTitle } from '../services/session-title'
import { cleanupWorkspaceWorktrees } from '../services/workspace-cleanup-service'
import { scheduleWorkspaceDeletionCleanup } from '../services/workspace-deletion-cleanup-service'
import { resolveUserWorkspaceShareAccess } from '../services/workspace-share-service'
import { cleanupWorkspaceRuntimeResources, summarizeWorkspaceRuntimeCleanup } from '../services/workspace-runtime-cleanup-service'
import { createWorkspaceOperationTimelineWriter, recordWorkspaceSessionSystemMessage } from '../services/workspace-session-operation-timeline'
import { publishWorkspaceBrainReview } from '../services/scheduling-brain/event-supervisor'
import {
  clearWorkspaceEnvironmentTemplate,
  getWorkspaceEnvironmentTemplate,
  importWorkspaceEnvironmentTemplate,
  resolveWorkspaceEffectiveEnvironmentTemplate,
  saveWorkspaceEnvironmentTemplate,
} from '../services/workspace-environment-template-service'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'
import { canUserManageProjectWorkspace, getProjectWorkspaceManagementDeniedMessage } from '../services/project-workspace-management-access'
import { resolveScopedRuntimeEnvironment, saveWorkspaceRuntimeEnvironmentConfig } from '../services/runtime-environment-service'
import { scheduleTaskChatQueueDrain } from '../services/task-chat-dispatch'
import { readWorkspaceExecutorGitWorkingTreeDiff, finalizeWorkspaceExecutorGit, shouldEmitWorkspaceAutoCommitStartMessage } from '../services/task-chat-dispatch/workspace-executor'
import { appendTerminalCommandDiagnostic } from '../services/terminal-command-diagnostics'
import { verifyWorkspaceDirectoryReady } from '../services/task-chat-dispatch/workspace-directory-ready'
import { SERVER_AGENT_TYPES } from '../services/server-agent'
import { resolveEffectiveWorkspaceRuntimeStatus } from '../services/task-workspace-runtime-state'
import { getWorkspaceSessionUnreadStoreSnapshotForUser, saveWorkspaceSessionUnreadStoreSnapshotForUser } from '../services/workspace-session-unread-store'
import { resolveWorkspaceRepoPath } from '../services/workspace-repo-path'
import {
  buildWorkspaceTitleFallback,
  suggestWorkspaceTitleWithDeepSeek,
} from '../services/workspace-title-suggestion'
import { deleteConversation, getTaskConversation, listConversationMessages, listConversations } from '../storage/conversation-store'
import { persistWorkspaceSessionTurnHistory } from '../storage/postgres/workspace-session-history-store'
import { deleteTaskWorkspaceBindings, deleteWorkspaceSessions, loadState, saveProject, saveTask, saveTaskAndWait, saveTaskWorkspaceBinding, saveWorkspaceSession, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { deleteWorkspaces, getWorkspace, listProjectBindings, saveWorkspace, saveWorkspaceAndWait } from '../storage/distributed-task-store'
import { getScopedState, getUserIdFromHeader, projectEnvironmentTemplateSchema, withClusterState, withState } from './shared'
import { deleteObjectPrefix } from '../services/object-storage'
import { normalizeProjectEnvironmentTemplate } from './project-route-shared'
import {
  allocateWorkspaceWorktreeUniqueId,
  createWorkspaceRecord,
  detachWorkspaceIdsFromTask,
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getWorkspaceSessionRecordForTaskContext,
  getScopedWorkspaceForProject,
  listProjectWorkspacesForUser,
  listWorkspaceSessionRecordsForWorkspace,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd,
  resolveWorkspaceWorkingDirectoryMode,
  saveWorkspaceDirectorySessions,
  upsertWorkspaceSessionInState,
} from './task-route-support'

const serverAgentTypeSchema = z.enum(SERVER_AGENT_TYPES)
const workspaceSessionUnreadStoreSnapshotSchema = z.object({
  updatedAt: z.string().trim().optional().default(''),
  sessionAttentionById: z.record(z.string()).optional().default({}),
  acknowledgedSessionAttentionById: z.record(z.string()).optional().default({}),
  manuallyUnreadSessionAttentionById: z.record(z.string()).optional().default({}),
})

const workspaceReorderSchema = z.object({
  orderedWorkspaceIds: z.array(z.string().trim().min(1)).min(1),
})

const workspaceSessionReorderSchema = z.object({
  orderedSessionIds: z.array(z.string().trim().min(1)).min(1),
})

const workspaceSessionPinSchema = z.object({
  pinned: z.boolean(),
})

const workspaceSessionAutoTitleSchema = z.object({
  taskId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
})

const workspaceSessionForkSchema = z.object({
  taskId: z.string().trim().min(1).optional(),
  sourceMessageId: z.string().trim().min(1),
  mode: z.enum(['local', 'worktree']),
  title: z.string().trim().max(80).optional(),
  revision: z.object({
    kind: z.enum(['rewrite-user-turn', 'retry-assistant-turn']),
    sourceTurnId: z.string().trim().min(1).optional(),
    sourceUserMessageId: z.string().trim().min(1),
    sourceAssistantMessageId: z.string().trim().min(1).optional(),
  }).optional(),
})

const workspaceArchiveSchema = z.object({
  archived: z.boolean(),
})

/**
 * 确保系统保留的 playground 虚拟项目存在（幂等）。
 * 仅在通过 /api/projects/__playground__/workspaces 创建无项目工作区时惰性创建。
 */
const ensurePlaygroundProject = (): Project => {
  const existing = loadState().projects.find((project) => project.id === PLAYGROUND_PROJECT_ID)
  if (existing) {
    return existing
  }

  const timestamp = new Date().toISOString()
  const playgroundProject: Project = {
    id: PLAYGROUND_PROJECT_ID,
    name: PLAYGROUND_PROJECT_NAME,
    displayOrder: -1,
    color: null,
    workspaceId: undefined,
    visibility: 'private',
    rootPath: undefined,
    versionControl: 'none',
    gitUrl: '',
    defaultBranch: 'main',
    preferredExecutorId: undefined,
    repositoryCloneStatus: undefined,
    repositoryCloneMessage: undefined,
    environmentTemplate: undefined,
    recentBaseBranches: ['main'],
    createdById: undefined,
    createdByName: undefined,
    createdByAvatarUrl: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  saveProject(playgroundProject)
  return playgroundProject
}

const resolveAuthorizedWorkspaceContext = (state: AppState, userId: string, workspaceId: string, options?: { requireCollaborate?: boolean }) => {
  const workspace = getWorkspace(workspaceId)
  if (!workspace) return { ok: false as const, message: '工作区不存在。' }

  const scopedState = getScopedState(state, userId)
  // playground 虚拟项目被 scopedState 隐藏，但 workspace 上下文需要真实 project
  const project = isPlaygroundProjectId(workspace.projectId)
    ? state.projects.find((item) => item.id === workspace.projectId) ?? null
    : scopedState.projects.find((item) => item.id === workspace.projectId)
  if (!project) {
    // 共享协作人兜底：会话管理操作要求 collaborate（可协助）权限
    if (options?.requireCollaborate) {
      const rawProject = state.projects.find((item) => item.id === workspace.projectId)
      const collabWorkspaceId = rawProject?.workspaceId?.trim()
      if (rawProject && collabWorkspaceId) {
        const access = resolveUserWorkspaceShareAccess(userId, collabWorkspaceId)
        if (access.ok && access.permission === 'collaborate') {
          const scopedWorkspace = getScopedWorkspaceForProject(userId, rawProject, workspaceId)
          if (scopedWorkspace) {
            return { ok: true as const, workspace, scopedState, project: rawProject, scopedWorkspace }
          }
        }
      }
    }
    return { ok: false as const, message: '项目不存在或无权访问。' }
  }

  const scopedWorkspace = getScopedWorkspaceForProject(userId, project, workspaceId)
  if (!scopedWorkspace) return { ok: false as const, message: '工作区不存在或无权访问。' }

  return { ok: true as const, workspace, scopedState, project, scopedWorkspace }
}

const workspaceTitleSuggestionSchema = z.object({
  executorNodeId: z.string().trim().min(1).optional(),
  initialPrompt: z.string().trim().optional().default(''),
  imageFilename: z.string().trim().optional(),
  imageDataUrl: z.string().trim().optional(),
  fallbackTitle: z.string().trim().optional(),
})

const workspaceEnvironmentTemplatePayloadSchema = z.object({
  template: projectEnvironmentTemplateSchema.nullable().optional(),
})

const workspaceEnvironmentTemplateImportPayloadSchema = z.object({
  workspaceSessionId: z.string().trim().optional(),
}).optional()

const workspaceSessionCreateSchema = z.object({
  workspaceSessionId: z.string().trim().min(1).optional(),
  createNewSession: z.boolean().optional().default(true),
  agentType: serverAgentTypeSchema.optional(),
  executionModel: z.string().trim().optional(),
  agentSettings: z.record(z.unknown()).optional(),
  baseBranch: z.string().trim().min(1).optional(),
  title: z.string().trim().max(80).optional(),
  titleOrigin: z.enum(['system', 'ai', 'manual']).optional(),
})

const DEFAULT_WORKSPACE_SESSION_TITLE = '默认会话'

const resolveWorkspaceSessionTaskContext = (params: {
  state: AppState
  project: Project
  workspace: WorkspaceRecord | Workspace
  session: WorkspaceSession
  requestedTaskId?: string
}) => {
  const requestedTaskId = params.requestedTaskId?.trim()
  const taskId = requestedTaskId && requestedTaskId !== params.session.id
    ? requestedTaskId
    : undefined
  const workspaceBindingTaskId = params.state.taskWorkspaceBindings.find((binding) => (
    binding.workspaceId === params.workspace.id && binding.status === 'active'
  ))?.taskId
  const effectiveTaskId = taskId || workspaceBindingTaskId

  const persistedTask = effectiveTaskId
    ? params.state.tasks.find((task) => task.id === effectiveTaskId && task.projectId === params.project.id)
    : undefined
  if (persistedTask) {
    return persistedTask
  }

  return buildWorkspaceSessionRuntimeTask({
    project: params.project,
    sessionId: params.session.id,
    title: params.session.title,
    agentType: params.session.agentType ?? params.workspace.agentType,
    executionModel: params.session.executionModel,
    baseBranch: params.session.baseBranch || params.workspace.suggestedBaseBranch || params.project.defaultBranch,
    currentStep: params.session.currentStep,
    createdAt: params.session.createdAt,
    updatedAt: params.session.updatedAt,
  })
}

export const resolveWorkspaceCreateInitialization = (params: {
  state: AppState
  project: Project
  workspace: WorkspaceRecord | Workspace
  session: WorkspaceSession
  persistedTask?: Task | null
}) => ({
  task: params.persistedTask ?? resolveWorkspaceSessionTaskContext(params),
  persistTask: Boolean(params.persistedTask),
})

export const buildForkWorkspaceSessionTitle = (session: WorkspaceSession, providedTitle?: string) => {
  const explicitTitle = providedTitle?.trim()
  if (explicitTitle) {
    return explicitTitle
  }

  const baseTitle = session.title.trim() || '会话'
  return `${baseTitle} · 分叉`
}

const buildForkWorkspaceName = (workspace: Workspace, session: WorkspaceSession, providedTitle?: string) => {
  const explicitTitle = providedTitle?.trim()
  if (explicitTitle) {
    return explicitTitle
  }

  const workspaceName = workspace.name.trim() || '工作区'
  const sessionTitle = session.title.trim()
  return sessionTitle ? `${workspaceName} · ${sessionTitle} 分叉` : `${workspaceName} · 分叉`
}

const createForkWorkspaceRecord = (params: {
  project: Project
  sourceWorkspace: Workspace
  sourceSession: WorkspaceSession
  userId: string
  title?: string
}) => {
  const executorAccess = canUserUseExecutorForProject({
    userId: params.userId,
    projectId: params.project.id,
    executorId: params.sourceWorkspace.executorNodeId,
  })
  if (!executorAccess.ok) {
    return { ok: false as const, message: executorAccess.message }
  }

  const workspace = createWorkspaceRecord(
    params.project,
    params.sourceWorkspace.executorNodeId,
    executorAccess.executor.name,
    buildForkWorkspaceName(params.sourceWorkspace, params.sourceSession, params.title),
    params.userId,
    params.sourceSession.agentType ?? params.sourceWorkspace.agentType,
    params.sourceSession.workingDirectoryMode,
    params.sourceSession.baseBranch ?? params.sourceWorkspace.suggestedBaseBranch,
    params.sourceWorkspace.autoCommitEnabled,
    resolveNextDisplayOrder(listProjectWorkspacesForUser(params.userId, params.project)),
    { workspaceRoot: executorAccess.executor.workspaceRoot },
  )
  const repoPath = resolveWorkspaceRepoPath({
    project: params.project,
    workspaceRoot: executorAccess.executor.workspaceRoot,
    workspace,
    bindingPathHint: listProjectBindings().find((binding) => (
      binding.projectId === params.project.id
      && binding.nodeId === params.sourceWorkspace.executorNodeId
      && binding.isActive
    ))?.pathHint,
  })

  return {
    ok: true as const,
    executor: executorAccess.executor,
    workspace: {
      ...workspace,
      defaultBranch: params.sourceWorkspace.defaultBranch || workspace.defaultBranch,
      repoPath,
      repoReady: Boolean(repoPath),
      status: repoPath ? 'ready' as const : workspace.status,
      suggestedBaseBranch: params.sourceSession.baseBranch
        ?? params.sourceWorkspace.suggestedBaseBranch
        ?? workspace.suggestedBaseBranch,
    } satisfies WorkspaceRecord,
  }
}

export const canAutoRenameWorkspaceSessionTitle = (params: {
  session: WorkspaceSession
  userMessageCount: number
}) => {
  if (params.session.titleOrigin !== 'system') {
    return false
  }

  return params.userMessageCount <= 1
}

export const resolveInitialWorkspaceSessionTitleOrigin = (_workspaceTitleOrigin?: WorkspaceSession['titleOrigin']) => {
  return 'system' as const
}

export const applyWorkspaceSessionCreatePayload = (params: {
  session: WorkspaceSession
  workspace: WorkspaceRecord | Workspace
  project: Project
  now: string
  payload: {
    agentSettings?: Record<string, unknown>
    baseBranch?: string
    title?: string
    titleOrigin?: WorkspaceSession['titleOrigin']
  }
}) => {
  const inheritedAgentSettings = 'agentSettings' in params.session ? params.session.agentSettings : undefined
  return applyWorkspaceCodeStateToSession(
    {
      ...params.session,
      title: params.payload.title ?? params.session.title,
      titleOrigin: params.payload.titleOrigin ?? params.session.titleOrigin,
      baseBranch: params.payload.baseBranch
        || params.session.baseBranch
        || params.workspace.suggestedBaseBranch
        || params.project.defaultBranch,
      agentSettings: (params.payload.agentSettings as AgentRuntimeSettings | undefined) ?? inheritedAgentSettings,
      updatedAt: params.now,
      lastActiveAt: params.now,
    },
    params.workspace,
  )
}

const resolveWorkspaceManagedCloudExecutorId = async (params: {
  state: AppState
  userId: string
  projectWorkspaceId?: string
}) => {
  getManagedCloudGate().ensureDevOnlyAccess()
  await getManagedCloudGate().ensureUsageAccess({
    state: params.state,
    userId: params.userId,
  })

  const result = await getManagedCloudGate().ensureExecutor({
    config: params.state.config,
    ownerUserId: params.userId,
    workspaceId: params.projectWorkspaceId?.trim() || undefined,
    projects: params.state.projects,
  })
  return result.executor.executorId
}

/**
 * 新建工作区默认节点策略：本地在线优先，无在线本地节点时返回 null（由调用方回退云节点）。
 * preferredExecutorId 命中最先，其余保持原顺序。
 */
export const resolveDefaultWorkspaceExecutorId = (params: {
  visibleExecutors: Array<Pick<ExecutorRecord, 'executorId' | 'status' | 'executorSource' | 'managedBy'>>
  preferredExecutorId?: string
}): string | null => {
  const onlineLocalExecutors = params.visibleExecutors.filter((executor) => (
    executor.status === 'online'
    && executor.executorSource !== 'managed-cloud'
    && executor.managedBy !== 'vibemux'
  ))
  if (onlineLocalExecutors.length === 0) {
    return null
  }

  const preferredExecutorId = params.preferredExecutorId?.trim()
  const preferred = preferredExecutorId
    ? onlineLocalExecutors.find((executor) => executor.executorId === preferredExecutorId)
    : undefined
  return preferred?.executorId ?? onlineLocalExecutors[0].executorId
}

const resolveWorkspaceExecutorNodeId = async (params: {
  state: AppState
  userId: string
  projectWorkspaceId?: string
  executorNodeId: string
}) => {
  const executorNodeId = params.executorNodeId.trim()
  if (!isManagedCloudAutoExecutorId(executorNodeId)) {
    return executorNodeId
  }

  return resolveWorkspaceManagedCloudExecutorId({
    state: params.state,
    userId: params.userId,
    projectWorkspaceId: params.projectWorkspaceId,
  })
}

const mergeWorkspaceMessage = (message: string, detail: string) => {
  return detail ? `${message} ${detail}` : message
}

const resolveTaskGitIdentityDiagnostic = async (userId: string, project: Project): Promise<GitIdentityDiagnostic> => {
  try {
    return await resolveUserProjectGitIdentityDiagnostic({
      userId,
      projectId: project.id,
      mode: 'personal',
      repoUrl: project.gitUrl,
    })
  } catch (error) {
    return {
      ok: false as const,
      code: 'no-binding' as const,
      message: error instanceof Error ? `Git 身份解析失败：${error.message}` : 'Git 身份解析失败。',
    }
  }
}

const WORKSPACE_PREPARATION_TURN_PREFIX = 'workspace-prepare:'
const WORKSPACE_INSTALL_TURN_PREFIX = 'workspace-install:'
const WORKSPACE_INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const activeWorkspacePreparationRuns = new Map<string, { runId: string; executorNodeId: string }>()

const resolveWorkspacePreparationEventIndex = (params: {
  step: string
  status?: 'executing' | 'complete' | 'error'
}) => {
  if (params.status === 'complete' || params.status === 'error') {
    return 3
  }

  return params.step.includes('worktree') ? 2 : 1
}

const resolveWorkspacePreparationTurnId = (workspaceSessionId: string, eventIndex: number) => {
  return `${WORKSPACE_PREPARATION_TURN_PREFIX}${workspaceSessionId}:${eventIndex}`
}

const resolveWorkspaceInstallTurnId = (workspaceSessionId: string) => {
  return `${WORKSPACE_INSTALL_TURN_PREFIX}${workspaceSessionId}`
}

const buildWorkspacePreparationSupersededMessage = (executorNodeId: string) => {
  return `针对节点 ${executorNodeId} 的后台准备已停止，已由更新的节点切换替代。`
}

const buildWorkspaceExecutorSwitchSummary = (params: {
  fromExecutorName: string
  toExecutorName: string
  branchName?: string
}) => [
  `节点切换：${params.fromExecutorName || '原执行节点'} → ${params.toExecutorName || '新执行节点'}`,
  params.branchName?.trim() ? `分支：${params.branchName.trim()}` : '',
  '正在后台准备新节点上的工作目录。',
].filter(Boolean).join('\n')

const beginWorkspacePreparationRun = (workspaceId: string, executorNodeId: string) => {
  const runId = crypto.randomUUID()
  activeWorkspacePreparationRuns.set(workspaceId, { runId, executorNodeId })
  return runId
}

const isWorkspacePreparationRunCurrent = (params: {
  workspaceId: string
  taskId: string
  workspaceSessionId: string
  executorNodeId: string
  runId?: string
}) => {
  const normalizedExecutorNodeId = params.executorNodeId.trim()
  if (params.runId) {
    const activeRun = activeWorkspacePreparationRuns.get(params.workspaceId)
    if (!activeRun || activeRun.runId !== params.runId || activeRun.executorNodeId !== normalizedExecutorNodeId) {
      return false
    }
  }

  const latestWorkspace = getWorkspace(params.workspaceId)
  if (!latestWorkspace || latestWorkspace.executorNodeId.trim() !== normalizedExecutorNodeId) {
    return false
  }

  const latestSession = getWorkspaceSessionRecordForTaskContext(params.taskId, params.workspaceId, params.workspaceSessionId)
  if (!latestSession || latestSession.status === 'archived') {
    return false
  }

  return resolveWorkspaceSessionExecutorId(latestSession, latestWorkspace.executorNodeId) === normalizedExecutorNodeId
}

const finishWorkspacePreparationRun = (workspaceId: string, runId?: string) => {
  if (!runId) {
    return
  }

  const activeRun = activeWorkspacePreparationRuns.get(workspaceId)
  if (activeRun?.runId === runId) {
    activeWorkspacePreparationRuns.delete(workspaceId)
  }
}

export const resolveWorkspaceExecutorSwitchPreparationTarget = (params: {
  workspaceId: string
  requestedTaskId?: string
  requestedWorkspaceSessionId?: string
  taskIdByWorkspaceId: Map<string, string>
  taskById: Map<string, Task>
  sessions: WorkspaceSession[]
}) => {
  const candidates = sortWorkspaceSessions(
    params.sessions.filter((session) => session.workspaceId === params.workspaceId && session.status !== 'archived'),
  )
  if (candidates.length === 0) {
    return null
  }

  const resolveTaskForSession = (session: WorkspaceSession) => {
    const taskId = params.requestedTaskId ?? params.taskIdByWorkspaceId.get(session.workspaceId)
    return taskId ? params.taskById.get(taskId) : undefined
  }

  const requestedWorkspaceSessionId = params.requestedWorkspaceSessionId?.trim() || undefined
  if (requestedWorkspaceSessionId) {
    const requestedSession = candidates.find((session) => session.id === requestedWorkspaceSessionId)
    const requestedTask = requestedSession ? resolveTaskForSession(requestedSession) : undefined
    if (requestedSession && requestedTask) {
      return { session: requestedSession, task: requestedTask }
    }
  }

  const requestedTaskId = params.requestedTaskId?.trim() || undefined
  if (requestedTaskId) {
    const matched = candidates.find((session) => {
      const task = resolveTaskForSession(session)
      return task?.id === requestedTaskId
    })
    const task = matched ? resolveTaskForSession(matched) : undefined
    if (matched && task) {
      return { session: matched, task }
    }
  }

  for (const session of candidates) {
    const task = resolveTaskForSession(session)
    if (task) {
      return { session, task }
    }
  }

  return null
}

export const ensureWorkspaceExecutorSwitchPreparationTarget = (params: {
  task?: Task
  workspace: WorkspaceRecord
  requestedWorkspaceSessionId?: string
  executorNodeId: string
  updatedAt: string
}) => {
  const task = params.task
  if (!task) {
    return null
  }

  const bindingState = ensureTaskWorkspaceBindingState({
    task,
    workspaceId: params.workspace.id,
    updatedAt: params.updatedAt,
  })
  const workspaceForExecutor = {
    ...params.workspace,
    executorNodeId: params.executorNodeId,
  }
  const session = ensureWorkspaceSessionRecord({
    task: bindingState.task,
    workspaceId: params.workspace.id,
    executorNodeId: params.executorNodeId,
    workspace: workspaceForExecutor,
    workspaceSessionId: params.requestedWorkspaceSessionId,
    createNewSession: false,
  })

  return {
    task: bindingState.task,
    session,
  }
}

export const resolveWorkspaceEnvironmentTemplateImportTarget = (params: {
  state: Pick<AppState, 'config' | 'workspaceSessions'>
  project: Project
  workspace: WorkspaceRecord
  requestedWorkspaceSessionId?: string
}) => {
  const requestedWorkspaceSessionId = params.requestedWorkspaceSessionId?.trim()
  const workspaceSessions = sortWorkspaceSessions(
    params.state.workspaceSessions.filter((session) => (
      session.workspaceId === params.workspace.id
      && session.status !== 'archived'
    )),
  )
  const importSession = requestedWorkspaceSessionId
    ? workspaceSessions.find((session) => session.id === requestedWorkspaceSessionId) ?? workspaceSessions[0]
    : workspaceSessions[0]
  const executorId = importSession
    ? resolveWorkspaceSessionExecutorId(importSession, params.workspace.executorNodeId)
    : params.workspace.executorNodeId?.trim()
  const executor = executorId
    ? executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
    : undefined
  const workspaceRoot = executor?.workspaceRoot?.trim() || params.state.config.workspaceRoot
  const effectiveSession = importSession
    ? applyWorkspaceCodeStateToSession(
        resolveEffectiveWorkspaceWorktreeSession(importSession.id, importSession, params.workspace.executorNodeId),
        params.workspace,
      )
    : null
  const sessionCwd = effectiveSession
    ? resolveWorkspaceSessionCwd(workspaceRoot, params.project, effectiveSession, params.workspace)
    : undefined
  const fallbackPath = params.workspace.repoPath?.trim() || undefined

  return {
    executorId: executorId || undefined,
    importPath: sessionCwd?.trim() || fallbackPath,
    workspaceSessionId: importSession?.id,
  }
}

const persistWorkspacePreparationStatus = async (params: {
  project: Project
  task: Task
  workspace: WorkspaceRecord
  session: WorkspaceSession
  step: string
  status?: 'executing' | 'complete' | 'error'
}) => {
  const now = new Date().toISOString()
  const eventIndex = resolveWorkspacePreparationEventIndex(params)
  const turnId = resolveWorkspacePreparationTurnId(params.session.id, eventIndex)
  const turnSeq = 1
  const event: WorkspaceSessionEventRecord = params.status === 'error'
    ? {
        id: crypto.randomUUID(),
        sessionId: params.session.id,
        turnId,
        sessionSeq: 0,
        turnSeq,
        createdAt: now,
        visibility: 'diagnostic',
        kind: 'error',
        payload: { message: params.step },
      }
    : {
        id: crypto.randomUUID(),
        sessionId: params.session.id,
        turnId,
        sessionSeq: 0,
        turnSeq,
        createdAt: now,
        visibility: 'diagnostic',
        kind: 'status',
        payload: {
          status: params.status ?? 'executing',
          step: params.step,
        },
      }
  const runtime: WorkspaceSessionRuntimeSnapshot = {
    sessionId: params.session.id,
    taskId: params.task.id,
    workspaceId: params.workspace.id,
    agentRunningStatus: params.status ?? 'executing',
    runtimeStatus: params.status === 'complete' ? 'completed' : params.status === 'error' ? 'error' : 'running',
    currentStep: params.step,
    queueStatus: 'idle',
    activeToolCalls: [],
    lastEventSeq: 0,
    lastEventAt: now,
    updatedAt: now,
  }
  const timelineEvent = params.status === 'error'
    ? {
        id: event.id,
        ts: event.createdAt,
        turnId: event.turnId,
        seq: event.turnSeq,
        kind: 'error' as const,
        message: params.step,
      }
    : {
        id: event.id,
        ts: event.createdAt,
        turnId: event.turnId,
        seq: event.turnSeq,
        kind: 'status' as const,
        status: params.status ?? 'executing',
        step: params.step,
      }
  appendTaskConversationMessage({
    task: params.task,
    project: params.project,
    workspaceId: params.workspace.id,
    workspaceSessionId: params.session.id,
    role: 'system',
    content: params.step,
    contentType: 'json',
    externalRef: {
      timelineEvent,
    },
  })
  const turn: WorkspaceSessionTurnRecord = {
    id: turnId,
    sessionId: params.session.id,
    status: params.status === 'error' ? 'error' : params.status === 'complete' ? 'completed' : 'running',
    startedAt: now,
    finishedAt: params.status === 'executing' ? undefined : now,
    eventCount: 1,
  }

  await persistWorkspaceSessionTurnHistory({
    sessionId: params.session.id,
    taskId: params.task.id,
    workspaceId: params.workspace.id,
    turn,
    events: [event],
    runtime,
  })
}

const persistWorkspacePreparationUnavailableStatus = async (params: {
  project: Project
  task: Task
  workspace: WorkspaceRecord
  session: WorkspaceSession
}) => {
  await persistWorkspacePreparationStatus({
    project: params.project,
    task: params.task,
    workspace: params.workspace,
    session: params.session,
    step: '执行节点不可用，暂时无法准备工作目录。',
    status: 'error',
  })
}

/**
 * 云节点被 idle-stop 后自动启动并等待上线（对齐 task-chat 路径的 auto-start 逻辑）。
 * 启动失败或等待期间被新操作替代时，由调用方中止后续准备。
 */
const ensureWorkspacePreparationExecutorOnline = async (params: {
  state: AppState
  project: Project
  task: Task
  workspace: WorkspaceRecord
  session: WorkspaceSession
  executorId: string
  stopIfSuperseded: () => boolean
}): Promise<'online' | 'superseded' | 'error'> => {
  await persistWorkspacePreparationStatus({
    project: params.project,
    task: params.task,
    workspace: params.workspace,
    session: params.session,
    step: '正在启动云节点，请稍候…',
    status: 'executing',
  })

  try {
    await getManagedCloudGate().startExecutor({
      config: params.state.config,
      executorId: params.executorId,
      projects: params.state.projects,
    })
    const startedExecutor = await getManagedCloudGate().waitForExecutorOnline(params.executorId)
    if (startedExecutor?.status !== 'online') {
      throw new Error('云节点启动超时，请稍后重试。')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '云节点启动失败。'
    await persistWorkspacePreparationStatus({
      project: params.project,
      task: params.task,
      workspace: params.workspace,
      session: params.session,
      step: `云节点启动失败：${message}`,
      status: 'error',
    })
    return 'error'
  }

  return params.stopIfSuperseded() ? 'superseded' : 'online'
}

const trimTerminalOutputForTimeline = (output: string) => {
  const normalized = output.trim()
  if (normalized.length <= 800) {
    return normalized
  }

  return `${normalized.slice(-800).trimStart()}`
}

const scheduleWorkspaceSessionQueuedTaskChatDrains = (params: {
  fallbackTaskId: string
  workspaceId: string
  workspaceSessionId: string
}) => {
  const queuedEntries = listTaskChatQueueEntriesForWorkspaceSession(
    params.workspaceId,
    params.workspaceSessionId,
  )
  const taskIds = new Set<string>([
    params.fallbackTaskId,
    ...queuedEntries.map((entry) => entry.taskId).filter((taskId): taskId is string => Boolean(taskId?.trim())),
  ])

  for (const taskId of taskIds) {
    scheduleTaskChatQueueDrain({
      taskId,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
    })
  }
}

export const runWorkspaceCreateInstallCommand = async (
  params: {
    project: Project
    task: Task
    workspace: WorkspaceRecord
    session: WorkspaceSession
    cwd: string
    executorId: string
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  },
  deps: {
    getWorkspaceEnvironmentTemplate?: typeof getWorkspaceEnvironmentTemplate
    requestTerminalCommand?: typeof executorWsService.requestTerminalCommand
    recordSystemMessage?: typeof recordWorkspaceSessionSystemMessage
  } = {},
) => {
  const workspaceEnvironmentTemplate = await (deps.getWorkspaceEnvironmentTemplate ?? getWorkspaceEnvironmentTemplate)(params.workspace.id)
  const preview = resolveProjectEnvironmentPreview({
    project: params.project,
    session: params.session,
    cwd: params.cwd,
    workspaceEnvironmentTemplate,
  })
  const installCommand = preview?.installCommand?.trim()
  if (!installCommand) {
    return { skipped: true as const }
  }

  const recordSystemMessage = deps.recordSystemMessage ?? recordWorkspaceSessionSystemMessage
  const timelineScope = {
    taskId: params.task.id,
    workspaceId: params.workspace.id,
    workspaceSessionId: params.session.id,
    turnId: resolveWorkspaceInstallTurnId(params.session.id),
  }
  recordSystemMessage(timelineScope, `开始自动执行安装命令：${installCommand}`)

  try {
    const result = await (deps.requestTerminalCommand ?? executorWsService.requestTerminalCommand)(
      params.executorId,
      installCommand,
      params.cwd,
      {
        mode: 'background',
        timeoutMs: WORKSPACE_INSTALL_TIMEOUT_MS,
        runtimeEnvironment: params.runtimeEnvironment,
      },
    )
    if (result.mode === 'background' && result.detached) {
      recordSystemMessage(timelineScope, `自动安装已在后台启动：${installCommand}`)
      return { skipped: false as const, ok: true as const, command: installCommand, detached: true as const }
    }
    const rawOutput = trimTerminalOutputForTimeline([result.stdout, result.stderr].filter(Boolean).join('\n'))
    const output = appendTerminalCommandDiagnostic({
      command: installCommand,
      exitCode: result.exitCode,
      output: rawOutput,
    })
    const suffix = output ? `\n\n最后输出：\n${output}` : ''
    if (result.exitCode === 0) {
      recordSystemMessage(timelineScope, `自动安装完成：${installCommand}${suffix}`)
      return { skipped: false as const, ok: true as const, command: installCommand }
    }

    recordSystemMessage(timelineScope, `自动安装失败（退出码 ${result.exitCode}）：${installCommand}${suffix}`)
    return { skipped: false as const, ok: false as const, command: installCommand, exitCode: result.exitCode }
  } catch (error) {
    const message = error instanceof Error ? error.message : '安装命令执行失败。'
    recordSystemMessage(timelineScope, `自动安装失败：${installCommand}\n\n${message}`)
    return { skipped: false as const, ok: false as const, command: installCommand, error: message }
  }
}

export const runWorkspaceBackgroundPreparation = async (params: {
  userId: string
  state: AppState
  project: Project
  task: Task
  workspace: WorkspaceRecord
  session: WorkspaceSession
  persistTask?: boolean
  runId?: string
  shouldContinue?: () => boolean
  supersededMessage?: string
}) => {
  const shouldPersistTask = params.persistTask ?? true
  const stopIfSuperseded = () => {
    if (params.shouldContinue?.() !== false) {
      return false
    }

    if (params.supersededMessage) {
      recordWorkspaceSessionSystemMessage({
        taskId: params.task.id,
        workspaceId: params.workspace.id,
        workspaceSessionId: params.session.id,
        turnId: resolveWorkspacePreparationTurnId(params.session.id, 3),
      }, params.supersededMessage)
    }
    return true
  }

  try {
    if (stopIfSuperseded()) {
      return
    }

    const executorId = resolveWorkspaceSessionExecutorId(params.session, params.workspace.executorNodeId)
    const executor = executorId
      ? executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
      : undefined
    if (!executorId || !executor || (executor.status !== 'online' && !getManagedCloudGate().isManagedExecutor(executor))) {
      await persistWorkspacePreparationUnavailableStatus({
        project: params.project,
        task: params.task,
        workspace: params.workspace,
        session: params.session,
      })
      return
    }

    if (executor.status !== 'online') {
      const startResult = await ensureWorkspacePreparationExecutorOnline({
        state: params.state,
        project: params.project,
        task: params.task,
        workspace: params.workspace,
        session: params.session,
        executorId,
        stopIfSuperseded,
      })
      if (startResult !== 'online') {
        return
      }
    }

    if (stopIfSuperseded()) {
      return
    }

    const effectiveSession = applyWorkspaceCodeStateToSession(
      resolveEffectiveWorkspaceWorktreeSession(params.task.id, params.session),
      params.workspace,
    )
    const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(params.workspace, effectiveSession)
    const workspaceRoot = executor.workspaceRoot || params.state.config.workspaceRoot
    const repoPath = resolveWorkspaceRepoPath({
      project: params.project,
      workspaceRoot,
      workspace: params.workspace,
      session: params.session,
      bindingPathHint: listProjectBindings()
        .find((binding) => binding.projectId === params.project.id && binding.nodeId === executorId && binding.isActive)
        ?.pathHint,
    })
    const worktreePath = resolveWorkspaceSessionCwd(workspaceRoot, params.project, effectiveSession, params.workspace)
    if (!worktreePath) {
      await persistWorkspacePreparationStatus({
        project: params.project,
        task: params.task,
        workspace: params.workspace,
        session: params.session,
        step: '无法解析工作目录路径，请检查工作区配置。',
        status: 'error',
      })
      return
    }

    const baseBranch = resolveWorkspaceCodeBaseBranch(params.workspace, params.task.baseBranch || params.task.baseBranchHint || params.project.defaultBranch)
      || params.task.baseBranch?.trim()
      || params.task.baseBranchHint?.trim()
      || params.workspace.suggestedBaseBranch?.trim()
      || params.project.defaultBranch
    const workspaceCodeBranchName = resolveWorkspaceCodeBranchName({
      workspace: params.workspace,
      fallbackSession: effectiveSession,
      fallbackBaseBranch: baseBranch,
    })
    await persistWorkspacePreparationStatus({
      project: params.project,
      task: params.task,
      workspace: params.workspace,
      session: params.session,
      step: workingDirectoryMode === 'original-dir'
        ? '正在检查原始项目目录。'
        : `正在 fetch / pull base 分支：${baseBranch || '默认分支'}。`,
      status: 'executing',
    })
    if (workingDirectoryMode === 'worktree') {
      await persistWorkspacePreparationStatus({
        project: params.project,
        task: params.task,
        workspace: params.workspace,
        session: params.session,
        step: `正在创建 worktree：${workspaceCodeBranchName}。`,
        status: 'executing',
      })
    }

    if (stopIfSuperseded()) {
      return
    }

    let gitIdentity: TaskRuntimeGitIdentity | undefined
    if (params.project.versionControl !== 'none') {
      const identityResult = await resolveTaskGitIdentityDiagnostic(params.userId, params.project)
      if (!identityResult.ok) {
        await persistWorkspacePreparationStatus({
          project: params.project,
          task: params.task,
          workspace: params.workspace,
          session: params.session,
          step: identityResult.message,
          status: 'error',
        })
        return
      }
      gitIdentity = identityResult.identity
    }

    const runtimeEnvironment = await resolveScopedRuntimeEnvironment({
      projectId: params.project.id,
      workspaceId: params.workspace.id,
    }).then((result) => result?.payload).catch(() => undefined)
    const createResult = await executorWsService.requestWorktreeEnsure(executorId, {
      workspaceId: params.workspace.id,
      ownerUserId: params.workspace.ownerUserId ?? params.userId,
      repoPath: params.project.versionControl === 'none' ? undefined : repoPath,
      repoUrl: params.project.versionControl === 'none' ? undefined : (params.project.gitUrl?.trim() || undefined),
      preferredBranch: baseBranch,
      branchName: workspaceCodeBranchName,
      worktreePath,
      workingDirectoryMode,
      gitIdentity,
      runtimeEnvironment,
      onOperationEvent: ((event) => {
        if (params.shouldContinue?.() === false) {
          return
        }
        createWorkspaceOperationTimelineWriter({
          taskId: params.task.id,
          workspaceId: params.workspace.id,
          workspaceSessionId: params.session.id,
          turnId: resolveWorkspacePreparationTurnId(params.session.id, 2),
        })?.(event)
      }),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '工作目录准备失败。',
    }))
    const ensuredWorktreePath = createResult.ok && 'worktreePath' in createResult
      ? createResult.worktreePath?.trim() || worktreePath
      : worktreePath
    const directoryReady = createResult.ok
      ? await verifyWorkspaceDirectoryReady({
          executorId,
          cwd: ensuredWorktreePath,
          browseDirectory: executorWsService.requestDirectoryBrowse,
        })
      : null
    const preparationOk = createResult.ok && (directoryReady?.ok ?? true)
    const preparationMessage = createResult.ok && directoryReady && !directoryReady.ok
      ? directoryReady.message
      : createResult.message

    if (stopIfSuperseded()) {
      return
    }

    const latestState = loadState()
    const latestTask = shouldPersistTask
      ? latestState.tasks.find((item) => item.id === params.task.id) ?? params.task
      : params.task
    const latestWorkspace = getWorkspace(params.workspace.id) ?? params.workspace
    const latestSession = getWorkspaceSessionRecordForTaskContext(params.task.id, params.workspace.id, params.session.id) ?? params.session
    if (stopIfSuperseded()) {
      return
    }
    const updatedAt = new Date().toISOString()
    const nextTask: Task = {
      ...buildWorkspaceTaskExecutionView(latestTask, latestSession),
      updatedAt,
      logs: [...latestTask.logs, createExecutionLog(preparationOk ? 'system' : 'review', preparationMessage)],
    }
    const nextSession = saveWorkspaceDirectorySessions({
      task: latestTask,
      currentSession: latestSession,
      effectiveSession,
      patch: {
        executorNodeId: params.workspace.executorNodeId,
        runtimeOwnerExecutorId: params.workspace.executorNodeId,
        worktreeStatus: preparationOk ? 'created' : effectiveSession.worktreeStatus,
        agentRunningStatus: preparationOk ? 'idle' : 'error',
        runtimeStatus: preparationOk ? 'completed' : 'error',
        currentStep: preparationMessage,
        updatedAt,
        lastActiveAt: updatedAt,
      },
    })
    if (shouldPersistTask) {
      await saveTaskAndWait(nextTask)
    }

    const nextWorkspaceRepoPath = preparationOk
      ? resolveWorkspaceRepoPath({
          project: params.project,
          workspaceRoot,
          workspace: latestWorkspace,
          session: nextSession,
          bindingPathHint: listProjectBindings()
            .find((binding) => binding.projectId === params.project.id && binding.nodeId === executorId && binding.isActive)
            ?.pathHint,
        })
      : undefined
    saveWorkspace({
      ...latestWorkspace,
      repoPath: preparationOk ? nextWorkspaceRepoPath : latestWorkspace.repoPath,
      repoReady: preparationOk,
      status: preparationOk ? 'ready' : 'pending_repo',
      updatedAt,
    })

    await persistWorkspacePreparationStatus({
      project: params.project,
      task: nextTask,
      workspace: {
        ...latestWorkspace,
        repoPath: preparationOk ? nextWorkspaceRepoPath : latestWorkspace.repoPath,
        repoReady: preparationOk,
        status: preparationOk ? 'ready' : 'pending_repo',
        updatedAt,
      },
      session: nextSession,
      step: preparationOk
        ? (workingDirectoryMode === 'original-dir' ? '原始项目目录已就绪。' : 'worktree 准备完毕。')
        : preparationMessage,
      status: preparationOk ? 'complete' : 'error',
    })

    if (!preparationOk || stopIfSuperseded()) {
      return
    }

    scheduleTaskChatQueueDrain({
      taskId: params.task.id,
      workspaceId: params.workspace.id,
      workspaceSessionId: params.session.id,
    })
    void runWorkspaceCreateInstallCommand({
      project: params.project,
      task: nextTask,
      workspace: {
        ...latestWorkspace,
        repoPath: nextWorkspaceRepoPath,
        repoReady: true,
        status: 'ready',
        updatedAt,
      },
      session: nextSession,
      cwd: ensuredWorktreePath,
      executorId,
      runtimeEnvironment,
    }).catch((error) => {
      console.error('[workspace-create] background install command failed', error)
    })
    scheduleWorkspaceSessionQueuedTaskChatDrains({
      fallbackTaskId: params.task.id,
      workspaceId: params.workspace.id,
      workspaceSessionId: params.session.id,
    })
  } finally {
    finishWorkspacePreparationRun(params.workspace.id, params.runId)
  }
}

const startWorkspaceCreateInitialization = (params: {
  userId: string
  state: AppState
  project: Project
  task: Task
  workspace: WorkspaceRecord
  session: WorkspaceSession
  persistTask?: boolean
}) => {
  void autoImportProjectRuntimeEnvironment({
    project: params.project,
    executorId: params.workspace.executorNodeId,
    repoPath: params.workspace.repoPath,
    logContext: 'workspace-create',
  }).then(() => runWorkspaceBackgroundPreparation(params)).catch(async (error) => {
    console.error('[workspace-create] background initialization failed', error)
    const message = error instanceof Error ? error.message : '工作区后台初始化失败。'
    const updatedAt = new Date().toISOString()
    const latestWorkspace = getWorkspace(params.workspace.id) ?? params.workspace
    const latestSession = getWorkspaceSessionRecordForTaskContext(params.task.id, params.workspace.id, params.session.id) ?? params.session
    const failedWorkspace: WorkspaceRecord = {
      ...latestWorkspace,
      repoReady: false,
      status: 'pending_repo',
      updatedAt,
    }
    const failedSession: WorkspaceSession = {
      ...latestSession,
      agentRunningStatus: 'error',
      runtimeStatus: 'error',
      currentStep: message,
      updatedAt,
      lastActiveAt: updatedAt,
    }
    saveWorkspace(failedWorkspace)
    await saveWorkspaceSessionAndWait(failedSession)
    await persistWorkspacePreparationStatus({
      project: params.project,
      task: params.task,
      workspace: failedWorkspace,
      session: failedSession,
      step: message,
      status: 'error',
    }).catch((persistError) => {
      console.error('[workspace-create] persist background initialization failure failed', persistError)
    })
  })
}

const startWorkspaceCreateTitleSuggestion = (params: {
  workspace: WorkspaceRecord
  session: WorkspaceSession
  initialPrompt: string
  imageFilename?: string
  imageDataUrl?: string
}) => {
  void suggestWorkspaceTitleWithDeepSeek({
    initialPrompt: params.initialPrompt,
    imageFilename: params.imageFilename,
    imageDataUrl: params.imageDataUrl,
    fallbackTitle: params.workspace.name,
  }).then((result) => {
    const suggestedTitle = result.title?.trim() || ''
    if (result.source !== 'ai' || !suggestedTitle || suggestedTitle === params.workspace.name) {
      return
    }

    const latestWorkspace = getWorkspace(params.workspace.id)
    const latestSession = loadState().workspaceSessions.find((item) => item.id === params.session.id)
    if (!latestWorkspace || latestWorkspace.name !== params.workspace.name) {
      return
    }

    const updatedAt = new Date().toISOString()
    saveWorkspace({ ...latestWorkspace, name: suggestedTitle, updatedAt })
    if (latestSession && latestSession.titleOrigin === 'system' && latestSession.title === params.session.title) {
      saveWorkspaceSession({
        ...latestSession,
        title: suggestedTitle,
        titleOrigin: 'ai',
        updatedAt,
      })
    }
  }).catch((error) => {
    console.error('[workspace-create] background title suggestion failed', error)
  })
}

const startWorkspaceExecutorSwitchPreparation = (params: {
  userId: string
  state: AppState
  project: Project
  task: Task
  workspace: WorkspaceRecord
  session: WorkspaceSession
}) => {
  const runId = beginWorkspacePreparationRun(params.workspace.id, params.workspace.executorNodeId)
  const supersededMessage = buildWorkspacePreparationSupersededMessage(params.workspace.executorNodeId)

  void runWorkspaceBackgroundPreparation({
    ...params,
    runId,
    supersededMessage,
    shouldContinue: () => isWorkspacePreparationRunCurrent({
      workspaceId: params.workspace.id,
      taskId: params.task.id,
      workspaceSessionId: params.session.id,
      executorNodeId: params.workspace.executorNodeId,
      runId,
    }),
  }).catch((error) => {
    console.error('[workspace-switch] background worktree preparation failed', error)
  })
}

const resolveProjectRepositoryWorkspaceBlockMessage = (project: Project) => {
  if (project.repositoryCloneStatus === 'cloning') {
    return '项目仓库仍在执行节点上克隆，请等待完成后再创建工作区。'
  }

  if (project.repositoryCloneStatus === 'failed') {
    return project.repositoryCloneMessage?.trim()
      ? `项目仓库克隆失败：${project.repositoryCloneMessage}`
      : '项目仓库克隆失败，请先修复项目仓库后再创建工作区。'
  }

  return ''
}

export const registerWorkspaceManagementRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/workspace-session-unread-state', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    return c.json({
      snapshot: getWorkspaceSessionUnreadStoreSnapshotForUser(userId),
    })
  })

  app.put('/api/workspace-session-unread-state', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceSessionUnreadStoreSnapshotSchema.parse(await c.req.json().catch(() => ({})))

    const result = saveWorkspaceSessionUnreadStoreSnapshotForUser(userId, payload)

    return c.json({
      applied: result.applied,
      updatedAt: result.snapshot.updatedAt,
    })
  })

  app.post('/api/projects/:id/workspace-title-suggestion', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceTitleSuggestionSchema.parse(await c.req.json().catch(() => ({})))
    const fallbackTitle = buildWorkspaceTitleFallback(payload.initialPrompt, payload.imageFilename, payload.fallbackTitle)
    const fallbackResponse = (reason: string, message?: string) => c.json({
      ok: true,
      title: fallbackTitle,
      source: 'fallback' as const,
      reason,
      message,
    })
    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const project = scopedState.projects.find((item) => item.id === c.req.param('id'))
    if (!project) {
      return c.json({ message: '项目不存在或无权访问。' }, 404)
    }

    const initialPrompt = payload.initialPrompt.trim()
    if (!initialPrompt) {
      return fallbackResponse('empty_prompt')
    }

    if (!payload.executorNodeId) {
      return fallbackResponse('missing_executor')
    }

    let resolvedExecutorNodeId = payload.executorNodeId
    try {
      resolvedExecutorNodeId = await resolveWorkspaceExecutorNodeId({
        state,
        userId,
        projectWorkspaceId: project.workspaceId,
        executorNodeId: payload.executorNodeId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '官方云节点暂不可用。'
      if (getManagedCloudGate().isUsageLimitError(error)) {
        return c.json({
          ok: true,
          title: fallbackTitle,
          source: 'fallback' as const,
          reason: 'executor_unavailable',
          message,
        }, 402)
      }

      return fallbackResponse('executor_unavailable', message)
    }

    const executorAccess = canUserUseExecutorForProject({ userId, projectId: project.id, executorId: resolvedExecutorNodeId })
    if (!executorAccess.ok) {
      return fallbackResponse('executor_forbidden', executorAccess.message)
    }

    const result = await suggestWorkspaceTitleWithDeepSeek({
      initialPrompt,
      imageFilename: payload.imageFilename,
      imageDataUrl: payload.imageDataUrl,
      fallbackTitle,
    })
    return c.json({
      ok: true,
      title: result.title,
      source: result.source,
      model: result.model,
      fallbackTitle,
      reason: result.reason,
      message: result.message,
    })
  })

  app.post('/api/projects/:id/workspaces', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      executorNodeId: z.string().trim().optional(),
      agentType: serverAgentTypeSchema.optional(),
      executionModel: z.string().trim().optional(),
      agentSettings: z.record(z.unknown()).optional(),
      name: z.string().trim().min(1),
      initialPrompt: z.string().trim().optional(),
      imageFilename: z.string().trim().optional(),
      imageDataUrl: z.string().trim().optional(),
      workingDirectoryMode: z.enum(['worktree', 'original-dir']).optional().default('worktree'),
      autoCommitEnabled: z.boolean().optional(),
      suggestedBaseBranch: z.string().trim().optional(),
      taskId: z.string().trim().min(1).optional(),
      nameOrigin: z.enum(['system', 'ai', 'manual']).optional(),
      titleOrigin: z.enum(['system', 'ai', 'manual']).optional(),
      deferInitialization: z.boolean().optional().default(false),
    }).parse(await c.req.json())
    const state = loadState()
    const scopedState = getScopedState(state, userId)
    // playground 虚拟项目被 scopedState 隐藏，但允许通过 /api/projects/__playground__/workspaces 创建无项目工作区
    const requestedProjectId = c.req.param('id')
    const project = isPlaygroundProjectId(requestedProjectId)
      ? ensurePlaygroundProject()
      : scopedState.projects.find((item) => item.id === requestedProjectId)
    if (!project) {
      return c.json({ message: '项目不存在或无权访问。' }, 404)
    }
    const projectRepositoryBlockMessage = resolveProjectRepositoryWorkspaceBlockMessage(project)
    if (projectRepositoryBlockMessage) {
      return c.json({ message: projectRepositoryBlockMessage }, 409)
    }

    const workspaceExecutionDefaults = state.config.workspaceExecutionDefaults
    let requestedExecutorNodeId = payload.executorNodeId?.trim() || workspaceExecutionDefaults.executorNodeId?.trim() || ''
    if (!requestedExecutorNodeId) {
      // 默认节点策略：本地在线优先，无在线本地节点时回退云节点（由 resolveWorkspaceExecutorNodeId 复用同一段云节点路径）。
      requestedExecutorNodeId = resolveDefaultWorkspaceExecutorId({
        visibleExecutors: listVisibleExecutorsForUser(userId),
        preferredExecutorId: project.preferredExecutorId,
      }) ?? MANAGED_CLOUD_AUTO_EXECUTOR_ID
    }
    const effectiveAgentType = payload.agentType ?? workspaceExecutionDefaults.agentType
    const effectiveExecutionModel = payload.executionModel?.trim()
      || (effectiveAgentType === workspaceExecutionDefaults.agentType ? workspaceExecutionDefaults.executionModel : undefined)

    let resolvedExecutorNodeId = requestedExecutorNodeId
    try {
      resolvedExecutorNodeId = await resolveWorkspaceExecutorNodeId({
        state,
        userId,
        projectWorkspaceId: project.workspaceId,
        executorNodeId: requestedExecutorNodeId,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '官方云节点暂不可用。' }, getManagedCloudGate().isUsageLimitError(error) ? 402 : 400)
    }

    const executorAccess = canUserUseExecutorForProject({ userId, projectId: project.id, executorId: resolvedExecutorNodeId })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    const effectiveWorkingDirectoryMode = project.versionControl === 'none' ? 'original-dir' : payload.workingDirectoryMode
    const suggestedBaseBranch = effectiveWorkingDirectoryMode === 'original-dir'
      ? undefined
      : payload.suggestedBaseBranch
    let workspaceName = payload.name
    let workspaceTitleOrigin = payload.titleOrigin ?? payload.nameOrigin ?? 'system'
    const workspaceTitlePrompt = payload.initialPrompt?.trim() || payload.name
    const shouldSuggestWorkspaceName = (payload.nameOrigin ?? payload.titleOrigin ?? 'system') === 'system' && Boolean(workspaceTitlePrompt.trim())
    if (shouldSuggestWorkspaceName && !payload.deferInitialization) {
      const titleSuggestion = await suggestWorkspaceTitleWithDeepSeek({
        initialPrompt: workspaceTitlePrompt,
        imageFilename: payload.imageFilename,
        imageDataUrl: payload.imageDataUrl,
        fallbackTitle: payload.name,
      })
      workspaceName = titleSuggestion.title || payload.name
      workspaceTitleOrigin = titleSuggestion.source === 'ai' ? 'ai' : 'system'
    }

    const workspace = createWorkspaceRecord(
      project,
      resolvedExecutorNodeId,
      executorAccess.executor.name,
      workspaceName,
      userId,
      effectiveAgentType,
      effectiveWorkingDirectoryMode,
      suggestedBaseBranch,
      payload.autoCommitEnabled,
      resolveNextDisplayOrder(listProjectWorkspacesForUser(userId, project)),
      { workspaceRoot: executorAccess.executor.workspaceRoot },
    )
    const repoPath = resolveWorkspaceRepoPath({
      project,
      workspaceRoot: executorAccess.executor.workspaceRoot,
      workspace,
      bindingPathHint: listProjectBindings().find((binding) => binding.projectId === project.id && binding.nodeId === resolvedExecutorNodeId && binding.isActive)?.pathHint,
    })
    const savedWorkspaceRecord: WorkspaceRecord = {
      ...workspace,
      defaultBranch: workspace.defaultBranch || project.defaultBranch,
      repoPath,
      repoReady: Boolean(repoPath),
      status: repoPath ? 'ready' as const : workspace.status,
      workingDirectoryMode: effectiveWorkingDirectoryMode,
      autoCommitEnabled: resolveWorkspaceAutoCommitEnabled({
        workingDirectoryMode: effectiveWorkingDirectoryMode,
        autoCommitEnabled: payload.autoCommitEnabled ?? workspace.autoCommitEnabled,
      }),
    } as WorkspaceRecord
    // Creation is a durable lifecycle boundary: the workspace and its default
    // session must both be in Postgres before the client navigates to them.
    await saveWorkspaceAndWait(savedWorkspaceRecord)
    const savedWorkspace: Workspace = {
      ...savedWorkspaceRecord,
      executorName: executorAccess.executor.name,
      executorStatus: executorAccess.executor.status === 'online' ? 'online' : executorAccess.executor.status === 'paired' ? 'paired' : 'offline',
    }
    let workspaceSessionTask: Task | null = null
    let persistedWorkspaceSessionTask: Task | null = null
    let workspaceSession: WorkspaceSession | null = null
    if (payload.taskId) {
      const existingTask = scopedState.tasks.find((item) => item.id === payload.taskId && item.projectId === project.id) ?? null
      if (!existingTask) {
        return c.json({ message: '任务不存在或无权访问。' }, 404)
      }
      if (existingTask.requirementType === 'requirement') {
        return c.json({ message: '需求项暂不支持创建工作区会话，请先转成可执行任务。' }, 400)
      }
      const bindingState = ensureTaskWorkspaceBindingState({
        task: existingTask,
        workspaceId: savedWorkspaceRecord.id,
        updatedAt: new Date().toISOString(),
      })
      workspaceSessionTask = bindingState.task
      persistedWorkspaceSessionTask = bindingState.task
    }
    workspaceSession = workspaceSessionTask
      ? applyWorkspaceCodeStateToSession(ensureWorkspaceSessionRecord({
          task: workspaceSessionTask,
          workspaceId: savedWorkspaceRecord.id,
          executorNodeId: savedWorkspaceRecord.executorNodeId,
          workspace: savedWorkspaceRecord,
          title: savedWorkspaceRecord.name,
          titleOrigin: resolveInitialWorkspaceSessionTitleOrigin(workspaceTitleOrigin),
          workingDirectoryMode: effectiveWorkingDirectoryMode,
        }), savedWorkspaceRecord)
      : applyWorkspaceCodeStateToSession(createWorkspaceSession({
          workspaceId: savedWorkspaceRecord.id,
          executorNodeId: savedWorkspaceRecord.executorNodeId,
          workspaceName: savedWorkspaceRecord.name,
          title: savedWorkspaceRecord.name,
          titleOrigin: resolveInitialWorkspaceSessionTitleOrigin(workspaceTitleOrigin),
          agentType: effectiveAgentType,
          executionModel: effectiveExecutionModel,
          baseBranch: savedWorkspaceRecord.suggestedBaseBranch || project.defaultBranch,
          workingDirectoryMode: effectiveWorkingDirectoryMode,
          displayOrder: resolveNextWorkspaceSessionDisplayOrder(
            listWorkspaceSessionRecordsForWorkspace(savedWorkspaceRecord.id),
          ),
        }), savedWorkspaceRecord)
    await saveWorkspaceSessionAndWait(workspaceSession)
    if (payload.agentSettings) {
      workspaceSession = {
        ...workspaceSession,
        agentSettings: payload.agentSettings as unknown as AgentRuntimeSettings,
        updatedAt: new Date().toISOString(),
      }
      await saveWorkspaceSessionAndWait(workspaceSession)
    }
    const initialization = resolveWorkspaceCreateInitialization({
      state: loadState(),
      project,
      workspace: savedWorkspaceRecord,
      session: workspaceSession,
      persistedTask: persistedWorkspaceSessionTask,
    })
    startWorkspaceCreateInitialization({
      userId,
      state: loadState(),
      project,
      task: initialization.task,
      workspace: savedWorkspaceRecord,
      session: workspaceSession,
      persistTask: initialization.persistTask,
    })
    if (shouldSuggestWorkspaceName && payload.deferInitialization) {
      startWorkspaceCreateTitleSuggestion({
        workspace: savedWorkspaceRecord,
        session: workspaceSession,
        initialPrompt: workspaceTitlePrompt,
        imageFilename: payload.imageFilename,
        imageDataUrl: payload.imageDataUrl,
      })
    }
    const message = effectiveWorkingDirectoryMode === 'original-dir'
      ? `已创建工作区 ${savedWorkspace.name}，后续会直接复用原始目录。`
      : savedWorkspace.repoPath
        ? `已创建工作区 ${savedWorkspace.name}，并复用当前工作站上的项目目录。`
        : `已创建工作区 ${savedWorkspace.name}。`

    return c.json({
      state: upsertWorkspaceSessionInState({
        ...getScopedState(loadState(), userId),
      }, workspaceSession),
      workspace: savedWorkspace,
      workspaces: listProjectWorkspacesForUser(userId, project),
      workspaceSessionId: workspaceSession.id,
      workspaceSession,
      taskId: persistedWorkspaceSessionTask?.id,
      task: persistedWorkspaceSessionTask ?? undefined,
      workspaceTitleOrigin,
      message,
    })
  })

  app.post('/api/workspaces/:id/sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceSessionCreateSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId)
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, scopedState, project, scopedWorkspace } = context
    const projectRepositoryBlockMessage = resolveProjectRepositoryWorkspaceBlockMessage(project)
    if (projectRepositoryBlockMessage) {
      return c.json({ message: projectRepositoryBlockMessage }, 409)
    }

    const now = new Date().toISOString()
    const workspaceSessionState = state.workspaceSessions
    const existingSession = payload.createNewSession
      ? null
      : sortWorkspaceSessions(workspaceSessionState.filter((session) => (
          session.workspaceId === workspace.id
          && session.status !== 'archived'
          && (!payload.workspaceSessionId || session.id === payload.workspaceSessionId)
        )))[0] ?? null
    const workspaceSessions = workspaceSessionState.filter((session) => session.workspaceId === workspace.id)
    const session = existingSession ?? createWorkspaceSession({
      workspaceId: workspace.id,
      displayOrder: resolveNextWorkspaceSessionDisplayOrder(workspaceSessions),
      executorNodeId: workspace.executorNodeId,
      worktreeUniqueId: allocateWorkspaceWorktreeUniqueId(workspace.executorNodeId),
      workspaceName: workspace.name,
      agentType: payload.agentType ?? workspace.agentType,
      executionModel: payload.executionModel,
      baseBranch: workspace.suggestedBaseBranch || project.defaultBranch,
      title: payload.title ?? (workspaceSessions.length === 0 ? DEFAULT_WORKSPACE_SESSION_TITLE : `会话 ${workspaceSessions.length + 1}`),
      titleOrigin: payload.titleOrigin as WorkspaceSession['titleOrigin'] | undefined,
      workingDirectoryMode: workspace.workingDirectoryMode,
    })
    const nextSession: WorkspaceSession = applyWorkspaceSessionCreatePayload({
      session,
      workspace,
      project,
      now,
      payload: {
        agentSettings: payload.agentSettings,
        baseBranch: payload.baseBranch,
        title: payload.title,
        titleOrigin: payload.titleOrigin as WorkspaceSession['titleOrigin'] | undefined,
      },
    })
    await saveWorkspaceSessionAndWait(nextSession)

    // 调度大脑（feature）：新建且无 Agent 认领的会话 → 旁路发布 review 事件（有 Agent 会话不打扰）
    // 注意：workspaceId 是执行工作区（WorkspaceRecord），大脑按 project.workspaceId（collab 工作区）定位
    if (payload.createNewSession !== false && !nextSession.customAgentId?.trim()) {
      void publishWorkspaceBrainReview({
        kind: 'workspace.session.created',
        projectId: project.id,
        actingUserId: userId,
        actor: { type: 'user', id: userId },
        eventKey: `session:${nextSession.id}`,
        session: {
          id: nextSession.id,
          title: nextSession.title,
          status: nextSession.status,
          customAgentId: nextSession.customAgentId,
        },
      })
    }

    const nextState = upsertWorkspaceSessionInState({
      ...state,
      selectedProjectId: project.id,
    }, nextSession)

    const response = await withState(
      withClusterState(nextState),
      payload.createNewSession === false ? '已准备工作区会话。' : '已新建工作区会话。',
      userId,
      { includeResources: false },
    )
    return c.json({
      ...response,
      taskId: undefined,
      task: undefined,
      workspaceId: workspace.id,
      workspace: scopedWorkspace,
      workspaces: listProjectWorkspacesForUser(userId, project),
      workspaceSessionId: nextSession.id,
      workspaceSession: nextSession,
    })
  })

  app.delete('/api/workspaces/:id/sessions/:sessionId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const workspaceId = c.req.param('id').trim()
    const sessionId = c.req.param('sessionId').trim()
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { project, scopedWorkspace } = context

    const workspaceSessionState = state.workspaceSessions
    const currentSession = workspaceSessionState.find((session) => (
      session.id === sessionId
      && session.workspaceId === workspaceId
      && session.status !== 'archived'
    ))
    if (!currentSession) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const workspaceSessions = sortWorkspaceSessions(workspaceSessionState.filter((session) => (
      session.workspaceId === workspaceId
      && session.status !== 'archived'
    )))
    if (workspaceSessions.length <= 1) {
      return c.json({ message: '当前工作区至少需要保留一个会话，不能删除最后一个会话。' }, 409)
    }

    const dependentSession = workspaceSessions.find((session) => {
      if (session.id === currentSession.id) {
        return false
      }

      return session.parentSessionId === currentSession.id
        || session.rootSessionId === currentSession.id
        || session.forkedFromSessionId === currentSession.id
        || session.sharedWorktreeSourceSessionId === currentSession.id
    })
    if (dependentSession) {
      return c.json({ message: `会话「${dependentSession.title}」仍依赖当前会话，请先处理这些子会话。` }, 409)
    }

    const effectiveRuntimeStatus = resolveEffectiveWorkspaceRuntimeStatus(currentSession)
    if (
      isWorkspaceSessionExecutionActive(workspaceId, currentSession.id)
      || effectiveRuntimeStatus === 'running'
      || effectiveRuntimeStatus === 'waiting'
    ) {
      return c.json({ message: '当前会话仍在运行中，请先等待完成或停止后再删除。' }, 409)
    }

    // 会话删除是最高优先级：先清空该会话的排队消息，再删除会话本身。
    await removeTaskChatQueueEntriesForWorkspaceSession({
      workspaceId,
      workspaceSessionId: currentSession.id,
    })

    const conversations = listConversations().filter((conversation) => (
      conversation.kind === 'task'
      && conversation.workspaceId === workspaceId
      && conversation.workspaceSessionId === currentSession.id
    ))
    for (const conversation of conversations) {
      deleteConversation(conversation.id)
    }

    deleteWorkspaceSessions({
      workspaceIds: [workspaceId],
      sessionIds: [currentSession.id],
    })

    const nextState: AppState = {
      ...state,
      workspaceSessions: workspaceSessionState.filter((session) => session.id !== currentSession.id),
    }
    const nextWorkspaceSession = workspaceSessions.find((session) => session.id !== currentSession.id) ?? null
    const response = await withState(withClusterState(nextState), `已删除会话 ${currentSession.title}。`, userId)

    return c.json({
      ...response,
      workspaceId,
      workspace: scopedWorkspace,
      workspaces: listProjectWorkspacesForUser(userId, project),
      workspaceSessionId: nextWorkspaceSession?.id,
    })
  })

  app.post('/api/workspaces/:id/sessions/reorder', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceSessionReorderSchema.parse(await c.req.json())
    const state = loadState()
    const workspaceId = c.req.param('id').trim()
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const workspaceSessionState = state.workspaceSessions
    const workspaceSessions = sortWorkspaceSessions(workspaceSessionState.filter((session) => (
      session.workspaceId === workspaceId
      && session.status !== 'archived'
    )))
    if (workspaceSessions.length <= 1) {
      const response = await withState(withClusterState(state), '当前无需调整会话顺序。', userId)
      return c.json({
        ...response,
        workspaceId,
        workspace: scopedWorkspace,
        workspaceSessions,
      })
    }

    const expectedSessionIds = new Set(workspaceSessions.map((session) => session.id))
    const orderedSessionIds = payload.orderedSessionIds.map((sessionId) => sessionId.trim())
    const providedSessionIds = new Set(orderedSessionIds)
    if (
      orderedSessionIds.length !== workspaceSessions.length
      || providedSessionIds.size !== workspaceSessions.length
      || orderedSessionIds.some((sessionId) => !expectedSessionIds.has(sessionId))
    ) {
      return c.json({ message: '会话顺序参数无效。' }, 400)
    }

    const updatedAt = new Date().toISOString()
    const displayOrderBySessionId = new Map(orderedSessionIds.map((sessionId, index) => [sessionId, index]))
    const nextSessions = workspaceSessions.map((session) => mergeWorkspaceSession(undefined, session, {
      displayOrder: displayOrderBySessionId.get(session.id),
      updatedAt,
      lastActiveAt: session.lastActiveAt,
    }))
    const nextSessionById = new Map(nextSessions.map((session) => [session.id, session]))
    const nextWorkspaceSessions = workspaceSessionState.map((session) => nextSessionById.get(session.id) ?? session)

    for (const nextSession of nextSessions) {
      await saveWorkspaceSessionAndWait(nextSession)
    }

    const nextState: AppState = {
      ...state,
      workspaceSessions: nextWorkspaceSessions,
    }
    const response = await withState(withClusterState(nextState), '会话顺序已更新。', userId)
    return c.json({
      ...response,
      workspaceId,
      workspace: scopedWorkspace,
      workspaceSessions: nextSessions,
    })
  })

  app.post('/api/workspaces/:id/sessions/:sessionId/pin', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceSessionPinSchema.parse(await c.req.json())
    const state = loadState()
    const workspaceId = c.req.param('id').trim()
    const sessionId = c.req.param('sessionId').trim()
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const workspaceSessionState = state.workspaceSessions
    const workspaceSession = workspaceSessionState.find((session) => (
      session.id === sessionId
      && session.workspaceId === workspaceId
      && session.status !== 'archived'
    ))
    if (!workspaceSession) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const updatedAt = new Date().toISOString()
    const pinnedSession = setWorkspaceSessionPinned(workspaceSession, payload.pinned, updatedAt)
    const nextSession = mergeWorkspaceSession(undefined, pinnedSession, {
      updatedAt,
      lastActiveAt: workspaceSession.lastActiveAt,
    })
    await saveWorkspaceSessionAndWait(nextSession)

    const nextWorkspaceSessions = workspaceSessionState.map((session) => (
      session.id === nextSession.id ? nextSession : session
    ))
    const nextState: AppState = {
      ...state,
      workspaceSessions: nextWorkspaceSessions,
    }
    const response = await withState(withClusterState(nextState), payload.pinned ? '会话已置顶。' : '会话已取消置顶。', userId)
    return c.json({
      ...response,
      workspaceId,
      workspace: scopedWorkspace,
      workspaceSessionId: nextSession.id,
      workspaceSession: nextSession,
    })
  })

  app.post('/api/workspaces/:id/sessions/:sessionId/fork', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceSessionForkSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const workspaceId = c.req.param('id').trim()
    const sourceSessionId = c.req.param('sessionId').trim()
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const sourceSession = state.workspaceSessions.find((session) => (
      session.id === sourceSessionId
      && session.workspaceId === workspaceId
      && session.status !== 'archived'
    ))
    if (!sourceSession) {
      return c.json({ message: '源会话不存在。' }, 404)
    }

    const task = resolveWorkspaceSessionTaskContext({
      state,
      project,
      workspace: scopedWorkspace,
      session: sourceSession,
      requestedTaskId: payload.taskId,
    })
    if (!task) {
      return c.json({ message: '当前会话缺少可用于分叉的任务上下文。' }, 409)
    }

    const forkWorkspaceResult = payload.mode === 'worktree'
      ? createForkWorkspaceRecord({
          project,
          sourceWorkspace: scopedWorkspace,
          sourceSession,
          userId,
          title: payload.title,
        })
      : null
    if (forkWorkspaceResult && !forkWorkspaceResult.ok) {
      return c.json({ message: forkWorkspaceResult.message }, 403)
    }

    const targetWorkspace = forkWorkspaceResult?.ok ? forkWorkspaceResult.workspace : workspace
    if (forkWorkspaceResult?.ok) {
      saveWorkspace(forkWorkspaceResult.workspace)
    }

    const sourceBinding = state.taskWorkspaceBindings.find((binding) => (
      binding.workspaceId === sourceSession.workspaceId
      && binding.taskId === task.id
      && binding.status === 'active'
    ))
    const bindingState = sourceBinding && task.id === sourceBinding.taskId
      ? ensureTaskWorkspaceBindingState({
          task,
          workspaceId: targetWorkspace.id,
          updatedAt: new Date().toISOString(),
        })
      : null
    const pendingRevision = payload.revision
      ? {
          kind: payload.revision.kind,
          sourceTurnId: payload.revision.sourceTurnId,
          sourceUserMessageId: payload.revision.sourceUserMessageId,
          sourceAssistantMessageId: payload.revision.sourceAssistantMessageId,
        }
      : undefined
    const forkTitle = buildForkWorkspaceSessionTitle(sourceSession, payload.title)
    const ensuredSession = bindingState
      ? ensureWorkspaceSessionRecord({
          task: bindingState.task,
          workspaceId: targetWorkspace.id,
          executorNodeId: targetWorkspace.executorNodeId,
          workspace: targetWorkspace,
          createNewSession: true,
          title: forkTitle,
          titleOrigin: payload.title?.trim() ? 'manual' : 'system',
          sessionKind: 'primary',
          sessionRole: sourceSession.sessionRole,
          sessionOrigin: 'fork',
          parentSessionId: sourceSession.id,
          rootSessionId: sourceSession.rootSessionId || sourceSession.id,
          forkMode: payload.mode,
          forkedFromSessionId: sourceSession.id,
          forkedFromMessageId: payload.sourceMessageId,
          forkRevision: pendingRevision,
          pendingRevision,
          sharedWorktreeSourceSessionId: payload.mode === 'local'
            ? (sourceSession.sharedWorktreeSourceSessionId || sourceSession.id)
            : undefined,
          workingDirectoryMode: sourceSession.workingDirectoryMode,
        })
      : applyWorkspaceCodeStateToSession(createWorkspaceSession({
          workspaceId: targetWorkspace.id,
          displayOrder: resolveNextWorkspaceSessionDisplayOrder(
            state.workspaceSessions.filter((session) => session.workspaceId === targetWorkspace.id),
          ),
          executorNodeId: targetWorkspace.executorNodeId,
          workspaceName: targetWorkspace.name,
          agentType: sourceSession.agentType ?? task.agentType,
          executionModel: sourceSession.executionModel,
          opencodeConfig: sourceSession.opencodeConfig,
          gitIdentityMode: sourceSession.gitIdentityMode,
          baseBranch: sourceSession.baseBranch,
          title: forkTitle,
          titleOrigin: payload.title?.trim() ? 'manual' : 'system',
          sessionKind: 'primary',
          sessionRole: sourceSession.sessionRole,
          sessionOrigin: 'fork',
          parentSessionId: sourceSession.id,
          rootSessionId: sourceSession.rootSessionId || sourceSession.id,
          forkMode: payload.mode,
          forkedFromSessionId: sourceSession.id,
          forkedFromMessageId: payload.sourceMessageId,
          forkRevision: pendingRevision,
          pendingRevision,
          sharedWorktreeSourceSessionId: payload.mode === 'local'
            ? (sourceSession.sharedWorktreeSourceSessionId || sourceSession.id)
            : undefined,
          workingDirectoryMode: sourceSession.workingDirectoryMode,
          worktreeUniqueId: allocateWorkspaceWorktreeUniqueId(targetWorkspace.executorNodeId),
        }), targetWorkspace)

    const now = new Date().toISOString()
    const sessionTask = bindingState?.task ?? task
    const forkedSession = mergeWorkspaceSession(sessionTask, ensuredSession, {
      title: forkTitle,
      titleOrigin: payload.title?.trim() ? 'manual' : 'system',
      sessionKind: 'primary',
      sessionRole: sourceSession.sessionRole,
      sessionOrigin: 'fork',
      parentSessionId: sourceSession.id,
      rootSessionId: sourceSession.rootSessionId || sourceSession.id,
      forkMode: payload.mode,
      forkedFromSessionId: sourceSession.id,
      forkedFromMessageId: payload.sourceMessageId,
      forkRevision: pendingRevision,
      pendingRevision,
      sharedWorktreeSourceSessionId: payload.mode === 'local'
        ? (sourceSession.sharedWorktreeSourceSessionId || sourceSession.id)
        : undefined,
      executorNodeId: resolveWorkspaceSessionExecutorId(sourceSession, targetWorkspace.executorNodeId),
      runtimeOwnerExecutorId: resolveWorkspaceSessionExecutorId(sourceSession, targetWorkspace.executorNodeId),
      agentType: sourceSession.agentType ?? sessionTask.agentType,
      customAgentId: sourceSession.customAgentId,
      customAgentName: sourceSession.customAgentName,
      agentInvocationMode: sourceSession.agentInvocationMode,
      mountedSkillNames: sourceSession.mountedSkillNames ?? [],
      mountedMcpServerNames: sourceSession.mountedMcpServerNames ?? [],
      enabledMcpServerIds: sourceSession.enabledMcpServerIds,
      delegatedPrompt: undefined,
      executionModel: sourceSession.executionModel,
      agentSettings: sourceSession.agentSettings,
      opencodeConfig: sourceSession.opencodeConfig,
      gitIdentityMode: sourceSession.gitIdentityMode,
      baseBranch: sourceSession.baseBranch,
      workingDirectoryMode: sourceSession.workingDirectoryMode,
      needsHumanConfirm: false,
      agentRunningStatus: 'idle',
      currentStep: payload.mode === 'local'
        ? '已从历史消息分叉，继续复用当前 worktree。'
        : '已从历史消息分叉，新 worktree 会在首次准备时创建。',
      updatedAt: now,
      lastActiveAt: now,
      worktreeId: payload.mode === 'local' ? sourceSession.worktreeId : ensuredSession.worktreeId,
      worktreeUniqueId: payload.mode === 'local' ? sourceSession.worktreeUniqueId : ensuredSession.worktreeUniqueId,
      branchName: payload.mode === 'local' ? sourceSession.branchName : ensuredSession.branchName,
      worktreeStatus: payload.mode === 'local' ? sourceSession.worktreeStatus : 'planned',
      distributedTaskId: undefined,
      agentSessionId: undefined,
      opencodeSessionId: undefined,
    })

    const forkResult = forkTaskConversationUntilMessage({
      task,
      project,
      sourceWorkspaceId: workspaceId,
      sourceWorkspaceSessionId: sourceSession.id,
      targetWorkspaceId: targetWorkspace.id,
      targetWorkspaceSessionId: forkedSession.id,
      sourceMessageId: payload.sourceMessageId,
    })
    if (!forkResult) {
      return c.json({ message: '分叉锚点消息不存在。' }, 404)
    }

    appendTaskConversationMessage({
      task,
      project,
      workspaceId: targetWorkspace.id,
      workspaceSessionId: forkedSession.id,
      role: 'system',
      content: [
        payload.revision
          ? `已从会话「${sourceSession.title}」创建修订分叉。`
          : `已从会话「${sourceSession.title}」创建分叉。`,
        `模式：${payload.mode === 'local' ? '派生到本地（共享 worktree）' : '派生到新工作树'}`,
        `历史：已复制截止锚点消息为止的 ${forkResult.sourceMessageCount} 条消息。`,
        payload.revision ? `修订类型：${payload.revision.kind === 'rewrite-user-turn' ? '改写用户问题' : '重试助手回复'}` : '说明：这是一次普通分叉。',
        '说明：这次分叉只截断聊天上下文，不会把磁盘回滚到历史时刻；新会话基于当前磁盘状态继续。',
      ].join('\n'),
      contentType: 'markdown',
      externalRef: {
        forkSession: {
          sourceSessionId: sourceSession.id,
          sourceMessageId: payload.sourceMessageId,
          mode: payload.mode,
        },
      },
    })

    await saveWorkspaceSessionAndWait(forkedSession)
    const nextTask = bindingState
      ? {
          ...bindingState.task,
          logs: bindingState.task.logs.some((log) => log.workspaceId === targetWorkspace.id)
            ? bindingState.task.logs
            : [
                ...bindingState.task.logs,
                createExecutionLog('system', `已关联工作区 ${targetWorkspace.name}。`, targetWorkspace.id),
              ],
          updatedAt: new Date().toISOString(),
        } satisfies Task
      : null
    if (nextTask) {
      await saveTaskAndWait(nextTask)
    }

    const nextState = upsertWorkspaceSessionInState(bindingState && nextTask
      ? {
          ...state,
          tasks: state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)),
          taskWorkspaceBindings: state.taskWorkspaceBindings.some((binding) => binding.id === bindingState.binding.id)
            ? state.taskWorkspaceBindings.map((binding) => binding.id === bindingState.binding.id ? bindingState.binding : binding)
            : [bindingState.binding, ...state.taskWorkspaceBindings],
        }
      : state, forkedSession)
    const response = await withState(withClusterState(nextState), '分叉会话已创建。', userId)
    return c.json({
      ...response,
      workspaceId: targetWorkspace.id,
      workspace: forkWorkspaceResult?.ok
        ? {
            ...forkWorkspaceResult.workspace,
            executorName: forkWorkspaceResult.executor.name,
            executorStatus: forkWorkspaceResult.executor.status === 'online'
              ? 'online'
              : forkWorkspaceResult.executor.status === 'paired'
                ? 'paired'
                : 'offline',
          } satisfies Workspace
        : scopedWorkspace,
      workspaces: listProjectWorkspacesForUser(userId, project),
      workspaceSessionId: forkedSession.id,
      workspaceSession: forkedSession,
    })
  })

  app.post('/api/workspaces/:id/sessions/:sessionId/title/auto', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceSessionAutoTitleSchema.parse(await c.req.json())
    const state = loadState()
    const workspaceId = c.req.param('id').trim()
    const sessionId = c.req.param('sessionId').trim()
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { project, scopedWorkspace } = context

    const currentSession = state.workspaceSessions.find((session) => (
      session.id === sessionId
      && session.workspaceId === workspaceId
      && session.status !== 'archived'
    ))
    if (!currentSession) {
      return c.json({ message: '会话不存在。' }, 404)
    }

    const task = resolveWorkspaceSessionTaskContext({
      state,
      project,
      workspace: scopedWorkspace,
      session: currentSession,
      requestedTaskId: payload.taskId,
    })
    if (!task) {
      return c.json({ message: '当前会话缺少可用于命名的任务上下文。' }, 409)
    }

    const conversation = getTaskConversation(task.id, workspaceId, sessionId)
    const userMessageCount = conversation
      ? listConversationMessages(conversation.id).filter((message) => message.role === 'user').length
      : 0

    if (!canAutoRenameWorkspaceSessionTitle({ session: currentSession, userMessageCount })) {
      const skipMessage = currentSession.titleOrigin === 'manual'
        ? '当前会话已手动命名，跳过自动重命名。'
        : currentSession.titleOrigin === 'ai'
          ? '当前会话已自动命名过，跳过重复重命名。'
          : '当前会话已过首条消息自动命名窗口，跳过自动重命名。'
      const response = await withState(withClusterState(state), skipMessage, userId)
      return c.json({
        ...response,
        workspaceId,
        workspace: scopedWorkspace,
        workspaceSessionId: currentSession.id,
        workspaceSession: currentSession,
      })
    }

    const fallbackTitle = buildSessionTitle(payload.message)
    const titleSuggestion = await suggestWorkspaceTitleWithDeepSeek({
      initialPrompt: payload.message,
      fallbackTitle,
    })
    const now = new Date().toISOString()
    const nextSession = mergeWorkspaceSession(task, currentSession, {
      title: titleSuggestion.title || fallbackTitle,
      titleOrigin: titleSuggestion.source === 'ai' ? 'ai' : 'system',
      updatedAt: now,
    })

    await saveWorkspaceSessionAndWait(nextSession)
    const nextState = upsertWorkspaceSessionInState(state, nextSession)
    const response = await withState(withClusterState(nextState), '会话标题已更新。', userId)
    return c.json({
      ...response,
      workspaceId,
      workspace: scopedWorkspace,
      workspaceSessionId: nextSession.id,
      workspaceSession: nextSession,
    })
  })

  app.put('/api/workspaces/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      name: z.string().trim().min(1).max(80),
      executorNodeId: z.string().trim().min(1).optional(),
      autoCommitEnabled: z.boolean().optional(),
      taskId: z.string().trim().min(1).optional(),
      workspaceSessionId: z.string().trim().min(1).optional(),
    }).parse(await c.req.json())
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    let nextExecutorId = payload.executorNodeId?.trim() || workspace.executorNodeId
    try {
      nextExecutorId = await resolveWorkspaceExecutorNodeId({
        state,
        userId,
        projectWorkspaceId: project.workspaceId,
        executorNodeId: nextExecutorId,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '官方云节点暂不可用。' }, getManagedCloudGate().isUsageLimitError(error) ? 402 : 400)
    }

    const executorAccess = canUserUseExecutorForProject({ userId, projectId: project.id, executorId: nextExecutorId })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    const executorChanged = nextExecutorId !== workspace.executorNodeId
    const previousExecutor = workspace.executorNodeId
      ? executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === workspace.executorNodeId)
      : undefined
    const repoPath = executorChanged
      ? undefined
      : resolveWorkspaceRepoPath({
          project,
          workspaceRoot: executorAccess.executor.workspaceRoot,
          workspace,
          bindingPathHint: listProjectBindings()
            .find((binding) => binding.projectId === project.id && binding.nodeId === nextExecutorId && binding.isActive)
            ?.pathHint,
        })
    const updatedAt = new Date().toISOString()
    const nextWorkspace: WorkspaceRecord = {
      ...workspace,
      name: payload.name,
      executorNodeId: nextExecutorId,
      repoPath,
      repoReady: Boolean(repoPath),
      status: repoPath ? 'ready' : 'pending_repo',
      autoCommitEnabled: resolveWorkspaceAutoCommitEnabled({
        workingDirectoryMode: workspace.workingDirectoryMode,
        autoCommitEnabled: payload.autoCommitEnabled ?? workspace.autoCommitEnabled,
      }),
      updatedAt,
    }
    saveWorkspace(nextWorkspace)

    const taskIdByWorkspaceId = new Map(state.taskWorkspaceBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => [binding.workspaceId, binding.taskId] as const))
    const taskById = new Map(state.tasks.map((task) => [task.id, task] as const))
    const workspaceSessionState = state.workspaceSessions
    if (payload.workspaceSessionId) {
      const requestedSession = workspaceSessionState.find((session) => (
        session.id === payload.workspaceSessionId
        && session.workspaceId === workspaceId
        && session.status !== 'archived'
      ))
      if (requestedSession) {
        const runtimeTask = resolveWorkspaceSessionTaskContext({
          state,
          project,
          workspace: nextWorkspace,
          session: requestedSession,
          requestedTaskId: payload.taskId,
        })
        if (runtimeTask) {
          taskById.set(runtimeTask.id, runtimeTask)
        }
      }
    }
    const nextWorkspaceSessions = workspaceSessionState.map((session) => {
      if (!executorChanged || session.workspaceId !== workspaceId || session.status === 'archived') {
        return session
      }

      const task = resolveWorkspaceSessionTaskContext({
        state,
        project,
        workspace: nextWorkspace,
        session,
        requestedTaskId: session.id === payload.workspaceSessionId ? payload.taskId : undefined,
      })
      if (!task) {
        return session
      }
      taskById.set(task.id, task)

      const nextSession = rebindWorkspaceSessionToExecutor(task, session, {
        executorNodeId: nextExecutorId,
        currentStep: '已切换执行节点，正在后台准备新的工作目录。',
        updatedAt,
        worktreeUniqueId: allocateWorkspaceWorktreeUniqueId(nextExecutorId, session.id),
      })
      saveWorkspaceSession(nextSession)
      return nextSession
    })

    let nextTasks = state.tasks
    let nextWorkspaceSessionsForState = nextWorkspaceSessions
    let switchPreparationTarget = executorChanged
      ? resolveWorkspaceExecutorSwitchPreparationTarget({
          workspaceId,
          requestedTaskId: payload.taskId,
          requestedWorkspaceSessionId: payload.workspaceSessionId,
          taskIdByWorkspaceId,
          taskById,
          sessions: nextWorkspaceSessions,
        })
      : null
    if (!switchPreparationTarget && executorChanged) {
      const fallbackTarget = ensureWorkspaceExecutorSwitchPreparationTarget({
        task: payload.taskId ? taskById.get(payload.taskId) : undefined,
        workspace: nextWorkspace,
        requestedWorkspaceSessionId: payload.workspaceSessionId,
        executorNodeId: nextExecutorId,
        updatedAt,
      })
      if (fallbackTarget) {
        switchPreparationTarget = fallbackTarget
        nextTasks = state.tasks.map((task) => task.id === fallbackTarget.task.id ? fallbackTarget.task : task)
        nextWorkspaceSessionsForState = [
          ...nextWorkspaceSessions.filter((session) => session.id !== fallbackTarget.session.id),
          fallbackTarget.session,
        ]
      }
    }
    if (executorChanged && switchPreparationTarget) {
      const switchSummary = buildWorkspaceExecutorSwitchSummary({
        fromExecutorName: previousExecutor?.name || workspace.executorNodeId,
        toExecutorName: executorAccess.executor.name || nextExecutorId,
        branchName: nextWorkspace.codeBranchName || switchPreparationTarget.session.branchName,
      })
      nextTasks = nextTasks.map((task) => task.id === switchPreparationTarget.task.id
        ? {
            ...task,
            logs: [
              ...task.logs,
              createExecutionLog('system', switchSummary, nextWorkspace.id, switchPreparationTarget.session.id),
            ],
          }
        : task)
      recordWorkspaceSessionSystemMessage({
        taskId: switchPreparationTarget.task.id,
        workspaceId: nextWorkspace.id,
        workspaceSessionId: switchPreparationTarget.session.id,
      }, switchSummary)
    }
    const nextState: AppState = {
      ...state,
      tasks: nextTasks,
      workspaceSessions: nextWorkspaceSessionsForState,
      executionCenter: deriveExecutionCenter(nextTasks, state.executionCenter),
    }
    const response = await withState(withClusterState(nextState), executorChanged
      ? switchPreparationTarget
        ? `已将工作区 ${nextWorkspace.name} 切换到执行节点 ${executorAccess.executor.name}，正在后台准备环境。`
        : `已将工作区 ${nextWorkspace.name} 切换到执行节点 ${executorAccess.executor.name}。`
      : `已更新工作区名称为 ${nextWorkspace.name}。`, userId, { includeResources: false })
    const workspaces = listProjectWorkspacesForUser(userId, project)

    if (executorChanged && switchPreparationTarget) {
      startWorkspaceExecutorSwitchPreparation({
        userId,
        state: nextState,
        project,
        task: switchPreparationTarget.task,
        workspace: nextWorkspace,
        session: switchPreparationTarget.session,
      })
    }

    return c.json({
      ...response,
      workspace: workspaces.find((item) => item.id === nextWorkspace.id) ?? scopedWorkspace,
      workspaces,
    })
  })

  app.post('/api/workspaces/:id/transfer', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      executorNodeId: z.string().trim().min(1),
      workspaceSessionId: z.string().trim().min(1).optional(),
      taskId: z.string().trim().min(1).optional(),
    }).parse(await c.req.json())
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    // Resolve target executor
    let nextExecutorId = payload.executorNodeId.trim()
    try {
      nextExecutorId = await resolveWorkspaceExecutorNodeId({
        state,
        userId,
        projectWorkspaceId: project.workspaceId,
        executorNodeId: nextExecutorId,
      })
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '官方云节点暂不可用。' }, getManagedCloudGate().isUsageLimitError(error) ? 402 : 400)
    }

    // Must be a different executor
    if (nextExecutorId === workspace.executorNodeId) {
      return c.json({ message: '目标节点与当前节点相同。' }, 400)
    }

    // Check executor access
    const executorAccess = canUserUseExecutorForProject({ userId, projectId: project.id, executorId: nextExecutorId })
    if (!executorAccess.ok) {
      return c.json({ message: executorAccess.message }, 403)
    }

    // Check executor is online
    const targetExecutor = executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === nextExecutorId)
    if (!targetExecutor || targetExecutor.status !== 'online') {
      return c.json({ message: '目标节点不在线，请选择其他节点。' }, 400)
    }

    // Pre-validate project cross-node compatibility (before stopping anything)
    const pathAccess = validateProjectExecutorPathAccess({
      project,
      executorId: nextExecutorId,
      bindings: listProjectBindings(),
      executors: executorRegistry.listExecutorsWithPresence(),
    })
    if (!pathAccess.ok) {
      return c.json({ message: pathAccess.message }, 409)
    }

    // Resolve target session
    const workspaceSessions = state.workspaceSessions.filter(
      (session) => session.workspaceId === workspaceId && session.status !== 'archived',
    )
    let targetSession: WorkspaceSession | undefined
    if (payload.workspaceSessionId) {
      targetSession = workspaceSessions.find((session) => session.id === payload.workspaceSessionId)
    }
    if (!targetSession) {
      targetSession = sortWorkspaceSessions(workspaceSessions)[0]
    }
    if (!targetSession) {
      return c.json({ message: '工作区没有活跃会话可以转接。' }, 400)
    }

    // Resolve task for the target session
    const task = resolveWorkspaceSessionTaskContext({
      state,
      project,
      workspace,
      session: targetSession,
      requestedTaskId: payload.taskId,
    })
    if (!task) {
      return c.json({ message: '无法解析目标任务。' }, 400)
    }

    // Step 1: Stop running session (safe even if not running)
    const wasRunning = isWorkspaceSessionExecutionActive(workspaceId, targetSession.id)
    await stopTaskChatExecutionAcrossNodes({ taskId: task.id, workspaceId, workspaceSessionId: targetSession.id })
    if (wasRunning) {
      markTaskChatRuntimeStopped({ task, workspaceId, workspaceSessionId: targetSession.id })
    }

    // Step 2: Switch workspace executor + rebind session
    const updatedAt = new Date().toISOString()
    const previousExecutorName = executorRegistry.listExecutorsWithPresence().find(
      (item) => item.executorId === workspace.executorNodeId,
    )?.name || workspace.executorNodeId

    const repoPath = undefined // executor changed, repo must be re-prepared
    const nextWorkspace: WorkspaceRecord = {
      ...workspace,
      executorNodeId: nextExecutorId,
      repoPath,
      repoReady: false,
      status: 'pending_repo',
      updatedAt,
    }
    saveWorkspace(nextWorkspace)

    const nextSession = rebindWorkspaceSessionToExecutor(task, targetSession, {
      executorNodeId: nextExecutorId,
      currentStep: '已切换执行节点，正在后台准备新的工作目录。',
      updatedAt,
      worktreeUniqueId: allocateWorkspaceWorktreeUniqueId(nextExecutorId, targetSession.id),
    })
    await saveWorkspaceSessionAndWait(nextSession)

    // Build preparation target
    const taskIdByWorkspaceId = new Map(state.taskWorkspaceBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => [binding.workspaceId, binding.taskId] as const))
    const taskById = new Map(state.tasks.map((t) => [t.id, t] as const))
    taskById.set(task.id, task)

    let nextTasks = state.tasks
    let nextWorkspaceSessionsForState = state.workspaceSessions.map((s) => (s.id === nextSession.id ? nextSession : s))

    const switchPreparationTarget = resolveWorkspaceExecutorSwitchPreparationTarget({
      workspaceId,
      requestedTaskId: payload.taskId,
      requestedWorkspaceSessionId: targetSession.id,
      taskIdByWorkspaceId,
      taskById,
      sessions: nextWorkspaceSessionsForState,
    }) || ensureWorkspaceExecutorSwitchPreparationTarget({
      task,
      workspace: nextWorkspace,
      requestedWorkspaceSessionId: targetSession.id,
      executorNodeId: nextExecutorId,
      updatedAt,
    })

    if (switchPreparationTarget) {
      nextTasks = nextTasks.map((t) => (t.id === switchPreparationTarget.task.id ? switchPreparationTarget.task : t))
      nextWorkspaceSessionsForState = nextWorkspaceSessionsForState.map(
        (s) => (s.id === switchPreparationTarget.session.id ? switchPreparationTarget.session : s),
      )
    }

    // Record system message
    if (switchPreparationTarget) {
      const switchSummary = buildWorkspaceExecutorSwitchSummary({
        fromExecutorName: previousExecutorName,
        toExecutorName: executorAccess.executor.name || nextExecutorId,
        branchName: nextWorkspace.codeBranchName || switchPreparationTarget.session.branchName,
      })
      nextTasks = nextTasks.map((t) => (t.id === switchPreparationTarget.task.id
        ? {
            ...t,
            logs: [...t.logs, createExecutionLog('system', switchSummary, nextWorkspace.id, switchPreparationTarget.session.id)],
          }
        : t))
      recordWorkspaceSessionSystemMessage({
        taskId: switchPreparationTarget.task.id,
        workspaceId: nextWorkspace.id,
        workspaceSessionId: switchPreparationTarget.session.id,
      }, switchSummary)
    }

    const nextState: AppState = {
      ...state,
      tasks: nextTasks,
      workspaceSessions: nextWorkspaceSessionsForState,
      executionCenter: deriveExecutionCenter(nextTasks, state.executionCenter),
    }

    // Step 3: Enqueue auto-continue message
    const continueTaskId = switchPreparationTarget?.task.id || task.id
    const continueSessionId = switchPreparationTarget?.session.id || nextSession.id
    const newExecutorMeta = executorRegistry.getExecutor(nextExecutorId)
    const newCwd = resolveWorkspaceSessionCwd(
      newExecutorMeta?.workspaceRoot?.trim() || state.config.workspaceRoot,
      project,
      nextSession,
      nextWorkspace,
    )
    const continueMessage = newCwd
      ? `节点已切换，当前项目路径：${newCwd}，继续。`
      : '节点已切换，继续。'
    const dedupeKey = `workspace-transfer:${workspaceId}:${continueSessionId}:${nextExecutorId}:${updatedAt}`

    try {
      await enqueueTaskChatMessage({
        taskId: continueTaskId,
        workspaceId,
        workspaceSessionId: continueSessionId,
        message: continueMessage,
        dedupeKey,
        createdBy: userId,
      })
      scheduleTaskChatQueueDrain({
        taskId: continueTaskId,
        workspaceId,
        workspaceSessionId: continueSessionId,
      })

      recordWorkspaceSessionSystemMessage({
        taskId: continueTaskId,
        workspaceId,
        workspaceSessionId: continueSessionId,
      }, '已自动入队继续消息，AI 将在新节点准备就绪后继续工作。')
    } catch (error) {
      console.error('[workspace-transfer] failed to enqueue continue message', error)
      recordWorkspaceSessionSystemMessage({
        taskId: continueTaskId,
        workspaceId,
        workspaceSessionId: continueSessionId,
      }, '节点已切换，但自动继续消息入队失败，请手动发送消息继续。')
    }

    // Start background preparation on new executor
    if (switchPreparationTarget) {
      startWorkspaceExecutorSwitchPreparation({
        userId,
        state: nextState,
        project,
        task: switchPreparationTarget.task,
        workspace: nextWorkspace,
        session: switchPreparationTarget.session,
      })
    }

    const response = await withState(
      withClusterState(nextState),
      `已将工作区 ${nextWorkspace.name} 转接到节点 ${executorAccess.executor.name}，AI 将自动继续工作。`,
      userId,
      { includeResources: false },
    )
    const workspaces = listProjectWorkspacesForUser(userId, project)

    return c.json({
      ...response,
      workspace: workspaces.find((item) => item.id === nextWorkspace.id) ?? scopedWorkspace,
      workspaces,
      workspaceSession: nextSession,
    })
  })

  app.post('/api/executors/:executorId/transfer', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const sourceExecutorId = c.req.param('executorId').trim()
    const payload = z.object({
      targetExecutorNodeId: z.string().trim().min(1),
    }).parse(await c.req.json())

    if (!sourceExecutorId) {
      return c.json({ message: '源节点 ID 不能为空。' }, 400)
    }

    const state = loadState()
    const executors = executorRegistry.listExecutorsWithPresence()
    const sourceExecutor = executors.find((item) => item.executorId === sourceExecutorId)
    if (!sourceExecutor) {
      return c.json({ message: '源节点不存在。' }, 404)
    }

    // Resolve target executor
    let targetExecutorId = payload.targetExecutorNodeId.trim()
    const targetExecutor = executors.find((item) => item.executorId === targetExecutorId)
    if (!targetExecutor || targetExecutor.status !== 'online') {
      return c.json({ message: '目标节点不在线，请选择其他节点。' }, 400)
    }
    if (targetExecutorId === sourceExecutorId) {
      return c.json({ message: '目标节点与源节点相同。' }, 400)
    }

    // Find all actively running sessions on the source executor
    const activeRunningStatuses = new Set(['executing', 'thinking', 'waiting'])
    const sessionsToTransfer = state.workspaceSessions.filter(
      (session) => session.executorNodeId === sourceExecutorId
        && session.status !== 'archived'
        && activeRunningStatuses.has(session.agentRunningStatus),
    )

    if (sessionsToTransfer.length === 0) {
      return c.json({ message: '该节点上没有正在运行的会话需要转接。', transferred: 0, failed: 0 })
    }

    let transferred = 0
    let failed = 0
    const updatedAt = new Date().toISOString()

    for (const session of sessionsToTransfer) {
      try {
        const workspaceId = session.workspaceId
        const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId)
        if (!context.ok) { failed++; continue }
        const { workspace, project } = context

        // Check executor access
        const executorAccess = canUserUseExecutorForProject({ userId, projectId: project.id, executorId: targetExecutorId })
        if (!executorAccess.ok) { failed++; continue }

        // Validate cross-node compatibility
        const pathAccess = validateProjectExecutorPathAccess({
          project,
          executorId: targetExecutorId,
          bindings: listProjectBindings(),
          executors,
        })
        if (!pathAccess.ok) { failed++; continue }

        // Resolve task
        const task = resolveWorkspaceSessionTaskContext({ state, project, workspace, session })
        if (!task) { failed++; continue }

        // Commit and push uncommitted changes before switching
        const sourceExecutorMeta = executorRegistry.getExecutor(sourceExecutorId)
        const sessionCwd = resolveWorkspaceSessionCwd(
          sourceExecutorMeta?.workspaceRoot?.trim() || state.config.workspaceRoot,
          project,
          session,
          workspace,
        )
        if (sessionCwd) {
          try {
            const gitDiff = await readWorkspaceExecutorGitWorkingTreeDiff({
              project,
              executorId: sourceExecutorId,
              cwd: sessionCwd,
            })
            if (shouldEmitWorkspaceAutoCommitStartMessage(gitDiff)) {
              const commitResult = await finalizeWorkspaceExecutorGit({
                userId,
                project,
                executorId: sourceExecutorId,
                cwd: sessionCwd,
                branchName: session.branchName,
                commitMessage: `转接前自动提交：切换节点 ${sourceExecutor.name || sourceExecutorId} → ${targetExecutor.name || targetExecutorId}`,
              })
              if (commitResult.ok) {
                recordWorkspaceSessionSystemMessage({
                  taskId: task.id,
                  workspaceId,
                  workspaceSessionId: session.id,
                }, `转接前已自动提交并推送代码${commitResult.remoteBranchName ? `（分支 ${commitResult.remoteBranchName}）` : ''}。`)
              } else {
                console.warn(`[executor-transfer] git commit failed for session ${session.id}: ${commitResult.message}`)
                recordWorkspaceSessionSystemMessage({
                  taskId: task.id,
                  workspaceId,
                  workspaceSessionId: session.id,
                }, `转接前自动提交失败（${commitResult.message}），新节点可能无法获取最新代码。`)
              }
            }
          } catch (error) {
            console.warn(`[executor-transfer] git pre-transfer check failed for session ${session.id}`, error)
          }
        }

        // Stop running session
        const wasRunning = isWorkspaceSessionExecutionActive(workspaceId, session.id)
        await stopTaskChatExecutionAcrossNodes({ taskId: task.id, workspaceId, workspaceSessionId: session.id })
        if (wasRunning) {
          markTaskChatRuntimeStopped({ task, workspaceId, workspaceSessionId: session.id })
        }

        // Switch workspace executor (only once per workspace)
        if (workspace.executorNodeId === sourceExecutorId) {
          const nextWorkspace: WorkspaceRecord = {
            ...workspace,
            executorNodeId: targetExecutorId,
            repoPath: undefined,
            repoReady: false,
            status: 'pending_repo',
            updatedAt,
          }
          saveWorkspace(nextWorkspace)
        }

        // Rebind session
        const nextSession = rebindWorkspaceSessionToExecutor(task, session, {
          executorNodeId: targetExecutorId,
          currentStep: '已切换执行节点，正在后台准备新的工作目录。',
          updatedAt,
          worktreeUniqueId: allocateWorkspaceWorktreeUniqueId(targetExecutorId, session.id),
        })
        await saveWorkspaceSessionAndWait(nextSession)

        // Record system message
        const switchSummary = buildWorkspaceExecutorSwitchSummary({
          fromExecutorName: sourceExecutor.name || sourceExecutorId,
          toExecutorName: targetExecutor.name || targetExecutorId,
          branchName: session.branchName,
        })
        recordWorkspaceSessionSystemMessage({
          taskId: task.id,
          workspaceId,
          workspaceSessionId: session.id,
        }, switchSummary)

        // Enqueue auto-continue message
        const targetExecutorMeta = executorRegistry.getExecutor(targetExecutorId)
        const newCwd = resolveWorkspaceSessionCwd(
          targetExecutorMeta?.workspaceRoot?.trim() || state.config.workspaceRoot,
          project,
          nextSession,
          workspace,
        )
        const continueMessage = newCwd
          ? `节点已切换，当前项目路径：${newCwd}，继续。`
          : '节点已切换，继续。'
        const dedupeKey = `executor-transfer:${workspaceId}:${session.id}:${targetExecutorId}:${updatedAt}`
        try {
          await enqueueTaskChatMessage({
            taskId: task.id,
            workspaceId,
            workspaceSessionId: session.id,
            message: continueMessage,
            dedupeKey,
            createdBy: userId,
          })
          scheduleTaskChatQueueDrain({ taskId: task.id, workspaceId, workspaceSessionId: session.id })
          recordWorkspaceSessionSystemMessage({
            taskId: task.id,
            workspaceId,
            workspaceSessionId: session.id,
          }, '已自动入队继续消息，AI 将在新节点准备就绪后继续工作。')
        } catch (error) {
          console.error('[executor-transfer] failed to enqueue continue message', error)
          recordWorkspaceSessionSystemMessage({
            taskId: task.id,
            workspaceId,
            workspaceSessionId: session.id,
          }, '节点已切换，但自动继续消息入队失败，请手动发送消息继续。')
        }

        // Start background preparation
        const updatedWorkspace = getWorkspace(workspaceId)
        if (updatedWorkspace) {
          startWorkspaceExecutorSwitchPreparation({
            userId,
            state,
            project,
            task,
            workspace: updatedWorkspace,
            session: nextSession,
          })
        }

        transferred++
      } catch (error) {
        console.error(`[executor-transfer] failed to transfer session ${session.id}`, error)
        failed++
      }
    }

    const sourceName = sourceExecutor.name || sourceExecutorId
    const targetName = targetExecutor.name || targetExecutorId
    const message = failed > 0
      ? `已将 ${transferred} 个会话从 ${sourceName} 转接到 ${targetName}，${failed} 个失败。`
      : `已将 ${transferred} 个会话从 ${sourceName} 转接到 ${targetName}，AI 将自动继续工作。`

    return c.json({ transferred, failed, message })
  })

  app.get('/api/workspaces/:id/environment-template', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId)
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const template = await getWorkspaceEnvironmentTemplate(workspaceId)
    const effectiveTemplate = resolveEffectiveProjectEnvironmentTemplate({
      project,
      workspaceEnvironmentTemplate: template,
    }) ?? null

    return c.json({
      workspace: scopedWorkspace,
      template,
      effectiveTemplate,
    })
  })

  app.put('/api/workspaces/:id/environment-template', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceEnvironmentTemplatePayloadSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const nextTemplate = normalizeProjectEnvironmentTemplate(payload.template ?? undefined) ?? null
    const duplicatePorts = validateProjectEnvironmentPreviewPorts({
      appPort: nextTemplate?.appPort,
      ports: nextTemplate?.ports,
      previewDomainBindings: nextTemplate?.previewDomainBindings,
    })
    if (duplicatePorts.length > 0) {
      return c.json({ message: `预览端口不能重复：${duplicatePorts.join('、')}` }, 409)
    }

    const template = await saveWorkspaceEnvironmentTemplate(
      workspaceId,
      nextTemplate,
    )
    const effectiveTemplate = await resolveWorkspaceEffectiveEnvironmentTemplate(project, workspaceId)

    return c.json({
      workspace: scopedWorkspace,
      template,
      effectiveTemplate,
      message: template ? '工作区环境模板已保存。' : '工作区环境模板已清空，已回退到项目模板。',
    })
  })

  app.post('/api/workspaces/:id/environment-template/import', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceEnvironmentTemplateImportPayloadSchema.parse(await c.req.json().catch(() => undefined))
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const importTarget = resolveWorkspaceEnvironmentTemplateImportTarget({
      state,
      project,
      workspace,
      requestedWorkspaceSessionId: payload?.workspaceSessionId,
    })
    const template = await importWorkspaceEnvironmentTemplate({
      project,
      workspace,
      importPath: importTarget.importPath,
      executorId: importTarget.executorId,
    })
    if (!template) {
      return c.json({ message: '当前工作区没有检测到 `.wemux.yml`。' }, 404)
    }

    const effectiveTemplate = await resolveWorkspaceEffectiveEnvironmentTemplate(project, workspaceId)

    return c.json({
      workspace: scopedWorkspace,
      template,
      effectiveTemplate,
      message: '工作区环境模板已重新导入。',
    })
  })

  app.post('/api/workspaces/:id/settings/sync', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceEnvironmentTemplateImportPayloadSchema.parse(await c.req.json().catch(() => undefined))
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    const importTarget = resolveWorkspaceEnvironmentTemplateImportTarget({
      state,
      project,
      workspace,
      requestedWorkspaceSessionId: payload?.workspaceSessionId,
    })
    const messages: string[] = []
    const template = await importWorkspaceEnvironmentTemplate({
      project,
      workspace,
      importPath: importTarget.importPath,
      executorId: importTarget.executorId,
    })
    if (template) {
      messages.push('已同步工作区环境模板。')
    } else {
      messages.push('未检测到工作区 `.wemux.yml`。')
    }

    let runtimeEnvironmentImported = false
    try {
      const detectedRuntimeEnv = await detectProjectRuntimeEnvironmentFile({
        rootPath: importTarget.importPath,
        executorId: importTarget.executorId,
        repoPath: importTarget.importPath,
      })
      if (detectedRuntimeEnv) {
        await saveWorkspaceRuntimeEnvironmentConfig(workspace.id, {
          mode: 'process-env',
          fileName: detectedRuntimeEnv.fileName,
          content: detectedRuntimeEnv.content,
        })
        runtimeEnvironmentImported = true
        messages.push(`已同步工作区 ${detectedRuntimeEnv.fileName}。`)
      }
    } catch (error) {
      messages.push(error instanceof Error ? `工作区环境变量同步失败：${error.message}` : '工作区环境变量同步失败。')
    }
    if (!runtimeEnvironmentImported) {
      messages.push('未检测到新的工作区 `.env`。')
    }

    if (project.versionControl !== 'none') {
      messages.push('Git 项目工作区会在预览、终端或 Agent 执行前校验并准备当前节点目录。')
    } else {
      messages.push('非 Git 工作区已跳过跨节点仓库同步。')
    }

    const effectiveTemplate = await resolveWorkspaceEffectiveEnvironmentTemplate(project, workspaceId)

    return c.json({
      workspace: scopedWorkspace,
      template: template ?? await getWorkspaceEnvironmentTemplate(workspaceId),
      effectiveTemplate,
      message: messages.join(' '),
    })
  })

  app.post('/api/workspaces/:id/archive', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceArchiveSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    if (workspace.source !== 'manual') {
      return c.json({ message: '只有自建工作区支持归档。' }, 403)
    }

    if (!(await canUserManageProjectWorkspace({ userId, project, workspace }))) {
      return c.json({ message: getProjectWorkspaceManagementDeniedMessage(payload.archived ? 'archive' : 'restore') }, 403)
    }

    const nextArchived = payload.archived
    const nextWorkspaceStatus = nextArchived
      ? 'archived' as const
      : (workspace.repoPath?.trim() ? 'ready' as const : workspace.status === 'archived' ? 'pending_repo' as const : workspace.status)

    const updatedAt = new Date().toISOString()
    const nextWorkspace: WorkspaceRecord = {
      ...workspace,
      status: nextWorkspaceStatus,
      updatedAt,
    }
    let runtimeCleanupDetail = ''

    if (nextArchived) {
      const runtimeCleanupSummary = await cleanupWorkspaceRuntimeResources({
        state,
        project,
        userId,
        workspace,
      })
      const workspaceSessionState = state.workspaceSessions
      const workspaceSessions = workspaceSessionState.filter((session) => session.workspaceId === workspaceId)
      const cleanupResult = await cleanupWorkspaceWorktrees({
        state,
        project,
        workspace,
        sessions: workspaceSessions,
        userId,
        deleteLocalBranch: false,
        deleteRemoteBranch: false,
      })
      if (!cleanupResult.ok) {
        return c.json({ message: cleanupResult.message }, 409)
      }

      runtimeCleanupDetail = [
        summarizeWorkspaceRuntimeCleanup(runtimeCleanupSummary),
        cleanupResult.detail ?? '',
      ].filter(Boolean).join('，')
    }

    saveWorkspace(nextWorkspace)

    const nextBindings = state.taskWorkspaceBindings.map((binding) => {
      if (binding.workspaceId !== workspaceId) {
        return binding
      }

      const nextBinding = {
        ...binding,
        status: nextArchived ? 'archived' as const : 'active' as const,
        updatedAt,
      }
      saveTaskWorkspaceBinding(nextBinding)
      return nextBinding
    })

    const workspaceSessionState = state.workspaceSessions
    const nextSessions = workspaceSessionState.map((session) => {
      if (session.workspaceId !== workspaceId) {
        return session
      }

      const nextSession = {
        ...session,
        status: nextArchived ? 'archived' as const : 'active' as const,
        updatedAt,
      }
      saveWorkspaceSession(nextSession)
      return nextSession
    })

    const nextState: AppState = {
      ...state,
      taskWorkspaceBindings: nextBindings,
      workspaceSessions: nextSessions,
    }

    const response = await withState(
      withClusterState(nextState),
      nextArchived
        ? mergeWorkspaceMessage(`已归档工作区 ${workspace.name}。`, runtimeCleanupDetail)
        : `已恢复工作区 ${workspace.name}。`,
      userId,
    )
    const workspaces = listProjectWorkspacesForUser(userId, project)

    return c.json({
      ...response,
      workspace: workspaces.find((item) => item.id === workspaceId) ?? scopedWorkspace,
      workspaces,
    })
  })

  app.delete('/api/workspaces/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      deleteLocalBranch: z.boolean().optional().default(false),
      deleteRemoteBranch: z.boolean().optional().default(false),
    }).parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const workspaceId = c.req.param('id')
    const context = resolveAuthorizedWorkspaceContext(state, userId, workspaceId, { requireCollaborate: true })
    if (!context.ok) return c.json({ message: context.message }, 404)
    const { workspace, project, scopedWorkspace } = context

    if (!canDeleteWorkspaceRecord(workspace)) {
      return c.json({ message: '绑定生成的工作区不支持单独删除。' }, 403)
    }

    if (!(await canUserManageProjectWorkspace({ userId, project, workspace }))) {
      return c.json({ message: getProjectWorkspaceManagementDeniedMessage('delete') }, 403)
    }

    const workspaceSessionState = state.workspaceSessions
    const workspaceSessions = workspaceSessionState.filter((session) => session.workspaceId === workspaceId)
    const timestamp = new Date().toISOString()
    const workspaceIdSet = new Set([workspaceId])
    const nextTasks = state.tasks.map((task) => detachWorkspaceIdsFromTask(task, workspaceIdSet, timestamp))

    for (let index = 0; index < nextTasks.length; index += 1) {
      const task = nextTasks[index]
      if (task !== state.tasks[index]) {
        await saveTaskAndWait(task)
      }
    }

    deleteTaskWorkspaceBindings({ workspaceIds: [workspaceId] })
    deleteWorkspaceSessions({ workspaceIds: [workspaceId] })
    // 工作区删除是最高优先级：连同全部会话的排队消息一起清空，避免遗留队列指向已删除会话。
    await removeTaskChatQueueEntriesForWorkspace({ workspaceId })
    await clearWorkspaceEnvironmentTemplate(workspaceId)
    deleteWorkspaces([workspaceId])
    scheduleWorkspaceDeletionCleanup({
      state,
      project,
      workspace,
      workspaceSessions,
      userId,
      deleteLocalBranch: payload.deleteLocalBranch,
      deleteRemoteBranch: payload.deleteRemoteBranch,
    })

    // 云节点文件清理（R2）：workspaces/<wid>/ 前缀下是云节点执行文件（唯一消费者），
    // 与本地目录清理语义对齐；尽力而为，失败不阻断工作区删除。
    void deleteObjectPrefix(`workspaces/${workspaceId}`).catch((error) => {
      console.warn(`[workspace-delete] R2 云节点文件清理失败 workspace=${workspaceId}:`, error instanceof Error ? error.message : error)
    })

    const nextState: AppState = {
      ...state,
      tasks: nextTasks,
      taskWorkspaceBindings: state.taskWorkspaceBindings.filter((binding) => binding.workspaceId !== workspaceId),
      workspaceSessions: workspaceSessionState.filter((session) => session.workspaceId !== workspaceId),
      executionCenter: deriveExecutionCenter(nextTasks, state.executionCenter),
    }

    return c.json(await withState(
      withClusterState(nextState),
      mergeWorkspaceMessage(
        `已删除工作区 ${workspace.name}。`,
        '节点清理指令已下发，后台会继续清理相关运行资源、本地目录与分支。',
      ),
      userId,
    ))
  })

  app.post('/api/projects/:id/workspaces/reorder', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = workspaceReorderSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const project = scopedState.projects.find((item) => item.id === c.req.param('id'))
    if (!project) {
      return c.json({ message: '项目不存在或无权访问。' }, 404)
    }

    const visibleWorkspaces = listProjectWorkspacesForUser(userId, project)
    const visibleWorkspaceIds = new Set(visibleWorkspaces.map((workspace) => workspace.id))
    const normalizedOrderedWorkspaceIds = payload.orderedWorkspaceIds.filter((workspaceId, index, list) => (
      visibleWorkspaceIds.has(workspaceId) && list.indexOf(workspaceId) === index
    ))
    if (normalizedOrderedWorkspaceIds.length !== visibleWorkspaces.length) {
      return c.json({ message: '工作区顺序无效。' }, 400)
    }

    const updatedAt = new Date().toISOString()
    const displayOrderByWorkspaceId = buildDisplayOrderPatch(normalizedOrderedWorkspaceIds)
    for (const workspace of visibleWorkspaces) {
      const nextDisplayOrder = displayOrderByWorkspaceId.get(workspace.id)
      if (typeof nextDisplayOrder !== 'number') {
        continue
      }

      saveWorkspace({
        ...workspace,
        displayOrder: nextDisplayOrder,
        updatedAt,
      })
    }

    return c.json({
      workspaces: listProjectWorkspacesForUser(userId, project),
      message: '工作区顺序已更新。',
    })
  })
}
