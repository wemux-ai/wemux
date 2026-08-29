import type { ReactNode } from 'react'
import { Activity, AlertTriangle, FolderKanban, HeartPulse, Timer, Workflow } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { useTranslation } from '../../lib/i18n/react'
import { formatDate, formatExecutionModelLabel } from '../../lib/utils'
import { RuntimeLabel } from '../runtime/runtime-icons'
import type { AgentHeartbeatRecord, AgentTaskRecord } from '../../lib/api'
import type { AgentType } from '@shared/types'

export type CustomAgentAuditEntry = {
  sessionId: string
  taskId: string
  taskTitle: string
  projectId: string
  projectName: string
  workspaceId: string
  invocationMode: 'mention' | 'delegate' | 'unknown'
  sessionKind: string
  sessionRole: string
  agentType: string
  status: string
  currentStep: string
  createdAt: string
  lastActiveAt: string
  executionModel: string
  mountedSkillNames: string[]
  mountedMcpServerNames: string[]
}

export type CustomAgentAuditSummary = {
  totalSessions: number
  activeSessions: number
  runningSessions: number
  mentionSessions: number
  delegateSessions: number
  projectCount: number
  workspaceCount: number
  recentSkillNames: string[]
  recentMcpServerNames: string[]
}

type DistributionRow = {
  label: string
  value: number
  description: string
}

const runningStatusTone: Record<string, string> = {
  idle: 'border-zinc-800 bg-zinc-950 text-zinc-400',
  thinking: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
  executing: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  waiting: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
  complete: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  error: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
}

const taskStatusTone: Record<string, string> = {
  pending: 'border-zinc-800 bg-zinc-950 text-zinc-400',
  running: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  completed: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  failed: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
}

const parseTimestamp = (value: string) => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const formatRate = (value: number) => `${Math.round(value * 100)}%`

const formatDuration = (value: number, t: (key: string, options?: Record<string, unknown>) => string) => {
  if (!Number.isFinite(value) || value <= 0) {
    return t('agents.custom.activity.none')
  }

  const minutes = Math.round(value / 60000)
  if (minutes < 1) {
    return t('agents.custom.activity.duration.ltMinute')
  }

  if (minutes < 60) {
    return t('agents.custom.activity.duration.minutes', { count: minutes })
  }

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0
    ? t('agents.custom.activity.duration.hoursMinutes', { hours, minutes: restMinutes })
    : t('agents.custom.activity.duration.hours', { hours })
}

