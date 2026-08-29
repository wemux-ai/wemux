// [INPUT]: Projects, workspaces, Task↔Workspace bindings, workspace sessions, and UI selection state.
// [OUTPUT]: Derived workspace rows, route targets, summaries, and task-binding presentation data.
// [POS]: /workspaces derivation boundary; session records never establish task relationships.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { sortProjectsByDisplayOrder, sortWorkspacesByDisplayOrder } from '@shared/project-workspace-order'
import { resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId, sortWorkspaceSessions } from '@shared/task-workspace'
import type { AgentRunningStatus, CreatorIdentity, ExecutorRecord, Project, Task, TaskWorkspaceBinding, WorkspacePresenceUser, WorkspacePreviewSummary, WorkspaceSession, Workspace, WorkspaceSessionRuntimeStatus } from '@shared/types'
import {
  resolveWorkspacePrimaryView,
  type WorkspacePrimaryView,
  type WorkspaceRouteSearch,
} from '../../routes/-workspace-route-shared'
import {
  getWorkspaceSessionUnreadTone,
  type WorkspaceSessionUnreadOptions,
} from '../../lib/workspace-session-attention'
import { shouldShowWorkspaceInUserLists } from '../../lib/workspace-visibility'
import { isExecutorEffectivelyOnline } from '../../lib/managed-cloud-executor'
import { replaceEqualDeep } from '../../lib/app-entity-store'
import { resolveWorkspaceSessionDisplaySummary } from './workspace-session-display-summary'
import {
  getWorkspaceSessionDisplayStatus,
  type WorkspaceSessionDisplayStatus,
} from './workspace-session-status'

export type WorkspaceListSessionPreview = {
  id: string
  title: string
  taskId?: string
  tone: 'selected' | 'running' | 'queued' | 'unread' | 'error' | 'idle'
  badgeLabel?: string
  agentType?: WorkspaceSession['agentType']
  agentRunningStatus?: AgentRunningStatus
  runtimeStatus?: WorkspaceSessionRuntimeStatus
  needsHumanConfirm?: boolean
  currentStep?: string
}

export type WorkspaceListItem = {
  workspace: Workspace
  project: Project
  creatorProfile?: {
    id?: string
    type?: CreatorIdentity['type']
    name: string
    avatarUrl?: string
  }
  activePresenceUsers: WorkspacePresenceUser[]
  recentActivityAt: string
  linkedTasks: Task[]
  activeTask: Task | null
  sessionCount: number
  currentSessionTitle?: string
  sessionPreviews: WorkspaceListSessionPreview[]
  runningCount: number
  unreadCount: number
  errorCount: number
  runningTargetWorkspaceSessionId?: string
  runningTargetTaskId?: string
  unreadTargetWorkspaceSessionId?: string
  unreadTargetTaskId?: string
  errorTargetWorkspaceSessionId?: string
  errorTargetTaskId?: string
  baseBranch: string
  worktreeBranchName?: string
  worktreeLabel: string
  worktreeStatusLabel: string
  summaryText?: string
  summaryBadgeLabel?: string
  summaryKind?: 'history' | 'lineage'
  currentExecutorDisplayName?: string
  currentExecutorId?: string
  currentExecutorStatusTone?: 'online' | 'busy' | 'offline' | 'neutral'
  previewSummary?: WorkspacePreviewSummary
}

/**
 * 按 workspace.id 对重算后的列表行做引用级 reconciliation：内容未变的行复用上次引用，
 * 避免每次 session 状态变化都重建所有卡片对象（与 AppEntityStore 的 replaceEqualDeep 同源）。
 */
export const reconcileWorkspaceItems = (
  previousItems: WorkspaceListItem[],
  nextItems: WorkspaceListItem[],
): WorkspaceListItem[] => {
  const previousById = new Map(previousItems.map((item) => [item.workspace.id, item] as const))
  const reconciled = nextItems.map((item) => replaceEqualDeep(previousById.get(item.workspace.id), item))

  if (
    reconciled.length === previousItems.length
    && reconciled.every((item, index) => Object.is(item, previousItems[index]))
  ) {
    return previousItems
  }

  return reconciled
}

