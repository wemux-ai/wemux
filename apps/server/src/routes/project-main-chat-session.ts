// [INPUT]: 已鉴权 Hono app，主聊天会话请求
// [OUTPUT]: 项目主聊天会话 HTTP/WS 路由
// [POS]: 主聊天会话协议层（mainChatSession 作用域）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import type {
  AgentRunningStatus,
  AppState,
  ChatMessage,
  ConversationHandoffSnapshot,
  MainChatSession,
  Project,
  RuntimeId,
} from '@shared/types'
import { buildMainAgentSystemPrompt } from '../services/main-agent-prompt'
import {
  buildConversationHandoffPromptSection as renderConversationHandoffPromptSection,
  buildConversationHandoffSnapshot,
} from '../services/conversation-handoff'
import { isServerAgentType } from '../services/server-agent'
export { buildSessionTitle } from '../services/session-title'

export type MainChatContinuationScope = {
  runtimeId: RuntimeId
  executorId?: string
  customAgentId?: string
  executionModel?: string
  cwd?: string
}

type MainChatSessionCreationDefaults = Pick<MainChatSession, 'customAgentId' | 'executorId' | 'executionModel'>

const normalizeScopeValue = (value?: string | null) => {
  return value?.trim() || ''
}

const normalizeCustomAgentId = (value?: string | null) => {
  return value?.trim() || undefined
}

const buildCwdHash = (cwd?: string) => {
  const normalizedCwd = normalizeScopeValue(cwd)
  if (!normalizedCwd) {
    return ''
  }

  return createHash('sha1').update(normalizedCwd).digest('hex').slice(0, 12)
}

export const buildMainChatContinuationScopeKey = (scope: MainChatContinuationScope) => {
  return [
    `runtime=${scope.runtimeId}`,
    `executor=${normalizeScopeValue(scope.executorId) || 'default'}`,
    `persona=${normalizeScopeValue(scope.customAgentId) || 'main'}`,
    `model=${normalizeScopeValue(scope.executionModel) || 'default'}`,
    `cwd=${buildCwdHash(scope.cwd) || 'default'}`,
  ].join('|')
}

export const createMainChatSession = (
  title = '新会话',
  options?: {
    ownerUserId?: string
    customAgentId?: string
    executorId?: string
    workspaceId?: string
    cwd?: string
    executionModel?: string
    sourceChannel?: MainChatSession['sourceChannel']
    externalConversationId?: string
    externalUserId?: string
    externalChatId?: string
    externalThreadId?: string
  },
): MainChatSession => {
  const timestamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title,
    ...(options?.ownerUserId === undefined ? {} : { ownerUserId: options.ownerUserId }),
    customAgentId: options?.customAgentId?.trim() || undefined,
    sourceChannel: options?.sourceChannel,
    externalConversationId: options?.externalConversationId?.trim() || undefined,
    externalUserId: options?.externalUserId?.trim() || undefined,
    externalChatId: options?.externalChatId?.trim() || undefined,
    externalThreadId: options?.externalThreadId?.trim() || undefined,
    agentRunningStatus: 'idle',
    currentStep: '',
    executorId: options?.executorId?.trim() || undefined,
    workspaceId: options?.workspaceId?.trim() || undefined,
    cwd: options?.cwd?.trim() || undefined,
    executionModel: options?.executionModel?.trim() || undefined,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export const createCustomAgentChatSession = (
  customAgentId: string,
  title = '新会话',
  options?: Omit<Parameters<typeof createMainChatSession>[1], 'customAgentId'>,
): MainChatSession => {
  return createMainChatSession(title, { ...options, customAgentId })
}

const matchesTargetAgent = (session: Pick<MainChatSession, 'customAgentId'>, customAgentId?: string) => {
  return normalizeCustomAgentId(session.customAgentId) === normalizeCustomAgentId(customAgentId)
}

export const resolveNewMainChatSessionDefaults = (params: {
  sessions: MainChatSession[]
  selectedSessionId?: string
  customAgentId?: string
}): MainChatSessionCreationDefaults => {
  const normalizedCustomAgentId = normalizeCustomAgentId(params.customAgentId)
  const selectedSession = params.sessions.find((session) => session.id === params.selectedSessionId)
  const matchedSelectedSession = selectedSession && matchesTargetAgent(selectedSession, normalizedCustomAgentId)
    ? selectedSession
    : undefined
  const fallbackSession = [...params.sessions]
    .filter((session) => matchesTargetAgent(session, normalizedCustomAgentId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const sourceSession = matchedSelectedSession ?? fallbackSession

  return {
    customAgentId: normalizedCustomAgentId ?? normalizeCustomAgentId(sourceSession?.customAgentId),
    executorId: sourceSession?.executorId?.trim() || undefined,
    executionModel: sourceSession?.executionModel?.trim() || undefined,
  }
}

export const resolveNewCustomAgentChatSessionDefaults = (params: {
  sessions: MainChatSession[]
  selectedSessionId?: string
  customAgentId: string
}): MainChatSessionCreationDefaults => {
  return resolveNewMainChatSessionDefaults(params)
}

export const buildMainChatHandoffSnapshot = (messages?: ChatMessage[]): ConversationHandoffSnapshot | undefined => {
  return buildConversationHandoffSnapshot((messages ?? []).map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  })))
}

