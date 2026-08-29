// [INPUT]: Agent 协作页面请求
// [OUTPUT]: /brain Agent 协作只读视图（团队大脑：事件流 + 摘要 + 分发记录 + 已纳入文件）
// [POS]: Agent 协作（Agent Brain）可视化页面；UI 只显示「Agent 协作/Agent Collaboration」，
//        页面使用面向用户的协作术语；个人上下文能力按需展示。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { getStoredCollaborationWorkspaceId, COLLABORATION_WORKSPACE_CHANGE_EVENT } from '@/lib/collaboration-workspace'
import { formatRelativeTime } from '@/components/dashboard/dashboard-data'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context'
import type {
  WorkspaceBrainOverview,
  WorkspaceBrainMyContext,
  WorkspaceBrainDispatchRecord,
  WorkspaceBrainContextItem,
  WorkspaceBrainFile,
} from '@/lib/api/types'

export const Route = createFileRoute('/brain')({
  component: BrainPage,
})

type TabKey = 'team' | 'personal'

const KIND_LABEL: Record<WorkspaceBrainContextItem['kind'], string> = {
  group_chat: '群聊',
  event: '事件',
  task: '任务',
  session: '会话',
}

const STATUS_TONE: Record<string, string> = {
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  running: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  running: '处理中',
  pending: '排队中',
  failed: '失败',
  canceled: '已取消',
  waiting: '等待中',
}

