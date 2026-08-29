import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import type { AgentAdapter } from '@shared/types'

export const MetricCard = ({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) => (
  <Card className="rounded-lg border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
    <CardContent className="p-4">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-[#09090b] text-zinc-300">{icon}</div>
      <div className="text-xl font-semibold text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </CardContent>
  </Card>
)

export const InfoCard = ({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) => (
  <Card className="rounded-lg border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
    <CardContent className="p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={cn('mt-2 text-sm text-zinc-100', multiline ? 'leading-6' : 'break-all')}>{value || '-'}</p>
    </CardContent>
  </Card>
)

export const AdapterCard = ({ adapter }: { adapter: AgentAdapter }) => {
  const { i18n, t } = useTranslation()
  const statusClassName =
    adapter.status === 'online'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
      : adapter.status === 'degraded'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
        : 'border-zinc-800 bg-zinc-950 text-zinc-300'
  const statusText = {
    online: t('adapter.status.online'),
    degraded: t('adapter.status.degraded'),
    offline: t('adapter.status.offline'),
  }[adapter.status]
  const locale = i18n.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'

  return (
    <Card className="overflow-hidden rounded-lg border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          {t('adapter.profile')}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-zinc-50">{adapter.name}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{adapter.transport}</p>
          </div>
          <Badge className={statusClassName}>{statusText}</Badge>
        </div>
        <div className="mt-4 rounded-lg border border-zinc-800 bg-[#09090b] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{t('adapter.lastHeartbeat')}</p>
          <p className="mt-2 text-sm text-zinc-300">{adapter.heartbeatAt ? new Date(adapter.heartbeatAt).toLocaleString(locale) : '-'}</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t('adapter.strengths')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {adapter.strengths.slice(0, 3).map((item) => (
                <span key={item} className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t('adapter.limitations')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {adapter.limitations.slice(0, 3).map((item) => (
                <span key={item} className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
