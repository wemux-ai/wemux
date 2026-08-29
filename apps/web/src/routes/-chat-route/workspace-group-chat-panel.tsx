/**
 * [INPUT]: Workspace group chat API records, user input, and stream events.
 * [OUTPUT]: Group creation, Agent execution mentions, human mention notifications, transcript, unread state, and responder identity UI for `/chat`.
 * [POS]: `/chat` group-chat surface; task Squad assignment is deliberately outside this module.
 * [PROTOCOL]: Update this header when changing this responsibility, then check AGENTS.md.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppDialog } from '../../components/ui/app-dialog-provider'
import { ArrowDown, ArrowLeft, ArrowUp, AtSign, CornerDownLeft, Loader2, Megaphone, Paperclip, Send, Settings2, Share2, Smile, Square, Users, X } from 'lucide-react'
import { resolveChatMentionTargetIds } from '@shared/chat-mentions'
import { toggleMessageReaction } from '@shared/message-reactions'
import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import type { ExecutorRecord, ToolCall } from '@shared/types'
import { toast } from 'sonner'
import { ChatComposer } from '../../components/chat/chat-composer'
import { ChatComposerOverlay } from '../../components/chat/chat-composer-overlay'
import { buildWorkspaceMentionOptions } from '../../lib/chat-mentions'
import { ConversationFeed } from '../../components/chat/conversation-feed'
import type { ConversationMessage, ConversationTurn } from '../../components/chat/conversation-types'
import type { ChatMentionTarget } from '../../components/chat/mention-text'
import { EmojiPicker } from '../../components/chat/emoji-picker'
import { buildMessageChrome as sharedBuildMessageChrome } from '../../components/chat/message-chrome'
import { realtimeClient, useRealtimeActiveView, useRealtimeConversation, type ConversationWsEvent } from '../../lib/realtime/useRealtime'
import { useConversationUnreadState } from '../../lib/use-conversation-unread-state'
import { ChatViewport } from '../../components/chat/chat-viewport'
import { Button } from '../../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { type ChatMentionOption } from '../../components/chat/chat-mention-list'
import { api, type CollaborationWorkspace, type TeamMember, type WorkspaceChatAgentOption, type WorkspaceChatGroupDetail, type WorkspaceChatGroupSessionDetail, type WorkspaceChatGroupSessionSummary, type WorkspaceChatGroupSummary, type WorkspaceGroupWithMembers } from '../../lib/api'
import {
  COLLABORATION_WORKSPACE_CHANGE_EVENT,
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspaceId,
} from '../../lib/collaboration-workspace'
import { isImeComposingKeyboardEvent } from '../../lib/ime-keyboard'
import {
  collaborationWorkspacesCache,
  readCollaborationWorkspacesCache,
  readWorkspaceChatGroupsCache,
  writeCollaborationWorkspacesCache,
  writeWorkspaceChatGroupsCache,
  workspaceChatGroupsCache,
} from '../../lib/chat-sidebar-cache'
import type { Language } from '../../lib/i18n'
import { useScrollTopSentinel } from '../../lib/use-scroll-top-sentinel'
import { usePreventPullToRefresh } from '../../lib/use-prevent-pull-to-refresh'
import { useSmoothAutoScroll } from '../../lib/use-smooth-auto-scroll'
import { cn, formatDate } from '../../lib/utils'
import { useAuth } from '../../lib/auth-context'
import { getAgentInitials, text } from './chat-route-helpers'
import {
  collectUnackedMentionIds,
  messageMentionsUserId,
  readGroupChatMentionSeen,
  writeGroupChatMentionSeen,
} from './workspace-group-chat-mentions'
import { WorkspaceGroupSettingsDialog } from './workspace-group-settings-dialog'
import { ConversationShareDialog } from '../../components/chat/conversation-share-dialog'
import {
  getPersistedWorkspaceGroupId,
  getPersistedWorkspaceGroupSessionId,
  readWorkspaceGroupChatPreferences,
  setPersistedWorkspaceGroupChatGroup,
  setPersistedWorkspaceGroupChatSessionReadMessageCount,
  setPersistedWorkspaceGroupChatSession,
  setPersistedWorkspaceGroupChatWorkspace,
  writeWorkspaceGroupChatPreferences,
} from './workspace-group-chat-preferences'

export type GroupOptions = {
  members: TeamMember[]
  executors: ExecutorRecord[]
  agents: WorkspaceChatAgentOption[]
}

export type CreateGroupDraft = {
  title: string
  description: string
  userMemberIds: string[]
  agentMemberIds: string[]
}

const EMPTY_OPTIONS: GroupOptions = {
  members: [],
  executors: [],
  agents: [],
}

const createInitialDraft = (): CreateGroupDraft => ({
  title: '',
  description: '',
  userMemberIds: [],
  agentMemberIds: [],
})

const INITIAL_SESSION_MESSAGE_LIMIT = 10
const SESSION_SCROLL_TOP_THRESHOLD = 120
const GROUP_CHAT_SUMMARY_REFRESH_MS = 15_000

/** 从消息 externalRef.mentions 提取 @会话 引用（targetType=conversation），标题从当前会话列表匹配 */
const extractConversationReferences = (
  message: { externalRef?: Record<string, unknown> },
  sessions: ReadonlyArray<{ conversation: { id: string; title: string } }>,
): Array<{ id: string; title: string }> | undefined => {
  const mentions = message.externalRef?.mentions
  if (!Array.isArray(mentions)) return undefined
  const referenced = mentions
    .filter((mention): mention is { targetType: string; targetId: string } => (
      typeof mention === 'object'
      && mention !== null
      && (mention as { targetType?: string }).targetType === 'conversation'
      && typeof (mention as { targetId?: string }).targetId === 'string'
    ))
    .map((mention) => {
      const session = sessions.find((item) => item.conversation.id === mention.targetId)
      return { id: mention.targetId, title: session?.conversation.title ?? mention.targetId }
    })
  return referenced.length > 0 ? referenced : undefined
}

/** 从消息 externalRef.referencedDocs 提取 @文档 引用（targetType=doc / reference_doc） */
const extractDocumentReferences = (
  message: { externalRef?: Record<string, unknown> },
): Array<{ id: string; name: string; workspaceId: string | null }> | undefined => {
  const referencedDocs = message.externalRef?.referencedDocs
  if (!Array.isArray(referencedDocs)) return undefined
  const docs = referencedDocs
    .filter((doc): doc is { id: string; name: string; workspaceId?: string | null } => (
      typeof doc === 'object'
      && doc !== null
      && typeof (doc as { id?: string }).id === 'string'
      && typeof (doc as { name?: string }).name === 'string'
    ))
    .map((doc) => ({
      id: doc.id,
      name: doc.name,
      workspaceId: doc.workspaceId ?? null,
    }))
  return docs.length > 0 ? docs : undefined
}

type WorkspaceGroupMessage = WorkspaceChatGroupSessionDetail['messages'][number]
export type { WorkspaceGroupMessage }
type StreamingAgentReply = {
  agentId: string
  content: string
  toolCalls: ToolCall[]
}

export type WorkspaceGroupSessionExecutionState = {
  groupId: string
  label: string
}

const mergeConversationMessages = (
  previous: WorkspaceChatGroupSessionDetail['messages'],
  nextPage: WorkspaceChatGroupSessionDetail['messages'],
) => {
  const nextIds = new Set(nextPage.map((message) => message.id))
  return [...nextPage, ...previous.filter((message) => !nextIds.has(message.id))]
}

const readClientMessageId = (message: WorkspaceChatGroupSessionDetail['messages'][number]) => {
  const value = message.externalRef?.clientMessageId
  return typeof value === 'string' ? value.trim() : ''
}

/** WS 回声可能早于 stream 请求结束；按 clientMessageId 替换临时气泡，避免短暂双显。 */
export const reconcileGroupRealtimeMessage = (
  current: WorkspaceChatGroupSessionDetail['messages'],
  incoming: WorkspaceChatGroupSessionDetail['messages'][number],
) => {
  const clientMessageId = readClientMessageId(incoming)
  const optimisticId = clientMessageId ? `user-${clientMessageId}` : ''
  if (optimisticId && current.some((item) => item.id === optimisticId)) {
    return current.map((item) => item.id === optimisticId ? incoming : item)
  }

  if (current.some((item) => item.id === incoming.id)) {
    return current
  }

  return mergeConversationMessages(current, [incoming])
}

/** 从消息 externalRef.attachments 提取附件（Drive 引用等），供 ConversationFeed 渲染 */
export const extractGroupMessageAttachments = (message: WorkspaceGroupMessage) => (
  normalizeTaskChatAttachments(message.externalRef?.attachments)
)

const getMessageAgentId = (message: WorkspaceGroupMessage) => {
  const externalAgentId = typeof message.externalRef?.agentId === 'string'
    ? message.externalRef.agentId.trim()
    : ''
  if (externalAgentId) {
    return externalAgentId
  }

  return message.role === 'assistant' ? message.senderId?.trim() || '' : ''
}

export const getWorkspaceGroupMessageAgent = (
  agents: readonly WorkspaceChatAgentOption[],
  message: WorkspaceGroupMessage,
) => {
  const agentId = getMessageAgentId(message)
  return agentId ? agents.find((agent) => agent.id === agentId) : undefined
}

export const getFirstMentionedWorkspaceGroupAgent = (
  message: string,
  agents: readonly WorkspaceChatAgentOption[],
) => getMentionedWorkspaceGroupAgents(message, agents)[0]

