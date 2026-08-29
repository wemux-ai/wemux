// [INPUT]: Authorized task/workspace state plus persisted workspace/session stores.
// [OUTPUT]: Task-workspace binding helpers and task-addressed runtime compatibility adapters.
// [POS]: Server route support; workspace bindings may reference tasks, inner sessions never do.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveNextDisplayOrder, sortWorkspacesByDisplayOrder } from '@shared/project-workspace-order'
import {
  buildWorkspaceTaskExecutionView,
  buildWorkspaceSessionTitle,
  createTaskWorkspaceBinding,
  createWorkspaceSession,
  mergeWorkspaceSession,
  resolveNextWorkspaceSessionDisplayOrder,
  resolveWorkspaceCodeBaseBranch,
  resolveWorkspaceCodeBranchName,
  resolveWorkspaceAutoCommitEnabled,
  resolveWorkspaceDirectoryView,
  resolveWorkspaceWorkerId,
  sortWorkspaceSessions,
  resolveWorkspaceSessionExecutorId,
  type WorkspaceDirectoryView,
} from '@shared/task-workspace'
import { syncTaskStatusFromWorkspaceBound } from '@shared/task-status-flow'
import { collapseDuplicateAssistantEvents, type ChatTimelineEvent } from '@shared/timeline'
import { buildWorkspaceDeliverySummary } from '@shared/workspace-delivery'
import { DEFAULT_AGENT_TYPE } from '@shared/agent-type'
import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionRuntimeSnapshot,
  WorkspaceSessionTurnRecord,
} from '@shared/workspace-session-history'
import type { AppState, CreatorIdentity, Project, RepoBranchSnapshotResult, Task, TaskWorkspaceBinding, WorkspaceSession, Workspace, WorkspaceRecord, WorkspaceViewState } from '@shared/types'
import type { WorkspaceEnvironmentRuntimeSnapshot, WorkspaceRuntimeSummary, WorkspaceTerminalRuntimeSnapshot } from '@shared/workspace-runtime'
import { isWorkspaceRuntimeSnapshotFresh, resolveWorkspaceTerminalRuntimeStatus } from '@shared/workspace-runtime'
import { isPlaygroundProjectId } from '@shared/playground-workspace'
import { resolveTaskWorktreePath } from '@shared/workspace-paths'
import { getWorkspacePlaygroundBaseDir, buildWorkspacePlaygroundSessionDir } from '@shared/workspace-paths'
import type { AgentMessageResult } from '../integrations/opencode/task-chat-stream'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { appendTaskConversationMessage, getTaskConversationWithMessages } from '../control-plane/conversation-service'
import { createTimelineCollector, createUserMessageEvent } from '../integrations/opencode/task-chat-stream'
import { executorRegistry } from '../control-plane/executor-registry'
import { getWorkspaceBranchSnapshotFromExecutor } from '../control-plane/executor-repo-service'
import { recordTaskAgentTurn } from '../control-plane/governance-service'
import { getTeamProjects, getUserById, getUserTeams } from '../repositories/auth'
import { buildTaskConversationHandoffSnapshot } from '../services/conversation-handoff'
import { getServerAgentLabel } from '../services/server-agent'
import { recordUsageEvent } from '../services/usage-event-service'
import { persistWorkspaceSessionStateBeforeHistory } from '../services/task-chat-dispatch/workspace-session-persistence-order'
import {
  resolveWorkspaceLocalWorktreeSnapshot,
  upsertWorkspaceLocalWorktreeSnapshot,
} from '../services/workspace-local-worktree-store'
import { resolveProjectRuntimeRootPath, resolveWorkspaceRepoPath } from '../services/workspace-repo-path'
import { listProjectBindings, listWorkspaces, saveWorkspace } from '../storage/distributed-task-store'
import { getTaskWorkspaceBinding, getWorkspaceSessionById, listTaskWorkspaceBindings, listWorkspaceSessions, loadState, saveProject, saveTask, saveTaskWorkspaceBinding, saveWorkspaceSession, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { resolveUserWorkspaceShareAccess } from '../services/workspace-share-service'
import { persistWorkspaceSessionTurnHistory } from '../storage/postgres/workspace-session-history-store'

type WorkingDirectoryMode = 'worktree' | 'original-dir'
type WorkspaceSessionWithMeta = WorkspaceSession & {
  title?: string
  status?: 'active' | 'archived'
  workingDirectoryMode?: WorkingDirectoryMode
}
type WorkspaceWithMode = Workspace & { workingDirectoryMode?: WorkingDirectoryMode }
type WorkspaceRecordWithMode = WorkspaceRecord & { workingDirectoryMode?: WorkingDirectoryMode }

export const resolveUserCreatorIdentity = (userId?: string): CreatorIdentity | undefined => {
  const normalizedUserId = userId?.trim()
  if (!normalizedUserId) {
    return undefined
  }

  const user = getUserById(normalizedUserId)
  return {
    type: 'user',
    id: normalizedUserId,
    name: user?.name?.trim() || normalizedUserId,
    avatarUrl: user?.avatarUrl?.trim() || undefined,
  }
}

const resolveSharedWorktreeSourceSessionById = (
  session: Pick<WorkspaceSession, 'id' | 'workspaceId'> & { sharedWorktreeSourceSessionId?: string },
) => {
  const sourceSessionId = session.sharedWorktreeSourceSessionId?.trim()
  if (!sourceSessionId) {
    return null
  }

  const sourceSession = getWorkspaceSessionById(sourceSessionId)
  if (!sourceSession || sourceSession.workspaceId !== session.workspaceId || sourceSession.status === 'archived') {
    return null
  }

  return sourceSession
}

export const resolveEffectiveWorkspaceWorktreeSessionFromCandidates = (
  session: WorkspaceSession,
  candidates: WorkspaceSession[],
  workspaceExecutorId?: string | null,
) => {
  const targetExecutorId = resolveWorkspaceSessionExecutorId(session, workspaceExecutorId)
  const matchesTargetExecutor = (candidate: WorkspaceSession) => {
    const candidateExecutorId = resolveWorkspaceSessionExecutorId(candidate)
    return !targetExecutorId || !candidateExecutorId || candidateExecutorId === targetExecutorId
  }

  const sourceSessionId = session.sharedWorktreeSourceSessionId?.trim()
  if (sourceSessionId) {
    const sourceSession = candidates.find((candidate) => candidate.id === sourceSessionId && candidate.workspaceId === session.workspaceId && candidate.status !== 'archived')
    if (sourceSession && matchesTargetExecutor(sourceSession)) {
      return sourceSession
    }
  }

  if (session.worktreeStatus === 'created' || session.workingDirectoryMode === 'original-dir') {
    return session
  }

  return candidates.find((candidate) => (
    candidate.id !== session.id
    && candidate.status !== 'archived'
    && candidate.worktreeStatus === 'created'
    && matchesTargetExecutor(candidate)
  )) ?? session
}

export const resolveEffectiveWorkspaceWorktreeSession = (
  taskId: string,
  session: WorkspaceSession,
  workspaceExecutorId?: string | null,
) => {
  void taskId
  return resolveEffectiveWorkspaceWorktreeSessionFromCandidates(
    session,
    listWorkspaceSessionRecordsForWorkspace(session.workspaceId),
    workspaceExecutorId,
  )
}

const resolveWorkingDirectoryMode = (
  value?: { workingDirectoryMode?: string | null; versionControl?: string | null } | null,
): WorkingDirectoryMode => {
  if ((value as { versionControl?: string | null } | null | undefined)?.versionControl === 'none') {
    return 'original-dir'
  }

  return value?.workingDirectoryMode === 'original-dir' ? 'original-dir' : 'worktree'
}

const resolveDefaultSharedWorktreeSourceSession = (params: {
  workspaceId: string
  currentSessionId?: string
  executorNodeId?: string | null
  workingDirectoryMode: WorkingDirectoryMode
}) => {
  if (params.workingDirectoryMode !== 'worktree') {
    return null
  }

  return listWorkspaceSessionRecordsForWorkspace(params.workspaceId).find((session) => (
    session.id !== params.currentSessionId
    && session.status !== 'archived'
    && session.worktreeStatus === 'created'
    && (!params.executorNodeId || resolveWorkspaceSessionExecutorId(session) === params.executorNodeId)
  )) ?? null
}

const resolveSuggestedBaseBranch = ({
  workingDirectoryMode,
  suggestedBaseBranch,
  fallbackBranch,
}: {
  workingDirectoryMode: WorkingDirectoryMode
  suggestedBaseBranch?: string | null
  fallbackBranch?: string | null
}) => {
  if (workingDirectoryMode === 'original-dir') {
    return undefined
  }

  return suggestedBaseBranch?.trim() || fallbackBranch?.trim() || undefined
}

const resolveWorkspaceSessionStatus = (value?: { status?: string | null }) => {
  return value?.status === 'archived' ? 'archived' as const : 'active' as const
}

export const allocateWorkspaceWorktreeUniqueId = (executorNodeId?: string, currentSessionId?: string) => {
  const usedIds = new Set(
    listWorkspaceSessions()
      .filter((session) => !currentSessionId || session.id !== currentSessionId)
      .filter((session) => !executorNodeId || resolveWorkspaceSessionExecutorId(session) === executorNodeId)
      .map((session) => session.worktreeUniqueId)
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0),
  )

  let nextId = 1
  while (usedIds.has(nextId)) {
    nextId += 1
  }

  return nextId
}

