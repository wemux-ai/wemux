/**
 * [INPUT]: URL-selected Inbox section/group, global Inbox provider, and existing task/group navigation state.
 * [OUTPUT]: Responsive operational global Inbox with desktop resizable list/detail and mobile list-to-detail flow.
 * [POS]: Primary `/inbox` frontend experience; Agent-specific inbox remains outside this surface.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Archive, AtSign, Eye, Inbox } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { toast } from 'sonner'
import type { InboxGroupSummary, InboxItem, InboxSection } from '@shared/inbox'
import { useApp } from '../../lib/app-provider'
import { useInbox } from '../../lib/inbox-provider'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  readWorkspaceGroupChatPreferences,
  setPersistedWorkspaceGroupChatGroup,
  setPersistedWorkspaceGroupChatSession,
  setPersistedWorkspaceGroupChatTarget,
  setPersistedWorkspaceGroupChatWorkspace,
  writeWorkspaceGroupChatPreferences,
} from '../../routes/-chat-route/workspace-group-chat-preferences'
import { useSidebar } from '../ui/sidebar'
import { InboxDetail } from './inbox-detail'
import { InboxGroupList } from './inbox-group-list'
import { inboxSectionLabel, toInboxSection, type InboxPageSection } from './inbox-model'

const SECTIONS: Array<{ id: InboxPageSection; icon: typeof Inbox }> = [
  { id: 'all', icon: Inbox },
  { id: 'action', icon: AtSign },
  { id: 'following', icon: Eye },
  { id: 'archived', icon: Archive },
]

export function InboxPage({ section, groupKey }: { section: InboxPageSection; groupKey?: string }) {
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const { language } = useTranslation()
  const { state, setSelectedProjectId, setSelectedTaskId } = useApp()
  const inbox = useInbox()
  const apiSection = toInboxSection(section)
  const list = inbox.groups[apiSection]
  const itemState = groupKey ? inbox.getItems(apiSection, groupKey) : { entries: [], loading: false, loaded: false, error: '' }
  // 'all' 是页面查询范围，不是 InboxGroupSummary 的 section。
  // 该兜底对象只在目标 group 尚未进入列表时构造，section 仅用于判断是否已归档。
  const fallbackSection: InboxSection = apiSection !== 'all' ? apiSection : 'action'
  const fallbackGroup: InboxGroupSummary | undefined = groupKey && itemState.entries[0]
    ? {
        groupKey,
        section: fallbackSection,
        latestItem: itemState.entries[0],
        itemCount: itemState.entries.length,
        unreadCount: itemState.entries.filter((item) => !item.readAt).length,
        actionableUnreadCount: itemState.entries.filter((item) => !item.readAt && item.kind !== 'observe').length,
        snoozedUntil: itemState.entries.map((item) => item.snoozedUntil).filter(Boolean).sort().at(-1),
      }
    : undefined
  const selectedGroup = list?.entries.find((group) => group.groupKey === groupKey) ?? fallbackGroup
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en

  const setSearch = (next: { section?: InboxPageSection; groupKey?: string }, replace = false) => {
    void navigate({
      to: '/inbox' as never,
      search: {
        section: next.section ?? section,
        groupKey: next.groupKey,
      } as never,
      replace,
    })
  }

  useEffect(() => {
    void inbox.refreshGroups(apiSection).catch(() => undefined)
  }, [apiSection, inbox.refreshGroups])

  useEffect(() => {
    if (!groupKey) return
    void inbox.refreshItems(apiSection, groupKey).catch(() => undefined)
  }, [apiSection, groupKey, inbox.refreshItems])

  useEffect(() => {
    if (isMobile || groupKey || !list?.loaded || list.entries.length === 0) return
    setSearch({ section, groupKey: list.entries[0]?.groupKey }, true)
  }, [apiSection, groupKey, isMobile, list?.entries, list?.loaded, section])

  const run = async (action: () => Promise<void>, fallback: string, onSuccess?: () => void) => {
    try {
      await action()
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback)
    }
  }

  const openSource = async (item: InboxItem) => {
    if (item.replyTo.kind === 'feedback_item' || item.scope.feedbackId) {
      const feedbackId = item.replyTo.kind === 'feedback_item' ? item.replyTo.feedbackId : item.scope.feedbackId
      await navigate({ to: '/feedback' as never, search: { open: feedbackId } as never })
      return
    }

    if (item.scope.taskId) {
      const projectId = item.scope.projectId || state.tasks.find((task) => task.id === item.scope.taskId)?.projectId || ''
      setSelectedTaskId(item.scope.taskId)
      if (projectId) setSelectedProjectId(projectId)
      await navigate({
        to: '/kanban' as never,
        search: { projectId: projectId || undefined, taskId: item.scope.taskId, createTask: undefined } as never,
      })
      return
    }

    if (item.scope.groupId) {
      let preferences = readWorkspaceGroupChatPreferences()
      if (item.scope.workspaceId) {
        preferences = setPersistedWorkspaceGroupChatWorkspace(preferences, item.scope.workspaceId)
        preferences = setPersistedWorkspaceGroupChatGroup(preferences, item.scope.workspaceId, item.scope.groupId)
      }
      if (item.scope.workspaceSessionId) {
        preferences = setPersistedWorkspaceGroupChatSession(preferences, item.scope.groupId, item.scope.workspaceSessionId)
      }
      preferences = setPersistedWorkspaceGroupChatTarget(preferences, { kind: 'group', id: item.scope.groupId })
      writeWorkspaceGroupChatPreferences(preferences)
      await navigate({ to: '/chat' as never })
      return
    }

    // 私聊（DM）新消息：跳回 /chat 并选中对应私聊对象（收件人视角的 peer 即发送者 actor）。
    if (item.scope.conversationId && item.actorType === 'user' && item.actorId) {
      const preferences = setPersistedWorkspaceGroupChatTarget(
        readWorkspaceGroupChatPreferences(),
        { kind: 'dm', id: item.actorId },
      )
      writeWorkspaceGroupChatPreferences(preferences)
      await navigate({ to: '/chat' as never })
      return
    }

    // 好友请求 / 已接受：跳设置页「好友与连接」处理。
    if (item.eventType === 'user.connection.requested' || item.eventType === 'user.connection.accepted') {
      await navigate({ to: '/settings' as never, search: { section: 'connections' } as never })
      return
    }

    // 协作空间加入邀请：跳转邀请确认页。
    if (item.scope.invitationToken) {
      await navigate({ to: `/invite/${item.scope.invitationToken}` as never })
      return
    }

    if (item.scope.workspaceId) {
      await navigate({
        to: '/workspaces' as never,
        search: {
          workspaceId: item.scope.workspaceId,
          workspaceSessionId: item.scope.workspaceSessionId,
          taskId: item.scope.taskId,
          projectId: item.scope.projectId,
        } as never,
      })
    }
  }

  const groupList = (
    <InboxGroupList
      language={language}
      list={list}
      section={apiSection}
      selectedGroupKey={groupKey}
      onLoadMore={() => run(() => inbox.loadMoreGroups(apiSection), tr('加载更多失败', 'Failed to load more groups.'))}
      onRefresh={() => run(() => inbox.refreshGroups(apiSection), tr('刷新收件箱失败', 'Failed to refresh Inbox.'))}
      onSelect={(nextGroupKey) => setSearch({ section, groupKey: nextGroupKey })}
    />
  )

  const detail = (
    <InboxDetail
      group={selectedGroup}
      items={itemState}
      language={language}
      onBack={isMobile ? () => setSearch({ section, groupKey: undefined }) : undefined}
      onRefresh={() => groupKey
        ? run(() => inbox.refreshItems(apiSection, groupKey), tr('刷新时间线失败', 'Failed to refresh timeline.'))
        : Promise.resolve()}
      onMarkGroupRead={() => groupKey
        ? run(() => inbox.markGroupRead(groupKey), tr('标记已读失败', 'Failed to mark group read.'))
        : Promise.resolve()}
      onArchiveGroup={async () => {
        if (!groupKey) return
        await run(
          () => inbox.archiveGroup(groupKey),
          tr('归档失败', 'Failed to archive group.'),
          () => setSearch({ section, groupKey: undefined }, true),
        )
      }}
      onSnoozeGroup={async (until) => {
        if (!groupKey) return
        await run(
          () => inbox.snoozeGroup(groupKey, until),
          tr('设置提醒失败', 'Failed to snooze group.'),
          () => setSearch({ section, groupKey: undefined }, true),
        )
      }}
      onUnsnoozeGroup={() => groupKey
        ? run(() => inbox.unsnoozeGroup(groupKey), tr('取消提醒失败', 'Failed to unsnooze group.'))
        : Promise.resolve()}
      onMarkItemRead={(itemId) => groupKey
        ? run(() => inbox.markItemRead(itemId, groupKey), tr('标记已读失败', 'Failed to mark item read.'))
        : Promise.resolve()}
      onArchiveItem={(itemId) => groupKey
        ? run(() => inbox.archiveItem(itemId, groupKey), tr('归档失败', 'Failed to archive item.'))
        : Promise.resolve()}
      onSnoozeItem={(itemId, until) => groupKey
        ? run(() => inbox.snoozeItem(itemId, groupKey, until), tr('设置提醒失败', 'Failed to snooze item.'))
        : Promise.resolve()}
      onUnsnoozeItem={(itemId) => groupKey
        ? run(() => inbox.unsnoozeItem(itemId, groupKey), tr('取消提醒失败', 'Failed to unsnooze item.'))
        : Promise.resolve()}
      onOpenSource={openSource}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#050505]">
      <div className="flex min-h-0 shrink-0 items-end gap-1 overflow-x-auto border-b border-zinc-900 bg-[#060607] px-2 pt-2 sm:px-3">
        {SECTIONS.map((entry) => {
          const Icon = entry.icon
          const selected = section === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSearch({ section: entry.id, groupKey: undefined })}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors',
                selected
                  ? 'border-zinc-800 bg-[#09090b] text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:border-zinc-900 hover:bg-zinc-950/70 hover:text-zinc-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {inboxSectionLabel(entry.id, language)}
              {entry.id === 'action' && inbox.badgeCount > 0 ? (
                <span className="flex min-w-4 items-center justify-center rounded-md bg-rose-500/15 px-1 text-[9px] font-semibold leading-4 text-rose-300">
                  {inbox.badgeCount > 99 ? '99+' : inbox.badgeCount}
                </span>
              ) : null}
            </button>
          )
        })}
        <span className="ml-auto mb-2 hidden items-center gap-1.5 px-2 text-[10px] text-zinc-600 sm:flex">
          <span className={cn('h-1.5 w-1.5 rounded-full', inbox.connected ? 'bg-emerald-400' : 'bg-zinc-700')} />
          {inbox.connected ? tr('实时更新', 'Live') : tr('正在重连', 'Reconnecting')}
        </span>
      </div>

      {isMobile ? (
        <div className="min-h-0 flex-1">{groupKey ? detail : groupList}</div>
      ) : (
        <Group id="global-inbox-columns" orientation="horizontal" className="min-h-0 flex-1">
          <Panel id="inboxGroupList" defaultSize="32%" minSize="280px" maxSize="420px">
            {groupList}
          </Panel>
          <Separator className="group relative flex w-1 items-center justify-center px-0 outline-none focus:outline-none focus-visible:ring-0">
            <div className="h-full w-px bg-zinc-900 transition-colors group-hover:bg-zinc-700 group-focus-visible:bg-zinc-700" />
          </Separator>
          <Panel id="inboxGroupDetail" defaultSize="68%" minSize="480px">
            {detail}
          </Panel>
        </Group>
      )}
    </div>
  )
}
