import { type CSSProperties, type ReactNode } from 'react'

import { cn } from '../../lib/utils'
import { Card, CardContent } from './card'

const studioTheme = {
  mcp: {
    badgeClassName: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
    iconClassName: 'border-cyan-400/20 bg-cyan-400/12 text-cyan-100 shadow-[0_0_40px_rgba(34,211,238,0.18)]',
    metricClassName: 'border-cyan-400/16 bg-cyan-400/8',
    glow: 'rgba(34,211,238,0.24)',
    stroke: 'rgba(34,211,238,0.16)',
  },
  skills: {
    badgeClassName: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    iconClassName: 'border-emerald-400/20 bg-emerald-400/12 text-emerald-100 shadow-[0_0_40px_rgba(16,185,129,0.18)]',
    metricClassName: 'border-emerald-400/16 bg-emerald-400/8',
    glow: 'rgba(16,185,129,0.22)',
    stroke: 'rgba(16,185,129,0.15)',
  },
} as const

type StudioTheme = keyof typeof studioTheme

type StudioMetric = {
  label: string
  note?: string
  value: string
}

export function StudioShell({
  actions,
  badge,
  children,
  className,
  description,
  icon,
  metrics,
  theme,
  title,
}: {
  actions?: ReactNode
  badge: string
  children: ReactNode
  className?: string
  description: string
  icon: ReactNode
  metrics: StudioMetric[]
  theme: StudioTheme
  title: string
}) {
  const palette = studioTheme[theme]
  const shellStyle = {
    '--studio-glow': palette.glow,
    '--studio-stroke': palette.stroke,
  } as CSSProperties

  return (
    <Card className={cn('overflow-hidden border-zinc-800/80 bg-[#040507] text-zinc-100 shadow-[0_28px_100px_rgba(0,0,0,0.45)]', className)}>
      <CardContent className="p-0">
        <div style={shellStyle} className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--studio-glow),transparent_42%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent_24%)] opacity-40" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:32px_32px] opacity-20 [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9),transparent)]" />
          <div className="absolute inset-x-0 top-0 h-56 border-b border-[color:var(--studio-stroke)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]" />

          <div className="relative p-4 md:p-6">
            <section className="rounded-[30px] border border-[color:var(--studio-stroke)] bg-black/25 p-5 backdrop-blur md:p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                  <div className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.28em]', palette.badgeClassName)}>
                    {badge}
                  </div>
                  <div className="mt-4 flex items-start gap-4">
                    <div className={cn('rounded-[22px] border p-4', palette.iconClassName)}>
                      {icon}
                    </div>
                    <div>
                      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 md:text-[2.4rem]">{title}</h1>
                      <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300 md:text-[15px]">
                        {description}
                      </p>
                    </div>
                  </div>
                </div>

                {actions ? (
                  <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                    {actions}
                  </div>
                ) : null}
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className={cn(
                      'rounded-[22px] border px-4 py-4 backdrop-blur transition-transform duration-200 hover:-translate-y-0.5',
                      palette.metricClassName,
                    )}
                  >
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-400">{metric.label}</p>
                    <div className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">{metric.value}</div>
                    {metric.note ? <p className="mt-2 text-xs leading-6 text-zinc-400">{metric.note}</p> : null}
                  </div>
                ))}
              </div>
            </section>

            <div className="mt-5">{children}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
