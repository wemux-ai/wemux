/**
 * [INPUT]: Agent / DM / 群聊三种目标状态（controller / dmState / groupState）、
 *          当前选中目标 selectedTarget、语言与移动端模式。
 * [OUTPUT]: `/chat` 中栏会话列表的唯一入口：无论目标是 Agent、私聊还是群聊，
 *           都渲染同一个 ChatSessionListSidebar（Agent 版式：头部按钮 + 行内操作），
 *           行为与视觉全端一致。
 * [POS]: 会话列表不再按目标拆组件；新增目标类型时在下面加一个分支 adapter，禁止新开侧栏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { ReactNode } from 'react'
import { ListChecks, Loader2, MoreHorizontal, Pin, PinOff, Plus, Send, Share2, Trash2, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { cn } from '../../lib/utils'
import {
  formatChatListTimestamp,
  getMainChatSessionActivityState,
  getMainChatSessionPreview,
  text,
} from './chat-route-helpers'
import { ChatSessionListSidebar, type ChatSessionListItem } from './chat-session-list-sidebar'
import type { ChatRouteController } from './use-chat-route-controller'
import type { DmChatState } from './use-dm-chat-state'
import type { WorkspaceGroupChatState } from './workspace-group-chat-panel'
import type { Language } from '../../lib/i18n'

type ChatTarget = { kind: 'agent' | 'group' | 'dm'; id: string }

type ChatSessionSidebarProps = {
  controller: ChatRouteController
  groupState: WorkspaceGroupChatState
  dmState: DmChatState
  selectedTarget: ChatTarget
  language: Language
  isMobile?: boolean
  onSelectSession?: () => void
}

const CHANNEL_LABELS: Record<string, { zh: string; en: string }> = {
  telegram: { zh: 'Telegram', en: 'Telegram' },
  feishu: { zh: '飞书', en: 'Feishu' },
  wechat: { zh: '微信', en: 'WeChat' },
  discord: { zh: 'Discord', en: 'Discord' },
  slack: { zh: 'Slack', en: 'Slack' },
  wecom: { zh: '企业微信', en: 'WeCom' },
  whatsapp: { zh: 'WhatsApp', en: 'WhatsApp' },
  dingtalk: { zh: '钉钉', en: 'DingTalk' },
}

/**
 * 三种目标（Agent / DM / 群聊）会话行共用的行内操作：置顶 / 删除 / 更多。
 * 删除统一走 confirm（见各 state hook），按钮行为与视觉全端一致。
 */
