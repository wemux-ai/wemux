/**
 * [INPUT]: 统一会话条目数据（标题/预览/时间/未读/置顶/运行态/渠道/行内操作）
 *          + 头部标题与操作区 + 空态 + 移动端横向滚动模式。
 * [OUTPUT]: `/chat` 中栏会话列表（Agent 会话 / 私聊 / 群聊）共用的侧栏组件，
 *           条目行布局、选中/悬停态、未读与运行态徽标全端一致。
 * [POS]: 会话列表 UI 唯一实现；新增列表形态必须复用本组件，禁止再复制 aside 结构。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { Loader2, MessageCircle, Pin } from 'lucide-react'
import type { ReactNode } from 'react'
import { Checkbox } from '../../components/ui/checkbox'
import { cn } from '../../lib/utils'

export type ChatSessionListItem = {
  id: string
  title: string
  preview?: string
  previewTone?: 'default' | 'running' | 'unread' | 'mention'
  timeLabel?: string
  isActive?: boolean
  isPinned?: boolean
  unreadCount?: number
  /** 群聊里有尚未确认的 @你，飞书式红色提示。 */
  mentioned?: boolean
  running?: boolean
  runningLabel?: string
  channelLabel?: string
  /** 条目行左侧附加内容（如 Agent 会话的运行状态条） */
  leading?: ReactNode
  onClick?: () => void
  /** 行内操作（置顶/删除/更多…）；不传则整行为纯按钮 */
  actions?: ReactNode
}

type ChatSessionListSidebarProps = {
  title: ReactNode
  items: ChatSessionListItem[]
  emptyState?: ReactNode
  headerActions?: ReactNode
  isMobile?: boolean
  /** 多选模式：条目显示 checkbox，点击切换选中 */
  selectMode?: boolean
  selectedIds?: ReadonlySet<string>
  onToggleSelected?: (id: string, checked: boolean) => void
  onSelectSession?: () => void
}

export function ChatSessionListSidebar({
  title,
  items,
  emptyState,
  headerActions,
  isMobile = false,
  selectMode = false,
  selectedIds,
  onToggleSelected,
  onSelectSession,
}: ChatSessionListSidebarProps) {
  return (
    <aside className={cn('min-h-0 border-zinc-900 bg-[#060607]', isMobile ? 'border-b' : 'border-b xl:border-b-0')}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-900 px-3 py-2.5">
          <span className="min-w-0 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            <span className="line-clamp-1">{title}</span>
          </span>
          {headerActions ? (
            <div className="flex items-center gap-0.5">{headerActions}</div>
          ) : null}
        </div>

        <div className={cn('scrollbar-subtle flex-1 p-2', isMobile ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto')}>
          {items.length === 0 && emptyState ? (
            emptyState
          ) : (
            <div className={cn(isMobile ? 'flex gap-2' : 'space-y-1')}>
              {items.map((item) => (
                <ChatSessionListRow
                  key={item.id}
                  item={item}
                  isMobile={isMobile}
                  selectMode={selectMode}
                  selected={selectMode ? Boolean(selectedIds?.has(item.id)) : false}
                  onToggleSelected={onToggleSelected}
                  onSelectSession={onSelectSession}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function ChatSessionListRow({
  item,
  isMobile,
  selectMode,
  selected,
  onToggleSelected,
  onSelectSession,
}: {
  item: ChatSessionListItem
  isMobile: boolean
  selectMode: boolean
  selected: boolean
  onToggleSelected?: (id: string, checked: boolean) => void
  onSelectSession?: () => void
}) {
  const unread = item.unreadCount ?? 0
  const showActions = Boolean(item.actions) && !selectMode
  // active / 置顶行按钮常驻：时间戳让位隐藏；普通行 hover 时才淡出让位给浮出的按钮。
  const actionsAlwaysVisible = showActions && (item.isActive || item.isPinned)

  const handleClick = () => {
    if (selectMode) {
      onToggleSelected?.(item.id, !selected)
      return
    }
    item.onClick?.()
    onSelectSession?.()
  }

  return (
    <div
      className={cn(
        'group relative rounded-md px-2.5 py-2.5 transition-colors',
        isMobile && 'min-w-[11rem] shrink-0 border border-zinc-800/50',
        item.isActive
          ? 'bg-zinc-900/80 text-zinc-100'
          : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
      )}
    >
      {item.leading}

      <div className="relative flex items-start gap-1.5">
        {selectMode ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(nextValue) => onToggleSelected?.(item.id, Boolean(nextValue))}
            className="mt-1 shrink-0"
          />
        ) : null}

        <button
          type="button"
          onClick={handleClick}
          className={cn('min-w-0 flex-1 text-left', showActions && 'pl-1.5')}
        >
          <div className="flex items-center gap-2">
            <p className="line-clamp-1 min-w-0 flex-1 text-xs font-medium">{item.title}</p>
            {item.channelLabel ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500"
                title={item.channelLabel}
              >
                <MessageCircle className="size-2.5" />
                {item.channelLabel}
              </span>
            ) : null}
            {item.isPinned ? <Pin className="size-3 shrink-0 text-amber-300" /> : null}
            {item.mentioned ? (
              <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                @
              </span>
            ) : unread > 0 ? (
              <span className="min-w-4 rounded-full bg-sky-400 px-1.5 py-0.5 text-center text-[10px] font-semibold text-zinc-950">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
            {item.running ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                <Loader2 className="size-2.5 animate-spin" />
                {item.runningLabel}
              </span>
            ) : null}
            {item.timeLabel ? (
              <span
                className={cn(
                  'shrink-0 text-[10px] tabular-nums text-zinc-600 transition-opacity',
                  actionsAlwaysVisible ? 'opacity-0' : showActions && 'group-hover:opacity-0',
                )}
              >
                {item.timeLabel}
              </span>
            ) : null}
          </div>

          <p
            className={cn(
              'mt-0.5 line-clamp-1 text-[11px]',
              item.previewTone === 'running'
                ? 'text-sky-300'
                : item.previewTone === 'mention'
                  ? 'text-rose-400'
                  : item.previewTone === 'unread'
                    ? 'text-zinc-300'
                    : 'text-zinc-600',
            )}
          >
            {item.preview}
          </p>
        </button>

        {showActions ? (
          <div
            className={cn(
              'absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-md bg-zinc-900/95 transition-opacity',
              actionsAlwaysVisible
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
            )}
          >
            {item.actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