function BrainPage() {
  const [tab, setTab] = useState<TabKey>('team')
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(() => getStoredCollaborationWorkspaceId() || undefined)
  const [overview, setOverview] = useState<WorkspaceBrainOverview | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      setWorkspaceId(detail?.workspaceId || undefined)
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleChange)
  }, [])

  const reload = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const data = await api.getWorkspaceBrainOverview(workspaceId)
      setOverview(data)
    } catch (error) {
      setOverview(null)
      console.error('[brain] load overview failed:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  const teamTab = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-900 px-5 py-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">团队大脑</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            事件流是大脑自动积累的工作区脉搏；云盘文件是主动纳入的知识。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          刷新
        </Button>
      </div>
      {!workspaceId ? (
        <WorkspaceRequiredHint />
      ) : loading && !overview ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">加载中…</div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <SummaryCard overview={overview} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <EventTimeline items={overview?.context.recentItems ?? []} updatedAt={overview?.context.updatedAt} />
            <DispatchRecords records={overview?.dispatchRecords ?? []} />
          </div>
          <BrainFiles files={overview?.files ?? []} />
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col bg-[#09090b]">
      <div className="flex items-center gap-1 border-b border-zinc-900 bg-[#060607] px-4 pt-2">
        <TabButton active={tab === 'team'} onClick={() => setTab('team')}>团队大脑</TabButton>
        <TabButton active={tab === 'personal'} onClick={() => setTab('personal')}>我的上下文</TabButton>
      </div>
      {tab === 'team' ? teamTab : <PersonalContextTab />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'border-b-2 px-3 pb-2 pt-1 text-sm transition-colors',
        active
          ? 'border-zinc-200 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-300',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// 组织语境跟随全局（左上角切换器）：与组织概览页一致，提示去切换器选择，不提供页内跳转
function WorkspaceRequiredHint() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-400">
      请先在左上角选择组织，再查看团队大脑。
    </div>
  )
}

function SummaryCard({ overview }: { overview: WorkspaceBrainOverview | null }) {
  const summaryLines = overview?.context.summaryLines ?? []
  const enabled = overview?.enabled ?? false
  return (
    <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
      <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
        <h3 className="text-sm font-medium text-zinc-200">持续摘要</h3>
        <div className="flex items-center gap-2">
          {enabled ? (
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300">已启用</span>
          ) : (
            <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-400">未启用</span>
          )}
          {overview?.context.updatedAt ? (
            <span className="text-[11px] text-zinc-500">更新于 {formatRelativeTime(overview.context.updatedAt)}</span>
          ) : null}
        </div>
      </header>
      {summaryLines.length > 0 ? (
        <div className="space-y-1.5 px-4 py-3">
          {summaryLines.map((line, index) => (
            <p key={index} className="text-[13px] leading-relaxed text-zinc-300">{line}</p>
          ))}
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-zinc-600">
          还没有持续摘要。事件积累后，大脑会把讨论压成结论放在这里。
        </div>
      )}
    </section>
  )
}

function EventTimeline({ items, updatedAt }: { items: WorkspaceBrainContextItem[]; updatedAt?: string }) {
  return (
    <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
      <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
        <h3 className="text-sm font-medium text-zinc-200">事件流时间线</h3>
        <span className="text-[11px] text-zinc-500">{items.length} 条</span>
      </header>
      {items.length > 0 ? (
        <ul className="max-h-[420px] divide-y divide-zinc-900 overflow-y-auto">
          {[...items].reverse().map((item, index) => (
            <li key={index} className="flex gap-3 px-4 py-2.5">
              <div className="flex w-16 shrink-0 flex-col items-end gap-0.5">
                <span className="text-[11px] text-zinc-500">{formatEventTime(item.at)}</span>
                <span className="rounded border border-zinc-800 bg-zinc-900 px-1 py-px text-[10px] text-zinc-400">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                {item.source ? (
                  <p className="text-[11px] text-zinc-500">{item.source}</p>
                ) : null}
                <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-zinc-300">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-8 text-center text-xs text-zinc-600">
          还没有事件。群聊讨论与任务事件会自动进入这里。{updatedAt ? `（最近更新 ${formatRelativeTime(updatedAt)}）` : ''}
        </div>
      )}
    </section>
  )
}

function DispatchRecords({ records }: { records: WorkspaceBrainDispatchRecord[] }) {
  return (
    <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
      <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
        <h3 className="text-sm font-medium text-zinc-200">大脑分发记录</h3>
        <span className="text-[11px] text-zinc-500">{records.length} 条</span>
      </header>
      {records.length > 0 ? (
        <ul className="max-h-[420px] divide-y divide-zinc-900 overflow-y-auto">
          {records.map((record) => (
            <li key={record.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-zinc-200">{record.agentName || record.agentId}</span>
                  <span className={`rounded border px-1.5 py-px text-[10px] ${STATUS_TONE[record.status] ?? 'border-zinc-700 bg-zinc-900 text-zinc-300'}`}>
                    {STATUS_LABEL[record.status] ?? record.status}
                  </span>
                </div>
                {record.triggerKind ? (
                  <p className="mt-0.5 text-[11px] text-zinc-500">{record.triggerKind}</p>
                ) : null}
                {record.sourceText ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-400">{record.sourceText}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] text-zinc-600">{formatRelativeTime(record.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-8 text-center text-xs text-zinc-600">
          还没有分发记录。大脑审查事件并 @ 相关 Agent 时会记录在这里。
        </div>
      )}
    </section>
  )
}

function BrainFiles({ files }: { files: WorkspaceBrainFile[] }) {
  const enabledFiles = useMemo(() => files.filter((file) => file.enabled), [files])
  return (
    <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
      <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
        <h3 className="text-sm font-medium text-zinc-200">已纳入文件</h3>
        <span className="text-[11px] text-zinc-500">{enabledFiles.length} 个文件</span>
      </header>
      {enabledFiles.length > 0 ? (
        <ul className="divide-y divide-zinc-900">
          {enabledFiles.map((file) => (
            <li key={file.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-zinc-200">{file.fileName || file.fileId}</p>
                {file.digest ? (
                  <p className="mt-0.5 line-clamp-3 text-xs leading-snug text-zinc-400">{file.digest}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-zinc-600">摘要整理中…</p>
                )}
              </div>
              {file.digestAt ? (
                <span className="shrink-0 text-[11px] text-zinc-600">{formatRelativeTime(file.digestAt)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-8 text-center text-xs text-zinc-600">
          还没有纳入文件。在云盘文件菜单里选择「设为Agent 协作上下文」即可加入。
        </div>
      )}
    </section>
  )
}

function PersonalContextTab() {
  const { user } = useAuth()
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(() => getStoredCollaborationWorkspaceId() || undefined)
  const [data, setData] = useState<WorkspaceBrainMyContext | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      setWorkspaceId(detail?.workspaceId || undefined)
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleChange)
  }, [])

  useEffect(() => {
    if (!workspaceId) {
      setData(null)
      return
    }
    setLoading(true)
    api.getWorkspaceBrainMyContext(workspaceId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [workspaceId])

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-zinc-900 px-5 py-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">我的上下文</h2>
          <p className="mt-0.5 text-xs text-zinc-500">个人云盘 + 我参与的任务/会话时间线 + 我关心的待办。</p>
        </div>
        {user ? <span className="text-xs text-zinc-500">{user.name || user.email}</span> : null}
      </div>
      {!workspaceId ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">选择一个组织后查看我的上下文。</div>
      ) : loading && !data ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">加载中…</div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
            <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
              <h3 className="text-sm font-medium text-zinc-200">我的个人云盘</h3>
              <span className="text-[11px] text-zinc-500">{data?.personalFiles.length ?? 0} 个文件</span>
            </header>
            {data?.personalFiles.length ? (
              <ul className="divide-y divide-zinc-900">
                {data.personalFiles.map((file) => (
                  <li key={file.id} className="flex items-center justify-between px-4 py-2">
                    <span className="truncate text-[13px] text-zinc-300">{file.name}</span>
                    <span className="ml-3 shrink-0 text-[11px] text-zinc-600">{formatRelativeTime(file.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-xs text-zinc-600">个人云盘暂无文件。</div>
            )}
          </section>
          <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
            <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
              <h3 className="text-sm font-medium text-zinc-200">我参与的任务/会话（近 7 天）</h3>
              <span className="text-[11px] text-zinc-500">{data?.participations.length ?? 0} 个会话</span>
            </header>
            {data?.participations.length ? (
              <ul className="divide-y divide-zinc-900">
                {data.participations.map((p) => (
                  <li key={p.conversationId} className="flex items-center justify-between px-4 py-2">
                    <span className="truncate text-[13px] text-zinc-300">{p.title || p.conversationId}</span>
                    <span className="ml-3 shrink-0 text-[11px] text-zinc-600">{p.messageCount} 条 · {p.activeMinutes} 分钟</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-xs text-zinc-600">近 7 天暂无参与的会话。</div>
            )}
          </section>
          <section className="rounded-lg border border-zinc-900 bg-zinc-950/70">
            <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-2.5">
              <h3 className="text-sm font-medium text-zinc-200">我关心的待办</h3>
              <span className="text-[11px] text-zinc-500">{data?.todos.length ?? 0} 组</span>
            </header>
            {data?.todos.length ? (
              <ul className="divide-y divide-zinc-900">
                {data.todos.map((todo) => (
                  <li key={todo.id} className="flex items-center justify-between px-4 py-2">
                    <span className="truncate text-[13px] text-zinc-300">{todo.title}</span>
                    {todo.unreadCount > 0 ? (
                      <span className="ml-3 shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300">{todo.unreadCount} 未读</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-xs text-zinc-600">暂无待办。</div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

const formatEventTime = (at: string) => {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