const buildDistribution = (items: string[]) => {
  const counts = items.reduce<Map<string, number>>((map, item) => {
    const key = item.trim()
    if (!key) {
      return map
    }

    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map())

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
}

export function CustomAgentActivityPanel({
  selectedAgentId,
  tasks,
  heartbeats,
  auditEntries,
  auditSummary,
}: {
  selectedAgentId: string
  tasks: AgentTaskRecord[]
  heartbeats: AgentHeartbeatRecord[]
  auditEntries: CustomAgentAuditEntry[]
  auditSummary: CustomAgentAuditSummary
}) {
  const { t } = useTranslation()
  const invocationModeLabel: Record<CustomAgentAuditEntry['invocationMode'], string> = {
    mention: t('agents.custom.activity.invocation.mention'),
    delegate: t('agents.custom.activity.invocation.delegate'),
    unknown: t('agents.custom.activity.invocation.unknown'),
  }
  const sessionKindLabel: Record<'primary' | 'subagent', string> = {
    primary: t('agents.custom.activity.sessionKind.primary'),
    subagent: t('agents.custom.activity.sessionKind.subagent'),
  }
  const sessionRoleLabel: Record<string, string> = {
    general: t('agents.custom.activity.sessionRole.general'),
    tester: t('agents.custom.activity.sessionRole.tester'),
    'doc-writer': t('agents.custom.activity.sessionRole.docWriter'),
    reviewer: t('agents.custom.activity.sessionRole.reviewer'),
    researcher: t('agents.custom.activity.sessionRole.researcher'),
  }
  const latestSessions = auditEntries.slice(0, 10)
  const finishedSessions = auditEntries.filter((entry) => entry.status === 'complete' || entry.status === 'error')
  const successSessions = finishedSessions.filter((entry) => entry.status === 'complete')
  const failedSessions = finishedSessions.filter((entry) => entry.status === 'error')
  const successRate = finishedSessions.length > 0 ? successSessions.length / finishedSessions.length : 0
  const failureRate = finishedSessions.length > 0 ? failedSessions.length / finishedSessions.length : 0
  const averageDurationMs = auditEntries.length > 0
    ? auditEntries.reduce((total, entry) => {
      const duration = Math.max(0, parseTimestamp(entry.lastActiveAt) - parseTimestamp(entry.createdAt))
      return total + duration
    }, 0) / auditEntries.length
    : 0
  const errorEntries = auditEntries
    .filter((entry) => entry.status === 'error')
    .slice(0, 5)
  const projectDistribution = buildDistribution(auditEntries.map((entry) => entry.projectName)).slice(0, 5)
  const workspaceDistribution = buildDistribution(auditEntries.map((entry) => entry.workspaceId)).slice(0, 5)
  const modelDistribution = buildDistribution(
    auditEntries
      .map((entry) => formatExecutionModelLabel(entry.executionModel))
      .filter((value) => value !== t('agents.custom.activity.unset')),
  ).slice(0, 5)
  const roleDistribution = buildDistribution(
    auditEntries.map((entry) => {
      if (entry.sessionKind === 'subagent') {
        return sessionRoleLabel[entry.sessionRole] ?? entry.sessionRole
      }

      return sessionKindLabel.primary
    }),
  ).slice(0, 5)
  const taskStatusDistribution = buildDistribution(tasks.map((task) => task.status)).map(({ label, value }) => ({
    label,
    value,
    description: label === 'completed'
      ? t('agents.custom.activity.taskStatus.completed')
      : label === 'failed'
        ? t('agents.custom.activity.taskStatus.failed')
        : label === 'running'
          ? t('agents.custom.activity.taskStatus.running')
          : t('agents.custom.activity.taskStatus.pending'),
  }))
  const latestHeartbeat = heartbeats[0] ?? null
  const metricCards = [
    { label: t('agents.custom.activity.metrics.totalRuns'), value: String(auditSummary.totalSessions), icon: <Workflow className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.successRate'), value: formatRate(successRate), icon: <Activity className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.failureRate'), value: formatRate(failureRate), icon: <AlertTriangle className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.averageDuration'), value: formatDuration(averageDurationMs, t), icon: <Timer className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.running'), value: String(auditSummary.runningSessions), icon: <Workflow className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.projectCoverage'), value: String(auditSummary.projectCount), icon: <FolderKanban className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.workspaceCoverage'), value: String(auditSummary.workspaceCount), icon: <FolderKanban className="h-4 w-4" /> },
    { label: t('agents.custom.activity.metrics.latestHeartbeat'), value: latestHeartbeat ? latestHeartbeat.status : t('agents.custom.activity.none'), icon: <HeartPulse className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4 2xl:grid-cols-8">
        {metricCards.map((item) => (
          <ActivityMetricCard key={item.label} label={item.label} value={item.value} icon={item.icon} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="text-base">{t('agents.custom.activity.recentRuns')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {selectedAgentId && latestSessions.length > 0 ? (
              latestSessions.map((entry) => {
                const durationLabel = formatDuration(Math.max(0, parseTimestamp(entry.lastActiveAt) - parseTimestamp(entry.createdAt)), t)
                return (
                  <div key={entry.sessionId} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">{entry.taskTitle}</p>
                        <p className="mt-1 text-xs text-zinc-500">{entry.projectName} · {t('agents.custom.activity.workspaceLabel')} {entry.workspaceId}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge className="border-zinc-800 bg-zinc-950 text-zinc-400">{invocationModeLabel[entry.invocationMode]}</Badge>
                        <Badge className="border-zinc-800 bg-zinc-950 text-zinc-400">
                          <RuntimeLabel runtime={entry.agentType as AgentType} size={12} labelClassName="text-inherit" />
                        </Badge>
                        <Badge className={runningStatusTone[entry.status] ?? runningStatusTone.idle}>{entry.status}</Badge>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-zinc-400">{entry.currentStep || t('agents.custom.activity.noCurrentStep')}</p>
                    {entry.mountedSkillNames.length > 0 || entry.mountedMcpServerNames.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.mountedSkillNames.length > 0 ? (
                          <Badge className="border-sky-500/20 bg-sky-500/10 text-sky-200">
                            Skills · {entry.mountedSkillNames.join(', ')}
                          </Badge>
                        ) : null}
                        {entry.mountedMcpServerNames.length > 0 ? (
                          <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-200">
                            MCP · {entry.mountedMcpServerNames.join(', ')}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-3 grid gap-2 text-[11px] text-zinc-500 xl:grid-cols-2">
                      <span>{t('agents.custom.activity.session')}: {entry.sessionId}</span>
                      <span>{t('agents.custom.activity.task')}: {entry.taskId}</span>
                      <span>
                        {t('agents.custom.activity.role')}: {entry.sessionKind === 'subagent'
                          ? `${sessionKindLabel.subagent} / ${sessionRoleLabel[entry.sessionRole] ?? entry.sessionRole}`
                          : sessionKindLabel.primary}
                      </span>
                      <span>{t('agents.custom.activity.model')}: {formatExecutionModelLabel(entry.executionModel)}</span>
                      <span>{t('agents.custom.activity.createdAt')}: {formatDate(entry.createdAt)}</span>
                      <span>{t('agents.custom.activity.lastActiveAt')}: {formatDate(entry.lastActiveAt)}</span>
                      <span>{t('agents.custom.activity.durationEstimate')}: {durationLabel}</span>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyCard text={selectedAgentId ? t('agents.custom.activity.empty.noRuns') : t('agents.custom.activity.empty.selectAgent')} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-base">{t('agents.custom.activity.insights')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <AuditRow label={t('agents.custom.activity.rows.mentionCalls')} value={String(auditSummary.mentionSessions)} />
              <AuditRow label={t('agents.custom.activity.rows.delegations')} value={String(auditSummary.delegateSessions)} />
              <AuditRow label={t('agents.custom.activity.rows.activeSessions')} value={String(auditSummary.activeSessions)} />
              <AuditRow label={t('agents.custom.activity.rows.completedSessions')} value={String(successSessions.length)} />
              <AuditRow label={t('agents.custom.activity.rows.failedSessions')} value={String(failedSessions.length)} />
              <AuditRow label={t('agents.custom.activity.rows.averageDuration')} value={formatDuration(averageDurationMs, t)} />
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-base">{t('agents.custom.activity.commonScope')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <DistributionGroup
                label={t('agents.custom.activity.project')}
                rows={projectDistribution.map((item) => ({
                  ...item,
                  description: t('agents.custom.activity.projectRunCount', { count: item.value }),
                }))}
                emptyText={t('agents.custom.activity.empty.noProjectDistribution')}
              />
              <DistributionGroup
                label={t('agents.custom.activity.workspace')}
                rows={workspaceDistribution.map((item) => ({
                  ...item,
                  description: t('agents.custom.activity.workspaceRunCount', { count: item.value }),
                }))}
                emptyText={t('agents.custom.activity.empty.noWorkspaceDistribution')}
              />
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-base">{t('agents.custom.activity.preferenceProfile')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <DistributionGroup
                label={t('agents.custom.activity.sessionRoleLabel')}
                rows={roleDistribution.map((item) => ({
                  ...item,
                  description: t('agents.custom.activity.roleRunCount', { count: item.value }),
                }))}
                emptyText={t('agents.custom.activity.empty.noRoleDistribution')}
              />
              <DistributionGroup
                label={t('agents.custom.activity.model')}
                rows={modelDistribution.map((item) => ({
                  ...item,
                  description: t('agents.custom.activity.modelRunCount', { count: item.value }),
                }))}
                emptyText={t('agents.custom.activity.empty.noModelDistribution')}
              />
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-base">{t('agents.custom.activity.recentErrors')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {errorEntries.length > 0 ? (
                errorEntries.map((entry) => (
                  <div key={`error-${entry.sessionId}`} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-rose-100">{entry.taskTitle}</p>
                      <Badge className="border-rose-500/20 bg-rose-500/10 text-rose-200">{entry.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-rose-100/80">{entry.currentStep || t('agents.custom.activity.empty.noExplicitErrorStep')}</p>
                    <p className="mt-2 text-[11px] text-rose-100/60">{formatDate(entry.lastActiveAt)} · {entry.projectName}</p>
                  </div>
                ))
              ) : (
                <EmptyCard text={t('agents.custom.activity.empty.noRecentErrors')} />
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-base">{t('agents.custom.activity.recentCapabilities')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <CapabilityGroup
                label="Skills"
                tone="sky"
                names={auditSummary.recentSkillNames}
                emptyText={t('agents.custom.activity.empty.noMountedSkills')}
              />
              <CapabilityGroup
                label="MCP"
                tone="emerald"
                names={auditSummary.recentMcpServerNames}
                emptyText={t('agents.custom.activity.empty.noMountedMcp')}
              />
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
            <CardHeader className="border-b border-zinc-800">
              <CardTitle className="text-base">{t('agents.custom.activity.tasksAndHeartbeat')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <DistributionGroup
                label={t('agents.custom.activity.taskStatusLabel')}
                rows={taskStatusDistribution}
                emptyText={t('agents.custom.activity.empty.noTaskActivity')}
              />
              {latestHeartbeat ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-100">{t('agents.custom.activity.metrics.latestHeartbeat')}</p>
                    <Badge className="border-zinc-800 bg-zinc-950 text-zinc-400">{latestHeartbeat.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{formatDate(latestHeartbeat.createdAt)}</p>
                </div>
              ) : (
                <EmptyCard text={t('agents.custom.activity.empty.noHeartbeat')} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function ActivityMetricCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: ReactNode
}) {
  return (
    <Card className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-none">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300">
          {icon}
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function AuditRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-200">{value}</p>
    </div>
  )
}

function EmptyCard({
  text,
}: {
  text: string
}) {
  return (
    <div className="border border-dashed border-zinc-800 px-4 py-5 text-sm text-zinc-500">
      {text}
    </div>
  )
}

function CapabilityGroup({
  label,
  names,
  emptyText,
  tone,
}: {
  label: string
  names: string[]
  emptyText: string
  tone: 'sky' | 'emerald'
}) {
  const badgeClassName = tone === 'sky'
    ? 'border-sky-500/20 bg-sky-500/10 text-sky-200'
    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {names.map((name) => (
            <Badge key={`${label}-${name}`} className={badgeClassName}>
              {name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">{emptyText}</p>
      )}
    </div>
  )
}

function DistributionGroup({
  label,
  rows,
  emptyText,
}: {
  label: string
  rows: DistributionRow[]
  emptyText: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={`${label}-${row.label}`} className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium text-zinc-100">{row.label}</p>
                <Badge className="border-zinc-800 bg-zinc-950 text-zinc-300">{row.value}</Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{row.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">{emptyText}</p>
      )}
    </div>
  )
}
