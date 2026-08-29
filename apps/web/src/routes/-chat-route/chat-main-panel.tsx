import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Bot, CornerDownLeft, Globe, ImagePlus, Loader2, Lock, MoreHorizontal, Pin, PinOff, Send, Share2, Smile, Square, Trash2, X } from 'lucide-react'
import { toggleMessageReaction } from '@shared/message-reactions'
import { ChatComposer } from '../../components/chat/chat-composer'
import { ChatComposerOverlay } from '../../components/chat/chat-composer-overlay'
import { ChatTranscript } from '../../components/chat/chat-transcript'
import { ChatViewport } from '../../components/chat/chat-viewport'
import { EmojiPicker } from '../../components/chat/emoji-picker'
import { type ChatMentionOption } from '../../components/chat/chat-mention-list'
import { buildMessageChrome as sharedBuildMessageChrome, type MessageChromeInput } from '../../components/chat/message-chrome'
import { TaskProposalCard } from '../../components/kanban/task-proposal-card'
import { AgentChatQueue } from '../../components/workspaces/workspace-session-chat/workspace-session-chat-ui'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { api, resolveMediaUrl } from '../../lib/api'
import { toast } from 'sonner'
import { useAuth } from '../../lib/auth-context'
import { buildConversationMentionOptions, buildPersonMentionOptions, buildPersonMentionTargets, buildWorkspaceMentionOptions, type MentionablePerson } from '../../lib/chat-mentions'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { usePreventPullToRefresh } from '../../lib/use-prevent-pull-to-refresh'
import { cn } from '../../lib/utils'
import { getAgentInitials, text } from './chat-route-helpers'
import type { ChatRouteController } from './use-chat-route-controller'
import type { Language } from '../../lib/i18n'

type ChatMainPanelProps = {
  controller: ChatRouteController
  isMobile: boolean
  language: Language
  onBackToList?: () => void
}

