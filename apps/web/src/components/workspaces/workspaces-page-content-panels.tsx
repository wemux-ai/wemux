import type {
  AppState,
  ExecutorAgentSessionDetail,
  ExecutorAgentSessionSummary,
  ExecutorRecord,
  PreviewSessionDto,
  PreviewViewerAccess,
  Project,
  Task,
  WorkspacePreviewSourceOption,
  WorkspaceSession,
} from '@shared/types'
import type { WorkspaceOpenTarget } from '@shared/workspace-open-command'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import type { ConversationMessageRecord } from '../../lib/api'
import type { WorkspaceTerminalCommandRequest } from './workspace-terminal-panel'
import type { WorkspaceSessionChatHandle, WorkspaceSessionChatRevisionAction } from './workspace-session-chat'
import { WorkspaceSessionChat } from './workspace-session-chat'
import { WorkspaceGitPanel } from './workspace-git-panel'
import { WorkspaceFilesPanel } from './workspace-files-panel'
import { WorkspacePreviewPanel } from './workspace-preview-panel'
import { WorkspaceTerminalPanel } from './workspace-terminal-panel'
import { WorkspaceTestRecordPanel } from './workspace-test-record-panel'
import { WorkspaceLocalSessionPreview } from './workspace-local-session-preview'
import type { WorkspaceListItem } from './workspaces-page-utils'
import type { WorkspacePanelView } from '../../routes/-workspace-route-shared'

type WorkspaceEnvironmentPreview = NonNullable<ReturnType<typeof import('@shared/project-environment-template').resolveProjectEnvironmentPreview>>
type WorkspaceRuntimeResolution = ReturnType<typeof import('../../lib/workspace-session-runtime').resolveWorkspaceSessionRuntime>

type WorkspacesPageContentPanelsProps = {
  activeWorkspaceOpenTarget: WorkspaceOpenTarget
  busy: boolean
  clearPendingWorkspaceSessionSelection: () => void
  clearWorkspaceEnvironmentRunningForWorkspace: (workspaceId: string) => void
  currentWorkspaceTerminalCollapsed: boolean
  displayTask: Task | null
  environmentPreview: WorkspaceEnvironmentPreview | null
  environmentPreviewSources: WorkspacePreviewSourceOption[]
  executorOptions: ExecutorRecord[]
  forkingMessageId: string | null
  handleChatRef: (instance: WorkspaceSessionChatHandle | null) => void
  handleCreateRepairSession: (observation: TaskSubagentObservation) => void | Promise<void>
  handleForkWorkspaceSessionFromMessage: (messageId: string, mode: 'local' | 'worktree') => Promise<void>
  handleImportLocalSession: () => Promise<void>
  handleOpenWorkspaceFileLink: (href: string) => boolean
  handleReviseWorkspaceSessionTurn: (payload: WorkspaceSessionChatRevisionAction) => Promise<void>
  handleWorkspaceSessionChange: (payload: { workspaceSessionId: string; state: AppState }) => void
  handleWorkspaceTaskUpdate: (task: Task) => void
  installWorkspaceCommand: string
  isMobile: boolean
  launchPrefill: string
  loadTestRecordMessages: (options?: { refreshing?: boolean }) => void | Promise<void>
  localSessionDetailLoading: boolean
  localSessionImporting: boolean
  markEnvironmentTerminalClosed: () => void
  mcpServers: AppState['config']['mcpServers']
  openCurrentWorkspaceInTarget: (target: WorkspaceOpenTarget) => Promise<void>
  previewBusyAction: null | 'open' | 'refresh' | 'stop' | 'share' | 'revoke'
  previewSession: PreviewSessionDto | null
  previewShareUrl?: string
  previewViewer: PreviewViewerAccess | null
  revisingTurnId: string | null
  selectedItem: WorkspaceListItem | null
  selectedLocalSessionDetail: ExecutorAgentSessionDetail | null
  selectedLocalSessionKey: string
  selectedLocalSessionSummary: ExecutorAgentSessionSummary | null
  selectedWorkspaceCwd?: string
  selectedWorkspaceExecutor?: ExecutorRecord | null
  selectedWorkspaceExecutorId: string
  selectedWorkspaceExecutorName: string
  selectedWorkspaceFileExplorerRootPath?: string
  selectedWorkspaceFileScopeRootPaths: string[]
  selectedWorkspaceRuntime: WorkspaceRuntimeResolution | null
  selectedWorkspaceSession: WorkspaceSession | null
  selectedWorkspaceSessions: WorkspaceSession[]
  setSelectedWorkspaceSessionId: (workspaceSessionId: string) => void
  setTerminalCollapsed: (collapsed: boolean) => void
  setTerminalMaximized: (maximized: boolean) => void
  setWorkspacePrimaryViewState: (workspaceId: string | undefined, view: 'chat' | 'git' | 'records' | 'files' | 'preview') => void
  setWorkspaceTerminalOpenUi: (workspaceId: string, open: boolean) => void
  shouldRenderSelectedWorkspaceTerminal: boolean
  state: AppState
  terminalCommandRequest: WorkspaceTerminalCommandRequest | null
  terminalMaximized: boolean
  testRecordLiveStatus: 'connecting' | 'open' | 'closed' | 'error'
  testRecordLoading: boolean
  testRecordMessages: ConversationMessageRecord[]
  testRecordRefreshing: boolean
  repairingObservationId?: string | null
  updateWorkspaceSearch: (patch: { workspaceSessionId?: string; panel?: WorkspacePanelView }) => void
  workspaceFileOpenRequest: { filePath: string; requestId: number } | null
  onAssignExecutor: (
    taskId: string,
    executorNodeId: string,
    targetWorkspaceId?: string,
    targetWorkspaceSessionId?: string,
  ) => Promise<string | undefined>
  onOpenWorkspacePreview: () => void | Promise<void>
  onOpenWorkspacePreviewInBrowser: (targetUrl?: string) => void
  onRefreshWorkspacePreview: () => void | Promise<void>
  onRevokeWorkspacePreviewShare: () => void | Promise<void>
  onShareWorkspacePreview: () => void | Promise<void>
  onStopWorkspacePreview: () => void | Promise<void>
}

