/**
 * [INPUT]: Dialog open state and language; connection API (search + request).
 * [OUTPUT]: "Add friend" dialog: search users by name/email, send connection requests, show sent/connected state.
 * [POS]: `/chat` sidebar "new chat" dropdown entry; friend relations drive cross-workspace visibility (server user-visibility-service).
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, UserPlus, UserRoundCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { Button } from '../../components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { api, resolveMediaUrl } from '../../lib/api'
import type { Language } from '../../lib/i18n'
import { getAgentInitials, text } from './chat-route-helpers'
import { cn } from '../../lib/utils'

type AddFriendDialogProps = {
  open: boolean
  language: Language
  workspaceId: string
  onOpenChange: (open: boolean) => void
  /** 好友请求被接受后刷新侧栏好友分区（由父组件注册）。 */
  onFriendAdded?: () => void
}

type UserHit = {
  id: string
  name: string
  username?: string
  email: string
  avatarUrl?: string
}

/** 搜索用户并发送好友请求；已连接 / 已发送的用户显示状态而非按钮。 */
export function AddFriendDialog({ open, language, workspaceId, onOpenChange, onFriendAdded }: AddFriendDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserHit[]>([])
  const [searching, setSearching] = useState(false)
  const [busyUserId, setBusyUserId] = useState('')
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set())
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 打开时同步「已是好友 / 已发送请求」状态，避免对已连接用户重复发请求。
  const loadRelationState = useCallback(async () => {
    try {
      const [friendsRes, sentRes] = await Promise.all([api.listConnections(workspaceId), api.listPendingSent(workspaceId)])
      setFriendIds(new Set(friendsRes.users.map((user) => user.id)))
      setSentIds(new Set(sentRes.users.map((user) => user.id)))
    } catch {
      // 静默失败：搜索仍可用，发送时由服务端兜底校验。
    }
  }, [workspaceId])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setSearching(false)
      setBusyUserId('')
      return
    }
    void loadRelationState()
  }, [open, loadRelationState])

  const runSearch = useCallback(async (rawQuery: string) => {
    const normalized = rawQuery.trim()
    if (normalized.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const response = await api.searchUsers(normalized, workspaceId, { forConnection: true })
      setResults(response.users)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

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

  const handleAdd = async (userId: string) => {
    if (busyUserId) {
      return
    }
    setBusyUserId(userId)
    try {
      const response = await api.requestConnection(userId, workspaceId)
      if (response.created) {
        setSentIds((prev) => new Set(prev).add(userId))
        toast.success(text(language, '好友请求已发送', 'Friend request sent'))
      } else {
        // 已是好友或请求已存在：刷新状态并提示。
        await loadRelationState()
        toast.info(text(language, '你们已经是好友了', 'Already friends'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '发送失败', 'Failed to send'))
    } finally {
      setBusyUserId('')
      onFriendAdded?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text(language, '添加好友', 'Add friend')}</DialogTitle>
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
                {text(language, '没有找到可添加的用户（仅显示同一协作空间的成员与已连接好友）。', 'No matching users (only shared-workspace members and connected friends are shown).')}
              </p>
            ) : (
              results.map((user) => {
                const isFriend = friendIds.has(user.id)
                const isSent = sentIds.has(user.id)
                const busy = busyUserId === user.id
                return (
                  <div
                    key={user.id}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2',
                      isFriend ? 'opacity-80' : '',
                    )}
                  >
                    <Avatar className="size-7 shrink-0 border border-zinc-800 bg-zinc-900">
                      {user.avatarUrl ? <AvatarImage src={resolveMediaUrl(user.avatarUrl)} /> : null}
                      <AvatarFallback className="rounded-full bg-zinc-800 text-[10px] text-zinc-200">
                        {getAgentInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-[13px] font-medium text-zinc-200">{user.name}</p>
                      <p className="line-clamp-1 text-[11px] text-zinc-600">{user.username ? `@${user.username}` : user.email}</p>
                    </div>
                    {isFriend ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        <UserRoundCheck className="size-3" />
                        {text(language, '已是好友', 'Friends')}
                      </span>
                    ) : isSent ? (
                      <span className="inline-flex shrink-0 items-center rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        {text(language, '已发送', 'Sent')}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void handleAdd(user.id)}
                        className="h-7 shrink-0 rounded-md px-2 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                      >
                        {busy ? <Loader2 className="size-3 animate-spin" /> : <UserPlus className="size-3" />}
                        {text(language, '加好友', 'Add friend')}
                      </Button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
