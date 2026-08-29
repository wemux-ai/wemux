/**
 * [INPUT]: Unified task Timeline entries, task Agent activity metadata, and workspace/transcript navigation callbacks.
 * [OUTPUT]: Filterable task audit view with stable actor avatars plus direct workspace and single-run Transcript navigation.
 * [POS]: Kanban task-detail Timeline presentation; detailed comments and execution controls remain separate sections.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useMemo, useState } from 'react'
import {
  AtSign,
  Bot,
  Clock3,
  ExternalLink,
  FileDiff,
  FilePlus2,
  FolderGit2,
  MessageSquare,
  MessageSquareText,
  UserRoundCheck,
} from 'lucide-react'
import type { Task, Workspace, WorkspaceSession } from '@shared/types'

import { Button } from '../../components/ui/button'
import type { TaskAgentActivityRecord } from '../../lib/api'
import { cn, formatDate } from '../../lib/utils'
import { TaskIdentityAvatar } from './task-identity-avatar'
import {
  buildTaskTimelineEntries,
  type TaskTimelineCategory,
  type TaskTimelineEntry,
} from './task-timeline-model'

const FILTERS: Array<{ value: 'all' | TaskTimelineCategory; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'collaboration', label: '协作' },
  { value: 'agent', label: 'Agent' },
  { value: 'workspace', label: '工作区' },
]

const ENTRY_ICON = {
  created: FilePlus2,
  assignment: UserRoundCheck,
  comment: MessageSquare,
  mention: AtSign,
  agent_queued: Clock3,
  agent_running: Bot,
  agent_waiting: Clock3,
  agent_finished: Bot,
  workspace_queued: FolderGit2,
  workspace_running: FolderGit2,
  workspace_waiting: Clock3,
  workspace_changed: FileDiff,
  workspace_finished: FolderGit2,
} satisfies Record<TaskTimelineEntry['kind'], typeof Bot>

const ENTRY_TONE: Record<TaskTimelineCategory, string> = {
  collaboration: 'border-sky-500/20 bg-sky-500/8 text-sky-300',
  agent: 'border-violet-500/20 bg-violet-500/8 text-violet-300',
  workspace: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300',
}

function TimelineActor({ entry }: { entry: TaskTimelineEntry }) {
  if (!entry.actor) return null
  const initial = entry.actor.name.trim().slice(0, 2).toUpperCase() || 'A'
  return (
    <TaskIdentityAvatar
      type={entry.actor.type}
      id={entry.actor.id}
      name={initial}
      avatarUrl={entry.actor.avatarUrl}
      className="h-5 w-5 shrink-0"
      fallbackClassName="text-[8px]"
    />
  )
}

export function TaskTimeline({
  task,
  activities,
  workspaces,
  workspaceSessions,
  loading,
  onOpenWorkspace,
  onOpenAgentActivity,
}: {
  task: Task
  activities: TaskAgentActivityRecord[]
  workspaces: Workspace[]
  workspaceSessions: WorkspaceSession[]
  loading: boolean
  onOpenWorkspace: (workspaceId: string) => void
  onOpenAgentActivity: (activityId: string) => void
}) {
  const [filter, setFilter] = useState<'all' | TaskTimelineCategory>('all')
  const [expanded, setExpanded] = useState(false)
  const entries = useMemo(() => buildTaskTimelineEntries({
    task,
    activities,
    workspaces,
    workspaceSessions,
  }), [activities, task, workspaces, workspaceSessions])
  const activityById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities],
  )
  const filteredEntries = filter === 'all' ? entries : entries.filter((entry) => entry.category === filter)
  const visibleEntries = expanded ? filteredEntries : filteredEntries.slice(0, 12)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/40 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">任务时间线</h3>
          <span className="text-[11px] text-zinc-600">{entries.length}</span>
        </div>
        <div className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                'h-6 rounded px-2 text-[10px] transition-colors',
                filter === item.value ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">正在加载任务动态…</div>
      ) : visibleEntries.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">暂无任务动态</div>
      ) : (
        <div className="relative">
          <div className="absolute bottom-3 left-[13px] top-3 w-px bg-zinc-800/70" />
          <div className="space-y-0.5">
            {visibleEntries.map((entry) => {
              const Icon = ENTRY_ICON[entry.kind]
              const activity = entry.activityId ? activityById.get(entry.activityId) : undefined
              return (
                <div key={entry.id} className="relative flex min-w-0 gap-3 py-2">
                  <div className={cn(
                    'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-zinc-950',
                    ENTRY_TONE[entry.category],
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex min-w-0 items-start gap-2">
                      <TimelineActor entry={entry} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-5 text-zinc-300">{entry.title}</p>
                        {entry.activityLabel ? <p className="text-[10px] leading-4 text-zinc-600">{entry.activityLabel}</p> : null}
                        {entry.detail ? <p className="line-clamp-2 whitespace-pre-wrap break-words text-[11px] leading-4 text-zinc-500">{entry.detail}</p> : null}
                        {entry.mentions && entry.mentions.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.mentions.map((mention) => (
                              <span key={mention} className="inline-flex h-5 items-center gap-1 rounded border border-sky-500/15 bg-sky-500/5 px-1.5 text-[10px] text-sky-300">
                                <AtSign className="h-2.5 w-2.5" />
                                {mention}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-[10px] text-zinc-600">{formatDate(entry.at)}</span>
                        {entry.activityId && activity?.transcriptAvailable ? (
                          <button
                            type="button"
                            title="查看本轮运行过程"
                            aria-label={`查看 ${entry.actor?.name || 'Agent'} 本轮运行过程`}
                            onClick={() => onOpenAgentActivity(entry.activityId!)}
                            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800/70 hover:text-zinc-300"
                          >
                            <MessageSquareText className="h-3 w-3" />
                          </button>
                        ) : null}
                        {entry.workspaceId ? (
                          <button
                            type="button"
                            title="打开工作区"
                            aria-label="打开工作区"
                            onClick={() => onOpenWorkspace(entry.workspaceId!)}
                            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-800/70 hover:text-zinc-300"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {filteredEntries.length > 12 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((current) => !current)}
          className="h-7 w-full rounded-md text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
        >
          {expanded ? '收起时间线' : `查看全部 ${filteredEntries.length} 条`}
        </Button>
      ) : null}
    </section>
  )
}
