// [INPUT]: /api/admin/analytics 聚合数据
// [OUTPUT]: 管理员数据看板 UI（概览 / 交付质量 / 增长 / 商业化 / 平台，分 Tab）
// [POS]: 自有 analytics 展示层；数据全部来自自家 Postgres，无第三方依赖
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useMemo } from 'react'
import { Activity, Boxes, CheckCircle2, Cpu, GitPullRequest, Users } from 'lucide-react'
import type { AdminAnalyticsResponse } from '@/lib/api'
import { useTranslation } from '@/lib/i18n/react'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui-admin/tabs'
import { cn } from '@/lib/utils'

const DAY_OPTIONS = [7, 14, 30, 90] as const

const EVENT_TYPE_LABELS: Record<string, string> = {
  signup_completed: 'signup_completed',
  invite_used: 'invite_used',
  onboarding_completed: 'onboarding_completed',
  worker_paired: 'worker_paired',
  task_created: 'task_created',
  task_first_review: 'task_first_review',
  feedback_submitted: 'feedback_submitted',
}

const formatDuration = (sec: number) => {
  if (!sec) return '—'
  if (sec < 60) return `${sec}s`
  const minutes = Math.round(sec / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = (minutes / 60).toFixed(1)
  return `${hours}h`
}

export function AdminAnalyticsPage({ data, days, onDaysChange }: { data: AdminAnalyticsResponse | null; days: number; onDaysChange: (days: number) => void }) {
  const { t } = useTranslation()

  const funnelSteps = useMemo(() => {
    const byType = new Map(data?.funnel.map((f) => [f.eventType, f.count]) ?? [])
    const order = ['signup_completed', 'invite_used', 'onboarding_completed', 'worker_paired', 'task_first_review'] as const
    return order
      .filter((type) => byType.has(type))
      .map((type, index, list) => {
        const count = byType.get(type) ?? 0
        const previous = index > 0 ? (byType.get(list[index - 1]!) ?? 0) : null
        return {
          type,
          count,
          conversion: previous === null ? null : previous > 0 ? Math.round((count / previous) * 100) : null,
        }
      })
  }, [data])

  if (!data) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('analytics.subtitle')}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('analytics.loading')}</p>
      </div>
    )
  }

  const stats = [
    { title: t('analytics.totals.users'), value: data.totals.users, icon: Users },
    { title: t('analytics.totals.executors'), value: data.totals.executors, icon: Cpu },
    { title: t('analytics.totals.onlineExecutors'), value: data.totals.onlineExecutors, icon: Boxes },
    { title: t('analytics.totals.tasks'), value: data.totals.tasks, icon: GitPullRequest },
    { title: t('analytics.totals.deliveries'), value: data.totals.deliveries, icon: CheckCircle2 },
  ]

  const maxFunnelCount = Math.max(1, ...funnelSteps.map((s) => s.count))
  const deliveryPercent = data.deliveryRate.completed > 0
    ? Math.round((data.deliveryRate.delivered / data.deliveryRate.completed) * 100)
    : 0

  const exportCsv = () => {
    const lines: string[] = []
    lines.push('每日活跃用户')
    lines.push('date,loginUsers,eventUsers,executionUsers')
    for (const row of data.dailyActiveUsers) lines.push(`${row.date},${row.loginUsers},${row.eventUsers},${row.executionUsers}`)
    lines.push('')
    lines.push('每日任务')
    lines.push('date,created,delivered')
    for (const row of data.dailyTasks) lines.push(`${row.date},${row.created},${row.delivered}`)
    lines.push('')
    lines.push('留存曲线')
    lines.push('date,cohort,d1,d7')
    for (const row of data.retentionCurve) lines.push(`${row.date},${row.cohort},${row.d1 ?? ''},${row.d7 ?? ''}`)
    lines.push('')
    lines.push('每周真实交付')
    lines.push('week,deliveries')
    for (const row of data.weeklyDeliveries) lines.push(`${row.week},${row.count}`)

    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `wemux-analytics-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('analytics.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-muted p-0.5">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onDaysChange(option)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                days === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option}d
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}>导出 CSV</Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="delivery">交付与质量</TabsTrigger>
          <TabsTrigger value="growth">增长</TabsTrigger>
          <TabsTrigger value="platform">平台</TabsTrigger>
        </TabsList>

        {/* ============ 概览 ============ */}
        <TabsContent value="overview" className="space-y-5 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stats.map((stat) => (
              <Card key={stat.title}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardDescription className="text-[13px] font-medium">{stat.title}</CardDescription>
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <stat.icon className="size-3.5" />
                    </div>
                  </div>
                  <div className="mt-1.5 text-2xl font-semibold tracking-tight">{stat.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">{t('analytics.funnel')}</CardTitle>
                <CardDescription className="text-xs">{t('analytics.funnelDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {funnelSteps.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.noEvents')}</p>
                )}
                {funnelSteps.map((step) => (
                  <div key={step.type}>
                    <div className="mb-1 flex items-center justify-between text-[13px]">
                      <span className="font-mono text-xs text-muted-foreground">{EVENT_TYPE_LABELS[step.type] ?? step.type}</span>
                      <span className="font-medium">{step.count}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.round((step.count / maxFunnelCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">{t('analytics.dailyDeliveries')}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {data.dailyDeliveries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.noEvents')}</p>
                ) : (
                  <VerticalBars rows={data.dailyDeliveries.slice(0, 14).map((row) => ({ label: row.date, value: row.count }))} color="bg-primary/80" />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">每日活跃用户</CardTitle>
              <CardDescription className="text-xs">去重用户数：登录 / 埋点事件 / 执行（token 用量）</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
                <LegendDot color="bg-emerald-500" label="登录" />
                <LegendDot color="bg-sky-500" label="埋点事件" />
                <LegendDot color="bg-amber-500" label="执行" />
              </div>
              <TripleBars
                rows={data.dailyActiveUsers.map((row) => ({
                  label: row.date,
                  a: row.loginUsers,
                  b: row.eventUsers,
                  c: row.executionUsers,
                }))}
                colors={['bg-emerald-500', 'bg-sky-500', 'bg-amber-500']}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">留存（登录口径）</CardTitle>
              <CardDescription className="text-xs">近 30 天注册用户 {data.retention.cohort} 人</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 p-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">次日留存 D1</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{data.retention.d1}%</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">7 日留存 D7</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">{data.retention.d7}%</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">留存曲线（按注册日 cohort）</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
                <LegendDot color="bg-sky-500" label="D1 次日" />
                <LegendDot color="bg-violet-500" label="D7 七日" />
              </div>
              <DoubleBars
                rows={data.retentionCurve.map((row) => ({ label: row.date, a: row.d1 ?? 0, b: row.d7 ?? 0, dimA: row.d1 == null, dimB: row.d7 == null }))}
                colors={['bg-sky-500', 'bg-violet-500']}
                labelEvery={5}
                scale="percent"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">每日任务：创建 vs 交付</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
                <LegendDot color="bg-sky-500" label="创建" />
                <LegendDot color="bg-emerald-500" label="交付" />
              </div>
              <DoubleBars rows={data.dailyTasks.map((row) => ({ label: row.date, a: row.created, b: row.delivered }))} colors={['bg-sky-500', 'bg-emerald-500']} labelEvery={Math.max(1, Math.floor(data.dailyTasks.length / 14))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-3">
              <div>
                <CardTitle className="text-sm font-semibold">{t('analytics.recentEvents')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {data.recentEvents.slice(0, 30).map((event) => (
                  <div key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Activity className="size-3.5 shrink-0 text-muted-foreground" />
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      {event.eventType}
                    </Badge>
                    <span className="truncate text-xs text-muted-foreground">
                      {event.userId ? `${t('analytics.user')}: ${event.userId}` : '-'}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
                {data.recentEvents.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('analytics.noEvents')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ 交付与质量 ============ */}
        <TabsContent value="delivery" className="space-y-5 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="本周交付（近 8 周合计）" value={String(data.weeklyDeliveries.reduce((sum, row) => sum + row.count, 0))} sub="真实 commit / branch / PR 快照" />
            <MetricCard label="交付率（近 30 天）" value={`${deliveryPercent}%`} sub={`${data.deliveryRate.delivered} / ${data.deliveryRate.completed} 完成`} />
            <MetricCard label="平均执行时长" value={formatDuration(data.executionQuality.avgDurationSec)} sub="assign → result" />
          </div>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">每周真实交付数（北极星）</CardTitle>
              <CardDescription className="text-xs">近 8 周，按 completedAt 聚合</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              {data.weeklyDeliveries.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无交付数据</p>
              ) : (
                <VerticalBars rows={data.weeklyDeliveries.map((row) => ({ label: row.week.slice(0, 10), value: row.count }))} color="bg-primary/80" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">任务状态分布（近 30 天）</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <DistributionList rows={data.executionQuality.statusCounts.map((row) => ({ label: row.status, value: row.count }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">失败原因 Top（近 30 天）</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <DistributionList rows={data.executionQuality.failureCodes.map((row) => ({ label: row.code, value: row.count }))} color="bg-destructive/70" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">执行效率</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 p-4">
              <MetricCard label="完成数" value={String(data.executionQuality.completed)} />
              <MetricCard label="真实交付数" value={String(data.executionQuality.delivered)} />
              <MetricCard label="重试率" value={`${data.executionQuality.retryRate}%`} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ 增长 ============ */}
        <TabsContent value="growth" className="space-y-5 pt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="WAU（近 7 天）" value={String(data.activeUsers.wau)} />
            <MetricCard label="MAU（近 30 天）" value={String(data.activeUsers.mau)} />
            <MetricCard label="总用户" value={String(data.activeUsers.totalUsers)} />
            <MetricCard label="7 日回访率" value={data.activeUsers.totalUsers > 0 ? `${Math.round((data.activeUsers.wau / data.activeUsers.totalUsers) * 100)}%` : '—'} />
          </div>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">激活漏斗转化率</CardTitle>
              <CardDescription className="text-xs">每一步相对上一步的转化 %</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {funnelSteps.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>
              )}
              {funnelSteps.map((step, index) => (
                <div key={step.type} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate font-mono text-xs text-muted-foreground">{EVENT_TYPE_LABELS[step.type] ?? step.type}</span>
                  <span className="w-12 shrink-0 text-right font-medium">{step.count}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, Math.round((step.count / maxFunnelCount) * 100))}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {index === 0 ? '—' : step.conversion == null ? '—' : `${step.conversion}%`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">周留存（W1 / W2）</CardTitle>
                <CardDescription className="text-xs">注册 8-30 天的 cohort {data.weeklyRetention.cohort} 人</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 p-4">
                <MetricCard label="W1 次周留存" value={`${data.weeklyRetention.w1}%`} />
                <MetricCard label="W2 两周留存" value={`${data.weeklyRetention.w2}%`} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">渠道会话分布</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <DistributionList rows={data.channels.map((row) => ({ label: row.channel, value: row.conversations }))} color="bg-emerald-500/70" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ 平台 ============ */}
        <TabsContent value="platform" className="space-y-5 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="执行器总数" value={String(data.executors.total)} />
            <MetricCard label="在线执行器" value={String(data.executors.online)} />
            <MetricCard label="反馈总数" value={String(data.feedback.total)} sub={`${data.feedback.open} 条待处理`} />
          </div>

          <Card>
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm font-semibold">执行器在线趋势（近 30 天）</CardTitle>
              <CardDescription className="text-xs">按天去重：当天发过心跳的执行器数</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              {data.executors.onlineTrend.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无心跳数据</p>
              ) : (
                <VerticalBars rows={data.executors.onlineTrend.map((row) => ({ label: row.date, value: row.count }))} color="bg-emerald-500/80" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">执行器运行时分布</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <DistributionList rows={data.executors.byRuntimeClass.map((row) => ({ label: row.runtimeClass, value: row.count }))} color="bg-sky-500/70" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b px-4 py-3">
                <CardTitle className="text-sm font-semibold">用户反馈类型</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <DistributionList rows={data.feedback.byType.map((row) => ({ label: row.type, value: row.count }))} color="bg-amber-500/70" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-sm', color)} />
      {label}
    </span>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function DistributionList({ rows, color = 'bg-primary/70' }: { rows: Array<{ label: string; value: number }>; color?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div className="space-y-2.5">
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">暂无数据</p>
      ) : rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="truncate font-mono text-xs text-muted-foreground">{row.label}</span>
            <span className="ml-3 shrink-0 font-medium">{row.value}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.max(2, Math.round((row.value / max) * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function VerticalBars({ rows, color }: { rows: Array<{ label: string; value: number }>; color: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-1 flex-col items-center gap-1" title={`${row.label}: ${row.value}`}>
            <span className="text-[11px] font-medium text-muted-foreground">{row.value || ''}</span>
            <div className={cn('w-full rounded-t', color)} style={{ height: `${Math.max(4, Math.round((row.value / max) * 100))}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {rows.map((row) => (
          <span key={row.label} className="flex-1 truncate text-center text-[10px] text-muted-foreground">{row.label}</span>
        ))}
      </div>
    </div>
  )
}

