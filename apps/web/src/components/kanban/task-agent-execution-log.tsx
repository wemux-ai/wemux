/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Task-scoped AgentTask records, a shared selected Transcript event, invalidation signals, and activity action callbacks.
 * [OUTPUT]: Multica-style active/past execution log with unified Agent activity states, retry session choice, attempts, live duration, heartbeat/usage, and push-refreshed in-task transcript.
 * [POS]: Task-detail execution observability backed by AgentTaskRun, with Main Chat retained as the conversation entry and legacy fallback.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Copy, Loader2, MessageCircle, MessageSquareText, Play, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentRunningStatus, MainChatSession } from '@shared/types'
import { api, resolveMediaUrl, type TaskAgentActivityRecord, type TaskAgentRetrySessionMode } from '../../lib/api'
import { cn, formatDate } from '../../lib/utils'
import { ChatTranscript } from '../chat/chat-transcript'
import {
  buildMainChatTranscriptTurns,
  chatMessagesToChatBubbleMessages,
  filterMainChatTranscriptTurns,
  formatMainChatTranscriptTurnsForCopy,
  type MainChatTranscriptFilter,
} from '../chat/main-chat-transcript-turns'
import { Button } from '../ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { AgentActivityIndicator } from '../agent-activity-indicator'
import { TaskIdentityAvatar } from './task-identity-avatar'
import { describeTaskAgentActivityTrigger } from './task-timeline-model'

interface TaskAgentExecutionLogProps {
  taskId: string
  activities: TaskAgentActivityRecord[]
  loading: boolean
  actionEventId?: string
  transcriptEventId: string
  transcriptSignals?: Record<string, string>
  canStartAssignedAgent?: boolean
  startAssignedAgentDisabled?: boolean
  onStartAssignedAgent?: () => void
  onCancel: (eventId: string) => void
  onRetry: (eventId: string, sessionMode: TaskAgentRetrySessionMode) => Promise<boolean>
  onTranscriptEventIdChange: (eventId: string) => void
  onOpenConversation: (sessionId: string) => void
}

export const parseTaskAgentActivityStreamEvent = (block: string) => {
  const event = block.split('\n').find((line) => line.startsWith('event:'))?.slice('event:'.length).trim()
  const dataText = block.split('\n').find((line) => line.startsWith('data:'))?.slice('data:'.length).trim()
  if (!event || !dataText) return null
  try {
    return { event, data: JSON.parse(dataText) as Record<string, unknown> }
  } catch {
    return null
  }
}

const isActiveActivity = (activity: TaskAgentActivityRecord) => (
  activity.status === 'pending' || activity.status === 'running' || activity.status === 'waiting'
)

const ACTIVE_STATUS_RANK: Record<TaskAgentActivityRecord['status'], number> = {
  running: 0,
  waiting: 1,
  pending: 2,
  failed: 3,
  canceled: 4,
  completed: 5,
}

export const splitTaskAgentActivities = (activities: TaskAgentActivityRecord[]) => ({
  active: activities
    .filter(isActiveActivity)
    .sort((left, right) => (
      ACTIVE_STATUS_RANK[left.status] - ACTIVE_STATUS_RANK[right.status]
      || right.createdAt.localeCompare(left.createdAt)
    )),
  past: activities
    .filter((activity) => !isActiveActivity(activity))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
})

export const resolveAgentActivityRetryDefault = (
  activity: Pick<TaskAgentActivityRecord, 'recommendedRetrySessionMode'>,
): TaskAgentRetrySessionMode => activity.recommendedRetrySessionMode ?? 'resume'