const withWorkspaceSessionMeta = (
  session: WorkspaceSession,
  patch?: {
    title?: string
    status?: 'active' | 'archived'
    workingDirectoryMode?: WorkingDirectoryMode
  },
): WorkspaceSessionWithMeta => {
  const current = session as WorkspaceSessionWithMeta
  return {
    ...current,
    title: patch?.title ?? current.title ?? '默认会话',
    status: patch?.status ?? resolveWorkspaceSessionStatus(current),
    workingDirectoryMode: patch?.workingDirectoryMode ?? resolveWorkingDirectoryMode(current),
  }
}

export const rememberRecentBaseBranch = (project: Project, baseBranch: string) => {
  const normalizedBaseBranch = baseBranch.trim()
  if (!normalizedBaseBranch) {
    return project
  }

  const nextRecentBaseBranches = [
    normalizedBaseBranch,
    ...(project.recentBaseBranches ?? []).filter((item) => item !== normalizedBaseBranch),
  ].slice(0, 8)

  if ((project.recentBaseBranches ?? []).join('\u0000') === nextRecentBaseBranches.join('\u0000')) {
    return project
  }

  const nextProject: Project = {
    ...project,
    recentBaseBranches: nextRecentBaseBranches,
    updatedAt: new Date().toISOString(),
  }
  saveProject(nextProject)
  return nextProject
}

export const appendExecutionRun = (task: Task, _payload: {
  distributedTaskId: string
  workspaceId?: string
  executorNodeId: string
  baseBranch: string
  returnMode: 'summary' | 'branch' | 'commit'
  gitIdentityMode: 'personal'
}) => {
  return {
    ...task,
    executionHistory: task.executionHistory,
  }
}

const toWorkspaceView = (workspace: WorkspaceRecord, view: WorkspaceViewState): Workspace => ({
  ...workspace,
  ...view,
})

const getWorkspaceEnvironmentRuntimePriority = (status: WorkspaceEnvironmentRuntimeSnapshot['status']) => {
  if (status === 'running') return 5
  if (status === 'starting' || status === 'checking') return 4
  if (status === 'stopping') return 3
  if (status === 'error' || status === 'unreachable') return 2
  if (status === 'stopped') return 1
  return 0
}

const pickWorkspaceEnvironmentRuntime = (
  current: WorkspaceEnvironmentRuntimeSnapshot | undefined,
  next: WorkspaceEnvironmentRuntimeSnapshot | undefined,
) => {
  if (!next) {
    return current
  }
  if (!current) {
    return next
  }

  const currentPriority = getWorkspaceEnvironmentRuntimePriority(current.status)
  const nextPriority = getWorkspaceEnvironmentRuntimePriority(next.status)
  if (currentPriority !== nextPriority) {
    return nextPriority > currentPriority ? next : current
  }

  return next.checkedAt.localeCompare(current.checkedAt) >= 0 ? next : current
}

const pickWorkspaceTerminalRuntime = (
  current: WorkspaceTerminalRuntimeSnapshot | undefined,
  next: WorkspaceTerminalRuntimeSnapshot | undefined,
) => {
  if (!next) {
    return current
  }
  if (!current) {
    return next
  }

  const currentStatus = resolveWorkspaceTerminalRuntimeStatus(current)
  const nextStatus = resolveWorkspaceTerminalRuntimeStatus(next)
  if (currentStatus !== nextStatus) {
    if (nextStatus === 'open') return next
    if (currentStatus === 'open') return current
  }

  return next.reportedAt.localeCompare(current.reportedAt) >= 0 ? next : current
}

const buildWorkspaceRuntimeSummary = (sessions: WorkspaceSession[]): WorkspaceRuntimeSummary | undefined => {
  let terminal: WorkspaceTerminalRuntimeSnapshot | undefined
  let environment: WorkspaceEnvironmentRuntimeSnapshot | undefined
  let latestWorkspaceSessionId: string | undefined
  let runningCount = 0
  let queuedCount = 0
  let waitingCount = 0

  for (const session of sortWorkspaceSessions(sessions)) {
    const terminalSnapshot = session.runtimeSummary?.terminal
    terminal = pickWorkspaceTerminalRuntime(terminal, terminalSnapshot)

    const environmentSnapshot = session.runtimeSummary?.environment
    if (environmentSnapshot && isWorkspaceRuntimeSnapshotFresh(environmentSnapshot.checkedAt)) {
      environment = pickWorkspaceEnvironmentRuntime(environment, environmentSnapshot)
    }

    if (session.runtimeStatus === 'running') {
      runningCount += 1
      latestWorkspaceSessionId ??= session.id
    } else if (session.runtimeStatus === 'queued') {
      queuedCount += 1
      latestWorkspaceSessionId ??= session.id
    } else if (session.runtimeStatus === 'waiting') {
      waitingCount += 1
      latestWorkspaceSessionId ??= session.id
    }
  }

  if (!terminal && !environment && runningCount === 0 && queuedCount === 0 && waitingCount === 0) {
    return undefined
  }

  return {
    terminal,
    environment,
    agent: runningCount > 0 || queuedCount > 0 || waitingCount > 0
      ? {
          runningCount,
          queuedCount,
          waitingCount,
          latestWorkspaceSessionId,
        }
      : undefined,
  }
}

const isTeamSharedProjectForUser = (userId: string, projectId: string) => {
  return getUserTeams(userId).some((team) => getTeamProjects(team.id).some((project) => project.projectId === projectId))
}

const resolveProjectWorkspaceRepoPath = (project: Project, workspaceRoot?: string, workspaceId?: string, ownerUserId?: string) => {
  if (project.versionControl === 'git-remote') {
    return undefined
  }

  return resolveProjectRuntimeRootPath(project, workspaceRoot, workspaceId, ownerUserId)
}