const buildSessionRowActions = (params: {
  language: Language
  isPinned: boolean
  pinLabel: string
  onTogglePin: () => void
  onDelete: () => void
  disabled?: boolean
  canDelete?: boolean
  extraMenuItems?: ReactNode
}) => (
  <>
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        params.onTogglePin()
      }}
      disabled={params.disabled}
      title={params.pinLabel}
      aria-label={params.pinLabel}
      className={cn(
        'rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50',
        params.isPinned && 'text-amber-300',
      )}
    >
      {params.isPinned ? <PinOff size={10} /> : <Pin size={10} />}
    </button>
    {params.canDelete !== false ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          params.onDelete()
        }}
        disabled={params.disabled}
        title={text(params.language, '删除会话', 'Delete session')}
        aria-label={text(params.language, '删除会话', 'Delete session')}
        className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 size={10} />
      </button>
    ) : null}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title={text(params.language, '更多操作', 'More actions')}
          aria-label={text(params.language, '更多操作', 'More actions')}
        >
          <MoreHorizontal size={10} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={params.onTogglePin}>
          {params.isPinned ? <PinOff /> : <Pin />}
          {params.pinLabel}
        </DropdownMenuItem>
        {params.extraMenuItems}
        {params.canDelete !== false ? (
          <DropdownMenuItem
            onSelect={params.onDelete}
            className="text-rose-300 focus:text-rose-200"
          >
            <Trash2 />
            {text(params.language, '删除会话', 'Delete session')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  </>
)

export function ChatSessionSidebar(props: ChatSessionSidebarProps) {
  if (props.selectedTarget.kind === 'group') {
    return <GroupTargetSessions {...props} />
  }
  if (props.selectedTarget.kind === 'dm') {
    return <DmTargetSessions {...props} />
  }
  return <AgentTargetSessions {...props} />
}

/** Agent 目标：主聊天会话，功能最全（多选转发 / 置顶 / 删除 / 分享）。 */
function AgentTargetSessions({
  controller,
  language,
  isMobile = false,
  onSelectSession,
}: ChatSessionSidebarProps) {
  const { shareActions } = controller
  const selectMode = shareActions.multiSelectMode

  const items = controller.selectedAgentSessions.map<ChatSessionListItem>((session) => {
    const isActive = session.id === controller.state.selectedMainChatSessionId
    const isPinned = Boolean(session.pinnedAt?.trim())
    const canDelete = controller.mainChatSessions.length > 1
    const activityState = getMainChatSessionActivityState({
      session,
      localActivity: controller.sessionActivityById[session.id],
      streamingActive: controller.isStreaming && session.id === controller.activeSession?.id,
    })
    const pinLabel = isPinned
      ? text(language, '取消置顶', 'Unpin')
      : text(language, '置顶会话', 'Pin session')

    return {
      id: session.id,
      title: session.title || text(language, '新会话', 'New Session'),
      preview: getMainChatSessionPreview(session)
        || text(language, '空会话', 'Empty session'),
      timeLabel: formatChatListTimestamp(session.updatedAt || session.createdAt, language),
      isActive,
      isPinned,
      unreadCount: controller.mainChatUnread[session.id],
      running: activityState === 'running',
      runningLabel: text(language, '正在工作中', 'Working'),
      channelLabel: session.sourceChannel
        ? (CHANNEL_LABELS[session.sourceChannel]?.[language === 'zh' ? 'zh' : 'en'] || session.sourceChannel)
        : undefined,
      leading: activityState ? (
        <span
          className={cn(
            'absolute bottom-2.5 left-1.5 top-2.5 w-0.5 rounded-full',
            activityState === 'running' ? 'bg-sky-400 animate-pulse' : 'bg-emerald-400',
          )}
        />
      ) : undefined,
      onClick: () => {
        void controller.handleSelectSession(session.id)
      },
      actions: buildSessionRowActions({
        language,
        isPinned,
        pinLabel,
        onTogglePin: () => { void controller.handleToggleSessionPinned(session.id, !isPinned) },
        onDelete: () => { void controller.handleDeleteSession(session.id) },
        disabled: controller.busy,
        canDelete,
        extraMenuItems: (
          <>
            <DropdownMenuItem onSelect={() => void controller.shareActions.openForwardDialog([session.id])}>
              <Send />
              {text(language, '转发', 'Forward')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void controller.shareActions.openShareDialog(session.id, session.visibility)}>
              <Share2 />
              {text(language, '分享', 'Share')}
            </DropdownMenuItem>
          </>
        ),
      }),
    }
  })

  return (
    <ChatSessionListSidebar
      title={text(language, '会话', 'Sessions')}
      items={items}
      isMobile={isMobile}
      onSelectSession={onSelectSession}
      selectMode={selectMode}
      selectedIds={shareActions.selectedSessionIds}
      onToggleSelected={(id, checked) => shareActions.toggleSessionSelected(id, checked)}
      headerActions={selectMode ? (
        <>
          {shareActions.selectedSessionIds.size > 0 ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => void shareActions.openForwardDialog([...shareActions.selectedSessionIds])}
              className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label={text(language, '转发选中会话', 'Forward selected sessions')}
              title={text(language, '转发选中会话', 'Forward selected sessions')}
            >
              <Send size={14} />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={shareActions.toggleMultiSelectMode}
            className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label={text(language, '退出多选', 'Exit multi-select')}
            title={text(language, '退出多选', 'Exit multi-select')}
          >
            <X size={14} />
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={shareActions.toggleMultiSelectMode}
            className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label={text(language, '多选转发', 'Select multiple to forward')}
            title={text(language, '多选转发', 'Select multiple to forward')}
          >
            <ListChecks size={14} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => void controller.handleCreateSession()}
            disabled={controller.busy || !controller.selectedChatAgent?.canCreateSession}
            className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label={text(language, '新建会话', 'New session')}
            title={text(language, '新建会话', 'New session')}
          >
            <Plus size={14} />
          </Button>
        </>
      )}
      emptyState={(
        <div className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-8 text-center">
          <p className="text-xs text-zinc-500">{text(language, '还没有会话', 'No sessions yet')}</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            {controller.selectedChatAgent?.kind === 'loading'
              ? text(language, 'Agent 列表加载中，请稍候。', 'Agent list is still loading.')
              : controller.selectedChatAgent?.canCreateSession
                ? text(language, '点击右上角 + 新建。', 'Click + in the top right to create one.')
                : text(language, '这个 Agent 当前不可用。', 'This agent is unavailable.')}
          </p>
        </div>
      )}
    />
  )
}

/** DM 目标：当前私聊对象的会话列表（同一对象可开多个会话），版式与 Agent 一致。 */
function DmTargetSessions({
  dmState,
  language,
  isMobile = false,
  onSelectSession,
}: ChatSessionSidebarProps) {
  const peer = dmState.selectedDm?.peer
  const peerUserId = peer?.userId || ''
  const peerSessions = peerUserId
    ? dmState.conversationsByPeer(peerUserId).sort((a, b) => {
      const aPinnedAt = a.conversation.pinnedAt?.trim() || ''
      const bPinnedAt = b.conversation.pinnedAt?.trim() || ''
      if (aPinnedAt && !bPinnedAt) return -1
      if (!aPinnedAt && bPinnedAt) return 1
      if (aPinnedAt && bPinnedAt) return bPinnedAt.localeCompare(aPinnedAt)
      return (b.latestMessage?.createdAt || b.conversation.updatedAt || '')
        .localeCompare(a.latestMessage?.createdAt || a.conversation.updatedAt || '')
    })
    : []
  const creating = dmState.creatingSessionForPeer === peerUserId

  const items = peerSessions.map<ChatSessionListItem>((item) => {
    const isActive = item.conversation.id === dmState.selectedDmId
    const unreadCount = dmState.unreadByConversationId[item.conversation.id] ?? 0
    const isPinned = Boolean(item.conversation.pinnedAt?.trim())
    return {
      id: item.conversation.id,
      title: item.conversation.title || text(language, '私聊', 'Direct message'),
      preview: item.latestMessage?.content || text(language, '暂无消息', 'No messages yet'),
      timeLabel: formatChatListTimestamp(
        item.latestMessage?.createdAt || item.conversation.updatedAt,
        language,
      ),
      isActive,
      isPinned,
      unreadCount,
      onClick: () => {
        dmState.selectDm(item.conversation.id)
      },
      actions: buildSessionRowActions({
        language,
        isPinned,
        pinLabel: isPinned
          ? text(language, '取消置顶', 'Unpin')
          : text(language, '置顶会话', 'Pin conversation'),
        onTogglePin: () => { void dmState.toggleDmConversationPinned(item.conversation.id, !isPinned) },
        onDelete: () => { void dmState.deleteDmConversation(item.conversation.id) },
      }),
    }
  })

  return (
    <ChatSessionListSidebar
      title={peer ? `${text(language, '私聊', 'Direct')} · ${peer.name}` : text(language, '会话', 'Sessions')}
      items={items}
      isMobile={isMobile}
      onSelectSession={onSelectSession}
      headerActions={(
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => {
            if (peerUserId) {
              void dmState.createDmSession(peerUserId)
            }
          }}
          disabled={!peerUserId || creating}
          className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          aria-label={text(language, '新建会话', 'New session')}
          title={text(language, '新建会话', 'New session')}
        >
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus size={14} />}
        </Button>
      )}
      emptyState={!peer ? (
        <div className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-8 text-center">
          <p className="text-xs text-zinc-500">{text(language, '从左侧选择或发起私聊', 'Select or start a direct message on the left')}</p>
        </div>
      ) : (
        <div className="border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-8 text-center">
          <p className="text-xs text-zinc-500">{text(language, '还没有会话', 'No sessions yet')}</p>
          <p className="mt-1 text-[11px] text-zinc-600">{text(language, '点击右上角 + 新建。', 'Click + in the top right to create one.')}</p>
        </div>
      )}
    />
  )
}

