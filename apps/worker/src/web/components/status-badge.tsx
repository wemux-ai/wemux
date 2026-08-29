import React from 'react'
import type { StatusTone } from '../worker-console-types'

type StatusBadgeProps = {
  label: string
  value: string
  tone?: StatusTone
}

const toneClassMap: Record<StatusTone, string> = {
  neutral: 'border-white/10 bg-black/20 text-zinc-200',
  success: 'border-emerald-500/25 bg-emerald-950/25 text-emerald-100',
  warning: 'border-amber-500/25 bg-amber-950/25 text-amber-100',
  danger: 'border-rose-500/25 bg-rose-950/25 text-rose-100',
}

const dotClassMap: Record<StatusTone, string> = {
  neutral: 'bg-zinc-500',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
}

export const StatusBadge = ({ label, value, tone = 'neutral' }: StatusBadgeProps) => {
  return (
    <div className={`rounded-[12px] border px-3 py-2.5 ${toneClassMap[tone]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotClassMap[tone]}`} />
        <div className="text-[11px] uppercase tracking-[0.1em] opacity-70">{label}</div>
      </div>
      <div className="mt-1.5 text-sm font-semibold">{value}</div>
    </div>
  )
}
