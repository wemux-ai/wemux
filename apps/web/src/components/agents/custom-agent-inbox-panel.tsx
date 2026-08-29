/**
 * [INPUT]: Selected owned Agent id and owner-scoped Agent Inbox HTTP/SSE endpoints.
 * [OUTPUT]: Compact Agent Inbox with actionable/observe/history groups, item detail, and linked execution attempts.
 * [POS]: Agent-control-center Inbox view; owner inspection never marks an Agent item read.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  Archive,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'

import {
  resolveInboxSection,
  type InboxExecutionSummary,
  type InboxGroupListResponse,
  type InboxGroupSummary,
  type InboxItem,
  type InboxQueryScope,
  type InboxSection,
} from '@shared/inbox'
import { getAuthHeaders, resolveApiUrl } from '../../lib/api'
import { cn, formatDate } from '../../lib/utils'
import { Button } from '../ui/button'

const SECTIONS: Array<{ id: InboxQueryScope; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'action', label: '待处理' },
  { id: 'following', label: '仅知悉' },
  { id: 'archived', label: '历史' },
]

const EMPTY_LABELS: Record<InboxQueryScope, string> = {
  all: '暂无收件记录',
  action: '暂无待处理项目',
  following: '暂无知悉项目',
  snoozed: '暂无稍后提醒',
  archived: '暂无历史记录',
}

/** 全部视图里每行标出自己的真实归属，否则待处理和历史混在一起看不出区别。 */
const SECTION_BADGES: Record<InboxSection, { label: string; tone: string }> = {
  action: { label: '待处理', tone: 'bg-amber-500/10 text-amber-300' },
  following: { label: '仅知悉', tone: 'bg-zinc-500/10 text-zinc-400' },
  snoozed: { label: '稍后', tone: 'bg-violet-500/10 text-violet-300' },
  archived: { label: '已归档', tone: 'bg-zinc-700/20 text-zinc-500' },
}

type AgentInboxItem = InboxItem & { execution?: InboxExecutionSummary }
type AgentInboxItemsResponse = { items: AgentInboxItem[]; unreadGroups: number }
type AgentInboxAttempt = {
  agentTaskId: string
  type: string
  status: string
  relation: string
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  run?: {
    id: string
    attempt: number
    status: string
    failureCode?: string | null
    failureMessage?: string | null
    conversationSessionId?: string | null
  } | null
}

const shortId = (id: string) => (id.length > 10 ? id.slice(0, 8) : id)

const requestJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(resolveApiUrl(path), { headers: getAuthHeaders() })
  if (!response.ok) throw new Error(`Agent Inbox request failed: ${response.status}`)
  return response.json() as Promise<T>
}

const executionLabel = (execution?: InboxExecutionSummary) => {
  if (!execution) return '未派发'
  const labels: Record<InboxExecutionSummary['status'], string> = {
    not_woken: '未唤醒',
    pending: '排队中',
    running: '运行中',
    waiting: '等待中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
    dispatch_fault: '派发异常',
  }
  return labels[execution.status]
}

const executionTone = (status?: InboxExecutionSummary['status']) => (
  status === 'completed'
    ? 'text-emerald-400'
    : status === 'failed' || status === 'dispatch_fault'
      ? 'text-rose-400'
      : status === 'running' || status === 'waiting'
        ? 'text-sky-400'
        : 'text-zinc-500'
)

/** 关系说明这次执行是怎么来的：首次派发、合并的评论、重试还是等待后恢复。 */
const relationLabel = (relation: string) => ({
  primary: '首次派发',
  coalesced: '合并事件',
  retry: '重试',
  resume: '等待恢复',
}[relation] ?? relation)

const attemptStatusLabel = (status: string) => ({
  pending: '排队中',
  running: '运行中',
  waiting: '等待中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
}[status] ?? status)

const reasonLabel: Record<InboxItem['reason'], string> = {
  assigned: '被指派',
  started: '被启动',
  mentioned: '被提及',
  replied: '收到回复',
  subscribed: '关注更新',
  workspace_completed: '工作区完成',
  workspace_failed: '工作区失败',
  workspace_needs_input: '工作区等待输入',
  status_changed: '状态变化',
  handoff_requested: 'Agent 交接',
  handoff_returned: '交接回执',
  quick_create: '快速建任务',
  generic_event: '产品事件',
}

