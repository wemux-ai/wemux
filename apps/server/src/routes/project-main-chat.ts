/**
 * [INPUT]: Main-chat state, authenticated user requests, control-plane runtime settings, and executor replies.
 * [OUTPUT]: Untimed control-plane chat execution plus state transitions and streaming/non-streaming responses; aborted replies persist their partial text with finishReason 'aborted'.
 * [POS]: Main Agent Chat orchestration only; workspace-session chat belongs to task-chat-dispatch modules.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { mergeAgentRuntimeSettings } from '@shared/agent-config'
import { sanitizeAgentWorkdirId } from '@shared/agent-workdir'
import { getRuntimeDescriptor } from '@shared/agent-type'
import { isManagedCloudAutoExecutorId } from '@shared/managed-cloud'
import { normalizeMainChatSessionState } from '@shared/main-chat-session'
import { findMatchingAgentExecutionModelOption, resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import { normalizeAssistantReplyText } from '@shared/task-chat'
import { publishMainChatEvent } from '../services/main-chat-ws-service'
import { readAgentMindSnapshot } from '../services/agent-mind-files'
import { recordUsageEvent } from '../services/usage-event-service'
import { ensureTokenQuotaAccess, isTokenQuotaLimitError } from '../services/token-quota-service'
import { checkTeamModelAllowed } from '../services/team-model-policy-service'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { ChatDocReference } from '@shared/chat-mentions'
import { resolveMentionedDocRefs } from '../services/chat-doc-mentions'
import { createConversationMention } from '../repositories/conversation-share-store'
import type {
  AgentRunningStatus,
  AppState,
  ChatMessage,
  ConversationHandoffSnapshot,
  ExecutorAgentPromptAbortReason,
  ExecutionModelOption,
  MainChatSession,
  ModelTokenUsage,
  Project,
  Task,
  TaskProposal,
  ToolCall,
} from '@shared/types'
import { executorWsService } from '../control-plane/executor-ws-service'
import { resolveMentionedConversationIdsForUser, resolveMentionedWorkspaceIds } from '../control-plane/conversation-service'
import { listUserWorkspaces } from '../repositories/workspace'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { loadState } from '../storage/app-state-store'
import { buildCustomAgentSystemPrompt, buildMainAgentRuntimeToolInstructions } from '../services/main-agent-prompt'
import { touchAgentWorkdirSession } from '../services/agent-workdir-service'
import { buildToolCall } from '../services/agent-tool-call'
import { resolveModelProfileRuntime } from '../services/model-profile-service'
import { getPrimaryAgentMcpServers } from '../services/primary-agent-mcp'
import { resolveWorkspaceRuntimeEnvironment } from '../services/runtime-environment-service'
import {
  buildMessageWithRuntimeSkillMentions,
  buildRuntimeSkillPackagesFromSkills,
  dedupeRuntimeSkills,
  resolveRuntimeSkills,
  resolveSkillSelections,
} from '../services/skill-service'
import { resolveTaskRuntimeCapabilitySnapshot } from '../services/custom-agent-runtime'
import { loadAgentModelOptionsFromExecutor } from '../services/task-chat-dispatch/workspace-executor'
import { getDefaultUserAgent } from '../repositories/agent'
import { bindMainChatExecutionAbortSignal } from '../services/main-chat-runtime-state'
import { getScopedState, publishState, withState } from './shared'
import { resolveCustomChatAgent, type ResolvedCustomChatAgent } from './project-main-chat-agent'
import {
  buildConversationHandoffPromptSection,
  buildMainChatHandoffSnapshot,
  buildMainChatWorkerPrompt,
  buildSessionTitle,
  createCustomAgentChatSession,
  createMainChatSession,
  getChatSessionById,
  getMainChatPromptHistory,
  getMainChatRuntimeSessionId,
  refreshMainChatSessionSnapshot,
  setMainChatSessionRuntimeStatus,
  setMainChatRuntimeSessionId,
  type MainChatContinuationScope,
} from './project-main-chat-session'
import {
  getServerAgentDefaultModel,
  getServerAgentSettings,
  resolveServerAgentTypeForRuntimeId,
  type ServerAgentType,
} from '../services/server-agent'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'
export { createCustomAgentChatSession, createMainChatSession } from './project-main-chat-session'

export type MainAgentChatResponse = {
  state: AppState
  message: string | undefined
  taskProposal?: TaskProposal
  reasoning?: string[]
  toolCalls?: ToolCall[]
  usage?: ModelTokenUsage
}

export type MainChatResponseEvent =
  | { type: 'status'; status: 'thinking' | 'executing' | 'complete' | 'error'; currentStep: string }
  | { type: 'delta'; content: string }
  | { type: 'reasoning'; partId: string; content: string }
  | { type: 'tool'; status: 'pending' | 'running' | 'completed' | 'error'; toolCall: ToolCall }

/**
 * 无显式执行节点时的在线回退：取用户可见执行器中第一个 online 的，
 * 与渠道会话 resolveAgentChannelExecutorId 的在线回退策略保持一致。
 */
export const resolveFallbackOnlineExecutor = <T extends { status?: string }>(executors: ReadonlyArray<T>) => {
  return executors.find((item) => item.status === 'online') ?? null
}

export const sanitizeMainChatReply = (reply: string, userMessage: string, fallback = false) => {
  const normalized = normalizeAssistantReplyText(reply, userMessage).trim()
  if (normalized || !fallback) {
    return normalized
  }

  return reply.trim()
    ? '本次回复被系统提示词回显污染，请重试。'
    : '未生成有效回复，请重试。'
}

const resolveChatAgentType = (session: MainChatSession, userId: string) => {
  const customAgent = resolveCustomChatAgent(session, userId)
  if (!customAgent) {
    return null
  }

  return resolveServerAgentTypeForRuntimeId(customAgent.profile.preferredRuntime)
}

const getUnsupportedCustomAgentRuntimeMessage = (session: MainChatSession, userId: string) => {
  const customAgent = resolveCustomChatAgent(session, userId)
  if (!customAgent) {
    return '当前主对话执行端不可用。'
  }

  return `${getRuntimeDescriptor(customAgent.profile.preferredRuntime).label} 还没有接入当前 wemux worker，暂时不能用于主对话。`
}

const updateChatSession = (
  state: AppState,
  sessionId: string,
  updater: (session: MainChatSession) => MainChatSession,
): AppState => {
  const sessions = state.mainChatSessions.map((session) => (
    session.id === sessionId ? refreshMainChatSessionSnapshot(updater(session)) : session
  ))
  const activeSession = sessions.find((session) => session.id === state.selectedMainChatSessionId)

  return {
    ...state,
    mainChatSessions: sessions,
  }
}