export const listProjectWorkspacesForUser = (userId: string, project: Project): Workspace[] => {
  const state = loadState()
  const bindings = listProjectBindings().filter((binding) => binding.projectId === project.id && binding.isActive)
  const visibleExecutors = listVisibleExecutorsForUser(userId)
  const visibleExecutorIds = new Set(visibleExecutors.map((executor) => executor.executorId))
  const visibleExecutorById = new Map(visibleExecutors.map((executor) => [executor.executorId, executor] as const))
  const includeProjectWorkspaces = isTeamSharedProjectForUser(userId, project.id)
  // 共享协作人兜底：对项目所属协作工作区（collab workspace）有生效授权时，相关工作区可见
  const hasSharedWorkspaceAccess = Boolean(project.workspaceId?.trim() && (
    resolveUserWorkspaceShareAccess(userId, project.workspaceId).ok
  ))
  const workspaceSessions = listWorkspaceSessions()
  const projectTasks = state.tasks.filter((task) => task.projectId === project.id)
  const projectTaskById = new Map(projectTasks.map((task) => [task.id, task] as const))
  const taskWorkspaceBindings = listTaskWorkspaceBindings()
  const linkedTaskIdsByWorkspaceId = new Map<string, Set<string>>()
  const addLinkedTaskId = (workspaceId: string | undefined, taskId: string | undefined) => {
    const normalizedWorkspaceId = workspaceId?.trim()
    if (!normalizedWorkspaceId || !taskId || !projectTaskById.has(taskId)) {
      return
    }

    const existing = linkedTaskIdsByWorkspaceId.get(normalizedWorkspaceId)
    if (existing) {
      existing.add(taskId)
    } else {
      linkedTaskIdsByWorkspaceId.set(normalizedWorkspaceId, new Set([taskId]))
    }
  }

  for (const binding of taskWorkspaceBindings) {
    if (binding.status !== 'active') {
      continue
    }

    addLinkedTaskId(binding.workspaceId, binding.taskId)
  }
  const latestSessionByWorkspaceId = new Map(
    workspaceSessions.map((session) => [session.workspaceId, session]),
  )
  const workspaceSessionsByWorkspaceId = new Map<string, WorkspaceSession[]>()
  for (const session of workspaceSessions) {
    const existing = workspaceSessionsByWorkspaceId.get(session.workspaceId)
    if (existing) {
      existing.push(session)
    } else {
      workspaceSessionsByWorkspaceId.set(session.workspaceId, [session])
    }
  }

  for (const task of projectTasks) {
    addLinkedTaskId(task.result?.workspaceId, task.id)
    for (const run of task.executionHistory ?? []) {
      addLinkedTaskId(run.workspaceId, task.id)
      addLinkedTaskId(run.result?.workspaceId, task.id)
    }
  }
  for (const distributedTask of state.distributedTasks) {
    if (distributedTask.projectId !== project.id) {
      continue
    }

    addLinkedTaskId(distributedTask.workspaceId, distributedTask.originTaskId)
    addLinkedTaskId(distributedTask.result?.workspaceId, distributedTask.originTaskId)
  }

  const linkedTasksByWorkspaceId = new Map<string, Task[]>()
  for (const [workspaceId, linkedTaskIds] of linkedTaskIdsByWorkspaceId) {
    linkedTasksByWorkspaceId.set(
      workspaceId,
      projectTasks.filter((task) => linkedTaskIds.has(task.id)),
    )
  }
  const resolveWorkspaceLinkedTasks = (workspaceId: string) => linkedTasksByWorkspaceId.get(workspaceId) ?? []
  const bindingByNodeId = new Map<string, (typeof bindings)[number]>()
  for (const binding of bindings) {
    if (!bindingByNodeId.has(binding.nodeId)) {
      bindingByNodeId.set(binding.nodeId, binding)
    }
  }
  const allExecutors = executorRegistry.listExecutorsWithPresence()
  const executorById = new Map(allExecutors.map((executor) => [executor.executorId, executor] as const))
  const isReferencedWorkspace = (workspaceId: string) => (
    (linkedTaskIdsByWorkspaceId.get(workspaceId)?.size ?? 0) > 0
    || (workspaceSessionsByWorkspaceId.get(workspaceId)?.length ?? 0) > 0
  )
  const shouldIncludeWorkspace = (workspace: WorkspaceRecord) => {
    if (workspace.source !== 'workspace-root') {
      return true
    }

    return isReferencedWorkspace(workspace.id)
  }
  const hasWorkspaceVisibility = (workspace: WorkspaceRecord) => {
    if (includeProjectWorkspaces || visibleExecutorIds.has(workspace.executorNodeId) || hasSharedWorkspaceAccess) {
      return true
    }

    return workspace.source === 'manual' && (!workspace.ownerUserId || workspace.ownerUserId === userId)
  }
  const mergeWorkspaceBinding = (workspace: WorkspaceRecord): WorkspaceRecord => {
    const workspaceWorkerId = resolveWorkspaceWorkerId(workspace)
    const binding = bindingByNodeId.get(workspaceWorkerId)
    const versionControl = project.versionControl ?? (project.gitUrl.trim() ? 'git-remote' : 'none')
    const workingDirectoryMode = resolveWorkingDirectoryMode({
      ...workspace,
      versionControl,
    })
    const repoPath = resolveWorkspaceRepoPath({
      project,
      workspaceRoot: visibleExecutorById.get(workspaceWorkerId)?.workspaceRoot,
      workspace,
      session: undefined,
      bindingPathHint: binding?.pathHint,
    })
    return {
      ...workspace,
      versionControl,
      workingDirectoryMode,
      defaultBranch: workspace.defaultBranch || binding?.defaultBranch || project.defaultBranch,
      repoPath,
      repoReady: Boolean(repoPath),
      status: workspace.status === 'archived'
        ? 'archived'
        : repoPath
          ? 'ready'
          : workspace.status,
      suggestedBaseBranch: resolveSuggestedBaseBranch({
        workingDirectoryMode,
        suggestedBaseBranch: workspace.suggestedBaseBranch,
        fallbackBranch: project.recentBaseBranches?.[0] || project.defaultBranch,
      }),
    }
  }
  const existing: Workspace[] = listWorkspaces()
    .filter((workspace) => workspace.projectId === project.id)
    .filter(hasWorkspaceVisibility)
    .filter(shouldIncludeWorkspace)
    .map((workspace) => {
      const mergedWorkspace = mergeWorkspaceBinding(workspace)
      const displayExecutorId = resolveWorkspaceWorkerId(workspace)
      const executor = executorById.get(displayExecutorId)
      const isExecutorVisible = visibleExecutorIds.has(displayExecutorId)
      const executorStatus: Workspace['executorStatus'] = isExecutorVisible && executor?.status === 'online' ? 'online' : isExecutorVisible && executor?.status === 'paired' ? 'paired' : 'offline'
      const linkedTasks = resolveWorkspaceLinkedTasks(workspace.id)
      const linkedDistributedTaskResults = state.distributedTasks
        .filter((distributedTask) => distributedTask.projectId === project.id)
        .filter((distributedTask) => (
          distributedTask.workspaceId?.trim() === workspace.id
          || distributedTask.result?.workspaceId?.trim() === workspace.id
        ))
        .map((distributedTask) => ({
          result: distributedTask.result,
          updatedAt: distributedTask.updatedAt,
        }))
      const linkedWorkspaceSessions = workspaceSessionsByWorkspaceId.get(workspace.id) ?? []
      const ownerUser = mergedWorkspace.ownerUserId ? getUserById(mergedWorkspace.ownerUserId) : null
      return toWorkspaceView(mergedWorkspace, {
        executorName: executor?.name || displayExecutorId || 'Unknown Executor',
        executorStatus,
        runtimeSummary: buildWorkspaceRuntimeSummary(linkedWorkspaceSessions),
        deliverySummary: buildWorkspaceDeliverySummary(
          [...linkedTasks, ...linkedDistributedTaskResults],
          workspace.id,
          linkedWorkspaceSessions,
        ),
        ownerUserName: ownerUser?.name,
        ownerAvatarUrl: ownerUser?.avatarUrl,
      })
    })

  return sortWorkspacesByDisplayOrder(existing)
}