export function resolveWorkspaceListItemDisplayStatus(
  item: WorkspaceListItem,
): WorkspaceSessionDisplayStatus {
  const sessionTones = item.sessionPreviews.map((session) => session.tone)

  if (sessionTones.includes('error') || item.errorCount > 0) {
    return 'error'
  }
  if (sessionTones.includes('running') || item.runningCount > 0) {
    return 'running'
  }
  if (sessionTones.includes('unread') || item.unreadCount > 0) {
    return 'attention'
  }
  if (sessionTones.includes('queued')) {
    return 'queued'
  }

  return 'idle'
}

export type WorkspaceListItemDefaultSessionTarget = {
  workspaceId: string
  workspaceSessionId: string
  taskId?: string
}

export const DEFAULT_BRANCH_FALLBACK = 'main'

type WorkspaceListUnreadOptions = WorkspaceSessionUnreadOptions & {
  executors?: Pick<ExecutorRecord, 'executorId' | 'name' | 'status'>[]
  selectedWorkspaceSessionId?: string
}

type ResolveWorkspaceListSelectionParams = {
  filteredWorkspaceIds: string[]
  loading: boolean
  routeWorkspaceId?: string
  selectedWorkspaceId: string
}

type WorkspaceListSelectionResolution = {
  nextWorkspaceId: string
  shouldUpdateRoute: boolean
}

type WorkspaceTerminalCollapsedByWorkspaceId = Record<string, boolean>
type WorkspacePrimaryViewByWorkspaceId = Record<string, WorkspacePrimaryView>
export type WorkspacesPageMobileView = 'list' | 'detail' | 'create'

export const text = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

export const resolveWorkspacesPageMobileView = (params: {
  create?: string
  panelMode: 'detail' | 'create'
  routeWorkspaceId?: string
  searchMobileView?: string
}): WorkspacesPageMobileView => {
  if (params.create === '1' || params.panelMode === 'create') {
    return 'create'
  }

  if (params.searchMobileView === 'detail' || params.routeWorkspaceId?.trim()) {
    return 'detail'
  }

  return 'list'
}

export const shouldReplaceWorkspacesDetailHistoryEntry = (params: {
  isMobile: boolean
  nextMobileView?: WorkspacesPageMobileView
}) => {
  if (!params.isMobile) {
    return true
  }

  return params.nextMobileView !== 'detail'
}

export const resolveWorkspaceDirectorySelectionLoading = (params: {
  fetching: boolean
  loading: boolean
  routeWorkspaceId?: string
}) => {
  return params.loading || (Boolean(params.routeWorkspaceId?.trim()) && params.fetching)
}

export const resolveWorkspaceTerminalCollapsed = (
  workspaceId: string | undefined,
  terminalCollapsedByWorkspaceId: WorkspaceTerminalCollapsedByWorkspaceId,
  fallbackCollapsed = true,
) => {
  if (!workspaceId) {
    return fallbackCollapsed
  }

  return terminalCollapsedByWorkspaceId[workspaceId] ?? fallbackCollapsed
}

export const resolveWorkspacePrimaryViewForWorkspace = (
  workspaceId: string | undefined,
  primaryViewByWorkspaceId: WorkspacePrimaryViewByWorkspaceId,
  fallbackView: WorkspacePrimaryView = 'chat',
) => {
  if (!workspaceId) {
    return fallbackView
  }

  return primaryViewByWorkspaceId[workspaceId] ?? fallbackView
}

export const buildWorkspaceTerminalSearchPatch = (params: {
  workspaceId: string | undefined
  terminalCollapsedByWorkspaceId: WorkspaceTerminalCollapsedByWorkspaceId
}): Pick<WorkspaceRouteSearch, 'terminal'> => ({
  terminal: resolveWorkspaceTerminalCollapsed(params.workspaceId, params.terminalCollapsedByWorkspaceId)
    ? undefined
    : '1',
})

export const buildWorkspacePrimaryViewSearchPatch = (params: {
  workspaceId: string | undefined
  primaryViewByWorkspaceId: WorkspacePrimaryViewByWorkspaceId
}): Pick<WorkspaceRouteSearch, 'panel'> => {
  const currentPrimaryView = resolveWorkspacePrimaryViewForWorkspace(
    params.workspaceId,
    params.primaryViewByWorkspaceId,
  )

  return {
    panel: currentPrimaryView === 'chat' ? undefined : currentPrimaryView,
  }
}

