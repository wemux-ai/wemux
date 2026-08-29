/**
 * [INPUT]: /workspace route search, app state, workspace APIs, and shared workspace UI components.
 * [OUTPUT]: Focused single-workspace detail experience with task-return navigation and launch restoration.
 * [POS]: Standalone workspace-detail route; does not own the /workspaces directory, filtering, or multi-pane cache.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { buildWorkspacePreviewSourceOptions } from '@shared/types'
import { type WorkspaceOpenTarget } from '@shared/workspace-open-command'
import { resolveWorkspaceAutoCommitEnabled, stripWorkspaceExecutionFieldsFromTask, syncWorkspaceSessionFromTaskExecutionView } from '@shared/task-workspace'
import type {
  Task,
  WorkspaceDesktopSandboxAction,
  WorkspaceDesktopSandboxDisplayProfile,
  WorkspaceDesktopSandboxDto,
  WorkspaceRemoteCodeDto,
} from '@shared/types'
import { buildVsCodeOpenCommandAttempts } from '@shared/vscode-open-command'
import { ArrowLeft, Bot, CircleDot, Code2, ExternalLink, FolderTree, GitBranch, Loader2, Monitor, MoreHorizontal, Play, Rocket, ScrollText, SlidersHorizontal, Square, Users } from 'lucide-react'
import { toast } from 'sonner'
import { WorkspaceSessionChat } from '../components/workspaces/workspace-session-chat'
import { useAppDialog } from '../components/ui/app-dialog-provider'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu'
import { useSidebar } from '../components/ui/sidebar'
import { WorkspaceEnvironmentStatusBanner } from '../components/workspaces/workspace-environment-status-banner'
import { WorkspaceShell } from '../components/workspaces/workspace-shell'
import { WorkspaceOpenAction } from '../components/workspaces/workspace-open-action'
import { WorkspaceSessionShareMenu } from '../components/workspaces/workspace-session-share-menu'
import { PersistentWorkspaceTerminalDock, useDesktopPersistentWorkspaceTerminal } from '../components/workspaces/persistent-workspace-terminal'
import { useApp } from '../lib/app-provider'
import { api } from '../lib/api'
import { buildWorkspacePageTabId, openPageTab } from '../lib/page-tabs-store'
import { useTranslation } from '../lib/i18n/react'
import { buildExecutorOptionsWithManagedCloud, isManagedCloudExecutorRecord } from '../lib/managed-cloud-executor'
import { isLikelyWorkspaceFileLinkHref, resolveWorkspaceFileLinkPath } from '../lib/workspace-file-link'
import { isCustomAgentVisibleInWorkspace, readCustomAgentConfig } from '@shared/custom-agent'
import { useAuth } from '../lib/auth-context'
import { cn } from '../lib/utils'
import { isDesktopSandboxDevOnlyEnabled } from '../lib/runtime-config'
import { renameWorkspaceSession, resolveCreatedWorkspaceSession } from '../lib/workspace-session-mutations'
import {
  readDesktopSandboxClientNetworkHint,
  readStoredDesktopSandboxDisplayProfile,
  writeStoredDesktopSandboxDisplayProfile,
} from '../lib/desktop-sandbox-display-profile'
import { getStoredCollaborationWorkspaceId } from '../lib/collaboration-workspace'
import { openWorkspaceInTarget } from '../lib/workspace-open-target'
import { getStoredWorkspaceOpenTarget, setStoredWorkspaceOpenTarget } from '../lib/workspace-open-preferences'
import { isRemoteCodeTunnelReady, resolveRemoteCodeOpenUrl, waitForRemoteCodeTunnel } from '../lib/remote-code-open'
import { getWorkspaceSessionAttentionSignature, markWorkspaceSessionRead, markWorkspaceSessionUnread } from '../lib/workspace-session-attention'
import { resolveWorkspaceSessionForWorkspace } from '../lib/workspace-session-scope'
import { useRealtimeActiveView } from '../lib/realtime/useRealtime'
import { useWorkspaceSessionUnreadState } from '../lib/use-workspace-session-unread-state'
import { useAvailableAgents } from '../lib/use-available-agents'
import {
  buildWorkspaceRouteSearch,
  resolveWorkspacePrimaryViewForWorkspace,
  resolveWorkspacePrimaryView,
  shouldRunEnvironmentStartInTerminal,
  shouldShowEnvironmentLogsCommand,
  shouldShowEnvironmentStopCommand,
  WorkspaceLoadingState,
  type WorkspacePrimaryView,
  type WorkspaceRouteSearch,
  text,
} from './-workspace-route-shared'
import {
  buildWorkspaceRouteIndexes,
  selectWorkspaceRouteProject,
  selectWorkspaceRouteTask,
} from './-workspace-route-selectors'
import { shouldHandleToggleWorkspaceTerminalShortcut } from './-workspace-route-shortcuts'
import { useWorkspaceLaunch } from './-use-workspace-launch'
import { useWorkspaceRouteData } from './-use-workspace-route-data'
import { useWorkspaceTesting } from './-use-workspace-testing'
import type { AgentRecord } from '../lib/api/types'
import type {
  WorkspaceSessionChatDraftPayload,
  WorkspaceSessionChatRevisionAction,
} from '../components/workspaces/workspace-session-chat'

const buildWorkspacePageHref = (search: WorkspaceRouteSearch) => {
  const params = new URLSearchParams()
  const append = (key: keyof WorkspaceRouteSearch) => {
    const value = search[key]
    if (typeof value === 'string' && value) {
      params.set(key, value)
    }
  }

  append('projectId')
  append('taskId')
  append('workspaceId')
  append('workspaceSessionId')
  append('launchId')
  append('autoEnvironmentInstall')
  append('panel')
  append('terminal')
  append('mobileView')
  append('create')

  const queryString = params.toString()
  return queryString ? `/workspace?${queryString}` : '/workspace'
}

const WorkspaceDesktopSandboxPanel = lazy(() => import('../components/workspaces/workspace-desktop-sandbox-panel').then((module) => ({ default: module.WorkspaceDesktopSandboxPanel })))
const WorkspaceFilesPanel = lazy(() => import('../components/workspaces/workspace-files-panel').then((module) => ({ default: module.WorkspaceFilesPanel })))
const WorkspaceGitPanel = lazy(() => import('../components/workspaces/workspace-git-panel').then((module) => ({ default: module.WorkspaceGitPanel })))
const WorkspacePreviewPanel = lazy(() => import('../components/workspaces/workspace-preview-panel').then((module) => ({ default: module.WorkspacePreviewPanel })))
const WorkspaceSettingsDialog = lazy(() => import('../components/workspaces/workspace-settings-dialog').then((module) => ({ default: module.WorkspaceSettingsDialog })))
const WorkspaceTerminalPanel = lazy(() => import('../components/workspaces/workspace-terminal-panel').then((module) => ({ default: module.WorkspaceTerminalPanel })))
const WorkspaceTestRecordPanel = lazy(() => import('../components/workspaces/workspace-test-record-panel').then((module) => ({ default: module.WorkspaceTestRecordPanel })))

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

const DESKTOP_SANDBOX_ENABLED = isDesktopSandboxDevOnlyEnabled()
const resolveDesktopSandboxPanelView = (view: WorkspacePrimaryView): WorkspacePrimaryView => (
  DESKTOP_SANDBOX_ENABLED || view !== 'desktop' ? view : 'chat'
)

export const Route = createFileRoute('/workspace')({
  validateSearch: (search: Record<string, unknown>) => buildWorkspaceRouteSearch(search),
  component: WorkspaceRoute,
})

function WorkspaceRoute() {
  const { language, t } = useTranslation()
  const { isMobile } = useSidebar()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { user: currentAuthUser } = useAuth()
  const { state, setState, busy, runMutation } = useApp()
  const { confirm } = useAppDialog()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [autoCommitBusy, setAutoCommitBusy] = useState(false)
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false)
  const [workspaceSettingsAutoCommitEnabled, setWorkspaceSettingsAutoCommitEnabled] = useState(false)
  const [deletingWorkspaceSessionId, setDeletingWorkspaceSessionId] = useState('')
  const [reorderingWorkspaceSessions, setReorderingWorkspaceSessions] = useState(false)
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  const [revisingTurnId, setRevisingTurnId] = useState<string | null>(null)
  const [pendingPostForkAction, setPendingPostForkAction] = useState<{
    targetWorkspaceSessionId: string
    action: 'prefill' | 'send'
    draft: WorkspaceSessionChatDraftPayload
  } | null>(null)
  const [terminalCommandRequest, setTerminalCommandRequest] = useState<import('../components/workspaces/workspace-terminal-panel').WorkspaceTerminalCommandRequest | null>(null)
  const [availableAgents, setAvailableAgents] = useState<AgentRecord[]>([])
  const [desktopSandbox, setDesktopSandbox] = useState<WorkspaceDesktopSandboxDto | null>(null)
  const [desktopSandboxBusyAction, setDesktopSandboxBusyAction] = useState<null | 'open' | 'refresh' | 'stop' | 'action' | 'command'>(null)
  const [desktopSandboxDisplayProfile, setDesktopSandboxDisplayProfile] = useState<WorkspaceDesktopSandboxDisplayProfile>(() => readStoredDesktopSandboxDisplayProfile())
  const [remoteCode, setRemoteCode] = useState<WorkspaceRemoteCodeDto | null>(null)
  const [remoteCodeBusyAction, setRemoteCodeBusyAction] = useState<null | 'open' | 'tunnel' | 'refresh' | 'stop'>(null)
  const [workspaceChatBootstrap, setWorkspaceChatBootstrap] = useState<{
    workspaceId: string
    status: 'pending' | 'failed'
    message?: string
  } | null>(null)
  const terminalCollapsedFromSearch = search.terminal === '1'
    ? false
    : Boolean(search.taskId || search.workspaceSessionId || search.launchId)
  const [terminalCollapsed, setTerminalCollapsedState] = useState(() => terminalCollapsedFromSearch)
  const [terminalCollapsedByWorkspaceId, setTerminalCollapsedByWorkspaceId] = useState<Record<string, boolean>>(() => (
    search.workspaceId
      ? { [search.workspaceId]: terminalCollapsedFromSearch }
      : {}
  ))
  const [terminalMaximized, setTerminalMaximized] = useState(false)
  const [openingWorkspaceTarget, setOpeningWorkspaceTarget] = useState<WorkspaceOpenTarget | null>(null)
  const [activeWorkspaceOpenTarget, setActiveWorkspaceOpenTarget] = useState<WorkspaceOpenTarget>(() => (
    getStoredWorkspaceOpenTarget(state.config.workspaceOpenSettings.defaultTarget)
  ))
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] = useState<{
    filePath: string
    requestId: number
  } | null>(null)
  const [activePrimaryView, setActivePrimaryViewState] = useState<WorkspacePrimaryView>(() => (
    resolveDesktopSandboxPanelView(resolveWorkspacePrimaryView(search.panel))
  ))
  const [primaryViewByWorkspaceId, setPrimaryViewByWorkspaceId] = useState<Record<string, WorkspacePrimaryView>>(() => (
    search.workspaceId
      ? { [search.workspaceId]: resolveDesktopSandboxPanelView(resolveWorkspacePrimaryView(search.panel)) }
      : {}
  ))
  const workspaceFileRequestIdRef = useRef(0)
  const routeWorkspaceStateRef = useRef('')
  const primaryViewByWorkspaceIdRef = useRef(primaryViewByWorkspaceId)
  const terminalCollapsedByWorkspaceIdRef = useRef(terminalCollapsedByWorkspaceId)
  const buildRouteSearch = (patch: Partial<WorkspaceRouteSearch> = {}) => buildWorkspaceRouteSearch({
    ...search,
    ...patch,
  })
  const updateRouteSearch = (patch: Partial<WorkspaceRouteSearch> = {}) => {
    void navigate({
      to: '/workspace',
      replace: true,
      search: buildRouteSearch(patch),
    })
  }
  const currentWorkspaceId = search.workspaceId || ''
  const setWorkspacePrimaryViewState = (
    workspaceId: string | undefined,
    requestedNextView: WorkspacePrimaryView,
  ) => {
    const nextView = resolveDesktopSandboxPanelView(requestedNextView)
    setActivePrimaryViewState(nextView)
    if (!workspaceId) {
      return
    }

    setPrimaryViewByWorkspaceId((current) => {
      if (current[workspaceId] === nextView) {
        return current
      }

      return {
        ...current,
        [workspaceId]: nextView,
      }
    })
  }
  const setActivePrimaryView = (nextValue: WorkspacePrimaryView | ((current: WorkspacePrimaryView) => WorkspacePrimaryView)) => {
    const next = resolveDesktopSandboxPanelView(typeof nextValue === 'function' ? nextValue(activePrimaryView) : nextValue)
    setWorkspacePrimaryViewState(currentWorkspaceId, next)

    const patch: Partial<WorkspaceRouteSearch> = {
      panel: next === 'chat' ? undefined : next,
    }

    if (isMobile && next !== 'chat' && !terminalCollapsed) {
      setTerminalCollapsedState(true)
      if (currentWorkspaceId) {
        setTerminalCollapsedByWorkspaceId((current) => ({
          ...current,
          [currentWorkspaceId]: true,
        }))
      }
      setTerminalMaximized(false)
      patch.terminal = undefined
    }

    updateRouteSearch(patch)
  }
  const setTerminalCollapsed = (nextValue: boolean) => {
    setTerminalCollapsedState(nextValue)
    if (currentWorkspaceId) {
      setTerminalCollapsedByWorkspaceId((current) => ({
        ...current,
        [currentWorkspaceId]: nextValue,
      }))
    }
    if (nextValue) {
      setTerminalMaximized(false)
    }

    const patch: Partial<WorkspaceRouteSearch> = {
      terminal: nextValue ? undefined : '1',
    }

    if (isMobile && !nextValue && activePrimaryView !== 'chat') {
      setWorkspacePrimaryViewState(currentWorkspaceId, 'chat')
      patch.panel = undefined
    }

    updateRouteSearch(patch)
  }
  const openWorkspaceMemberSettings = () => {
    const collaborationWorkspaceId = getStoredCollaborationWorkspaceId()
    void navigate({
      to: '/settings',
      search: {
        section: 'workspace',


        workspaceId: collaborationWorkspaceId || undefined,

      },
    })
  }
  const toggleWorkspacePrimaryPanel = (panel: Exclude<WorkspacePrimaryView, 'chat'>) => {
    setActivePrimaryView((current) => current === panel ? 'chat' : panel)
  }

  const workspaceRouteIndexes = useMemo(
    () => buildWorkspaceRouteIndexes(state),
    [state.projectBindings, state.projects, state.taskWorkspaceBindings, state.workspaceSessions, state.tasks],
  )
  const task = useMemo(
    () => selectWorkspaceRouteTask(workspaceRouteIndexes, search),
    [search, workspaceRouteIndexes],
  )
  const project = useMemo(
    () => selectWorkspaceRouteProject(workspaceRouteIndexes, search, task),
    [search, task, workspaceRouteIndexes],
  )
  const {
    currentWorkspace,
    displayTask,
    environmentCommands,
    environmentDisabledReason,
    environmentPreview,
    executors,
    gitPanelEnabled,
    managedCloudRuntime,
    hasEnvironmentControls,
    matchedWorkspaceSession,
    parentWorkspaceSession,
    refreshExecutors,
    selectedWorkspaceSessionId,
    setWorkspaceEnvironmentTemplate,
    setWorkspaces,
    terminalCandidateCwds,
    terminalCwd,
    testerWorkspaceSession,
    workspaceExecutor,
    workspaceFileExplorerRootPath,
    workspaceRuntimeExecutorId,
    workspaceRuntimeExecutorName,
    workspaceSessionRuntime,
    workspaceSession,
    workspaceSessions,
    workspaceTask,
    workspacesLoading,
  } = useWorkspaceRouteData({
    language,
    project,
    routeIndexes: workspaceRouteIndexes,
    search,
    setState,
    state,
    task,
    t,
  })
  useEffect(() => {
    if (!currentWorkspace?.id || search.create === '1') {
      return
    }

    openPageTab({
      id: buildWorkspacePageTabId({
        pathname: '/workspace',
        workspaceId: currentWorkspace.id,
        taskId: search.taskId,
        workspaceSessionId: search.workspaceSessionId,
        launchId: search.launchId,
      }),
      scope: 'workspace',
      pathname: '/workspace',
      href: buildWorkspacePageHref(search),
      title: currentWorkspace.name,
      subtitle: project?.name || task?.title || undefined,
    })
  }, [
    currentWorkspace?.id,
    currentWorkspace?.name,
    project?.name,
    search.autoEnvironmentInstall,
    search.create,
    search.launchId,
    search.mobileView,
    search.panel,
    search.projectId,
    search.taskId,
    search.terminal,
    search.workspaceId,
    search.workspaceSessionId,
    task?.title,
  ])
  const workspaceChatExecutors = useMemo(() => {
    const workspaceId = currentWorkspaceId.trim()
    const scopedExecutors = workspaceId && currentAuthUser?.id
      ? executors.filter((executor) => (
        executor.ownerUserId === currentAuthUser.id
        || (executor.visibility === 'team' && (executor.workspaceIds ?? []).includes(workspaceId))
      ))
      : executors
    return buildExecutorOptionsWithManagedCloud(scopedExecutors, managedCloudRuntime, { includeOffline: true })
  }, [currentAuthUser?.id, currentWorkspaceId, executors, managedCloudRuntime])
  useEffect(() => {
    if (!workspaceExecutor || !isManagedCloudExecutorRecord(workspaceExecutor) || workspaceExecutor.status === 'online') {
      return
    }

    let cancelled = false

    const refreshManagedExecutor = async () => {
      const refreshDelays = [1500, 2500, 4000, 6000, 6000]
      for (const delay of refreshDelays) {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return
        }

        await new Promise((resolve) => window.setTimeout(resolve, delay))
        if (cancelled) {
          return
        }

        try {
          const nextExecutors = await refreshExecutors(true)
          if (cancelled) {
            return
          }

          const matchedExecutor = nextExecutors.find((item) => item.executorId === workspaceExecutor.executorId)
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
  }, [refreshExecutors, workspaceExecutor])
  const workspaceSessionUnreadState = useWorkspaceSessionUnreadState({
    workspaceSessions: state.workspaceSessions,
    selectedWorkspaceSessionId,
  })
  // 通知矩阵「不在该会话时弹」：声明当前正在查看的工作区会话。
  useRealtimeActiveView({ workspaceSessionId: selectedWorkspaceSessionId })
  const selectedWorkspaceSessionIdRef = useRef(selectedWorkspaceSessionId)
  const executorSwitchRequestIdRef = useRef(0)
  const {
    activeLaunch,
    chatRef,
    chatReady,
    handleChatRef,
    launchError,
    launchPrefill,
    launchStatus,
    workspacePreparing,
  } = useWorkspaceLaunch({
    currentWorkspace,
    matchedWorkspaceSession,
    navigate,
    project,
    route: '/workspace',
    search,
    selectedWorkspaceSessionId,
    setState,
    state,
    task,
    t,
    workspaceSession,
    workspaceSessions,
    workspaceTask,
  })
  const {
    environmentBusyAction,
    localEnvironmentProbe,
    localWorkerDiagnostics,
    environmentStatus,
    environmentStatusLoading,
    handleOpenWorkspacePreview,
    handleOpenWorkspacePreviewInBrowser,
    handleBackToParentSession,
    handleCreateRepairSession,
    handleOpenEnvironmentApp,
    handleRefreshWorkspacePreview,
    handleRevokeWorkspacePreviewShare,
    handleRunEnvironmentAction,
    handleShareWorkspacePreview,
    handleStopWorkspacePreview,
    loadTestRecordMessages,
    markEnvironmentTerminalClosed,
    markEnvironmentTerminalStart,
    markEnvironmentTerminalStop,
    previewBusyAction,
    previewAccessRoute,
    previewSession,
    previewShareUrl,
    previewViewer,
    repairingObservationId,
    refreshEnvironmentStatus,
    refreshLocalDirectProbes,
    testRecordLiveStatus,
    testRecordLoading,
    testRecordMessages,
    testRecordRefreshing,
  } = useWorkspaceTesting({
    activePrimaryView,
    currentWorkspace,
    displayTask,
    environmentPreview,
    language,
    navigate,
    parentWorkspaceSession,
    project,
    route: '/workspace',
    search,
    setActivePrimaryView,
    setState,
    t,
    terminalCwd,
    testerWorkspaceSession,
    workspaceExecutorId: workspaceRuntimeExecutorId,
    workspaceSession,
  })

  const desktopSandboxScope = useMemo(() => ({
    taskId: displayTask?.id || '',
    workspaceId: currentWorkspace?.id || '',
    workspaceSessionId: workspaceSession?.id || '',
  }), [currentWorkspace?.id, displayTask?.id, workspaceSession?.id])
  const remoteCodeScope = desktopSandboxScope

  useEffect(() => {
    setDesktopSandbox(null)
    setRemoteCode(null)
  }, [desktopSandboxScope.taskId, desktopSandboxScope.workspaceId, desktopSandboxScope.workspaceSessionId])

  useEffect(() => {
    if (!remoteCodeScope.taskId || !remoteCodeScope.workspaceId) {
      return
    }

    let cancelled = false
    void api.getTaskRemoteCode(
      remoteCodeScope.taskId,
      remoteCodeScope.workspaceId,
      remoteCodeScope.workspaceSessionId || undefined,
    ).then((response) => {
      if (!cancelled) {
        setRemoteCode(response.remoteCode)
      }
    }).catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [remoteCodeScope.taskId, remoteCodeScope.workspaceId, remoteCodeScope.workspaceSessionId])

  useEffect(() => {
    if (!DESKTOP_SANDBOX_ENABLED || activePrimaryView !== 'desktop' || !desktopSandboxScope.taskId || !desktopSandboxScope.workspaceId) {
      return
    }

    let cancelled = false
    setDesktopSandboxBusyAction('refresh')
    void api.getTaskDesktopSandbox(
      desktopSandboxScope.taskId,
      desktopSandboxScope.workspaceId,
      desktopSandboxScope.workspaceSessionId || undefined,
    ).then((response) => {
      if (!cancelled) {
        setDesktopSandbox(response.desktop)
      }
    }).catch((error) => {
      if (!cancelled) {
        toast.error(error instanceof Error ? error.message : '读取 Desktop Sandbox 状态失败')
      }
    }).finally(() => {
      if (!cancelled) {
        setDesktopSandboxBusyAction(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    activePrimaryView,
    desktopSandboxScope.taskId,
    desktopSandboxScope.workspaceId,
    desktopSandboxScope.workspaceSessionId,
  ])

  useEffect(() => {
    primaryViewByWorkspaceIdRef.current = primaryViewByWorkspaceId
  }, [primaryViewByWorkspaceId])

  useEffect(() => {
    terminalCollapsedByWorkspaceIdRef.current = terminalCollapsedByWorkspaceId
  }, [terminalCollapsedByWorkspaceId])

  const { agents: loadedAgents } = useAvailableAgents()
  const scopedAvailableAgents = useMemo(() => {
    const workspaceId = currentWorkspaceId.trim()
    if (!workspaceId) {
      return loadedAgents
    }

    const userId = currentAuthUser?.id?.trim() || ''
    return loadedAgents.filter((agent) => isCustomAgentVisibleInWorkspace(
      readCustomAgentConfig(agent.config),
      {
        userId,
        ownerUserId: agent.ownerUserId,
        workspaceId,
      },
    ))
  }, [currentAuthUser?.id, currentWorkspaceId, loadedAgents])

  useEffect(() => {
    setAvailableAgents(scopedAvailableAgents)
  }, [scopedAvailableAgents])

  useEffect(() => {
    const routeWorkspaceId = currentWorkspace?.id || search.workspaceId || ''
    if (!routeWorkspaceId) {
      return
    }

    const previousWorkspaceId = routeWorkspaceStateRef.current
    const workspaceChanged = previousWorkspaceId !== routeWorkspaceId
    routeWorkspaceStateRef.current = routeWorkspaceId

    if (workspaceChanged) {
      const savedPrimaryView = primaryViewByWorkspaceIdRef.current[routeWorkspaceId]
      const savedTerminalCollapsed = terminalCollapsedByWorkspaceIdRef.current[routeWorkspaceId]
      const nextPrimaryView = resolveDesktopSandboxPanelView(resolveWorkspacePrimaryViewForWorkspace({
        previousWorkspaceId,
        routePanel: search.panel,
        savedPrimaryView,
        workspaceId: routeWorkspaceId,
      }))
      const nextTerminalCollapsed = savedTerminalCollapsed ?? terminalCollapsedFromSearch

      if (savedPrimaryView === undefined) {
        setPrimaryViewByWorkspaceId((current) => ({
          ...current,
          [routeWorkspaceId]: nextPrimaryView,
        }))
      }
      if (savedTerminalCollapsed === undefined) {
        setTerminalCollapsedByWorkspaceId((current) => ({
          ...current,
          [routeWorkspaceId]: nextTerminalCollapsed,
        }))
      }

      setActivePrimaryViewState((current) => current === nextPrimaryView ? current : nextPrimaryView)
      setTerminalCollapsedState((current) => current === nextTerminalCollapsed ? current : nextTerminalCollapsed)
      if (nextTerminalCollapsed) {
        setTerminalMaximized(false)
      }

      const nextPanel = nextPrimaryView === 'chat' ? undefined : nextPrimaryView
      const nextTerminal = nextTerminalCollapsed ? undefined : '1'
      if ((search.panel ?? undefined) !== nextPanel || (search.terminal ?? undefined) !== nextTerminal) {
        updateRouteSearch({
          panel: nextPanel,
          terminal: nextTerminal,
        })
      }
      return
    }

    const nextPrimaryView = resolveDesktopSandboxPanelView(resolveWorkspacePrimaryView(search.panel))
    setPrimaryViewByWorkspaceId((current) => (
      current[routeWorkspaceId] === nextPrimaryView
        ? current
        : {
            ...current,
            [routeWorkspaceId]: nextPrimaryView,
          }
    ))
    setActivePrimaryViewState((current) => current === nextPrimaryView ? current : nextPrimaryView)

    setTerminalCollapsedByWorkspaceId((current) => (
      current[routeWorkspaceId] === terminalCollapsedFromSearch
        ? current
        : {
            ...current,
            [routeWorkspaceId]: terminalCollapsedFromSearch,
          }
    ))
    setTerminalCollapsedState((current) => current === terminalCollapsedFromSearch ? current : terminalCollapsedFromSearch)
    if (terminalCollapsedFromSearch) {
      setTerminalMaximized(false)
    }
  }, [
    currentWorkspace?.id,
    search.panel,
    search.terminal,
    search.workspaceId,
    terminalCollapsedFromSearch,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleToggleWorkspaceTerminalShortcut(event)) {
        return
      }

      event.preventDefault()
      setTerminalCollapsed(!terminalCollapsed)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [setTerminalCollapsed, terminalCollapsed])

  useEffect(() => {
    if (!gitPanelEnabled && activePrimaryView === 'git') {
      setActivePrimaryView('chat')
    }
  }, [activePrimaryView, gitPanelEnabled])

  useEffect(() => {
    if (!displayTask || !workspaceSession) {
      if (activePrimaryView === 'records') {
        setActivePrimaryView('chat')
      }
    }
  }, [activePrimaryView, displayTask, workspaceSession])

  useEffect(() => {
    setTitleDraft(currentWorkspace?.name ?? '')
    setIsEditingTitle(false)
  }, [currentWorkspace?.id, currentWorkspace?.name])

  useEffect(() => {
    selectedWorkspaceSessionIdRef.current = selectedWorkspaceSessionId
  }, [selectedWorkspaceSessionId])

  const installWorkspaceCommand = environmentCommands.installCommand?.trim() || ''
  const environmentStartInTerminal = shouldRunEnvironmentStartInTerminal(environmentPreview)
  const shouldShowEnvironmentStop = shouldShowEnvironmentStopCommand(environmentPreview)
  const shouldShowEnvironmentLogs = shouldShowEnvironmentLogsCommand(environmentPreview)
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
  const workspaceRuntimeRepoPath = workspaceSessionRuntime?.repoPath
  const workspaceFileScopeRootPaths = useMemo(
    () => (workspaceFileExplorerRootPath ? [workspaceFileExplorerRootPath] : []),
    [workspaceFileExplorerRootPath],
  )
  const toolButtonClass = (active = false) => active
    ? 'h-7 w-7 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100'
    : 'h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40'
  if (!project) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-[#09090b] p-8 text-zinc-400">
        {t('workspace.notFoundOrInvalidTask', { defaultValue: '工作区不存在或关联任务已失效。' })}
      </div>
    )
  }

  if (!currentWorkspace) {
    if (search.workspaceId && workspacesLoading) {
      return <WorkspaceLoadingState message={t('workspace.loadingWorkspace', { defaultValue: '正在加载工作区...' })} />
    }

    if (search.workspaceId) {
      return (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-[#09090b] p-8 text-zinc-400">
          {t('workspace.noAccess', { defaultValue: '该工作区不存在或你暂时没有访问权限。' })}
        </div>
      )
    }

    return null
  }

  const handleOpenWorkspaceFileLink = (href: string) => {
    if (!isLikelyWorkspaceFileLinkHref(href)) {
      return false
    }

    const resolvedFilePath = resolveWorkspaceFileLinkPath({
      href,
      baseDirectoryPath: workspaceRuntimeRepoPath || workspaceFileExplorerRootPath || terminalCwd,
      candidateRootPaths: workspaceFileScopeRootPaths,
    })

    if (!resolvedFilePath) {
      toast.error(t('workspace.files.errors.outOfScope', { defaultValue: '该文件不在当前工作区目录内。' }))
      return true
    }

    if (!workspaceRuntimeExecutorId) {
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

  const resolveDesktopSandboxPayload = () => {
    if (!displayTask) {
      toast.error(t('workspace.desktop.noTask', { defaultValue: '当前工作区还没有可用任务，暂时无法启动 Desktop Sandbox。' }))
      return null
    }

    return {
      taskId: displayTask.id,
      payload: {
        workspaceId: currentWorkspace.id,
        workspaceSessionId: workspaceSession?.id,
      },
    }
  }

  const applyDesktopSandboxResponse = (desktop: WorkspaceDesktopSandboxDto, successMessage?: string) => {
    setDesktopSandbox(desktop)
    if (!desktop.ok) {
      toast.error(desktop.error || desktop.message || 'Desktop Sandbox 操作失败')
      return false
    }
    if (successMessage) {
      toast.success(successMessage)
    }
    return true
  }

  const handleOpenDesktopSandbox = async () => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('open')
    try {
      const response = await api.openTaskDesktopSandbox(scope.taskId, {
        ...scope.payload,
        displayProfile: desktopSandboxDisplayProfile,
        clientNetwork: desktopSandboxDisplayProfile === 'auto'
          ? readDesktopSandboxClientNetworkHint()
          : undefined,
      })
      applyDesktopSandboxResponse(response.desktop, response.desktop.ok ? 'Desktop Sandbox 已启动。' : undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 Desktop Sandbox 失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }

  const handleRefreshDesktopSandbox = async () => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('refresh')
    try {
      const response = await api.getTaskDesktopSandbox(scope.taskId, scope.payload.workspaceId, scope.payload.workspaceSessionId)
      applyDesktopSandboxResponse(response.desktop)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新 Desktop Sandbox 失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }

  const handleStopDesktopSandbox = async () => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('stop')
    try {
      const response = await api.stopTaskDesktopSandbox(scope.taskId, scope.payload)
      applyDesktopSandboxResponse(response.desktop, response.desktop.ok ? 'Desktop Sandbox 已停止。' : undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '停止 Desktop Sandbox 失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }

  const handleRunDesktopSandboxAction = async (action: WorkspaceDesktopSandboxAction) => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('action')
    try {
      const response = await api.runTaskDesktopSandboxAction(scope.taskId, {
        ...scope.payload,
        action,
      })
      applyDesktopSandboxResponse(response.desktop)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行 Desktop Sandbox 桌面动作失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }

  const handleRunDesktopSandboxCommand = async (command: string) => {
    const scope = resolveDesktopSandboxPayload()
    if (!scope) {
      return
    }

    setDesktopSandboxBusyAction('command')
    try {
      const response = await api.runTaskDesktopSandboxCommand(scope.taskId, {
        ...scope.payload,
        command,
      })
      applyDesktopSandboxResponse(response.desktop)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行 Desktop Sandbox 命令失败')
    } finally {
      setDesktopSandboxBusyAction(null)
    }
  }

  const handleOpenDesktopSandboxExternal = (targetUrl?: string) => {
    const url = targetUrl?.trim() || desktopSandbox?.viewUrl || desktopSandbox?.streamRedirectUrl || desktopSandbox?.streamUrl || desktopSandbox?.controlUrl || ''
    if (!url) {
      toast.error('Desktop Sandbox 还没有可打开的地址。')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleOpenRemoteCode = async () => {
    if (!remoteCodeScope.taskId || !remoteCodeScope.workspaceId) {
      toast.error(text(language, '当前工作区还没有可用任务，暂时无法打开 Code Server。', 'This workspace has no available task for Code Server.'))
      return
    }

    setRemoteCodeBusyAction('open')
    try {
      const response = await api.openTaskRemoteCode(remoteCodeScope.taskId, {
        workspaceId: remoteCodeScope.workspaceId,
        workspaceSessionId: remoteCodeScope.workspaceSessionId || undefined,
      })
      setRemoteCode(response.remoteCode)
      if (response.passwordOnce) {
        await navigator.clipboard?.writeText(response.passwordOnce).then(() => {
          toast.success(text(language, 'Code Server 密码已复制。', 'Code Server password copied.'))
        }).catch(() => {
          toast.message(text(language, `Code Server 密码：${response.passwordOnce}`, `Code Server password: ${response.passwordOnce}`))
        })
      }
      setRemoteCodeBusyAction('tunnel')
      const readyResponse = isRemoteCodeTunnelReady(response)
        ? response
        : await waitForRemoteCodeTunnel({
            openResponse: response,
            poll: () => api.getTaskRemoteCode(
              remoteCodeScope.taskId,
              remoteCodeScope.workspaceId,
              remoteCodeScope.workspaceSessionId || undefined,
            ),
            onUpdate: (nextResponse) => setRemoteCode(nextResponse.remoteCode),
          })
      setRemoteCode(readyResponse.remoteCode)
      const url = resolveRemoteCodeOpenUrl(readyResponse)
      if (!url) {
        toast.error(text(language, 'Code Server 隧道还没有就绪，请稍后重试。', 'Code Server tunnel is not ready yet. Please try again shortly.'))
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '打开 Code Server 失败', 'Failed to open Code Server'))
    } finally {
      setRemoteCodeBusyAction(null)
    }
  }

  const handleStopRemoteCode = async () => {
    if (!remoteCodeScope.taskId || !remoteCodeScope.workspaceId) {
      return
    }

    setRemoteCodeBusyAction('stop')
    try {
      const response = await api.stopTaskRemoteCode(remoteCodeScope.taskId, {
        workspaceId: remoteCodeScope.workspaceId,
        workspaceSessionId: remoteCodeScope.workspaceSessionId || undefined,
      })
      setRemoteCode(response.remoteCode)
      toast.success(text(language, 'Code Server 已停止。', 'Code Server stopped.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '停止 Code Server 失败', 'Failed to stop Code Server'))
    } finally {
      setRemoteCodeBusyAction(null)
    }
  }

  const openDesktopSandboxPanel = () => {
    if (!DESKTOP_SANDBOX_ENABLED) {
      return
    }
    setActivePrimaryView('desktop')
  }

  const handleDesktopSandboxDisplayProfileChange = (profile: WorkspaceDesktopSandboxDisplayProfile) => {
    setDesktopSandboxDisplayProfile(profile)
    writeStoredDesktopSandboxDisplayProfile(profile)
  }

  const workspacePanelButtons = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => toggleWorkspacePrimaryPanel('files')}
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
          onClick={() => toggleWorkspacePrimaryPanel('git')}
          className={toolButtonClass(activePrimaryView === 'git')}
          aria-label="Git"
          title="Git"
        >
          <GitBranch className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {DESKTOP_SANDBOX_ENABLED ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => toggleWorkspacePrimaryPanel('desktop')}
          disabled={!displayTask}
          className={toolButtonClass(activePrimaryView === 'desktop')}
          aria-label="Desktop Sandbox"
          title="Desktop Sandbox"
        >
          <Monitor className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </>
  )

  const handleTaskUpdate = (updatedTask: Task) => {
    setState((prev) => {
      const baseTask = prev.tasks.find((item) => item.id === updatedTask.id) ?? updatedTask
      const nextTasks = prev.tasks.map((item) => (item.id === updatedTask.id ? stripWorkspaceExecutionFieldsFromTask(baseTask, updatedTask) : item))

      if (!currentWorkspace) {
        return {
          ...prev,
          tasks: nextTasks,
        }
      }

      const latestWorkspaceSession = resolveWorkspaceSessionForWorkspace({
        workspaceId: currentWorkspace.id,
        workspaceSessionId: search.workspaceSessionId,
        workspaceSessions: prev.workspaceSessions,
      })

      if (!latestWorkspaceSession) {
        return {
          ...prev,
          tasks: nextTasks,
        }
      }

      const nextSession = syncWorkspaceSessionFromTaskExecutionView(baseTask, latestWorkspaceSession, updatedTask)
      return {
        ...prev,
        tasks: nextTasks,
        workspaceSessions: prev.workspaceSessions.some((item) => item.id === nextSession.id)
          ? prev.workspaceSessions.map((item) => (item.id === nextSession.id ? nextSession : item))
          : [nextSession, ...prev.workspaceSessions],
      }
    })
  }

  const handleSelectWorkspaceSession = (nextWorkspaceSessionId: string, nextWorkspaceId = search.workspaceId) => {
    const nextWorkspaceSession = workspaceSessions.find((session) => session.id === nextWorkspaceSessionId)
    if (nextWorkspaceSession) {
      markWorkspaceSessionRead(nextWorkspaceSession)
    }

    navigate({
      to: '/workspace',
      search: buildRouteSearch({
        projectId: search.projectId,
        taskId: workspaceTask?.id || search.taskId,
        workspaceId: nextWorkspaceId,
        workspaceSessionId: nextWorkspaceSessionId || undefined,
        launchId: search.launchId,
      }),
      replace: true,
    })
  }

  useEffect(() => {
    const chat = chatRef.current
    if (
      !pendingPostForkAction
      || pendingPostForkAction.targetWorkspaceSessionId !== (workspaceSession?.id || '')
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
  }, [chatReady, chatRef, pendingPostForkAction, workspaceSession?.id])

  const handleCreateWorkspaceSession = async () => {
    if (!currentWorkspace) {
      toast.error(t('workspace.noAccess', { defaultValue: '该工作区不存在或你暂时没有访问权限。' }))
      return
    }

    try {
      const previousSessionIds = new Set(state.workspaceSessions
        .filter((item) => item.workspaceId === currentWorkspace.id)
        .map((item) => item.id))
      const response = await api.createWorkspaceSession(currentWorkspace.id, {
        baseBranch: workspaceSession?.baseBranch || workspaceTask?.baseBranch || workspaceTask?.baseBranchHint,
        workspaceSessionId: workspaceSession?.id,
        createNewSession: true,
      })
      setState(response.state)
      const responseTaskId = response.taskId ?? workspaceTask?.id
      const nextSession = resolveCreatedWorkspaceSession({
        workspaceId: currentWorkspace.id,
        previousSessionIds,
        response,
      })

      if (nextSession) {
        const preservePreviewPanel = activePrimaryView === 'preview'
        if (!preservePreviewPanel) {
          setActivePrimaryView('chat')
        }
        navigate({
          to: '/workspace',
          search: buildRouteSearch({
            taskId: responseTaskId,
            workspaceSessionId: nextSession.id,
            panel: preservePreviewPanel ? 'preview' : undefined,
            launchId: search.launchId,
          }),
          replace: true,
        })
      }
      toast.success(t('workspace.session.created', { defaultValue: '已新建工作区会话。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.session.createFailed', { defaultValue: '新建工作区会话失败' }))
    }
  }

  const handleRenameWorkspace = async () => {
    const nextName = titleDraft.trim()
    if (!nextName) {
      toast.error(t('workspace.rename.emptyTitle', { defaultValue: '工作区标题不能为空' }))
      return
    }

    if (nextName === currentWorkspace.name) {
      setIsEditingTitle(false)
      return
    }

    setRenameBusy(true)
    try {
      const response = await api.updateWorkspace(currentWorkspace.id, { name: nextName })
      setWorkspaces(response.workspaces)
      setTitleDraft(response.workspace.name)
      setIsEditingTitle(false)
      toast.success(response.message || t('workspace.rename.updated', { defaultValue: '工作区标题已更新。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.rename.updateFailed', { defaultValue: '更新工作区标题失败' }))
    } finally {
      setRenameBusy(false)
    }
  }

  const handleRenameWorkspaceSession = async (workspaceSessionId: string, title: string) => {
    const nextTitle = title.trim()
    const targetSession = workspaceSessions.find((item) => item.id === workspaceSessionId)
    if (!currentWorkspace || !targetSession || !nextTitle || nextTitle === targetSession.title) {
      return
    }

    const response = await renameWorkspaceSession({
      workspaceSessionId,
      workspaceId: currentWorkspace.id,
      title: nextTitle,
    })
    setState(response.state)
    if (response.workspaceSessionId && response.workspaceSessionId !== search.workspaceSessionId) {
      handleSelectWorkspaceSession(response.workspaceSessionId)
    }
    toast.success(t('workspace.session.rename.updated', { defaultValue: '会话名称已更新。' }))
  }

  const handleDeleteWorkspaceSession = async (workspaceSessionId: string) => {
    const targetSession = workspaceSessions.find((item) => item.id === workspaceSessionId)
    if (!targetSession || !currentWorkspace) {
      return
    }

    const confirmed = await confirm({
      title: text(language, `确认删除会话「${targetSession.title}」？`, `Delete session "${targetSession.title}"?`),
      description: text(language, '这会删除该会话，并尝试清理对应的本地隔离目录。不会删除整个工作区。', 'This deletes the session and tries to clean up its local isolated directory. It will not delete the whole workspace.'),
      confirmText: text(language, '删除会话', 'Delete Session'),
      cancelText: text(language, '取消', 'Cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    setDeletingWorkspaceSessionId(workspaceSessionId)
    try {
      const response = await runMutation(() => api.deleteWorkspaceSession(currentWorkspace.id, workspaceSessionId))
      if (!response) {
        return
      }

      if (workspaceSessionId === search.workspaceSessionId) {
        handleSelectWorkspaceSession(response.workspaceSessionId ?? '')
      }
    } finally {
      setDeletingWorkspaceSessionId('')
    }
  }

  const handleReorderWorkspaceSessions = async (orderedWorkspaceSessionIds: string[]) => {
    if (!currentWorkspace || orderedWorkspaceSessionIds.length <= 1) {
      return
    }

    setReorderingWorkspaceSessions(true)
    try {
      const response = await api.reorderWorkspaceSessions(currentWorkspace.id, {
        orderedSessionIds: orderedWorkspaceSessionIds,
      })
      setState(response.state)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.session.reorderFailed', { defaultValue: '更新会话顺序失败。' }))
      throw error
    } finally {
      setReorderingWorkspaceSessions(false)
    }
  }

  const handleForkWorkspaceSessionFromMessage = async (messageId: string, mode: 'local' | 'worktree') => {
    if (!displayTask || !currentWorkspace || !workspaceSession) {
      toast.error(t('workspace.currentMissing', { defaultValue: '当前工作区或会话不存在。' }))
      return
    }

    setForkingMessageId(messageId)
    try {
      const response = await api.forkWorkspaceSession(currentWorkspace.id, workspaceSession.id, {
        taskId: displayTask.id,
        sourceMessageId: messageId,
        mode,
      })
      setState(response.state)
      const nextWorkspaceSessionId = response.workspaceSessionId ?? response.workspaceSession?.id
      const nextWorkspaceId = response.workspaceId ?? response.workspaceSession?.workspaceId ?? currentWorkspace.id
      if (response.workspaces) {
        setWorkspaces(response.workspaces)
      }
      if (nextWorkspaceSessionId) {
        handleSelectWorkspaceSession(nextWorkspaceSessionId, nextWorkspaceId)
      }
      toast.success(response.message || t('workspace.session.forked', { defaultValue: '分叉会话已创建。' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.session.forkFailed', { defaultValue: '创建分叉会话失败。' }))
    } finally {
      setForkingMessageId(null)
    }
  }

  const handleReviseWorkspaceSessionTurn = async (payload: WorkspaceSessionChatRevisionAction) => {
    if (!displayTask || !currentWorkspace || !workspaceSession) {
      toast.error(t('workspace.currentMissing', { defaultValue: '当前工作区或会话不存在。' }))
      return
    }

    setRevisingTurnId(payload.turnId)
    try {
      const response = await api.forkWorkspaceSession(currentWorkspace.id, workspaceSession.id, {
        taskId: displayTask.id,
        sourceMessageId: payload.sourceMessageId,
        mode: payload.mode,
        revision: {
          kind: payload.kind,
          sourceTurnId: payload.turnId,
          sourceUserMessageId: payload.kind === 'retry-assistant-turn' ? payload.userMessageId : payload.sourceMessageId,
          sourceAssistantMessageId: payload.kind === 'retry-assistant-turn' ? payload.assistantMessageId : undefined,
        },
      })
      setState(response.state)
      const nextWorkspaceSessionId = response.workspaceSessionId ?? response.workspaceSession?.id
      const nextWorkspaceId = response.workspaceId ?? response.workspaceSession?.workspaceId ?? currentWorkspace.id
      if (!nextWorkspaceSessionId) {
        throw new Error('分叉成功，但没有返回新的工作区会话。')
      }
      if (response.workspaces) {
        setWorkspaces(response.workspaces)
      }

      setPendingPostForkAction({
        targetWorkspaceSessionId: nextWorkspaceSessionId,
        action: payload.kind === 'retry-assistant-turn' ? 'send' : 'prefill',
        draft: {
          text: payload.text,
          attachments: payload.attachments,
        },
      })
      handleSelectWorkspaceSession(nextWorkspaceSessionId, nextWorkspaceId)
      toast.success(response.message || t('workspace.session.forked', { defaultValue: '分叉会话已创建。' }))
    } catch (error) {
      setPendingPostForkAction(null)
      toast.error(error instanceof Error ? error.message : t('workspace.session.forkFailed', { defaultValue: '创建分叉会话失败。' }))
    } finally {
      setRevisingTurnId(null)
    }
  }

  const handleUpdateWorkspaceAutoCommit = async (enabled: boolean) => {
    if (resolveWorkspaceAutoCommitEnabled(currentWorkspace) === enabled) {
      return true
    }

    setAutoCommitBusy(true)
    try {
      const response = await api.updateWorkspace(currentWorkspace.id, {
        name: currentWorkspace.name,
        autoCommitEnabled: enabled,
      })
      setWorkspaces(response.workspaces)
      toast.success(
        enabled
          ? t('workspace.autoCommit.enabled', { defaultValue: '已开启自动提交 / 推送。' })
          : t('workspace.autoCommit.disabled', { defaultValue: '已关闭自动提交 / 推送。' }),
      )
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.autoCommit.updateFailed', { defaultValue: '更新自动提交设置失败。' }))
      return false
    } finally {
      setAutoCommitBusy(false)
    }
  }

  const openWorkspaceSettings = () => {
    setTitleDraft(currentWorkspace.name)
    setWorkspaceSettingsAutoCommitEnabled(resolveWorkspaceAutoCommitEnabled(currentWorkspace))
    setWorkspaceSettingsOpen(true)
  }
  const canMarkCurrentWorkspaceSessionUnread = Boolean(
    workspaceSession && getWorkspaceSessionAttentionSignature(workspaceSession),
  )
  const handleMarkCurrentWorkspaceSessionUnread = () => {
    if (!workspaceSession || !markWorkspaceSessionUnread(workspaceSession)) {
      return
    }

    toast.success(t('workspace.pageView.messages.currentSessionMarkedUnread', { defaultValue: '已将当前会话标记为未读。' }))
  }

  useEffect(() => {
    setActiveWorkspaceOpenTarget(getStoredWorkspaceOpenTarget(state.config.workspaceOpenSettings.defaultTarget))
  }, [state.config.workspaceOpenSettings.defaultTarget])

  const openCurrentWorkspaceInTarget = useCallback(async (target: WorkspaceOpenTarget) => {
    if (openingWorkspaceTarget || !currentWorkspace) {
      return
    }
    const executorName = workspaceRuntimeExecutorName || currentWorkspace.executorName
    setOpeningWorkspaceTarget(target)
    try {
      const opened = await openWorkspaceInTarget({
        executorId: workspaceRuntimeExecutorId,
        executorName,
        platform: workspaceExecutor?.platform,
        candidateCwds: terminalCandidateCwds,
        target,
        customCommand: state.config.workspaceOpenSettings.customCommand,
        debugPrefix: '[Wemux][Workspace Open][/workspace]',
        t,
      })
      if (opened) {
        setStoredWorkspaceOpenTarget(target)
        setActiveWorkspaceOpenTarget(target)
      }
    } finally {
      setOpeningWorkspaceTarget(null)
    }
  }, [
    currentWorkspace,
    openingWorkspaceTarget,
    state.config.workspaceOpenSettings.customCommand,
    t,
    terminalCandidateCwds,
    workspaceExecutor?.platform,
    workspaceRuntimeExecutorId,
    workspaceRuntimeExecutorName,
  ])

  const desktopPersistentTerminal = useMemo(() => {
    if (isMobile || !currentWorkspace) {
      return null
    }

    const shouldLoadTerminalSessions = !terminalCollapsed || Boolean(terminalCommandRequest)

    return {
      collapsed: terminalCollapsed,
      cwd: terminalCwd,
      executorId: workspaceRuntimeExecutorId,
      executorName: workspaceRuntimeExecutorName,
      executorRealtimeBaseUrl: workspaceExecutor?.realtimeBaseUrl,
      projectId: project.id,
      workspaceId: currentWorkspace.id,
      workspaceName: currentWorkspace.name,
      installCommand: installWorkspaceCommand,
      startCommand: environmentPreview?.startCommand,
      logsCommand: environmentPreview?.logsCommand,
      maximized: terminalMaximized,
      panelKey: currentWorkspace.id,
      shouldLoadSessions: shouldLoadTerminalSessions,
      commandRequest: terminalCommandRequest,
      onCollapsedChange: setTerminalCollapsed,
      onMaximizedChange: setTerminalMaximized,
      onOpenStateChange: (open: boolean) => {
        if (!open) {
          markEnvironmentTerminalClosed()
        }
      },
      onOpenWorkspaceTarget: async () => {
        await openCurrentWorkspaceInTarget(activeWorkspaceOpenTarget)
      },
    }
  }, [
    activeWorkspaceOpenTarget,
    currentWorkspace,
    environmentPreview?.logsCommand,
    environmentPreview?.startCommand,
    installWorkspaceCommand,
    isMobile,
    markEnvironmentTerminalClosed,
    openCurrentWorkspaceInTarget,
    project.id,
    setTerminalCollapsed,
    terminalCollapsed,
    terminalCommandRequest,
    terminalCwd,
    terminalMaximized,
    workspaceRuntimeExecutorId,
    workspaceRuntimeExecutorName,
  ])
  useDesktopPersistentWorkspaceTerminal(desktopPersistentTerminal)

  const handleStartEnvironment = () => {
    const startCommand = environmentPreview?.startCommand?.trim()
    if (!startCommand) {
      return
    }

    markEnvironmentTerminalStart()
    setTerminalCollapsed(false)
    setTerminalCommandRequest({
      id: crypto.randomUUID(),
      kind: 'command',
      bindingKey: 'environment',
      workspaceId: currentWorkspace?.id,
      command: startCommand,
      successMessage: t('workspace.environment.startedInTerminal', {
        defaultValue: '已在终端启动环境。日志会直接输出到终端，停止请用 Ctrl+C。',
      }),
    })
  }

  const handleStopEnvironment = () => {
    const stopCommand = environmentPreview?.stopCommand?.trim()

    markEnvironmentTerminalStop()
    setTerminalCollapsed(false)
    if (stopCommand) {
      setTerminalCommandRequest({
        id: crypto.randomUUID(),
        kind: 'command',
        bindingKey: 'environment',
        workspaceId: currentWorkspace?.id,
        command: stopCommand,
        successMessage: t('workspace.environment.stopCommandStartedInTerminal', {
          defaultValue: '已在终端执行环境停止命令。',
        }),
      })
      return
    }

    setTerminalCommandRequest({
      id: crypto.randomUUID(),
      kind: 'interrupt',
      bindingKey: 'environment',
      workspaceId: currentWorkspace?.id,
      successMessage: t('workspace.environment.stopSentToTerminal', {
        defaultValue: '已向环境终端发送 Ctrl+C。',
      }),
    })
  }

  const handleOpenEnvironmentLogs = () => {
    const logsCommand = environmentPreview?.logsCommand?.trim()

    setTerminalCollapsed(false)
    if (logsCommand) {
      setTerminalCommandRequest({
        id: crypto.randomUUID(),
        kind: 'command',
        bindingKey: 'environment',
        workspaceId: currentWorkspace?.id,
        command: logsCommand,
        successMessage: t('workspace.environment.logsCommandStartedInTerminal', {
          defaultValue: '已在终端执行环境日志命令。',
        }),
      })
      return
    }

    setTerminalCommandRequest({
      id: crypto.randomUUID(),
      kind: 'focus',
      bindingKey: 'environment',
      workspaceId: currentWorkspace?.id,
    })
    toast.message(t('workspace.environment.logsInTerminal', {
      defaultValue: '环境日志会直接输出到下方终端。',
    }))
  }
  const workspaceLaunchStatusBanner = activeLaunch ? (
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            launchStatus === 'failed'
              ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
              : 'border-sky-500/20 bg-sky-500/10 text-sky-100',
          )}
        >
          {launchStatus === 'failed'
            ? t('workspace.launch.failedWithReason', { defaultValue: '工作区启动失败：{{message}}', message: launchError || t('workspace.launch.continueManually', { defaultValue: '请手动继续填写并发送首条消息。' }) })
            : launchStatus === 'done'
              ? t('workspace.launch.done', { defaultValue: '工作区已准备完成，首条消息已预填到发送框。' })
              : t('workspace.launch.preparing', { defaultValue: '正在准备工作区环境，准备完成后会把首条消息预填到发送框。' })}
        </div>
      ) : null
  const shouldShowEnvironmentStatusBanner = Boolean(
    hasEnvironmentControls
    && project.environmentTemplate
    && (
      activePrimaryView === 'preview'
      || environmentStatus
      || environmentStatusLoading
      || environmentBusyAction
    ),
  )
  const environmentStatusBanner = shouldShowEnvironmentStatusBanner
    ? (
        <WorkspaceEnvironmentStatusBanner
          status={environmentStatus}
          loading={environmentStatusLoading || Boolean(environmentBusyAction)}
          appUrl={environmentPreview?.appUrl}
          healthUrl={environmentPreview?.healthUrl}
          localEnvironmentProbe={localEnvironmentProbe}
          localWorkerDiagnostics={localWorkerDiagnostics}
          onOpenApp={environmentPreview?.appUrl ? handleOpenEnvironmentApp : undefined}
          onRefreshLocalProbes={refreshLocalDirectProbes}
          onRefresh={refreshEnvironmentStatus}
        />
      )
    : null
  const statusBanner = workspaceLaunchStatusBanner || environmentStatusBanner
    ? (
        <div className="flex flex-col gap-3">
          {workspaceLaunchStatusBanner}
          {environmentStatusBanner}
        </div>
      )
    : null

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden bg-[#09090b] text-zinc-100', isMobile ? 'min-h-[calc(100vh-3.5rem)]' : 'h-full flex-1')}>
      <div className="min-h-0 flex-1">
        <WorkspaceShell
        project={project}
        workspace={currentWorkspace}
        displayTask={displayTask}
        workspaceSessions={workspaceSessions}
        selectedWorkspaceSessionId={selectedWorkspaceSessionId}
        workspaceSessionUnreadState={workspaceSessionUnreadState}
        availableAgents={availableAgents}
        workspaceSessionListPlacement={isMobile ? 'top' : 'side'}
        activePrimaryView={activePrimaryView}
        isMobile={isMobile}
        statusBanner={statusBanner}
        headerLeading={(
          <Button
            variant="ghost"
            onClick={() => navigate(task
              ? { to: '/kanban', search: { projectId: project.id, taskId: task.id, createTask: undefined } }
              : {
                  to: '/workspaces',
                  search: buildWorkspaceRouteSearch({
                    projectId: project.id,
                    taskId: workspaceTask?.id || undefined,
                    workspaceId: currentWorkspace.id,
                    workspaceSessionId: workspaceSession?.id || undefined,
                    panel: search.panel,
                    terminal: terminalCollapsed ? undefined : '1',
                  }),
                })}
            className="px-0 text-zinc-400 hover:bg-transparent hover:text-zinc-100"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {task ? t('workspace.backToTask', { defaultValue: '返回任务' }) : t('workspace.backToWorkspaces', { defaultValue: '返回工作区' })}
          </Button>
        )}
        headerActions={(
          <div className="flex items-center gap-1">
            {!isMobile ? workspacePanelButtons : null}
            {DESKTOP_SANDBOX_ENABLED ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openDesktopSandboxPanel}
                disabled={!displayTask}
                className={cn(
                  'h-7 rounded-md border px-2 text-xs',
                  activePrimaryView === 'desktop'
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40',
                )}
                aria-label="Desktop Sandbox"
                title="Desktop Sandbox"
              >
                <Monitor className="mr-1.5 h-3.5 w-3.5" />
                Desktop
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={openWorkspaceMemberSettings}
              className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label={text(language, '成员与共享设置', 'Members & Sharing Settings')}
              title={text(language, '成员与共享设置', 'Members & Sharing Settings')}
            >
              <Users className="h-3.5 w-3.5" />
            </Button>
            {workspaceSession?.id && displayTask ? (
              <WorkspaceSessionShareMenu
                projectId={project.id}
                taskId={workspaceTask?.id}
                workspaceId={currentWorkspace.id}
                workspaceSessionId={workspaceSession.id}
                workspaceSessionTitle={workspaceSession.title ?? ''}
              />
            ) : null}
            <WorkspaceOpenAction
              busy={Boolean(openingWorkspaceTarget)}
              disabled={terminalCandidateCwds.length === 0}
              activeTarget={activeWorkspaceOpenTarget}
              onOpen={(target) => void openCurrentWorkspaceInTarget(target)}
              buttonClassName="gap-0"
              menuClassName="h-7 w-7 border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleOpenRemoteCode()}
        disabled={!displayTask || remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel'}
              className={cn(
                'h-7 rounded-md border px-2 text-xs',
                remoteCode?.phase === 'ready'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40',
              )}
              aria-label="Code Server"
              title="Code Server"
            >
        {remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel'
          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          : <Code2 className="mr-1.5 h-3.5 w-3.5" />}
        {remoteCodeBusyAction === 'tunnel' ? '建立隧道' : 'Code Server'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label={text(language, '工作区操作', 'Workspace actions')}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={openWorkspaceMemberSettings}>
                  <Users className="h-4 w-4" />
                  {text(language, '成员与共享设置', 'Members & Sharing Settings')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openWorkspaceSettings}>
                  <SlidersHorizontal className="h-4 w-4" />
                  {text(language, '工作区设置', 'Workspace Settings')}
                </DropdownMenuItem>
                {DESKTOP_SANDBOX_ENABLED ? (
                  <DropdownMenuItem onSelect={openDesktopSandboxPanel} disabled={!displayTask}>
                    <Monitor className="h-4 w-4" />
                    Desktop Sandbox
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => void handleOpenRemoteCode()} disabled={!displayTask || remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel'}>
                  {remoteCodeBusyAction === 'open' || remoteCodeBusyAction === 'tunnel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}
                  {remoteCodeBusyAction === 'tunnel' ? text(language, '建立 Code Server 隧道', 'Opening Code Server tunnel') : 'Code Server'}
                </DropdownMenuItem>
                {remoteCode?.phase === 'ready' ? (
                  <DropdownMenuItem onSelect={() => void handleStopRemoteCode()} disabled={remoteCodeBusyAction === 'stop'}>
                    {remoteCodeBusyAction === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                    {text(language, '停止 Code Server', 'Stop Code Server')}
                  </DropdownMenuItem>
                ) : null}
                {canMarkCurrentWorkspaceSessionUnread ? (
                  <DropdownMenuItem onSelect={handleMarkCurrentWorkspaceSessionUnread}>
                    <CircleDot className="h-4 w-4" />
                    {t('workspace.pageView.actions.markCurrentSessionUnread', { defaultValue: '设为未读' })}
                  </DropdownMenuItem>
                ) : null}
                {parentWorkspaceSession ? (
                  <DropdownMenuItem onSelect={() => void handleBackToParentSession()}>
                    <ArrowLeft className="h-4 w-4" />
                    {parentWorkspaceSession.sessionRole === 'tester'
                      ? text(language, '返回测试会话', 'Back to test session')
                      : text(language, '返回父会话', 'Back to parent session')}
                  </DropdownMenuItem>
                ) : null}
                {hasEnvironmentControls ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={handleStartEnvironment}
                      disabled={Boolean(environmentBusyAction) || !environmentPreview?.startCommand}
                    >
                      {environmentBusyAction === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {environmentStartInTerminal
                        ? text(language, '在终端启动环境', 'Start in Terminal')
                        : text(language, '启动环境', 'Start Environment')}
                    </DropdownMenuItem>
                    {shouldShowEnvironmentStop ? (
                      <DropdownMenuItem
                        onSelect={handleStopEnvironment}
                        disabled={Boolean(environmentBusyAction)}
                      >
                        {environmentBusyAction === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        {environmentStartInTerminal
                          ? text(language, '停止终端环境', 'Stop Terminal Environment')
                          : text(language, '停止环境', 'Stop Environment')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => setActivePrimaryView('preview')}
                      disabled={!environmentPreview?.appUrl || previewBusyAction === 'open'}
                    >
                      {previewBusyAction === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                      {text(language, '开发预览', 'Preview')}
                    </DropdownMenuItem>
                    {shouldShowEnvironmentLogs ? (
                      <DropdownMenuItem
                        onSelect={handleOpenEnvironmentLogs}
                        disabled={Boolean(environmentBusyAction)}
                      >
                        {environmentBusyAction === 'logs' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" />}
                        {environmentStartInTerminal
                          ? text(language, '查看终端日志', 'Show Terminal Logs')
                          : text(language, '环境日志', 'Environment Logs')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => void handleOpenEnvironmentApp()} disabled={!environmentPreview?.appUrl}>
                      <ExternalLink className="h-4 w-4" />
                      {text(language, '打开应用', 'Open App')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        mobileHeaderToolbar={isMobile ? workspacePanelButtons : undefined}
        emptyActions={(
          <>
            {terminalCollapsed ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setTerminalCollapsed(false)}
                className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
              >
                {t('workspace.terminal.expand', { defaultValue: '展开终端' })}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => void handleCreateWorkspaceSession()}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              <Bot className="mr-2 h-4 w-4" />
              {t('workspace.shell.createSession', { defaultValue: '新建 AI 对话' })}
            </Button>
            <Button asChild variant="outline" className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
              <Link
                to="/workspaces"
                search={buildWorkspaceRouteSearch({
                  projectId: project.id,
                  taskId: workspaceTask?.id || undefined,
                  workspaceId: currentWorkspace.id,
                  workspaceSessionId: workspaceSession?.id || undefined,
                  panel: search.panel,
                  terminal: terminalCollapsed ? undefined : '1',
                })}
              >
                {t('workspace.viewAll', { defaultValue: '查看全部工作区' })}
              </Link>
            </Button>
          </>
        )}
        terminalCollapsed={terminalCollapsed}
        terminalMaximized={terminalMaximized}
        terminalSection={isMobile ? lazyWorkspacePanel(
          <WorkspaceTerminalPanel
            collapsed={terminalCollapsed}
            cwd={terminalCwd}
            executorId={workspaceRuntimeExecutorId}
            executorName={workspaceRuntimeExecutorName}
            executorRealtimeBaseUrl={workspaceExecutor?.realtimeBaseUrl}
            projectId={project.id}
            workspaceId={currentWorkspace.id}
            workspaceName={currentWorkspace.name}
            installCommand={installWorkspaceCommand}
            startCommand={environmentPreview?.startCommand}
            logsCommand={environmentPreview?.logsCommand}
            maximized={terminalMaximized}
            isMobile
            panelKey={currentWorkspace.id}
            shouldLoadSessions={!terminalCollapsed || Boolean(terminalCommandRequest)}
            commandRequest={terminalCommandRequest}
            onCollapsedChange={setTerminalCollapsed}
            onMaximizedChange={setTerminalMaximized}
            onOpenStateChange={(open) => {
              if (!open) {
                markEnvironmentTerminalClosed()
              }
            }}
            onOpenWorkspaceTarget={async () => {
              await openCurrentWorkspaceInTarget(activeWorkspaceOpenTarget)
            }}
          />,
          t('workspace.terminal.loading', { defaultValue: '正在加载终端...' }),
        ) : undefined}
        onTerminalCollapsedChange={setTerminalCollapsed}
        onTerminalMaximizedChange={setTerminalMaximized}
        bodyStyle={isMobile ? {
          gridTemplateRows: terminalCollapsed
            ? 'minmax(0, 1fr) auto'
            : 'minmax(0, 1fr) minmax(220px, 34vh)',
        } : undefined}
        titleDraft={titleDraft}
        renameBusy={renameBusy}
        isEditingTitle={isEditingTitle}
        reorderingWorkspaceSessions={reorderingWorkspaceSessions}
        canEditTitle={false}
        canCreateWorkspaceSession
        gitPanelEnabled={gitPanelEnabled}
        testRecordsEnabled={Boolean(displayTask && workspaceSession)}
        onTitleDraftChange={setTitleDraft}
        onStartEditTitle={() => setIsEditingTitle(true)}
        onCancelEditTitle={() => {
          setTitleDraft(currentWorkspace.name)
          setIsEditingTitle(false)
        }}
        onRenameWorkspace={() => void handleRenameWorkspace()}
        onRenameWorkspaceSession={handleRenameWorkspaceSession}
        onDeleteWorkspaceSession={(workspaceSessionId) => {
          void handleDeleteWorkspaceSession(workspaceSessionId)
        }}
        onReorderWorkspaceSessions={handleReorderWorkspaceSessions}
        deletingWorkspaceSessionId={deletingWorkspaceSessionId}
        onSelectWorkspaceSession={handleSelectWorkspaceSession}
        onCreateWorkspaceSession={() => void handleCreateWorkspaceSession()}
        onPrimaryViewChange={setActivePrimaryView}
        chatContent={displayTask ? (
          <WorkspaceSessionChat
            ref={handleChatRef}
            key={`${displayTask.id}:${currentWorkspace.id}:${workspaceSession?.id || 'latest'}`}
            task={displayTask}
            allTasks={state.tasks}
            agentSettings={state.config.agentSettings}
            mcpServers={state.config.mcpServers}
            project={project}
            mentionProjects={state.projects}
            initialInput={launchPrefill}
            preparingWorkspace={workspacePreparing}
            executors={workspaceChatExecutors}
            chrome="flush"
            hideHeader
            open
            workspaceId={currentWorkspace.id}
            workspaceSessionId={workspaceSession?.id}
            workspaceSession={workspaceSession}
            workspaceSessions={workspaceSessions}
            workspaceWorkingDirectoryMode={workspaceSession?.workingDirectoryMode ?? currentWorkspace.workingDirectoryMode}
            workspaceBranchName={currentWorkspace.codeBranchName || workspaceSession?.branchName}
            workspaceBaseBranch={currentWorkspace.codeBaseBranch || workspaceSession?.baseBranch || displayTask.baseBranch}
            workspaceOwnerUserId={currentWorkspace.ownerUserId}
            workspaceRoot={workspaceExecutor?.workspaceRoot || state.config.workspaceRoot}
            workspaceRepoPath={workspaceRuntimeRepoPath}
            activeExecutorId={workspaceRuntimeExecutorId}
            activeExecutorName={workspaceRuntimeExecutorName}
            onOpenWorkspaceFileLink={handleOpenWorkspaceFileLink}
            launchId={activeLaunch?.launchId}
            onTaskUpdate={handleTaskUpdate}
            onWorkspaceSessionChange={({ workspaceSessionId: nextWorkspaceSessionId, state: nextState }) => {
              const normalizedSourceWorkspaceSessionId = workspaceSession?.id?.trim() || ''
              const normalizedNextWorkspaceSessionId = nextWorkspaceSessionId.trim()
              if (
                normalizedSourceWorkspaceSessionId
                && normalizedNextWorkspaceSessionId === normalizedSourceWorkspaceSessionId
                && selectedWorkspaceSessionIdRef.current
                && selectedWorkspaceSessionIdRef.current !== normalizedSourceWorkspaceSessionId
              ) {
                return
              }
              setState(nextState)
              if (normalizedNextWorkspaceSessionId !== search.workspaceSessionId) {
                handleSelectWorkspaceSession(normalizedNextWorkspaceSessionId)
              }
            }}
            onForkFromMessage={handleForkWorkspaceSessionFromMessage}
            forkingMessageId={forkingMessageId}
            onReviseTurn={handleReviseWorkspaceSessionTurn}
            revisingTurnId={revisingTurnId}
            onAssignExecutor={async (taskId, executorNodeId, targetWorkspaceId, targetWorkspaceSessionId) => {
              const workspaceId = targetWorkspaceId || currentWorkspace.id
              const requestId = executorSwitchRequestIdRef.current + 1
              executorSwitchRequestIdRef.current = requestId
              try {
                console.info('[workspace-route][executor-switch][request]', {
                  taskId,
                  workspaceId,
                  workspaceSessionId: targetWorkspaceSessionId,
                  requestedExecutorId: executorNodeId,
                  currentSessionExecutorId: workspaceSession?.executorNodeId,
                  currentRuntimeOwnerExecutorId: workspaceSession?.runtimeOwnerExecutorId,
                  currentWorkspaceExecutorId: currentWorkspace.executorNodeId,
                })
                const response = await api.updateWorkspace(workspaceId, {
                  name: currentWorkspace.name,
                  executorNodeId,
                  autoCommitEnabled: currentWorkspace.autoCommitEnabled,
                  taskId,
                  workspaceSessionId: targetWorkspaceSessionId,
                })
                console.info('[workspace-route][executor-switch][response]', {
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
                setWorkspaces(response.workspaces)
                console.info('[workspace-route][executor-switch][state-apply]', {
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
          />
        ) : null}
        gitContent={activePrimaryView === 'git' && displayTask ? lazyWorkspacePanel(
          <WorkspaceGitPanel
            task={displayTask}
            workspace={currentWorkspace}
            workspaceSession={workspaceSession}
            projectDefaultBranch={project.defaultBranch}
            versionControl={project.versionControl}
            className="flex h-full min-h-0 flex-col"
          />,
          t('workspace.git.loading', { defaultValue: '正在加载 Git 面板...' }),
        ) : null}
        recordsContent={activePrimaryView === 'records' && displayTask ? lazyWorkspacePanel(
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
              handleSelectWorkspaceSession(workspaceSessionId)
            }}
          />,
          t('workspace.records.loading', { defaultValue: '正在加载测试记录...' }),
        ) : null}
        previewContent={activePrimaryView === 'preview' && displayTask ? lazyWorkspacePanel(
          <WorkspacePreviewPanel
            busyAction={previewBusyAction}
            executorId={workspaceRuntimeExecutorId}
            executor={workspaceExecutor}
            iframeUrl={previewViewer?.iframeUrl}
            preview={previewSession}
            previewAccessRoute={previewAccessRoute}
            shareUrl={previewShareUrl}
            sourceAppUrl={environmentPreview?.appUrl}
            previewSources={environmentPreviewSources}
            onOpen={() => void handleOpenWorkspacePreview()}
            onOpenExternal={(targetUrl, options) => handleOpenWorkspacePreviewInBrowser(targetUrl, options)}
            onRefresh={() => void handleRefreshWorkspacePreview()}
            onRevokeShare={() => void handleRevokeWorkspacePreviewShare()}
            onShare={() => void handleShareWorkspacePreview()}
            onStop={() => void handleStopWorkspacePreview()}
          />,
          t('workspace.preview.loading', { defaultValue: '正在加载预览...' }),
        ) : null}
        desktopContent={DESKTOP_SANDBOX_ENABLED && activePrimaryView === 'desktop' && displayTask ? lazyWorkspacePanel(
          <WorkspaceDesktopSandboxPanel
            busyAction={desktopSandboxBusyAction}
            desktop={desktopSandbox}
            displayProfile={desktopSandboxDisplayProfile}
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
        filesContent={activePrimaryView === 'files' && currentWorkspace ? lazyWorkspacePanel(
          <WorkspaceFilesPanel
            executorId={workspaceRuntimeExecutorId}
            initialDirectoryPath={workspaceFileExplorerRootPath}
            candidateRootPaths={workspaceFileScopeRootPaths}
            openFileRequest={workspaceFileOpenRequest}
            className="h-full"
          />,
          t('workspace.files.loading', { defaultValue: '正在加载文件树...' }),
        ) : null}
        />
      </div>
      {isMobile ? null : <PersistentWorkspaceTerminalDock />}
      {workspaceSettingsOpen ? (
        <Suspense fallback={null}>
          <WorkspaceSettingsDialog
            open={workspaceSettingsOpen}
            workspace={currentWorkspace}
            workspaceSessionId={workspaceSession?.id}
            project={project}
            nameDraft={titleDraft}
            renameBusy={renameBusy}
            autoCommitEnabled={workspaceSettingsAutoCommitEnabled}
            saving={autoCommitBusy}
            onOpenChange={setWorkspaceSettingsOpen}
            onNameDraftChange={setTitleDraft}
            onRename={() => void handleRenameWorkspace()}
            onAutoCommitEnabledChange={setWorkspaceSettingsAutoCommitEnabled}
            onEnvironmentTemplateChange={(template) => {
              setWorkspaceEnvironmentTemplate(template)
            }}
            onSave={() => void handleUpdateWorkspaceAutoCommit(workspaceSettingsAutoCommitEnabled).then((saved) => {
              if (saved) {
                setWorkspaceSettingsOpen(false)
              }
            })}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
