import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { resolveAgentTypeForRuntimeId } from '@shared/agent-type'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { isMainChatSessionVisibleInWorkspace } from '@shared/main-chat-session'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import type { SkillRecord } from '@shared/skill'
import { toast } from 'sonner'
import { useApp } from '../../lib/app-provider'
import { useAuth } from '../../lib/auth-context'
import { api, type AgentRecord } from '../../lib/api'
import { countConfiguredChannels, parseMcpServerPolicies, parsePrimaryAgentConfig } from '../../lib/agent-config'
import { AGENT_SIDEBAR_REFRESH_EVENT } from '../../lib/agent-sidebar-store'
import { COLLABORATION_WORKSPACE_CHANGE_EVENT, getStoredCollaborationWorkspaceId } from '../../lib/collaboration-workspace'
import type { Language } from '../../lib/i18n'
import { insertSkillMentionToken } from '../../lib/skill-mentions'
import { useSmoothAutoScroll } from '../../lib/use-smooth-auto-scroll'
import { useConversationUnreadState } from '../../lib/use-conversation-unread-state'
import { useAvailableSkills } from '../../lib/use-available-skills'
import { formatExecutionModelLabel, formatExecutionModelProviderLabel } from '../../lib/utils'
import { useRealtimeMainChat, type MainChatWsEvent } from '../../lib/realtime/useRealtime'
import { chatMessagesToChatBubbleMessages } from '../../components/chat/main-chat-transcript-turns'
import { useThread } from '../../lib/thread/use-thread'
import { prependConversationMessages } from '../../lib/thread/thread-merge'
import {
  mainChatThreadCache,
  readMainChatThreadCache,
  writeMainChatThreadCache,
} from '../../lib/main-chat-thread-cache'
import {
  agentCatalogCache,
  readAgentCatalogCache,
  writeAgentCatalogCache,
} from '../../lib/chat-sidebar-cache'
import {
  appendStatusTimelineEntry,
  buildMainChatTranscriptTurns,
  buildMessagesFromState,
  createWelcomeMessage,
  getActiveMainChatSession,
  getAgentAvatarClassName,
  getEnabledCustomChatAgents,
  getMainChatSessions,
  getSessionAgentId,
  getVisibleMainChatSessions,
  PRIMARY_CHAT_AGENT_ID,
  resolveHistoricalAgentName,
  text,
  upsertAssistantTimelineEntry,
  upsertThinkingTimelineEntry,
  upsertToolTimelineEntry,
} from './chat-route-helpers'
import {
  getPersistedMainChatSessionPreference,
  type PersistedMainChatPreferences,
  readMainChatPreferences,
  resolveMainChatSessionSelectedModel,
  setPersistedMainChatLastSelectedAgent,
  upsertPersistedMainChatSessionPreference,
  writeMainChatPreferences,
} from './chat-session-preferences'
import type { ChatAgentListItem, ChatBubbleMessage, ChatImage, ChatTimelineEntry } from './chat-route-types'
import type { AgentRunningStatus, ChatMessage, ExecutionModelOption, ExecutorRecord, ToolCall } from '@shared/types'

type UseChatRouteStateParams = {
  language: Language
}

const INITIAL_VISIBLE_TRANSCRIPT_TURNS = 10
const TRANSCRIPT_TURNS_PAGE_SIZE = 10

const stringifyComparableValue = (value: unknown) => {
  return value === undefined ? '' : JSON.stringify(value)
}

const areChatBubbleMessagesEqual = (
  previous: ChatBubbleMessage[],
  next: ChatBubbleMessage[],
) => {
  if (previous === next) {
    return true
  }

  if (previous.length !== next.length) {
    return false
  }

  return previous.every((message, index) => {
    const candidate = next[index]
    if (!candidate) {
      return false
    }

    return message.id === candidate.id
      && message.role === candidate.role
      && message.content === candidate.content
      && message.createdAt === candidate.createdAt
      && message.authorType === candidate.authorType
      && message.authorId === candidate.authorId
      && message.authorName === candidate.authorName
      && message.agentRunningStatus === candidate.agentRunningStatus
      && message.currentStep === candidate.currentStep
      && message.streaming === candidate.streaming
      && message.timelineOrder === candidate.timelineOrder
      && stringifyComparableValue(message.attachments) === stringifyComparableValue(candidate.attachments)
      && stringifyComparableValue(message.reasoning) === stringifyComparableValue(candidate.reasoning)
      && stringifyComparableValue(message.toolCalls) === stringifyComparableValue(candidate.toolCalls)
      && stringifyComparableValue(message.taskProposal) === stringifyComparableValue(candidate.taskProposal)
  })
}

