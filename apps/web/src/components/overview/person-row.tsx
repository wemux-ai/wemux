// [INPUT]: 概览成员/Agent 数据 + 时间范围判定
// [OUTPUT]: 统一成员行（头像 + 姓名 + 职位 + 在办/待跟进 + 最近动态），点击跳转画像页
// [POS]: 组织概览通用行组件；供「概览」tab 与「分组」tab 复用
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, ClipboardCheck, Clock } from 'lucide-react'
import { resolveMediaUrl } from '../../lib/api'
import type { WorkspaceOverviewAgent, WorkspaceOverviewMember } from '../../lib/api/methods/overview'
import { UserCardPopover } from '../profiles/user-card-popover'
import { HealthDots } from '../profiles/health-dots'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { cn } from '../../lib/utils'
import { buildHealthTitle } from './workspace-overview-shared'

export const RECORD_TYPE_LABEL: Record<string, string> = {
  task_completed: '完成任务',
  task_dispatched: '派发任务',
  drive_file_created: '创建文件',
  drive_file_updated: '更新文件',
  conversation: '参与会话',
}

export const formatTime = (iso: string) => {
  try {
    const date = new Date(iso)
    const diff = Date.now() - date.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export type OverviewPerson = WorkspaceOverviewMember | WorkspaceOverviewAgent

export function PersonRow({
  person,
  kind,
  to,
  params,
  inRange,
}: {
  person: OverviewPerson
  kind: 'member' | 'agent'
  to: string
  params: Record<string, string>
  inRange: (iso: string) => boolean
}) {
  const navigate = useNavigate()
  const name = person.name
  const initials = name.slice(0, 2).toUpperCase()
  const avatarUrl = kind === 'member'
    ? (person as WorkspaceOverviewMember).avatarUrl
    : (person as WorkspaceOverviewAgent).avatarUrl
  const role = kind === 'member' ? (person as WorkspaceOverviewMember).role : 'Agent'
  const healthScore = kind === 'agent' ? (person as WorkspaceOverviewAgent).healthScore : null
  const healthTitle = kind === 'agent'
    ? buildHealthTitle((person as WorkspaceOverviewAgent).healthScore, (person as WorkspaceOverviewAgent).healthSample)
    : undefined
  const activeTask = person.inProgressTasks[0]
  const extraTaskCount = Math.max(0, person.inProgressTasks.length - 1)
  const attentionTask = person.attentionTasks[0]
  const extraAttentionCount = Math.max(0, person.attentionTasks.length - 1)
  const latestRecord = person.recent.find((record) => inRange(record.occurredAt))

  return (
    <button
      className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-900/40"
      onClick={() => navigate({ to: to as never, params: params as never })}
    >
      {kind === 'member' ? (
        <UserCardPopover userId={(person as WorkspaceOverviewMember).userId} name={name} avatarUrl={avatarUrl}>
          <span className="shrink-0">
            <Avatar className="h-6 w-6 shrink-0">
              {avatarUrl && <AvatarImage src={resolveMediaUrl(avatarUrl)} />}
              <AvatarFallback className="bg-zinc-800 text-[10px] text-zinc-300">{initials}</AvatarFallback>
            </Avatar>
          </span>
        </UserCardPopover>
      ) : (
        <Avatar className="h-6 w-6 shrink-0">
          {avatarUrl && <AvatarImage src={resolveMediaUrl(avatarUrl)} />}
          <AvatarFallback className="bg-zinc-800 text-[10px] text-zinc-300">{initials}</AvatarFallback>
        </Avatar>
      )}

      <span className="flex min-w-0 shrink-0 items-center gap-1.5" style={{ width: 148 }}>
        <span className="truncate text-xs font-medium text-zinc-200">{name}</span>
        {kind === 'agent' && <Bot className="h-3 w-3 shrink-0 text-zinc-500" />}
      </span>

      <span className="shrink-0 text-[11px] text-zinc-500" style={{ width: 56 }}>{role}</span>

      <span className="shrink-0" style={{ width: 68 }}>
        {kind === 'agent' ? <HealthDots score={healthScore} title={healthTitle} /> : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {attentionTask && (
            <span
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 text-[11px]',
                attentionTask.status === 'blocked'
                  ? 'border-rose-500/30 bg-rose-950/40 text-rose-300'
                  : 'border-amber-500/30 bg-amber-950/40 text-amber-300',
              )}
              title={attentionTask.status === 'blocked' ? '阻塞中' : '待审核'}
            >
              {attentionTask.status === 'blocked'
                ? <AlertTriangle className="h-3 w-3 shrink-0" />
                : <ClipboardCheck className="h-3 w-3 shrink-0" />}
              <span className="truncate">{attentionTask.title}</span>
              {extraAttentionCount > 0 && <span className="shrink-0 opacity-70">+{extraAttentionCount}</span>}
            </span>
          )}
          {activeTask ? (
            <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-400">
              <Clock className="h-3 w-3 shrink-0 text-amber-400" />
              <span className="truncate">{activeTask.title}</span>
              {extraTaskCount > 0 && <span className="shrink-0 text-zinc-600">+{extraTaskCount}</span>}
            </span>
          ) : null}
          {!attentionTask && !activeTask && <span className="text-[11px] text-zinc-700">—</span>}
        </span>
      </span>

      <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-[11px] text-zinc-600" style={{ width: 220 }}>
        {latestRecord ? (
          <>
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
            <span className="min-w-0 truncate">
              {latestRecord.title.includes('《')
                ? latestRecord.title
                : `${RECORD_TYPE_LABEL[latestRecord.recordType] ?? latestRecord.recordType}「${latestRecord.title}」`}
            </span>
            <span className="ml-auto shrink-0">{formatTime(latestRecord.occurredAt)}</span>
          </>
        ) : (
          <span className="text-zinc-700">该时段无动态</span>
        )}
      </span>

      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
