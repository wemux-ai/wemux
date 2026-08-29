// [INPUT]: Workspace directory state, route search, session state, and workspace actions.
// [OUTPUT]: The taskless /workspaces console layout and workspace-session panels.
// [POS]: Workspaces page controller; legacy task-shaped runtime adapters never enter route or selection state.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { resolveProjectEnvironmentCommandFields, resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import { buildWorkspacePreviewSourceOptions } from '@shared/types'
import { isPlaygroundProjectId } from '@shared/playground-workspace'
import { type WorkspaceOpenTarget } from '@shared/workspace-open-command'
import { resolveWorkspaceAutoCommitEnabled } from '@shared/task-workspace'
import { buildWorkspaceSessionRuntimeTask } from '@shared/workspace-session-runtime-task'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { toast } from 'sonner'
import type {
  ExecutorAgentSessionDetail,
  ExecutorAgentSessionSummary,
  Project,
  Task,
  WorkspaceSession,
  Workspace,
} from '@shared/types'
import { Archive, ArrowLeftRight, Bot, CircleDot, Code2, FolderTree, GitBranch, Globe, Link2, Loader2, Monitor, MoreHorizontal, Pencil, Play, Rocket, Share2, SlidersHorizontal, Square, TerminalSquare, Trash2 } from 'lucide-react'
import type {
  WorkspaceSessionChatDraftPayload,
  WorkspaceSessionChatRevisionAction,
} from './workspace-session-chat'
import { useAppDialog } from '../ui/app-dialog-provider'
import { Button } from '../ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { api } from '../../lib/api'
import { buildWorkspacePageTabId, openPageTab } from '../../lib/page-tabs-store'
import { queryClient } from '../../lib/query-client'
import { useApp } from '../../lib/app-provider'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { buildExecutorOptionsWithManagedCloud, isManagedCloudExecutorRecord } from '../../lib/managed-cloud-executor'
import { buildWorkspaceGitScopeKey, workspaceQueryKeys } from '../../lib/workspace-query-keys'
import { getStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import { useTranslation } from '../../lib/i18n/react'

import { useAutoRefreshTaskPullRequests } from '../../lib/use-auto-refresh-task-pull-requests'
import { useRealtimeActiveView } from '../../lib/realtime/useRealtime'
import { useWorkspaceScopedProjects } from '../../lib/use-workspace-scoped-projects'
import { isLikelyWorkspaceFileLinkHref, resolveWorkspaceFileLinkPath } from '../../lib/workspace-file-link'
import { cn } from '../../lib/utils'
import { isDesktopSandboxDevOnlyEnabled } from '../../lib/runtime-config'
import { openWorkspaceInTarget } from '../../lib/workspace-open-target'
import { getStoredWorkspaceOpenTarget, setStoredWorkspaceOpenTarget } from '../../lib/workspace-open-preferences'
import {
  getWorkspaceSessionAttentionSignature,
  markWorkspaceSessionRead,
} from '../../lib/workspace-session-attention'
import { useWorkspaceSessionUnreadState } from '../../lib/use-workspace-session-unread-state'
import { listWorkspaceSessionsForWorkspace } from '../../lib/workspace-session-scope'
import { useSidebar } from '../ui/sidebar'
import { useDesktopPersistentWorkspaceTerminal, usePersistentWorkspaceTerminalControl, usePersistentWorkspaceTerminalOpenPanelKeys } from './persistent-workspace-terminal'
import { WorkspaceOpenAction } from './workspace-open-action'
import { useWorkspaceSessionShare } from './workspace-session-share-menu'
import type { DeleteWorkspaceOptions } from './delete-workspace-dialog'
import { WorkspacesPageView } from './workspaces-page-view'
import {
  normalizeWorkspacesPageDirectoryCache,
  resolvePreferredWorkspacesPageDirectoryData,
  resolveWorkspacesPageDirectoryLoadOrder,
  resolveWorkspacesPageDirectoryLoading,
  resolveWorkspacesPageDirectoryProjectIdsKey,
  resolveWorkspacesPageDirectoryProjectIds,
  useWorkspacesPageAgentsQuery,
  useWorkspacesPageDirectoryQuery,
  useWorkspacesPageGitHubResourceBindingsQuery,
  useWorkspacesPageRailwayDeploymentsQuery,
  useWorkspacesPageRailwayResourceBindingsQuery,
  useWorkspacesPageReviewPullRequestsQuery,
  workspacesPageQueryKeys,
  type WorkspacesPageDirectoryData,
} from './workspaces-page-queries'
import { useWorkspaceSessionTokenSummary } from './use-workspace-session-token-summary'
import { useWorkspacesSessionActions } from './use-workspaces-session-actions'
import { useWorkspacesLocalSessionBrowser } from './use-workspaces-local-session-browser'
import { useWorkspacesProjectEditDialog } from './use-workspaces-project-edit-dialog'
import { useWorkspacesReorderActions } from './use-workspaces-reorder-actions'
import { useWorkspacesSelectionModel } from './use-workspaces-selection-model'
import { useSelectedWorkspaceRuntime } from './use-selected-workspace-runtime'
import { useWorkspaceEnvironmentTerminalController } from './use-workspace-environment-terminal-controller'
import { useWorkspacesDesktopTerminalRegistration } from './use-workspaces-desktop-terminal-registration'
import { useDesktopSandboxAndRemoteCode } from './use-desktop-sandbox-and-remote-code'
import { useWorkspacesPageSecondaryActions } from './use-workspaces-page-secondary-actions'
import type { WorkspacesTestingState } from './workspaces-testing-controller'
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  rememberWorkspaceTabRoute,
  resolveWorkspaceSessionListPlacement,
  setWorkspacePrimaryView,
  setWorkspaceSessionListPlacement,
  setWorkspaceTerminalCollapsed as setWorkspaceTerminalCollapsedUi,
  setWorkspaceTerminalOpen as setWorkspaceTerminalOpenUi,
  useWorkspacesPageUiStore,
  type WorkspaceSessionListPlacement,
} from './workspaces-page-ui-store'
import {
  buildWorkspacePrimaryViewSearchPatch,
  resolveWorkspacesPageMobileView,
  resolveWorkspaceDirectorySelectionLoading,
  buildWorkspaceTerminalSearchPatch,
  resolveCurrentWorkspacePrimaryView,
  resolveCurrentWorkspaceTerminalCollapsed,
  resolveWorkspaceRouteWorkspaceId,
  resolveWorkspaceTerminalCollapsed,
  shouldReplaceWorkspacesDetailHistoryEntry,
  type WorkspaceListItem,
} from './workspaces-page-utils'
import {
  buildWorkspacesRouteSearch,
  resolveWorkspacePrimaryView,
  type WorkspacePrimaryView,
  type WorkspaceRouteSearch,
} from '../../routes/-workspace-route-shared'
import { useWorkspaceLaunch } from '../../routes/-use-workspace-launch'
import { buildWorkspacePanelUiScopeKey } from './workspace-panel-ui-store'

import {
  areWorkspaceRouteSearchEqual,
  GIT_WORKING_TREE_REFRESH_MS,
} from './workspaces-page-helpers'

const DESKTOP_SANDBOX_ENABLED = isDesktopSandboxDevOnlyEnabled()
const ProjectEditDialog = lazy(() => import('../project-edit-dialog').then((module) => ({ default: module.ProjectEditDialog })))
const DeleteWorkspaceDialog = lazy(() => import('./delete-workspace-dialog').then((module) => ({ default: module.DeleteWorkspaceDialog })))
const WorkspaceSessionChat = lazy(() => import('./workspace-session-chat').then((module) => ({ default: module.WorkspaceSessionChat })))
const WorkspaceDesktopSandboxPanel = lazy(() => import('./workspace-desktop-sandbox-panel').then((module) => ({ default: module.WorkspaceDesktopSandboxPanel })))
const WorkspaceFilesPanel = lazy(() => import('./workspace-files-panel').then((module) => ({ default: module.WorkspaceFilesPanel })))

const WorkspaceGitPanel = lazy(() => import('./workspace-git-panel').then((module) => ({ default: module.WorkspaceGitPanel })))
const WorkspaceLocalSessionPreview = lazy(() => import('./workspace-local-session-preview').then((module) => ({ default: module.WorkspaceLocalSessionPreview })))
const WorkspacePreviewPanel = lazy(() => import('./workspace-preview-panel').then((module) => ({ default: module.WorkspacePreviewPanel })))
const WorkspaceTerminalPanel = lazy(() => import('./workspace-terminal-panel').then((module) => ({ default: module.WorkspaceTerminalPanel })))
const WorkspaceTestRecordPanel = lazy(() => import('./workspace-test-record-panel').then((module) => ({ default: module.WorkspaceTestRecordPanel })))
const WorkspacesTestingController = lazy(() => import('./workspaces-testing-controller').then((module) => ({ default: module.WorkspacesTestingController })))
const WorkspacesCreatePanelController = lazy(() => import('./workspaces-create-panel-controller').then((module) => ({ default: module.WorkspacesCreatePanelController })))

