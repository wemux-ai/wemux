import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Copy, Cpu, HardDrive, MemoryStick, Server, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  getExecutorNetworkTypeLabel,
  getExecutorPreviewAccessDescription,
  getExecutorPreviewAccessLabel,
  resolveExecutorNetworkType,
} from './executor-network-type'
import { getExecutorMeshDisplayState, getExecutorMeshRemotePeers, getExecutorMeshStatusBadgeClassName } from './executor-mesh-display'
import { ConnectionPill, InfoField } from './execution-shared'
import { getMeshRemediation } from './mesh-remediation'
import { formatExecutorLatency } from '../../lib/executor-latency'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate } from '../../lib/utils'
import { api, type CollaborationWorkspace, type WorkerDoctorPayload } from '../../lib/api'
import type { DistributedTask, ExecutorRecord, ProjectBinding } from '@shared/types'

const ACTIVE_DISTRIBUTED_TASK_STATUSES = new Set(['assigned', 'preparing', 'executing', 'syncing_back'])
const TELEMETRY_STALE_MS = 60_000
const CPU_WARNING_PERCENT = 70
const CPU_CRITICAL_PERCENT = 85
const MEMORY_WARNING_PERCENT = 75
const MEMORY_CRITICAL_PERCENT = 90
const DISK_WARNING_PERCENT = 80
const DISK_CRITICAL_PERCENT = 90
const MANAGED_RUNTIME_TARGET_LABEL_PREFIX = 'managed-runtime-target:'
const MANAGED_RUNTIME_HOST_MODE_LABEL_PREFIX = 'managed-runtime-host-mode:'

type Severity = 'normal' | 'warning' | 'critical' | 'unknown'
const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

const formatBytes = (bytes?: number) => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return '-'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

const formatPercent = (value?: number, language = 'zh') => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return tr(language, '采样中', 'Sampling')
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)}%`
}

const formatDuration = (seconds?: number, language = 'zh') => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '-'
  }

  if (seconds < 60) {
    return tr(language, `${seconds} 秒`, `${seconds}s`)
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return tr(language, `${hours} 小时 ${minutes} 分`, `${hours}h ${minutes}m`)
  }

  if (minutes > 0 && remainingSeconds > 0) {
    return tr(language, `${minutes} 分 ${remainingSeconds} 秒`, `${minutes}m ${remainingSeconds}s`)
  }

  return tr(language, `${minutes} 分`, `${minutes}m`)
}

const formatDurationFromMs = (value?: number, language = 'zh') => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-'
  }

  return formatDuration(Math.round(value / 1000), language)
}

const calculatePercent = (used?: number, total?: number) => {
  if (typeof used !== 'number' || typeof total !== 'number' || !Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return undefined
  }

  return (used / total) * 100
}

const getSeverity = (value: number | undefined, thresholds: { warning: number; critical: number }): Severity => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'unknown'
  }

  if (value >= thresholds.critical) {
    return 'critical'
  }

  if (value >= thresholds.warning) {
    return 'warning'
  }

  return 'normal'
}

const getSeverityMeta = (severity: Severity, language = 'zh') => {
  const severityMeta: Record<Exclude<Severity, 'unknown'>, { label: string; badge: string; panel: string; value: string }> = {
  normal: {
    label: tr(language, '正常', 'Normal'),
    badge: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    panel: 'border-zinc-800 bg-zinc-900/50',
    value: 'text-zinc-200',
  },
  warning: {
    label: tr(language, '预警', 'Warning'),
    badge: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    panel: 'border-amber-500/20 bg-amber-500/10',
    value: 'text-amber-100',
  },
  critical: {
    label: tr(language, '高危', 'Critical'),
    badge: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
    panel: 'border-rose-500/20 bg-rose-500/10',
    value: 'text-rose-100',
  },
}
  return severity === 'unknown'
    ? {
        label: tr(language, '未知', 'Unknown'),
        badge: 'border-zinc-700 bg-zinc-900 text-zinc-400',
        panel: 'border-zinc-800 bg-zinc-900/50',
        value: 'text-zinc-200',
      }
    : severityMeta[severity]
}

const renderTaskBadges = (taskIds: string[], tone: string, emptyText: string) => {
  if (taskIds.length === 0) {
    return <p className="text-sm text-zinc-500">{emptyText}</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {taskIds.map((taskId) => (
        <Badge key={taskId} className={tone} title={taskId}>
          {taskId.slice(0, 8)}
        </Badge>
      ))}
    </div>
  )
}

const maskSshPubkey = (sshPubkey?: string) => {
  if (!sshPubkey) {
    return null
  }

  const [algorithm = '', body = '', ...commentParts] = sshPubkey.trim().split(/\s+/)
  const comment = commentParts.join(' ')
  const bodyPreview = body.length > 24 ? `${body.slice(0, 10)}••••${body.slice(-10)}` : `${body.slice(0, 6)}••••`

  return {
    algorithm: algorithm || '-',
    bodyPreview,
    comment: comment || null,
  }
}

function DetailSection({ title, description, icon, children }: { title: string; description?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="rounded-lg border-zinc-800 bg-zinc-950/75">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-300">{icon}</div>
          <div>
            <h3 className="text-base font-medium text-zinc-100">{title}</h3>
            {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
          </div>
        </div>
        <div className="mt-4">{children}</div>
      </CardContent>
    </Card>
  )
}

function HighlightField({
  label,
  value,
  severity = 'normal',
}: {
  label: string
  value: string
  severity?: Severity
}) {
  const { language } = useTranslation()
  const meta = getSeverityMeta(severity, language)

  return (
    <div className={`rounded-lg border px-3 py-2 ${meta.panel}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">{label}</p>
        {severity !== 'normal' ? <Badge className={`border ${meta.badge}`}>{meta.label}</Badge> : null}
      </div>
      <p className={`mt-0.5 text-sm ${meta.value}`}>{value}</p>
    </div>
  )
}

