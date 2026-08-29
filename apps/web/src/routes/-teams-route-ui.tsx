// [INPUT]: 团队页 UI 输入
// [OUTPUT]: 团队 UI
// [POS]: 团队路由 UI
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ReactNode } from 'react'
import { Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/react'

export function TopStat({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1.5 text-lg font-semibold text-zinc-50">{value}</p>
      <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{subtext}</p>
    </div>
  )
}

export function InfoStat({ label, value, subtext }: { label: string; value: string; subtext: string }) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none">
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-zinc-50">{value}</p>
        <p className="mt-1.5 text-xs leading-5 text-zinc-500">{subtext}</p>
      </CardContent>
    </Card>
  )
}

export function SectionPanel({
  title,
  description,
  children,
  className,
}: {
  title: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('border-zinc-800 bg-zinc-950/75 text-zinc-100 shadow-none', className)}>
      <CardContent className="space-y-4 p-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-50">{title}</h3>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">{description}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">{children}</div>
}

export function ListArea({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5">{children}</div>
}

export function RowCard({
  leading,
  title,
  subtitle,
  actions,
  children,
}: {
  leading: ReactNode
  title: string
  subtitle: string
  actions: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">{title}</p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
      <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">{actions}</div>
    </div>
  )
}

export function EmptyAside() {
  const { t } = useTranslation()

  return (
    <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center">
      <Users className="mx-auto h-10 w-10 text-zinc-600" />
      <p className="mt-3 text-sm text-zinc-400">{t('teamsPage.empty.noTeams')}</p>
      <p className="mt-1 text-xs text-zinc-500">{t('teamsPage.empty.createFirstTeam')}</p>
    </div>
  )
}

export function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="border border-dashed border-zinc-800 bg-[#09090b] px-4 py-10 text-center text-zinc-500">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-600">{icon}</div>
      <p className="mt-3 text-sm">{text}</p>
    </div>
  )
}

export function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation()
  const tones: Record<string, string> = {
    owner: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    admin: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
    member: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    viewer: 'border-zinc-800 bg-zinc-950 text-zinc-300',
  }

  return <Badge className={tones[role] || tones.viewer}>{t(`teamsPage.roles.${role}`)}</Badge>
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    pending: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    accepted: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    declined: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    expired: 'border-zinc-800 bg-zinc-950 text-zinc-300',
  }

  return <Badge className={tones[status] || tones.expired}>{status}</Badge>
}
