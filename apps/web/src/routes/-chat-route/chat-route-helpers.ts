import type { Dispatch, SetStateAction } from 'react'
import { isCustomAgentEnabled, readCustomAgentConfig } from '@shared/custom-agent'
import { sortMainChatSessions } from '@shared/main-chat-session'
import type { ChatTranscriptTurn } from '../../components/chat/chat-transcript'
import { getAgentAvatarAccent } from '../../lib/agent-avatar'
import { getCurrentLanguage, type Language } from '../../lib/i18n'
import type { ChatAgentStatus, ChatBubbleMessage, ChatTimelineEntry } from './chat-route-types'
import type { AgentRecord } from '../../lib/api'
import type { AgentRunningStatus, AppState, MainChatSession, ToolCall } from '@shared/types'

export const PRIMARY_CHAT_AGENT_ID = '__primary_agent__'

export const text = (language: Language, zh: string, en: string) => {
  return language === 'zh' ? zh : en
}

export const getSessionAgentId = (session?: MainChatSession | null) => {
  return session?.customAgentId?.trim() || PRIMARY_CHAT_AGENT_ID
}

/**
 * 历史/外部 Agent 名称兜底：Agent 不在当前用户可见列表时，
 * 从「来自 <Agent名> 的消息」这类会话标题提取显示名，取不到则回落 agentId。
 */
export const resolveHistoricalAgentName = (
  sessions: readonly MainChatSession[],
  agentId: string,
) => {
  const session = sessions.find((item) => getSessionAgentId(item) === agentId)
  const title = session?.title?.trim()
  if (title) {
    const extracted = title.replace(/^来自\s*/, '').replace(/的?消息\s*$/, '').trim()
    if (extracted) {
      return extracted
    }
  }
  return agentId
}

export const resolveAgentDefaultExecutorId = (agent?: Pick<AgentRecord, 'config'> | null) => {
  if (!agent) {
    return ''
  }

  return readCustomAgentConfig(agent.config).defaultExecutorId.trim()
}

export const resolveEffectiveMainChatExecutorId = (
  session?: MainChatSession | null,
  agent?: Pick<AgentRecord, 'config'> | null,
) => {
  return session?.executorId?.trim() || resolveAgentDefaultExecutorId(agent)
}

export const getAgentInitials = (name: string) => {
  const normalized = name.trim()
  if (!normalized) {
    return 'AI'
  }

  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  }

  return Array.from(normalized).slice(0, 2).join('').toUpperCase()
}

export const getAgentAvatarClassName = (seed: string) => {
  return getAgentAvatarAccent(seed)
}

export const getMainChatAgentDisplayName = (
  language: Language = getCurrentLanguage(),
) => {
  return text(language, 'Agent', 'Agent')
}

export const getMainChatAgentDisplaySubtitle = (
  language: Language = getCurrentLanguage(),
) => {
  return text(language, '通用对话', 'General chat')
}

export const findCreatedChatSession = (
  previousSessions: MainChatSession[],
  nextSessions: MainChatSession[],
  agentId: string,
) => {
  const previousIds = new Set(previousSessions.map((session) => session.id))
  return nextSessions.find((session) => {
    return getSessionAgentId(session) === agentId && !previousIds.has(session.id)
  })
    ?? nextSessions.find((session) => getSessionAgentId(session) === agentId)
    ?? null
}

export const createWelcomeMessage = (
  language: Language = getCurrentLanguage(),
): ChatBubbleMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content: text(
    language,
    '我是 Agent。直接说需求、问进度，或者让我帮你创建任务。',
    'I am Agent. Tell me what you need, ask for progress, or ask me to create a task.',
  ),
  createdAt: new Date().toISOString(),
  timelineOrder: 1,
})

export const getMainChatSessions = (state: AppState) => {
  return sortMainChatSessions(state.mainChatSessions)
}

export const getVisibleMainChatSessions = (
  sessions: MainChatSession[],
  agents: Pick<AgentRecord, 'id'>[],
  viewerUserId?: string,
) => {
  const knownAgentIds = new Set(agents.map((agent) => agent.id))
  const normalizedViewerUserId = viewerUserId?.trim()
  return sessions.filter((session) => {
    const customAgentId = session.customAgentId?.trim()
    if (!customAgentId || knownAgentIds.has(customAgentId)) {
      return true
    }
    // 会话 Agent 不在当前用户可见 Agent 列表时，仍允许「我拥有的会话」可见
    // （例如其他 Agent 主动私聊创建的会话：ownerUserId=我，Agent 属于别人）。
    return Boolean(normalizedViewerUserId && session.ownerUserId === normalizedViewerUserId)
  })
}

