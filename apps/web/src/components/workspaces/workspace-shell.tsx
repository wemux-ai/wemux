/**
 * [INPUT]: Current workspace metadata, workspace-scoped panel content, and session navigation callbacks.
 * [OUTPUT]: The workspace shell with retained chat and tool-panel instances across workspace switches.
 * [POS]: Shared layout boundary for `/workspace` and `/workspaces` detail experiences.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ExecutorAgentSessionSummary, Project, Task, WorkspaceSession, Workspace } from '@shared/types'
import {
  Bot,
  Check,
  Columns3,
  Loader2,
  Maximize2,
  Minimize2,
  PanelTop,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { ProjectIdentity } from '../project-identity'
import type { AgentRecord } from '../../lib/api/types'
import { useTranslation } from '../../lib/i18n/react'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { cn } from '../../lib/utils'
import type { WorkspacePrimaryView } from '../../routes/-workspace-route-shared'
import { RetainedWorkspacePanel } from './retained-workspace-panel'
import { WorkspaceSidePanelHeaderActionsProvider } from './workspace-side-panel-header-actions'
import {
  getWorkspaceSessionUnreadTone,
  type WorkspaceSessionUnreadStoreState,
} from '../../lib/workspace-session-attention'
import { getWorkspaceSessionDisplayStatus } from './workspace-session-status'
import type { WorkspaceSessionListPlacement } from './workspaces-page-ui-store'

const DEFAULT_TERMINAL_ROW_HEIGHT = 'minmax(220px, 36%)'
const MIN_TERMINAL_HEIGHT = 220
const MIN_MAIN_PANEL_HEIGHT = 240
const DEFAULT_SIDE_PANEL_WIDTH_PERCENT = 38
const MIN_SIDE_PANEL_WIDTH_PERCENT = 24
const MAX_SIDE_PANEL_WIDTH_PERCENT = 100
const SIDE_PANEL_RESIZE_HANDLE_WIDTH_PX = 4
const SIDE_PANEL_RESIZE_HIT_AREA_WIDTH_PX = 12

const LOCAL_SESSION_RUNTIME_BY_SOURCE = {
  claude: 'ClaudeCode',
  opencode: 'OpenCode',
  codex: 'Codex',
  pi: 'Pi',
} as const

const buildLocalSessionKey = (session: Pick<ExecutorAgentSessionSummary, 'source' | 'id'>) => `${session.source}:${session.id}`

interface WorkspaceShellProps {
  project: Project
  workspace: Workspace
  displayTask: Task | null
  workspaceSessions: WorkspaceSession[]
  selectedWorkspaceSessionId: string
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
  retainedPrimaryViews?: WorkspacePrimaryView[]
  isMobile?: boolean
  statusBanner?: ReactNode
  headerLeading?: ReactNode
  headerActions?: ReactNode
  mobileHeaderToolbar?: ReactNode
  emptyActions?: ReactNode
  terminalSection?: ReactNode
  terminalCollapsed?: boolean
  terminalMaximized?: boolean
  onTerminalCollapsedChange?: (collapsed: boolean) => void
  onTerminalMaximizedChange?: (maximized: boolean) => void
  bodyStyle?: CSSProperties
  titleDraft: string
  renameBusy: boolean
  isEditingTitle: boolean
  connectedToLeadingPanel?: boolean
  canCreateWorkspaceSession?: boolean
  creatingWorkspaceSession?: boolean
  reorderingWorkspaceSessions?: boolean
  canEditTitle?: boolean
  gitPanelEnabled?: boolean
  testRecordsEnabled?: boolean
  onTitleDraftChange: (value: string) => void
  onStartEditTitle: () => void
  onCancelEditTitle: () => void
  onRenameWorkspace: () => void
  onSelectWorkspaceSession: (workspaceSessionId: string) => void
  onCreateWorkspaceSession?: () => void | Promise<void>
  onToggleLocalSessions?: () => void
  onRefreshLocalSessions?: () => void
  onSelectLocalSession?: (session: ExecutorAgentSessionSummary) => void
  onDeleteWorkspaceSession?: (workspaceSessionId: string) => void
  onPinWorkspaceSession?: (workspaceSessionId: string, pinned: boolean) => void
  deletingWorkspaceSessionId?: string
  onRenameWorkspaceSession?: (workspaceSessionId: string, title: string) => Promise<void>
  onReorderWorkspaceSessions?: (orderedWorkspaceSessionIds: string[]) => void | Promise<void>
  onWorkspaceSessionListPlacementChange?: (placement: WorkspaceSessionListPlacement) => void
  onPrimaryViewChange: (view: WorkspacePrimaryView) => void
  chatContent: ReactNode
  gitContent?: ReactNode
  recordsContent?: ReactNode
  filesContent?: ReactNode
  previewContent?: ReactNode
  desktopContent?: ReactNode
  browserContent?: ReactNode
}

export function WorkspaceShell({
  project,
  workspace,
  displayTask,
  workspaceSessions,
  selectedWorkspaceSessionId,
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
  retainedPrimaryViews = [],
  isMobile = false,
  statusBanner,
  headerLeading,
  headerActions,
  mobileHeaderToolbar,
  emptyActions,
  terminalSection,
  terminalCollapsed = false,
  terminalMaximized = false,
  onTerminalCollapsedChange,
  onTerminalMaximizedChange,
  bodyStyle,
  titleDraft,
  renameBusy,
  isEditingTitle,
  connectedToLeadingPanel = false,
  canCreateWorkspaceSession = false,
  creatingWorkspaceSession = false,
  reorderingWorkspaceSessions = false,
  canEditTitle = true,
  gitPanelEnabled = false,
  testRecordsEnabled = false,
  onTitleDraftChange,
  onStartEditTitle,
  onCancelEditTitle,
  onRenameWorkspace,
  onSelectWorkspaceSession,
  onCreateWorkspaceSession,
  onToggleLocalSessions,
  onRefreshLocalSessions,
  onSelectLocalSession,
  onDeleteWorkspaceSession,
  onPinWorkspaceSession,
  deletingWorkspaceSessionId,
  onRenameWorkspaceSession,
  onReorderWorkspaceSessions,
  onWorkspaceSessionListPlacementChange,
  onPrimaryViewChange,
  chatContent,
  gitContent,
  recordsContent,
  filesContent,
  previewContent,
  desktopContent,
  browserContent,
}: WorkspaceShellProps) {
  const { t } = useTranslation()
  void project
  const hasTerminal = Boolean(terminalSection)
  const [sessionRenameOpen, setSessionRenameOpen] = useState(false)

  const [sessionRenameTarget, setSessionRenameTarget] = useState<WorkspaceSession | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false)
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null)
  const sidePanelLayoutRef = useRef<HTMLDivElement | null>(null)
  const [terminalHeightPx, setTerminalHeightPx] = useState<number | null>(null)
  const [sidePanelResizing, setSidePanelResizing] = useState(false)
  const selectedWorkspaceSession = selectedWorkspaceSessionId
    ? workspaceSessions.find((session) => session.id === selectedWorkspaceSessionId) ?? null
    : null
  const selectedWorkspaceSessionTitle = selectedWorkspaceSession?.title?.trim()
  const selectedLocalSession = selectedLocalSessionKey
    ? localSessions.find((session) => buildLocalSessionKey(session) === selectedLocalSessionKey) ?? null
    : null
  const workspaceChatPanelKey = selectedLocalSessionKey
    ? `chat:${workspace.id}:local:${selectedLocalSessionKey}`
    : `chat:${workspace.id}:session:${selectedWorkspaceSessionId || 'latest'}`

  const showWorkspaceLabel = !isMobile
  const headerTitle = isMobile
    ? selectedWorkspaceSessionTitle || workspace.name
    : workspace.name
  void gitPanelEnabled
  void testRecordsEnabled
  const sidePanelContents: Array<{ view: Exclude<WorkspacePrimaryView, 'chat'>; content: ReactNode }> = [
    { view: 'git', content: gitContent },
    { view: 'records', content: recordsContent },
    { view: 'preview', content: previewContent },
    { view: 'desktop', content: desktopContent },
    { view: 'browser', content: browserContent },
    { view: 'files', content: filesContent },
  ]
  void retainedPrimaryViews
  const activeSidePanelContent = sidePanelContents.find(({ view }) => view === activePrimaryView)?.content ?? null
  const sidePanelOpen = activePrimaryView !== 'chat' && Boolean(activeSidePanelContent)
  const persistentSidePanelContents = sidePanelContents.map(({ view, content }) => ({
    view,
    content: (
      <RetainedWorkspacePanel
        active={sidePanelOpen && view === activePrimaryView}
        panelKey={`${view}:${workspace.id}`}
      >
        {content}
      </RetainedWorkspacePanel>
    ),
  }))
  const [sidePanelModeByWorkspaceId, setSidePanelModeByWorkspaceId] = useState<Record<string, 'split' | 'overlay'>>({})
  const [sidePanelWidthByWorkspaceId, setSidePanelWidthByWorkspaceId] = useState<Record<string, number>>({})
  const sidePanelMode = sidePanelModeByWorkspaceId[workspace.id] ?? 'split'
  const sidePanelWidthPercent = sidePanelWidthByWorkspaceId[workspace.id] ?? DEFAULT_SIDE_PANEL_WIDTH_PERCENT
  const openSessionRenameDialog = (session: WorkspaceSession) => {
    setSessionRenameTarget(session)
    setSessionRenameDraft(session.title)
    setSessionRenameOpen(true)
  }

  const effectiveWorkspaceSessionListPlacement = workspaceSessionListPlacement
  const canShowWorkspaceSessionNav = Boolean(displayTask)
  const switchWorkspaceSessionListPlacement = () => {
    onWorkspaceSessionListPlacementChange?.(effectiveWorkspaceSessionListPlacement === 'side' ? 'top' : 'side')
  }
  const workspaceSessionPlacementLabel = effectiveWorkspaceSessionListPlacement === 'side'
    ? t('workspace.shell.sessionPlacement.top', { defaultValue: '切到顶部' })
    : t('workspace.shell.sessionPlacement.side', { defaultValue: '切到侧边' })
  const renderWorkspaceSessionPlacementIcon = () => (
    effectiveWorkspaceSessionListPlacement === 'side'
      ? <PanelTop className="h-3.5 w-3.5" />
      : <Columns3 className="h-3.5 w-3.5" />
  )
  const renderSessionStatusDot = (
    displayStatus: ReturnType<typeof getWorkspaceSessionDisplayStatus>,
    unreadTone: ReturnType<typeof getWorkspaceSessionUnreadTone> | undefined,
    selected: boolean,
  ) => (
    <span className={cn(
      'shrink-0 rounded-full',
      effectiveWorkspaceSessionListPlacement === 'side' ? 'h-2 w-2' : 'h-1.5 w-1.5',
      displayStatus === 'running'
        ? 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.65)]'
        : displayStatus === 'queued'
          ? 'bg-amber-400'
          : unreadTone === 'error'
            ? 'bg-orange-400'
            : unreadTone
              ? 'bg-cyan-400'
              : selected ? 'bg-zinc-100' : 'bg-zinc-600',
    )} />
  )
  const renderWorkspaceSessionNavItem = (session: WorkspaceSession) => {
    const selected = session.id === selectedWorkspaceSessionId && !selectedLocalSession
    const displayStatus = getWorkspaceSessionDisplayStatus(session)
    const unreadTone = getWorkspaceSessionUnreadTone(session, {
      sessionAttentionById: workspaceSessionUnreadState.sessionAttentionById,
      acknowledgedSessionAttentionById: workspaceSessionUnreadState.acknowledgedSessionAttentionById,
      manuallyUnreadSessionAttentionById: workspaceSessionUnreadState.manuallyUnreadSessionAttentionById,
    }) ?? undefined
    const tokenSummary = workspaceSessionTokenSummaryById[session.id]

    if (effectiveWorkspaceSessionListPlacement === 'side') {
      return (
        <button
          key={session.id}
          type="button"
          onClick={() => onSelectWorkspaceSession(session.id)}
          onDoubleClick={() => openSessionRenameDialog(session)}
          className={cn(
            'group relative flex w-full min-w-0 flex-col items-center gap-0.5 rounded border px-1 py-1.5 text-center transition-colors',
            selected
              ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
              : 'border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-950 hover:text-zinc-200',
          )}
          title={session.title}
        >
          {selected ? <span className="absolute left-0 top-1.5 h-6 w-0.5 rounded-r-full bg-sky-400" /> : null}
          <span className="flex h-2.5 items-center justify-center">
            {renderSessionStatusDot(displayStatus, unreadTone, selected)}
          </span>
          <span className="line-clamp-2 min-h-[1.5rem] w-full break-words text-[9px] font-medium leading-3">
            {session.title}
          </span>
          {tokenSummary ? (
            <span className="max-w-full truncate rounded-full border border-cyan-500/20 bg-cyan-500/10 px-0.5 text-[7px] leading-3 text-cyan-100">
              {tokenSummary}
            </span>
          ) : null}
        </button>
      )
    }

    return (
      <button
        key={session.id}
        type="button"
        onClick={() => onSelectWorkspaceSession(session.id)}
        onDoubleClick={() => openSessionRenameDialog(session)}
        className={cn(
          'flex h-9 w-[9rem] shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors sm:w-[10.5rem]',
          selected
            ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
            : 'border-zinc-900 bg-zinc-950/70 text-zinc-400 hover:border-zinc-800 hover:bg-zinc-950 hover:text-zinc-100',
        )}
        title={session.title}
      >
        {renderSessionStatusDot(displayStatus, unreadTone, selected)}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight">{session.title}</span>
        {tokenSummary ? (
          <span className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-1 text-[8px] leading-none text-cyan-100">
            {tokenSummary}
          </span>
        ) : null}
      </button>
    )
  }
  const workspaceSessionNav = canShowWorkspaceSessionNav ? (
    <nav
      className={cn(
        'shrink-0 border-zinc-900 bg-[#070708]',
        effectiveWorkspaceSessionListPlacement === 'side'
          ? 'flex w-[56px] flex-col border-r'
          : 'flex min-w-0 items-center border-b px-1.5 py-1',
      )}
      aria-label={t('workspace.shell.sessionList')}
    >
      <div className={cn(
        'flex shrink-0 items-center gap-1 border-zinc-900',
        effectiveWorkspaceSessionListPlacement === 'side'
          ? 'flex-col border-b px-1 py-1.5'
          : 'border-0 p-0',
      )}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={switchWorkspaceSessionListPlacement}
          className="h-6 w-6 shrink-0 rounded border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          aria-label={workspaceSessionPlacementLabel}
          title={workspaceSessionPlacementLabel}
        >
          {renderWorkspaceSessionPlacementIcon()}
        </Button>
        {canCreateWorkspaceSession && onCreateWorkspaceSession ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void onCreateWorkspaceSession()}
            disabled={creatingWorkspaceSession}
            className="h-6 w-6 shrink-0 rounded border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            aria-label={t('workspace.shell.createSession')}
            title={t('workspace.shell.createSession')}
          >
            {creatingWorkspaceSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
        ) : null}
      </div>
      <div className={cn(
        'scrollbar-subtle min-h-0',
        effectiveWorkspaceSessionListPlacement === 'side'
          ? 'flex flex-1 flex-col gap-0.5 overflow-y-auto p-1'
          : 'ml-2 flex min-w-0 flex-1 gap-1 overflow-x-auto p-0',
      )}>
        {workspaceSessions.length === 0 ? (
          <div className={cn(
            'border border-dashed border-zinc-800 bg-zinc-950/60 text-zinc-500',
            effectiveWorkspaceSessionListPlacement === 'side'
              ? 'rounded px-1 py-2 text-center text-[8px] leading-3'
              : 'rounded-md px-3 py-2 text-xs',
          )}>
            {t('workspace.shell.empty.noTaskDescription')}
          </div>
        ) : (
          workspaceSessions.map(renderWorkspaceSessionNavItem)
        )}
      </div>
    </nav>
  ) : null

  useEffect(() => {
    if (terminalCollapsed && terminalMaximized) {
      onTerminalMaximizedChange?.(false)
    }
  }, [onTerminalMaximizedChange, terminalCollapsed, terminalMaximized])

  const clampTerminalHeight = useCallback((height: number, containerHeight: number) => {
    const maxTerminalHeight = Math.max(
      MIN_TERMINAL_HEIGHT,
      Math.min(Math.floor(containerHeight * 0.82), containerHeight - MIN_MAIN_PANEL_HEIGHT),
    )
    return Math.min(Math.max(height, MIN_TERMINAL_HEIGHT), maxTerminalHeight)
  }, [])

  const clampSidePanelWidthPercent = useCallback((widthPercent: number) => {
    return Math.min(Math.max(widthPercent, MIN_SIDE_PANEL_WIDTH_PERCENT), MAX_SIDE_PANEL_WIDTH_PERCENT)
  }, [])

  const handleTerminalResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isMobile || terminalCollapsed || terminalMaximized) {
      return
    }

    const container = workspaceBodyRef.current
    const terminalRoot = container?.querySelector<HTMLElement>('[data-workspace-terminal-root]')
    if (!container || !terminalRoot) {
      return
    }

    event.preventDefault()
    const containerHeight = container.getBoundingClientRect().height
    const startHeight = terminalRoot.getBoundingClientRect().height
    const startY = event.clientY
    const originalUserSelect = document.body.style.userSelect
    const originalCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight + startY - moveEvent.clientY
      setTerminalHeightPx(clampTerminalHeight(nextHeight, containerHeight))
    }

    const handlePointerUp = () => {
      document.body.style.userSelect = originalUserSelect
      document.body.style.cursor = originalCursor
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [clampTerminalHeight, isMobile, terminalCollapsed, terminalMaximized])

  const handleSidePanelResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (isMobile || !sidePanelOpen || sidePanelMode === 'overlay') {
      return
    }

    const container = sidePanelLayoutRef.current
    if (!container) {
      return
    }

    event.preventDefault()
    const containerWidth = container.getBoundingClientRect().width
    const startWidth = (containerWidth * sidePanelWidthPercent) / 100
    const startX = event.clientX
    const originalUserSelect = document.body.style.userSelect
    const originalCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    setSidePanelResizing(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + startX - moveEvent.clientX
      const nextWidthPercent = clampSidePanelWidthPercent((nextWidth / containerWidth) * 100)
      setSidePanelWidthByWorkspaceId((current) => ({
        ...current,
        [workspace.id]: nextWidthPercent,
      }))
    }

    const handlePointerUp = () => {
      document.body.style.userSelect = originalUserSelect
      document.body.style.cursor = originalCursor
      setSidePanelResizing(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [clampSidePanelWidthPercent, isMobile, sidePanelMode, sidePanelOpen, sidePanelWidthPercent, workspace.id])

  const sidePanelTitle = activePrimaryView === 'git'
    ? 'Git'
    : activePrimaryView === 'records'
      ? '测试记录'
      : activePrimaryView === 'preview'
        ? 'Preview'
        : activePrimaryView === 'desktop'
          ? 'Desktop'
          : activePrimaryView === 'files'
            ? '文件树'
            : ''
  const desktopSidePanelOverlay = sidePanelOpen && !isMobile && sidePanelMode === 'overlay'
  const mobileTerminalOverlay = isMobile && hasTerminal && !terminalCollapsed
  const terminalRowHeight = terminalHeightPx == null
    ? DEFAULT_TERMINAL_ROW_HEIGHT
    : `${terminalHeightPx}px`
  // Mobile terminal uses an absolute overlay; reserving a grid row leaves a
  // visible empty strip after the terminal has been closed.
  const workspaceBodyStyle = hasTerminal && !isMobile
    ? {
        gridTemplateRows: terminalCollapsed
          ? 'minmax(0, 1fr) auto'
          : terminalMaximized
            ? '0 minmax(0, 1fr)'
            : `minmax(0, 1fr) ${terminalRowHeight}`,
      }
    : undefined
  const handleRenameWorkspaceSession = async () => {
    const nextTitle = sessionRenameDraft.trim()
    if (!sessionRenameTarget || !nextTitle || !onRenameWorkspaceSession) {
      return
    }

    setSessionRenameBusy(true)
    try {
      await onRenameWorkspaceSession(sessionRenameTarget.id, nextTitle)
      setSessionRenameOpen(false)
      setSessionRenameTarget(null)
      setSessionRenameDraft('')
    } finally {
      setSessionRenameBusy(false)
    }
  }

  const renderSidePanelHeaderActions = (overlay = false) => {
    if (!sidePanelOpen) {
      return null
    }

    if (isMobile) {
      return (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onPrimaryViewChange('chat')}
            className="h-8 w-8 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            aria-label={`关闭${sidePanelTitle || '面板'}`}
            title={`关闭${sidePanelTitle || '面板'}`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )
    }

    const desktopButtonClassName = cn(
      'h-7 w-7 shrink-0 rounded-md border text-zinc-400 hover:text-zinc-100',
      overlay
        ? 'border-zinc-800/80 bg-[#0f1115]/95 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur hover:bg-[#171a20]'
        : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-900',
    )

    return (
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setSidePanelModeByWorkspaceId((current) => ({
              ...current,
              [workspace.id]: current[workspace.id] === 'overlay' ? 'split' : 'overlay',
            }))
          }}
          className={desktopButtonClassName}
          aria-label={overlay ? '还原侧栏布局' : '覆盖聊天区域'}
          title={overlay ? '还原侧栏布局' : '覆盖聊天区域'}
        >
          {overlay ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onPrimaryViewChange('chat')}
          className={desktopButtonClassName}
          aria-label="关闭侧栏"
          title={`关闭${sidePanelTitle || '侧栏'}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  const renderSidePanelBody = (overlay = false) => (
    <WorkspaceSidePanelHeaderActionsProvider headerActions={renderSidePanelHeaderActions(overlay)}>
      <div
        className={cn(
          'h-full min-h-0 flex-1 overflow-hidden bg-[#09090b]',
          overlay
            ? 'rounded-xl shadow-[0_30px_90px_rgba(0,0,0,0.38)]'
            : '',
        )}
      >
        {persistentSidePanelContents.map(({ view, content }) => {
          const active = sidePanelOpen && view === activePrimaryView
          return (
            <div
              key={view}
              className={active ? 'h-full min-h-0' : 'hidden'}
              aria-hidden={active ? undefined : true}
              hidden={!active}
            >
              {content}
            </div>
          )
        })}
      </div>
    </WorkspaceSidePanelHeaderActionsProvider>
  )

  const workspaceContent = (
    <div className={cn(
      'flex h-full min-h-0 overflow-hidden',
      effectiveWorkspaceSessionListPlacement === 'side' ? 'flex-row' : 'flex-col',
    )}>
      {effectiveWorkspaceSessionListPlacement === 'side' ? workspaceSessionNav : null}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative isolate h-full min-h-0 flex-1 overflow-hidden">
        {!isMobile ? (
          <div
            ref={sidePanelLayoutRef}
            className="grid h-full min-h-0"
            style={{
              gridTemplateColumns: sidePanelOpen
                ? `minmax(0,1fr) ${SIDE_PANEL_RESIZE_HANDLE_WIDTH_PX}px minmax(0,${sidePanelWidthPercent}%)`
                : 'minmax(0,1fr)',
            }}
          >
            <div className="relative z-0 flex min-h-0 flex-col overflow-hidden">
              {effectiveWorkspaceSessionListPlacement === 'top' ? workspaceSessionNav : null}
              <div className="min-h-0 flex-1 overflow-hidden">
                <RetainedWorkspacePanel
                  active
                  panelKey={workspaceChatPanelKey}
                  retainResources={!selectedLocalSessionKey}
                >
                  {chatContent}
                </RetainedWorkspacePanel>
              </div>
            </div>
            {sidePanelOpen ? (
              <>
                <button
                  type="button"
                  aria-label="调整侧栏宽度"
                  title="调整侧栏宽度"
                  onPointerDown={handleSidePanelResizePointerDown}
                  onDoubleClick={() => {
                    setSidePanelWidthByWorkspaceId((current) => ({
                      ...current,
                      [workspace.id]: DEFAULT_SIDE_PANEL_WIDTH_PERCENT,
                    }))
                  }}
                  className={cn(
                    'group relative z-20 flex h-full min-h-0 cursor-col-resize items-center justify-center bg-transparent focus:outline-none',
                    desktopSidePanelOverlay ? 'pointer-events-none opacity-0' : 'opacity-100',
                  )}
                  style={{ width: SIDE_PANEL_RESIZE_HIT_AREA_WIDTH_PX }}
                >
                  <span className="absolute left-0 block h-full w-px bg-zinc-900/70 transition-colors group-hover:bg-zinc-500 group-focus-visible:bg-zinc-400" />
                </button>
                <div
                  className={cn(
                    'min-h-0 overflow-hidden border-l border-zinc-800 transition-[opacity,transform] duration-150',
                    desktopSidePanelOverlay
                      ? 'pointer-events-none opacity-0'
                      : 'opacity-100',
                  )}
                />
              </>
            ) : null}
          </div>
        ) : (
          <div className="relative z-0 flex h-full min-h-0 flex-col overflow-hidden">
            {effectiveWorkspaceSessionListPlacement === 'top' ? workspaceSessionNav : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <RetainedWorkspacePanel
                active
                panelKey={workspaceChatPanelKey}
                retainResources={!selectedLocalSessionKey}
              >
                {chatContent}
              </RetainedWorkspacePanel>
            </div>
          </div>
        )}
        <div
          className={cn(
            'min-h-0 overflow-hidden',
            !sidePanelOpen ? 'hidden' : '',
            sidePanelResizing ? 'pointer-events-none select-none' : '',
            isMobile
              ? 'absolute inset-0 z-20 bg-[#09090b]'
              : desktopSidePanelOverlay
                ? 'absolute inset-0 z-10 bg-[#09090b]/12 p-2 backdrop-blur-[1px]'
                : 'absolute inset-y-0 right-0 border-l border-zinc-800',
          )}
          style={isMobile || desktopSidePanelOverlay ? undefined : { width: `${sidePanelWidthPercent}%` }}
        >
          {renderSidePanelBody(desktopSidePanelOverlay)}
        </div>
        </div>
      </div>
    </div>
  )

  const workspaceMain = (
    <div className={cn('flex h-full min-h-0 flex-col', statusBanner ? 'gap-3' : 'gap-0')}>
      {statusBanner}

      {displayTask ? (
        isMobile ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {workspaceContent}
          </div>
        ) : (
          workspaceContent
        )
      ) : (
        <Card className="flex h-full min-h-0 flex-col overflow-hidden border-zinc-800 bg-zinc-950/70 text-zinc-100 shadow-none">
          <CardHeader className="border-b border-zinc-800 bg-[#09090b] pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Bot className="h-4 w-4" />
              {t('workspace.shell.tabs.chat')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md space-y-4 text-center">
              <p className="text-lg font-medium text-zinc-100">{hasTerminal ? t('workspace.shell.empty.withTerminalTitle') : t('workspace.shell.empty.noTaskTitle')}</p>
              <p className="text-sm leading-6 text-zinc-500">
                {hasTerminal
                  ? t('workspace.shell.empty.withTerminalDescription')
                  : t('workspace.shell.empty.noTaskDescription')}
              </p>
              {emptyActions ? <div className="flex flex-wrap justify-center gap-2">{emptyActions}</div> : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )

  return (
    <>
      <main className={cn(
        'wemux-page-outer-frame flex h-full min-h-0 flex-1 flex-col overflow-hidden border border-zinc-900 bg-[#09090b] text-zinc-100',
        isMobile
          ? 'border-0'
          : connectedToLeadingPanel
            ? 'border-l-0'
            : 'rounded-none',
      )}>
      <div className="border-b border-zinc-900 bg-[linear-gradient(180deg,#070708_0%,#050506_100%)] px-3">
        <div className="flex h-11 items-center gap-2">
          <div className="min-w-0 flex-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                {headerLeading ? (
                  <div className="flex shrink-0 items-center text-zinc-400 [&>button]:h-6 [&>button]:text-[11px] [&_svg]:h-3.5 [&_svg]:w-3.5">
                    {headerLeading}
                  </div>
                ) : null}
                {!isMobile ? (
                  <ProjectIdentity
                    project={project}
                    className="max-w-[10rem] rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300 sm:max-w-[14rem]"
                    dotClassName="h-2 w-2"
                    nameClassName="font-medium text-zinc-300"
                  />
                ) : null}
                {showWorkspaceLabel ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-md border-zinc-800 bg-zinc-950 px-1.5 py-0 text-[10px] font-medium tracking-[0.18em] text-zinc-400"
                  >
                    {t('workspace.shell.header.workspaceLabel', { defaultValue: '工作区' })}
                  </Badge>
                ) : null}
                <Input
                  value={titleDraft}
                  onChange={(event) => onTitleDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (isImeComposingKeyboardEvent(event)) {
                      return
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onRenameWorkspace()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      onCancelEditTitle()
                    }
                  }}
                  maxLength={80}
                  autoFocus
                  className="h-7 rounded-lg border-zinc-800 bg-zinc-950 text-sm text-zinc-100"
                />
                <Button
                  size="icon"
                  onClick={onRenameWorkspace}
                  disabled={renameBusy}
                  className="h-7 w-7 rounded-lg bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                >
                  {renameBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onCancelEditTitle}
                  disabled={renameBusy}
                  className="h-7 w-7 rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  {headerLeading ? (
                    <div className="flex shrink-0 items-center text-zinc-400 [&>button]:h-6 [&>button]:text-[11px] [&_svg]:h-3.5 [&_svg]:w-3.5">
                      {headerLeading}
                    </div>
                  ) : null}
                  {!isMobile ? (
                    <ProjectIdentity
                      project={project}
                      className="max-w-[10rem] rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300 sm:max-w-[14rem]"
                      dotClassName="h-2 w-2"
                      nameClassName="font-medium text-zinc-300"
                    />
                  ) : null}
                  {showWorkspaceLabel ? (
                    <Badge
                      variant="outline"
                      className="shrink-0 rounded-md border-zinc-800 bg-zinc-950 px-1.5 py-0 text-[10px] font-medium tracking-[0.18em] text-zinc-400"
                    >
                      {t('workspace.shell.header.workspaceLabel', { defaultValue: '工作区' })}
                    </Badge>
                  ) : null}
                  <h1 className={cn(
                    'min-w-0 truncate text-[15px] font-semibold tracking-tight text-zinc-50 sm:text-base',
                    isMobile ? 'flex-1' : 'max-w-[18rem] shrink sm:max-w-[24rem]',
                  )}>
                    {headerTitle}
                  </h1>
                  {canEditTitle ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onStartEditTitle}
                      className="h-6 w-6 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  ) : null}
                  {!isMobile ? <div className="min-w-0 flex-1" /> : null}
                </div>
              </>
            )}
          </div>

          {headerActions ? (
            <div className="flex shrink-0 items-center text-zinc-400">
              {headerActions}
            </div>
          ) : null}
        </div>
        {isMobile && mobileHeaderToolbar && !isEditingTitle ? (
          <div className="scrollbar-subtle -mx-3 overflow-x-auto border-t border-zinc-900/80 px-3 pb-2 pt-1.5">
            <div className="flex w-max min-w-full items-center gap-1">
              {mobileHeaderToolbar}
            </div>
          </div>
        ) : null}
      </div>

      <div className="h-full min-h-0 flex-1 overflow-hidden">
        <div className="relative h-full min-h-0 overflow-hidden">
          <div ref={workspaceBodyRef} className="grid h-full min-h-0 gap-0 overflow-hidden p-0" style={workspaceBodyStyle}>
            <div className="h-full min-h-0 overflow-hidden">
              {workspaceMain}
            </div>
            {hasTerminal && !isMobile ? (
              <div className={cn('relative min-h-0 overflow-hidden', terminalCollapsed ? 'h-auto' : 'h-full')}>
                {!terminalCollapsed && !terminalMaximized ? (
                  <button
                    type="button"
                    aria-label={t('workspace.terminal.resizeHeight', { defaultValue: '调整终端高度' })}
                    title={t('workspace.terminal.resizeHeight', { defaultValue: '调整终端高度' })}
                    onPointerDown={handleTerminalResizePointerDown}
                    onDoubleClick={() => setTerminalHeightPx(null)}
                    className="group absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize items-start justify-center bg-transparent focus:outline-none"
                  >
                    <span className="mt-0 block h-px w-full bg-transparent transition-colors group-hover:bg-cyan-400/70 group-focus-visible:bg-cyan-400" />
                  </button>
                ) : null}
                {terminalSection}
              </div>
            ) : null}
          </div>
          {hasTerminal && isMobile && mobileTerminalOverlay && terminalSection ? (
            <div className={cn(
              'absolute inset-0 min-h-0 overflow-hidden bg-[#09090b]',
              'z-20',
            )}>
              <div className="h-full min-h-0 overflow-hidden">
                {terminalSection}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      </main>

      <Dialog
        open={sessionRenameOpen}
        onOpenChange={(open) => {
          setSessionRenameOpen(open)
          if (!open) {
            setSessionRenameTarget(null)
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
                void handleRenameWorkspaceSession()
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
              onClick={() => void handleRenameWorkspaceSession()}
              disabled={!sessionRenameDraft.trim() || sessionRenameBusy || !onRenameWorkspaceSession}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
            >
              {sessionRenameBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
