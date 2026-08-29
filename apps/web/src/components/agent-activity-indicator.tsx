/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Canonical AgentRunningStatus values and an optional accessible label.
 * [OUTPUT]: Stable icon or dot affordance for Agent lifecycle state, with motion only while work is active.
 * [POS]: Web-wide visual adapter for Agent activity; task, runtime, and generic async indicators remain separate.
 */
import { Bot, Brain, Check, Clock3, Terminal, XCircle, type LucideIcon } from 'lucide-react'
import type { AgentRunningStatus } from '@shared/types'
import { cn } from '../lib/utils'

type AgentActivityIndicatorSize = 'xs' | 'sm' | 'md'

type AgentActivityVisual = {
  icon: LucideIcon
  iconTone: string
  dotTone: string
  live: boolean
}

type AgentActivityIndicatorProps = {
  status: AgentRunningStatus
  variant?: 'icon' | 'dot'
  size?: AgentActivityIndicatorSize
  className?: string
  ariaLabel?: string
}

const iconSizeClass: Record<AgentActivityIndicatorSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
}

const dotSizeClass: Record<AgentActivityIndicatorSize, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
}

export const agentActivityVisuals: Record<AgentRunningStatus, AgentActivityVisual> = {
  idle: {
    icon: Bot,
    iconTone: 'text-zinc-500',
    dotTone: 'bg-zinc-500',
    live: false,
  },
  thinking: {
    icon: Brain,
    iconTone: 'text-sky-300',
    dotTone: 'bg-sky-400',
    live: true,
  },
  executing: {
    icon: Terminal,
    iconTone: 'text-sky-300',
    dotTone: 'bg-sky-400',
    live: true,
  },
  waiting: {
    icon: Clock3,
    iconTone: 'text-amber-300',
    dotTone: 'bg-amber-400',
    live: false,
  },
  complete: {
    icon: Check,
    iconTone: 'text-emerald-300',
    dotTone: 'bg-emerald-400',
    live: false,
  },
  error: {
    icon: XCircle,
    iconTone: 'text-rose-300',
    dotTone: 'bg-rose-400',
    live: false,
  },
}

export function AgentActivityIndicator({
  status,
  variant = 'icon',
  size = 'sm',
  className,
  ariaLabel,
}: AgentActivityIndicatorProps) {
  const visual = agentActivityVisuals[status]
  const Icon = visual.icon
  const accessibilityProps = ariaLabel
    ? { role: 'img' as const, 'aria-label': ariaLabel }
    : { 'aria-hidden': true }

  if (variant === 'dot') {
    return (
      <span className={cn('relative inline-flex shrink-0', className)} {...accessibilityProps}>
        <span className={cn('block rounded-full', dotSizeClass[size], visual.dotTone)} />
        {visual.live ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping',
              visual.dotTone,
            )}
          />
        ) : null}
      </span>
    )
  }

  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} {...accessibilityProps}>
      <Icon
        className={cn(
          iconSizeClass[size],
          visual.iconTone,
          status === 'thinking' && 'motion-safe:animate-pulse',
        )}
      />
      {visual.live ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full opacity-70 motion-safe:animate-ping',
            dotSizeClass.xs,
            visual.dotTone,
          )}
        />
      ) : null}
    </span>
  )
}
