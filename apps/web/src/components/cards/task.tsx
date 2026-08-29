import type { MouseEvent } from 'react'
import { TaskPullRequestBadge } from '../task-pull-request-badge'
import { cn, formatDate, formatExecutionModelLabel, statusMeta, agentMeta } from "../../lib/utils"
import { useTranslation } from '../../lib/i18n/react'
import { RuntimeLabel } from '../runtime/runtime-icons'
import type { Task } from "@shared/types"

const priorityLabel: Record<Task['priority'], string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

export const TaskCard = ({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) => {
  const { t } = useTranslation()
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const prTarget = event.target instanceof Node
      ? (event.target instanceof Element ? event.target : event.target.parentElement)?.closest('[data-task-pull-request-url]')
      : null
    const pullRequestUrl = prTarget?.getAttribute('data-task-pull-request-url')?.trim()

    if (pullRequestUrl) {
      window.open(pullRequestUrl, '_blank', 'noopener,noreferrer')
      return
    }

    onClick()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-primary bg-muted' : 'border-input bg-background hover:bg-muted'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium line-clamp-2">{task.title}</p>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', agentMeta[task.agentType].soft, agentMeta[task.agentType].accent)}>
          <RuntimeLabel runtime={task.agentType} size={12} labelClassName="text-inherit" />
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      {task.executionModel && <p className="mt-2 text-[11px] text-muted-foreground">{t('task.model')}: {formatExecutionModelLabel(task.executionModel)}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TaskPullRequestBadge task={task} compact asLink />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground/60">
        <span>{formatDate(task.updatedAt)}</span>
        <span>{task.retryCount > 0 ? t('task.retryCount', { count: task.retryCount }) : `${t('task.priority')}: ${priorityLabel[task.priority]}`}</span>
      </div>
    </button>
  )
}

export const KanbanColumn = ({ 
  title, 
  subtitle, 
  count, 
  children, 
  onDragOver, 
  onDrop 
}: { 
  title: string; 
  subtitle: string; 
  count: number; 
  children: React.ReactNode;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
}) => (
  <div 
    className="flex flex-col rounded-lg border border-border bg-muted/30"
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
    <div className="flex items-center justify-between border-b border-border p-3">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{count}</span>
    </div>
    <div className="flex-1 space-y-2 p-2">
      {children}
    </div>
  </div>
)
