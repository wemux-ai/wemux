import { GitMerge, GitPullRequest } from 'lucide-react'
import { resolveTaskPullRequestDisplay, type TaskPullRequestDisplay } from '../lib/task-pull-request'
import { cn } from '../lib/utils'

export function TaskPullRequestBadge({
  task,
  display,
  className,
  compact = false,
  asLink = false,
}: {
  task?: Parameters<typeof resolveTaskPullRequestDisplay>[0]
  display?: TaskPullRequestDisplay | null
  className?: string
  compact?: boolean
  asLink?: boolean
}) {
  const resolvedDisplay = display === undefined
    ? resolveTaskPullRequestDisplay(task)
    : display
  if (!resolvedDisplay) {
    return null
  }

  const content = (
    <>
      {resolvedDisplay.icon === 'merged'
        ? <GitMerge className="h-3 w-3 shrink-0" />
        : <GitPullRequest className="h-3 w-3 shrink-0" />}
      <span className="truncate">{compact ? resolvedDisplay.compactLabel : resolvedDisplay.label}</span>
      {typeof resolvedDisplay.number === 'number' ? (
        <span className="shrink-0 font-mono tabular-nums">#{resolvedDisplay.number}</span>
      ) : null}
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
      data-task-pull-request-url={resolvedDisplay.url ?? ''}
      className={badgeClassName}
      title={resolvedDisplay.url ?? (typeof resolvedDisplay.number === 'number' ? `${resolvedDisplay.label} #${resolvedDisplay.number}` : resolvedDisplay.label)}
    >
      {content}
    </span>
  )
}
