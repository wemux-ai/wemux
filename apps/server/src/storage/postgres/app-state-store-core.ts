/**
 * [INPUT]: Domain records and full application state snapshots.
 * [OUTPUT]: In-memory state reconciliation and durable Postgres persistence for server-owned entities.
 * [POS]: Server storage boundary; Task↔Workspace relations come only from task_workspace_bindings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { normalizeMainChatSessionState } from '@shared/main-chat-session'
import { sortProjectsByDisplayOrder } from '@shared/project-workspace-order'
import { preserveWorkspaceSessionTitle, sortWorkspaceSessions } from '@shared/task-workspace'
import type { AppState, ExecutionCenter, MainChatSession, Project, Task, TaskRun, TaskWorkspaceBinding, WorkspaceSession, ChatMessage } from '@shared/types'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { deleteWorkspaces, listDistributedTasks, listNodes, listProjectBindings, listWorkspaces, resetClusterData } from './distributed-task-store'
import { ensurePostgresReady } from './db'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import {
  appMeta,
  collabWorkspaceProjects,
  executionLogs,
  projectGitCredentialBindings,
  projectRuntimeEnvironmentConfigs,
  projects,
  taskCollaboration,
  taskRuns,
  tasks,
  taskWorkspaceBindings,
  teamProjects,
  userProjects,
  users,
  workspaceSessionHistoryProjection,
  workspaceSessions,
} from './schema'
import { initialServerState } from './app-state-seed'
import { composeState, defaultMetaState, domainStateCache, getStateResources, metaCache, taskRunCache, uiStateCache } from './app-state-store-core-cache'
import { backfillMainChatOwnerFromMessages, backfillMainChatThreads, readMainChatSessionsFromThreads, resetThreadStoreSnapshot, runMainChatRetentionThrottled, syncMainChatThreads, syncSnapshotFromSessions } from './thread-message-store'
import {
  applyTaskCollaborationRow,
  extractLegacyTaskRunsFromTasks,
  hydrateTaskExecutionHistory,
  mapProjectRow,
  mapTaskRow,
  mapTaskRunRow,
  mapTaskWorkspaceBindingRow,
  mapWorkspaceSessionRow,
  normalizeAdapters,
  normalizeConfig,
  normalizeFilters,
  normalizeMainChatSessions,
} from './app-state-store-core-mappers'
import { persistProject, persistTask, persistTaskRun, persistTaskWorkspaceBinding, persistWorkspaceSession } from './app-state-store-core-persistence'
import type { LogRow, ProjectRow, TaskCollaborationRow, TaskRow, TaskRunRow, TaskWorkspaceBindingRow, WorkspaceSessionRow } from './app-state-store-core-types'
import { deleteWorkspaceSessionPersistedHistory } from './workspace-session-history-store'
import { notifyWorkspaceSessionCompletionIfNeeded } from '../../services/workspace-session-completion-notifier'

export { defaultMetaState, getStateResources }

const assignState = (nextState: AppState) => {
  domainStateCache.projects = nextState.projects
  domainStateCache.tasks = nextState.tasks.map(hydrateTaskExecutionHistory)
  domainStateCache.nodes = nextState.nodes
  domainStateCache.projectBindings = nextState.projectBindings
  domainStateCache.distributedTasks = nextState.distributedTasks
  domainStateCache.taskWorkspaceBindings = nextState.taskWorkspaceBindings
  domainStateCache.workspaceSessions = nextState.workspaceSessions
  uiStateCache.mainChatSessions = nextState.mainChatSessions
  uiStateCache.selectedMainChatSessionId = nextState.selectedMainChatSessionId
  uiStateCache.selectedProjectId = nextState.selectedProjectId
  uiStateCache.selectedTaskId = nextState.selectedTaskId
  uiStateCache.filters = nextState.filters
  uiStateCache.config = nextState.config
  uiStateCache.adapters = nextState.adapters
  uiStateCache.executionCenter = nextState.executionCenter
}

const toSnakeProjectRow = (row: typeof projects.$inferSelect & { creator_name: string | null; creator_avatar_url: string | null }): ProjectRow => ({
  id: row.id,
  name: row.name,
  display_order: row.displayOrder,
  color: row.color,
  workspace_id: row.workspaceId,
  visibility: row.visibility,
  git_url: row.gitUrl,
  local_path: row.localPath,
  version_control: row.versionControl,
  default_branch: row.defaultBranch,
  preferred_executor_id: row.preferredExecutorId,
  repository_clone_status: row.repositoryCloneStatus,
  repository_clone_message: row.repositoryCloneMessage,
  command_presets_json: row.commandPresetsJson,
  default_command_preset_id: row.defaultCommandPresetId,
  environment_template_json: row.environmentTemplateJson,
  recent_base_branches_json: row.recentBaseBranchesJson,
  created_by: row.createdBy,
  creator_name: row.creator_name,
  creator_avatar_url: row.creator_avatar_url,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
})

const toSnakeTaskRow = (row: typeof tasks.$inferSelect): TaskRow => ({
  id: row.id,
  project_id: row.projectId,
  parent_task_id: row.parentTaskId,
  creator_json: row.creatorJson,
  origin_type: row.originType,
  origin_id: row.originId,
  title: row.title,
  description: row.description,
  assignee_id: row.assigneeId,
  assignee_agent_id: row.assigneeAgentId,
  assignee_agent_group_id: row.assigneeAgentGroupId,
  status: row.status,
  agent_type: row.agentType,
  execution_model: row.executionModel,
  opencode_config_json: row.opencodeConfigJson,
  execution_mode: row.executionMode,
  agent_managed: row.agentManaged,
  priority: row.priority,
  retry_count: row.retryCount,
  created_at: row.createdAt,
  started_at: row.startedAt,
  due_at: row.dueAt,
  updated_at: row.updatedAt,
  base_branch: row.baseBranch,
  acceptance_criteria: row.acceptanceCriteria,
  draft_id: row.draftId,
  draft_saved_at: row.draftSavedAt,
  recommended_title: row.recommendedTitle,
  command_preset_id: row.commandPresetId,
  base_branch_hint: row.baseBranchHint,
  auto_review_json: row.autoReviewJson,
  requirement_type: row.requirementType ?? null,
  needs_human_confirm: row.needsHumanConfirm,
  agent_running_status: row.agentRunningStatus,
  current_step: row.currentStep,
  attachments_json: row.attachmentsJson ?? [],
  reactions_json: row.reactionsJson ?? [],
  completed_at: row.completedAt ?? null,
})

const toSnakeLogRow = (row: typeof executionLogs.$inferSelect): LogRow => ({
  id: row.id,
  task_id: row.taskId,
  role: row.role as LogRow['role'],
  content: row.content,
  workspace_id: row.workspaceId,
  workspace_session_id: row.workspaceSessionId,
  created_at: row.createdAt,
})

const toSnakeTaskRunRow = (row: typeof taskRuns.$inferSelect): TaskRunRow => ({
  id: row.id,
  task_id: row.taskId,
  project_id: row.projectId,
  distributed_task_id: row.distributedTaskId,
  workspace_id: row.workspaceId,
  workspace_session_id: row.workspaceSessionId,
  executor_node_id: row.executorNodeId,
  base_branch: row.baseBranch,
  return_mode: row.returnMode as TaskRunRow['return_mode'],
  git_identity_mode: row.gitIdentityMode as TaskRunRow['git_identity_mode'],
  agent_session_id: row.agentSessionId,
  execution_model: row.executionModel,
  usage_json: row.usageJson,
  status: row.status,
  summary: row.summary,
  result_json: row.resultJson,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
})

const toSnakeCollabRow = (row: typeof taskCollaboration.$inferSelect): TaskCollaborationRow => ({
  task_id: row.taskId,
  comments_json: row.commentsJson,
  subscriber_ids_json: row.subscriberIdsJson,
  tool_calls_json: row.toolCallsJson,
  history_json: row.historyJson,
  orchestration_json: row.orchestrationJson,
  validation_checks_json: row.validationChecksJson,
  updated_at: row.updatedAt,
})

const toSnakeBindingRow = (row: typeof taskWorkspaceBindings.$inferSelect): TaskWorkspaceBindingRow => ({
  id: row.id,
  task_id: row.taskId,
  workspace_id: row.workspaceId,
  status: row.status,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
})

const toSnakeWorkspaceSessionRow = (
  session: typeof workspaceSessions.$inferSelect,
  history: typeof workspaceSessionHistoryProjection.$inferSelect | null,
): WorkspaceSessionRow => ({
  id: session.id,
  workspace_id: session.workspaceId,
  history_task_id: history?.taskId ?? null,
  display_order: session.displayOrder,
  pinned_at: session.pinnedAt,
  title: session.title,
  title_origin: session.titleOrigin,
  status: session.status,
  session_kind: session.sessionKind,
  session_role: session.sessionRole,
  session_origin: session.sessionOrigin,
  parent_session_id: session.parentSessionId,
  root_session_id: session.rootSessionId,
  fork_mode: session.forkMode,
  forked_from_session_id: session.forkedFromSessionId,
  forked_from_message_id: session.forkedFromMessageId,
  fork_revision_json: session.forkRevisionJson,
  pending_revision_json: session.pendingRevisionJson,
  shared_worktree_source_session_id: session.sharedWorktreeSourceSessionId,
  executor_node_id: session.executorNodeId,
  agent_type: session.agentType,
  custom_agent_id: session.customAgentId,
  custom_agent_name: session.customAgentName,
  agent_invocation_mode: session.agentInvocationMode,
  mounted_skill_names_json: session.mountedSkillNamesJson,
  mounted_mcp_server_names_json: session.mountedMcpServerNamesJson,
  enabled_mcp_server_ids_json: session.enabledMcpServerIdsJson,
  delegated_prompt: session.delegatedPrompt,
  execution_model: session.executionModel,
  agent_settings_json: session.agentSettingsJson,
  opencode_config_json: session.opencodeConfigJson,
  git_identity_mode: session.gitIdentityMode,
  publish_policy: session.publishPolicy,
  git_auth_preference: session.gitAuthPreference,
  distributed_task_id: session.distributedTaskId,
  agent_session_id: session.agentSessionId,
  runtime_continuations_json: session.runtimeContinuationsJson,
  handoff_snapshot_json: session.handoffSnapshotJson,
  base_branch: session.baseBranch,
  worktree_id: session.worktreeId,
  worktree_unique_id: session.worktreeUniqueId,
  branch_name: session.branchName,
  worktree_status: session.worktreeStatus,
  working_directory_mode: session.workingDirectoryMode,
  needs_human_confirm: session.needsHumanConfirm,
  agent_running_status: session.agentRunningStatus,
  runtime_status: session.runtimeStatus,
  runtime_session_id: session.runtimeSessionId,
  runtime_owner_executor_id: session.runtimeOwnerExecutorId,
  runtime_started_at: session.runtimeStartedAt,
  last_heartbeat_at: session.lastHeartbeatAt,
  last_runtime_event_at: session.lastRuntimeEventAt,
  terminal_reason: session.terminalReason,
  runtime_summary_json: session.runtimeSummaryJson,
  delivery_summary_json: session.deliverySummaryJson,
  runtime_sequence: session.runtimeSequence,
  current_step: session.currentStep,
  history_latest_turn_id: history?.latestTurnId ?? null,
  history_latest_event_kind: history?.latestEventKind ?? null,
  history_latest_event_seq: history?.latestEventSeq ?? null,
  history_total_event_count: history?.totalEventCount ?? null,
  history_last_event_at: history?.lastEventAt ?? null,
  history_latest_user_message_id: history?.latestUserMessageId ?? null,
  history_latest_user_message_preview: history?.latestUserMessagePreview ?? null,
  history_latest_assistant_message_id: history?.latestAssistantMessageId ?? null,
  history_latest_assistant_message_preview: history?.latestAssistantMessagePreview ?? null,
  history_last_persisted_turn_started_at: history?.lastPersistedTurnStartedAt ?? null,
  history_last_persisted_turn_finished_at: history?.lastPersistedTurnFinishedAt ?? null,
  history_last_persisted_turn_status: history?.lastPersistedTurnStatus ?? null,
  history_deleted_turn_count: history?.deletedTurnCount ?? null,
  history_updated_at: history?.updatedAt ?? null,
  last_active_at: session.lastActiveAt,
  created_at: session.createdAt,
  updated_at: session.updatedAt,
})

export const initAppStateStore = async () => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const [
    projectRowsRaw,
    taskRowsRaw,
    logRowsRaw,
    metaRows,
    taskRunRowsRaw,
    collabRowsRaw,
    bindingRowsRaw,
    workspaceSessionJoinRows,
  ] = await Promise.all([
    db
      .select({
        project: projects,
        creator_name: users.name,
        creator_avatar_url: users.avatarUrl,
      })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.createdBy))
      .orderBy(sql`${projects.displayOrder} ASC NULLS LAST`, desc(projects.updatedAt)),
    db.select().from(tasks).orderBy(desc(tasks.updatedAt)),
    db.select().from(executionLogs).orderBy(asc(executionLogs.createdAt)),
    db.select({ key: appMeta.key, value: appMeta.value }).from(appMeta),
    db.select().from(taskRuns).orderBy(desc(taskRuns.createdAt)),
    db.select().from(taskCollaboration),
    db.select().from(taskWorkspaceBindings).orderBy(desc(taskWorkspaceBindings.updatedAt)),
    db
      .select({
        session: workspaceSessions,
        history: workspaceSessionHistoryProjection,
      })
      .from(workspaceSessions)
      .leftJoin(workspaceSessionHistoryProjection, eq(workspaceSessionHistoryProjection.sessionId, workspaceSessions.id))
      .orderBy(desc(workspaceSessions.updatedAt)),
  ])

  const projectRows = projectRowsRaw.map((row) => toSnakeProjectRow({
    ...row.project,
    creator_name: row.creator_name,
    creator_avatar_url: row.creator_avatar_url,
  }))
  const taskRows = taskRowsRaw.map(toSnakeTaskRow)
  const logRows = logRowsRaw.map(toSnakeLogRow)
  const taskRunRows = taskRunRowsRaw.map(toSnakeTaskRunRow)
  const collabRows = collabRowsRaw.map(toSnakeCollabRow)
  const bindingRows = bindingRowsRaw.map(toSnakeBindingRow)
  const workspaceSessionRows = workspaceSessionJoinRows.map((row) =>
    toSnakeWorkspaceSessionRow(row.session, row.history ?? null)
  )

  const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value])) as Partial<Record<keyof typeof defaultMetaState, unknown>>
  metaCache.clear()
  for (const [key, value] of Object.entries(meta)) {
    metaCache.set(key, value)
  }
  taskRunCache.clear()
  for (const row of taskRunRows) {
    const taskRun = mapTaskRunRow(row)
    taskRunCache.set(taskRun.id, taskRun)
  }
  const nextProjects = sortProjectsByDisplayOrder(projectRows.map(mapProjectRow))
  const logsByTaskId = new Map<string, LogRow[]>()
  const collaborationByTaskId = new Map(collabRows.map((row) => [row.task_id, row]))
  for (const log of logRows) {
    logsByTaskId.set(log.task_id, [...(logsByTaskId.get(log.task_id) ?? []), log])
  }

  const nextTasks = taskRows.map((row) => applyTaskCollaborationRow(mapTaskRow(row, logsByTaskId.get(row.id) ?? []), collaborationByTaskId.get(row.id)))
  const nextTaskWorkspaceBindings = bindingRows.map(mapTaskWorkspaceBindingRow)
  const nextWorkspaceSessions = workspaceSessionRows.map(mapWorkspaceSessionRow)
  // 主对话已迁入 conversations/messages。app_meta 里的 blob 仅作为一次性回填来源，
  // 回填走单事务并落显式完成标记，中途崩溃时下次启动会完整重做而非跳过。
  const legacyBlobSessions = normalizeMainChatSessions(
    meta.mainChatSessions as AppState['mainChatSessions'] | undefined,
    meta.selectedMainChatSessionId as string | undefined,
  )
  const backfill = await backfillMainChatThreads(legacyBlobSessions.sessions)
  if (backfill.status === 'completed') {
    console.log(`[postgres] Backfilled main chat into threads: ${backfill.sessionCount} sessions, ${backfill.messageCount} messages`)
    if (backfill.skipped.length > 0) {
      // 同时落在 app_meta['mainChatThreadBackfillSkipped']，日志滚掉也能查。
      console.warn(`[postgres] Backfill skipped ${backfill.skipped.length} sessions: ${backfill.skipped.map((item) => item.sessionId).join(', ')}`)
    }
  }

  // retention 只在启动/首次与周期扫描时执行：storage_change 高频事件（心跳写库等）
  // 会反复触发 initAppStateStore，若每次都跑 retention（全表查 conversations +
  // billing 判定），会把每个 storage_change 事件放大成一次全表扫描。
  // 节流窗口内复用最近一次结果。
  const retention = await runMainChatRetentionThrottled()
  if (retention.deletedMessageCount > 0 || retention.deletedThreadCount > 0) {
    console.log(`[postgres] Main chat retention pruned ${retention.deletedMessageCount} messages, ${retention.deletedThreadCount} threads`)
  }

  // R10.1-B：存量 main thread owner 回填（按最早 user 消息 sender 推断，幂等）。
  const ownerBackfilled = await backfillMainChatOwnerFromMessages()
  if (ownerBackfilled > 0) {
    console.log(`[postgres] Backfilled main chat owners: ${ownerBackfilled} threads`)
  }

  const relationalSessions = await readMainChatSessionsFromThreads()
  const mainChatState = normalizeMainChatSessions(
    relationalSessions,
    meta.selectedMainChatSessionId as string | undefined,
  )
  const retainedMainChatState = {
    mainChatSessions: mainChatState.sessions,
    selectedMainChatSessionId: mainChatState.selectedSessionId,
  }

  assignState({
    projects: nextProjects,
    tasks: nextTasks,
    nodes: listNodes(),
    projectBindings: listProjectBindings(),
    distributedTasks: listDistributedTasks(),
    taskWorkspaceBindings: nextTaskWorkspaceBindings,
    workspaceSessions: nextWorkspaceSessions,
    mainChatSessions: retainedMainChatState.mainChatSessions,
    selectedMainChatSessionId: retainedMainChatState.selectedMainChatSessionId,
    selectedProjectId: (meta.selectedProjectId as string | undefined) || nextProjects[0]?.id || '',
    selectedTaskId: (meta.selectedTaskId as string | undefined) || nextTasks[0]?.id || '',
    filters: normalizeFilters((meta.filters as AppState['filters'] | undefined) ?? defaultMetaState.filters),
    config: normalizeConfig(meta.config as Partial<AppState['config']> | undefined),
    adapters: normalizeAdapters((meta.adapters as AppState['adapters'] | undefined) ?? defaultMetaState.adapters),
    executionCenter: (meta.executionCenter as ExecutionCenter | undefined) ?? defaultMetaState.executionCenter,
  })

  // 快照与关系表实况对齐，避免首次 saveStateMeta 又把全量重写一遍。
  resetThreadStoreSnapshot()
  syncSnapshotFromSessions(retainedMainChatState.mainChatSessions)
}

export const loadState = (): AppState => hydrateClusterState(composeState())

export const saveProject = (project: Project) => {
  const nextProject = cloneJson(project)
  const index = domainStateCache.projects.findIndex((item) => item.id === project.id)
  if (index >= 0) {
    domainStateCache.projects[index] = nextProject
  } else {
    domainStateCache.projects.unshift(nextProject)
  }
  domainStateCache.projects = sortProjectsByDisplayOrder(domainStateCache.projects)

  schedulePersistence(`save-project:${project.id}`, persistProject(nextProject))
}

export const saveProjectAndWait = async (project: Project) => {
  const nextProject = cloneJson(project)
  await persistProject(nextProject)
  const index = domainStateCache.projects.findIndex((item) => item.id === project.id)
  if (index >= 0) {
    domainStateCache.projects[index] = nextProject
  } else {
    domainStateCache.projects.unshift(nextProject)
  }
  domainStateCache.projects = sortProjectsByDisplayOrder(domainStateCache.projects)
  return nextProject
}

export const saveProjectWorkspaceAssignment = (project: Project) => {
  if (!project.workspaceId) {
    schedulePersistence(
      `clear-project-workspace:${project.id}`,
      getDrizzleDb().delete(collabWorkspaceProjects).where(eq(collabWorkspaceProjects.projectId, project.id)),
    )
    return
  }
  schedulePersistence(
    `save-project-workspace:${project.id}`,
    getDrizzleDb()
      .insert(collabWorkspaceProjects)
      .values({ workspaceId: project.workspaceId, projectId: project.id })
      .onConflictDoNothing(),
  )
}

const updateTaskCache = (task: Task) => {
  const nextTask = hydrateTaskExecutionHistory(cloneJson(task))
  const index = domainStateCache.tasks.findIndex((item) => item.id === task.id)
  const previousTask = index >= 0 ? domainStateCache.tasks[index] : null
  if (index >= 0) {
    domainStateCache.tasks[index] = nextTask
  } else {
    domainStateCache.tasks.unshift(nextTask)
  }

  return { nextTask, previousTask }
}

const isWorkspaceSessionRuntimeTask = (taskId: string) => (
  domainStateCache.workspaceSessions.some((session) => session.id === taskId)
)

export const saveTask = (task: Task) => {
  if (isWorkspaceSessionRuntimeTask(task.id)) {
    return
  }
  const updated = updateTaskCache(task)
  schedulePersistence(`save-task:${task.id}`, persistTask(updated.nextTask))
}

export const saveTaskAndWait = async (task: Task) => {
  if (isWorkspaceSessionRuntimeTask(task.id)) {
    return cloneJson(task)
  }
  const nextTask = hydrateTaskExecutionHistory(cloneJson(task))
  const previousTask = cloneJson(domainStateCache.tasks.find((item) => item.id === task.id) ?? null)
  await persistTask(nextTask)

  const currentTask = domainStateCache.tasks.find((item) => item.id === task.id) ?? null
  if (
    !currentTask
    || currentTask.updatedAt < nextTask.updatedAt
    || (currentTask.updatedAt === nextTask.updatedAt && JSON.stringify(currentTask) === JSON.stringify(previousTask))
  ) {
    updateTaskCache(nextTask)
  }

  return cloneJson(nextTask)
}

export const listTaskRuns = (taskId?: string) => {
  const runs = Array.from(taskRunCache.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return cloneJson(taskId ? runs.filter((run) => run.taskId === taskId) : runs)
}

export const getTaskRun = (taskRunId: string) => cloneJson(taskRunCache.get(taskRunId) ?? null)

export const getTaskRunByDistributedTaskId = (distributedTaskId: string) => {
  for (const taskRun of taskRunCache.values()) {
    if (taskRun.distributedTaskId === distributedTaskId) {
      return cloneJson(taskRun)
    }
  }
  return null
}

const updateTaskRunCache = (taskRun: TaskRun) => {
  const nextTaskRun = cloneJson(taskRun)
  const previousTaskRun = taskRunCache.get(taskRun.id) ?? null
  taskRunCache.set(taskRun.id, nextTaskRun)
  const taskIndex = domainStateCache.tasks.findIndex((task) => task.id === nextTaskRun.taskId)
  if (taskIndex >= 0) {
    domainStateCache.tasks[taskIndex] = hydrateTaskExecutionHistory(domainStateCache.tasks[taskIndex])
  }

  return { nextTaskRun, previousTaskRun }
}

export const saveTaskRun = (taskRun: TaskRun) => {
  const { nextTaskRun } = updateTaskRunCache(taskRun)
  schedulePersistence(`save-task-run:${taskRun.id}`, persistTaskRun(nextTaskRun))
}

export const saveTaskRunAndWait = async (taskRun: TaskRun) => {
  const nextTaskRun = cloneJson(taskRun)
  const previousTaskRun = cloneJson(taskRunCache.get(taskRun.id) ?? null)
  await persistTaskRun(nextTaskRun)

  const currentTaskRun = taskRunCache.get(taskRun.id) ?? null
  if (
    !currentTaskRun
    || currentTaskRun.updatedAt < nextTaskRun.updatedAt
    || (currentTaskRun.updatedAt === nextTaskRun.updatedAt && JSON.stringify(currentTaskRun) === JSON.stringify(previousTaskRun))
  ) {
    updateTaskRunCache(nextTaskRun)
  }

  return cloneJson(nextTaskRun)
}

export const listTaskWorkspaceBindings = (taskId?: string) => {
  const bindings = cloneJson(domainStateCache.taskWorkspaceBindings)
  return taskId ? bindings.filter((binding) => binding.taskId === taskId) : bindings
}

export const getTaskWorkspaceBinding = (taskId: string, workspaceId: string) => {
  return cloneJson(domainStateCache.taskWorkspaceBindings.find((binding) => binding.taskId === taskId && binding.workspaceId === workspaceId) ?? null)
}

export const saveTaskWorkspaceBinding = (binding: TaskWorkspaceBinding) => {
  if (isWorkspaceSessionRuntimeTask(binding.taskId)) {
    return
  }
  const nextBinding = cloneJson(binding)
  const index = domainStateCache.taskWorkspaceBindings.findIndex((item) => item.taskId === binding.taskId && item.workspaceId === binding.workspaceId)
  if (index >= 0) {
    domainStateCache.taskWorkspaceBindings[index] = nextBinding
  } else {
    domainStateCache.taskWorkspaceBindings.unshift(nextBinding)
  }

  schedulePersistence(`save-task-workspace-binding:${binding.taskId}:${binding.workspaceId}`, persistTaskWorkspaceBinding(nextBinding))
}

export const saveTaskWorkspaceBindingAndWait = async (binding: TaskWorkspaceBinding) => {
  if (isWorkspaceSessionRuntimeTask(binding.taskId)) {
    return cloneJson(binding)
  }
  const nextBinding = cloneJson(binding)
  await persistTaskWorkspaceBinding(nextBinding)
  const index = domainStateCache.taskWorkspaceBindings.findIndex((item) => item.taskId === binding.taskId && item.workspaceId === binding.workspaceId)
  if (index >= 0) {
    domainStateCache.taskWorkspaceBindings[index] = nextBinding
  } else {
    domainStateCache.taskWorkspaceBindings.unshift(nextBinding)
  }
  return nextBinding
}

export const listWorkspaceSessions = (workspaceId?: string) => {
  const sessions = cloneJson(domainStateCache.workspaceSessions).filter((session) => {
    if (workspaceId && session.workspaceId !== workspaceId) {
      return false
    }

    return true
  })
  return sortWorkspaceSessions(sessions)
}

export const getWorkspaceSession = (workspaceId: string) => {
  return cloneJson(listWorkspaceSessions(workspaceId)[0] ?? null)
}

export const getWorkspaceSessionById = (sessionId: string) => {
  return cloneJson(domainStateCache.workspaceSessions.find((session) => session.id === sessionId) ?? null)
}

const updateWorkspaceSessionCache = (session: WorkspaceSession) => {
  const currentSession = domainStateCache.workspaceSessions.find((item) => item.id === session.id) ?? null
  const nextSession = cloneJson(preserveWorkspaceSessionTitle(currentSession, session))
  const previousSession = cloneJson(currentSession)
  const index = domainStateCache.workspaceSessions.findIndex((item) => item.id === session.id)
  if (index >= 0) {
    domainStateCache.workspaceSessions[index] = nextSession
  } else {
    domainStateCache.workspaceSessions.unshift(nextSession)
  }

  return { nextSession, previousSession }
}

const notifyWorkspaceSessionChange = (
  previousSession: WorkspaceSession | null,
  nextSession: WorkspaceSession,
) => {
  const distributedTask = nextSession.distributedTaskId
    ? listDistributedTasks().find((item) => item.id === nextSession.distributedTaskId) ?? null
    : null
  const binding = distributedTask
    ? null
    : domainStateCache.taskWorkspaceBindings.find((item) => (
        item.workspaceId === nextSession.workspaceId && item.status === 'active'
      )) ?? null
  const taskId = distributedTask?.originTaskId ?? binding?.taskId
  const task = taskId
    ? domainStateCache.tasks.find((item) => item.id === taskId) ?? null
    : null
  const project = task
    ? domainStateCache.projects.find((item) => item.id === task.projectId) ?? null
    : null
  const workspace = listWorkspaces().find((item) => item.id === nextSession.workspaceId) ?? null
  const recipientUserIds = [...new Set([
    task?.assigneeId?.trim() || '',
    project?.createdById?.trim() || '',
    workspace?.ownerUserId?.trim() || '',
  ].filter(Boolean))]

  void notifyWorkspaceSessionCompletionIfNeeded({
    previousSession,
    nextSession,
    recipientUserIds,
    task,
    project,
    workspace,
  })
}

export const saveWorkspaceSession = (session: WorkspaceSession) => {
  const { nextSession, previousSession } = updateWorkspaceSessionCache(session)
  notifyWorkspaceSessionChange(previousSession, nextSession)

  schedulePersistence(`save-workspace-session:${session.id}`, persistWorkspaceSession(nextSession))
}

export const saveWorkspaceSessionAndWait = async (session: WorkspaceSession) => {
  const currentSession = domainStateCache.workspaceSessions.find((item) => item.id === session.id) ?? null
  let nextSession = cloneJson(preserveWorkspaceSessionTitle(currentSession, session))
  const previousSession = cloneJson(currentSession)
  await persistWorkspaceSession(nextSession)

  const latestCachedSession = domainStateCache.workspaceSessions.find((item) => item.id === session.id) ?? null
  const reconciledSession = preserveWorkspaceSessionTitle(latestCachedSession, nextSession)
  if (reconciledSession !== nextSession) {
    nextSession = cloneJson(reconciledSession)
    await persistWorkspaceSession(nextSession)
  }

  const currentRuntimeSequence = latestCachedSession?.runtimeSequence ?? 0
  const nextRuntimeSequence = nextSession.runtimeSequence ?? 0
  if (
    !latestCachedSession
    || latestCachedSession.updatedAt < nextSession.updatedAt
    || (latestCachedSession.updatedAt === nextSession.updatedAt && currentRuntimeSequence < nextRuntimeSequence)
    || (
      latestCachedSession.updatedAt === nextSession.updatedAt
      && currentRuntimeSequence === nextRuntimeSequence
      && JSON.stringify(latestCachedSession) === JSON.stringify(previousSession)
    )
  ) {
    updateWorkspaceSessionCache(nextSession)
    notifyWorkspaceSessionChange(previousSession, nextSession)
  }

  return cloneJson(nextSession)
}

export const deleteTaskWorkspaceBindings = (params: { taskId?: string; workspaceIds?: string[] }) => {
  const workspaceIdSet = params.workspaceIds ? new Set(params.workspaceIds) : null
  domainStateCache.taskWorkspaceBindings = domainStateCache.taskWorkspaceBindings.filter((binding) => {
    if (params.taskId && binding.taskId !== params.taskId) {
      return true
    }
    if (workspaceIdSet && !workspaceIdSet.has(binding.workspaceId)) {
      return true
    }
    return false
  })

  schedulePersistence(`delete-task-workspace-bindings:${params.taskId ?? 'all'}:${params.workspaceIds?.join(',') ?? 'all'}`, (async () => {
    if (params.taskId && workspaceIdSet && workspaceIdSet.size > 0) {
      await getDrizzleDb()
        .delete(taskWorkspaceBindings)
        .where(and(eq(taskWorkspaceBindings.taskId, params.taskId), inArray(taskWorkspaceBindings.workspaceId, [...workspaceIdSet])))
      return
    }
    if (params.taskId) {
      await getDrizzleDb().delete(taskWorkspaceBindings).where(eq(taskWorkspaceBindings.taskId, params.taskId))
      return
    }
    if (workspaceIdSet && workspaceIdSet.size > 0) {
      await getDrizzleDb().delete(taskWorkspaceBindings).where(inArray(taskWorkspaceBindings.workspaceId, [...workspaceIdSet]))
    }
  })())
}

export const deleteWorkspaceSessions = (params: { workspaceIds?: string[]; sessionIds?: string[] }) => {
  const workspaceIdSet = params.workspaceIds ? new Set(params.workspaceIds) : null
  const sessionIdSet = params.sessionIds ? new Set(params.sessionIds) : null
  domainStateCache.workspaceSessions = domainStateCache.workspaceSessions.filter((session) => {
    if (sessionIdSet && sessionIdSet.has(session.id)) {
      return false
    }
    if (workspaceIdSet && !workspaceIdSet.has(session.workspaceId)) {
      return true
    }
    if (sessionIdSet && !sessionIdSet.has(session.id)) {
      return true
    }
    return false
  })
  schedulePersistence(`delete-workspace-sessions:${params.workspaceIds?.join(',') ?? 'all'}:${params.sessionIds?.join(',') ?? 'all'}`, (async () => {
    if (workspaceIdSet && workspaceIdSet.size > 0 && sessionIdSet && sessionIdSet.size > 0) {
      await getDrizzleDb()
        .delete(workspaceSessions)
        .where(and(inArray(workspaceSessions.workspaceId, [...workspaceIdSet]), inArray(workspaceSessions.id, [...sessionIdSet])))
      await deleteWorkspaceSessionPersistedHistory({ workspaceIds: [...workspaceIdSet], sessionIds: [...sessionIdSet] })
      return
    }
    if (workspaceIdSet && workspaceIdSet.size > 0) {
      await getDrizzleDb().delete(workspaceSessions).where(inArray(workspaceSessions.workspaceId, [...workspaceIdSet]))
      await deleteWorkspaceSessionPersistedHistory({ workspaceIds: [...workspaceIdSet] })
      return
    }
    if (sessionIdSet && sessionIdSet.size > 0) {
      await getDrizzleDb().delete(workspaceSessions).where(inArray(workspaceSessions.id, [...sessionIdSet]))
      await deleteWorkspaceSessionPersistedHistory({ sessionIds: [...sessionIdSet] })
    }
  })())
}

export const saveMeta = (key: string, value: unknown) => {
  metaCache.set(key, cloneJson(value))
  schedulePersistence(
    `save-meta:${key}`,
    getDrizzleDb()
      .insert(appMeta)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value },
      }),
  )
}

export const getMeta = <T>(key: string, fallback: T): T => {
  const value = metaCache.get(key)
  return (value as T | undefined) ?? fallback
}

export const getMainChatSessionById = (sessionId: string): MainChatSession | null => {
  return cloneJson(uiStateCache.mainChatSessions.find((session) => session.id === sessionId) ?? null)
}

export const setMainChatSessionVisibility = (sessionId: string, visibility: 'public' | 'private'): MainChatSession | null => {
  const index = uiStateCache.mainChatSessions.findIndex((session) => session.id === sessionId)
  if (index < 0) {
    return null
  }

  const nextSession: MainChatSession = {
    ...uiStateCache.mainChatSessions[index],
    visibility,
    updatedAt: new Date().toISOString(),
  }
  uiStateCache.mainChatSessions[index] = nextSession
  saveMeta('mainChatSessions', uiStateCache.mainChatSessions)
  return cloneJson(nextSession)
}

export const saveStateMeta = (state: AppState) => {
  const normalizedState = normalizeMainChatSessionState(state)

  uiStateCache.mainChatSessions = cloneJson(normalizedState.mainChatSessions)
  uiStateCache.selectedMainChatSessionId = normalizedState.selectedMainChatSessionId
  uiStateCache.selectedProjectId = normalizedState.selectedProjectId
  uiStateCache.selectedTaskId = normalizedState.selectedTaskId
  uiStateCache.filters = cloneJson(normalizedState.filters)
  uiStateCache.config = cloneJson(normalizedState.config)
  uiStateCache.adapters = cloneJson(normalizedState.adapters)
  uiStateCache.executionCenter = cloneJson(normalizedState.executionCenter)

  // 主对话真相在 conversations/messages；不再写 app_meta blob。
  // 保留期裁剪改为启动时按行删除，见 applyMainChatRetention。
  syncMainChatThreads(normalizedState.mainChatSessions)
  saveMeta('selectedMainChatSessionId', normalizedState.selectedMainChatSessionId)
  saveMeta('selectedProjectId', normalizedState.selectedProjectId)
  saveMeta('selectedTaskId', normalizedState.selectedTaskId)
  saveMeta('filters', normalizedState.filters)
  saveMeta('config', normalizedState.config)
  saveMeta('adapters', normalizedState.adapters)
  saveMeta('executionCenter', normalizedState.executionCenter)
}

export const replaceState = (state: AppState) => {
  taskRunCache.clear()
  assignState(cloneJson(state))
  schedulePersistence('replace-state', withDrizzleTransaction(async (tx) => {
    await tx.delete(executionLogs)
    await tx.delete(taskCollaboration)
    await tx.delete(workspaceSessions)
    await tx.delete(taskWorkspaceBindings)
    await tx.delete(taskRuns)
    await tx.delete(tasks)
    await tx.delete(projects)
    await tx.delete(appMeta)
    await tx.delete(userProjects)
    await tx.delete(teamProjects)
  }))
  resetClusterData()
  for (const taskRun of extractLegacyTaskRunsFromTasks(state.tasks)) {
    taskRunCache.set(taskRun.id, cloneJson(taskRun))
  }
  for (const project of state.projects) {
    saveProject(project)
  }
  for (const taskRun of Array.from(taskRunCache.values())) {
    saveTaskRun(taskRun)
  }
  for (const binding of state.taskWorkspaceBindings) {
    saveTaskWorkspaceBinding(binding)
  }
  for (const session of state.workspaceSessions) {
    saveWorkspaceSession(session)
  }
  for (const task of state.tasks) {
    saveTask(task)
  }
  saveStateMeta(state)
}

const assertDestructiveTestResetIsIsolated = () => {
  if (!process.env.NODE_TEST_CONTEXT || process.env.VIBEMUX_ALLOW_DESTRUCTIVE_TEST_DB_RESET === '1') {
    return
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!databaseUrl) {
    return
  }

  let databaseName = ''
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '')
  } catch {
    databaseName = databaseUrl
  }
  if (/(^|[-_])test($|[-_])/i.test(databaseName)) {
    return
  }

  throw new Error(
    `Refusing to reset non-test Postgres database "${databaseName || 'unknown'}" from a Node test process.`,
  )
}

export const resetState = () => {
  assertDestructiveTestResetIsIsolated()
  replaceState(initialServerState)
}

export const deleteProject = (projectId: string) => {
  const taskIds = new Set(domainStateCache.tasks.filter((task) => task.projectId === projectId).map((task) => task.id))
  const workspaceIds = new Set(listWorkspaces().filter((workspace) => workspace.projectId === projectId).map((workspace) => workspace.id))
  if (workspaceIds.size > 0) {
    deleteWorkspaces([...workspaceIds])
  }
  domainStateCache.projects = domainStateCache.projects.filter((project) => project.id !== projectId)
  domainStateCache.tasks = domainStateCache.tasks.filter((task) => task.projectId !== projectId)
  domainStateCache.taskWorkspaceBindings = domainStateCache.taskWorkspaceBindings.filter((binding) => !taskIds.has(binding.taskId))
  domainStateCache.workspaceSessions = domainStateCache.workspaceSessions.filter((session) => !workspaceIds.has(session.workspaceId))
  for (const [taskRunId, taskRun] of taskRunCache.entries()) {
    if (taskRun.projectId === projectId) {
      taskRunCache.delete(taskRunId)
    }
  }
  schedulePersistence(`delete-project:${projectId}`, withDrizzleTransaction(async (tx) => {
    const projectTaskIds = (await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId))).map((row) => row.id)
    if (projectTaskIds.length > 0) {
      await tx.delete(executionLogs).where(inArray(executionLogs.taskId, projectTaskIds))
      await tx.delete(taskCollaboration).where(inArray(taskCollaboration.taskId, projectTaskIds))
      await tx.delete(taskWorkspaceBindings).where(inArray(taskWorkspaceBindings.taskId, projectTaskIds))
    }
    if (workspaceIds.size > 0) {
      await tx.delete(workspaceSessions).where(inArray(workspaceSessions.workspaceId, [...workspaceIds]))
      await deleteWorkspaceSessionPersistedHistory({ workspaceIds: [...workspaceIds] })
    }
    await tx.delete(taskRuns).where(eq(taskRuns.projectId, projectId))
    await tx.delete(tasks).where(eq(tasks.projectId, projectId))
    await tx.delete(userProjects).where(eq(userProjects.projectId, projectId))
    await tx.delete(teamProjects).where(eq(teamProjects.projectId, projectId))
    await tx.delete(projectGitCredentialBindings).where(eq(projectGitCredentialBindings.projectId, projectId))
    await tx.delete(projectRuntimeEnvironmentConfigs).where(eq(projectRuntimeEnvironmentConfigs.projectId, projectId))
    await tx.delete(projects).where(eq(projects.id, projectId))
  }))
}

export const deleteTask = (taskId: string) => {
  domainStateCache.tasks = domainStateCache.tasks.filter((task) => task.id !== taskId)
  domainStateCache.taskWorkspaceBindings = domainStateCache.taskWorkspaceBindings.filter((binding) => binding.taskId !== taskId)
  for (const [taskRunId, taskRun] of taskRunCache.entries()) {
    if (taskRun.taskId === taskId) {
      taskRunCache.delete(taskRunId)
    }
  }
  schedulePersistence(`delete-task:${taskId}`, withDrizzleTransaction(async (tx) => {
    await tx.delete(executionLogs).where(eq(executionLogs.taskId, taskId))
    await tx.delete(taskCollaboration).where(eq(taskCollaboration.taskId, taskId))
    await tx.delete(taskWorkspaceBindings).where(eq(taskWorkspaceBindings.taskId, taskId))
    await tx.delete(taskRuns).where(eq(taskRuns.taskId, taskId))
    await tx.delete(tasks).where(eq(tasks.id, taskId))
  }))
}

export const hydrateClusterState = (state: AppState): AppState => ({
  ...state,
  nodes: listNodes(),
  projectBindings: listProjectBindings(),
  distributedTasks: listDistributedTasks(),
})
