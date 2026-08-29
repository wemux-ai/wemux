// [INPUT]: Agent ownership, external-conversation identity, main-chat state, and visible executors.
// [OUTPUT]: One reusable external-channel main-chat session bound to a currently usable executor.
// [POS]: Shared Telegram/Feishu session coordinator between channel transports and main-chat execution.
// [PROTOCOL]: Update this header when changing responsibilities, then check AGENTS.md.
import type { AppState, ExecutorRecord, MainChatSession } from '@shared/types'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { isManagedCloudAutoExecutorId, MANAGED_CLOUD_AUTO_EXECUTOR_ID } from '@shared/managed-cloud'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { executorRegistry } from '../control-plane/executor-registry'
import { getAllUsers } from '../repositories/auth'
import type { AgentRecord } from '../repositories/agent'
import { getAgent } from '../repositories/agent'
import { createMainChatSession } from '../routes/project-main-chat'
import { resolveNewMainChatSessionDefaults } from '../routes/project-main-chat-session'

const trimString = (value?: string | null) => value?.trim() || undefined

export const resolveAgentChannelExecutorId = (
  executors: Array<Pick<ExecutorRecord, 'executorId' | 'status'>>,
  preferredExecutorIds: Array<string | null | undefined>,
) => {
  const preferredIds = preferredExecutorIds.map(trimString).filter((value): value is string => Boolean(value))
  // agent 默认官方云节点：保留 auto 标记，执行时由 resolveMainChatExecutor 按需分配云节点
  if (preferredIds.some(isManagedCloudAutoExecutorId)) {
    return MANAGED_CLOUD_AUTO_EXECUTOR_ID
  }
  const preferredExecutors = preferredIds
    .map((executorId) => executors.find((executor) => executor.executorId === executorId))
    .filter((executor): executor is Pick<ExecutorRecord, 'executorId' | 'status'> => Boolean(executor))

  return preferredExecutors.find((executor) => executor.status === 'online')?.executorId
    ?? executors.find((executor) => executor.status === 'online')?.executorId
    ?? preferredExecutors[0]?.executorId
    ?? executors[0]?.executorId
}

const updateSession = (
  session: MainChatSession,
  params: {
    title: string
    sourceChannel: 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'
    externalConversationId: string
    externalUserId?: string
    externalChatId?: string
    externalThreadId?: string
    executorId?: string
  },
) => {
  const nextTitle = (session.messages?.length ?? 0) > 0 ? session.title : params.title

  return {
    ...session,
    title: nextTitle,
    sourceChannel: params.sourceChannel,
    externalConversationId: params.externalConversationId,
    externalUserId: trimString(params.externalUserId) || session.externalUserId,
    externalChatId: trimString(params.externalChatId) || session.externalChatId,
    externalThreadId: trimString(params.externalThreadId) || session.externalThreadId,
    executorId: trimString(params.executorId),
  }
}

const replaceSession = (state: AppState, sessionId: string, session: MainChatSession) => {
  const sessions = state.mainChatSessions.map((item) => (item.id === sessionId ? session : item))
  return {
    ...state,
    mainChatSessions: sessions,
  }
}

export const resolveAgentChannelActingUserId = (params: {
  agentOwnerUserId?: string | null
  defaultExecutorOwnerUserId?: string | null
  fallbackUserId?: string | null
  ownerCanUseDefaultExecutor: boolean
}) => {
  const agentOwnerUserId = trimString(params.agentOwnerUserId)
  const defaultExecutorOwnerUserId = trimString(params.defaultExecutorOwnerUserId)
  if (defaultExecutorOwnerUserId && !params.ownerCanUseDefaultExecutor) {
    return defaultExecutorOwnerUserId
  }

  return agentOwnerUserId || defaultExecutorOwnerUserId || trimString(params.fallbackUserId) || null
}

