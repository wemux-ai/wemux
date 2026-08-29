import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bot, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import type { InboxGroupSummary } from '@shared/inbox'
import type { AgentType, Task, TaskStatus, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import type { AgentRecord } from '../../lib/api'
import type { AgentLiveStatus } from '../../lib/agent-live-status'
import { isAgentEffectivelyOnline } from '../../lib/managed-cloud-executor'
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { ExecutorRecord } from '@shared/types'
import { RuntimeLabel } from '../runtime/runtime-icons'
import { RuntimeStatusBadge } from '../runtime-status-badge'
import { resolveMediaUrl } from '../../lib/api'
import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { useTranslation } from '../../lib/i18n/react'
import { agentMeta, cn, formatDate, statusMeta } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'
import {
  formatRelativeTime,
  type ActivityItem,
  type DayPoint,
  type HeatmapDay,
  type StatusDayBucket,
} from './dashboard-data'

const statusChartColors: Record<TaskStatus, string> = {
  backlog: '#71717a',
  todo: '#3b82f6',
  in_progress: '#f59e0b',
  in_review: '#8b5cf6',
  done: '#10b981',
  blocked: '#ef4444',
  cancelled: '#52525b',
}

const statusChartOrder: TaskStatus[] = ['done', 'in_review', 'in_progress', 'todo', 'blocked', 'cancelled', 'backlog']

const agentBarClassName: Record<AgentType, string> = {
  OpenCode: 'bg-violet-400',
  Codex: 'bg-sky-400',
  ClaudeCode: 'bg-amber-400',
  Pi: 'bg-emerald-400',
}

const activityToneClassName = {
  neutral: 'bg-zinc-500/80',
  live: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)]',
  review: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.4)]',
  warning: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.35)]',
} as const

export const activityRowKeyframes = `
@keyframes dashboard-activity-enter {
  0% {
    opacity: 0;
    transform: translateY(-10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
`

export function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
    </div>
  )
}

export function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 px-4 py-8 text-sm text-zinc-500">
      {message}
    </div>
  )
}

export function MetricCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Bot
  value: string | number
  label: string
  description?: string
}) {
  return (
    <div className="h-full px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{value}</p>
        </div>
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
      </div>
    </div>
  )
}

export function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-950/55 p-3.5', className)}>
      <div>
        <h3 className="text-xs font-medium text-zinc-400">{title}</h3>
        {subtitle ? <p className="text-[10px] text-zinc-500">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}

export function ProjectSnapshotSection({
  tasks,
  trendPoints,
  trendValues,
}: {
  tasks: Task[]
  trendPoints: DayPoint[]
  trendValues: number[]
}) {
  const { t } = useTranslation()
  const blockedCount = tasks.filter((task) => task.status === 'blocked').length
  const doneCount = tasks.filter((task) => task.status === 'done').length
  const todoCount = tasks.filter((task) => task.status === 'todo' || task.status === 'backlog').length
  const totalTasks = tasks.length
  const totalTrendUpdates = trendValues.reduce((sum, value) => sum + value, 0)
  const latestTrendValue = trendValues[trendValues.length - 1] ?? 0
  const latestTrendPoint = trendPoints[trendPoints.length - 1]
  const statusRows = [
    {
      label: t('dashboard.snapshot.todo'),
      value: todoCount,
      tone: 'neutral' as const,
      progress: totalTasks > 0 ? Math.round((todoCount / totalTasks) * 100) : 0,
    },
    {
      label: t('dashboard.snapshot.done'),
      value: doneCount,
      tone: 'positive' as const,
      progress: totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0,
    },
    {
      label: t('dashboard.snapshot.blocked'),
      value: blockedCount,
      tone: 'warning' as const,
      progress: totalTasks > 0 ? Math.round((blockedCount / totalTasks) * 100) : 0,
    },
  ]

  return (
    <section className="space-y-4">
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.8fr)]">
        <div className="self-start rounded-xl border border-zinc-800 bg-zinc-950/55 px-4 py-3.5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_4.5rem] lg:items-end">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">{t('dashboard.charts.activityTitle')}</p>
              <p className="mt-1 text-xs text-zinc-500">{t('dashboard.charts.last14Days')}</p>
              <div className="mt-2.5">
                <OverviewTrendChart points={trendPoints} values={trendValues} emptyLabel={t('dashboard.charts.noTaskUpdates')} />
              </div>
            </div>
            <div className="border-t border-zinc-800/80 pt-2.5 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0 lg:text-right">
              <p className="text-lg font-semibold tracking-tight text-zinc-50">{totalTrendUpdates}</p>
              <p className="text-[11px] text-zinc-500">
                {latestTrendPoint ? `${latestTrendPoint.label} · ${latestTrendValue}` : t('dashboard.charts.noTaskUpdates')}
              </p>
            </div>
          </div>
        </div>

        <SnapshotMetric title={t('dashboard.snapshot.statusOverview')} rows={statusRows} />
      </div>
    </section>
  )
}

