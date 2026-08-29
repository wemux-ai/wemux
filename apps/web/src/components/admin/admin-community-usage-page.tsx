// [INPUT]: GET /api/admin/community-usage 聚合数据
// [OUTPUT]: /admin/community 社区版遥测看板（安装/活跃/版本分布/counter 汇总/最近安装表）
// [POS]: admin 社区版使用上报只读视图；collector 数据为空时展示引导空态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { Globe, RefreshCw } from 'lucide-react'
import type { AdminCommunityUsageSummary } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Badge } from '@/components/ui-admin/badge'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/react'

interface Props {
  data: AdminCommunityUsageSummary | null
  error: string | null
}

const formatNumber = (value: number) => new Intl.NumberFormat().format(value)

export function AdminCommunityUsagePage({ data, error }: Props) {
  const { t } = useTranslation()

  if (error) {
    return (
      <div className="space-y-5">
        <Header />
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <Header />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> {t('communityUsage.loading')}
        </p>
      </div>
    )
  }

  const statCards = [
    { label: t('communityUsage.totalInstalls'), value: data.totals.installs },
    { label: t('communityUsage.active7d'), value: data.totals.active7d },
    { label: t('communityUsage.active30d'), value: data.totals.active30d },
    { label: t('communityUsage.new7d'), value: data.totals.new7d },
    { label: t('communityUsage.reports'), value: data.totals.reports },
  ]

  const counterCards = [
    { label: t('communityUsage.usersTotal'), value: data.latestCounters.users },
    { label: t('communityUsage.teamsTotal'), value: data.latestCounters.teams },
    { label: t('communityUsage.tasksTotal'), value: data.latestCounters.tasks },
    { label: t('communityUsage.conversationsTotal'), value: data.latestCounters.conversations },
    { label: t('communityUsage.agentRunsTotal'), value: data.latestCounters.agentRuns },
  ]

  return (
    <div className="space-y-5">
      <Header />
      <p className="text-sm text-muted-foreground">{t('communityUsage.description')}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-1">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{formatNumber(stat.value)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">{t('communityUsage.countersTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {counterCards.map((stat) => (
            <Card key={stat.label}>
              <CardHeader className="pb-1">
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-xl tabular-nums">{formatNumber(stat.value)}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('communityUsage.versionsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.versions.length === 0 && (
              <EmptyHint text={t('communityUsage.empty')} />
            )}
            {data.versions.map((item) => (
              <div key={item.version} className="flex items-center justify-between gap-3 text-sm">
                <Badge variant="outline" className="font-mono">{item.version}</Badge>
                <span className="tabular-nums text-muted-foreground">{formatNumber(item.installs)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('communityUsage.dailyTitle')}</CardTitle>
            <CardDescription>{t('communityUsage.dailyDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.dailyReports.length === 0 && <EmptyHint text={t('communityUsage.empty')} />}
            {data.dailyReports.length > 0 && (
              <div className="flex h-28 items-end gap-1" aria-hidden>
                {data.dailyReports.map((day) => {
                  const max = Math.max(...data.dailyReports.map((d) => d.reports), 1)
                  return (
                    <div
                      key={day.date}
                      title={`${day.date}: ${day.reports} reports / ${day.installs} installs`}
                      className="flex-1 rounded-sm bg-primary/70"
                      style={{ height: `${Math.max((day.reports / max) * 100, 4)}%` }}
                    />
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('communityUsage.recentTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentInstalls.length === 0 && <EmptyHint text={t('communityUsage.empty')} />}
          {data.recentInstalls.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('communityUsage.installId')}</th>
                    <th className="py-2 pr-3 font-medium">Version</th>
                    <th className="py-2 pr-3 font-medium">OS</th>
                    <th className="py-2 pr-3 font-medium">{t('communityUsage.firstSeen')}</th>
                    <th className="py-2 pr-3 font-medium">{t('communityUsage.lastSeen')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('communityUsage.usersTotal')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('communityUsage.tasksTotal')}</th>
                    <th className="py-2 text-right font-medium">{t('communityUsage.agentRunsTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInstalls.map((install) => (
                    <tr key={install.installId} className="border-b last:border-0">
                      <td className="max-w-40 truncate py-2 pr-3 font-mono text-xs" title={install.installId}>{install.installId}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{install.version}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{install.os || '—'}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{formatDate(install.firstSeenAt)}</td>
                      <td className={cn('py-2 pr-3 text-xs', isRecent(install.lastSeenAt) ? 'text-emerald-500' : 'text-muted-foreground')}>{formatDate(install.lastSeenAt)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(install.usersTotal)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(install.tasksTotal)}</td>
                      <td className="py-2 text-right tabular-nums">{formatNumber(install.agentRunsTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const DAY_MS = 86_400_000

const isRecent = (iso: string) => Date.now() - Date.parse(iso) <= 7 * DAY_MS

const formatDate = (iso: string) => {
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : iso
}

function Header() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <Globe className="h-5 w-5 text-muted-foreground" />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('communityUsage.title')}</h1>
      </div>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-4 text-center text-xs text-muted-foreground">{text}</p>
}
