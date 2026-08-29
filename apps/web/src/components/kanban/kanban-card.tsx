import { Clock, User } from 'lucide-react'
import { RuntimeStatusBadge } from '../runtime-status-badge'
import { TaskPullRequestBadge } from '../task-pull-request-badge'
import type { TaskPullRequestDisplay } from '../../lib/task-pull-request'
import { cn, formatDate, normalizeTaskDisplayText } from '../../lib/utils'
import type { Task } from '@shared/types'
import type { ProjectAssignee } from '../../lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { resolveMediaUrl } from '../../lib/api'
import { IdentityCardWrapper } from '../profiles/identity-card-wrapper'
import { getTaskAssigneeOptionId } from '../../lib/project-collaboration-data'

interface KanbanCardProps {
  task: Task
  assignee?: ProjectAssignee
  isSelected: boolean
  isDragging?: boolean
  draggable?: boolean
  activeAgentEvent?: boolean
  pullRequestDisplay?: TaskPullRequestDisplay | null
  onClick: () => void
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: () => void
}

const priorityColors: Record<Task['priority'], string> = {
  none: 'text-zinc-500',
  low: 'text-emerald-400',
  medium: 'text-sky-400',
  high: 'text-amber-300',
  urgent: 'text-rose-400',
}

const PriorityIcon = ({ priority, className }: { priority: Task['priority']; className?: string }) => {
  const baseClass = cn('shrink-0', priorityColors[priority], className)
  
  switch (priority) {
    case 'urgent':
      return (
        <svg className={baseClass} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="7" y="4.5" width="2" height="5" rx="1" fill="currentColor" />
          <circle cx="8" cy="11.5" r="1" fill="currentColor" />
        </svg>
      )
    case 'high':
      return (
        <svg className={baseClass} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="8" width="3" height="6" rx="1.5" fill="currentColor" />
          <rect x="6.5" y="4.5" width="3" height="9.5" rx="1.5" fill="currentColor" />
          <rect x="11" y="1" width="3" height="13" rx="1.5" fill="currentColor" />
        </svg>
      )
    case 'medium':
      return (
        <svg className={baseClass} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="8" width="3" height="6" rx="1.5" fill="currentColor" />
          <rect x="6.5" y="4.5" width="3" height="9.5" rx="1.5" fill="currentColor" />
          <rect x="11" y="1" width="3" height="13" rx="1.5" fill="currentColor" opacity="0.35" />
        </svg>
      )
    case 'low':
      return (
        <svg className={baseClass} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="8" width="3" height="6" rx="1.5" fill="currentColor" />
          <rect x="6.5" y="4.5" width="3" height="9.5" rx="1.5" fill="currentColor" opacity="0.35" />
          <rect x="11" y="1" width="3" height="13" rx="1.5" fill="currentColor" opacity="0.35" />
        </svg>
      )
    default:
      return (
        <svg className={baseClass} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="6.5" width="12" height="2" rx="1" fill="currentColor" />
          <rect x="2" y="10" width="12" height="2" rx="1" fill="currentColor" />
        </svg>
      )
  }
}

const buildTaskIssueKey = (taskId: string) => {
  const compactId = taskId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()
  return `VMX-${compactId || 'TASK'}`
}

export function KanbanCard({ task, assignee, isSelected, isDragging = false, draggable = true, activeAgentEvent = false, pullRequestDisplay, onClick, onDragStart, onDragEnd }: KanbanCardProps) {
  const displayTitle = normalizeTaskDisplayText(task.title, '图片输入失败，请移除截图或切换支持视觉的模型')
  const displayDescription = normalizeTaskDisplayText(task.description, '创建任务时包含了当前模型不支持的图片输入，导致原始错误文案被写进任务内容。')
  const issueKey = buildTaskIssueKey(task.id)

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group min-w-0 max-w-full overflow-hidden rounded-lg border p-3 text-left',
        'border-zinc-800/85 bg-[#17181c] shadow-[0_1px_0_rgba(255,255,255,0.03)]',
        'transition-colors duration-150 ease-out',
        isDragging && 'opacity-40',
        isSelected
          ? 'border-zinc-500 bg-zinc-800/90'
          : 'hover:border-zinc-600 hover:bg-[#1b1c21]'
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-zinc-500">
          <PriorityIcon priority={task.priority} className="size-3.5" />
          <span className="truncate">{issueKey}</span>
        </div>
      </div>

      <p className="mb-1 min-w-0 text-[13px] font-semibold leading-snug text-zinc-100 line-clamp-2">{displayTitle}</p>

      <p className="mb-2.5 min-w-0 text-[11px] leading-5 text-zinc-500 line-clamp-2">{displayDescription}</p>

      <div className="mb-3 flex flex-wrap items-center gap-1.5 empty:hidden">
        <RuntimeStatusBadge task={task} activeAgentEvent={activeAgentEvent} />
        {pullRequestDisplay ? <TaskPullRequestBadge display={pullRequestDisplay} compact /> : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {getTaskAssigneeOptionId(task) && assignee ? (
            <IdentityCardWrapper
              kind={assignee.kind === 'agent' ? 'agent' : 'user'}
              id={assignee.kind === 'agent' ? assignee.id.replace(/^agent:/, '') : assignee.id}
              name={assignee.name}
              avatarUrl={assignee.avatarUrl}
              triggerMode="hover"
            >
              <Avatar className="size-5" title={assignee.name ?? '已分配负责人'}>
                {assignee.avatarUrl && <AvatarImage src={resolveMediaUrl(assignee.avatarUrl)} />}
                <AvatarFallback className="bg-zinc-800 text-[8px] font-medium text-zinc-400">
                  {assignee.name ? assignee.name.slice(0, 2).toUpperCase() : <User size={8} />}
                </AvatarFallback>
              </Avatar>
            </IdentityCardWrapper>
          ) : (
            <Avatar className="size-5" title="未分配负责人">
              <AvatarFallback className="bg-zinc-800 text-zinc-500">
                <User size={9} />
              </AvatarFallback>
            </Avatar>
          )}
          <span className="truncate text-[11px] font-semibold text-zinc-400">{assignee?.name ?? '未分配'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-zinc-500">
          <Clock size={10} />
          <span>{formatDate(task.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}