export const resolveAvailableChatAgentId = (
  requestedAgentId: string,
  availableAgentIds: readonly string[],
  fallbackAgentId?: string,
) => {
  const normalizedRequestedAgentId = requestedAgentId.trim()
  const normalizedFallbackAgentId = fallbackAgentId?.trim() || ''
  const availableAgentIdSet = new Set(availableAgentIds.map((agentId) => agentId.trim()).filter(Boolean))

  if (normalizedRequestedAgentId && availableAgentIdSet.has(normalizedRequestedAgentId)) {
    return normalizedRequestedAgentId
  }

  if (normalizedFallbackAgentId && availableAgentIdSet.has(normalizedFallbackAgentId)) {
    return normalizedFallbackAgentId
  }

  return availableAgentIds.find((agentId) => agentId.trim())?.trim() || ''
}

export const getActiveMainChatSession = (state: AppState) => {
  const sessions = getMainChatSessions(state)
  return sessions.find((session) => session.id === state.selectedMainChatSessionId) ?? sessions[0]
}

export const isMainChatSessionBusy = (
  session?: Pick<MainChatSession, 'agentRunningStatus'> | null,
) => {
  const status = session?.agentRunningStatus
  return status === 'thinking' || status === 'executing' || status === 'waiting'
}

const hasTerminalLatestAssistantMessage = (
  session?: Partial<Pick<MainChatSession, 'messages'>> | null,
) => {
  const latestMessage = session?.messages?.at(-1)
  if (latestMessage?.role !== 'assistant') {
    return false
  }

  return latestMessage.agentRunningStatus === 'complete' || latestMessage.agentRunningStatus === 'error'
}

export const getMainChatSessionActivityState = (params: {
  session: Pick<MainChatSession, 'agentRunningStatus'> & Partial<Pick<MainChatSession, 'messages'>>
  localActivity?: 'running' | 'completed'
  streamingActive?: boolean
}) => {
  if (params.localActivity === 'completed' && !params.streamingActive) {
    return 'completed' as const
  }

  if (hasTerminalLatestAssistantMessage(params.session) && !params.streamingActive) {
    return undefined
  }

  if (isMainChatSessionBusy(params.session) || params.localActivity === 'running' || params.streamingActive) {
    return 'running' as const
  }

  return undefined
}

const DAY_MS = 24 * 60 * 60 * 1000

