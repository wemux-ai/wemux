import { Boxes, Check, FileText, MessageSquare, Search, Sparkles, Users } from 'lucide-react'

import { resolveMediaUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

export type ChatMentionOption = {
  id: string
  kind: 'agent' | 'member' | 'conversation' | 'all' | 'doc' | 'group' | 'skill' | 'workspace'
  label: string
  description?: string
  avatarUrl?: string
  kindLabel: string
  keywords?: string[]
}

type ChatMentionListProps = {
  activeIndex: number
  emptyText: string
  hintText: string
  onSelect: (option: ChatMentionOption) => void
  options: ChatMentionOption[]
  open: boolean
  title: string
}

const getInitials = (name: string) => {
  const normalized = name.trim()
  if (!normalized) {
    return 'AI'
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

export function ChatMentionList({
  activeIndex,
  emptyText,
  hintText,
  onSelect,
  options,
  open,
  title,
}: ChatMentionListProps) {
  if (!open) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-2 rounded-2xl border border-zinc-800 bg-[#0f0f11] p-2 text-zinc-100 shadow-2xl shadow-black/40">
      <div className="mb-2 flex items-center justify-between px-2 pt-1">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{title}</p>
          <p className="mt-1 text-[11px] text-zinc-600">{hintText}</p>
        </div>
        <Search className="h-3.5 w-3.5 text-zinc-500" />
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto overscroll-contain pr-1">
        {options.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-500">
            {emptyText}
          </div>
        ) : (
          options.map((option, index) => {
            const active = index === activeIndex

            return (
              <button
                key={option.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(option)
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs transition-colors',
                  active ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-zinc-50',
                )}
              >
                <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                  {option.avatarUrl ? <AvatarImage src={resolveMediaUrl(option.avatarUrl)} /> : null}
                  {option.kind === 'conversation' ? (
                    <AvatarFallback className="bg-emerald-500/20 text-emerald-300">
                      <MessageSquare className="size-3.5" />
                    </AvatarFallback>
                  ) : option.kind === 'doc' ? (
                    <AvatarFallback className="bg-sky-500/20 text-sky-300">
                      <FileText className="size-3.5" />
                    </AvatarFallback>
                  ) : option.kind === 'all' ? (
                    <AvatarFallback className="bg-amber-500/20 text-amber-300">
                      <Users className="size-3.5" />
                    </AvatarFallback>
                  ) : option.kind === 'group' ? (
                    <AvatarFallback className="bg-violet-500/20 text-violet-300">
                      <Users className="size-3.5" />
                    </AvatarFallback>
                  ) : option.kind === 'workspace' ? (
                    <AvatarFallback className="bg-teal-500/20 text-teal-300">
                      <Boxes className="size-3.5" />
                    </AvatarFallback>
                  ) : option.kind === 'skill' ? (
                    <AvatarFallback className="bg-violet-500/20 text-violet-300">
                      <Sparkles className="size-3.5" />
                    </AvatarFallback>
                  ) : (
                    <AvatarFallback className={cn(
                      'text-[11px] font-semibold text-zinc-100',
                      option.kind === 'agent' ? 'bg-gradient-to-br from-cyan-400 via-sky-400 to-indigo-500 text-zinc-950' : 'bg-zinc-800',
                    )}>
                      {getInitials(option.label)}
                    </AvatarFallback>
                  )}
                </Avatar>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.label}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <span>{option.kindLabel}</span>
                    {option.description ? <span className="truncate">{option.description}</span> : null}
                  </span>
                </span>

                <span className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
                  active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-500',
                )}>
                  {active ? <Check className="h-3 w-3" /> : '@'}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