/** 群聊目标：当前群聊下的会话列表，版式与 Agent 一致。 */
function GroupTargetSessions({
  groupState,
  language,
  isMobile = false,
  onSelectSession,
}: ChatSessionSidebarProps) {
  const activeGroup = groupState.groups.find((group) => group.conversation.id === groupState.selectedGroupId) ?? null

  const items = activeGroup
    ? [...groupState.sessions].sort((a, b) => {
      const aPinnedAt = a.conversation.pinnedAt?.trim() || ''
      const bPinnedAt = b.conversation.pinnedAt?.trim() || ''
      if (aPinnedAt && !bPinnedAt) return -1
      if (!aPinnedAt && bPinnedAt) return 1
      if (aPinnedAt && bPinnedAt) return bPinnedAt.localeCompare(aPinnedAt)
      return 0
    }).map<ChatSessionListItem>((session, index) => {
      const isActive = session.conversation.id === groupState.selectedSessionId
      const unreadCount = groupState.unreadCountBySessionId[session.conversation.id] ?? 0
      const mentioned = (groupState.mentionUnreadBySessionId[session.conversation.id]?.length ?? 0) > 0
      const execution = groupState.sessionExecutionById[session.conversation.id]
      const isPinned = Boolean(session.conversation.pinnedAt?.trim())
      return {
        id: session.conversation.id,
        title: session.conversation.title
          || (index === 0
            ? text(language, '主会话', 'Main Session')
            : text(language, `会话 ${index + 1}`, `Session ${index + 1}`)),
        preview: mentioned
          ? text(language, '有人 @ 你', 'Someone mentioned you')
          : execution?.label || session.latestMessage?.content || text(language, '暂无消息', 'No messages yet'),
        previewTone: execution ? 'running' : mentioned ? 'mention' : unreadCount > 0 ? 'unread' : 'default',
        isActive,
        isPinned,
        unreadCount,
        mentioned,
        running: Boolean(execution),
        runningLabel: text(language, '执行中', 'Running'),
        onClick: () => {
          groupState.setSelectedSessionId(session.conversation.id)
        },
        actions: buildSessionRowActions({
          language,
          isPinned,
          pinLabel: isPinned
            ? text(language, '取消置顶', 'Unpin')
            : text(language, '置顶会话', 'Pin session'),
          onTogglePin: () => { void groupState.handleToggleSessionPinned(session.conversation.id, !isPinned) },
          onDelete: () => { void groupState.handleDeleteSession(session.conversation.id) },
        }),
      }
    })
    : []

  return (
    <ChatSessionListSidebar
      title={text(language, '会话', 'Sessions')}
      items={items}
      isMobile={isMobile}
      onSelectSession={onSelectSession}
      headerActions={(
        <>
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-500">
            {groupState.sessions.length}
          </span>
          {activeGroup ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              onClick={() => void groupState.handleCreateSession()}
              aria-label={text(language, '新建会话', 'New session')}
              title={text(language, '新建会话', 'New session')}
            >
              <Plus className="size-3.5" />
            </Button>
          ) : null}
        </>
      )}
      emptyState={(
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-8 text-center">
          <p className="text-xs text-zinc-500">{text(language, '还没有选中群聊', 'No group selected')}</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            {text(language, '从左侧选择一个群聊。', 'Choose a group from the left.')}
          </p>
        </div>
      )}
    />
  )
}
