import { lazy, Suspense, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import type { ExecutorAgentSessionSummary, ExecutorRecord, GitHubResourceBinding, Project, ProjectPullRequestReviewSummary, RailwayDeploymentSummary, RailwayResourceBinding, Task, WorkspaceSession } from '@shared/types'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { ArrowLeft, ChevronLeft, ChevronRight, LayoutGrid, Link2, Loader2, MoreHorizontal, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '../ui/drawer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { NativeSelect } from '../ui/native-select'
import { useTranslation } from '../../lib/i18n/react'
import type { AgentRecord } from '../../lib/api/types'
import { cn } from '../../lib/utils'
import { WorkspacesListPanel } from './workspaces-list-panel'
import { SharedWithMePanel } from './shared-with-me-panel'
import { WorkspacesTablePanel } from './workspaces-table-panel'
import { WorkspaceShell } from './workspace-shell'
import { PersistentWorkspaceTerminalDock } from './persistent-workspace-terminal'
import type { WorkspacePrimaryView } from '../../routes/-workspace-route-shared'
import type { WorkspaceListItem } from './workspaces-page-utils'
import type { WorkspaceSessionUnreadStoreState } from '../../lib/workspace-session-attention'
import type { WorkspaceSessionListPlacement } from './workspaces-page-ui-store'
import { WorkbenchResourceVisibilityProvider } from './workbench-resource-registry'

const WORKSPACE_PAGE_COLUMNS_LAYOUT = {
  workspaceListPanel: 23,
  workspaceDetailPanel: 77,
} satisfies Layout

const MAX_CACHED_WORKSPACE_DETAIL_PANES = 8

const WorkspaceSettingsDialog = lazy(() => import('./workspace-settings-dialog').then((module) => ({ default: module.WorkspaceSettingsDialog })))

type CachedWorkspaceDetailPane = {
  node: ReactNode
  lastActiveAt: number
}

function WorkspaceDetailPaneCache({
  active,
  activeKey,
  children,
}: {
  active: boolean
  activeKey: string
  children: ReactNode
}) {
  const cachedPaneByKeyRef = useRef(new Map<string, CachedWorkspaceDetailPane>())

  if (activeKey && children) {
    cachedPaneByKeyRef.current.set(activeKey, {
      node: children,
      lastActiveAt: Date.now(),
    })
  }

  if (cachedPaneByKeyRef.current.size > MAX_CACHED_WORKSPACE_DETAIL_PANES) {
    const staleKeys = [...cachedPaneByKeyRef.current.entries()]
      .filter(([key]) => key !== activeKey)
      .sort(([, left], [, right]) => left.lastActiveAt - right.lastActiveAt)
      .slice(0, cachedPaneByKeyRef.current.size - MAX_CACHED_WORKSPACE_DETAIL_PANES)

    for (const [key] of staleKeys) {
      cachedPaneByKeyRef.current.delete(key)
    }
  }

  return (
    <>
      {[...cachedPaneByKeyRef.current.entries()].map(([key, cachedPane]) => {
        const selected = active && key === activeKey
        return (
          <div
            key={key}
            data-workspace-detail-cache-pane={key}
            className={selected ? 'h-full min-h-0' : 'hidden'}
            aria-hidden={selected ? undefined : true}
            hidden={!selected}
          >
            <WorkbenchResourceVisibilityProvider active={selected}>
              {cachedPane.node}
            </WorkbenchResourceVisibilityProvider>
          </div>
        )
      })}
    </>
  )
}

type WorkspacesPageViewProps = {
  isMobile: boolean
  mobileView: 'list' | 'detail' | 'create'
  panelMode: 'detail' | 'create'
  activeFilteredItems: WorkspaceListItem[]
  archivedFilteredItems: WorkspaceListItem[]
  archivedWorkspaceCount: number
  executors?: ExecutorRecord[]
  onTableStartEnvironment?: (workspaceId: string) => void
  onTableStopEnvironment?: (workspaceId: string) => void
  terminalOpenWorkspaceIds?: Record<string, boolean>
  environmentStartCommandRunningWorkspaceIds?: Record<string, boolean>
  workspaceEnvironmentStatusesByWorkspaceId?: Record<string, WorkspaceEnvironmentStatusSnapshot>
  projectPullRequests?: ProjectPullRequestReviewSummary[]
  githubResourceBindings?: GitHubResourceBinding[]
  railwayDeployments?: RailwayDeploymentSummary[]
  railwayResourceBindings?: RailwayResourceBinding[]
  projects: Project[]
  visibleProjectIds: string[] | null
  searchQuery: string
  selectedWorkspaceId: string
  selectedItem: WorkspaceListItem | null
  detailLoading?: boolean
  selectedWorkspaceTask: Task | null
  displayTask: Task | null
  selectedWorkspaceSessions: WorkspaceSession[]
  selectedWorkspaceSession: WorkspaceSession | null
  workspaceSessionUnreadState: WorkspaceSessionUnreadStoreState
  workspaceSessionTokenSummaryById?: Record<string, string>
  availableAgents?: AgentRecord[]
  localSessions?: ExecutorAgentSessionSummary[]
  localSessionsOpen?: boolean
  localSessionsLoading?: boolean
  localSessionsRefreshing?: boolean
  localSessionExecutorName?: string
  selectedLocalSessionKey?: string
  workspaceSessionListPlacement: WorkspaceSessionListPlacement
  activePrimaryView: WorkspacePrimaryView
  retainedPrimaryViews: WorkspacePrimaryView[]
  busy: boolean
  creatingWorkspaceSession: boolean
  reorderingWorkspaceSessions: boolean
  shellTitleDraft: string
  renameBusy: boolean
  isEditingShellTitle: boolean
  gitPanelEnabled: boolean
  bindDialogOpen: boolean
  bindTaskId: string
  bindableTasks: Task[]
  bindBusy: boolean
  workspaceSettingsOpen: boolean
  workspaceNameDraft: string
  workspaceRenameBusy: boolean
  workspaceSettingsAutoCommitEnabled: boolean
  workspaceSettingsSaving: boolean
  statusBanner?: ReactNode
  headerLeading?: ReactNode
  headerActions?: ReactNode
  mobileHeaderToolbar?: ReactNode
  createPanelContent?: ReactNode
  emptyActions?: ReactNode
  chatContent?: ReactNode
  gitContent?: ReactNode
  recordsContent?: ReactNode
  filesContent?: ReactNode
  previewContent?: ReactNode
  desktopContent?: ReactNode
  browserContent?: ReactNode
  terminalSection?: ReactNode
  terminalCollapsed?: boolean
  terminalMaximized?: boolean
  onTerminalCollapsedChange?: (collapsed: boolean) => void
  onTerminalMaximizedChange?: (maximized: boolean) => void
  bodyStyle?: CSSProperties
  onSetMobileView: (view: 'list' | 'detail' | 'create') => void
  onOpenCreatePanel: () => void
  onCreateForProject: (projectId: string) => void
  onEditProject: (projectId: string) => void
  onLoadProject?: (projectId: string) => void
  onVisibleProjectIdsChange: (value: string[] | null) => void
  onSearchChange: (value: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onArchivedSectionExpandedChange?: (expanded: boolean) => void
  onReorderProjects?: (orderedProjectIds: string[]) => void | Promise<void>
  onReorderWorkspaces?: (projectId: string, orderedWorkspaceIds: string[]) => void | Promise<void>
  onSelectWorkspaceSessionTarget: (target: {
    workspaceId: string
    workspaceSessionId: string
    taskId?: string
  }) => void
  onOpenBindDialog: () => void
  onOpenWorkspaceSettings: () => void
  onOpenProjectSettingsFromWorkspaceSettings?: (projectId: string) => void
  onDeleteSelectedWorkspace: () => void
  onTitleDraftChange: (value: string) => void
  onStartEditTitle: () => void
  onCancelEditTitle: () => void
  onRenameWorkspace: () => void
  onRenameWorkspaceSession: (
    workspaceSessionId: string,
    title: string,
    target?: { workspaceId: string; taskId?: string },
  ) => Promise<void>
  onDeleteWorkspaceSession: (workspaceSessionId: string) => void
  onPinWorkspaceSession: (workspaceSessionId: string, pinned: boolean) => void
  deletingWorkspaceSessionId: string
  onSelectWorkspaceSession: (sessionId: string) => void
  onCreateWorkspaceSession: () => void | Promise<void>
  onToggleLocalSessions: () => void
  onRefreshLocalSessions: () => void
  onSelectLocalSession: (session: ExecutorAgentSessionSummary) => void
  onReorderWorkspaceSessions: (orderedWorkspaceSessionIds: string[]) => void | Promise<void>
  onWorkspaceSessionListPlacementChange: (placement: WorkspaceSessionListPlacement) => void
  onPrimaryViewChange: (view: WorkspacePrimaryView) => void
  onBindDialogOpenChange: (open: boolean) => void
  onBindTaskIdChange: (taskId: string) => void
  onBindWorkspaceTask: () => void
  onWorkspaceSettingsOpenChange: (open: boolean) => void
  onWorkspaceNameDraftChange: (value: string) => void
  onRenameWorkspaceFromSettings: () => void
  onWorkspaceSettingsAutoCommitEnabledChange: (enabled: boolean) => void
  onWorkspaceEnvironmentTemplateChange?: (
    template: Project['environmentTemplate'] | null,
    effectiveTemplate: Project['environmentTemplate'] | null,
  ) => void
  onSaveWorkspaceAutoCommit: () => void
}

export function WorkspacesPageView({
  isMobile,
  mobileView,
  panelMode,
  activeFilteredItems,
  archivedFilteredItems,
  archivedWorkspaceCount,
  executors = [],
  onTableStartEnvironment,
  onTableStopEnvironment,
  terminalOpenWorkspaceIds = {},
  environmentStartCommandRunningWorkspaceIds = {},
  workspaceEnvironmentStatusesByWorkspaceId = {},
  projectPullRequests = [],
  githubResourceBindings = [],
  railwayDeployments = [],
  railwayResourceBindings = [],
  projects,
  visibleProjectIds,
  searchQuery,
  selectedWorkspaceId,
  selectedItem,
  detailLoading = false,
  selectedWorkspaceTask,
  displayTask,
  selectedWorkspaceSessions,
  selectedWorkspaceSession,
  workspaceSessionUnreadState,
  workspaceSessionTokenSummaryById = {},
  availableAgents = [],
  localSessions = [],
  localSessionsOpen = false,
  localSessionsLoading = false,
  localSessionsRefreshing = false,
  localSessionExecutorName,
  selectedLocalSessionKey = '',
  workspaceSessionListPlacement,
  activePrimaryView,
  retainedPrimaryViews,
  busy,
  creatingWorkspaceSession,
  reorderingWorkspaceSessions,
  shellTitleDraft,
  renameBusy,
  isEditingShellTitle,
  gitPanelEnabled,
  bindDialogOpen,
  bindTaskId,
  bindableTasks,
  bindBusy,
  workspaceSettingsOpen,
  workspaceNameDraft,
  workspaceRenameBusy,
  workspaceSettingsAutoCommitEnabled,
  workspaceSettingsSaving,
  statusBanner,
  headerLeading,
  headerActions,
  mobileHeaderToolbar,
  createPanelContent,
  emptyActions,
  chatContent,
  gitContent,
  recordsContent,
  filesContent,
  previewContent,
  desktopContent,
  browserContent,
  terminalSection,
  terminalCollapsed,
  terminalMaximized,
  onTerminalCollapsedChange,
  onTerminalMaximizedChange,
  bodyStyle,
  onSetMobileView,
  onOpenCreatePanel,
  onCreateForProject,
  onEditProject,
  onLoadProject,
  onVisibleProjectIdsChange,
  onSearchChange,
  onSelectWorkspace,
  onArchivedSectionExpandedChange,
  onReorderProjects,
  onReorderWorkspaces,
  onSelectWorkspaceSessionTarget,
  onOpenBindDialog,
  onOpenWorkspaceSettings,
  onOpenProjectSettingsFromWorkspaceSettings,
  onDeleteSelectedWorkspace,
  onTitleDraftChange,
  onStartEditTitle,
  onCancelEditTitle,
  onRenameWorkspace,
  onRenameWorkspaceSession,
  onDeleteWorkspaceSession,
  onPinWorkspaceSession,
  deletingWorkspaceSessionId,
  onSelectWorkspaceSession,
  onCreateWorkspaceSession,
  onToggleLocalSessions,
  onRefreshLocalSessions,
  onSelectLocalSession,
  onReorderWorkspaceSessions,
  onWorkspaceSessionListPlacementChange,
  onPrimaryViewChange,
  onBindDialogOpenChange,
  onBindTaskIdChange,
  onBindWorkspaceTask,
  onWorkspaceSettingsOpenChange,
  onWorkspaceNameDraftChange,
  onRenameWorkspaceFromSettings,
  onWorkspaceSettingsAutoCommitEnabledChange,
  onWorkspaceEnvironmentTemplateChange,
  onSaveWorkspaceAutoCommit,
}: WorkspacesPageViewProps) {
  const { t } = useTranslation()
  const [workspaceListCollapsed, setWorkspaceListCollapsed] = useState(false)
  const [showTableOverview, setShowTableOverview] = useState(false)
  const [tableDrawerOpen, setTableDrawerOpen] = useState(false)
  const listPanel = (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <SharedWithMePanel />
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspacesListPanel
        isMobile={isMobile}
        activeFilteredItems={activeFilteredItems}
        archivedFilteredItems={archivedFilteredItems}
        archivedWorkspaceCount={archivedWorkspaceCount}
        terminalOpenWorkspaceIds={terminalOpenWorkspaceIds}
        environmentStartCommandRunningWorkspaceIds={environmentStartCommandRunningWorkspaceIds}
        workspaceEnvironmentStatusesByWorkspaceId={workspaceEnvironmentStatusesByWorkspaceId}
        projectPullRequests={projectPullRequests}
        githubResourceBindings={githubResourceBindings}
        railwayDeployments={railwayDeployments}
        railwayResourceBindings={railwayResourceBindings}
        projects={projects}
        visibleProjectIds={visibleProjectIds}
        searchQuery={searchQuery}
        selectedWorkspaceId={selectedWorkspaceId}
        embedded
        connectedRight={!isMobile}
        headerActions={null}
        onCreate={onOpenCreatePanel}
        onCreateForProject={onCreateForProject}
        onEditProject={onEditProject}
        onLoadProject={onLoadProject}
        onVisibleProjectIdsChange={onVisibleProjectIdsChange}
        onSearchChange={onSearchChange}
        onSelectWorkspace={onSelectWorkspace}
        onArchivedSectionExpandedChange={onArchivedSectionExpandedChange}
        onReorderProjects={onReorderProjects}
        onReorderWorkspaces={onReorderWorkspaces}
        onSelectWorkspaceSessionTarget={onSelectWorkspaceSessionTarget}
        onRenameWorkspaceSession={onRenameWorkspaceSession}
        showTableOverview={showTableOverview}
        onToggleTableOverview={() => setShowTableOverview((v) => !v)}
      />
      </div>
    </div>
  )

  const collapsedListRail = !isMobile ? (
    <div className="flex h-full w-10 shrink-0 flex-col items-center gap-2 border-r border-zinc-900/80 bg-[#060607] px-1.5 py-2.5 shadow-[inset_-1px_0_0_rgba(24,24,27,0.45)]">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setWorkspaceListCollapsed(false)}
        className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        aria-label="展开工作区列表"
        title="展开工作区列表"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onOpenCreatePanel}
        className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        aria-label={t('workspace.page.actions.new')}
        title={t('workspace.page.actions.new')}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  ) : null

  const detailPanel = (
    <div
      className={cn(
        'min-w-0',
        isMobile
          ? mobileView === 'detail'
            ? 'fixed inset-0 z-40 block min-h-0 bg-[#050505]'
            : mobileView === 'create'
              ? 'block min-h-0 flex-1'
              : 'hidden'
          : 'h-full flex-1',
      )}
    >
      {panelMode === 'create' ? createPanelContent : null}
      {selectedItem ? (
        <WorkspaceDetailPaneCache active={panelMode !== 'create'} activeKey={selectedWorkspaceId}>
          <WorkspaceShell
          project={selectedItem.project}
          workspace={selectedItem.workspace}
          displayTask={displayTask}
          workspaceSessions={selectedWorkspaceSessions}
          selectedWorkspaceSessionId={selectedWorkspaceSession?.id || ''}
          workspaceSessionUnreadState={workspaceSessionUnreadState}
          workspaceSessionTokenSummaryById={workspaceSessionTokenSummaryById}
          availableAgents={availableAgents}
          localSessions={localSessions}
          localSessionsOpen={localSessionsOpen}
          localSessionsLoading={localSessionsLoading}
          localSessionsRefreshing={localSessionsRefreshing}
          localSessionExecutorName={localSessionExecutorName}
          selectedLocalSessionKey={selectedLocalSessionKey}
          workspaceSessionListPlacement={workspaceSessionListPlacement}
          activePrimaryView={activePrimaryView}
          retainedPrimaryViews={retainedPrimaryViews}
          isMobile={isMobile}
          connectedToLeadingPanel={!isMobile}
          statusBanner={statusBanner}
          headerLeading={headerLeading ?? (isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onSetMobileView('list')}
              className="-ml-2 h-7 w-7 text-zinc-400 hover:bg-transparent hover:text-zinc-100"
              aria-label={t('workspace.pageView.actions.backToList')}
              title={t('workspace.pageView.actions.backToList')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : null)}
          headerActions={headerActions ?? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label={t('workspace.pageView.actions.workspaceActions')}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={onOpenBindDialog}>
                  <Link2 className="h-4 w-4" />
                  {t('workspace.pageView.actions.bindTask')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenWorkspaceSettings}>
                  <SlidersHorizontal className="h-4 w-4" />
                  {t('workspace.pageView.actions.workspaceSettings')}
                </DropdownMenuItem>
                {canDeleteWorkspaceRecord(selectedItem.workspace) ? (
                  <DropdownMenuItem
                    onSelect={onDeleteSelectedWorkspace}
                    disabled={busy}
                    className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('workspace.pageView.actions.deleteWorkspace')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          mobileHeaderToolbar={mobileHeaderToolbar}
          emptyActions={emptyActions ?? null}
          titleDraft={shellTitleDraft}
          renameBusy={renameBusy}
          isEditingTitle={isEditingShellTitle}
          canEditTitle={false}
          canCreateWorkspaceSession
          creatingWorkspaceSession={creatingWorkspaceSession}
          reorderingWorkspaceSessions={reorderingWorkspaceSessions}
          gitPanelEnabled={gitPanelEnabled}
          onTitleDraftChange={onTitleDraftChange}
          onStartEditTitle={onStartEditTitle}
          onCancelEditTitle={onCancelEditTitle}
          onRenameWorkspace={onRenameWorkspace}
          onRenameWorkspaceSession={onRenameWorkspaceSession}
          onDeleteWorkspaceSession={onDeleteWorkspaceSession}
          onPinWorkspaceSession={onPinWorkspaceSession}
          deletingWorkspaceSessionId={deletingWorkspaceSessionId}
          onReorderWorkspaceSessions={onReorderWorkspaceSessions}
          onSelectWorkspaceSession={onSelectWorkspaceSession}
          onCreateWorkspaceSession={onCreateWorkspaceSession}
          onToggleLocalSessions={onToggleLocalSessions}
          onRefreshLocalSessions={onRefreshLocalSessions}
          onSelectLocalSession={onSelectLocalSession}
          onWorkspaceSessionListPlacementChange={onWorkspaceSessionListPlacementChange}
          onPrimaryViewChange={onPrimaryViewChange}
          chatContent={chatContent}
          gitContent={gitContent}
          recordsContent={recordsContent}
          filesContent={filesContent}
          previewContent={previewContent}
          desktopContent={desktopContent}
          browserContent={browserContent}
          terminalSection={terminalSection}
          terminalCollapsed={terminalCollapsed}
          terminalMaximized={terminalMaximized}
          onTerminalCollapsedChange={onTerminalCollapsedChange}
          onTerminalMaximizedChange={onTerminalMaximizedChange}
          bodyStyle={bodyStyle}
          />
        </WorkspaceDetailPaneCache>
      ) : detailLoading ? (
        <div className="flex h-full min-h-[24rem] items-center justify-center bg-[#09090b] px-6 text-center text-xs text-zinc-500">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          {t('workspace.pageView.loading')}
        </div>
      ) : panelMode === 'create' ? null : (
        <div className="wemux-page-outer-frame flex h-full min-h-[24rem] items-center justify-center border border-dashed border-zinc-800 bg-[#050505] px-6 text-center text-zinc-500">
          {t('workspace.pageView.empty')}
        </div>
      )}
    </div>
  )

  const desktopDetailPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">{detailPanel}</div>
      <PersistentWorkspaceTerminalDock />
    </div>
  )

  return (
    <div
      className={cn(
        'flex gap-0 bg-[#050505]',
        isMobile ? 'h-full min-h-0 flex-1 flex-col' : 'h-full min-h-0',
      )}
    >
      {showTableOverview ? (
        /* Table mode — full-width table, detail in right drawer */
        <>
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900/80 px-3 py-2">
              <Button
                type="button"
                onClick={() => setShowTableOverview(false)}
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md border border-sky-800/60 bg-sky-950/30 text-sky-400 hover:bg-sky-950/50"
                aria-label={t('workspace.page.view.list', { defaultValue: '返回列表' })}
                title={t('workspace.page.view.list', { defaultValue: '返回列表' })}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[12px] font-medium text-zinc-300">
                {t('workspace.page.title')} — {t('workspace.page.view.table', { defaultValue: '总览' })}
              </span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                Alpha
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <WorkspacesTablePanel
                items={activeFilteredItems}
                executors={executors}
                projectPullRequests={projectPullRequests}
                githubResourceBindings={githubResourceBindings}
                railwayDeployments={railwayDeployments}
                railwayResourceBindings={railwayResourceBindings}
                selectedWorkspaceId={selectedWorkspaceId}
                onSelectWorkspace={(workspaceId) => {
                  onSelectWorkspace(workspaceId)
                  setTableDrawerOpen(true)
                }}
                onStartEnvironment={onTableStartEnvironment}
                onStopEnvironment={onTableStopEnvironment}
                onOpenLogs={(workspaceId) => {
                  onSelectWorkspace(workspaceId)
                  onPrimaryViewChange('chat')
                  onTerminalCollapsedChange?.(false)
                }}
                onOpenPreview={(workspaceId) => {
                  onSelectWorkspace(workspaceId)
                  onPrimaryViewChange('preview')
                }}
              />
            </div>
          </div>
          <Drawer open={tableDrawerOpen && !!selectedItem} onOpenChange={setTableDrawerOpen} direction="right">
            <DrawerContent className="w-full max-w-[720px] border-zinc-800 bg-[#050505]">
              <DrawerHeader className="sr-only">
                <DrawerTitle>{selectedItem?.workspace.name ?? ''}</DrawerTitle>
              </DrawerHeader>
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                {desktopDetailPanel}
              </div>
            </DrawerContent>
          </Drawer>
        </>
      ) : isMobile ? (
        <>
          <div className={mobileView === 'list' ? 'flex min-h-0 flex-1' : 'hidden'}>
            <div className="h-full min-h-0 flex-1 overflow-hidden">
              {listPanel}
            </div>
          </div>
          {detailPanel}
        </>
      ) : (
        workspaceListCollapsed ? (
          <>
            {collapsedListRail}
            <div className="flex h-full min-w-0 flex-1 flex-col">
              {desktopDetailPanel}
            </div>
          </>
        ) : (
          <Group
            id="workspace-page-columns"
            orientation="horizontal"
            defaultLayout={WORKSPACE_PAGE_COLUMNS_LAYOUT}
          >
            <Panel id="workspaceListPanel" defaultSize="23%" minSize="260px" maxSize="340px">
              {listPanel}
            </Panel>
            <Separator className="group relative flex w-1 items-center justify-center px-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
              <div className="h-full w-px bg-zinc-900/70 transition-colors group-hover:bg-zinc-700 group-focus:bg-zinc-700 group-focus-visible:bg-zinc-700" />
            </Separator>
            <Panel id="workspaceDetailPanel" defaultSize="81%" minSize="560px">
              {desktopDetailPanel}
            </Panel>
          </Group>
        )
      )}

      <Dialog open={bindDialogOpen} onOpenChange={onBindDialogOpenChange}>
        <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('workspace.pageView.bindDialog.title')}</DialogTitle>
            <DialogDescription className="text-zinc-500">
              {t('workspace.pageView.bindDialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{t('workspace.pageView.bindDialog.selectTask')}</p>
              <NativeSelect
                value={bindTaskId}
                onChange={(event) => onBindTaskIdChange(event.target.value)}
                placeholder={t('workspace.pageView.bindDialog.selectTask')}
              >
                {bindableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {bindableTasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-6 text-sm text-zinc-500">
                {t('workspace.pageView.bindDialog.empty')}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onBindDialogOpenChange(false)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={onBindWorkspaceTask}
              disabled={bindBusy || bindableTasks.length === 0 || !bindTaskId}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {bindBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('workspace.pageView.bindDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {workspaceSettingsOpen ? (
        <Suspense fallback={null}>
          <WorkspaceSettingsDialog
            open={workspaceSettingsOpen}
            workspace={selectedItem?.workspace ?? null}
            workspaceSessionId={selectedWorkspaceSession?.id}
            project={selectedItem?.project ?? null}
            nameDraft={workspaceNameDraft}
            renameBusy={workspaceRenameBusy}
            autoCommitEnabled={workspaceSettingsAutoCommitEnabled}
            saving={workspaceSettingsSaving}
            onOpenProjectSettings={onOpenProjectSettingsFromWorkspaceSettings}
            onOpenChange={onWorkspaceSettingsOpenChange}
            onNameDraftChange={onWorkspaceNameDraftChange}
            onRename={onRenameWorkspaceFromSettings}
            onAutoCommitEnabledChange={onWorkspaceSettingsAutoCommitEnabledChange}
            onEnvironmentTemplateChange={onWorkspaceEnvironmentTemplateChange}
            onSave={onSaveWorkspaceAutoCommit}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
