import type { ReactNode } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'

type CapabilityBadge = {
  label: string
  className?: string
}

type CapabilityCardProps = {
  actionLabel?: string
  badges?: CapabilityBadge[]
  children?: ReactNode
  className?: string
  description?: string
  meta?: string
  onClick?: () => void
  selected?: boolean
  status?: CapabilityBadge
  title: string
  warning?: string
}

const baseClassName = 'w-full rounded-md border px-3 py-2.5 text-left transition-colors'

export function CapabilityCard({
  actionLabel,
  badges = [],
  children,
  className,
  description,
  meta,
  onClick,
  selected = false,
  status,
  title,
  warning,
}: CapabilityCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-100">{title}</p>
            {status ? (
              <Badge className={cn('text-[10px]', status.className)}>
                {status.label}
              </Badge>
            ) : null}
          </div>
          {description ? (
            <p className={cn('mt-2 line-clamp-2 text-xs leading-5', selected ? 'text-zinc-300' : 'text-zinc-500')}>
              {description}
            </p>
          ) : null}
        </div>
        {actionLabel ? (
          <Badge className={selected ? 'border-zinc-700 bg-zinc-800 text-zinc-100' : 'border-zinc-800 bg-zinc-950 text-zinc-400'}>
            {actionLabel}
          </Badge>
        ) : onClick ? (
          <ChevronRight size={14} className={selected ? 'text-zinc-300' : 'text-zinc-500'} />
        ) : null}
      </div>

      {badges.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((badge, index) => (
            <Badge key={`${badge.label}-${index + 1}`} className={cn('text-[10px]', badge.className)}>
              {badge.label}
            </Badge>
          ))}
        </div>
      ) : null}

      {meta ? (
        <p className={cn('mt-3 truncate text-[11px]', selected ? 'text-zinc-300' : 'text-zinc-500')}>
          {meta}
        </p>
      ) : null}

      {warning ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warning}</span>
        </div>
      ) : null}

      {children ? <div className="mt-4 space-y-4">{children}</div> : null}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          baseClassName,
          selected
            ? 'border-zinc-700 bg-zinc-900 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
            : 'border-zinc-800 bg-[#09090b] text-zinc-100 hover:border-zinc-700 hover:bg-zinc-900',
          className,
        )}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className={cn(
        baseClassName,
        selected
          ? 'border-zinc-700 bg-zinc-900 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]'
          : 'border-zinc-800 bg-zinc-950/70 text-zinc-100',
        className,
      )}
    >
      {content}
    </div>
  )
}
