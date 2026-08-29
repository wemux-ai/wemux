/**
 * [INPUT]: Tasks, workspaces, workspace sessions, and execution-state patches.
 * [OUTPUT]: Pure workspace-session creation, merge, execution-preference, ordering, and path-safe state helpers.
 * [POS]: Shared workspace-session domain model; sessions never persist Task↔Workspace binding identity.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { VIBEMUX_MCP_SERVER_ID } from './mcp'
import { DEFAULT_AGENT_TYPE } from './agent-type'
import { mergeOpenCodeExecutionConfig, resolveOpenCodeExecutionModel } from './opencode-execution-config'
import type { AgentRunningStatus, MainChatRuntimeContinuation, OpenCodeExecutionConfig, Task, TaskGitIdentityMode, TaskWorkspaceBinding, WorkspaceExecutionDefaults, WorkspaceSession, WorkspaceSessionRuntimeStatus, WorkingDirectoryMode, WorkspaceRecord } from './types'

export type WorkspaceExecutionPreference = {
  agentType: Task['agentType']
  executionModel: string
  source: 'explicit' | 'session' | 'workspace-history' | 'user-default'
}

export const resolveWorkspaceExecutionPreference = (params: {
  workspaceId: string
  executorNodeId: string
  sessions: WorkspaceSession[]
  currentSession?: WorkspaceSession | null
  explicitAgentType?: Task['agentType']
  explicitExecutionModel?: string
  defaults?: WorkspaceExecutionDefaults
}): WorkspaceExecutionPreference | null => {
  const explicitExecutionModel = params.explicitExecutionModel?.trim()
  if (params.explicitAgentType && explicitExecutionModel) {
    return { agentType: params.explicitAgentType, executionModel: explicitExecutionModel, source: 'explicit' }
  }

  const toPreference = (
    session: WorkspaceSession | null | undefined,
    source: WorkspaceExecutionPreference['source'],
  ): WorkspaceExecutionPreference | null => {
    const executionModel = session?.executionModel?.trim()
    if (!session?.agentType || !executionModel) return null
    const executorNodeId = session.runtimeOwnerExecutorId?.trim() || session.executorNodeId?.trim()
    if (executorNodeId && executorNodeId !== params.executorNodeId) return null
    return { agentType: session.agentType, executionModel, source }
  }

  const currentPreference = toPreference(params.currentSession, 'session')
  if (currentPreference) return currentPreference

  const successfulPreference = [...params.sessions]
    .filter((session) => session.workspaceId === params.workspaceId && session.runtimeStatus === 'completed')
    .sort((left, right) => (right.lastRuntimeEventAt || right.updatedAt).localeCompare(left.lastRuntimeEventAt || left.updatedAt))
    .map((session) => toPreference(session, 'workspace-history'))
    .find((preference): preference is WorkspaceExecutionPreference => Boolean(preference))
  if (successfulPreference) return successfulPreference

  const defaultExecutionModel = params.defaults?.executionModel.trim()
  if (
    params.defaults?.agentType
    && defaultExecutionModel
    && params.defaults.executorNodeId === params.executorNodeId
  ) {
    return {
      agentType: params.defaults.agentType,
      executionModel: defaultExecutionModel,
      source: 'user-default',
    }
  }

  return null
}

export type WorkspaceTaskExecutionView = Task & Pick<
  WorkspaceSession,
  'workspaceId' | 'executorNodeId' | 'agentType' | 'distributedTaskId' | 'agentSessionId' | 'opencodeSessionId' | 'worktreeId' | 'branchName' | 'worktreeStatus' | 'workingDirectoryMode' | 'agentSettings' | 'enabledMcpServerIds' | 'publishPolicy' | 'gitAuthPreference'
> & {
  runtimeStatus?: WorkspaceSessionRuntimeStatus
}

export type WorkspaceCodeStateView = {
  workspaceId: string
  baseBranch?: string
  branchName: string
  workingDirectoryMode: WorkingDirectoryMode
}

export type WorkspaceSessionRuntimeView = Pick<
  WorkspaceSession,
  | 'agentRunningStatus'
  | 'currentStep'
  | 'lastHeartbeatAt'
  | 'lastRuntimeEventAt'
  | 'needsHumanConfirm'
  | 'runtimeContinuations'
  | 'runtimeOwnerExecutorId'
  | 'runtimeSequence'
  | 'runtimeSessionId'
  | 'runtimeStartedAt'
  | 'runtimeStatus'
  | 'runtimeSummary'
  | 'terminalReason'
> & {
  executorId: string
  workspaceSessionId: string
}

export type WorkspaceDirectoryView = {
  workspaceId: string
  workspaceSessionId?: string
  sourceWorkspaceSessionId?: string
  executorId: string
  worktreeId?: string
  worktreeUniqueId?: number
  worktreeStatus?: WorkspaceSession['worktreeStatus']
  workingDirectoryMode: WorkingDirectoryMode
}

export type WorkspaceExecutionContext = {
  task?: Task
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'agentType' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode' | 'executorNodeId'>
  session?: WorkspaceSession
  codeState: WorkspaceCodeStateView
  directory: WorkspaceDirectoryView
  runtime?: WorkspaceSessionRuntimeView
  runtimeConfig: {
    agentType: Task['agentType']
    executionModel?: string
    opencodeConfig?: Task['opencodeConfig']
    gitIdentityMode?: Task['gitIdentityMode']
    publishPolicy?: WorkspaceSession['publishPolicy']
    gitAuthPreference?: WorkspaceSession['gitAuthPreference']
    agentSettings?: WorkspaceSession['agentSettings']
    enabledMcpServerIds?: string[]
  }
}

export type WorkspaceSessionContinuationScope = {
  runtimeId: Task['agentType']
  executorId?: string
  customAgentId?: string
  executionModel?: string
  cwd?: string
}

const cloneOptionalStringArray = (value?: string[]) => {
  return Array.isArray(value) ? [...value] : undefined
}

const cloneRuntimeContinuations = (value?: MainChatRuntimeContinuation[]) => {
  return Array.isArray(value)
    ? value.map((item) => ({ ...item }))
    : undefined
}

const cloneHandoffSnapshot = (value?: WorkspaceSession['handoffSnapshot']) => {
  if (!value) {
    return undefined
  }

  return {
    ...value,
    summaryLines: [...value.summaryLines],
    recentMessages: value.recentMessages.map((item) => ({ ...item })),
  }
}

const normalizeContinuationScopeValue = (value?: string | null) => {
  return value?.trim() || ''
}

const resolveDefaultWorkspacePublishPolicy = (task?: Pick<Task, 'executionMode'> | null) => {
  return task?.executionMode === 'remote' || task?.executionMode === 'auto'
    ? 'pull-request' as const
    : 'none' as const
}

const createDefaultWorkspaceSessionEnabledMcpServerIds = () => {
  return [VIBEMUX_MCP_SERVER_ID]
}

export const resolveWorkspaceSessionExecutorId = (
  session?: {
    executorNodeId?: string | null
    runtimeOwnerExecutorId?: string | null
  } | null,
  workspaceExecutorId?: string | null,
) => {
  return workspaceExecutorId?.trim()
    || session?.runtimeOwnerExecutorId?.trim()
    || session?.executorNodeId?.trim()
    || ''
}

export const resolveWorkspaceWorkerId = (
  workspace?: {
    executorNodeId?: string | null
  } | null,
) => workspace?.executorNodeId?.trim() || ''

export const buildWorkspaceContinuationScopeKey = (scope: WorkspaceSessionContinuationScope) => {
  return [
    `runtime=${scope.runtimeId}`,
    `executor=${normalizeContinuationScopeValue(scope.executorId) || 'default'}`,
    `persona=${normalizeContinuationScopeValue(scope.customAgentId) || 'main'}`,
    `model=${normalizeContinuationScopeValue(scope.executionModel) || 'default'}`,
    `cwd=${normalizeContinuationScopeValue(scope.cwd) || 'default'}`,
  ].join('|')
}

export const getWorkspaceRuntimeSessionId = (
  session: Pick<WorkspaceSession, 'agentSessionId' | 'opencodeSessionId' | 'runtimeContinuations'>,
  scope: WorkspaceSessionContinuationScope,
) => {
  const scopeKey = buildWorkspaceContinuationScopeKey(scope)
  const continuation = session.runtimeContinuations?.find((item) => item.scopeKey === scopeKey)
  if (continuation?.nativeSessionId?.trim()) {
    return continuation.nativeSessionId.trim()
  }

  if ((session.runtimeContinuations?.length ?? 0) > 0) {
    return undefined
  }

  return session.agentSessionId?.trim() || session.opencodeSessionId?.trim() || undefined
}

export const setWorkspaceRuntimeSessionId = (
  session: WorkspaceSession,
  scope: WorkspaceSessionContinuationScope,
  runtimeSessionId?: string,
) => {
  const normalizedSessionId = runtimeSessionId?.trim()
  if (!normalizedSessionId) {
    return cloneRuntimeContinuations(session.runtimeContinuations)
  }

  const scopeKey = buildWorkspaceContinuationScopeKey(scope)
  const continuation: MainChatRuntimeContinuation = {
    runtimeId: scope.runtimeId,
    scopeKey,
    nativeSessionId: normalizedSessionId,
    executorId: normalizeContinuationScopeValue(scope.executorId) || undefined,
    customAgentId: normalizeContinuationScopeValue(scope.customAgentId) || undefined,
    executionModel: normalizeContinuationScopeValue(scope.executionModel) || undefined,
    cwdHash: normalizeContinuationScopeValue(scope.cwd) || undefined,
    updatedAt: new Date().toISOString(),
  }

  return [
    ...(cloneRuntimeContinuations(session.runtimeContinuations) ?? []).filter((item) => item.scopeKey !== scopeKey),
    continuation,
  ]
}

export const clearWorkspaceRuntimeSessionId = (
  session: Pick<WorkspaceSession, 'runtimeContinuations'>,
  scope: WorkspaceSessionContinuationScope,
) => {
  const scopeKey = buildWorkspaceContinuationScopeKey(scope)
  const nextContinuations = (cloneRuntimeContinuations(session.runtimeContinuations) ?? [])
    .filter((item) => item.scopeKey !== scopeKey)

  return nextContinuations.length > 0 ? nextContinuations : []
}

const resolveOptionalStringArrayPatch = (
  patch: Partial<Record<'value', string[] | undefined>>,
  previous?: string[],
) => {
  if (Object.prototype.hasOwnProperty.call(patch, 'value')) {
    return cloneOptionalStringArray(patch.value)
  }

  return cloneOptionalStringArray(previous)
}

const resolveStringArrayPatch = (
  patch: Partial<Record<'value', string[] | undefined>>,
  previous?: string[],
) => {
  return resolveOptionalStringArrayPatch(patch, previous) ?? []
}

const hasPatchValue = <T extends object, K extends PropertyKey>(patch: T, key: K) => {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

const resolveWorkspaceSessionRuntimeStatusFromAgentStatus = (
  agentRunningStatus: AgentRunningStatus,
  previousRuntimeStatus: WorkspaceSessionRuntimeStatus,
): WorkspaceSessionRuntimeStatus => {
  if (agentRunningStatus === 'waiting') {
    return 'waiting'
  }

  if (agentRunningStatus === 'complete') {
    return 'completed'
  }

  if (agentRunningStatus === 'error') {
    return 'error'
  }

  if (agentRunningStatus === 'idle') {
    return 'idle'
  }

  return previousRuntimeStatus === 'queued' ? 'queued' : 'running'
}

const resolveWorkspaceSessionExecutionModel = (params: {
  task?: Task | null
  agentType: Task['agentType']
  sessionAgentType?: Task['agentType']
  sessionModel?: string
  hasModelPatch?: boolean
}) => {
  if (params.sessionModel?.trim()) {
    if (params.hasModelPatch || !params.task || (params.sessionAgentType ?? params.task.agentType) === params.agentType) {
      return params.sessionModel
    }
  }

  if (!params.hasModelPatch && params.task && params.agentType === params.task.agentType) {
    return params.task.executionModel
  }

  return undefined
}

const resolveRuntimeExecutionModel = (params: {
  agentType: Task['agentType']
  executionModel?: string
  opencodeConfig?: Task['opencodeConfig']
}) => {
  if (params.agentType === 'OpenCode') {
    return resolveOpenCodeExecutionModel({
      opencodeConfig: params.opencodeConfig,
      executionModel: params.executionModel,
    })
  }

  return params.executionModel
}

const makeSlug = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
}

export const buildTaskBranchName = (worktreeId: string, title: string) => {
  const worktreeKey = worktreeId.slice(0, 4)
  const slug = makeSlug(title) || 'task'

  return `wemux/${worktreeKey}-${slug}`
}

export const buildWorkspaceCodeBranchName = (params: {
  workspaceId: string
  workspaceName: string
  discriminator?: string
}) => {
  const baseBranchName = buildTaskBranchName(params.workspaceId, params.workspaceName)
  const suffix = makeSlug(params.discriminator?.trim() || '').slice(0, 12)

  return suffix ? `${baseBranchName}-${suffix}` : baseBranchName
}

// 兼容窗口：新旧品牌前缀都识别为托管分支，后续可移除 vibemux/ 分支
const isWemuxManagedBranchName = (branchName?: string | null) => {
  const normalized = branchName?.trim() || ''
  return normalized.startsWith('wemux/') || normalized.startsWith('vibemux/')
}

export const resolveWorkspaceSessionBranchName = (params: {
  task?: Pick<Task, 'title' | 'baseBranch' | 'baseBranchHint'>
  title?: string
  baseBranch?: string
  worktreeId: string
  workspaceName?: string
  workingDirectoryMode?: WorkingDirectoryMode
  currentBranchName?: string
}) => {
  const branchNameTitle = params.workspaceName?.trim() || params.task?.title || params.title?.trim() || '工作区'
  const normalizedCurrentBranchName = params.currentBranchName?.trim() || ''
  if (params.workingDirectoryMode === 'original-dir') {
    if (normalizedCurrentBranchName && !isWemuxManagedBranchName(normalizedCurrentBranchName)) {
      return normalizedCurrentBranchName
    }

    return (
      params.task?.baseBranch?.trim()
      || params.task?.baseBranchHint?.trim()
      || params.baseBranch?.trim()
      || normalizedCurrentBranchName
      || buildTaskBranchName(params.worktreeId, branchNameTitle)
    )
  }

  return normalizedCurrentBranchName || buildTaskBranchName(params.worktreeId, branchNameTitle)
}

export const resolveWorkspaceCodeBaseBranch = (
  workspace: Pick<WorkspaceRecord, 'codeBaseBranch' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode'>,
  fallbackBaseBranch?: string,
) => {
  if (workspace.workingDirectoryMode === 'original-dir') {
    return undefined
  }

  return (
    workspace.codeBaseBranch?.trim()
    || workspace.suggestedBaseBranch?.trim()
    || fallbackBaseBranch?.trim()
    || workspace.defaultBranch?.trim()
    || undefined
  )
}

export const resolveWorkspaceCodeBranchName = (params: {
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBranchName' | 'defaultBranch' | 'workingDirectoryMode'>
  fallbackSession?: Pick<WorkspaceSession, 'branchName'> | null
  fallbackBaseBranch?: string
}) => {
  const workspaceBranchName = params.workspace.codeBranchName?.trim()
  if (workspaceBranchName) {
    return workspaceBranchName
  }

  const sessionBranchName = params.fallbackSession?.branchName?.trim()
  if (sessionBranchName) {
    return sessionBranchName
  }

  if (params.workspace.workingDirectoryMode === 'original-dir') {
    return params.fallbackBaseBranch?.trim() || params.workspace.defaultBranch?.trim() || buildTaskBranchName(params.workspace.id, params.workspace.name)
  }

  return buildWorkspaceCodeBranchName({
    workspaceId: params.workspace.id,
    workspaceName: params.workspace.name,
  })
}

export const applyWorkspaceCodeStateToSession = (
  session: WorkspaceSession,
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode'>,
): WorkspaceSession => {
  const codeBaseBranch = resolveWorkspaceCodeBaseBranch(workspace, session.baseBranch)
  const codeBranchName = resolveWorkspaceCodeBranchName({
    workspace,
    fallbackSession: session,
    fallbackBaseBranch: codeBaseBranch,
  })

  return {
    ...session,
    baseBranch: codeBaseBranch,
    branchName: codeBranchName,
  }
}

export const resolveWorkspaceCodeStateView = (params: {
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode'>
  session?: Pick<WorkspaceSession, 'baseBranch' | 'branchName'> | null
  fallbackBaseBranch?: string
}): WorkspaceCodeStateView => {
  const baseBranch = resolveWorkspaceCodeBaseBranch(
    params.workspace,
    params.workspace.workingDirectoryMode === 'original-dir'
      ? undefined
      : params.fallbackBaseBranch ?? params.session?.baseBranch,
  )
  const branchName = resolveWorkspaceCodeBranchName({
    workspace: params.workspace,
    fallbackSession: params.session,
    fallbackBaseBranch: baseBranch ?? params.fallbackBaseBranch ?? params.session?.baseBranch,
  })

  return {
    workspaceId: params.workspace.id,
    baseBranch,
    branchName,
    workingDirectoryMode: params.workspace.workingDirectoryMode,
  }
}

export const resolveWorkspaceSessionRuntimeView = (
  session: WorkspaceSession,
  workspaceExecutorId?: string | null,
): WorkspaceSessionRuntimeView => ({
  workspaceSessionId: session.id,
  executorId: resolveWorkspaceSessionExecutorId(session, workspaceExecutorId),
  agentRunningStatus: session.agentRunningStatus,
  currentStep: session.currentStep,
  lastHeartbeatAt: session.lastHeartbeatAt,
  lastRuntimeEventAt: session.lastRuntimeEventAt,
  needsHumanConfirm: session.needsHumanConfirm,
  runtimeContinuations: cloneRuntimeContinuations(session.runtimeContinuations),
  runtimeOwnerExecutorId: session.runtimeOwnerExecutorId,
  runtimeSequence: session.runtimeSequence,
  runtimeSessionId: session.runtimeSessionId,
  runtimeStartedAt: session.runtimeStartedAt,
  runtimeStatus: session.runtimeStatus,
  runtimeSummary: session.runtimeSummary,
  terminalReason: session.terminalReason,
})

export const resolveWorkspaceDirectoryView = (params: {
  workspace: Pick<WorkspaceRecord, 'id' | 'executorNodeId' | 'workingDirectoryMode'> & { projectId?: string }
  session?: Pick<WorkspaceSession, 'id' | 'workspaceId' | 'executorNodeId' | 'runtimeOwnerExecutorId' | 'worktreeId' | 'worktreeUniqueId' | 'worktreeStatus' | 'workingDirectoryMode'> | null
  sourceSession?: Pick<WorkspaceSession, 'id' | 'workspaceId' | 'executorNodeId' | 'runtimeOwnerExecutorId' | 'worktreeId' | 'worktreeUniqueId' | 'worktreeStatus' | 'workingDirectoryMode'> | null
}): WorkspaceDirectoryView => {
  const directorySource = params.sourceSession ?? params.session
  const workingDirectoryMode = directorySource?.workingDirectoryMode ?? params.workspace.workingDirectoryMode
  const executorId = resolveWorkspaceSessionExecutorId(directorySource ?? params.session, params.workspace.executorNodeId)

  return {
    workspaceId: params.workspace.id,
    workspaceSessionId: params.session?.id,
    sourceWorkspaceSessionId: directorySource?.id,
    executorId,
    worktreeId: workingDirectoryMode === 'worktree' ? directorySource?.worktreeId : undefined,
    worktreeUniqueId: workingDirectoryMode === 'worktree' ? directorySource?.worktreeUniqueId : undefined,
    worktreeStatus: directorySource?.worktreeStatus,
    workingDirectoryMode,
  }
}

export const resolveWorkspaceExecutionContext = (params: {
  task?: Task | null
  workspace: Pick<WorkspaceRecord, 'id' | 'name' | 'agentType' | 'codeBaseBranch' | 'codeBranchName' | 'suggestedBaseBranch' | 'defaultBranch' | 'workingDirectoryMode' | 'executorNodeId' | 'projectId'>
  session?: WorkspaceSession | null
  directorySourceSession?: WorkspaceSession | null
  fallbackBaseBranch?: string
}): WorkspaceExecutionContext => {
  const task = params.task ?? undefined
  const session = params.session ?? undefined
  const agentType = session?.agentType ?? task?.agentType ?? params.workspace.agentType
  const inheritedExecutionModel = task
    ? resolveWorkspaceSessionExecutionModel({
        task,
        agentType,
        sessionAgentType: session?.agentType ?? task.agentType,
        sessionModel: session?.executionModel,
      })
    : session?.executionModel
  const opencodeConfig = mergeOpenCodeExecutionConfig(
    task?.opencodeConfig,
    session?.opencodeConfig,
    inheritedExecutionModel,
  )
  const executionModel = resolveRuntimeExecutionModel({
    agentType,
    executionModel: inheritedExecutionModel,
    opencodeConfig,
  })

  return {
    task,
    workspace: params.workspace,
    session,
    codeState: resolveWorkspaceCodeStateView({
      workspace: params.workspace,
      session,
      fallbackBaseBranch: params.fallbackBaseBranch ?? task?.baseBranch ?? task?.baseBranchHint,
    }),
    directory: resolveWorkspaceDirectoryView({
      workspace: params.workspace,
      session,
      sourceSession: params.directorySourceSession ?? session,
    }),
    runtime: session ? resolveWorkspaceSessionRuntimeView(session, params.workspace.executorNodeId) : undefined,
    runtimeConfig: {
      agentType,
      executionModel,
      opencodeConfig,
      gitIdentityMode: session?.gitIdentityMode ?? task?.gitIdentityMode,
      agentSettings: session?.agentSettings,
      enabledMcpServerIds: cloneOptionalStringArray(session?.enabledMcpServerIds),
    },
  }
}

const getWorkspaceSessionActivityAt = (
  session: Pick<WorkspaceSession, 'lastActiveAt' | 'createdAt'>,
) => {
  return session.lastActiveAt?.trim() || session.createdAt
}

export const resolveNextWorkspaceSessionDisplayOrder = <
  T extends Partial<Pick<WorkspaceSession, 'displayOrder'>>
>(
  sessions: T[],
) => {
  const existingDisplayOrders = sessions
    .map((session) => session.displayOrder)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (existingDisplayOrders.length === 0) {
    return 0
  }

  return Math.min(...existingDisplayOrders) - 1
}

const normalizePinnedAt = (value?: string | null) => value?.trim() || undefined

export const isWorkspaceSessionPinned = (session: Pick<WorkspaceSession, 'pinnedAt'>) => {
  return Boolean(normalizePinnedAt(session.pinnedAt))
}

export const setWorkspaceSessionPinned = <T extends Pick<WorkspaceSession, 'pinnedAt'> & object>(
  session: T,
  pinned: boolean,
  pinnedAt = new Date().toISOString(),
): T => {
  const currentPinnedAt = normalizePinnedAt(session.pinnedAt)
  const nextPinnedAt = pinned ? currentPinnedAt ?? pinnedAt : undefined
  if (currentPinnedAt === nextPinnedAt) {
    return session
  }

  return {
    ...session,
    pinnedAt: nextPinnedAt,
  } as T
}

export const sortWorkspaceSessions = <
  T extends Pick<WorkspaceSession, 'id' | 'lastActiveAt' | 'createdAt' | 'pinnedAt'> & Partial<Pick<WorkspaceSession, 'displayOrder'>>
>(
  sessions: T[],
) => {
  return sessions
    .map((session, index) => ({
      session,
      index,
      pinnedAt: normalizePinnedAt(session.pinnedAt),
    }))
    .sort((left, right) => {
      const leftPinned = Boolean(left.pinnedAt)
      const rightPinned = Boolean(right.pinnedAt)
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1
      }

      if (leftPinned && rightPinned) {
        const pinnedCompare = right.pinnedAt!.localeCompare(left.pinnedAt!)
        if (pinnedCompare !== 0) {
          return pinnedCompare
        }
      }

      const leftHasDisplayOrder = typeof left.session.displayOrder === 'number' && Number.isFinite(left.session.displayOrder)
      const rightHasDisplayOrder = typeof right.session.displayOrder === 'number' && Number.isFinite(right.session.displayOrder)
      const leftDisplayOrder = left.session.displayOrder
      const rightDisplayOrder = right.session.displayOrder

      if (leftHasDisplayOrder && rightHasDisplayOrder && leftDisplayOrder !== rightDisplayOrder) {
        return Number(leftDisplayOrder) - Number(rightDisplayOrder)
      }

      return right.session.lastActiveAt.localeCompare(left.session.lastActiveAt)
        || getWorkspaceSessionActivityAt(right.session).localeCompare(getWorkspaceSessionActivityAt(left.session))
        || right.session.createdAt.localeCompare(left.session.createdAt)
        || right.session.id.localeCompare(left.session.id)
        || left.index - right.index
    })
    .map(({ session }) => session)
}

export const getWorkspaceAutoCommitDefault = (workingDirectoryMode: WorkingDirectoryMode = 'worktree') => {
  return workingDirectoryMode !== 'original-dir'
}

export const resolveWorkspaceAutoCommitEnabled = (
  value?: Pick<WorkspaceRecord, 'workingDirectoryMode' | 'autoCommitEnabled'> | null,
) => {
  if (typeof value?.autoCommitEnabled === 'boolean') {
    return value.autoCommitEnabled
  }

  return getWorkspaceAutoCommitDefault(value?.workingDirectoryMode ?? 'worktree')
}

export const createTaskWorkspaceBinding = (taskId: string, workspaceId: string): TaskWorkspaceBinding => {
  const timestamp = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    taskId,
    workspaceId,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const sessionRoleLabels: Record<NonNullable<WorkspaceSession['sessionRole']>, string> = {
  general: '通用协作',
  tester: '测试',
  'doc-writer': '文档',
  reviewer: '评审',
  researcher: '研究',
}

export const getWorkspaceSessionRoleLabel = (role?: WorkspaceSession['sessionRole']) => {
  return sessionRoleLabels[role ?? 'general']
}

export const buildWorkspaceSessionTitle = (params: {
  title?: string
  sessionKind?: WorkspaceSession['sessionKind']
  sessionRole?: WorkspaceSession['sessionRole']
  customAgentName?: string
}) => {
  const explicitTitle = params.title?.trim()
  if (explicitTitle) {
    return explicitTitle
  }

  if (params.sessionKind === 'subagent') {
    const roleLabel = getWorkspaceSessionRoleLabel(params.sessionRole)
    const customAgentName = params.customAgentName?.trim()
    return customAgentName
      ? `${customAgentName} · ${roleLabel}`
      : `${roleLabel}子会话`
  }

  return '默认会话'
}

export const preserveWorkspaceSessionTitle = (
  currentSession: Pick<WorkspaceSession, 'title' | 'titleOrigin'> | null | undefined,
  nextSession: WorkspaceSession,
): WorkspaceSession => {
  const currentTitleOrigin = currentSession?.titleOrigin ?? 'system'
  const nextTitleOrigin = nextSession.titleOrigin ?? 'system'
  if (currentTitleOrigin === 'system' || nextTitleOrigin !== 'system') {
    return nextSession
  }

  return {
    ...nextSession,
    title: currentSession?.title ?? nextSession.title,
    titleOrigin: currentTitleOrigin,
  }
}

export const createWorkspaceSession = (params: {
  task?: Task
  agentType?: Task['agentType']
  executionModel?: string
  opencodeConfig?: OpenCodeExecutionConfig
  gitIdentityMode?: TaskGitIdentityMode
  baseBranch?: string
  workspaceId: string
  displayOrder?: number
  executorNodeId?: string
  customAgentId?: string
  customAgentName?: string
  agentInvocationMode?: WorkspaceSession['agentInvocationMode']
  sessionKind?: WorkspaceSession['sessionKind']
  sessionRole?: WorkspaceSession['sessionRole']
  parentSessionId?: string
  rootSessionId?: string
  delegatedPrompt?: string
  worktreeUniqueId?: number
  workspaceName?: string
  title?: string
  worktreeId?: string
  workingDirectoryMode?: WorkspaceSession['workingDirectoryMode']
  titleOrigin?: WorkspaceSession['titleOrigin']
  sessionOrigin?: WorkspaceSession['sessionOrigin']
  forkMode?: WorkspaceSession['forkMode']
  forkedFromSessionId?: string
  forkedFromMessageId?: string
  forkRevision?: WorkspaceSession['forkRevision']
  pendingRevision?: WorkspaceSession['pendingRevision']
  sharedWorktreeSourceSessionId?: string
}) => {
  const timestamp = new Date().toISOString()
  const id = crypto.randomUUID()
  const worktreeId = params.worktreeId?.trim() || crypto.randomUUID()
  const workingDirectoryMode = params.workingDirectoryMode ?? 'worktree'
  const agentType = params.task?.agentType ?? params.agentType ?? DEFAULT_AGENT_TYPE
  const opencodeConfig = mergeOpenCodeExecutionConfig(undefined, params.task?.opencodeConfig ?? params.opencodeConfig, params.task?.executionModel ?? params.executionModel)
  const executionModel = resolveRuntimeExecutionModel({
    agentType,
    executionModel: params.task?.executionModel ?? params.executionModel,
    opencodeConfig,
  })
  const sessionKind = params.sessionKind ?? 'primary'
  const title = buildWorkspaceSessionTitle({
    title: params.title,
    sessionKind,
    sessionRole: params.sessionRole,
    customAgentName: params.customAgentName,
  })

  return {
    id,
    workspaceId: params.workspaceId,
    displayOrder: params.displayOrder,
    title,
    titleOrigin: params.titleOrigin ?? 'system',
    status: 'active' as const,
    sessionKind,
    sessionRole: params.sessionRole ?? 'general',
    sessionOrigin: params.sessionOrigin ?? (sessionKind === 'subagent' ? 'delegate' : 'manual'),
    parentSessionId: params.parentSessionId?.trim() || undefined,
    rootSessionId: params.rootSessionId?.trim() || params.parentSessionId?.trim() || id,
    forkMode: params.forkMode,
    forkedFromSessionId: params.forkedFromSessionId?.trim() || undefined,
    forkedFromMessageId: params.forkedFromMessageId?.trim() || undefined,
    forkRevision: params.forkRevision ? { ...params.forkRevision } : undefined,
    pendingRevision: params.pendingRevision ? { ...params.pendingRevision } : undefined,
    sharedWorktreeSourceSessionId: params.sharedWorktreeSourceSessionId?.trim() || undefined,
    executorNodeId: params.executorNodeId,
    agentType,
    customAgentId: params.customAgentId,
    customAgentName: params.customAgentName,
    agentInvocationMode: params.agentInvocationMode,
    mountedSkillNames: [],
    mountedMcpServerNames: [],
    enabledMcpServerIds: createDefaultWorkspaceSessionEnabledMcpServerIds(),
    delegatedPrompt: params.delegatedPrompt?.trim() || undefined,
    executionModel,
    opencodeConfig,
    gitIdentityMode: params.task?.gitIdentityMode ?? params.gitIdentityMode,
    publishPolicy: params.task ? resolveDefaultWorkspacePublishPolicy(params.task) : 'none',
    gitAuthPreference: 'project-default',
    distributedTaskId: undefined,
    agentSessionId: undefined,
    opencodeSessionId: undefined,
    runtimeContinuations: [],
    handoffSnapshot: undefined,
    baseBranch: params.task?.baseBranch ?? params.baseBranch,
    worktreeId,
    worktreeUniqueId: params.worktreeUniqueId,
    branchName: resolveWorkspaceSessionBranchName({
      task: params.task,
      title: params.title,
      baseBranch: params.baseBranch,
      worktreeId,
      workspaceName: params.workspaceName,
      workingDirectoryMode,
    }),
    worktreeStatus: 'planned' as const,
    workingDirectoryMode,
    needsHumanConfirm: false,
    agentRunningStatus: 'idle' as const,
    runtimeStatus: 'idle' as const,
    runtimeSessionId: undefined,
    runtimeOwnerExecutorId: params.executorNodeId,
    runtimeStartedAt: undefined,
    lastHeartbeatAt: undefined,
    lastRuntimeEventAt: undefined,
    terminalReason: undefined,
    runtimeSummary: undefined,
    runtimeSequence: 0,
    currentStep: '',
    historyProjection: undefined,
    lastActiveAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies WorkspaceSession
}

export const buildWorkspaceTaskExecutionView = (task: Task, session?: WorkspaceSession | null): WorkspaceTaskExecutionView | Task => {
  if (!session) {
    return task
  }

  const opencodeConfig = mergeOpenCodeExecutionConfig(
    task.opencodeConfig,
    session.opencodeConfig,
    resolveWorkspaceSessionExecutionModel({
      task,
      agentType: session.agentType ?? task.agentType,
      sessionAgentType: session.agentType ?? task.agentType,
      sessionModel: session.executionModel,
    }),
  )
  const agentType = session.agentType ?? task.agentType
  const executionModel = resolveRuntimeExecutionModel({
    agentType,
    executionModel: resolveWorkspaceSessionExecutionModel({
      task,
      agentType,
      sessionAgentType: session.agentType ?? task.agentType,
      sessionModel: session.executionModel,
    }),
    opencodeConfig,
  })

  return {
    ...task,
    workspaceId: session.workspaceId,
    executorNodeId: session.executorNodeId,
    agentType,
    distributedTaskId: session.distributedTaskId,
    agentSessionId: session.agentSessionId ?? session.opencodeSessionId,
    opencodeSessionId: session.opencodeSessionId,
    worktreeId: session.worktreeId,
    branchName: session.branchName,
    worktreeStatus: session.worktreeStatus,
    workingDirectoryMode: session.workingDirectoryMode,
    agentSettings: session.agentSettings,
    enabledMcpServerIds: cloneOptionalStringArray(session.enabledMcpServerIds),
    executionModel,
    opencodeConfig,
    gitIdentityMode: session.gitIdentityMode ?? task.gitIdentityMode,
    publishPolicy: session.publishPolicy ?? resolveDefaultWorkspacePublishPolicy(task),
    gitAuthPreference: session.gitAuthPreference ?? 'project-default',
    baseBranch: session.baseBranch ?? task.baseBranch,
    needsHumanConfirm: session.needsHumanConfirm,
    agentRunningStatus: session.agentRunningStatus,
    runtimeStatus: session.runtimeStatus,
    currentStep: session.currentStep,
  }
}

export const mergeWorkspaceSession = (task: Task | null | undefined, session: WorkspaceSession, patch: Partial<WorkspaceSession>): WorkspaceSession => {
  const agentType = patch.agentType ?? session.agentType ?? task?.agentType ?? DEFAULT_AGENT_TYPE
  const hasExecutionModelPatch = hasPatchValue(patch, 'executionModel')
  const hasAgentSessionPatch = hasPatchValue(patch, 'agentSessionId')
  const hasOpencodeSessionPatch = hasPatchValue(patch, 'opencodeSessionId')
  const sessionModel = hasExecutionModelPatch
    ? patch.executionModel
    : session.executionModel
  const inheritedExecutionModel = resolveWorkspaceSessionExecutionModel({
    task,
    agentType,
    sessionAgentType: session.agentType ?? task?.agentType ?? agentType,
    sessionModel,
    hasModelPatch: hasExecutionModelPatch,
  })
  const opencodeConfig = mergeOpenCodeExecutionConfig(
    task?.opencodeConfig,
    mergeOpenCodeExecutionConfig(session.opencodeConfig, patch.opencodeConfig, patch.executionModel),
    inheritedExecutionModel,
  )
  const executionModel = resolveRuntimeExecutionModel({
    agentType,
    executionModel: inheritedExecutionModel,
    opencodeConfig,
  })

  return {
    ...session,
    workspaceId: session.workspaceId,
    displayOrder: patch.displayOrder ?? session.displayOrder,
    pinnedAt: hasPatchValue(patch, 'pinnedAt') ? normalizePinnedAt(patch.pinnedAt) : normalizePinnedAt(session.pinnedAt),
    title: buildWorkspaceSessionTitle({
      title: patch.title ?? session.title,
      sessionKind: patch.sessionKind ?? session.sessionKind,
      sessionRole: patch.sessionRole ?? session.sessionRole,
      customAgentName: patch.customAgentName ?? session.customAgentName,
    }),
    titleOrigin: patch.titleOrigin ?? session.titleOrigin ?? 'system',
    status: patch.status ?? session.status,
    sessionKind: patch.sessionKind ?? session.sessionKind,
    sessionRole: patch.sessionRole ?? session.sessionRole,
    sessionOrigin: patch.sessionOrigin ?? session.sessionOrigin ?? (session.sessionKind === 'subagent' ? 'delegate' : 'manual'),
    parentSessionId: patch.parentSessionId ?? session.parentSessionId,
    rootSessionId: patch.rootSessionId ?? session.rootSessionId ?? session.parentSessionId ?? session.id,
    forkMode: patch.forkMode ?? session.forkMode,
    forkedFromSessionId: patch.forkedFromSessionId ?? session.forkedFromSessionId,
    forkedFromMessageId: patch.forkedFromMessageId ?? session.forkedFromMessageId,
    forkRevision: hasPatchValue(patch, 'forkRevision')
      ? (patch.forkRevision ? { ...patch.forkRevision } : undefined)
      : session.forkRevision,
    pendingRevision: hasPatchValue(patch, 'pendingRevision')
      ? (patch.pendingRevision ? { ...patch.pendingRevision } : undefined)
      : session.pendingRevision,
    sharedWorktreeSourceSessionId: patch.sharedWorktreeSourceSessionId ?? session.sharedWorktreeSourceSessionId,
    executionModel,
    opencodeConfig,
    gitIdentityMode: patch.gitIdentityMode ?? session.gitIdentityMode ?? task?.gitIdentityMode,
    publishPolicy: patch.publishPolicy ?? session.publishPolicy ?? resolveDefaultWorkspacePublishPolicy(task),
    gitAuthPreference: patch.gitAuthPreference ?? session.gitAuthPreference ?? 'project-default',
    executorNodeId: patch.executorNodeId ?? session.executorNodeId,
    agentType,
    customAgentId: patch.customAgentId ?? session.customAgentId,
    customAgentName: patch.customAgentName ?? session.customAgentName,
    agentInvocationMode: patch.agentInvocationMode ?? session.agentInvocationMode,
    mountedSkillNames: resolveStringArrayPatch({ value: patch.mountedSkillNames }, session.mountedSkillNames),
    mountedMcpServerNames: resolveStringArrayPatch({ value: patch.mountedMcpServerNames }, session.mountedMcpServerNames),
    enabledMcpServerIds: resolveOptionalStringArrayPatch({ value: patch.enabledMcpServerIds }, session.enabledMcpServerIds),
    delegatedPrompt: hasPatchValue(patch, 'delegatedPrompt') ? patch.delegatedPrompt : session.delegatedPrompt,
    distributedTaskId: hasPatchValue(patch, 'distributedTaskId') ? patch.distributedTaskId : session.distributedTaskId,
    agentSessionId: hasAgentSessionPatch
      ? patch.agentSessionId ?? (hasOpencodeSessionPatch ? patch.opencodeSessionId : undefined)
      : hasOpencodeSessionPatch
        ? patch.opencodeSessionId
        : session.agentSessionId ?? session.opencodeSessionId,
    opencodeSessionId: hasOpencodeSessionPatch
      ? patch.opencodeSessionId ?? (hasAgentSessionPatch ? patch.agentSessionId : undefined)
      : hasAgentSessionPatch
        ? patch.agentSessionId
        : session.opencodeSessionId ?? session.agentSessionId,
    runtimeContinuations: hasPatchValue(patch, 'runtimeContinuations')
      ? cloneRuntimeContinuations(patch.runtimeContinuations)
      : cloneRuntimeContinuations(session.runtimeContinuations),
    handoffSnapshot: hasPatchValue(patch, 'handoffSnapshot')
      ? cloneHandoffSnapshot(patch.handoffSnapshot)
      : cloneHandoffSnapshot(session.handoffSnapshot),
    agentSettings: patch.agentSettings ?? session.agentSettings,
    baseBranch: hasPatchValue(patch, 'baseBranch') ? patch.baseBranch : (session.baseBranch ?? task?.baseBranch),
    worktreeId: patch.worktreeId ?? session.worktreeId,
    worktreeUniqueId: patch.worktreeUniqueId ?? session.worktreeUniqueId,
    branchName: hasPatchValue(patch, 'branchName')
      ? patch.branchName ?? session.branchName
      : resolveWorkspaceSessionBranchName({
          task: {
            title: task?.title ?? session.title,
            baseBranch: hasPatchValue(patch, 'baseBranch') ? patch.baseBranch : (session.baseBranch ?? task?.baseBranch),
            baseBranchHint: task?.baseBranchHint,
          },
          worktreeId: patch.worktreeId ?? session.worktreeId,
          workingDirectoryMode: patch.workingDirectoryMode ?? session.workingDirectoryMode,
          currentBranchName: session.branchName,
        }),
    worktreeStatus: patch.worktreeStatus ?? session.worktreeStatus,
    workingDirectoryMode: patch.workingDirectoryMode ?? session.workingDirectoryMode,
    needsHumanConfirm: patch.needsHumanConfirm ?? session.needsHumanConfirm,
    agentRunningStatus: patch.agentRunningStatus ?? session.agentRunningStatus,
    runtimeStatus: patch.runtimeStatus ?? session.runtimeStatus,
    runtimeSessionId: hasPatchValue(patch, 'runtimeSessionId') ? patch.runtimeSessionId : session.runtimeSessionId,
    runtimeOwnerExecutorId: hasPatchValue(patch, 'runtimeOwnerExecutorId') ? patch.runtimeOwnerExecutorId : session.runtimeOwnerExecutorId,
    runtimeStartedAt: hasPatchValue(patch, 'runtimeStartedAt') ? patch.runtimeStartedAt : session.runtimeStartedAt,
    lastHeartbeatAt: hasPatchValue(patch, 'lastHeartbeatAt') ? patch.lastHeartbeatAt : session.lastHeartbeatAt,
    lastRuntimeEventAt: hasPatchValue(patch, 'lastRuntimeEventAt') ? patch.lastRuntimeEventAt : session.lastRuntimeEventAt,
    terminalReason: hasPatchValue(patch, 'terminalReason') ? patch.terminalReason : session.terminalReason,
    runtimeSummary: hasPatchValue(patch, 'runtimeSummary') ? patch.runtimeSummary : session.runtimeSummary,
    runtimeSequence: patch.runtimeSequence ?? session.runtimeSequence,
    currentStep: patch.currentStep ?? session.currentStep,
    deliverySummary: hasPatchValue(patch, 'deliverySummary') ? patch.deliverySummary : session.deliverySummary,
    historyProjection: hasPatchValue(patch, 'historyProjection') ? patch.historyProjection : session.historyProjection,
    lastActiveAt: patch.lastActiveAt ?? session.lastActiveAt ?? session.createdAt,
    updatedAt: patch.updatedAt ?? session.updatedAt ?? session.lastActiveAt ?? session.createdAt,
  }
}

export const rebindWorkspaceSessionToExecutor = (
  task: Task,
  session: WorkspaceSession,
  params: {
    executorNodeId: string
    currentStep?: string
    updatedAt?: string
    worktreeUniqueId?: number
  },
) => {
  const updatedAt = params.updatedAt ?? new Date().toISOString()

  return mergeWorkspaceSession(task, session, {
    executorNodeId: params.executorNodeId,
    runtimeOwnerExecutorId: params.executorNodeId,
    worktreeUniqueId: params.worktreeUniqueId ?? session.worktreeUniqueId,
    worktreeStatus: 'planned',
    distributedTaskId: undefined,
    agentSessionId: undefined,
    opencodeSessionId: undefined,
    runtimeContinuations: [],
    runtimeSessionId: undefined,
    runtimeStartedAt: undefined,
    lastHeartbeatAt: undefined,
    lastRuntimeEventAt: undefined,
    terminalReason: undefined,
    agentRunningStatus: 'idle',
    runtimeStatus: 'idle',
    needsHumanConfirm: false,
    currentStep: params.currentStep ?? '',
    updatedAt,
    lastActiveAt: updatedAt,
  })
}

export const stripWorkspaceExecutionFieldsFromTask = (baseTask: Task, scopedTask: WorkspaceTaskExecutionView | Task): Task => {
  const {
    agentSettings: _agentSettings,
    enabledMcpServerIds: _enabledMcpServerIds,
    runtimeStatus: _runtimeStatus,
    ...taskFields
  } = scopedTask as WorkspaceTaskExecutionView

  return {
    ...taskFields,
    agentType: baseTask.agentType,
    executionModel: baseTask.executionModel,
    opencodeConfig: baseTask.opencodeConfig,
    gitIdentityMode: baseTask.gitIdentityMode,
    baseBranch: baseTask.baseBranch,
    needsHumanConfirm: scopedTask.needsHumanConfirm,
    agentRunningStatus: scopedTask.agentRunningStatus,
    currentStep: scopedTask.currentStep,
    toolCalls: baseTask.toolCalls,
    logs: scopedTask.logs,
  }
}

export const syncWorkspaceSessionFromTaskExecutionView = (baseTask: Task, session: WorkspaceSession, scopedTask: WorkspaceTaskExecutionView | Task): WorkspaceSession => {
  const scopedUpdatedAt = scopedTask.updatedAt?.trim()
  const baseUpdatedAt = baseTask.updatedAt?.trim()
  const hasWorkspaceSessionActivityUpdate = Boolean(scopedUpdatedAt && scopedUpdatedAt !== baseUpdatedAt)

  return mergeWorkspaceSession(baseTask, session, {
    executionModel: scopedTask.executionModel,
    agentType: scopedTask.agentType,
    agentSettings: 'agentSettings' in scopedTask ? scopedTask.agentSettings : session.agentSettings,
    enabledMcpServerIds: 'enabledMcpServerIds' in scopedTask ? scopedTask.enabledMcpServerIds : session.enabledMcpServerIds,
    opencodeConfig: scopedTask.opencodeConfig,
    baseBranch: scopedTask.baseBranch,
    needsHumanConfirm: scopedTask.needsHumanConfirm,
    agentRunningStatus: scopedTask.agentRunningStatus,
    runtimeStatus: 'runtimeStatus' in scopedTask
      ? scopedTask.runtimeStatus
      : resolveWorkspaceSessionRuntimeStatusFromAgentStatus(scopedTask.agentRunningStatus, session.runtimeStatus),
    currentStep: scopedTask.currentStep,
    ...(hasWorkspaceSessionActivityUpdate
      ? {
          updatedAt: scopedTask.updatedAt,
          lastActiveAt: scopedTask.updatedAt,
        }
      : {}),
  })
}