export function ChatMainPanel({
  controller,
  isMobile,
  language,
  onBackToList,
}: ChatMainPanelProps) {
  const { user } = useAuth()
  const clearTaskProposalRef = useRef(controller.clearTaskProposal)

  // 悬浮输入区高度 → 消息区底部内边距（飞书式：输入框浮在会话上方）
  const [composerAreaHeight, setComposerAreaHeight] = useState(0)

  // @成员/Agent 候选：自己 + 当前会话 Agent（正文高亮只认真实用户，Agent 与群聊一致不参与）。
  const mentionPeople = useMemo<MentionablePerson[]>(() => {
    const people: MentionablePerson[] = []
    const selfName = user?.name?.trim() || user?.username?.trim() || ''
    if (user?.id && selfName) {
      people.push({
        id: user.id,
        name: selfName,
        ...(user.avatarUrl?.trim() ? { avatarUrl: user.avatarUrl.trim() } : {}),
        description: text(language, '我', 'Me'),
        keywords: [user.username ?? ''],
      })
    }
    const agent = controller.selectedChatAgent
    if (agent?.id && agent.name.trim()) {
      people.push({
        id: agent.id,
        name: agent.name.trim(),
        ...(agent.avatarUrl.trim() ? { avatarUrl: agent.avatarUrl.trim() } : {}),
        description: agent.role,
        kind: 'agent',
        keywords: [agent.role, agent.status],
      })
    }
    return people
  }, [controller.selectedChatAgent, language, user?.avatarUrl, user?.id, user?.name, user?.username])
  const memberMentionOptions = useMemo(
    () => buildPersonMentionOptions(mentionPeople, text(language, '成员', 'Members')),
    [language, mentionPeople],
  )
  const mentionTargets = useMemo(() => buildPersonMentionTargets(mentionPeople), [mentionPeople])

  // @会话 候选：自己的主聊天会话 + 可见会话（工作区群聊/任务会话，按作用域）。
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
  const mainChatConversationOptions = useMemo(
    () => buildConversationMentionOptions(
      controller.mainChatSessions.map((session) => ({ id: session.id, title: session.title })),
      text(language, '会话', 'Conversation'),
    ),
    [controller.mainChatSessions, language],
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

  clearTaskProposalRef.current = controller.clearTaskProposal

  usePreventPullToRefresh({
    enabled: isMobile,
    scrollRef: controller.scrollRef,
  })

  const handleTranscriptScroll = () => {
    controller.updateStickiness()
    const node = controller.scrollRef.current
    if (!node || controller.loadingOlderTranscriptTurns || controller.loadingOlderMessages) {
      return
    }

    // 本地揭示未耗尽 → 逐步揭示；已耗尽且服务端还有更早 → 翻页拉取。
    if (node.scrollTop <= 120 && (controller.hasHiddenTranscriptTurns || controller.hasMoreBefore)) {
      controller.loadOlderTranscriptTurns()
    }
  }

  const assistantLabel = controller.selectedChatAgent?.name
    || controller.activeCustomAgent?.name
    || controller.primaryAgentSummary?.name
    || text(language, 'Agent', 'Agent')
  const assistantAvatarUrl = controller.selectedChatAgent?.avatarUrl || ''
  const assistantAvatarFallback = getAgentInitials(assistantLabel)
  const userAvatarUrl = user?.avatarUrl?.trim() || undefined
  const userAvatarFallback = getAgentInitials(user?.name || text(language, '你', 'You'))
  const uploadDisabled = controller.busy || controller.isUploading
  const activeSessionPinned = Boolean(controller.activeSession?.pinnedAt?.trim())
  /** R8.1 主聊天回复态：被回复消息的发送者标签。 */
  const mainChatReplyTargetLabel = useMemo(() => {
    if (!controller.replyToMessageId) {
      return ''
    }
    const target = controller.messages.find((message) => message.id === controller.replyToMessageId)
    if (!target) {
      return ''
    }
    return target.role === 'user'
      ? text(language, '你', 'You')
      : target.authorName || assistantLabel
  }, [assistantLabel, controller.messages, controller.replyToMessageId, language])
  const canDeleteActiveSession = controller.mainChatSessions.length > 1
  const assistantAvatarByAgentId = useMemo(() => {
    const pairs = controller.chatAgents.map((agent) => [agent.id, agent.avatarUrl?.trim() || ''] as const)
    return new Map(pairs)
  }, [controller.chatAgents])
  const assistantAvatarByName = useMemo(() => {
    return new Map(
      controller.chatAgents.flatMap((agent) => {
        const normalizedName = agent.name.trim().toLowerCase()
        if (!normalizedName) {
          return []
        }

        return [[normalizedName, agent.avatarUrl?.trim() || ''] as const]
      }),
    )
  }, [controller.chatAgents])
  const messageById = useMemo(() => {
    return new Map(controller.messages.map((message) => [message.id, message] as const))
  }, [controller.messages])

  // R8.1 主聊天消息表情/点赞：乐观更新 + 通用会话 reaction 端点 + 失败回滚。
  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, MessageChromeInput['reactions']>>({})
  const toggleMainChatReaction = useCallback(async (messageId: string, emoji: string, active: boolean) => {
    const conversationId = controller.activeSession?.id
    const currentUserId = user?.id
    if (!conversationId || !currentUserId) {
      return
    }
    const base = messageById.get(messageId)?.reactions
    const current = reactionsOverrides[messageId] ?? base ?? []
    const optimistic = toggleMessageReaction(current, emoji, currentUserId, active)
    setReactionsOverrides((prev) => ({ ...prev, [messageId]: optimistic }))
    try {
      const result = await api.toggleConversationMessageReaction(conversationId, messageId, { emoji, active })
      setReactionsOverrides((prev) => ({ ...prev, [messageId]: result.reactions }))
    } catch (error) {
      setReactionsOverrides((prev) => ({
        ...prev,
        [messageId]: toggleMessageReaction(optimistic, emoji, currentUserId, !active),
      }))
      toast.error(error instanceof Error ? error.message : text(language, '表情回复失败', 'Failed to react'))
    }
  }, [controller.activeSession?.id, messageById, reactionsOverrides, user?.id, language])

  const resolveHistoricalAssistantAvatar = useCallback((messageId?: string, sourceId?: string, fallbackAuthorName?: string) => {
    const sourceMessage = messageById.get(sourceId || messageId || '')
    const authorId = sourceMessage?.authorId?.trim()
    if (authorId && assistantAvatarByAgentId.has(authorId)) {
      return {
        avatarUrl: assistantAvatarByAgentId.get(authorId) || '',
        authorName: sourceMessage?.authorName,
        hasHistoricalAuthor: true,
      }
    }

    const authorName = sourceMessage?.authorName || fallbackAuthorName || ''
    const normalizedAuthorName = authorName.trim().toLowerCase()
    if (normalizedAuthorName && assistantAvatarByName.has(normalizedAuthorName)) {
      return {
        avatarUrl: assistantAvatarByName.get(normalizedAuthorName) || '',
        authorName: sourceMessage?.authorName || fallbackAuthorName,
        hasHistoricalAuthor: true,
      }
    }

    return {
      avatarUrl: undefined,
      authorName: sourceMessage?.authorName || fallbackAuthorName,
      hasHistoricalAuthor: Boolean(authorId || normalizedAuthorName),
    }
  }, [assistantAvatarByAgentId, assistantAvatarByName, messageById])

  const transcriptTurns = useMemo(() => {
    // R8.1：消息交互 chrome（操作条/表情/回复）——与群聊共用 message-chrome，保证一致。
    const chromeById = new Map<string, MessageChromeInput>()
    for (const message of controller.messages) {
      chromeById.set(message.id, {
        id: message.id,
        content: message.content,
        reactions: reactionsOverrides[message.id] ?? message.reactions,
        replyToMessageId: message.replyToMessageId,
        senderId: message.authorId,
      })
    }
    const currentUserIdForChrome = user?.id ?? ''
    const buildChrome = (message: MessageChromeInput & { isOwn?: boolean }) => sharedBuildMessageChrome({
      message,
      messageById: chromeById,
      currentUserId: currentUserIdForChrome,
      getSenderLabel: (target) => (target.id === turnUserRef.current ? text(language, '你', 'You') : assistantLabel),
      toggleReaction: toggleMainChatReaction,
      setReplyToMessageId: (messageId) => controller.setReplyToMessageId(messageId),
      isOwn: message.isOwn ?? false,
    })
    const turnUserRef: { current: string | undefined } = { current: undefined }

    return controller.visibleTranscriptTurns.map((turn) => {
      turnUserRef.current = turn.user?.id
      let lastAssistantEntryIndex = -1
      for (let index = turn.entries.length - 1; index >= 0; index -= 1) {
        if (turn.entries[index]?.kind === 'assistant') {
          lastAssistantEntryIndex = index
          break
        }
      }

      const chromeUser = turn.user ? buildChrome({
        id: turn.user.id,
        content: turn.user.text,
        reactions: chromeById.get(turn.user.id)?.reactions,
        replyToMessageId: chromeById.get(turn.user.id)?.replyToMessageId,
        isOwn: true,
      }) : null

      return {
        ...turn,
        user: turn.user ? { ...turn.user, authorId: user?.id, ...(chromeUser ?? {}) } : turn.user,
        entries: turn.entries.map((entry, index) => {
          if (entry.kind !== 'assistant') {
            return entry
          }

          const isLastAssistantEntry = lastAssistantEntryIndex === index
          const sourceMessageId = entry.message.sourceId ?? entry.message.id
          const sourceMessage = messageById.get(sourceMessageId)
          const historicalAssistant = resolveHistoricalAssistantAvatar(entry.message.id, sourceMessageId, entry.message.authorName)
          const chrome = buildChrome({
            id: entry.message.id,
            content: entry.message.text,
            reactions: chromeById.get(sourceMessageId)?.reactions,
            replyToMessageId: chromeById.get(sourceMessageId)?.replyToMessageId,
            senderId: sourceMessage?.authorId,
          })
          const proposalAfterContent = isLastAssistantEntry ? (() => {
            if (!sourceMessage?.taskProposal || sourceMessage.streaming) {
              return null
            }

            return (
              <TaskProposalCard
                proposal={sourceMessage.taskProposal}
                projectName={controller.state.projects.find((project) => project.id === sourceMessage.taskProposal?.projectId)?.name}
                loading={false}
                onConfirm={() => clearTaskProposalRef.current(sourceMessage.id)}
                onCancel={() => clearTaskProposalRef.current(sourceMessage.id)}
              />
            )
          })() : null

          return {
            ...entry,
            message: {
              ...entry.message,
              authorType: sourceMessage?.authorType ?? entry.message.authorType,
              authorId: sourceMessage?.authorId ?? entry.message.authorId,
              authorName: historicalAssistant.authorName || entry.message.authorName,
              streaming: sourceMessage?.streaming ?? entry.message.streaming,
              agentRunningStatus: sourceMessage?.agentRunningStatus ?? entry.message.agentRunningStatus,
              currentStep: sourceMessage?.currentStep ?? entry.message.currentStep,
              finishReason: sourceMessage?.finishReason ?? entry.message.finishReason,
              ...(historicalAssistant.hasHistoricalAuthor
                ? { avatarUrl: historicalAssistant.avatarUrl ?? '' }
                : {}),
              ...(chrome.actions ? { actions: chrome.actions } : {}),
              afterContent: (
                <div className="flex flex-col gap-1.5">
                  {chrome.afterContent}
                  {proposalAfterContent}
                </div>
              ),
            },
          }
        }),
      }
    })
  }, [
    assistantLabel,
    controller.state.projects,
    controller.visibleTranscriptTurns,
    controller.messages,
    language,
    messageById,
    reactionsOverrides,
    resolveHistoricalAssistantAvatar,
    toggleMainChatReaction,
    user?.id,
  ])
  const showSessionLoadingState = controller.appLoading || (
    !controller.activeSession
    && (
      controller.isResolvingSessionSelection
      || Boolean(controller.pendingSessionSelectionId)
      || controller.selectedAgentSessions.length > 0
    )
  )
  const showSessionOpeningIndicator = controller.isResolvingSessionSelection
    || controller.pendingSessionSelectionId === controller.activeSession?.id
  const showSessionHistoryLoading = Boolean(controller.pendingSessionSelectionId)
  const emptyStateClassName = cn(
    'mx-auto max-w-md border border-dashed border-zinc-800 bg-zinc-950/70 text-center',
    isMobile ? 'mt-6 px-5 py-8' : 'mt-16 px-6 py-10',
  )

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#09090b]">
      <div className={cn('shrink-0 border-b border-zinc-900 px-4 py-2.5 md:px-5', isMobile && 'px-3 py-2')}>
        <div className={cn('flex justify-between gap-3', isMobile ? 'items-start' : 'items-center')}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
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
              <span className="truncate text-sm font-semibold text-zinc-100">
                {assistantLabel}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {controller.isStreaming ? <Loader2 className="size-3 animate-spin text-zinc-500" /> : null}
            {controller.activeSession ? (
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
                  <DropdownMenuItem
                    onSelect={() => void controller.handleToggleSessionPinned(controller.activeSession!.id, !activeSessionPinned)}
                  >
                    {activeSessionPinned ? <PinOff /> : <Pin />}
                    {activeSessionPinned
                      ? text(language, '取消置顶', 'Unpin')
                      : text(language, '置顶会话', 'Pin session')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void controller.shareActions.openForwardDialog([controller.activeSession!.id])}>
                    <Send />
                    {text(language, '转发', 'Forward')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void controller.shareActions.openShareDialog(controller.activeSession!.id, controller.activeSession!.visibility)}
                  >
                    <Share2 />
                    {text(language, '分享', 'Share')}
                  </DropdownMenuItem>
                  {controller.activeSession?.ownerUserId === user?.id && controller.activeSession.ownerUserId ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        const next = controller.activeSession!.visibility === 'private' ? 'public' : 'private'
                        void controller.handleToggleSessionVisibility(controller.activeSession!.id, next)
                      }}
                    >
                      {controller.activeSession.visibility === 'private' ? <Globe /> : <Lock />}
                      {controller.activeSession.visibility === 'private'
                        ? text(language, '设为公开', 'Make public')
                        : text(language, '取消公开', 'Make private')}
                    </DropdownMenuItem>
                  ) : null}
                  {canDeleteActiveSession ? (
                    <DropdownMenuItem
                      onSelect={() => void controller.handleDeleteSession(controller.activeSession!.id)}
                      className="text-rose-300 focus:text-rose-200"
                    >
                      <Trash2 />
                      {text(language, '删除会话', 'Delete session')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>

      <ChatViewport
        absolute
        scrollRef={controller.scrollRef}
        onScroll={handleTranscriptScroll}
        paddingBottom={composerAreaHeight + 16}
        rootClassName="bg-[#09090b]"
        scrollClassName={cn(
          'scrollbar-subtle overflow-y-auto overscroll-y-contain touch-pan-y bg-[#09090b] md:px-4',
          isMobile ? 'px-2.5 py-2.5' : 'px-3 py-3',
        )}
        jumpButton={controller.scrollShortcutTarget ? (
          <Button
            size="icon"
            variant="secondary"
            style={{ bottom: composerAreaHeight + 24 }}
            className="absolute right-4 z-10 size-8 rounded-full border border-zinc-800/80 bg-zinc-900/90 text-zinc-400 shadow-lg shadow-black/30 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => {
              if (controller.scrollShortcutTarget === 'top') {
                controller.scrollToTop()
                return
              }

              controller.scrollToBottom()
            }}
            aria-label={controller.scrollShortcutTarget === 'top'
              ? text(language, '回到顶部', 'Back to top')
              : text(language, '回到底部', 'Back to bottom')}
            title={controller.scrollShortcutTarget === 'top'
              ? text(language, '回到顶部', 'Back to top')
              : text(language, '回到底部', 'Back to bottom')}
          >
            {controller.scrollShortcutTarget === 'top' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </Button>
        ) : null}
      >
          <div className="flex w-full flex-col gap-3">
            {!controller.activeSession ? (
              showSessionLoadingState ? (
                <div className={emptyStateClassName}>
                  <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-zinc-900 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-zinc-300">
                    {text(language, '正在加载会话记录...', 'Loading conversation history...')}
                  </p>
                  <p className="mt-2 text-sm text-zinc-600">
                    {text(
                      language,
                      '网络较慢时会先显示这个状态，消息同步完成后会自动出现。',
                      'This appears while the session is syncing on a slow network. Messages will show up automatically.',
                    )}
                  </p>
                </div>
              ) : (
                <div className={emptyStateClassName}>
                  <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-zinc-900 text-zinc-500">
                    <Bot size={20} />
                  </div>
                  <p className="mt-4 text-sm font-medium text-zinc-300">
                    {assistantLabel}{' '}
                    {text(language, '还没有选中会话', 'has no selected session')}
                  </p>
                  <p className="mt-2 text-sm text-zinc-600">
                    {controller.selectedChatAgent?.kind === 'loading'
                      ? text(
                        language,
                        '正在同步这个 Agent 的配置，稍后就会显示出来。',
                        'This agent configuration is still syncing and will appear shortly.',
                      )
                      : controller.selectedChatAgent?.canCreateSession
                        ? text(
                          language,
                          '从左侧新建会话后即可开始与这个 Agent 对话。',
                          'Create a session on the left to start chatting with this Agent.',
                        )
                        : text(language, '这个 Agent 已不可用，只能查看已有会话。', 'This agent is unavailable, so only existing sessions can be viewed.')}
                  </p>
                </div>
              )
            ) : (
              <>
                {showSessionOpeningIndicator && !showSessionHistoryLoading ? (
                  <div className="flex justify-center">
                    <div className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-[11px] text-zinc-400">
                      <Loader2 className="size-3 animate-spin" />
                      {text(language, '正在加载会话记录...', 'Loading conversation history...')}
                    </div>
                  </div>
                ) : null}
                {showSessionHistoryLoading ? (
                  <div className={emptyStateClassName}>
                    <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-zinc-900 text-zinc-500">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-zinc-300">
                      {text(language, '正在加载会话记录...', 'Loading conversation history...')}
                    </p>
                    <p className="mt-2 text-sm text-zinc-600">
                      {text(
                        language,
                        '消息同步完成后会自动出现。',
                        'Messages will appear after the session finishes syncing.',
                      )}
                    </p>
                  </div>
                ) : (
                  <>
                    {(controller.hasHiddenTranscriptTurns || controller.hasMoreBefore) ? (
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => controller.loadOlderTranscriptTurns()}
                          disabled={controller.loadingOlderTranscriptTurns || controller.loadingOlderMessages}
                          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {controller.loadingOlderTranscriptTurns || controller.loadingOlderMessages
                            ? text(language, '加载中...', 'Loading...')
                            : text(language, `加载更早消息 (${controller.hiddenTranscriptTurnsCount})`, `Load earlier messages (${controller.hiddenTranscriptTurnsCount})`)}
                        </button>
                      </div>
                    ) : null}

                    <ChatTranscript
                      assistantLabel={assistantLabel}
                      assistantAvatarUrl={assistantAvatarUrl}
                      assistantAvatarFallback={assistantAvatarFallback}
                      userAvatarUrl={userAvatarUrl}
                      userAvatarFallback={userAvatarFallback}
                      userLabel={text(language, '你', 'You')}
                      turns={transcriptTurns}
                      isBusy={controller.isStreaming}
                      fallbackStep={controller.streamStatus}
                      emptyTitle={text(language, '暂无消息', 'No messages yet')}
                      emptyDescription={text(language, '发一条消息，开始这次会话。', 'Send a message to start this session.')}
                      mobileHeaderLayout={isMobile}
                      hideProcessBehindLog
                      mentionTargets={mentionTargets}
                    />
                  </>
                )}
              </>
            )}
          </div>
      </ChatViewport>

      <ChatComposerOverlay onHeightChange={setComposerAreaHeight}>
        <div className={cn(controller.messageQueue.length > 0 && 'mb-2.5')}>
            <AgentChatQueue
              queue={controller.messageQueue}
              onEdit={controller.editQueuedMessage}
              onMoveToInput={controller.moveQueuedMessageToInput}
              onRemove={controller.removeQueuedMessage}
            />
          </div>
          <ChatComposer
            maxHeight={isMobile ? 140 : 180}
            minHeight={isMobile ? 46 : 56}
            disabled={controller.busy || !controller.activeSession}
            placeholder={controller.activeSession
              ? text(language, '输入消息...', 'Type a message...')
              : text(language, '请先选择或创建会话...', 'Select or create a session first...')}
            rows={1}
            value={controller.chatInput}
            onChange={(event) => controller.setChatInput(event.target.value)}
            onSelectMention={(nextValue) => controller.setChatInput(nextValue)}
            onMentionQueryChange={setMentionQuery}
            mentionOptions={[...memberMentionOptions, ...mainChatConversationOptions, ...scopeConversationOptions, ...workspaceMentionOptions, ...driveMentionOptions]}
            mentionTitle={text(language, '提及', 'Mentions')}
            mentionHintText={text(language, '输入 @ 选择成员、Agent、会话、工作区或文档', 'Type @ to mention a member, agent, session, workspace, or document.')}
            mentionEmptyText={text(language, '没有匹配的成员、会话或文档。', 'No matching members, sessions, or documents.')}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file))
              if (files.length === 0) {
                return
              }

              event.preventDefault()
              void controller.handleImageUpload(files)
            }}
            onKeyDown={(event) => {
              if (isImeComposingKeyboardEvent(event)) {
                return
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void controller.handleSend()
              }
            }}
            className={cn(
              'px-3 py-3 pr-1 text-sm leading-6',
              isMobile && 'min-h-0 px-3 py-2.5',
            )}
            shellClassName={cn(
              'pointer-events-auto rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.45)] transition-colors focus-within:border-zinc-700',
              isMobile && 'px-1.5 py-1.5',
            )}
            inputShellClassName="relative flex-1 min-w-0"
            overlayPlacement="side"
            sideInputClassName="flex items-end pb-1"
            topContent={controller.replyToMessageId ? (
              <div className="mb-1.5 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-400">
                <CornerDownLeft className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {text(language, '正在回复', 'Replying to')}
                  {mainChatReplyTargetLabel ? `：${mainChatReplyTargetLabel}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => controller.setReplyToMessageId('')}
                  className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label={text(language, '取消回复', 'Cancel reply')}
                >
                  <X size={12} />
                </button>
              </div>
            ) : controller.images.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {controller.images.map((image) => (
                  <div key={image.id} className="group relative">
                    <img
                      src={resolveMediaUrl(image.url)}
                      alt={image.filename}
                      className="h-12 w-12 rounded-md border border-zinc-800 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => controller.handleRemoveImage(image.id)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-800 text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      aria-label={text(language, '移除图片', 'Remove image')}
                      title={text(language, '移除图片', 'Remove image')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
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
                        controller.setChatInput((current: string) => {
                          const trimmed = current.trimEnd()
                          return trimmed ? `${trimmed} ${emoji} ` : `${emoji} `
                        })
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <label
                  className={cn(
                    'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200',
                    uploadDisabled && 'pointer-events-none cursor-not-allowed opacity-40',
                  )}
                  aria-label={text(language, '上传图片', 'Upload image')}
                  title={text(language, '上传图片', 'Upload image')}
                >
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const files = event.target.files ? Array.from(event.target.files) : []
                      if (files.length > 0) {
                        void controller.handleImageUpload(files)
                      }
                      event.target.value = ''
                    }}
                    disabled={uploadDisabled}
                  />
                  {controller.isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </label>
                <Button
                  type="button"
                  onClick={() => {
                    if (controller.isStreaming) {
                      controller.handleStopStreaming()
                      return
                    }
                    void controller.handleSend()
                  }}
                  disabled={controller.sendDisabled}
                  size="icon"
                  className={cn(
                    'h-8 w-8 rounded-md transition-colors',
                    controller.isStreaming
                      ? 'border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      : 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200',
                  )}
                  aria-label={controller.isStreaming ? text(language, '停止', 'Stop') : text(language, '发送', 'Send')}
                  title={controller.isStreaming ? text(language, '停止', 'Stop') : text(language, '发送', 'Send')}
                >
                  {controller.isStreaming
                    ? <Square size={14} />
                    : controller.busy
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send size={14} />}
                </Button>
              </div>
            )}
            footer={controller.composerLockedReason ? (
              <div className={cn('px-1', isMobile ? 'mt-1.5' : 'mt-2')}>
                <span className="min-w-0 truncate text-[11px] text-zinc-600">
                  {controller.composerLockedReason}
                </span>
              </div>
            ) : null}
          />
      </ChatComposerOverlay>
    </section>
  )
}
