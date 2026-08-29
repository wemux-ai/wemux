/**
 * Canonical status color definitions following Paperclip design.
 * Every component that renders a status indicator should import from here.
 *
 * Linear-style icon colors (HSL values for consistency)
 */

// StatusIcon: circle with border color (for inline status dots)
export const issueStatusIcon: Record<string, string> = {
  backlog: 'text-zinc-500 border-zinc-500',
  todo: 'text-blue-500 border-blue-500 dark:text-blue-400 dark:border-blue-400',
  in_progress: 'text-amber-500 border-amber-500 dark:text-amber-400 dark:border-amber-400',
  in_review: 'text-violet-500 border-violet-500 dark:text-violet-400 dark:border-violet-400',
  done: 'text-emerald-500 border-emerald-500 dark:text-emerald-400 dark:border-emerald-400',
  blocked: 'text-red-500 border-red-500 dark:text-red-400 dark:border-red-400',
  cancelled: 'text-zinc-400 border-zinc-400 dark:text-zinc-500 dark:border-zinc-500',
}

export const issueStatusIconDefault = 'text-zinc-500 border-zinc-500'

// StatusBadge: pill with background fill
export const statusBadge: Record<string, string> = {
  backlog: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  todo: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  in_review: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  cancelled: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

export const statusBadgeDefault = 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'

// Kanban column colors
export const kanbanColumnColors: Record<string, { dot: string; ring: string; bg: string }> = {
  backlog: { dot: 'bg-zinc-400', ring: 'border-zinc-700', bg: 'bg-zinc-900/50' },
  todo: { dot: 'bg-blue-400', ring: 'border-blue-500/30', bg: 'bg-blue-950/30' },
  in_progress: { dot: 'bg-amber-400', ring: 'border-amber-500/30', bg: 'bg-amber-950/30' },
  in_review: { dot: 'bg-violet-400', ring: 'border-violet-500/30', bg: 'bg-violet-950/30' },
  done: { dot: 'bg-emerald-400', ring: 'border-emerald-500/30', bg: 'bg-emerald-950/30' },
  blocked: { dot: 'bg-red-400', ring: 'border-red-500/30', bg: 'bg-red-950/30' },
  cancelled: { dot: 'bg-zinc-400', ring: 'border-zinc-700', bg: 'bg-zinc-900/50' },
}

// Linear-style SVG icon colors
export const linearIconColors: Record<string, { stroke: string; fill: string }> = {
  backlog: { stroke: '#8b95a5', fill: 'none' },
  todo: { stroke: '#6e7b91', fill: 'none' },
  in_progress: { stroke: '#e89b3e', fill: '#e89b3e' },
  in_review: { stroke: '#a87be0', fill: '#a87be0' },
  done: { stroke: '#4ade80', fill: '#4ade80' },
  blocked: { stroke: '#f87171', fill: 'none' },
  cancelled: { stroke: '#8b95a5', fill: 'none' },
}
