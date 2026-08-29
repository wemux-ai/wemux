// [INPUT]: userId + 今日时间线摘要 API
// [OUTPUT]: 头像/名称 Popover 用户卡片（基本资料 + 今日时间线摘要 + 会话分钟 + 查看详情跳画像页）
// [POS]: 用户卡片组件；click 模式轻量不跳页（Popover 内嵌），hover 模式悬停弹出、移出关闭、点击跳详情；
//        「查看详情」跳 /profile/$userId；数据第一版所有人可见
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Clock, Loader2, MessageSquarePlus, User as UserIcon, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import type { UserCardSummary } from '@shared/types'
import { api } from '../../lib/api'
import type { ConnectionStatus } from '../../lib/api/methods/connections'
import { orgMethods } from '../../lib/api/methods/org'
import { resolveMediaUrl } from '../../lib/api'
import { launchDmFromUserCard } from '../../lib/dm-launch'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover'

const RECORD_TYPE_LABEL: Record<string, string> = {
  task_completed: '完成任务',
  task_dispatched: '派发任务',
  drive_file_created: '创建文件',
  drive_file_updated: '更新文件',
  conversation: '参与会话',
}

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_DELAY_MS = 150

const formatMinutes = (minutes: number) => {
  if (minutes < 1) return '不足 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

export function UserCardPopover({
  userId,
  name,
  avatarUrl,
  children,
  triggerMode = 'click',
}: {
  userId: string
  name?: string
  avatarUrl?: string | null
  children?: React.ReactNode
  /** click：点击弹出（组织图/概览页沿用）；hover：悬停弹出、移出关闭、点击跳详情（聊天场景） */
  triggerMode?: 'click' | 'hover'
}) {
  const [summary, setSummary] = useState<UserCardSummary | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('none')
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const openTimerRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)

  const handleStartDm = () => {
    // 卡片关闭后交给 /chat 的 DM 消费方（ensureDm + 切换会话）。
    setOpen(false)
    const launched = launchDmFromUserCard(userId)
    if (!launched) {
      toast('请在消息中心发起私聊', { description: '打开「聊天」后即可与对方直接对话。' })
    }
  }

  const handleConnectionAction = async () => {
    if (connectionBusy) return
    setConnectionBusy(true)
    try {
      if (connectionStatus === 'pending_received') {
        await api.acceptConnection(userId)
        setConnectionStatus('connected')
        toast.success('已添加为好友')
        return
      }
      if (connectionStatus === 'pending_sent') {
        await api.cancelConnection(userId)
        setConnectionStatus('none')
        return
      }
      await api.requestConnection(userId)
      setConnectionStatus('pending_sent')
      toast.success('好友请求已发送')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setConnectionBusy(false)
    }
  }

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await orgMethods.getUserCard(userId)
      setSummary(res.summary)
      // 好友关系状态（按钮展示用）。
      try {
        const statusRes = await api.getConnectionStatus(userId)
        setConnectionStatus(statusRes.status)
      } catch {
        setConnectionStatus('none')
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // 打开时懒加载；已有摘要不重复请求（hover 反复进出不抖动）。
  useEffect(() => {
    if (open && !summary && !loading) {
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, summary, userId])

  const clearTimers = () => {
    window.clearTimeout(openTimerRef.current)
    window.clearTimeout(closeTimerRef.current)
  }

  const handleTriggerEnter = () => {
    window.clearTimeout(closeTimerRef.current)
    openTimerRef.current = window.setTimeout(() => setOpen(true), HOVER_OPEN_DELAY_MS)
  }

  const handleTriggerLeave = () => {
    window.clearTimeout(openTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS)
  }

  const handleContentEnter = () => {
    window.clearTimeout(closeTimerRef.current)
  }

  const handleContentLeave = () => {
    window.clearTimeout(openTimerRef.current)
    setOpen(false)
  }

  useEffect(() => {
    return () => clearTimers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const initials = (summary?.name ?? name ?? '?').slice(0, 2).toUpperCase()
  const displayAvatar = summary?.avatarUrl ?? avatarUrl ?? null

  const cardContent = (
    <PopoverContent
      align="start"
      side="bottom"
      sideOffset={6}
      className="w-80 rounded-xl border-zinc-800/70 bg-[#0f0f11] p-0 text-zinc-100 shadow-xl shadow-black/40"
      {...(triggerMode === 'hover'
        ? { onMouseEnter: handleContentEnter, onMouseLeave: handleContentLeave }
        : {})}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />加载中…
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-xs text-zinc-500">加载失败</div>
      ) : summary ? (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-zinc-800/70 px-4 py-3">
            <Avatar className="h-10 w-10">
              {displayAvatar && <AvatarImage src={resolveMediaUrl(displayAvatar)} />}
              <AvatarFallback className="bg-zinc-800 text-xs text-zinc-300">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-zinc-100">{summary.name}</div>
              <div className="truncate text-[11px] text-zinc-500">
                {summary.username ? <span className="text-zinc-400">@{summary.username}</span> : null}
                {summary.username && (summary.title || summary.department) ? <span className="mx-1 text-zinc-700">·</span> : null}
                {[summary.title, summary.department].filter(Boolean).join(' · ') || (summary.username ? '' : '未设置职位信息')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                disabled={connectionBusy || connectionStatus === 'connected' || connectionStatus === 'self'}
                onClick={() => void handleConnectionAction()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {connectionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                {connectionStatus === 'connected'
                  ? '好友'
                  : connectionStatus === 'pending_sent'
                    ? '已发送请求'
                    : connectionStatus === 'pending_received'
                      ? '接受好友'
                      : '加好友'}
              </button>
              <button
                type="button"
                onClick={handleStartDm}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300"
              >
                <MessageSquarePlus className="h-3 w-3" />
                聊天
              </button>
              <Link
                to="/profile/$userId"
                params={{ userId: summary.userId }}
                className="shrink-0 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              >
                详情
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="h-3 w-3 text-sky-400" />
              今日会话活跃约 {formatMinutes(summary.todaySessionMinutes)}
            </div>
            {summary.today.length > 0 ? (
              <>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-600">今日时间线</div>
                {summary.today.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                    <span className="min-w-0 truncate">{RECORD_TYPE_LABEL[item.recordType] ?? item.recordType}「{item.title}」</span>
                  </div>
                ))}
                {summary.today.length > 4 && (
                  <div className="pl-[18px] text-[10px] text-zinc-600">另有 {summary.today.length - 4} 条…</div>
                )}
              </>
            ) : (
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-2 text-[11px] text-zinc-600">
                <UserIcon className="h-3 w-3" />今日暂无工作记录。
              </div>
            )}
          </div>
        </div>
      ) : null}
    </PopoverContent>
  )

  if (triggerMode === 'hover') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <span
            className="inline-flex cursor-pointer"
            onMouseEnter={handleTriggerEnter}
            onMouseLeave={handleTriggerLeave}
            onClick={(event) => {
              // 点击头像同样弹出卡片（详情通过卡片内按钮进入），不跳转。
              event.preventDefault()
              event.stopPropagation()
              window.clearTimeout(openTimerRef.current)
              window.clearTimeout(closeTimerRef.current)
              setOpen(true)
            }}
          >
            {children}
          </span>
        </PopoverAnchor>
        {cardContent}
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {cardContent}
    </Popover>
  )
}
