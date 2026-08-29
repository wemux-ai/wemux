// [INPUT]: 主聊天 prompt 请求记录
// [OUTPUT]: 待恢复请求管理
// [POS]: 主聊天 prompt 恢复
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorAgentPromptResult, MainChatSession } from '@shared/types'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { getMeta, loadState, saveMeta } from '../storage/app-state-store'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { appMeta } from '../storage/postgres/schema'
import { withState } from '../routes/shared'
import { buildMainChatContinuationScopeKey, type MainChatContinuationScope } from '../routes/project-main-chat-session'

const PENDING_MAIN_CHAT_PROMPT_META_KEY = 'pendingMainChatPromptRequests'

type PendingMainChatPromptRecord = {
  requestId: string
  executorId: string
  userId: string
  sessionId: string
  userMessage: string
  attachments: TaskChatAttachment[]
  continuationScope?: MainChatContinuationScope
  createdAt: string
}

const normalizePendingMainChatPromptRecord = (value: unknown): PendingMainChatPromptRecord | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : ''
  const executorId = typeof record.executorId === 'string' ? record.executorId.trim() : ''
  const userId = typeof record.userId === 'string' ? record.userId.trim() : ''
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  const userMessage = typeof record.userMessage === 'string' ? record.userMessage : ''
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : ''
  if (!requestId || !executorId || !userId || !sessionId || !createdAt) {
    return null
  }

  return {
    requestId,
    executorId,
    userId,
    sessionId,
    userMessage,
    attachments: Array.isArray(record.attachments) ? record.attachments as TaskChatAttachment[] : [],
    continuationScope: record.continuationScope && typeof record.continuationScope === 'object'
      ? record.continuationScope as MainChatContinuationScope
      : undefined,
    createdAt,
  }
}

const listPendingMainChatPromptRecords = () => {
  const stored = getMeta<unknown>(PENDING_MAIN_CHAT_PROMPT_META_KEY, [])
  if (!Array.isArray(stored)) {
    return []
  }

  return stored
    .map((item) => normalizePendingMainChatPromptRecord(item))
    .filter((item): item is PendingMainChatPromptRecord => Boolean(item))
}

const persistPendingMainChatPromptRecords = async (records: PendingMainChatPromptRecord[]) => {
  saveMeta(PENDING_MAIN_CHAT_PROMPT_META_KEY, records)
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(appMeta)
    .values({ key: PENDING_MAIN_CHAT_PROMPT_META_KEY, value: records })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: records },
    })
}

export const registerPendingMainChatPrompt = async (record: PendingMainChatPromptRecord) => {
  const current = listPendingMainChatPromptRecords()
  const nextRecords = [
    ...current.filter((item) => item.requestId !== record.requestId),
    record,
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.requestId.localeCompare(right.requestId))
  await persistPendingMainChatPromptRecords(nextRecords)
}

export const clearPendingMainChatPrompt = async (requestId: string) => {
  const current = listPendingMainChatPromptRecords()
  const nextRecords = current.filter((item) => item.requestId !== requestId)
  if (nextRecords.length === current.length) {
    return
  }

  await persistPendingMainChatPromptRecords(nextRecords)
}

const hasPendingUserMessage = (session: MainChatSession, record: PendingMainChatPromptRecord) => {
  const lastMessage = session.messages?.at(-1)
  return lastMessage?.role === 'user' && lastMessage.content === record.userMessage
}

const hasRecoveredAssistantMessage = (session: MainChatSession, record: PendingMainChatPromptRecord, output: string) => {
  const messages = session.messages ?? []
  let userIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.content === record.userMessage) {
      userIndex = index
      break
    }
  }
  if (userIndex === -1) {
    return false
  }

  return messages.slice(userIndex + 1).some((message) => message.role === 'assistant' && message.content === output)
}

const applyRuntimeContinuation = (
  session: MainChatSession,
  record: PendingMainChatPromptRecord,
  nativeSessionId: string | undefined,
  updatedAt: string,
): MainChatSession => {
  if (!record.continuationScope || !nativeSessionId?.trim()) {
    return session
  }

  const scopeKey = buildMainChatContinuationScopeKey(record.continuationScope)
  return {
    ...session,
    runtimeContinuations: [
      ...(session.runtimeContinuations ?? []).filter((item) => item.scopeKey !== scopeKey),
      {
        runtimeId: record.continuationScope.runtimeId,
        scopeKey,
        nativeSessionId,
        executorId: record.continuationScope.executorId,
        customAgentId: record.continuationScope.customAgentId,
        executionModel: record.continuationScope.executionModel,
        updatedAt,
      },
    ],
  }
}

export const recoverPendingMainChatPromptResponse = async (params: {
  requestId: string
  executorId: string
  result: ExecutorAgentPromptResult
  at: string
}) => {
  const record = listPendingMainChatPromptRecords().find((item) => item.requestId === params.requestId)
  if (!record || record.executorId !== params.executorId) {
    return false
  }

  const state = loadState()
  const session = state.mainChatSessions.find((item) => item.id === record.sessionId)
  if (!session) {
    await clearPendingMainChatPrompt(record.requestId)
    return false
  }

  const output = params.result.output.trim()
  if (!output || hasRecoveredAssistantMessage(session, record, output)) {
    await clearPendingMainChatPrompt(record.requestId)
    return false
  }

  const userPatch = record.attachments.length > 0 ? { attachments: record.attachments } : {}
  const nextMessages = [
    ...(session.messages ?? []),
    ...(hasPendingUserMessage(session, record)
      ? []
      : [{
          id: crypto.randomUUID(),
          role: 'user' as const,
          content: record.userMessage,
          createdAt: record.createdAt,
          ...userPatch,
        }]),
    {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: output,
      createdAt: params.at,
      agentRunningStatus: params.result.ok ? 'complete' as const : 'error' as const,
      currentStep: params.result.ok ? 'Agent 系统对话已完成' : 'Agent 系统对话失败',
    },
  ]
  const nextSession = applyRuntimeContinuation({
    ...session,
    messages: nextMessages,
    agentRunningStatus: 'idle',
    currentStep: '',
    updatedAt: params.at,
  }, record, params.result.sessionId, params.at)
  const nextState = {
    ...state,
    mainChatSessions: state.mainChatSessions.map((item) => (item.id === nextSession.id ? nextSession : item)),
  }

  await withState(nextState, undefined, record.userId)
  await clearPendingMainChatPrompt(record.requestId)
  return true
}