export const resolveCurrentWorkspaceTerminalCollapsed = (params: {
  selectedWorkspaceId?: string
  routeWorkspaceId?: string
  routeTerminal?: WorkspaceRouteSearch['terminal']
  terminalCollapsedByWorkspaceId: WorkspaceTerminalCollapsedByWorkspaceId
  fallbackCollapsed?: boolean
}) => {
  const currentWorkspaceId = params.selectedWorkspaceId || params.routeWorkspaceId
  const defaultCollapsed = params.fallbackCollapsed ?? true
  if (!currentWorkspaceId) {
    return defaultCollapsed
  }

  const routeOwnsCurrentWorkspace = !params.routeWorkspaceId || params.routeWorkspaceId === currentWorkspaceId
  const fallbackCollapsed = routeOwnsCurrentWorkspace
    ? params.routeTerminal !== '1'
    : defaultCollapsed

  return resolveWorkspaceTerminalCollapsed(
    currentWorkspaceId,
    params.terminalCollapsedByWorkspaceId,
    fallbackCollapsed,
  )
}

export const resolveCurrentWorkspacePrimaryView = (params: {
  selectedWorkspaceId?: string
  routeWorkspaceId?: string
  routePanel?: WorkspaceRouteSearch['panel']
  primaryViewByWorkspaceId: WorkspacePrimaryViewByWorkspaceId
  fallbackView?: WorkspacePrimaryView
}) => {
  const currentWorkspaceId = params.selectedWorkspaceId || params.routeWorkspaceId
  const defaultView = params.fallbackView ?? 'chat'
  if (!currentWorkspaceId) {
    return defaultView
  }

  const routeOwnsCurrentWorkspace = !params.routeWorkspaceId || params.routeWorkspaceId === currentWorkspaceId
  const fallbackView = routeOwnsCurrentWorkspace
    ? resolveWorkspacePrimaryView(params.routePanel)
    : defaultView

  return resolveWorkspacePrimaryViewForWorkspace(
    currentWorkspaceId,
    params.primaryViewByWorkspaceId,
    fallbackView,
  )
}

export const resolveWorkspaceRouteWorkspaceId = (params: {
  routeWorkspaceId?: string
  routeWorkspaceSessionId?: string
  routeTaskId?: string
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  workspaceSessions: WorkspaceSession[]
}) => {
  const normalizedRouteWorkspaceId = params.routeWorkspaceId?.trim() || ''
  if (normalizedRouteWorkspaceId) {
    return normalizedRouteWorkspaceId
  }

  const normalizedRouteWorkspaceSessionId = params.routeWorkspaceSessionId?.trim() || ''
  if (normalizedRouteWorkspaceSessionId) {
    const matchedWorkspaceSession = params.workspaceSessions.find((session) => session.id === normalizedRouteWorkspaceSessionId)
    const matchedWorkspaceId = matchedWorkspaceSession?.workspaceId?.trim() || ''
    if (matchedWorkspaceId) {
      return matchedWorkspaceId
    }
  }

  const normalizedRouteTaskId = params.routeTaskId?.trim() || ''
  if (!normalizedRouteTaskId) {
    return ''
  }

  const matchedBinding = params.taskWorkspaceBindings.find((binding) => (
    binding.status === 'active'
    && binding.taskId === normalizedRouteTaskId
  ))

  return matchedBinding?.workspaceId?.trim() || ''
}

export const resolveWorkspaceListItemDefaultSessionTarget = (
  item: WorkspaceListItem,
): WorkspaceListItemDefaultSessionTarget | null => {
  const sessionPreview = item.sessionPreviews[0]
  if (!sessionPreview) {
    return null
  }

  return {
    workspaceId: item.workspace.id,
    workspaceSessionId: sessionPreview.id,
    taskId: sessionPreview.taskId || item.activeTask?.id,
  }
}

const resolveWorkspaceSessionTask = (params: {
  session: WorkspaceSession
  taskById: Map<string, Task>
  activeBindingsByWorkspaceId: Map<string, TaskWorkspaceBinding[]>
}) => {
  const binding = params.activeBindingsByWorkspaceId.get(params.session.workspaceId)?.[0]

  if (!binding) {
    return null
  }

  return params.taskById.get(binding.taskId) ?? null
}

