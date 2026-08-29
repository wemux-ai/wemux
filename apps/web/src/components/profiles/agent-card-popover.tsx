// [INPUT]: agentId + 展示名/头像 + hover/click 触发
// [OUTPUT]: Agent 悬浮卡片（名字 + 角色 + 聊天/详情按钮），与用户卡片交互一致
// [POS]: Agent 消息头像卡片；数据来自消息上下文（无额外 API 请求），「聊天」走 /chat launch 桥，「详情」跳画像页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bot, MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import { resolveMediaUrl } from '../../lib/api'
import { launchAgentFromCard } from '../../lib/dm-launch'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover'

const HOVER_OPEN_DELAY_MS = 200
const HOVER_CLOSE_DELAY_MS = 150

export function AgentCardPopover({
  agentId,
  name,
  avatarUrl,
  children,
  triggerMode = 'hover',
}: {
  agentId: string
  name?: string
  avatarUrl?: string | null
  children?: React.ReactNode
  triggerMode?: 'hover' | 'click'
}) {
  const [open, setOpen] = useState(false)
  const openTimerRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)

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

  const displayName = name?.trim() || 'Agent'
  const initials = displayName.slice(0, 2).toUpperCase()

  const handleStartChat = () => {
    setOpen(false)
    const launched = launchAgentFromCard(agentId)
    if (!launched) {
      toast('请在消息中心打开对话', { description: '打开「聊天」后即可与该 Agent 对话。' })
    }
  }

  const cardContent = (
    <div className="flex items-center gap-3 border-b border-zinc-800/70 px-4 py-3">
      <Avatar className="h-10 w-10">
        {avatarUrl ? <AvatarImage src={resolveMediaUrl(avatarUrl)} /> : null}
        <AvatarFallback className="bg-zinc-800 text-xs text-zinc-300">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-100">{displayName}</div>
        <div className="flex items-center gap-1 text-[11px] text-zinc-500">
          <Bot className="h-3 w-3" />
          Agent
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={handleStartChat}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-300"
        >
          <MessageSquarePlus className="h-3 w-3" />
          聊天
        </button>
        <Link
          to="/agent-profile/$agentId"
          params={{ agentId }}
          className="shrink-0 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
        >
          详情
        </Link>
      </div>
    </div>
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
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-72 rounded-xl border-zinc-800/70 bg-[#0f0f11] p-0 text-zinc-100 shadow-xl shadow-black/40"
          onMouseEnter={handleContentEnter}
          onMouseLeave={handleContentLeave}
        >
          {cardContent}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 rounded-xl border-zinc-800/70 bg-[#0f0f11] p-0 text-zinc-100 shadow-xl shadow-black/40"
      >
        {cardContent}
      </PopoverContent>
    </Popover>
  )
}