export function useChatRouteState({ language }: UseChatRouteStateParams) {
  const {
    state,
    setState,
    loading: appLoading,
    busy,
    setBusy,
    setSelectedProjectId,
    setSelectedTaskId,
  } = useApp()
  const persistedMainChatPreferencesRef = useRef(readMainChatPreferences())
  const { user: currentUser } = useAuth()
  const currentUserId = currentUser?.id
  const [chatInput, setChatInput] = useState('')
  /** R8.1 主聊天回复态：被回复消息 id（空 = 非回复模式）。 */
  const [replyToMessageId, setReplyToMessageId] = useState('')

  const [messages, setMessages] = useState<ChatBubbleMessage[]>(() => {
    return buildMessagesFromState(state, language)
  })
  const [timelineEntries, setTimelineEntries] = useState<ChatTimelineEntry[]>([])
  const hydratedMainChatSessionIdRef = useRef<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamStatus, setStreamStatus] = useState(text(language, '等待输入', 'Waiting for input'))
  const [executors, setExecutors] = useState<ExecutorRecord[]>([])
  const [modelOptions, setModelOptions] = useState<ExecutionModelOption[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [modelMessage, setModelMessage] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [modelLoading, setModelLoading] = useState(false)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [showConfigDialog, setShowConfigDialog] = useState(false)
  const [primaryAgentSummary, setPrimaryAgentSummary] = useState<AgentRecord | null>(null)
  const [availableAgents, setAvailableAgents] = useState<AgentRecord[]>([])
  const [agentCatalogLoaded, setAgentCatalogLoaded] = useState(false)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getStoredCollaborationWorkspaceId())
  const [selectedChatAgentId, setSelectedChatAgentId] = useState(() => {
    const activeSession = getActiveMainChatSession(state)
    if (activeSession) {
      return getSessionAgentId(activeSession)
    }

    const persistedPreferences = persistedMainChatPreferencesRef.current
    return persistedPreferences.lastSelectedAgentId?.trim() || PRIMARY_CHAT_AGENT_ID
  })
  const [images, setImages] = useState<ChatImage[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [configLoading, setConfigLoading] = useState(false)
  const [messageQueue, setMessageQueue] = useState<ChatBubbleMessage[]>([])
  const [sessionActivityById, setSessionActivityById] = useState<Record<string, 'running' | 'completed'>>({})
  const [pendingSessionSelectionId, setPendingSessionSelectionId] = useState<string | null>(null)
  const [loadingOlderTranscriptTurns, setLoadingOlderTranscriptTurns] = useState(false)
  const [visibleTranscriptTurnCount, setVisibleTranscriptTurnCount] = useState(INITIAL_VISIBLE_TRANSCRIPT_TURNS)

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

  const streamAbortRef = useRef<AbortController | null>(null)
  const timelineOrderRef = useRef(messages.length)
  const streamingAssistantIdRef = useRef<string | null>(null)
  const streamingAssistantSegmentIndexRef = useRef(0)
  const splitAssistantSegmentOnNextDeltaRef = useRef(false)
  const transcriptWindowRestoreRef = useRef<{ previousHeight: number; previousTop: number } | null>(null)
  const previousTranscriptTurnLengthRef = useRef(0)
  const skipNextTranscriptGrowthSyncRef = useRef(false)
  const loadingMainChatSessionIdRef = useRef<string | null>(null)

  const persistedMainChatSessions = useMemo(() => getMainChatSessions(state), [state])
  const mainChatSessions = useMemo(() => {
    const baseSessions = agentCatalogLoaded
      ? getVisibleMainChatSessions(persistedMainChatSessions, availableAgents, currentUserId)
      : persistedMainChatSessions
    const workspaceId = currentWorkspaceId.trim()
    return workspaceId
      ? baseSessions.filter((session) => isMainChatSessionVisibleInWorkspace(session, workspaceId))
      : baseSessions
  }, [agentCatalogLoaded, availableAgents, currentUserId, currentWorkspaceId, persistedMainChatSessions])
  const activeMainChatSession = mainChatSessions.find((session) => {
    return session.id === state.selectedMainChatSessionId
  }) ?? mainChatSessions[0] ?? null
  const enabledCustomAgents = useMemo(() => {
    return getEnabledCustomChatAgents(availableAgents)
  }, [availableAgents])
  const chatAgents = useMemo<ChatAgentListItem[]>(() => {
    const sessionAgentIds = new Set(mainChatSessions.map((session) => getSessionAgentId(session)))
    const enabledAgentIds = new Set(enabledCustomAgents.map((agent) => agent.id))
    const agentById = new Map(availableAgents.map((agent) => [agent.id, agent]))
    // 历史 Agent = 有会话但不在当前启用的 Agent 列表（含其他 Agent 主动私聊创建的会话，
    // 即使该 Agent 不属于当前用户——会话归属我所以需要能进历史会话）。
    const historicalAgentIds = [...sessionAgentIds].filter((agentId) => {
      return agentId !== PRIMARY_CHAT_AGENT_ID && !enabledAgentIds.has(agentId)
    })

    const customAgents = enabledCustomAgents.map((agent) => {
      const profile = readCustomAgentConfig(agent.config)
      return {
        id: agent.id,
        name: agent.name,
        role: profile.role || profile.category || text(language, '自定义 Agent', 'Custom Agent'),
        kind: 'custom' as const,
        status: agent.status,
        avatarUrl: profile.avatarUrl,
        avatarClassName: getAgentAvatarClassName(agent.id),
        canCreateSession: true,
      }
    })

    const historicalAgents = historicalAgentIds.map((agentId) => {
      const agent = agentById.get(agentId)
      const profile = agent ? readCustomAgentConfig(agent.config) : undefined
      return {
        id: agentId,
        name: agent?.name || resolveHistoricalAgentName(mainChatSessions, agentId),
        role: profile?.role || text(language, '外部 Agent', 'External Agent'),
        kind: 'unavailable' as const,
        status: (agent?.status ?? 'unknown') as ChatAgentListItem['status'],
        avatarUrl: profile?.avatarUrl || '',
        avatarClassName: getAgentAvatarClassName(agentId),
        canCreateSession: false,
      }
    })

    return [...customAgents, ...historicalAgents]
  }, [availableAgents, enabledCustomAgents, language, mainChatSessions])
  const selectedChatAgent = chatAgents.find((agent) => agent.id === selectedChatAgentId) ?? chatAgents[0]
  const selectedAgentSessions = useMemo(() => {
    return mainChatSessions.filter((session) => getSessionAgentId(session) === selectedChatAgent?.id)
  }, [mainChatSessions, selectedChatAgent?.id])
  const hasExactSelectedAgentSession = selectedAgentSessions.some((session) => {
    return session.id === state.selectedMainChatSessionId
  })
  const activeSession = selectedAgentSessions.find((session) => {
    return session.id === state.selectedMainChatSessionId
  }) ?? selectedAgentSessions[0] ?? null
  // 主对话未读（服务端游标为权威）：kind='main' 会话未读计数 + 打开会话标记已读。
  const { unreadByConversationId: mainChatUnread, markRead: markMainChatRead } = useConversationUnreadState({
    conversationIds: mainChatSessions.map((session) => session.id),
    activeConversationId: activeSession?.id,
  })
  useEffect(() => {
    if (activeSession?.id) {
      void markMainChatRead(activeSession.id)
    }
  }, [activeSession?.id, markMainChatRead])
  // 线程级已确认消息（冷加载/增量），会话切换时自动重置；流式增量仍走本地
  // messages/timelineEntries buffer（P2.4 收口：AppState 不再携带消息）。
  // 路由重挂载时先用模块级缓存种子即时渲染，冷加载照常后台静默刷新（避免每次切页空加载闪烁）。
  const cachedThreadPage = activeSession?.id
    ? readMainChatThreadCache(mainChatThreadCache, activeSession.id)
    : null
  const { messages: threadMessages, loadHistory: threadLoadHistory, loadMoreBefore: threadLoadMoreBefore, hasMoreBefore: threadHasMoreBefore } = useThread<ChatMessage>(
    activeSession?.id,
    cachedThreadPage ?? undefined,
  )
  const hydratedMessages = useMemo(() => {
    const bubbles = chatMessagesToChatBubbleMessages(threadMessages)
    return bubbles.length > 0 ? bubbles : [createWelcomeMessage(language)]
  }, [language, threadMessages])
  const groupedModelOptions = useMemo(() => {
    return modelOptions.reduce<Array<{ providerId: string; models: ExecutionModelOption[] }>>((groups, model) => {
      const providerLabel = formatExecutionModelProviderLabel(model)
      const current = groups.find((group) => group.providerId === providerLabel)
      if (current) {
        current.models.push(model)
        return groups
      }

      groups.push({ providerId: providerLabel, models: [model] })
      return groups
    }, [])
  }, [modelOptions])
  const resolvedCustomAgentId = useMemo(() => {
    const sessionAgentId = activeSession?.customAgentId?.trim()
    if (sessionAgentId) {
      return sessionAgentId
    }

    return selectedChatAgentId !== PRIMARY_CHAT_AGENT_ID
      ? selectedChatAgentId
      : chatAgents[0]?.id || ''
  }, [activeSession?.customAgentId, chatAgents, selectedChatAgentId])
  const activeCustomAgent = useMemo(() => {
    if (!resolvedCustomAgentId) {
      return null
    }

    return enabledCustomAgents.find((agent) => agent.id === resolvedCustomAgentId) ?? null
  }, [enabledCustomAgents, resolvedCustomAgentId])
  const agentDefaultExecutorId = useMemo(() => {
    return activeCustomAgent ? readCustomAgentConfig(activeCustomAgent.config).defaultExecutorId.trim() : ''
  }, [activeCustomAgent])
  const effectiveExecutorId = activeSession?.executorId?.trim() || agentDefaultExecutorId
  const selectedExecutor = useMemo(() => {
    return executors.find((executor) => executor.executorId === effectiveExecutorId) ?? null
  }, [effectiveExecutorId, executors])
  const activeSessionAgentType = activeCustomAgent
    ? resolveAgentTypeForRuntimeId(readCustomAgentConfig(activeCustomAgent.config).preferredRuntime) ?? 'OpenCode'
    : 'OpenCode'
  const unavailableBoundAgentId = activeSession?.customAgentId?.trim() && !activeCustomAgent
    ? activeSession.customAgentId.trim()
    : ''
  const { skills: mentionSkills, loading: mentionSkillsLoading } = useAvailableSkills(undefined, { workspaceId: currentWorkspaceId || undefined })

  const transcriptTurns = useMemo(() => {
    return buildMainChatTranscriptTurns(messages, timelineEntries)
  }, [messages, timelineEntries])
  const visibleTranscriptTurns = useMemo(() => {
    if (visibleTranscriptTurnCount >= transcriptTurns.length) {
      return transcriptTurns
    }

    return transcriptTurns.slice(-visibleTranscriptTurnCount)
  }, [transcriptTurns, visibleTranscriptTurnCount])
  const hiddenTranscriptTurnsCount = Math.max(transcriptTurns.length - visibleTranscriptTurns.length, 0)
  const hasHiddenTranscriptTurns = hiddenTranscriptTurnsCount > 0
  const primaryAgentConfig = useMemo(() => {
    return primaryAgentSummary ? parsePrimaryAgentConfig(primaryAgentSummary.config) : null
  }, [primaryAgentSummary])
  const globalMcpServers = useMemo(() => {
    return parseMcpServerPolicies(state.config.mcpServers)
  }, [state.config.mcpServers])
  const primaryAgentStats = useMemo(() => {
    const config = primaryAgentConfig
    return {
      skills: config?.skills.filter((item) => item.enabled).length ?? 0,
      mcpServers: globalMcpServers.filter((item) => item.enabled).length,
      channels: config ? countConfiguredChannels(config) : 0,
    }
  }, [globalMcpServers, primaryAgentConfig])

  const nextTimelineOrder = () => {
    timelineOrderRef.current += 1
    return timelineOrderRef.current
  }

  const updatePersistedMainChatPreferences = (
    updater: (current: PersistedMainChatPreferences) => PersistedMainChatPreferences,
  ) => {
    const nextPreferences = updater(persistedMainChatPreferencesRef.current)
    if (nextPreferences === persistedMainChatPreferencesRef.current) {
      return
    }

    persistedMainChatPreferencesRef.current = nextPreferences
    writeMainChatPreferences(nextPreferences)
  }

  const resetTimeline = (nextMessages: ChatBubbleMessage[]) => {
    timelineOrderRef.current = nextMessages.length
    streamingAssistantIdRef.current = null
    streamingAssistantSegmentIndexRef.current = 0
    splitAssistantSegmentOnNextDeltaRef.current = false
    setTimelineEntries((previous) => (previous.length === 0 ? previous : []))
    setMessages((previous) => {
      return areChatBubbleMessagesEqual(previous, nextMessages) ? previous : nextMessages
    })
  }

  const appendStatusEntry = (status: AgentRunningStatus, currentStep: string) => {
    setTimelineEntries((previous) => {
      return appendStatusTimelineEntry(previous, status, currentStep, nextTimelineOrder())
    })
  }

  const upsertToolEntry = (toolCall: ToolCall) => {
    setTimelineEntries((previous) => {
      return upsertToolTimelineEntry(previous, toolCall, nextTimelineOrder())
    })
  }

  const upsertThinkingEntry = (partId: string, content: string) => {
    setTimelineEntries((previous) => {
      return upsertThinkingTimelineEntry(previous, {
        id: `thinking:${partId}`,
        content,
      }, nextTimelineOrder())
    })
  }

  const upsertAssistantEntry = (updater: (current: string) => string) => {
    const assistantMessageId = streamingAssistantIdRef.current
    if (!assistantMessageId) {
      return
    }

    setTimelineEntries((previous) => {
      const segmentId = `assistant:${assistantMessageId}:${streamingAssistantSegmentIndexRef.current}`
      const currentEntry = previous.find((entry) => entry.kind === 'assistant' && entry.id === segmentId)
      return upsertAssistantTimelineEntry(previous, {
        id: segmentId,
        messageId: assistantMessageId,
        text: updater(currentEntry?.kind === 'assistant' ? currentEntry.text : ''),
      }, nextTimelineOrder())
    })
  }

  const upsertStreamingAssistant = (updater: (current: ChatBubbleMessage) => ChatBubbleMessage) => {
    const assistantId = streamingAssistantIdRef.current ?? crypto.randomUUID()
    streamingAssistantIdRef.current = assistantId

    setMessages((previous) => {
      const existingIndex = previous.findIndex((message) => message.id === assistantId)
      if (existingIndex === -1) {
        const baseMessage: ChatBubbleMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          streaming: true,
          agentRunningStatus: 'thinking',
          currentStep: '',
          toolCalls: [],
          timelineOrder: nextTimelineOrder(),
        }

        return [...previous, updater(baseMessage)]
      }

      return previous.map((message, index) => {
        return index === existingIndex ? updater(message) : message
      })
    })
  }

  const applyAgentCatalog = (agents: AgentRecord[]) => {
    setAvailableAgents(agents)
    setAgentCatalogLoaded(true)
    const agent = getEnabledCustomChatAgents(agents)[0] ?? null
    setPrimaryAgentSummary(agent)
  }

  const loadPrimaryAgent = useCallback(async (options?: { force?: boolean }) => {
    // 路由重挂载时先用缓存种出 Agent 目录（头像/角色/无会话 Agent 立即渲染），
    // 后台静默刷新保持状态最新；AGENT_SIDEBAR_REFRESH_EVENT 走 force 绕过缓存。
    const cachedAgents = options?.force
      ? null
      : readAgentCatalogCache(agentCatalogCache, currentWorkspaceId)
    if (cachedAgents) {
      applyAgentCatalog(cachedAgents)
    }
    try {
      setConfigLoading(true)
      const response = await api.listAgents(currentWorkspaceId.trim() || undefined)
      writeAgentCatalogCache(agentCatalogCache, currentWorkspaceId, response.agents)
      applyAgentCatalog(response.agents)
    } catch (error) {
      if (!cachedAgents) {
        toast.error(error instanceof Error ? error.message : text(language, 'Agent 配置加载失败', 'Failed to load agent config'))
      }
    } finally {
      setConfigLoading(false)
    }
  }, [currentWorkspaceId, language])

  useEffect(() => {
    const handleWorkspaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      setCurrentWorkspaceId(detail?.workspaceId?.trim() || '')
    }
    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
    return () => window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, handleWorkspaceChange)
  }, [])

  useEffect(() => {
    updatePersistedMainChatPreferences((current) => {
      return setPersistedMainChatLastSelectedAgent(current, selectedChatAgentId)
    })
  }, [selectedChatAgentId])

  useEffect(() => {
    if (!activeMainChatSession?.id) {
      return
    }

    updatePersistedMainChatPreferences((current) => {
      return upsertPersistedMainChatSessionPreference(current, activeMainChatSession)
    })
  }, [
    activeMainChatSession?.customAgentId,
    activeMainChatSession?.executionModel,
    activeMainChatSession?.id,
  ])

  useEffect(() => {
    if (chatAgents.some((agent) => agent.id === selectedChatAgentId)) {
      return
    }

    const persistedSessionPreference = getPersistedMainChatSessionPreference(
      persistedMainChatPreferencesRef.current,
      activeMainChatSession?.id,
    )
    const fallbackAgentId = activeMainChatSession
      ? getSessionAgentId(activeMainChatSession)
      : persistedSessionPreference?.agentId
        || persistedMainChatPreferencesRef.current.lastSelectedAgentId?.trim()
        || chatAgents[0]?.id
        || ''
    setSelectedChatAgentId(fallbackAgentId)
  }, [activeMainChatSession, chatAgents, selectedChatAgentId])

  useEffect(() => {
    let cancelled = false
    let refreshTimer: number | null = null

    const loadExecutors = async () => {
      try {
        const response = await api.listExecutors()
        if (!cancelled) {
          setExecutors(response.executors)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : text(language, '执行节点列表加载失败', 'Failed to load executors'))
        }
      }
    }

    void loadExecutors()
    refreshTimer = window.setInterval(() => {
      void loadExecutors()
    }, 15000)

    return () => {
      cancelled = true
      if (refreshTimer !== null) {
        window.clearInterval(refreshTimer)
      }
    }
  }, [language])

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      if (!activeSession?.id) {
        setModelOptions([])
        setDefaultModel('')
        setModelMessage('')
        return
      }

      setModelLoading(true)
      setModelMessage('')
      try {
        const response = await api.listMainChatSessionModels(activeSession.id)
        if (cancelled) {
          return
        }

        setModelOptions(response.models)
        setDefaultModel(response.defaultModel ?? '')
        setModelMessage(response.message ?? '')
      } catch (error) {
        if (!cancelled) {
          setModelOptions([])
          setDefaultModel('')
          setModelMessage(error instanceof Error ? error.message : text(language, '模型列表加载失败', 'Failed to load models'))
        }
      } finally {
        if (!cancelled) {
          setModelLoading(false)
        }
      }
    }

    void loadModels()

    return () => {
      cancelled = true
    }
  }, [activeSession?.customAgentId, activeSession?.id, effectiveExecutorId, language])

  useEffect(() => {
    const persistedSessionPreference = getPersistedMainChatSessionPreference(
      persistedMainChatPreferencesRef.current,
      activeSession?.id,
    )
    setSelectedModel(resolveMainChatSessionSelectedModel(activeSession, persistedSessionPreference))
  }, [activeSession?.executionModel, activeSession?.id])

  const loadMainChatSessionHistory = useCallback((sessionId: string, options?: { silent?: boolean }) => {
    if (loadingMainChatSessionIdRef.current === sessionId) {
      return
    }

    loadingMainChatSessionIdRef.current = sessionId
    return threadLoadHistory(async () => {
      const response = await api.getMainChatSession(sessionId, { limit: 50 })
      // 消息交给 useThread 持有；AppState 只更新会话元数据（P2.4 收口）。
      const { messages: _omittedMessages, ...sessionMeta } = response.session
      setState((current) => {
        const sessionExists = current.mainChatSessions.some((session) => session.id === response.session.id)
        if (!sessionExists) {
          return current
        }

        const mainChatSessions = current.mainChatSessions.map((session) => (
          session.id === response.session.id ? sessionMeta : session
        ))
        return {
          ...current,
          mainChatSessions,
        }
      })
      const page = {
        messages: _omittedMessages ?? [],
        hasMoreBefore: response.hasMoreBefore ?? false,
      }
      // 写回模块级缓存：下次路由重挂载 / 会话切换时直接先渲染这份内容。
      writeMainChatThreadCache(mainChatThreadCache, sessionId, page)
      return page
    })
      .catch((error) => {
        if (!options?.silent) {
          toast.error(error instanceof Error ? error.message : text(language, '会话历史加载失败', 'Failed to load session history'))
        }
      })
      .finally(() => {
        if (loadingMainChatSessionIdRef.current === sessionId) {
          loadingMainChatSessionIdRef.current = null
        }
      })
  }, [language, setState, threadLoadHistory])

  // 每次切换会话都用游标读取冷加载一次历史：useThread 在切换时重置了消息状态，
  // 不再依赖 loadedMainChatSessionIdRef 守卫（那会让切回的会话漏加载）。
  useEffect(() => {
    if (!activeSession?.id) {
      return
    }

    void loadMainChatSessionHistory(activeSession.id)
  }, [activeSession?.id, loadMainChatSessionHistory])

  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming

  // 其它标签页发起的消息通过 WS 感知：本标签只当"有更新"信号，
  // 内容一律回退到 HTTP 游标读取；正在本标签流式发送时跳过避免打断乐观 UI。
  useRealtimeMainChat(activeSession?.id, {
    onEvent: useCallback((event: MainChatWsEvent) => {
      // 本地流式中：SSE 已驱动增量，WS 增量跳过避免重复。
      if (isStreamingRef.current) {
        return
      }

      if (event.type === 'message_saved') {
        const sessionId = activeSession?.id
        if (sessionId) {
          void loadMainChatSessionHistory(sessionId, { silent: true })
        }
        return
      }

      // 其它标签 / 刷新后重放的流式增量：驱动本地 timeline（跨标签增量渲染）。
      if (event.type === 'status') {
        appendStatusEntry(
          event.payload.status as AgentRunningStatus | undefined ?? 'thinking',
          String(event.payload.currentStep ?? event.payload.content ?? ''),
        )
        return
      }

      if (event.type === 'reasoning') {
        upsertThinkingEntry(
          String(event.payload.partId ?? ''),
          String(event.payload.content ?? ''),
        )
        return
      }

      if (event.type === 'tool' && event.payload.toolCall) {
        upsertToolEntry(event.payload.toolCall as ToolCall)
        return
      }

      if (event.type === 'delta') {
        if (!streamingAssistantIdRef.current) {
          streamingAssistantIdRef.current = crypto.randomUUID()
          streamingAssistantSegmentIndexRef.current = 0
          splitAssistantSegmentOnNextDeltaRef.current = false
          upsertStreamingAssistant((current) => ({
            ...current,
            authorType: 'agent',
            agentRunningStatus: 'thinking',
          }))
        }
        upsertAssistantEntry((current) => current + String(event.payload.content ?? ''))
      }
    }, [
      activeSession?.id,
      appendStatusEntry,
      loadMainChatSessionHistory,
      upsertAssistantEntry,
      upsertStreamingAssistant,
      upsertThinkingEntry,
      upsertToolEntry,
    ]),
    // 重连后服务端重放缓冲区已过期（resumed: false）：断线期间的增量事件已经丢失，
    // 主动做一次 HTTP 冷加载兜底，避免 UI 静默漏掉这段时间的更新。
    onNeedsRefresh: useCallback(() => {
      if (isStreamingRef.current) {
        return
      }
      const sessionId = activeSession?.id
      if (sessionId) {
        void loadMainChatSessionHistory(sessionId, { silent: true })
      }
    }, [activeSession?.id, loadMainChatSessionHistory]),
  })

  const hydratedMessageCountRef = useRef(threadMessages.length)

  // Rebuild timeline when session changes or confirmed messages update
  useEffect(() => {
    if (isStreaming) {
      return
    }

    const activeSessionId = activeSession?.id ?? null
    const sessionChanged = hydratedMainChatSessionIdRef.current !== activeSessionId
    const messageCountChanged = hydratedMessageCountRef.current !== threadMessages.length
    hydratedMainChatSessionIdRef.current = activeSessionId
    if (!sessionChanged && !messageCountChanged && timelineEntries.length > 0) {
      return
    }

    hydratedMessageCountRef.current = threadMessages.length
    setImages([])
    resetTimeline(hydratedMessages)
  }, [activeSession?.id, hydratedMessages, isStreaming, timelineEntries.length])

  useEffect(() => {
    if (pendingSessionSelectionId) {
      return
    }

    autoScrollToBottom(isStreaming ? 'smooth' : 'instant')
  }, [
    autoScrollToBottom,
    images.length,
    isStreaming,
    messageQueue.length,
    messages,
    pendingSessionSelectionId,
    streamStatus,
    timelineEntries,
    visibleTranscriptTurns.length,
  ])

  useLayoutEffect(() => {
    if (!activeSession?.id) {
      previousTranscriptTurnLengthRef.current = 0
      return
    }

    transcriptWindowRestoreRef.current = null
    previousTranscriptTurnLengthRef.current = 0
    skipNextTranscriptGrowthSyncRef.current = true
    setVisibleTranscriptTurnCount(INITIAL_VISIBLE_TRANSCRIPT_TURNS)
    resumeAutoScroll()
    scrollToBottom('instant')
  }, [activeSession?.id, resumeAutoScroll, scrollToBottom])

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
  }, [scrollRef, visibleTranscriptTurns.length])

  useEffect(() => {
    const previousLength = previousTranscriptTurnLengthRef.current
    previousTranscriptTurnLengthRef.current = transcriptTurns.length

    if (skipNextTranscriptGrowthSyncRef.current) {
      skipNextTranscriptGrowthSyncRef.current = false
      return
    }

    if (!showJumpToBottom || transcriptTurns.length <= previousLength || visibleTranscriptTurnCount >= previousLength) {
      return
    }

    const appendedTurns = transcriptTurns.length - previousLength
    setVisibleTranscriptTurnCount((current) => Math.min(current + appendedTurns, transcriptTurns.length))
  }, [showJumpToBottom, transcriptTurns.length, visibleTranscriptTurnCount])

  useEffect(() => {
    void loadPrimaryAgent()
  }, [loadPrimaryAgent])

  useEffect(() => {
    const refreshAgentCatalog = () => {
      void loadPrimaryAgent({ force: true })
    }

    window.addEventListener(AGENT_SIDEBAR_REFRESH_EVENT, refreshAgentCatalog)
    return () => {
      window.removeEventListener(AGENT_SIDEBAR_REFRESH_EVENT, refreshAgentCatalog)
    }
  }, [loadPrimaryAgent])

  const visibleSelectedModel = resolveMatchingAgentExecutionModelOptionId(activeSessionAgentType, modelOptions, selectedModel)
  const visibleDefaultModel = resolveMatchingAgentExecutionModelOptionId(activeSessionAgentType, modelOptions, defaultModel) || defaultModel
  const hasUnavailableSelectedModel = Boolean(selectedModel) && !visibleSelectedModel
  const modelDisabled = busy || isStreaming || modelLoading || modelSaving || !activeSession || !effectiveExecutorId
  const agentDisabled = busy || isStreaming || configLoading || !activeSession
  const agentSummary = activeCustomAgent?.name || selectedChatAgent?.name || primaryAgentSummary?.name || text(language, 'Agent', 'Agent')
  const agentMeta = configLoading
    ? text(language, '保存中', 'Saving')
    : text(language, `${chatAgents.length} 个 Agent`, `${chatAgents.length} agents`)
  const modelSummary = visibleSelectedModel
    ? formatExecutionModelLabel(visibleSelectedModel)
    : visibleDefaultModel
      ? text(language, `默认模型 · ${visibleDefaultModel}`, `Default model · ${visibleDefaultModel}`)
      : text(language, '默认模型', 'Default Model')
  const modelMeta = modelSaving
    ? text(language, '保存中', 'Saving')
    : modelLoading
      ? text(language, '加载中', 'Loading')
      : text(language, `${modelOptions.length} 个模型`, `${modelOptions.length} models`)
  const quickPrompts = [
    text(language, '帮我梳理一下当前最值得推进的任务。', 'Help me identify the most valuable tasks to move forward now.'),
    text(language, '基于现有项目，帮我拆一个新的功能任务。', 'Break down a new feature task based on the current project.'),
    text(language, '总结最近会话里的关键决策和下一步。', 'Summarize key decisions and next steps from recent conversations.'),
  ]
  const composerLockedReason = !activeSession
    ? text(language, '请先为当前 Agent 创建或选择会话。', 'Create or select a session for the current agent first.')
    : ''
  const hasPendingImages = images.length > 0
  const sendDisabled = isStreaming ? false : busy || isUploading || (!chatInput.trim() && !hasPendingImages)
  const showQuickPrompts = Boolean(
    activeSession
    && !isStreaming
    && messages.length === 1
    && timelineEntries.length === 0
    && messages[0]?.role === 'assistant',
  )
  const isResolvingSessionSelection = selectedAgentSessions.length > 0 && !hasExactSelectedAgentSession

  const insertSkillMention = (skill: SkillRecord) => {
    setChatInput(insertSkillMentionToken(chatInput, skill))
  }

  const markSessionActivity = (sessionId: string, state: 'running' | 'completed') => {
    setSessionActivityById((previous) => ({
      ...previous,
      [sessionId]: state,
    }))
  }

  const clearSessionActivity = (sessionId: string, expectedState?: 'running' | 'completed') => {
    setSessionActivityById((previous) => {
      if (!previous[sessionId]) {
        return previous
      }

      if (expectedState && previous[sessionId] !== expectedState) {
        return previous
      }

      const next = { ...previous }
      delete next[sessionId]
      return next
    })
  }

  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const loadOlderServerMessages = async () => {
    const sessionId = activeSession?.id
    const oldestSeq = threadMessages[0]?.seq
    if (!sessionId || typeof oldestSeq !== 'number' || !threadHasMoreBefore || loadingOlderMessages) {
      return
    }

    setLoadingOlderMessages(true)
    try {
      await threadLoadMoreBefore(async () => {
        const response = await api.getMainChatSession(sessionId, {
          limit: 50,
          beforeMessageId: String(oldestSeq),
        })
        const page = {
          messages: response.session.messages ?? [],
          hasMoreBefore: response.hasMoreBefore ?? false,
        }
        // 缓存同步：更早一页前插进缓存条目，保证重挂载后翻页游标仍然可用。
        const cachedEntry = readMainChatThreadCache(mainChatThreadCache, sessionId)
        if (cachedEntry) {
          writeMainChatThreadCache(mainChatThreadCache, sessionId, {
            messages: prependConversationMessages(cachedEntry.messages, page.messages),
            hasMoreBefore: page.hasMoreBefore,
          })
        }
        return page
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text(language, '更早消息加载失败', 'Failed to load earlier messages'))
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  const loadOlderTranscriptTurns = () => {
    if (loadingOlderTranscriptTurns || loadingOlderMessages) {
      return
    }

    if (hasHiddenTranscriptTurns) {
      const node = scrollRef.current
      setLoadingOlderTranscriptTurns(true)
      if (!node) {
        setVisibleTranscriptTurnCount((previous) => Math.min(previous + TRANSCRIPT_TURNS_PAGE_SIZE, transcriptTurns.length))
        return
      }

      transcriptWindowRestoreRef.current = {
        previousHeight: node.scrollHeight,
        previousTop: node.scrollTop,
      }
      setVisibleTranscriptTurnCount((previous) => Math.min(previous + TRANSCRIPT_TURNS_PAGE_SIZE, transcriptTurns.length))
      return
    }

    // 本地 turns 已全部揭示，还有更早历史在服务端 → 翻页拉取，前插进 useThread。
    void loadOlderServerMessages()
  }

  useLayoutEffect(() => {
    if (!loadingOlderTranscriptTurns) {
      return
    }

    setLoadingOlderTranscriptTurns(false)
  }, [loadingOlderTranscriptTurns, visibleTranscriptTurns.length])

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node || !hasHiddenTranscriptTurns) {
      return
    }

    if (node.scrollHeight > node.clientHeight + 24) {
      return
    }

    setVisibleTranscriptTurnCount((current) => {
      if (current >= transcriptTurns.length) {
        return current
      }

      return Math.min(current + TRANSCRIPT_TURNS_PAGE_SIZE, transcriptTurns.length)
    })
  }, [hasHiddenTranscriptTurns, scrollRef, transcriptTurns.length, visibleTranscriptTurns.length])

  return {
    activeCustomAgent,
    activeMainChatSession,
    activeSession,
    agentDisabled,
    agentMenuOpen,
    agentMeta,
    agentSummary,
    appendStatusEntry,
    appLoading,
    autoScrollToBottom,
    availableAgents,
    busy,
    chatAgents,
    chatInput,
    composerLockedReason,
    currentWorkspaceId,
    configLoading,
    defaultModel,
    enabledCustomAgents,
    agentDefaultExecutorId,
    effectiveExecutorId,
    executors,
    globalMcpServers,
    groupedModelOptions,
    hasHiddenTranscriptTurns,
    hasMoreBefore: threadHasMoreBefore,
    hasUnavailableSelectedModel,
    hiddenTranscriptTurnsCount,
    hydratedMessages,
    images,
    insertSkillMention,
    isStreaming,
    isUploading,
    isResolvingSessionSelection,
    loadPrimaryAgent,
    loadOlderTranscriptTurns,
    loadingOlderMessages,
    loadingOlderTranscriptTurns,
    mainChatSessions,
    mainChatUnread,
    mentionSkills,
    mentionSkillsLoading,
    messageQueue,
    messages,
    modelDisabled,
    modelLoading,
    modelMenuOpen,
    modelMessage,
    modelMeta,
    modelOptions,
    modelSaving,
    modelSummary,
    nextTimelineOrder,
    pendingSessionSelectionId,
    primaryAgentConfig,
    primaryAgentStats,
    primaryAgentSummary,
    quickPrompts,
    resetTimeline,
    resumeAutoScroll,
    scrollRef,
    scrollShortcutTarget,
    scrollToTop,
    scrollToBottom,
    selectedAgentSessions,
    selectedChatAgent,
    selectedChatAgentId,
    selectedExecutor,
    selectedModel,
    sendDisabled,
    setAgentMenuOpen,
    setAvailableAgents,
    setBusy,
    setChatInput,
    replyToMessageId,
    setReplyToMessageId,
    setConfigLoading,
    setDefaultModel,
    setExecutors,
    setImages,
    setIsStreaming,
    setIsUploading,
    setMessageQueue,
    setMessages,
    setModelLoading,
    setModelMenuOpen,
    setModelMessage,
    setModelOptions,
    setModelSaving,
    setPrimaryAgentSummary,
    setSelectedChatAgentId,
    setSelectedModel,
    setShowConfigDialog,
    setPendingSessionSelectionId,
    setState,
    setStreamStatus,
    setTimelineEntries,
    setSelectedProjectId,
    setSelectedTaskId,
    sessionActivityById,
    showConfigDialog,
    showJumpToBottom,
    showQuickPrompts,
    state,
    streamAbortRef,
    streamingAssistantIdRef,
    streamingAssistantSegmentIndexRef,
    streamStatus,
    splitAssistantSegmentOnNextDeltaRef,
    timelineEntries,
    transcriptTurns,
    unavailableBoundAgentId,
    updateStickiness,
    visibleTranscriptTurns,
    clearSessionActivity,
    markSessionActivity,
    upsertAssistantEntry,
    upsertThinkingEntry,
    upsertStreamingAssistant,
    upsertToolEntry,
  }
}

export type ChatRouteState = ReturnType<typeof useChatRouteState>