const getWorktreeStatusLabel = (status: WorkspaceSession['worktreeStatus'], language: string) => {
  if (status === 'created') return text(language, '已创建', 'Created')
  if (status === 'cleaned') return text(language, '已清理', 'Cleaned')
  return text(language, '待创建', 'Pending')
}

const resolveWorkspaceListSummary = (params: {
  workspaceSessions: WorkspaceSession[]
  preferredWorkspaceSessionId?: string
}) => {
  const preferredWorkspaceSessionId = params.preferredWorkspaceSessionId?.trim() || ''
  if (preferredWorkspaceSessionId) {
    const preferredSession = params.workspaceSessions.find((session) => session.id === preferredWorkspaceSessionId)
    if (preferredSession) {
      const preferredSummary = resolveWorkspaceSessionDisplaySummary(preferredSession, params.workspaceSessions)
      if (preferredSummary) {
        return preferredSummary
      }
    }
  }

  const sessionsByRecentPersistedHistory = [...params.workspaceSessions].sort((left, right) => {
    const rightHistoryAt = right.historyProjection?.lastEventAt?.trim() || ''
    const leftHistoryAt = left.historyProjection?.lastEventAt?.trim() || ''
    if (rightHistoryAt !== leftHistoryAt) {
      return rightHistoryAt.localeCompare(leftHistoryAt)
    }

    return right.lastActiveAt.localeCompare(left.lastActiveAt)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id)
  })

  for (const session of sessionsByRecentPersistedHistory) {
    const summary = resolveWorkspaceSessionDisplaySummary(session, params.workspaceSessions)
    if (!summary) {
      continue
    }

    return summary
  }

  return null
}

const appendToListMap = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
    return
  }

  map.set(key, [value])
}

const getWorkspaceListRecentActivityAt = (params: {
  workspace: Workspace
  workspaceSessions: WorkspaceSession[]
  linkedTasks: Task[]
}) => {
  const candidates = [
    params.workspace.updatedAt,
    params.workspace.createdAt,
    ...params.workspaceSessions.flatMap((session) => [
      session.historyProjection?.lastEventAt,
      session.lastActiveAt,
      session.updatedAt,
      session.createdAt,
    ]),
    ...params.linkedTasks.flatMap((task) => [
      task.updatedAt,
      task.createdAt,
      task.result?.completedAt,
    ]),
  ]
    .map((value) => value?.trim() || '')
    .filter(Boolean)

  return candidates.sort((left, right) => right.localeCompare(left))[0] || ''
}

export const resolveBranchSelectionState = (params: {
  branches: string[]
  currentBranch?: string
  defaultBranch?: string
  fallbackBranch?: string
  language?: string
  message?: string
}) => {
  const language = params.language ?? 'zh'
  const normalizedDefaultBranch = params.defaultBranch?.trim()
    || params.fallbackBranch?.trim()
    || DEFAULT_BRANCH_FALLBACK
  const branchOptions = params.branches.length > 0
    ? params.branches
    : [normalizedDefaultBranch]
  const selectedBranch = params.currentBranch?.trim() && branchOptions.includes(params.currentBranch.trim())
    ? params.currentBranch.trim()
    : branchOptions.includes(normalizedDefaultBranch)
      ? normalizedDefaultBranch
      : branchOptions[0] || ''
  const fallbackMessage = params.branches.length === 0
    ? text(language, `暂时无法读取远端分支，先按默认分支 ${normalizedDefaultBranch} 继续；稍后准备工作区时会自动 clone。`, `Remote branches are unavailable for now, so ${normalizedDefaultBranch} is used as the default; the workspace will clone automatically during preparation.`)
    : ''

  return {
    branchOptions,
    defaultBranch: normalizedDefaultBranch,
    selectedBranch,
    branchMessage: params.message?.trim() || fallbackMessage,
  }
}