export const getScopedWorkspaceForProject = (userId: string, project: Project, workspaceId: string) => {
  return listProjectWorkspacesForUser(userId, project).find((workspace) => workspace.id === workspaceId) ?? null
}

export const getWorkspaceBranchSnapshot = async (
  userId: string,
  project: Project,
  workspace: Workspace,
  session?: WorkspaceSession | null,
): Promise<RepoBranchSnapshotResult> => {
  const effectiveSession = session ? hydrateWorkspaceSessionWithLocalWorktree(session, workspace) : null
  const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(workspace, effectiveSession)
  const executorNodeId = effectiveSession
    ? resolveWorkspaceSessionExecutorId(effectiveSession, resolveWorkspaceWorkerId(workspace))
    : resolveWorkspaceWorkerId(workspace)
  const executor = executorNodeId
    ? listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorNodeId)
    : undefined
  const worktreeRepoPath = effectiveSession && workingDirectoryMode === 'worktree'
    ? resolveWorkspaceSessionCwd(executor?.workspaceRoot, project, effectiveSession, workspace)
    : undefined

  if (effectiveSession && workingDirectoryMode === 'worktree' && !worktreeRepoPath) {
    return {
      ok: false,
      branches: [],
      defaultBranch: workspace.defaultBranch || project.defaultBranch || 'main',
      message: '当前工作区会话没有可用 worktree 目录，无法读取分支。',
    }
  }

  return getWorkspaceBranchSnapshotFromExecutor(
    userId,
    project,
    workspace,
    executorNodeId,
    { repoPathOverride: worktreeRepoPath },
  )
}

export const createWorkspaceRecord = (
  project: Project,
  executorId: string,
  _executorName: string,
  name: string,
  ownerUserId?: string,
  agentType: Task['agentType'] = DEFAULT_AGENT_TYPE,
  workingDirectoryMode: WorkingDirectoryMode = 'worktree',
  suggestedBaseBranch?: string,
  autoCommitEnabled?: boolean,
  displayOrder?: number,
  options?: {
    id?: string
    workspaceRoot?: string
  },
): WorkspaceRecord => {
  const timestamp = new Date().toISOString()
  const workspaceId = options?.id?.trim() || crypto.randomUUID()
  const repoPath = isPlaygroundProjectId(project.id)
    ? buildWorkspacePlaygroundSessionDir(options?.workspaceRoot, workspaceId)
    : resolveProjectWorkspaceRepoPath(project, options?.workspaceRoot, workspaceId, ownerUserId)
  const normalizedWorkingDirectoryMode = project.versionControl === 'none'
    ? 'original-dir'
    : resolveWorkingDirectoryMode({ workingDirectoryMode })
  const normalizedSuggestedBaseBranch = resolveSuggestedBaseBranch({
    workingDirectoryMode: normalizedWorkingDirectoryMode,
    suggestedBaseBranch,
    fallbackBranch: project.recentBaseBranches?.[0] || project.defaultBranch,
  })
  const workspaceCodeSeed = {
    id: workspaceId,
    name: name.trim(),
    workingDirectoryMode: normalizedWorkingDirectoryMode,
    defaultBranch: project.defaultBranch,
    codeBranchName: undefined,
  }
  const codeBaseBranch = resolveWorkspaceCodeBaseBranch({
    ...workspaceCodeSeed,
    suggestedBaseBranch: normalizedSuggestedBaseBranch,
    defaultBranch: project.defaultBranch,
  })
  return {
    id: workspaceId,
    projectId: project.id,
    createdBy: resolveUserCreatorIdentity(ownerUserId),
    displayOrder,
    executorNodeId: executorId,
    agentType,
    name: name.trim(),
    status: repoPath ? 'ready' : 'pending_repo',
    repoReady: Boolean(repoPath),
    repoPath,
    worktreeRootPath: undefined,
    source: 'manual',
    defaultBranch: project.defaultBranch,
    suggestedBaseBranch: normalizedSuggestedBaseBranch,
    codeBaseBranch,
    codeBranchName: resolveWorkspaceCodeBranchName({
      workspace: workspaceCodeSeed,
      fallbackBaseBranch: codeBaseBranch,
    }),
    autoCommitEnabled: resolveWorkspaceAutoCommitEnabled({
      workingDirectoryMode: normalizedWorkingDirectoryMode,
      autoCommitEnabled,
    }),
    versionControl: project.versionControl,
    ownerUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
    workingDirectoryMode: normalizedWorkingDirectoryMode,
  } as WorkspaceRecordWithMode
}

export const detachWorkspaceIdsFromTask = (task: Task, workspaceIdSet: Set<string>, timestamp: string) => {
  if (workspaceIdSet.size === 0) {
    return task
  }

  return {
    ...task,
    updatedAt: timestamp,
  } satisfies Task
}

export const listActiveTaskWorkspaceBindings = (taskId: string) => {
  return listTaskWorkspaceBindings(taskId)
    .filter((binding) => binding.status === 'active')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
}

export const getActiveTaskWorkspaceBinding = (taskId: string, workspaceId: string) => {
  const binding = getTaskWorkspaceBinding(taskId, workspaceId)
  return binding?.status === 'active' ? binding : null
}

const listWorkspaceSessionsForTaskBinding = (taskId: string, workspaceId?: string) => {
  const workspaceOnlySessionId = getWorkspaceSessionById(taskId) ? taskId : undefined
  if (workspaceOnlySessionId) {
    const workspaceOnlySession = workspaceId?.trim()
      ? getWorkspaceSessionRecord(workspaceId, workspaceOnlySessionId)
      : getWorkspaceSessionById(workspaceOnlySessionId)
    return workspaceOnlySession && workspaceOnlySession.status !== 'archived'
      ? [withWorkspaceSessionMeta(workspaceOnlySession)]
      : []
  }

  const boundWorkspaceIds = new Set(
    listActiveTaskWorkspaceBindings(taskId)
      .filter((binding) => !workspaceId || binding.workspaceId === workspaceId)
      .map((binding) => binding.workspaceId),
  )
  if (boundWorkspaceIds.size === 0) {
    return []
  }

  const targetWorkspaceId = workspaceId?.trim()
  if (targetWorkspaceId) {
    return listWorkspaceSessionRecordsForWorkspace(targetWorkspaceId)
  }

  return listWorkspaceSessions().filter((session) => boundWorkspaceIds.has(session.workspaceId))
}

export const listWorkspaceSessionRecordsForWorkspace = (workspaceId: string, options?: { includeArchived?: boolean }) => {
  const targetWorkspaceId = workspaceId.trim()
  if (!targetWorkspaceId) {
    return []
  }

  return sortWorkspaceSessions(
    listWorkspaceSessions(targetWorkspaceId)
      .filter((session) => session.workspaceId === targetWorkspaceId)
      .filter((session) => options?.includeArchived || session.status !== 'archived')
      .map((session) => withWorkspaceSessionMeta(session)),
  )
}

export const getWorkspaceSessionRecord = (workspaceId: string, workspaceSessionId?: string) => {
  const sessions = listWorkspaceSessionRecordsForWorkspace(workspaceId)
  if (workspaceSessionId?.trim()) {
    return sessions.find((session) => session.id === workspaceSessionId.trim()) ?? null
  }

  return sessions[0] ?? null
}

export const getWorkspaceSessionRecordForTaskContext = (taskId: string, workspaceId: string, workspaceSessionId?: string) => {
  const workspaceOnlySessionId = getWorkspaceSessionById(taskId) ? taskId : undefined
  const sessions = workspaceOnlySessionId
    ? sortWorkspaceSessions(listWorkspaceSessionsForTaskBinding(taskId, workspaceId))
    : listWorkspaceSessionRecordsForWorkspace(workspaceId)

  if (workspaceSessionId?.trim()) {
    const matched = sessions.find((session) => session.id === workspaceSessionId.trim())
    return matched ? withWorkspaceSessionMeta(matched) : null
  }

  const latest = sessions[0] ?? null
  return latest ? withWorkspaceSessionMeta(latest) : null
}