export const resolveAgentOwnerUserId = (agent: Pick<AgentRecord, 'ownerUserId' | 'config'>) => {
  const ownerUserId = trimString(agent.ownerUserId)
  const defaultExecutorId = readCustomAgentConfig(agent.config).defaultExecutorId.trim()
  // 官方云节点（auto）视为 owner 可用：执行时按需分配
  const usesManagedCloudDefault = isManagedCloudAutoExecutorId(defaultExecutorId)
  const defaultExecutor = !usesManagedCloudDefault && defaultExecutorId
    ? executorRegistry.listExecutorsWithPresence().find((executor) => executor.executorId === defaultExecutorId)
    : undefined
  const ownerCanUseDefaultExecutor = usesManagedCloudDefault || Boolean(
    ownerUserId
    && defaultExecutorId
    && listVisibleExecutorsForUser(ownerUserId).some((executor) => executor.executorId === defaultExecutorId),
  )

  return resolveAgentChannelActingUserId({
    agentOwnerUserId: ownerUserId,
    defaultExecutorOwnerUserId: defaultExecutor?.ownerUserId,
    fallbackUserId: getAllUsers()[0]?.id,
    ownerCanUseDefaultExecutor: !defaultExecutorId || ownerCanUseDefaultExecutor,
  })
}

export const findAgentChannelSession = (
  sessions: MainChatSession[],
  params: {
    agentId: string
    sourceChannel: 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'
    externalConversationId: string
    workspaceId?: string
  },
) => {
  const workspaceId = params.workspaceId?.trim() || undefined
  return sessions.find((session) => (
    session.customAgentId === params.agentId
    && session.sourceChannel === params.sourceChannel
    && session.externalConversationId === params.externalConversationId
    && (session.workspaceId?.trim() || undefined) === workspaceId
  ))
}

export const ensureAgentChannelSession = (params: {
  state: AppState
  agentId: string
  ownerUserId: string
  workspaceId?: string
  title: string
  sourceChannel: 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'
  externalConversationId: string
  externalUserId?: string
  externalChatId?: string
  externalThreadId?: string
}) => {
  const workspaceId = params.workspaceId?.trim() || undefined
  const existingSession = findAgentChannelSession(params.state.mainChatSessions, {
    agentId: params.agentId,
    sourceChannel: params.sourceChannel,
    externalConversationId: params.externalConversationId,
    workspaceId,
  })
  const defaults = resolveNewMainChatSessionDefaults({
    sessions: params.state.mainChatSessions,
    selectedSessionId: params.state.selectedMainChatSessionId,
    customAgentId: params.agentId,
  })
  const agent = getAgent(params.agentId)
  const agentDefaultExecutorId = agent
    ? readCustomAgentConfig(agent.config).defaultExecutorId.trim()
    : ''
  const executorId = resolveAgentChannelExecutorId(
    listVisibleExecutorsForUser(params.ownerUserId),
    [existingSession?.executorId, agentDefaultExecutorId, defaults.executorId],
  )

  if (existingSession) {
    const nextSession = updateSession(existingSession, {
      ...params,
      executorId,
    })

    return {
      state: replaceSession(params.state, existingSession.id, nextSession),
      session: nextSession,
      executorId: nextSession.executorId,
    }
  }

  const session: MainChatSession = createMainChatSession(params.title, {
    customAgentId: params.agentId,
    workspaceId,
    executionModel: defaults.executionModel,
    sourceChannel: params.sourceChannel,
    externalConversationId: params.externalConversationId,
    externalUserId: params.externalUserId,
    externalChatId: params.externalChatId,
    externalThreadId: params.externalThreadId,
  })
  session.executorId = executorId

  const selectedSessionId = params.state.selectedMainChatSessionId || session.id
  const selectedSession = params.state.mainChatSessions.find((item) => item.id === selectedSessionId)

  return {
    state: {
      ...params.state,
      mainChatSessions: [session, ...params.state.mainChatSessions],
      selectedMainChatSessionId: selectedSessionId,
    },
    session,
    executorId,
  }
}