export function buildWorkspaceItems(
  projects: Project[],
  workspacesByProject: Record<string, Workspace[]>,
  tasks: Task[],
  bindings: TaskWorkspaceBinding[],
  sessions: WorkspaceSession[],
  language: string,
  unreadOptions: WorkspaceListUnreadOptions = {},
  presenceByWorkspaceId: Record<string, WorkspacePresenceUser[]> = {},
  previewByWorkspaceId: Record<string, WorkspacePreviewSummary> = {},
): WorkspaceListItem[] {
  const executorNameById = new Map(
    (unreadOptions.executors ?? []).map((executor) => [executor.executorId, executor.name] as const),
  )
  const activeBindings = bindings.filter((binding) => binding.status === 'active')
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const tasksByProjectId = new Map<string, Task[]>()
  const activeBindingsByWorkspaceId = new Map<string, TaskWorkspaceBinding[]>()
  const activeTaskIdsByWorkspaceId = new Map<string, Set<string>>()
  const sessionsByWorkspaceId = new Map<string, WorkspaceSession[]>()

  for (const task of tasks) {
    appendToListMap(tasksByProjectId, task.projectId, task)
  }

  for (const projectTasks of tasksByProjectId.values()) {
    projectTasks.sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    )
  }

  for (const binding of activeBindings) {
    appendToListMap(activeBindingsByWorkspaceId, binding.workspaceId, binding)
    const linkedTaskIds = activeTaskIdsByWorkspaceId.get(binding.workspaceId)
    if (linkedTaskIds) {
      linkedTaskIds.add(binding.taskId)
      continue
    }

    activeTaskIdsByWorkspaceId.set(binding.workspaceId, new Set([binding.taskId]))
  }

  for (const session of sessions) {
    appendToListMap(sessionsByWorkspaceId, session.workspaceId, session)
  }

  return sortProjectsByDisplayOrder(projects)
    .flatMap((project) => {
      const projectWorkspaces = sortWorkspacesByDisplayOrder(workspacesByProject[project.id] ?? [])
      const projectTasks = tasksByProjectId.get(project.id) ?? []

      return projectWorkspaces.flatMap((workspace) => {
        const workspaceSessions = sessionsByWorkspaceId.get(workspace.id) ?? []
        const orderedWorkspaceSessions = sortWorkspaceSessions(workspaceSessions)
        const activeWorkspaceSessions: WorkspaceSession[] = []
        const runningWorkspaceSessions: WorkspaceSession[] = []
        const unreadWorkspaceSessions: WorkspaceSession[] = []
        const unreadErrorWorkspaceSessions: WorkspaceSession[] = []

        for (const session of orderedWorkspaceSessions) {
          if (session.status !== 'active') {
            continue
          }

          activeWorkspaceSessions.push(session)
          const displayStatus = getWorkspaceSessionDisplayStatus(session)
          if (displayStatus === 'running') {
            runningWorkspaceSessions.push(session)
          }

          const unreadTone = getWorkspaceSessionUnreadTone(session, unreadOptions)
          if (unreadTone === 'error') {
            unreadErrorWorkspaceSessions.push(session)
          } else if (unreadTone) {
            unreadWorkspaceSessions.push(session)
          }
        }

        const activeTaskIds = activeTaskIdsByWorkspaceId.get(workspace.id)
        const linkedTaskIds = new Set(activeTaskIds ?? [])
        const linkedTasks = projectTasks.filter((task) => linkedTaskIds.has(task.id))
        const activeTask = projectTasks.find((task) => activeTaskIds?.has(task.id)) ?? linkedTasks[0] ?? null
        const activeSession = orderedWorkspaceSessions[0] ?? null
        const runningTargetTask = runningWorkspaceSessions[0]
          ? resolveWorkspaceSessionTask({
            session: runningWorkspaceSessions[0],
            taskById,
            activeBindingsByWorkspaceId,
          })
          : null
        const unreadTargetTask = unreadWorkspaceSessions[0]
          ? resolveWorkspaceSessionTask({
            session: unreadWorkspaceSessions[0],
            taskById,
            activeBindingsByWorkspaceId,
          })
          : null
        const errorTargetTask = unreadErrorWorkspaceSessions[0]
          ? resolveWorkspaceSessionTask({
            session: unreadErrorWorkspaceSessions[0],
            taskById,
            activeBindingsByWorkspaceId,
          })
          : null

        const sessionCount = orderedWorkspaceSessions.length
        const hasExistingActivity = linkedTasks.length > 0 || sessionCount > 0
        if (!shouldShowWorkspaceInUserLists(workspace, hasExistingActivity)) {
          return []
        }
        const recentActivityAt = getWorkspaceListRecentActivityAt({
          workspace,
          workspaceSessions: orderedWorkspaceSessions,
          linkedTasks,
        })

        const selectedSession = unreadOptions.selectedWorkspaceSessionId
          ? activeWorkspaceSessions.find((session) => session.id === unreadOptions.selectedWorkspaceSessionId)
          : undefined
        const representativeSession = selectedSession ?? activeSession
        const workspaceSummary = resolveWorkspaceListSummary({
          workspaceSessions: orderedWorkspaceSessions,
          preferredWorkspaceSessionId: representativeSession?.id,
        })
        const currentExecutorId = resolveWorkspaceSessionExecutorId(representativeSession) || resolveWorkspaceWorkerId(workspace)
        const currentExecutorDisplayName = currentExecutorId
          ? executorNameById.get(currentExecutorId)
            || (workspace.executorNodeId === currentExecutorId ? workspace.executorName : undefined)
            || currentExecutorId
          : workspace.executorName
        const currentExecutorRecord = currentExecutorId
          ? unreadOptions.executors?.find((executor) => executor.executorId === currentExecutorId)
          : undefined
        const currentExecutorStatusTone: WorkspaceListItem['currentExecutorStatusTone'] = isExecutorEffectivelyOnline(currentExecutorRecord)
          ? 'online'
          : currentExecutorRecord?.status === 'paired'
            ? 'busy'
            : currentExecutorRecord?.status === 'offline' || currentExecutorRecord?.status === 'disabled'
              ? 'offline'
              : currentExecutorDisplayName
                ? 'neutral'
                : undefined
        const sessionPreviewCandidates = selectedSession
          ? [selectedSession, ...activeWorkspaceSessions.filter((session) => session.id !== selectedSession.id)]
          : activeWorkspaceSessions
        const sessionPreviews = sessionPreviewCandidates.map((session): WorkspaceListSessionPreview => {
          const displayStatus = getWorkspaceSessionDisplayStatus(session)
          const unreadTone = getWorkspaceSessionUnreadTone(session, unreadOptions)
          const sessionTask = resolveWorkspaceSessionTask({
            session,
            taskById,
            activeBindingsByWorkspaceId,
          })
          const selected = session.id === unreadOptions.selectedWorkspaceSessionId
          const tone: WorkspaceListSessionPreview['tone'] = selected
            ? 'selected'
            : displayStatus === 'running'
              ? 'running'
              : displayStatus === 'queued'
                ? 'queued'
                : unreadTone === 'error'
                  ? 'error'
                  : unreadTone
                    ? 'unread'
                    : 'idle'
          const badgeLabel = displayStatus === 'running'
            ? text(language, '运行中', 'Running')
            : displayStatus === 'queued'
              ? text(language, '排队', 'Queued')
              : unreadTone === 'error'
                ? text(language, '异常', 'Error')
                : unreadTone
                  ? text(language, '未读', 'Unread')
                  : undefined

          return {
            id: session.id,
            title: session.title,
            taskId: sessionTask?.id,
            tone,
            badgeLabel,
            agentType: session.agentType,
            agentRunningStatus: session.agentRunningStatus,
            runtimeStatus: session.runtimeStatus,
            needsHumanConfirm: session.needsHumanConfirm,
            currentStep: session.currentStep?.trim() || undefined,
          }
        })

        const isOriginalDirectory = representativeSession?.workingDirectoryMode === 'original-dir'
          || (!representativeSession && workspace.workingDirectoryMode === 'original-dir')
        return [{
          workspace,
          project,
          creatorProfile: workspace.createdBy
            ? {
                id: workspace.createdBy.id,
                type: workspace.createdBy.type,
                name: workspace.createdBy.name,
                avatarUrl: workspace.createdBy.avatarUrl,
              }
            : workspace.ownerUserId || workspace.ownerUserName || workspace.ownerAvatarUrl
              ? {
                  id: workspace.ownerUserId,
                  type: 'user' as const,
                  name: workspace.ownerUserName?.trim() || workspace.ownerUserId || text(language, '未知用户', 'Unknown user'),
                  avatarUrl: workspace.ownerAvatarUrl,
                }
              : undefined,
          activePresenceUsers: presenceByWorkspaceId[workspace.id] ?? [],
          recentActivityAt,
          linkedTasks,
          activeTask,
          sessionCount,
          currentSessionTitle: representativeSession?.title?.trim() || undefined,
          sessionPreviews,
          runningCount: runningWorkspaceSessions.length,
          unreadCount: unreadWorkspaceSessions.length,
          errorCount: unreadErrorWorkspaceSessions.length,
          runningTargetWorkspaceSessionId: runningWorkspaceSessions[0]?.id,
          runningTargetTaskId: runningTargetTask?.id,
          unreadTargetWorkspaceSessionId: unreadWorkspaceSessions[0]?.id,
          unreadTargetTaskId: unreadTargetTask?.id,
          errorTargetWorkspaceSessionId: unreadErrorWorkspaceSessions[0]?.id,
          errorTargetTaskId: errorTargetTask?.id,
          baseBranch:
            representativeSession?.baseBranch
            || activeTask?.baseBranch
            || workspace.suggestedBaseBranch
            || workspace.defaultBranch
            || text(language, '未设置', 'Not set'),
          worktreeBranchName: representativeSession?.branchName || undefined,
          worktreeLabel: isOriginalDirectory
            ? text(language, '原始目录', 'Original directory')
            : representativeSession?.branchName || representativeSession?.worktreeId || text(language, '待准备目录', 'Pending directory'),
          worktreeStatusLabel: representativeSession
            ? getWorktreeStatusLabel(representativeSession.worktreeStatus, language)
            : isOriginalDirectory ? text(language, '复用', 'Reuse') : text(language, '待创建', 'Pending'),
          summaryText: workspaceSummary?.text,
          summaryBadgeLabel: workspaceSummary?.badgeLabel,
          summaryKind: workspaceSummary?.kind,
          currentExecutorDisplayName,
          currentExecutorId: currentExecutorId || undefined,
          currentExecutorStatusTone,
          previewSummary: previewByWorkspaceId[workspace.id],
        }]
      })
    })
    .sort(
      (left, right) =>
        right.recentActivityAt.localeCompare(left.recentActivityAt)
        || new Date(right.workspace.updatedAt).getTime() - new Date(left.workspace.updatedAt).getTime(),
    )
}

