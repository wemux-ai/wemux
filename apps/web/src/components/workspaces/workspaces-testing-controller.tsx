import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type {
  AppState,
  Project,
  Task,
  WorkspaceSession,
  Workspace,
} from '@shared/types'
import type { Language } from '../../lib/i18n'
import type { WorkspacePrimaryView, WorkspaceRouteSearch } from '../../routes/-workspace-route-shared'
import { useWorkspaceTesting } from '../../routes/-use-workspace-testing'

type UseWorkspaceTestingResult = ReturnType<typeof useWorkspaceTesting>

export type WorkspacesTestingState = Pick<
  UseWorkspaceTestingResult,
  | 'environmentBusyAction'
  | 'environmentStatus'
  | 'handleOpenWorkspacePreview'
  | 'handleOpenWorkspacePreviewInBrowser'
  | 'handleBackToParentSession'
  | 'handleCreateRepairSession'
  | 'handleOpenEnvironmentApp'
  | 'handleRefreshWorkspacePreview'
  | 'handleRevokeWorkspacePreviewShare'
  | 'handleRunEnvironmentAction'
  | 'handleShareWorkspacePreview'
  | 'handleStopWorkspacePreview'
  | 'loadTestRecordMessages'
  | 'markEnvironmentTerminalClosed'
  | 'markEnvironmentTerminalStart'
  | 'markEnvironmentTerminalStop'
  | 'previewBusyAction'
  | 'previewSession'
  | 'previewShareUrl'
  | 'previewViewer'
  | 'repairingObservationId'
  | 'testRecordLiveStatus'
  | 'testRecordLoading'
  | 'testRecordMessages'
  | 'testRecordRefreshing'
>

type WorkspacesTestingControllerProps = {
  activePrimaryView: WorkspacePrimaryView
  currentWorkspace: Workspace | null
  displayTask: Task | null
  environmentPreview: {
    installCommand?: string
    appUrl?: string
    healthUrl?: string
    logsCommand?: string
    startCommand?: string
    stopCommand?: string
  } | null
  language: Language
  navigate: (options: { to: '/workspace' | '/workspaces'; search: WorkspaceRouteSearch; replace?: boolean }) => Promise<void> | void
  onEnvironmentStatusChange: (payload: {
    workspaceId: string
    workspaceSessionId: string
    status: NonNullable<WorkspacesTestingState['environmentStatus']>
  }) => void
  onStateChange: (state: WorkspacesTestingState | null) => void
  parentWorkspaceSession: WorkspaceSession | null
  project: Project | null
  search: WorkspaceRouteSearch
  setActivePrimaryView: Dispatch<SetStateAction<WorkspacePrimaryView>>
  setState: Dispatch<SetStateAction<AppState>>
  t: (key: string, options?: Record<string, unknown>) => string
  terminalCwd?: string
  testerWorkspaceSession: WorkspaceSession | null
  workspaceExecutorId?: string
  workspaceSession: WorkspaceSession | null
}

