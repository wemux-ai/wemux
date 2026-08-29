/**
 * [INPUT]: One server-filtered Inbox group list and current URL selection.
 * [OUTPUT]: Compact Linear-style group rows with actor, reason, body, unread count, and time.
 * [POS]: Left pane of the global Inbox list/detail surface.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { Inbox, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import type { InboxGroupSummary, InboxQueryScope, InboxSection } from '@shared/inbox'
import type { InboxListState } from '../../lib/inbox-provider'
import { cn } from '../../lib/utils'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { IdentityCardWrapper } from '../profiles/identity-card-wrapper'
import { Button } from '../ui/button'
import { formatInboxRelativeTime, inboxReasonLabel } from './inbox-model'

const getInitials = (name: string) => (name.trim() || '?').slice(0, 2).toUpperCase()

/** 「全部」视图里逐行标出真实归属，否则待处理和已归档混在一条线上分不出来。 */
const SECTION_BADGES: Record<InboxSection, { zh: string; en: string; tone: string }> = {
  action: { zh: '待处理', en: 'Action', tone: 'bg-amber-500/10 text-amber-300' },
  following: { zh: '关注', en: 'Following', tone: 'bg-zinc-500/10 text-zinc-400' },
  snoozed: { zh: '稍后', en: 'Snoozed', tone: 'bg-violet-500/10 text-violet-300' },
  archived: { zh: '已归档', en: 'Archived', tone: 'bg-zinc-700/20 text-zinc-500' },
}

export function InboxGroupList({
  language,
  list,
  section,
  selectedGroupKey,
  onLoadMore,
  onRefresh,
  onSelect,
}: {
  language: string
  list: InboxListState<InboxGroupSummary>
  section: InboxQueryScope
  selectedGroupKey?: string
  onLoadMore: () => Promise<void>
  onRefresh: () => Promise<void>
  onSelect: (groupKey: string) => void
}) {
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#060607]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-200">{tr('收件箱', 'Inbox')}</p>
          <p className="text-[11px] text-zinc-600">{list.entries.length} {tr('个对话组', 'groups')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={list.loading}
          onClick={() => void onRefresh()}
          className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          aria-label={tr('刷新收件箱', 'Refresh Inbox')}
          title={tr('刷新', 'Refresh')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', list.loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.loading && !list.loaded ? (
          <div className="flex h-36 items-center justify-center gap-2 text-xs text-zinc-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tr('正在加载...', 'Loading...')}
          </div>
        ) : list.error && list.entries.length === 0 ? (
          <div className="mx-3 my-3 border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-5 text-center text-xs text-zinc-500">
            <p>{list.error}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void onRefresh()} className="mt-2 h-7 gap-1.5 rounded-md px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
              <RotateCw className="h-3.5 w-3.5" />
              {tr('重试', 'Retry')}
            </Button>
          </div>
        ) : list.entries.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center px-5 text-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-600">
              <Inbox className="h-4 w-4" />
            </span>
            <p className="mt-3 text-xs font-medium text-zinc-400">{tr('此分区暂无内容', 'Nothing in this section')}</p>
            <p className="mt-1 text-[11px] leading-4 text-zinc-600">
              {section === 'archived'
                ? tr('归档的对话组会显示在这里。', 'Archived groups will appear here.')
                : section === 'snoozed'
                  ? tr('稍后提醒的对话组会显示在这里。', 'Snoozed groups will appear here.')
                  : section === 'all'
                    ? tr('你收到的所有动态都会汇总在这里。', 'Everything you receive is collected here.')
                    : tr('新的相关动态会自动出现在这里。', 'Relevant activity will appear here automatically.')}
            </p>
          </div>
        ) : (
          <div className="p-1.5">
            {list.entries.map((group) => {
              const item = group.latestItem
              const selected = group.groupKey === selectedGroupKey
              return (
                <button
                  key={group.groupKey}
                  type="button"
                  onClick={() => onSelect(group.groupKey)}
                  className={cn(
                    'group flex min-h-[92px] w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors',
                    selected
                      ? 'bg-zinc-900/80 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                  )}
                >
                  <IdentityCardWrapper kind={item.actorType} id={item.actorId} name={item.actorName} triggerMode="hover">
                    <Avatar className="mt-0.5 h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950">
                      <AvatarFallback className="rounded-md bg-zinc-900 text-[9px] font-semibold text-zinc-300">
                        {getInitials(item.actorName)}
                      </AvatarFallback>
                    </Avatar>
                  </IdentityCardWrapper>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {group.unreadCount > 0 ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" /> : null}
                      <span className="truncate text-[11px] font-medium text-zinc-400">{item.actorName}</span>
                      <span className="truncate text-[10px] text-zinc-600">{inboxReasonLabel(item.reason, language)}</span>
                      {section === 'all' && SECTION_BADGES[group.section] ? (
                        <span className={cn(
                          'shrink-0 rounded px-1 text-[9px] font-medium leading-4',
                          SECTION_BADGES[group.section].tone,
                        )}>
                          {tr(SECTION_BADGES[group.section].zh, SECTION_BADGES[group.section].en)}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{formatInboxRelativeTime(item.createdAt, language)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', selected ? 'text-zinc-100' : 'text-zinc-300')}>
                        {item.title}
                      </span>
                      {group.unreadCount > 0 ? (
                        <span className="flex min-w-5 shrink-0 items-center justify-center rounded-md bg-rose-500/15 px-1.5 text-[9px] font-semibold leading-4 text-rose-300">
                          {group.unreadCount > 99 ? '99+' : group.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-zinc-500">{item.body}</span>
                  </span>
                </button>
              )
            })}
            {list.nextCursor ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={list.loading}
                onClick={() => void onLoadMore()}
                className="mt-1 h-8 w-full rounded-md text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              >
                {list.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {tr('加载更多', 'Load more')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
