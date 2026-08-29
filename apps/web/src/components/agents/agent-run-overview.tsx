// [INPUT]: Agent 基础信息（id/状态/模型/Runtime/机器）+ 实时工作状态 + 任务/活动 API
// [OUTPUT]: Agent 运行概览——状态卡（在线/忙碌/模型/机器）+ 活动时间线（今天/7天）+ 最近任务
// [POS]: Agent 详情页「运行概览」区块（feature）；把 Agent 实际在做什么绑定到详情页，替代纯配置观感
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useState } from 'react'
import { Bot, Cpu, Loader2, Monitor, Timer } from 'lucide-react'
import { agentsMethods } from '../../lib/api/methods/agents'
import { getAgentLiveStatus, useAgentLiveStatuses } from '../../lib/agent-live-status'
import { TimelineSection } from '../profiles/user-timeline-section'
import { cn } from '../../lib/utils'
import type { AgentTaskRecord } from '../../lib/api'

const TASK_STATUS_TONE: Record<string, string> = {
  pending: 'bg-zinc-800 text-zinc-400',
  running: 'bg-amber-500/15 text-amber-300',
  waiting: 'bg-violet-500/15 text-violet-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-rose-500/15 text-rose-300',
  canceled: 'bg-zinc-800 text-zinc-500',
}

const TASK_TYPE_LABEL: Record<string, string> = {
  chat: '聊天',
  task: '任务执行',
  cron: '定时',
  inbox: '收件箱',
  review: '评审',
}

const formatTime = (iso: string | null) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function AgentRunOverview({
  agentId,
  name,
  status,
  model,
  runtime,
  executorLabel,
}: {
  agentId: string
  name: string
  status: 'online' | 'offline' | 'error'
  model: string
  runtime: string
  executorLabel?: string
}) {
  const liveStatuses = useAgentLiveStatuses()
  const live = getAgentLiveStatus(liveStatuses, agentId, name)
  const workingCount = live?.workingCount ?? 0
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setTasksLoading(true)
    agentsMethods.getAgentTasks(agentId)
      .then((res) => { if (alive) setTasks(res.tasks) })
      .catch(() => { if (alive) setTasks([]) })
      .finally(() => { if (alive) setTasksLoading(false) })
    return () => { alive = false }
  }, [agentId])

  const statusMeta = status === 'online'
    ? { label: '在线', className: 'bg-emerald-400', working: workingCount > 0 ? `工作中（${workingCount} 个会话）` : '空闲' }
    : status === 'error'
      ? { label: '异常', className: 'bg-rose-400', working: '需要关注' }
      : { label: '离线', className: 'bg-zinc-500', working: '未连接' }

  const recentTasks = tasks.slice(0, 5)

  return (
    <div className="flex flex-col gap-3">
      {/* 运行状态卡 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', statusMeta.className)} />
          <span className="font-medium text-zinc-100">{statusMeta.label}</span>
          {workingCount > 0 ? (
            <span className="text-amber-300">{statusMeta.working}</span>
          ) : (
            <span className="text-zinc-500">{statusMeta.working}</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <Bot className="h-3.5 w-3.5 text-violet-400" />
          模型：<span className="text-zinc-200">{model || '未配置'}</span>
        </span>
        <span className="flex items-center gap-1.5 text-zinc-400">
          <Cpu className="h-3.5 w-3.5 text-sky-400" />
          Runtime：<span className="text-zinc-200">{runtime}</span>
        </span>
        {executorLabel && (
          <span className="flex items-center gap-1.5 text-zinc-400">
            <Monitor className="h-3.5 w-3.5 text-emerald-400" />
            机器：<span className="text-zinc-200">{executorLabel}</span>
          </span>
        )}
      </div>

      {/* 活动时间线（今天/7天） */}
      <TimelineSection targetType="agent" targetId={agentId} />

      {/* 最近任务 */}
      <div className="flex flex-col rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          <Timer className="h-3 w-3 text-sky-400" />
          最近任务
        </div>
        {tasksLoading ? (
          <div className="flex items-center gap-2 py-2 text-[11px] text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />加载中…
          </div>
        ) : recentTasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-3 text-center text-[11px] text-zinc-600">
            暂无任务记录。在聊天中 @ 或派发任务后这里会出现。
          </div>
        ) : (
          <div className="flex flex-col">
            {recentTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 border-b border-zinc-900 py-1.5 text-[11px] last:border-0">
                <span className="shrink-0 rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {TASK_TYPE_LABEL[task.type] ?? task.type}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {typeof task.payload === 'object' && task.payload && 'title' in task.payload
                    ? String(task.payload.title)
                    : task.id.slice(0, 8)}
                </span>
                <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px]', TASK_STATUS_TONE[task.status] ?? 'bg-zinc-800 text-zinc-500')}>
                  {task.status}
                </span>
                <span className="shrink-0 text-zinc-600">{formatTime(task.startedAt ?? task.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