export function WorkspacesTestingController({
  activePrimaryView,
  currentWorkspace,
  displayTask,
  environmentPreview,
  language,
  navigate,
  onEnvironmentStatusChange,
  onStateChange,
  parentWorkspaceSession,
  project,
  search,
  setActivePrimaryView,
  setState,
  t,
  terminalCwd,
  testerWorkspaceSession,
  workspaceExecutorId,
  workspaceSession,
}: WorkspacesTestingControllerProps) {
  const testingState = useWorkspaceTesting({
    activePrimaryView,
    currentWorkspace,
    displayTask,
    environmentPreview,
    language,
    navigate,
    onEnvironmentStatusChange,
    parentWorkspaceSession,
    project,
    route: '/workspaces',
    search,
    setActivePrimaryView,
    setState,
    t,
    terminalCwd,
    testerWorkspaceSession,
    workspaceExecutorId,
    workspaceSession,
  })
  const testingStateRef = useRef(testingState)
  testingStateRef.current = testingState
  // The parent stores this object in state. Stable proxies prevent useWorkspaceTesting
  // handler identity churn from causing an onStateChange -> setState render loop.
  const handleOpenWorkspacePreview = useCallback<WorkspacesTestingState['handleOpenWorkspacePreview']>((options) => (
    testingStateRef.current.handleOpenWorkspacePreview(options)
  ), [])
  const handleOpenWorkspacePreviewInBrowser = useCallback<WorkspacesTestingState['handleOpenWorkspacePreviewInBrowser']>((targetPreviewUrl, options) => (
    testingStateRef.current.handleOpenWorkspacePreviewInBrowser(targetPreviewUrl, options)
  ), [])
  const handleBackToParentSession = useCallback<WorkspacesTestingState['handleBackToParentSession']>(() => (
    testingStateRef.current.handleBackToParentSession()
  ), [])
  const handleCreateRepairSession = useCallback<WorkspacesTestingState['handleCreateRepairSession']>((observation) => (
    testingStateRef.current.handleCreateRepairSession(observation)
  ), [])
  const handleOpenEnvironmentApp = useCallback<WorkspacesTestingState['handleOpenEnvironmentApp']>(() => (
    testingStateRef.current.handleOpenEnvironmentApp()
  ), [])
  const handleRefreshWorkspacePreview = useCallback<WorkspacesTestingState['handleRefreshWorkspacePreview']>(() => (
    testingStateRef.current.handleRefreshWorkspacePreview()
  ), [])
  const handleRevokeWorkspacePreviewShare = useCallback<WorkspacesTestingState['handleRevokeWorkspacePreviewShare']>(() => (
    testingStateRef.current.handleRevokeWorkspacePreviewShare()
  ), [])
  const handleRunEnvironmentAction = useCallback<WorkspacesTestingState['handleRunEnvironmentAction']>((action) => (
    testingStateRef.current.handleRunEnvironmentAction(action)
  ), [])
  const handleShareWorkspacePreview = useCallback<WorkspacesTestingState['handleShareWorkspacePreview']>(() => (
    testingStateRef.current.handleShareWorkspacePreview()
  ), [])
  const handleStopWorkspacePreview = useCallback<WorkspacesTestingState['handleStopWorkspacePreview']>(() => (
    testingStateRef.current.handleStopWorkspacePreview()
  ), [])
  const loadTestRecordMessages = useCallback<WorkspacesTestingState['loadTestRecordMessages']>((options) => (
    testingStateRef.current.loadTestRecordMessages(options)
  ), [])
  const markEnvironmentTerminalClosed = useCallback<WorkspacesTestingState['markEnvironmentTerminalClosed']>(() => {
    testingStateRef.current.markEnvironmentTerminalClosed()
  }, [])
  const markEnvironmentTerminalStart = useCallback<WorkspacesTestingState['markEnvironmentTerminalStart']>(() => {
    testingStateRef.current.markEnvironmentTerminalStart()
  }, [])
  const markEnvironmentTerminalStop = useCallback<WorkspacesTestingState['markEnvironmentTerminalStop']>(() => {
    testingStateRef.current.markEnvironmentTerminalStop()
  }, [])
  const stableTestingState = useMemo<WorkspacesTestingState>(() => ({
    environmentBusyAction: testingState.environmentBusyAction,
    environmentStatus: testingState.environmentStatus,
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
    previewBusyAction: testingState.previewBusyAction,
    previewSession: testingState.previewSession,
    previewShareUrl: testingState.previewShareUrl,
    previewViewer: testingState.previewViewer,
    repairingObservationId: testingState.repairingObservationId,
    testRecordLiveStatus: testingState.testRecordLiveStatus,
    testRecordLoading: testingState.testRecordLoading,
    testRecordMessages: testingState.testRecordMessages,
    testRecordRefreshing: testingState.testRecordRefreshing,
  }), [
    testingState.environmentBusyAction,
    testingState.environmentStatus,
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
    testingState.previewBusyAction,
    testingState.previewSession,
    testingState.previewShareUrl,
    testingState.previewViewer,
    testingState.repairingObservationId,
    testingState.testRecordLiveStatus,
    testingState.testRecordLoading,
    testingState.testRecordMessages,
    testingState.testRecordRefreshing,
  ])

  useEffect(() => {
    onStateChange(stableTestingState)
  }, [onStateChange, stableTestingState])

  useEffect(() => {
    return () => {
      onStateChange(null)
    }
  }, [onStateChange])

  return null
}