export const listWorkspaceSessionsForWorkspaceContext = (_taskId: string, workspaceId: string) => {
  return sortWorkspaceSessions(
    listWorkspaceSessionRecordsForWorkspace(workspaceId).map((session) => withWorkspaceSessionMeta(session)),
  )
}

export const ensureTaskWorkspaceBindingRecord = (task: Task, workspaceId: string) => {
  const existing = getActiveTaskWorkspaceBinding(task.id, workspaceId)
  if (existing) {
    return existing
  }

  const binding = createTaskWorkspaceBinding(task.id, workspaceId)
  saveTaskWorkspaceBinding(binding)
  return binding
}

export const ensureTaskWorkspaceBindingState = (params: {
  task: Task
  workspaceId: string
  updatedAt: string
}) => {
  const existing = getActiveTaskWorkspaceBinding(params.task.id, params.workspaceId)
  if (existing) {
    return {
      binding: existing,
      task: params.task,
      created: false,
    }
  }

  const binding = createTaskWorkspaceBinding(params.task.id, params.workspaceId)
  saveTaskWorkspaceBinding(binding)
  const nextTask = syncTaskStatusFromWorkspaceBound(params.task, params.updatedAt)
  if (nextTask.status !== params.task.status) {
    saveTask(nextTask)
  }

  return {
    binding,
    task: nextTask,
    created: true,
  }
}

export const ensureWorkspaceSessionRecord = (params: {
  task: Task
  workspaceId: string
  executorNodeId?: string
  workspace?: WorkspaceRecord | Workspace | null
  workspaceSessionId?: string
  createNewSession?: boolean
  title?: string
  titleOrigin?: WorkspaceSession['titleOrigin']
  customAgentId?: string
  customAgentName?: string
  agentInvocationMode?: WorkspaceSession['agentInvocationMode']
  sessionKind?: WorkspaceSession['sessionKind']
  sessionRole?: WorkspaceSession['sessionRole']
  sessionOrigin?: WorkspaceSession['sessionOrigin']
  parentSessionId?: string
  rootSessionId?: string
  forkMode?: WorkspaceSession['forkMode']
  forkedFromSessionId?: string
  forkedFromMessageId?: string
  forkRevision?: WorkspaceSession['forkRevision']
  pendingRevision?: WorkspaceSession['pendingRevision']
  sharedWorktreeSourceSessionId?: string
  delegatedPrompt?: string
  workingDirectoryMode?: WorkspaceSession['workingDirectoryMode']
}) => {
  const workspaceWorkerId = resolveWorkspaceWorkerId(params.workspace) || params.executorNodeId?.trim() || ''
  const existing = params.createNewSession
    ? null
    : getWorkspaceSessionRecordForTaskContext(params.task.id, params.workspaceId, params.workspaceSessionId)
  if (existing) {
    const nextSession = mergeWorkspaceSession(params.task, existing, {
      executorNodeId: workspaceWorkerId || existing.executorNodeId,
      agentType: existing.agentType ?? params.task.agentType,
      customAgentId: params.customAgentId ?? existing.customAgentId,
      customAgentName: params.customAgentName ?? existing.customAgentName,
      agentInvocationMode: params.agentInvocationMode ?? existing.agentInvocationMode,
      sessionKind: params.sessionKind ?? existing.sessionKind,
      sessionRole: params.sessionRole ?? existing.sessionRole,
      sessionOrigin: params.sessionOrigin ?? existing.sessionOrigin,
      parentSessionId: params.parentSessionId ?? existing.parentSessionId,
      rootSessionId: params.rootSessionId ?? existing.rootSessionId,
      forkMode: params.forkMode ?? existing.forkMode,
      forkedFromSessionId: params.forkedFromSessionId ?? existing.forkedFromSessionId,
      forkedFromMessageId: params.forkedFromMessageId ?? existing.forkedFromMessageId,
      forkRevision: params.forkRevision ?? existing.forkRevision,
      pendingRevision: params.pendingRevision ?? existing.pendingRevision,
      sharedWorktreeSourceSessionId: params.sharedWorktreeSourceSessionId ?? existing.sharedWorktreeSourceSessionId,
      titleOrigin: params.titleOrigin ?? existing.titleOrigin,
      delegatedPrompt: params.delegatedPrompt ?? existing.delegatedPrompt,
      workingDirectoryMode: params.workingDirectoryMode ?? existing.workingDirectoryMode,
      executionModel: existing.executionModel ?? params.task.executionModel,
      opencodeConfig: existing.opencodeConfig ?? params.task.opencodeConfig,
      gitIdentityMode: existing.gitIdentityMode ?? params.task.gitIdentityMode,
      worktreeUniqueId: existing.worktreeUniqueId ?? allocateWorkspaceWorktreeUniqueId(workspaceWorkerId || existing.executorNodeId, existing.id),
    })
    const sessionWithMeta = withWorkspaceSessionMeta(nextSession, {
      title: params.title ?? existing.title,
      status: resolveWorkspaceSessionStatus(existing),
      workingDirectoryMode: params.workingDirectoryMode ?? resolveWorkingDirectoryMode(params.workspace ?? existing),
    })
    saveWorkspaceSession(sessionWithMeta)
    return sessionWithMeta
  }

  const workspaceSessions = listWorkspaceSessionRecordsForWorkspace(params.workspaceId)
  const workingDirectoryMode = params.workingDirectoryMode ?? resolveWorkingDirectoryMode(params.workspace ?? undefined)
  const requestedSharedWorktreeSourceSession = params.sharedWorktreeSourceSessionId
    ? resolveSharedWorktreeSourceSessionById({
        id: '',
        workspaceId: params.workspaceId,
        sharedWorktreeSourceSessionId: params.sharedWorktreeSourceSessionId,
      })
    : resolveDefaultSharedWorktreeSourceSession({
        workspaceId: params.workspaceId,
        executorNodeId: workspaceWorkerId,
        workingDirectoryMode,
      })
  const sharedWorktreeSourceSession = requestedSharedWorktreeSourceSession
    && (!workspaceWorkerId || resolveWorkspaceSessionExecutorId(requestedSharedWorktreeSourceSession) === workspaceWorkerId)
    ? requestedSharedWorktreeSourceSession
    : null
  const session = createWorkspaceSession({
    task: params.task,
    workspaceId: params.workspaceId,
    displayOrder: resolveNextWorkspaceSessionDisplayOrder(workspaceSessions),
    executorNodeId: workspaceWorkerId || undefined,
    customAgentId: params.customAgentId,
    customAgentName: params.customAgentName,
    agentInvocationMode: params.agentInvocationMode,
    sessionKind: params.sessionKind,
    sessionRole: params.sessionRole,
    sessionOrigin: params.sessionOrigin,
    parentSessionId: params.parentSessionId,
    rootSessionId: params.rootSessionId,
    forkMode: params.forkMode,
    forkedFromSessionId: params.forkedFromSessionId,
    forkedFromMessageId: params.forkedFromMessageId,
    forkRevision: params.forkRevision,
    pendingRevision: params.pendingRevision,
    sharedWorktreeSourceSessionId: sharedWorktreeSourceSession?.id,
    titleOrigin: params.titleOrigin,
    delegatedPrompt: params.delegatedPrompt,
    workingDirectoryMode,
    worktreeUniqueId: allocateWorkspaceWorktreeUniqueId(workspaceWorkerId || undefined),
    workspaceName: params.workspace?.name,
  })
  const sessionWithMeta = withWorkspaceSessionMeta(session, {
    title: params.title ?? buildWorkspaceSessionTitle({
      title: (params.sessionKind ?? 'primary') === 'primary'
        ? (workspaceSessions.length === 0 ? (params.task.title.trim() || '默认会话') : `会话 ${workspaceSessions.length + 1}`)
        : undefined,
      sessionKind: params.sessionKind,
      sessionRole: params.sessionRole,
      customAgentName: params.customAgentName,
    }),
    status: 'active',
    workingDirectoryMode,
  })
  const sessionWithSharedWorktree = sharedWorktreeSourceSession
    ? mergeWorkspaceSession(params.task, sessionWithMeta, {
        baseBranch: sharedWorktreeSourceSession.baseBranch,
        branchName: sharedWorktreeSourceSession.branchName,
        worktreeId: sharedWorktreeSourceSession.worktreeId,
        worktreeStatus: sharedWorktreeSourceSession.worktreeStatus,
        worktreeUniqueId: sharedWorktreeSourceSession.worktreeUniqueId,
        currentStep: sharedWorktreeSourceSession.currentStep,
        updatedAt: sessionWithMeta.updatedAt,
      })
    : sessionWithMeta
  saveWorkspaceSession(sessionWithSharedWorktree)
  return sessionWithSharedWorktree
}