const resolveSessionAssistantAuthor = (session: MainChatSession, userId: string) => {
  const customAgent = resolveCustomChatAgent(session, userId)
  if (customAgent) {
    return {
      authorType: 'agent' as const,
      authorId: customAgent.agent.id,
      authorName: customAgent.agent.name,
    }
  }

  return {
    authorType: 'agent' as const,
    authorName: 'Agent',
  }
}

const updateMainChatRuntimeSession = (
  state: AppState,
  sessionId: string | undefined,
  continuationScope: MainChatContinuationScope | undefined,
  runtimeSessionId?: string,
) => {
  const targetSessionId = sessionId?.trim() || state.selectedMainChatSessionId
  const normalizedRuntimeSessionId = runtimeSessionId?.trim()
  if (!targetSessionId || !continuationScope || !normalizedRuntimeSessionId) {
    return state
  }

  const targetSession = state.mainChatSessions.find((session) => session.id === targetSessionId)
  if (!targetSession) {
    return state
  }

  return updateChatSession(state, targetSessionId, (session) => (
    setMainChatRuntimeSessionId(session, continuationScope, normalizedRuntimeSessionId)
  ))
}

const updateMainChatSessionRuntimeState = (
  state: AppState,
  sessionId: string | undefined,
  agentRunningStatus: AgentRunningStatus,
  currentStep = '',
) => {
  const targetSessionId = sessionId?.trim() || state.selectedMainChatSessionId
  if (!targetSessionId) {
    return state
  }

  const targetSession = state.mainChatSessions.find((session) => session.id === targetSessionId)
  if (!targetSession) {
    return state
  }

  return updateChatSession(state, targetSessionId, (session) => (
    setMainChatSessionRuntimeStatus(session, agentRunningStatus, currentStep)
  ))
}

const resolveMainChatExecutor = async (userId: string, session: MainChatSession) => {
  let executorId = session.executorId?.trim()
  if (!executorId) {
    const customAgent = resolveCustomChatAgent(session, userId)
    const agentDefaultId = customAgent?.profile.defaultExecutorId?.trim()
    if (agentDefaultId) {
      executorId = agentDefaultId
    }
  }

  // 未指定节点或默认官方云节点 → 优先按需分配 wemux 云节点执行；
  // 云节点不可用（如生产环境尚未开放 / 未配置）时回退到用户可见的第一个在线执行器，
  // 避免「会话未指定执行节点」变成死胡同（web 已不再提供手动选择入口）。
  if (!executorId || isManagedCloudAutoExecutorId(executorId)) {
    try {
      getManagedCloudGate().ensureDevOnlyAccess()
      const state = loadState()
      await getManagedCloudGate().ensureUsageAccess({
        state,
        userId,
      })
      const result = await getManagedCloudGate().ensureExecutor({
        config: state.config,
        ownerUserId: userId,
        workspaceId: session.workspaceId?.trim() || undefined,
        projects: state.projects,
      })
      return {
        ok: true as const,
        executor: result.executor,
      }
    } catch (error) {
      if (getManagedCloudGate().isUsageLimitError(error)) {
        return {
          ok: false as const,
          status: 402 as const,
          message: error instanceof Error ? error.message : '官方云节点暂不可用。',
        }
      }

      // 云节点不可用（非开发环境未开放 / 未配置）→ 回退到用户可见的第一个在线执行器，
      // 与渠道会话 resolveAgentChannelExecutorId 的在线回退策略保持一致。
      const onlineExecutor = resolveFallbackOnlineExecutor(listVisibleExecutorsForUser(userId))
      if (onlineExecutor) {
        return {
          ok: true as const,
          executor: onlineExecutor,
        }
      }

      return {
        ok: false as const,
        status: 503 as const,
        message: error instanceof Error
          ? `当前没有可用的执行节点（${error.message}），请先连接一个执行器后再试。`
          : '当前没有可用的执行节点，请先连接一个执行器后再试。',
      }
    }
  }

  const executor = listVisibleExecutorsForUser(userId).find((item) => item.executorId === executorId)
  if (!executor) {
    return {
      ok: false as const,
      status: 403 as const,
      message: '当前主对话绑定的执行节点不可见或无权限访问。',
    }
  }

  return {
    ok: true as const,
    executor,
  }
}

export const buildMainChatMissingWorkingDirectoryMessage = (params: {
  cwd: string
  executorName: string
  detail?: string
}) => {
  const lines = [
    `当前会话绑定的工作目录在执行节点「${params.executorName}」上不可用：${params.cwd}`,
    '这通常是因为你刚切换了节点，而新节点上还没有 clone 或准备这个项目目录。',
  ]

  if (params.detail?.trim()) {
    lines.push(`节点返回：${params.detail.trim()}`)
  }

  lines.push('请先在该节点准备仓库，或新建一个不绑定旧目录的会话后再试。')
  return lines.join('\n')
}

export const validateMainChatSessionCwdOnExecutor = async (params: {
  boundCwd?: string
  executorName: string
  browseDirectory: (cwd: string) => Promise<{ ok: boolean; message?: string }>
}) => {
  const cwd = params.boundCwd?.trim()
  if (!cwd) {
    return { ok: true as const }
  }

  try {
    const result = await params.browseDirectory(cwd)
    if (result.ok) {
      return { ok: true as const }
    }

    return {
      ok: false as const,
      message: buildMainChatMissingWorkingDirectoryMessage({
        cwd,
        executorName: params.executorName,
        detail: result.message,
      }),
    }
  } catch (error) {
    return {
      ok: false as const,
      message: buildMainChatMissingWorkingDirectoryMessage({
        cwd,
        executorName: params.executorName,
        detail: error instanceof Error ? error.message : String(error),
      }),
    }
  }
}

export const loadMainChatModelOptions = async (userId: string, session: MainChatSession): Promise<{
  ok: boolean
  status?: 400 | 402 | 403 | 503
  models: ExecutionModelOption[]
  defaultModel?: string
  message?: string
}> => {
  const executorResult = await resolveMainChatExecutor(userId, session)
  if (!executorResult.ok) {
    return {
      ok: false,
      status: executorResult.status,
      models: [],
      message: executorResult.message,
    }
  }

  const effectiveAgentType = resolveChatAgentType(session, userId)
  if (!effectiveAgentType) {
    return {
      ok: false,
      status: 400,
      models: [],
      message: getUnsupportedCustomAgentRuntimeMessage(session, userId),
    }
  }
  const customAgent = resolveCustomChatAgent(session, userId)
  const preferredModel = customAgent?.profile.preferredModel?.trim() || ''
  const runtimeResult = await loadAgentModelOptionsFromExecutor(
    userId,
    effectiveAgentType,
    executorResult.executor.executorId,
    session.workspaceId?.trim() || undefined,
  )
  if (!runtimeResult.ok) {
    return {
      ok: false,
      status: runtimeResult.status,
      models: [],
      message: runtimeResult.message,
    }
  }

  const defaultModel = resolveMatchingAgentExecutionModelOptionId(
    effectiveAgentType,
    runtimeResult.models,
    preferredModel,
  ) || runtimeResult.defaultModel || ''

  return {
    ok: true,
    models: runtimeResult.models,
    defaultModel,
    message: runtimeResult.message,
  }
}

