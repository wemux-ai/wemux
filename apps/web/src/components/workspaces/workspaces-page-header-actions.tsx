import type { ReactNode } from 'react'
import type { WorkspaceOpenTarget } from '@shared/workspace-open-command'
import type { WorkspaceSession } from '@shared/types'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import {
  ArrowLeftRight,
  Bot,
  CircleDot,
  FolderTree,
  GitBranch,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Rocket,
  SlidersHorizontal,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { cn } from '../../lib/utils'
import type { WorkspacePrimaryView } from '../../routes/-workspace-route-shared'
import { WorkspaceOpenAction } from './workspace-open-action'
import type { WorkspaceListItem } from './workspaces-page-utils'

type WorkspacesPageHeaderToolbarProps = {
  activePrimaryView: WorkspacePrimaryView
  activeWorkspaceOpenTarget: WorkspaceOpenTarget
  canOpenEnvironmentPreview: boolean
  canShowEnvironmentStop: boolean
  canStartEnvironment: boolean
  canStopEnvironment: boolean
  environmentBusyAction?: string | null
  environmentPreviewAppUrl?: string
  environmentStartInTerminal: boolean
  gitPanelEnabled: boolean
  openingWorkspaceTarget: WorkspaceOpenTarget | null
  previewBusyAction?: string | null
  selectedWorkspaceCandidateCwdsLength: number
  selectedWorkspaceTerminalActive: boolean
  selectedWorkspaceTerminalKeptAlive: boolean
  selectedWorkspaceTerminalOpen: boolean
  terminalCollapsed: boolean
  visibleGitWorkingTreeSummary: { additions: number; deletions: number } | null
  onOpenWorkspaceTarget: (target: WorkspaceOpenTarget) => void
  onStartEnvironment: () => void
  onStopEnvironment: () => void
  onTogglePanel: (panel: Exclude<WorkspacePrimaryView, 'chat'>) => void
  onToggleTerminal: () => void
}

type WorkspacesPageActionsMenuProps = {
  busy: boolean
  canMarkSelectedWorkspaceSessionUnread: boolean
  canOpenEnvironmentPreview: boolean
  deletingWorkspaceSessionId: string
  parentWorkspaceSession: WorkspaceSession | null
  previewBusyAction?: string | null
  selectedItem: WorkspaceListItem
  selectedWorkspaceSession: WorkspaceSession | null
  selectedWorkspaceSessionsLength: number
  selectedWorkspaceTaskExists: boolean
  t: (key: string, options?: Record<string, unknown>) => string
  onBackToParentSession: () => void
  onDeleteWorkspace: () => void
  onDeleteWorkspaceSession: (workspaceSessionId: string) => void
  onMarkSelectedWorkspaceSessionUnread: () => void
  onOpenBindDialogForSelectedTask: () => void
  onOpenPreviewPanel: () => void
  onOpenSettings: () => void
  onOpenSessionRenameDialog: () => void
}

const toolButtonClass = (active = false) => active
  ? 'h-7 w-7 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100'
  : 'h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950/90 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 disabled:opacity-40'

const toolbarDivider = <div aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-800" />

export function WorkspacesPageHeaderToolbar({
  activePrimaryView,
  activeWorkspaceOpenTarget,
  canOpenEnvironmentPreview,
  canShowEnvironmentStop,
  canStartEnvironment,
  canStopEnvironment,
  environmentBusyAction,
  environmentPreviewAppUrl,
  environmentStartInTerminal,
  gitPanelEnabled,
  openingWorkspaceTarget,
  previewBusyAction,
  selectedWorkspaceCandidateCwdsLength,
  selectedWorkspaceTerminalActive,
  selectedWorkspaceTerminalKeptAlive,
  selectedWorkspaceTerminalOpen,
  terminalCollapsed,
  visibleGitWorkingTreeSummary,
  onOpenWorkspaceTarget,
  onStartEnvironment,
  onStopEnvironment,
  onTogglePanel,
  onToggleTerminal,
}: WorkspacesPageHeaderToolbarProps) {
  const gitToolbarTitle = visibleGitWorkingTreeSummary
    ? `Git（未提交改动：+${visibleGitWorkingTreeSummary.additions.toLocaleString()} / -${visibleGitWorkingTreeSummary.deletions.toLocaleString()}）`
    : 'Git'
  const gitToolbarAriaLabel = visibleGitWorkingTreeSummary
    ? `Git，未提交改动新增 ${visibleGitWorkingTreeSummary.additions.toLocaleString()}，删除 ${visibleGitWorkingTreeSummary.deletions.toLocaleString()}`
    : 'Git'

  return (
    <div className="flex items-center gap-1 pr-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onTogglePanel('files')}
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
          onClick={() => onTogglePanel('git')}
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
        onClick={onStartEnvironment}
        disabled={Boolean(environmentBusyAction) || !canStartEnvironment}
        className={toolButtonClass()}
        aria-label={environmentStartInTerminal ? '在终端启动环境' : '启动环境'}
        title={environmentStartInTerminal ? '在终端启动环境' : '启动环境'}
      >
        {environmentBusyAction === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      {canShowEnvironmentStop ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onStopEnvironment}
          disabled={Boolean(environmentBusyAction) || !canStopEnvironment}
          className={toolButtonClass()}
          aria-label={environmentStartInTerminal ? '停止终端环境' : '停止环境'}
          title={environmentStartInTerminal ? '停止终端环境' : '停止环境'}
        >
          {environmentBusyAction === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
      {environmentPreviewAppUrl ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onTogglePanel('preview')}
          disabled={!canOpenEnvironmentPreview || previewBusyAction === 'open'}
          className={toolButtonClass(activePrimaryView === 'preview')}
          aria-label="开发预览"
          title="开发预览"
        >
          {previewBusyAction === 'open' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onToggleTerminal}
        className={cn(
          selectedWorkspaceTerminalActive
            ? toolButtonClass(true)
            : toolButtonClass(!terminalCollapsed),
          'relative',
        )}
        aria-label={selectedWorkspaceTerminalKeptAlive ? '展开后台终端' : terminalCollapsed ? '展开终端' : '折叠终端'}
        title={selectedWorkspaceTerminalKeptAlive ? '终端正在后台保持连接，点击展开' : terminalCollapsed ? '展开终端' : '折叠终端'}
      >
        <TerminalSquare className="h-3.5 w-3.5" />
        {selectedWorkspaceTerminalOpen ? (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
        ) : null}
      </Button>
      {toolbarDivider}
      <WorkspaceOpenAction
        busy={Boolean(openingWorkspaceTarget)}
        disabled={selectedWorkspaceCandidateCwdsLength === 0}
        activeTarget={activeWorkspaceOpenTarget}
        onOpen={onOpenWorkspaceTarget}
        buttonClassName="gap-0"
        menuClassName={toolButtonClass()}
      />
    </div>
  )
}

export function WorkspacesPageActionsMenu({
  busy,
  canMarkSelectedWorkspaceSessionUnread,
  canOpenEnvironmentPreview,
  deletingWorkspaceSessionId,
  parentWorkspaceSession,
  previewBusyAction,
  selectedItem,
  selectedWorkspaceSession,
  selectedWorkspaceSessionsLength,
  selectedWorkspaceTaskExists,
  t,
  onBackToParentSession,
  onDeleteWorkspace,
  onDeleteWorkspaceSession,
  onMarkSelectedWorkspaceSessionUnread,
  onOpenBindDialogForSelectedTask,
  onOpenPreviewPanel,
  onOpenSettings,
  onOpenSessionRenameDialog,
}: WorkspacesPageActionsMenuProps) {
  return (
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
        {selectedWorkspaceTaskExists ? (
          <DropdownMenuItem onSelect={onOpenBindDialogForSelectedTask}>
            <Link2 className="h-4 w-4" />
            绑定任务
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onOpenSettings}>
          <SlidersHorizontal className="h-4 w-4" />
          工作区设置
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenPreviewPanel} disabled={!canOpenEnvironmentPreview || previewBusyAction === 'open'}>
          {previewBusyAction === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          开发预览
        </DropdownMenuItem>
        {parentWorkspaceSession ? (
          <DropdownMenuItem onSelect={() => onBackToParentSession()}>
            <ArrowLeftRight className="h-4 w-4" />
            {parentWorkspaceSession.sessionRole === 'tester' ? '返回测试会话' : '返回父会话'}
          </DropdownMenuItem>
        ) : null}
        {selectedWorkspaceSession ? (
          <>
            <DropdownMenuSeparator />
            {canMarkSelectedWorkspaceSessionUnread ? (
              <DropdownMenuItem onSelect={onMarkSelectedWorkspaceSessionUnread}>
                <CircleDot className="h-4 w-4" />
                {t('workspace.pageView.actions.markCurrentSessionUnread', { defaultValue: '设为未读' })}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onOpenSessionRenameDialog}>
              <Pencil className="h-4 w-4" />
              {t('workspace.pageView.actions.renameCurrentSession')}
            </DropdownMenuItem>
            {selectedWorkspaceSessionsLength > 1 ? (
              <DropdownMenuItem
                onSelect={() => onDeleteWorkspaceSession(selectedWorkspaceSession.id)}
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
            <DropdownMenuItem
              onSelect={onDeleteWorkspace}
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
  )
}

export const wrapHeaderActions = (toolbar: ReactNode, actionsMenu: ReactNode) => (
  <div className="flex items-center gap-1">
    {toolbar}
    {actionsMenu}
  </div>
)
