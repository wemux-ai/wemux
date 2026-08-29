import { useEffect, useMemo, useState } from 'react'
import { Cloud, PauseCircle, PlayCircle, ShieldCheck, Wallet } from 'lucide-react'
import { ExecutionLogCenter } from '../execution-log-center'
import { ExecutionExecutorTerminalPage } from './execution-executor-terminal-page'
import { ExecutorsTab } from './execution-executors-tab'
import { BindingsTab } from './execution-bindings-tab'
import { TabButton, type TabId } from './execution-shared'
import { TasksTab } from './execution-tasks-tab'
import { formatDate } from '../../lib/utils'
import { useTranslation } from '../../lib/i18n/react'
import { useSidebar } from '../ui/sidebar'
import type { ClusterNode, DistributedTask, ExecutionCenter, ExecutorRecord, Project, ProjectBinding, Task } from '@shared/types'
import type { TaskGitPullRequestResult } from '@shared/task-git-ops'
import type { CollaborationWorkspace, ManagedCloudRuntimeStatus, ManagedCloudUsageResponse } from '../../lib/api'
import type { WorkerLocalInstallTarget, WorkerRunMode } from '../../lib/worker-connect-command'

export function ExecutionPage({
  executionCenter,
  projects,
  tasks,
  nodes,
  projectBindings,
  distributedTasks,
  executors,
  managedCloudRuntime,
  managedCloudUsage,
  workspaces,
  defaultWorkspaceId,
  pairingCode,
  connectCommand,
  installerConnectCommand,
  pairingExpiresAt,
  pairingVisibility,
  pairingWorkspaceId,
  pairingWorkspaceIds,
  pairingLabel,
  pairingRunMode,
  pairingInstallTarget,
  pairingBusy,
  autoOpenCreateDialog,
  autoOpenEditExecutorId,
  autoOpenTerminalExecutorId,
  executorLoading,
  busy,
  onPairingVisibilityChange,
  onPairingWorkspaceIdChange,
  onPairingWorkspaceIdsChange,
  onPairingLabelChange,
  onPairingRunModeChange,
  onPairingInstallTargetChange,
  onCreatePairingCode,
  onCreateDialogOpenChange,
  onEditDialogOpenChange,
  onOpenTerminal,
  onCloseTerminal,
  onUpdateExecutor,
  onRefreshExecutor,
  onDeleteExecutor,
  onShutdownExecutor,
  onStartManagedCloudExecutor,
  onCreateDistributedTask,
  onAssignTask,
  onCreatePullRequest,
  onRefreshPullRequestStatus,
  onCancelTask,
  onRetryTask,
  onTakeoverTask,
}: {
  executionCenter: ExecutionCenter
  projects: Project[]
  tasks: Task[]
  nodes: ClusterNode[]
  projectBindings: ProjectBinding[]
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  managedCloudRuntime: ManagedCloudRuntimeStatus | null
  managedCloudUsage: ManagedCloudUsageResponse | null
  workspaces: CollaborationWorkspace[]
  defaultWorkspaceId?: string
  pairingCode: string
  connectCommand: string
  installerConnectCommand: string
  pairingExpiresAt: string
  pairingVisibility: 'private' | 'workspace'
  pairingWorkspaceId: string
  pairingWorkspaceIds: string[]
  pairingLabel: string
  pairingRunMode: WorkerRunMode
  pairingInstallTarget: WorkerLocalInstallTarget
  pairingBusy: boolean
  autoOpenCreateDialog: boolean
  autoOpenEditExecutorId?: string
  autoOpenTerminalExecutorId?: string
  executorLoading: boolean
  busy: boolean
  onPairingVisibilityChange: (value: 'private' | 'workspace') => void
  onPairingWorkspaceIdChange: (value: string) => void
  onPairingWorkspaceIdsChange: (value: string[]) => void
  onPairingLabelChange: (value: string) => void
  onPairingRunModeChange: (value: WorkerRunMode) => void
  onPairingInstallTargetChange: (value: WorkerLocalInstallTarget) => void
  onCreatePairingCode: (payload: { previewExposureMode: 'private' | 'public-ingress' }) => void | Promise<void>
  onCreateDialogOpenChange: (open: boolean) => void
  onEditDialogOpenChange: (executorId?: string) => void
  onOpenTerminal: (executorId: string) => void
  onCloseTerminal: () => void
  onUpdateExecutor: (executorId: string, payload: {
    name?: string
    note?: string
    maxConcurrency?: number
    previewExposureMode?: 'private' | 'public-ingress'
    previewIngressPort?: number
    visibility?: 'private' | 'workspace'
    workspaceId?: string
    workspaceIds?: string[]
  }) => Promise<void>
  onRefreshExecutor: (executorId: string) => Promise<void>
  onDeleteExecutor: (executorId: string) => Promise<void>
  onShutdownExecutor: (executorId: string) => Promise<void>
  onStartManagedCloudExecutor: () => Promise<void>
  onCreateDistributedTask: (payload: { originTaskId: string; projectId: string; description: string; priority?: 'low' | 'medium' | 'high'; timeoutSec?: number; executorNodeId?: string; returnMode?: 'summary' | 'branch' | 'commit'; syncBackStrategy?: 'none' | 'pull-branch'; gitIdentityMode?: 'personal' }) => Promise<unknown>
  onAssignTask: (taskId: string, nodeId: string) => void
  onCreatePullRequest: (taskId: string, payload: { title?: string; body?: string; baseBranch?: string }) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onRefreshPullRequestStatus: (taskId: string) => Promise<{ state: import('@shared/types').AppState; message?: string; pullRequest?: TaskGitPullRequestResult } | undefined>
  onCancelTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onTakeoverTask: (taskId: string, nodeId?: string) => void
}) {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [selectedTaskId, setSelectedTaskId] = useState(distributedTasks[0]?.id ?? '')
  const terminalExecutor = autoOpenTerminalExecutorId
    ? executors.find((executor) => executor.executorId === autoOpenTerminalExecutorId) ?? null
    : null

  const onlineNodes = nodes.filter((node) => node.status === 'online' || node.status === 'busy')
  const onlineExecutors = executors.filter((executor) => executor.status === 'online')
  const managedCloudExecutors = executors.filter((executor) => executor.executorSource === 'managed-cloud' || executor.managedBy === 'vibemux')
  const activeBindings = projectBindings.filter((binding) => binding.isActive)

  useEffect(() => {
    if (!distributedTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(distributedTasks[0]?.id ?? '')
    }
  }, [distributedTasks, selectedTaskId])

  const selectedTask = distributedTasks.find((task) => task.id === selectedTaskId) ?? distributedTasks[0] ?? null
  const selectedOriginTask = tasks.find((task) => task.id === selectedTask?.originTaskId)
  const executorOptions = useMemo(() => {
    const fromNodes = nodes
      .filter((node) => node.status === 'online' || node.status === 'busy')
      .map((node) => ({ value: node.nodeId, label: `${node.name} (${node.status})` }))

    const fromExecutors = executors
      .filter((executor) => executor.status === 'online' || executor.status === 'paired')
      .map((executor) => ({ value: executor.executorId, label: `${executor.name} (${executor.visibility})` }))

    const seen = new Set<string>()
    return [...fromExecutors, ...fromNodes].filter((item) => {
      if (seen.has(item.value)) {
        return false
      }
      seen.add(item.value)
      return true
    })
  }, [executors, nodes])

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: t('execution.tabs.overview', { defaultValue: '总览' }) },
    { id: 'tasks', label: t('execution.tabs.tasks', { defaultValue: '任务' }) },
    { id: 'bindings', label: t('execution.tabs.bindings', { defaultValue: '绑定' }) },
    { id: 'logs', label: t('execution.tabs.logs', { defaultValue: '日志' }) },
  ]

  const managedCloudOverview = useMemo(() => {
    const runtime = managedCloudRuntime
    const usage = managedCloudUsage?.summary ?? null
    const activeLeaseCount = managedCloudExecutors.filter((executor) => executor.managedCloudLifecycle?.state === 'active').length
    const autoStoppedExecutors = managedCloudExecutors
      .filter((executor) => executor.managedCloudLifecycle?.state === 'auto-stopped')
      .sort((left, right) => (
        (right.managedCloudLifecycle?.stoppedAt || '').localeCompare(left.managedCloudLifecycle?.stoppedAt || '')
      ))
    const latestAutoStoppedExecutor = autoStoppedExecutors[0]
    return {
      available: Boolean(runtime?.available),
      // 产品化状态文案：不向用户暴露底层实现（Cloudflare / 内部网关地址等）。
      productMessage: runtime?.available
        ? t('execution.managedCloud.readyMessage', { defaultValue: '官方云节点已就绪，任务可在云端执行，无需本地运行环境。' })
        : t('execution.managedCloud.unavailableMessage', { defaultValue: '官方云节点当前不可用，请稍后重试。' }),
      managedExecutorCount: managedCloudExecutors.length,
      activeLeaseCount,
      latestAutoStoppedExecutor,
      usedComputeHours: usage?.usedComputeHours ?? 0,
      remainingComputeHours: usage?.remainingComputeHours ?? 0,
      usagePercent: (usage?.includedComputeHours ?? 0) > 0
        ? Math.min(100, Math.round(((usage?.usedComputeHours ?? 0) / (usage?.includedComputeHours ?? 1)) * 100))
        : 0,
    }
  }, [managedCloudRuntime, managedCloudUsage, managedCloudExecutors, t])

  if (isMobile && autoOpenTerminalExecutorId) {
    return (
      <ExecutionExecutorTerminalPage
        executor={terminalExecutor}
        loading={executorLoading}
        onBack={onCloseTerminal}
      />
    )
  }

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <div className={isMobile ? 'overflow-x-auto' : ''}>
        <div className="flex w-max min-w-full gap-1 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-1 sm:min-w-0">
        {tabs.map((tab) => (
          <TabButton key={tab.id} id={tab.id} label={tab.label} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} />
        ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 shadow-sm shadow-black/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950">
                <Cloud className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">{t('execution.managedCloud.title', { defaultValue: '官方云节点' })}</p>
                <div className="flex items-center gap-1.5">
                  <span className={managedCloudOverview.available ? 'h-1.5 w-1.5 rounded-full bg-emerald-400' : 'h-1.5 w-1.5 rounded-full bg-zinc-600'} />
                  <p className="text-xs text-zinc-500">
                    {managedCloudOverview.available
                      ? t('execution.managedCloud.available', { defaultValue: '官方云节点运行时可用' })
                      : t('execution.managedCloud.unavailable', { defaultValue: '官方云节点运行时当前不可用' })}
                  </p>
                </div>
              </div>
            </div>
            <p className="max-w-2xl text-sm text-zinc-400">
              {managedCloudOverview.productMessage}
            </p>
          </div>
          <div className="flex items-start">
            {managedCloudExecutors.length === 0 && managedCloudOverview.available ? (
              <button
                type="button"
                onClick={onStartManagedCloudExecutor}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                {t('execution.managedCloud.start', { defaultValue: '启动官方云节点' })}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ManagedCloudMetricCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label={t('execution.managedCloud.status', { defaultValue: '运行状态' })}
            value={managedCloudOverview.available
              ? t('execution.managedCloud.statusReady', { defaultValue: '已就绪' })
              : t('execution.managedCloud.statusUnavailable', { defaultValue: '不可用' })}
            meta={t('execution.managedCloud.hosted', { defaultValue: '云端托管 · 空闲自动回收' })}
          />
          <ManagedCloudMetricCard
            icon={<Cloud className="h-4 w-4" />}
            label={t('execution.managedCloud.executors', { defaultValue: '云端执行节点' })}
            value={String(managedCloudOverview.managedExecutorCount)}
            meta={managedCloudOverview.managedExecutorCount > 0
              ? t('execution.managedCloud.activeNodes', { defaultValue: '{{count}} 个运行中', count: managedCloudOverview.activeLeaseCount })
              : t('execution.managedCloud.notRunning', { defaultValue: '未运行' })}
          />
          <div className="min-w-[180px] rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3">
            <div className="flex items-center gap-2 text-zinc-500">
              <Wallet className="h-4 w-4" />
              <span className="text-xs">{t('execution.managedCloud.usage', { defaultValue: '算力使用' })}</span>
            </div>
            <p className="mt-2 text-lg font-semibold text-zinc-100">{managedCloudOverview.usedComputeHours.toFixed(1)}h</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={managedCloudOverview.usagePercent >= 90 ? 'h-full rounded-full bg-amber-500/80' : 'h-full rounded-full bg-emerald-500/80'}
                style={{ width: `${managedCloudOverview.usagePercent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {t('execution.managedCloud.remaining', { defaultValue: '剩余 {{count}}h', count: managedCloudOverview.remainingComputeHours.toFixed(1) })}
              {' · '}{managedCloudOverview.usagePercent}%
            </p>
          </div>
          <ManagedCloudMetricCard
            icon={<PauseCircle className="h-4 w-4" />}
            label={t('execution.managedCloud.latestStop', { defaultValue: '最近自动停止' })}
            value={managedCloudOverview.latestAutoStoppedExecutor?.name || t('execution.managedCloud.none', { defaultValue: '无' })}
            meta={managedCloudOverview.latestAutoStoppedExecutor?.managedCloudLifecycle?.stoppedAt
              ? formatDate(managedCloudOverview.latestAutoStoppedExecutor.managedCloudLifecycle.stoppedAt)
              : t('execution.managedCloud.noAutoStop', { defaultValue: '暂无自动停止记录' })}
          />
        </div>
        {managedCloudOverview.latestAutoStoppedExecutor?.managedCloudLifecycle?.stopReason ? (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3">
            <p className="text-xs text-amber-200/80">
              {t('execution.managedCloud.latestStopReason', { defaultValue: 'Latest auto-stop reason' })}
            </p>
            <p className="mt-1 text-sm text-amber-50">
              {managedCloudOverview.latestAutoStoppedExecutor.managedCloudLifecycle.stopReason}
            </p>
          </div>
        ) : null}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <ExecutorsTab
            executors={executors}
            distributedTasks={distributedTasks}
            projectBindings={projectBindings}
            managedCloudUsage={managedCloudUsage}
            workspaces={workspaces}
            defaultWorkspaceId={defaultWorkspaceId}
            pairingCode={pairingCode}
            connectCommand={connectCommand}
            installerConnectCommand={installerConnectCommand}
            pairingExpiresAt={pairingExpiresAt}
            pairingVisibility={pairingVisibility}
            pairingWorkspaceId={pairingWorkspaceId}
            pairingWorkspaceIds={pairingWorkspaceIds}
            pairingLabel={pairingLabel}
            pairingRunMode={pairingRunMode}
            pairingInstallTarget={pairingInstallTarget}
            pairingBusy={pairingBusy}
            autoOpenCreateDialog={autoOpenCreateDialog}
            autoOpenEditExecutorId={autoOpenEditExecutorId}
            autoOpenTerminalExecutorId={autoOpenTerminalExecutorId}
            executorLoading={executorLoading}
            busy={busy}
            onPairingVisibilityChange={onPairingVisibilityChange}
            onPairingWorkspaceIdChange={onPairingWorkspaceIdChange}
            onPairingWorkspaceIdsChange={onPairingWorkspaceIdsChange}
            onPairingLabelChange={onPairingLabelChange}
            onPairingRunModeChange={onPairingRunModeChange}
            onPairingInstallTargetChange={onPairingInstallTargetChange}
            onCreatePairingCode={onCreatePairingCode}
            onCreateDialogOpenChange={onCreateDialogOpenChange}
            onEditDialogOpenChange={onEditDialogOpenChange}
            onOpenTerminal={onOpenTerminal}
            onCloseTerminal={onCloseTerminal}
            onUpdateExecutor={onUpdateExecutor}
            onRefreshExecutor={onRefreshExecutor}
            onDeleteExecutor={onDeleteExecutor}
            onShutdownExecutor={onShutdownExecutor}
          />
        </div>
      )}

      {activeTab === 'tasks' && (
        <TasksTab
          distributedTasks={distributedTasks}
          executors={executors}
          projectBindings={projectBindings}
          tasks={tasks}
          projects={projects}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          selectedTask={selectedTask}
          selectedOriginTask={selectedOriginTask}
          executorOptions={executorOptions}
          busy={busy}
          onCreateDistributedTask={onCreateDistributedTask}
          onAssignTask={onAssignTask}
          onCreatePullRequest={onCreatePullRequest}
          onRefreshPullRequestStatus={onRefreshPullRequestStatus}
          onCancelTask={onCancelTask}
          onRetryTask={onRetryTask}
          onTakeoverTask={onTakeoverTask}
        />
      )}

      {activeTab === 'bindings' && <BindingsTab bindings={activeBindings} projects={projects} executors={executors} nodes={nodes} />}

      {activeTab === 'logs' && (
        <ExecutionLogCenter tasks={tasks} distributedTasks={distributedTasks} executors={executors} selectedTaskId={selectedTaskId} />
      )}
    </div>
  )
}

function ManagedCloudMetricCard({
  icon,
  label,
  value,
  meta,
}: {
  icon: React.ReactNode
  label: string
  value: string
  meta: string
}) {
  return (
    <div className="min-w-[180px] rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3">
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{meta}</p>
    </div>
  )
}