function DoubleBars({ rows, colors, labelEvery = 1, scale = 'auto' }: { rows: Array<{ label: string; a: number; b: number; dimA?: boolean; dimB?: boolean }>; colors: [string, string]; labelEvery?: number; scale?: 'auto' | 'percent' }) {
  const max = scale === 'percent' ? 100 : Math.max(1, ...rows.flatMap((row) => [row.a, row.b]))
  const heightOf = (value: number) => scale === 'percent'
    ? `${Math.max(4, Math.min(100, value))}%`
    : `${Math.max(4, Math.round((value / max) * 100))}%`
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex h-full flex-1 items-end gap-px" title={`${row.label}: ${row.a} / ${row.b}`}>
            <div className={cn('flex-1 rounded-t', colors[0])} style={{ height: heightOf(row.a), opacity: row.dimA ? 0.15 : 1 }} />
            <div className={cn('flex-1 rounded-t', colors[1])} style={{ height: heightOf(row.b), opacity: row.dimB ? 0.15 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {rows.map((row, index) => (
          <span key={row.label} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
            {index % labelEvery === 0 ? row.label.slice(5) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function TripleBars({ rows, colors }: { rows: Array<{ label: string; a: number; b: number; c: number }>; colors: [string, string, string] }) {
  const labelEvery = Math.max(1, Math.floor(rows.length / 14))
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {rows.map((row) => {
          const max = Math.max(1, row.a, row.b, row.c)
          return (
            <div key={row.label} className="flex h-full flex-1 items-end gap-px" title={`${row.label}: ${row.a} / ${row.b} / ${row.c}`}>
              <div className={cn('flex-1 rounded-t', colors[0])} style={{ height: `${Math.max(4, Math.round((row.a / max) * 100))}%` }} />
              <div className={cn('flex-1 rounded-t', colors[1])} style={{ height: `${Math.max(4, Math.round((row.b / max) * 100))}%` }} />
              <div className={cn('flex-1 rounded-t', colors[2])} style={{ height: `${Math.max(4, Math.round((row.c / max) * 100))}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {rows.map((row, index) => (
          <span key={row.label} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
            {index % labelEvery === 0 ? row.label.slice(5) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