export const ensureMainChatState = (state: AppState, userId?: string): AppState => {
  const normalizedState = normalizeMainChatSessionState(state)
  const defaultCustomAgentId = userId?.trim() ? getDefaultUserAgent(userId)?.id : undefined
  const mainChatSessions = defaultCustomAgentId
    ? normalizedState.mainChatSessions.map((session) => (
        session.customAgentId ? session : { ...session, customAgentId: defaultCustomAgentId }
      ))
    : normalizedState.mainChatSessions
  const selectedSession = mainChatSessions.find((session) => session.id === normalizedState.selectedMainChatSessionId)
  if (
    mainChatSessions.length > 0
    && selectedSession
  ) {
    return {
      ...normalizedState,
      mainChatSessions,
    }
  }

  const fallbackSession = mainChatSessions[0] ?? {
    ...createMainChatSession('默认会话', { customAgentId: defaultCustomAgentId }),
  }

  return normalizeMainChatSessionState({
    ...normalizedState,
    mainChatSessions: mainChatSessions.length > 0 ? mainChatSessions : [fallbackSession],
    selectedMainChatSessionId: fallbackSession.id,
  })
}

export const appendMainChatDriveAttachment = (params: {
  state: AppState
  userId: string
  sessionId: string
  attachment: TaskChatAttachment
}): AppState => {
  // 分享 Drive 文件到主聊天：追加一条空内容 + 引用附件的用户消息（不触发 Agent 执行）
  return appendUserChatMessage(params.state, '', params.sessionId, [params.attachment])
}

export const appendMainChatTextMessage = (params: {
  state: AppState
  userId: string
  sessionId: string
  text: string
}): AppState => {
  // 分享链接到主聊天：追加一条纯文本用户消息（不触发 Agent 执行）
  return appendUserChatMessage(params.state, params.text, params.sessionId)
}

export const removeMainChatSessionsForDeletedAgent = (
  state: AppState,
  agentId: string,
  userId?: string,
): AppState => {
  const normalizedAgentId = agentId.trim()
  if (!normalizedAgentId) {
    return ensureMainChatState(state, userId)
  }

  const mainChatSessions = state.mainChatSessions.filter((session) => session.customAgentId?.trim() !== normalizedAgentId)
  const selectedMainChatSessionId = mainChatSessions.some((session) => session.id === state.selectedMainChatSessionId)
    ? state.selectedMainChatSessionId
    : mainChatSessions[0]?.id ?? ''
  const activeSession = mainChatSessions.find((session) => session.id === selectedMainChatSessionId)

  return ensureMainChatState({
    ...state,
    mainChatSessions,
    selectedMainChatSessionId,
  }, userId)
}

export const switchMainChatSession = (state: AppState, sessionId: string): AppState => {
  const nextState = ensureMainChatState(state)
  const session = nextState.mainChatSessions.find((item) => item.id === sessionId)
  if (!session) {
    return nextState
  }

  return {
    ...nextState,
    selectedMainChatSessionId: session.id,
  }
}

export const clearTaskProposalFromChat = (state: AppState, taskProposalId: string): AppState => {
  const nextState = ensureMainChatState(state)
  const sessions = nextState.mainChatSessions.map((session) => ({
    ...session,
    messages: session.messages?.map((message) => {
      if (!message.taskProposal || message.taskProposal.id !== taskProposalId) {
        return message
      }

      return {
        ...message,
        taskProposal: undefined,
      }
    }),
  }))
  const activeSession = sessions.find((session) => session.id === nextState.selectedMainChatSessionId) ?? sessions[0]

  return {
    ...nextState,
    mainChatSessions: sessions,
  }
}

const appendChatMessages = (
  state: AppState,
  userId: string,
  userMessage: string,
  assistantMessage: string,
  assistantPatch?: Partial<ChatMessage>,
  sessionId?: string,
  userAttachments?: TaskChatAttachment[],
): AppState => {
  const nextState = ensureMainChatState(state)
  const timestamp = new Date().toISOString()
  const targetSessionId = sessionId?.trim() || nextState.selectedMainChatSessionId
  const targetSession = nextState.mainChatSessions.find((session) => session.id === targetSessionId)
  if (!targetSession) {
    return nextState
  }

  return updateChatSession(nextState, targetSessionId, (session) => {
    const userPatch = userAttachments?.length ? { attachments: userAttachments } : {}
    const assistantAuthor = resolveSessionAssistantAuthor(session, userId)
    const existingMessages = session.messages ?? []
    const nextMessages = [
      ...existingMessages,
      { id: crypto.randomUUID(), role: 'user' as const, content: userMessage, createdAt: timestamp, ...userPatch },
      {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: assistantMessage,
        createdAt: new Date().toISOString(),
        ...assistantAuthor,
        ...assistantPatch,
      },
    ]

    return {
      ...session,
      title: existingMessages.length === 0 ? buildSessionTitle(userMessage) : session.title,
      messages: nextMessages,
      updatedAt: nextMessages.at(-1)?.createdAt ?? timestamp,
    }
  })
}

