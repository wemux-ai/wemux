/**
 * [INPUT]: DM chat state (list, messages, composer) and the current user.
 * [OUTPUT]: The `/chat` DM panel: peer header, message feed, reactions, and composer.
 * [POS]: `/chat` DM surface; peer messages render as assistant role (left) while own messages render right.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Send, Smile, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { toggleMessageReaction } from '@shared/message-reactions'
import { ChatComposer } from '../../components/chat/chat-composer'
import { ChatComposerOverlay } from '../../components/chat/chat-composer-overlay'
import { type ChatMentionOption } from '../../components/chat/chat-mention-list'
import { ConversationFeed } from '../../components/chat/conversation-feed'
import { ChatViewport } from '../../components/chat/chat-viewport'
import { EmojiPicker } from '../../components/chat/emoji-picker'
import { buildMessageChrome as sharedBuildMessageChrome, type MessageChromeInput } from '../../components/chat/message-chrome'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { Input } from '../../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import { IdentityCardWrapper } from '../../components/profiles/identity-card-wrapper'
import { api, resolveMediaUrl } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { buildConversationMentionOptions, buildPersonMentionOptions, buildPersonMentionTargets, buildWorkspaceMentionOptions, type MentionablePerson } from '../../lib/chat-mentions'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { usePreventPullToRefresh } from '../../lib/use-prevent-pull-to-refresh'
import { cn } from '../../lib/utils'
import type { DmChatState } from './use-dm-chat-state'
import type { Language } from '../../lib/i18n'
import { text } from './chat-route-helpers'
import type { ConversationMessage, ConversationTurn } from '../../components/chat/conversation-types'
import { getAgentInitials } from './chat-route-helpers'

type DmChatPanelProps = {
  dmState: DmChatState
  language: Language
  isMobile: boolean
  onBackToList?: () => void
}

export function DmChatPanel({ dmState, language, isMobile, onBackToList }: DmChatPanelProps) {
  const { user } = useAuth()

  // 悬浮输入区高度 → 消息区底部内边距（飞书式：输入框浮在会话上方）
  const [composerAreaHeight, setComposerAreaHeight] = useState(0)
  const { selectedDm, messages, sending, replyToMessageId, setReplyToMessageId, sendMessage } = dmState
  const peer = selectedDm?.peer
  const peerName = peer?.name || text(language, '对方', 'Peer')
  const currentUserId = user?.id || ''
  const scrollRef = dmState.scrollRef as unknown as React.RefObject<HTMLDivElement | null>

  // 会话重命名（右上角铅笔按钮 → 内联输入）。
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const startRename = useCallback(() => {
    if (!selectedDm) {
      return
    }
    setRenameValue(selectedDm.conversation.title || '')
    setRenaming(true)
  }, [selectedDm])
  const handleRenameSave = useCallback(async () => {
    if (!selectedDm) {
      return
    }
    const title = renameValue.trim()
    if (!title) {
      return
    }
    const renamed = await dmState.renameConversation(selectedDm.conversation.id, title)
    if (renamed) {
      setRenaming(false)
    }
  }, [dmState, renameValue, selectedDm])
  // 切换会话时退出重命名态。
  useEffect(() => {
    setRenaming(false)
  }, [selectedDm?.conversation.id])

  // @成员 候选：私聊双方（自己 + 对方；自己与自己私聊时去重为一个人）。
  const mentionPeople = useMemo<MentionablePerson[]>(() => {
    const people: MentionablePerson[] = []
    const selfName = user?.name?.trim() || user?.username?.trim() || ''
    if (currentUserId && selfName) {
      people.push({
        id: currentUserId,
        name: selfName,
        ...(user?.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
        description: text(language, '我', 'Me'),
        keywords: [user?.username ?? ''],
      })
    }
    const peerNameForMention = peer?.name?.trim() || ''
    if (peer?.userId && peer.userId !== currentUserId && peerNameForMention) {
      people.push({
        id: peer.userId,
        name: peerNameForMention,
        ...(peer.avatarUrl?.trim() ? { avatarUrl: peer.avatarUrl.trim() } : {}),
        description: text(language, '私聊对象', 'DM peer'),
        keywords: [peer.username ?? ''],
      })
    }
    return people
  }, [currentUserId, language, peer?.avatarUrl, peer?.name, peer?.userId, peer?.username, user?.avatarUrl, user?.name, user?.username])
  const memberMentionOptions = useMemo(
    () => buildPersonMentionOptions(mentionPeople, text(language, '成员', 'Member')),
    [language, mentionPeople],
  )
  const mentionTargets = useMemo(() => buildPersonMentionTargets(mentionPeople), [mentionPeople])

  // @会话 候选：自己的私聊 + 可见会话（工作区群聊/任务会话，按作用域）。
  const [scopeConversationOptions, setScopeConversationOptions] = useState<ChatMentionOption[]>([])
  useEffect(() => {
    let cancelled = false
    void api.listScopedConversations()
      .then((response) => {
        if (cancelled) return
        setScopeConversationOptions(buildConversationMentionOptions(
          response.conversations.map((item) => ({ id: item.conversation.id, title: item.conversation.title })),
          text(language, '会话', 'Conversation'),
        ))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [language])
  const dmConversationOptions = useMemo(
    () => buildConversationMentionOptions(
      dmState.dmConversations.map((item) => ({ id: item.conversation.id, title: item.conversation.title })),
      text(language, '会话', 'Conversation'),
    ),
    [dmState.dmConversations, language],
  )

  // @工作区 候选：用户可见的协作工作区（引用型提及，不触发通知）。
  const [workspaceMentionOptions, setWorkspaceMentionOptions] = useState<ChatMentionOption[]>([])
  useEffect(() => {
    let cancelled = false
    void api.listCollaborationWorkspaces()
      .then((response) => {
        if (cancelled) return
        setWorkspaceMentionOptions(buildWorkspaceMentionOptions(
          response.workspaces,
          text(language, '工作区', 'Workspace'),
        ))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [language])

  // @文档 候选：输入 @ 后按 query 异步搜索个人 Drive（query 为空显示最近文件）
  const [mentionQuery, setMentionQuery] = useState('')
  const [driveMentionOptions, setDriveMentionOptions] = useState<ChatMentionOption[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const mine = await api.searchMyDrive(mentionQuery).catch(() => ({ results: [] }))
      if (cancelled) return
      setDriveMentionOptions(
        mine.results
          .filter((result) => result.fileType === 'file')
          .slice(0, 8)
          .map((result) => ({
            id: `doc:${result.id}`,
            kind: 'doc' as const,
            label: result.name,
            description: text(language, '文档', 'Document'),
            kindLabel: text(language, '文档', 'Document'),
            keywords: [result.name, result.contentType],
          })),
      )
    })()
    return () => { cancelled = true }
  }, [language, mentionQuery])

  // 把当前用户 id 同步给 DM 状态（乐观消息归属判定）。
  useEffect(() => {
    dmState.setCurrentUserId(currentUserId)
  }, [currentUserId, dmState])

  usePreventPullToRefresh({
    enabled: isMobile,
    scrollRef,
  })

  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, MessageChromeInput['reactions']>>({})
  const toggleDmReaction = useCallback(async (messageId: string, emoji: string, active: boolean) => {
    if (!selectedDm || !currentUserId) {
      return
    }
    const current = reactionsOverrides[messageId] ?? []
    const optimistic = toggleMessageReaction(current, emoji, currentUserId, active)
    setReactionsOverrides((prev) => ({ ...prev, [messageId]: optimistic }))
    try {
      const result = await api.toggleConversationMessageReaction(selectedDm.conversation.id, messageId, { emoji, active })
      setReactionsOverrides((prev) => ({ ...prev, [messageId]: result.reactions }))
    } catch (error) {
      setReactionsOverrides((prev) => ({
        ...prev,
        [messageId]: toggleMessageReaction(optimistic, emoji, currentUserId, !active),
      }))
      toast.error(error instanceof Error ? error.message : text(language, '表情回复失败', 'Failed to react'))
    }
  }, [currentUserId, language, messages, reactionsOverrides, selectedDm])

  const turns = useMemo<ConversationTurn[]>(() => {
    const messageById = new Map(messages.map((message) => [message.id, message] as const))
    const buildChrome = (message: MessageChromeInput) => sharedBuildMessageChrome({
      message,
      messageById,
      currentUserId,
      getSenderLabel: (target) => (target.id === currentUserId ? text(language, '你', 'You') : peerName),
      toggleReaction: toggleDmReaction,
      setReplyToMessageId,
      isOwn: message.senderId === currentUserId || message.senderId === undefined,
    })

    const turns: ConversationTurn[] = []
    for (const message of messages) {
      const isOwn = message.authorId === currentUserId || message.authorId === '__me__'
      const chrome = buildChrome({
        id: message.id,
        content: message.text,
        reactions: reactionsOverrides[message.id] ?? [],
        replyToMessageId: message.sourceId,
        senderId: message.authorId,
      })

      if (isOwn) {
        const userMessage: ConversationMessage = {
          ...message,
          ...(chrome.actions ? { actions: chrome.actions } : {}),
          afterContent: chrome.afterContent,
        }
        turns.push({
          id: `dm-turn:${message.id}`,
          user: userMessage,
          referencedDocs: userMessage.referencedDocs,
          entries: [],
          isCurrent: false,
        })
        continue
      }

      turns.push({
        id: `dm-turn:${message.id}`,
        referencedDocs: message.referencedDocs,
        entries: [{
          kind: 'assistant',
          id: `dm-message:${message.id}`,
          message: {
            ...message,
            // 对方消息强制 assistant role：渲染层按 role 决定左右气泡（自己的消息在右，对方在左）。
            role: 'assistant',
            authorType: 'user',
            authorId: message.authorId || peer?.userId,
            authorName: peerName,
            avatarUrl: peer?.avatarUrl,
            ...(chrome.actions ? { actions: chrome.actions } : {}),
            afterContent: chrome.afterContent,
          },
        }],
        isCurrent: false,
      })
    }
    return turns
  }, [currentUserId, language, messages, peer?.avatarUrl, peer?.userId, peerName, reactionsOverrides, setReplyToMessageId, toggleDmReaction])

  if (!selectedDm) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#09090b]">
        <div className="mx-auto mt-24 max-w-md border border-dashed border-zinc-800 bg-zinc-950/70 px-6 py-10 text-center">
          <p className="text-sm font-medium text-zinc-300">{text(language, '还没有选中的私聊', 'No direct message selected')}</p>
          <p className="mt-2 text-sm text-zinc-600">
            {text(language, '从左侧选择私聊，或搜索用户发起新对话。', 'Pick a conversation on the left, or search for a user to start one.')}
          </p>
        </div>
      </section>
    )
  }

  const handleSend = () => {
    if (sending || !dmState.composerValue.trim()) {
      return
    }
    void sendMessage(dmState.composerValue)
    dmState.setComposerValue('')
  }

  const isPinned = Boolean(selectedDm.conversation.pinnedAt?.trim())

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#09090b]">
      <div className={cn('shrink-0 border-b border-zinc-900 px-4 py-2.5 md:px-5', isMobile && 'px-3 py-2')}>
        <div className={cn('flex justify-between gap-3', isMobile ? 'items-start' : 'items-center')}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {onBackToList ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onBackToList}
                  className="-ml-2 h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label={text(language, '返回列表', 'Back to list')}
                  title={text(language, '返回列表', 'Back to list')}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : null}
              <IdentityCardWrapper kind="user" id={peer?.userId} name={peerName} avatarUrl={peer?.avatarUrl} triggerMode="hover">
                <Avatar className="size-7 border border-zinc-800 bg-zinc-900">
                  {peer?.avatarUrl ? <AvatarImage src={resolveMediaUrl(peer.avatarUrl)} /> : null}
                  <AvatarFallback className="rounded-full bg-zinc-800 text-[10px] text-zinc-200">
                    {getAgentInitials(peerName)}
                  </AvatarFallback>
                </Avatar>
              </IdentityCardWrapper>
              <p className="truncate text-sm font-semibold text-zinc-100">{peerName}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {sending ? <Loader2 className="size-3 animate-spin text-zinc-500" /> : null}
            {renaming ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleRenameSave()
                    } else if (event.key === 'Escape') {
                      setRenaming(false)
                    }
                  }}
                  maxLength={120}
                  placeholder={text(language, '会话名称', 'Session name')}
                  className="h-7 w-40 rounded-md border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-700 focus-visible:ring-0"
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void handleRenameSave()}
                  disabled={!renameValue.trim()}
                  className="h-7 w-7 shrink-0 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                  aria-label={text(language, '保存', 'Save')}
                  title={text(language, '保存', 'Save')}
                >
                  <Check size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setRenaming(false)}
                  className="h-7 w-7 shrink-0 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label={text(language, '取消', 'Cancel')}
                  title={text(language, '取消', 'Cancel')}
                >
                  <X size={14} />
                </Button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                    aria-label={text(language, '当前会话操作', 'Current session actions')}
                    title={text(language, '当前会话操作', 'Current session actions')}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => void dmState.toggleDmConversationPinned(selectedDm.conversation.id, !isPinned)}>
                    {isPinned ? <PinOff /> : <Pin />}
                    {isPinned
                      ? text(language, '取消置顶', 'Unpin')
                      : text(language, '置顶会话', 'Pin conversation')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={startRename}>
                    <Pencil />
                    {text(language, '重命名会话', 'Rename session')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void dmState.deleteDmConversation(selectedDm.conversation.id)}
                    className="text-rose-300 focus:text-rose-200"
                  >
                    <Trash2 />
                    {text(language, '删除会话', 'Delete conversation')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      <ChatViewport
        absolute
        scrollRef={scrollRef}
        paddingBottom={composerAreaHeight + 16}
        rootClassName="bg-[#09090b]"
        scrollClassName="scrollbar-subtle overflow-y-auto overscroll-y-contain touch-pan-y bg-[#09090b] md:px-4"
      >
        <div className="flex w-full flex-col gap-3">
          {dmState.loading ? (
            <div className="mx-auto mt-16 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-400">
              <Loader2 className="size-3 animate-spin" />
              {text(language, '正在加载消息...', 'Loading messages...')}
            </div>
          ) : turns.length > 0 ? (
            <ConversationFeed
              turns={turns}
              isBusy={false}
              assistantLabel={peerName}
              assistantAvatarUrl={peer?.avatarUrl}
              assistantAvatarFallback={getAgentInitials(peerName)}
              userAvatarUrl={user?.avatarUrl?.trim() || undefined}
              userAvatarFallback={getAgentInitials(user?.name || text(language, '你', 'You'))}
              userLabel={text(language, '你', 'You')}
              mobileHeaderLayout={isMobile}
              mentionTargets={mentionTargets}
            />
          ) : (
            <ConversationFeed
              turns={[]}
              isBusy={false}
              assistantLabel={peerName}
              assistantAvatarUrl={peer?.avatarUrl}
              assistantAvatarFallback={getAgentInitials(peerName)}
              userAvatarUrl={user?.avatarUrl?.trim() || undefined}
              userAvatarFallback={getAgentInitials(user?.name || text(language, '你', 'You'))}
              userLabel={text(language, '你', 'You')}
              mobileHeaderLayout={isMobile}
              mentionTargets={mentionTargets}
              emptyTitle={text(language, '暂无消息', 'No messages yet')}
              emptyDescription={text(language, '发一条消息，开始这次私聊。', 'Send a message to start this conversation.')}
            />
          )}
        </div>
      </ChatViewport>

      <ChatComposerOverlay onHeightChange={setComposerAreaHeight}>
        <ChatComposer
            maxHeight={isMobile ? 140 : 180}
            minHeight={isMobile ? 46 : 56}
            disabled={false}
            placeholder={text(language, '输入消息...', 'Type a message...')}
            rows={1}
            value={dmState.composerValue}
            onChange={(event) => dmState.setComposerValue(event.target.value)}
            onSelectMention={(nextValue) => dmState.setComposerValue(nextValue)}
            onMentionQueryChange={setMentionQuery}
            mentionOptions={[...memberMentionOptions, ...dmConversationOptions, ...scopeConversationOptions, ...workspaceMentionOptions, ...driveMentionOptions]}
            mentionTitle={text(language, '提及', 'Mentions')}
            mentionHintText={text(language, '输入 @ 选择成员、会话、工作区或文档', 'Type @ to mention a member, session, workspace, or document.')}
            mentionEmptyText={text(language, '没有匹配的成员、会话或文档。', 'No matching members, sessions, or documents.')}
            onKeyDown={(event) => {
              if (isImeComposingKeyboardEvent(event)) {
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            className="px-3 py-3 pr-1 text-sm leading-6"
            shellClassName="pointer-events-auto rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.45)] transition-colors focus-within:border-zinc-700"
            inputShellClassName="relative flex-1 min-w-0"
            overlayPlacement="side"
            sideInputClassName="flex items-end pb-1"
            topContent={replyToMessageId ? (
              <div className="mb-1.5 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-400">
                <span className="min-w-0 flex-1 truncate">
                  {text(language, '正在回复', 'Replying to')}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyToMessageId('')}
                  className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label={text(language, '取消回复', 'Cancel reply')}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            overlay={(
              <div className="flex shrink-0 items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                      aria-label={text(language, '插入 emoji', 'Insert emoji')}
                      title={text(language, '插入 emoji', 'Insert emoji')}
                    >
                      <Smile size={16} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="end">
                    <EmojiPicker
                      onSelect={(emoji) => {
                        dmState.setComposerValue((current: string) => {
                          const trimmed = current.trimEnd()
                          return trimmed ? `${trimmed} ${emoji} ` : `${emoji} `
                        })
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !dmState.composerValue.trim()}
                  size="icon"
                  className="h-8 w-8 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200"
                  aria-label={text(language, '发送', 'Send')}
                  title={text(language, '发送', 'Send')}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={14} />}
                </Button>
              </div>
            )}
        />
      </ChatComposerOverlay>
    </section>
  )
}