export function buildWorkspacesPageContentPanels({
  activeWorkspaceOpenTarget,
  busy,
  clearPendingWorkspaceSessionSelection,
  clearWorkspaceEnvironmentRunningForWorkspace,
  currentWorkspaceTerminalCollapsed,
  displayTask,
  environmentPreview,
  environmentPreviewSources,
  executorOptions,
  forkingMessageId,
  handleChatRef,
  handleCreateRepairSession,
  handleForkWorkspaceSessionFromMessage,
  handleImportLocalSession,
  handleOpenWorkspaceFileLink,
  handleReviseWorkspaceSessionTurn,
  handleWorkspaceSessionChange,
  handleWorkspaceTaskUpdate,
  installWorkspaceCommand,
  isMobile,
  launchPrefill,
  loadTestRecordMessages,
  localSessionDetailLoading,
  localSessionImporting,
  markEnvironmentTerminalClosed,
  mcpServers,
  openCurrentWorkspaceInTarget,
  previewBusyAction,
  previewSession,
  previewShareUrl,
  previewViewer,
  revisingTurnId,
  selectedItem,
  selectedLocalSessionDetail,
  selectedLocalSessionKey,
  selectedLocalSessionSummary,
  selectedWorkspaceCwd,
  selectedWorkspaceExecutor,
  selectedWorkspaceExecutorId,
  selectedWorkspaceExecutorName,
  selectedWorkspaceFileExplorerRootPath,
  selectedWorkspaceFileScopeRootPaths,
  selectedWorkspaceRuntime,
  selectedWorkspaceSession,
  selectedWorkspaceSessions,
  setSelectedWorkspaceSessionId,
  setTerminalCollapsed,
  setTerminalMaximized,
  setWorkspacePrimaryViewState,
  setWorkspaceTerminalOpenUi,
  shouldRenderSelectedWorkspaceTerminal,
  state,
  terminalCommandRequest,
  terminalMaximized,
  testRecordLiveStatus,
  testRecordLoading,
  testRecordMessages,
  testRecordRefreshing,
  repairingObservationId,
  updateWorkspaceSearch,
  workspaceFileOpenRequest,
  onAssignExecutor,
  onOpenWorkspacePreview,
  onOpenWorkspacePreviewInBrowser,
  onRefreshWorkspacePreview,
  onRevokeWorkspacePreviewShare,
  onShareWorkspacePreview,
  onStopWorkspacePreview,
}: WorkspacesPageContentPanelsProps) {
  const chatContent = selectedLocalSessionKey || selectedLocalSessionDetail || localSessionDetailLoading ? (
    <WorkspaceLocalSessionPreview
      sessionSummary={selectedLocalSessionSummary}
      sessionDetail={selectedLocalSessionDetail}
      loading={localSessionDetailLoading}
      importing={localSessionImporting}
      executorName={selectedWorkspaceExecutorName}
      onImport={handleImportLocalSession}
    />
  ) : displayTask && selectedItem ? (
    <WorkspaceSessionChat
      ref={handleChatRef}
      key={`${displayTask.id}:${selectedItem.workspace.id}:${selectedWorkspaceSession?.id || 'latest'}`}
      task={displayTask}
      allTasks={state.tasks}
      executors={executorOptions}
      agentSettings={state.config.agentSettings}
      mcpServers={mcpServers}
      project={selectedItem.project as Project}
      mentionProjects={state.projects}
      chrome="flush"
      hideHeader
      initialInput={launchPrefill}
      open
      workspaceId={selectedItem.workspace.id}
      workspaceSessionId={selectedWorkspaceSession?.id}
      workspaceSession={selectedWorkspaceSession}
      workspaceSessions={selectedWorkspaceSessions}
      workspaceWorkingDirectoryMode={selectedWorkspaceSession?.workingDirectoryMode ?? selectedItem.workspace.workingDirectoryMode}
      workspaceBranchName={selectedItem.workspace.codeBranchName || selectedWorkspaceSession?.branchName}
      workspaceBaseBranch={selectedItem.workspace.codeBaseBranch || selectedWorkspaceSession?.baseBranch || displayTask.baseBranch}
      workspaceCreatedBy={selectedItem.workspace.createdBy}
      workspaceOwnerUserId={selectedItem.workspace.ownerUserId}
      workspaceRoot={selectedWorkspaceExecutor?.workspaceRoot || state.config.workspaceRoot}
      workspaceRepoPath={selectedWorkspaceRuntime?.repoPath}
      activeExecutorId={selectedWorkspaceExecutorId}
      activeExecutorName={selectedWorkspaceExecutorName}
      onOpenWorkspaceFileLink={handleOpenWorkspaceFileLink}
      onTaskUpdate={handleWorkspaceTaskUpdate}
      onWorkspaceSessionChange={handleWorkspaceSessionChange}
      onForkFromMessage={handleForkWorkspaceSessionFromMessage}
      forkingMessageId={forkingMessageId}
      onReviseTurn={handleReviseWorkspaceSessionTurn}
      revisingTurnId={revisingTurnId}
      onAssignExecutor={onAssignExecutor}
      busy={busy}
    />
  ) : null

  const gitContent = displayTask && selectedItem ? (
    <WorkspaceGitPanel
      task={displayTask}
      workspace={selectedItem.workspace}
      workspaceSession={selectedWorkspaceSession}
      projectDefaultBranch={selectedItem.project.defaultBranch}
      versionControl={selectedItem.project.versionControl}
      className="flex h-full min-h-0 flex-col"
    />
  ) : null

  const recordsContent = displayTask && selectedWorkspaceSession && selectedItem ? (
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
    />
  ) : null

  const filesContent = selectedItem ? (
    <WorkspaceFilesPanel
      executorId={selectedWorkspaceExecutorId}
      initialDirectoryPath={selectedWorkspaceFileExplorerRootPath}
      candidateRootPaths={selectedWorkspaceFileScopeRootPaths}
      cacheScopeKey={[
        selectedItem.project.id,
        selectedItem.workspace.id,
        selectedWorkspaceSession?.id || 'workspace',
        selectedWorkspaceSession?.branchName || '',
        selectedWorkspaceSession?.baseBranch || '',
        selectedWorkspaceSession?.worktreeStatus || '',
        selectedWorkspaceRuntime?.repoPath || selectedWorkspaceFileExplorerRootPath || '',
      ].join(':')}
      openFileRequest={workspaceFileOpenRequest}
      className="h-full"
    />
  ) : null

  const previewContent = selectedItem ? (
    <WorkspacePreviewPanel
      busyAction={previewBusyAction}
      executorId={selectedWorkspaceExecutorId}
      executor={selectedWorkspaceExecutor}
      iframeUrl={previewViewer?.iframeUrl}
      preview={previewSession}
      shareUrl={previewShareUrl}
      sourceAppUrl={environmentPreview?.appUrl}
      previewSources={environmentPreviewSources}
      onOpen={() => void onOpenWorkspacePreview()}
      onOpenExternal={(targetUrl) => onOpenWorkspacePreviewInBrowser(targetUrl)}
      onRefresh={() => void onRefreshWorkspacePreview()}
      onRevokeShare={() => void onRevokeWorkspacePreviewShare()}
      onShare={() => void onShareWorkspacePreview()}
      onStop={() => void onStopWorkspacePreview()}
    />
  ) : null

  const terminalSection = isMobile && selectedItem && shouldRenderSelectedWorkspaceTerminal ? (
    <div className="h-full w-full">
      <WorkspaceTerminalPanel
        collapsed={currentWorkspaceTerminalCollapsed}
        cwd={selectedWorkspaceCwd}
        executorId={selectedWorkspaceExecutorId}
        executorName={selectedWorkspaceExecutorName}
        executorRealtimeBaseUrl={selectedWorkspaceExecutor?.realtimeBaseUrl}
        projectId={selectedItem.project.id}
        workspaceId={selectedItem.workspace.id}
        workspaceName={selectedItem.workspace.name}
        installCommand={installWorkspaceCommand}
        startCommand={environmentPreview?.startCommand}
        logsCommand={environmentPreview?.logsCommand}
        maximized={terminalMaximized}
        isMobile
        panelKey={selectedItem.workspace.id}
        commandRequest={terminalCommandRequest}
        onCollapsedChange={setTerminalCollapsed}
        onMaximizedChange={setTerminalMaximized}
        onOpenStateChange={(open) => {
          setWorkspaceTerminalOpenUi(selectedItem.workspace.id, open)
          if (!open) {
            markEnvironmentTerminalClosed()
            clearWorkspaceEnvironmentRunningForWorkspace(selectedItem.workspace.id)
          }
        }}
        onOpenWorkspaceTarget={async () => {
          await openCurrentWorkspaceInTarget(activeWorkspaceOpenTarget)
        }}
      />
    </div>
  ) : undefined

  return {
    chatContent,
    filesContent,
    gitContent,
    previewContent,
    recordsContent,
    terminalSection,
  }
}
