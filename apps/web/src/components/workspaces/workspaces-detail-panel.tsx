import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FolderGit2,
  GitBranch,
  Server,
  Sparkles,
  TerminalSquare,
  Trash2,
  Workflow,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { ScrollArea } from '../ui/scroll-area'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate } from '../../lib/utils'
import type { Project, Task, Workspace } from '@shared/types'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { isManagedCloudExecutorRecord } from '../../lib/managed-cloud-executor'
import { isManagedCloudDevOnlyEnabled } from '../../lib/runtime-config'

type WorkspaceListItem = {
  workspace: Workspace
  project: Project
  linkedTasks: Task[]
  activeTask: Task | null
  runningCount: number
  unreadCount: number
  baseBranch: string
}

interface WorkspacesDetailPanelProps {
  item: WorkspaceListItem | null
  mobile?: boolean
  busy: boolean
  onDelete: (item: WorkspaceListItem) => Promise<void>
  onOpenWorkspace: (item: WorkspaceListItem) => void
  onBack?: () => void
}

export function WorkspacesDetailPanel({
  item,
  mobile = false,
  busy,
  onDelete,
  onOpenWorkspace,
  onBack,
}: WorkspacesDetailPanelProps) {
  const { t } = useTranslation()
  if (!item) {
    return <EmptyState />
  }

  const workspaceStatusMeta: Record<Workspace['status'], { label: string; className: string }> = {
    ready: { label: t('workspace.labels.status.ready'), className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400' },
    pending_repo: { label: t('workspace.labels.status.pendingRepo'), className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400' },
    missing_repo: { label: t('workspace.labels.status.missingRepo'), className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400' },
    archived: { label: t('workspace.labels.status.archived'), className: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400' },
  }
  const executorStatusMeta: Record<Workspace['executorStatus'], { label: string; dotClassName: string }> = {
    online: { label: t('workspace.labels.executor.online'), dotClassName: 'bg-emerald-500' },
    paired: { label: t('workspace.labels.executor.paired'), dotClassName: 'bg-sky-500' },
    offline: { label: t('workspace.labels.executor.offline'), dotClassName: 'dark:bg-zinc-600 bg-zinc-400' },
    error: { label: t('workspace.labels.executor.error'), dotClassName: 'bg-rose-500' },
  }
  const workspaceSourceLabel: Record<Workspace['source'], string> = {
    binding: t('workspace.labels.source.binding'),
    'workspace-root': t('workspace.labels.source.workspaceRoot'),
    manual: t('workspace.labels.source.manual'),
  }
  const workspaceModeLabel: Record<Workspace['workingDirectoryMode'], string> = {
    worktree: t('workspace.labels.directory.worktree'),
    'original-dir': t('workspace.labels.directory.originalDir'),
  }

  const statusMeta = workspaceStatusMeta[item.workspace.status]
  const isManagedCloudWorkspace = isManagedCloudDevOnlyEnabled()
    && item.workspace.executorNodeId.startsWith('managed-cloud:')
    && isManagedCloudExecutorRecord({
      executorId: item.workspace.executorNodeId,
      machineId: item.workspace.executorNodeId,
      machineName: item.workspace.executorName,
      name: item.workspace.executorName,
      ownerUserId: '',
      visibility: 'private',
      status: item.workspace.executorStatus === 'error' ? 'offline' : item.workspace.executorStatus,
      workspaceRoot: '',
      maxConcurrency: 0,
      capabilities: [],
      labels: [],
      createdAt: '',
      lastSeenAt: '',
      executorSource: 'managed-cloud',
      managedBy: 'vibemux',
    })
  const executorMeta = isManagedCloudWorkspace
    ? (
      item.workspace.executorStatus === 'error'
        ? { label: '云节点异常', dotClassName: 'bg-rose-500' }
        : item.workspace.executorStatus === 'offline'
          ? { label: '云节点待唤起', dotClassName: 'bg-amber-500' }
          : item.workspace.executorStatus === 'paired'
            ? { label: '云节点启动中', dotClassName: 'bg-sky-500' }
            : { label: '云节点可用', dotClassName: 'bg-emerald-500' }
    )
    : executorStatusMeta[item.workspace.executorStatus]

  return (
    <main className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 min-w-0">
      {/* Header */}
      <div className="border-b border-stone-200 bg-white px-4 py-4 sm:px-6 sm:py-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4 min-w-0">
          <div className="min-w-0 overflow-hidden">
            {mobile && onBack ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onBack}
                className="mb-3 h-8 rounded-lg px-0 text-stone-500 hover:bg-transparent hover:text-stone-900 dark:text-zinc-500 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('workspace.pageView.actions.backToList')}
              </Button>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn('border text-xs font-medium', statusMeta.className)}>
                {statusMeta.label}
              </Badge>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-600 dark:bg-zinc-800 dark:text-zinc-400">
                <span className={cn('h-2 w-2 rounded-full', executorMeta.dotClassName)} />
                {executorMeta.label}
              </span>
            </div>
            <h1 className="mt-2 truncate min-w-0 text-xl font-semibold tracking-tight text-stone-950 dark:text-zinc-50 sm:text-2xl">
              {item.workspace.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-stone-500 dark:text-zinc-500 min-w-0">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <FolderGit2 className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">{item.project.name}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Server className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">{item.workspace.executorName}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <GitBranch className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">{item.baseBranch}</span>
              </span>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button
              type="button"
              onClick={() => onOpenWorkspace(item)}
              className="h-9 flex-1 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800 sm:flex-none dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <TerminalSquare className="mr-2 h-4 w-4" />
              {t('workspace.detail.actions.openWorkspace')}
            </Button>
            {item.activeTask && (
              <Button
                asChild
                variant="outline"
                className="h-9 flex-1 rounded-lg border-stone-200 bg-white px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 sm:flex-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <Link
                  to="/kanban"
                  search={{
                    projectId: item.project.id,
                    taskId: item.activeTask.id,
                    createTask: undefined,
                  }}
                >
                  {t('workspace.detail.actions.viewTask')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
            {canDeleteWorkspaceRecord(item.workspace) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onDelete(item)}
                disabled={busy}
                className="h-9 flex-1 rounded-lg border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-600 hover:bg-rose-100 sm:flex-none dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/30"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('workspace.detail.actions.deleteWorkspace')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-0 p-4 sm:p-6">
          {/* Metrics Grid */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 min-w-0">
            <MetricCard
              icon={Workflow}
              label={t('workspace.detail.metrics.linkedTasks')}
              value={String(item.linkedTasks.length)}
              detail={item.linkedTasks.length > 0 ? t('workspace.detail.metricDetails.linkedTasksBound') : t('workspace.detail.metricDetails.linkedTasksEmpty')}
            />
            <MetricCard
              icon={Sparkles}
              label={t('workspace.detail.metrics.running')}
              value={String(item.runningCount)}
              detail={item.runningCount > 0 ? t('workspace.detail.metricDetails.runningActive') : t('workspace.detail.metricDetails.runningEmpty')}
              accent={item.runningCount > 0 ? 'amber' : undefined}
            />
            <MetricCard
              icon={AlertTriangle}
              label={t('workspace.detail.metrics.attention')}
              value={String(item.unreadCount)}
              detail={item.unreadCount > 0 ? t('workspace.detail.metricDetails.attentionActive') : t('workspace.detail.metricDetails.attentionEmpty')}
              accent={item.unreadCount > 0 ? 'rose' : undefined}
            />
            <MetricCard
              icon={CheckCircle2}
              label={t('workspace.detail.metrics.repoStatus')}
              value={item.workspace.repoReady ? t('workspace.labels.status.ready') : t('workspace.labels.status.pendingRepo')}
              detail={item.workspace.repoPath || t('workspace.detail.metricDetails.repoPending')}
              accent={item.workspace.repoReady ? 'emerald' : 'amber'}
            />
            <MetricCard
              icon={Sparkles}
              label={t('workspace.detail.metrics.defaultAgent')}
              value={<RuntimeLabel runtime={item.workspace.agentType} size={16} labelClassName="text-inherit" />}
              detail={t('workspace.detail.metricDetails.defaultAgent')}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2 min-w-0">
            {/* Current Focus */}
            <Card className="dark:bg-zinc-800 dark:border-zinc-700 min-w-0 overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-base dark:text-zinc-100">{t('workspace.detail.currentFocusTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                {item.activeTask ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 dark:bg-zinc-700 dark:text-zinc-400">
                        {t('workspace.detail.taskStatus', { status: item.activeTask.status })}
                      </span>
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 dark:bg-zinc-700 dark:text-zinc-400">
                        {t('workspace.detail.taskModel', { model: item.activeTask.executionModel || t('workspace.labels.defaultModel') })}
                      </span>
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-600 dark:bg-zinc-700 dark:text-zinc-400">
                        {t('workspace.detail.taskAgent', { agent: item.activeTask.agentType })}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-stone-950 dark:text-zinc-50">{item.activeTask.title}</h3>
                    <p className="line-clamp-3 text-sm leading-relaxed text-stone-600 dark:text-zinc-400">
                      {item.activeTask.description || t('workspace.detail.noTaskDescription')}
                    </p>
                    <div className="rounded-lg bg-stone-50 p-3 dark:bg-zinc-900/50">
                      <p className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-zinc-500">{t('workspace.detail.taskSnapshot')}</p>
                      <div className="mt-2 space-y-1.5 text-sm">
                        <InfoLine label={t('workspace.detail.summary.project')} value={item.project.name} />
                        <InfoLine label={t('workspace.detail.summary.executor')} value={item.workspace.executorName} />
                        <InfoLine label={t('workspace.detail.summary.branch')} value={item.baseBranch} />
                        <InfoLine label={t('workspace.detail.summary.updatedAt')} value={formatDate(item.activeTask.updatedAt)} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50/50 px-4 py-6 text-center dark:border-zinc-700 dark:bg-zinc-800/30">
                    <p className="text-sm font-medium text-stone-600 dark:text-zinc-400">{t('workspace.detail.noBoundTaskTitle')}</p>
                    <p className="mt-1 text-xs text-stone-400 dark:text-zinc-500">
                      {t('workspace.detail.noBoundTaskDescription')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Workspace Summary */}
            <Card className="dark:bg-zinc-800 dark:border-zinc-700 min-w-0 overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-base dark:text-zinc-100">{t('workspace.detail.summaryTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <SummaryRow label={t('workspace.detail.summary.source')} value={workspaceSourceLabel[item.workspace.source]} />
                <SummaryRow label={t('workspace.detail.summary.directory')} value={workspaceModeLabel[item.workspace.workingDirectoryMode]} />
                <SummaryRow
                  label={t('workspace.detail.summary.defaultAgent')}
                  value={<RuntimeLabel runtime={item.workspace.agentType} size={14} labelClassName="text-inherit" />}
                />
                <SummaryRow label={t('workspace.detail.summary.defaultBranch')} value={item.workspace.defaultBranch || t('workspace.labels.unset')} />
                <SummaryRow label={t('workspace.detail.summary.suggestedBaseBranch')} value={item.workspace.suggestedBaseBranch || item.baseBranch} />
                <SummaryRow label={t('workspace.detail.summary.repoPath')} value={item.workspace.repoPath || t('workspace.detail.metricDetails.repoPending')} />
                <SummaryRow label={t('workspace.detail.summary.updatedAt')} value={formatDate(item.workspace.updatedAt)} />
              </CardContent>
            </Card>
          </div>

          {/* Recent Tasks */}
          {item.linkedTasks.length > 0 && (
            <Card className="mt-6 dark:bg-zinc-800 dark:border-zinc-700 min-w-0 overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-base dark:text-zinc-100">{t('workspace.detail.recentTasksTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {item.linkedTasks.slice(0, 6).map((task) => (
                    <TaskRow key={task.id} task={task} projectId={item.project.id} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </main>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-0 items-center justify-center rounded-lg border border-dashed border-stone-200 bg-stone-50/50 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className="max-w-sm space-y-4 px-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-zinc-800">
          <Workflow className="h-8 w-8 text-stone-400 dark:text-zinc-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">{t('workspace.detail.emptyTitle')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-zinc-500">
            {t('workspace.detail.emptyDescription')}
          </p>
        </div>
      </div>
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof Workflow
  label: string
  value: ReactNode
  detail: string
  accent?: 'amber' | 'rose' | 'emerald'
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-400 dark:text-zinc-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={cn(
        "mt-2 text-2xl font-semibold min-w-0",
        accent === 'amber' && 'text-amber-600 dark:text-amber-400',
        accent === 'rose' && 'text-rose-600 dark:text-rose-400',
        accent === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
        !accent && 'text-stone-950 dark:text-zinc-50'
      )}>
        {value}
      </p>
      <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-stone-500 dark:text-zinc-500">{detail}</p>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-stone-500 dark:text-zinc-500">{label}</span>
      <span className="max-w-[12rem] truncate text-right text-xs font-medium text-stone-700 dark:text-zinc-400">{value}</span>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-stone-50 px-3 py-2.5 dark:bg-zinc-900/50 min-w-0 overflow-hidden">
      <span className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-zinc-500">{label}</span>
      <div className="text-sm font-medium text-stone-700 dark:text-zinc-300 min-w-0 overflow-hidden text-ellipsis">{value}</div>
    </div>
  )
}

function TaskRow({ task, projectId }: { task: Task; projectId: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to="/kanban"
      search={{
        projectId,
        taskId: task.id,
        createTask: undefined,
      }}
      className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 transition-colors hover:border-stone-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-stone-900 dark:text-zinc-100">{task.title}</p>
        <p className="mt-0.5 text-xs text-stone-500 dark:text-zinc-500">
          {task.status} · {task.executionModel || t('workspace.labels.defaultModel')}
        </p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-stone-400 dark:text-zinc-600" />
    </Link>
  )
}
