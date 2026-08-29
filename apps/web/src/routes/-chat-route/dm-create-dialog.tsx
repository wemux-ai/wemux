import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '../../components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Input } from '../../components/ui/input'
import { api, resolveMediaUrl } from '../../lib/api'
import type { Language } from '../../lib/i18n'
import { getAgentInitials, text } from './chat-route-helpers'
import { cn } from '../../lib/utils'

type DmCreateDialogProps = {
  open: boolean
  language: Language
  workspaceId: string
  onOpenChange: (open: boolean) => void
  onStartDm: (peerUserId: string) => Promise<string>
  onSelected: (peerUserId: string) => void
}

type UserHit = {
  id: string
  name: string
  username?: string
  email: string
  avatarUrl?: string
}

/** 飞书式用户搜索 → 发起私聊。跨空间开放：按姓名/邮箱搜索任意注册用户。 */
export function DmCreateDialog({ open, language, workspaceId, onOpenChange, onStartDm, onSelected }: DmCreateDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserHit[]>([])
  const [searching, setSearching] = useState(false)
  const [starting, setStarting] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const runSearch = useCallback(async (rawQuery: string) => {
    const normalized = rawQuery.trim()
    if (normalized.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const response = await api.searchUsers(normalized, workspaceId)
      setResults(response.users)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    if (!open) {
      return
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query)
    }, 300)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [open, query, runSearch])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setStarting('')
    }
  }, [open])

  const handleStart = async (userId: string) => {
    if (starting) {
      return
    }
    setStarting(userId)
    try {
      const conversationId = await onStartDm(userId)
      if (conversationId) {
        onOpenChange(false)
        // 选中态按私聊对象（peer）切换，具体会话由中栏/selectPeer 定位。
        onSelected(userId)
      }
    } finally {
      setStarting('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text(language, '发起私聊', 'Start a direct message')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text(language, '搜索姓名或邮箱...', 'Search by name or email...')}
              autoFocus
              className="h-8 rounded-md border-zinc-800 bg-zinc-950 pl-8 pr-8 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-700 focus-visible:ring-0"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                aria-label={text(language, '清空', 'Clear')}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-zinc-600">
                <Loader2 className="size-3 animate-spin" />
                {text(language, '搜索中...', 'Searching...')}
              </div>
            ) : query.trim().length < 2 ? (
              <p className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-[11px] text-zinc-600">
                {text(language, '输入至少 2 个字符搜索用户。', 'Type at least 2 characters to search.')}
              </p>
            ) : results.length === 0 ? (
              <p className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-[11px] text-zinc-600">
                {text(language, '没有找到匹配的用户（仅显示同一协作空间的成员与已连接好友，其他人需先加好友）。', 'No matching users (only shared-workspace members and connected friends are shown; add others as friends first).')}
              </p>
            ) : (
              results.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => void handleStart(user.id)}
                  disabled={Boolean(starting)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900',
                    starting === user.id && 'cursor-wait opacity-70',
                  )}
                >
                  <Avatar className="size-7 border border-zinc-800 bg-zinc-900">
                    {user.avatarUrl ? <AvatarImage src={resolveMediaUrl(user.avatarUrl)} /> : null}
                    <AvatarFallback className="rounded-full bg-zinc-800 text-[10px] text-zinc-200">
                      {getAgentInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[13px] font-medium text-zinc-200">{user.name}</p>
                    <p className="line-clamp-1 text-[11px] text-zinc-600">{user.username ? `@${user.username}` : user.email}</p>
                  </div>
                  {starting === user.id ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-zinc-500" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
