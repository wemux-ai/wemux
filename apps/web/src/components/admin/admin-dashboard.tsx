import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowUpRight,
  Clock,
  Cpu,
  XCircle,
  Zap,
} from 'lucide-react'
import type { DistributedTask, ExecutorRecord, WorkspaceSession } from '@shared/types'
import type { AdminAuditLogRecord } from '@/lib/api'
import { AuditEventIcon, getAuditEventBadgeVariant, getAuditEventSummary } from './audit-event'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/react'

export function AdminDashboard({
  executors,
  distributedTasks,
  workspaceSessions,
  auditLogs,
}: {
  executors: ExecutorRecord[]
  distributedTasks: DistributedTask[]
  workspaceSessions: WorkspaceSession[]
  auditLogs: AdminAuditLogRecord[]
}) {
  const { t } = useTranslation()

  const onlineExecutors = executors.filter(e => e.status === 'online').length
  const offlineExecutors = executors.filter(e => e.status !== 'online' && e.status !== 'paired').length
  const activeTasks = distributedTasks.filter(t =>
    ['assigned', 'preparing', 'executing', 'syncing_back'].includes(t.status)
  ).length
  const failedTasks = distributedTasks.filter(t =>
    ['failed', 'timed_out', 'lost'].includes(t.status)
  ).length
  const runningSessions = workspaceSessions.filter(s => s.runtimeStatus === 'running').length

  const tasks24h = distributedTasks.filter(t => {
    const createdAtMs = new Date(t.createdAt).getTime()
    return Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= 24 * 60 * 60 * 1000
  })
  const failures24h = tasks24h.filter(t => ['failed', 'timed_out', 'lost'].includes(t.status))
  const failureRate = tasks24h.length > 0 ? Math.round((failures24h.length / tasks24h.length) * 100) : 0

  const stats = [
    {
      title: t('admin.dashboard.executorsOnline'),
      value: onlineExecutors,
      description: t('admin.dashboard.offlineCount', { count: offlineExecutors }),
      icon: Cpu,
      iconClass: onlineExecutors > 0 ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
    },
    { title: t('admin.dashboard.activeTasks'), value: activeTasks, description: t('admin.dashboard.currentlyExecuting'), icon: Zap, iconClass: 'bg-muted text-muted-foreground' },
    {
      title: t('admin.dashboard.failedTasks'),
      value: failedTasks,
      description: t('admin.dashboard.failureRate', { percent: failureRate }),
      icon: XCircle,
      iconClass: failedTasks > 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
    },
    { title: t('admin.dashboard.runningSessions'), value: runningSessions, description: t('admin.dashboard.sessionsActive'), icon: Clock, iconClass: 'bg-muted text-muted-foreground' },
  ]

  const meshReadyCount = executors.filter(e => e.presence?.mesh?.status === 'ready').length
  const needsAttention = executors.filter(e =>
    e.status === 'offline'
    || e.status === 'disabled'
    || e.presence?.mesh?.status === 'error'
  ).length
  const healthPercentage = executors.length > 0 ? Math.round((onlineExecutors / executors.length) * 100) : 0

  // Recent Activity：排除高频的 agent.turn.completed（完整流水在 /admin/audit），
  // 保留失败/等待中的回合与其他有信息量的事件，避免概览被刷屏。
  const completedTurnCount = auditLogs.filter((log) => log.eventType === 'agent.turn.completed').length
  const meaningfulLogs = auditLogs.filter((log) => log.eventType !== 'agent.turn.completed')
  const visibleLogs = meaningfulLogs.slice(0, 6)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('admin.dashboard.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('admin.dashboard.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button render={<Link to="/admin/executors" />} variant="outline" size="sm">
            {t('admin.dashboard.executors')}
          </Button>
          <Button render={<Link to="/admin/tasks" />} size="sm">
            {t('admin.dashboard.viewTasks')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <CardDescription className="text-[13px] font-medium">{stat.title}</CardDescription>
                <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', stat.iconClass)}>
                  <stat.icon className="size-3.5" />
                </div>
              </div>
              <div className="mt-1.5 text-2xl font-semibold tracking-tight">{stat.value}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-3">
            <div>
              <CardTitle className="text-sm font-semibold">{t('admin.dashboard.recentActivity')}</CardTitle>
              <CardDescription className="text-xs">{t('admin.dashboard.recentActivityDesc')}</CardDescription>
            </div>
            <Button render={<Link to="/admin/audit" />} variant="ghost" size="sm">
              {t('admin.dashboard.viewAll')}
              <ArrowUpRight className="ml-0.5 size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-2">
            <div className="divide-y">
              {visibleLogs.map((log) => {
                const summary = getAuditEventSummary(log)
                const actorLabel = log.actorType === 'agent' && log.actorId
                  ? t('admin.dashboard.triggeredBy', { id: log.actorId })
                  : log.actorId
                    ? t('admin.dashboard.actor', { id: log.actorId })
                    : log.actorType
                return (
                  <div key={log.id} className="flex items-start gap-3 px-2 py-2.5">
                    <div className="mt-0.5 shrink-0">
                      <AuditEventIcon log={log} className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={getAuditEventBadgeVariant(log)} className="text-[11px]">
                          {log.eventType}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {actorLabel}
                        {log.taskId ? ` · ${t('admin.dashboard.task', { id: log.taskId })}` : ''}
                        {log.workspaceId ? ` · ${t('admin.dashboard.workspace', { id: log.workspaceId })}` : ''}
                      </p>
                      {summary && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/80" title={summary}>
                          {summary}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
              {visibleLogs.length === 0 && completedTurnCount === 0 && (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">{t('admin.dashboard.noRecentActivity')}</p>
              )}
            </div>
            {completedTurnCount > 0 && (
              <div className="mt-1 flex items-center gap-1.5 border-t px-2 pt-2 text-[11px] text-muted-foreground">
                <Activity className="size-3" />
                {t('admin.dashboard.turnsCompleted', { count: completedTurnCount })} · {t('admin.dashboard.viewAuditStream')}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="text-sm font-semibold">{t('admin.dashboard.systemHealth')}</CardTitle>
            <CardDescription className="text-xs">{t('admin.dashboard.systemHealthDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">{t('admin.dashboard.executorAvailability')}</span>
                <span className="font-medium">{healthPercentage}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${healthPercentage}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('admin.dashboard.onlineCount', { count: onlineExecutors })}</span>
                <span>{t('admin.dashboard.totalCount', { count: executors.length })}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border p-3">
                <div className="text-xl font-semibold tracking-tight">{meshReadyCount}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.dashboard.meshReady')}</p>
              </div>
              <div className="rounded-xl border p-3">
                <div className={cn('text-xl font-semibold tracking-tight', needsAttention > 0 ? 'text-destructive' : '')}>
                  {needsAttention}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.dashboard.needsAttention')}</p>
              </div>
            </div>

            <Button render={<Link to="/admin/executors" />} variant="outline" size="sm" className="w-full">
              {t('admin.dashboard.viewDetails')}
              <ArrowUpRight className="ml-1 size-3" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
