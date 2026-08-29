/**
 * [INPUT]: Agent Chat controller state, workspace group-chat state, and selected chat target.
 * [OUTPUT]: Search, unread state, and workspace-scoped selection for direct Agent, member, and group conversations; "new chat" dropdown (start DM / create group / add friend) opens the corresponding dialogs.
 * [POS]: `/chat` target sidebar; group chat is available without becoming a task-assignee type.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessageSquarePlus, Plus, Search, Share2, UserPlus, Users } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { IdentityCardWrapper } from '../../components/profiles/identity-card-wrapper'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { Input } from '../../components/ui/input'
import { api, resolveMediaUrl } from '../../lib/api'
import type { ConnectionUserBrief } from '../../lib/api/methods/connections'
import { useRealtimeEvents } from '../../lib/realtime/useRealtime'
import { cn } from '../../lib/utils'
import { getAgentLiveStatus, useAgentLiveStatuses } from '../../lib/agent-live-status'
import {
  buildMainChatAgentSessionDigests,
  formatChatListTimestamp,
  getAgentInitials,
  getSessionAgentId,
  text,
} from './chat-route-helpers'
import type { ChatRouteController } from './use-chat-route-controller'
import type { DmChatState } from './use-dm-chat-state'
import type { DmConversationListItem } from '../../lib/api/methods/collaboration'
import type { Language } from '../../lib/i18n'
import type { WorkspaceGroupChatState } from './workspace-group-chat-panel'
import { WorkspaceGroupCreateDialog } from './workspace-group-create-dialog'
import { DmCreateDialog } from './dm-create-dialog'
import { AddFriendDialog } from './add-friend-dialog'
import { filterWorkspaceVisibleDmConversations } from './chat-target-visibility'

type ChatTargetSidebarProps = {
  controller: ChatRouteController
  groupState: WorkspaceGroupChatState
  dmState: DmChatState
  language: Language
  selectedTarget: { kind: 'agent' | 'group' | 'dm'; id: string }
  onSelectTarget: (target: { kind: 'agent' | 'group' | 'dm'; id: string }) => void
}

type TargetItem = {
  id: string
  kind: 'agent' | 'group' | 'dm' | 'member'
  agentKind?: string
  title: string
  subtitle: string
  meta: number
  unreadCount: number
  mentioned?: boolean
  updatedAt: string
  avatarUrl?: string
  avatarClassName?: string
}

export function ChatTargetSidebar({
  controller,
  groupState,
  dmState,
  language,
  selectedTarget,
  onSelectTarget,
}: ChatTargetSidebarProps) {
  const [query, setQuery] = useState('')
  const [dmCreateOpen, setDmCreateOpen] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [friends, setFriends] = useState<ConnectionUserBrief[]>([])
  const [friendsLoaded, setFriendsLoaded] = useState(false)
  const liveStatuses = useAgentLiveStatuses()
  const normalizedQuery = query.trim().toLowerCase()
  const { shareActions } = controller
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 搜索结果跳转：群聊 → 选中群；主聊天/DM 会话 → 选中对应 Agent；私聊 → 选中 DM。 */
  const openSearchHit = (hit: { conversation: { id?: string; kind?: string; chatMode?: string; groupId?: string; orchestratorAgentId?: string; createdBy?: string } }) => {
    const conversation = hit.conversation
    if (conversation.chatMode === 'group' && conversation.groupId) {
      onSelectTarget({ kind: 'group', id: conversation.groupId })
      return
    }
    if (conversation.kind === 'dm' && conversation.id) {
      // 左栏 DM 目标按 peer 聚合，选中态 id 是 peerUserId：从会话反查对方。
      const item = dmState.dmConversations.find((entry) => entry.conversation.id === conversation.id)
      onSelectTarget({ kind: 'dm', id: item?.peer?.userId || conversation.id })
      return
    }
    if (conversation.kind === 'main') {
      const agentId = conversation.orchestratorAgentId || conversation.createdBy || ''
      if (agentId) {
        onSelectTarget({ kind: 'agent', id: agentId })
      }
    }
  }

  useEffect(() => {
    // 「共享给我的」已下线（协作共享改在工作区侧展示）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 好友列表（连接机制）：侧栏「好友」分区展示，点击发起/打开私聊。
  const loadFriends = useCallback(() => {
    setFriendsLoaded(false)
    void api.listConnections(groupState.selectedWorkspaceId)
      .then((response) => setFriends(response.users))
      .catch(() => undefined)
      .finally(() => setFriendsLoaded(true))
  }, [groupState.selectedWorkspaceId])
  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // 对方接受好友请求后实时刷新好友分区。
  useRealtimeEvents((event) => {
    if (event.type === 'inbox.item.created' && event.item.eventType === 'user.connection.accepted') {
      loadFriends()
    }
  })

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (!normalizedQuery) {
      void shareActions.runSessionSearch('')
      return
    }

    searchDebounceRef.current = setTimeout(() => {
      void shareActions.runSessionSearch(query)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedQuery])
  const filteredAgents = useMemo(() => {
    const visibleAgents = controller.chatAgents.filter((agent) => agent.kind !== 'primary')
    if (!normalizedQuery) return visibleAgents
    return visibleAgents.filter((agent) => `${agent.name} ${agent.role}`.toLowerCase().includes(normalizedQuery))
  }, [controller.chatAgents, normalizedQuery])
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groupState.groups
    return groupState.groups.filter((group) => {
      const latest = group.latestMessage?.content || ''
      return `${group.conversation.title} ${latest}`.toLowerCase().includes(normalizedQuery)
    })
  }, [groupState.groups, normalizedQuery])
  const sessionDigestByAgentId = useMemo(
    () => buildMainChatAgentSessionDigests(controller.mainChatSessions),
    [controller.mainChatSessions],
  )
  const sessionIdsByAgentId = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const session of controller.mainChatSessions) {
      const agentId = getSessionAgentId(session)
      map[agentId] = [...(map[agentId] ?? []), session.id]
    }
    return map
  }, [controller.mainChatSessions])
  const unreadCountByAgentId = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [agentId, sessionIds] of Object.entries(sessionIdsByAgentId)) {
      counts[agentId] = sessionIds.reduce((sum, id) => sum + (controller.mainChatUnread[id] ?? 0), 0)
    }
    return counts
  }, [controller.mainChatUnread, sessionIdsByAgentId])
  /** 当前空间 DM + 好友 DM；空间成员不会随历史私聊泄漏到其他空间。 */
  const workspaceVisibleDmConversations = useMemo(() => filterWorkspaceVisibleDmConversations({
    conversations: dmState.dmConversations,
    workspaceId: groupState.selectedWorkspaceId,
    friends,
  }), [dmState.dmConversations, friends, groupState.selectedWorkspaceId])
  const visibleDmConversationIds = useMemo(
    () => new Set(workspaceVisibleDmConversations.map((item) => item.conversation.id)),
    [workspaceVisibleDmConversations],
  )
  const visibleSessionSearchHits = useMemo(
    () => shareActions.sessionSearchHits.filter((hit) => (
      hit.conversation.kind !== 'dm' || visibleDmConversationIds.has(hit.conversation.id)
    )),
    [shareActions.sessionSearchHits, visibleDmConversationIds],
  )
  useEffect(() => {
    if (
      !friendsLoaded
      || !groupState.selectedWorkspaceId
      || selectedTarget.kind !== 'dm'
      || workspaceVisibleDmConversations.some((item) => item.peer?.userId === selectedTarget.id)
    ) {
      return
    }

    const fallbackAgentId = controller.selectedChatAgent?.id
      || controller.chatAgents.find((agent) => agent.kind !== 'primary')?.id
    if (fallbackAgentId) {
      onSelectTarget({ kind: 'agent', id: fallbackAgentId })
    }
  }, [
    controller.chatAgents,
    controller.selectedChatAgent?.id,
    friendsLoaded,
    groupState.selectedWorkspaceId,
    onSelectTarget,
    selectedTarget,
    workspaceVisibleDmConversations,
  ])
  /** 私聊目标按 peer 聚合：同一对象的多会话合并为一行（最新消息 / 聚合未读 / 会话数），选中态 id 为 peerUserId。 */
  const dmTargets = useMemo(() => {
    const byPeer = new Map<string, DmConversationListItem[]>()
    for (const item of workspaceVisibleDmConversations) {
      const peerId = item.peer?.userId || item.conversation.id
      byPeer.set(peerId, [...(byPeer.get(peerId) ?? []), item])
    }
    const entries = [...byPeer.entries()].map(([peerId, items]) => {
      const latest = [...items].sort((a, b) => (
        (b.latestMessage?.createdAt || b.conversation.updatedAt || '')
          .localeCompare(a.latestMessage?.createdAt || a.conversation.updatedAt || '')
      ))[0]
      return {
        id: peerId,
        kind: 'dm' as const,
        title: latest.peer?.name || text(language, '未知用户', 'Unknown user'),
        subtitle: latest.latestMessage?.content || text(language, '暂无消息', 'No messages yet'),
        meta: items.length,
        unreadCount: items.reduce(
          (sum, item) => sum + (dmState.unreadByConversationId[item.conversation.id] ?? 0),
          0,
        ),
        updatedAt: latest.latestMessage?.createdAt || latest.conversation.updatedAt || '',
        avatarUrl: latest.peer?.avatarUrl,
        avatarClassName: 'bg-emerald-200',
      }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (normalizedQuery) {
      return entries.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(normalizedQuery))
    }
    return entries
  }, [dmState.unreadByConversationId, language, normalizedQuery, workspaceVisibleDmConversations])
  /** 工作区成员（含自己，尚无私聊会话的）默认展示，点击直接发起私聊；发起后由 DM 会话行代表。 */
  const memberTargets = useMemo(() => {
    const workspaceId = groupState.selectedWorkspaceId
    if (!workspaceId) {
      return []
    }
    const dmPeerIds = new Set(
      workspaceVisibleDmConversations
        .map((item) => item.peer?.userId)
        .filter((id): id is string => Boolean(id)),
    )
    return groupState.options.members
      .filter((member) => !dmPeerIds.has(member.id))
      .filter((member) => (
        !normalizedQuery || `${member.name} ${member.email}`.toLowerCase().includes(normalizedQuery)
      ))
      .map((member) => ({
        id: member.id,
        kind: 'member' as const,
        title: member.name,
        subtitle: text(language, '工作区成员', 'Workspace member'),
        meta: 0,
        unreadCount: 0,
        updatedAt: '',
        avatarUrl: member.avatarUrl,
        avatarClassName: 'bg-sky-200',
      }))
  }, [groupState.options.members, groupState.selectedWorkspaceId, language, normalizedQuery, workspaceVisibleDmConversations])
  const targetsByKind = useMemo(() => {
    const agentTargets = filteredAgents.map((agent) => {
      const digest = sessionDigestByAgentId[agent.id]
      return {
        id: agent.id,
        kind: 'agent' as const,
        agentKind: agent.kind,
        title: agent.name,
        subtitle: digest?.summary
          || (agent.kind === 'loading' ? agent.role : text(language, '暂无会话', 'No sessions yet')),
        meta: digest?.sessionCount ?? 0,
        updatedAt: digest?.updatedAt || '',
        avatarUrl: agent.avatarUrl,
        avatarClassName: agent.avatarClassName,
        unreadCount: unreadCountByAgentId[agent.id] ?? 0,
      }
    })
    const groupTargets = filteredGroups.map((group) => {
      const mentioned = (groupState.mentionUnreadByGroupId[group.conversation.id] ?? 0) > 0
      return {
        id: group.conversation.id,
        kind: 'group' as const,
        title: group.conversation.title,
        subtitle: mentioned
          ? text(language, '有人 @ 你', 'Someone mentioned you')
          : group.latestMessage?.content || text(language, '暂无消息', 'No messages yet'),
        meta: group.members.length,
        unreadCount: groupState.unreadCountByGroupId[group.conversation.id] ?? 0,
        mentioned,
        updatedAt: group.latestMessage?.createdAt || group.conversation.updatedAt || '',
      }
    })

    return {
      dm: dmTargets,
      agent: agentTargets,
      group: groupTargets,
    }
  }, [dmTargets, filteredAgents, filteredGroups, groupState.mentionUnreadByGroupId, groupState.unreadCountByGroupId, language, unreadCountByAgentId, sessionDigestByAgentId])

  /** 合并单列表：私聊 / 成员 / Agent / 群聊统一按最近活跃排序，无会话的成员按名字排尾部。 */
  const targets = useMemo(() => {
    const items: TargetItem[] = [
      ...targetsByKind.dm,
      ...memberTargets,
      ...targetsByKind.agent,
      ...targetsByKind.group,
    ].sort((a, b) => {
      if (a.updatedAt && b.updatedAt) {
        return b.updatedAt.localeCompare(a.updatedAt)
      }
      if (a.updatedAt) return -1
      if (b.updatedAt) return 1
      return a.title.localeCompare(b.title, undefined, { numeric: true })
    })
    return items
  }, [memberTargets, targetsByKind])

  return (
    <aside className="min-h-0 border-b border-zinc-900 bg-[#060607] xl:border-b-0">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-900 px-3 py-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            {text(language, '聊天对象', 'Targets')}
          </span>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={text(language, '新建聊天', 'New chat')}
                  title={text(language, '新建聊天', 'New chat')}
                  className="size-7 text-zinc-500 hover:text-zinc-200"
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onSelect={() => setDmCreateOpen(true)}>
                  <MessageSquarePlus />
                  {text(language, '发起私聊', 'Start a direct message')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => groupState.setCreateOpen(true)}>
                  <Users />
                  {text(language, '创建群聊', 'Create group chat')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAddFriendOpen(true)}>
                  <UserPlus />
                  {text(language, '添加好友', 'Add friend')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="shrink-0 border-b border-zinc-900 px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-zinc-600" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text(language, '搜索 Agent 或群聊...', 'Search agents or groups...')}
              className="h-7 rounded-md border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-700 focus-visible:ring-0"
            />
          </div>
        </div>

        <div className="scrollbar-subtle flex-1 overflow-y-auto p-1.5">
          {normalizedQuery ? (
            <div className="mb-2 space-y-1">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
                  {text(language, '搜索结果', 'Search results')}
                </p>
                {shareActions.sessionSearchLoading ? <Loader2 className="size-3 animate-spin text-zinc-600" /> : null}
              </div>
              {visibleSessionSearchHits.length === 0 ? (
                <div className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-3 text-center text-[11px] text-zinc-600">
                  {shareActions.sessionSearchLoading
                    ? text(language, '搜索中…', 'Searching…')
                    : text(language, '没有匹配的会话内容。', 'No matching session content.')}
                </div>
              ) : (
                visibleSessionSearchHits.map((hit) => (
                  <button
                    key={hit.conversation.id}
                    type="button"
                    onClick={() => openSearchHit(hit)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="line-clamp-1 flex-1 text-[12px] font-medium text-zinc-200">{hit.conversation.title}</p>
                      {hit.conversation.visibility === 'public' ? (
                        <Share2 className="size-3 shrink-0 text-emerald-400" />
                      ) : null}
                    </div>
                    {hit.matchedMessages.map((message) => (
                      <p key={message.id} className="mt-0.5 line-clamp-1 text-[11px] text-zinc-600">{message.content}</p>
                    ))}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {(() => {
            const totalCount = targets.length

            return (
              <>
                {!normalizedQuery && friends.length > 0 ? (
                  <div className="mb-2">
                    <div className="mb-1.5 flex items-center justify-between px-1">
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
                        {text(language, '好友', 'Friends')}
                      </p>
                      <span className="rounded-md bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">{friends.length}</span>
                    </div>
                    <div className="space-y-1">
                      {friends.map((friend) => {
                        const isActive = selectedTarget.kind === 'dm' && selectedTarget.id === friend.id
                        return (
                          <button
                            key={friend.id}
                            type="button"
                            onClick={() => {
                              // 有会话 → 打开最近私聊；无会话 → get-or-create。
                              const peerItems = dmState.dmConversations.filter((item) => item.peer?.userId === friend.id)
                              if (peerItems.length > 0) {
                                onSelectTarget({ kind: 'dm', id: friend.id })
                              } else {
                                void dmState.startDm(friend.id, groupState.selectedWorkspaceId).then((conversationId) => {
                                  if (conversationId) {
                                    onSelectTarget({ kind: 'dm', id: friend.id })
                                  }
                                })
                              }
                            }}
                            className={cn(
                              'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                              isActive ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <IdentityCardWrapper kind="user" id={friend.id} name={friend.name} avatarUrl={friend.avatarUrl} triggerMode="hover">
                                <Avatar className="size-8 border border-zinc-800 bg-zinc-900">
                                  {friend.avatarUrl ? <AvatarImage src={resolveMediaUrl(friend.avatarUrl)} /> : null}
                                  <AvatarFallback className="rounded-full bg-emerald-200 text-[10px] font-semibold text-zinc-950">
                                    {getAgentInitials(friend.name)}
                                  </AvatarFallback>
                                </Avatar>
                              </IdentityCardWrapper>
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-1 text-[13px] font-medium">{friend.name}</p>
                                <p className="line-clamp-1 text-[11px] text-zinc-600">{friend.username ? `@${friend.username}` : text(language, '好友', 'Friend')}</p>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mb-1.5 flex items-center justify-between px-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
                    {text(language, '聊天对象', 'Targets')}
                  </p>
                  <span className="rounded-md bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">{totalCount}</span>
                </div>

                {totalCount === 0 ? (
                  <div className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-[11px] text-zinc-600">
                    {normalizedQuery
                      ? text(language, '没有匹配的聊天对象。', 'No matching targets.')
                      : text(language, '点击右上角 + 新建群聊或发起私聊，或进入任意 Agent。', 'Use + to create a group or start a direct message, or open any Agent.')}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {targets.map((target) => {
                      const isActive = selectedTarget.kind === target.kind && selectedTarget.id === target.id
                      const isGroup = target.kind === 'group'
                      const isMember = target.kind === 'member'
                      const isLoadingAgent = !isGroup && !isMember && target.agentKind === 'loading'
                      const liveStatus = isGroup || isMember ? undefined : getAgentLiveStatus(liveStatuses, target.id, target.title)
                      const timeLabel = formatChatListTimestamp(target.updatedAt, language)
                      return (
                        <button
                          key={`${target.kind}:${target.id}`}
                          type="button"
                          onClick={() => {
                            // 工作区成员（含自己）：点击直接发起私聊（get-or-create），成功后选中 DM。
                            if (target.kind === 'member') {
                              void dmState.startDm(target.id, groupState.selectedWorkspaceId).then((conversationId) => {
                                if (conversationId) {
                                  // DM 选中态 id 为 peerUserId（左栏按私聊对象聚合）。
                                  onSelectTarget({ kind: 'dm', id: target.id })
                                }
                              })
                              return
                            }
                            if (!isLoadingAgent) onSelectTarget({ kind: target.kind, id: target.id })
                          }}
                          disabled={isLoadingAgent}
                          className={cn(
                            'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                            isActive ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                            isLoadingAgent && 'cursor-wait opacity-75',
                          )}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="relative shrink-0">
                              <IdentityCardWrapper
                                kind={isGroup ? undefined : target.kind === 'agent' ? 'agent' : 'user'}
                                id={isGroup ? undefined : target.id}
                                name={target.title}
                                avatarUrl={target.avatarUrl}
                                triggerMode="hover"
                              >
                                <Avatar className={cn('size-8 border border-zinc-800 bg-zinc-900', isGroup ? 'rounded-md' : 'rounded-full')}>
                                  {!isGroup && target.avatarUrl ? <AvatarImage src={resolveMediaUrl(target.avatarUrl)} /> : null}
                                  <AvatarFallback className={cn(
                                    'font-semibold',
                                    isGroup
                                      ? 'rounded-md bg-zinc-900 text-[11px] text-zinc-100'
                                      : `rounded-full bg-gradient-to-br text-[10px] text-zinc-950 ${target.avatarClassName}`,
                                  )}>
                                    {getAgentInitials(target.title)}
                                  </AvatarFallback>
                                </Avatar>
                              </IdentityCardWrapper>
                              {isGroup ? (
                                <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-800 text-zinc-300">
                                  <Users className="size-2.5" />
                                </span>
                              ) : isLoadingAgent ? (
                                <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-800 text-zinc-300">
                                  <Loader2 className="size-2.5 animate-spin" />
                                </span>
                              ) : null}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <p className="line-clamp-1 min-w-0 flex-1 text-[13px] font-medium">{target.title}</p>
                                {liveStatus && liveStatus.workingCount > 0 ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                                    {text(language, '运行中', 'Running')}
                                    {liveStatus.workingCount > 1 ? ` ${liveStatus.workingCount}` : ''}
                                  </span>
                                ) : null}
                                {timeLabel ? (
                                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{timeLabel}</span>
                                ) : null}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2">
                                <p className={cn(
                                  'line-clamp-1 min-w-0 flex-1 text-[11px]',
                                  target.mentioned ? 'text-rose-400' : 'text-zinc-600',
                                )}>{target.subtitle}</p>
                                <div className="flex shrink-0 items-center gap-2">
                                  {target.mentioned ? (
                                    <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      @
                                    </span>
                                  ) : target.unreadCount > 0 ? (
                                    <span
                                      className="size-2 shrink-0 rounded-full bg-rose-500"
                                      aria-label={text(language, '有未读消息', 'Unread messages')}
                                    />
                                  ) : null}
                                  {(isGroup || isLoadingAgent) ? (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                      {isGroup ? text(language, '群聊', 'Group') : text(language, '加载中', 'Loading')}
                                    </span>
                                  ) : null}
                                </div>
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )
              })()}
        </div>
      </div>

      <DmCreateDialog
        open={dmCreateOpen}
        language={language}
        workspaceId={groupState.selectedWorkspaceId}
        onOpenChange={setDmCreateOpen}
        onStartDm={(peerUserId) => dmState.startDm(peerUserId, groupState.selectedWorkspaceId)}
        onSelected={(peerUserId) => onSelectTarget({ kind: 'dm', id: peerUserId })}
      />
      <AddFriendDialog
        open={addFriendOpen}
        language={language}
        workspaceId={groupState.selectedWorkspaceId}
        onOpenChange={setAddFriendOpen}
        onFriendAdded={loadFriends}
      />
      <WorkspaceGroupCreateDialog
        draft={groupState.draft}
        language={language}
        onDraftChange={groupState.setDraft}
        onSubmit={groupState.handleCreateGroup}
        open={groupState.createOpen}
        onOpenChange={groupState.setCreateOpen}
        options={groupState.options}
        workspace={groupState.selectedWorkspace}
        busy={groupState.createBusy}
      />
    </aside>
  )
}