export const getMentionedWorkspaceGroupAgents = (
  message: string,
  agents: readonly WorkspaceChatAgentOption[],
) => {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent] as const))
  return resolveChatMentionTargetIds(message, agents)
    .flatMap((agentId) => {
      const agent = agentsById.get(agentId)
      return agent ? [agent] : []
    })
}

const getMessageSenderLabel = (
  detail: WorkspaceChatGroupDetail | null,
  options: GroupOptions,
  message: WorkspaceGroupMessage,
  language: Language,
) => {
  const externalName = typeof message.externalRef?.senderName === 'string'
    ? message.externalRef.senderName
    : typeof message.externalRef?.agentName === 'string'
      ? message.externalRef.agentName
      : ''
  if (externalName) {
    return externalName
  }

  if (message.role === 'assistant') {
    return getWorkspaceGroupMessageAgent(options.agents, message)?.name
      || text(language, 'Agent', 'Agent')
  }

  if (message.role === 'user') {
    const member = options.members.find((item) => item.id === message.senderId)
    return member?.name || text(language, '成员', 'Member')
  }

  return detail?.conversation.title || text(language, '系统', 'System')
}

export function useWorkspaceGroupChatState(language: Language) {
  const { user } = useAuth()
  const persistedPreferencesRef = useRef(readWorkspaceGroupChatPreferences())
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [options, setOptions] = useState<GroupOptions>(EMPTY_OPTIONS)
  /** 空间内分组（P2）：群聊创建按组筛选 / @组名通知候选 */
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceGroupWithMembers[]>([])
  const [groups, setGroups] = useState<WorkspaceChatGroupSummary[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [detail, setDetail] = useState<WorkspaceChatGroupDetail | null>(null)
  const [sessions, setSessions] = useState<WorkspaceChatGroupSessionSummary[]>([])
  const [sessionsByGroupId, setSessionsByGroupId] = useState<Record<string, WorkspaceChatGroupSessionSummary[]>>({})
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [sessionDetail, setSessionDetail] = useState<WorkspaceChatGroupSessionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [streamStatus, setStreamStatus] = useState('')
  const [input, setInput] = useState('')
  const [streamingReplies, setStreamingReplies] = useState<StreamingAgentReply[]>([])
  const [activeResponderAgentId, setActiveResponderAgentId] = useState('')
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsBusyKey, setSettingsBusyKey] = useState('')
  const [draft, setDraft] = useState<CreateGroupDraft>(createInitialDraft)
  const [readMessageCountsBySessionId, setReadMessageCountsBySessionId] = useState(
    persistedPreferencesRef.current.readMessageCountsBySessionId,
  )
  const [sessionExecutionById, setSessionExecutionById] = useState<Record<string, WorkspaceGroupSessionExecutionState>>({})
  const [replyToMessageId, setReplyToMessageId] = useState('')
  const [attaching, setAttaching] = useState(false)
  const sessionRequestIdRef = useRef(0)
  const transcriptWindowRestoreRef = useRef<{ previousHeight: number; previousTop: number } | null>(null)
  const initializedSessionReadWorkspaceIdsRef = useRef(new Set<string>())
  /** 当前聊天对象数据所属的协作空间 id（用于切换空间时先清空再加载）。 */
  const loadedWorkspaceIdRef = useRef('')
  const [mentionUnreadBySessionId, setMentionUnreadBySessionId] = useState<Record<string, string[]>>({})
  const mentionSeenRef = useRef(readGroupChatMentionSeen())
  const mentionSubscriptionCleanupsRef = useRef<Map<string, () => void>>(new Map())
  const userIdRef = useRef(user?.id)
  userIdRef.current = user?.id

  const updatePersistedPreferences = useCallback((updater: (current: ReturnType<typeof readWorkspaceGroupChatPreferences>) => ReturnType<typeof readWorkspaceGroupChatPreferences>) => {
    const nextPreferences = updater(persistedPreferencesRef.current)
    if (nextPreferences === persistedPreferencesRef.current) {
      return
    }

    persistedPreferencesRef.current = nextPreferences
    setReadMessageCountsBySessionId(nextPreferences.readMessageCountsBySessionId)
    writeWorkspaceGroupChatPreferences(nextPreferences)
  }, [])

  const initializeReadMessageCounts = useCallback((workspaceId: string, nextSessions: readonly WorkspaceChatGroupSessionSummary[]) => {
    if (!workspaceId || initializedSessionReadWorkspaceIdsRef.current.has(workspaceId)) {
      return
    }

    initializedSessionReadWorkspaceIdsRef.current.add(workspaceId)
    updatePersistedPreferences((current) => {
      const unreadSessionIds = nextSessions.filter((session) => (
        !(session.conversation.id in current.readMessageCountsBySessionId)
      ))
      if (unreadSessionIds.length === 0) {
        return current
      }

      return unreadSessionIds.reduce((preferences, session) => (
        setPersistedWorkspaceGroupChatSessionReadMessageCount(
          preferences,
          session.conversation.id,
          session.messageCount,
        )
      ), current)
    })
  }, [updatePersistedPreferences])

  const {
    autoScrollToBottom,
    resumeAutoScroll,
    scrollRef,
    scrollShortcutTarget,
    scrollToTop,
    scrollToBottom,
    showJumpToBottom,
    updateStickiness,
  } = useSmoothAutoScroll({ threshold: 56 })

  const selectedWorkspace = useMemo(() => {
    return workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  }, [selectedWorkspaceId, workspaces])
  const activeResponderAgent = useMemo(() => {
    return options.agents.find((agent) => agent.id === activeResponderAgentId)
  }, [activeResponderAgentId, options.agents])
  const unreadCountBySessionId = useMemo(() => {
    return Object.fromEntries(
      Object.values(sessionsByGroupId).flat().map((session) => [
        session.conversation.id,
        Math.max(0, session.messageCount - (readMessageCountsBySessionId[session.conversation.id] ?? 0)),
      ]),
    )
  }, [readMessageCountsBySessionId, sessionsByGroupId])
  const unreadCountByGroupId = useMemo(() => {
    return Object.fromEntries(
      Object.entries(sessionsByGroupId).map(([groupId, groupSessions]) => [
        groupId,
        groupSessions.reduce((count, session) => count + (unreadCountBySessionId[session.conversation.id] ?? 0), 0),
      ]),
    )
  }, [sessionsByGroupId, unreadCountBySessionId])

  // feature P2：服务端会话未读（多设备同步）。群聊 badge 取本地与服务端较大值，打开会话时推进游标。
  const allConversationIds = useMemo(() => {
    const ids = new Set<string>()
    for (const group of groups) {
      ids.add(group.conversation.id)
      for (const session of sessionsByGroupId[group.conversation.id] ?? []) {
        ids.add(session.conversation.id)
      }
    }
    return [...ids]
  }, [groups, sessionsByGroupId])
  const { unreadByConversationId, markRead: markConversationRead } = useConversationUnreadState({
    conversationIds: allConversationIds,
    activeConversationId: sessionDetail?.conversation.id,
  })
  const unreadCountByGroupIdWithServer = useMemo(() => {
    const merged: Record<string, number> = { ...unreadCountByGroupId }
    for (const group of groups) {
      const serverUnread = (sessionsByGroupId[group.conversation.id] ?? [])
        .reduce((count, session) => count + (unreadByConversationId[session.conversation.id] ?? 0), 0)
      if (serverUnread > 0) {
        merged[group.conversation.id] = Math.max(merged[group.conversation.id] ?? 0, serverUnread)
      }
    }
    return merged
  }, [groups, sessionsByGroupId, unreadByConversationId, unreadCountByGroupId])

  const pushMentionUnread = useCallback((sessionId: string, messageIds: string[]) => {
    const ids = messageIds.map((id) => id.trim()).filter(Boolean)
    if (!sessionId.trim() || ids.length === 0) return
    setMentionUnreadBySessionId((current) => {
      const existing = current[sessionId] ?? []
      const nextIds = ids.filter((id) => !existing.includes(id))
      if (nextIds.length === 0) return current
      return { ...current, [sessionId]: [...existing, ...nextIds] }
    })
  }, [])

  const ackSessionMentions = useCallback((sessionId: string, seenUntil?: string) => {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) return
    mentionSeenRef.current = {
      ...mentionSeenRef.current,
      [normalizedSessionId]: seenUntil?.trim() || new Date().toISOString(),
    }
    writeGroupChatMentionSeen(mentionSeenRef.current)
    setMentionUnreadBySessionId((current) => {
      if (!current[normalizedSessionId]?.length) return current
      const next = { ...current }
      delete next[normalizedSessionId]
      return next
    })
  }, [])

  const mentionUnreadIds = mentionUnreadBySessionId[selectedSessionId] ?? []
  const mentionUnreadByGroupId = useMemo(() => {
    const result: Record<string, number> = {}
    for (const group of groups) {
      const count = (sessionsByGroupId[group.conversation.id] ?? []).reduce((sum, session) => (
        sum + (mentionUnreadBySessionId[session.conversation.id]?.length ?? 0)
      ), 0)
      if (count > 0) result[group.conversation.id] = count
    }
    return result
  }, [groups, mentionUnreadBySessionId, sessionsByGroupId])

  const jumpToMention = useCallback(() => {
    const firstId = mentionUnreadBySessionId[selectedSessionId]?.[0]
    if (!firstId) return
    const target = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(firstId)}"]`)
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    const first = sessionDetail?.messages.find((message) => message.id === firstId)
    ackSessionMentions(selectedSessionId, first?.createdAt)
  }, [ackSessionMentions, mentionUnreadBySessionId, scrollRef, selectedSessionId, sessionDetail?.messages])

  /** 回复态：被回复消息的发送者标签（composer 顶部提示条用）。 */
  const replyTargetLabel = useMemo(() => {
    if (!replyToMessageId || !sessionDetail) {
      return ''
    }
    const target = sessionDetail.messages.find((message) => message.id === replyToMessageId)
    return target ? getMessageSenderLabel(detail, options, target, language) : ''
  }, [detail, language, options, replyToMessageId, sessionDetail])

  const visibleMessages = useMemo(() => {
    const baseMessages = sessionDetail?.messages ?? []
    if (streamingReplies.length === 0) {
      return baseMessages
    }

    return [
      ...baseMessages,
      ...streamingReplies.map((reply, index) => {
        const agent = options.agents.find((item) => item.id === reply.agentId)
        return {
          id: `streaming-agent:${reply.agentId}:${index}`,
          conversationId: sessionDetail?.conversation.id || '',
          role: 'assistant' as const,
          senderId: reply.agentId,
          content: reply.content,
          contentType: 'text' as const,
          createdAt: new Date().toISOString(),
          externalRef: {
            agentId: reply.agentId,
            agentName: agent?.name || text(language, 'Agent', 'Agent'),
            toolCalls: reply.toolCalls,
            streaming: true,
          },
        }
      }),
    ]
  }, [language, options.agents, sessionDetail?.conversation.id, sessionDetail?.messages, streamingReplies])

  const loadWorkspaces = useCallback(async (preferredWorkspaceId?: string) => {
    // 路由重挂载时先用缓存种出工作区列表，后台静默刷新保持最新。
    const cachedWorkspaces = readCollaborationWorkspacesCache(collaborationWorkspacesCache)
    if (cachedWorkspaces) {
      setWorkspaces(cachedWorkspaces)
    }
    setLoading(true)
    try {
      const response = await api.listCollaborationWorkspaces()
      writeCollaborationWorkspacesCache(collaborationWorkspacesCache, response.workspaces)
      setWorkspaces(response.workspaces)
      setSelectedWorkspaceId((current) => resolveCollaborationWorkspaceId(
        response.workspaces,
        preferredWorkspaceId
          || current
          || persistedPreferencesRef.current.workspaceId
          || getStoredCollaborationWorkspaceId(),
      ))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '组织加载失败', 'Failed to load workspaces'))
    } finally {
      setLoading(false)
    }
  }, [language])

  const clearWorkspaceScopedState = useCallback(() => {
    // 切换协作空间时清空上一空间的聊天对象（群/成员/详情/会话）与选中态，避免串空间。
    setOptions(EMPTY_OPTIONS)
    setGroups([])
    setDetail(null)
    setSessions([])
    setSessionsByGroupId({})
    setSessionDetail(null)
    setSelectedGroupId('')
    setSelectedSessionId('')
    setWorkspaceGroups([])
  }, [])

  const loadWorkspaceData = async (workspaceId: string) => {
    const workspaceChanged = loadedWorkspaceIdRef.current !== workspaceId
    loadedWorkspaceIdRef.current = workspaceId
    if (workspaceChanged) {
      clearWorkspaceScopedState()
    }
    if (!workspaceId) {
      return
    }

    setLoading(true)
    try {
      // 路由重挂载时先用缓存种出群列表，避免「群聊」分区空一下再弹出。
      const cachedGroups = readWorkspaceChatGroupsCache(workspaceChatGroupsCache, workspaceId)
      if (cachedGroups) {
        setGroups(cachedGroups)
      }
      const [optionsResponse, groupsResponse, groupsResult] = await Promise.all([
        api.getWorkspaceChatGroupOptions(workspaceId),
        api.listWorkspaceChatGroups(workspaceId),
        api.listWorkspaceGroups(workspaceId).catch(() => null),
      ])
      setWorkspaceGroups(groupsResult?.groups ?? [])
      setOptions({
        members: optionsResponse.members,
        executors: optionsResponse.executors,
        agents: optionsResponse.agents.filter((agent) => agent.kind !== 'primary'),
      })
      writeWorkspaceChatGroupsCache(workspaceChatGroupsCache, workspaceId, groupsResponse.groups)
      setGroups(groupsResponse.groups)
      const sessionEntries = await Promise.all(groupsResponse.groups.map(async (group) => {
        const response = await api.listWorkspaceChatGroupSessions(workspaceId, group.conversation.id)
        return [group.conversation.id, response.sessions] as const
      }))
      const nextSessionsByGroupId = Object.fromEntries(sessionEntries)
      setSessionsByGroupId(nextSessionsByGroupId)
      if (selectedGroupId && nextSessionsByGroupId[selectedGroupId]) {
        setSessions(nextSessionsByGroupId[selectedGroupId])
      }
      initializeReadMessageCounts(workspaceId, Object.values(nextSessionsByGroupId).flat())
      setSelectedGroupId((current) => {
        if (groupsResponse.groups.some((group) => group.conversation.id === current)) {
          return current
        }
        const persistedGroupId = getPersistedWorkspaceGroupId(persistedPreferencesRef.current, workspaceId)
        if (persistedGroupId && groupsResponse.groups.some((group) => group.conversation.id === persistedGroupId)) {
          return persistedGroupId
        }
        return groupsResponse.groups[0]?.conversation.id || ''
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '群聊数据加载失败', 'Failed to load workspace groups'))
    } finally {
      setLoading(false)
    }
  }

  const loadGroupDetail = async (workspaceId: string, groupId: string) => {
    if (!workspaceId || !groupId) {
      setDetail(null)
      setSessions([])
      setSessionDetail(null)
      return
    }

    try {
      const [response, sessionsResponse] = await Promise.all([
        api.getWorkspaceChatGroupDetail(workspaceId, groupId),
        api.listWorkspaceChatGroupSessions(workspaceId, groupId),
      ])
      setDetail(response.detail)
      setSessions(sessionsResponse.sessions)
      setSessionsByGroupId((current) => ({
        ...current,
        [groupId]: sessionsResponse.sessions,
      }))
      setSelectedSessionId((current) => {
        if (sessionsResponse.sessions.some((session) => session.conversation.id === current)) {
          return current
        }
        const persistedSessionId = getPersistedWorkspaceGroupSessionId(persistedPreferencesRef.current, groupId)
        if (persistedSessionId && sessionsResponse.sessions.some((session) => session.conversation.id === persistedSessionId)) {
          return persistedSessionId
        }
        return sessionsResponse.sessions[0]?.conversation.id || ''
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '群聊详情加载失败', 'Failed to load group detail'))
    }
  }

  const loadSessionDetail = useCallback(async (
    workspaceId: string,
    groupId: string,
    sessionId: string,
    options?: {
      beforeMessageId?: string
      limit?: number
      mode?: 'replace' | 'prepend'
    },
  ) => {
    if (!workspaceId || !groupId || !sessionId) {
      setSessionDetail(null)
      return
    }

    try {
      if (options?.mode !== 'prepend') {
        setSessionDetail((current) => current?.conversation.id === sessionId ? current : null)
      }

      const requestId = ++sessionRequestIdRef.current
      const response = await api.getWorkspaceChatGroupSessionDetail(workspaceId, groupId, sessionId, {
        beforeMessageId: options?.beforeMessageId,
        limit: options?.limit ?? INITIAL_SESSION_MESSAGE_LIMIT,
      })
      if (requestId !== sessionRequestIdRef.current) {
        return
      }

      setSessionDetail((current) => {
        if (options?.mode === 'prepend' && current?.conversation.id === response.detail.conversation.id) {
          return {
            ...response.detail,
            messages: mergeConversationMessages(current.messages, response.detail.messages),
          }
        }

        return response.detail
      })

      // feature P2：打开会话 → 推进服务端已读游标（多设备同步）。
      if (options?.mode !== 'prepend' && response.detail.messages.length > 0) {
        const latestMessage = response.detail.messages[response.detail.messages.length - 1]
        void markConversationRead(response.detail.conversation.id, latestMessage.createdAt)
      }
      if (options?.mode !== 'prepend') {
        pushMentionUnread(
          response.detail.conversation.id,
          collectUnackedMentionIds(
            response.detail.messages,
            userIdRef.current,
            mentionSeenRef.current[response.detail.conversation.id],
          ),
        )
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '群聊会话加载失败', 'Failed to load group session'))
    }
  }, [language, pushMentionUnread])

  /** 消息表情回复/点赞 toggle（R8.1）：乐观更新 + 服务端确认 + 失败回滚。 */
  const toggleReaction = useCallback(async (messageId: string, emoji: string, active: boolean) => {
    const conversationId = sessionDetail?.conversation.id
    const currentUserId = user?.id
    if (!conversationId || !currentUserId) {
      return
    }

    setSessionDetail((current) => current
      ? {
          ...current,
          messages: current.messages.map((message) => (
            message.id === messageId
              ? { ...message, reactions: toggleMessageReaction(message.reactions, emoji, currentUserId, active) }
              : message
          )),
        }
      : current)

    try {
      const result = await api.toggleConversationMessageReaction(conversationId, messageId, { emoji, active })
      setSessionDetail((current) => current
        ? {
            ...current,
            messages: current.messages.map((message) => (
              message.id === messageId ? { ...message, reactions: result.reactions } : message
            )),
          }
        : current)
    } catch (error) {
      setSessionDetail((current) => current
        ? {
            ...current,
            messages: current.messages.map((message) => (
              message.id === messageId
                ? { ...message, reactions: toggleMessageReaction(message.reactions, emoji, currentUserId, !active) }
                : message
            )),
          }
        : current)
      toast.error(error instanceof Error ? error.message : text(language, '表情回复失败', 'Failed to react'))
    }
  }, [language, sessionDetail?.conversation.id, user?.id])

  /** R8.2-C：选择文件 → 上传到 Drive → 作为引用附件发到群聊会话。 */
  const handleAttachFile = useCallback(async (file: File) => {
    if (!selectedWorkspaceId || !selectedGroupId || !selectedSessionId || attaching) {
      return
    }
    setAttaching(true)
    try {
      const uploaded = await api.uploadDriveFile(selectedWorkspaceId, file)
      await api.sendDriveFileToGroupChat(
        selectedWorkspaceId,
        selectedGroupId,
        selectedSessionId,
        uploaded.file.id,
      )
      await loadSessionDetail(selectedWorkspaceId, selectedGroupId, selectedSessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '附件上传失败', 'Failed to attach file'))
    } finally {
      setAttaching(false)
    }
  }, [attaching, language, loadSessionDetail, selectedGroupId, selectedSessionId, selectedWorkspaceId])

  /** 群聊会话实时订阅（R8.4，统一客户端）：新消息/表情变化增量合并进当前会话。 */
  useRealtimeActiveView({ conversationId: sessionDetail?.conversation.id })
  useRealtimeConversation(sessionDetail?.conversation.id, {
    onEvent: (event: ConversationWsEvent) => {
      if (event.type === 'message.created') {
        const message = event.payload.message as { id?: string; conversationId?: string; role?: string; content?: string; createdAt?: string } | undefined
        if (!message?.id || !message.conversationId || typeof message.role !== 'string') {
          return
        }
        setSessionDetail((current) => {
          if (!current || current.conversation.id !== message.conversationId) {
            return current
          }
          if (current.messages.some((item) => item.id === message.id)) {
            return current
          }
          return {
            ...current,
            messages: reconcileGroupRealtimeMessage(current.messages, message as never),
          }
        })
        return
      }

      if (event.type === 'message.reaction.changed') {
        const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : ''
        const reactions = Array.isArray(event.payload.reactions) ? event.payload.reactions : []
        if (!messageId) {
          return
        }
        setSessionDetail((current) => current
          ? {
              ...current,
              messages: current.messages.map((message) => (
                message.id === messageId ? { ...message, reactions } : message
              )),
            }
          : current)
      }
    },
    onNeedsRefresh: () => {
      if (selectedWorkspaceId && selectedGroupId && selectedSessionId) {
        void loadSessionDetail(selectedWorkspaceId, selectedGroupId, selectedSessionId)
      }
    },
  })

  // 所有群会话都订阅：未打开的会话被 @ 时也能在 /chat 侧栏和消息页亮起「有人 @ 你」。
  useEffect(() => {
    const cleanups = mentionSubscriptionCleanupsRef.current
    const desiredIds = new Set(allConversationIds)
    for (const [conversationId, cleanup] of cleanups) {
      if (!desiredIds.has(conversationId)) {
        cleanup()
        cleanups.delete(conversationId)
      }
    }
    for (const conversationId of desiredIds) {
      if (cleanups.has(conversationId)) continue
      cleanups.set(conversationId, realtimeClient.subscribeConversation(conversationId, {
        onEvent: (event) => {
          if (event.type !== 'message.created') return
          const message = event.payload.message as {
            id?: string
            senderId?: string
            createdAt?: string
            externalRef?: Record<string, unknown>
          } | undefined
          if (!message?.id || !messageMentionsUserId(message, userIdRef.current)) return
          const seenUntil = mentionSeenRef.current[conversationId]
          if (seenUntil && message.createdAt && message.createdAt <= seenUntil) return
          pushMentionUnread(conversationId, [message.id])
        },
      }))
    }
  }, [allConversationIds, pushMentionUnread])

  useEffect(() => {
    const cleanups = mentionSubscriptionCleanupsRef.current
    return () => {
      for (const cleanup of cleanups.values()) cleanup()
      cleanups.clear()
    }
  }, [])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    setSelectedWorkspaceId((current) => resolveCollaborationWorkspaceId(
      workspaces,
      persistedPreferencesRef.current.workspaceId || getStoredCollaborationWorkspaceId() || current,
    ))
  }, [workspaces])

  useEffect(() => {
    void loadWorkspaceData(selectedWorkspaceId)
  }, [selectedWorkspaceId])

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadWorkspaceData(selectedWorkspaceId)
    }, GROUP_CHAT_SUMMARY_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [selectedGroupId, selectedWorkspaceId])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId
      const requestedId = workspaceId || getStoredCollaborationWorkspaceId()

      // 目标空间不在当前列表：先清空旧空间聊天对象，拉取最新列表后再切，避免闪到错误空间。
      if (requestedId && !workspaces.some((workspace) => workspace.id === requestedId)) {
        loadedWorkspaceIdRef.current = ''
        clearWorkspaceScopedState()
        void loadWorkspaces(requestedId)
        return
      }

      const resolvedWorkspaceId = resolveCollaborationWorkspaceId(workspaces, requestedId)
      if (resolvedWorkspaceId !== loadedWorkspaceIdRef.current) {
        // 同步清空旧空间的群/成员/详情/会话，防止 loadGroupDetail 用旧 groupId 在新空间加载。
        clearWorkspaceScopedState()
      }
      setSelectedWorkspaceId(resolvedWorkspaceId)
    }

    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => {
      window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    }
  }, [clearWorkspaceScopedState, loadWorkspaces, workspaces])

  useEffect(() => {
    void loadGroupDetail(selectedWorkspaceId, selectedGroupId)
  }, [selectedGroupId, selectedWorkspaceId])

  useEffect(() => {
    void loadSessionDetail(selectedWorkspaceId, selectedGroupId, selectedSessionId)
  }, [loadSessionDetail, selectedGroupId, selectedSessionId, selectedWorkspaceId])

  useEffect(() => {
    const selectedSession = sessions.find((session) => session.conversation.id === selectedSessionId)
    if (!selectedSession) {
      return
    }

    updatePersistedPreferences((current) => setPersistedWorkspaceGroupChatSessionReadMessageCount(
      current,
      selectedSession.conversation.id,
      selectedSession.messageCount,
    ))
  }, [selectedSessionId, sessions, updatePersistedPreferences])

  useEffect(() => {
    setActiveResponderAgentId('')
  }, [selectedSessionId])

  useEffect(() => {
    updatePersistedPreferences((current) => setPersistedWorkspaceGroupChatWorkspace(current, selectedWorkspaceId))
  }, [selectedWorkspaceId, updatePersistedPreferences])

  useEffect(() => {
    updatePersistedPreferences((current) => setPersistedWorkspaceGroupChatGroup(
      current,
      selectedWorkspaceId,
      selectedGroupId,
    ))
  }, [selectedGroupId, selectedWorkspaceId, updatePersistedPreferences])

  useEffect(() => {
    updatePersistedPreferences((current) => setPersistedWorkspaceGroupChatSession(
      current,
      selectedGroupId,
      selectedSessionId,
    ))
  }, [selectedGroupId, selectedSessionId, updatePersistedPreferences])

  useLayoutEffect(() => {
    if (!sessionDetail?.conversation.id) {
      return
    }

    resumeAutoScroll()
    scrollToBottom('instant')
  }, [resumeAutoScroll, scrollToBottom, sessionDetail?.conversation.id])

  useLayoutEffect(() => {
    const pendingRestore = transcriptWindowRestoreRef.current
    if (!pendingRestore) {
      return
    }

    const node = scrollRef.current
    if (!node) {
      transcriptWindowRestoreRef.current = null
      return
    }

    const heightDelta = node.scrollHeight - pendingRestore.previousHeight
    node.scrollTop = pendingRestore.previousTop + heightDelta
    transcriptWindowRestoreRef.current = null
  }, [scrollRef, visibleMessages.length])

  useEffect(() => {
    autoScrollToBottom(streamingReplies.length > 0 ? 'smooth' : 'instant')
  }, [autoScrollToBottom, streamingReplies, visibleMessages.length])

  const handleCreateGroup = async () => {
    if (!selectedWorkspaceId || !draft.title.trim() || draft.agentMemberIds.length === 0) {
      toast.error(text(language, '请完整填写群聊配置。', 'Please complete the group configuration.'))
      return
    }

    setCreateBusy(true)
    try {
      const response = await api.createWorkspaceChatGroup(selectedWorkspaceId, {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        userMemberIds: draft.userMemberIds,
        agentMemberIds: draft.agentMemberIds,
      })
      setCreateOpen(false)
      setDraft(createInitialDraft())
      await loadWorkspaceData(selectedWorkspaceId)
      setSelectedGroupId(response.detail.conversation.id)
      setDetail(response.detail)
      setSessions([])
      setSessionDetail(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '创建群聊失败', 'Failed to create group'))
    } finally {
      setCreateBusy(false)
    }
  }

  const { confirm } = useAppDialog()

  /** 会话置顶 / 取消置顶（群聊子会话）。 */
  const handleToggleSessionPinned = async (conversationId: string, pinned: boolean) => {
    try {
      const response = await api.updateConversationPinned(conversationId, pinned)
      setSessions((current) => current.map((item) => (
        item.conversation.id === conversationId
          ? { ...item, conversation: response.conversation }
          : item
      )))
      toast.success(pinned
        ? text(language, '会话已置顶', 'Session pinned')
        : text(language, '会话已取消置顶', 'Session unpinned'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新置顶失败', 'Failed to update pin'))
    }
  }

  /** 删除群聊子会话（带确认）。 */
  const handleDeleteSession = async (conversationId: string) => {
    const confirmed = await confirm({
      title: text(language, '删除这个会话？', 'Delete this session?'),
      description: text(language, '会话与其中所有消息将被删除，且不可恢复。', 'The session and all its messages will be deleted permanently.'),
      confirmText: text(language, '删除会话', 'Delete session'),
      cancelText: text(language, '取消', 'Cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }
    try {
      await api.deleteConversation(conversationId)
      setSessions((current) => current.filter((item) => item.conversation.id !== conversationId))
      if (selectedSessionId === conversationId) {
        setSelectedSessionId('')
        setSessionDetail(null)
      }
      toast.success(text(language, '会话已删除', 'Session deleted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '删除会话失败', 'Failed to delete session'))
    }
  }

  const handleCreateSession = async () => {
    if (!selectedWorkspaceId || !selectedGroupId) {
      return
    }

    try {
      const response = await api.createWorkspaceChatGroupSession(selectedWorkspaceId, selectedGroupId, {})
      await loadGroupDetail(selectedWorkspaceId, selectedGroupId)
      setSelectedSessionId(response.detail.conversation.id)
      setSessionDetail(response.detail)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '创建群聊会话失败', 'Failed to create group session'))
    }
  }

  const applyGroupDetail = (nextDetail: WorkspaceChatGroupDetail) => {
    setDetail(nextDetail)
    setGroups((current) => current.map((group) => group.conversation.id === nextDetail.conversation.id
      ? {
          ...group,
          conversation: nextDetail.conversation,
          members: nextDetail.members,
        }
      : group))
  }

  const handleUpdateGroupTitle = async (title: string) => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    setSettingsBusyKey('title')
    try {
      const response = await api.updateWorkspaceChatGroup(selectedWorkspaceId, selectedGroupId, { title })
      applyGroupDetail(response.detail)
      toast.success(text(language, '群名称已更新。', 'Group name updated.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新群名称失败', 'Failed to update group name'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleUpdateGroupDescription = async (description: string) => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    setSettingsBusyKey('description')
    try {
      const response = await api.updateWorkspaceChatGroup(selectedWorkspaceId, selectedGroupId, { description })
      applyGroupDetail(response.detail)
      toast.success(text(language, '群简介已更新。', 'Group description updated.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新群简介失败', 'Failed to update group description'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleUpdateGroupAnnouncement = async (announcement: string) => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    setSettingsBusyKey('announcement')
    try {
      const response = await api.updateWorkspaceChatGroup(selectedWorkspaceId, selectedGroupId, { announcement })
      applyGroupDetail(response.detail)
      toast.success(text(language, '群公告已更新。', 'Group announcement updated.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更新群公告失败', 'Failed to update group announcement'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleAddGroupMember = async (memberType: 'user' | 'agent', memberId: string) => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    const key = `add:${memberType}:${memberId}`
    setSettingsBusyKey(key)
    try {
      const response = await api.addWorkspaceChatGroupMember(selectedWorkspaceId, selectedGroupId, { memberType, memberId })
      applyGroupDetail(response.detail)
      toast.success(text(language, '成员已添加。', 'Member added.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '添加成员失败', 'Failed to add member'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleRemoveGroupMember = async (memberType: 'user' | 'agent', memberId: string) => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    const key = `remove:${memberType}:${memberId}`
    setSettingsBusyKey(key)
    try {
      const response = await api.removeWorkspaceChatGroupMember(selectedWorkspaceId, selectedGroupId, memberType, memberId)
      applyGroupDetail(response.detail)
      toast.success(text(language, '成员已移除。', 'Member removed.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '移除成员失败', 'Failed to remove member'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleLeaveGroup = async () => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    setSettingsBusyKey('leave')
    try {
      await api.leaveWorkspaceChatGroup(selectedWorkspaceId, selectedGroupId)
      toast.success(text(language, '已退出群聊。', 'Left the group.'))
      setSettingsOpen(false)
      setDetail(null)
      setSelectedGroupId('')
      await loadWorkspaceData(selectedWorkspaceId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '退出群聊失败', 'Failed to leave group'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleDeleteGroup = async () => {
    if (!selectedWorkspaceId || !selectedGroupId) return
    setSettingsBusyKey('disband')
    try {
      await api.deleteWorkspaceChatGroup(selectedWorkspaceId, selectedGroupId)
      toast.success(text(language, '群聊已解散。', 'Group disbanded.'))
      setSettingsOpen(false)
      setDetail(null)
      setSelectedGroupId('')
      await loadWorkspaceData(selectedWorkspaceId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '解散群聊失败', 'Failed to disband group'))
    } finally {
      setSettingsBusyKey('')
    }
  }

  const handleSend = async () => {
    const message = input.trim()
    if (!message || !selectedWorkspaceId || !selectedGroupId || !selectedSessionId || sending || !detail || !sessionDetail) {
      return
    }

    const replyTo = replyToMessageId.trim() || undefined
    const clientMessageId = crypto.randomUUID()
    const optimisticUserMessage = {
      id: `user-${clientMessageId}`,
      conversationId: sessionDetail.conversation.id,
      role: 'user' as const,
      senderId: user?.id || '__me__',
      content: message,
      contentType: 'text' as const,
      ...(replyTo ? { replyToMessageId: replyTo } : {}),
      createdAt: new Date().toISOString(),
      externalRef: { senderName: text(language, '我', 'Me') },
    }

    setInput('')
    resumeAutoScroll()
    setSending(true)
    const groupAgentIds = new Set(detail.members
      .filter((member) => member.memberType === 'agent')
      .map((member) => member.memberId))
    const mentionedAgents = getMentionedWorkspaceGroupAgents(
      message,
      options.agents.filter((agent) => groupAgentIds.has(agent.id)),
    )
    const mentionedAgent = mentionedAgents[0]
    const groupUserIds = new Set(detail.members
      .filter((member) => member.memberType === 'user')
      .map((member) => member.memberId))
    const mentionedUserIds = resolveChatMentionTargetIds(
      message,
      options.members.filter((member) => groupUserIds.has(member.id)),
    )
    const notifiedUserIds = mentionedUserIds.filter((memberId) => memberId !== user?.id)
    setActiveResponderAgentId(mentionedAgent?.id || '')
    setStreamStatus(mentionedAgent
      ? `${mentionedAgent.name} ${text(language, '正在分析上下文...', 'is analyzing context...')}`
      : notifiedUserIds.length > 0
        ? text(language, '正在发送提及通知...', 'Sending mention notifications...')
        : text(language, '正在发送消息...', 'Sending message...'))
    if (mentionedAgent) {
      setSessionExecutionById((current) => ({
        ...current,
        [selectedSessionId]: {
          groupId: selectedGroupId,
          label: `${mentionedAgent.name} ${text(language, '正在分析...', 'is analyzing...')}`,
        },
      }))
    }
    setStreamingReplies([])
    const upsertStreamingReply = (
      agentId: string,
      updater: (reply: StreamingAgentReply) => StreamingAgentReply,
    ) => {
      setStreamingReplies((current) => {
        const index = current.findIndex((reply) => reply.agentId === agentId)
        if (index === -1) {
          return [...current, updater({ agentId, content: '', toolCalls: [] })]
        }

        return current.map((reply, replyIndex) => replyIndex === index ? updater(reply) : reply)
      })
    }
    setSessionDetail((current) => current
      ? {
          ...current,
          messages: [...current.messages, optimisticUserMessage],
          totalMessageCount: current.totalMessageCount + 1,
          returnedMessageCount: current.returnedMessageCount + 1,
        }
      : current)

    try {
      const result = await api.streamWorkspaceChatGroupMessage(
        selectedWorkspaceId,
        selectedGroupId,
        selectedSessionId,
        {
          message,
          ...(replyTo ? { replyToMessageId: replyTo } : {}),
          clientMessageId,
        },
        (event) => {
          if (event.agentId) {
            setActiveResponderAgentId(event.agentId)
          }

          if (event.type === 'status') {
            setStreamStatus(event.currentStep || event.content)
            setSessionExecutionById((current) => ({
              ...current,
              [selectedSessionId]: {
                groupId: selectedGroupId,
                label: event.currentStep || event.content,
              },
            }))
            const statusAgentId = event.agentId?.trim()
            if (statusAgentId) {
              upsertStreamingReply(statusAgentId, (reply) => reply)
            }
            return
          }

          if (event.type === 'delta') {
            const respondingAgent = options.agents.find((agent) => agent.id === event.agentId) || mentionedAgent
            const responseStatus = `${respondingAgent?.name || text(language, 'Agent', 'Agent')} ${text(language, '正在回复...', 'is responding...')}`
            setStreamStatus(responseStatus)
            setSessionExecutionById((current) => ({
              ...current,
              [selectedSessionId]: {
                groupId: selectedGroupId,
                label: responseStatus,
              },
            }))
            const agentId = event.agentId || respondingAgent?.id || ''
            if (agentId) {
              upsertStreamingReply(agentId, (reply) => ({
                ...reply,
                content: reply.content + event.content,
              }))
            }
            return
          }

          if (event.type === 'tool' && event.toolCall) {
            const toolCall = event.toolCall
            const toolAgentId = event.agentId || mentionedAgent?.id || ''
            if (toolAgentId) {
              upsertStreamingReply(toolAgentId, (reply) => ({
                ...reply,
                toolCalls: [...reply.toolCalls, toolCall],
              }))
            }
            return
          }

          if (event.type === 'done') {
            setStreamStatus(event.currentStep || text(language, '已完成', 'Completed'))
            return
          }

          if (event.type === 'error') {
            setStreamStatus(text(language, '回复失败', 'Failed'))
          }
        },
      )

      if (!result.ok) {
        throw new Error(result.output)
      }

      setReplyToMessageId('')
      await loadWorkspaceData(selectedWorkspaceId)
      await loadGroupDetail(selectedWorkspaceId, selectedGroupId)
      await loadSessionDetail(selectedWorkspaceId, selectedGroupId, selectedSessionId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '发送群聊消息失败', 'Failed to send group message'))
      await loadGroupDetail(selectedWorkspaceId, selectedGroupId)
      await loadSessionDetail(selectedWorkspaceId, selectedGroupId, selectedSessionId)
    } finally {
      setStreamingReplies([])
      setSessionExecutionById((current) => {
        const { [selectedSessionId]: _finishedSession, ...remainingSessions } = current
        return remainingSessions
      })
      setSending(false)
    }
  }

  const loadOlderMessages = useCallback(async () => {
    if (
      loadingOlderMessages
      || !selectedWorkspaceId
      || !selectedGroupId
      || !selectedSessionId
      || !sessionDetail?.hasMoreBefore
      || !sessionDetail.messages[0]?.id
    ) {
      return
    }

    const node = scrollRef.current
    if (node) {
      transcriptWindowRestoreRef.current = {
        previousHeight: node.scrollHeight,
        previousTop: node.scrollTop,
      }
    }

    setLoadingOlderMessages(true)
    try {
      await loadSessionDetail(selectedWorkspaceId, selectedGroupId, selectedSessionId, {
        beforeMessageId: sessionDetail.messages[0].id,
        limit: INITIAL_SESSION_MESSAGE_LIMIT,
        mode: 'prepend',
      })
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [
    loadSessionDetail,
    loadingOlderMessages,
    scrollRef,
    selectedGroupId,
    selectedSessionId,
    selectedWorkspaceId,
    sessionDetail,
  ])

  return {
    activeResponderAgent,
    createBusy,
    createOpen,
    detail,
    draft,
    groups,
    handleCreateGroup,
    handleCreateSession,
    handleDeleteSession,
    handleToggleSessionPinned,
    handleAddGroupMember,
    handleRemoveGroupMember,
    handleLeaveGroup,
    handleDeleteGroup,
    handleSend,
    handleUpdateGroupTitle,
    handleUpdateGroupDescription,
    handleUpdateGroupAnnouncement,
    input,
    loading,
    loadingOlderMessages,
    options,
    workspaceGroups,
    loadOlderMessages,
    scrollRef,
    scrollShortcutTarget,
    scrollToTop,
    scrollToBottom,
    selectedSessionId,
    selectedGroupId,
    selectedWorkspace,
    selectedWorkspaceId,
    settingsBusyKey,
    settingsOpen,
    sending,
    sessionExecutionById,
    setCreateOpen,
    setDraft,
    setInput,
    setReplyToMessageId,
    setSettingsOpen,
    setSelectedGroupId,
    setSelectedSessionId,
    sessionDetail,
    sessions,
    sessionsByGroupId,
    showJumpToBottom,
    streamStatus,
    toggleReaction,
    replyToMessageId,
    replyTargetLabel,
    attaching,
    handleAttachFile,
    unreadCountByGroupId: unreadCountByGroupIdWithServer,
    unreadCountBySessionId,
    mentionUnreadIds,
    mentionUnreadBySessionId,
    mentionUnreadByGroupId,
    jumpToMention,
    updateStickiness,
    visibleMessages,
  }
}

export type WorkspaceGroupChatState = ReturnType<typeof useWorkspaceGroupChatState>

export function WorkspaceGroupMainPanel(props: {
  groupState: WorkspaceGroupChatState
  language: Language
  isMobile?: boolean
  onBackToList?: () => void
  /** 从群成员卡片发起私聊：ensureDm + 切到 DM。 */
  onStartDm?: (userId: string) => Promise<string>
}) {
  const { groupState, language, isMobile = false, onBackToList, onStartDm } = props
  const { user } = useAuth()
  const [shareOpen, setShareOpen] = useState(false)
  const [announcementCollapsed, setAnnouncementCollapsed] = useState(false)

  // 悬浮输入区高度 → 消息区底部内边距（飞书式：输入框浮在会话上方）
  const [composerAreaHeight, setComposerAreaHeight] = useState(0)
  const loadOlderSentinelRef = useRef<HTMLDivElement | null>(null)
  const detail = groupState.detail
  const sessionDetail = groupState.sessionDetail
  const { toggleReaction, replyToMessageId, setReplyToMessageId, replyTargetLabel } = groupState
  const attachFileInputRef = useRef<HTMLInputElement | null>(null)
  // @文档 候选：输入 @ 后按 query 异步搜索组织 + 个人 Drive（query 为空显示最近文件）
  const [mentionQuery, setMentionQuery] = useState('')
  const [driveMentionOptions, setDriveMentionOptions] = useState<ChatMentionOption[]>([])
  useEffect(() => {
    const workspaceId = groupState.selectedWorkspaceId
    if (!workspaceId) {
      setDriveMentionOptions([])
      return
    }
    let cancelled = false
    void (async () => {
      const [team, mine] = await Promise.all([
        api.searchTeamDrive(workspaceId, mentionQuery).catch(() => ({ results: [] })),
        api.searchMyDrive(mentionQuery).catch(() => ({ results: [] })),
      ])
      if (cancelled) return
      setDriveMentionOptions(
        [...team.results, ...mine.results]
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
  }, [groupState.selectedWorkspaceId, language, mentionQuery])
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
  const currentUserId = user?.id?.trim() || ''
  const canManageGroup = Boolean(currentUserId && detail?.members.some((member) => (
    member.memberType === 'user'
    && member.memberId === currentUserId
    && member.role === 'owner'
  )))
  const announcementAuthorName = useMemo(() => {
    const updatedBy = detail?.conversation.announcementUpdatedBy?.trim()
    if (!updatedBy) return ''
    return groupState.options.members.find((member) => member.id === updatedBy)?.name || ''
  }, [detail?.conversation.announcementUpdatedBy, groupState.options.members])
  const activeResponderAgent = groupState.activeResponderAgent
  const activeResponderLabel = activeResponderAgent?.name || text(language, 'Agent', 'Agent')
  const activeResponderAvatarUrl = activeResponderAgent?.avatarUrl?.trim() || undefined
  const memberAvatarById = useMemo(() => {
    return new Map(
      groupState.options.members.map((member) => [member.id, member.avatarUrl?.trim() || undefined] as const),
    )
  }, [groupState.options.members])
  const memberMentionTargets = useMemo<ChatMentionTarget[]>(() => {
    if (!detail) {
      return []
    }
    const membersById = new Map(groupState.options.members.map((member) => [member.id, member] as const))
    return detail.members.flatMap((member) => {
      if (member.memberType !== 'user') {
        return []
      }
      const workspaceMember = membersById.get(member.memberId)
      if (!workspaceMember) {
        return []
      }
      const target: ChatMentionTarget = {
        id: workspaceMember.id,
        name: workspaceMember.name,
        ...(workspaceMember.avatarUrl?.trim() ? { avatarUrl: workspaceMember.avatarUrl.trim() } : {}),
      }
      return [target]
    })
  }, [detail, groupState.options.members])
  const mentionOptions = useMemo<ChatMentionOption[]>(() => {
    if (!detail) {
      return []
    }

    const membersById = new Map(groupState.options.members.map((member) => [member.id, member] as const))
    const agentsById = new Map(groupState.options.agents.map((agent) => [agent.id, agent] as const))

    const memberOptions = detail.members.reduce<ChatMentionOption[]>((items, member) => {
      if (member.memberType === 'agent') {
        const agent = agentsById.get(member.memberId)
        if (!agent) {
          return items
        }

        items.push({
          id: `agent:${agent.id}`,
          kind: 'agent' as const,
          label: agent.name,
          description: agent.role,
          avatarUrl: agent.avatarUrl?.trim() || undefined,
          kindLabel: text(language, 'Agent', 'Agent'),
          keywords: [agent.name, agent.role, agent.status, agent.kind],
        })
        return items
      }

      const workspaceMember = membersById.get(member.memberId)
      if (!workspaceMember) {
        return items
      }

      items.push({
        id: `member:${workspaceMember.id}`,
        kind: 'member' as const,
        label: workspaceMember.name,
        description: workspaceMember.role,
        avatarUrl: workspaceMember.avatarUrl?.trim() || undefined,
        kindLabel: text(language, '成员', 'Member'),
        keywords: [workspaceMember.name, workspaceMember.email, workspaceMember.role],
      })
      return items
    }, [])

    // @会话：工作区内全部群聊会话（其他群的主/子会话也可见，服务端按工作区范围解析）。
    const allWorkspaceSessions = Object.values(groupState.sessionsByGroupId ?? {}).flat()
    const conversationOptions: ChatMentionOption[] = allWorkspaceSessions
      .map((session) => session.conversation)
      .filter((conversation) => conversation.title?.trim())
      .map((conversation) => ({
        id: `conversation:${conversation.id}`,
        kind: 'conversation' as const,
        label: conversation.title.trim(),
        description: text(language, '会话', 'Conversation'),
        kindLabel: text(language, '会话', 'Conversation'),
        keywords: [conversation.title.trim()],
      }))
    const allOption: ChatMentionOption = {
      id: 'all',
      kind: 'all',
      label: text(language, '所有人', 'Everyone'),
      description: text(language, '通知全部成员', 'Notify everyone'),
      kindLabel: text(language, '提及', 'Mention'),
      keywords: ['all', 'everyone', '所有人'],
    }
    // @组名（P2）：选择分组 → 插入 @组名，服务端展开为组内成员通知。
    const groupOptions: ChatMentionOption[] = groupState.workspaceGroups.map((group) => ({
      id: `group:${group.id}`,
      kind: 'group' as const,
      label: group.name,
      description: `${group.members.length} ${text(language, '名成员', 'members')}`,
      kindLabel: text(language, '分组', 'Group'),
      keywords: [group.name, '分组', 'group'],
    }))
    return [allOption, ...memberOptions, ...groupOptions, ...conversationOptions, ...workspaceMentionOptions, ...driveMentionOptions]
  }, [detail, driveMentionOptions, groupState.options.agents, groupState.options.members, groupState.sessionsByGroupId, groupState.workspaceGroups, language, workspaceMentionOptions])
  const conversationTurns = useMemo<ConversationTurn[]>(() => {
    const turns: ConversationTurn[] = []
    let currentTurn: ConversationTurn | null = null

    const ensureTurn = (id: string) => {
      if (!currentTurn) {
        currentTurn = {
          id,
          entries: [],
          isCurrent: false,
        }
      }

      return currentTurn
    }

    const pushCurrentTurn = () => {
      if (!currentTurn) {
        return
      }

      turns.push(currentTurn)
      currentTurn = null
    }

    // 消息引用块 + 表情回复行 + 悬停操作条（R8.1）：统一走共享组件 message-chrome，与主聊天保持一致。
    const messageById = new Map<(typeof groupState.visibleMessages)[number]['id'], (typeof groupState.visibleMessages)[number]>()
    for (const visibleMessage of groupState.visibleMessages) {
      messageById.set(visibleMessage.id, visibleMessage)
    }
    const currentUserIdForChrome = user?.id ?? ''
    const buildMessageChrome = (message: {
      id: string
      content: string
      senderId?: string
      reactions?: Array<{ emoji: string; userIds: string[] }>
      replyToMessageId?: string
    }) => sharedBuildMessageChrome({
      message,
      messageById,
      currentUserId: currentUserIdForChrome,
      getSenderLabel: (target) => getMessageSenderLabel(detail, groupState.options, target as never, language),
      toggleReaction,
      setReplyToMessageId,
      isOwn: message.senderId === currentUserIdForChrome,
    })

    for (const message of groupState.visibleMessages) {
      const senderLabel = getMessageSenderLabel(detail, groupState.options, message, language)

      if (message.role === 'user') {
        const userAvatarUrl = memberAvatarById.get(message.senderId || '')
        const isCurrentWorkspaceMember = message.senderId === '__me__'
          || Boolean(currentUserId && message.senderId === currentUserId)
        if (!isCurrentWorkspaceMember) {
          const turn = ensureTurn(`group-turn:${message.id}`)
          if (!turn.referencedDocs) {
            turn.referencedDocs = extractDocumentReferences(message)
          }
          if (!turn.conversationReferences) {
            turn.conversationReferences = extractConversationReferences(message, groupState.sessions)
          }
          turn.entries.push({
            kind: 'assistant',
            id: `group-message:${message.id}`,
            message: {
              id: message.id,
              role: 'assistant',
              text: message.content,
              authorType: 'user',
              authorId: message.senderId || undefined,
              authorName: senderLabel,
              avatarUrl: userAvatarUrl,
              ...buildMessageChrome(message),
              attachments: extractGroupMessageAttachments(message),
            },
          })
          continue
        }

        pushCurrentTurn()
        currentTurn = {
          id: `group-turn:${message.id}`,
          user: {
            id: message.id,
            role: 'user',
            text: message.content,
            authorId: user?.id,
            authorName: senderLabel,
            avatarUrl: userAvatarUrl,
            ...buildMessageChrome(message),
            attachments: extractGroupMessageAttachments(message),
          },
          // @会话引用：从 externalRef.mentions 提取 targetType=conversation
          conversationReferences: extractConversationReferences(message, groupState.sessions),
          // @文档引用：从 externalRef.referencedDocs 提取（reference_doc）
          referencedDocs: extractDocumentReferences(message),
          entries: [],
          isCurrent: false,
        }
        continue
      }

      const senderAgent = getWorkspaceGroupMessageAgent(groupState.options.agents, message)
      const messageToolCalls = Array.isArray(message.externalRef?.toolCalls)
        ? (message.externalRef.toolCalls as ToolCall[])
        : []
      const streaming = message.externalRef?.streaming === true
      pushCurrentTurn()
      currentTurn = {
        id: `group-turn:${message.id}`,
        entries: [
          ...messageToolCalls.map((toolCall) => ({
            kind: 'tool' as const,
            id: `group-tool:${message.id}:${toolCall.id}`,
            tool: toolCall,
          })),
          {
            kind: 'assistant' as const,
            id: `group-message:${message.id}`,
            message: {
              id: message.id,
              role: 'assistant',
              text: message.content,
              streaming,
              agentRunningStatus: streaming ? 'executing' : undefined,
              authorType: 'agent',
              authorId: message.senderId || undefined,
              authorName: senderLabel,
              avatarUrl: senderAgent?.avatarUrl?.trim() || undefined,
              avatarFallback: getAgentInitials(senderAgent?.name || senderLabel),
              ...buildMessageChrome(message),
              attachments: extractGroupMessageAttachments(message),
            },
          },
        ],
        isCurrent: false,
      }
    }

    // 只有本次发送真的 @ 到了 Agent（或有 Agent 回复在途）时才显示「Agent 处理中」状态气泡；
    // 未 @ 的普通消息只是落库+通知，前端不得伪造 Agent 工作状态。
    const hasAgentReplyInFlight = groupState.sending && Boolean(groupState.activeResponderAgent)

    if (currentTurn) {
      currentTurn.isCurrent = hasAgentReplyInFlight
      if (hasAgentReplyInFlight) {
        currentTurn.status = {
          status: 'thinking',
          step: groupState.streamStatus || `${activeResponderLabel} ${text(language, '处理中', 'is processing')}`,
        }
      }
      pushCurrentTurn()
    }

    if (hasAgentReplyInFlight && turns.length > 0) {
      const lastTurn = turns[turns.length - 1]
      lastTurn.isCurrent = true
      lastTurn.status = {
        status: 'thinking',
        step: groupState.streamStatus || `${activeResponderLabel} ${text(language, '处理中', 'is processing')}`,
      }
    }

    return turns
  }, [activeResponderLabel, currentUserId, detail, groupState.options, groupState.sending, groupState.streamStatus, groupState.visibleMessages, language, memberAvatarById, toggleReaction])
  const sessionTitle = sessionDetail?.conversation.title || text(language, '主会话', 'Main Session')
  const sendDisabled = groupState.sending || !groupState.input.trim()

  usePreventPullToRefresh({
    enabled: isMobile,
    scrollRef: groupState.scrollRef,
  })

  useScrollTopSentinel({
    enabled: groupState.showJumpToBottom && Boolean(sessionDetail?.hasMoreBefore) && !groupState.loadingOlderMessages,
    onTrigger: () => {
      void groupState.loadOlderMessages()
    },
    rootRef: groupState.scrollRef,
    targetRef: loadOlderSentinelRef,
  })

  const handleTranscriptScroll = () => {
    groupState.updateStickiness()
    const node = groupState.scrollRef.current
    if (!node || !sessionDetail?.hasMoreBefore || groupState.loadingOlderMessages) {
      return
    }

    if (node.scrollTop <= SESSION_SCROLL_TOP_THRESHOLD) {
      void groupState.loadOlderMessages()
    }
  }

  if (!detail || !sessionDetail) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-500">
            {groupState.loading ? <Loader2 className="size-5 animate-spin" /> : <Users className="size-5" />}
          </div>
          <p className="mt-4 text-sm font-medium text-zinc-300">
            {text(language, '选择一个群聊，或先创建一个。', 'Select a group or create one first.')}
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            {text(
              language,
              '群聊消息只有在 @ 到 Agent 时才会触发回复；多个 @ 会按出现顺序依次处理，并共享同一会话上下文。',
              'Group messages only trigger replies when they mention agents. Multiple mentions run in order and share the same session context.',
            )}
          </p>
        </div>
      </div>
    )
  }

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col bg-[#09090b]">
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
              <button
                type="button"
                onClick={() => groupState.setSettingsOpen(true)}
                title={text(language, '群设置', 'Group settings')}
                aria-label={text(language, '群设置', 'Group settings')}
                className="max-w-full truncate text-left text-sm font-semibold text-zinc-100 transition-colors hover:text-zinc-200"
              >
                {detail.conversation.title}
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {groupState.streamStatus ? (
              <span className="hidden w-fit rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline-flex">
                {groupState.streamStatus}
              </span>
            ) : null}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setShareOpen(true)}
              aria-label={text(language, '分享', 'Share')}
              title={text(language, '分享', 'Share')}
              className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Share2 className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => groupState.setSettingsOpen(true)}
              aria-label={text(language, '群设置', 'Group settings')}
              title={text(language, '群设置', 'Group settings')}
              className="size-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <WorkspaceGroupSettingsDialog
        detail={detail}
        language={language}
        options={groupState.options}
        open={groupState.settingsOpen}
        canManage={canManageGroup}
        busyKey={groupState.settingsBusyKey}
        onOpenChange={groupState.setSettingsOpen}
        onUpdateTitle={groupState.handleUpdateGroupTitle}
        onUpdateDescription={groupState.handleUpdateGroupDescription}
        onUpdateAnnouncement={groupState.handleUpdateGroupAnnouncement}
        onAddMember={groupState.handleAddGroupMember}
        onRemoveMember={groupState.handleRemoveGroupMember}
        onLeaveGroup={groupState.handleLeaveGroup}
        onDeleteGroup={groupState.handleDeleteGroup}
        onStartDm={onStartDm}
      />

      <ConversationShareDialog
        conversationId={detail.conversation.id}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {detail.conversation.announcement ? (
        <div className="flex items-start gap-2 border-b border-zinc-800/50 bg-zinc-900/40 px-4 py-2 md:px-5">
          <Megaphone className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
          <button
            type="button"
            onClick={() => setAnnouncementCollapsed((collapsed) => !collapsed)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              {text(language, '群公告', 'Announcement')}
              <span className="text-zinc-600">{announcementCollapsed ? '▸' : '▾'}</span>
              {detail.conversation.announcementUpdatedAt ? (
                <span className="normal-case tracking-normal text-zinc-600">
                  · {announcementAuthorName || text(language, '未知', 'Unknown')} · {formatDate(detail.conversation.announcementUpdatedAt)}
                </span>
              ) : null}
            </p>
            {announcementCollapsed ? (
              <p className="mt-0.5 truncate text-xs text-zinc-500">{detail.conversation.announcement}</p>
            ) : (
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{detail.conversation.announcement}</p>
            )}
          </button>
          {canManageGroup ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => groupState.setSettingsOpen(true)}
              className="h-6 shrink-0 px-2 text-[11px] text-zinc-500 hover:text-zinc-200"
            >
              {text(language, '编辑', 'Edit')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ChatViewport
        absolute
        scrollRef={groupState.scrollRef}
        onScroll={handleTranscriptScroll}
        paddingBottom={composerAreaHeight + 16}
        rootClassName="bg-zinc-950"
        scrollClassName={cn(
          'scrollbar-subtle overflow-y-auto overscroll-y-contain touch-pan-y px-4 py-4',
          isMobile && 'px-3 py-3',
        )}
        overlay={groupState.mentionUnreadIds.length > 0 ? (
          <button
            type="button"
            onClick={() => groupState.jumpToMention()}
            style={{ bottom: composerAreaHeight + 24 }}
            className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg shadow-rose-950/40 hover:bg-rose-500"
            aria-label={text(language, '有人 @ 你', 'Someone mentioned you')}
          >
            <AtSign className="size-3.5" />
            {text(language, '有人 @ 你', 'Someone mentioned you')}
          </button>
        ) : null}
        jumpButton={groupState.scrollShortcutTarget ? (
          <Button
            size="icon"
            variant="secondary"
            style={{ bottom: composerAreaHeight + 24 }}
            className="absolute right-4 z-10 size-8 rounded-full border border-zinc-800/80 bg-zinc-900/90 text-zinc-400 shadow-lg shadow-black/30 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => {
              if (groupState.scrollShortcutTarget === 'top') {
                groupState.scrollToTop()
                return
              }

              groupState.scrollToBottom()
            }}
            aria-label={groupState.scrollShortcutTarget === 'top'
              ? text(language, '回到顶部', 'Back to top')
              : text(language, '回到底部', 'Back to bottom')}
            title={groupState.scrollShortcutTarget === 'top'
              ? text(language, '回到顶部', 'Back to top')
              : text(language, '回到底部', 'Back to bottom')}
          >
            {groupState.scrollShortcutTarget === 'top' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
          </Button>
        ) : null}
      >
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {sessionDetail.hasMoreBefore ? (
              <div ref={loadOlderSentinelRef} className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void groupState.loadOlderMessages()}
                  disabled={groupState.loadingOlderMessages}
                  className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {groupState.loadingOlderMessages
                    ? text(language, '加载中...', 'Loading...')
                    : text(language, `加载更早消息`, 'Load earlier messages')}
                </button>
              </div>
            ) : null}
            <ConversationFeed
              turns={conversationTurns}
              isBusy={groupState.sending}
              assistantLabel={activeResponderLabel}
              assistantAvatarUrl={activeResponderAvatarUrl}
              assistantAvatarFallback={getAgentInitials(activeResponderLabel)}
              userLabel={text(language, '成员', 'Member')}
              userAvatarFallback="MB"
              fallbackStep={groupState.streamStatus || `${activeResponderLabel} ${text(language, '处理中', 'is processing')}`}
              emptyTitle={text(language, '还没有消息', 'No messages yet')}
              emptyDescription={text(
                language,
                '发一条消息，开始这次群会话。输入 @ 可提及成员、Agent、会话、文档或工作区。',
                'Send a message to start this group session. Type @ to mention a member, agent, session, document, or workspace.',
              )}
              hideProcessBehindLog
              mentionTargets={memberMentionTargets}
            />
          </div>
      </ChatViewport>

      <ChatComposerOverlay onHeightChange={setComposerAreaHeight}>
        <ChatComposer
            maxHeight={isMobile ? 140 : 180}
            minHeight={isMobile ? 46 : 56}
            rows={1}
            value={groupState.input}
            onChange={(event) => groupState.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (isImeComposingKeyboardEvent(event)) {
                return
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void groupState.handleSend()
              }
            }}
            onSelectMention={(nextValue) => groupState.setInput(nextValue)}
            mentionOptions={mentionOptions}
            onMentionQueryChange={setMentionQuery}
            mentionTitle={text(language, '提及', 'Mentions')}
            mentionHintText={text(language, '输入 @ 选择成员、Agent、会话、工作区或文档', 'Type @ to mention a member, agent, session, workspace, or document.')}
            mentionEmptyText={text(language, '没有匹配的成员或文档。', 'No matching members or documents.')}
            placeholder={text(
              language,
              '输入消息：@Agent 会启动回复，@成员会发送通知，@文档会附带引用。',
              'Type a message: @Agent starts a reply, @member sends a notification, @document adds a reference.',
            )}
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
            topContent={replyToMessageId ? (
              <div className="mb-1.5 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[11px] text-zinc-400">
                <CornerDownLeft className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {text(language, '正在回复', 'Replying to')}
                  {replyTargetLabel ? `：${replyTargetLabel}` : ''}
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
            ) : undefined}
            overlay={(
              <div className="flex shrink-0 items-center gap-1">
                <input
                  ref={attachFileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) {
                      void groupState.handleAttachFile(file)
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => attachFileInputRef.current?.click()}
                  disabled={groupState.attaching}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={text(language, '上传附件', 'Attach file')}
                  title={text(language, '上传附件（存入 Drive 云盘）', 'Attach file (saved to Drive)')}
                >
                  {groupState.attaching ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
                </button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      aria-label={text(language, '插入 emoji', 'Insert emoji')}
                      title={text(language, '插入 emoji', 'Insert emoji')}
                    >
                      <Smile size={16} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="end">
                    <EmojiPicker
                      onSelect={(emoji) => {
                        groupState.setInput((current: string) => {
                          const trimmed = current.trimEnd()
                          return trimmed ? `${trimmed} ${emoji} ` : `${emoji} `
                        })
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  onClick={() => void groupState.handleSend()}
                  disabled={sendDisabled}
                  size="icon"
                  className={cn(
                    'h-8 w-8 rounded-md transition-colors',
                    groupState.sending
                      ? 'border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      : 'bg-zinc-100 text-zinc-950 hover:bg-zinc-200',
                  )}
                  aria-label={groupState.sending ? text(language, '停止', 'Stop') : text(language, '发送', 'Send')}
                  title={groupState.sending ? text(language, '停止', 'Stop') : text(language, '发送', 'Send')}
                >
                  {groupState.sending
                    ? <Square size={14} />
                    : <Send size={14} />}
                </Button>
              </div>
            )}
            footer={(
              <div className={cn('flex min-w-0 items-center gap-3', isMobile ? 'mt-1.5 px-1' : 'mt-2 px-1')}>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1.5">
                    <AtSign className="size-3" />
                    {text(language, '@Agent 启动回复，@成员发送通知', '@Agent starts a reply; @member sends a notification')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CornerDownLeft className="size-3" />
                    {text(language, 'Enter 发送', 'Enter to send')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CornerDownLeft className="size-3 rotate-180" />
                    {text(language, 'Shift + Enter 换行', 'Shift + Enter for newline')}
                  </span>
                </div>
              </div>
            )}
        />
      </ChatComposerOverlay>
    </section>
  )
}
