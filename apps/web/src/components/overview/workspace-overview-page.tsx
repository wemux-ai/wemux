// [INPUT]: 当前用户与其协作组织列表、组织概览数据
// [OUTPUT]: 工作记录可见性页面（组织切换 + 顶部统计 + 时间范围筛选 + 成员/Agent 分区：待跟进/进行中任务 + 最近工作记录 + Agent 完成率）
// [POS]: 组织概览页；纯确定性数据（零 LLM）；隔离由服务端 isWorkspaceMember 保证
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Users } from 'lucide-react'
import type { CollaborationWorkspace } from '@shared/types'
import { api } from '../../lib/api'
import type { WorkspaceOverviewAgent, WorkspaceOverviewMember } from '../../lib/api/methods/overview'
import { COLLABORATION_WORKSPACE_CHANGE_EVENT, getStoredCollaborationWorkspaceId, resolveCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import { OrgGraphViewEnhanced } from './org-graph-view-enhanced'
import { WorkspaceGroupsView } from './workspace-groups-view'
import { PersonRow } from './person-row'
import { RANGE_OPTIONS, computeRangeStart, isRecordInRange } from './workspace-overview-shared'
import type { RangeKey } from './workspace-overview-shared'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

export function WorkspaceOverviewPage() {
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [overview, setOverview] = useState<{ members: WorkspaceOverviewMember[]; agents: WorkspaceOverviewAgent[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'overview' | 'groups' | 'graph'>('overview')
  const [range, setRange] = useState<RangeKey>('7d')
  const workspacesRef = useRef<CollaborationWorkspace[]>([])

  // 组织语境跟随全局（左上角切换器）：页面内不提供选择器
  useEffect(() => {
    api.listCollaborationWorkspaces().then((res) => {
      workspacesRef.current = res.workspaces
      setWorkspaces(res.workspaces)
      setWorkspaceId(resolveCollaborationWorkspaceId(res.workspaces, getStoredCollaborationWorkspaceId()))
    }).catch(() => {})

    const handleWorkspaceChange = () => {
      setWorkspaceId(resolveCollaborationWorkspaceId(workspacesRef.current, getStoredCollaborationWorkspaceId()))
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
  }, [])

  const reload = useCallback(async (targetWorkspaceId: string) => {
    setLoading(true)
    try {
      const res = await api.getWorkspaceOverview(targetWorkspaceId)
      setOverview(res.overview)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载概览失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (workspaceId) void reload(workspaceId)
  }, [workspaceId, reload])

  const normalizedQuery = query.trim().toLowerCase()
  const members = useMemo(() => {
    const list = overview?.members ?? []
    if (!normalizedQuery) return list
    return list.filter((member) => member.name.toLowerCase().includes(normalizedQuery))
  }, [overview, normalizedQuery])
  const agents = useMemo(() => {
    const list = overview?.agents ?? []
    if (!normalizedQuery) return list
    return list.filter((agent) => agent.name.toLowerCase().includes(normalizedQuery))
  }, [overview, normalizedQuery])

  const rangeStart = useMemo(() => computeRangeStart(range), [range])
  const inRange = useCallback((iso: string) => isRecordInRange(iso, rangeStart), [rangeStart])

  const stats = useMemo(() => {
    const all = [...(overview?.members ?? []), ...(overview?.agents ?? [])]
    return {
      members: overview?.members.length ?? 0,
      agents: overview?.agents.length ?? 0,
      inProgress: all.reduce((sum, person) => sum + person.inProgressTasks.length, 0),
      attention: all.reduce((sum, person) => sum + person.attentionTasks.length, 0),
      recent: all.reduce(
        (sum, person) => sum + person.recent.filter((record) => inRange(record.occurredAt)).length,
        0,
      ),
    }
  }, [overview, inRange])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-900 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-zinc-100">组织概览</h1>
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
          {([['overview', '概览'], ['groups', '分组'], ['graph', '关系图谱']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                tab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-zinc-600">谁在忙 · 谁待跟进 · 刚干完什么 · Agent 完成率</span>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中…
        </div>
      ) : !workspaceId ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
            <Users className="h-8 w-8 text-zinc-700" />
            请先在左上角选择组织，再查看组织概览。
          </div>
        </div>
      ) : tab === 'groups' ? (
        <WorkspaceGroupsView
          workspaceId={workspaceId}
          members={overview?.members ?? []}
          agents={overview?.agents ?? []}
          inRange={inRange}
        />
      ) : tab === 'graph' ? (
        <OrgGraphViewEnhanced workspaceId={workspaceId} />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-6 border-b border-zinc-900 px-4 py-2.5">
            <StatItem label="成员" value={stats.members} />
            <StatItem label="Agent" value={stats.agents} />
            <StatItem label="在办" value={stats.inProgress} />
            <StatItem label="待跟进" value={stats.attention} />
            <StatItem label="动态" value={stats.recent} />
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              {RANGE_OPTIONS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRange(key)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                    range === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-52">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                className="h-7 rounded-lg pl-8 text-xs"
                placeholder="搜索成员或 Agent…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto px-2 py-2">
            {members.length === 0 && agents.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6">
                <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-8 text-center text-xs text-zinc-500">
                  {normalizedQuery ? '没有匹配的成员或 Agent。' : '该组织暂无成员或 Agent 数据。'}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {members.length > 0 && (
                  <div>
                    <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      成员 · {members.length}
                    </div>
                    <div>
                      {members.map((member) => (
                        <PersonRow
                          key={member.userId}
                          person={member}
                          kind="member"
                          to="/profile/$userId"
                          params={{ userId: member.userId }}
                          inRange={inRange}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {agents.length > 0 && (
                  <div>
                    <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      Agent · {agents.length}
                    </div>
                    <div>
                      {agents.map((agent) => (
                        <PersonRow
                          key={agent.agentId}
                          person={agent}
                          kind="agent"
                          to="/agent-profile/$agentId"
                          params={{ agentId: agent.agentId }}
                          inRange={inRange}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-sm font-semibold text-zinc-100">{value}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </div>
  )
}
