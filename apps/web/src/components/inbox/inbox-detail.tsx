/**
 * [INPUT]: Selected Inbox group, its item timeline, and group/item mutation callbacks.
 * [OUTPUT]: Operational detail pane with read, archive, snooze, and source-navigation actions.
 * [POS]: Right pane of the global Inbox list/detail surface.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useState } from 'react'
import {
  Archive,
  ArrowLeft,
  Check,
  ExternalLink,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
} from 'lucide-react'
import type { InboxGroupSummary, InboxItem } from '@shared/inbox'
import type { InboxListState } from '../../lib/inbox-provider'
import { cn, formatDate } from '../../lib/utils'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { IdentityCardWrapper } from '../profiles/identity-card-wrapper'
import { Button } from '../ui/button'
import { InboxSnoozeControl } from './inbox-snooze-control'
import { formatInboxRelativeTime, inboxEventTypeReasonLabel, inboxReasonLabel } from './inbox-model'

const getInitials = (name: string) => (name.trim() || '?').slice(0, 2).toUpperCase()

export function InboxDetail({
  group,
  items,
  language,
  onArchiveGroup,
  onArchiveItem,
  onBack,
  onMarkGroupRead,
  onMarkItemRead,
  onOpenSource,
  onRefresh,
  onSnoozeGroup,
  onSnoozeItem,
  onUnsnoozeGroup,
  onUnsnoozeItem,
}: {
  group?: InboxGroupSummary
  items: InboxListState<InboxItem>
  language: string
  onArchiveGroup: () => Promise<void>
  onArchiveItem: (itemId: string) => Promise<void>
  onBack?: () => void
  onMarkGroupRead: () => Promise<void>
  onMarkItemRead: (itemId: string) => Promise<void>
  onOpenSource: (item: InboxItem) => Promise<void>
  onRefresh: () => Promise<void>
  onSnoozeGroup: (until: string) => Promise<void>
  onSnoozeItem: (itemId: string, until: string) => Promise<void>
  onUnsnoozeGroup: () => Promise<void>
  onUnsnoozeItem: (itemId: string) => Promise<void>
}) {
  const [busyKey, setBusyKey] = useState('')
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en

  const run = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key)
    try {
      await action()
    } finally {
      setBusyKey('')
    }
  }

  if (!group) {
    return (
      <div className="flex h-full min-h-[22rem] flex-col items-center justify-center bg-[#09090b] px-6 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-600">
          <Inbox className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-zinc-300">{tr('选择一个收件箱对话', 'Select an Inbox group')}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-600">
          {tr('在左侧选择对话组以查看完整时间线并处理。', 'Choose a group from the list to review its timeline and take action.')}
        </p>
      </div>
    )
  }

  const latest = group.latestItem
  const groupBusy = busyKey.startsWith('group:')

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
      <div className="flex shrink-0 items-start gap-2 border-b border-zinc-900 px-3 py-2.5 sm:px-4">
        {onBack ? (
          <Button type="button" variant="ghost" size="icon" onClick={onBack} className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100" aria-label={tr('返回列表', 'Back to list')} title={tr('返回', 'Back')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-zinc-100">{latest.title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-zinc-600">
            {latest.actorName} · {inboxEventTypeReasonLabel(latest.eventType, language) || inboxReasonLabel(latest.reason, language)} · {group.itemCount} {tr('条动态', 'items')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {group.unreadCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={groupBusy}
              onClick={() => void run('group:read', onMarkGroupRead)}
              className="h-7 w-7 rounded-md border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label={tr('全部标为已读', 'Mark group read')}
              title={tr('全部标为已读', 'Mark group read')}
            >
              {busyKey === 'group:read' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          <InboxSnoozeControl
            compact
            busy={groupBusy}
            language={language}
            snoozedUntil={group.snoozedUntil}
            onSnooze={(until) => run('group:snooze', () => onSnoozeGroup(until))}
            onUnsnooze={() => run('group:unsnooze', onUnsnoozeGroup)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={groupBusy || group.section === 'archived'}
            onClick={() => void run('group:archive', onArchiveGroup)}
            className="h-7 w-7 rounded-md border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-rose-300"
            aria-label={tr('归档对话组', 'Archive group')}
            title={tr('归档', 'Archive')}
          >
            {busyKey === 'group:archive' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.loading && !items.loaded ? (
          <div className="flex h-40 items-center justify-center gap-2 text-xs text-zinc-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {tr('正在加载时间线...', 'Loading timeline...')}
          </div>
        ) : items.error && items.entries.length === 0 ? (
          <div className="mx-auto mt-8 w-[min(28rem,calc(100%-2rem))] border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center text-xs text-zinc-500">
            <p>{items.error}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void onRefresh()} className="mt-2 h-7 gap-1.5 rounded-md px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
              <RefreshCw className="h-3.5 w-3.5" />
              {tr('重试', 'Retry')}
            </Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-5">
            {[...items.entries].reverse().map((item, index) => {
              const itemBusy = busyKey.startsWith(`item:${item.id}:`)
              const sourceAvailable = Boolean(item.scope.taskId || item.scope.groupId || item.scope.workspaceId)
              return (
                <div key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < items.entries.length - 1 ? <div className="absolute left-3.5 top-8 h-[calc(100%-1.25rem)] w-px bg-zinc-900" /> : null}
                  <IdentityCardWrapper kind={item.actorType} id={item.actorId} name={item.actorName} triggerMode="hover">
                    <Avatar className="relative z-[1] h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950">
                      <AvatarFallback className="rounded-md bg-zinc-900 text-[9px] font-semibold text-zinc-300">{getInitials(item.actorName)}</AvatarFallback>
                    </Avatar>
                  </IdentityCardWrapper>
                  <div className={cn('min-w-0 flex-1 border-b border-zinc-900/80 pb-5', index === items.entries.length - 1 && 'border-b-0 pb-0')}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-medium text-zinc-200">{item.actorName}</span>
                      <span className="text-[11px] text-zinc-500">{inboxEventTypeReasonLabel(item.eventType, language) || inboxReasonLabel(item.reason, language)}</span>
                      {!item.readAt ? <span className="flex items-center gap-1 text-[10px] text-rose-300"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" />{tr('未读', 'Unread')}</span> : null}
                      <span className="ml-auto shrink-0 text-[10px] text-zinc-600" title={formatDate(item.createdAt)}>{formatInboxRelativeTime(item.createdAt, language)}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-5 text-zinc-200">{item.title}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-400">{item.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {!item.readAt ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={itemBusy}
                          onClick={() => void run(`item:${item.id}:read`, () => onMarkItemRead(item.id))}
                          className="h-7 gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        >
                          {busyKey === `item:${item.id}:read` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          {tr('标为已读', 'Mark read')}
                        </Button>
                      ) : null}
                      {sourceAvailable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={itemBusy}
                          onClick={() => void run(`item:${item.id}:open`, () => onOpenSource(item))}
                          className="h-7 gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        >
                          {busyKey === `item:${item.id}:open` ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                          {item.scope.taskId ? tr('打开任务', 'Open task') : tr('打开群聊', 'Open group')}
                        </Button>
                      ) : null}
                      <InboxSnoozeControl
                        compact
                        busy={itemBusy}
                        language={language}
                        snoozedUntil={item.snoozedUntil}
                        onSnooze={(until) => run(`item:${item.id}:snooze`, () => onSnoozeItem(item.id, until))}
                        onUnsnooze={() => run(`item:${item.id}:unsnooze`, () => onUnsnoozeItem(item.id))}
                      />
                      {!item.archivedAt ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={itemBusy}
                          onClick={() => void run(`item:${item.id}:archive`, () => onArchiveItem(item.id))}
                          className="h-7 w-7 rounded-md text-zinc-600 hover:bg-zinc-900 hover:text-rose-300"
                          aria-label={tr('归档此条', 'Archive item')}
                          title={tr('归档此条', 'Archive item')}
                        >
                          {busyKey === `item:${item.id}:archive` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
            {items.loaded && items.entries.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center">
                <MessageSquare className="h-5 w-5 text-zinc-700" />
                <p className="mt-2 text-xs text-zinc-500">{tr('这个对话组暂无可见动态。', 'No visible items in this group.')}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