export const refreshMainChatSessionSnapshot = (session: MainChatSession): MainChatSession => {
  const handoffSnapshot = buildMainChatHandoffSnapshot(session.messages)
  if (!handoffSnapshot) {
    return {
      ...session,
      handoffSnapshot: undefined,
    }
  }

  return {
    ...session,
    handoffSnapshot,
  }
}

export const setMainChatSessionRuntimeStatus = (
  session: MainChatSession,
  agentRunningStatus: AgentRunningStatus,
  currentStep = '',
): MainChatSession => {
  if (
    session.agentRunningStatus === agentRunningStatus
    && (session.currentStep ?? '') === currentStep
  ) {
    return session
  }

  return {
    ...session,
    agentRunningStatus,
    currentStep,
  }
}

export const getMainChatPromptHistory = (session: MainChatSession, pendingUserMessage?: string) => {
  const normalizedPendingMessage = pendingUserMessage?.trim()
  const messages = session.messages ?? []
  const lastMessage = messages.at(-1)
  if (
    normalizedPendingMessage
    && lastMessage?.role === 'user'
    && lastMessage.content.trim() === normalizedPendingMessage
  ) {
    return messages.slice(0, -1)
  }

  return messages
}

export const getMainChatRuntimeSessionId = (session: MainChatSession, scope: MainChatContinuationScope) => {
  const scopeKey = buildMainChatContinuationScopeKey(scope)
  const continuation = session.runtimeContinuations?.find((item) => item.scopeKey === scopeKey)
  if (continuation?.nativeSessionId?.trim()) {
    return continuation.nativeSessionId.trim()
  }

  if ((session.runtimeContinuations?.length ?? 0) > 0) {
    return undefined
  }

  return isServerAgentType(scope.runtimeId) ? session.runtimeSessionIds?.[scope.runtimeId]?.trim() || undefined : undefined
}

export const clearMainChatLegacyRuntimeSessionIds = (
  session: MainChatSession,
  runtimeId?: RuntimeId,
): MainChatSession => {
  if (!session.runtimeSessionIds) {
    return session
  }

  if (runtimeId && isServerAgentType(runtimeId)) {
    const nextEntries = Object.entries(session.runtimeSessionIds)
      .filter(([key]) => key !== runtimeId)
    return {
      ...session,
      runtimeSessionIds: nextEntries.length > 0
        ? Object.fromEntries(nextEntries) as MainChatSession['runtimeSessionIds']
        : undefined,
    }
  }

  return {
    ...session,
    runtimeSessionIds: undefined,
  }
}

export const setMainChatRuntimeSessionId = (
  session: MainChatSession,
  scope: MainChatContinuationScope,
  runtimeSessionId?: string,
): MainChatSession => {
  const normalizedSessionId = runtimeSessionId?.trim()
  if (!normalizedSessionId) {
    return session
  }

  const scopeKey = buildMainChatContinuationScopeKey(scope)
  const continuation = {
    runtimeId: scope.runtimeId,
    scopeKey,
    nativeSessionId: normalizedSessionId,
    executorId: normalizeScopeValue(scope.executorId) || undefined,
    customAgentId: normalizeScopeValue(scope.customAgentId) || undefined,
    executionModel: normalizeScopeValue(scope.executionModel) || undefined,
    cwdHash: buildCwdHash(scope.cwd) || undefined,
    updatedAt: new Date().toISOString(),
  }
  const nextContinuations = [
    ...(session.runtimeContinuations ?? []).filter((item) => item.scopeKey !== scopeKey),
    continuation,
  ]

  return refreshMainChatSessionSnapshot(clearMainChatLegacyRuntimeSessionIds({
    ...session,
    runtimeContinuations: nextContinuations,
  }, scope.runtimeId))
}

export const buildConversationHandoffPromptSection = (handoffSnapshot?: ConversationHandoffSnapshot) => {
  return renderConversationHandoffPromptSection(handoffSnapshot)
}

export const buildMainChatWorkerPrompt = (
  projects: Project[],
  message: string,
  handoffSnapshot?: ConversationHandoffSnapshot,
  userId = '',
) => {
  const historySection = buildConversationHandoffPromptSection(handoffSnapshot)

  return [
    buildMainAgentSystemPrompt(projects, userId),
    '',
    historySection ? `${historySection}\n` : '',
    `用户消息：${message}`,
    '请直接面向用户回复，保持简洁、真实、可执行。',
  ].join('\n')
}

export const getActiveMainChatSession = (state: AppState) => {
  return state.mainChatSessions.find((session) => session.id === state.selectedMainChatSessionId) ?? state.mainChatSessions[0]
}

export const getChatSessionById = (state: AppState, sessionId?: string) => {
  if (!sessionId?.trim()) {
    return getActiveMainChatSession(state)
  }

  return state.mainChatSessions.find((session) => session.id === sessionId.trim()) ?? null
}