export const listWorkspaceSessionsForTaskContext = (taskId: string, workspaceId?: string) => {
  if (workspaceId?.trim()) {
    return sortWorkspaceSessions(
      listWorkspaceSessionRecordsForWorkspace(workspaceId).map((session) => withWorkspaceSessionMeta(session)),
    )
  }

  return sortWorkspaceSessions(
    listWorkspaceSessionsForTaskBinding(taskId, workspaceId)
      .map((session) => withWorkspaceSessionMeta(session)),
  )
}

export const applyWorkspaceSessionView = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (!workspaceId) {
    return task
  }

  const session = getWorkspaceSessionRecordForTaskContext(task.id, workspaceId, workspaceSessionId)
  return buildWorkspaceTaskExecutionView(task, session)
}

type WorkspaceDirectorySessionLike = Pick<WorkspaceSession, 'id' | 'workspaceId' | 'worktreeId' | 'executorNodeId' | 'runtimeOwnerExecutorId'> & {
  baseBranch?: string
  branchName: string
  sharedWorktreeSourceSessionId?: string
  workingDirectoryMode?: WorkingDirectoryMode
  worktreeStatus?: WorkspaceSession['worktreeStatus']
  worktreeUniqueId?: number
}

type WorkspaceDirectoryWorkspaceLike = Pick<Workspace, 'id' | 'ownerUserId' | 'repoPath'> & {
  executorNodeId?: string | null
  workingDirectoryMode?: WorkingDirectoryMode | null
  projectId?: string
}

const normalizeWorkspaceDirectorySession = (session: WorkspaceDirectorySessionLike) => ({
  id: session.id,
  workspaceId: session.workspaceId,
  executorNodeId: session.executorNodeId,
  runtimeOwnerExecutorId: session.runtimeOwnerExecutorId,
  worktreeId: session.worktreeId,
  worktreeUniqueId: session.worktreeUniqueId,
  worktreeStatus: session.worktreeStatus ?? 'planned' as const,
  workingDirectoryMode: resolveWorkingDirectoryMode(session),
})

const normalizeWorkspaceDirectoryWorkspace = (workspace?: WorkspaceDirectoryWorkspaceLike | null) => {
  if (!workspace) {
    return workspace
  }

  return {
    ...workspace,
    executorNodeId: workspace.executorNodeId ?? undefined,
    workingDirectoryMode: workspace.workingDirectoryMode ?? undefined,
  }
}

export const resolveWorkspaceSessionDirectoryView = (
  session: WorkspaceDirectorySessionLike,
  workspace?: WorkspaceDirectoryWorkspaceLike | null,
  workspaceExecutorId?: string | null,
  sourceSession?: WorkspaceDirectorySessionLike | null,
  projectId?: string | null,
) => {
  const effectiveSession = sourceSession ?? resolveSharedWorktreeSourceSessionById(session) ?? session
  const effectiveWorkingDirectoryMode = resolveWorkingDirectoryMode(effectiveSession)
  const localWorktree = workspace
    ? resolveWorkspaceLocalWorktreeSnapshot({
        workspace: {
          id: workspace.id,
          name: '',
          codeBaseBranch: undefined,
          codeBranchName: undefined,
          suggestedBaseBranch: undefined,
          defaultBranch: undefined,
          workingDirectoryMode: workspace.workingDirectoryMode ?? effectiveWorkingDirectoryMode,
          executorNodeId: workspace.executorNodeId ?? '',
        },
        session: {
          ...effectiveSession,
          worktreeStatus: effectiveSession.worktreeStatus ?? 'planned',
          workingDirectoryMode: effectiveWorkingDirectoryMode,
        },
      })
    : null
  const directorySource = localWorktree
    ? {
        ...effectiveSession,
        executorNodeId: localWorktree.executorNodeId,
        runtimeOwnerExecutorId: localWorktree.executorNodeId,
        worktreeId: localWorktree.worktreeId ?? effectiveSession.worktreeId,
        worktreeUniqueId: localWorktree.worktreeUniqueId ?? effectiveSession.worktreeUniqueId,
        worktreeStatus: localWorktree.status,
        workingDirectoryMode: localWorktree.workingDirectoryMode,
      }
    : effectiveSession
  const workspaceId = workspace?.id?.trim() || effectiveSession.workspaceId
  const workingDirectoryMode = resolveWorkingDirectoryMode(directorySource)
  const executorId = resolveWorkspaceSessionExecutorId(directorySource, workspaceExecutorId ?? workspace?.executorNodeId)
  const normalizedSession = normalizeWorkspaceDirectorySession(session)
  const normalizedEffectiveSession = normalizeWorkspaceDirectorySession(directorySource)
  const directory = resolveWorkspaceDirectoryView({
    workspace: {
      id: workspaceId,
      executorNodeId: executorId,
      workingDirectoryMode: workspace?.workingDirectoryMode ?? workingDirectoryMode,
      projectId: projectId ?? workspace?.projectId ?? undefined,
    },
    session: normalizedSession,
    sourceSession: normalizedEffectiveSession,
  })

  return {
    directory,
    effectiveSession: directorySource,
  }
}

export const hydrateWorkspaceSessionWithLocalWorktree = (
  session: WorkspaceSession,
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode' | 'executorNodeId'>,
): WorkspaceSession => {
  const localWorktree = resolveWorkspaceLocalWorktreeSnapshot({
    workspace,
    session,
  })

  return {
    ...session,
    executorNodeId: localWorktree.executorNodeId || session.executorNodeId,
    runtimeOwnerExecutorId: localWorktree.executorNodeId || session.runtimeOwnerExecutorId,
    worktreeId: localWorktree.worktreeId ?? session.worktreeId,
    worktreeUniqueId: localWorktree.worktreeUniqueId ?? session.worktreeUniqueId,
    worktreeStatus: localWorktree.status,
    workingDirectoryMode: localWorktree.workingDirectoryMode,
  }
}

