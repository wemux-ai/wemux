/**
 * [INPUT]: Task-detail view models, assignee/mention options, Agent activity, and UI callbacks.
 * [OUTPUT]: Flat task hero, Agent activity, workspace, subtask, and threaded Markdown comments with dispatch preview, live Agent status, and linked run details.
 * [POS]: Presentational and local-interaction sections for the Kanban task-detail drawer.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  AtSign,
  AlertTriangle,
  CalendarClock,
  Check,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  GitMerge,
  GitPullRequest,
  ListTodo,
  MessageSquare,
  Loader2,
  Paperclip,
  Pencil,
  PlayCircle,
  Plus,
  Reply,
  RotateCcw,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react'
import {
  TASK_DESCRIPTION_MAX_LENGTH,
} from '@shared/task-input-limits'
import { TASK_COMMENT_REACTION_OPTIONS, type TaskCommentReactionEmoji } from '@shared/task-comment-reaction'
import { TASK_COMMENT_ATTACHMENT_LIMIT, type TaskChatAttachment } from '@shared/task-chat-attachment'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { api, resolveMediaUrl, type ProjectAssignee, type TaskAgentActivityRecord } from '../../lib/api'
import { getTaskAssigneeOptionId } from '../../lib/project-collaboration-data'
import { Button } from '../../components/ui/button'
import { TaskPullRequestBadge } from '../../components/task-pull-request-badge'
import { DateTimePicker } from '../../components/ui/date-time-picker'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { IdentityCardWrapper } from '../../components/profiles/identity-card-wrapper'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { summarizeTaskIndexedPullRequests } from '../../lib/task-pull-request'
import { useTranslation } from '../../lib/i18n/react'
import { cn, formatDate, statusMeta } from '../../lib/utils'
import type { ExecutorRecord, GitHubResourceBinding, Project, ProjectPullRequestReviewSummary, Task, TaskCommentDispatchOutcome, TaskCommentMention, TaskWorkspaceBinding, WorkspaceSession, Workspace } from '@shared/types'
import { WorkspaceListCard } from '../workspaces/workspaces-list-panel'
import { buildWorkspaceItems } from '../workspaces/workspaces-page-utils'
import { AssigneeSelect, PrioritySelect, StatusSelect } from './create-task-modal-controls'
import { buildTaskCommentReplyDraft, insertTaskCommentMention, resolveEditedTaskCommentMentions, resolveTaskCommentDispatchPreviewMeta, resolveTaskCommentMentionQuery, toTaskCommentMentionCandidate } from './task-comment-mention'
import {
  getTaskCommentActiveAgentActivities,
  getTaskCommentLinkedAgentActivity,
} from './task-comment-agent-activity'
import { TaskCommentMarkdown } from './task-comment-markdown'
import { TaskIdentityAvatar } from './task-identity-avatar'

const TASK_DETAIL_SETTING_CHIP_CLASS = 'inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800/80 bg-zinc-950/80 px-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:border-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600/70 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60'

interface TaskDetailHeroProps {
  task: Task
  assignees: ProjectAssignee[]
  taskTitleInput: string
  taskDescriptionInput: string
  taskStatusInput: Task['status']
  taskPriorityInput: Task['priority']
  taskStartedAtInput: string
  taskDueAtInput: string
  currentUserId?: string
  pendingConfirmationWorkspaceName?: string
  awaitingConfirmation: boolean
  onAssignTask: (assigneeId?: string) => void
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onStatusChange: (value: Task['status']) => void
  onPriorityChange: (value: Task['priority']) => void
  onStartedAtChange: (value: string) => void
  onDueAtChange: (value: string) => void
  onSubscriberChange: (userId: string, subscribed: boolean) => Promise<boolean>
  busy: boolean
}

interface TaskDetailWorkspaceSectionProps {
  project: Project | null
  task: Task
  projectPullRequests: ProjectPullRequestReviewSummary[]
  projectPullRequestBindings: GitHubResourceBinding[]
  taskBindings: TaskWorkspaceBinding[]
  executors: ExecutorRecord[]
  preferredExecutorName: string
  workspaces: Workspace[]
  workspaceSessions: WorkspaceSession[]
  selectedWorkspaceId: string
  pendingConfirmationWorkspaceId?: string
  loading: boolean
  busy: boolean
  onCreateWorkspace: () => void
  onOpenWorkspaceSession: (workspaceId: string, workspaceSessionId?: string) => void
  onArchiveWorkspace: (workspace: Workspace, archived: boolean) => Promise<void>
  onDeleteWorkspace: (workspace: Workspace) => Promise<void>
}

interface TaskDetailSubtasksSectionProps {
  childTasks: Task[]
  busy: boolean
  onCreate: () => void
}

interface TaskDetailCommentsSectionProps {
  taskId: string
  comments: Task['comments']
  agentActivities: TaskAgentActivityRecord[]
  currentUserId?: string
  commentInput: string
  mentionOptions: ProjectAssignee[]
  busy: boolean
  onCommentChange: (value: string) => void
  onCommentSubmit: (payload: {
    parentCommentId?: string
    mentions: Array<Pick<TaskCommentMention, 'targetType' | 'targetId'>>
    attachments: TaskChatAttachment[]
  }) => Promise<boolean>
  onCommentEdit: (payload: {
    commentId: string
    content: string
    mentions: Array<Pick<TaskCommentMention, 'targetType' | 'targetId'>>
    attachments: TaskChatAttachment[]
  }) => Promise<boolean>
  onCommentDelete: (commentId: string) => Promise<boolean>
  onCommentReaction: (commentId: string, emoji: TaskCommentReactionEmoji, active: boolean) => Promise<boolean>
  onCommentResolution: (commentId: string, resolved: boolean) => Promise<boolean>
  onCommentAttachmentUpload: (file: File) => Promise<TaskChatAttachment | null>
  onOpenAgentActivity: (eventId: string) => void
}

const taskCommentAgentActivityStatusMeta: Record<
  TaskAgentActivityRecord['status'],
  { label: string; badgeClassName: string; dotClassName: string }
> = {
  pending: {
    label: '等待处理',
    badgeClassName: 'border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
    dotClassName: 'bg-zinc-500',
  },
  running: {
    label: '正在处理',
    badgeClassName: 'border-sky-500/25 bg-sky-500/10 text-sky-300 hover:border-sky-500/40 hover:bg-sky-500/15',
    dotClassName: 'bg-sky-400 animate-pulse',
  },
  waiting: {
    label: '等待输入',
    badgeClassName: 'border-amber-500/25 bg-amber-500/10 text-amber-300 hover:border-amber-500/40 hover:bg-amber-500/15',
    dotClassName: 'bg-amber-400',
  },
  completed: {
    label: '已完成',
    badgeClassName: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/15',
    dotClassName: 'bg-emerald-400',
  },
  failed: {
    label: '处理失败',
    badgeClassName: 'border-rose-500/25 bg-rose-500/10 text-rose-300 hover:border-rose-500/40 hover:bg-rose-500/15',
    dotClassName: 'bg-rose-400',
  },
  canceled: {
    label: '已取消',
    badgeClassName: 'border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
    dotClassName: 'bg-zinc-500',
  },
}

function TaskCommentAgentActivityStatusIcon({
  status,
  dotClassName,
}: {
  status: TaskAgentActivityRecord['status']
  dotClassName: string
}) {
  if (status === 'running') {
    return (
      <span
        aria-hidden="true"
        data-task-comment-agent-running-indicator="true"
        className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"
      >
        <span className="absolute inset-0 rounded-full bg-sky-400/20 animate-ping motion-reduce:animate-none" />
        <Loader2 className="relative h-3 w-3 animate-spin motion-reduce:animate-none" />
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClassName)}
    />
  )
}

export function TaskDetailHero({
  task,
  assignees,
  taskTitleInput,
  taskDescriptionInput,
  taskStatusInput,
  taskPriorityInput,
  taskStartedAtInput,
  taskDueAtInput,
  currentUserId,
  pendingConfirmationWorkspaceName,
  awaitingConfirmation,
  onAssignTask,
  onTitleChange,
  onDescriptionChange,
  onStatusChange,
  onPriorityChange,
  onStartedAtChange,
  onDueAtChange,
  onSubscriberChange,
  busy,
}: TaskDetailHeroProps) {
  const subscriberIds = task.subscriberIds ?? []
  const subscriberOptions = assignees.filter((assignee) => assignee.kind === 'user' || !assignee.kind)
  const currentUserSubscribed = Boolean(currentUserId && subscriberIds.includes(currentUserId))

  return (
    <section className="space-y-5">
      {/* 标题 + 自动保存 */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <Input
            value={taskTitleInput}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="任务标题"
            disabled={busy}
            className="h-auto flex-1 border-none bg-transparent px-0 py-0 text-xl font-semibold tracking-[-0.02em] text-zinc-100 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="relative">
          <Textarea
            value={taskDescriptionInput}
            onChange={(event) => onDescriptionChange(event.target.value.slice(0, TASK_DESCRIPTION_MAX_LENGTH))}
            placeholder="描述背景、目标、边界和注意事项..."
            disabled={busy}
            className="min-h-[132px] resize-y border-none bg-transparent px-0 py-0 text-[13px] leading-[1.7] text-zinc-400 shadow-none focus-visible:ring-0"
          />
          <span className="absolute bottom-1 right-0 text-[10px] text-zinc-700">
            {taskDescriptionInput.length}/{TASK_DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="border-y border-zinc-800/40 py-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusSelect
                value={taskStatusInput}
                disabled={busy}
                triggerClassName="h-7 w-auto shrink-0 border-zinc-800 bg-zinc-950 px-2 text-xs"
                onChange={(nextStatus) => onStatusChange(nextStatus as Task['status'])}
              />

              <PrioritySelect
                value={taskPriorityInput}
                disabled={busy}
                triggerClassName="h-7 w-auto shrink-0 border-zinc-800 bg-zinc-950 px-2 text-xs"
                onChange={(nextPriority) => onPriorityChange(nextPriority as Task['priority'])}
              />

              <AssigneeSelect
                assignees={assignees}
                value={getTaskAssigneeOptionId(task)}
                disabled={busy}
                triggerClassName="h-7 w-auto shrink-0 border-zinc-800 bg-zinc-950 px-2 text-xs"
                onChange={onAssignTask}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <TaskDetailDateTimeChip
                value={taskStartedAtInput}
                label="开始时间"
                highlightTone="sky"
                disabled={busy}
                onChange={onStartedAtChange}
              />

              <TaskDetailDateTimeChip
                value={taskDueAtInput}
                label="截止时间"
                highlightTone="violet"
                disabled={busy}
                onChange={onDueAtChange}
              />

              {currentUserId ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSubscriberChange(currentUserId, !currentUserSubscribed)}
                  className={cn(
                    TASK_DETAIL_SETTING_CHIP_CLASS,
                    currentUserSubscribed && 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:border-sky-500/40 hover:bg-sky-500/15',
                  )}
                  aria-pressed={currentUserSubscribed}
                >
                  {currentUserSubscribed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {currentUserSubscribed ? '已关注' : '关注'}
                </button>
              ) : null}

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className={TASK_DETAIL_SETTING_CHIP_CLASS}
                    aria-label="管理任务关注者"
                  >
                    <span>关注者</span>
                    <span className="text-zinc-600">{subscriberIds.length}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" sideOffset={6} className="w-64 border-zinc-800 bg-[#09090b] p-1.5 text-zinc-100 shadow-xl">
                  <div className="border-b border-zinc-800/60 px-2 py-1.5 text-[11px] font-medium text-zinc-400">任务关注者</div>
                  <div className="max-h-56 overflow-y-auto py-1">
                    {subscriberOptions.length > 0 ? subscriberOptions.map((assignee) => {
                      const subscribed = subscriberIds.includes(assignee.id)
                      return (
                        <button
                          key={assignee.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void onSubscriberChange(assignee.id, !subscribed)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-900 disabled:opacity-50"
                        >
                          <Avatar className="h-5 w-5 border border-zinc-800">
                            <AvatarImage src={resolveMediaUrl(assignee.avatarUrl)} />
                            <AvatarFallback className="bg-zinc-800 text-[8px] text-zinc-200">{assignee.name.trim().slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{assignee.id === currentUserId ? '你' : assignee.name}</span>
                          {subscribed ? <Check className="h-3.5 w-3.5 text-sky-300" /> : null}
                        </button>
                      )
                    }) : (
                      <div className="px-2 py-3 text-center text-xs text-zinc-600">暂无可关注成员</div>
                    )}
                  </div>
                  <div className="border-t border-zinc-800/60 px-2 py-1.5 text-[10px] text-zinc-600">关注者会收到后续评论通知</div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {task.createdBy ? (
            <>
              <IdentityCardWrapper
                kind={task.createdBy.type}
                id={task.createdBy.id}
                name={task.createdBy.name}
                avatarUrl={task.createdBy.avatarUrl}
                triggerMode="hover"
              >
                <Avatar className="h-5 w-5 border border-zinc-800" title={`创建人：${task.createdBy.name}`}>
                  <AvatarImage src={resolveMediaUrl(task.createdBy.avatarUrl)} />
                  <AvatarFallback className={cn(
                    'text-[8px]',
                    task.createdBy.type === 'agent'
                      ? `bg-gradient-to-br text-zinc-950 ${getAgentAvatarAccent(task.createdBy.id)}`
                      : 'bg-zinc-800 text-zinc-200',
                  )}>
                    {task.createdBy.name.trim().slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </IdentityCardWrapper>
              <span>{task.createdBy.name}</span>
              <span className="text-zinc-700">·</span>
            </>
          ) : null}
          <span>创建于 {formatDate(task.createdAt)}</span>
        </div>
      </div>

      {awaitingConfirmation ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/15 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {pendingConfirmationWorkspaceName ? `需要人工确认 · ${pendingConfirmationWorkspaceName}` : '需要人工确认'}
        </div>
      ) : null}
    </section>
  )
}

function TaskDetailDateTimeChip({
  value,
  label,
  highlightTone,
  disabled,
  onChange,
}: {
  value: string
  label: string
  highlightTone: 'sky' | 'violet'
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const accentClassName = highlightTone === 'sky'
    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300 hover:border-sky-500/40 hover:bg-sky-500/15'
    : 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:border-violet-500/40 hover:bg-violet-500/15'

  return (
    <DateTimePicker
      value={value}
      disabled={disabled}
      placeholder={label}
      onChange={onChange}
      sideOffset={6}
      trigger={
        <div className="inline-flex items-center gap-0.5">
          <button
            type="button"
            disabled={disabled}
            aria-label={value ? `${label}: ${formatTaskDetailDateTimeLabel(value)}` : label}
            className={cn(
              TASK_DETAIL_SETTING_CHIP_CLASS,
              'shrink-0 justify-start whitespace-nowrap',
              value && accentClassName,
            )}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span className="whitespace-nowrap">{value ? formatTaskDetailDateTimeLabel(value) : label}</span>
          </button>

          {value ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange('')
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`清空${label}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      }
    />
  )
}

function formatTaskDetailDateTimeLabel(value: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${month}/${day} ${hours}:${minutes}`
}

export function TaskDetailWorkspaceSection({
  project,
  task,
  projectPullRequests,
  projectPullRequestBindings,
  taskBindings,
  executors,
  preferredExecutorName,
  workspaces,
  workspaceSessions,
  selectedWorkspaceId,
  pendingConfirmationWorkspaceId,
  loading,
  busy,
  onCreateWorkspace,
  onOpenWorkspaceSession,
  onArchiveWorkspace,
  onDeleteWorkspace,
}: TaskDetailWorkspaceSectionProps) {
  const { language } = useTranslation()
  const preferredExecutor = executors.find((executor) => executor.name === preferredExecutorName)
  const pullRequestSummary = summarizeTaskIndexedPullRequests({
    pullRequests: projectPullRequests,
    bindings: projectPullRequestBindings,
    projectId: project?.id,
    taskId: task.id,
  })
  const workspaceItems = useMemo(
    () => project
      ? buildWorkspaceItems(
          [project],
          { [project.id]: workspaces },
          [task],
          taskBindings,
          workspaceSessions,
          language,
          { executors },
        )
      : [],
    [executors, language, project, task, taskBindings, workspaceSessions, workspaces],
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-zinc-800/40 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">工作区</h3>
          {pullRequestSummary.totalCount > 0 ? (
            pullRequestSummary.totalCount === 1 && pullRequestSummary.latestDisplay ? (
              <TaskPullRequestBadge
                display={pullRequestSummary.latestDisplay}
                asLink
                className="border border-zinc-800 bg-zinc-950"
              />
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400">
                {pullRequestSummary.mergedCount > 0 ? <GitMerge className="h-3 w-3 text-violet-300" /> : <GitPullRequest className="h-3 w-3 text-emerald-300" />}
                <span>{`${pullRequestSummary.totalCount} 个 PR`}</span>
                <span className="text-zinc-500">
                  {pullRequestSummary.mergedCount > 0
                    ? `${pullRequestSummary.mergedCount} 已合并`
                    : pullRequestSummary.openCount > 0
                      ? `${pullRequestSummary.openCount} 审核中`
                      : pullRequestSummary.closedCount > 0
                        ? `${pullRequestSummary.closedCount} 已关闭`
                        : `${pullRequestSummary.unknownCount} 已记录`}
                </span>
              </span>
            )
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {preferredExecutor ? (
            <span className="hidden text-[10px] text-zinc-600 sm:inline">{preferredExecutor.name}</span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreateWorkspace}
            disabled={busy}
            className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            <Plus className="h-3 w-3" />
            新建
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/20 px-3 py-6 text-center text-xs text-zinc-500">
          正在加载工作区…
        </div>
      ) : null}

      {!loading && workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800/40 bg-zinc-900/10 px-4 py-6 text-center">
          <FolderOpen className="mx-auto mb-2 h-4 w-4 text-zinc-700" />
          <p className="text-xs text-zinc-500">暂无工作区</p>
          <Button
            onClick={onCreateWorkspace}
            disabled={busy}
            size="sm"
            className="mt-3 h-6 gap-1 rounded-md border border-zinc-700/60 bg-transparent px-2.5 text-[11px] text-zinc-400 hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            <Plus className="h-3 w-3" />
            立即创建
          </Button>
        </div>
      ) : null}

      {!loading && workspaceItems.map((item) => {
        const workspace = item.workspace
        const isPending = pendingConfirmationWorkspaceId === workspace.id
        const isSelected = selectedWorkspaceId === workspace.id

        return (
          <div
            key={workspace.id}
            className="group relative min-w-0 max-w-full space-y-1"
          >
            <WorkspaceListCard
              item={item}
              selected={isSelected}
              projectPullRequests={projectPullRequests}
              githubResourceBindings={projectPullRequestBindings}
              onSelect={() => onOpenWorkspaceSession(workspace.id)}
              onSelectWorkspaceSessionTarget={({ workspaceId, workspaceSessionId }) => {
                onOpenWorkspaceSession(workspaceId, workspaceSessionId)
              }}
            />

            <div className="flex min-h-7 items-center justify-between gap-2 px-1">
              <div>
                {isPending ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-300"
                      style={{ animation: 'workspace-pending-dot-breathe 1.4s ease-in-out infinite' }}
                    />
                    待确认
                  </span>
                ) : null}
              </div>

              <div className="flex min-w-0 items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenWorkspaceSession(workspace.id)}
                  className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
                >
                  <PlayCircle className="h-3 w-3" />
                  打开
                </Button>

                {workspace.source === 'manual' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void onArchiveWorkspace(workspace, workspace.status !== 'archived')}
                    className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
                  >
                    <Archive className="h-3 w-3" />
                    {workspace.status === 'archived' ? '恢复' : '归档'}
                  </Button>
                ) : null}

                {canDeleteWorkspaceRecord(workspace) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void onDeleteWorkspace(workspace)}
                    className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-rose-950/30 hover:text-rose-300"
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

export function TaskDetailSubtasksSection({
  childTasks,
  busy,
  onCreate,
}: TaskDetailSubtasksSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-zinc-800/40 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">子任务</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreate}
          disabled={busy}
          className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
        >
          <Plus className="h-3 w-3" />
          新建
        </Button>
      </div>

      {childTasks.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-5 text-center">
          <ListTodo className="h-4 w-4 text-zinc-700" />
          <p className="text-xs text-zinc-600">暂无子任务</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {childTasks.map((child) => (
            <div key={child.id} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 transition-colors hover:bg-zinc-900/40">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', statusMeta[child.status]?.accent?.split(' ')[0] ?? 'bg-zinc-500')} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">{child.title}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TaskCommentAttachmentItems({
  attachments,
  onRemove,
}: {
  attachments: TaskChatAttachment[]
  onRemove?: (attachmentId: string) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const image = attachment.contentType?.startsWith('image/')
        return (
          <div key={attachment.id} className="group relative max-w-full">
            <a
              href={resolveMediaUrl(attachment.url)}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'flex max-w-[15rem] items-center gap-2 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/70 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                image ? 'pr-2' : 'px-2 py-1.5',
              )}
            >
              {image ? (
                <img src={resolveMediaUrl(attachment.url)} alt={attachment.filename} className="h-10 w-10 shrink-0 object-cover" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              )}
              <span className="truncate">{attachment.filename}</span>
            </a>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-500 opacity-0 shadow-sm hover:text-zinc-200 group-hover:opacity-100"
                aria-label={`移除附件 ${attachment.filename}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function TaskDetailCommentsSection({
  taskId,
  comments,
  agentActivities,
  currentUserId,
  commentInput,
  mentionOptions,
  busy,
  onCommentChange,
  onCommentSubmit,
  onCommentEdit,
  onCommentDelete,
  onCommentReaction,
  onCommentResolution,
  onCommentAttachmentUpload,
  onOpenAgentActivity,
}: TaskDetailCommentsSectionProps) {
  const hasComments = comments.length > 0
  const latestCommentRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const [replyToCommentId, setReplyToCommentId] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<ProjectAssignee[]>([])
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionCursor, setMentionCursor] = useState(-1)
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false)
  const [agentOnlyMenu, setAgentOnlyMenu] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [editingCommentId, setEditingCommentId] = useState('')
  const [editCommentInput, setEditCommentInput] = useState('')
  const [deleteConfirmCommentId, setDeleteConfirmCommentId] = useState('')
  const [reactionPickerCommentId, setReactionPickerCommentId] = useState('')
  const [commentAttachments, setCommentAttachments] = useState<TaskChatAttachment[]>([])
  const [editCommentAttachments, setEditCommentAttachments] = useState<TaskChatAttachment[]>([])
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const [dispatchPreview, setDispatchPreview] = useState<TaskCommentDispatchOutcome[]>([])
  const [dispatchPreviewLoading, setDispatchPreviewLoading] = useState(false)
  const [dispatchPreviewError, setDispatchPreviewError] = useState('')
  const replyToComment = comments.find((comment) => comment.id === replyToCommentId)
  const filteredMentionOptions = useMemo(() => {
    const query = mentionQuery.trim().toLowerCase()
    return mentionOptions
      .filter((option) => !agentOnlyMenu || option.kind === 'agent' || option.id.startsWith('agent:'))
      .filter((option) => !query || option.name.toLowerCase().includes(query) || option.email.toLowerCase().includes(query))
      .slice(0, 8)
  }, [agentOnlyMenu, mentionOptions, mentionQuery])

  useEffect(() => {
    latestCommentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [comments.length])

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery, agentOnlyMenu])

  // 服务端预览只由 task/parent/mention 集合决定，与正文内容无关。
  // 用 ref 携带请求正文，避免逐字输入让预览请求与 loading 骨架反复重建导致输入区跳动。
  const dispatchPreviewPayloadRef = useRef({ commentInput, commentAttachments, selectedMentions })
  dispatchPreviewPayloadRef.current = { commentInput, commentAttachments, selectedMentions }
  const dispatchPreviewKey = useMemo(() => (
    selectedMentions.length === 0
      ? ''
      : [
          taskId,
          replyToCommentId,
          ...selectedMentions.map(toTaskCommentMentionCandidate)
            .map((candidate) => `${candidate.targetType}:${candidate.targetId}`)
            .sort(),
        ].join('|')
  ), [replyToCommentId, selectedMentions, taskId])

  useEffect(() => {
    if (!dispatchPreviewKey) {
      setDispatchPreview([])
      setDispatchPreviewError('')
      setDispatchPreviewLoading(false)
      return
    }

    let cancelled = false
    setDispatchPreviewLoading(true)
    const timer = window.setTimeout(() => {
      const payload = dispatchPreviewPayloadRef.current
      void api.previewTaskComment(taskId, {
        content: payload.commentInput.trim(),
        parentCommentId: replyToCommentId || undefined,
        mentions: payload.selectedMentions.map(toTaskCommentMentionCandidate),
        attachments: payload.commentAttachments,
      }).then((response) => {
        if (cancelled) return
        setDispatchPreview(response.commentDispatches)
        setDispatchPreviewError('')
      }).catch((error) => {
        if (cancelled) return
        setDispatchPreview([])
        setDispatchPreviewError(error instanceof Error ? error.message : '无法预览评论触发结果。')
      }).finally(() => {
        if (!cancelled) setDispatchPreviewLoading(false)
      })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dispatchPreviewKey, replyToCommentId, taskId])

  useEffect(() => {
    if (editingCommentId && !comments.some((comment) => comment.id === editingCommentId && !comment.deletedAt)) {
      setEditingCommentId('')
      setEditCommentInput('')
      setEditCommentAttachments([])
    }
    if (deleteConfirmCommentId && !comments.some((comment) => comment.id === deleteConfirmCommentId && !comment.deletedAt)) {
      setDeleteConfirmCommentId('')
    }
    if (reactionPickerCommentId && !comments.some((comment) => comment.id === reactionPickerCommentId && !comment.deletedAt)) {
      setReactionPickerCommentId('')
    }
  }, [comments, deleteConfirmCommentId, editingCommentId, reactionPickerCommentId])

  const updateMentionMenuFromInput = (value: string, cursor: number) => {
    const match = resolveTaskCommentMentionQuery(value, cursor)
    if (!match) {
      setMentionMenuOpen(false)
      setAgentOnlyMenu(false)
      return
    }

    setMentionQuery(match.query)
    setMentionStart(match.start)
    setMentionCursor(match.cursor)
    setMentionMenuOpen(true)
    setAgentOnlyMenu(false)
  }

  const handleCommentChange = (value: string, cursor: number) => {
    onCommentChange(value)
    setSelectedMentions((current) => {
      const next = current.filter((option) => value.includes(`@${option.name}`))
      // 保持引用不变，避免逐字输入触发无意义的重渲染与预览重取。
      return next.length === current.length ? current : next
    })
    updateMentionMenuFromInput(value, cursor)
  }

  const selectMention = (option: ProjectAssignee) => {
    const cursor = mentionCursor >= 0 ? mentionCursor : commentInput.length
    const start = mentionStart >= 0 ? mentionStart : cursor
    const inserted = insertTaskCommentMention({ value: commentInput, label: option.name, start, cursor })

    onCommentChange(inserted.value)
    setSelectedMentions((current) => current.some((item) => item.id === option.id)
      ? current
      : [...current, option])
    setMentionMenuOpen(false)
    setAgentOnlyMenu(false)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(inserted.cursor, inserted.cursor)
    })
  }

  const openReplyComposer = (commentId: string, agentsOnly = false) => {
    setReplyToCommentId(commentId)
    if (agentsOnly) {
      setMentionQuery('')
      setMentionStart(commentInput.length)
      setMentionCursor(commentInput.length)
      setMentionMenuOpen(true)
      setAgentOnlyMenu(true)
    } else {
      const comment = comments.find((item) => item.id === commentId)
      if (comment) {
        const replyDraft = buildTaskCommentReplyDraft({
          comment,
          value: commentInput,
          selectedMentions,
          mentionOptions,
        })
        if (!replyDraft.mentionAdded) {
          requestAnimationFrame(() => textareaRef.current?.focus())
          return
        }
        onCommentChange(replyDraft.value)
        setSelectedMentions(replyDraft.selectedMentions)
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
          textareaRef.current?.setSelectionRange(replyDraft.cursor, replyDraft.cursor)
        })
        return
      }
    }
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const removeMention = (option: ProjectAssignee) => {
    setSelectedMentions((current) => current.filter((item) => item.id !== option.id))
    onCommentChange(commentInput.replace(`@${option.name}`, '').replace(/ {2,}/g, ' ').trimStart())
  }

  const submitComment = async () => {
    if (busy || attachmentsUploading || (!commentInput.trim() && commentAttachments.length === 0)) return
    const submitted = await onCommentSubmit({
      parentCommentId: replyToCommentId || undefined,
      mentions: selectedMentions.map(toTaskCommentMentionCandidate),
      attachments: commentAttachments,
    })
    if (!submitted) return

    setReplyToCommentId('')
    setSelectedMentions([])
    setMentionMenuOpen(false)
    setAgentOnlyMenu(false)
    setCommentAttachments([])
  }

  const startEditingComment = (comment: Task['comments'][number]) => {
    setEditingCommentId(comment.id)
    setEditCommentInput(comment.content)
    setEditCommentAttachments(comment.attachments ?? [])
    setDeleteConfirmCommentId('')
  }

  const submitCommentEdit = async () => {
    const comment = comments.find((item) => item.id === editingCommentId)
    if (!comment || busy || (!editCommentInput.trim() && editCommentAttachments.length === 0)) return

    const edited = await onCommentEdit({
      commentId: comment.id,
      content: editCommentInput.trim(),
      mentions: resolveEditedTaskCommentMentions(comment, editCommentInput, mentionOptions),
      attachments: editCommentAttachments,
    })
    if (!edited) return

    setEditingCommentId('')
    setEditCommentInput('')
    setEditCommentAttachments([])
  }

  const deleteComment = async (commentId: string) => {
    if (busy) return
    const deleted = await onCommentDelete(commentId)
    if (!deleted) return

    setDeleteConfirmCommentId('')
    if (editingCommentId === commentId) {
      setEditingCommentId('')
      setEditCommentInput('')
      setEditCommentAttachments([])
    }
  }

  const setCommentReaction = async (commentId: string, emoji: TaskCommentReactionEmoji, active: boolean) => {
    if (busy || !currentUserId) return
    const updated = await onCommentReaction(commentId, emoji, active)
    if (updated) setReactionPickerCommentId('')
  }

  const uploadCommentAttachments = async (files: File[]) => {
    if (busy || attachmentsUploading || files.length === 0 || commentAttachments.length >= TASK_COMMENT_ATTACHMENT_LIMIT) return

    setAttachmentsUploading(true)
    try {
      let nextAttachments = commentAttachments
      const remaining = TASK_COMMENT_ATTACHMENT_LIMIT - nextAttachments.length
      for (const file of files.slice(0, remaining)) {
        const attachment = await onCommentAttachmentUpload(file)
        if (!attachment) continue
        nextAttachments = [...nextAttachments, attachment]
        setCommentAttachments(nextAttachments)
      }
    } finally {
      setAttachmentsUploading(false)
    }
  }

  return (
    <section className="space-y-3 pb-1">
      <div className="flex items-center justify-between border-b border-zinc-800/40 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">评论</h3>
        <span className="text-[11px] text-zinc-600">{comments.length}</span>
      </div>

      {hasComments ? (
        <div className="space-y-2 pb-1">
          {comments.map((comment, index) => {
            const ownComment = Boolean(currentUserId && comment.authorId === currentUserId)
            const authorName = ownComment ? '你' : (comment.authorName || '团队成员')
            const authorInitial = authorName.trim().slice(0, 2).toUpperCase() || 'A'
            const isAgentComment = comment.authorType === 'agent'
            const isEditing = editingCommentId === comment.id
            const isDeleted = Boolean(comment.deletedAt)
            const confirmingDelete = deleteConfirmCommentId === comment.id
            const threadRoot = comment.parentCommentId
              ? comments.find((candidate) => candidate.id === comment.parentCommentId)
              : comment
            const threadResolved = Boolean(threadRoot?.resolvedAt)
            const activeAgentActivities = getTaskCommentActiveAgentActivities(agentActivities, comment.id)
            const linkedAgentActivity = isAgentComment
              ? getTaskCommentLinkedAgentActivity(agentActivities, comment.idempotencyKey)
              : undefined
            const linkedAgentActivityStatusMeta = linkedAgentActivity
              ? taskCommentAgentActivityStatusMeta[linkedAgentActivity.status]
              : undefined
            const resolvedByName = threadRoot?.resolvedByUserId
              ? threadRoot.resolvedByUserId === currentUserId
                ? '你'
                : mentionOptions.find((option) => option.id === threadRoot.resolvedByUserId)?.name || '团队成员'
              : ''

            return (
              <div
                key={comment.id}
                ref={index === comments.length - 1 ? latestCommentRef : undefined}
                className={cn(
                  'rounded-lg border px-3 py-2.5 transition-colors',
                  comment.parentCommentId && 'ml-6',
                  ownComment
                    ? 'border-zinc-700/70 bg-zinc-900/60 hover:border-zinc-600/70 hover:bg-zinc-900/80'
                    : 'border-zinc-800/50 bg-zinc-950/30 hover:border-zinc-700/60 hover:bg-zinc-950/50',
                  threadResolved && 'border-emerald-500/20 bg-emerald-500/[0.035] hover:border-emerald-500/30 hover:bg-emerald-500/[0.055]',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-6 w-6 shrink-0 rounded-full border border-zinc-800 bg-zinc-900">
                    <AvatarImage src={resolveMediaUrl(comment.authorAvatarUrl)} className="object-cover" />
                    <AvatarFallback className={cn(
                      'rounded-full text-[9px] font-bold',
                      isAgentComment
                        ? `bg-gradient-to-br text-zinc-950 ${getAgentAvatarAccent(comment.authorId || authorName)}`
                        : 'bg-zinc-800 text-zinc-200',
                    )}>
                      {authorInitial}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate text-[12px] font-medium text-zinc-300">{authorName}</span>
                  <span className="text-[10px] text-zinc-600">{formatDate(comment.createdAt)}</span>
                  {comment.editedAt && !isDeleted ? <span className="text-[10px] text-zinc-700">已编辑</span> : null}
                  {!comment.parentCommentId && threadResolved ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      <Check className="h-3 w-3" />
                      {resolvedByName ? `${resolvedByName} 已解决` : '已解决'}
                    </span>
                  ) : null}
                </div>
                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      autoFocus
                      value={editCommentInput}
                      onChange={(event) => setEditCommentInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditingCommentId('')
                          setEditCommentInput('')
                          setEditCommentAttachments([])
                        }
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault()
                          void submitCommentEdit()
                        }
                      }}
                      disabled={busy}
                      className="min-h-[68px] resize-y border-zinc-800 bg-zinc-950/70 px-2.5 py-2 text-[13px] leading-5 text-zinc-300 focus-visible:ring-zinc-700"
                    />
                    <TaskCommentAttachmentItems
                      attachments={editCommentAttachments}
                      onRemove={(attachmentId) => setEditCommentAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-zinc-700">编辑不会重新触发历史 @ 提及</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCommentId('')
                            setEditCommentInput('')
                            setEditCommentAttachments([])
                          }}
                          disabled={busy}
                          className="text-[10px] text-zinc-600 hover:text-zinc-300 disabled:opacity-50"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitCommentEdit()}
                          disabled={busy || (!editCommentInput.trim() && editCommentAttachments.length === 0)}
                          className="inline-flex items-center gap-1 text-[10px] text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" />
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {isDeleted ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 italic text-zinc-600">评论已删除</p>
                    ) : (
                      <TaskCommentMarkdown content={comment.content} />
                    )}
                    {!isDeleted ? <TaskCommentAttachmentItems attachments={comment.attachments ?? []} /> : null}
                    {linkedAgentActivity && linkedAgentActivityStatusMeta ? (
                      <button
                        type="button"
                        onClick={() => onOpenAgentActivity(linkedAgentActivity.id)}
                        data-task-comment-agent-run={linkedAgentActivity.id}
                        className={cn(
                          'mt-2 inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600',
                          linkedAgentActivityStatusMeta.badgeClassName,
                        )}
                        aria-label={`查看 ${linkedAgentActivity.agentName} 本轮运行的执行过程`}
                      >
                        <PlayCircle className="h-3 w-3 shrink-0" />
                        <span className="shrink-0">本轮运行</span>
                        <TaskCommentAgentActivityStatusIcon
                          status={linkedAgentActivity.status}
                          dotClassName={linkedAgentActivityStatusMeta.dotClassName}
                        />
                        <span className="shrink-0">{linkedAgentActivityStatusMeta.label}</span>
                        <span className="truncate opacity-70">查看过程</span>
                      </button>
                    ) : null}
                    {activeAgentActivities.length > 0 ? (
                      <div
                        className="mt-2 flex flex-wrap items-center gap-1.5"
                        aria-label="正在处理此评论的 Agent"
                        aria-live="polite"
                      >
                        {activeAgentActivities.map((activity) => {
                          const statusMeta = taskCommentAgentActivityStatusMeta[activity.status]
                          return (
                            <button
                              key={activity.id}
                              type="button"
                              onClick={() => onOpenAgentActivity(activity.id)}
                              data-task-comment-agent-activity={activity.id}
                              className={cn(
                                'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600',
                                statusMeta.badgeClassName,
                              )}
                              aria-label={`查看 ${activity.agentName} ${statusMeta.label}的执行过程`}
                            >
                              <TaskIdentityAvatar
                                type="agent"
                                id={activity.agentId}
                                name={activity.agentName}
                                avatarUrl={activity.agentAvatarUrl}
                                className="h-4 w-4 shrink-0 border-current/20"
                                fallbackClassName="text-[6px] font-bold"
                              />
                              <span className="max-w-24 truncate">{activity.agentName}</span>
                              <TaskCommentAgentActivityStatusIcon
                                status={activity.status}
                                dotClassName={statusMeta.dotClassName}
                              />
                              <span className="shrink-0">{statusMeta.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openReplyComposer(comment.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-300 disabled:opacity-50"
                      >
                        <Reply className="h-3 w-3" />
                        回复
                      </button>
                      <button
                        type="button"
                        onClick={() => openReplyComposer(comment.id, true)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-300 disabled:opacity-50"
                      >
                        <AtSign className="h-3 w-3" />
                        交给 Agent
                      </button>
                      {!comment.parentCommentId && !isDeleted ? (
                        <button
                          type="button"
                          onClick={() => void onCommentResolution(comment.id, !threadResolved)}
                          disabled={busy}
                          className={cn(
                            'inline-flex items-center gap-1 text-[10px] disabled:opacity-50',
                            threadResolved ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-600 hover:text-emerald-300',
                          )}
                        >
                          {threadResolved ? <RotateCcw className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                          {threadResolved ? '重新打开' : '标记已解决'}
                        </button>
                      ) : null}
                      {ownComment && !isDeleted ? (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditingComment(comment)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-300 disabled:opacity-50"
                          >
                            <Pencil className="h-3 w-3" />
                            编辑
                          </button>
                          {confirmingDelete ? (
                            <span className="inline-flex items-center gap-2 text-[10px]">
                              <span className="text-rose-400">确认删除？</span>
                              <button type="button" onClick={() => void deleteComment(comment.id)} disabled={busy} className="text-rose-400 hover:text-rose-300 disabled:opacity-50">删除</button>
                              <button type="button" onClick={() => setDeleteConfirmCommentId('')} disabled={busy} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-50">取消</button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteConfirmCommentId(comment.id)
                                setEditingCommentId('')
                                setEditCommentInput('')
                                setEditCommentAttachments([])
                              }}
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-rose-400 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              删除
                            </button>
                          )}
                        </>
                      ) : null}
                    </div>
                  </>
                )}
                {!isDeleted ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(comment.reactions ?? []).map((reaction) => {
                      const reacted = Boolean(currentUserId && reaction.userIds.includes(currentUserId))
                      const names = reaction.userIds.map((userId) => (
                        userId === currentUserId
                          ? '你'
                          : mentionOptions.find((option) => option.id === userId)?.name || '团队成员'
                      ))
                      return (
                        <button
                          key={reaction.emoji}
                          type="button"
                          onClick={() => void setCommentReaction(comment.id, reaction.emoji, !reacted)}
                          disabled={busy || !currentUserId}
                          aria-pressed={reacted}
                          title={names.join('、')}
                          className={cn(
                            'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10px] transition-colors disabled:opacity-50',
                            reacted
                              ? 'border-sky-500/35 bg-sky-500/10 text-sky-200'
                              : 'border-zinc-800 bg-zinc-950/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
                          )}
                        >
                          <span>{reaction.emoji}</span>
                          <span>{reaction.userIds.length}</span>
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => setReactionPickerCommentId((current) => current === comment.id ? '' : comment.id)}
                      disabled={busy || !currentUserId}
                      aria-label="添加表情回应"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-zinc-700 hover:border-zinc-800 hover:bg-zinc-950/60 hover:text-zinc-400 disabled:opacity-50"
                    >
                      <SmilePlus className="h-3.5 w-3.5" />
                    </button>
                    {reactionPickerCommentId === comment.id ? (
                      <span className="inline-flex items-center gap-0.5 rounded-md border border-zinc-800 bg-[#09090b] p-0.5 shadow-lg">
                        {TASK_COMMENT_REACTION_OPTIONS.map((option) => {
                          const reacted = comment.reactions?.find((reaction) => reaction.emoji === option.emoji)?.userIds.includes(currentUserId || '') ?? false
                          return (
                            <button
                              key={option.emoji}
                              type="button"
                              onClick={() => void setCommentReaction(comment.id, option.emoji, !reacted)}
                              disabled={busy || !currentUserId}
                              title={option.label}
                              className={cn(
                                'flex h-6 w-6 items-center justify-center rounded text-sm hover:bg-zinc-800 disabled:opacity-50',
                                reacted && 'bg-sky-500/10 ring-1 ring-inset ring-sky-500/30',
                              )}
                            >
                              {option.emoji}
                            </button>
                          )
                        })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-800/50 bg-zinc-950/20 px-3 py-5 text-center text-xs text-zinc-600">
          还没有评论，留下第一条评论吧。
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 bg-gradient-to-t from-[#0c0c0e] via-[#0c0c0e] to-transparent px-1 pb-1 pt-3">
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/90 px-3 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.22)] backdrop-blur-sm">
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="hidden"
            disabled={busy || attachmentsUploading || commentAttachments.length >= TASK_COMMENT_ATTACHMENT_LIMIT}
            onChange={(event) => {
              void uploadCommentAttachments(event.target.files ? Array.from(event.target.files) : [])
              event.target.value = ''
            }}
          />
          {replyToComment ? (
            <div className="mb-2 flex items-center justify-between rounded-md bg-zinc-900/70 px-2 py-1.5 text-[11px] text-zinc-500">
              <span className="truncate">回复 {replyToComment.authorName || '团队成员'}：{replyToComment.deletedAt ? '评论已删除' : replyToComment.content || `${replyToComment.attachments?.length ?? 0} 个附件`}</span>
              <button type="button" onClick={() => setReplyToCommentId('')} className="ml-2 text-zinc-600 hover:text-zinc-300" aria-label="取消回复">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          {mentionMenuOpen ? (
            <div className="mb-2 overflow-hidden rounded-md border border-zinc-800 bg-[#09090b] py-1 shadow-xl">
              {filteredMentionOptions.length > 0 ? filteredMentionOptions.map((option, index) => {
                const isAgent = option.kind === 'agent' || option.id.startsWith('agent:')
                const targetLabel = option.kind === 'all' ? '全部' : isAgent ? 'Agent' : '成员'
                return (
                  <button
                    type="button"
                    key={option.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectMention(option)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                      index === mentionIndex ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900/60',
                    )}
                  >
                    <Avatar className="h-5 w-5 border border-zinc-800">
                      <AvatarImage src={resolveMediaUrl(option.avatarUrl)} />
                      <AvatarFallback className={cn('text-[8px]', isAgent ? `bg-gradient-to-br text-zinc-950 ${getAgentAvatarAccent(option.id)}` : 'bg-zinc-800 text-zinc-200')}>
                        {option.name.trim().slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    <span className="text-[9px] uppercase text-zinc-600">{targetLabel}</span>
                  </button>
                )
              }) : (
                <div className="px-2.5 py-2 text-xs text-zinc-600">没有匹配的成员或 Agent</div>
              )}
            </div>
          ) : null}

          <Textarea
            ref={textareaRef}
            value={commentInput}
            onChange={(event) => handleCommentChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
            onKeyDown={(event) => {
              if (mentionMenuOpen && filteredMentionOptions.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const direction = event.key === 'ArrowDown' ? 1 : -1
                  setMentionIndex((current) => (current + direction + filteredMentionOptions.length) % filteredMentionOptions.length)
                  return
                }
                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  selectMention(filteredMentionOptions[mentionIndex]!)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setMentionMenuOpen(false)
                  setAgentOnlyMenu(false)
                  return
                }
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                if (!busy && !attachmentsUploading && (commentInput.trim() || commentAttachments.length > 0)) {
                  void submitComment()
                }
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length === 0) return
              event.preventDefault()
              void uploadCommentAttachments(files)
            }}
            onClick={(event) => updateMentionMenuFromInput(commentInput, event.currentTarget.selectionStart ?? commentInput.length)}
            placeholder="留下评论… 输入 @ 提及成员或 Agent"
            className="min-h-[72px] resize-y border-none bg-transparent px-0 py-0 text-[13px] leading-5 text-zinc-300 shadow-none focus-visible:ring-0"
          />

          <TaskCommentAttachmentItems
            attachments={commentAttachments}
            onRemove={(attachmentId) => setCommentAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))}
          />

          {selectedMentions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedMentions.map((option) => {
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => removeMention(option)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px]',
                      'border-zinc-700 bg-zinc-900 text-zinc-400',
                    )}
                  >
                    @{option.name}
                    <X className="h-3 w-3" />
                  </button>
                )
              })}
            </div>
          ) : null}

          {dispatchPreview.length > 0 || dispatchPreviewError || (dispatchPreviewLoading && dispatchPreviewKey) ? (
            <div
              className={cn(
                'mt-2 flex flex-wrap gap-1.5 transition-opacity',
                dispatchPreviewLoading && dispatchPreview.length > 0 && 'opacity-60',
              )}
              aria-live="polite"
              aria-busy={dispatchPreviewLoading}
            >
              {/* 首次加载用与结果标签等高的占位，避免加载态与结果态切换时评论框高度跳动 */}
              {dispatchPreviewLoading && dispatchPreview.length === 0 && !dispatchPreviewError ? (
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                  正在检查触发结果…
                </span>
              ) : null}
              {dispatchPreview.map((outcome) => {
                const meta = resolveTaskCommentDispatchPreviewMeta(outcome)
                return (
                  <span
                    key={`${outcome.targetType}:${outcome.targetId}`}
                    className={cn(
                      'inline-flex max-w-full items-center rounded-md border px-1.5 py-1 text-[10px]',
                      meta.tone === 'agent' && 'border-sky-500/25 bg-sky-500/10 text-sky-300',
                      meta.tone === 'human' && 'border-zinc-700 bg-zinc-900 text-zinc-400',
                      meta.tone === 'neutral' && 'border-zinc-800 bg-zinc-950 text-zinc-500',
                      meta.tone === 'blocked' && 'border-rose-500/25 bg-rose-500/10 text-rose-300',
                    )}
                  >
                    {meta.label}
                  </span>
                )
              })}
              {dispatchPreviewError ? (
                <span className="inline-flex max-w-full items-center rounded-md border border-rose-500/25 bg-rose-500/10 px-1.5 py-1 text-[10px] text-rose-300">
                  预览失败：{dispatchPreviewError}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-800/60 pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={busy || attachmentsUploading || commentAttachments.length >= TASK_COMMENT_ATTACHMENT_LIMIT}
                className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300 disabled:opacity-50"
                aria-label="添加评论附件"
              >
                {attachmentsUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                {commentAttachments.length > 0 ? `${commentAttachments.length}/${TASK_COMMENT_ATTACHMENT_LIMIT}` : '附件'}
              </button>
              <span className="text-[11px] text-zinc-600">Cmd/Ctrl + Enter 发送</span>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitComment()}
              disabled={busy || attachmentsUploading || (!commentInput.trim() && commentAttachments.length === 0)}
              className="h-7 gap-1 rounded-md bg-zinc-100 px-2.5 text-[11px] font-medium text-zinc-950 hover:bg-zinc-200"
            >
              <MessageSquare className="h-3 w-3" />
              发送
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function workspaceStatusLabel(status: Workspace['status']) {
  switch (status) {
    case 'ready':
      return '可用'
    case 'pending_repo':
      return '仓库准备中'
    case 'missing_repo':
      return '缺少仓库'
    case 'archived':
      return '已归档'
    default:
      return status
  }
}

export function workspaceStatusBadgeClass(status: Workspace['status']) {
  switch (status) {
    case 'ready':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    case 'pending_repo':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    case 'missing_repo':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
    case 'archived':
      return 'border-zinc-700 bg-zinc-950 text-zinc-400'
    default:
      return 'border-zinc-700 bg-zinc-950 text-zinc-200'
  }
}

export const workspacePendingKeyframes = `
@keyframes workspace-pending-breathe {
  0%, 100% {
    opacity: 0.45;
    transform: scale(0.985);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes workspace-pending-dot-breathe {
  0%, 100% {
    opacity: 0.6;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1.14);
  }
}
`