function WorkspacePanelLoading({ label = '正在加载面板...' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[#09090b] text-xs text-zinc-500">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  )
}

const lazyWorkspacePanel = (content: ReactNode, label?: string) => (
  <Suspense fallback={<WorkspacePanelLoading label={label} />}>
    {content}
  </Suspense>
)

type ProjectWorkspacesQueryData = {
  project: unknown
  workspaces: Workspace[]
}

type PendingTestingAction =
  | { type: 'environment'; action: 'start' | 'stop' | 'logs' }
  | { type: 'back-to-parent' }

const resolveDesktopSandboxPanelView = (view: WorkspacePrimaryView): WorkspacePrimaryView => (
  DESKTOP_SANDBOX_ENABLED || view !== 'desktop' ? view : 'chat'
)

const buildWorkspacesPageHref = (search: WorkspaceRouteSearch) => {
  const params = new URLSearchParams()
  const append = (key: keyof WorkspaceRouteSearch) => {
    const value = search[key]
    if (typeof value === 'string' && value) {
      params.set(key, value)
    }
  }

  append('projectId')
  append('workspaceId')
  append('workspaceSessionId')
  append('launchId')
  append('autoEnvironmentInstall')
  append('panel')
  append('terminal')
  append('mobileView')
  append('create')

  const queryString = params.toString()
  return queryString ? `/workspaces?${queryString}` : '/workspaces'
}

export function WorkspacesPage() {
  const { language, t } = useTranslation()
  const { setWorkspaceTerminalOpen } = usePersistentWorkspaceTerminalControl()
  const navigate = useNavigate()
  const search = useSearch({ from: '/workspaces' })
  const { isMobile } = useSidebar()
  const { state, selectedProjectId, setSelectedProjectId, setState, busy, runMutation } = useApp()
  const { confirm } = useAppDialog()
  const pinnedRouteProjectIds = useMemo(
    () => search.projectId ? [search.projectId] : [],
    [search.projectId],
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(search.workspaceId || '')
  const selectedWorkspaceIdRef = useRef(search.workspaceId || '')
  const hasInitialWorkspaceRouteTarget = Boolean(search.workspaceId || search.workspaceSessionId)
  const {
    visibleProjects: workspaceScopedProjects,
    visibleProjectIds,
    workspaceScopeLoading,
  } = useWorkspaceScopedProjects(
    state.projects,
    undefined,
    { pinnedProjectIds: pinnedRouteProjectIds },
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [projectVisibilityFilterIds, setProjectVisibilityFilterIds] = useState<string[] | null>(null)
  const projectEditDialog = useWorkspacesProjectEditDialog({ projects: state.projects, runMutation })
  const [panelMode, setPanelMode] = useState<'detail' | 'create'>(search.create === '1' ? 'create' : 'detail')
  const [mobileView, setMobileView] = useState<'list' | 'detail' | 'create'>(() => (
    resolveWorkspacesPageMobileView({
      create: search.create,
      panelMode: search.create === '1' ? 'create' : 'detail',
      routeWorkspaceId: hasInitialWorkspaceRouteTarget ? 'pending' : '',
      searchMobileView: search.mobileView,
    })
  ))
  const createPanelOpen = panelMode === 'create' || search.create === '1'
  const [selectedWorkspaceSessionId, setSelectedWorkspaceSessionIdState] = useState(search.workspaceSessionId || '')
  const selectedWorkspaceSessionIdRef = useRef(search.workspaceSessionId || '')
  const executorSwitchRequestIdRef = useRef(0)
  const [activePrimaryView, setActivePrimaryViewState] = useState<WorkspacePrimaryView>(() => (
    resolveDesktopSandboxPanelView(resolveWorkspacePrimaryView(search.panel))
  ))
  const [testingControllerRequested, setTestingControllerRequested] = useState(() => (
    search.panel === 'preview' || search.panel === 'records'
  ))
  const [testingControllerState, setTestingControllerState] = useState<WorkspacesTestingState | null>(null)
  const [pendingTestingAction, setPendingTestingAction] = useState<PendingTestingAction | null>(null)
  const openWorkspaceTabs = useWorkspacesPageUiStore((uiState) => uiState.openWorkspaceTabs)
  const primaryViewByWorkspaceId = useWorkspacesPageUiStore((uiState) => uiState.primaryViewByWorkspaceId)
  const visitedPrimaryViewsByWorkspaceId = useWorkspacesPageUiStore((uiState) => uiState.visitedPrimaryViewsByWorkspaceId)
  const workspaceSessionListPlacementByWorkspaceId = useWorkspacesPageUiStore((uiState) => uiState.workspaceSessionListPlacementByWorkspaceId)
  const terminalOpenWorkspaceIds = useWorkspacesPageUiStore((uiState) => uiState.terminalOpenWorkspaceIds)
  const terminalCollapsedByWorkspaceId = useWorkspacesPageUiStore((uiState) => uiState.terminalCollapsedByWorkspaceId)
  const [isEditingShellTitle, setIsEditingShellTitle] = useState(false)
  const [shellTitleDraft, setShellTitleDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [autoCommitBusy, setAutoCommitBusy] = useState(false)
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false)
  const [workspaceSettingsAutoCommitEnabled, setWorkspaceSettingsAutoCommitEnabled] = useState(false)
  const [bindDialogOpen, setBindDialogOpen] = useState(false)
  const [bindTaskId, setBindTaskId] = useState('')
  const [bindBusy, setBindBusy] = useState(false)
  const [optimisticWorkspaceSession, setOptimisticWorkspaceSession] = useState<WorkspaceSession | null>(null)
  const [deleteWorkspaceDialogItem, setDeleteWorkspaceDialogItem] = useState<WorkspaceListItem | null>(null)
  const [deleteWorkspaceBusy, setDeleteWorkspaceBusy] = useState(false)
  const [pendingPostForkAction, setPendingPostForkAction] = useState<{
    targetWorkspaceSessionId: string
    action: 'prefill' | 'send'
    draft: WorkspaceSessionChatDraftPayload
  } | null>(null)
  const [, setTerminalCollapsedState] = useState(search.terminal !== '1')
  const [terminalMaximized, setTerminalMaximized] = useState(false)
  const [pendingAutoEnvironmentInstallWorkspaceId, setPendingAutoEnvironmentInstallWorkspaceId] = useState<string | null>(null)
  const [openingWorkspaceTarget, setOpeningWorkspaceTarget] = useState<WorkspaceOpenTarget | null>(null)
  const [activeWorkspaceOpenTarget, setActiveWorkspaceOpenTarget] = useState<WorkspaceOpenTarget>(() => (
    getStoredWorkspaceOpenTarget(state.config.workspaceOpenSettings.defaultTarget)
  ))
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] = useState<{
    filePath: string
    requestId: number
  } | null>(null)
  const workspaceFileRequestIdRef = useRef(0)
  const terminalPresenceRequestIdRef = useRef(0)
  const pendingWorkspaceSelectionIdRef = useRef('')
  const pendingWorkspaceSessionSelectionIdRef = useRef('')

  useEffect(() => {
    setProjectVisibilityFilterIds((current) => {
      if (!current) {
        return current
      }

      const validProjectIds = new Set(workspaceScopedProjects.map((project) => project.id))
      const nextVisibleProjectIds = current.filter((projectId) => validProjectIds.has(projectId))
      return nextVisibleProjectIds.length === workspaceScopedProjects.length
        ? null
        : nextVisibleProjectIds
    })
  }, [workspaceScopedProjects])
  const pendingWorkspaceSessionSelectionClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setSelectedWorkspaceSessionId = (workspaceSessionId: string) => {
    selectedWorkspaceSessionIdRef.current = workspaceSessionId
    setSelectedWorkspaceSessionIdState(workspaceSessionId)
  }
  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId
  }, [selectedWorkspaceId])
  const setWorkspacePrimaryViewState = useCallback((workspaceId: string | undefined, nextView: WorkspacePrimaryView) => {
    const safeNextView = resolveDesktopSandboxPanelView(nextView)
    setActivePrimaryViewState(safeNextView)
    setWorkspacePrimaryView(workspaceId, safeNextView)
  }, [])
  const clearPendingWorkspaceSessionSelection = useCallback(() => {
    if (pendingWorkspaceSessionSelectionClearTimerRef.current) {
      clearTimeout(pendingWorkspaceSessionSelectionClearTimerRef.current)
      pendingWorkspaceSessionSelectionClearTimerRef.current = null
    }
    pendingWorkspaceSessionSelectionIdRef.current = ''
    setOptimisticWorkspaceSession(null)
  }, [])
  const routeWorkspaceId = useMemo(() => resolveWorkspaceRouteWorkspaceId({
    routeWorkspaceId: search.workspaceId,
    routeWorkspaceSessionId: search.workspaceSessionId,
    routeTaskId: undefined,
    taskWorkspaceBindings: [],
    workspaceSessions: state.workspaceSessions,
  }), [
    search.workspaceId,
    search.workspaceSessionId,
    state.workspaceSessions,
  ])
  const routeWorkspaceTargetId = routeWorkspaceId || search.workspaceId || search.workspaceSessionId || ''
  const prioritizedDirectoryProjectIds = useMemo(() => resolveWorkspacesPageDirectoryProjectIds({
    projects: workspaceScopedProjects,
    routeProjectId: search.projectId,
    selectedProjectId,
    routeTaskId: undefined,
    routeWorkspaceId,
    tasks: [],
    taskWorkspaceBindings: [],
    workspaceSessions: state.workspaceSessions,
  }), [
    routeWorkspaceId,
    search.projectId,
    selectedProjectId,
    state.workspaceSessions,
    workspaceScopedProjects,
  ])
  const directoryLoadOrder = useMemo(() => {
    return resolveWorkspacesPageDirectoryLoadOrder(workspaceScopedProjects, prioritizedDirectoryProjectIds)
  }, [prioritizedDirectoryProjectIds, workspaceScopedProjects])
  const directoryProjectIds = useMemo(() => {
    return directoryLoadOrder
  }, [directoryLoadOrder])
  const directoryScopedProjects = useMemo(() => {
    if (workspaceScopedProjects.some((project) => isPlaygroundProjectId(project.id))) {
      return workspaceScopedProjects
    }
    const playgroundProject = state.projects.find((project) => isPlaygroundProjectId(project.id)) ?? null
    return playgroundProject ? [...workspaceScopedProjects, playgroundProject] : workspaceScopedProjects
  }, [state.projects, workspaceScopedProjects])
  const directoryProjects = useMemo(() => {
    const projectById = new Map(directoryScopedProjects.map((project) => [project.id, project] as const))
    const scopedProjects = directoryProjectIds
      .map((projectId) => projectById.get(projectId))
      .filter((project): project is (typeof directoryScopedProjects)[number] => Boolean(project))
    // 追加 playground 分组（若有自由工作区），保证 directory 请求与列表分组包含它
    if (!scopedProjects.some((project) => isPlaygroundProjectId(project.id))) {
      const playgroundProject = directoryScopedProjects.find((project) => isPlaygroundProjectId(project.id))
      if (playgroundProject) {
        scopedProjects.push(playgroundProject)
      }
    }
    return scopedProjects
  }, [directoryProjectIds, directoryScopedProjects])
  const projectIdsKey = useMemo(
    () => resolveWorkspacesPageDirectoryProjectIdsKey(directoryProjectIds),
    [directoryProjectIds],
  )
  // Directory data is loaded in one batch; child actions can still call this old hook safely.
  const ensureDirectoryProjectLoaded = useCallback((projectId?: string) => {
    const normalizedProjectId = projectId?.trim() || ''
    if (normalizedProjectId && !visibleProjectIds.has(normalizedProjectId)) {
      return
    }
  }, [visibleProjectIds])
  const [archivedSectionExpanded, setArchivedSectionExpanded] = useState(false)
  const activeDirectoryQuery = useWorkspacesPageDirectoryQuery(directoryProjects, projectIdsKey, !workspaceScopeLoading)
  const activeDirectoryData = activeDirectoryQuery.data
  const activeWorkspaceIds = useMemo(() => (
    new Set(
      Object.values(activeDirectoryData?.workspacesByProject ?? {})
        .flat()
        .map((workspace) => workspace.id),
    )
  ), [activeDirectoryData?.workspacesByProject])
  const shouldLoadArchivedForRoute = Boolean(
    routeWorkspaceId
    && !workspaceScopeLoading
    && !activeDirectoryQuery.isLoading
    && !activeWorkspaceIds.has(routeWorkspaceId),
  )
  const archivedDirectoryQuery = useWorkspacesPageDirectoryQuery(
    directoryProjects,
    projectIdsKey,
    !workspaceScopeLoading && (archivedSectionExpanded || shouldLoadArchivedForRoute),
    { includeArchived: true },
  )
  const directoryData = resolvePreferredWorkspacesPageDirectoryData({
    activeDirectoryData,
    archivedDirectoryData: archivedDirectoryQuery.data,
    archivedDirectoryLoaded: archivedDirectoryQuery.hasDirectoryData,
  })
  const workspacesByProject = useMemo(() => ({
    ...Object.fromEntries(directoryScopedProjects.map((project) => [project.id, []])),
    ...(directoryData?.workspacesByProject ?? {}),
  }), [directoryData?.workspacesByProject, directoryScopedProjects])
  const archivedWorkspaceCount = useMemo(() => {
    const archivedWorkspaceCountByProject = activeDirectoryData?.archivedWorkspaceCountByProject
      ?? directoryData?.archivedWorkspaceCountByProject
      ?? {}
    return directoryProjects.reduce((total, project) => total + (archivedWorkspaceCountByProject[project.id] ?? 0), 0)
  }, [activeDirectoryData?.archivedWorkspaceCountByProject, directoryData?.archivedWorkspaceCountByProject, directoryProjects])
  const presenceByWorkspaceId = directoryData?.presenceByWorkspaceId ?? {}
  const previewByWorkspaceId = directoryData?.previewByWorkspaceId ?? {}
  const executors = directoryData?.executors ?? []
  const managedCloudRuntime = directoryData?.managedCloudRuntime ?? null
  const agentsQuery = useWorkspacesPageAgentsQuery()
  const availableAgents = agentsQuery.data ?? []
  const reviewPullRequestsQuery = useWorkspacesPageReviewPullRequestsQuery(
    !workspaceScopeLoading && workspaceScopedProjects.length > 0,
    directoryProjectIds,
    projectIdsKey,
  )
  const githubResourceBindingsQuery = useWorkspacesPageGitHubResourceBindingsQuery(
    !workspaceScopeLoading && workspaceScopedProjects.length > 0,
    directoryProjectIds,
    projectIdsKey,
  )
  const projectPullRequests = reviewPullRequestsQuery.data ?? []
  const githubResourceBindings = githubResourceBindingsQuery.data ?? []
  const railwayDeploymentsQuery = useWorkspacesPageRailwayDeploymentsQuery(
    !workspaceScopeLoading && workspaceScopedProjects.length > 0,
    directoryProjectIds,
    projectIdsKey,
  )
  const railwayResourceBindingsQuery = useWorkspacesPageRailwayResourceBindingsQuery(
    !workspaceScopeLoading && workspaceScopedProjects.length > 0,
    directoryProjectIds,
    projectIdsKey,
  )
  const railwayDeployments = railwayDeploymentsQuery.data ?? []
  const railwayResourceBindings = railwayResourceBindingsQuery.data ?? []
  const workspaceDirectoryLoading = workspaceScopedProjects.length > 0 && resolveWorkspaceDirectorySelectionLoading({
    loading: resolveWorkspacesPageDirectoryLoading({
      workspaceScopeLoading,
      directoryLoading: activeDirectoryQuery.isLoading || archivedDirectoryQuery.isLoading,
    }),
    fetching: activeDirectoryQuery.isFetching || archivedDirectoryQuery.isFetching,
    routeWorkspaceId,
  })
  const resolveSelectedWorkspaceTerminalCollapsed = useCallback((workspaceId?: string, fallbackCollapsed = true) => {
    return resolveWorkspaceTerminalCollapsed(workspaceId, terminalCollapsedByWorkspaceId, fallbackCollapsed)
  }, [terminalCollapsedByWorkspaceId])
  const currentWorkspaceTerminalCollapsed = resolveCurrentWorkspaceTerminalCollapsed({
    selectedWorkspaceId,
    routeWorkspaceId,
    routeTerminal: search.terminal,
    terminalCollapsedByWorkspaceId,
  })
  const updateWorkspaceSearch = (patch: Partial<WorkspaceRouteSearch>, replace = false) => {
    const pendingWorkspaceSessionSelectionId = pendingWorkspaceSessionSelectionIdRef.current
    const patchHasWorkspaceSessionId = Object.prototype.hasOwnProperty.call(patch, 'workspaceSessionId')
    const patchHasWorkspaceId = Object.prototype.hasOwnProperty.call(patch, 'workspaceId')
    const patchHasPanel = Object.prototype.hasOwnProperty.call(patch, 'panel')
    const patchOpensCreatePanel = patch.create === '1'
    if (
      pendingWorkspaceSessionSelectionId
      && patchHasWorkspaceSessionId
      && (patch.workspaceSessionId || '') !== pendingWorkspaceSessionSelectionId
    ) {
      return
    }

    const nextPatch: Partial<WorkspaceRouteSearch> = { ...patch }
    if (patchHasWorkspaceSessionId && !patchHasWorkspaceId && !search.workspaceId) {
      const workspaceSessionId = typeof patch.workspaceSessionId === 'string'
        ? patch.workspaceSessionId
        : selectedWorkspaceSessionIdRef.current
      const workspaceId = state.workspaceSessions.find((session) => session.id === workspaceSessionId)?.workspaceId
        ?? (optimisticWorkspaceSession?.id === workspaceSessionId ? optimisticWorkspaceSession.workspaceId : undefined)
      if (workspaceId) {
        nextPatch.workspaceId = workspaceId
      }
    }
    const nextPatchHasWorkspaceId = Object.prototype.hasOwnProperty.call(nextPatch, 'workspaceId')
    if (nextPatchHasWorkspaceId && !Object.prototype.hasOwnProperty.call(nextPatch, 'terminal')) {
      nextPatch.terminal = buildWorkspaceTerminalSearchPatch({
        workspaceId: nextPatch.workspaceId as string | undefined,
        terminalCollapsedByWorkspaceId,
      }).terminal
    }
    if (nextPatchHasWorkspaceId && !patchHasPanel) {
      nextPatch.panel = buildWorkspacePrimaryViewSearchPatch({
        workspaceId: nextPatch.workspaceId as string | undefined,
        primaryViewByWorkspaceId,
      }).panel
    }

    const workspaceSessionId = patchOpensCreatePanel
      ? undefined
      : patchHasWorkspaceSessionId
      ? patch.workspaceSessionId
      : selectedWorkspaceSessionIdRef.current || search.workspaceSessionId

    const nextSearch = buildWorkspacesRouteSearch({
      ...search,
      ...nextPatch,
      ...(patchOpensCreatePanel
        ? {
            workspaceId: undefined,
            taskId: undefined,
            workspaceSessionId: undefined,
            launchId: undefined,
            panel: undefined,
            terminal: undefined,
            mobileView: undefined,
          }
        : {}),
      workspaceSessionId,
    })
    const currentSearch = buildWorkspacesRouteSearch(search)
    if (areWorkspaceRouteSearchEqual(currentSearch, nextSearch)) {
      return
    }

    void navigate({
      to: '/workspaces',
      replace,
      search: nextSearch,
    })
  }
  const navigateWorkspaceSearch = (nextSearch: WorkspaceRouteSearch, replace?: boolean) => {
    updateWorkspaceSearch(nextSearch, replace)
  }

  const updateWorkspaceDirectoryCache = useCallback((
    updater: (current: WorkspacesPageDirectoryData | undefined) => WorkspacesPageDirectoryData | undefined,
  ) => {
    for (const includeArchived of [false, true]) {
      queryClient.setQueryData<WorkspacesPageDirectoryData>(
        workspacesPageQueryKeys.directory(projectIdsKey, includeArchived),
        (current) => {
          const next = updater(current)
          return next ? normalizeWorkspacesPageDirectoryCache(next, includeArchived) : next
        },
      )
    }
  }, [projectIdsKey])
  const refreshWorkspacesListPrState = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workspacesPageQueryKeys.directory(projectIdsKey, false) })
    void queryClient.invalidateQueries({ queryKey: workspacesPageQueryKeys.directory(projectIdsKey, true) })
    void queryClient.invalidateQueries({ queryKey: workspacesPageQueryKeys.reviewPullRequests(projectIdsKey) })
  }, [projectIdsKey])

  const setMobileWorkspaceView = useCallback((view: 'list' | 'detail' | 'create') => {
    if (view === 'create') {
      setMobileView('create')
      return
    }

    if (view === 'detail') {
      setMobileView('detail')
      updateWorkspaceSearch({ mobileView: 'detail' })
      return
    }

    if (search.mobileView === 'detail') {
      setMobileView('list')
      updateWorkspaceSearch({ mobileView: undefined, panel: undefined, terminal: undefined }, true)
      return
    }

    setMobileView('list')
    updateWorkspaceSearch({ mobileView: undefined }, true)
  }, [search.mobileView, updateWorkspaceSearch])

  const setActivePrimaryView: Dispatch<SetStateAction<WorkspacePrimaryView>> = (nextValue) => {
    const next = resolveDesktopSandboxPanelView(typeof nextValue === 'function' ? nextValue(activePrimaryView) : nextValue)
    setWorkspacePrimaryViewState(selectedWorkspaceId || routeWorkspaceId, next)
    const patch: Partial<WorkspaceRouteSearch> = {
      panel: next === 'chat' ? undefined : next,
    }

    if (isMobile && next !== 'chat' && !currentWorkspaceTerminalCollapsed) {
      setTerminalCollapsedState(true)
      if (selectedWorkspaceId) {
        setWorkspaceTerminalCollapsedUi(selectedWorkspaceId, true)
      }
      setTerminalMaximized(false)
      patch.terminal = undefined
    }

    updateWorkspaceSearch(patch, isMobile)
  }

  const setTerminalCollapsed = (nextValue: boolean) => {
    setTerminalCollapsedState(nextValue)
    if (selectedWorkspaceId) {
      setWorkspaceTerminalCollapsedUi(selectedWorkspaceId, nextValue)
    }
    if (nextValue) {
      setTerminalMaximized(false)
    } else if (selectedWorkspaceId) {
      setWorkspaceTerminalOpenUi(selectedWorkspaceId, true)
    }
    const patch: Partial<WorkspaceRouteSearch> = {
      terminal: nextValue ? undefined : '1',
    }

    if (isMobile && !nextValue && activePrimaryView !== 'chat') {
      setWorkspacePrimaryViewState(selectedWorkspaceId || routeWorkspaceId, 'chat')
      patch.panel = undefined
    }

    updateWorkspaceSearch(patch, isMobile)
  }
  useEffect(() => {
    setSelectedWorkspaceId(routeWorkspaceId)
  }, [routeWorkspaceId])

  useEffect(() => {
    const pendingWorkspaceSessionSelectionId = pendingWorkspaceSessionSelectionIdRef.current
    if (pendingWorkspaceSessionSelectionId && search.workspaceSessionId !== pendingWorkspaceSessionSelectionId) {
      const pendingWorkspaceSessionWorkspaceId = state.workspaceSessions.find((session) => (
        session.id === pendingWorkspaceSessionSelectionId
      ))?.workspaceId ?? (
        optimisticWorkspaceSession?.id === pendingWorkspaceSessionSelectionId
          ? optimisticWorkspaceSession.workspaceId
          : ''
      )

      if (
        routeWorkspaceId
        && pendingWorkspaceSessionWorkspaceId
        && pendingWorkspaceSessionWorkspaceId !== routeWorkspaceId
      ) {
        clearPendingWorkspaceSessionSelection()
        setSelectedWorkspaceSessionId(search.workspaceSessionId || '')
        return
      }

      setSelectedWorkspaceSessionId(pendingWorkspaceSessionSelectionId)
      updateWorkspaceSearch({ workspaceSessionId: pendingWorkspaceSessionSelectionId }, true)
      return
    }

    setSelectedWorkspaceSessionId(search.workspaceSessionId || '')
  }, [
    clearPendingWorkspaceSessionSelection,
    optimisticWorkspaceSession?.id,
    optimisticWorkspaceSession?.workspaceId,
    routeWorkspaceId,
    search.workspaceSessionId,
    state.workspaceSessions,
  ])

  useEffect(() => {
    if (!routeWorkspaceId) {
      return
    }

    const nextPrimaryView = resolveDesktopSandboxPanelView(resolveWorkspacePrimaryView(search.panel))
    setWorkspacePrimaryView(routeWorkspaceId, nextPrimaryView)
  }, [routeWorkspaceId, search.panel])

  useEffect(() => {
    const nextPrimaryView = resolveDesktopSandboxPanelView(resolveCurrentWorkspacePrimaryView({
      selectedWorkspaceId,
      routeWorkspaceId,
      routePanel: search.panel,
      primaryViewByWorkspaceId,
    }))
    setActivePrimaryViewState((current) => current === nextPrimaryView ? current : nextPrimaryView)
  }, [primaryViewByWorkspaceId, routeWorkspaceId, search.panel, selectedWorkspaceId])

  useEffect(() => {
    if (!routeWorkspaceId) {
      return
    }

    const nextTerminalCollapsed = resolveSelectedWorkspaceTerminalCollapsed(
      routeWorkspaceId,
      search.terminal !== '1',
    )
    setWorkspaceTerminalCollapsedUi(routeWorkspaceId, nextTerminalCollapsed)
    setTerminalCollapsedState(nextTerminalCollapsed)
    if (nextTerminalCollapsed) {
      setTerminalMaximized(false)
    }
  }, [resolveSelectedWorkspaceTerminalCollapsed, routeWorkspaceId, search.terminal])

  useEffect(() => {
    const directoryError = activeDirectoryQuery.error ?? archivedDirectoryQuery.error
    if (!directoryError) {
      return
    }

    const message = directoryError instanceof Error
      ? directoryError.message
      : t('workspace.page.errors.loadFailed')
    toast.error(message)
  }, [activeDirectoryQuery.error, archivedDirectoryQuery.error, t])

  useEffect(() => {
    if (!directoryData?.updatedProjects.length) {
      return
    }

    const updatedProjects = new Map(directoryData.updatedProjects.map((project) => [project.id, project]))
    if (!workspaceScopedProjects.some((project) => {
      const updatedProject = updatedProjects.get(project.id)
      return updatedProject && JSON.stringify(updatedProject) !== JSON.stringify(project)
    })) {
      return
    }

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) => updatedProjects.get(project.id) ?? project),
    }))
  }, [directoryData?.updatedProjects, setState, workspaceScopedProjects])

  const workspaceSessionUnreadState = useWorkspaceSessionUnreadState({
    workspaceSessions: state.workspaceSessions,
    selectedWorkspaceSessionId,
  })
  // 通知矩阵「不在该会话时弹」：声明当前正在查看的工作区会话。
  useRealtimeActiveView({ workspaceSessionId: selectedWorkspaceSessionId })

  const selectionModel = useWorkspacesSelectionModel({
    executors,
    language,
    openWorkspaceTabs,
    optimisticWorkspaceSession,
    routeWorkspaceId,
    searchQuery,
    searchWorkspaceSessionId: search.workspaceSessionId,
    selectedWorkspaceId,
    selectedWorkspaceSessionId,
    state,
    workspaceDirectoryLoading,
    presenceByWorkspaceId,
    previewByWorkspaceId,
    directoryScopedProjects,
    workspacesByProject,
    workspaceSessionUnreadState,
  })
  const {
    activeFilteredItems,
    archivedFilteredItems,
    bindableTasks,
    displayTask,
    matchedWorkspaceSession,
    routeWorkspaceItem,
    searchTask,
    selectedItem,
    selectedWorkspaceRouteFallback,
    selectedWorkspaceSession,
    selectedWorkspaceSessions,
    selectedWorkspaceTask,
    visibleWorkspaceItems,
    workspaceItems,
    workspaceSelection,
  } = selectionModel
  const workspaceSessionShare = useWorkspaceSessionShare({
    projectId: selectedItem?.project.id,
    taskId: selectedWorkspaceTask?.id ?? selectedItem?.activeTask?.id,
    workspaceId: selectedItem?.workspace.id ?? '',
    workspaceSessionId: selectedWorkspaceSession?.id ?? '',
    workspaceSessionTitle: selectedWorkspaceSession?.title ?? '',
  })
  const currentWorkspaceSessionListPlacement = resolveWorkspaceSessionListPlacement(
    selectedItem?.workspace.id || selectedWorkspaceId || routeWorkspaceId,
    workspaceSessionListPlacementByWorkspaceId,
    isMobile ? 'top' : 'side',
  )
  const handleWorkspaceSessionListPlacementChange = useCallback((placement: WorkspaceSessionListPlacement) => {
    setWorkspaceSessionListPlacement(selectedItem?.workspace.id || selectedWorkspaceId || routeWorkspaceId, placement)
  }, [routeWorkspaceId, selectedItem?.workspace.id, selectedWorkspaceId])
  const currentWorkspaceViewId = selectedItem?.workspace.id || selectedWorkspaceId || routeWorkspaceId
  const retainedPrimaryViews = useMemo(() => {
    const visitedViews = visitedPrimaryViewsByWorkspaceId[currentWorkspaceViewId] ?? []
    return visitedViews.includes(activePrimaryView)
      ? visitedViews
      : [...visitedViews, activePrimaryView]
  }, [activePrimaryView, currentWorkspaceViewId, visitedPrimaryViewsByWorkspaceId])
  const buildCurrentPanelUiScopeKey = useCallback((panel: 'files' | 'git' | 'preview' | 'records' | 'desktop' | 'terminal') => (
    buildWorkspacePanelUiScopeKey({
      workspaceId: currentWorkspaceViewId,
      workspaceSessionId: selectedWorkspaceSession?.id,
      panel,
    })
  ), [currentWorkspaceViewId, selectedWorkspaceSession?.id])
  useEffect(() => {
    if (!selectedItem) {
      return
    }

    const workspaceId = selectedItem.workspace.id
    const workspaceSessionId = selectedWorkspaceSession?.id || selectedItem.runningTargetWorkspaceSessionId
    const presenceState = selectedItem.runningCount > 0 ? 'working' : 'viewing'
    let inFlightController: AbortController | null = null
    const recordPresence = () => {
      if (inFlightController) {
        return
      }

      const controller = new AbortController()
      inFlightController = controller
      void api.recordWorkspacePresence(workspaceId, {
        state: presenceState,
        workspaceSessionId,
      }, controller.signal).catch(() => undefined).finally(() => {
        if (inFlightController === controller) {
          inFlightController = null
        }
      })
    }

    recordPresence()
    const intervalId = window.setInterval(recordPresence, 20_000)
    return () => {
      window.clearInterval(intervalId)
      inFlightController?.abort()
      inFlightController = null
    }
  }, [
    selectedItem?.workspace.id,
    selectedItem?.runningCount,
    selectedItem?.runningTargetWorkspaceSessionId,
    selectedWorkspaceSession?.id,
  ])
  const workspaceSessionRuntimeTask = useMemo(() => (
    selectedItem && selectedWorkspaceSession
      ? buildWorkspaceSessionRuntimeTask({
          project: selectedItem.project,
          sessionId: selectedWorkspaceSession.id,
          title: selectedWorkspaceSession.title,
          agentType: selectedWorkspaceSession.agentType ?? selectedItem.workspace.agentType,
          executionModel: selectedWorkspaceSession.executionModel,
          baseBranch: selectedWorkspaceSession.baseBranch || selectedItem.workspace.suggestedBaseBranch || selectedItem.project.defaultBranch,
          currentStep: selectedWorkspaceSession.currentStep,
          createdAt: selectedWorkspaceSession.createdAt,
          updatedAt: selectedWorkspaceSession.updatedAt,
        })
      : null
  ), [selectedItem, selectedWorkspaceSession])
  const effectiveWorkspaceTask = workspaceSessionRuntimeTask
  const effectiveDisplayTask = workspaceSessionRuntimeTask
  const autoRefreshTaskIds = useMemo(
    () => new Set(selectedWorkspaceTask ? [selectedWorkspaceTask.id] : []),
    [selectedWorkspaceTask],
  )
  const autoRefreshProjectIds = useMemo(() => {
    const projectIds = [
      search.projectId,
      selectedItem?.project.id,
      routeWorkspaceItem?.project.id,
    ]
      .map((projectId) => projectId?.trim() || '')
      .filter(Boolean)

    return projectIds.length > 0 ? new Set(projectIds) : visibleProjectIds
  }, [routeWorkspaceItem?.project.id, search.projectId, selectedItem?.project.id, visibleProjectIds])

  useAutoRefreshTaskPullRequests({
    projects: state.projects,
    tasks: state.tasks,
    taskWorkspaceBindings: state.taskWorkspaceBindings,
    workspaceSessions: state.workspaceSessions,
    enabledProjectIds: autoRefreshProjectIds,
    enabledTaskIds: autoRefreshTaskIds,
    setState,
  })

  const routeWorkspaceProjectId = routeWorkspaceItem?.project.id
  const routeWorkspaceProjectName = routeWorkspaceItem?.project.name
  const routeWorkspaceName = routeWorkspaceItem?.workspace.name
  useEffect(() => {
    if (!routeWorkspaceId || !routeWorkspaceProjectId || !routeWorkspaceName || search.create === '1') {
      return
    }

    openWorkspaceTab({
      workspaceId: routeWorkspaceId,
      projectId: routeWorkspaceProjectId,
      workspaceSessionId: search.workspaceSessionId,
    })
    openPageTab({
      id: buildWorkspacePageTabId({
        pathname: '/workspaces',
        workspaceId: routeWorkspaceId,
        workspaceSessionId: search.workspaceSessionId,
        launchId: search.launchId,
      }),
      scope: 'workspace',
      pathname: '/workspaces',
      href: buildWorkspacesPageHref(search),
      title: routeWorkspaceName || '',
      subtitle: routeWorkspaceProjectName,
    })
  }, [
    routeWorkspaceId,
    search.create,
    search.launchId,
    search.workspaceSessionId,
    routeWorkspaceProjectId,
    routeWorkspaceProjectName,
    routeWorkspaceName,
  ])
  const editingProject = projectEditDialog.editingProject

  useEffect(() => {
    if (search.create === '1' && panelMode !== 'create') {
      setPanelMode('create')
    }
  }, [panelMode, search.create])

  useEffect(() => {
    if (selectedProjectId && visibleProjectIds.has(selectedProjectId)) {
      return
    }

    setSelectedProjectId(workspaceScopedProjects[0]?.id ?? '')
  }, [selectedProjectId, setSelectedProjectId, visibleProjectIds, workspaceScopedProjects])

  useEffect(() => {
    if (search.create === '1' || panelMode === 'create') {
      return
    }

    if (search.projectId && visibleProjectIds.has(search.projectId)) {
      return
    }

    const nextProjectId = workspaceScopedProjects[0]?.id || ''
    if ((search.projectId || '') === nextProjectId) {
      return
    }

    updateWorkspaceSearch({
      projectId: nextProjectId || undefined,
      workspaceId: undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    }, true)
  }, [panelMode, search.create, search.projectId, visibleProjectIds, workspaceScopedProjects])

  useEffect(() => {
    if (search.create === '1' || panelMode === 'create' || workspaceDirectoryLoading) {
      return
    }

    if (!search.workspaceId) {
      return
    }

    if (visibleWorkspaceItems.some((item) => item.workspace.id === search.workspaceId)) {
      return
    }

    const pendingWorkspaceSelectionId = pendingWorkspaceSelectionIdRef.current
    if (
      pendingWorkspaceSelectionId
      && (routeWorkspaceId === pendingWorkspaceSelectionId || selectedWorkspaceId === pendingWorkspaceSelectionId)
    ) {
      return
    }

    const fallbackItem = visibleWorkspaceItems[0] ?? null
    const nextWorkspaceId = fallbackItem?.workspace.id || ''
    if (selectedWorkspaceId !== nextWorkspaceId) {
      setSelectedWorkspaceId(nextWorkspaceId)
    }
    if (selectedWorkspaceSessionId) {
      setSelectedWorkspaceSessionId('')
    }

    updateWorkspaceSearch({
      projectId: fallbackItem?.project.id || search.projectId,
      workspaceId: fallbackItem?.workspace.id || undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
      launchId: undefined,
      autoEnvironmentInstall: undefined,
    }, true)
  }, [
    panelMode,
    search.autoEnvironmentInstall,
    search.create,
    search.projectId,
    search.workspaceId,
    routeWorkspaceId,
    selectedWorkspaceId,
    selectedWorkspaceSessionId,
    visibleWorkspaceItems,
    workspaceDirectoryLoading,
  ])

  useEffect(() => {
    if (search.create === '1' || panelMode === 'create') {
      return
    }

    if (!routeWorkspaceId && openWorkspaceTabs.length === 0 && !selectedWorkspaceId) {
      return
    }

    const pendingWorkspaceSelectionId = pendingWorkspaceSelectionIdRef.current
    if (pendingWorkspaceSelectionId) {
      const pendingWorkspaceSelectionItem = visibleWorkspaceItems.find((item) => (
        item.workspace.id === pendingWorkspaceSelectionId
      ))
      if (pendingWorkspaceSelectionItem && routeWorkspaceId !== pendingWorkspaceSelectionId) {
        if (selectedWorkspaceId !== pendingWorkspaceSelectionId) {
          setSelectedWorkspaceId(pendingWorkspaceSelectionId)
        }
        updateWorkspaceSearch({
          projectId: pendingWorkspaceSelectionItem.project.id,
          workspaceId: pendingWorkspaceSelectionId,
          taskId: undefined,
          workspaceSessionId: pendingWorkspaceSessionSelectionIdRef.current || undefined,
        }, true)
        return
      }
      if (routeWorkspaceId === pendingWorkspaceSelectionId && pendingWorkspaceSelectionItem) {
        pendingWorkspaceSelectionIdRef.current = ''
      } else if (routeWorkspaceId === pendingWorkspaceSelectionId || selectedWorkspaceId === pendingWorkspaceSelectionId) {
        return
      }
    }

    if (selectedWorkspaceId !== workspaceSelection.nextWorkspaceId) {
      setSelectedWorkspaceId(workspaceSelection.nextWorkspaceId)
    }

    if (!workspaceSelection.shouldUpdateRoute) {
      return
    }

    const fallbackItem = visibleWorkspaceItems.find((item) => item.workspace.id === workspaceSelection.nextWorkspaceId)
      ?? visibleWorkspaceItems[0]
      ?? null

    updateWorkspaceSearch({
      projectId: fallbackItem?.project.id,
      workspaceId: workspaceSelection.nextWorkspaceId || undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    }, true)
  }, [openWorkspaceTabs.length, panelMode, routeWorkspaceId, search.create, selectedWorkspaceId, visibleWorkspaceItems, workspaceSelection])

  useEffect(() => {
    if (!isMobile) {
      setMobileView('list')
      return
    }

    if (panelMode === 'create') {
      setMobileView('create')
      return
    }

    setMobileView(resolveWorkspacesPageMobileView({
      create: search.create,
      panelMode,
      routeWorkspaceId: routeWorkspaceTargetId,
      searchMobileView: search.mobileView,
    }))
  }, [isMobile, panelMode, routeWorkspaceTargetId, search.create, search.mobileView])

  useEffect(() => {
    if (!isMobile || panelMode === 'create') {
      return
    }

    if (!selectedWorkspaceId && !routeWorkspaceTargetId) {
      setMobileView('list')
    }
  }, [isMobile, panelMode, routeWorkspaceTargetId, selectedWorkspaceId])

  const executorOptions = useMemo(
    () => buildExecutorOptionsWithManagedCloud(executors, managedCloudRuntime),
    [executors, managedCloudRuntime],
  )
  const openCreatePanel = useCallback(() => {
    const nextProjectId = selectedProjectId || selectedItem?.project.id || workspaceScopedProjects[0]?.id || ''

    clearPendingWorkspaceSessionSelection()
    setPanelMode('create')
    updateWorkspaceSearch({
      projectId: nextProjectId || undefined,
      create: '1',
      workspaceId: undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    if (isMobile) {
      setMobileView('create')
    }
  }, [
    clearPendingWorkspaceSessionSelection,
    isMobile,
    selectedItem?.project.id,
    selectedProjectId,
    setMobileView,
    updateWorkspaceSearch,
    workspaceScopedProjects,
  ])
  const openCreatePanelForProject = useCallback((projectId: string) => {
    clearPendingWorkspaceSessionSelection()
    ensureDirectoryProjectLoaded(projectId)
    setPanelMode('create')
    updateWorkspaceSearch({
      projectId,
      create: '1',
      workspaceId: undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    if (isMobile) {
      setMobileView('create')
    }
  }, [
    clearPendingWorkspaceSessionSelection,
    ensureDirectoryProjectLoaded,
    isMobile,
    setMobileView,
    updateWorkspaceSearch,
  ])
  const closeCreatePanel = useCallback(() => {
    setPanelMode('detail')
    updateWorkspaceSearch({
      create: undefined,
      workspaceId: selectedWorkspaceId || undefined,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    if (isMobile) {
      setMobileView(selectedWorkspaceId ? 'detail' : 'list')
    }
  }, [
    isMobile,
    selectedWorkspaceId,
    setMobileView,
    updateWorkspaceSearch,
  ])
  const clearSelectedLocalSessionPreviewRef = useRef<() => void>(() => {})
  const sessionActions = useWorkspacesSessionActions({
    clearPendingWorkspaceSessionSelection,
    clearSelectedLocalSessionPreview: () => clearSelectedLocalSessionPreviewRef.current(),
    confirm,
    displayTask: effectiveDisplayTask,
    isMobile,
    pendingWorkspaceSessionSelectionIdRef,
    runMutation,
    selectedItem,
    selectedWorkspaceSession,
    selectedWorkspaceSessionId,
    selectedWorkspaceSessions,
    selectedWorkspaceTask: effectiveWorkspaceTask,
    setMobileView,
    setOptimisticWorkspaceSession,
    setPendingPostForkAction,
    setSelectedWorkspaceSessionId,
    setState,
    setWorkspacePrimaryViewState,
    workspaceSessions: state.workspaceSessions,
    t,
    updateWorkspaceSearch,
  })
  const {
    creatingWorkspaceSession,
    deletingWorkspaceSessionId,
    forkingMessageId,
    revisingTurnId,
    sessionRenameOpen,
    sessionRenameDraft,
    sessionRenameBusy,
    setSessionRenameDraft,
    setSessionRenameOpen,
    handleWorkspaceTaskUpdate,
    handleCreateWorkspaceSession,
    handleRenameWorkspaceSession,
    handleDeleteWorkspaceSession,
    handlePinWorkspaceSession,
    openSelectedWorkspaceSessionRenameDialog,
    handleMarkSelectedWorkspaceSessionUnread,
    handleRenameSelectedWorkspaceSession,
    handleForkWorkspaceSessionFromMessage,
    handleReviseWorkspaceSessionTurn,
  } = sessionActions
  const workspaceSessionTokenSummaryById = useWorkspaceSessionTokenSummary({
    displayTask: effectiveDisplayTask,
    enabled: Boolean(selectedItem?.workspace.id && selectedWorkspaceSessions.length > 0),
    searchTask,
    selectedItem,
    selectedWorkspaceSessionId: selectedWorkspaceSession?.id,
    selectedWorkspaceSessions,
    selectedWorkspaceTask: effectiveWorkspaceTask,
  })
  const routeProject = useMemo(
    () => selectedItem?.project
      ?? workspaceScopedProjects.find((project) => project.id === search.projectId)
      ?? null,
    [search.projectId, selectedItem?.project, workspaceScopedProjects],
  )
  const gitPanelEnabled = selectedItem?.project.versionControl !== 'none'
  const reorderActions = useWorkspacesReorderActions({
    selectedItem,
    setState,
    stateProjects: state.projects,
    t,
    updateWorkspaceDirectoryCache,
    workspaceScopedProjects,
    workspacesByProject,
  })
  const { handleReorderWorkspaceSessions, handleReorderProjects, handleReorderProjectWorkspaces, reorderingWorkspaceSessions } = reorderActions
  const workspaceRuntime = useSelectedWorkspaceRuntime({
    defaultWorkspaceRoot: state.config.workspaceRoot,
    executors,
    managedCloudRuntime,
    projectBindings: state.projectBindings,
    selectedItem,
    selectedWorkspaceSession,
  })
  const {
    selectedWorkspaceRuntime,
    selectedWorkspaceExecutor,
    selectedWorkspaceExecutorId,
    selectedWorkspaceExecutorName,
    selectedWorkspaceFileExplorerRootPath,
    selectedWorkspaceCwd,
    selectedWorkspaceTerminalTargetCwd,
    selectedWorkspaceCandidateCwds,
    selectedWorkspaceFileScopeRootPaths,
  } = workspaceRuntime
  const selectedWorkspaceFilesCacheScopeKey = useMemo(() => {
    if (!selectedItem) {
      return ''
    }

    return JSON.stringify([
      selectedItem.project.id,
      selectedItem.workspace.id,
      selectedWorkspaceSession?.id || '',
      selectedItem.workspace.codeBranchName || selectedWorkspaceSession?.branchName || '',
      selectedItem.workspace.codeBaseBranch
        || selectedWorkspaceSession?.baseBranch
        || effectiveDisplayTask?.baseBranch
        || effectiveDisplayTask?.baseBranchHint
        || selectedItem.workspace.suggestedBaseBranch
        || selectedItem.workspace.defaultBranch
        || selectedItem.project.defaultBranch
        || '',
      selectedWorkspaceSession?.worktreeStatus || '',
      selectedWorkspaceSession?.workingDirectoryMode || selectedItem.workspace.workingDirectoryMode || '',
      selectedWorkspaceExecutorId || '',
      selectedWorkspaceRuntime?.repoPath || selectedWorkspaceFileExplorerRootPath || selectedWorkspaceCwd || '',
    ])
  }, [
    effectiveDisplayTask?.baseBranch,
    effectiveDisplayTask?.baseBranchHint,
    selectedItem,
    selectedWorkspaceCwd,
    selectedWorkspaceExecutorId,
    selectedWorkspaceFileExplorerRootPath,
    selectedWorkspaceRuntime?.repoPath,
    selectedWorkspaceSession?.baseBranch,
    selectedWorkspaceSession?.branchName,
    selectedWorkspaceSession?.id,
    selectedWorkspaceSession?.workingDirectoryMode,
    selectedWorkspaceSession?.worktreeStatus,
  ])
  const refreshWorkspaceSessionViewRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const localSessionBrowser = useWorkspacesLocalSessionBrowser({
    selectedItem,
    selectedWorkspaceCandidateCwds,
    selectedWorkspaceExecutorId,
    selectedWorkspaceSession,
    selectedWorkspaceTask: effectiveWorkspaceTask,
    t,
    onShowChatView: () => setWorkspacePrimaryViewState(selectedItem?.workspace.id ?? routeWorkspaceId, 'chat'),
    clearPendingWorkspaceSessionSelection,
    setSelectedWorkspaceSessionId,
    setWorkspacePrimaryViewState,
    updateWorkspaceSearch,
    refreshWorkspaceSessionView: () => refreshWorkspaceSessionViewRef.current(),
    runMutation,
  })
  const {
    visibleLocalSessions,
    localSessionsOpen,
    localSessionsLoading,
    localSessionsRefreshing,
    localSessionDetailLoading,
    localSessionImporting,
    selectedLocalSessionKey,
    selectedLocalSessionDetail,
    selectedLocalSessionSummary,
    clearSelectedLocalSessionPreview,
    handleToggleLocalSessions,
    handleSelectLocalSession,
    handleImportLocalSession,
    loadLocalSessions,
  } = localSessionBrowser
  clearSelectedLocalSessionPreviewRef.current = clearSelectedLocalSessionPreview
  const persistentTerminalOpenPanelKeys = usePersistentWorkspaceTerminalOpenPanelKeys()
  // Explicit local false values must beat the slower persistent-session reconciliation.
  const displayedTerminalOpenWorkspaceIds = useMemo(() => (
    isMobile
      ? terminalOpenWorkspaceIds
      : { ...persistentTerminalOpenPanelKeys, ...terminalOpenWorkspaceIds }
  ), [isMobile, persistentTerminalOpenPanelKeys, terminalOpenWorkspaceIds])
  const selectedWorkspaceTerminalPresenceWorkspaceId = selectedItem?.workspace.id || ''

  useEffect(() => {
    if (!selectedWorkspaceExecutor || !isManagedCloudExecutorRecord(selectedWorkspaceExecutor) || selectedWorkspaceExecutor.status === 'online') {
      return
    }

    let cancelled = false

    const refreshManagedExecutor = async () => {
      const deadline = Date.now() + 20_000
      while (!cancelled && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        if (cancelled) {
          return
        }

        try {
          const response = await api.listExecutors()
          if (cancelled) {
            return
          }

          updateWorkspaceDirectoryCache((current) => current
            ? {
                ...current,
                executors: response.executors,
              }
            : current)
          const matchedExecutor = response.executors.find((item) => item.executorId === selectedWorkspaceExecutor.executorId)
          if (!matchedExecutor || matchedExecutor.status === 'online' || matchedExecutor.status === 'offline') {
            return
          }
        } catch {
          return
        }
      }
    }

    void refreshManagedExecutor()

    return () => {
      cancelled = true
    }
  }, [selectedWorkspaceExecutor])
  const testerWorkspaceSession = useMemo<WorkspaceSession | null>(() => {
    return selectedWorkspaceSessions.find((session) => session.status === 'active' && session.sessionKind === 'subagent' && session.sessionRole === 'tester') ?? null
  }, [selectedWorkspaceSessions])
  const parentWorkspaceSession = useMemo<WorkspaceSession | null>(() => {
    if (!selectedWorkspaceSession?.parentSessionId) {
      return null
    }

    return selectedWorkspaceSessions.find((session) => session.id === selectedWorkspaceSession.parentSessionId) ?? null
  }, [selectedWorkspaceSession?.parentSessionId, selectedWorkspaceSessions])
  const canMarkSelectedWorkspaceSessionUnread = Boolean(
    selectedWorkspaceSession && getWorkspaceSessionAttentionSignature(selectedWorkspaceSession),
  )
  const [selectedWorkspaceEnvironmentTemplate, setSelectedWorkspaceEnvironmentTemplate] = useState<Project['environmentTemplate'] | null>(null)
  const environmentCommands = useMemo(
    () => resolveProjectEnvironmentCommandFields(selectedItem?.project ?? null, selectedWorkspaceEnvironmentTemplate),
    [selectedItem?.project, selectedWorkspaceEnvironmentTemplate],
  )
  const environmentPreview = useMemo(() => {
    if (!selectedItem?.project || !selectedWorkspaceSession) {
      return null
    }

    return resolveProjectEnvironmentPreview({
      project: selectedItem.project,
      session: selectedWorkspaceSession,
      cwd: selectedWorkspaceTerminalTargetCwd,
      workspaceEnvironmentTemplate: selectedWorkspaceEnvironmentTemplate,
    })
  }, [selectedItem?.project, selectedWorkspaceEnvironmentTemplate, selectedWorkspaceSession, selectedWorkspaceTerminalTargetCwd])

  useEffect(() => {
    let cancelled = false
    if (!selectedItem?.workspace.id) {
      setSelectedWorkspaceEnvironmentTemplate(null)
      return () => {
        cancelled = true
      }
    }

    void api.getWorkspaceEnvironmentTemplate(selectedItem.workspace.id)
      .then((response) => {
        if (!cancelled) {
          setSelectedWorkspaceEnvironmentTemplate(response.template)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedWorkspaceEnvironmentTemplate(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedItem?.workspace.id])

  const envTerminalController = useWorkspaceEnvironmentTerminalController({
    currentWorkspaceTerminalCollapsed,
    environmentPreview,
    isMobile,
    persistentTerminalOpenPanelKeys: displayedTerminalOpenWorkspaceIds,
    searchWorkspaceSessionId: search.workspaceSessionId,
    selectedItem,
    selectedWorkspaceExecutorId,
    selectedWorkspaceSession,
    setTerminalCollapsed,
    setWorkspaceTerminalOpen,
    t,
    terminalOpenWorkspaceIds: displayedTerminalOpenWorkspaceIds,
    workspaceSessions: state.workspaceSessions,
  })
  const {
    environmentStartInTerminal,
    shouldShowEnvironmentStop,
    canOpenEnvironmentPreview,
    canStopEnvironment,
    selectedWorkspaceTerminalOpen,
    selectedWorkspaceTerminalKeptAlive,
    selectedWorkspaceTerminalActive,
    shouldRenderSelectedWorkspaceTerminal,
    selectedWorkspaceStartCommandRunning,
    environmentStartCommandRunningWorkspaceIds,
    workspaceEnvironmentStatusesByWorkspaceId,
    terminalCommandRequest,
    handleToggleSelectedWorkspaceTerminal,
    handleWorkspaceEnvironmentStatusChange,
    clearWorkspaceEnvironmentRunningForWorkspace,
    startSelectedWorkspaceEnvironment,
    stopSelectedWorkspaceEnvironment,
    openSelectedWorkspaceEnvironmentLogs,
    syncSelectedWorkspaceTerminalPresence,
    setEnvironmentTerminalCommand,
  } = envTerminalController
  const shouldShowSelectedWorkspaceTerminal = Boolean(
    isMobile
    && selectedItem
    && shouldRenderSelectedWorkspaceTerminal
    && !currentWorkspaceTerminalCollapsed
  )
  // On mobile, closing the terminal should remove the overlay entirely instead of
  // keeping a collapsed terminal shell at the bottom of the chat view.
  const selectedWorkspaceTerminalItem = shouldShowSelectedWorkspaceTerminal ? selectedItem : null

  const gitWorkingTreeCompareBranch = selectedItem?.workspace.codeBranchName || selectedWorkspaceSession?.branchName || ''
  const gitWorkingTreeBaseBranch = selectedItem?.workspace.codeBaseBranch
    || selectedWorkspaceSession?.baseBranch
    || effectiveDisplayTask?.baseBranch
    || effectiveDisplayTask?.baseBranchHint
    || selectedItem?.workspace.suggestedBaseBranch
    || selectedItem?.workspace.defaultBranch
    || selectedItem?.project.defaultBranch
    || 'main'
  const gitWorkingTreeScopeKey = selectedItem && effectiveDisplayTask
    ? buildWorkspaceGitScopeKey({
        taskId: effectiveDisplayTask.id,
        workspaceId: selectedItem.workspace.id,
        workspaceSessionId: selectedWorkspaceSession?.id,
        compareBranch: gitWorkingTreeCompareBranch,
        worktreeStatus: selectedWorkspaceSession?.worktreeStatus,
        baseBranch: gitWorkingTreeBaseBranch,
      })
    : ''
  const gitWorkingTreeDiffQuery = useQuery({
    queryKey: workspaceQueryKeys.gitWorkingTreeDiff(
      effectiveDisplayTask?.id || '',
      selectedItem?.workspace.id || '',
      selectedWorkspaceSession?.id,
      gitWorkingTreeScopeKey,
    ),
    enabled: activePrimaryView === 'git' && Boolean(gitPanelEnabled && selectedItem && effectiveDisplayTask),
    queryFn: () => api.getTaskGitWorkingTreeDiff(
      effectiveDisplayTask!.id,
      selectedItem!.workspace.id,
      selectedWorkspaceSession?.id,
    ),
    staleTime: 10_000,
    refetchInterval: () => (
      typeof document !== 'undefined' && document.hidden
        ? false
        : GIT_WORKING_TREE_REFRESH_MS
    ),
  })
  const gitWorkingTreeSummary = useMemo(() => {
    const result = gitWorkingTreeDiffQuery.data
    if (!result?.ok) {
      return null
    }

    return result.files.reduce((summary, file) => ({
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }), { additions: 0, deletions: 0 })
  }, [gitWorkingTreeDiffQuery.data])
  const handleOpenProjectEdit = projectEditDialog.handleOpenProjectEdit
  const handleSubmitProjectEdit = projectEditDialog.handleSubmitProjectEdit
  const handleReimportProjectEnvironmentTemplate = projectEditDialog.handleReimportProjectEnvironmentTemplate

  const handleDeleteProject = async (options: { projectName: string; deleteProjectDirectory: boolean }) => {
    if (!projectEditDialog.editingProject) {
      return
    }

    const response = await runMutation(() => api.deleteProject(projectEditDialog.editingProject!.id, options))
    if (response) {
      projectEditDialog.handleProjectEditOpenChange(false)
    }
  }

  useEffect(() => {
    if (search.create === '1' || panelMode === 'create') {
      return
    }

    if (!selectedItem || selectedItem.workspace.id !== selectedWorkspaceId) {
      return
    }

    if (routeWorkspaceId && selectedWorkspaceId !== routeWorkspaceId) {
      return
    }

    const pendingWorkspaceSessionSelectionId = pendingWorkspaceSessionSelectionIdRef.current
    const pendingWorkspaceSessionSelectionExists = pendingWorkspaceSessionSelectionId
      && selectedWorkspaceSessions.some((session) => session.id === pendingWorkspaceSessionSelectionId)

    if (pendingWorkspaceSessionSelectionId && !pendingWorkspaceSessionSelectionExists) {
      return
    }

    const nextSessionId = pendingWorkspaceSessionSelectionExists
      ? pendingWorkspaceSessionSelectionId
      : selectedWorkspaceSessions.some((session) => session.id === selectedWorkspaceSessionId)
        ? selectedWorkspaceSessionId
        : selectedWorkspaceSessions[0]?.id || ''
    if (selectedWorkspaceSessionId !== nextSessionId) {
      setSelectedWorkspaceSessionId(nextSessionId)
    }
    rememberWorkspaceTabRoute(selectedItem.workspace.id, {
      projectId: selectedItem.project.id,
      workspaceSessionId: nextSessionId || undefined,
    })
    if (search.workspaceSessionId === (nextSessionId || undefined)) {
      return
    }
    updateWorkspaceSearch({
      taskId: undefined,
      workspaceSessionId: nextSessionId || undefined,
    }, true)
  }, [panelMode, routeWorkspaceId, search.create, search.workspaceSessionId, selectedItem, selectedWorkspaceId, selectedWorkspaceSessionId, selectedWorkspaceSessions])

  useEffect(() => {
    const pendingWorkspaceSessionSelectionId = pendingWorkspaceSessionSelectionIdRef.current
    if (
      !pendingWorkspaceSessionSelectionId
      || search.workspaceSessionId !== pendingWorkspaceSessionSelectionId
      || selectedWorkspaceSessionId !== pendingWorkspaceSessionSelectionId
      || !selectedWorkspaceSessions.some((session) => session.id === pendingWorkspaceSessionSelectionId)
    ) {
      return
    }

    pendingWorkspaceSessionSelectionClearTimerRef.current = setTimeout(() => {
      if (
        pendingWorkspaceSessionSelectionIdRef.current === pendingWorkspaceSessionSelectionId
        && selectedWorkspaceSessionIdRef.current === pendingWorkspaceSessionSelectionId
      ) {
        pendingWorkspaceSessionSelectionIdRef.current = ''
        pendingWorkspaceSessionSelectionClearTimerRef.current = null
        setOptimisticWorkspaceSession((current) => (
          current?.id === pendingWorkspaceSessionSelectionId ? null : current
        ))
      }
    }, 5000)

    return () => {
      if (pendingWorkspaceSessionSelectionClearTimerRef.current) {
        clearTimeout(pendingWorkspaceSessionSelectionClearTimerRef.current)
        pendingWorkspaceSessionSelectionClearTimerRef.current = null
      }
    }
  }, [search.workspaceSessionId, selectedWorkspaceSessionId, selectedWorkspaceSessions])

  useEffect(() => {
    setShellTitleDraft(selectedItem?.workspace.name || '')
    setIsEditingShellTitle(false)
  }, [selectedItem?.workspace.id, selectedItem?.workspace.name])

  useEffect(() => {
    if (!gitPanelEnabled && activePrimaryView === 'git') {
      setActivePrimaryView('chat')
    }
  }, [activePrimaryView, gitPanelEnabled])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    clearPendingWorkspaceSessionSelection()
    const targetItem = visibleWorkspaceItems.find((item) => item.workspace.id === workspaceId)
    ensureDirectoryProjectLoaded(targetItem?.project.id)
    pendingWorkspaceSelectionIdRef.current = workspaceId
    openWorkspaceTab({
      workspaceId,
      projectId: targetItem?.project.id,
    })
    setSelectedWorkspaceId(workspaceId)
    updateWorkspaceSearch({
      projectId: targetItem?.project.id,
      workspaceId,
      taskId: undefined,
      workspaceSessionId: undefined,
    })
    setPanelMode('detail')
    if (isMobile) {
      setMobileView('detail')
    }
  }, [
    clearPendingWorkspaceSessionSelection,
    ensureDirectoryProjectLoaded,
    isMobile,
    updateWorkspaceSearch,
    visibleWorkspaceItems,
  ])

  const handleSelectWorkspaceSessionTarget = useCallback(({
    workspaceId,
    workspaceSessionId,
  }: {
    workspaceId: string
    workspaceSessionId: string
    taskId?: string
  }) => {
    clearPendingWorkspaceSessionSelection()
    clearSelectedLocalSessionPreview()
    pendingWorkspaceSelectionIdRef.current = workspaceId
    const nextWorkspaceSession = state.workspaceSessions.find((session) => (
      session.id === workspaceSessionId && session.workspaceId === workspaceId
    ))
    if (nextWorkspaceSession) {
      markWorkspaceSessionRead(nextWorkspaceSession)
    }
    const targetItem = visibleWorkspaceItems.find((item) => item.workspace.id === workspaceId)
    openWorkspaceTab({
      workspaceId,
      projectId: targetItem?.project.id,
      workspaceSessionId,
    })
    setSelectedWorkspaceId(workspaceId)
    setSelectedWorkspaceSessionId(workspaceSessionId)
    const nextMobileView = isMobile ? 'detail' : undefined
    updateWorkspaceSearch({
      projectId: targetItem?.project.id,
      workspaceId,
      taskId: undefined,
      workspaceSessionId,
      mobileView: nextMobileView,
    }, shouldReplaceWorkspacesDetailHistoryEntry({
      isMobile,
      nextMobileView,
    }))
    setPanelMode('detail')
    if (isMobile) {
      setMobileView('detail')
    }
  }, [
    clearPendingWorkspaceSessionSelection,
    clearSelectedLocalSessionPreview,
    isMobile,
    state.workspaceSessions,
    state.taskWorkspaceBindings,
    updateWorkspaceSearch,
    visibleWorkspaceItems,
  ])

  const handleBindWorkspaceTask = async () => {
    if (!selectedItem || !bindTaskId) {
      toast.error(t('workspace.page.errors.selectBindTaskFirst'))
      return
    }

    setBindBusy(true)
    try {
      const targetTask = bindableTasks.find((task) => task.id === bindTaskId)
      const response = await api.bindTaskWorkspace(bindTaskId, selectedItem.workspace.id, {
        baseBranch: selectedItem.workspace.suggestedBaseBranch || selectedItem.workspace.defaultBranch || targetTask?.baseBranch || targetTask?.baseBranchHint || selectedItem.project.defaultBranch || undefined,
      })
      const nextSession = response.workspaceSession
        ?? response.state.workspaceSessions.find((session) => session.id === response.workspaceSessionId)
        ?? listWorkspaceSessionsForWorkspace({
          workspaceId: selectedItem.workspace.id,
          workspaceSessions: response.state.workspaceSessions,
        })[0]

      setState(response.state)
      setSelectedWorkspaceSessionId(nextSession?.id || '')
      setWorkspacePrimaryViewState(selectedItem.workspace.id, 'chat')
      updateWorkspaceSearch({
        taskId: undefined,
        workspaceSessionId: nextSession?.id,
        panel: undefined,
      })
      setBindDialogOpen(false)
      setBindTaskId('')
      toast.success(t('workspace.page.bindSuccess'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.bindFailed'))
    } finally {
      setBindBusy(false)
    }
  }

  useEffect(() => {
    if (!pendingAutoEnvironmentInstallWorkspaceId) {
      return
    }

    if (selectedItem?.workspace.id !== pendingAutoEnvironmentInstallWorkspaceId) {
      return
    }

    if (!effectiveWorkspaceTask || !selectedWorkspaceSession) {
      return
    }

    const shouldAutoEnvironmentInstall = Boolean(environmentPreview?.installCommand?.trim())
    if (!shouldAutoEnvironmentInstall) {
      return
    }

    setPendingAutoEnvironmentInstallWorkspaceId(null)

    void (async () => {
      try {
        if (selectedWorkspaceSession.workingDirectoryMode !== 'worktree') {
          return
        }

        const response = await api.ensureTaskWorktree(
          effectiveWorkspaceTask.id,
          selectedItem.workspace.id,
          selectedWorkspaceSession.id,
          undefined,
          true,
        )
        setState(response.state)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('workspace.environment.installPrepareFailed', {
          defaultValue: '工作目录准备失败，未能自动执行安装命令。',
        }))
      }
    })()
  }, [
    environmentPreview?.installCommand,
    pendingAutoEnvironmentInstallWorkspaceId,
    selectedItem?.workspace.id,
    selectedWorkspaceSession,
    effectiveWorkspaceTask,
    t,
  ])

  useEffect(() => {
    if (search.autoEnvironmentInstall !== '1') {
      return
    }

    if (!routeWorkspaceId || selectedItem?.workspace.id !== routeWorkspaceId) {
      return
    }

    setPendingAutoEnvironmentInstallWorkspaceId(routeWorkspaceId)
    updateWorkspaceSearch({
      autoEnvironmentInstall: undefined,
    }, true)
  }, [routeWorkspaceId, search.autoEnvironmentInstall, selectedItem?.workspace.id])

  const handleDeleteWorkspace = (item: WorkspaceListItem) => {
    setDeleteWorkspaceDialogItem(item)
  }

  const handleConfirmDeleteWorkspace = async (options: DeleteWorkspaceOptions) => {
    const item = deleteWorkspaceDialogItem
    if (!item) {
      return
    }

    const deletedWorkspaceId = item.workspace.id
    const deletingCurrentWorkspace = deletedWorkspaceId === routeWorkspaceId || deletedWorkspaceId === selectedWorkspaceId
    const nextVisibleWorkspaceItem = visibleWorkspaceItems.find((candidate) => candidate.workspace.id !== deletedWorkspaceId) ?? null

    setDeleteWorkspaceBusy(true)
    try {
      const response = await runMutation(() => api.deleteWorkspace(item.workspace.id, options))
      if (!response) {
        return
      }

      queryClient.setQueryData<ProjectWorkspacesQueryData>(
        workspaceQueryKeys.projectWorkspaces(item.project.id),
        (current) => current
          ? {
              ...current,
              workspaces: current.workspaces.filter((workspace) => workspace.id !== deletedWorkspaceId),
            }
          : current,
      )
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            workspacesByProject: {
              ...current.workspacesByProject,
              [item.project.id]: (current.workspacesByProject[item.project.id] ?? []).filter((workspace) => workspace.id !== deletedWorkspaceId),
            },
          }
        : current)
      closeWorkspaceTab(deletedWorkspaceId)
      if (deletingCurrentWorkspace) {
        pendingWorkspaceSelectionIdRef.current = nextVisibleWorkspaceItem?.workspace.id || ''
        clearPendingWorkspaceSessionSelection()
        clearSelectedLocalSessionPreview()
        setSelectedWorkspaceId(nextVisibleWorkspaceItem?.workspace.id || '')
        setSelectedWorkspaceSessionId('')
        updateWorkspaceSearch({
          projectId: nextVisibleWorkspaceItem?.project.id || search.projectId || item.project.id,
          workspaceId: nextVisibleWorkspaceItem?.workspace.id || undefined,
          taskId: undefined,
          workspaceSessionId: undefined,
          launchId: undefined,
          autoEnvironmentInstall: undefined,
        }, true)
      }
      setDeleteWorkspaceDialogItem(null)
    } finally {
      setDeleteWorkspaceBusy(false)
    }
  }

  const handleRenameWorkspace = async () => {
    if (!selectedItem) {
      return
    }

    const nextName = shellTitleDraft.trim()
    if (!nextName) {
      toast.error(t('workspace.rename.emptyTitle'))
      return
    }

    if (nextName === selectedItem.workspace.name) {
      setIsEditingShellTitle(false)
      return
    }

    setRenameBusy(true)
    try {
      const response = await api.updateWorkspace(selectedItem.workspace.id, { name: nextName })
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            workspacesByProject: {
              ...current.workspacesByProject,
              [selectedItem.project.id]: response.workspaces,
            },
          }
        : current)
      setShellTitleDraft(response.workspace.name)
      setIsEditingShellTitle(false)
      toast.success(response.message || t('workspace.rename.updated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.rename.updateFailed'))
    } finally {
      setRenameBusy(false)
    }
  }

  const handleUpdateWorkspaceAutoCommit = async (enabled: boolean) => {
    if (!selectedItem) {
      return false
    }

    if (resolveWorkspaceAutoCommitEnabled(selectedItem.workspace) === enabled) {
      return true
    }

    setAutoCommitBusy(true)
    try {
      const response = await api.updateWorkspace(selectedItem.workspace.id, {
        name: selectedItem.workspace.name,
        autoCommitEnabled: enabled,
      })
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            workspacesByProject: {
              ...current.workspacesByProject,
              [selectedItem.project.id]: response.workspaces,
            },
          }
        : current)
      toast.success(
        enabled
          ? t('workspace.page.autoCommitEnabled')
          : t('workspace.page.autoCommitDisabled'),
      )
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.updateAutoCommitFailed'))
      return false
    } finally {
      setAutoCommitBusy(false)
    }
  }

  const openWorkspaceSettings = () => {
    if (!selectedItem) {
      return
    }

    setShellTitleDraft(selectedItem.workspace.name)
    setWorkspaceSettingsAutoCommitEnabled(resolveWorkspaceAutoCommitEnabled(selectedItem.workspace))
    setWorkspaceSettingsOpen(true)
  }

  const openProjectSettingsFromWorkspaceSettings = (projectId: string) => {
    setWorkspaceSettingsOpen(false)
    handleOpenProjectEdit(projectId)
  }

  const installWorkspaceCommand = environmentCommands.installCommand?.trim() || ''
  const workspaceSearchState: WorkspaceRouteSearch = buildWorkspacesRouteSearch({
    projectId: selectedItem?.project.id || search.projectId,
    workspaceId: selectedItem?.workspace.id || routeWorkspaceId,
    workspaceSessionId: selectedWorkspaceSession?.id || search.workspaceSessionId,
    launchId: search.launchId,
    autoEnvironmentInstall: search.autoEnvironmentInstall,
    panel: activePrimaryView === 'chat' ? undefined : activePrimaryView,
    terminal: currentWorkspaceTerminalCollapsed ? undefined : '1',
  })
  const {
    activeLaunch,
    chatRef,
    chatReady,
    handleChatRef,
    launchError,
    launchPrefill,
    launchStatus,
    refreshWorkspaceSessionView,
  } = useWorkspaceLaunch({
    currentWorkspace: selectedItem?.workspace ?? null,
    matchedWorkspaceSession,
    navigate: ({ search: nextSearch, replace }) => navigateWorkspaceSearch(nextSearch, replace),
    project: routeProject,
    route: '/workspaces',
    search: workspaceSearchState,
    selectedWorkspaceSessionId,
    setState,
    state,
    task: searchTask,
    workspaceSession: selectedWorkspaceSession,
    workspaceSessions: selectedWorkspaceSessions,
    workspaceTask: selectedWorkspaceTask,
    t,
  })
  refreshWorkspaceSessionViewRef.current = refreshWorkspaceSessionView
  useEffect(() => {
    const selectedWorkspaceChatVisible = Boolean(
      selectedItem
      && effectiveDisplayTask
      && !selectedLocalSessionKey
      && !selectedLocalSessionDetail
      && !localSessionDetailLoading
    )
    if (!selectedWorkspaceChatVisible) {
      handleChatRef(null)
    }
  }, [
    effectiveDisplayTask,
    handleChatRef,
    localSessionDetailLoading,
    selectedItem,
    selectedLocalSessionDetail,
    selectedLocalSessionKey,
  ])
  const requestTestingController = useCallback(() => {
    setTestingControllerRequested(true)
  }, [])
  const handleTestingControllerStateChange = useCallback((nextTestingState: WorkspacesTestingState | null) => {
    setTestingControllerState(nextTestingState)
  }, [])
  useEffect(() => {
    if (activePrimaryView === 'preview' || activePrimaryView === 'records') {
      setTestingControllerRequested(true)
    }
  }, [activePrimaryView])
  const shouldMountTestingController = Boolean(
    selectedItem
    && effectiveDisplayTask
    && (
      testingControllerRequested
      || activePrimaryView === 'preview'
      || activePrimaryView === 'records'
    ),
  )
  const environmentBusyAction = testingControllerState?.environmentBusyAction ?? null
  const previewBusyAction = testingControllerState?.previewBusyAction ?? null
  const previewSession = testingControllerState?.previewSession ?? null
  const previewShareUrl = testingControllerState?.previewShareUrl ?? ''
  const previewOpen = Boolean(previewSession && previewSession.status !== 'closed' && previewSession.status !== 'error')
  const previewViewer = testingControllerState?.previewViewer ?? null
  const environmentPreviewSources = useMemo(() => buildWorkspacePreviewSourceOptions({
    preview: {
      sourceAppUrl: previewSession?.sourceAppUrl || environmentPreview?.appUrl,
      domainBindings: previewSession?.domainBindings ?? environmentPreview?.domainBindings,
      additionalSourceAppUrls: previewSession?.additionalSourceAppUrls,
    },
    fallbackSourceAppUrl: previewSession?.sourceAppUrl || environmentPreview?.appUrl,
  }), [
    environmentPreview?.appUrl,
    environmentPreview?.domainBindings,
    previewSession?.additionalSourceAppUrls,
    previewSession?.domainBindings,
    previewSession?.sourceAppUrl,
  ])

  const repairingObservationId = testingControllerState?.repairingObservationId ?? null
  const testRecordLiveStatus = testingControllerState?.testRecordLiveStatus ?? 'closed'
  const testRecordLoading = testingControllerState?.testRecordLoading ?? false
  const testRecordMessages = testingControllerState?.testRecordMessages ?? []
  const testRecordRefreshing = testingControllerState?.testRecordRefreshing ?? false
  const markEnvironmentTerminalClosed = useCallback(() => {
    testingControllerState?.markEnvironmentTerminalClosed()
  }, [testingControllerState])
  const handleOpenWorkspacePreview = useCallback<WorkspacesTestingState['handleOpenWorkspacePreview']>(async (options) => {
    requestTestingController()
    await testingControllerState?.handleOpenWorkspacePreview(options)
  }, [requestTestingController, testingControllerState])
  const handleOpenWorkspacePreviewInBrowser = useCallback<WorkspacesTestingState['handleOpenWorkspacePreviewInBrowser']>((targetPreviewUrl, options) => {
    requestTestingController()
    testingControllerState?.handleOpenWorkspacePreviewInBrowser(targetPreviewUrl, options)
  }, [requestTestingController, testingControllerState])
  const handleBackToParentSession = useCallback<WorkspacesTestingState['handleBackToParentSession']>(async () => {
    requestTestingController()
    if (!testingControllerState) {
      setPendingTestingAction({ type: 'back-to-parent' })
      return
    }
    await testingControllerState.handleBackToParentSession()
  }, [requestTestingController, testingControllerState])
  const handleCreateRepairSession = useCallback<WorkspacesTestingState['handleCreateRepairSession']>(async (observation) => {
    requestTestingController()
    await testingControllerState?.handleCreateRepairSession(observation)
  }, [requestTestingController, testingControllerState])
  const handleRefreshWorkspacePreview = useCallback<WorkspacesTestingState['handleRefreshWorkspacePreview']>(async () => {
    requestTestingController()
    await testingControllerState?.handleRefreshWorkspacePreview()
  }, [requestTestingController, testingControllerState])
  const handleRevokeWorkspacePreviewShare = useCallback<WorkspacesTestingState['handleRevokeWorkspacePreviewShare']>(async () => {
    requestTestingController()
    await testingControllerState?.handleRevokeWorkspacePreviewShare()
  }, [requestTestingController, testingControllerState])
  const handleRunEnvironmentAction = useCallback<WorkspacesTestingState['handleRunEnvironmentAction']>(async (action) => {
    requestTestingController()
    if (!testingControllerState) {
      setPendingTestingAction({ type: 'environment', action })
      return
    }
    await testingControllerState.handleRunEnvironmentAction(action)
  }, [requestTestingController, testingControllerState])
  const handleShareWorkspacePreview = useCallback<WorkspacesTestingState['handleShareWorkspacePreview']>(async () => {
    requestTestingController()
    await testingControllerState?.handleShareWorkspacePreview()
  }, [requestTestingController, testingControllerState])
  const handleStopWorkspacePreview = useCallback<WorkspacesTestingState['handleStopWorkspacePreview']>(async () => {
    requestTestingController()
    await testingControllerState?.handleStopWorkspacePreview()
  }, [requestTestingController, testingControllerState])
  const loadTestRecordMessages = useCallback<WorkspacesTestingState['loadTestRecordMessages']>(async (options) => {
    requestTestingController()
    await testingControllerState?.loadTestRecordMessages(options)
  }, [requestTestingController, testingControllerState])
  useEffect(() => {
    if (!testingControllerState || !pendingTestingAction) {
      return
    }

    const action = pendingTestingAction
    setPendingTestingAction(null)
    if (action.type === 'environment') {
      void testingControllerState.handleRunEnvironmentAction(action.action)
      return
    }
    void testingControllerState.handleBackToParentSession()
  }, [pendingTestingAction, testingControllerState])
  useEffect(() => (
    syncSelectedWorkspaceTerminalPresence()
  ), [syncSelectedWorkspaceTerminalPresence])

  const sandboxAndRemoteCode = useDesktopSandboxAndRemoteCode({
    activePrimaryView,
    clearPendingWorkspaceSessionSelection,
    clearSelectedLocalSessionPreview: () => clearSelectedLocalSessionPreviewRef.current(),
    clearWorkspaceEnvironmentRunningForWorkspace,
    displayTask: effectiveDisplayTask,
    markEnvironmentTerminalClosed,
    previewSession,
    handleStopWorkspacePreview,
    runMutation,
    selectedWorkspaceId,
    selectedWorkspaceIdRef,
    selectedWorkspaceSession,
    selectedItem,
    setActivePrimaryView,
    setTerminalCollapsedState,
    setTerminalMaximized,
    setWorkspaceTerminalCollapsedUi: setWorkspaceTerminalCollapsedUi,
    setWorkspaceTerminalOpen,
    setWorkspaceTerminalOpenUi: setWorkspaceTerminalOpenUi,
    setWorkspacePrimaryViewState,
    setSelectedWorkspaceSessionId,
    updateWorkspaceDirectoryCache,
    updateWorkspaceSearch,
  })
  const {
    archiveWorkspaceBusyId,
    archiveWorkspaceProgress,
    desktopSandbox,
    desktopSandboxBusyAction,
    desktopSandboxDisplayProfile,
    handleArchiveWorkspace,
    handleDesktopSandboxDisplayProfileChange,
    handleOpenDesktopSandbox,
    handleOpenDesktopSandboxExternal,
    handleOpenRemoteCode,
    handleRefreshDesktopSandbox,
    handleRunDesktopSandboxAction,
    handleRunDesktopSandboxCommand,
    handleStopDesktopSandbox,
    handleStopRemoteCode,
    openDesktopSandboxPanel,
    remoteCode,
    remoteCodeBusyAction,
  } = sandboxAndRemoteCode

  useEffect(() => {
    const chat = chatRef.current
    if (
      !pendingPostForkAction
      || pendingPostForkAction.targetWorkspaceSessionId !== (selectedWorkspaceSession?.id || '')
      || !chatReady
      || !chat
    ) {
      return
    }

    const run = async () => {
      if (pendingPostForkAction.action === 'prefill') {
        chat.prepareDraft(pendingPostForkAction.draft)
        setPendingPostForkAction(null)
        return
      }

      const sent = await chat.sendPreparedMessage(pendingPostForkAction.draft)
      if (sent) {
        setPendingPostForkAction(null)
      }
    }

    void run()
  }, [chatReady, chatRef, pendingPostForkAction, selectedWorkspaceSession?.id])

  useEffect(() => {
    setActiveWorkspaceOpenTarget(getStoredWorkspaceOpenTarget(state.config.workspaceOpenSettings.defaultTarget))
  }, [state.config.workspaceOpenSettings.defaultTarget])

  async function openCurrentWorkspaceInTarget(target: WorkspaceOpenTarget) {
    if (openingWorkspaceTarget) {
      return
    }

    const executorName = selectedWorkspaceExecutorName || selectedItem?.workspace.executorName || t('workspace.executor.currentNode', { defaultValue: '当前节点' })
    setOpeningWorkspaceTarget(target)
    try {
      const opened = await openWorkspaceInTarget({
        executorId: selectedWorkspaceExecutorId,
        executorName,
        platform: selectedWorkspaceExecutor?.platform,
        candidateCwds: selectedWorkspaceCandidateCwds,
        target,
        customCommand: state.config.workspaceOpenSettings.customCommand,
        debugPrefix: '[Wemux][Workspace Open][/workspaces]',
        t,
      })
      if (opened) {
        setStoredWorkspaceOpenTarget(target)
        setActiveWorkspaceOpenTarget(target)
      }
    } finally {
      setOpeningWorkspaceTarget(null)
    }
  }

  const desktopPersistentTerminal = useMemo(() => {
    if (isMobile || !selectedItem) {
      return null
    }

    return {
      collapsed: currentWorkspaceTerminalCollapsed,
      cwd: selectedWorkspaceCwd,
      executorId: selectedWorkspaceExecutorId,
      executorName: selectedWorkspaceExecutorName,
      projectId: selectedItem.project.id,
      workspaceId: selectedItem.workspace.id,
      workspaceName: selectedItem.workspace.name,
      installCommand: installWorkspaceCommand,
      startCommand: environmentPreview?.startCommand,
      logsCommand: environmentPreview?.logsCommand,
      maximized: terminalMaximized,
      panelKey: selectedItem.workspace.id,
      commandRequest: terminalCommandRequest,
      onCollapsedChange: setTerminalCollapsed,
      onMaximizedChange: setTerminalMaximized,
      onOpenStateChange: (open: boolean) => {
        setWorkspaceTerminalOpenUi(selectedItem.workspace.id, open)
        if (!open) {
          markEnvironmentTerminalClosed()
          clearWorkspaceEnvironmentRunningForWorkspace(selectedItem.workspace.id)
        }
      },
      onOpenWorkspaceTarget: async () => {
        await openCurrentWorkspaceInTarget(activeWorkspaceOpenTarget)
      },
    }
  }, [
    activeWorkspaceOpenTarget,
    currentWorkspaceTerminalCollapsed,
    clearWorkspaceEnvironmentRunningForWorkspace,
    environmentPreview?.logsCommand,
    environmentPreview?.startCommand,
    installWorkspaceCommand,
    isMobile,
    markEnvironmentTerminalClosed,
    openCurrentWorkspaceInTarget,
    selectedItem,
    selectedWorkspaceCwd,
    selectedWorkspaceExecutorId,
    selectedWorkspaceExecutorName,
    setTerminalCollapsed,
    terminalCommandRequest,
    terminalMaximized,
  ])
  useDesktopPersistentWorkspaceTerminal(desktopPersistentTerminal)

  const togglePanel = (panel: Exclude<WorkspacePrimaryView, 'chat'>) => {
    setActivePrimaryView((current) => current === panel ? 'chat' : panel)
  }
  const togglePreviewPanel = () => {
    if (activePrimaryView === 'preview') {
      setActivePrimaryView('chat')
      return
    }

    setActivePrimaryView('preview')
  }

  const handleOpenWorkspaceFileLink = (href: string) => {
    if (!isLikelyWorkspaceFileLinkHref(href)) {
      return false
    }

    const resolvedFilePath = resolveWorkspaceFileLinkPath({
      href,
      baseDirectoryPath: selectedWorkspaceRuntime?.repoPath || selectedWorkspaceFileExplorerRootPath || selectedWorkspaceCwd,
      candidateRootPaths: selectedWorkspaceFileScopeRootPaths,
    })

    if (!resolvedFilePath) {
      toast.error(t('workspace.files.errors.outOfScope', { defaultValue: '该文件不在当前工作区目录内。' }))
      return true
    }

    if (!selectedWorkspaceExecutorId) {
      toast.error(t('workspace.files.noDirectory', { defaultValue: '当前没有可浏览目录。' }))
      return true
    }

    workspaceFileRequestIdRef.current += 1
    setWorkspaceFileOpenRequest({
      filePath: resolvedFilePath,
      requestId: workspaceFileRequestIdRef.current,
    })
    setActivePrimaryView('files')
    return true
  }

  const localSessionPreviewActive = Boolean(selectedLocalSessionKey || selectedLocalSessionDetail || localSessionDetailLoading)
  const visibleGitWorkingTreeSummary = gitWorkingTreeSummary && (gitWorkingTreeSummary.additions > 0 || gitWorkingTreeSummary.deletions > 0)
    ? gitWorkingTreeSummary
    : null
  const gitToolbarTitle = visibleGitWorkingTreeSummary
    ? `Git（未提交改动：+${visibleGitWorkingTreeSummary.additions.toLocaleString()} / -${visibleGitWorkingTreeSummary.deletions.toLocaleString()}）`
    : 'Git'
  const gitToolbarAriaLabel = visibleGitWorkingTreeSummary
    ? `Git，未提交改动新增 ${visibleGitWorkingTreeSummary.additions.toLocaleString()}，删除 ${visibleGitWorkingTreeSummary.deletions.toLocaleString()}`
    : 'Git'
  const toolButtonClass = (active = false) => active
    ? 'h-7 w-7 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100'
    : 'h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40'
  const toolbarDivider = <div aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-800" />

  const workspaceHeaderToolbar = !localSessionPreviewActive && selectedItem ? (
    <div className="flex items-center gap-1 pr-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => togglePanel('files')}
        className={toolButtonClass(activePrimaryView === 'files')}
        aria-label="文件树"
        title="文件树"
      >
        <FolderTree className="h-3.5 w-3.5" />
      </Button>
      {gitPanelEnabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => togglePanel('git')}
          className={cn(
            toolButtonClass(activePrimaryView === 'git'),
            visibleGitWorkingTreeSummary ? 'w-auto gap-1.5 px-2 font-mono text-[10px] leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]' : null,
          )}
          aria-label={gitToolbarAriaLabel}
          title={gitToolbarTitle}
        >
          <GitBranch className="h-3.5 w-3.5" />
          {visibleGitWorkingTreeSummary ? (
            <>
              <span className="text-emerald-400">+{visibleGitWorkingTreeSummary.additions.toLocaleString()}</span>
              <span className="text-rose-400">-{visibleGitWorkingTreeSummary.deletions.toLocaleString()}</span>
            </>
          ) : null}
        </Button>
      ) : null}
      {gitPanelEnabled ? toolbarDivider : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={startSelectedWorkspaceEnvironment}
        disabled={Boolean(environmentBusyAction) || !environmentPreview?.startCommand}
        className={toolButtonClass()}
        aria-label={environmentStartInTerminal ? '在终端启动环境' : '启动环境'}
        title={environmentStartInTerminal ? '在终端启动环境' : '启动环境'}
      >
        {environmentBusyAction === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      {shouldShowEnvironmentStop ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => stopSelectedWorkspaceEnvironment(canStopEnvironment)}
          disabled={Boolean(environmentBusyAction) || !canStopEnvironment}
          className={toolButtonClass()}
          aria-label={environmentStartInTerminal ? '停止终端环境' : '停止环境'}
          title={environmentStartInTerminal ? '停止终端环境' : '停止环境'}
        >
          {environmentBusyAction === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
      {environmentPreview?.appUrl ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={togglePreviewPanel}
          disabled={!canOpenEnvironmentPreview || previewBusyAction === 'open'}
          className={cn(toolButtonClass(activePrimaryView === 'preview'), 'relative')}
          aria-label="开发预览"
          title="开发预览"
        >
          {previewBusyAction === 'open' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {previewOpen ? (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
          ) : null}
        </Button>
      ) : null}
      {DESKTOP_SANDBOX_ENABLED ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openDesktopSandboxPanel}
          disabled={!effectiveDisplayTask}
          className={cn(toolButtonClass(activePrimaryView === 'desktop'), 'w-auto gap-1.5 px-2 text-[11px]')}
          aria-label="Desktop Sandbox"
          title="Desktop Sandbox"
        >
          <Monitor className="h-3.5 w-3.5" />
          Desktop
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleToggleSelectedWorkspaceTerminal}
        className={cn(
          selectedWorkspaceTerminalActive
            ? toolButtonClass(true)
            : toolButtonClass(!currentWorkspaceTerminalCollapsed),
          'relative',
        )}
        aria-label={selectedWorkspaceTerminalKeptAlive ? '展开后台终端' : currentWorkspaceTerminalCollapsed ? '展开终端' : '折叠终端'}
        title={selectedWorkspaceTerminalKeptAlive ? '终端正在后台保持连接，点击展开' : currentWorkspaceTerminalCollapsed ? '展开终端' : '折叠终端'}
      >
        <TerminalSquare className="h-3.5 w-3.5" />
        {selectedWorkspaceTerminalOpen ? (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
        ) : null}
      </Button>
      {toolbarDivider}
      <WorkspaceOpenAction
        busy={Boolean(openingWorkspaceTarget)}
        disabled={selectedWorkspaceCandidateCwds.length === 0}
        activeTarget={activeWorkspaceOpenTarget}
        onOpen={(target) => void openCurrentWorkspaceInTarget(target)}
        buttonClassName="gap-0"
        menuClassName={toolButtonClass()}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void handleOpenRemoteCode()}
        disabled={!effectiveDisplayTask || remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel'}
        className={cn(
          toolButtonClass(remoteCode?.phase === 'ready'),
          'w-auto gap-1.5 px-2 text-[11px]',
        )}
        aria-label="Code Server"
        title="Code Server"
      >
        {remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Code2 className="h-3.5 w-3.5" />}
        {remoteCodeBusyAction === 'tunnel' ? '建立隧道' : 'Code Server'}
      </Button>
    </div>
  ) : null

  const workspaceActionsMenu = selectedItem ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          aria-label={t('workspace.pageView.actions.workspaceActions')}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={bindableTasks.length === 0}
          onSelect={() => {
            setBindTaskId(selectedWorkspaceTask?.id || bindableTasks[0]?.id || '')
            setBindDialogOpen(true)
          }}
        >
          <Link2 className="h-4 w-4" />
          绑定任务
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openWorkspaceSettings}>
          <SlidersHorizontal className="h-4 w-4" />
          工作区设置
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setActivePrimaryView('preview')} disabled={!canOpenEnvironmentPreview || previewBusyAction === 'open'}>
          {previewBusyAction === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          开发预览
        </DropdownMenuItem>
        {DESKTOP_SANDBOX_ENABLED ? (
          <DropdownMenuItem onSelect={openDesktopSandboxPanel} disabled={!effectiveDisplayTask}>
            <Monitor className="h-4 w-4" />
            Desktop Sandbox
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void handleOpenRemoteCode()} disabled={!effectiveDisplayTask || remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel'}>
          {remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
          {remoteCodeBusyAction === 'tunnel' ? '建立 Code Server 隧道' : 'Code Server'}
        </DropdownMenuItem>
        {remoteCode?.phase === 'ready' ? (
          <DropdownMenuItem onSelect={() => void handleStopRemoteCode()} disabled={remoteCodeBusyAction === 'stop'}>
            {remoteCodeBusyAction === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            停止 Code Server
          </DropdownMenuItem>
        ) : null}
        {parentWorkspaceSession ? (
          <DropdownMenuItem onSelect={() => void handleBackToParentSession()}>
            <ArrowLeftRight className="h-4 w-4" />
            {parentWorkspaceSession.sessionRole === 'tester' ? '返回测试会话' : '返回父会话'}
          </DropdownMenuItem>
        ) : null}
        {selectedWorkspaceSession ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={workspaceSessionShare.openShareDialog}>
              <Share2 className="h-4 w-4" />
              分享会话
            </DropdownMenuItem>
            {canMarkSelectedWorkspaceSessionUnread ? (
              <DropdownMenuItem onSelect={handleMarkSelectedWorkspaceSessionUnread}>
                <CircleDot className="h-4 w-4" />
                {t('workspace.pageView.actions.markCurrentSessionUnread', { defaultValue: '设为未读' })}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={openSelectedWorkspaceSessionRenameDialog}>
              <Pencil className="h-4 w-4" />
              {t('workspace.pageView.actions.renameCurrentSession')}
            </DropdownMenuItem>
            {selectedWorkspaceSessions.length > 1 ? (
              <DropdownMenuItem
                onSelect={() => {
                  void handleDeleteWorkspaceSession(selectedWorkspaceSession.id)
                }}
                disabled={deletingWorkspaceSessionId === selectedWorkspaceSession.id}
                className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
              >
                {deletingWorkspaceSessionId === selectedWorkspaceSession.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t('workspace.pageView.actions.deleteCurrentSession')}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {canDeleteWorkspaceRecord(selectedItem.workspace) ? (
          <>
            <DropdownMenuSeparator />
            {selectedItem.workspace.source === 'manual' ? (
              <DropdownMenuItem
                onSelect={() => {
                  void handleArchiveWorkspace(selectedItem, selectedItem.workspace.status !== 'archived')
                }}
                disabled={busy || archiveWorkspaceBusyId === selectedItem.workspace.id}
              >
                {archiveWorkspaceBusyId === selectedItem.workspace.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                {selectedItem.workspace.status === 'archived' ? '恢复工作区' : '归档工作区'}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={() => {
                void handleDeleteWorkspace(selectedItem)
              }}
              disabled={busy}
              className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
            >
              <Trash2 className="h-4 w-4" />
              删除工作区
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  const headerActions = selectedItem ? (
    <div className="flex items-center gap-1">
      {workspaceHeaderToolbar}
      {workspaceActionsMenu}
    </div>
  ) : null

  const workspaceLaunchStatusBanner = activeLaunch ? (
        <div
          className={
            launchStatus === 'failed'
              ? 'rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200'
              : 'rounded-lg border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100'
          }
        >
          {launchStatus === 'failed'
            ? t('workspace.launch.failedWithReason', { defaultValue: '工作区启动失败：{{message}}', message: launchError || t('workspace.launch.continueManually', { defaultValue: '请手动继续填写并发送首条消息。' }) })
            : launchStatus === 'done'
              ? t('workspace.launch.done', { defaultValue: '工作区已准备完成，首条消息已预填到发送框。' })
              : t('workspace.launch.preparing', { defaultValue: '正在准备工作区环境，准备完成后会把首条消息预填到发送框。' })}
        </div>
      ) : null
  const statusBanner = workspaceLaunchStatusBanner
    ? <div className="flex flex-col gap-3">{workspaceLaunchStatusBanner}</div>
    : null
  const detailPaneLoading = !createPanelOpen
    && !selectedItem
    && Boolean(routeWorkspaceTargetId)
    && workspaceDirectoryLoading

  const handleTableStartEnvironment = useCallback(async (workspaceId: string) => {
    const item = visibleWorkspaceItems.find((candidate) => candidate.workspace.id === workspaceId)
    if (!item) return

    const session = state.workspaceSessions.find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.status === 'active',
    )
    const task = item.activeTask
    if (!task || !session) {
      toast.error(t('workspace.table.noActiveSession', { defaultValue: '该工作区没有活跃的任务或会话。' }))
      return
    }

    try {
      const response = await api.runTaskEnvironmentAction(task.id, 'start', workspaceId, session.id)
      setState(response.state)
      toast.success(t('workspace.table.environmentStarted', { defaultValue: '正在启动环境...' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.table.environmentStartFailed', { defaultValue: '启动环境失败' }))
    }
  }, [visibleWorkspaceItems, state.workspaceSessions, setState, t])

  const handleTableStopEnvironment = useCallback(async (workspaceId: string) => {
    const item = visibleWorkspaceItems.find((candidate) => candidate.workspace.id === workspaceId)
    if (!item) return

    const session = state.workspaceSessions.find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.status === 'active',
    )
    const task = item.activeTask
    if (!task || !session) {
      toast.error(t('workspace.table.noActiveSession', { defaultValue: '该工作区没有活跃的任务或会话。' }))
      return
    }

    try {
      const response = await api.runTaskEnvironmentAction(task.id, 'stop', workspaceId, session.id)
      setState(response.state)
      toast.success(t('workspace.table.environmentStopped', { defaultValue: '已停止环境。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.table.environmentStopFailed', { defaultValue: '停止环境失败' }))
    }
  }, [visibleWorkspaceItems, state.workspaceSessions, setState, t])

  return (
    <>
      {workspaceSessionShare.shareDialog}
      {projectEditDialog.projectEditOpen ? (
        <Suspense fallback={null}>
          <ProjectEditDialog
            open={projectEditDialog.projectEditOpen}
            onOpenChange={projectEditDialog.handleProjectEditOpenChange}
            draft={projectEditDialog.projectDraft}
            onDraftChange={projectEditDialog.setProjectDraft}
            project={projectEditDialog.editingProject}
            workspaceRoot={state.config.workspaceRoot}
            executors={executors}
            busy={busy}
            reimportBusy={projectEditDialog.projectReimportBusy}
            onReimportEnvironmentTemplate={handleReimportProjectEnvironmentTemplate}
            onSyncProjectSettings={projectEditDialog.handleSyncProjectSettings}
            onSubmit={handleSubmitProjectEdit}
            onDelete={handleDeleteProject}
          />
        </Suspense>
      ) : null}

      <WorkspacesPageView
        isMobile={isMobile}
        mobileView={mobileView}
        panelMode={createPanelOpen ? 'create' : panelMode}
        activeFilteredItems={activeFilteredItems}
        archivedFilteredItems={archivedFilteredItems}
        archivedWorkspaceCount={archivedWorkspaceCount}
        executors={executors}
        onTableStartEnvironment={handleTableStartEnvironment}
        onTableStopEnvironment={handleTableStopEnvironment}
        terminalOpenWorkspaceIds={displayedTerminalOpenWorkspaceIds}
        environmentStartCommandRunningWorkspaceIds={environmentStartCommandRunningWorkspaceIds}
        workspaceEnvironmentStatusesByWorkspaceId={workspaceEnvironmentStatusesByWorkspaceId}
        projectPullRequests={projectPullRequests}
        githubResourceBindings={githubResourceBindings}
        railwayDeployments={railwayDeployments}
        railwayResourceBindings={railwayResourceBindings}
        projects={directoryScopedProjects}
        visibleProjectIds={projectVisibilityFilterIds}
        searchQuery={searchQuery}
        selectedWorkspaceId={selectedItem?.workspace.id || selectedWorkspaceId || routeWorkspaceId}
        selectedItem={selectedItem}
        detailLoading={detailPaneLoading}
        selectedWorkspaceTask={selectedWorkspaceTask}
        displayTask={effectiveDisplayTask}
        selectedWorkspaceSessions={selectedWorkspaceSessions}
        selectedWorkspaceSession={selectedWorkspaceSession}
        workspaceSessionUnreadState={workspaceSessionUnreadState}
        workspaceSessionTokenSummaryById={workspaceSessionTokenSummaryById}
        availableAgents={availableAgents}
        localSessions={visibleLocalSessions}
        localSessionsOpen={localSessionsOpen}
        localSessionsLoading={localSessionsLoading}
        localSessionsRefreshing={localSessionsRefreshing}
        localSessionExecutorName={selectedWorkspaceExecutorName}
        selectedLocalSessionKey={selectedLocalSessionKey}
        workspaceSessionListPlacement={currentWorkspaceSessionListPlacement}
        onWorkspaceSessionListPlacementChange={handleWorkspaceSessionListPlacementChange}
        activePrimaryView={activePrimaryView}
        retainedPrimaryViews={retainedPrimaryViews}
        busy={busy}
        creatingWorkspaceSession={creatingWorkspaceSession}
        reorderingWorkspaceSessions={reorderingWorkspaceSessions}
        shellTitleDraft={shellTitleDraft}
        renameBusy={renameBusy}
        isEditingShellTitle={isEditingShellTitle}
        gitPanelEnabled={gitPanelEnabled}
        bindDialogOpen={bindDialogOpen}
        bindTaskId={bindTaskId}
        bindableTasks={bindableTasks}
        bindBusy={bindBusy}
        workspaceSettingsOpen={workspaceSettingsOpen}
        workspaceNameDraft={shellTitleDraft}
        workspaceRenameBusy={renameBusy}
        workspaceSettingsAutoCommitEnabled={workspaceSettingsAutoCommitEnabled}
        workspaceSettingsSaving={autoCommitBusy}
        statusBanner={statusBanner}
        headerActions={isMobile ? workspaceActionsMenu : headerActions}
        mobileHeaderToolbar={isMobile ? workspaceHeaderToolbar : undefined}
        createPanelContent={createPanelOpen ? lazyWorkspacePanel(
          <WorkspacesCreatePanelController
            agentSettings={state.config.agentSettings}
            workspaceExecutionDefaults={state.config.workspaceExecutionDefaults}
            busy={busy}
            clearPendingWorkspaceSessionSelection={clearPendingWorkspaceSessionSelection}
            executors={executors}
            executorOptions={executorOptions}
            isMobile={isMobile}
            language={language}
            managedCloudRuntime={managedCloudRuntime}
            panelMode={panelMode}
            pendingWorkspaceSelectionIdRef={pendingWorkspaceSelectionIdRef}
            pendingWorkspaceSessionSelectionIdRef={pendingWorkspaceSessionSelectionIdRef}
            projects={workspaceScopedProjects}
            search={search}
            selectedItem={selectedItem}
            selectedProjectId={selectedProjectId}
            selectedWorkspaceId={selectedWorkspaceId}
            setMobileView={setMobileView}
            setOptimisticWorkspaceSession={setOptimisticWorkspaceSession}
            setPanelMode={setPanelMode}
            setPendingAutoEnvironmentInstallWorkspaceId={setPendingAutoEnvironmentInstallWorkspaceId}
            setSelectedProjectId={setSelectedProjectId}
            setSelectedWorkspaceId={setSelectedWorkspaceId}
            setSelectedWorkspaceSessionId={setSelectedWorkspaceSessionId}
            setState={setState}
            t={t}
            updateWorkspaceDirectoryCache={updateWorkspaceDirectoryCache}
            updateWorkspaceSearch={updateWorkspaceSearch}
            visibleProjectIds={visibleProjectIds}
            workspaceScopedProjects={workspaceScopedProjects}
            onBack={isMobile ? closeCreatePanel : undefined}
          />,
          t('workspace.createPanel.loading', { defaultValue: '正在加载创建面板...' }),
        ) : null}
        emptyActions={selectedItem ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleCreateWorkspaceSession()}
            disabled={creatingWorkspaceSession}
            className="border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
          >
            <Bot className="mr-2 h-4 w-4" />
            {t('workspace.shell.createSession', { defaultValue: '新建 AI 对话' })}
          </Button>
        ) : null}
        chatContent={selectedItem && (selectedLocalSessionKey || selectedLocalSessionDetail || localSessionDetailLoading) ? lazyWorkspacePanel(
          <WorkspaceLocalSessionPreview
            sessionSummary={selectedLocalSessionSummary}
            sessionDetail={selectedLocalSessionDetail}
            loading={localSessionDetailLoading}
            importing={localSessionImporting}
            executorName={selectedWorkspaceExecutorName}
            onImport={handleImportLocalSession}
          />,
          t('workspace.importAgentSession.loading', { defaultValue: '正在加载本地会话...' }),
        ) : selectedItem && effectiveDisplayTask ? lazyWorkspacePanel(
          <WorkspaceSessionChat
            ref={(instance) => {
              if (selectedItem.workspace.id === selectedWorkspaceIdRef.current) {
                handleChatRef(instance)
              }
            }}
            key={`${effectiveDisplayTask.id}:${selectedItem.workspace.id}:${selectedWorkspaceSession?.id || 'latest'}`}
            task={effectiveDisplayTask}
            allTasks={[effectiveDisplayTask]}
            executors={executorOptions}
            agentSettings={state.config.agentSettings}
            mcpServers={state.config.mcpServers}
            project={selectedItem.project}
            mentionProjects={state.projects}
            chrome="flush"
            hideHeader
            inlineSessionTokenSummary={selectedWorkspaceSession?.id
              ? workspaceSessionTokenSummaryById[selectedWorkspaceSession.id] || ''
              : ''}
            initialInput={launchPrefill}
            open
            workspaceId={selectedItem.workspace.id}
            workspaceSessionId={selectedWorkspaceSession?.id}
            workspaceSession={selectedWorkspaceSession}
            workspaceSessions={selectedWorkspaceSessions}
            workspaceWorkingDirectoryMode={selectedWorkspaceSession?.workingDirectoryMode ?? selectedItem.workspace.workingDirectoryMode}
            workspaceBranchName={selectedItem.workspace.codeBranchName || selectedWorkspaceSession?.branchName}
            workspaceBaseBranch={selectedItem.workspace.codeBaseBranch || selectedWorkspaceSession?.baseBranch || effectiveDisplayTask.baseBranch}
            workspaceCreatedBy={selectedItem.workspace.createdBy}
            workspaceOwnerUserId={selectedItem.workspace.ownerUserId}
            workspaceRoot={selectedWorkspaceExecutor?.workspaceRoot || state.config.workspaceRoot}
            workspaceRepoPath={selectedWorkspaceRuntime?.repoPath}
            activeExecutorId={selectedWorkspaceExecutorId}
            activeExecutorName={selectedWorkspaceExecutorName}
            onOpenWorkspaceFileLink={handleOpenWorkspaceFileLink}
            onTaskUpdate={handleWorkspaceTaskUpdate}
            onWorkspaceSessionChange={({ workspaceSessionId: nextWorkspaceSessionId, state: nextState }) => {
              refreshWorkspacesListPrState()
              if (selectedItem.workspace.id !== selectedWorkspaceIdRef.current) {
                setState(nextState)
                return
              }

              const normalizedSourceWorkspaceSessionId = selectedWorkspaceSession?.id?.trim() || ''
              const normalizedNextWorkspaceSessionId = nextWorkspaceSessionId.trim()
              const pendingWorkspaceSessionSelectionId = pendingWorkspaceSessionSelectionIdRef.current
              if (
                pendingWorkspaceSessionSelectionId
                && normalizedNextWorkspaceSessionId !== pendingWorkspaceSessionSelectionId
              ) {
                return
              }

              if (
                normalizedSourceWorkspaceSessionId
                && normalizedNextWorkspaceSessionId === normalizedSourceWorkspaceSessionId
                && selectedWorkspaceSessionIdRef.current
                && selectedWorkspaceSessionIdRef.current !== normalizedSourceWorkspaceSessionId
              ) {
                return
              }
              setState(nextState)
              setSelectedWorkspaceSessionId(normalizedNextWorkspaceSessionId)
              updateWorkspaceSearch({ workspaceSessionId: normalizedNextWorkspaceSessionId || undefined })
            }}
            onForkFromMessage={handleForkWorkspaceSessionFromMessage}
            forkingMessageId={forkingMessageId}
            onReviseTurn={handleReviseWorkspaceSessionTurn}
            revisingTurnId={revisingTurnId}
            onAssignExecutor={async (taskId, executorNodeId, targetWorkspaceId, targetWorkspaceSessionId) => {
              const workspaceId = targetWorkspaceId || selectedItem.workspace.id
              const requestId = executorSwitchRequestIdRef.current + 1
              executorSwitchRequestIdRef.current = requestId
              try {
                console.info('[workspaces-page][executor-switch][request]', {
                  taskId,
                  workspaceId,
                  workspaceSessionId: targetWorkspaceSessionId,
                  requestedExecutorId: executorNodeId,
                  currentSessionExecutorId: selectedWorkspaceSession?.executorNodeId,
                  currentRuntimeOwnerExecutorId: selectedWorkspaceSession?.runtimeOwnerExecutorId,
                  currentWorkspaceExecutorId: selectedItem.workspace.executorNodeId,
                })
                const response = await api.updateWorkspace(workspaceId, {
                  name: selectedItem.workspace.name,
                  executorNodeId,
                  autoCommitEnabled: selectedItem.workspace.autoCommitEnabled,
                  taskId,
                  workspaceSessionId: targetWorkspaceSessionId,
                })
                console.info('[workspaces-page][executor-switch][response]', {
                  taskId,
                  workspaceId,
                  workspaceSessionId: targetWorkspaceSessionId,
                  requestedExecutorId: executorNodeId,
                  responseWorkspaceExecutorId: response.workspace.executorNodeId,
                  requestId,
                  latestRequestId: executorSwitchRequestIdRef.current,
                })
                if (requestId !== executorSwitchRequestIdRef.current) {
                  return undefined
                }
                setState(response.state)
                updateWorkspaceDirectoryCache((current) => current
                  ? {
                      ...current,
                      workspacesByProject: {
                        ...current.workspacesByProject,
                        [selectedItem.project.id]: response.workspaces,
                      },
                    }
                  : current)
                console.info('[workspaces-page][executor-switch][state-apply]', {
                  taskId,
                  workspaceId,
                  workspaceSessionId: targetWorkspaceSessionId,
                  requestedExecutorId: executorNodeId,
                  appliedWorkspaceExecutorId: response.workspace.executorNodeId,
                  requestId,
                })
                return response.workspace.executorNodeId?.trim() || undefined
              } catch (error) {
                if (requestId === executorSwitchRequestIdRef.current) {
                  toast.error(error instanceof Error ? error.message : '切换执行节点失败')
                }
                return undefined
              }
            }}
            busy={busy}
          />,
          t('workspace.chat.loading', { defaultValue: '正在加载会话...' }),
        ) : null}
        gitContent={retainedPrimaryViews.includes('git') && selectedItem && effectiveDisplayTask ? lazyWorkspacePanel(
          <WorkspaceGitPanel
            task={effectiveDisplayTask}
            workspace={selectedItem.workspace}
            workspaceSession={selectedWorkspaceSession}
            projectDefaultBranch={selectedItem.project.defaultBranch}
            versionControl={selectedItem.project.versionControl}
            uiScopeKey={buildCurrentPanelUiScopeKey('git')}
            className="flex h-full min-h-0 flex-col"
          />,
          t('workspace.git.loading', { defaultValue: '正在加载 Git 面板...' }),
        ) : null}
        recordsContent={retainedPrimaryViews.includes('records') && selectedItem && effectiveDisplayTask && selectedWorkspaceSession ? lazyWorkspacePanel(
          <WorkspaceTestRecordPanel
            messages={testRecordMessages}
            loading={testRecordLoading}
            refreshing={testRecordRefreshing}
            liveStatus={testRecordLiveStatus}
            repairingObservationId={repairingObservationId}
            onRefresh={() => {
              void loadTestRecordMessages({ refreshing: true })
            }}
            onCreateRepairSession={(observation) => {
              void handleCreateRepairSession(observation)
            }}
            onOpenSession={(workspaceSessionId) => {
              clearPendingWorkspaceSessionSelection()
              setSelectedWorkspaceSessionId(workspaceSessionId)
              setWorkspacePrimaryViewState(selectedItem.workspace.id, 'records')
              updateWorkspaceSearch({ workspaceSessionId, panel: 'records' })
            }}
          />,
          t('workspace.testing.loading', { defaultValue: '正在加载测试记录...' }),
        ) : null}
        filesContent={retainedPrimaryViews.includes('files') && selectedItem ? lazyWorkspacePanel(
          <WorkspaceFilesPanel
            executorId={selectedWorkspaceExecutorId}
            initialDirectoryPath={selectedWorkspaceFileExplorerRootPath}
            candidateRootPaths={selectedWorkspaceFileScopeRootPaths}
            cacheScopeKey={selectedWorkspaceFilesCacheScopeKey}
            uiScopeKey={buildCurrentPanelUiScopeKey('files')}
            openFileRequest={workspaceFileOpenRequest}
            className="h-full"
          />,
          t('workspace.files.loading', { defaultValue: '正在加载文件树...' }),
        ) : null}
        previewContent={retainedPrimaryViews.includes('preview') && selectedItem ? lazyWorkspacePanel(
          <WorkspacePreviewPanel
            busyAction={previewBusyAction}
            executorId={selectedWorkspaceExecutorId}
            executor={selectedWorkspaceExecutor}
            iframeUrl={previewViewer?.iframeUrl}
            preview={previewSession}
            shareUrl={previewShareUrl}
            sourceAppUrl={environmentPreview?.appUrl}
            previewSources={environmentPreviewSources}
            uiScopeKey={buildCurrentPanelUiScopeKey('preview')}
            resourceActive={activePrimaryView === 'preview'}
            onOpen={() => void handleOpenWorkspacePreview()}
            onOpenExternal={(targetUrl, options) => handleOpenWorkspacePreviewInBrowser(targetUrl, options)}
            onRefresh={() => void handleRefreshWorkspacePreview()}
            onRevokeShare={() => void handleRevokeWorkspacePreviewShare()}
            onShare={() => void handleShareWorkspacePreview()}
            onStop={() => void handleStopWorkspacePreview()}
          />,
          t('workspace.preview.loading', { defaultValue: '正在加载预览面板...' }),
        ) : null}
        desktopContent={DESKTOP_SANDBOX_ENABLED && retainedPrimaryViews.includes('desktop') && selectedItem && effectiveDisplayTask ? lazyWorkspacePanel(
          <WorkspaceDesktopSandboxPanel
            busyAction={desktopSandboxBusyAction}
            desktop={desktopSandbox}
            displayProfile={desktopSandboxDisplayProfile}
            resourceKey={`desktop:${buildCurrentPanelUiScopeKey('desktop')}`}
            resourceActive={activePrimaryView === 'desktop'}
            onAction={(action) => {
              void handleRunDesktopSandboxAction(action)
            }}
            onCommand={(command) => {
              void handleRunDesktopSandboxCommand(command)
            }}
            onDisplayProfileChange={handleDesktopSandboxDisplayProfileChange}
            onOpen={() => {
              void handleOpenDesktopSandbox()
            }}
            onOpenExternal={handleOpenDesktopSandboxExternal}
            onRefresh={() => {
              void handleRefreshDesktopSandbox()
            }}
            onStop={() => {
              void handleStopDesktopSandbox()
            }}
          />,
          t('workspace.desktop.loading', { defaultValue: '正在加载 Desktop Sandbox...' }),
        ) : null}
        browserContent={null}
        terminalCollapsed={currentWorkspaceTerminalCollapsed}
        terminalMaximized={terminalMaximized}
        terminalSection={selectedWorkspaceTerminalItem ? lazyWorkspacePanel(
          <div className="h-full w-full">
            <WorkspaceTerminalPanel
              collapsed={currentWorkspaceTerminalCollapsed}
              cwd={selectedWorkspaceCwd}
              executorId={selectedWorkspaceExecutorId}
              executorName={selectedWorkspaceExecutorName}
              executorRealtimeBaseUrl={selectedWorkspaceExecutor?.realtimeBaseUrl}
              projectId={selectedWorkspaceTerminalItem.project.id}
              workspaceId={selectedWorkspaceTerminalItem.workspace.id}
              workspaceName={selectedWorkspaceTerminalItem.workspace.name}
              installCommand={installWorkspaceCommand}
              startCommand={environmentPreview?.startCommand}
              logsCommand={environmentPreview?.logsCommand}
              maximized={terminalMaximized}
              isMobile
              panelKey={selectedWorkspaceTerminalItem.workspace.id}
              shouldLoadSessions
              commandRequest={terminalCommandRequest}
              onCollapsedChange={setTerminalCollapsed}
              onMaximizedChange={setTerminalMaximized}
              onOpenStateChange={(open) => {
                setWorkspaceTerminalOpenUi(selectedWorkspaceTerminalItem.workspace.id, open)
                if (!open) {
                  markEnvironmentTerminalClosed()
                  clearWorkspaceEnvironmentRunningForWorkspace(selectedWorkspaceTerminalItem.workspace.id)
                }
              }}
              onOpenWorkspaceTarget={async () => {
                await openCurrentWorkspaceInTarget(activeWorkspaceOpenTarget)
              }}
            />
          </div>,
          t('workspace.terminal.loading', { defaultValue: '正在加载终端...' }),
        ) : undefined}
        bodyStyle={undefined}
        onTerminalCollapsedChange={setTerminalCollapsed}
        onTerminalMaximizedChange={setTerminalMaximized}
        onSetMobileView={setMobileWorkspaceView}
        onOpenCreatePanel={openCreatePanel}
        onCreateForProject={openCreatePanelForProject}
        onEditProject={handleOpenProjectEdit}
        onLoadProject={ensureDirectoryProjectLoaded}
        onVisibleProjectIdsChange={setProjectVisibilityFilterIds}
        onSearchChange={setSearchQuery}
        onSelectWorkspace={handleSelectWorkspace}
        onArchivedSectionExpandedChange={setArchivedSectionExpanded}
        onReorderProjects={handleReorderProjects}
        onReorderWorkspaces={handleReorderProjectWorkspaces}
        onSelectWorkspaceSessionTarget={handleSelectWorkspaceSessionTarget}
        onOpenBindDialog={() => {
          setBindTaskId(selectedWorkspaceTask?.id || bindableTasks[0]?.id || '')
          setBindDialogOpen(true)
        }}
        onOpenWorkspaceSettings={openWorkspaceSettings}
        onOpenProjectSettingsFromWorkspaceSettings={openProjectSettingsFromWorkspaceSettings}
        onDeleteSelectedWorkspace={() => {
          if (selectedItem) {
            void handleDeleteWorkspace(selectedItem)
          }
        }}
        onTitleDraftChange={setShellTitleDraft}
        onStartEditTitle={() => setIsEditingShellTitle(true)}
        onCancelEditTitle={() => {
          if (selectedItem) {
            setShellTitleDraft(selectedItem.workspace.name)
          }
          setIsEditingShellTitle(false)
        }}
        onRenameWorkspace={() => void handleRenameWorkspace()}
        onRenameWorkspaceSession={handleRenameWorkspaceSession}
        onDeleteWorkspaceSession={(workspaceSessionId) => {
          void handleDeleteWorkspaceSession(workspaceSessionId)
        }}
        onPinWorkspaceSession={handlePinWorkspaceSession}
        deletingWorkspaceSessionId={deletingWorkspaceSessionId}
        onSelectWorkspaceSession={(workspaceSessionId) => {
          clearPendingWorkspaceSessionSelection()
          clearSelectedLocalSessionPreview()
          const nextWorkspaceSession = selectedWorkspaceSessions.find((session) => session.id === workspaceSessionId)
          if (nextWorkspaceSession) {
            markWorkspaceSessionRead(nextWorkspaceSession)
          }
          setSelectedWorkspaceSessionId(workspaceSessionId)
          if (selectedItem) {
            rememberWorkspaceTabRoute(selectedItem.workspace.id, {
              projectId: selectedItem.project.id,
              workspaceSessionId,
            })
          }
          updateWorkspaceSearch({ taskId: undefined, workspaceSessionId })
        }}
        onCreateWorkspaceSession={handleCreateWorkspaceSession}
        onToggleLocalSessions={handleToggleLocalSessions}
        onRefreshLocalSessions={() => {
          void loadLocalSessions(true).catch((error) => {
            toast.error(error instanceof Error ? error.message : t('workspace.importAgentSession.listFailed', { defaultValue: '读取节点聊天记录失败。' }))
          })
        }}
        onSelectLocalSession={handleSelectLocalSession}
        onReorderWorkspaceSessions={handleReorderWorkspaceSessions}
        onPrimaryViewChange={setActivePrimaryView}
        onBindDialogOpenChange={setBindDialogOpen}
        onBindTaskIdChange={setBindTaskId}
        onBindWorkspaceTask={() => void handleBindWorkspaceTask()}
        onWorkspaceSettingsOpenChange={setWorkspaceSettingsOpen}
        onWorkspaceNameDraftChange={setShellTitleDraft}
        onRenameWorkspaceFromSettings={() => void handleRenameWorkspace()}
        onWorkspaceSettingsAutoCommitEnabledChange={setWorkspaceSettingsAutoCommitEnabled}
        onWorkspaceEnvironmentTemplateChange={(template) => {
          setSelectedWorkspaceEnvironmentTemplate(template)
        }}
        onSaveWorkspaceAutoCommit={() => void handleUpdateWorkspaceAutoCommit(workspaceSettingsAutoCommitEnabled).then((saved) => {
          if (saved) {
            setWorkspaceSettingsOpen(false)
          }
        })}
      />
      {shouldMountTestingController ? (
        <Suspense fallback={null}>
          <WorkspacesTestingController
            activePrimaryView={activePrimaryView}
            currentWorkspace={selectedItem?.workspace ?? null}
            displayTask={effectiveDisplayTask}
            environmentPreview={environmentPreview}
            language={language}
            navigate={({ search: nextSearch, replace }) => navigateWorkspaceSearch(nextSearch, replace)}
            onEnvironmentStatusChange={handleWorkspaceEnvironmentStatusChange}
            onStateChange={handleTestingControllerStateChange}
            parentWorkspaceSession={parentWorkspaceSession}
            project={selectedItem?.project ?? null}
            search={workspaceSearchState}
            setActivePrimaryView={setActivePrimaryView}
            setState={setState}
            t={t}
            terminalCwd={selectedWorkspaceCwd}
            testerWorkspaceSession={testerWorkspaceSession}
            workspaceExecutorId={selectedWorkspaceExecutorId}
            workspaceSession={selectedWorkspaceSession}
          />
        </Suspense>
      ) : null}
      {deleteWorkspaceDialogItem ? (
        <Suspense fallback={null}>
          <DeleteWorkspaceDialog
            open={Boolean(deleteWorkspaceDialogItem)}
            workspaceName={deleteWorkspaceDialogItem.workspace.name}
            branchName={deleteWorkspaceDialogItem.workspace.codeBranchName || selectedWorkspaceSession?.branchName || ''}
            busy={deleteWorkspaceBusy}
            onOpenChange={(open) => {
              if (!open && !deleteWorkspaceBusy) {
                setDeleteWorkspaceDialogItem(null)
              }
            }}
            onConfirm={handleConfirmDeleteWorkspace}
            title={t('workspace.page.deleteDialog.title', { name: '{{name}}' })}
            description={t('workspace.page.deleteDialog.description')}
            localBranchLabel={t('workspace.page.deleteDialog.deleteLocalBranch')}
            localBranchHint={t('workspace.page.deleteDialog.deleteLocalBranchHint')}
            remoteBranchLabel={t('workspace.page.deleteDialog.deleteRemoteBranch')}
            remoteBranchHint={t('workspace.page.deleteDialog.deleteRemoteBranchHint')}
            cancelText={t('common.cancel')}
            confirmText={t('workspace.page.deleteDialog.confirm')}
          />
        </Suspense>
      ) : null}
      <Dialog
        open={sessionRenameOpen}
        onOpenChange={(open) => {
          setSessionRenameOpen(open)
          if (!open) {
            setSessionRenameDraft('')
          }
        }}
      >
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('workspace.shell.renameSessionTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
          <Input
            value={sessionRenameDraft}
            onChange={(event) => setSessionRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isImeComposingKeyboardEvent(event)) {
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                void handleRenameSelectedWorkspaceSession()
              }
            }}
            maxLength={80}
            autoFocus
            className="h-10 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100"
          />
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSessionRenameOpen(false)}
              className="border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRenameSelectedWorkspaceSession()}
              disabled={!sessionRenameDraft.trim() || sessionRenameBusy}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {sessionRenameBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {archiveWorkspaceProgress ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-zinc-800/80 bg-[#09090b]/96 px-4 py-3 text-zinc-100 shadow-[0_22px_60px_rgba(0,0,0,0.52)] backdrop-blur-xl">
          <div className="mt-0.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-200">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">
              正在归档工作区 {archiveWorkspaceProgress.workspaceName}
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              {archiveWorkspaceProgress.detail}
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