export const resolveWorkspaceDirectoryCwd = (
  workspaceRoot: string | undefined,
  project: Project,
  directory: WorkspaceDirectoryView,
  workspace?: WorkspaceDirectoryWorkspaceLike | null,
) => {
  const bindingPathHint = directory.executorId
    ? listProjectBindings().find((binding) => (
      binding.projectId === project.id
      && binding.nodeId === directory.executorId
      && binding.isActive
    ))?.pathHint
    : undefined

  // 无项目自由工作区：目录固定在 workspaces/<wid>/playground/<YYYY-MM-DD>-<suffix>
  // （workspace 创建时生成一次并存 repoPath，所有 session 共享，类似 codex desktop 的文件夹模型）
  if (isPlaygroundProjectId(project.id)) {
    return workspace?.repoPath?.trim() || buildWorkspacePlaygroundSessionDir(workspaceRoot, directory.workspaceId)
  }

  if (directory.workingDirectoryMode === 'original-dir') {
    return resolveWorkspaceRepoPath({
      project,
      workspaceRoot,
      workspace: normalizeWorkspaceDirectoryWorkspace(workspace),
      session: {
        workspaceId: directory.workspaceId,
        executorNodeId: directory.executorId,
        runtimeOwnerExecutorId: directory.executorId,
        workingDirectoryMode: directory.workingDirectoryMode,
      },
      bindingPathHint,
    })
  }

  if (project.versionControl === 'none') {
    return resolveProjectRuntimeRootPath(project, workspaceRoot, directory.workspaceId, workspace?.ownerUserId)
  }

  return resolveTaskWorktreePath(workspaceRoot, project, {
    id: directory.sourceWorkspaceSessionId || directory.workspaceSessionId || directory.workspaceId,
    workspaceId: directory.workspaceId,
    worktreeId: directory.worktreeId,
    ownerUserId: workspace?.ownerUserId,
  })
}

export const resolveWorkspaceSessionCwd = (
  workspaceRoot: string | undefined,
  project: Project,
  session: WorkspaceDirectorySessionLike,
  workspace?: WorkspaceDirectoryWorkspaceLike | null,
) => {
  const { directory } = resolveWorkspaceSessionDirectoryView(session, workspace, undefined, undefined, project.id)
  return resolveWorkspaceDirectoryCwd(workspaceRoot, project, directory, workspace)
}

export const upsertTaskWorkspaceBindingInState = (state: AppState, binding: TaskWorkspaceBinding): AppState => ({
  ...state,
  taskWorkspaceBindings: state.taskWorkspaceBindings.some((item) => item.taskId === binding.taskId && item.workspaceId === binding.workspaceId)
    ? state.taskWorkspaceBindings.map((item) => (item.taskId === binding.taskId && item.workspaceId === binding.workspaceId ? binding : item))
    : [binding, ...state.taskWorkspaceBindings],
})

export const upsertWorkspaceSessionInState = (state: AppState, session: WorkspaceSession): AppState => ({
  ...state,
  workspaceSessions: state.workspaceSessions.some((item) => item.id === session.id)
    ? state.workspaceSessions.map((item) => (item.id === session.id ? session : item))
    : [session, ...state.workspaceSessions],
})

export const buildWorkspaceDirectorySessions = (params: {
  task: Task
  currentSession: WorkspaceSession
  effectiveSession: WorkspaceSession
  patch: Partial<WorkspaceSession>
}) => {
  const nextEffectiveSession = mergeWorkspaceSession(params.task, params.effectiveSession, params.patch)

  if (params.currentSession.id === params.effectiveSession.id) {
    return {
      nextEffectiveSession,
      nextCurrentSession: nextEffectiveSession,
    }
  }

  const nextCurrentSession = mergeWorkspaceSession(params.task, params.currentSession, {
    ...params.patch,
    worktreeId: nextEffectiveSession.worktreeId,
    worktreeUniqueId: nextEffectiveSession.worktreeUniqueId,
    worktreeStatus: nextEffectiveSession.worktreeStatus,
    branchName: nextEffectiveSession.branchName,
    baseBranch: nextEffectiveSession.baseBranch,
  })

  return {
    nextEffectiveSession,
    nextCurrentSession,
  }
}

export const saveWorkspaceDirectorySessions = (params: {
  task: Task
  currentSession: WorkspaceSession
  effectiveSession: WorkspaceSession
  patch: Partial<WorkspaceSession>
}) => {
  const { nextEffectiveSession, nextCurrentSession } = buildWorkspaceDirectorySessions(params)
  saveWorkspaceSession(nextEffectiveSession)
  if (nextCurrentSession.id !== nextEffectiveSession.id) {
    saveWorkspaceSession(nextCurrentSession)
  }
  const workspace = listWorkspaces().find((item) => item.id === nextEffectiveSession.workspaceId)
  if (workspace) {
    upsertWorkspaceLocalWorktreeSnapshot({
      workspace,
      session: nextEffectiveSession,
      updatedAt: nextEffectiveSession.updatedAt,
    })
  }

  return nextCurrentSession
}

const attachChangeSummaryToDeliveryEvents = (
  events: ChatTimelineEvent[],
  result: AgentMessageResult,
): ChatTimelineEvent[] => {
  if (!result.changeSummary) {
    return events
  }

  let attached = false
  const nextEvents = events.map((event) => {
    if (event.kind !== 'delivery_result') {
      return event
    }

    attached = true
    return {
      ...event,
      changeSummary: event.changeSummary ?? result.changeSummary,
    }
  })

  if (attached) {
    return nextEvents
  }

  const lastEvent = nextEvents.at(-1)
  const ts = lastEvent?.ts ?? new Date().toISOString()
  const turnId = result.turnId ?? lastEvent?.turnId ?? crypto.randomUUID()
  const seq = nextEvents.reduce((maxSeq, event) => Math.max(maxSeq, event.seq), 0) + 1
  return [
    ...nextEvents,
    {
      id: `turn:${turnId}:delivery:change-summary`,
      ts,
      turnId,
      seq,
      kind: 'delivery_result',
      message: '本轮变更已记录。',
      remoteBranchName: result.remoteBranchName,
      commitShas: result.commitShas,
      delivery: result.delivery,
      changeSummary: result.changeSummary,
    },
  ]
}

