import { useMemo, useState, type ReactNode } from 'react'
import { getDistributedTaskQueueInsight } from '@shared/executor-scheduling'
import {
  Activity,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  GitBranch,
  GitPullRequest,
  Link2,
  RefreshCw,
  RotateCcw,
  SendToBack,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { ExecutorSelect } from '../ui/executor-select'
import { SearchableSelect } from '../ui/searchable-select'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { agentMeta, cn, formatDate, formatExecutionModelLabel } from '../../lib/utils'
import { useTranslation } from '../../lib/i18n/react'
import type { DistributedTask, ExecutorRecord, ProjectBinding, Task } from '@shared/types'
import type { TaskGitPullRequestResult } from '@shared/task-git-ops'

export type TabId = 'overview' | 'tasks' | 'bindings' | 'logs'
const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en
const panelClassName = 'rounded-xl border border-zinc-800/80 bg-zinc-950/60 shadow-sm shadow-black/20'

export function TabButton({ id, label, active, onClick }: { id: TabId; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-all',
        active
          ? 'bg-zinc-100 text-zinc-950 shadow-sm'
          : 'text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200',
      )}
    >
      {label}
    </button>
  )
}

export function StatusBlock({ label, value, tone }: { label: string; value: number; tone: 'green' | 'yellow' | 'gray' | 'blue' }) {
  const colors = {
    green: 'text-emerald-300',
    yellow: 'text-amber-300',
    gray: 'text-zinc-400',
    blue: 'text-sky-300',
  }

  return (
    <div className={cn(panelClassName, 'px-4 py-3')}>
      <p className={cn('text-2xl font-semibold', colors[tone])}>{value}</p>
      <p className="mt-1 text-sm text-zinc-500">{label}</p>
    </div>
  )
}

