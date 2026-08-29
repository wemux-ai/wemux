import { cn } from '../../lib/utils'
import { TaskStatusIcon } from '../task-status-icon'
import type { TaskStatus } from '@shared/types'

interface KanbanColumnProps {
  status: TaskStatus
  title: string
  count: number
  className?: string
  isDropTarget?: boolean
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
  children: React.ReactNode
}

const columnTone: Record<string, { icon: string; text: string; column: string; active: string }> = {
  backlog: {
    icon: 'border-zinc-500',
    text: 'text-zinc-300',
    column: 'bg-zinc-900/58',
    active: 'bg-zinc-800/72',
  },
  todo: {
    icon: 'border-zinc-400',
    text: 'text-zinc-200',
    column: 'bg-zinc-900/58',
    active: 'bg-zinc-800/72',
  },
  in_progress: {
    icon: 'border-amber-400 bg-amber-400/20',
    text: 'text-zinc-100',
    column: 'bg-amber-950/22',
    active: 'bg-amber-900/30',
  },
  in_review: {
    icon: 'border-emerald-400 bg-emerald-400/18',
    text: 'text-zinc-100',
    column: 'bg-emerald-950/20',
    active: 'bg-emerald-900/30',
  },
  done: {
    icon: 'border-sky-400 bg-sky-400',
    text: 'text-zinc-100',
    column: 'bg-sky-950/24',
    active: 'bg-sky-900/32',
  },
  blocked: {
    icon: 'border-rose-400 bg-rose-400/14',
    text: 'text-zinc-100',
    column: 'bg-rose-950/25',
    active: 'bg-rose-900/32',
  },
}

export function KanbanColumn({
  status,
  title,
  count,
  className,
  isDropTarget = false,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: KanbanColumnProps) {
  const tone = columnTone[status] ?? columnTone.backlog

  return (
    <div
      className={cn(
        'flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-900/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]',
        tone.column,
        isDropTarget && tone.active,
        className,
      )}
    >
      <div className="flex h-11 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <TaskStatusIcon status={status} size={14} />
          <h3 className={cn('truncate text-[13px] font-semibold leading-none', tone.text)}>{title}</h3>
          <span className="text-[12px] font-semibold leading-none text-zinc-500">{count}</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-500">
          <button type="button" className="grid size-5 place-items-center rounded text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200" aria-label={`${title} 更多`}>
            <span className="leading-none">...</span>
          </button>
          <button type="button" className="grid size-5 place-items-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200" aria-label={`${title} 新建`}>
            +
          </button>
        </div>
      </div>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'scrollbar-subtle min-h-[10rem] min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4 pt-1.5 transition-colors sm:min-h-[16rem]',
        )}
      >
        <div className="flex flex-col gap-2.5">
          {children}
        </div>
      </div>
    </div>
  )
}