export const persistTaskConversationTurn = async (params: {
  project: Project
  task: Task
  userId: string
  author?: CreatorIdentity
  userMessage: string
  result: AgentMessageResult
  attachments?: Array<{ id: string; url: string; filename: string; contentType?: string }>
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const workspaceSession = params.workspaceSessionId
    ? getWorkspaceSessionById(params.workspaceSessionId)
    : undefined
  const assistantAuthorName = getServerAgentLabel(workspaceSession?.agentType ?? params.task.agentType ?? DEFAULT_AGENT_TYPE)
  const turnId = params.result.turnId ?? crypto.randomUUID()
  const author = params.author ?? resolveUserCreatorIdentity(params.userId) ?? {
    type: 'user' as const,
    id: params.userId,
    name: params.userId,
  }
  const userEvent = createUserMessageEvent(
    createTimelineCollector(turnId),
    `user:${turnId}`,
    params.userMessage,
    new Date().toISOString(),
    params.attachments,
    {
      authorId: author.id,
      author,
    },
  )
  const events = attachChangeSummaryToDeliveryEvents([
    userEvent,
    ...collapseDuplicateAssistantEvents(params.result.conversationTimeline ?? []),
  ], params.result)
  const { conversation } = appendTaskConversationMessage({
    task: params.task,
    project: params.project,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    role: author.type === 'user' ? 'user' : 'assistant',
    senderId: author.id,
    content: params.userMessage,
    contentType: 'json',
    externalRef: {
      attachments: params.attachments,
      timelineEvent: userEvent,
    },
  })

  console.log('[task-conversation] persist', JSON.stringify({
    taskId: params.task.id,
    requestedWorkspaceId: params.workspaceId ?? null,
    requestedWorkspaceSessionId: params.workspaceSessionId ?? null,
    conversationTaskWorkspaceId: params.workspaceId ?? null,
    conversationId: conversation.id,
    resultOk: params.result.ok,
    userPreview: params.userMessage.slice(0, 120),
    outputPreview: (params.result.output ?? '').slice(0, 120),
    eventCount: events.length,
  }))

  for (const event of events.slice(1)) {
    appendTaskConversationMessage({
      task: params.task,
      project: params.project,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
      role: event.kind === 'user_message'
        ? 'user'
        : event.kind === 'assistant_message' || event.kind === 'thinking'
          ? 'assistant'
          : 'system',
      content: event.kind === 'user_message' || event.kind === 'assistant_message'
        ? event.text
        : event.kind === 'thinking'
          ? event.text
          : event.kind === 'tool_call'
            ? event.toolCall.name
            : event.kind === 'interaction'
              ? event.interaction.prompt || event.interaction.title
            : event.kind === 'status'
              ? event.step
              : event.message,
      contentType: 'json',
      externalRef: {
        ...(event.kind === 'assistant_message' ? { agentName: assistantAuthorName } : {}),
        timelineEvent: event,
      },
    })
  }

  const currentWorkspaceSession = params.workspaceId && params.workspaceSessionId
    ? getWorkspaceSessionById(params.workspaceSessionId)
    : undefined
  if (params.workspaceId && params.workspaceSessionId && currentWorkspaceSession) {
    const workspaceId = params.workspaceId
    const workspaceSessionId = params.workspaceSessionId
    const historyEvents: WorkspaceSessionEventRecord[] = []
    for (const event of events) {
      let historyEvent: WorkspaceSessionEventRecord
      switch (event.kind) {
        case 'user_message':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'user_message',
            createdAt: event.ts,
            payload: {
              messageId: event.messageId,
              text: event.text,
              authorId: event.authorId,
              author: event.author,
              attachments: event.attachments,
            },
          }
          break
        case 'assistant_message':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'assistant_message',
            createdAt: event.ts,
            payload: {
              messageId: event.messageId,
              text: event.text,
              authorName: event.authorName,
              executionModel: event.executionModel,
              attachments: event.attachments,
            },
          }
          break
        case 'system_message':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'system_message',
            createdAt: event.ts,
            payload: {
              message: event.message,
            },
          }
          break
        case 'delivery_result':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'delivery_result',
            createdAt: event.ts,
            payload: {
              message: event.message,
              remoteBranchName: event.remoteBranchName,
              commitShas: event.commitShas,
              delivery: event.delivery,
              changeSummary: event.changeSummary,
            },
          }
          break
        case 'thinking':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'thinking',
            createdAt: event.ts,
            payload: {
              partId: event.partId,
              messageId: event.messageId,
              text: event.text,
            },
          }
          break
        case 'tool_call':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'tool_call',
            createdAt: event.ts,
            payload: {
              toolCall: event.toolCall,
            },
          }
          break
        case 'interaction':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'interaction',
            createdAt: event.ts,
            payload: {
              interaction: event.interaction,
            },
          }
          break
        case 'status':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'status',
            createdAt: event.ts,
            payload: {
              status: event.status,
              step: event.step,
            },
          }
          break
        case 'error':
          historyEvent = {
            id: event.id,
            sessionId: workspaceSessionId,
            turnId,
            sessionSeq: 0,
            turnSeq: event.seq,
            visibility: 'transcript',
            kind: 'error',
            createdAt: event.ts,
            payload: {
              message: event.message,
            },
          }
          break
      }
      historyEvents.push(historyEvent)
    }

    const runtimeSnapshot: WorkspaceSessionRuntimeSnapshot = {
      sessionId: workspaceSessionId,
      taskId: params.task.id,
      workspaceId,
      agentRunningStatus: params.result.agentRunningStatus ?? (params.result.ok ? 'complete' : 'error'),
      runtimeStatus: params.result.agentRunningStatus === 'waiting'
        ? 'waiting'
        : params.result.ok
          ? 'completed'
          : 'error',
      currentStep: params.result.currentStep ?? (params.result.ok ? '工作区对话已完成' : '工作区对话失败'),
      queueStatus: 'idle',
      activeToolCalls: (params.result.toolCalls ?? params.task.toolCalls ?? []).filter((toolCall) => !toolCall.finishedAt),
      lastEventSeq: 0,
      lastEventAt: historyEvents.at(-1)?.createdAt,
      updatedAt: new Date().toISOString(),
    }

    const turnRecord: WorkspaceSessionTurnRecord = {
      id: turnId,
      sessionId: workspaceSessionId,
      status: params.result.ok ? 'completed' : 'error',
      startedAt: historyEvents[0]?.createdAt ?? new Date().toISOString(),
      finishedAt: historyEvents.at(-1)?.createdAt ?? new Date().toISOString(),
      eventCount: historyEvents.length,
      usage: params.result.usage,
    }

    const conversationPayload = getTaskConversationWithMessages(
      params.task,
      params.project,
      params.workspaceId,
      params.workspaceSessionId,
    )
    const handoffSnapshot = buildTaskConversationHandoffSnapshot(conversationPayload.messages)
    try {
      await persistWorkspaceSessionStateBeforeHistory(
        () => saveWorkspaceSessionAndWait(mergeWorkspaceSession(params.task, currentWorkspaceSession, {
          pendingRevision: undefined,
          handoffSnapshot,
          lastActiveAt: conversationPayload.messages.at(-1)?.createdAt ?? currentWorkspaceSession.lastActiveAt,
          updatedAt: new Date().toISOString(),
        })),
        () => persistWorkspaceSessionTurnHistory({
          sessionId: workspaceSessionId,
          taskId: params.task.id,
          workspaceId,
          turn: turnRecord,
          events: historyEvents,
          runtime: runtimeSnapshot,
          sourceSessionId: currentWorkspaceSession.forkedFromSessionId,
          pendingRevision: currentWorkspaceSession.pendingRevision,
        }),
      )
      // 统一 usage 事件：工作区会话 turn 链路。
      if (params.result.usage) {
        await recordUsageEvent({
          runKind: 'workspace_turn',
          runId: turnId,
          userId: params.userId,
          agentName: workspaceSession?.agentType ? getServerAgentLabel(workspaceSession.agentType) : undefined,
          conversationId: conversation.id,
          workspaceId: params.workspaceId ?? workspaceId,
          workspaceSessionId: params.workspaceSessionId ?? workspaceSessionId,
          taskId: params.task.id,
          projectId: params.project.id,
          executionModel: params.task.executionModel,
          usage: params.result.usage,
        }).catch((error) => {
          console.warn('[usage-event] workspace_turn record failed', error)
        })
      }
    } catch (error) {
      console.error('[workspace-session-history] persist turn failed', error)
    }
  }

  recordTaskAgentTurn({
    task: params.task,
    project: params.project,
    result: params.result,
    previousToolCalls: params.task.toolCalls ?? [],
    conversationId: conversation.id,
    workspaceId: params.workspaceId,
    triggeredByUserId: params.userId,
  })
}

export const resolveWorkspaceWorkingDirectoryMode = (workspace?: Workspace | WorkspaceRecord | null, session?: WorkspaceSession | null): WorkingDirectoryMode => {
  return resolveWorkingDirectoryMode((session as WorkspaceSessionWithMeta | null | undefined) ?? (workspace as WorkspaceWithMode | null | undefined))
}

export const hasOriginalDirSessionConflict = (params: {
  state: AppState
  workspaceId: string
  currentSessionId?: string
}) => {
  return params.state.workspaceSessions.some((session) => {
    const current = session as WorkspaceSessionWithMeta
    if (session.workspaceId !== params.workspaceId) {
      return false
    }
    if (params.currentSessionId && session.id === params.currentSessionId) {
      return false
    }
    if (resolveWorkspaceSessionStatus(current) === 'archived') {
      return false
    }
    if (resolveWorkingDirectoryMode(current) !== 'original-dir') {
      return false
    }
    return current.agentRunningStatus === 'thinking'
      || current.agentRunningStatus === 'executing'
      || current.agentRunningStatus === 'waiting'
  })
}
