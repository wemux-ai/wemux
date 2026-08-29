import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { ChevronRight, ChevronUp, CornerDownLeft, Download, FileText, FolderOpen, ImagePlus, Loader2, MessageSquareText, Plus, RefreshCw, Search, Send, Smile, Square, Trash2, X } from 'lucide-react'
import { toggleMessageReaction } from '@shared/message-reactions'
import { sortMainChatSessions, isMainChatSessionVisibleInWorkspace } from '@shared/main-chat-session'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { isExecutorEffectivelyOnline } from '../../lib/managed-cloud-executor'
import { toast } from 'sonner'
import type { ChatMessage, MainChatSession, ToolCall } from '@shared/types'
import type { AgentRecord, AgentWorkdirFileEntry, AgentWorkdirSummary } from '../../lib/api'
import { api, resolveMediaUrl } from '../../lib/api'
import { normalizeBuiltInAgentAvatarUrl } from '../../lib/agent-avatar'
import { useAuth } from '../../lib/auth-context'
import { useApp } from '../../lib/app-provider'
import { COLLABORATION_WORKSPACE_CHANGE_EVENT, getStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import { useTranslation } from '../../lib/i18n/react'
import { insertSkillMentionToken } from '../../lib/skill-mentions'
import { useSmoothAutoScroll } from '../../lib/use-smooth-auto-scroll'
import { useAvailableSkills } from '../../lib/use-available-skills'
import { useThread } from '../../lib/thread/use-thread'
import { cn } from '../../lib/utils'
import { ChatComposer } from '../chat/chat-composer'
import { ChatComposerOverlay } from '../chat/chat-composer-overlay'
import { ChatTranscript } from '../chat/chat-transcript'
import type { ChatMentionOption } from '../chat/chat-mention-list'
import { EmojiPicker } from '../chat/emoji-picker'
import { buildMessageChrome as sharedBuildMessageChrome, type MessageChromeInput } from '../chat/message-chrome'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { buildMainChatTranscriptTurns, chatMessagesToChatBubbleMessages } from '../chat/main-chat-transcript-turns'
import { isAgentWorkingStatus } from '../../lib/agent-live-status'
import { useRealtimeMainChat } from '../../lib/realtime/useRealtime'
import { applyStateSelection } from '../../routes/-chat-route/chat-route-helpers'
import type { ChatBubbleMessage } from '../../routes/-chat-route/chat-route-types'
import { SkillMentionPicker } from '../chat/skill-mention-picker'
import {
  groupAgentSessions,
  type AgentSessionListItem,
  type AgentSessionSourceFilter,
  type AgentSessionSourceKind,
} from './agent-session-grouping'
import { getAgentInitials } from './custom-agent-detail-panel-shared'
import { Button } from '../ui/button'
import { ExecutorSelect } from '../ui/executor-select'

type ChatMessageItem = ChatMessage
type ChatImage = NonNullable<ChatMessage['attachments']>[number]

/**
 * 把 useThread 的乐观队列（发送中的 user 消息，id 为 `pending:<clientMessageId>`）
 * 合成进 `ChatBubbleMessage[]`：追加乐观 user 气泡，streaming 时再追加一条空
 * assistant 工作气泡（id 派生自最后一条乐观消息）。合成后的数组直接喂给
 * `buildMainChatTranscriptTurns`，后者不感知发送过程。
 */
export const appendPendingChatBubbleMessages = (
  messages: ChatBubbleMessage[],
  optimisticMessages: ChatMessageItem[],
  isStreaming: boolean,
): ChatBubbleMessage[] => {
  if (optimisticMessages.length === 0) {
    return messages
  }

  const appended = [
    ...messages,
    ...optimisticMessages.map((message, index) => ({
      ...message,
      streaming: false,
      timelineOrder: messages.length + index + 1,
    })),
  ]

  if (!isStreaming) {
    return appended
  }

  const lastOptimisticId = optimisticMessages[optimisticMessages.length - 1]?.id ?? 'pending-user'
  return [
    ...appended,
    {
      id: `${lastOptimisticId}:assistant`,
      role: 'assistant' as const,
      content: '',
      createdAt: new Date().toISOString(),
      timelineOrder: appended.length + 1,
      streaming: true,
    },
  ]
}

export function CustomAgentChatPanel({
  agent,
  blockedReason = '',
  workdirSummary,
  workdirFiles,
  workdirLoading,
  workdirRefreshing,
  onRefreshWorkdir,
  onDownloadWorkdirFile,
}: {
  agent: AgentRecord | null
  blockedReason?: string
  workdirSummary: AgentWorkdirSummary | null
  workdirFiles: AgentWorkdirFileEntry[]
  workdirLoading: boolean
  workdirRefreshing: boolean
  onRefreshWorkdir: () => Promise<void>
  onDownloadWorkdirFile: (relativePath: string) => Promise<void>
}) {
  const { language, t } = useTranslation()
  const { user } = useAuth()
  const { state, setState, setSelectedProjectId, setSelectedTaskId } = useApp()
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getStoredCollaborationWorkspaceId())
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [input, setInput] = useState('')
  const [executors, setExecutors] = useState<Array<{ executorId: string; name: string; status: string }>>([])
  const [executorLoading, setExecutorLoading] = useState(false)
  const [executorSaving, setExecutorSaving] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [executorMenuOpen, setExecutorMenuOpen] = useState(false)
  const [streamError, setStreamError] = useState('')
  const [images, setImages] = useState<ChatImage[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [historyLoadingSessionId, setHistoryLoadingSessionId] = useState('')
  const [sessionQuery, setSessionQuery] = useState('')
  const [sessionSourceFilter, setSessionSourceFilter] = useState<AgentSessionSourceFilter>('all')
  const [emptyGroupExpanded, setEmptyGroupExpanded] = useState(false)
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false)

  // 悬浮输入区高度 → 消息区底部内边距（飞书式：输入框浮在会话上方）
  const [composerAreaHeight, setComposerAreaHeight] = useState(0)
  const { skills: mentionSkills, loading: mentionSkillsLoading } = useAvailableSkills(undefined, { workspaceId: currentWorkspaceId || undefined })

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
            description: t('agents.custom.chat.mentionDocKind', { defaultValue: '文档' }),
            kindLabel: t('agents.custom.chat.mentionDocKind', { defaultValue: '文档' }),
            keywords: [result.name, result.contentType],
          })),
      )
    })()
    return () => { cancelled = true }
  }, [mentionQuery, t])

  // @候选：技能（@slug 由服务端展开技能说明）+ 文档（reference_doc 引用）
  const mentionOptions = useMemo<ChatMentionOption[]>(() => {
    const skillOptions: ChatMentionOption[] = mentionSkills.map((skill) => ({
      id: `skill:${skill.id}`,
      kind: 'skill' as const,
      label: skill.slug,
      description: skill.description?.trim() || skill.name,
      kindLabel: t('agents.custom.chat.mentionSkillKind', { defaultValue: '技能' }),
      keywords: [skill.slug, skill.name, skill.description ?? ''],
    }))
    return [...skillOptions, ...driveMentionOptions]
  }, [driveMentionOptions, mentionSkills, t])
  const { autoScrollToBottom, resumeAutoScroll, scrollRef, updateStickiness } = useSmoothAutoScroll()
  const streamAbortRef = useRef<AbortController | null>(null)
  const createSessionInFlightRef = useRef(false)
  const sendInFlightRef = useRef(false)

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      setCurrentWorkspaceId(detail?.workspaceId?.trim() || '')
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
  }, [])

  const sessions = useMemo(
    () => agent
      ? sortMainChatSessions(state.mainChatSessions
        .filter((session) => session.customAgentId === agent.id)
        .filter((session) => isMainChatSessionVisibleInWorkspace(session, currentWorkspaceId)))
      : [],
    [agent, currentWorkspaceId, state.mainChatSessions],
  )
  /** 回复态：被回复消息的发送者标签。 */
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [selectedSessionId, sessions],
  )
  // 线程级消息状态（已确认 + 乐观队列），会话切换时自动重置，调用方负责重新冷加载。
  const thread = useThread<ChatMessage>(activeSession?.id)
  // 流式完成回调里判断“是否还在当前会话”，避免把旧会话的消息写进新会话的 hook 状态。
  const activeSessionIdRef = useRef<string | undefined>(undefined)
  activeSessionIdRef.current = activeSession?.id
  const selectedExecutor = useMemo(
    () => executors.find((executor) => executor.executorId === activeSession?.executorId) ?? null,
    [activeSession?.executorId, executors],
  )
  const executorDisabled = executorLoading || executorSaving || isStreaming
  const chatBlocked = Boolean(blockedReason)
  const assistantLabel = agent?.name?.trim() || 'Agent'
  const assistantAvatarUrl = useMemo(() => {
    if (!agent) {
      return undefined
    }

    const avatarUrl = readCustomAgentConfig(agent.config).avatarUrl.trim()
    return avatarUrl ? normalizeBuiltInAgentAvatarUrl(avatarUrl) : undefined
  }, [agent])
  const userLabel = user?.name?.trim() || (language === 'zh' ? '你' : 'You')
  const userAvatarUrl = user?.avatarUrl?.trim() || undefined
  const sessionGroups = useMemo(() => groupAgentSessions({
    sessions,
    query: sessionQuery,
    sourceFilter: sessionSourceFilter,
    activeSessionId: activeSession?.id ?? '',
  }), [activeSession?.id, sessionQuery, sessionSourceFilter, sessions])
  const workdirFileCount = workdirSummary?.totalFiles ?? workdirFiles.filter((file) => file.type === 'file').length
  const sourceFilterOptions = useMemo(() => ([
    { value: 'all' as const, label: language === 'zh' ? '全部' : 'All' },
    { value: 'web' as const, label: language === 'zh' ? '网页' : 'Web' },
    { value: 'feishu' as const, label: language === 'zh' ? '飞书' : 'Feishu' },
    { value: 'telegram' as const, label: 'Telegram' },
    { value: 'channel' as const, label: language === 'zh' ? '渠道' : 'Channel' },
  ]), [language])
  const emptyChatTitle = language === 'zh' ? '发起一段新对话' : 'Start a new conversation'
  const emptyChatDescription = language === 'zh'
    ? '发送一条消息，在当前 Agent 的任务上下文中继续协作。'
    : 'Send a message to continue working with this agent in context.'

  const [liveStreamText, setLiveStreamText] = useState('')
  const [liveStreamReasoning, setLiveStreamReasoning] = useState<string[]>([])
  const [liveStreamToolCalls, setLiveStreamToolCalls] = useState<ToolCall[]>([])
  /** R8.1 回复态：被回复消息 id。 */
  const [replyToMessageId, setReplyToMessageId] = useState('')

  /** 回复态：被回复消息的发送者标签。 */
  const replyTargetLabel = useMemo(() => {
    if (!replyToMessageId) {
      return ''
    }
    const target = thread.messages.find((m) => m.id === replyToMessageId)
    if (!target) {
      return ''
    }
    return target.role === 'user' ? t('chat.main.you') : (target.authorName || t('agents.custom.chat.headerTitle'))
  }, [replyToMessageId, thread.messages, t])
  /** R8.1 消息表情/点赞：乐观更新 + 通用端点 + 失败回滚。 */
  const [reactionsOverrides, setReactionsOverrides] = useState<Record<string, MessageChromeInput['reactions']>>({})

  const toggleReaction = useMemo(() => async (messageId: string, emoji: string, active: boolean) => {
    const conversationId = activeSession?.id
    const currentUserId = user?.id
    if (!conversationId || !currentUserId) {
      return
    }
    const base = thread.messages.find((m) => m.id === messageId)?.reactions
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
      toast.error(error instanceof Error ? error.message : '表情回复失败')
    }
  }, [activeSession?.id, reactionsOverrides, thread.messages, user?.id])
  // 会话切换时清掉其它会话的流式增量，避免跨会话泄漏。
  useEffect(() => {
    setLiveStreamText('')
    setLiveStreamReasoning([])
    setLiveStreamToolCalls([])
  }, [activeSession?.id])
  const transcriptTurns = useMemo(() => {
    const confirmedBubbles = chatMessagesToChatBubbleMessages(thread.messages)
    const withLiveStream = liveStreamText
      ? [...confirmedBubbles, {
          id: 'live-stream',
          role: 'assistant' as const,
          content: liveStreamText,
          createdAt: new Date().toISOString(),
          timelineOrder: confirmedBubbles.length + 1,
          streaming: true,
          ...(liveStreamReasoning.length > 0 ? { reasoning: liveStreamReasoning } : {}),
          ...(liveStreamToolCalls.length > 0 ? { toolCalls: liveStreamToolCalls } : {}),
        }]
      : confirmedBubbles
    const turns = buildMainChatTranscriptTurns(
      appendPendingChatBubbleMessages(withLiveStream, thread.optimisticMessages, isStreaming),
    )

    // R8.1：消息交互 chrome（操作条/表情/回复）——与主聊天/群聊共用 message-chrome，保证一致。
    const chromeById = new Map<string, MessageChromeInput>()
    for (const message of thread.messages) {
      chromeById.set(message.id, {
        id: message.id,
        content: message.content,
        reactions: reactionsOverrides[message.id] ?? message.reactions,
        replyToMessageId: message.replyToMessageId,
        senderId: message.authorId,
      })
    }
    const currentUserIdForChrome = user?.id ?? ''
    const assistantLabelForChrome = t('agents.custom.chat.headerTitle')
    const buildChrome = (message: MessageChromeInput & { isOwn?: boolean }) => sharedBuildMessageChrome({
      message,
      messageById: chromeById,
      currentUserId: currentUserIdForChrome,
      getSenderLabel: (target) => (target.id === turnUserRef.current ? t('chat.main.you') : assistantLabelForChrome),
      toggleReaction,
      setReplyToMessageId,
      isOwn: message.isOwn ?? false,
    })
    const turnUserRef: { current: string | undefined } = { current: undefined }

    return turns.map((turn) => {
      turnUserRef.current = turn.user?.id
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
        entries: turn.entries.map((entry) => {
          if (entry.kind !== 'assistant') {
            return entry
          }
          const chrome = buildChrome({
            id: entry.message.id,
            content: entry.message.text,
            reactions: chromeById.get(entry.message.id)?.reactions,
            replyToMessageId: chromeById.get(entry.message.id)?.replyToMessageId,
          })
          return {
            ...entry,
            message: {
              ...entry.message,
              ...(chrome.actions ? { actions: chrome.actions } : {}),
              afterContent: chrome.afterContent,
            },
          }
        }),
      }
    })
  }, [appendPendingChatBubbleMessages, isStreaming, liveStreamReasoning, liveStreamText, liveStreamToolCalls, reactionsOverrides, thread.messages, thread.optimisticMessages, toggleReaction, user?.id])

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionId('')
      return
    }

    if (!sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id)
    }
  }, [selectedSessionId, sessions])

  const loadSessionHistory = (sessionId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setHistoryLoadingSessionId(sessionId)
    }
    return thread.loadHistory(async () => {
      const { session, hasMoreBefore } = await api.getMainChatSession(sessionId, { limit: 50 })
      // 消息交给 useThread 持有；AppState 只更新会话元数据（P2.4 收口）。
      const { messages: _omittedMessages, ...sessionMeta } = session
      setState((current) => {
        const sessionExists = current.mainChatSessions.some((item) => item.id === session.id)
        if (!sessionExists) {
          return current
        }

        const mainChatSessions = current.mainChatSessions.map((item) => (
          item.id === session.id ? sessionMeta : item
        ))
        return {
          ...current,
          mainChatSessions,
        }
      })
      return { messages: _omittedMessages ?? [], hasMoreBefore: hasMoreBefore ?? false }
    })
      .catch((error) => {
        if (!options?.silent) {
          toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.loadHistory'))
        }
      })
      .finally(() => {
        if (!options?.silent) {
          setHistoryLoadingSessionId('')
        }
      })
  }

  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const loadOlderMessages = async () => {
    if (loadingOlderMessages || isStreaming || !activeSession?.id || !thread.hasMoreBefore) {
      return
    }
    const sessionId = activeSession.id
    const oldestSeq = thread.messages[0]?.seq
    if (typeof oldestSeq !== 'number') {
      return
    }

    setLoadingOlderMessages(true)
    try {
      await thread.loadMoreBefore(async () => {
        const { session, hasMoreBefore } = await api.getMainChatSession(sessionId, {
          limit: 50,
          beforeMessageId: String(oldestSeq),
        })
        return { messages: session.messages ?? [], hasMoreBefore: hasMoreBefore ?? false }
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.loadHistory'))
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  useEffect(() => {
    if (!activeSession) {
      setHistoryLoadingSessionId('')
      return
    }

    // useThread 在会话切换时重置了消息状态，每次切换都必须重新冷加载；
    // 不再依赖 loadedHistorySessionIdRef 守卫（那会让切回的会话漏加载）。
    void loadSessionHistory(activeSession.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id])

  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming

  // 其它标签页发起的消息通过 WS 事件感知——本标签只当"有更新"信号，
  // 内容一律回退到 HTTP 游标读取，正在本标签流式发送时跳过避免打断乐观 UI。
  // 非本地流式时把 delta 增量渲染成本地 streaming 气泡（刷新后断线续流）。
  useRealtimeMainChat(activeSession?.id, {
    onEvent: (event) => {
      if (isStreamingRef.current) {
        return
      }

      if (event.type === 'message_saved') {
        const sessionId = activeSession?.id
        if (sessionId) {
          setLiveStreamText('')
          setLiveStreamReasoning([])
          setLiveStreamToolCalls([])
          void loadSessionHistory(sessionId, { silent: true })
        }
        return
      }

      if (event.type === 'delta') {
        setLiveStreamText((current) => current + String(event.payload.content ?? ''))
        return
      }

      if (event.type === 'reasoning') {
        const content = String(event.payload.content ?? '').trim()
        if (content) {
          setLiveStreamReasoning((current) => [...current, content])
        }
        return
      }

      if (event.type === 'tool' && event.payload.toolCall) {
        const toolCall = event.payload.toolCall as ToolCall
        setLiveStreamToolCalls((current) => {
          const existingIndex = current.findIndex((item) => item.id === toolCall.id)
          if (existingIndex === -1) {
            return [...current, toolCall]
          }
          return current.map((item, index) => (index === existingIndex ? toolCall : item))
        })
      }
    },
    // 重连后服务端重放缓冲区已过期（resumed: false）：断线期间的增量事件已经丢失，
    // 主动做一次 HTTP 冷加载兜底，避免 UI 静默漏掉这段时间的更新。
    onNeedsRefresh: () => {
      if (isStreamingRef.current) {
        return
      }
      const sessionId = activeSession?.id
      if (sessionId) {
        setLiveStreamText('')
        void loadSessionHistory(sessionId, { silent: true })
      }
    },
  })

  useEffect(() => {
    let cancelled = false

    const loadExecutors = async () => {
      setExecutorLoading(true)
      try {
        const response = await api.listExecutors()
        if (!cancelled) {
          setExecutors(response.executors.map((executor) => ({
            executorId: executor.executorId,
            name: executor.name,
            status: executor.status,
          })))
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.loadExecutors'))
        }
      } finally {
        if (!cancelled) {
          setExecutorLoading(false)
        }
      }
    }

    void loadExecutors()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!filesDrawerOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFilesDrawerOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filesDrawerOpen])

  // 仅在「尾部新增」（新消息/流式结束）时自动滚到底；prepend（加载更早历史）不滚动，
  // 否则用户翻历史时会被拉回底部。
  const messagesTailRef = useRef({ length: 0, lastId: undefined as string | undefined })
  useEffect(() => {
    const previous = messagesTailRef.current
    const tail = { length: thread.messages.length, lastId: thread.messages.at(-1)?.id }
    messagesTailRef.current = tail
    const isPrepend = tail.length > previous.length && tail.lastId === previous.lastId
    if (isPrepend) {
      return
    }
    autoScrollToBottom()
  }, [autoScrollToBottom, liveStreamText, thread.messages, isStreaming])

  const handleTranscriptScroll = (event: UIEvent<HTMLDivElement>) => {
    updateStickiness()
    if (event.currentTarget.scrollTop <= 60) {
      void loadOlderMessages()
    }
  }

  useEffect(() => {
    if (!activeSession?.id) {
      return
    }

    resumeAutoScroll()
    autoScrollToBottom('instant')
  }, [activeSession?.id, autoScrollToBottom, resumeAutoScroll])

  const handleCreateSession = async () => {
    if (!agent || isStreaming || createSessionInFlightRef.current) {
      return
    }

    createSessionInFlightRef.current = true
    try {
      const response = await api.createCustomAgentChatSession(agent.id, {
        workspaceId: currentWorkspaceId.trim() || undefined,
      })
      applyStateSelection(response.state, setState, setSelectedProjectId, setSelectedTaskId)
      const nextSession = response.state.mainChatSessions.find((session) => session.customAgentId === agent.id)
      setSelectedSessionId(nextSession?.id ?? '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.createSession'))
    } finally {
      createSessionInFlightRef.current = false
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (!agent || isStreaming || sessions.length <= 1) {
      return
    }

    try {
      const response = await api.deleteCustomAgentChatSession(agent.id, sessionId)
      applyStateSelection(response.state, setState, setSelectedProjectId, setSelectedTaskId)
      if (selectedSessionId === sessionId) {
        const nextSession = response.state.mainChatSessions.find((session) => session.customAgentId === agent.id)
        setSelectedSessionId(nextSession?.id ?? '')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.deleteSession'))
    }
  }

  const handleExecutorChange = async (executorId: string) => {
    if (!agent || !activeSession) {
      return
    }

    setExecutorSaving(true)
    try {
      const response = await api.updateCustomAgentChatSessionExecutor(agent.id, activeSession.id, executorId || undefined)
      applyStateSelection(response.state, setState, setSelectedProjectId, setSelectedTaskId)
      setExecutorMenuOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.switchExecutor'))
    } finally {
      setExecutorSaving(false)
    }
  }

  const handleImageUpload = async (files: File[]) => {
    if (files.length === 0 || isStreaming || isUploading) {
      return
    }

    setIsUploading(true)
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          continue
        }

        const reader = new FileReader()
        const imageBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const uploaded = await api.uploadMainChatImage(imageBase64, file.name)
        setImages((current) => [
          ...current,
          {
            id: uploaded.id,
            url: uploaded.url,
            filename: file.name,
            contentType: uploaded.contentType || file.type,
          },
        ])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('agents.custom.chat.errors.uploadImage'))
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveImage = (imageId: string) => {
    setImages((current) => current.filter((image) => image.id !== imageId))
  }

  const handleSend = async () => {
    if (sendInFlightRef.current) {
      return
    }
    if (chatBlocked) {
      toast.error(blockedReason)
      return
    }
    if (!agent || !activeSession || !activeSession.executorId) {
      toast.error(t('agents.custom.chat.errors.selectExecutorFirst'))
      return
    }

    const attachments = images.map((image) => ({
      id: image.id,
      url: image.url,
      filename: image.filename,
      contentType: image.contentType,
    }))
    const value = input.trim() || (attachments.length > 0 ? t(attachments.length > 1 ? 'agents.custom.chat.imagePrompt.multiple' : 'agents.custom.chat.imagePrompt.single') : '')
    if ((!value && attachments.length === 0) || isStreaming) {
      return
    }

    const sessionId = activeSession.id
    const clientMessageId = crypto.randomUUID()
    const replyTo = replyToMessageId.trim() || undefined
    sendInFlightRef.current = true
    setInput('')
    setImages([])
    setReplyToMessageId('')
    setStreamError('')
    setIsStreaming(true)
    // 乐观 user 气泡进 useThread 队列，id 用 clientMessageId 派生；工作气泡由
    // appendPendingChatBubbleMessages 在 streaming 时补上。
    thread.applyOptimistic({
      id: `pending:${clientMessageId}`,
      role: 'user',
      content: value,
      createdAt: new Date().toISOString(),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(replyTo ? { replyToMessageId: replyTo } : {}),
    }, clientMessageId)
    const abortController = new AbortController()
    streamAbortRef.current = abortController

    try {
      const result = await api.customAgentChatStream(agent.id, sessionId, value, (event) => {
        if (event.type === 'done' && event.state) {
          // 服务端已落库回显：把新消息合进已确认列表并销账，乐观气泡让位给真实消息。
          // 流式中可能已切走会话——旧会话的完成结果只更新 AppState，不写进新会话的 hook。
          if (activeSessionIdRef.current === sessionId) {
            thread.applyIncoming(
              event.state.mainChatSessions.find((session) => session.id === sessionId)?.messages ?? [],
            )
            thread.settleOptimistic(clientMessageId)
          }
          applyStateSelection(event.state, setState, setSelectedProjectId, setSelectedTaskId)
          return
        }

        if (event.type === 'error') {
          thread.settleOptimistic(clientMessageId)
          setStreamError(event.content)
        }
      }, abortController.signal, attachments, clientMessageId, replyTo)

      if (!result.ok && !result.aborted) {
        throw new Error(result.output)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('agents.custom.chat.errors.sendFailed')
      thread.settleOptimistic(clientMessageId)
      setStreamError(message)
      toast.error(message)
    } finally {
      streamAbortRef.current = null
      sendInFlightRef.current = false
      thread.settleOptimistic(clientMessageId)
      setIsStreaming(false)
    }
  }

  const sourceKindLabels: Record<AgentSessionSourceKind, string> = {
    web: language === 'zh' ? '网页' : 'Web',
    feishu: language === 'zh' ? '飞书' : 'Feishu',
    telegram: 'Telegram',
    channel: language === 'zh' ? '渠道' : 'Channel',
  }

  const renderSessionItems = (items: AgentSessionListItem[]) => items.map(({ session, sourceKind, preview }) => {
    const active = session.id === activeSession?.id
    const sessionWorking = isAgentWorkingStatus(session.agentRunningStatus)
    return (
      <div key={session.id} className={cn('group rounded-md px-2.5 py-2 transition-colors', active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200')}>
        <button type="button" onClick={() => setSelectedSessionId(session.id)} className="w-full text-left">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || t('agents.custom.chat.newSession')}</p>
            {sessionWorking ? (
              <span className="shrink-0" title={language === 'zh' ? '正在处理' : 'Working'}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
              </span>
            ) : null}
            <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">{sourceKindLabels[sourceKind]}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-zinc-500">{preview || t('agents.custom.chat.emptySession')}</p>
        </button>
        {sessions.length > 1 ? (
          <button
            type="button"
            onClick={() => void handleDeleteSession(session.id)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-400 focus:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
            {t('common.delete')}
          </button>
        ) : null}
      </div>
    )
  })

  if (!agent) {
    return <EmptyChatState text={t('agents.custom.chat.empty.selectAgent')} />
  }

  if (sessions.length === 0) {
    return (
      <EmptyChatState
        text={t('agents.custom.chat.empty.noSessions')}
        action={<Button type="button" onClick={() => void handleCreateSession()} className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200">{t('agents.custom.chat.createSession')}</Button>}
      />
    )
  }

  return (
    <div className="relative grid h-full min-h-0 overflow-hidden bg-[#09090b] text-zinc-100 lg:min-h-[30rem] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 max-h-28 flex-col border-b border-zinc-800 bg-[#070708] lg:max-h-none lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-3 pt-2.5">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <MessageSquareText className="h-4 w-4" />
              {t('agents.custom.chat.sessionList')}
              <span className="text-xs font-normal text-zinc-600">{sessions.length}</span>
            </div>
            <Button type="button" size="icon" variant="ghost" title={t('agents.custom.chat.createSession')} onClick={() => void handleCreateSession()} className="size-7 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 border-b border-zinc-800 px-3 pb-2.5 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder={language === 'zh' ? '搜索会话' : 'Search sessions'}
                aria-label={language === 'zh' ? '搜索会话' : 'Search sessions'}
                className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-7 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {sourceFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSessionSourceFilter(option.value)}
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                    sessionSourceFilter === option.value
                      ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                      : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {renderSessionItems(sessionGroups.substantive)}

            {sessionGroups.empty.length > 0 ? (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setEmptyGroupExpanded((current) => !current)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-900/50 hover:text-zinc-300"
                  aria-expanded={emptyGroupExpanded}
                >
                  <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', emptyGroupExpanded && 'rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{t('agents.custom.chat.emptySession')}</span>
                  <span className="shrink-0 text-zinc-600">{sessionGroups.empty.length}</span>
                </button>
                {emptyGroupExpanded ? (
                  <div className="mt-1 space-y-1">
                    {renderSessionItems(sessionGroups.empty)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {sessionGroups.totalMatched === 0 ? (
              <p className="px-2.5 py-6 text-center text-xs text-zinc-600">
                {language === 'zh' ? '没有匹配的会话' : 'No matching sessions'}
              </p>
            ) : null}
          </div>
        </aside>

        <section className="relative flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-200">{activeSession?.title || t('agents.custom.chat.newSession')}</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                {selectedExecutor ? selectedExecutor.name : t('agents.custom.chat.selectExecutor')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn('flex items-center gap-1.5 text-[11px]', isStreaming ? 'text-sky-300' : activeSession?.executorId ? 'text-emerald-300' : 'text-zinc-500')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', isStreaming ? 'bg-sky-400' : activeSession?.executorId ? 'bg-emerald-400' : 'bg-zinc-600')} />
                {isStreaming ? t('agents.custom.chat.stop') : activeSession?.executorId ? selectedExecutor?.status || 'online' : t('agents.custom.chat.noExecutorBinding')}
              </span>
              <button
                type="button"
                onClick={() => setFilesDrawerOpen(true)}
                title={language === 'zh' ? '工作区文件' : 'Workspace files'}
                aria-label={language === 'zh' ? '工作区文件' : 'Workspace files'}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              >
                <FolderOpen className="size-4" />
                {workdirFileCount > 0 ? (
                  <span className="text-[11px] tabular-nums text-zinc-400">{workdirFileCount}</span>
                ) : null}
              </button>
            </div>
          </div>
          <div ref={scrollRef} onScroll={handleTranscriptScroll} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" style={{ paddingBottom: composerAreaHeight + 16 }}>
            {thread.hasMoreBefore ? (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadOlderMessages()}
                  disabled={loadingOlderMessages}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-60"
                >
                  {loadingOlderMessages ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronUp className="size-3.5" />}
                  {language === 'zh' ? '加载更早消息' : 'Load earlier messages'}
                </button>
              </div>
            ) : null}
            {historyLoadingSessionId === activeSession?.id ? (
              <div className="flex h-full min-h-48 items-center justify-center text-sm text-zinc-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                {language === 'zh' ? '正在加载完整聊天记录…' : 'Loading full chat history…'}
              </div>
            ) : transcriptTurns.length === 0 ? (
              <div className="flex min-h-full items-center justify-center">
                <div className="max-w-sm text-center">
                  <span className="mx-auto flex size-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-500">
                    <MessageSquareText className="size-5" />
                  </span>
                  <p className="mt-3 text-sm font-medium text-zinc-200">{emptyChatTitle}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{emptyChatDescription}</p>
                </div>
              </div>
            ) : (
              <ChatTranscript
                turns={transcriptTurns}
                isBusy={isStreaming}
                assistantLabel={assistantLabel}
                assistantAvatarUrl={assistantAvatarUrl}
                assistantAvatarFallback={getAgentInitials(assistantLabel)}
                userLabel={userLabel}
                userAvatarUrl={userAvatarUrl}
                userAvatarFallback={getAgentInitials(userLabel)}
              />
            )}
          </div>

          <ChatComposerOverlay className="max-w-none px-3 pb-6 sm:pb-3" onHeightChange={setComposerAreaHeight}>
            <ChatComposer
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (isImeComposingKeyboardEvent(event)) {
                  return
                }

                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={chatBlocked ? blockedReason : activeSession?.executorId ? t('agents.custom.chat.inputPlaceholder') : t('agents.custom.chat.selectExecutorFirst')}
              disabled={chatBlocked || !activeSession?.executorId || isStreaming}
              rows={3}
              minHeight={72}
              className="min-h-[72px]"
              shellClassName="pointer-events-auto rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.45)] transition-colors focus-within:border-zinc-700"
              onSelectMention={(nextValue) => setInput(nextValue)}
              onMentionQueryChange={setMentionQuery}
              mentionOptions={mentionOptions}
              mentionTitle={t('agents.custom.chat.mentionTitle', { defaultValue: '引用与技能' })}
              mentionHintText={t('agents.custom.chat.mentionHint', { defaultValue: '输入 @ 选择要引用的文档或要启用的技能' })}
              mentionEmptyText={t('agents.custom.chat.mentionEmpty', { defaultValue: '没有匹配的文档或技能。' })}
              topContent={(
                <>
                  {replyToMessageId ? (
                    <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs text-zinc-400">
                      <CornerDownLeft className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        正在回复：{replyTargetLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyToMessageId('')}
                        className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                        aria-label="取消回复"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : null}
                  {streamError ? (
                    <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                      {streamError}
                    </div>
                  ) : null}
                  {images.length > 0 ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {images.map((image) => (
                        <div key={image.id} className="group relative">
                          <img
                            src={resolveMediaUrl(image.url)}
                            alt={image.filename}
                            className="h-14 w-14 rounded-xl border border-zinc-800/60 object-cover shadow-lg"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(image.id)}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800/90 text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
              overlay={(
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={chatBlocked || isStreaming}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-800/80 hover:text-zinc-300 disabled:pointer-events-none disabled:opacity-40"
                        aria-label="插入 emoji"
                        title="插入 emoji"
                      >
                        <Smile size={16} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="end">
                      <EmojiPicker
                        onSelect={(emoji) => {
                          setInput((current) => {
                            const trimmed = current.trimEnd()
                            return trimmed ? `${trimmed} ${emoji} ` : `${emoji} `
                          })
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <label className={cn(
                  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-800/80 hover:text-zinc-300',
                  (chatBlocked || isStreaming || isUploading) && 'pointer-events-none opacity-40',
                )}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const files = event.target.files ? Array.from(event.target.files) : []
                      if (files.length > 0) {
                        void handleImageUpload(files)
                      }
                      event.target.value = ''
                    }}
                    disabled={chatBlocked || isStreaming || isUploading}
                  />
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </label>
                </>
              )}
              footer={(
                <div className="mt-2.5 border border-zinc-800 bg-zinc-950 p-2">
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <SkillMentionPicker
                        disabled={chatBlocked || isStreaming || !activeSession?.executorId}
                        loading={mentionSkillsLoading}
                        skills={mentionSkills}
                        value={input}
                        onSelectSkill={(skill) => setInput((current) => insertSkillMentionToken(current, skill))}
                      />

                      <ExecutorSelect
                        open={executorMenuOpen}
                        onOpenChange={setExecutorMenuOpen}
                        disabled={executorDisabled}
                        value={activeSession?.executorId || ''}
                        options={[
                          {
                            value: '',
                            label: t('agents.custom.chat.noExecutorBinding'),
                            description: t('agents.custom.chat.noExecutorHint'),
                            statusTone: 'neutral',
                          },
                          ...executors.map((executor) => ({
                            value: executor.executorId,
                            label: executor.name,
                            description: executor.status,
                            badgeLabel: executor.status,
                            statusTone: isExecutorEffectivelyOnline(executor) ? 'online' : 'offline',
                          })),
                        ]}
                        placeholder={t('agents.custom.chat.selectExecutor')}
                        emptyText={t('agents.custom.chat.noMatchingExecutors', { defaultValue: '没有匹配的执行节点' })}
                        searchPlaceholder={t('agents.custom.chat.searchExecutor', { defaultValue: '搜索执行节点' })}
                        compact
                        side="top"
                        sideOffset={10}
                        triggerClassName="min-w-[180px]"
                        contentClassName="w-80"
                        selectedLabelOverride={selectedExecutor ? selectedExecutor.name : t('agents.custom.chat.selectExecutor')}
                        title={t('agents.custom.chat.selectExecutor')}
                        meta={executorSaving ? t('agents.custom.chat.switching') : t('agents.custom.chat.agentSession')}
                        onChange={(value) => void handleExecutorChange(value)}
                      />

                      {/* Model selector removed — agent uses its own configured model */}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <span className="hidden rounded-md border border-zinc-800/40 bg-zinc-900/30 px-1.5 py-0.5 text-[10px] text-zinc-600 sm:inline-flex">
                        {t('agents.custom.chat.sendHint')}
                      </span>
                    {isStreaming ? (
                      <Button type="button" variant="outline" onClick={() => streamAbortRef.current?.abort()} className="h-8 border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-900">
                        <Square className="mr-1 h-3.5 w-3.5" />
                        {t('agents.custom.chat.stop')}
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => void handleSend()} disabled={chatBlocked || !activeSession?.executorId || (!input.trim() && images.length === 0)} className="h-8 bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
                        <Send className="mr-1 h-3.5 w-3.5" />
                        {t('agents.custom.chat.send')}
                      </Button>
                    )}
                    </div>
                  </div>
                </div>
              )}
            />
          </ChatComposerOverlay>
        </section>

        {filesDrawerOpen ? (
          <div className="absolute inset-0 z-30 flex justify-end">
            <button
              type="button"
              aria-label={language === 'zh' ? '关闭工作区文件' : 'Close workspace files'}
              onClick={() => setFilesDrawerOpen(false)}
              className="absolute inset-0 bg-black/50"
            />
            <div className="relative flex w-full max-w-xs flex-col border-l border-zinc-800 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
              <AgentChatWorkspaceFiles
                summary={workdirSummary}
                files={workdirFiles}
                loading={workdirLoading}
                refreshing={workdirRefreshing}
                onRefresh={onRefreshWorkdir}
                onDownload={onDownloadWorkdirFile}
              />
            </div>
          </div>
        ) : null}
      </div>
  )
}

function AgentChatWorkspaceFiles({
  summary,
  files,
  loading,
  refreshing,
  onRefresh,
  onDownload,
}: {
  summary: AgentWorkdirSummary | null
  files: AgentWorkdirFileEntry[]
  loading: boolean
  refreshing: boolean
  onRefresh: () => Promise<void>
  onDownload: (relativePath: string) => Promise<void>
}) {
  const { language } = useTranslation()
  const downloadableFiles = files.filter((file) => file.type === 'file')
  const displayedFiles = downloadableFiles.slice(0, 12)
  const fileCount = summary?.totalFiles ?? downloadableFiles.length
  const title = language === 'zh' ? '工作区文件' : 'Workspace files'
  const emptyText = language === 'zh' ? '当前没有可下载文件' : 'No downloadable files yet'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#070708]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-4 shrink-0 text-zinc-500" />
          <span className="truncate text-sm font-medium text-zinc-300">{title}</span>
          <span className="text-xs text-zinc-600">{fileCount}</span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title={language === 'zh' ? '刷新文件' : 'Refresh files'}
          disabled={refreshing}
          onClick={() => void onRefresh()}
          className="size-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" />
            {language === 'zh' ? '正在读取文件...' : 'Loading files...'}
          </div>
        ) : displayedFiles.length === 0 ? (
          <div className="px-2 py-4 text-xs leading-5 text-zinc-500">{emptyText}</div>
        ) : (
          <div className="space-y-1">
            {displayedFiles.map((file) => (
              <div key={file.path} className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-zinc-900/60">
                <FileText className="size-3.5 shrink-0 text-zinc-600" />
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={file.path}>{file.path}</span>
                <button
                  type="button"
                  title={language === 'zh' ? `下载 ${file.path}` : `Download ${file.path}`}
                  onClick={() => void onDownload(file.path)}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-600 opacity-0 transition-colors group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100"
                >
                  <Download className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {downloadableFiles.length > displayedFiles.length ? (
        <div className="shrink-0 border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
          {language === 'zh' ? `显示前 ${displayedFiles.length} 个文件` : `Showing first ${displayedFiles.length} files`}
        </div>
      ) : null}
    </div>
  )
}

function EmptyChatState({
  text,
  action,
}: {
  text: string
  action?: ReactNode
}) {
  return (
    <div className="border border-dashed border-zinc-800 bg-[#09090b] px-6 py-12 text-center">
      <p className="text-sm text-zinc-500">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