export function CustomAgentInboxPanel({ agentId }: { agentId: string }) {
  const navigate = useNavigate()
  const [section, setSection] = useState<InboxQueryScope>('all')
  const [groups, setGroups] = useState<InboxGroupSummary[]>([])
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [items, setItems] = useState<AgentInboxItem[]>([])
  const [selectedItemId, setSelectedItemId] = useState('')
  const [attempts, setAttempts] = useState<AgentInboxAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const selectedGroup = groups.find((group) => group.groupKey === selectedGroupKey) ?? groups[0]
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0]

  const refreshGroups = async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const search = new URLSearchParams({ section, limit: '100' })
      const response = await requestJson<InboxGroupListResponse>(
        `/api/agents/${encodeURIComponent(agentId)}/inbox/groups?${search.toString()}`,
      )
      setGroups(response.groups)
      setSelectedGroupKey((current) => (
        response.groups.some((group) => group.groupKey === current)
          ? current
          : response.groups[0]?.groupKey ?? ''
      ))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 Agent Inbox。')
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  useEffect(() => {
    void refreshGroups()
  }, [agentId, section])

  useEffect(() => {
    if (!selectedGroup) {
      setItems([])
      setSelectedItemId('')
      return
    }
    let cancelled = false
    const search = new URLSearchParams({ section, limit: '200' })
    void requestJson<AgentInboxItemsResponse>(
      `/api/agents/${encodeURIComponent(agentId)}/inbox/groups/${encodeURIComponent(selectedGroup.groupKey)}/items?${search.toString()}`,
    ).then((response) => {
      if (cancelled) return
      setItems(response.items)
      setSelectedItemId((current) => response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? '')
    }).catch(() => {
      if (!cancelled) setItems([])
    })
    return () => { cancelled = true }
  }, [agentId, section, selectedGroup?.groupKey])

  useEffect(() => {
    if (!selectedItem) {
      setAttempts([])
      return
    }
    let cancelled = false
    void requestJson<{ attempts: AgentInboxAttempt[] }>(
      `/api/agents/${encodeURIComponent(agentId)}/inbox/items/${encodeURIComponent(selectedItem.id)}/attempts`,
    ).then((response) => {
      if (!cancelled) setAttempts(response.attempts)
    }).catch(() => {
      if (!cancelled) setAttempts([])
    })
    return () => { cancelled = true }
  }, [agentId, selectedItem?.id])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let controller: AbortController | undefined
    const connect = async () => {
      controller = new AbortController()
      try {
        const response = await fetch(resolveApiUrl(`/api/agents/${encodeURIComponent(agentId)}/inbox/stream`), {
          headers: getAuthHeaders(),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error('stream failed')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!cancelled) {
          const part = await reader.read()
          if (part.done) break
          buffer += decoder.decode(part.value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          if (events.some((event) => event.includes('event: inbox.'))) void refreshGroups(true)
        }
      } catch {
        // Reconnect below.
      }
      if (!cancelled) timer = window.setTimeout(() => void connect(), 1_500)
    }
    void connect()
    return () => {
      cancelled = true
      controller?.abort()
      if (timer) window.clearTimeout(timer)
    }
  }, [agentId, section])

  // 跳转优先级与人类收件箱一致：任务 > 工作区。
  const openScope = async (item: AgentInboxItem) => {
    if (item.scope.taskId) {
      await navigate({
        to: '/kanban' as never,
        search: {
          projectId: item.scope.projectId || undefined,
          taskId: item.scope.taskId,
          createTask: undefined,
        } as never,
      })
      return
    }
    if (item.scope.workspaceId) {
      await navigate({
        to: '/workspaces' as never,
        search: {
          workspaceId: item.scope.workspaceId,
          workspaceSessionId: item.scope.workspaceSessionId,
          projectId: item.scope.projectId,
        } as never,
      })
    }
  }

  // 完整 UUID 在这里只是噪声，截断展示、hover 看全量。
  const scopeLabels = useMemo(() => {
    if (!selectedItem) return []
    // navigable：只有能打开的对象才做成可点，Session/Trace 是排查标识、没有落地页。
    const chip = (label: string, id?: string, navigable = false) => (
      id ? [{ label, value: shortId(id), title: `${label} ${id}`, navigable }] : []
    )
    return [
      ...chip('Task', selectedItem.scope.taskId, true),
      ...chip('Workspace', selectedItem.scope.workspaceId, true),
      ...chip('Session', selectedItem.scope.workspaceSessionId),
      ...chip('Trace', selectedItem.traceId),
    ]
  }, [selectedItem])

  return (
    // 高度由父容器给定，不再用 100vh 减魔法数字去猜上方 chrome 的高度。
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090b]">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-zinc-950/80 p-0.5 ring-1 ring-inset ring-zinc-800/80">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
                section === entry.id
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] tabular-nums text-zinc-600">
          {groups.length > 0 ? `${groups.length} 组` : ''}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7 text-zinc-500 hover:text-zinc-200"
          onClick={() => void refreshGroups()}
          title="刷新"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 md:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-zinc-800 bg-[#060607] md:border-b-0 md:border-r">
          {loading && groups.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-zinc-600"><Loader2 className="h-4 w-4 animate-spin" />正在读取</div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-6 py-20 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-600">
                <Inbox className="h-4 w-4" />
              </span>
              <p className="text-xs text-zinc-500">{EMPTY_LABELS[section]}</p>
            </div>
          ) : groups.map((group) => {
            const selected = selectedGroup?.groupKey === group.groupKey
            const badge = section === 'all' ? SECTION_BADGES[resolveInboxSection(group.latestItem)] : null
            return (
              <button
                key={group.groupKey}
                type="button"
                onClick={() => setSelectedGroupKey(group.groupKey)}
                className={cn(
                  'relative flex w-full items-start gap-2.5 border-b border-zinc-900/70 px-3 py-3 text-left transition-colors',
                  selected ? 'bg-zinc-900/60' : 'hover:bg-zinc-900/30',
                )}
              >
                {/* 选中态用左侧色条，比整块背景更能在窄列里读出来。 */}
                {selected ? <span className="absolute inset-y-0 left-0 w-0.5 bg-zinc-100" /> : null}
                <span className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                  group.latestItem.kind === 'observe'
                    ? 'border-zinc-800 bg-zinc-950 text-zinc-600'
                    : 'border-zinc-700/60 bg-zinc-900 text-zinc-400',
                )}>
                  {group.latestItem.kind === 'observe' ? <CircleDot className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    {group.unreadCount > 0 ? <span className="mb-px h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" /> : null}
                    <span className={cn(
                      'min-w-0 flex-1 truncate text-xs',
                      group.unreadCount > 0 ? 'font-semibold text-zinc-100' : 'font-medium text-zinc-300',
                    )}>
                      {group.latestItem.title}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {formatDate(group.latestItem.createdAt)}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] leading-4 text-zinc-500">
                    {group.latestItem.actorName} · {group.latestItem.body}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {badge ? (
                      <span className={cn('rounded px-1.5 text-[9px] font-medium leading-4', badge.tone)}>{badge.label}</span>
                    ) : null}
                    <span className="rounded bg-zinc-900 px-1.5 text-[9px] leading-4 text-zinc-500">
                      {reasonLabel[group.latestItem.reason]}
                    </span>
                    <span className={cn('text-[10px]', executionTone(group.execution?.status))}>{executionLabel(group.execution)}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {!selectedItem ? (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-600">
                <MessageSquare className="h-4 w-4" />
              </span>
              <p className="text-xs text-zinc-500">选择左侧任一条目查看详情与执行记录</p>
            </div>
          ) : (
            <div>
              <header className="space-y-3 border-b border-zinc-800 px-5 py-4">
                {/* min-w-0：标题块不能收缩时会把右侧按钮挤出容器裁掉。 */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                      <span className="rounded bg-zinc-900 px-1.5 leading-4 text-zinc-400">{reasonLabel[selectedItem.reason]}</span>
                      <code className="truncate font-mono text-zinc-600">{selectedItem.eventType}</code>
                    </div>
                    <h3 className="mt-1.5 text-base font-semibold leading-6 text-zinc-100">{selectedItem.title}</h3>
                  </div>
                  {selectedItem.scope.taskId || selectedItem.scope.workspaceId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 gap-1.5 whitespace-nowrap border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
                      onClick={() => void openScope(selectedItem)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {selectedItem.scope.taskId ? '打开任务' : '打开工作区'}
                    </Button>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">{selectedItem.body}</p>
                {/* items-start：否则 flex 默认 stretch 会把这些角标拉成整行高的大方块。 */}
                <div className="flex flex-wrap items-start gap-1.5">
                  <span className={cn(
                    'inline-flex h-5 shrink-0 items-center rounded bg-zinc-900 px-1.5 text-[10px] leading-none',
                    executionTone(selectedItem.execution?.status),
                  )}>
                    {executionLabel(selectedItem.execution)}
                  </span>
                  {scopeLabels.map((scope) => scope.navigable ? (
                    <button
                      key={scope.title}
                      type="button"
                      title={`${scope.title}（点击打开）`}
                      onClick={() => void openScope(selectedItem)}
                      className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-zinc-900 px-1.5 font-mono text-[10px] leading-none text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <span className="text-zinc-600">{scope.label}</span>
                      {scope.value}
                      <ExternalLink className="h-2.5 w-2.5 text-zinc-600" />
                    </button>
                  ) : (
                    <span
                      key={scope.title}
                      title={scope.title}
                      className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-zinc-900 px-1.5 font-mono text-[10px] leading-none text-zinc-500"
                    >
                      <span className="text-zinc-600">{scope.label}</span>
                      {scope.value}
                    </span>
                  ))}
                </div>
              </header>

              {/* 只有一条时它就是上面的正文，重复显示没有信息量。 */}
              {items.length > 1 ? (
                <div className="border-b border-zinc-800 px-5 py-4">
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-600">本组动态 · {items.length}</p>
                  <div className="space-y-0.5">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedItemId(item.id)}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                          selectedItem.id === item.id ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/40',
                        )}
                      >
                        <span className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          selectedItem.id === item.id ? 'bg-zinc-300' : 'bg-zinc-700',
                        )} />
                        <span className="min-w-0 flex-1 text-xs leading-5 text-zinc-400">
                          <span className="font-medium text-zinc-300">{item.actorName}</span>
                          <span className="text-zinc-600"> · </span>
                          {item.body}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{formatDate(item.createdAt)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="px-5 py-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-600">执行记录</p>
                {attempts.length === 0 ? (
                  <div className="flex items-center gap-2 py-3 text-xs text-zinc-600">
                    {selectedItem.kind === 'observe' ? <CircleDot className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4 text-rose-500" />}
                    {selectedItem.kind === 'observe' ? '仅知悉项目，没有唤醒 Agent。' : '没有关联执行记录，派发可能异常。'}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {attempts.map((attempt) => (
                      <div
                        key={attempt.agentTaskId}
                        className="flex items-start gap-3 rounded-md border border-zinc-800/80 bg-zinc-950/60 px-3 py-2.5"
                      >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900">
                          {attempt.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : attempt.status === 'failed' ? <TriangleAlert className="h-3.5 w-3.5 text-rose-400" /> : <Activity className="h-3.5 w-3.5 text-sky-400" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-medium text-zinc-200">第 {attempt.run?.attempt ?? 1} 次</span>
                            <span className="rounded bg-zinc-900 px-1.5 text-[10px] leading-4 text-zinc-500">{relationLabel(attempt.relation)}</span>
                            <span className={cn('ml-auto shrink-0', executionTone(attempt.status as InboxExecutionSummary['status']))}>
                              {attemptStatusLabel(attempt.status)}
                            </span>
                          </div>
                          {attempt.run?.failureMessage ? (
                            <p className="mt-1.5 rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-xs leading-5 text-rose-300">
                              {attempt.run.failureMessage}
                            </p>
                          ) : null}
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] tabular-nums text-zinc-600">
                            <Clock3 className="h-3 w-3" />{formatDate(attempt.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