export const formatAgentActivityElapsed = (startedAt: string | null, now: number) => {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN
  if (!Number.isFinite(startedAtMs)) return ''
  const totalSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const agentActivityStatusMeta: Record<TaskAgentActivityRecord['status'], { label: string }> = {
  pending: { label: '等待 Agent 领取' },
  running: { label: '正在处理' },
  waiting: { label: '等待输入' },
  completed: { label: '已完成' },
  failed: { label: '处理失败' },
  canceled: { label: '已取消' },
}

const agentRunningStatusByActivityStatus: Record<TaskAgentActivityRecord['status'], AgentRunningStatus> = {
  pending: 'idle',
  running: 'executing',
  waiting: 'waiting',
  completed: 'complete',
  failed: 'error',
  canceled: 'idle',
}

const agentActivityFailureLabel: Record<NonNullable<TaskAgentActivityRecord['failureCode']>, string> = {
  canceled: '用户取消',
  context_poisoned: '会话上下文污染',
  delivery_missing: '缺少任务交付',
  infrastructure_interrupted: '执行基础设施中断',
  infrastructure_unavailable: '执行节点不可用',
  execution_failed: 'Agent 执行失败',
}

const formatTokenCount = (value: number) => {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}

function AgentActivityTranscriptDialog({
  taskId,
  activity,
  open,
  transcriptUpdatedAt,
  onOpenChange,
  onOpenConversation,
}: {
  taskId: string
  activity: TaskAgentActivityRecord | null
  open: boolean
  transcriptUpdatedAt?: string
  onOpenChange: (open: boolean) => void
  onOpenConversation: (sessionId: string) => void
}) {
  const [session, setSession] = useState<MainChatSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<MainChatTranscriptFilter>('all')
  const loadedEventKeyRef = useRef('')
  const sessionId = activity?.conversationSessionId
  const eventId = activity?.id

  useEffect(() => setFilter('all'), [eventId])

  useEffect(() => {
    if (!open || !eventId) {
      loadedEventKeyRef.current = ''
      return
    }
    let cancelled = false
    const eventKey = `${taskId}:${eventId}`
    const initial = loadedEventKeyRef.current !== eventKey
    loadedEventKeyRef.current = eventKey
    const refresh = async () => {
      if (initial) setLoading(true)
      try {
        const response = await api.getTaskAgentActivityTranscript(taskId, eventId)
        if (!cancelled) {
          setSession(response.session)
          setError('')
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '执行过程读取失败。')
      } finally {
        if (!cancelled && initial) setLoading(false)
      }
    }

    if (initial) {
      setSession(null)
      setError('')
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [eventId, open, sessionId, taskId, transcriptUpdatedAt])

  const turns = useMemo(() => buildMainChatTranscriptTurns(chatMessagesToChatBubbleMessages(session?.messages ?? [])), [session?.messages])
  const filteredTurns = useMemo(() => filterMainChatTranscriptTurns(turns, filter), [filter, turns])
  const copyTranscript = async () => {
    const text = formatMainChatTranscriptTurnsForCopy(turns)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success('本轮 Transcript 已复制。')
    } catch {
      toast.error('复制失败，请手动选择内容。')
    }
  }
  const filterOptions: Array<{ value: MainChatTranscriptFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'conversation', label: '对话' },
    { value: 'process', label: '思考与工具' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] max-h-[820px] flex-col gap-0 overflow-hidden border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-4xl">
        <div className="shrink-0 border-b border-zinc-900 px-4 py-3 pr-12">
          <div className="flex items-center gap-3">
            <TaskIdentityAvatar
              type="agent"
              id={activity?.agentId}
              name={activity?.agentName || 'Agent'}
              avatarUrl={activity?.agentAvatarUrl}
              className="h-7 w-7 shrink-0"
              fallbackClassName="text-[9px] font-bold"
            />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm font-semibold text-zinc-100">{activity?.agentName || 'Agent'} · 执行过程</DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-[11px] text-zinc-600">
                {activity ? `${describeTaskAgentActivityTrigger(activity)} · ${agentActivityStatusMeta[activity.status].label}` : 'Agent 执行过程'}
              </DialogDescription>
            </div>
            {sessionId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenConversation(sessionId)}
                className="h-7 gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                打开 Agent Chat
              </Button>
            ) : null}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5" role="group" aria-label="Transcript 显示筛选">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    'h-6 rounded px-2 text-[10px] transition-colors',
                    filter === option.value ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-600 hover:text-zinc-300',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={turns.length === 0}
              onClick={() => void copyTranscript()}
              className="h-7 gap-1.5 rounded-md px-2 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Copy className="h-3.5 w-3.5" />
              复制整轮
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && !session ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取执行过程…
            </div>
          ) : error && !session ? (
            <div className="flex h-full items-center justify-center text-xs text-rose-300">{error}</div>
          ) : (
            <ChatTranscript
              turns={filteredTurns}
              isBusy={activity?.status === 'running'}
              assistantLabel={activity?.agentName}
              assistantAvatarUrl={resolveMediaUrl(activity?.agentAvatarUrl)}
              assistantAvatarFallback={activity?.agentName.trim().slice(0, 2).toUpperCase() || 'AI'}
              emptyTitle={filter === 'process' ? '没有思考或工具调用' : '还没有过程消息'}
              emptyDescription={filter === 'process' ? '切换到“全部”或“对话”查看本轮消息。' : 'Agent 领取后，消息、思考和工具调用会显示在这里。'}
              enableProcessFolding
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AgentActivityRetryDialog({
  activity,
  sessionMode,
  busy,
  onSessionModeChange,
  onConfirm,
  onOpenChange,
}: {
  activity: TaskAgentActivityRecord | null
  sessionMode: TaskAgentRetrySessionMode
  busy: boolean
  onSessionModeChange: (mode: TaskAgentRetrySessionMode) => void
  onConfirm: () => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const freshRequired = activity?.recommendedRetrySessionMode === 'fresh'
  const choices: Array<{
    mode: TaskAgentRetrySessionMode
    title: string
    description: string
  }> = [
    {
      mode: 'resume',
      title: '续接原会话',
      description: '保留已有对话上下文和 Agent 工作目录，适合节点离线、网络中断或限流恢复。',
    },
    {
      mode: 'fresh',
      title: '新开干净会话',
      description: '保留 Agent 工作目录，但不复用旧对话，适合上下文溢出、无效请求或迭代卡死。',
    },
  ]

  return (
    <Dialog open={Boolean(activity)} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-[#09090b] text-zinc-100 shadow-2xl shadow-black/40 sm:max-w-[520px]">
        <DialogBody className="space-y-3">
        <div>
          <DialogTitle className="text-sm font-semibold text-zinc-100">重试 Agent 执行</DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-5 text-zinc-500">
            选择是否沿用上一轮对话。两种方式都会继续使用当前 Agent 的工作目录。
          </DialogDescription>
        </div>

        {freshRequired ? (
          <div className="border-l-2 border-amber-400/70 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-300">
            检测到上一轮可能污染会话上下文，本次必须使用干净会话，避免重复失败。
          </div>
        ) : null}

        <div className="space-y-2">
          {choices.map((choice) => {
            const selected = sessionMode === choice.mode
            const disabled = busy || (freshRequired && choice.mode === 'resume')
            return (
              <button
                key={choice.mode}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSessionModeChange(choice.mode)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'border-zinc-600 bg-zinc-900/80 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-zinc-200',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="flex items-center gap-2 text-xs font-medium">
                  <span className={cn('h-1.5 w-1.5 rounded-full', selected ? 'bg-sky-400' : 'bg-zinc-600')} />
                  {choice.title}
                </span>
                <span className="mt-1 block pl-3.5 text-[11px] leading-5 text-zinc-500">{choice.description}</span>
              </button>
            )
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
            确认重试
          </Button>
        </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function AgentActivityRow({
  activity,
  actionBusy,
  expanded,
  now,
  onToggleExpanded,
  onCancel,
  onRetry,
  onOpenTranscript,
  onOpenConversation,
}: {
  activity: TaskAgentActivityRecord
  actionBusy: boolean
  expanded: boolean
  now: number
  onToggleExpanded: () => void
  onCancel: (eventId: string) => void
  onRetry: (eventId: string) => void
  onOpenTranscript: (eventId: string) => void
  onOpenConversation: (sessionId: string) => void
}) {
  const meta = agentActivityStatusMeta[activity.status]
  const activityVisualStatus = agentRunningStatusByActivityStatus[activity.status]
  const isRunning = activity.status === 'running'
  const active = isActiveActivity(activity)
  const error = activity.failureMessage || (typeof activity.result?.error === 'string' ? activity.result.error : '')
  const failureLabel = activity.failureCode ? agentActivityFailureLabel[activity.failureCode] : ''
  const elapsed = isRunning
    ? formatAgentActivityElapsed(activity.startedAt ?? activity.createdAt, now)
    : ''
  const retrySourceLabel = activity.retrySource === 'infrastructure'
    ? '自动重试'
    : activity.retrySource === 'manual'
      ? '手动重试'
      : ''
  const retrySessionLabel = activity.retrySource !== 'initial'
    ? activity.retrySessionMode === 'fresh'
      ? '干净会话'
      : activity.retrySessionMode === 'resume'
        ? '续接会话'
        : ''
    : ''
  const retryDetail = [retrySourceLabel, retrySessionLabel].filter(Boolean).join(' · ')
  const statusLabel = activity.status === 'pending' && activity.retrySource === 'infrastructure'
    ? '等待自动重试'
    : meta.label
  const usageLabel = activity.usage?.totalTokens
    ? `${formatTokenCount(activity.usage.totalTokens)} tokens`
    : ''
  const auditActorLabel = activity.retrySource === 'manual'
    ? `${activity.actingUserName || activity.triggerActorName || '用户'} 手动重试`
    : activity.retrySource === 'infrastructure'
      ? '系统自动重试'
      : activity.triggerActorName
        ? `${activity.triggerActorName} 触发`
        : ''
  const includedCommentsLabel = activity.includedCommentIds.length > 0
    ? `本轮包含 ${activity.includedCommentIds.length} 条评论`
    : ''
  const auditLabel = [auditActorLabel, includedCommentsLabel].filter(Boolean).join(' · ')
  const compactDetail = activity.summaryPreview || activity.comment || auditLabel

  return (
    <article
      className={cn(
        'border-b border-zinc-900/80',
        isRunning && 'bg-sky-500/[0.035]',
        activity.status === 'waiting' && 'bg-amber-500/[0.025]',
      )}
    >
      <div className="flex items-start gap-2.5 py-2.5">
        <TaskIdentityAvatar
          type="agent"
          id={activity.agentId}
          name={activity.agentName}
          avatarUrl={activity.agentAvatarUrl}
          className="h-6 w-6 shrink-0"
          fallbackClassName="text-[9px] font-bold"
        />
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left outline-none hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-zinc-700"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-zinc-300">{activity.agentName}</span>
            <span className="truncate text-[10px] text-zinc-600">{describeTaskAgentActivityTrigger(activity)}</span>
            <span className={cn('shrink-0 text-[10px]', retrySourceLabel ? 'text-amber-300' : 'text-zinc-600')}>
              第 {activity.attempt} 次{retryDetail ? ` · ${retryDetail}` : ''}
            </span>
            <span className={cn('ml-auto shrink-0 text-[10px] tabular-nums', isRunning ? 'text-sky-300' : 'text-zinc-600')}>
              {elapsed || formatDate(activity.completedAt || activity.startedAt || activity.createdAt)}
            </span>
          </span>
          {compactDetail ? <span className="mt-1 block truncate text-[10px] text-zinc-600">{compactDetail}</span> : null}
        </button>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[10px] text-zinc-500">
          <AgentActivityIndicator status={activityVisualStatus} variant="dot" size="xs" />
          <span className={cn(isRunning && 'text-sky-300')}>{statusLabel}</span>
          <ChevronRight className={cn('h-3 w-3 text-zinc-600 transition-transform', expanded && 'rotate-90')} />
        </div>
      </div>

      {expanded ? (
        <div className="ml-[34px] border-l border-zinc-900 pl-3 pb-3">
          <div className="space-y-1">
            {activity.summaryPreview ? <p className="text-[11px] leading-4 text-zinc-400">{activity.summaryPreview}</p> : null}
            {activity.comment && activity.comment !== activity.summaryPreview ? (
              <p className="text-[11px] leading-4 text-zinc-500">{activity.comment}</p>
            ) : null}
            {activity.coalescedCommentCount > 0 ? (
              <p className="text-[10px] text-amber-300">已合并 {activity.coalescedCommentCount} 条后续评论</p>
            ) : null}
            {auditLabel ? <p className="text-[10px] text-zinc-600">{auditLabel}</p> : null}
            {activity.status === 'pending' && activity.retrySource === 'infrastructure' && activity.retryScheduledAt ? (
              <p className="text-[10px] text-amber-300">基础设施故障，计划于 {formatDate(activity.retryScheduledAt)} 自动重试</p>
            ) : null}
            {activity.lastHeartbeatAt && active ? (
              <p className={cn('text-[10px]', isRunning ? 'text-sky-300/80' : 'text-zinc-600')}>
                最近心跳 · {formatDate(activity.lastHeartbeatAt)}
              </p>
            ) : null}
            {usageLabel ? <p className="text-[10px] text-zinc-600">用量 · {usageLabel}</p> : null}
            {error ? <p className="text-[11px] text-rose-300">{failureLabel ? `${failureLabel}：` : ''}{error}</p> : null}
          </div>
          <div className="mt-2 flex items-center gap-1">
          {activity.transcriptAvailable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionBusy}
              onClick={() => onOpenTranscript(activity.id)}
              className="h-5 gap-1 rounded-md px-1.5 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <MessageSquareText className="h-3 w-3" />
              {isRunning ? '查看实时过程' : '查看过程'}
            </Button>
          ) : null}
          {activity.conversationSessionId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionBusy}
              onClick={() => onOpenConversation(activity.conversationSessionId!)}
              className="h-5 gap-1 rounded-md px-1.5 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <MessageCircle className="h-3 w-3" />
              打开对话
            </Button>
          ) : null}
          {active ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionBusy}
              onClick={() => onCancel(activity.id)}
              className="h-5 gap-1 rounded-md px-1.5 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              {actionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-2.5 w-2.5" />}
              取消
            </Button>
          ) : null}
          {(activity.status === 'failed' || activity.status === 'canceled') ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionBusy}
              onClick={() => onRetry(activity.id)}
              className="h-5 gap-1 rounded-md px-1.5 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              {actionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              重试
            </Button>
          ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}

export function TaskAgentExecutionLog({
  taskId,
  activities,
  loading,
  actionEventId,
  transcriptEventId,
  transcriptSignals,
  canStartAssignedAgent,
  startAssignedAgentDisabled,
  onStartAssignedAgent,
  onCancel,
  onRetry,
  onTranscriptEventIdChange,
  onOpenConversation,
}: TaskAgentExecutionLogProps) {
  const [showPast, setShowPast] = useState(false)
  const [expandedActivityIds, setExpandedActivityIds] = useState<Record<string, boolean>>({})
  const [retryEventId, setRetryEventId] = useState('')
  const [retrySessionMode, setRetrySessionMode] = useState<TaskAgentRetrySessionMode>('resume')
  const [now, setNow] = useState(() => Date.now())
  const { active, past } = useMemo(() => splitTaskAgentActivities(activities), [activities])
  const runningCount = active.filter((activity) => activity.status === 'running').length
  const activeVisualStatus: AgentRunningStatus = runningCount > 0
    ? 'executing'
    : active.some((activity) => activity.status === 'waiting')
      ? 'waiting'
      : 'idle'
  const selectedActivity = activities.find((activity) => activity.id === transcriptEventId) ?? null
  const retryActivity = activities.find((activity) => activity.id === retryEventId) ?? null

  const openRetryDialog = (eventId: string) => {
    const activity = activities.find((item) => item.id === eventId)
    if (!activity) return
    setRetrySessionMode(resolveAgentActivityRetryDefault(activity))
    setRetryEventId(eventId)
  }

  const confirmRetry = async () => {
    if (!retryActivity) return
    if (await onRetry(retryActivity.id, retrySessionMode)) setRetryEventId('')
  }

  const isActivityExpanded = (activity: TaskAgentActivityRecord) => (
    isActiveActivity(activity)
      ? expandedActivityIds[activity.id] !== false
      : expandedActivityIds[activity.id] === true
  )

  const toggleActivityExpanded = (activity: TaskAgentActivityRecord) => {
    const expanded = isActivityExpanded(activity)
    setExpandedActivityIds((current) => ({ ...current, [activity.id]: !expanded }))
  }

  useEffect(() => {
    if (!active.some((activity) => activity.status === 'running')) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between border-b border-zinc-800/40 pb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Agent 执行日志</h3>
        <div className="flex items-center gap-2">
          {active.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-sky-300">
              <AgentActivityIndicator status={activeVisualStatus} variant="dot" size="xs" />
              {runningCount > 0 ? `${runningCount} 个正在运行` : `${active.length} 个活跃运行`}
            </span>
          ) : <span className="text-[11px] text-zinc-600">{activities.length}</span>}
          {canStartAssignedAgent && onStartAssignedAgent ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={startAssignedAgentDisabled || active.length > 0}
              onClick={onStartAssignedAgent}
              className="h-6 gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <Play className="h-3 w-3" />
              {active.length > 0 ? '正在运行' : '启动 Agent'}
            </Button>
          ) : null}
        </div>
      </div>

      {loading && activities.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-xs text-zinc-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在读取执行状态…
        </div>
      ) : activities.length === 0 ? (
        <div className="py-3 text-xs text-zinc-600">还没有 Agent 执行记录。</div>
      ) : (
        <div>
          {active.length > 0 ? (
            <div className="border-y border-sky-500/15">
              <div className="flex items-center justify-between px-0 py-2 text-[10px]">
                <span className="inline-flex items-center gap-1.5 text-sky-300">
                  <AgentActivityIndicator status={activeVisualStatus} variant="dot" size="xs" />
                  {runningCount > 0 ? '实时执行' : '待处理运行'}
                </span>
                <span className="text-zinc-600">{active.length} 条</span>
              </div>
              {active.map((activity) => (
                <AgentActivityRow
                  key={activity.id}
                  activity={activity}
                  actionBusy={actionEventId === activity.id}
                  expanded={isActivityExpanded(activity)}
                  now={now}
                  onToggleExpanded={() => toggleActivityExpanded(activity)}
                  onCancel={onCancel}
                  onRetry={openRetryDialog}
                  onOpenTranscript={onTranscriptEventIdChange}
                  onOpenConversation={onOpenConversation}
                />
              ))}
            </div>
          ) : null}

          {past.length > 0 ? (
            <div className={cn(active.length > 0 && 'pt-1')}>
              <button
                type="button"
                onClick={() => setShowPast((current) => !current)}
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left text-[11px] text-zinc-500 transition-colors hover:bg-zinc-900/60 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700"
              >
                <ChevronRight className={cn('h-3 w-3 transition-transform', showPast && 'rotate-90')} />
                <span>历史运行</span>
                <span className="text-zinc-700">{past.length}</span>
                <span className="ml-auto text-[10px] text-zinc-600">{showPast ? '收起' : '展开'}</span>
              </button>
              {showPast ? (
                <div className="border-t border-zinc-900/80">
                  {past.map((activity) => (
                    <AgentActivityRow
                      key={activity.id}
                      activity={activity}
                      actionBusy={actionEventId === activity.id}
                      expanded={isActivityExpanded(activity)}
                      now={now}
                      onToggleExpanded={() => toggleActivityExpanded(activity)}
                      onCancel={onCancel}
                      onRetry={openRetryDialog}
                      onOpenTranscript={onTranscriptEventIdChange}
                      onOpenConversation={onOpenConversation}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <AgentActivityTranscriptDialog
        taskId={taskId}
        activity={selectedActivity}
        open={Boolean(selectedActivity)}
        transcriptUpdatedAt={selectedActivity ? transcriptSignals?.[selectedActivity.id] : undefined}
        onOpenChange={(nextOpen) => { if (!nextOpen) onTranscriptEventIdChange('') }}
        onOpenConversation={onOpenConversation}
      />
      <AgentActivityRetryDialog
        activity={retryActivity}
        sessionMode={retrySessionMode}
        busy={Boolean(retryActivity && actionEventId === retryActivity.id)}
        onSessionModeChange={setRetrySessionMode}
        onConfirm={confirmRetry}
        onOpenChange={(nextOpen) => { if (!nextOpen) setRetryEventId('') }}
      />
    </section>
  )
}