export function MetricCard({ label, value, subtext, icon, accent }: { label: string; value: string; subtext: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={cn(panelClassName, accent && 'border-emerald-500/30')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2 text-zinc-400">{icon}</div>
        </div>
        <p className="mt-3 text-xs font-medium text-zinc-500">{label}</p>
        <p className={cn('mt-1 text-lg font-semibold tracking-tight', accent ? 'text-emerald-300' : 'text-zinc-50')}>{value}</p>
        <p className="mt-1 text-sm leading-5 text-zinc-500">{subtext}</p>
      </CardContent>
    </Card>
  )
}

export function ConnectionPill({ status }: { status: string }) {
  const { language } = useTranslation()
  const tone =
    status === 'online'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'paired'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-zinc-700 bg-zinc-900 text-zinc-400'

  const label = status === 'online'
    ? tr(language, '已连接', 'Connected')
    : status === 'paired'
      ? tr(language, '已配对', 'Paired')
      : tr(language, '未连接', 'Disconnected')

  return <Badge className={cn('whitespace-nowrap border', tone)}>{label}</Badge>
}

export function StatusTag({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : ['executing', 'syncing_back', 'busy'].includes(status)
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
        : ['assigned', 'preparing', 'queued', 'paired'].includes(status)
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : ['failed', 'lost'].includes(status)
            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            : 'border-zinc-700 bg-zinc-900 text-zinc-400'

  return <Badge className={cn('border', tone)}>{status}</Badge>
}

export function InfoField({ label, value, isError }: { label: string; value: ReactNode; isError?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className={cn('mt-0.5 text-sm', isError ? 'text-rose-300' : 'text-zinc-200')}>{value}</div>
    </div>
  )
}

export function formatPullRequestDraft(task: DistributedTask) {
  const pr = task.result?.delivery?.pullRequest
  if (!pr?.ready || !pr.title || !pr.description || !pr.compareBranch) {
    return ''
  }

  return [
    `PR title: ${pr.title}`,
    `Base branch: ${pr.baseBranch}`,
    `Compare branch: ${pr.compareBranch}`,
    '',
    pr.description,
  ].join('\n')
}

const formatBranchDraft = (branchName: string, repoUrl: string, baseBranch: string) => {
  return [
    `Branch: ${branchName}`,
    `Repo: ${repoUrl}`,
    `Base branch: ${baseBranch}`,
  ].join('\n')
}

export function OverviewTab({
  activeTask,
  queuedTasks,
  queuedDistributedTasks,
  onlineCount,
  latestTask,
}: {
  activeTask?: Task
  queuedTasks: Task[]
  queuedDistributedTasks: DistributedTask[]
  onlineCount: number
  latestTask?: DistributedTask
}) {
  const { language } = useTranslation()
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label={tr(language, '当前执行', 'Current Execution')}
        value={activeTask?.title || tr(language, '空闲', 'Idle')}
        subtext={tr(language, '当前节点正在处理', 'Current node is processing')}
        icon={<Activity className="h-4 w-4" />}
        accent={!!activeTask}
      />
      <MetricCard
        label={tr(language, '排队任务', 'Queued Tasks')}
        value={String(queuedDistributedTasks.length)}
        subtext={queuedDistributedTasks.length > 0 ? tr(language, `${queuedTasks.length} 个原始任务仍在等待`, `${queuedTasks.length} source tasks still waiting`) : tr(language, '等待执行', 'Waiting to run')}
        icon={<Clock3 className="h-4 w-4" />}
      />
      <MetricCard
        label={tr(language, '已连接节点', 'Connected Nodes')}
        value={String(onlineCount)}
        subtext={tr(language, '当前已连接到控制面的节点', 'Nodes currently connected to the control plane')}
        icon={<Cpu className="h-4 w-4" />}
      />
      <MetricCard
        label={tr(language, '最新任务', 'Latest Task')}
        value={latestTask?.status || String(queuedDistributedTasks.length)}
        subtext={latestTask?.description || tr(language, '最近一次投递状态', 'Most recent dispatch status')}
        icon={<CheckCircle2 className="h-4 w-4" />}
      />
    </div>
  )
}

export function DistributedTaskDetails({
  distributedTasks,
  executors,
  projectBindings,
  task,
  originTask,
  executorOptions,
  busy,
  onAssignTask,
  onCreatePullRequest,
  onRefreshPullRequestStatus,
  onCancelTask,
  onRetryTask,
  onTakeoverTask,
}: {
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  projectBindings: ProjectBinding[]
  task: DistributedTask
  originTask?: Task
  executorOptions: Array<{ value: string; label: string }>
  busy: boolean
  onAssignTask: (taskId: string, nodeId: string) => void
  onCreatePullRequest: (taskId: string, payload: { title?: string; body?: string; baseBranch?: string }) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onRefreshPullRequestStatus: (taskId: string) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onCancelTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onTakeoverTask: (taskId: string, nodeId?: string) => void
}) {
  const { language } = useTranslation()
  const timeline = useMemo(() => {
    const logs = (originTask?.logs ?? []).filter((log) => log.content.includes('[分布式'))
    return logs.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  }, [originTask])

  const canCancel = ['queued', 'assigned', 'preparing'].includes(task.status)
  const canRetry = ['failed', 'lost', 'cancelled'].includes(task.status)
  const canTakeover = !['executing', 'syncing_back', 'completed'].includes(task.status)
  const queueInsight = useMemo(
    () => getDistributedTaskQueueInsight({
      distributedTasks,
      executors,
      projectBindings,
      task,
    }),
    [distributedTasks, executors, projectBindings, task],
  )
  const [showBranchDetails, setShowBranchDetails] = useState(task.returnMode === 'branch' || task.returnMode === 'commit')
  const [showPrDetails, setShowPrDetails] = useState(task.returnMode === 'commit')

  const delivery = task.result?.delivery
  const branchDelivery = delivery?.branch
  const pullRequest = delivery?.pullRequest
  const currentRunSessionId = originTask?.executionHistory
    ?.find((run) => run.distributedTaskId === task.id)
    ?.agentSessionId
    ?? originTask?.executionHistory?.find((run) => run.distributedTaskId === task.id)?.opencodeSessionId
    ?? task.result?.agentSessionId
    ?? task.result?.opencodeSessionId
  const agentType = originTask?.agentType
  const executionModel = originTask?.executionModel

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusTag status={task.status} />
          <Badge variant="outline" className="border-zinc-700 text-zinc-400">{task.returnMode}</Badge>
          {agentType ? (
            <Badge className={cn('border-0', agentMeta[agentType].soft)}>
              <RuntimeLabel runtime={agentType} size={12} labelClassName="text-inherit" />
            </Badge>
          ) : null}
          {executionModel ? <Badge variant="outline" className="border-zinc-700 text-zinc-300">{formatExecutionModelLabel(executionModel)}</Badge> : null}
        </div>
        <p className="mt-3 text-base font-medium text-zinc-100">{task.description}</p>
        <p className="mt-1 text-sm text-zinc-500">{tr(language, '来源', 'Origin')}: {originTask?.title || task.originTaskId}</p>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <InfoField label={tr(language, '节点', 'Node')} value={task.executorNodeId || tr(language, '待分配', 'Unassigned')} />
        <InfoField
          label={tr(language, 'Agent 类型', 'Agent Type')}
          value={agentType ? <RuntimeLabel runtime={agentType} size={14} labelClassName="text-zinc-200" /> : '-'}
        />
        <InfoField label={tr(language, '创建时间', 'Created At')} value={formatDate(task.createdAt)} />
        <InfoField label={tr(language, '更新时间', 'Updated At')} value={formatDate(task.updatedAt)} />
        <InfoField label={tr(language, '同步策略', 'Sync Strategy')} value={task.syncBackStrategy} />
        <InfoField label={tr(language, '执行模型', 'Execution Model')} value={executionModel ? formatExecutionModelLabel(executionModel) : tr(language, '默认模型', 'Default model')} />
        {currentRunSessionId && <InfoField label={tr(language, 'Agent 会话', 'Agent Session')} value={currentRunSessionId} />}
        {task.errorMessage && <InfoField label={tr(language, '失败原因', 'Failure Reason')} value={task.errorMessage} isError />}
      </div>

      {task.result && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-sm font-medium text-zinc-100">{tr(language, '执行结果', 'Execution Result')}</p>
          <p className="text-sm text-zinc-300">{task.result.summary}</p>
          <div className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
            <InfoField label={tr(language, '文件变更', 'Changed Files')} value={task.result.filesChanged.join(', ') || tr(language, '无', 'None')} />
            <InfoField label={tr(language, '耗时', 'Duration')} value={`${task.result.durationSec}s`} />
          </div>
          <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100">{tr(language, '交付动作', 'Delivery Actions')}</p>
              <Badge variant="outline" className="border-zinc-800 text-zinc-500">{task.returnMode}</Badge>
            </div>
            {delivery?.syncFailureReason ? (
              <p className="text-xs text-amber-300">{tr(language, '为什么没法同步', 'Why sync is unavailable')}: {delivery.syncFailureReason}</p>
            ) : null}

            {task.returnMode === 'summary' && (
              <p className="text-sm text-zinc-400">{tr(language, 'summary 模式只返回执行摘要，不触发仓库同步动作。', 'Summary mode only returns an execution summary and does not trigger repository sync.')}</p>
            )}

            {task.status === 'queued' && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p className="font-medium">{tr(language, '任务仍在控制面队列中，尚未真正开跑。', 'The task is still in the control-plane queue and has not started yet.')}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <InfoField label={tr(language, '预计节点', 'Expected Node')} value={queueInsight.executor?.name || task.executorNodeId || tr(language, '等待调度', 'Waiting for scheduling')} />
                  <InfoField label={tr(language, '前方任务', 'Tasks Ahead')} value={`${queueInsight.aheadOfTaskCount}`} />
                  <InfoField label={tr(language, '控制面排队', 'Control-plane Queue')} value={`${queueInsight.controlPlaneAheadCount}`} />
                </div>
                <p className="mt-3 text-xs leading-6 text-amber-200/80">{queueInsight.schedulingReasons.slice(0, 4).join(' / ') || tr(language, '等待调度器计算最合适的节点与空闲槽位', 'Waiting for the scheduler to find the best node and an available slot')}</p>
              </div>
            )}

            {branchDelivery && (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
                    onClick={() => setShowBranchDetails((current) => !current)}
                  >
                    <Link2 className="h-4 w-4" />{tr(language, '查看 branch 信息', 'View branch info')}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(formatBranchDraft(branchDelivery.branchName, branchDelivery.repoUrl, branchDelivery.baseBranch))
                        toast.success(tr(language, 'Branch 信息已复制', 'Branch info copied'))
                      } catch {
                        toast.error(tr(language, '复制 branch 信息失败', 'Failed to copy branch info'))
                      }
                    }}
                  >
                    <Copy className="h-4 w-4" />{tr(language, '复制 branch', 'Copy branch')}
                  </button>
                  <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300">
                    <GitBranch className="h-4 w-4" />{branchDelivery.branchName}
                  </div>
                </div>
                {showBranchDetails && (
                  <div className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                    <InfoField label={tr(language, '目标仓库', 'Target Repository')} value={branchDelivery.repoUrl} />
                    <InfoField label="base branch" value={branchDelivery.baseBranch} />
                    <InfoField label={tr(language, '推送状态', 'Push Status')} value={branchDelivery.pushed ? tr(language, '已推送', 'Pushed') : tr(language, '未推送', 'Not pushed')} />
                    <InfoField label={tr(language, '建议下一步', 'Suggested Next Step')} value={branchDelivery.suggestedNextStep} />
                  </div>
                )}
                {branchDelivery.reason && <p className="text-xs text-amber-300">{tr(language, '为什么还没法同步', 'Why sync is unavailable')}: {branchDelivery.reason}</p>}
              </div>
            )}

            {pullRequest && (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {pullRequest.url ? (
                    <a
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
                      href={pullRequest.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GitPullRequest className="h-4 w-4" />{tr(language, '查看 PR', 'View PR')}
                    </a>
                  ) : (
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                      disabled={!pullRequest.ready || busy}
                      onClick={async () => {
                        const response = await onCreatePullRequest(task.id, {
                          title: pullRequest.title,
                          body: pullRequest.description,
                          baseBranch: pullRequest.baseBranch,
                        })

                        if (response?.pullRequest?.url) {
                          window.open(response.pullRequest.url, '_blank', 'noopener,noreferrer')
                        }
                      }}
                    >
                      <GitPullRequest className="h-4 w-4" />{tr(language, '创建 PR', 'Create PR')}
                    </button>
                  )}
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                    disabled={!pullRequest.ready}
                    onClick={async () => {
                      const draft = formatPullRequestDraft(task)
                      if (!draft) {
                        toast.error(pullRequest.reason || tr(language, '当前没有可复制的 PR 文案', 'No PR copy is available right now'))
                        return
                      }

                      try {
                        await navigator.clipboard.writeText(draft)
                        toast.success(tr(language, 'PR 文案已复制', 'PR copy copied'))
                      } catch {
                        toast.error(tr(language, '复制 PR 文案失败', 'Failed to copy PR copy'))
                      }
                    }}
                  >
                    <Copy className="h-4 w-4" />{tr(language, '复制 PR 文案', 'Copy PR Copy')}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                    disabled={!pullRequest.ready}
                    onClick={() => setShowPrDetails((current) => !current)}
                  >
                    <GitPullRequest className="h-4 w-4" />{tr(language, '准备 PR', 'Prepare PR')}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                    disabled={!pullRequest.ready || busy}
                    onClick={async () => {
                      const response = await onRefreshPullRequestStatus(task.id)
                      const nextState = response?.pullRequest?.state
                      if (nextState === 'merged') {
                        toast.success(tr(language, 'PR 已合并，任务已自动完成', 'PR merged and the task was auto-completed'))
                      }
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />{tr(language, '刷新 PR 状态', 'Refresh PR Status')}
                  </button>
                </div>
                {!pullRequest.remoteReady && pullRequest.ready && (
                  <p className="text-xs text-amber-300">{tr(language, '当前只完成了本地 PR 准备；compare branch 还没有推送到远端。', 'Only local PR preparation is complete; the compare branch has not been pushed yet.')}</p>
                )}
                {showPrDetails && (
                  <div className="space-y-2 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3 text-xs text-zinc-400">
                    <InfoField label="PR title" value={pullRequest.title || tr(language, '未生成', 'Not generated')} />
                    <InfoField label="base branch" value={pullRequest.baseBranch} />
                    <InfoField label="compare branch" value={pullRequest.compareBranch || tr(language, '未生成', 'Not generated')} />
                    <InfoField label={tr(language, '目标仓库', 'Target Repository')} value={pullRequest.repoUrl} />
                    {pullRequest.number ? <InfoField label={tr(language, 'PR 编号', 'PR Number')} value={`#${pullRequest.number}`} /> : null}
                    {pullRequest.state ? <InfoField label={tr(language, 'PR 状态', 'PR State')} value={pullRequest.state} /> : null}
                    {pullRequest.url ? <InfoField label={tr(language, 'PR 链接', 'PR URL')} value={pullRequest.url} /> : null}
                    <div>
                      <p className="text-xs text-zinc-500">PR description</p>
                      <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 font-mono text-[11px] text-zinc-300">{pullRequest.description || tr(language, '未生成', 'Not generated')}</pre>
                    </div>
                  </div>
                )}
                {pullRequest.reason && (
                  <p className={cn('text-xs', pullRequest.ready ? 'text-zinc-500' : 'text-amber-300')}>
                    {pullRequest.ready ? `${tr(language, '准备状态提示', 'Readiness Note')}: ${pullRequest.reason}` : `${tr(language, '为什么还没法同步', 'Why sync is unavailable')}: ${pullRequest.reason}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-medium text-zinc-100">{tr(language, '调度', 'Scheduling')}</p>
        <ExecutorSelect
          value={task.executorNodeId || ''}
          options={[
            { value: '', label: tr(language, '选择节点', 'Select node'), statusTone: 'neutral' },
            ...executorOptions.map((opt) => ({
              value: opt.value,
              label: opt.label,
              statusTone: 'neutral',
            })),
          ]}
          placeholder={tr(language, '选择节点', 'Select node')}
          searchPlaceholder={tr(language, '搜索节点', 'Search nodes')}
          emptyText={tr(language, '没有匹配的节点', 'No matching nodes')}
          onChange={(value) => {
            if (!value) return
            onAssignTask(task.id, value)
          }}
        />
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" disabled={busy || !canCancel} onClick={() => onCancelTask(task.id)} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
            <XCircle className="mr-1.5 h-4 w-4" />{tr(language, '取消', 'Cancel')}
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !canRetry} onClick={() => onRetryTask(task.id)} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
            <RotateCcw className="mr-1.5 h-4 w-4" />{tr(language, '重试', 'Retry')}
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !canTakeover} onClick={() => onTakeoverTask(task.id)} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800">
            <SendToBack className="mr-1.5 h-4 w-4" />{tr(language, '接管', 'Take Over')}
          </Button>
        </div>
      </div>

      {timeline.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-100">{tr(language, '时间线', 'Timeline')}</p>
          <div className="space-y-2">
            {timeline.slice(0, 5).map((log) => (
              <div key={log.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <p className="text-xs text-zinc-500">{formatDate(log.createdAt)}</p>
                <p className="mt-1 text-sm text-zinc-300">{log.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