const DOCTOR_CATEGORY_ORDER = ['tooling', 'config', 'filesystem', 'network'] as const

const getDoctorCategoryLabel = (category: string, language: string) => {
  if (category === 'tooling') return tr(language, '工具链', 'Tooling')
  if (category === 'config') return tr(language, '配置', 'Configuration')
  if (category === 'filesystem') return tr(language, '文件系统', 'Filesystem')
  if (category === 'network') return tr(language, '网络', 'Network')
  return category
}

const readExecutorManagedRuntimeLabel = (labels: string[], prefix: string) => {
  const match = labels.find((label) => label.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

const getExecutorPublicIp = (executor: Pick<ExecutorRecord, 'previewIngressDetectedPublicIp' | 'previewIngressBaseUrl'>) => {
  const detectedPublicIp = executor.previewIngressDetectedPublicIp?.trim() || ''
  if (detectedPublicIp) {
    return detectedPublicIp
  }

  const previewIngressBaseUrl = executor.previewIngressBaseUrl?.trim() || ''
  if (!previewIngressBaseUrl) {
    return ''
  }

  try {
    return new URL(previewIngressBaseUrl).hostname
  } catch {
    return ''
  }
}

const getExecutorRegionLabel = (executor: Pick<ExecutorRecord, 'labels' | 'platform' | 'machineName'>) => {
  const labels = executor.labels.filter((label) => /region|zone|edge|location|country/i.test(label))
  if (labels[0]) {
    return labels[0].replace(/^(region|zone|edge|location|country)[:=_-]/i, '')
  }

  return executor.platform || executor.machineName || ''
}

const getPreviewReachabilityLabel = (executor: Pick<ExecutorRecord, 'previewExposureMode' | 'previewIngressReachable' | 'previewIngressLastError'>, language: string) => {
  if (executor.previewExposureMode !== 'public-ingress') {
    return tr(language, '内网节点不需要公网探活', 'Internal nodes do not require public ingress probing')
  }

  if (executor.previewIngressReachable) {
    return tr(language, 'reachable', 'reachable')
  }

  return executor.previewIngressLastError || tr(language, 'pending', 'pending')
}

const getExecutorMeshRouteLabel = (executor: Pick<ExecutorRecord, 'presence'>, language: string) => {
  const routeMode = executor.presence?.mesh?.routeMode
  if (routeMode === 'direct') return tr(language, 'P2P 直连', 'P2P Direct')
  if (routeMode === 'relayed') return tr(language, '中继', 'Relayed')
  if (routeMode === 'unknown') return tr(language, '未知', 'Unknown')
  return routeMode || '-'
}

export function ExecutorDetailDialog({
  open,
  executor,
  workspaces,
  distributedTasks,
  projectBindings,
  onOpenChange,
  onRefreshExecutor,
  refreshing,
}: {
  open: boolean
  executor: ExecutorRecord | null
  workspaces: CollaborationWorkspace[]
  distributedTasks: DistributedTask[]
  projectBindings: ProjectBinding[]
  onOpenChange: (open: boolean) => void
  onRefreshExecutor: (executorId: string) => Promise<void>
  refreshing: boolean
}) {
  const { language } = useTranslation()
  const [activeTab, setActiveTab] = useState<'info' | 'doctor' | 'ssh'>('info')
  const [doctor, setDoctor] = useState<WorkerDoctorPayload | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [doctorError, setDoctorError] = useState('')
  const [doctorFetchedAt, setDoctorFetchedAt] = useState('')

  useEffect(() => {
    if (open) {
      setActiveTab('info')
      setDoctor(null)
      setDoctorLoading(false)
      setDoctorError('')
      setDoctorFetchedAt('')
    }
  }, [executor?.executorId, open])

  const loadDoctor = async (force = false) => {
    if (!executor || doctorLoading) {
      return
    }

    if (executor.status !== 'online') {
      setDoctorError(tr(language, '节点离线时无法实时执行自检。', 'Doctor can only run while the executor is online.'))
      return
    }

    if (doctor && !force) {
      return
    }

    setDoctorLoading(true)
    setDoctorError('')

    try {
      const response = await api.runExecutorDoctor(executor.executorId)
      setDoctor(response.doctor)
      setDoctorFetchedAt(new Date().toISOString())
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : tr(language, '节点自检失败。', 'Executor doctor failed.'))
    } finally {
      setDoctorLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !executor || activeTab !== 'doctor' || doctor || doctorLoading) {
      return
    }

    void loadDoctor()
  }, [activeTab, doctor, doctorLoading, executor, language, open])

  if (!executor) {
    return null
  }

  const copySshPubkey = async () => {
    if (!executor.sshPubkey) {
      toast.error(tr(language, '当前节点还没有上报 SSH 公钥', 'This executor has not reported an SSH public key yet'))
      return
    }

    try {
      await navigator.clipboard.writeText(executor.sshPubkey)
      toast.success(tr(language, 'SSH 公钥已复制', 'SSH public key copied'))
    } catch {
      toast.error(tr(language, '复制 SSH 公钥失败', 'Failed to copy SSH public key'))
    }
  }

  const telemetry = executor.presence?.telemetry
  const lastHeartbeatAt = executor.presence?.lastHeartbeatAt || executor.lastSeenAt || executor.createdAt
  const workspaceIds = executor.workspaceIds?.filter((value) => typeof value === 'string' && value.trim().length > 0) ?? (executor.teamId ? [executor.teamId] : [])
  const workspaceNames = workspaceIds.map((workspaceId) => workspaces.find((workspace) => workspace.id === workspaceId)?.name || workspaceId)
  const bindingCount = projectBindings.filter((binding) => binding.nodeId === executor.executorId && binding.isActive).length
  const activeTaskCount = distributedTasks.filter((task) => task.executorNodeId === executor.executorId && ACTIVE_DISTRIBUTED_TASK_STATUSES.has(task.status)).length
  const telemetryAgeMs = telemetry ? Date.now() - new Date(telemetry.capturedAt).getTime() : Number.POSITIVE_INFINITY
  const telemetryStale = !telemetry || executor.status !== 'online' || telemetryAgeMs > TELEMETRY_STALE_MS
  const runningTaskIds = executor.presence?.runningTaskIds ?? []
  const queuedTaskIds = executor.presence?.queuedTaskIds ?? []
  const cpuUsagePercent = telemetry?.cpu.usagePercent
  const memoryUsagePercent = calculatePercent(telemetry?.memory.usedBytes, telemetry?.memory.totalBytes)
  const diskUsagePercent = calculatePercent(telemetry?.disk?.usedBytes, telemetry?.disk?.totalBytes)
  const cpuSeverity = telemetryStale ? 'unknown' : getSeverity(cpuUsagePercent, { warning: CPU_WARNING_PERCENT, critical: CPU_CRITICAL_PERCENT })
  const memorySeverity = telemetryStale ? 'unknown' : getSeverity(memoryUsagePercent, { warning: MEMORY_WARNING_PERCENT, critical: MEMORY_CRITICAL_PERCENT })
  const diskSeverity = telemetryStale ? 'unknown' : getSeverity(diskUsagePercent, { warning: DISK_WARNING_PERCENT, critical: DISK_CRITICAL_PERCENT })
  const resourceAlerts = [
    cpuSeverity === 'critical' ? tr(language, `CPU 利用率 ${formatPercent(cpuUsagePercent, language)}`, `CPU usage ${formatPercent(cpuUsagePercent, language)}`) : cpuSeverity === 'warning' ? tr(language, `CPU 偏高 ${formatPercent(cpuUsagePercent, language)}`, `High CPU ${formatPercent(cpuUsagePercent, language)}`) : null,
    memorySeverity === 'critical' ? tr(language, `内存占用 ${formatPercent(memoryUsagePercent, language)}`, `Memory usage ${formatPercent(memoryUsagePercent, language)}`) : memorySeverity === 'warning' ? tr(language, `内存偏高 ${formatPercent(memoryUsagePercent, language)}`, `High memory ${formatPercent(memoryUsagePercent, language)}`) : null,
    diskSeverity === 'critical' ? tr(language, `磁盘占用 ${formatPercent(diskUsagePercent, language)}`, `Disk usage ${formatPercent(diskUsagePercent, language)}`) : diskSeverity === 'warning' ? tr(language, `磁盘偏高 ${formatPercent(diskUsagePercent, language)}`, `High disk ${formatPercent(diskUsagePercent, language)}`) : null,
  ].filter(Boolean) as string[]
  const hasCriticalResourceAlert = [cpuSeverity, memorySeverity, diskSeverity].includes('critical')
  const resourceAlertTone = hasCriticalResourceAlert ? 'border-rose-500/20 bg-rose-500/10 text-rose-100' : 'border-amber-500/20 bg-amber-500/10 text-amber-100'
  const maskedSshPubkey = maskSshPubkey(executor.sshPubkey)
  const managedRuntimeTarget = readExecutorManagedRuntimeLabel(executor.labels, MANAGED_RUNTIME_TARGET_LABEL_PREFIX)
  const managedRuntimeHostMode = readExecutorManagedRuntimeLabel(executor.labels, MANAGED_RUNTIME_HOST_MODE_LABEL_PREFIX)
  const managedCloudLifecycle = executor.managedCloudLifecycle
  const executorPublicIp = getExecutorPublicIp(executor)
  const executorRegionLabel = getExecutorRegionLabel(executor)
  const networkType = resolveExecutorNetworkType(executor)
  const meshDisplayState = getExecutorMeshDisplayState(executor, language)
  const meshRemotePeers = getExecutorMeshRemotePeers(executor.presence?.mesh)
  const meshRemediation = getMeshRemediation(executor, language)
  const doctorItems = doctor?.items || []
  const doctorGroups = DOCTOR_CATEGORY_ORDER
    .map((category) => ({
      category,
      items: doctorItems.filter((item) => item.category === category),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-[#09090b] text-zinc-100 sm:max-w-[920px]">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle>{executor.name}</DialogTitle>
            <ConnectionPill status={executor.status} />
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">{executor.visibility}</Badge>
          </div>
          <DialogDescription className="text-zinc-500">
            {tr(language, '查看节点配置、资源占用和最近一次系统快照。资源数据通过 worker 心跳轻量上报，不做历史监控落库。', 'View executor configuration, resource usage, and the latest system snapshot. Resource data is reported lightly by worker heartbeats and is not stored as historical monitoring data.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="inline-flex w-full rounded-xl border border-zinc-800 bg-zinc-950/70 p-1">
            {([
              { id: 'info', label: tr(language, '信息', 'Info') },
              { id: 'doctor', label: tr(language, '自检', 'Doctor') },
              { id: 'ssh', label: tr(language, 'SSH 公钥', 'SSH Public Key') },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'info' ? (
            <>
              {telemetryStale ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">{telemetry ? tr(language, '当前展示的是最近一次快照', 'Showing the latest snapshot') : tr(language, '当前还没有资源快照', 'No resource snapshot yet')}</p>
                      <p className="mt-1 text-amber-200/80">
                        {telemetry
                          ? tr(language, `最后采样时间 ${formatDate(telemetry.capturedAt)}。节点离线或心跳延迟时，资源状态不会继续刷新。`, `Last sampled at ${formatDate(telemetry.capturedAt)}. Resource state stops refreshing when the executor is offline or heartbeats are delayed.`)
                          : tr(language, '节点通常会在下一次心跳后补齐 CPU、内存、磁盘与系统信息。', 'CPU, memory, disk, and system info usually appear after the next heartbeat.')}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              {!telemetryStale && resourceAlerts.length > 0 ? (
                <div className={`rounded-xl border px-4 py-3 text-sm ${resourceAlertTone}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">{hasCriticalResourceAlert ? tr(language, '检测到资源高危', 'Critical resource alert detected') : tr(language, '检测到资源预警', 'Resource warning detected')}</p>
                      <p className="mt-1 opacity-90">{resourceAlerts.join('，')}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <DetailSection title={tr(language, '基础配置', 'Basic Configuration')} description={tr(language, '节点静态配置与接入信息', 'Static executor configuration and access information')} icon={<Server className="h-4 w-4" />}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoField label={tr(language, '节点 ID', 'Executor ID')} value={executor.executorId} />
                    <InfoField label={tr(language, '机器名', 'Machine Name')} value={executor.machineName} />
                    <InfoField label={tr(language, '网络类型', 'Network Type')} value={getExecutorNetworkTypeLabel(networkType, language)} />
                    <InfoField label={tr(language, '公网 IP', 'Public IP')} value={executorPublicIp || '-'} />
                    <InfoField label={tr(language, '区域', 'Region')} value={executorRegionLabel || '-'} />
                    <InfoField label={tr(language, '机器 ID', 'Machine ID')} value={executor.machineId} />
                    <InfoField label={tr(language, '共享组织', 'Shared Organizations')} value={executor.visibility === 'team' ? (workspaceNames.join(' / ') || '-') : tr(language, '仅本人可用', 'Private only')} />
                    <InfoField label={tr(language, '并发槽位', 'Concurrency Slots')} value={String(executor.maxConcurrency)} />
                    <InfoField label={tr(language, '项目绑定', 'Project Bindings')} value={tr(language, `${bindingCount} 个活跃绑定`, `${bindingCount} active bindings`)} />
                    <InfoField label={tr(language, '工作区根目录', 'Workspace Root')} value={executor.workspaceRoot} />
                    <InfoField label={tr(language, 'Worker 版本', 'Worker Version')} value={executor.version || telemetry?.system.workerVersion || '-'} />
                    {executor.executorSource === 'managed-cloud' ? (
                      <InfoField
                        label={tr(language, '托管宿主', 'Managed Host')}
                        value={managedRuntimeTarget || (managedRuntimeHostMode === 'control-plane-host'
                          ? tr(language, '控制面宿主机', 'Control-plane host')
                          : tr(language, '未分配', 'Unassigned'))}
                      />
                    ) : null}
                    {executor.executorSource === 'managed-cloud' ? (
                      <InfoField
                        label={tr(language, '隔离落点', 'Isolation Placement')}
                        value={managedRuntimeHostMode === 'remote-docker-host'
                          ? tr(language, '远程运行宿主', 'Remote runtime host')
                          : managedRuntimeHostMode === 'remote-boxlite-host'
                          ? tr(language, '远程 BoxLite 宿主', 'Remote BoxLite host')
                          : managedRuntimeHostMode === 'control-plane-host'
                          ? tr(language, '控制面宿主机', 'Control-plane host')
                          : '-'}
                      />
                    ) : null}
                  </div>
                  {executor.note ? (
                    <div className="mt-3 rounded-lg bg-zinc-900/50 px-3 py-2">
                      <p className="text-xs text-zinc-500">{tr(language, '备注', 'Note')}</p>
                      <p className="mt-0.5 text-sm text-zinc-200">{executor.note}</p>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {executor.capabilities.length > 0 ? executor.capabilities.map((capability) => (
                      <Badge key={capability} variant="outline" className="border-zinc-700 text-zinc-400">
                        {capability}
                      </Badge>
                    )) : <span className="text-sm text-zinc-500">{tr(language, '未声明 capability', 'No capability declared')}</span>}
                  </div>
                </DetailSection>

                <DetailSection title={tr(language, '运行状态', 'Runtime Status')} description={tr(language, '当前连接、心跳与任务分布', 'Current connection, heartbeats, and task distribution')} icon={<Workflow className="h-4 w-4" />}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoField label={tr(language, '最近心跳', 'Last Heartbeat')} value={formatDate(lastHeartbeatAt)} />
                    <InfoField label={tr(language, '节点延迟', 'Latency')} value={formatExecutorLatency(executor.presence?.latency)} />
                    <InfoField label={tr(language, '最近采样', 'Last Sample')} value={telemetry ? formatDate(telemetry.capturedAt) : tr(language, '未上报', 'Not reported')} />
                    <InfoField label={tr(language, '运行中任务', 'Running Tasks')} value={tr(language, `${runningTaskIds.length} 个`, `${runningTaskIds.length}`)} />
                    <InfoField label={tr(language, '排队任务', 'Queued Tasks')} value={tr(language, `${queuedTaskIds.length} 个`, `${queuedTaskIds.length}`)} />
                    <InfoField label={tr(language, '活跃任务总数', 'Active Tasks')} value={tr(language, `${activeTaskCount} 个`, `${activeTaskCount}`)} />
                    {executor.executorSource === 'managed-cloud' ? (
                      <InfoField
                        label={tr(language, '托管生命周期', 'Managed Lifecycle')}
                        value={managedCloudLifecycle?.state === 'active'
                          ? tr(language, '运行中', 'Active')
                          : managedCloudLifecycle?.state === 'auto-stopped'
                            ? tr(language, '自动停止', 'Auto-stopped')
                            : managedCloudLifecycle?.state === 'stopped'
                              ? tr(language, '已停止', 'Stopped')
                              : '-'}
                      />
                    ) : null}
                    {executor.executorSource === 'managed-cloud' ? (
                      <InfoField
                        label={tr(language, '最后活动', 'Last Activity')}
                        value={managedCloudLifecycle?.lastActivityAt ? formatDate(managedCloudLifecycle.lastActivityAt) : '-'}
                      />
                    ) : null}
                    {executor.executorSource === 'managed-cloud' ? (
                      <InfoField
                        label={tr(language, '空闲时长', 'Idle Duration')}
                        value={formatDurationFromMs(managedCloudLifecycle?.idleDurationMs, language)}
                      />
                    ) : null}
                    {executor.executorSource === 'managed-cloud' ? (
                      <InfoField
                        label={tr(language, '最近停止', 'Last Stop')}
                        value={managedCloudLifecycle?.stoppedAt ? formatDate(managedCloudLifecycle.stoppedAt) : '-'}
                      />
                    ) : null}
                  </div>
                  {executor.executorSource === 'managed-cloud' && managedCloudLifecycle?.stopReason ? (
                    <div className="mt-3 rounded-lg bg-zinc-900/50 px-3 py-3">
                      <p className="text-xs text-zinc-500">{tr(language, '最近停机原因', 'Latest Stop Reason')}</p>
                      <p className="mt-1 text-sm text-zinc-200">{managedCloudLifecycle.stopReason}</p>
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-zinc-900/50 px-3 py-3">
                      <p className="text-xs text-zinc-500">{tr(language, '运行任务 ID', 'Running Task IDs')}</p>
                      <div className="mt-2">{renderTaskBadges(runningTaskIds, 'border border-sky-500/30 bg-sky-500/10 text-sky-300', tr(language, '当前没有运行中的任务', 'No running tasks right now'))}</div>
                    </div>
                    <div className="rounded-lg bg-zinc-900/50 px-3 py-3">
                      <p className="text-xs text-zinc-500">{tr(language, '排队任务 ID', 'Queued Task IDs')}</p>
                      <div className="mt-2">{renderTaskBadges(queuedTaskIds, 'border border-amber-500/30 bg-amber-500/10 text-amber-300', tr(language, '当前没有排队任务', 'No queued tasks right now'))}</div>
                    </div>
                  </div>
                </DetailSection>
              </div>

              <DetailSection
                title={tr(language, 'Preview 访问', 'Preview Access')}
                description={tr(language, '这里展示这台节点是以内网还是公网方式接入，以及当前预览访问链路。', 'Shows whether this node is treated as internal or public, and how preview traffic currently reaches it.')}
                icon={<Server className="h-4 w-4" />}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoField label={tr(language, '节点网络类型', 'Node Network Type')} value={getExecutorNetworkTypeLabel(networkType, language)} />
                  <InfoField label={tr(language, '预览接入方式（高级）', 'Preview Access Mode (Advanced)')} value={getExecutorPreviewAccessLabel(networkType, language)} />
                  <InfoField label={tr(language, '公网回源地址', 'Public Ingress Address')} value={executor.previewIngressBaseUrl || '-'} />
                  <InfoField
                    label={tr(language, '公网探活结果', 'Public Reachability')}
                    value={getPreviewReachabilityLabel(executor, language)}
                    isError={executor.previewExposureMode === 'public-ingress' && !executor.previewIngressReachable && Boolean(executor.previewIngressLastError)}
                  />
                  <InfoField label={tr(language, '探测公网 IP', 'Detected Public IP')} value={executor.previewIngressDetectedPublicIp || '-'} />
                  <InfoField label={tr(language, '预览端口', 'Preview Ingress Port')} value={executor.previewIngressPort ? String(executor.previewIngressPort) : '-'} />
                  <InfoField label={tr(language, '最近探测', 'Last Reachability Check')} value={executor.previewIngressLastCheckedAt ? formatDate(executor.previewIngressLastCheckedAt) : '-'} />
                  <InfoField label={tr(language, '失败原因', 'Last Error')} value={executor.previewIngressLastError || '-'} isError={Boolean(executor.previewIngressLastError)} />
                </div>
                <div className="mt-3 rounded-lg bg-zinc-900/50 px-3 py-3">
                  <p className="text-xs text-zinc-500">{tr(language, '链路说明', 'Routing Notes')}</p>
                  <p className="mt-1 text-sm text-zinc-200">
                    {getExecutorPreviewAccessDescription(networkType, language)}
                  </p>
                </div>
              </DetailSection>

              <DetailSection
                title={tr(language, 'Wemux Mesh', 'Wemux Mesh')}
                description={tr(language, '这里展示节点当前的 Wemux Mesh 组网状态，用来判断节点之间是否已经具备私有网络连接能力。', 'Shows the current Wemux Mesh state so you can tell whether nodes are ready for private network connectivity.')}
                icon={<Workflow className="h-4 w-4" />}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn('border', getExecutorMeshStatusBadgeClassName(meshDisplayState))}>
                    {meshDisplayState.detailLabel}
                  </Badge>
                  {executor.presence?.mesh?.errorMessage ? (
                    <Badge className="border border-rose-500/20 bg-rose-500/10 text-rose-300">
                      {tr(language, '存在错误', 'Has Error')}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 rounded-lg border border-zinc-800/70 bg-zinc-900/50 px-3 py-3">
                  <p className="text-sm text-zinc-200">{meshDisplayState.description}</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoField label={tr(language, 'Mesh IP', 'Mesh IP')} value={executor.presence?.mesh?.meshIpv4 || '-'} />
                  <InfoField label={tr(language, '路由模式', 'Route Mode')} value={getExecutorMeshRouteLabel(executor, language)} />
                  <InfoField label={tr(language, '远端节点', 'Remote Peers')} value={meshDisplayState.peerCountLabel} />
                  <InfoField label={tr(language, 'NAT 类型', 'NAT Type')} value={executor.presence?.mesh?.natType || '-'} />
                  <InfoField label={tr(language, 'Mesh 主机名', 'Mesh Hostname')} value={executor.presence?.mesh?.meshHostname || '-'} />
                  <InfoField label={tr(language, '最近上报', 'Last Mesh Report')} value={executor.presence?.mesh?.reportedAt ? formatDate(executor.presence.mesh.reportedAt) : '-'} />
                </div>
                {meshRemotePeers.length ? (
                  <div className="mt-3 rounded-lg bg-zinc-900/50 px-3 py-3">
                    <p className="text-xs text-zinc-500">{tr(language, '已观测远端节点', 'Observed Remote Peers')}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {meshRemotePeers.slice(0, 8).map((peer) => (
                        <Badge key={peer.executorId || peer.meshNodeId || peer.meshIpv4 || JSON.stringify(peer)} variant="outline" className="border-zinc-700 text-zinc-300">
                          {peer.executorId || peer.meshIpv4 || peer.meshNodeId || tr(language, '未知节点', 'Unknown Peer')}
                        </Badge>
                      ))}
                      {meshRemotePeers.length > 8 ? (
                        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                          +{meshRemotePeers.length - 8}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {executor.presence?.mesh?.errorMessage ? (
                  <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                    {executor.presence.mesh.errorMessage.replace(/EasyTier/g, 'Wemux Mesh')}
                  </div>
                ) : null}
                {meshRemediation ? (
                  <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{meshRemediation.title}</p>
                        <p className="mt-1 text-xs font-medium leading-5 text-zinc-100">
                          {meshRemediation.description}
                        </p>
                        {meshRemediation.note ? (
                          <p className="mt-1 text-xs leading-5 text-sky-100/90">{meshRemediation.note}</p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-sky-500/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20 hover:text-white"
                        onClick={() => {
                          void navigator.clipboard.writeText(meshRemediation.command)
                          toast.success(tr(language, '命令已复制', 'Command copied'))
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {tr(language, '复制终端命令', 'Copy Terminal Command')}
                      </Button>
                    </div>
                    <p className="mt-3 break-all rounded-md bg-black/30 px-3 py-2 font-mono text-xs text-sky-100">
                      {meshRemediation.command}
                    </p>
                  </div>
                ) : null}
              </DetailSection>

              <div className="grid gap-4 lg:grid-cols-3">
                <DetailSection title="CPU" description={tr(language, '核心数、利用率与平均负载', 'Core count, utilization, and load average')} icon={<Cpu className="h-4 w-4" />}>
                  <div className="grid gap-3">
                    <HighlightField label={tr(language, '利用率', 'Usage')} value={formatPercent(cpuUsagePercent, language)} severity={cpuSeverity} />
                    <HighlightField label={tr(language, '核心数', 'Cores')} value={telemetry ? tr(language, `${telemetry.cpu.coreCount} 核`, `${telemetry.cpu.coreCount} cores`) : '-'} />
                    <HighlightField label={tr(language, '主频', 'Clock Speed')} value={telemetry?.cpu.averageSpeedMhz ? `${telemetry.cpu.averageSpeedMhz} MHz` : '-'} />
                    <HighlightField label={tr(language, '负载均值', 'Load Average')} value={telemetry?.cpu.loadAverage ? telemetry.cpu.loadAverage.join(' / ') : '-'} />
                    <HighlightField label={tr(language, 'CPU 型号', 'CPU Model')} value={telemetry?.cpu.model || tr(language, '未上报', 'Not reported')} />
                  </div>
                </DetailSection>

                <DetailSection title={tr(language, '内存', 'Memory')} description={tr(language, '系统总量与当前占用', 'Total system memory and current usage')} icon={<MemoryStick className="h-4 w-4" />}>
                  <div className="grid gap-3">
                    <HighlightField label={tr(language, '总内存', 'Total Memory')} value={formatBytes(telemetry?.memory.totalBytes)} />
                    <HighlightField label={tr(language, '已使用', 'Used')} value={formatBytes(telemetry?.memory.usedBytes)} severity={memorySeverity} />
                    <HighlightField label={tr(language, '剩余', 'Free')} value={formatBytes(telemetry?.memory.freeBytes)} />
                    <HighlightField
                      label={tr(language, '使用率', 'Usage')}
                      value={telemetry?.memory.totalBytes ? formatPercent(memoryUsagePercent, language) : '-'}
                      severity={memorySeverity}
                    />
                  </div>
                </DetailSection>

                <DetailSection title={tr(language, '磁盘', 'Disk')} description={tr(language, '工作区所在磁盘容量', 'Disk capacity for the workspace volume')} icon={<HardDrive className="h-4 w-4" />}>
                  <div className="grid gap-3">
                    <HighlightField label={tr(language, '探测路径', 'Probe Path')} value={telemetry?.disk?.path || executor.workspaceRoot} />
                    <HighlightField label={tr(language, '总空间', 'Total Space')} value={formatBytes(telemetry?.disk?.totalBytes)} />
                    <HighlightField label={tr(language, '已使用', 'Used')} value={formatBytes(telemetry?.disk?.usedBytes)} severity={diskSeverity} />
                    <HighlightField label={tr(language, '剩余', 'Free')} value={formatBytes(telemetry?.disk?.freeBytes)} />
                    <HighlightField label={tr(language, '可用空间', 'Available')} value={formatBytes(telemetry?.disk?.availableBytes)} />
                    <HighlightField label={tr(language, '使用率', 'Usage')} value={telemetry?.disk?.totalBytes ? formatPercent(diskUsagePercent, language) : '-'} severity={diskSeverity} />
                  </div>
                </DetailSection>
              </div>

              <DetailSection title={tr(language, '系统信息', 'System Information')} description={tr(language, '宿主机与 worker 运行环境', 'Host machine and worker runtime environment')} icon={<Server className="h-4 w-4" />}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <InfoField label={tr(language, '平台', 'Platform')} value={telemetry?.system.platform || executor.platform || '-'} />
                  <InfoField label={tr(language, '架构', 'Architecture')} value={telemetry?.system.arch || '-'} />
                  <InfoField label={tr(language, '主机名', 'Hostname')} value={telemetry?.system.hostname || executor.machineName} />
                  <InfoField label={tr(language, '系统版本', 'System Version')} value={telemetry?.system.version || telemetry?.system.release || executor.platform || '-'} />
                  <InfoField label="Node.js" value={telemetry?.system.nodeVersion || '-'} />
                  <InfoField label={tr(language, 'Worker 进程运行时长', 'Worker Process Uptime')} value={formatDuration(telemetry?.system.processUptimeSec, language)} />
                  <InfoField label={tr(language, '系统运行时长', 'System Uptime')} value={formatDuration(telemetry?.system.systemUptimeSec, language)} />
                  <InfoField label={tr(language, '节点创建时间', 'Executor Created At')} value={formatDate(executor.createdAt)} />
                  <InfoField label={tr(language, '最近在线时间', 'Last Online')} value={formatDate(executor.lastSeenAt || lastHeartbeatAt)} />
                </div>
              </DetailSection>
            </>
          ) : activeTab === 'doctor' ? (
            <div className="space-y-4">
              <DetailSection
                title={tr(language, 'Worker 自检', 'Worker Doctor')}
                description={tr(language, '查看当前 worker 上报的完整自检结果。', 'View the full self-check payload reported by this worker.')}
                icon={<Workflow className="h-4 w-4" />}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-3">
                    <InfoField
                      label={tr(language, '状态', 'Status')}
                      value={
                        doctor?.summary
                          ? (doctor.summary.ok ? tr(language, '通过', 'Passed') : tr(language, '发现问题', 'Issues found'))
                          : doctorLoading
                            ? tr(language, '执行中', 'Running')
                            : '-'
                      }
                    />
                    <InfoField label={tr(language, '通过', 'Passed')} value={String(doctor?.summary?.passed ?? 0)} />
                    <InfoField label={tr(language, '失败', 'Failed')} value={String(doctor?.summary?.failed ?? 0)} />
                    <InfoField label={tr(language, '总项数', 'Total')} value={String(doctor?.summary?.total ?? 0)} />
                    <InfoField label={tr(language, '请求时间', 'Fetched At')} value={doctorFetchedAt ? formatDate(doctorFetchedAt) : '-'} />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={doctorLoading || executor.status !== 'online'}
                    onClick={() => void loadDoctor(true)}
                    className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                  >
                    {doctorLoading ? tr(language, '自检中...', 'Running...') : tr(language, '重新自检', 'Run Again')}
                  </Button>
                </div>

                {doctorError ? (
                  <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                    {doctorError}
                  </div>
                ) : null}

                {doctor ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoField label={tr(language, '控制面探测', 'Control Plane Probe')} value={doctor.cloudProbe?.message || '-'} isError={doctor.cloudProbe ? !doctor.cloudProbe.ok : false} />
                      <InfoField label={tr(language, '官网探测', 'Official Site Probe')} value={doctor.officialSiteProbe?.message || '-'} isError={doctor.officialSiteProbe ? !doctor.officialSiteProbe.ok : false} />
                    </div>

                    {doctorGroups.map((group) => (
                      <div key={group.category} className="space-y-3">
                        <div className="text-sm font-medium text-zinc-300">{getDoctorCategoryLabel(group.category, language)}</div>
                        <div className="grid gap-3">
                          {group.items.map((item) => (
                            <div key={item.id} className={cn(
                              'rounded-xl border px-4 py-3',
                              item.ok
                                ? 'border-emerald-500/20 bg-emerald-500/10'
                                : 'border-rose-500/20 bg-rose-500/10',
                            )}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-zinc-100">{item.label}</div>
                                  <div className={cn('mt-1 text-sm', item.ok ? 'text-emerald-100/90' : 'text-rose-100/90')}>{item.detail}</div>
                                  {item.hint ? <div className="mt-2 text-xs text-zinc-400">{item.hint}</div> : null}
                                </div>
                                <Badge className={cn(
                                  'border',
                                  item.ok
                                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                    : 'border-rose-500/20 bg-rose-500/10 text-rose-300',
                                )}>
                                  {item.ok ? tr(language, '通过', 'Pass') : tr(language, '失败', 'Fail')}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <details className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                      <summary className="cursor-pointer text-sm font-medium text-zinc-200">{tr(language, '查看原始上报', 'View Raw Payload')}</summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-zinc-400">{JSON.stringify(doctor, null, 2)}</pre>
                    </details>
                  </div>
                ) : doctorLoading ? (
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
                    {tr(language, '正在请求 worker 自检结果...', 'Requesting doctor results from the worker...')}
                  </div>
                ) : null}
              </DetailSection>
            </div>
          ) : (
            <DetailSection title={tr(language, 'SSH 公钥', 'SSH Public Key')} description={tr(language, '公钥与节点信息分开展示，默认只给脱敏预览。', 'SSH public key is separated from node info and shown as a masked preview by default.')} icon={<Server className="h-4 w-4" />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoField label={tr(language, '上报状态', 'Report Status')} value={executor.sshPubkey ? tr(language, '已上报', 'Reported') : tr(language, '未上报', 'Not reported')} />
                <InfoField label={tr(language, '算法', 'Algorithm')} value={maskedSshPubkey?.algorithm || '-'} />
              </div>
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3">
                <p className="text-xs text-zinc-500">{tr(language, '脱敏预览', 'Masked Preview')}</p>
                <p className="mt-2 font-mono text-sm text-zinc-200">{maskedSshPubkey?.bodyPreview || tr(language, '未上报', 'Not reported')}</p>
                {maskedSshPubkey?.comment ? (
                  <p className="mt-2 text-xs text-zinc-500">{tr(language, '备注字段', 'Comment')}: {maskedSshPubkey.comment}</p>
                ) : null}
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-sm text-zinc-400">
                {tr(language, '这里不明文展示完整公钥；需要接入时直接点击复制。', 'The full SSH public key is not shown in plain text here; use copy when you need it.')}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!executor.sshPubkey}
                  onClick={() => void copySshPubkey()}
                  className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {tr(language, '复制公钥', 'Copy Public Key')}
                </Button>
              </div>
            </DetailSection>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={executor.status !== 'online' || refreshing}
            onClick={() => void onRefreshExecutor(executor.executorId)}
            className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50"
            title={executor.status !== 'online' ? tr(language, '离线节点无法立即刷新', 'Offline executors cannot be refreshed immediately') : tr(language, '向节点发起一次实时资源采样', 'Request a live resource sample from the executor')}
          >
            {refreshing ? tr(language, '刷新中...', 'Refreshing...') : tr(language, '立即刷新', 'Refresh Now')}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50">
            {tr(language, '关闭', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