export function filterWorkspaceItems(
  items: WorkspaceListItem[],
  searchQuery: string,
  options: {
    includeArchived?: boolean
  } = {},
): WorkspaceListItem[] {
  const normalizedQuery = searchQuery.trim().toLowerCase()

  return items.filter(({ workspace, project, linkedTasks, activeTask, baseBranch, worktreeLabel, worktreeStatusLabel, summaryText, summaryBadgeLabel, currentExecutorDisplayName, currentExecutorId }) => {
    if (!options.includeArchived && workspace.status === 'archived') {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    return [
      workspace.name,
      workspace.executorName,
      currentExecutorDisplayName,
      currentExecutorId,
      workspace.repoPath,
      project.name,
      activeTask?.title,
      ...linkedTasks.map((task) => task.title),
      baseBranch,
      worktreeLabel,
      worktreeStatusLabel,
      summaryText,
      summaryBadgeLabel,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  })
}

export function resolveWorkspaceListSelection({
  filteredWorkspaceIds,
  loading,
  routeWorkspaceId,
  selectedWorkspaceId,
}: ResolveWorkspaceListSelectionParams): WorkspaceListSelectionResolution {
  const normalizedRouteWorkspaceId = routeWorkspaceId || ''

  if (loading) {
    return {
      nextWorkspaceId: normalizedRouteWorkspaceId || selectedWorkspaceId,
      shouldUpdateRoute: false,
    }
  }

  if (normalizedRouteWorkspaceId && filteredWorkspaceIds.includes(normalizedRouteWorkspaceId)) {
    return {
      nextWorkspaceId: normalizedRouteWorkspaceId,
      shouldUpdateRoute: false,
    }
  }

  if (selectedWorkspaceId && filteredWorkspaceIds.includes(selectedWorkspaceId)) {
    return {
      nextWorkspaceId: selectedWorkspaceId,
      shouldUpdateRoute: false,
    }
  }

  const nextWorkspaceId = filteredWorkspaceIds[0] || ''

  return {
    nextWorkspaceId,
    shouldUpdateRoute: normalizedRouteWorkspaceId !== nextWorkspaceId,
  }
}
