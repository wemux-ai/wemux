import { Rocket } from 'lucide-react'
import { resolveRailwayDeploymentDisplay, type RailwayDeploymentDisplay } from '../lib/railway-deployment'
import { cn } from '../lib/utils'

export function RailwayDeploymentBadge({
  deployment,
  display,
  className,
  compact = false,
  asLink = false,
}: {
  deployment?: Parameters<typeof resolveRailwayDeploymentDisplay>[0]
  display?: RailwayDeploymentDisplay | null
  className?: string
  compact?: boolean
  asLink?: boolean
}) {
  const resolvedDisplay = display === undefined
    ? resolveRailwayDeploymentDisplay(deployment)
    : display
  if (!resolvedDisplay) {
    return null
  }

  const identity = typeof resolvedDisplay.prNumber === 'number'
    ? `#${resolvedDisplay.prNumber}`
    : resolvedDisplay.environmentName

  const content = (
    <>
      <Rocket className="h-3 w-3 shrink-0" />
      <span className="truncate">{compact ? resolvedDisplay.compactLabel : resolvedDisplay.label}</span>
      <span className="shrink-0 font-mono tabular-nums">{identity}</span>
    </>
  )

  const badgeClassName = cn(
    'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
    resolvedDisplay.toneClassName,
    className,
  )

  if (asLink && resolvedDisplay.url) {
    return (
      <a
        href={resolvedDisplay.url}
        target="_blank"
        rel="noopener noreferrer"
        className={badgeClassName}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    )
  }

  return (
    <span
      data-railway-deployment-url={resolvedDisplay.url ?? ''}
      className={badgeClassName}
      title={resolvedDisplay.url ?? (typeof resolvedDisplay.prNumber === 'number' ? `${resolvedDisplay.label} #${resolvedDisplay.prNumber}` : resolvedDisplay.label)}
    >
      {content}
    </span>
  )
}
