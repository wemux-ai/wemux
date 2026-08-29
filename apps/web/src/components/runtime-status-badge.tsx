import { cn } from '../lib/utils'
import { useTranslation } from '../lib/i18n/react'
import { getTaskRuntimePhase, type ProjectRuntimeSummary } from '../lib/runtime-status'
import type { Task } from '@shared/types'
import { issueStatusIcon } from '../lib/status-colors'

const runtimeStatusKeyframes = `
@keyframes runtime-dot-core {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.04);
  }
}

@keyframes runtime-dot-halo {
  0%, 100% {
    opacity: 0.28;
    transform: scale(0.92);
  }
  50% {
    opacity: 0.72;
    transform: scale(1.5);
  }
}

@keyframes runtime-dot-running-core {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.42), 0 0 8px rgba(56, 189, 248, 0.68);
    transform: scale(0.95);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.16), 0 0 16px rgba(56, 189, 248, 0.9);
    transform: scale(1.08);
  }
}

@keyframes runtime-dot-running-halo {
  0%, 100% {
    opacity: 0.24;
    transform: scale(0.9);
  }
  50% {
    opacity: 0.88;
    transform: scale(1.75);
  }
}
`

type RuntimeStatusBadgeProps = {
  className?: string
  compact?: boolean
  projectSummary?: ProjectRuntimeSummary
  showText?: boolean
  task?: Task
  attentionCountLabel?: string
  attentionLabel?: string
  activeAgentEvent?: boolean
}

export function RuntimeStatusBadge({
  className,
  compact = false,
  projectSummary,
  showText = false,
  task,
  attentionCountLabel,
  attentionLabel,
  activeAgentEvent = false,
}: RuntimeStatusBadgeProps) {
  const { t } = useTranslation()
  const phase = task ? getTaskRuntimePhase(task, activeAgentEvent) : projectSummary?.phase ?? 'idle'

  const runningCount = projectSummary?.runningCount ?? (phase === 'running' ? 1 : 0)
  const attentionCount = projectSummary?.attentionCount ?? (phase === 'attention' ? 1 : 0)
  const resolvedAttentionCountLabel = attentionCountLabel ?? t('runtime.attentionCount', { count: attentionCount })
  const resolvedAttentionLabel = attentionLabel ?? t('runtime.attention')

  if (runningCount === 0 && attentionCount === 0) {
    return null
  }

  const title = [
    runningCount > 0 ? t('runtime.runningCount', { count: runningCount }) : null,
    attentionCount > 0 ? resolvedAttentionCountLabel : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <style>{runtimeStatusKeyframes}</style>
      <span
        aria-label={title}
        className={cn(
          'inline-flex items-center gap-1.5',
          className,
        )}
        title={title}
      >
        {runningCount > 0 ? <StatusDot tone="running" compact={compact} /> : null}
        {attentionCount > 0 ? <StatusDot tone="attention" compact={compact} /> : null}
        {showText ? (
          <span className="text-[10px] font-medium text-zinc-400">
            {projectSummary
              ? [runningCount > 0 ? t('runtime.developingCount', { count: runningCount }) : null, attentionCount > 0 ? resolvedAttentionCountLabel : null]
                  .filter(Boolean)
                  .join(' · ')
              : phase === 'running'
                ? t('runtime.developing')
                : resolvedAttentionLabel}
          </span>
        ) : null}
      </span>
    </>
  )
}

function StatusDot({ tone, compact }: { tone: 'running' | 'attention'; compact: boolean }) {
  const pulseClassName = tone === 'running' ? 'bg-sky-400/55' : 'bg-amber-400/30'
  const dotColor = tone === 'running' ? '#38bdf8' : '#fbbf24'
  const dotClassName = tone === 'running'
    ? 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.7)]'
    : 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.65)]'
  const sizeClassName = compact ? 'h-2.5 w-2.5' : 'h-3 w-3'
  const haloSizeClassName = compact ? 'h-4 w-4' : 'h-5 w-5'
  const coreAnimation = tone === 'running'
    ? 'runtime-dot-running-core 1.25s ease-in-out infinite'
    : 'runtime-dot-core 1.35s ease-in-out infinite'
  const haloAnimation = tone === 'running'
    ? 'runtime-dot-running-halo 1.25s ease-out infinite'
    : 'runtime-dot-halo 1.35s ease-out infinite'

  return (
    <span className={cn('relative isolate flex items-center justify-center', sizeClassName)}>
      <span
        className={cn('absolute rounded-full z-0', haloSizeClassName, pulseClassName)}
        style={{ animation: haloAnimation }}
      />
      <span
        className={cn('relative z-10 rounded-full', sizeClassName, dotClassName)}
        style={{ animation: coreAnimation, backgroundColor: dotColor }}
      />
    </span>
  )
}
