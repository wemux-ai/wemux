// [INPUT]: 目标（用户/Agent）id + 时间线 API（today | 7d）
// [OUTPUT]: 时间线区块（清晰版）：统计摘要 + 7 天活跃热力条 + 按日分组活动时间轴（图标/圆点/竖线）+ 会话参与时长；用户与 Agent 同构
// [POS]: 详情时间线视图；默认今天可切 7 天；数据第一版所有人可见
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  FilePen,
  FilePlus2,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Send,
} from 'lucide-react'
import type { AgentTimelineDetail, TimelineActivityItem, UserTimelineDetail } from '@shared/types'
import { orgMethods } from '../../lib/api/methods/org'
import { cn } from '../../lib/utils'

const RECORD_ICON: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  task_completed: { icon: CheckCircle2, className: 'text-emerald-400' },
  task_dispatched: { icon: Send, className: 'text-sky-400' },
  drive_file_created: { icon: FilePlus2, className: 'text-violet-400' },
  drive_file_updated: { icon: FilePen, className: 'text-amber-400' },
  conversation: { icon: MessagesSquare, className: 'text-cyan-400' },
}

const RECORD_TYPE_LABEL: Record<string, string> = {
  task_completed: '完成任务',
  task_dispatched: '派发任务',
  drive_file_created: '创建文件',
  drive_file_updated: '更新文件',
  conversation: '参与会话',
}

const KIND_LABEL: Record<string, string> = {
  main: '主对话',
  workspace: '工作区会话',
  task: '任务会话',
  dm: '私聊',
  'external-thread': '外部会话',
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const formatMinutes = (minutes: number) => {
  if (minutes < 1) return '不足 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

const formatClock = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** 日期分组标签：今天 / 昨天 / X月X日 周X */
const formatDayLabel = (date: Date) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - dayStart.getTime()) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
}

/** 按自然日分组（保持时间倒序） */
const groupActivitiesByDay = (activities: TimelineActivityItem[]) => {
  const groups: Array<{ dateKey: string; label: string; items: TimelineActivityItem[] }> = []
  const index = new Map<string, number>()
  for (const item of activities) {
    const date = new Date(item.occurredAt)
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const existing = index.get(dateKey)
    if (existing !== undefined) {
      groups[existing].items.push(item)
    } else {
      index.set(dateKey, groups.length)
      groups.push({ dateKey, label: formatDayLabel(date), items: [item] })
    }
  }
  return groups
}

/** 近 7 天每天活动数（index 0 = 6 天前 … 6 = 今天），供热力条展示 */
const countActivitiesByDay = (activities: TimelineActivityItem[]) => {
  const counts = new Array<number>(7).fill(0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (const item of activities) {
    const date = new Date(item.occurredAt)
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const diffDays = Math.round((today.getTime() - dayStart) / 86_400_000)
    if (diffDays >= 0 && diffDays <= 6) counts[6 - diffDays]++
  }
  return counts
}

export function TimelineSection({ targetType, targetId }: { targetType: 'user' | 'agent'; targetId: string }) {
  const [range, setRange] = useState<'today' | '7d'>('today')
  const [detail, setDetail] = useState<UserTimelineDetail | AgentTimelineDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = targetType === 'user'
        ? await orgMethods.getUserTimeline(targetId, range)
        : await orgMethods.getAgentTimeline(targetId, range)
      setDetail(res.timeline)
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [targetType, targetId, range])

  useEffect(() => { void load() }, [load])

  const dayGroups = useMemo(() => (detail ? groupActivitiesByDay(detail.activities) : []), [detail])
  const dayCounts = useMemo(() => (detail ? countActivitiesByDay(detail.activities) : []), [detail])
  const maxDayCount = Math.max(1, ...dayCounts)

  return (
    <div className="flex flex-col rounded border border-zinc-800 bg-[#09090b] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">时间线</span>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
          {(['today', '7d'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                range === option ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {option === 'today' ? '今天' : '近 7 天'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-zinc-500">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />加载中…
        </div>
      ) : !detail || (detail.activities.length === 0 && detail.sessions.length === 0) ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-xs text-zinc-600">
          {range === 'today' ? '今天暂无活动。' : '近 7 天暂无活动。'}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* 统计摘要 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span>
              <span className="font-semibold text-zinc-200">{detail.activities.length}</span> 项活动
            </span>
            {detail.totalSessionMinutes > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-sky-400" />
                会话参与约 <span className="font-semibold text-zinc-200">{formatMinutes(detail.totalSessionMinutes)}</span>
              </span>
            )}
          </div>

          {/* 7 天活跃热力条（近 7 天模式） */}
          {range === '7d' && detail.activities.length > 0 && (
            <div className="flex items-end gap-1.5 rounded-lg border border-zinc-900 bg-zinc-950/60 px-3 py-2">
              {dayCounts.map((count, index) => {
                const date = new Date()
                date.setDate(date.getDate() - (6 - index))
                const isToday = index === 6
                return (
                  <div key={index} className="flex flex-1 flex-col items-center gap-1">
                    <span className={cn('text-[9px]', count > 0 ? 'text-zinc-300' : 'text-zinc-700')}>{count}</span>
                    <div
                      className={cn('w-full rounded-sm', count > 0 ? 'bg-sky-500/70' : 'bg-zinc-800/60')}
                      style={{ height: Math.max(3, Math.round((count / maxDayCount) * 26)) }}
                    />
                    <span className={cn('text-[9px]', isToday ? 'text-zinc-300' : 'text-zinc-600')}>
                      {isToday ? '今' : `${date.getMonth() + 1}/${date.getDate()}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* 按日分组的活动时间轴 */}
          {dayGroups.length > 0 && (
            <div className="flex flex-col gap-3">
              {dayGroups.map((group) => (
                <div key={group.dateKey}>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    {group.label}
                    <span className="text-zinc-700">{group.items.length} 条</span>
                  </div>
                  <div className="relative ml-1.5 border-l border-zinc-800 pl-4">
                    {group.items.map((item) => {
                      const meta = RECORD_ICON[item.recordType] ?? RECORD_ICON.task_completed
                      const Icon = meta.icon
                      return (
                        <div key={item.id} className="relative flex items-center gap-2 py-1.5">
                          <span className="absolute -left-[19.5px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-zinc-600" />
                          <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
                            {/* 防御：title 已含《》（旧完整句记录）时不再加类型前缀，避免重复 */}
                            {item.title.includes('《')
                              ? item.title
                              : `${RECORD_TYPE_LABEL[item.recordType] ?? item.recordType}《${item.title}》`}
                          </span>
                          <span className="shrink-0 text-[10px] text-zinc-600">{formatClock(item.occurredAt)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 会话参与时长 */}
          {detail.sessions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-600">会话参与</div>
              {detail.sessions.slice(0, 8).map((session) => (
                <div key={session.conversationId} className="flex items-center gap-2 rounded-md border border-zinc-900 bg-zinc-950/60 px-2.5 py-1.5 text-[11px]">
                  <MessageSquare className="h-3 w-3 shrink-0 text-zinc-600" />
                  <span className="min-w-0 flex-1 truncate text-zinc-300">{session.title}</span>
                  <span className="shrink-0 rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {KIND_LABEL[session.kind] ?? session.kind}
                  </span>
                  <span className="shrink-0 text-zinc-500">{session.messageCount} 条消息</span>
                  <span className="shrink-0 font-medium text-sky-400">{formatMinutes(session.activeMinutes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
