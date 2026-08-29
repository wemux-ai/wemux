/**
 * [INPUT]: Derived workspace list items, executors, selection, and runtime action callbacks.
 * [OUTPUT]: Filterable workspace overview table using the shared workspace display-status derivation.
 * [POS]: /workspaces overview presentation; list-card and table status semantics stay aligned through workspaces-page-utils.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Check,
  ChevronDown,
  ExternalLink,
  LayoutGrid,
  Play,
  Radio,
  Rocket,
  Search,
  Square,
  TerminalSquare,
  X,
} from 'lucide-react'
import type { ExecutorRecord, GitHubResourceBinding, Project, ProjectPullRequestReviewSummary, RailwayDeploymentSummary, RailwayResourceBinding } from '@shared/types'
import { getProjectColor } from '@shared/project-color'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { api, resolveMediaUrl } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  resolveWorkspaceListItemDisplayStatus,
  type WorkspaceListItem,
} from './workspaces-page-utils'
import { getWorkspaceSessionDisplayStatus, type WorkspaceSessionDisplayStatus } from './workspace-session-status'
import { resolveListPreviewAddress } from './workspace-list-preview-address'
import { resolveWorkspaceIndexedPullRequestDisplay } from '../../lib/task-pull-request'
import { resolveWorkspaceIndexedRailwayDeploymentDisplay, type RailwayDeploymentDisplay } from '../../lib/railway-deployment'
import { RailwayDeploymentBadge } from '../railway-deployment-badge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkspaceOverviewFilter = 'all' | 'running' | 'waiting' | 'done'

type OverviewRow = {
  item: WorkspaceListItem
  displayStatus: WorkspaceSessionDisplayStatus
  prState?: {
    url?: string
    number?: number
    state: 'open' | 'merged' | 'closed' | 'unknown'
    branch?: string
  }
  railwayDisplay?: RailwayDeploymentDisplay | null
}

export type WorkspacesTablePanelProps = {
  items: WorkspaceListItem[]
  executors: ExecutorRecord[]
  projectPullRequests?: ProjectPullRequestReviewSummary[]
  githubResourceBindings?: GitHubResourceBinding[]
  railwayDeployments?: RailwayDeploymentSummary[]
  railwayResourceBindings?: RailwayResourceBinding[]
  selectedWorkspaceId: string
  onSelectWorkspace: (workspaceId: string) => void
  onStartEnvironment?: (workspaceId: string) => void
  onStopEnvironment?: (workspaceId: string) => void
  onOpenLogs?: (workspaceId: string) => void
  onOpenPreview?: (workspaceId: string) => void
  onSwitchNode?: (workspaceId: string, executorNodeId: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_CLASS = 'grid min-w-[1300px] grid-cols-[minmax(260px,1.5fr)_120px_100px_100px_72px_130px_100px_88px_120px_100px_100px] items-center'

const SELECT_CHEVRON_STYLE = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat' as const,
  backgroundPosition: 'right 4px center',
}

const FILTER_TABS: { id: WorkspaceOverviewFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'workspaceOverview.filterAll' },
  { id: 'running', labelKey: 'workspaceOverview.filterRunning' },
  { id: 'waiting', labelKey: 'workspaceOverview.filterWaiting' },
  { id: 'done', labelKey: 'workspaceOverview.filterDone' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatRelativeTime = (date?: string) => {
  if (!date) return ''
  const deltaMs = Date.now() - new Date(date).getTime()
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return ''
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (deltaMs < minute) return '刚刚'
  if (deltaMs < hour) return `${Math.max(1, Math.floor(deltaMs / minute))}m`
  if (deltaMs < day) return `${Math.max(1, Math.floor(deltaMs / hour))}h`
  return `${Math.max(1, Math.floor(deltaMs / day))}d`
}

const matchesFilter = (row: OverviewRow, filter: WorkspaceOverviewFilter): boolean => {
  if (filter === 'all') return true
  const s = row.displayStatus
  if (filter === 'running') return s === 'running' || s === 'queued'
  if (filter === 'waiting') return s === 'attention'
  if (filter === 'done') return s === 'complete'
  return true
}

const buildRows = (
  items: WorkspaceListItem[],
  pullRequests: ProjectPullRequestReviewSummary[],
  bindings: GitHubResourceBinding[],
  railwayDeployments: RailwayDeploymentSummary[],
  railwayResourceBindings: RailwayResourceBinding[],
): OverviewRow[] => {
  return items.map((item) => {
    const displayStatus = resolveWorkspaceListItemDisplayStatus(item)
    const pullRequestDisplay = resolveWorkspaceIndexedPullRequestDisplay({
      pullRequests,
      bindings,
      projectId: item.project.id,
      workspaceId: item.workspace.id,
      workspaceSessionIds: item.sessionPreviews.map((session) => session.id),
      compareBranch: item.worktreeBranchName,
    })
    const railwayDeploymentDisplay = resolveWorkspaceIndexedRailwayDeploymentDisplay({
      deployments: railwayDeployments,
      bindings: railwayResourceBindings,
      projectId: item.project.id,
      workspaceId: item.workspace.id,
      workspaceSessionIds: item.sessionPreviews.map((session) => session.id),
      compareBranch: item.worktreeBranchName,
    })
    return {
      item,
      displayStatus,
      prState: pullRequestDisplay
        ? {
            url: pullRequestDisplay.url,
            number: pullRequestDisplay.number,
            state: pullRequestDisplay.state,
            branch: pullRequestDisplay.compareBranch,
          }
        : undefined,
      railwayDisplay: railwayDeploymentDisplay,
    }
  })
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  WorkspaceSessionDisplayStatus,
  { labelKey: string; bgClass: string; textClass: string }
> = {
  running: { labelKey: 'workspaceOverview.status.running', bgClass: 'bg-sky-500/10', textClass: 'text-sky-300' },
  queued: { labelKey: 'workspaceOverview.status.queued', bgClass: 'bg-amber-500/10', textClass: 'text-amber-300' },
  attention: { labelKey: 'workspaceOverview.status.attention', bgClass: 'bg-amber-500/10', textClass: 'text-amber-300' },
  complete: { labelKey: 'workspaceOverview.status.complete', bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-300' },
  error: { labelKey: 'workspaceOverview.status.error', bgClass: 'bg-orange-500/10', textClass: 'text-orange-300' },
  idle: { labelKey: 'workspaceOverview.status.idle', bgClass: 'bg-zinc-500/10', textClass: 'text-zinc-400' },
}

const StatusPill = memo(function StatusPill({
  status,
  t,
}: {
  status: WorkspaceSessionDisplayStatus
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const meta = STATUS_META[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium', meta.bgClass, meta.textClass)}>
      {t(meta.labelKey)}
    </span>
  )
})

// ---------------------------------------------------------------------------
// Executor tone styles (matching workspace list card)
// ---------------------------------------------------------------------------

const EXECUTOR_ICON_CLASS: Record<string, string> = {
  online: 'text-emerald-500/75',
  busy: 'text-amber-400/85',
  offline: 'text-zinc-600',
  neutral: 'text-zinc-500',
}

const EXECUTOR_TEXT_CLASS: Record<string, string> = {
  online: 'text-emerald-500',
  paired: 'text-sky-500',
  offline: 'text-zinc-500',
  error: 'text-rose-500',
}

// ---------------------------------------------------------------------------
// PR badge (using shared TaskPullRequestBadge)
// ---------------------------------------------------------------------------

import type { TaskPullRequestDisplay } from '../../lib/task-pull-request'
import { TaskPullRequestBadge } from '../task-pull-request-badge'

const PR_TONE_CLASS: Record<string, string> = {
  open: 'bg-emerald-500/10 text-emerald-300',
  merged: 'bg-violet-500/10 text-violet-300',
  closed: 'bg-zinc-500/10 text-zinc-300',
  unknown: 'bg-zinc-500/10 text-zinc-300',
}

const PR_LABEL: Record<string, string> = {
  open: 'PR',
  merged: '已合并',
  closed: '已关闭',
  unknown: '已关闭',
}

const buildPrDisplay = (pr: NonNullable<OverviewRow['prState']>): TaskPullRequestDisplay => ({
  url: pr.url,
  number: pr.number,
  compareBranch: pr.branch,
  state: pr.state,
  label: pr.state === 'merged'
    ? 'PR 已合并'
    : pr.state === 'open'
      ? 'PR 审核中'
      : pr.state === 'closed'
        ? 'PR 已关闭'
        : 'PR 状态未知',
  compactLabel: PR_LABEL[pr.state] ?? 'PR',
  toneClassName: PR_TONE_CLASS[pr.state] ?? PR_TONE_CLASS.unknown,
  icon: pr.state === 'merged'
    ? 'merged'
    : pr.state === 'open'
      ? 'open'
      : pr.state === 'closed'
        ? 'closed'
        : 'unknown',
})

// ---------------------------------------------------------------------------
// Node switch popover
// ---------------------------------------------------------------------------

const NodeSwitchPopover = memo(function NodeSwitchPopover({
  workspaceId,
  executorName,
  executorStatusTone,
  currentExecutorId,
  executors,
  onSwitch,
  t,
}: {
  workspaceId: string
  executorName?: string
  executorStatusTone?: string
  currentExecutorId?: string
  executors: ExecutorRecord[]
  onSwitch: (workspaceId: string, executorNodeId: string) => void
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState(false)
  const available = executors.filter((e) => e.status === 'online' || e.status === 'paired')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center gap-1.5 overflow-hidden text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
          onClick={(e) => e.stopPropagation()}
        >
          <Radio className={cn('h-2.5 w-2.5 shrink-0', EXECUTOR_ICON_CLASS[executorStatusTone ?? ''] ?? 'text-zinc-500')} />
          <span className="truncate min-w-0">{executorName ?? '—'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-52 border-zinc-800 bg-zinc-950 p-1" onClick={(e) => e.stopPropagation()}>
        <div className="px-2 py-1 text-[10px] font-medium text-zinc-500">
          {t('workspaceOverview.switchNode')}
        </div>
        {available.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-zinc-600">{t('workspaceOverview.noOnlineNodes')}</div>
        ) : (
          available.map((executor) => {
            const isCurrent = executor.executorId === currentExecutorId
            return (
              <button
                key={executor.executorId}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors',
                  isCurrent ? 'bg-zinc-800/60 text-zinc-200' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200',
                )}
                onClick={() => {
                  if (!isCurrent) onSwitch(workspaceId, executor.executorId)
                  setOpen(false)
                }}
              >
                <Radio
                  size={10}
                  className={cn(EXECUTOR_TEXT_CLASS[executor.status] ?? 'text-zinc-600')}
                  fill="currentColor"
                  stroke="none"
                />
                <span className="flex-1 truncate">{executor.name}</span>
                {isCurrent && <Check size={12} className="shrink-0 text-emerald-400" />}
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
})

// ---------------------------------------------------------------------------
// Row item
// ---------------------------------------------------------------------------

const TableRowItem = memo(function TableRowItem({
  row,
  selected,
  executors,
  onSelect,
  onSwitchNode,
  onStartEnvironment,
  onStopEnvironment,
  onOpenLogs,
  onOpenPreview,
  optimisticState,
  t,
}: {
  row: OverviewRow
  selected: boolean
  executors: ExecutorRecord[]
  onSelect: () => void
  onSwitchNode: (workspaceId: string, executorNodeId: string) => void
  onStartEnvironment?: (workspaceId: string) => void
  onStopEnvironment?: (workspaceId: string) => void
  onOpenLogs?: (workspaceId: string) => void
  onOpenPreview?: (workspaceId: string) => void
  optimisticState?: { terminalOpen?: boolean; envRunning?: boolean }
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  const { item } = row
  const { workspace } = item
  const creator = item.creatorProfile
  const envStatus = workspace.runtimeSummary?.environment?.status
  const serverEnvRunning = envStatus === 'running' || envStatus === 'starting'
  const serverTerminalOpen = workspace.runtimeSummary?.terminal?.status === 'open'
  const envRunning = optimisticState?.envRunning ?? serverEnvRunning
  const terminalOpen = optimisticState?.terminalOpen ?? serverTerminalOpen

  // 实际访问地址:跟随 preview session 的 accessMode(隧道域名/公网预览域名)。
  // 列表页不跑 transport probe,不擅自降级为 127.0.0.1;支持多端口切换 ——
  // 切换端口时地址(含隧道域名,因每个端口有独立域名)跟着变。
  const previewAddresses = useMemo(() => {
    const summary = item.previewSummary
    if (!summary?.sources.length) {
      return []
    }
    return summary.sources.map((source) => resolveListPreviewAddress({
      source,
      remoteTransport: summary.remoteTransport,
    }))
  }, [item.previewSummary])
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0)
  const activePreview = previewAddresses[selectedPreviewIndex] ?? previewAddresses[0]

  return (
    <div className={cn('group border-b border-zinc-800/60 transition-colors hover:bg-zinc-900/40', selected && 'bg-zinc-900/60')}>
      <div
        className={cn(GRID_CLASS, 'h-10 cursor-pointer px-3')}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() }
        }}
      >
        {/* Name / Branch */}
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-200">
              {workspace.name || t('workspace.unnamed')}
            </div>
            {(workspace.codeBranchName || item.worktreeBranchName) && (
              <div className="truncate text-[11px] text-zinc-500">
                {workspace.codeBranchName || item.worktreeBranchName}
              </div>
            )}
          </div>
        </div>

        {/* Project */}
        <div className="flex items-center gap-1.5 truncate text-[12px] text-zinc-400">
          <span
            className="inline-block size-2 shrink-0 rounded-sm"
            style={{ backgroundColor: getProjectColor(item.project) }}
          />
          <span className="truncate">{item.project.name}</span>
        </div>

        {/* Creator */}
        <div className="flex items-center gap-1.5 truncate text-[12px] text-zinc-400">
          {creator?.avatarUrl ? (
            <img
              src={resolveMediaUrl(creator.avatarUrl)}
              alt=""
              className="size-4 shrink-0 rounded-full object-cover"
            />
          ) : creator?.name ? (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[9px] font-medium text-zinc-300">
              {creator.name.charAt(0).toUpperCase()}
            </span>
          ) : null}
          <span className="truncate">{creator?.name || '—'}</span>
        </div>

        {/* Node */}
        <div className="min-w-0 overflow-hidden">
          <NodeSwitchPopover
            workspaceId={workspace.id}
            executorName={item.currentExecutorDisplayName}
            executorStatusTone={item.currentExecutorStatusTone}
            currentExecutorId={item.currentExecutorId}
            executors={executors}
            onSwitch={onSwitchNode}
            t={t}
          />
        </div>

        {/* Agent */}
        <div className="flex items-center">
          {workspace.agentType ? (
            <RuntimeLabel runtime={workspace.agentType} size={14} showLabel={false} />
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </div>

        {/* Sessions / Activity */}
        <div className="flex items-center gap-1.5 text-[12px] text-zinc-400">
          <span>{t('workspaceOverview.sessionsCount', { count: item.sessionCount })}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">{formatRelativeTime(item.recentActivityAt)}</span>
        </div>

        {/* Status */}
        <div>
          <StatusPill status={row.displayStatus} t={t} />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-0.5">
          <button
            className={cn(
              'relative rounded p-1 transition-colors',
              envRunning
                ? 'text-emerald-500/40 cursor-not-allowed'
                : 'text-zinc-600 hover:bg-zinc-800 hover:text-emerald-400',
            )}
            title={t('workspaceOverview.actionRun')}
            disabled={envRunning}
            onClick={(e) => { e.stopPropagation(); onStartEnvironment?.(workspace.id) }}
          >
            <Play size={13} />
          </button>
          <button
            className={cn(
              'rounded p-1 transition-colors',
              !envRunning
                ? 'text-zinc-600/40 cursor-not-allowed'
                : 'text-zinc-600 hover:bg-zinc-800 hover:text-amber-400',
            )}
            title={t('workspaceOverview.actionStop')}
            disabled={!envRunning}
            onClick={(e) => { e.stopPropagation(); onStopEnvironment?.(workspace.id) }}
          >
            <Square size={13} />
          </button>
          <button
            className="relative rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-sky-400"
            title={t('workspaceOverview.actionLogs')}
            onClick={(e) => { e.stopPropagation(); onOpenLogs?.(workspace.id) }}
          >
            <TerminalSquare size={13} />
            {terminalOpen && (
              <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
          <button
            className="relative rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-violet-400"
            title={t('workspaceOverview.actionPreview')}
            onClick={(e) => { e.stopPropagation(); onOpenPreview?.(workspace.id) }}
          >
            <Rocket size={13} />
            {envRunning && (
              <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        </div>

        {/* Preview:端口选择器(左)+ 实际访问地址(右)。先选端口,再看该端口的地址。切换端口时地址跟着变(各端口有独立隧道域名)。 */}
        <div className="flex items-center gap-1.5">
          {activePreview ? (
            <>
              {/* 端口选择器(左):多端口时可下拉切换,单端口时仅展示 */}
              {previewAddresses.length > 1 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="inline-flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
                      title={t('workspaceOverview.switchPreviewPort')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {activePreview.port ? `:${activePreview.port}` : '—'}
                      <ChevronDown size={11} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-1" onClick={(e) => e.stopPropagation()}>
                    {previewAddresses.map((addr, index) => (
                      <button
                        key={addr.url}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-zinc-800',
                          index === selectedPreviewIndex ? 'text-sky-400' : 'text-zinc-300',
                        )}
                        onClick={() => setSelectedPreviewIndex(index)}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono text-zinc-400">{addr.port ? `:${addr.port}` : '—'}</span>
                          <span className="truncate">{addr.note || addr.host}</span>
                        </span>
                        {index === selectedPreviewIndex && <Check size={12} className="shrink-0" />}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                  {activePreview.port ? `:${activePreview.port}` : '—'}
                </span>
              )}
              {/* 实际访问地址(右):像浏览器地址栏,显示该端口当前 transport 的实际地址 */}
              <a
                href={activePreview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-[12px] text-sky-400 hover:underline"
                title={`${activePreview.transportLabel} · ${activePreview.url}`}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate max-w-[140px]">{activePreview.host}</span>
                <ExternalLink size={10} className="shrink-0" />
              </a>
              {activePreview.note && previewAddresses.length <= 1 && (
                <span className="truncate max-w-[100px] rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400" title={activePreview.note}>
                  {activePreview.note}
                </span>
              )}
            </>
          ) : (
            <span className="text-[12px] text-zinc-600" title={envRunning ? t('workspaceOverview.previewPortHint') : undefined}>
              {t('workspaceOverview.noPreview')}
            </span>
          )}
        </div>

        {/* PR */}
        <div>
          {row.prState ? <TaskPullRequestBadge display={buildPrDisplay(row.prState)} compact /> : <span className="text-zinc-600">—</span>}
        </div>

        {/* Railway */}
        <div>
          {row.railwayDisplay ? <RailwayDeploymentBadge display={row.railwayDisplay} compact /> : <span className="text-zinc-600">—</span>}
        </div>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Project filter dropdown
// ---------------------------------------------------------------------------

const ProjectFilterDropdown = memo(function ProjectFilterDropdown({
  projects,
  selectedId,
  onSelect,
  allLabel,
}: {
  projects: Project[]
  selectedId: string
  onSelect: (id: string) => void
  allLabel: string
}) {
  const [open, setOpen] = useState(false)
  const selected = projects.find((p) => p.id === selectedId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700"
          onClick={(e) => e.stopPropagation()}
        >
          {selected ? (
            <>
              <span
                className="inline-block size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: getProjectColor(selected) }}
              />
              <span className="truncate max-w-[100px]">{selected.name}</span>
            </>
          ) : (
            <span>{allLabel}</span>
          )}
          <ChevronDown size={12} className="shrink-0 text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-48 border-zinc-800 bg-zinc-950 p-1" onClick={(e) => e.stopPropagation()}>
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors',
            !selectedId ? 'bg-zinc-800/60 text-zinc-200' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200',
          )}
          onClick={() => { onSelect(''); setOpen(false) }}
        >
          <span className="size-2 rounded-sm bg-zinc-600" />
          <span className="flex-1 truncate">{allLabel}</span>
          {!selectedId && <Check size={12} className="shrink-0 text-emerald-400" />}
        </button>
        {projects.map((project) => {
          const isActive = project.id === selectedId
          return (
            <button
              key={project.id}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors',
                isActive ? 'bg-zinc-800/60 text-zinc-200' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200',
              )}
              onClick={() => { onSelect(project.id); setOpen(false) }}
            >
              <span
                className="inline-block size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: getProjectColor(project) }}
              />
              <span className="flex-1 truncate">{project.name}</span>
              {isActive && <Check size={12} className="shrink-0 text-emerald-400" />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const TableEmptyState = memo(function TableEmptyState({
  query,
  t,
}: {
  query: string
  t: (key: string, vars?: Record<string, unknown>) => string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <LayoutGrid size={36} className="mb-3 text-zinc-700" />
      <h3 className="text-sm font-medium text-zinc-400">{t('workspaceOverview.emptyTitle')}</h3>
      <p className="mt-1 text-xs text-zinc-600">
        {query ? t('workspaceOverview.emptySearchDescription', { query }) : t('workspaceOverview.emptyDescription')}
      </p>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export const WorkspacesTablePanel = memo(function WorkspacesTablePanel({
  items,
  executors,
  projectPullRequests = [],
  githubResourceBindings = [],
  railwayDeployments = [],
  railwayResourceBindings = [],
  selectedWorkspaceId,
  onSelectWorkspace,
  onStartEnvironment,
  onStopEnvironment,
  onOpenLogs,
  onOpenPreview,
  onSwitchNode,
}: WorkspacesTablePanelProps) {
  const { t } = useTranslation()

  const [filter, setFilter] = useState<WorkspaceOverviewFilter>('all')
  const [query, setQuery] = useState('')
  const [projectFilterId, setProjectFilterId] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const [optimisticState, setOptimisticState] = useState<Map<string, { terminalOpen?: boolean; envRunning?: boolean }>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const allRows = useMemo(
    () => buildRows(items, projectPullRequests, githubResourceBindings, railwayDeployments, railwayResourceBindings),
    [githubResourceBindings, items, projectPullRequests, railwayDeployments, railwayResourceBindings],
  )

  const filterProjects = useMemo(() => {
    const seen = new Map<string, Project>()
    for (const row of allRows) {
      const p = row.item.project
      if (!seen.has(p.id)) seen.set(p.id, p)
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allRows])

  const filterCreators = useMemo(() => {
    const seen = new Set<string>()
    for (const row of allRows) {
      const name = row.item.creatorProfile?.name.trim()
      if (name) seen.add(name)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [allRows])

  const filteredRows = useMemo(() => {
    const q = query.toLowerCase()
    return allRows.filter((row) => {
      if (!matchesFilter(row, filter)) return false
      if (projectFilterId && row.item.project.id !== projectFilterId) return false
      if (creatorFilter && (row.item.creatorProfile?.name || '') !== creatorFilter) return false
      if (!q) return true
      const ws = row.item.workspace
      return (
        ws.name.toLowerCase().includes(q) ||
        (ws.codeBranchName?.toLowerCase().includes(q) ?? false) ||
        row.item.project.name.toLowerCase().includes(q) ||
        (row.item.currentExecutorDisplayName?.toLowerCase().includes(q) ?? false) ||
        (row.item.creatorProfile?.name.toLowerCase().includes(q) ?? false) ||
        (ws.agentType?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [allRows, creatorFilter, filter, projectFilterId, query])

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 41,
    overscan: 8,
  })

  const counts = useMemo(() => {
    const c = { all: allRows.length, running: 0, waiting: 0, done: 0 }
    for (const row of allRows) {
      if (matchesFilter(row, 'running')) c.running++
      if (matchesFilter(row, 'waiting')) c.waiting++
      if (matchesFilter(row, 'done')) c.done++
    }
    return c
  }, [allRows])

  const handleSwitchNode = useCallback(async (workspaceId: string, executorNodeId: string) => {
    if (onSwitchNode) {
      onSwitchNode(workspaceId, executorNodeId)
      return
    }
    // Fallback: call API directly
    const workspace = items.find((i) => i.workspace.id === workspaceId)?.workspace
    if (!workspace) return
    try {
      await api.updateWorkspace(workspaceId, { name: workspace.name, executorNodeId })
    } catch {
      // silent
    }
  }, [items, onSwitchNode])

  // Sync optimistic state with server state
  useEffect(() => {
    setOptimisticState((prev) => {
      if (prev.size === 0) return prev
      const next = new Map(prev)
      for (const row of allRows) {
        const ws = row.item.workspace
        const local = next.get(ws.id)
        if (!local) continue
        const serverTerminal = ws.runtimeSummary?.terminal?.status === 'open'
        const serverEnv = ws.runtimeSummary?.environment?.status === 'running' || ws.runtimeSummary?.environment?.status === 'starting'
        // Clear optimistic values when server state catches up
        if (local.terminalOpen !== undefined) {
          if (local.terminalOpen === serverTerminal || !serverTerminal) {
            delete local.terminalOpen
          }
        }
        if (local.envRunning !== undefined) {
          if (local.envRunning === serverEnv || !serverEnv) {
            delete local.envRunning
          }
        }
        if (!local.terminalOpen && !local.envRunning) {
          next.delete(ws.id)
        }
      }
      return next.size === prev.size ? prev : next
    })
  }, [allRows])

  const handleStartEnvironment = useCallback((workspaceId: string) => {
    const item = items.find((i) => i.workspace.id === workspaceId)
    if (item?.currentExecutorStatusTone === 'online' || item?.currentExecutorStatusTone === 'busy') {
      setOptimisticState((prev) => {
        const next = new Map(prev)
        const existing = next.get(workspaceId) ?? {}
        next.set(workspaceId, { ...existing, envRunning: true })
        return next
      })
    }
    onStartEnvironment?.(workspaceId)
  }, [items, onStartEnvironment])

  const handleStopEnvironment = useCallback((workspaceId: string) => {
    const item = items.find((i) => i.workspace.id === workspaceId)
    if (item?.currentExecutorStatusTone === 'online' || item?.currentExecutorStatusTone === 'busy') {
      setOptimisticState((prev) => {
        const next = new Map(prev)
        const existing = next.get(workspaceId) ?? {}
        next.set(workspaceId, { ...existing, envRunning: false })
        return next
      })
    }
    onStopEnvironment?.(workspaceId)
  }, [items, onStopEnvironment])

  const handleOpenLogs = useCallback((workspaceId: string) => {
    const item = items.find((i) => i.workspace.id === workspaceId)
    if (item?.currentExecutorStatusTone === 'online' || item?.currentExecutorStatusTone === 'busy') {
      setOptimisticState((prev) => {
        const next = new Map(prev)
        const existing = next.get(workspaceId) ?? {}
        next.set(workspaceId, { ...existing, terminalOpen: true })
        return next
      })
    }
    onOpenLogs?.(workspaceId)
  }, [items, onOpenLogs])

  const handleOpenPreview = useCallback((workspaceId: string) => {
    onOpenPreview?.(workspaceId)
  }, [onOpenPreview])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filter tabs + search */}
      <div className="shrink-0 border-b border-zinc-800/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md bg-zinc-900 p-0.5">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                  filter === tab.id ? 'bg-zinc-800 text-zinc-200 shadow-sm' : 'text-zinc-500 hover:text-zinc-300',
                )}
                onClick={() => setFilter(tab.id)}
              >
                {t(tab.labelKey)}
                <span className="ml-1 text-[10px] text-zinc-600">{counts[tab.id]}</span>
              </button>
            ))}
          </div>

          {filterProjects.length > 1 && (
            <ProjectFilterDropdown
              projects={filterProjects}
              selectedId={projectFilterId}
              onSelect={setProjectFilterId}
              allLabel={t('workspaceOverview.filterAllProjects', { defaultValue: '全部项目' })}
            />
          )}

          {filterCreators.length > 1 && (
            <select
              value={creatorFilter}
              onChange={(e) => setCreatorFilter(e.target.value)}
              className="h-7 appearance-none rounded-md border border-zinc-800 bg-zinc-900 px-2 pr-5 text-[11px] text-zinc-300 outline-none transition-colors hover:border-zinc-700 focus:border-zinc-600"
              style={SELECT_CHEVRON_STYLE}
            >
              <option value="">{t('workspaceOverview.filterAllCreators', { defaultValue: '全部创建人' })}</option>
              {filterCreators.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}

          <div className="relative flex-1 max-w-[200px]">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workspaceOverview.searchPlaceholder')}
              className="h-7 bg-zinc-900 pl-6 pr-6 text-[12px] border-zinc-800 placeholder:text-zinc-600"
            />
            {query && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                onClick={() => setQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        {/* Column headers */}
        <div className={cn(GRID_CLASS, 'sticky top-0 z-10 h-8 border-b border-zinc-800/60 bg-zinc-950/95 px-3 text-[11px] font-medium text-zinc-500 backdrop-blur')}>
          <div>{t('workspaceOverview.column.name')}</div>
          <div>{t('workspaceOverview.column.project')}</div>
          <div>{t('workspaceOverview.column.creator', { defaultValue: '创建人' })}</div>
          <div>{t('workspaceOverview.column.node')}</div>
          <div>{t('workspaceOverview.column.agent')}</div>
          <div>{t('workspaceOverview.column.sessions')}</div>
          <div>{t('workspaceOverview.column.status')}</div>
          <div className="text-right">{t('workspaceOverview.column.actions')}</div>
          <div>{t('workspaceOverview.column.preview')}</div>
          <div>{t('workspaceOverview.column.pr')}</div>
          <div>{t('workspaceOverview.column.railway', { defaultValue: 'Railway' })}</div>
        </div>

        {/* Rows */}
        {filteredRows.length === 0 ? (
          <TableEmptyState query={query} t={t} />
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = filteredRows[virtualRow.index]
              return (
                <div
                  key={row.item.workspace.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TableRowItem
                    row={row}
                    selected={row.item.workspace.id === selectedWorkspaceId}
                    executors={executors}
                    onSelect={() => onSelectWorkspace(row.item.workspace.id)}
                    onSwitchNode={handleSwitchNode}
                    onStartEnvironment={handleStartEnvironment}
                    onStopEnvironment={handleStopEnvironment}
                    onOpenLogs={handleOpenLogs}
                    onOpenPreview={handleOpenPreview}
                    optimisticState={optimisticState.get(row.item.workspace.id)}
                    t={t}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center border-t border-zinc-800/60 px-3 py-1 text-[11px] text-zinc-600">
        <span>{t('workspaceOverview.footer', { shown: filteredRows.length, total: allRows.length })}</span>
      </div>
    </div>
  )
})