const appendUserChatMessage = (
  state: AppState,
  userMessage: string,
  sessionId?: string,
  userAttachments?: TaskChatAttachment[],
  clientMessageId?: string,
  replyToMessageId?: string,
  referencedDocs?: ChatDocReference[],
  mentionedConversationIds?: ReadonlySet<string>,
  mentionedWorkspaceIds?: ReadonlySet<string>,
): AppState => {
  const nextState = ensureMainChatState(state)
  const timestamp = new Date().toISOString()
  const targetSessionId = sessionId?.trim() || nextState.selectedMainChatSessionId
  const targetSession = nextState.mainChatSessions.find((session) => session.id === targetSessionId)
  if (!targetSession) {
    return nextState
  }

  return updateChatSession(nextState, targetSessionId, (session) => {
    const userPatch = userAttachments?.length ? { attachments: userAttachments } : {}
    const replyPatch = replyToMessageId?.trim() ? { replyToMessageId: replyToMessageId.trim() } : {}
    const mentionTargets = [
      ...(referencedDocs?.length ? referencedDocs.map((ref) => ({ targetType: 'doc' as const, targetId: ref.id })) : []),
      ...(mentionedConversationIds?.size ? [...mentionedConversationIds].map((targetId) => ({ targetType: 'conversation' as const, targetId })) : []),
      ...(mentionedWorkspaceIds?.size ? [...mentionedWorkspaceIds].map((targetId) => ({ targetType: 'workspace' as const, targetId })) : []),
    ]
    const externalRefPatch = clientMessageId || mentionTargets.length > 0
      ? {
          externalRef: {
            ...(clientMessageId ? { clientMessageId } : {}),
            ...(mentionTargets.length > 0 ? { mentions: mentionTargets } : {}),
            ...(referencedDocs?.length ? { referencedDocs } : {}),
          },
        }
      : {}
    const existingMessages = session.messages ?? []
    const nextMessages = [
      ...existingMessages,
      { id: crypto.randomUUID(), role: 'user' as const, content: userMessage, createdAt: timestamp, ...userPatch, ...replyPatch, ...externalRefPatch },
    ]

    return {
      ...session,
      title: existingMessages.length === 0 ? buildSessionTitle(userMessage) : session.title,
      messages: nextMessages,
      updatedAt: timestamp,
    }
  })
}

const appendAssistantChatMessage = (
  state: AppState,
  userId: string,
  assistantMessage: string,
  sessionId?: string,
  assistantPatch?: Partial<ChatMessage>,
): AppState => {
  const nextState = ensureMainChatState(state)
  const timestamp = new Date().toISOString()
  const targetSessionId = sessionId?.trim() || nextState.selectedMainChatSessionId
  const targetSession = nextState.mainChatSessions.find((session) => session.id === targetSessionId)
  if (!targetSession) {
    return nextState
  }

  return updateChatSession(nextState, targetSessionId, (session) => {
    const assistantAuthor = resolveSessionAssistantAuthor(session, userId)
    const nextMessages = [
      ...(session.messages ?? []),
      {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: assistantMessage,
        createdAt: timestamp,
        ...assistantAuthor,
        ...assistantPatch,
      },
    ]

    return {
      ...session,
      messages: nextMessages,
      updatedAt: timestamp,
    }
  })
}

export const executeMainAgentChat = async (
  state: AppState,
  userId: string,
  message: string,
  prepared: {
    output: string
    sessionId?: string
    agentType?: ServerAgentType
    continuationScope?: MainChatContinuationScope
    reasoning?: string[]
    toolCalls?: ToolCall[]
    usage?: ModelTokenUsage
  },
  sessionId?: string,
  attachments?: TaskChatAttachment[],
): Promise<MainAgentChatResponse> => {
  const normalizedState = ensureMainChatState(state, userId)
  const assistantPatch: Partial<ChatMessage> = {
    agentRunningStatus: 'complete',
    currentStep: 'Agent 系统对话已完成',
    reasoning: prepared.reasoning,
    toolCalls: prepared.toolCalls,
    usage: prepared.usage,
  }
  const nextState = appendChatMessages(normalizedState, userId, message, prepared.output, assistantPatch, sessionId, attachments)
  const stateWithRuntimeSession = updateMainChatRuntimeSession(
    nextState,
    sessionId,
    prepared.continuationScope,
    prepared.sessionId,
  )
  const response = await withState(stateWithRuntimeSession, prepared.output, userId)

  // 统一 usage 事件：main chat / 直接 Agent 会话链路（fire-and-forget，不阻塞回复）。
  const targetSessionId = sessionId?.trim() || nextState.selectedMainChatSessionId
  const targetSession = nextState.mainChatSessions.find((session) => session.id === targetSessionId)
  const assistantMessage = [...(targetSession?.messages ?? [])].reverse().find((message) => message.role === 'assistant')
  if (targetSession && assistantMessage?.id && prepared.usage) {
    const author = resolveSessionAssistantAuthor(targetSession, userId)
    void recordUsageEvent({
      runKind: 'main_chat',
      runId: assistantMessage.id,
      userId,
      agentId: author.authorId,
      agentName: author.authorName,
      conversationId: targetSessionId,
      workspaceId: targetSession.workspaceId,
      executorNodeId: targetSession.executorId,
      executionModel: targetSession.executionModel,
      usage: prepared.usage,
    }).catch((error) => {
      console.warn('[usage-event] main_chat record failed', error)
    })
  }

  return {
    ...response,
    reasoning: prepared.reasoning,
    toolCalls: prepared.toolCalls,
    usage: prepared.usage,
  }
}

export const validateMainChatModel = async (
  userId: string,
  session: MainChatSession,
  requestedModel: string | undefined,
) => {
  if (!requestedModel) {
    return { ok: true as const }
  }

  const modelsResult = await loadMainChatModelOptions(userId, session)
  if (!modelsResult.ok) {
    return {
      ok: false as const,
      status: modelsResult.status ?? 503,
      message: modelsResult.message || '模型列表加载失败。',
    }
  }

  const effectiveAgentType = resolveChatAgentType(session, userId) ?? 'OpenCode'
  if (!findMatchingAgentExecutionModelOption(effectiveAgentType, modelsResult.models, requestedModel)) {
    return { ok: false as const, status: 400 as const, message: '所选模型当前不可用。' }
  }

  // 协作区模型白名单硬约束：归属工作区的共享会话请求模型必须在白名单内。
  if (session.workspaceId?.trim()) {
    const blockedReason = checkTeamModelAllowed(session.workspaceId, requestedModel)
    if (blockedReason) {
      return { ok: false as const, status: 400 as const, message: blockedReason }
    }
  }

  return { ok: true as const }
}

const buildCustomChatWorkerPrompt = (
  projects: Project[],
  message: string,
  customAgent: ResolvedCustomChatAgent,
  workDirPath: string,
  handoffSnapshot?: ConversationHandoffSnapshot,
  userId = '',
  mind?: { soul?: string; memory?: string },
) => {
  const historySection = buildConversationHandoffPromptSection(handoffSnapshot)

  return [
    buildCustomAgentSystemPrompt(
      projects,
      customAgent.agent,
      customAgent.profile,
      userId,
      mind,
    ),
    '',
    `默认工作目录: ${workDirPath}`,
    '这个 Agent 的自由文件工作区仅限默认工作目录。Agent 根目录下的隐藏 .system 区域属于 wemux 自己管理，不应主动读写。',
    '',
    historySection,
    `用户消息：${message.trim()}`,
    '请直接面向用户回复，保持简洁、真实、可执行。',
  ].filter(Boolean).join('\n')
}

