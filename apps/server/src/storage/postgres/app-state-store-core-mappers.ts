// [INPUT]: PostgreSQL core rows and shared task/project/session contracts.
import { getEnv } from '@shared/env'
// [OUTPUT]: Hydrated app-state records, including persisted task creator identity.
// [POS]: Read-side mapping boundary for the server core app-state store.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { isRuntimeId } from '@shared/agent-type'
import { mergeAgentRuntimeSettings, normalizeAgentConfig } from '@shared/agent-config'
import { ensureOfficialConnectorMcpServer } from '@shared/mcp'
import { sortMainChatSessions } from '@shared/main-chat-session'
import { normalizeOpenCodeExecutionConfig, resolveOpenCodeExecutionModel } from '@shared/opencode-execution-config'
import { deriveProjectColor, normalizeHexColor } from '@shared/project-color'
import { createAdapters } from '@shared/task-orchestrator'
import type { WorkspaceSessionHistoryProjection } from '@shared/workspace-session-history'
import { resolveWorkspaceSessionHistoryLatestPreviewText } from '@shared/workspace-session-history'
import type { WorkspaceDeliverySummary } from '@shared/workspace-delivery'
import { normalizeWorkspaceDeliveryPullRequestState } from '@shared/workspace-delivery'
import { normalizeWorkspaceSessionRuntimeSummary } from '@shared/workspace-runtime'
import type { AppState, MainChatSession, Project, Task, TaskExecutionResult, TaskRun, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { sortTaskRunsDesc, taskRunCache } from './app-state-store-core-cache'
import type { LogRow, ProjectRow, TaskCollaborationRow, TaskRow, TaskRunRow, TaskWorkspaceBindingRow, WorkspaceSessionRow } from './app-state-store-core-types'
import { cloneJson } from './helpers'
import { initialServerState } from './app-state-seed'
import { coerceServerAgentType, isServerAgentType } from '../../services/server-agent'
import { applyManagedCloudEnvConfig } from '../../services/managed-cloud-env-config'

export const mapProjectRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  displayOrder: row.display_order ?? undefined,
  color: normalizeHexColor(row.color) ?? deriveProjectColor(row.name),
  workspaceId: row.workspace_id ?? undefined,
  visibility: row.visibility ?? 'private',
  gitUrl: row.git_url,
  rootPath: row.local_path?.trim() ? row.local_path : undefined,
  versionControl: row.version_control ?? (row.git_url.trim() ? 'git-remote' : 'none'),
  defaultBranch: row.default_branch ?? 'main',
  preferredExecutorId: row.preferred_executor_id ?? undefined,
  repositoryCloneStatus: row.repository_clone_status ?? undefined,
  repositoryCloneMessage: row.repository_clone_message?.trim() ? row.repository_clone_message : undefined,
  environmentTemplate: row.environment_template_json && typeof row.environment_template_json === 'object'
    ? row.environment_template_json as Project['environmentTemplate']
    : undefined,
  recentBaseBranches: Array.isArray(row.recent_base_branches_json) ? row.recent_base_branches_json as string[] : [],
  createdById: row.created_by ?? undefined,
  createdByName: row.creator_name ?? undefined,
  createdByAvatarUrl: row.creator_avatar_url ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const normalizeAdapters = (storedAdapters: AppState['adapters']): AppState['adapters'] => {
  const defaults = createAdapters()
  return defaults.map((adapter) => {
    const stored = storedAdapters.find((item) => item.id === adapter.id)
    if (!stored) {
      return adapter
    }

    return {
      ...adapter,
      status: stored.status,
      heartbeatAt: stored.heartbeatAt || adapter.heartbeatAt,
    }
  })
}

export const normalizeFilters = (filters: AppState['filters']): AppState['filters'] => ({
  ...filters,
  agent: filters.agent !== 'all' && isServerAgentType(filters.agent) ? filters.agent : 'all',
})

const readOfficialConnectorTarget = () => getEnv('WEMUX_OFFICIAL_CONNECTOR_URL')?.trim()
  || getEnv('WEMUX_OFFICIAL_CONNECTOR_URL')?.trim()
  || ''

const readOfficialConnectorRuntimeToken = () => getEnv('WEMUX_OFFICIAL_CONNECTOR_RUNTIME_TOKEN')?.trim()
  || getEnv('WEMUX_OFFICIAL_CONNECTOR_RUNTIME_TOKEN')?.trim()
  || ''

export const normalizeConfig = (config: Partial<AppState['config']> | undefined): AppState['config'] => {
  const normalized = applyManagedCloudEnvConfig(normalizeAgentConfig({
    ...initialServerState.config,
    ...config,
  }))
  const officialConnectorTarget = readOfficialConnectorTarget()
  if (!officialConnectorTarget) {
    return normalized
  }

  const runtimeToken = readOfficialConnectorRuntimeToken()
  const headers = runtimeToken ? { Authorization: `Bearer ${runtimeToken}` } : undefined
  return {
    ...normalized,
    mcpServers: ensureOfficialConnectorMcpServer(normalized.mcpServers, officialConnectorTarget, headers),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const normalizeUsageNumber = (value: unknown) => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

const normalizeWorkspaceDeliverySummary = (value: unknown): WorkspaceDeliverySummary | undefined => {
  if (!isRecord(value) || !isRecord(value.pullRequest)) {
    return undefined
  }

  const pullRequest = value.pullRequest
  const updatedAt = typeof pullRequest.updatedAt === 'string' && pullRequest.updatedAt.trim()
    ? pullRequest.updatedAt.trim()
    : ''
  if (!updatedAt) {
    return undefined
  }

  return {
    pullRequest: {
      state: normalizeWorkspaceDeliveryPullRequestState(
        typeof pullRequest.state === 'string' ? pullRequest.state : undefined,
      ),
      updatedAt,
      url: typeof pullRequest.url === 'string' && pullRequest.url.trim() ? pullRequest.url.trim() : undefined,
      number: typeof pullRequest.number === 'number' && Number.isFinite(pullRequest.number)
        ? pullRequest.number
        : undefined,
      compareBranch: typeof pullRequest.compareBranch === 'string' && pullRequest.compareBranch.trim()
        ? pullRequest.compareBranch.trim()
        : undefined,
      workspaceId: typeof pullRequest.workspaceId === 'string' && pullRequest.workspaceId.trim()
        ? pullRequest.workspaceId.trim()
        : undefined,
      workspaceSessionId: typeof pullRequest.workspaceSessionId === 'string' && pullRequest.workspaceSessionId.trim()
        ? pullRequest.workspaceSessionId.trim()
        : undefined,
    },
  }
}

const normalizeModelTokenUsage = (usage: unknown) => {
  if (!isRecord(usage)) {
    return undefined
  }

  const inputTokens = normalizeUsageNumber(usage.inputTokens)
  const outputTokens = normalizeUsageNumber(usage.outputTokens)
  const reasoningTokens = normalizeUsageNumber(usage.reasoningTokens)
  const cacheReadTokens = normalizeUsageNumber(usage.cacheReadTokens)
  const cacheWriteTokens = normalizeUsageNumber(usage.cacheWriteTokens)
  const totalTokens = normalizeUsageNumber(usage.totalTokens) || (
    inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens
  )

  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0 && reasoningTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
    totalTokens,
  }
}

const normalizeLegacyRuntimeSessionIds = (session: MainChatSession) => {
  if (!session.runtimeSessionIds) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(session.runtimeSessionIds)
      .filter(([agentType, sessionId]) => isServerAgentType(agentType) && typeof sessionId === 'string' && sessionId.trim())
      .map(([agentType, sessionId]) => [agentType, sessionId.trim()]),
  ) as MainChatSession['runtimeSessionIds']
}

const normalizeRuntimeContinuations = (session: MainChatSession) => {
  const continuations = Array.isArray(session.runtimeContinuations) ? session.runtimeContinuations : []
  const normalized = continuations
    .map((item) => {
      if (!isRecord(item)) {
        return null
      }

      if (!isRuntimeId(item.runtimeId) || !item.scopeKey?.trim() || !item.nativeSessionId?.trim()) {
        return null
      }

      return {
        runtimeId: item.runtimeId,
        scopeKey: item.scopeKey.trim(),
        nativeSessionId: item.nativeSessionId.trim(),
        executorId: item.executorId?.trim() || undefined,
        customAgentId: item.customAgentId?.trim() || undefined,
        executionModel: item.executionModel?.trim() || undefined,
        cwdHash: item.cwdHash?.trim() || undefined,
        updatedAt: item.updatedAt?.trim() || new Date().toISOString(),
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const seenScopeKeys = new Set(normalized.map((item) => item.scopeKey))
  const legacyContinuations = Object.entries(normalizeLegacyRuntimeSessionIds(session) ?? {}).reduce<NonNullable<MainChatSession['runtimeContinuations']>>((result, [runtimeId, nativeSessionId]) => {
    if (!isServerAgentType(runtimeId) || !nativeSessionId.trim()) {
      return result
    }

    const scopeKey = `legacy:${runtimeId}`
    if (seenScopeKeys.has(scopeKey)) {
      return result
    }

    result.push({
      runtimeId,
      scopeKey,
      nativeSessionId: nativeSessionId.trim(),
      updatedAt: session.updatedAt,
    })
    return result
  }, [])

  return normalized.length > 0 || legacyContinuations.length > 0
    ? [...normalized, ...legacyContinuations]
    : undefined
}

const normalizeHandoffSnapshot = (params: {
  handoffSnapshot?: MainChatSession['handoffSnapshot']
  updatedAt: string
  messageCount?: number
}) => {
  const snapshot = params.handoffSnapshot
  if (!isRecord(snapshot)) {
    return undefined
  }

  const recentMessages = Array.isArray(snapshot.recentMessages)
    ? snapshot.recentMessages
        .filter((item) => (
          isRecord(item)
          && (item.role === 'user' || item.role === 'assistant')
          && typeof item.content === 'string'
          && typeof item.createdAt === 'string'
        ))
        .map((item) => ({
          role: item.role,
          content: item.content.trim(),
          createdAt: item.createdAt.trim(),
        }))
        .filter((item) => item.content && item.createdAt)
    : []
  const summaryLines = Array.isArray(snapshot.summaryLines)
    ? snapshot.summaryLines
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []

  if (recentMessages.length === 0 && summaryLines.length === 0) {
    return undefined
  }

  return {
    updatedAt: typeof snapshot.updatedAt === 'string' && snapshot.updatedAt.trim()
      ? snapshot.updatedAt.trim()
      : params.updatedAt,
    messageCount: typeof snapshot.messageCount === 'number' && snapshot.messageCount >= 0
      ? snapshot.messageCount
      : (params.messageCount ?? 0),
    latestUserMessage: typeof snapshot.latestUserMessage === 'string' && snapshot.latestUserMessage.trim()
      ? snapshot.latestUserMessage.trim()
      : undefined,
    latestAssistantMessage: typeof snapshot.latestAssistantMessage === 'string' && snapshot.latestAssistantMessage.trim()
      ? snapshot.latestAssistantMessage.trim()
      : undefined,
    summaryLines,
    recentMessages,
  }
}

export const normalizeMainChatSessions = (
  sessions: MainChatSession[] | undefined,
  selectedSessionId?: string,
) => {
  const fallbackSessionId = initialServerState.selectedMainChatSessionId
  const now = new Date().toISOString()
  const fallbackSession: MainChatSession = {
    id: fallbackSessionId,
    title: '默认会话',
    executorId: undefined,
    executionModel: undefined,
    messages: [],
    createdAt: initialServerState.mainChatSessions[0]?.createdAt ?? now,
    updatedAt: initialServerState.mainChatSessions[0]?.updatedAt ?? now,
  }

  const nextSessions = (sessions && sessions.length > 0 ? sessions : [fallbackSession]).map((session) => ({
    ...session,
    pinnedAt: session.pinnedAt?.trim() || undefined,
    customAgentId: session.customAgentId?.trim() || undefined,
    executorId: session.executorId?.trim() || undefined,
    workspaceId: session.workspaceId?.trim() || undefined,
    cwd: session.cwd?.trim() || undefined,
    runtimeSessionIds: normalizeLegacyRuntimeSessionIds(session),
    runtimeContinuations: normalizeRuntimeContinuations(session),
    handoffSnapshot: normalizeHandoffSnapshot({
      handoffSnapshot: session.handoffSnapshot,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length ?? 0,
    }),
    sourceChannel: session.sourceChannel === 'telegram' || session.sourceChannel === 'feishu' || session.sourceChannel === 'wechat' || session.sourceChannel === 'discord' || session.sourceChannel === 'slack' || session.sourceChannel === 'wecom' || session.sourceChannel === 'whatsapp' || session.sourceChannel === 'dingtalk' ? session.sourceChannel : undefined,
    externalConversationId: session.externalConversationId?.trim() || undefined,
    externalUserId: session.externalUserId?.trim() || undefined,
    externalChatId: session.externalChatId?.trim() || undefined,
    externalThreadId: session.externalThreadId?.trim() || undefined,
  }))
  const sortedSessions = sortMainChatSessions(nextSessions)
  const nextSelectedSessionId = sortedSessions.some((session) => session.id === selectedSessionId)
    ? selectedSessionId!
    : sortedSessions[0].id

  return {
    sessions: sortedSessions,
    selectedSessionId: nextSelectedSessionId,
  }
}

export const mapTaskRow = (row: TaskRow, logs: LogRow[]): Task => ({
  id: row.id,
  projectId: row.project_id,
  parentTaskId: row.parent_task_id ?? undefined,
  createdBy: row.creator_json ?? undefined,
  originType: row.origin_type ?? undefined,
  originId: row.origin_id ?? undefined,
  title: row.title,
  description: row.description,
  acceptanceCriteria: row.acceptance_criteria ?? undefined,
  draftId: row.draft_id ?? undefined,
  draftSavedAt: row.draft_saved_at ?? undefined,
  recommendedTitle: row.recommended_title ?? undefined,
  baseBranchHint: row.base_branch_hint ?? undefined,
  requirementType: row.requirement_type ?? 'task',
  assigneeId: row.assignee_id ?? undefined,
  assigneeAgentId: row.assignee_agent_id ?? undefined,
  assigneeAgentGroupId: row.assignee_agent_group_id ?? undefined,
  status: row.status,
  attachments: row.attachments_json && row.attachments_json.length > 0 ? row.attachments_json : undefined,
  reactions: row.reactions_json && row.reactions_json.length > 0 ? row.reactions_json : undefined,
  completedAt: row.completed_at ?? undefined,
  agentType: coerceServerAgentType(row.agent_type),
  executionModel: resolveOpenCodeExecutionModel({
    executionModel: row.execution_model ?? undefined,
    opencodeConfig: normalizeOpenCodeExecutionConfig(row.opencode_config_json as Task['opencodeConfig']),
  }),
  opencodeConfig: normalizeOpenCodeExecutionConfig(row.opencode_config_json as Task['opencodeConfig'], row.execution_model ?? undefined),
  executionMode: row.execution_mode ?? 'local',
  agentManaged: row.agent_managed ?? 'none',
  priority: row.priority ?? 'medium',
  retryCount: row.retry_count,
  createdAt: row.created_at,
  startedAt: row.started_at ?? undefined,
  dueAt: row.due_at ?? undefined,
  updatedAt: row.updated_at,
  baseBranch: row.base_branch ?? 'main',
  needsHumanConfirm: row.needs_human_confirm,
  agentRunningStatus: row.agent_running_status ?? 'idle',
  currentStep: row.current_step ?? '',
  executionHistory: getTaskExecutionHistory(row.id),
  comments: [],
  subscriberIds: [],
  toolCalls: [],
  history: [],
  orchestration: [],
  validationChecks: [],
  logs: logs.map((log) => ({
    id: log.id,
    role: log.role,
    content: log.content,
    createdAt: log.created_at,
    workspaceId: log.workspace_id ?? undefined,
    workspaceSessionId: log.workspace_session_id ?? undefined,
  })),
})

export const applyTaskCollaborationRow = (task: Task, row?: TaskCollaborationRow): Task => ({
  ...task,
  comments: row && Array.isArray(row.comments_json) ? row.comments_json as Task['comments'] : [],
  subscriberIds: row && Array.isArray(row.subscriber_ids_json)
    ? row.subscriber_ids_json.filter((userId): userId is string => typeof userId === 'string')
    : [],
  toolCalls: row && Array.isArray(row.tool_calls_json) ? row.tool_calls_json as Task['toolCalls'] : [],
  history: row && Array.isArray(row.history_json) ? row.history_json as Task['history'] : [],
  orchestration: row && Array.isArray(row.orchestration_json) ? row.orchestration_json as Task['orchestration'] : [],
  validationChecks: row && Array.isArray(row.validation_checks_json) ? row.validation_checks_json as Task['validationChecks'] : [],
})

export const normalizeTaskExecutionResult = (result?: TaskExecutionResult | null): TaskExecutionResult | undefined => {
  if (!result) {
    return undefined
  }

  return {
    ...result,
    agentSessionId: result.agentSessionId ?? result.opencodeSessionId,
    opencodeSessionId: result.opencodeSessionId ?? result.agentSessionId,
    usage: normalizeModelTokenUsage(result.usage),
  }
}

export const mapTaskRunRow = (row: TaskRunRow): TaskRun => ({
  id: row.id,
  taskId: row.task_id,
  projectId: row.project_id,
  distributedTaskId: row.distributed_task_id ?? undefined,
  workspaceId: row.workspace_id ?? undefined,
  workspaceSessionId: row.workspace_session_id ?? undefined,
  executorNodeId: row.executor_node_id ?? undefined,
  baseBranch: row.base_branch ?? undefined,
  returnMode: row.return_mode ?? undefined,
  gitIdentityMode: row.git_identity_mode ?? undefined,
  agentSessionId: row.agent_session_id ?? undefined,
  opencodeSessionId: row.agent_session_id ?? undefined,
  executionModel: row.execution_model ?? undefined,
  usage: normalizeModelTokenUsage(row.usage_json),
  status: row.status,
  summary: row.summary ?? undefined,
  result: row.result_json && typeof row.result_json === 'object'
    ? normalizeTaskExecutionResult(row.result_json as TaskRun['result'])
    : undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapTaskWorkspaceBindingRow = (row: TaskWorkspaceBindingRow): TaskWorkspaceBinding => ({
  id: row.id,
  taskId: row.task_id,
  workspaceId: row.workspace_id,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapWorkspaceSessionRow = (row: WorkspaceSessionRow): WorkspaceSession => {
  const agentType = coerceServerAgentType(row.agent_type)
  const historyLatestEventKind = (
    row.history_latest_event_kind === 'user_message'
    || row.history_latest_event_kind === 'assistant_message'
    || row.history_latest_event_kind === 'system_message'
    || row.history_latest_event_kind === 'delivery_result'
    || row.history_latest_event_kind === 'thinking'
    || row.history_latest_event_kind === 'tool_call'
    || row.history_latest_event_kind === 'interaction'
    || row.history_latest_event_kind === 'status'
    || row.history_latest_event_kind === 'error'
    || row.history_latest_event_kind === 'turn_deleted'
  )
    ? row.history_latest_event_kind
    : undefined
  const historyLastPersistedTurnStatus = (
    row.history_last_persisted_turn_status === 'running'
    || row.history_last_persisted_turn_status === 'completed'
    || row.history_last_persisted_turn_status === 'error'
    || row.history_last_persisted_turn_status === 'cancelled'
  )
    ? row.history_last_persisted_turn_status
    : undefined
  const historyProjection: WorkspaceSessionHistoryProjection | undefined = row.history_updated_at
    ? {
        sessionId: row.id,
        taskId: row.history_task_id ?? row.id,
        workspaceId: row.workspace_id,
        latestTurnId: row.history_latest_turn_id ?? undefined,
        latestEventKind: historyLatestEventKind,
        latestEventSeq: row.history_latest_event_seq ?? 0,
        totalEventCount: row.history_total_event_count ?? 0,
        lastEventAt: row.history_last_event_at ?? undefined,
        latestUserMessageId: row.history_latest_user_message_id ?? undefined,
        latestUserMessagePreview: row.history_latest_user_message_preview ?? undefined,
        latestAssistantMessageId: row.history_latest_assistant_message_id ?? undefined,
        latestAssistantMessagePreview: row.history_latest_assistant_message_preview ?? undefined,
        lastPersistedTurnStartedAt: row.history_last_persisted_turn_started_at ?? undefined,
        lastPersistedTurnFinishedAt: row.history_last_persisted_turn_finished_at ?? undefined,
        lastPersistedTurnStatus: historyLastPersistedTurnStatus,
        deletedTurnCount: row.history_deleted_turn_count ?? 0,
        updatedAt: row.history_updated_at,
        hasPersistedHistory: (row.history_total_event_count ?? 0) > 0,
      }
    : undefined

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    displayOrder: row.display_order ?? undefined,
    pinnedAt: row.pinned_at?.trim() || undefined,
    title: row.title?.trim() || '默认会话',
    titleOrigin: row.title_origin === 'manual' || row.title_origin === 'ai' ? row.title_origin : 'system',
    status: row.status === 'archived' ? 'archived' : 'active',
    sessionKind: row.session_kind === 'subagent' ? 'subagent' : 'primary',
    sessionRole: row.session_role === 'tester'
      || row.session_role === 'doc-writer'
      || row.session_role === 'reviewer'
      || row.session_role === 'researcher'
      ? row.session_role
      : 'general',
    sessionOrigin: row.session_origin === 'delegate' || row.session_origin === 'fork'
      ? row.session_origin
      : 'manual',
    parentSessionId: row.parent_session_id ?? undefined,
    rootSessionId: row.root_session_id ?? row.parent_session_id ?? row.id,
    forkMode: row.fork_mode === 'local' || row.fork_mode === 'worktree'
      ? row.fork_mode
      : undefined,
    forkedFromSessionId: row.forked_from_session_id ?? undefined,
    forkedFromMessageId: row.forked_from_message_id ?? undefined,
    forkRevision: (
      row.fork_revision_json
      && typeof row.fork_revision_json === 'object'
      && typeof (row.fork_revision_json as Record<string, unknown>).sourceUserMessageId === 'string'
      && (
        (row.fork_revision_json as Record<string, unknown>).kind === 'rewrite-user-turn'
        || (row.fork_revision_json as Record<string, unknown>).kind === 'retry-assistant-turn'
      )
    )
      ? {
          kind: (row.fork_revision_json as Record<string, unknown>).kind as 'rewrite-user-turn' | 'retry-assistant-turn',
          sourceTurnId: typeof (row.fork_revision_json as Record<string, unknown>).sourceTurnId === 'string'
            ? (row.fork_revision_json as Record<string, unknown>).sourceTurnId as string
            : undefined,
          sourceUserMessageId: (row.fork_revision_json as Record<string, unknown>).sourceUserMessageId as string,
          sourceAssistantMessageId: typeof (row.fork_revision_json as Record<string, unknown>).sourceAssistantMessageId === 'string'
            ? (row.fork_revision_json as Record<string, unknown>).sourceAssistantMessageId as string
            : undefined,
        }
      : undefined,
    pendingRevision: (
      row.pending_revision_json
      && typeof row.pending_revision_json === 'object'
      && typeof (row.pending_revision_json as Record<string, unknown>).sourceUserMessageId === 'string'
      && (
        (row.pending_revision_json as Record<string, unknown>).kind === 'rewrite-user-turn'
        || (row.pending_revision_json as Record<string, unknown>).kind === 'retry-assistant-turn'
      )
    )
      ? {
          kind: (row.pending_revision_json as Record<string, unknown>).kind as 'rewrite-user-turn' | 'retry-assistant-turn',
          sourceTurnId: typeof (row.pending_revision_json as Record<string, unknown>).sourceTurnId === 'string'
            ? (row.pending_revision_json as Record<string, unknown>).sourceTurnId as string
            : undefined,
          sourceUserMessageId: (row.pending_revision_json as Record<string, unknown>).sourceUserMessageId as string,
          sourceAssistantMessageId: typeof (row.pending_revision_json as Record<string, unknown>).sourceAssistantMessageId === 'string'
            ? (row.pending_revision_json as Record<string, unknown>).sourceAssistantMessageId as string
            : undefined,
        }
      : undefined,
    sharedWorktreeSourceSessionId: row.shared_worktree_source_session_id ?? undefined,
    executorNodeId: row.executor_node_id ?? undefined,
    agentType,
    customAgentId: row.custom_agent_id ?? undefined,
    customAgentName: row.custom_agent_name ?? undefined,
    agentInvocationMode: row.agent_invocation_mode === 'mention' || row.agent_invocation_mode === 'delegate'
      ? row.agent_invocation_mode
      : undefined,
    mountedSkillNames: Array.isArray(row.mounted_skill_names_json)
      ? row.mounted_skill_names_json.filter((item): item is string => typeof item === 'string')
      : [],
    mountedMcpServerNames: Array.isArray(row.mounted_mcp_server_names_json)
      ? row.mounted_mcp_server_names_json.filter((item): item is string => typeof item === 'string')
      : [],
    enabledMcpServerIds: Array.isArray(row.enabled_mcp_server_ids_json)
      ? row.enabled_mcp_server_ids_json.filter((item): item is string => typeof item === 'string')
      : [],
    delegatedPrompt: row.delegated_prompt ?? undefined,
    executionModel: resolveOpenCodeExecutionModel({
      executionModel: row.execution_model ?? undefined,
      opencodeConfig: normalizeOpenCodeExecutionConfig(row.opencode_config_json as WorkspaceSession['opencodeConfig']),
    }),
    agentSettings: mergeAgentRuntimeSettings(
      agentType,
      normalizeAgentConfig({}).agentSettings[agentType],
      row.agent_settings_json,
    ),
    opencodeConfig: normalizeOpenCodeExecutionConfig(row.opencode_config_json as WorkspaceSession['opencodeConfig'], row.execution_model ?? undefined),
    gitIdentityMode: row.git_identity_mode ?? undefined,
    publishPolicy: row.publish_policy === 'none' || row.publish_policy === 'push-branch' || row.publish_policy === 'pull-request'
      ? row.publish_policy
      : 'pull-request',
    gitAuthPreference: row.git_auth_preference === 'github-app' || row.git_auth_preference === 'credential'
      ? row.git_auth_preference
      : 'project-default',
    distributedTaskId: row.distributed_task_id ?? undefined,
    agentSessionId: row.agent_session_id ?? undefined,
    opencodeSessionId: row.agent_session_id ?? undefined,
    runtimeContinuations: Array.isArray(row.runtime_continuations_json)
      ? row.runtime_continuations_json.filter((item): item is NonNullable<WorkspaceSession['runtimeContinuations']>[number] => {
          return typeof item === 'object' && item !== null
        })
      : [],
    handoffSnapshot: normalizeHandoffSnapshot({
      handoffSnapshot: row.handoff_snapshot_json as WorkspaceSession['handoffSnapshot'],
      updatedAt: row.updated_at,
    }),
    baseBranch: row.base_branch ?? undefined,
    worktreeId: row.worktree_id,
    worktreeUniqueId: row.worktree_unique_id ?? undefined,
    branchName: row.branch_name,
    worktreeStatus: row.worktree_status,
    workingDirectoryMode: row.working_directory_mode === 'original-dir' ? 'original-dir' : 'worktree',
    needsHumanConfirm: row.needs_human_confirm,
    agentRunningStatus: row.agent_running_status ?? 'idle',
    runtimeStatus: row.runtime_status === 'queued'
      || row.runtime_status === 'running'
      || row.runtime_status === 'waiting'
      || row.runtime_status === 'completed'
      || row.runtime_status === 'error'
      || row.runtime_status === 'lost'
      || row.runtime_status === 'cancelled'
      ? row.runtime_status
      : 'idle',
    runtimeSessionId: row.runtime_session_id ?? undefined,
    runtimeOwnerExecutorId: row.runtime_owner_executor_id ?? undefined,
    runtimeStartedAt: row.runtime_started_at ?? undefined,
    lastHeartbeatAt: row.last_heartbeat_at ?? undefined,
    lastRuntimeEventAt: row.last_runtime_event_at ?? undefined,
    terminalReason: row.terminal_reason ?? undefined,
    runtimeSummary: normalizeWorkspaceSessionRuntimeSummary(row.runtime_summary_json),
    deliverySummary: normalizeWorkspaceDeliverySummary(row.delivery_summary_json),
    runtimeSequence: row.runtime_sequence ?? 0,
    currentStep: row.current_step ?? '',
    historyProjection: historyProjection
      ? {
          ...historyProjection,
          latestPreviewText: resolveWorkspaceSessionHistoryLatestPreviewText(historyProjection),
        }
      : undefined,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const getTaskExecutionHistory = (taskId: string): Task['executionHistory'] => {
  return Array.from(taskRunCache.values())
    .filter((run) => run.taskId === taskId)
    .sort(sortTaskRunsDesc)
    .map((run) => ({ ...run }))
}

export const extractLegacyTaskRunsFromTasks = (tasks: Task[]): TaskRun[] => {
  return tasks.flatMap((task) => task.executionHistory.map((run) => ({
    ...run,
    taskId: task.id,
    projectId: task.projectId,
  })))
}

export const hydrateTaskExecutionHistory = (task: Task): Task => {
  const executionHistory = getTaskExecutionHistory(task.id)
  return {
    ...task,
    executionHistory,
  }
}
