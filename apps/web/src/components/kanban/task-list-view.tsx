import { Clock, User } from 'lucide-react'
import { cn, formatDate, normalizeTaskDisplayText } from '../../lib/utils'
import type { Task } from '@shared/types'
import type { ProjectAssignee } from '../../lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { IdentityCardWrapper } from '../profiles/identity-card-wrapper'
import { RuntimeStatusBadge } from '../runtime-status-badge'
import { resolveMediaUrl } from '../../lib/api'
import { getTaskAssigneeOptionId } from '../../lib/project-collaboration-data'

interface TaskRowProps {
  task: Task
  assignee?: ProjectAssignee
  isSelected: boolean
  activeAgentEvent?: boolean
  onClick: () => void
}

const priorityVariant: Record<Task['priority'], string> = {
  none: 'border-zinc-800 text-zinc-500',
  low: 'border-emerald-500/40 text-emerald-300',
  medium: 'border-sky-500/50 text-sky-400',
  high: 'border-amber-500/50 text-amber-300',
  urgent: 'border-rose-400 bg-rose-500/10 text-rose-300',
}

const priorityLabel: Record<Task['priority'], string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
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

export function TaskRow({ task, assignee, isSelected, activeAgentEvent = false, onClick }: TaskRowProps) {
  const displayTitle = normalizeTaskDisplayText(task.title, '图片输入失败，请移除截图或切换支持视觉的模型')
  const displayDescription = normalizeTaskDisplayText(task.description, '创建任务时包含了当前模型不支持的图片输入，导致原始错误文案被写进任务内容。')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group flex flex-col gap-2.5 border-b border-zinc-900/80 px-1 py-3 text-left sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_4.5rem_2.25rem_6.5rem] sm:items-center sm:gap-4 sm:px-2',
        'bg-transparent transition-all duration-150 ease-out cursor-pointer',
        isSelected
          ? 'bg-zinc-900/35'
          : 'hover:bg-zinc-950/45'
      )}
    >
      <div className="flex items-start justify-between gap-3 sm:contents">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:w-28 sm:shrink-0">
          <RuntimeStatusBadge task={task} activeAgentEvent={activeAgentEvent} showText />
          <span className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider',
            priorityVariant[task.priority]
          )}>
            {priorityLabel[task.priority]}
          </span>
        </div>
        <div className="min-w-0 flex-1 sm:min-w-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <PriorityIcon priority={task.priority} className="size-3.5" />
                <p className="line-clamp-1 text-sm font-medium text-zinc-100">{displayTitle}</p>
              </div>
              <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-zinc-500">{displayDescription}</p>
            </div>
            <div className="shrink-0 sm:hidden">
              {getTaskAssigneeOptionId(task) && assignee ? (
                <IdentityCardWrapper
                  kind={assignee.kind === 'agent' ? 'agent' : 'user'}
                  id={assignee.kind === 'agent' ? assignee.id.replace(/^agent:/, '') : assignee.id}
                  name={assignee.name}
                  avatarUrl={assignee.avatarUrl}
                  triggerMode="hover"
                >
                  <Avatar className="h-7 w-7" title={assignee.name ?? '已分配负责人'}>
                    {assignee.avatarUrl && <AvatarImage src={resolveMediaUrl(assignee.avatarUrl)} />}
                    <AvatarFallback className="bg-zinc-800 text-[9px] font-medium text-zinc-400">
                      {assignee.name ? assignee.name.slice(0, 2).toUpperCase() : <User size={8} />}
                    </AvatarFallback>
                  </Avatar>
                </IdentityCardWrapper>
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-zinc-800 bg-zinc-950">
                  <User size={10} className="text-zinc-600" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="hidden shrink-0 sm:block">
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider',
          priorityVariant[task.priority]
        )}>
          {priorityLabel[task.priority]}
        </span>
      </div>

      <div className="hidden shrink-0 sm:block">
        {getTaskAssigneeOptionId(task) && assignee ? (
          <IdentityCardWrapper
            kind={assignee.kind === 'agent' ? 'agent' : 'user'}
            id={assignee.kind === 'agent' ? assignee.id.replace(/^agent:/, '') : assignee.id}
            name={assignee.name}
            avatarUrl={assignee.avatarUrl}
            triggerMode="hover"
          >
            <Avatar className="h-6 w-6" title={assignee.name ?? '已分配负责人'}>
              {assignee.avatarUrl && <AvatarImage src={resolveMediaUrl(assignee.avatarUrl)} />}
              <AvatarFallback className="bg-zinc-800 text-[9px] font-medium text-zinc-400">
                {assignee.name ? assignee.name.slice(0, 2).toUpperCase() : <User size={8} />}
              </AvatarFallback>
            </Avatar>
          </IdentityCardWrapper>
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-zinc-800 bg-zinc-950">
            <User size={10} className="text-zinc-600" />
          </div>
        )}
      </div>

      <div className="mt-0.5 flex items-center justify-between text-[11px] text-zinc-600 sm:hidden">
        <div className="flex items-center gap-1.5">
          <Clock size={10} />
          <span>{formatDate(task.updatedAt)}</span>
        </div>
        {task.retryCount > 0 ? <span className="text-amber-500">重试 {task.retryCount}</span> : null}
      </div>

      <div className="hidden shrink-0 items-center gap-1.5 text-[11px] text-zinc-600 sm:flex">
        <Clock size={10} />
        <span>{formatDate(task.updatedAt)}</span>
      </div>
    </div>
  )
}

interface TaskListViewProps {
  tasks: Task[]
  selectedTaskId: string
  assigneesById: Record<string, ProjectAssignee>
  activeAgentTaskIds?: ReadonlySet<string>
  onSelectTask: (id: string) => void
}

export function TaskListView({ tasks, selectedTaskId, assigneesById, activeAgentTaskIds, onSelectTask }: TaskListViewProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-10 text-center text-xs uppercase tracking-[0.18em] text-zinc-600">
        暂无任务
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="hidden items-center gap-4 rounded-lg border border-zinc-800/50 bg-zinc-950/50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500 sm:flex">
        <div className="w-24 shrink-0">状态</div>
        <div className="min-w-0 flex-1">任务</div>
        <div className="w-16 shrink-0">优先级</div>
        <div className="w-8 shrink-0">负责人</div>
        <div className="hidden w-20 sm:flex shrink-0">更新时间</div>
      </div>

      <div>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            assignee={(() => {
              const assigneeId = getTaskAssigneeOptionId(task)
              return assigneeId ? assigneesById[assigneeId] : undefined
            })()}
            isSelected={selectedTaskId === task.id}
            activeAgentEvent={activeAgentTaskIds?.has(task.id)}
            onClick={() => onSelectTask(task.id)}
          />
        ))}
      </div>
    </div>
  )
}