const parseTimestamp = (value?: string | null) => {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getStartOfDayMs = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const padTimePart = (value: number) => String(value).padStart(2, '0')

const getWeekdayLabel = (date: Date, language: Language) => {
  const weekdays = language === 'zh'
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return weekdays[date.getDay()] ?? ''
}

/**
 * Compact chat-list timestamp: same day shows the clock, the previous day and
 * the rest of the week show a name, and older entries fall back to a date.
 */
export const formatChatListTimestamp = (
  value?: string | null,
  language: Language = getCurrentLanguage(),
  now: Date = new Date(),
) => {
  const parsed = parseTimestamp(value)
  if (!parsed) {
    return ''
  }

  const dayDelta = Math.round((getStartOfDayMs(now) - getStartOfDayMs(parsed)) / DAY_MS)
  if (dayDelta <= 0) {
    return `${padTimePart(parsed.getHours())}:${padTimePart(parsed.getMinutes())}`
  }

  if (dayDelta === 1) {
    return text(language, '昨天', 'Yesterday')
  }

  if (dayDelta < 7) {
    return getWeekdayLabel(parsed, language)
  }

  const month = parsed.getMonth() + 1
  const day = parsed.getDate()
  if (parsed.getFullYear() === now.getFullYear()) {
    return `${month}/${day}`
  }

  return `${parsed.getFullYear()}/${month}/${day}`
}

export type MainChatAgentSessionDigest = {
  sessionCount: number
  summary: string
  updatedAt: string
}

/**
 * Locally loaded messages win because they include the live stream; summarized
 * list payloads carry no messages, so they fall back to the derived preview.
 */
export const getMainChatSessionPreview = (
  session: Partial<Pick<MainChatSession, 'messages' | 'latestMessagePreview'>>,
) => {
  const latestMessage = [...(session.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant' || message.role === 'user')
  return latestMessage?.content.replace(/\s+/g, ' ').trim()
    || session.latestMessagePreview?.replace(/\s+/g, ' ').trim()
    || ''
}

/**
 * Rolls each Agent's sessions into the session count plus the newest session's
 * preview and timestamp, so the target list can show recency at a glance.
 */
export const buildMainChatAgentSessionDigests = (
  sessions: readonly MainChatSession[],
): Record<string, MainChatAgentSessionDigest> => {
  const digests: Record<string, MainChatAgentSessionDigest> = {}
  const latestMsByAgentId: Record<string, number> = {}

  for (const session of sessions) {
    const agentId = getSessionAgentId(session)
    const timestamp = session.updatedAt?.trim() || session.createdAt?.trim() || ''
    const timestampMs = parseTimestamp(timestamp)?.getTime() ?? Number.NEGATIVE_INFINITY
    const existing = digests[agentId]
    const isNewer = !existing || timestampMs > (latestMsByAgentId[agentId] ?? Number.NEGATIVE_INFINITY)

    digests[agentId] = {
      sessionCount: (existing?.sessionCount ?? 0) + 1,
      summary: isNewer
        ? getMainChatSessionPreview(session) || session.title.trim()
        : existing.summary,
      updatedAt: isNewer ? timestamp : existing.updatedAt,
    }

    if (isNewer) {
      latestMsByAgentId[agentId] = timestampMs
    }
  }

  return digests
}

export const buildMessagesFromSession = (
  session?: MainChatSession,
  language: Language = getCurrentLanguage(),
): ChatBubbleMessage[] => {
  if (session?.messages && session.messages.length > 0) {
    return session.messages.map((message, index) => ({
      ...message,
      // Persisted main-chat history should reopen as static content. The live
      // stream state only exists in local route state during an active reply.
      streaming: false,
      timelineOrder: index + 1,
    }))
  }

  return [createWelcomeMessage(language)]
}

export const buildMessagesFromState = (
  state: AppState,
  language: Language = getCurrentLanguage(),
) => {
  return buildMessagesFromSession(getActiveMainChatSession(state), language)
}

export const getEnabledCustomChatAgents = (agents: AgentRecord[]) => {
  return agents.filter((agent) => isCustomAgentEnabled(readCustomAgentConfig(agent.config)))
}

export const normalizeChatErrorMessage = (
  message: string,
  language: Language = getCurrentLanguage(),
) => {
  if (message.includes('does not support image input')) {
    return text(
      language,
      '当前模型不支持图片输入，请移除图片后重试，或切换到支持图片的模型。',
      'The current model does not support image input. Remove the images and retry, or switch to a model that supports images.',
    )
  }

  return message
}

export const consumeLeadingUserEcho = (remainingEcho: string, incoming: string) => {
  if (!remainingEcho || !incoming) {
    return { nextEcho: remainingEcho, nextContent: incoming }
  }

  const normalizedEcho = remainingEcho.replace(/\s+/g, ' ').trim()
  const normalizedIncoming = incoming.replace(/\s+/g, ' ').trim()
  if (!normalizedEcho || !normalizedIncoming) {
    return { nextEcho: remainingEcho, nextContent: incoming }
  }

  if (normalizedEcho.startsWith(normalizedIncoming)) {
    return {
      nextEcho: remainingEcho.slice(incoming.length),
      nextContent: '',
    }
  }

  if (normalizedIncoming.startsWith(normalizedEcho)) {
    return {
      nextEcho: '',
      nextContent: incoming.slice(remainingEcho.length),
    }
  }

  return {
    nextEcho: '',
    nextContent: incoming,
  }
}

const getSessionRoleLabels = (language: Language) => [
  text(language, '协调 Agent', 'Coordinator Agent'),
  text(language, 'Agent', 'Agent'),
  text(language, '技术负责人', 'Tech Lead'),
  text(language, '需求分析师', 'Requirements Analyst'),
  text(language, '交付协调', 'Delivery Coordinator'),
  text(language, '研发助理', 'Engineering Assistant'),
]

export const getSessionRoleLabel = (
  index: number,
  language: Language = getCurrentLanguage(),
) => {
  return getSessionRoleLabels(language)[index]
    ?? text(language, `协作角色 ${index + 1}`, `Collaborator ${index + 1}`)
}

export const buildImageFallbackPrompt = (
  count: number,
  language: Language = getCurrentLanguage(),
) => {
  return count > 1
    ? text(language, '请分析这些图片。', 'Please analyze these images.')
    : text(language, '请分析这张图片。', 'Please analyze this image.')
}

export const createMainChatSystemMessage = (
  content: string,
  timelineOrder: number,
  language: Language = getCurrentLanguage(),
): ChatBubbleMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content,
  createdAt: new Date().toISOString(),
  authorType: 'system',
  authorName: text(language, '系统提示', 'System'),
  timelineOrder,
})

export const applyStateSelection = (
  nextState: AppState,
  setState: Dispatch<SetStateAction<AppState>>,
  setSelectedProjectId: (id: string) => void,
  setSelectedTaskId: (id: string) => void,
) => {
  setState(nextState)
  setSelectedProjectId(
    nextState.projects.some((project) => project.id === nextState.selectedProjectId)
      ? nextState.selectedProjectId
      : nextState.projects[0]?.id ?? '',
  )
  setSelectedTaskId(
    nextState.tasks.some((task) => task.id === nextState.selectedTaskId)
      ? nextState.selectedTaskId
      : nextState.tasks[0]?.id ?? '',
  )
}

export const appendStatusTimelineEntry = (
  previous: ChatTimelineEntry[],
  status: AgentRunningStatus,
  currentStep: string,
  timelineOrder: number,
): ChatTimelineEntry[] => {
  const lastEntry = previous[previous.length - 1]
  if (lastEntry?.kind === 'status' && lastEntry.status === status && lastEntry.currentStep === currentStep) {
    return previous
  }

  return [
    ...previous,
    {
      id: crypto.randomUUID(),
      kind: 'status',
      createdAt: new Date().toISOString(),
      timelineOrder,
      status,
      currentStep,
    },
  ]
}

export const upsertThinkingTimelineEntry = (
  previous: ChatTimelineEntry[],
  thinkingEntry: {
    id: string
    content: string
  },
  timelineOrder: number,
): ChatTimelineEntry[] => {
  const existingIndex = previous.findIndex((entry) => {
    return entry.kind === 'thinking' && entry.id === thinkingEntry.id
  })

  if (existingIndex === -1) {
    return [
      ...previous,
      {
        id: thinkingEntry.id,
        kind: 'thinking',
        createdAt: new Date().toISOString(),
        timelineOrder,
        content: thinkingEntry.content,
      },
    ]
  }

  return previous.map((entry, index) => {
    return index === existingIndex
      ? {
          ...entry,
          content: thinkingEntry.content,
        }
      : entry
  })
}

export const upsertToolTimelineEntry = (
  previous: ChatTimelineEntry[],
  toolCall: ToolCall,
  timelineOrder: number,
): ChatTimelineEntry[] => {
  const existingIndex = previous.findIndex((entry) => {
    return entry.kind === 'tool' && entry.toolCall?.id === toolCall.id
  })
  if (existingIndex === -1) {
    return [
      ...previous,
      {
        id: `tool-${toolCall.id}`,
        kind: 'tool',
        createdAt: new Date().toISOString(),
        timelineOrder,
        toolCall,
      },
    ]
  }

  return previous.map((entry, index) => {
    return index === existingIndex ? { ...entry, toolCall } : entry
  })
}

export const upsertAssistantTimelineEntry = (
  previous: ChatTimelineEntry[],
  assistantEntry: {
    id: string
    messageId: string
    text: string
  },
  timelineOrder: number,
): ChatTimelineEntry[] => {
  const existingIndex = previous.findIndex((entry) => {
    return entry.kind === 'assistant' && entry.id === assistantEntry.id
  })

  if (existingIndex === -1) {
    return [
      ...previous,
      {
        id: assistantEntry.id,
        kind: 'assistant',
        createdAt: new Date().toISOString(),
        timelineOrder,
        messageId: assistantEntry.messageId,
        text: assistantEntry.text,
      },
    ]
  }

  return previous.map((entry, index) => {
    return index === existingIndex
      ? {
          ...entry,
          messageId: assistantEntry.messageId,
          text: assistantEntry.text,
        }
      : entry
  })
}

// P2.3 合并后唯一实现落在 components/chat/main-chat-transcript-turns.ts，
// 这里 re-export 保持 use-chat-route-state.ts 等既有 import 路径不变。
export { buildMainChatTranscriptTurns } from '../../components/chat/main-chat-transcript-turns'
