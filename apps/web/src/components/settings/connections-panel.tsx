/**
 * [INPUT]: 当前用户 + 连接 API（好友列表/请求/搜索）。
 * [OUTPUT]: 好友与连接管理面板：搜索加好友、待处理请求（接受/拒绝）、我发出的请求、好友列表。
 * [POS]: 跨协作空间可见性管理 UI；可见性规则（同空间 ∪ 已连接）见 server user-visibility-service。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, UserPlus, UserRoundCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, resolveMediaUrl } from '../../lib/api'
import type { ConnectionUserBrief } from '../../lib/api/methods/connections'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const getNameInitials = (name: string) => (name?.trim() || '?').slice(0, 2).toUpperCase()

type ConnectionsPanelProps = {
  language: string
}

export function ConnectionsPanel({ language }: ConnectionsPanelProps) {
  const tr = (zh: string, en: string) => (language === 'zh' ? zh : en)
  const [friends, setFriends] = useState<ConnectionUserBrief[]>([])
  const [requests, setRequests] = useState<ConnectionUserBrief[]>([])
  const [sent, setSent] = useState<ConnectionUserBrief[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ConnectionUserBrief[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyUserId, setBusyUserId] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [friendsRes, requestsRes, sentRes] = await Promise.all([
        api.listConnections(),
        api.listPendingRequests(),
        api.listPendingSent(),
      ])
      setFriends(friendsRes.users)
      setRequests(requestsRes.users)
      setSent(sentRes.users)
    } catch {
      toast.error(tr('加载失败', 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }, [tr])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const runSearch = useCallback(async (rawQuery: string) => {
    const normalized = rawQuery.trim()
    if (normalized.length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    try {
      // 搜索只返回同空间成员 ∪ 已连接好友；好友列表外的候选通过加好友建立关系。
      const response = await api.searchUsers(normalized, undefined, { forConnection: true })
      setHits(response.users.map((u) => ({ id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl })))
    } catch {
      setHits([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query)
    }, 300)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, runSearch])

  const runBusy = async (userId: string, action: () => Promise<unknown>, successMessage?: string) => {
    if (busyUserId) return
    setBusyUserId(userId)
    try {
      await action()
      if (successMessage) toast.success(successMessage)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('操作失败', 'Failed'))
    } finally {
      setBusyUserId('')
    }
  }

  const renderUserRow = (
    user: ConnectionUserBrief,
    trailing: React.ReactNode,
  ) => (
    <div key={user.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="h-7 w-7">
          {user.avatarUrl ? <AvatarImage src={resolveMediaUrl(user.avatarUrl)} /> : null}
          <AvatarFallback className="bg-zinc-900 text-xs text-zinc-100">{getNameInitials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{user.name}</p>
          <p className="truncate text-[11px] text-zinc-500">{user.username ? `@${user.username}` : ''}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
        <div className="border-b border-zinc-900 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">{tr('添加好友', 'Add friends')}</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {tr('通过用户 ID / 昵称搜索：只显示同一协作空间的成员与已连接好友；其他用户需先成为好友才能互相看见。', 'Search by user ID / name: only members of shared workspaces and connected friends are shown.')}
          </p>
        </div>
        <div className="space-y-2 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr('输入用户 ID 或昵称…', 'Type a user ID or name…')}
              className="h-8 rounded-md border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
          <div className="max-h-56 divide-y divide-zinc-900 overflow-y-auto rounded-md border border-zinc-800/60">
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" />{tr('搜索中…', 'Searching…')}
              </div>
            ) : hits.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-zinc-600">
                {query.trim().length >= 2 ? tr('没有可添加的用户（需同空间成员或已连接）。', 'No users found (shared workspace or connected required).') : tr('输入至少 2 个字符开始搜索。', 'Type at least 2 characters to search.')}
              </div>
            ) : (
              hits.map((user) => renderUserRow(user, (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyUserId === user.id}
                  onClick={() =>
                    void runBusy(
                      user.id,
                      async () => {
                        await api.requestConnection(user.id, user.workspaceId)
                        await loadAll()
                      },
                      tr('好友请求已发送', 'Friend request sent'),
                    )
                  }
                  className="h-7 rounded-md px-2 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
                >
                  {busyUserId === user.id ? <Loader2 className="mr-1 size-3 animate-spin" /> : <UserPlus className="mr-1 size-3" />}
                  {tr('加好友', 'Add friend')}
                </Button>
              )))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
        <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">{tr('待处理请求', 'Pending requests')}</h3>
          {requests.length > 0 ? (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">{requests.length}</span>
          ) : null}
        </div>
        <div className="divide-y divide-zinc-900">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" />{tr('加载中…', 'Loading…')}
            </div>
          ) : requests.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-600">{tr('暂无待处理的好友请求。', 'No pending friend requests.')}</div>
          ) : (
            requests.map((user) => renderUserRow(user, (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyUserId === user.id}
                  onClick={() =>
                    void runBusy(
                      user.id,
                      async () => {
                        await api.acceptConnection(user.id, user.workspaceId)
                        await loadAll()
                      },
                      tr('已添加为好友', 'Added as friend'),
                    )
                  }
                  className="h-7 rounded-md px-2 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
                >
                  {busyUserId === user.id ? <Loader2 className="mr-1 size-3 animate-spin" /> : <UserRoundCheck className="mr-1 size-3" />}
                  {tr('接受', 'Accept')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyUserId === user.id}
                  onClick={() =>
                    void runBusy(
                      user.id,
                      async () => {
                        await api.rejectConnection(user.id, user.workspaceId)
                        await loadAll()
                      },
                      tr('已拒绝', 'Rejected'),
                    )
                  }
                  className="h-7 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  {tr('拒绝', 'Decline')}
                </Button>
              </>
            )))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
        <div className="border-b border-zinc-900 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">{tr('我的好友', 'My friends')}</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">{tr('已连接的用户跨协作空间互相可见，可搜索、私聊与互相邀请。', 'Connected users are mutually visible across workspaces.')}</p>
        </div>
        <div className="divide-y divide-zinc-900">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" />{tr('加载中…', 'Loading…')}
            </div>
          ) : friends.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-600">{tr('还没有好友，先从搜索中添加吧。', 'No friends yet. Start by adding one above.')}</div>
          ) : (
            friends.map((user) => renderUserRow(user, sent.some((s) => s.id === user.id) ? null : null))
          )}
        </div>
      </div>

      {sent.length > 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/75">
          <div className="border-b border-zinc-900 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-100">{tr('我发出的请求', 'Sent requests')}</h3>
          </div>
          <div className="divide-y divide-zinc-900">
            {sent.map((user) => renderUserRow(user, (
              <Button
                size="sm"
                variant="ghost"
                disabled={busyUserId === user.id}
                onClick={() =>
                  void runBusy(
                    user.id,
                    async () => {
                        await api.cancelConnection(user.id, user.workspaceId)
                      await loadAll()
                    },
                    tr('已取消请求', 'Request cancelled'),
                  )
                }
                className="h-7 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                {tr('取消请求', 'Cancel')}
              </Button>
            )))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