const buildAgentWorkdirPromptPath = (agentId: string) => {
  return `~/.wemux/agents/${sanitizeAgentWorkdirId(agentId)}/workdir`
}

export const requestMainChatExecutorReply = async (params: {
  state: AppState
  userId: string
  message: string
  attachments?: TaskChatAttachment[]
  sessionId?: string
  signal?: AbortSignal
  onEvent?: (event: MainChatResponseEvent) => void
}) => {
  const normalizedState = ensureMainChatState(params.state, params.userId)
  const targetSession = getChatSessionById(normalizedState, params.sessionId)
  if (!targetSession) {
    return {
      ok: false as const,
      status: 404 as const,
      output: '对话会话不存在。',
      reasoning: [] as string[],
      toolCalls: [] as ToolCall[],
    }
  }

  // Token 配额控制：block 且当前周期超限时拒绝新的执行（warn 不阻断）。
  try {
    await ensureTokenQuotaAccess(params.userId)
  } catch (error) {
    if (isTokenQuotaLimitError(error)) {
      return {
        ok: false as const,
        status: 429 as const,
        output: error.message,
        reasoning: [] as string[],
        toolCalls: [] as ToolCall[],
      }
    }
    throw error
  }

  const executorResult = await resolveMainChatExecutor(params.userId, targetSession)
  if (!executorResult.ok) {
    return {
      ok: false as const,
      status: executorResult.status,
      output: executorResult.message,
      reasoning: [] as string[],
      toolCalls: [] as ToolCall[],
    }
  }

  const customAgent = resolveCustomChatAgent(targetSession, params.userId)
  const cwd = customAgent
    ? buildAgentWorkdirPromptPath(customAgent.agent.id)
    : targetSession.cwd?.trim() || executorResult.executor.workspaceRoot?.trim()
  if (!cwd) {
    return {
      ok: false as const,
      status: 503 as const,
      output: '当前执行节点未配置工作目录。',
      reasoning: [] as string[],
      toolCalls: [] as ToolCall[],
    }
  }

  const textState = new Map<string, string>()
  const reasoningState = new Map<string, string>()
  const toolCallMap = new Map<string, ToolCall>()
  let streamedAssistantText = ''
  let assistantMessageId = ''
  const scopedProjects = getScopedState(normalizedState, params.userId).projects
  const customSkills = customAgent ? resolveSkillSelections(customAgent.profile.skills, { userId: params.userId }) : []
  const effectiveAgentType = resolveChatAgentType(targetSession, params.userId)
  if (!effectiveAgentType) {
    return {
      ok: false as const,
      status: 400 as const,
      output: getUnsupportedCustomAgentRuntimeMessage(targetSession, params.userId),
      reasoning: [] as string[],
      toolCalls: [] as ToolCall[],
    }
  }
  const historyMessages = getMainChatPromptHistory(targetSession, params.message)
  const handoffSnapshot = buildMainChatHandoffSnapshot(historyMessages) ?? targetSession.handoffSnapshot
  const runtimeSkills = customAgent
    ? resolveRuntimeSkills({ userId: params.userId }).filter((skill, index, skills) => {
        return skills.findIndex((item) => item.id === skill.id) === index
      })
    : resolveRuntimeSkills({ userId: params.userId })
  const mergedRuntimeSkills = customAgent
    ? dedupeRuntimeSkills([...customSkills, ...runtimeSkills], {
        preferredSkillIds: new Set(customSkills.map((skill) => skill.id)),
      })
    : runtimeSkills
  const runtimeSkillPackages = buildRuntimeSkillPackagesFromSkills(mergedRuntimeSkills)
  const opencodeConfig = customAgent && effectiveAgentType === 'OpenCode'
    ? {
        mcpServers: customAgent.profile.mcpServers.filter((server) => server.enabled),
      }
    : undefined
  const selectedExecutionModel = targetSession.executionModel || customAgent?.profile.preferredModel || undefined
  const modelRuntime = await resolveModelProfileRuntime({
    userId: params.userId,
    agentType: effectiveAgentType,
    executionModel: selectedExecutionModel,
    fallbackExecutionModel: getServerAgentDefaultModel(normalizedState.config, effectiveAgentType),
    workspaceId: targetSession.workspaceId?.trim() || undefined,
  })
  const executionModel = modelRuntime.executionModel ?? selectedExecutionModel
  const agentSettings = modelRuntime.runtimeSettings
    ? mergeAgentRuntimeSettings(
        effectiveAgentType,
        getServerAgentSettings(normalizedState.config, effectiveAgentType),
        modelRuntime.runtimeSettings,
      )
    : undefined
  const capabilitySnapshot = resolveTaskRuntimeCapabilitySnapshot({
    userId: params.userId,
    runtimeEnv: modelRuntime.runtimeEnv,
    runtimeSkillPackages,
    mcpServers: customAgent
      ? [
          ...getPrimaryAgentMcpServers(normalizedState.config, params.userId, targetSession.workspaceId?.trim() || undefined),
          ...customAgent.profile.mcpServers.filter((server) => server.enabled),
        ]
      : getPrimaryAgentMcpServers(normalizedState.config, params.userId, targetSession.workspaceId?.trim() || undefined),
    opencodeConfig,
  })
  const continuationScope: MainChatContinuationScope = {
    runtimeId: effectiveAgentType,
    executorId: targetSession.executorId,
    customAgentId: targetSession.customAgentId,
    executionModel,
    cwd,
  }
  const basePrompt = customAgent
    ? await (async () => {
        const mind = await readAgentMindSnapshot({
          // 记忆文件在 owner 个人域，始终以 owner 身份读（共享 Agent 被成员调用也注入同一份）
          userId: customAgent.agent.ownerUserId ?? params.userId,
          agentId: customAgent.agent.id,
        }).catch(() => null)
        return buildCustomChatWorkerPrompt(
          scopedProjects,
          params.message,
          customAgent,
          cwd,
          handoffSnapshot,
          params.userId,
          mind ?? undefined,
        )
      })()
    : buildMainChatWorkerPrompt(
        scopedProjects,
        buildMessageWithRuntimeSkillMentions(params.message, { userId: params.userId }),
        handoffSnapshot,
        params.userId,
      )
  const prompt = [
    buildMainAgentRuntimeToolInstructions(effectiveAgentType),
    basePrompt,
  ].filter(Boolean).join('\n\n')

  params.onEvent?.({
    type: 'status',
    status: 'thinking',
    currentStep: 'Agent 系统正在分析上下文...',
  })

  if (!customAgent && targetSession.cwd?.trim()) {
    params.onEvent?.({
      type: 'status',
      status: 'thinking',
      currentStep: '正在检查当前节点上的工作目录...',
    })

    const cwdValidation = await validateMainChatSessionCwdOnExecutor({
      boundCwd: targetSession.cwd,
      executorName: executorResult.executor.name?.trim() || executorResult.executor.executorId,
      browseDirectory: async (boundCwd) => {
        return executorWsService.requestDirectoryBrowse(
          executorResult.executor.executorId,
          boundCwd,
          boundCwd,
        )
      },
    })
    if (!cwdValidation.ok) {
      return {
        ok: false as const,
        status: 503 as const,
        output: cwdValidation.message,
        reasoning: [] as string[],
        toolCalls: [] as ToolCall[],
      }
    }
  }

  try {
    if (customAgent) {
      touchAgentWorkdirSession(customAgent.agent.id, targetSession.id)
    }
    const result = await executorWsService.requestAgentPrompt(executorResult.executor.executorId, {
      agentType: effectiveAgentType as Task['agentType'],
      actingUserId: params.userId,
      runtimeAgentId: customAgent?.agent.id,
      resumeSessionId: getMainChatRuntimeSessionId(targetSession, continuationScope),
      cwd,
      agentWorkdir: customAgent ? { agentId: customAgent.agent.id, sessionId: targetSession.id, workspaceId: targetSession.workspaceId } : undefined,
      title: customAgent ? `wemux Agent Chat · ${customAgent.agent.name}` : 'wemux Main Agent Chat',
      prompt,
      executionModel,
      agentSettings,
      opencodeConfig: capabilitySnapshot.opencodeConfig,
      mcpServers: capabilitySnapshot.mcpServers,
      runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
      runtimeEnv: capabilitySnapshot.runtimeEnv,
      runtimeEnvironment: targetSession.workspaceId
        ? await resolveWorkspaceRuntimeEnvironment(targetSession.workspaceId).then((value) => value?.payload).catch(() => undefined)
        : undefined,
      attachments: params.attachments,
      mainChatRecovery: {
        userId: params.userId,
        sessionId: targetSession.id,
        userMessage: params.message,
        attachments: params.attachments,
        continuationScope,
      },
      signal: params.signal,
      onEvent: (event) => {
        if (event.type === 'session.status') {
          const statusPayload = event.properties.status as { type?: string; message?: string } | undefined
          if (statusPayload?.type === 'busy') {
            params.onEvent?.({
              type: 'status',
              status: 'executing',
              currentStep: statusPayload.message?.trim() || 'Agent 系统正在调用工具与整理回复',
            })
            return
          }

          if (statusPayload?.type === 'retry') {
            params.onEvent?.({
              type: 'status',
              status: 'thinking',
              currentStep: statusPayload.message?.trim() || 'Agent 系统正在重试',
            })
          }
          return
        }

        if (event.type === 'message.updated') {
          const info = event.properties.info as { id?: string; role?: string } | undefined
          if (info?.role === 'assistant' && info.id) {
            if (assistantMessageId && assistantMessageId !== info.id) {
              textState.clear()
            }
            assistantMessageId = info.id
          }
          return
        }

        if (event.type === 'message.part.delta') {
          const properties = event.properties as {
            messageID?: string
            partID?: string
            field?: string
            delta?: string
          }
          if (properties.field !== 'text' || !properties.partID || !properties.delta) {
            return
          }
          if (assistantMessageId && properties.messageID && properties.messageID !== assistantMessageId) {
            return
          }

          textState.set(properties.partID, `${textState.get(properties.partID) ?? ''}${properties.delta}`)
          const nextAssistantText = sanitizeMainChatReply(
            [...textState.values()].join(''),
            params.message,
          )
          if (!nextAssistantText) {
            streamedAssistantText = ''
            return
          }

          const nextDelta = nextAssistantText.startsWith(streamedAssistantText)
            ? nextAssistantText.slice(streamedAssistantText.length)
            : nextAssistantText
          streamedAssistantText = nextAssistantText
          if (nextDelta) {
            params.onEvent?.({ type: 'delta', content: nextDelta })
          }
          return
        }

        if (event.type !== 'message.part.updated') {
          return
        }

        const part = event.properties.part as {
          id: string
          messageID?: string
          type: string
          text?: string
          tool?: string
          state?: {
            status: 'pending' | 'running' | 'completed' | 'error'
            input?: Record<string, unknown>
            output?: string
            error?: string
            raw?: string
            time?: {
              start?: number
              end?: number
            }
          }
        }
        if (assistantMessageId && part.messageID && part.messageID !== assistantMessageId) {
          return
        }

        if (part.type === 'text') {
          textState.set(part.id, part.text ?? '')

          const nextAssistantText = sanitizeMainChatReply(
            [...textState.values()].join(''),
            params.message,
          )
          if (!nextAssistantText) {
            streamedAssistantText = ''
            return
          }

          const nextDelta = nextAssistantText.startsWith(streamedAssistantText)
            ? nextAssistantText.slice(streamedAssistantText.length)
            : nextAssistantText
          streamedAssistantText = nextAssistantText
          if (nextDelta) {
            params.onEvent?.({ type: 'delta', content: nextDelta })
          }
          return
        }

        if (part.type === 'reasoning') {
          reasoningState.set(part.id, part.text ?? '')
          if (part.text?.trim()) {
            params.onEvent?.({
              type: 'reasoning',
              partId: part.id,
              content: part.text ?? '',
            })
          }
          return
        }

        if (part.type === 'tool' && part.tool && part.state) {
          const toolCall = buildToolCall({
            id: part.id,
            tool: part.tool,
            state: part.state,
          }, toolCallMap.get(part.id))
          toolCallMap.set(part.id, toolCall)
          params.onEvent?.({ type: 'tool', status: part.state.status, toolCall })
          params.onEvent?.({
            type: 'status',
            status: part.state.status === 'pending' || part.state.status === 'running' ? 'executing' : 'thinking',
            currentStep: `Agent 系统正在调用工具：${part.tool}`,
          })
        }
      },
    })

    return {
      ok: result.ok,
      status: result.ok ? (200 as const) : (503 as const),
      output: sanitizeMainChatReply(result.output, params.message, true),
      sessionId: result.sessionId,
      agentType: effectiveAgentType,
      continuationScope,
      reasoning: [...reasoningState.values()].map((item) => item.trim()).filter(Boolean),
      toolCalls: [...toolCallMap.values()],
      usage: result.usage,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const abortReason = (error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason ?? 'unknown'
      return {
        ok: false as const,
        aborted: true as const,
        abortReason,
        output: error.message?.trim() || (abortReason === 'user_stop' ? '已停止' : '本次回复已中止'),
        /**
         * 中止前已经流出去的正文。output 是状态文案（「已停止」），不是内容；
         * 两者分开返回，调用方才能把片段落库、把状态文案留给运行态字段。
         */
        partialOutput: streamedAssistantText,
        sessionId: undefined,
        agentType: effectiveAgentType,
        continuationScope,
        reasoning: [...reasoningState.values()].map((item) => item.trim()).filter(Boolean),
        toolCalls: [...toolCallMap.values()],
      }
    }

    return {
      ok: false as const,
      status: 503 as const,
      output: error instanceof Error ? error.message : 'Agent 系统对话失败。',
      sessionId: undefined,
      agentType: effectiveAgentType,
      continuationScope,
      reasoning: [...reasoningState.values()].map((item) => item.trim()).filter(Boolean),
      toolCalls: [...toolCallMap.values()],
    }
  }
}

export const streamMainChatResponse = async (params: {
  state: AppState
  userId: string
  message: string
  attachments?: TaskChatAttachment[]
  sessionId?: string
  clientMessageId?: string
  replyToMessageId?: string
  signal: AbortSignal
  sendEvent: (data: Record<string, unknown>) => void
}) => {
  const resolvedSessionId = params.sessionId?.trim() || params.state.selectedMainChatSessionId
  const executionBinding = resolvedSessionId
    ? bindMainChatExecutionAbortSignal({
        userId: params.userId,
        sessionId: resolvedSessionId,
        upstreamSignal: params.signal,
      })
    : null
  const effectiveSignal = executionBinding?.signal ?? params.signal

  try {
    const normalizedState = ensureMainChatState(params.state, params.userId)
    // @文档：匹配个人 Drive 文件（reference_doc 引用）
    const mentionedDocRefs = await resolveMentionedDocRefs({
      message: params.message,
      scopes: [{ workspaceId: null, userId: params.userId }],
    })
    // @会话 / @工作区：引用型提及（不通知、不唤醒 Agent）
    const scopedState = getScopedState(loadState(), params.userId)
    const { mentionedIds: mentionedConversationIds } = resolveMentionedConversationIdsForUser({
      message: params.message,
      userId: params.userId,
      scopedState,
      mainChatSessions: normalizedState.mainChatSessions,
    })
    const userWorkspaces = await listUserWorkspaces(params.userId)
    const mentionedWorkspaceIds = resolveMentionedWorkspaceIds(
      params.message,
      userWorkspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    )
    // Pre-append user message so AI can see conversation history
    const stateWithUserMsg = appendUserChatMessage(normalizedState, params.message, params.sessionId, params.attachments, params.clientMessageId, params.replyToMessageId, mentionedDocRefs, mentionedConversationIds, mentionedWorkspaceIds)
    const stateWithRunningSession = updateMainChatSessionRuntimeState(
      stateWithUserMsg,
      params.sessionId,
      'thinking',
      'Agent 系统正在分析上下文...',
    )
    await publishState(stateWithRunningSession)

    // @文档 记录持久化（旁路）：reference_doc 引用（主聊天会话 id 即 mention 的 conversationId）
    const mentionConversationId = resolvedSessionId || stateWithUserMsg.selectedMainChatSessionId
    for (const docRef of mentionedDocRefs) {
      void createConversationMention({
        conversationId: mentionConversationId,
        messageId: undefined,
        mentionerId: params.userId,
        mentionerType: 'user',
        mentionedId: docRef.id,
        mentionedType: 'doc',
        mentionScope: 'reference_doc',
        contextJson: { name: docRef.name },
      }).catch(() => {})
    }
    // @会话 / @工作区 记录持久化（旁路）：share_conversation / share_workspace 引用
    for (const targetConversationId of mentionedConversationIds) {
      void createConversationMention({
        conversationId: mentionConversationId,
        messageId: undefined,
        mentionerId: params.userId,
        mentionerType: 'user',
        mentionedId: targetConversationId,
        mentionedType: 'conversation',
        mentionScope: 'share_conversation',
        contextJson: { targetConversationId, targetTitle: '' },
      }).catch(() => {})
    }
    for (const targetWorkspaceId of mentionedWorkspaceIds) {
      const target = userWorkspaces.find((workspace) => workspace.id === targetWorkspaceId)
      void createConversationMention({
        conversationId: mentionConversationId,
        messageId: undefined,
        mentionerId: params.userId,
        mentionerType: 'user',
        mentionedId: targetWorkspaceId,
        mentionedType: 'workspace',
        mentionScope: 'share_workspace',
        contextJson: { targetWorkspaceId, targetName: target?.name ?? '' },
      }).catch(() => {})
    }

    const streamResult = await requestMainChatExecutorReply({
      state: stateWithRunningSession,
      userId: params.userId,
      message: params.message,
      attachments: params.attachments,
      sessionId: params.sessionId,
      signal: effectiveSignal,
      onEvent: (event) => {
        if (event.type === 'delta') {
          params.sendEvent({ type: 'delta', content: event.content })
          publishMainChatEvent(resolvedSessionId, 'delta', { content: event.content })
          return
        }

        if (event.type === 'reasoning') {
          params.sendEvent({ type: 'reasoning', content: event.content, partId: event.partId })
          publishMainChatEvent(resolvedSessionId, 'reasoning', { content: event.content, partId: event.partId })
          return
        }

        if (event.type === 'tool') {
          params.sendEvent({ type: 'tool', content: event.toolCall.name, toolCall: event.toolCall, toolStatus: event.status })
          publishMainChatEvent(resolvedSessionId, 'tool', { content: event.toolCall.name, toolCall: event.toolCall, toolStatus: event.status })
          return
        }

        params.sendEvent({ type: 'status', content: event.currentStep, status: event.status, currentStep: event.currentStep })
        publishMainChatEvent(resolvedSessionId, 'status', { content: event.currentStep, status: event.status, currentStep: event.currentStep })
      },
    })

    if (streamResult.aborted) {
      /**
       * 两条中止路径统一为「保留片段 + 标注」：已经流到前端的正文必须落库，
       * 否则用户看着文字出现又整段消失。中止文案属于运行态（currentStep），
       * 不再顶替 content —— 那样会把已生成的内容替换成一句状态提示。
       *
       * blob 侧仍按追加顺序写入数组，不携带 seq；真正的 seq 由
       * thread-message-sync 镜像同步时通过 lockThreadAndGetNextSeq 统一分配
       * （单一分配点已收敛到关系表写入路径，blob 数组顺序仅用于计算镜像 diff）。
       */
      const partialOutput = streamResult.partialOutput?.trim() ?? ''

      if (streamResult.abortReason && streamResult.abortReason !== 'user_stop') {
        const errorMessage = streamResult.output?.trim() || '本次回复已中止'
        const stateWithAbortMessage = updateMainChatSessionRuntimeState(
          appendAssistantChatMessage(
            stateWithRunningSession,
            params.userId,
            partialOutput || errorMessage,
            params.sessionId,
            {
              agentRunningStatus: 'error',
              currentStep: errorMessage,
              finishReason: 'aborted',
              reasoning: streamResult.reasoning,
              toolCalls: streamResult.toolCalls,
              usage: streamResult.usage,
            },
          ),
          params.sessionId,
          'idle',
          '',
        )
        const persistedAbortResponse = await withState(stateWithAbortMessage, undefined, params.userId)
        params.sendEvent({
          type: 'error',
          content: errorMessage,
          state: persistedAbortResponse.state,
          reasoning: streamResult.reasoning,
          toolCalls: streamResult.toolCalls,
          usage: streamResult.usage,
          status: 'error',
          currentStep: errorMessage,
          abortReason: streamResult.abortReason,
        })
        publishMainChatEvent(resolvedSessionId, 'message_saved', {
          content: partialOutput || errorMessage,
          status: 'error',
        })
        return { completed: false as const }
      }

      // 用户主动停止：只有真的产出过正文才落库。空片段落一条空消息毫无信息量，
      // 反而在时间线上留一个空气泡。
      const stateAfterUserStop = partialOutput
        ? appendAssistantChatMessage(
            stateWithRunningSession,
            params.userId,
            partialOutput,
            params.sessionId,
            {
              finishReason: 'aborted',
              reasoning: streamResult.reasoning,
              toolCalls: streamResult.toolCalls,
              usage: streamResult.usage,
            },
          )
        : stateWithRunningSession

      await publishState(updateMainChatSessionRuntimeState(stateAfterUserStop, params.sessionId, 'idle', ''))
      if (partialOutput) {
        publishMainChatEvent(resolvedSessionId, 'message_saved', {
          content: partialOutput,
          status: 'aborted',
        })
      }
      return { completed: false as const }
    }

    if (!streamResult.ok) {
      const errorMessage = streamResult.output?.trim() || 'Agent 系统对话失败'
      const stateWithErrorMessage = updateMainChatSessionRuntimeState(
        appendAssistantChatMessage(
          stateWithRunningSession,
          params.userId,
          errorMessage,
          params.sessionId,
          {
            agentRunningStatus: 'error',
            currentStep: errorMessage,
            finishReason: 'error',
            reasoning: streamResult.reasoning,
            toolCalls: streamResult.toolCalls,
            usage: streamResult.usage,
          },
        ),
        params.sessionId,
        'idle',
        '',
      )
      const persistedErrorResponse = await withState(stateWithErrorMessage, undefined, params.userId)
      params.sendEvent({
        type: 'error',
        content: errorMessage,
        state: persistedErrorResponse.state,
        reasoning: streamResult.reasoning,
        toolCalls: streamResult.toolCalls,
        usage: streamResult.usage,
        status: 'error',
        currentStep: errorMessage,
      })
      publishMainChatEvent(resolvedSessionId, 'message_saved', {
        content: errorMessage,
        status: 'error',
      })
      return { completed: false as const }
    }

    // Append assistant message to the session
    const stateWithBothMsgs = updateMainChatSessionRuntimeState(
      appendAssistantChatMessage(
        stateWithRunningSession,
        params.userId,
        streamResult.output,
        params.sessionId,
        {
          agentRunningStatus: 'complete',
          currentStep: 'Agent 系统对话已完成',
          // 正常收尾也显式标注，渲染层才能区分「完整」与「未记录」，
          // 而不是把 undefined 一律当成完整回答。
          finishReason: 'end_turn',
          reasoning: streamResult.reasoning,
          toolCalls: streamResult.toolCalls,
          usage: streamResult.usage,
        },
      ),
      params.sessionId,
      'idle',
      '',
    )
    const stateWithRuntimeSession = updateMainChatRuntimeSession(
      stateWithBothMsgs,
      params.sessionId,
      streamResult.continuationScope,
      streamResult.sessionId,
    )
    const persistedResponse = await withState(stateWithRuntimeSession, undefined, params.userId)

    const doneEvent: Record<string, unknown> = {
      type: 'done',
      content: streamResult.output,
      state: persistedResponse.state,
      reasoning: streamResult.reasoning,
      toolCalls: streamResult.toolCalls,
      usage: streamResult.usage,
      status: 'complete',
      currentStep: 'Agent 系统对话已完成',
    }
    params.sendEvent(doneEvent)
    publishMainChatEvent(resolvedSessionId, 'message_saved', {
      content: streamResult.output,
      status: 'complete',
    })
    return { completed: true as const }
  } finally {
    executionBinding?.cleanup()
  }
}

export const runMainChatResponse = async (params: {
  state: AppState
  userId: string
  message: string
  attachments?: TaskChatAttachment[]
  sessionId?: string
  signal?: AbortSignal
  onEvent?: (event: MainChatResponseEvent) => void
}): Promise<{ state: AppState; message: string | undefined; taskProposal?: TaskProposal; reasoning?: string[]; toolCalls?: ToolCall[]; usage?: ModelTokenUsage; aborted?: boolean; status?: 200 | 400 | 402 | 403 | 404 | 429 | 503 }> => {
  const normalizedState = ensureMainChatState(params.state, params.userId)
  const result = await requestMainChatExecutorReply({
    state: normalizedState,
    userId: params.userId,
    message: params.message,
    attachments: params.attachments,
    sessionId: params.sessionId,
    signal: params.signal,
    onEvent: params.onEvent,
  })
  if (!result.ok) {
    return {
      state: normalizedState,
      message: result.output,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      usage: result.usage,
      aborted: result.aborted,
      status: result.status,
    }
  }

  const response = await executeMainAgentChat(normalizedState, params.userId, params.message, {
    output: result.output,
    sessionId: result.sessionId,
    agentType: result.agentType,
    continuationScope: result.continuationScope,
    reasoning: result.reasoning,
    toolCalls: result.toolCalls,
    usage: result.usage,
  }, params.sessionId, params.attachments)

  return {
    ...response,
    status: 200,
  }
}