export function BarsChart({
  points,
  values,
  colorClassName,
  emptyLabel,
}: {
  points: DayPoint[]
  values: number[]
  colorClassName: string
  emptyLabel: string
}) {
  const maxValue = Math.max(...values, 0)
  const hasData = values.some((value) => value > 0)

  if (!hasData) {
    return <p className="text-xs text-zinc-500">{emptyLabel}</p>
  }

  return (
    <div>
      <div className="flex h-20 items-end gap-[3px]">
        {points.map((point, index) => {
          const value = values[index] ?? 0
          const height = maxValue > 0 ? `${Math.max(6, (value / maxValue) * 100)}%` : '6px'

          return (
            <div key={point.key} className="flex h-full flex-1 flex-col justify-end" title={`${point.label}: ${value}`}>
              {value > 0 ? (
                <div className={cn('rounded-sm', colorClassName)} style={{ height }} />
              ) : (
                <div className="rounded-sm bg-zinc-800" style={{ height: 2 }} />
              )}
            </div>
          )
        })}
      </div>
      <ChartLabels points={points} />
    </div>
  )
}

export function StatusStackChart({ points, buckets }: { points: DayPoint[]; buckets: StatusDayBucket[] }) {
  const { t } = useTranslation()
  const totals = buckets.map((bucket) => Object.values(bucket).reduce((sum, value) => sum + value, 0))
  const maxValue = Math.max(...totals, 0)
  const hasData = totals.some((value) => value > 0)

  if (!hasData) {
    return <p className="text-xs text-zinc-500">{t('dashboard.charts.noStatusChanges')}</p>
  }

  return (
    <div>
      <div className="flex h-20 items-end gap-[3px]">
        {points.map((point, index) => {
          const bucket = buckets[index]
          const total = totals[index] ?? 0
          const height = maxValue > 0 ? `${Math.max(6, (total / maxValue) * 100)}%` : '6px'

          return (
            <div key={point.key} className="flex h-full flex-1 flex-col justify-end" title={`${point.label}: ${total}`}>
              {total > 0 ? (
                <div className="flex flex-col-reverse gap-px overflow-hidden rounded-sm" style={{ height }}>
                  {statusChartOrder.map((status) =>
                    bucket[status] > 0 ? (
                      <div key={status} style={{ flex: bucket[status], backgroundColor: statusChartColors[status] }} />
                    ) : null,
                  )}
                </div>
              ) : (
                <div className="rounded-sm bg-zinc-800" style={{ height: 2 }} />
              )}
            </div>
          )
        })}
      </div>
      <ChartLabels points={points} />
      <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1">
        {statusChartOrder.map((status) => (
          <span key={status} className="inline-flex items-center gap-1 text-[9px] text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusChartColors[status] }} />
            {statusMeta[status].label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function AgentBreakdownChart({ items }: { items: Array<{ agentType: AgentType; count: number; percent: number }> }) {
  const { t } = useTranslation()
  if (items.length === 0) {
    return <p className="text-xs text-zinc-500">{t('dashboard.charts.noAgentDistribution')}</p>
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.agentType} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <RuntimeLabel runtime={item.agentType} size={14} labelClassName="font-medium text-zinc-300" />
            <span className="text-zinc-500">
              {item.count} · {item.percent}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
            <div
              className={cn('h-full rounded-full', agentBarClassName[item.agentType])}
              style={{ width: `${item.percent > 0 ? Math.max(item.percent, 6) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HealthChart({
  rows,
}: {
  rows: Array<{ label: string; value: number; tone: 'emerald' | 'violet' | 'amber' }>
}) {
  const toneClassName = {
    emerald: 'bg-emerald-400',
    violet: 'bg-violet-400',
    amber: 'bg-amber-400',
  } as const

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-zinc-300">{row.label}</span>
            <span className="text-zinc-500">{row.value}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
            <div
              className={cn('h-full rounded-full', toneClassName[row.tone])}
              style={{ width: `${row.value > 0 ? Math.max(4, row.value) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ActivityHeatmapCard({ days }: { days: HeatmapDay[] }) {
  const { language, t } = useTranslation()
  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const weeks = useMemo(() => chunkHeatmapDays(days), [days])
  const activeHeatmapDays = useMemo(() => days.filter((day) => !day.isFuture && day.score > 0), [days])
  const activeDays = activeHeatmapDays.length
  const peakScore = useMemo(() => days.reduce((peak, day) => Math.max(peak, day.score), 0), [days])
  const activeWeeks = useMemo(() => weeks.filter((week) => week.some((day) => !day.isFuture && day.score > 0)).length, [weeks])
  const recent7DayScore = useMemo(
    () =>
      days
        .filter((day) => !day.isFuture)
        .slice(-7)
        .reduce((sum, day) => sum + day.score, 0),
    [days],
  )
  const averageActiveScore = useMemo(() => {
    if (activeHeatmapDays.length === 0) {
      return 0
    }

    const totalScore = activeHeatmapDays.reduce((sum, day) => sum + day.score, 0)
    return Math.round(totalScore / activeHeatmapDays.length)
  }, [activeHeatmapDays])
  const latestActiveDay = activeHeatmapDays.at(-1) ?? null
  const peakDay = useMemo(() => {
    if (activeHeatmapDays.length === 0) {
      return null
    }

    return activeHeatmapDays.reduce((peak, day) => (day.score > peak.score ? day : peak))
  }, [activeHeatmapDays])
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short' }), [locale])
  const shortDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'numeric',
        day: 'numeric',
      }),
    [locale],
  )
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }), [locale])
  const weekDayLabels = useMemo(() => getWeekdayLabels(weekdayFormatter), [weekdayFormatter])
  const legendLevels = [0, 1, 2, 3, 4]
  const heatmapAccessibleSummary = [
    t('dashboard.charts.heatmapTitle'),
    t('dashboard.charts.heatmapSummary', { activeDays, peak: peakScore }),
    latestActiveDay
      ? `${t('dashboard.charts.heatmapLatestActive')}: ${shortDateFormatter.format(new Date(`${latestActiveDay.key}T12:00:00.000Z`))}, ${t('dashboard.charts.heatmapLatestActiveDetail', { score: latestActiveDay.score })}`
      : t('dashboard.charts.noHeatmapActivity'),
    peakDay
      ? `${t('dashboard.charts.heatmapPeakDay')}: ${shortDateFormatter.format(new Date(`${peakDay.key}T12:00:00.000Z`))}, ${t('dashboard.charts.heatmapPeakDayDetail', { peak: peakDay.score })}`
      : null,
  ].filter(Boolean).join('。')

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/55">
      <div className="grid gap-px xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.85fr)]">
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="space-y-5">
            <div className="min-w-0">
              <SectionTitle title={t('dashboard.charts.heatmapTitle')} description={t('dashboard.charts.last16Weeks')} />
              <p className="mt-2 text-xs text-zinc-500">{t('dashboard.charts.heatmapSummary', { activeDays, peak: peakScore })}</p>
              <div className="mt-4 overflow-x-auto pb-1">
                <HeatmapCalendar
                  days={days}
                  weeks={weeks}
                  monthFormatter={monthFormatter}
                  weekDayLabels={weekDayLabels}
                  accessibleSummary={heatmapAccessibleSummary}
                />
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                <span>{t('dashboard.charts.heatmapLegendLess')}</span>
                {legendLevels.map((level) => (
                  <span key={level} className={getHeatmapToneClassName(level, false)} />
                ))}
                <span>{t('dashboard.charts.heatmapLegendMore')}</span>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 border-t border-zinc-800/80 pt-4 sm:grid-cols-2 xl:grid-cols-4">
              <HeatmapInsight
                label={t('dashboard.charts.heatmapLatestActive')}
                value={latestActiveDay ? shortDateFormatter.format(new Date(`${latestActiveDay.key}T12:00:00.000Z`)) : '--'}
                detail={
                  latestActiveDay
                    ? t('dashboard.charts.heatmapLatestActiveDetail', { score: latestActiveDay.score })
                    : t('dashboard.charts.noHeatmapActivity')
                }
              />
              <HeatmapInsight
                label={t('dashboard.charts.heatmapRecent7DayScore')}
                value={recent7DayScore}
                detail={t('dashboard.charts.heatmapRecent7DayDetail')}
              />
              <HeatmapInsight
                label={t('dashboard.charts.heatmapPeakDay')}
                value={peakDay ? shortDateFormatter.format(new Date(`${peakDay.key}T12:00:00.000Z`)) : '--'}
                detail={peakDay ? t('dashboard.charts.heatmapPeakDayDetail', { peak: peakDay.score }) : t('dashboard.charts.noHeatmapActivity')}
              />
              <HeatmapInsight
                label={t('dashboard.charts.heatmapActiveWeeks')}
                value={`${activeWeeks}/${weeks.length}`}
                detail={t('dashboard.charts.heatmapAverageScoreDetail', { score: averageActiveScore })}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 px-4 py-4 sm:px-5 sm:py-5 xl:border-l xl:border-t-0">
          <div className="mb-4">
            <h3 className="text-xs font-medium text-zinc-400">{t('dashboard.charts.heatmapTableTitle')}</h3>
            <p className="text-[10px] text-zinc-500">{t('dashboard.charts.heatmapTableSubtitle')}</p>
          </div>
          <DeliveryActivityTable days={days} />
        </div>
      </div>
    </section>
  )
}

function HeatmapInsight({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail: string
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="truncate text-lg font-semibold tabular-nums text-zinc-100">{value}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </div>
  )
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <Link
      to="/kanban"
      search={{ projectId: item.projectId, taskId: item.taskId, createTask: undefined }}
      className="block px-4 py-3 transition-colors hover:bg-zinc-900/65"
      style={{ animation: 'dashboard-activity-enter 220ms ease-out both' }}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full', activityToneClassName[item.tone])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-zinc-100">{item.taskTitle}</p>
            <span className="shrink-0 text-[11px] text-zinc-500" title={formatDate(item.at)}>
              {formatRelativeTime(item.at)}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-500">{item.text}</p>
        </div>
      </div>
    </Link>
  )
}

export function RecentTaskRow({ task }: { task: Task }) {
  const status = statusMeta[task.status] ?? statusMeta.todo

  return (
    <Link
      to="/kanban"
      search={{ projectId: task.projectId, taskId: task.id, createTask: undefined }}
      className="block px-4 py-3 transition-colors hover:bg-zinc-900/65"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <span className={cn('inline-flex rounded-full px-2 py-1 text-[10px] font-semibold', status.soft)}>
            {status.label}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 text-sm text-zinc-100">{task.title}</p>
            <span className="shrink-0 text-[11px] text-zinc-500">{formatRelativeTime(task.updatedAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className={cn('inline-flex rounded-full px-2 py-0.5 font-medium', agentMeta[task.agentType].soft)}>
              <RuntimeLabel runtime={task.agentType} size={12} labelClassName="text-inherit" />
            </span>
            <RuntimeStatusBadge task={task} compact showText />
          </div>
          {task.description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-5 text-zinc-500">{task.description}</p>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

function SnapshotMetric({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value: string | number; tone: 'neutral' | 'positive' | 'warning'; progress?: number }>
}) {
  const toneStyles = {
    neutral: {
      text: 'text-zinc-300',
      bar: 'bg-zinc-500/80',
    },
    positive: {
      text: 'text-emerald-300',
      bar: 'bg-emerald-400',
    },
    warning: {
      text: 'text-amber-300',
      bar: 'bg-amber-400',
    },
  } as const

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/45 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{title}</p>
      <div className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="border-b border-zinc-900/80 pb-2.5 last:border-b-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm text-zinc-500">{row.label}</span>
                {typeof row.progress === 'number' ? (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className={cn('h-full rounded-full', toneStyles[row.tone].bar)}
                      style={{ width: `${row.progress > 0 ? Math.max(4, row.progress) : 0}%` }}
                    />
                  </div>
                ) : null}
              </div>
              <div className="max-w-[70%] text-right">
                <span className={cn('block text-sm font-medium', toneStyles[row.tone].text)}>{row.value}</span>
                {typeof row.progress === 'number' ? <span className="text-[11px] text-zinc-600">{row.progress}%</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OverviewTrendChart({
  points,
  values,
  emptyLabel,
}: {
  points: DayPoint[]
  values: number[]
  emptyLabel: string
}) {
  const maxValue = Math.max(...values, 0)
  const hasData = values.some((value) => value > 0)

  if (!hasData) {
    return <p className="text-xs text-zinc-500">{emptyLabel}</p>
  }

  const width = 320
  const height = 96
  const paddingLeft = 8
  const paddingRight = 8
  const paddingTop = 8
  const paddingBottom = 14
  const innerWidth = width - paddingLeft - paddingRight
  const innerHeight = height - paddingTop - paddingBottom
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0
  const coordinates = values.map((value, index) => {
    const x = paddingLeft + step * index
    const y = paddingTop + innerHeight - (maxValue > 0 ? (value / maxValue) * innerHeight : 0)
    return { x, y, value, label: points[index]?.label ?? '' }
  })
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const areaPath = `${linePath} L ${paddingLeft + innerWidth} ${paddingTop + innerHeight} L ${paddingLeft} ${paddingTop + innerHeight} Z`

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible">
        <defs>
          <linearGradient id="dashboard-overview-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(244,244,245,0.16)" />
            <stop offset="100%" stopColor="rgba(244,244,245,0)" />
          </linearGradient>
        </defs>

        {[0.2, 0.5, 0.8].map((offset) => {
          const y = paddingTop + innerHeight * offset
          return <line key={offset} x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y} y2={y} stroke="rgba(63,63,70,0.65)" strokeDasharray="4 5" />
        })}

        <path d={areaPath} fill="url(#dashboard-overview-trend-fill)" />
        <path d={linePath} fill="none" stroke="#d4d4d8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" />

        {coordinates.map((point, index) => (
          <circle
            key={`${point.label}-${index}`}
            cx={point.x}
            cy={point.y}
            r={index === coordinates.length - 1 ? 4 : 3}
            fill={index === coordinates.length - 1 ? '#f4f4f5' : '#a1a1aa'}
            opacity={point.value > 0 ? 1 : 0.55}
          />
        ))}
      </svg>
      <ChartLabels points={points} />
    </div>
  )
}

function HeatmapCalendar({
  days,
  weeks,
  monthFormatter,
  weekDayLabels,
  accessibleSummary,
}: {
  days: HeatmapDay[]
  weeks: HeatmapDay[][]
  monthFormatter: Intl.DateTimeFormat
  weekDayLabels: string[]
  accessibleSummary: string
}) {
  if (days.length === 0) {
    return null
  }

  const heatmapCellSize = 14
  const weekGridTemplateStyle = {
    gridTemplateColumns: `repeat(${weeks.length}, ${heatmapCellSize}px)`,
  }

  return (
    <div role="img" aria-label={accessibleSummary} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2.5">
      <div aria-hidden="true" className="pt-5">
        <div className="grid grid-rows-7 gap-[3px] text-[10px] text-zinc-600">
          {weekDayLabels.map((label, index) => (
            <div key={`${label}-${index}`} className="flex h-[14px] w-4 items-center justify-start">
              {label}
            </div>
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="min-w-0 w-max space-y-[3px]">
        <div className="grid w-max gap-[3px] pl-0.5 text-[10px] text-zinc-600" style={weekGridTemplateStyle}>
          {weeks.map((week, index) => (
            <div key={`month-${week[0]?.key ?? index}`} className="min-w-0 text-left">
              {getHeatmapMonthLabel(week, weeks[index - 1], monthFormatter)}
            </div>
          ))}
        </div>

        <div className="grid w-max gap-[3px]" style={weekGridTemplateStyle}>
          {weeks.map((week) => (
            <div key={week[0]?.key ?? 'week'} className="grid grid-rows-7 gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.key}
                  className={getHeatmapToneClassName(day.level, day.isFuture, { stretch: true })}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DeliveryActivityTable({ days }: { days: HeatmapDay[] }) {
  const { language, t } = useTranslation()
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'numeric',
        day: 'numeric',
      }),
    [language],
  )
  const rows = useMemo(
    () =>
      days
        .filter((day) => !day.isFuture && day.score > 0)
        .sort((left, right) => new Date(right.key).getTime() - new Date(left.key).getTime())
        .slice(0, 8),
    [days],
  )

  if (rows.length === 0) {
    return <p className="text-xs text-zinc-500">{t('dashboard.charts.noHeatmapActivity')}</p>
  }

  return (
    <div className="overflow-hidden">
      <div className="grid grid-cols-[5rem_4rem_3.25rem_3.25rem_3.25rem] gap-2.5 border-b border-zinc-800/90 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        <span>{t('dashboard.charts.heatmapTableDate')}</span>
        <span className="text-right">{t('dashboard.charts.heatmapTableScore')}</span>
        <span className="text-right">{t('dashboard.charts.heatmapTableUpdates')}</span>
        <span className="text-right">{t('dashboard.charts.heatmapTableLogs')}</span>
        <span className="text-right">{t('dashboard.charts.heatmapTableHistory')}</span>
      </div>

      <div className="divide-y divide-zinc-800/80">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[5rem_4rem_3.25rem_3.25rem_3.25rem] gap-2.5 px-3 py-2.5 text-sm text-zinc-300"
          >
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full border border-zinc-600 bg-transparent" />
                <span className="tabular-nums text-zinc-100">
                  {dateFormatter.format(new Date(`${row.key}T12:00:00.000Z`))}
                </span>
              </div>
            </div>
            <span className="text-right font-medium tabular-nums text-zinc-200">{row.score}</span>
            <span className="text-right tabular-nums text-zinc-300">{row.taskUpdates}</span>
            <span className="text-right tabular-nums text-zinc-400">{row.logEntries}</span>
            <span className="text-right tabular-nums text-zinc-300">{row.historyEvents}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartLabels({ points }: { points: DayPoint[] }) {
  return (
    <div className="mt-1 flex gap-[3px]">
      {points.map((point, index) => (
        <div key={point.key} className="flex-1 text-center">
          {index === 0 || index === 6 || index === points.length - 1 ? (
            <span className="text-[9px] tabular-nums text-zinc-500">{point.label}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function chunkHeatmapDays(days: HeatmapDay[]) {
  const weeks: HeatmapDay[][] = []

  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7))
  }

  return weeks
}

function getWeekdayLabels(formatter: Intl.DateTimeFormat) {
  return Array.from({ length: 7 }, (_, index) => {
    if (![1, 3, 5].includes(index)) {
      return ''
    }

    const anchorDate = new Date(Date.UTC(2024, 0, 7 + index, 12, 0, 0, 0))
    return formatter.format(anchorDate)
  })
}

function getHeatmapMonthLabel(
  week: HeatmapDay[],
  previousWeek: HeatmapDay[] | undefined,
  formatter: Intl.DateTimeFormat,
) {
  const anchorDay = week.find((day) => {
    const date = new Date(`${day.key}T12:00:00.000Z`)
    return date.getUTCDate() <= 7
  }) ?? week[0]

  if (!anchorDay) {
    return ''
  }

  const anchorDate = new Date(`${anchorDay.key}T12:00:00.000Z`)
  const previousDate = previousWeek?.[0] ? new Date(`${previousWeek[0].key}T12:00:00.000Z`) : undefined
  const monthChanged =
    !previousDate ||
    previousDate.getUTCMonth() !== anchorDate.getUTCMonth() ||
    previousDate.getUTCFullYear() !== anchorDate.getUTCFullYear()

  return monthChanged ? formatter.format(anchorDate) : ''
}

function getHeatmapToneClassName(level: number, isFuture: boolean, options?: { stretch?: boolean }) {
  const sizeClassName = options?.stretch
    ? 'h-[14px] w-[14px] rounded-[4px] border'
    : 'h-[14px] w-[14px] rounded-[4px] border sm:h-4 sm:w-4'

  if (isFuture) {
    return cn(sizeClassName, 'border-zinc-900 bg-zinc-950/70')
  }

  const toneClassName = [
    'border-zinc-800 bg-zinc-900',
    'border-emerald-950 bg-emerald-950/80',
    'border-emerald-900 bg-emerald-800/70',
    'border-emerald-700 bg-emerald-600/80',
    'border-lime-400/50 bg-lime-400/95 shadow-[0_0_14px_rgba(163,230,53,0.18)]',
  ]

  return cn(sizeClassName, toneClassName[level] ?? toneClassName[0])
}

// ─── Agent 团队状态 ───────────────────────────────────────────────────────────

function getAgentInitials(name: string) {
  return (name.trim() || 'A').slice(0, 2).toUpperCase()
}

function AgentTeamRow({
  agent,
  isWorking,
  workingCount,
  isOnline,
  currentTask,
}: {
  agent: AgentRecord
  isWorking: boolean
  workingCount: number
  isOnline: boolean
  currentTask: Task | null
}) {
  const { t } = useTranslation()
  const profile = readCustomAgentConfig(agent.config)
  const avatarUrl = profile.avatarUrl.trim()

  const statusLabel = isWorking
    ? t('dashboard.agentTeam.working')
    : isOnline
      ? t('dashboard.agentTeam.idle')
      : t('dashboard.agentTeam.offline')

  const statusDot = isWorking
    ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]'
    : isOnline
      ? 'bg-emerald-400'
      : 'bg-zinc-600'

  return (
    <Link
      to={'/agents' as never}
      search={{ agentId: agent.id } as never}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-900/50"
    >
      <Avatar className="h-8 w-8 shrink-0 rounded-full border border-zinc-800 bg-zinc-900">
        <AvatarImage src={resolveMediaUrl(avatarUrl)} />
        <AvatarFallback className={cn(
          'rounded-full bg-gradient-to-br text-[11px] font-black text-zinc-950',
          getAgentAvatarAccent(agent.id),
        )}>
          {getAgentInitials(agent.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{agent.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot)} />
          <span>{statusLabel}</span>
          {isWorking && workingCount > 1 ? (
            <span className="text-zinc-600">
              · {t('dashboard.agentTeam.workingCount', { count: workingCount })}
            </span>
          ) : null}
        </div>
      </div>

      {currentTask ? (
        <div className="hidden min-w-0 max-w-[40%] text-right sm:block">
          <p className="truncate text-xs text-zinc-500">{currentTask.title}</p>
        </div>
      ) : null}

      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-700" />
    </Link>
  )
}

export function AgentTeamPanel({
  agents,
  liveStatuses,
  workspaceSessions,
  taskWorkspaceBindings,
  tasks,
  executors,
}: {
  agents: AgentRecord[]
  liveStatuses: Map<string, AgentLiveStatus>
  workspaceSessions: WorkspaceSession[]
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  tasks: Task[]
  executors: ExecutorRecord[]
}) {
  const { t } = useTranslation()

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])

  const activeBindingsByWorkspaceId = useMemo(() => {
    const map = new Map<string, TaskWorkspaceBinding[]>()
    for (const binding of taskWorkspaceBindings) {
      if (binding.status !== 'active') continue
      const existing = map.get(binding.workspaceId)
      if (existing) {
        existing.push(binding)
      } else {
        map.set(binding.workspaceId, [binding])
      }
    }
    return map
  }, [taskWorkspaceBindings])

  const getAgentCurrentTask = (agentId: string, agentName: string): Task | null => {
    const session = workspaceSessions.find((s) =>
      s.status === 'active'
      && (s.customAgentId?.trim() === agentId || s.customAgentName?.trim() === agentName),
    )
    if (!session) return null
    const binding = activeBindingsByWorkspaceId.get(session.workspaceId)?.[0]
    return binding ? (taskById.get(binding.taskId) ?? null) : null
  }

  const nonMainAgents = agents.filter((agent) => agent.type.trim().toLowerCase() !== 'main')

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 sm:px-5">
        <SectionTitle title={t('dashboard.agentTeam.sectionTitle')} />
        <Link
          to={'/agents' as never}
          search={{} as never}
          className="text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          {t('dashboard.collab.viewAll')}
        </Link>
      </div>
      {nonMainAgents.length === 0 ? (
        <div className="px-4 py-6 sm:px-5">
          <EmptyPanel message={t('dashboard.agentTeam.noAgents')} />
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60">
          {nonMainAgents.map((agent) => {
            const liveStatus = liveStatuses.get(agent.id)
            const isWorking = (liveStatus?.workingCount ?? 0) > 0
            const config = readCustomAgentConfig(agent.config)
            const isOnline = isAgentEffectivelyOnline({
              agentStatus: agent.status,
              defaultExecutorId: config.defaultExecutorId,
              executors,
            })
            const currentTask = getAgentCurrentTask(agent.id, agent.name)
            return (
              <AgentTeamRow
                key={agent.id}
                agent={agent}
                isWorking={isWorking}
                workingCount={liveStatus?.workingCount ?? 0}
                isOnline={isOnline}
                currentTask={currentTask}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

// ─── 协作动态（Inbox 驱动） ────────────────────────────────────────────────────

const inboxKindTone: Record<string, keyof typeof activityToneClassName> = {
  directive: 'live',
  handoff: 'warning',
  mention: 'review',
  observe: 'neutral',
}

export function InboxGroupRow({ group }: { group: InboxGroupSummary }) {
  const item = group.latestItem
  const isUnread = group.unreadCount > 0
  const tone = inboxKindTone[item.kind] ?? 'neutral'

  const to = item.scope?.taskId ? '/kanban' : '/inbox'
  const href = item.scope?.taskId
    ? `/kanban?projectId=${encodeURIComponent(item.scope.projectId ?? '')}&taskId=${encodeURIComponent(item.scope.taskId)}`
    : '/inbox'

  return (
    <a
      href={href}
      className="block px-4 py-3 transition-colors hover:bg-zinc-900/65"
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full', activityToneClassName[tone])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className={cn('truncate text-sm font-medium', isUnread ? 'text-zinc-100' : 'text-zinc-300')}>
              {item.title}
            </p>
            <span className="shrink-0 text-[11px] text-zinc-500">{formatRelativeTime(item.createdAt)}</span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
            {item.actorName}
            {item.body ? ` · ${item.body}` : ''}
          </p>
        </div>
        {isUnread ? (
          <span className="mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-sky-400" />
        ) : null}
      </div>
    </a>
  )
}

// ─── 热力图可折叠包装 ──────────────────────────────────────────────────────────

export function CollapsibleHeatmap({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-zinc-900/50 sm:px-5"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          {expanded
            ? t('dashboard.heatmapToggle.collapse')
            : t('dashboard.heatmapToggle.expand')}
        </span>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-zinc-600" />
          : <ChevronDown className="h-4 w-4 text-zinc-600" />}
      </button>
      {expanded ? <div className="border-t border-zinc-800">{children}</div> : null}
    </div>
  )
}
