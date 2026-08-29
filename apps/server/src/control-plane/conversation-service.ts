/**
 * [INPUT]: Persisted conversations, members, messages, and task/workspace conversation requests.
 * [OUTPUT]: Conversation projections and mutations for task chat, channels, and workspace group sessions.
 * [POS]: Control-plane conversation domain service; runtime execution remains outside this module.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { getImportableExecutorAgentSessionEntries } from '@shared/executor-agent-session'
import { resolveChatMentionTargetIds } from '@shared/chat-mentions'
import type { ExecutorAgentSessionDetail, MainChatSession, Project, Task } from '@shared/types'
import {
  deleteConversationMessage,
  deleteConversation,
  getChannelBinding,
  getConversation,
  getConversationByChannelBinding,
  getConversationMessageSummary,
  getTaskConversation,
  hasConversationMessageWithTurnId,
  listAllConversationMembers,
  listConversationMembers,
  listConversationChannelBindings,
  listConversationMessages,
  listConversations,
  listGroupSessions,
  listWorkspaceGroupConversations,
  deleteConversationMember,
  restoreConversationMember,
  saveChannelBinding,
  saveConversation,
  saveConversationMember,
  saveConversationMessage,
  type BindingMode,
  type ChannelBindingRecord,
  type ChannelType,
  type ConversationMemberRecord,
  type ConversationMemberRole,
  type ConversationMemberType,
  type ConversationMessageRecord,
  type ConversationRecord,
  type MessageContentType,
  type MessageSenderType,
} from '../storage/conversation-store'

export type ConversationBindingSummary = Pick<
  ChannelBindingRecord,
  'id' | 'channelType' | 'externalChatId' | 'externalThreadId' | 'bindingMode'
>

export type ConversationListItem = {
  conversation: ConversationRecord
  messageCount: number
  latestMessage?: ConversationMessageRecord
  channelBindings: ConversationBindingSummary[]
}

export type ConversationDetailPayload = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  channelBindings: ConversationBindingSummary[]
}

export type WorkspaceGroupConversationPayload = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  members: ConversationMemberRecord[]
}

export type WorkspaceGroupAgentSessionState = {
  agentId: string
  agentName?: string
  customAgentId?: string
  executorId?: string
  executionModel?: string
  runtimeSessionIds?: MainChatSession['runtimeSessionIds']
  runtimeContinuations?: MainChatSession['runtimeContinuations']
  handoffSnapshot?: MainChatSession['handoffSnapshot']
  updatedAt: string
}

export type WorkspaceGroupSessionPayload = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  agentSessions: WorkspaceGroupAgentSessionState[]
  totalMessageCount: number
  returnedMessageCount: number
  hasMoreBefore: boolean
}

export type ForkTaskConversationResult = {
  conversation: ConversationRecord
  copiedMessages: ConversationMessageRecord[]
  sourceMessageCount: number
}

type ConversationWindowOptions = {
  recentTurns?: number
  limit?: number
  beforeMessageId?: string
  afterMessageId?: string
}

const WORKSPACE_GROUP_AGENT_SESSION_KIND = 'workspace-group-agent-session'

const cloneExternalRef = (externalRef?: Record<string, unknown>) => {
  if (!externalRef) {
    return undefined
  }

  return JSON.parse(JSON.stringify(externalRef)) as Record<string, unknown>
}

const cloneJsonValue = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const readTrimmedString = (value: unknown) => {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const readForkAnchorMessageId = (message: ConversationMessageRecord) => {
  const timelineEvent = isRecord(message.externalRef?.timelineEvent)
    ? message.externalRef.timelineEvent
    : undefined

  return readTrimmedString(timelineEvent?.messageId)
}

const readTimelineTurnId = (message: ConversationMessageRecord) => {
  const timelineEvent = isRecord(message.externalRef?.timelineEvent)
    ? message.externalRef.timelineEvent
    : undefined

  return readTrimmedString(timelineEvent?.turnId)
}

const normalizeGroupAgentSessionState = (value: unknown): WorkspaceGroupAgentSessionState | null => {
  if (!isRecord(value)) {
    return null
  }

  const agentId = readTrimmedString(value.agentId)
  const updatedAt = readTrimmedString(value.updatedAt)
  if (!agentId || !updatedAt) {
    return null
  }

  const runtimeSessionIds = isRecord(value.runtimeSessionIds)
    ? cloneJsonValue(value.runtimeSessionIds) as WorkspaceGroupAgentSessionState['runtimeSessionIds']
    : undefined
  const runtimeContinuations = Array.isArray(value.runtimeContinuations)
    ? cloneJsonValue(value.runtimeContinuations) as WorkspaceGroupAgentSessionState['runtimeContinuations']
    : undefined
  const handoffSnapshot = isRecord(value.handoffSnapshot)
    ? cloneJsonValue(value.handoffSnapshot) as unknown as NonNullable<WorkspaceGroupAgentSessionState['handoffSnapshot']>
    : undefined

  return {
    agentId,
    agentName: readTrimmedString(value.agentName),
    customAgentId: readTrimmedString(value.customAgentId),
    executorId: readTrimmedString(value.executorId),
    executionModel: readTrimmedString(value.executionModel),
    runtimeSessionIds,
    runtimeContinuations,
    handoffSnapshot,
    updatedAt,
  }
}

const parseWorkspaceGroupAgentSessionState = (
  message: ConversationMessageRecord,
): WorkspaceGroupAgentSessionState | null => {
  if (message.role !== 'system' || !isRecord(message.externalRef)) {
    return null
  }

  if (message.externalRef.kind !== WORKSPACE_GROUP_AGENT_SESSION_KIND) {
    return null
  }

  return normalizeGroupAgentSessionState(message.externalRef.agentSession)
}

const isWorkspaceGroupAgentSessionMessage = (message: ConversationMessageRecord) => {
  return parseWorkspaceGroupAgentSessionState(message) !== null
}

const listVisibleConversationMessages = (messages: ConversationMessageRecord[]) => {
  return messages.filter((message) => !isWorkspaceGroupAgentSessionMessage(message))
}

const readConversationMessageTurnId = (message: ConversationMessageRecord) => {
  return readTimelineTurnId(message)
    || readTrimmedString(message.externalRef?.turnId)
    || undefined
}

const findConversationMessageByTurnId = (
  conversationId: string,
  turnId?: string,
) => {
  const normalizedTurnId = turnId?.trim()
  if (!normalizedTurnId) {
    return null
  }

  return listConversationMessages(conversationId).find((message) => {
    return readConversationMessageTurnId(message) === normalizedTurnId
  }) ?? null
}

const expandMessageWindowToFullTurns = (params: {
  messages: ConversationMessageRecord[]
  startIndex: number
  endIndex: number
  afterMessageId?: string
  beforeMessageId?: string
}) => {
  const { messages } = params
  let startIndex = Math.max(0, Math.min(params.startIndex, messages.length))
  let endIndex = Math.max(startIndex, Math.min(params.endIndex, messages.length))

  if (startIndex >= endIndex || messages.length === 0) {
    return {
      startIndex,
      endIndex,
    }
  }

  if (!params.afterMessageId) {
    const leadingTurnId = readConversationMessageTurnId(messages[startIndex]!)
    if (leadingTurnId) {
      while (startIndex > 0 && readConversationMessageTurnId(messages[startIndex - 1]!) === leadingTurnId) {
        startIndex -= 1
      }
    }
  }

  if (!params.beforeMessageId) {
    const trailingTurnId = readConversationMessageTurnId(messages[endIndex - 1]!)
    if (trailingTurnId) {
      while (endIndex < messages.length && readConversationMessageTurnId(messages[endIndex]!) === trailingTurnId) {
        endIndex += 1
      }
    }
  }

  return {
    startIndex,
    endIndex,
  }
}

const sliceMessageWindow = (
  messages: ConversationMessageRecord[],
  options?: Pick<ConversationWindowOptions, 'limit' | 'beforeMessageId' | 'afterMessageId'>,
) => {
  const totalMessageCount = messages.length
  const afterMessageId = options?.afterMessageId?.trim()
  const beforeMessageId = options?.beforeMessageId?.trim()
  const limit = options?.limit && options.limit > 0 ? options.limit : undefined

  let startIndex = 0
  if (afterMessageId) {
    const afterIndex = messages.findIndex((message) => message.id === afterMessageId)
    if (afterIndex < 0) {
      return {
        messages: [],
        totalMessageCount,
        returnedMessageCount: 0,
        hasMoreBefore: totalMessageCount > 0,
      }
    }

    startIndex = afterIndex + 1
  }

  let endIndex = messages.length
  if (beforeMessageId) {
    const beforeIndex = messages.findIndex((message) => message.id === beforeMessageId)
    if (beforeIndex < 0) {
      return {
        messages: [],
        totalMessageCount,
        returnedMessageCount: 0,
        hasMoreBefore: totalMessageCount > 0,
      }
    }

    endIndex = beforeIndex
  }

  startIndex = Math.min(startIndex, endIndex)

  if (limit) {
    if (beforeMessageId || !afterMessageId) {
      startIndex = Math.max(startIndex, endIndex - limit)
    } else {
      endIndex = Math.min(endIndex, startIndex + limit)
    }
  }

  const expandedWindow = expandMessageWindowToFullTurns({
    messages,
    startIndex,
    endIndex,
    afterMessageId,
    beforeMessageId,
  })
  startIndex = expandedWindow.startIndex
  endIndex = expandedWindow.endIndex

  const windowMessages = messages.slice(startIndex, endIndex)

  return {
    messages: windowMessages,
    totalMessageCount,
    returnedMessageCount: windowMessages.length,
    hasMoreBefore: startIndex > 0,
  }
}

const sliceConversationMessages = (
  messages: ConversationMessageRecord[],
  options?: Pick<ConversationWindowOptions, 'limit' | 'beforeMessageId' | 'afterMessageId'>,
) => {
  return sliceMessageWindow(listVisibleConversationMessages(messages), options)
}

const collectWorkspaceGroupAgentSessions = (messages: ConversationMessageRecord[]) => {
  const sessionMap = new Map<string, WorkspaceGroupAgentSessionState>()

  for (const message of messages) {
    const session = parseWorkspaceGroupAgentSessionState(message)
    if (!session) {
      continue
    }

    sessionMap.set(session.agentId, session)
  }

  return [...sessionMap.values()]
}

const sliceMessagesByRecentTurns = (
  messages: ConversationMessageRecord[],
  recentTurns?: number,
) => {
  if (!recentTurns || recentTurns < 1 || messages.length === 0) {
    return messages
  }

  let remainingTurns = recentTurns
  let startIndex = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'user') {
      continue
    }

    remainingTurns -= 1
    startIndex = index
    if (remainingTurns === 0) {
      return messages.slice(startIndex)
    }
  }

  return messages
}

const buildChannelConversationTitle = (channelType: ChannelType, chatId: string, threadId?: string) => {
  return threadId
    ? `${channelType}:${chatId}#${threadId}`
    : `${channelType}:${chatId}`
}

export const ensureTaskConversation = (task: Task, project?: Project, workspaceId?: string, workspaceSessionId?: string): ConversationRecord => {
  const resolvedWorkspaceId = workspaceId?.trim() || undefined
  const resolvedWorkspaceSessionId = workspaceSessionId?.trim() || undefined
  const existingConversation = getTaskConversation(task.id, resolvedWorkspaceId, resolvedWorkspaceSessionId)
  if (existingConversation) {
    const nextTitle = task.title.trim() || existingConversation.title
    if (
      existingConversation.title === nextTitle
      && existingConversation.projectId === task.projectId
      && (existingConversation.workspaceId ?? '') === (resolvedWorkspaceId ?? '')
      && (existingConversation.workspaceSessionId ?? '') === (resolvedWorkspaceSessionId ?? '')
    ) {
      return existingConversation
    }

    const nextConversation: ConversationRecord = {
      ...existingConversation,
      workspaceId: resolvedWorkspaceId,
      workspaceSessionId: resolvedWorkspaceSessionId,
      projectId: task.projectId,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
    }
    saveConversation(nextConversation)
    return nextConversation
  }

  const timestamp = new Date().toISOString()
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    workspaceId: resolvedWorkspaceId,
    workspaceSessionId: resolvedWorkspaceSessionId,
    projectId: task.projectId,
    taskId: task.id,
    title: task.title.trim() || project?.name || (resolvedWorkspaceId ? '工作区会话' : '任务会话'),
    kind: 'task',
    chatMode: 'direct',
    status: 'active',
    externalSyncMode: 'internal',
    visibility: 'public',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  saveConversation(conversation)
  return conversation
}

export const ensureChannelConversation = (params: {
  channelType: ChannelType
  externalChatId: string
  externalThreadId?: string
  bindingMode?: BindingMode
}) => {
  const existingConversation = getConversationByChannelBinding(
    params.channelType,
    params.externalChatId,
    params.externalThreadId,
  )

  if (existingConversation) {
    return existingConversation
  }

  const timestamp = new Date().toISOString()
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    title: buildChannelConversationTitle(params.channelType, params.externalChatId, params.externalThreadId),
    kind: 'external-thread',
    chatMode: 'direct',
    status: 'active',
    externalSyncMode: params.bindingMode ?? 'bidirectional',
    visibility: 'public',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  saveConversation(conversation)
  saveChannelBinding({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    channelType: params.channelType,
    externalChatId: params.externalChatId,
    externalThreadId: params.externalThreadId,
    bindingMode: params.bindingMode ?? 'bidirectional',
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  return conversation
}

export const bindTaskConversationToChannel = (params: {
  task: Task
  project?: Project
  channelType: ChannelType
  externalChatId: string
  externalThreadId?: string
  bindingMode?: BindingMode
}) => {
  const conversation = ensureTaskConversation(params.task, params.project)
  const existingBinding = getChannelBinding(
    params.channelType,
    params.externalChatId,
    params.externalThreadId,
  )
  const timestamp = new Date().toISOString()

  const binding: ChannelBindingRecord = {
    id: existingBinding?.id ?? crypto.randomUUID(),
    projectId: params.task.projectId,
    taskId: params.task.id,
    conversationId: conversation.id,
    channelType: params.channelType,
    externalChatId: params.externalChatId,
    externalThreadId: params.externalThreadId,
    bindingMode: params.bindingMode ?? existingBinding?.bindingMode ?? 'bidirectional',
    createdAt: existingBinding?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  saveChannelBinding(binding)
  return { conversation, binding }
}

export const appendConversationMessage = (params: {
  conversationId: string
  role: MessageSenderType
  senderId?: string
  content: string
  contentType?: MessageContentType
  replyToMessageId?: string
  externalRef?: Record<string, unknown>
}) => {
  const timestamp = new Date().toISOString()
  const message: ConversationMessageRecord = {
    id: crypto.randomUUID(),
    conversationId: params.conversationId,
    role: params.role,
    senderId: params.senderId,
    content: params.content,
    contentType: params.contentType ?? 'text',
    replyToMessageId: params.replyToMessageId,
    externalRef: params.externalRef,
    createdAt: timestamp,
  }

  saveConversationMessage(message)
  return message
}

const cloneConversationMessageForFork = (
  message: ConversationMessageRecord,
  conversationId: string,
  messageIdMap: Map<string, string>,
): ConversationMessageRecord => {
  const nextId = crypto.randomUUID()
  messageIdMap.set(message.id, nextId)
  const externalRef = cloneExternalRef(message.externalRef)
  const timelineEvent = externalRef?.timelineEvent
  if (timelineEvent && typeof timelineEvent === 'object') {
    ;(timelineEvent as Record<string, unknown>).messageId = nextId
  }

  return {
    ...message,
    id: nextId,
    conversationId,
    replyToMessageId: message.replyToMessageId,
    externalRef,
  }
}

export const appendTaskConversationMessage = (params: {
  task: Task
  project?: Project
  workspaceId?: string
  workspaceSessionId?: string
  role: MessageSenderType
  senderId?: string
  content: string
  contentType?: MessageContentType
  externalRef?: Record<string, unknown>
}) => {
  const conversation = ensureTaskConversation(params.task, params.project, params.workspaceId, params.workspaceSessionId)
  const existingMessage = findConversationMessageByTurnId(
    conversation.id,
    readTrimmedString(params.externalRef?.turnId) || readTrimmedString((params.externalRef?.timelineEvent as Record<string, unknown> | undefined)?.turnId),
  )
  if (existingMessage && existingMessage.role === params.role && existingMessage.content === params.content) {
    return { conversation, message: existingMessage }
  }

  const message = appendConversationMessage({
    conversationId: conversation.id,
    role: params.role,
    senderId: params.senderId,
    content: params.content,
    contentType: params.contentType,
    externalRef: params.externalRef,
  })

  return { conversation, message }
}

export const importTaskConversationMessages = (params: {
  task: Task
  project?: Project
  workspaceId?: string
  workspaceSessionId?: string
  executorId: string
  session: ExecutorAgentSessionDetail
}) => {
  const conversation = ensureTaskConversation(params.task, params.project, params.workspaceId, params.workspaceSessionId)
  const importedAt = new Date().toISOString()
  const importBatchId = crypto.randomUUID()
  const importableEntries = getImportableExecutorAgentSessionEntries(params.session.entries)
  const skippedCount = params.session.entries.length - importableEntries.length

  const importedMessages = importableEntries.map((entry) => {
    const message: ConversationMessageRecord = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: entry.role === 'user' ? 'user' : 'assistant',
      senderId: params.executorId,
      content: entry.text,
      contentType: 'text',
      externalRef: {
        importedAgentSession: {
          batchId: importBatchId,
          importedAt,
          executorId: params.executorId,
          source: params.session.source,
          sessionId: params.session.id,
          sessionTitle: params.session.title,
          sessionCwd: params.session.cwd,
          originalEntryId: entry.id,
          originalTimestamp: entry.timestamp,
        },
      },
      createdAt: importedAt,
    }
    saveConversationMessage(message)
    return message
  })

  return {
    conversation,
    importedMessages,
    importedCount: importedMessages.length,
    skippedCount,
    importBatchId,
    importedAt,
  }
}

export const appendChannelConversationMessage = (params: {
  channelType: ChannelType
  externalChatId: string
  externalThreadId?: string
  role: MessageSenderType
  senderId?: string
  content: string
  contentType?: MessageContentType
  externalRef?: Record<string, unknown>
}) => {
  const conversation = ensureChannelConversation({
    channelType: params.channelType,
    externalChatId: params.externalChatId,
    externalThreadId: params.externalThreadId,
  })
  const message = appendConversationMessage({
    conversationId: conversation.id,
    role: params.role,
    senderId: params.senderId,
    content: params.content,
    contentType: params.contentType,
    externalRef: params.externalRef,
  })

  return { conversation, message }
}

export type DmConversationEnsureResult = {
  conversation: ConversationRecord
  created: boolean
}

export type DmConversationListItem = {
  conversation: ConversationRecord
  members: ConversationMemberRecord[]
  messageCount: number
  latestMessage?: ConversationMessageRecord
}

/** 查找已存在的私聊会话：双方均为 user 成员且 workspace 作用域一致。允许自己与自己（个人备忘会话）。 */
export const findDmConversation = (params: {
  ownerUserId: string
  peerUserId: string
  workspaceId?: string
}): ConversationRecord | null => {
  const ownerUserId = params.ownerUserId.trim()
  const peerUserId = params.peerUserId.trim()
  if (!ownerUserId || !peerUserId) {
    return null
  }
  const workspaceId = params.workspaceId?.trim() || undefined
  const targetPair = new Set([ownerUserId, peerUserId])

  return listConversations().find((conversation) => {
    if (conversation.kind !== 'dm' || conversation.chatMode !== 'direct') {
      return false
    }
    if ((conversation.workspaceId?.trim() || undefined) !== workspaceId) {
      return false
    }

    const memberUserIds = listAllConversationMembers(conversation.id)
      .filter((member) => member.memberType === 'user' && !member.leftAt)
      .map((member) => member.memberId)
    // 用成员 id 集合匹配（自己 DM 自己时成员记录可能因 upsert 合并为一条）。
    const memberIdSet = new Set(memberUserIds)
    return memberIdSet.size === targetPair.size
      && [...targetPair].every((memberId) => memberIdSet.has(memberId))
  }) ?? null
}

/**
 * 确保私聊会话存在（get-or-create）：
 * - 允许自己与自己私聊（个人备忘会话，类似文件传输助手；点击侧边栏自己的头像/用户名发起）；
 * - 跨空间开放：workspaceId 可选，不带则建立全局私聊（飞书式用户搜索发起）。
 */
export const ensureDmConversation = (params: {
  ownerUserId: string
  peerUserId: string
  workspaceId?: string
}): DmConversationEnsureResult => {
  const ownerUserId = params.ownerUserId.trim()
  const peerUserId = params.peerUserId.trim()
  if (!ownerUserId || !peerUserId) {
    throw new Error('私聊对象无效。')
  }

  const existing = findDmConversation({
    ownerUserId,
    peerUserId,
    workspaceId: params.workspaceId,
  })
  if (existing) {
    return { conversation: existing, created: false }
  }

  return { ...createDmConversation({ ownerUserId, peerUserId, workspaceId: params.workspaceId }), created: true }
}

/**
 * 无条件创建私聊会话（同一私聊对象可建多个会话，类似 Agent 主对话的「新建会话」）：
 * - 不做查重；标题可选，默认「私聊」。
 */
export const createDmConversation = (params: {
  ownerUserId: string
  peerUserId: string
  workspaceId?: string
  title?: string
}): { conversation: ConversationRecord } => {
  const ownerUserId = params.ownerUserId.trim()
  const peerUserId = params.peerUserId.trim()
  if (!ownerUserId || !peerUserId) {
    throw new Error('私聊对象无效。')
  }

  const timestamp = new Date().toISOString()
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId?.trim() || undefined,
    title: params.title?.trim() || '私聊',
    kind: 'dm',
    chatMode: 'direct',
    status: 'active',
    externalSyncMode: 'internal',
    visibility: 'private',
    createdBy: ownerUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  saveConversation(conversation)
  saveConversationMember({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    memberType: 'user',
    memberId: ownerUserId,
    role: 'owner',
    joinedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  saveConversationMember({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    memberType: 'user',
    memberId: peerUserId,
    role: 'member',
    joinedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  return { conversation }
}

/** 重命名私聊会话标题（成员可编辑；仅更新标题与 updatedAt，消息与成员不变）。 */
export const renameConversation = (conversationId: string, title: string): ConversationRecord => {
  const conversation = getConversation(conversationId)
  if (!conversation) {
    throw new Error('会话不存在。')
  }
  const nextTitle = title.trim()
  if (!nextTitle) {
    throw new Error('会话名称不能为空。')
  }
  if (conversation.title === nextTitle) {
    return conversation
  }
  const updated: ConversationRecord = {
    ...conversation,
    title: nextTitle,
    updatedAt: new Date().toISOString(),
  }
  saveConversation(updated)
  return updated
}

/**
 * 会话置顶 / 取消置顶（DM、群聊会话等）。
 * 清除时必须返回 null（而非 undefined）：HTTP 序列化会丢掉 undefined 键，
 * 前端 replaceEqualDeep 会把缺失键当作「未变更」而保留旧值，导致取消置顶不生效。
 */
export const updateConversationPinned = (conversationId: string, pinned: boolean): ConversationRecord | null => {
  const conversation = getConversation(conversationId)
  if (!conversation) {
    return null
  }
  const currentPinnedAt = conversation.pinnedAt?.trim() || undefined
  const nextPinnedAt = pinned ? currentPinnedAt ?? new Date().toISOString() : null
  if (currentPinnedAt === nextPinnedAt) {
    return conversation
  }
  const updated: ConversationRecord = {
    ...conversation,
    pinnedAt: nextPinnedAt,
    updatedAt: new Date().toISOString(),
  }
  saveConversation(updated)
  return updated
}

/** 当前用户参与的私聊会话列表（含成员/最新消息），按最近活动排序。 */
export const listDmConversationsForUser = (userId: string): DmConversationListItem[] => {
  const normalizedUserId = userId.trim()
  return listConversations()
    .filter((conversation) => (
      conversation.kind === 'dm'
      && conversation.chatMode === 'direct'
      && listAllConversationMembers(conversation.id).some((member) => (
        !member.leftAt && member.memberType === 'user' && member.memberId === normalizedUserId
      ))
    ))
    .map((conversation) => {
      const members = listConversationMembers(conversation.id)
      const messages = listConversationMessages(conversation.id)
      return {
        conversation,
        members,
        messageCount: messages.length,
        latestMessage: messages.at(-1),
      }
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.latestMessage?.createdAt ?? left.conversation.updatedAt)
      const rightTime = Date.parse(right.latestMessage?.createdAt ?? right.conversation.updatedAt)
      return rightTime - leftTime
    })
}

export const createWorkspaceGroupConversation = (params: {
  workspaceId: string
  title: string
  createdBy: string
  executorId?: string
  orchestratorAgentId?: string
  description?: string
}) => {
  const timestamp = new Date().toISOString()
  const groupId = crypto.randomUUID()
  const conversation: ConversationRecord = {
    id: groupId,
    workspaceId: params.workspaceId.trim(),
    groupId,
    title: params.title.trim() || '未命名群聊',
    kind: 'workspace',
    chatMode: 'group',
    status: 'active',
    externalSyncMode: 'internal',
    orchestratorAgentId: params.orchestratorAgentId?.trim() || undefined,
    executorId: params.executorId?.trim() || undefined,
    createdBy: params.createdBy,
    visibility: 'public',
    description: params.description?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  saveConversation(conversation)
  return conversation
}

export const createWorkspaceGroupSession = (params: {
  workspaceId: string
  groupId: string
  title: string
  createdBy: string
  executorId?: string
}) => {
  const timestamp = new Date().toISOString()
  const conversation: ConversationRecord = {
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId.trim(),
    groupId: params.groupId.trim(),
    title: params.title.trim() || '新会话',
    kind: 'workspace',
    chatMode: 'group',
    status: 'active',
    externalSyncMode: 'internal',
    executorId: params.executorId?.trim() || undefined,
    createdBy: params.createdBy,
    visibility: 'public',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  saveConversation(conversation)
  return conversation
}

export const updateWorkspaceGroupConversationTitle = (
  workspaceId: string,
  conversationId: string,
  title: string,
) => updateWorkspaceGroupProfile(workspaceId, conversationId, { title })

export const updateWorkspaceGroupProfile = (
  workspaceId: string,
  conversationId: string,
  profile: { title?: string; description?: string },
) => {
  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  if (!detail) {
    return null
  }

  const nextTitle = profile.title?.trim()
  const hasDescriptionChange = profile.description !== undefined
  if (!nextTitle && !hasDescriptionChange) {
    return null
  }

  const nextConversation: ConversationRecord = {
    ...detail.conversation,
    ...(nextTitle ? { title: nextTitle } : {}),
    ...(hasDescriptionChange ? { description: profile.description?.trim() || undefined } : {}),
    updatedAt: new Date().toISOString(),
  }
  saveConversation(nextConversation)
  return getWorkspaceGroupConversationDetail(workspaceId, conversationId)
}

export const updateWorkspaceGroupAnnouncement = (
  workspaceId: string,
  conversationId: string,
  announcement: string,
  updatedBy: string,
) => {
  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  if (!detail) {
    return null
  }

  const timestamp = new Date().toISOString()
  const normalizedAnnouncement = announcement.trim() || undefined
  const normalizedUpdatedBy = updatedBy.trim() || undefined

  saveConversation({
    ...detail.conversation,
    announcement: normalizedAnnouncement,
    announcementUpdatedAt: normalizedAnnouncement ? timestamp : undefined,
    announcementUpdatedBy: normalizedAnnouncement ? normalizedUpdatedBy : undefined,
    updatedAt: timestamp,
  })
  return getWorkspaceGroupConversationDetail(workspaceId, conversationId)
}

export const saveWorkspaceGroupAgentSession = (params: {
  conversationId: string
  agentId: string
  agentName?: string
  session: Pick<
    MainChatSession,
    'customAgentId' | 'executorId' | 'executionModel' | 'runtimeSessionIds' | 'runtimeContinuations' | 'handoffSnapshot' | 'updatedAt'
  >
}) => {
  const agentId = params.agentId.trim()
  if (!agentId) {
    return null
  }

  const agentSession: WorkspaceGroupAgentSessionState = {
    agentId,
    agentName: params.agentName?.trim() || undefined,
    customAgentId: params.session.customAgentId?.trim() || undefined,
    executorId: params.session.executorId?.trim() || undefined,
    executionModel: params.session.executionModel?.trim() || undefined,
    runtimeSessionIds: params.session.runtimeSessionIds ? cloneJsonValue(params.session.runtimeSessionIds) : undefined,
    runtimeContinuations: params.session.runtimeContinuations ? cloneJsonValue(params.session.runtimeContinuations) : undefined,
    handoffSnapshot: params.session.handoffSnapshot ? cloneJsonValue(params.session.handoffSnapshot) : undefined,
    updatedAt: params.session.updatedAt,
  }

  return appendConversationMessage({
    conversationId: params.conversationId,
    role: 'system',
    senderId: agentId,
    content: `[${WORKSPACE_GROUP_AGENT_SESSION_KIND}]`,
    externalRef: {
      kind: WORKSPACE_GROUP_AGENT_SESSION_KIND,
      hidden: true,
      agentSession,
    },
  })
}

export const addConversationMember = (params: {
  conversationId: string
  memberType: ConversationMemberType
  memberId: string
  role?: ConversationMemberRole
}) => {
  const memberId = params.memberId.trim()
  const existing = listAllConversationMembers(params.conversationId).find((member) => (
    member.memberType === params.memberType && member.memberId === memberId
  ))

  if (existing?.leftAt) {
    return restoreConversationMember(params.conversationId, params.memberType, memberId)!
  }

  if (existing) {
    return existing
  }

  const timestamp = new Date().toISOString()
  const member: ConversationMemberRecord = {
    id: crypto.randomUUID(),
    conversationId: params.conversationId,
    memberType: params.memberType,
    memberId,
    role: params.role ?? 'member',
    joinedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  saveConversationMember(member)
  return member
}

export const removeConversationMember = (
  conversationId: string,
  memberType: ConversationMemberType,
  memberId: string,
) => {
  deleteConversationMember(conversationId, memberType, memberId)
}

/** 成员主动退出群聊：非创建者可退；创建者只能解散（转让暂不支持）。 */
export const leaveWorkspaceGroup = (
  workspaceId: string,
  conversationId: string,
  userId: string,
) => {
  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  const normalizedUserId = userId.trim()
  if (!detail || !normalizedUserId) {
    return null
  }

  const member = detail.members.find((item) => (
    item.memberType === 'user' && item.memberId === normalizedUserId && !item.leftAt
  ))
  if (!member || member.role === 'owner') {
    return null
  }

  removeConversationMember(conversationId, 'user', normalizedUserId)
  return getWorkspaceGroupConversationDetail(workspaceId, conversationId)
}

/** 解散群聊：删除群会话与群本身（调用方已校验 owner 权限）。 */
export const deleteWorkspaceGroup = (
  workspaceId: string,
  conversationId: string,
) => {
  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  if (!detail) {
    return null
  }

  const conversations = listGroupSessions(conversationId)
    .filter((conversation) => conversation.workspaceId === workspaceId.trim())
  for (const conversation of conversations) {
    deleteConversation(conversation.id)
  }
  return { ok: true as const }
}

export const updateWorkspaceGroupOrchestrator = (
  workspaceId: string,
  conversationId: string,
  orchestratorAgentId: string,
) => {
  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  const leaderAgentId = orchestratorAgentId.trim()
  if (!detail || !detail.members.some((member) => (
    member.memberType === 'agent' && member.memberId === leaderAgentId
  ))) {
    return null
  }

  const timestamp = new Date().toISOString()
  saveConversation({
    ...detail.conversation,
    orchestratorAgentId: leaderAgentId,
    updatedAt: timestamp,
  })
  for (const member of detail.members) {
    if (member.memberType !== 'agent') continue
    saveConversationMember({
      ...member,
      role: member.memberId === leaderAgentId ? 'orchestrator' : 'member',
      updatedAt: timestamp,
    })
  }

  return getWorkspaceGroupConversationDetail(workspaceId, conversationId)
}

export const clearWorkspaceGroupOrchestrator = (
  workspaceId: string,
  conversationId: string,
) => {
  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  if (!detail) return null

  const timestamp = new Date().toISOString()
  saveConversation({
    ...detail.conversation,
    orchestratorAgentId: undefined,
    updatedAt: timestamp,
  })
  for (const member of detail.members) {
    if (member.memberType !== 'agent' || member.role !== 'orchestrator') continue
    saveConversationMember({
      ...member,
      role: 'member',
      updatedAt: timestamp,
    })
  }

  return getWorkspaceGroupConversationDetail(workspaceId, conversationId)
}

export const getWorkspaceGroupConversationDetail = (
  workspaceId: string,
  conversationId: string,
): WorkspaceGroupConversationPayload | null => {
  const conversation = getConversation(conversationId)
  if (!conversation) {
    return null
  }

  if (conversation.workspaceId !== workspaceId.trim() || conversation.kind !== 'workspace' || conversation.chatMode !== 'group') {
    return null
  }

  return {
    conversation,
    messages: listVisibleConversationMessages(listConversationMessages(conversation.id)),
    members: listConversationMembers(conversation.id),
  }
}

export const listWorkspaceGroupConversationDetails = (workspaceId: string) => {
  return listWorkspaceGroupConversations(workspaceId)
    .map<WorkspaceGroupConversationPayload>((conversation) => {
      const messages = listVisibleConversationMessages(listConversationMessages(conversation.id))
      return {
        conversation,
        messages,
        members: listConversationMembers(conversation.id),
      }
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.messages.at(-1)?.createdAt ?? left.conversation.updatedAt)
      const rightTime = Date.parse(right.messages.at(-1)?.createdAt ?? right.conversation.updatedAt)
      return rightTime - leftTime
    })
}

/** 群列表轻量投影：只取成员 + 消息计数 + 最后一条，避免拉全量消息（GET /groups 专用）。 */
export const listWorkspaceGroupConversationSummaries = (workspaceId: string) => {
  return listWorkspaceGroupConversations(workspaceId)
    .map((conversation) => {
      const summary = getConversationMessageSummary(conversation.id)
      return {
        conversation,
        members: listConversationMembers(conversation.id),
        messageCount: summary.messageCount,
        latestMessage: summary.latestMessage,
      }
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.latestMessage?.createdAt ?? left.conversation.updatedAt)
      const rightTime = Date.parse(right.latestMessage?.createdAt ?? right.conversation.updatedAt)
      return rightTime - leftTime
    })
}

export const listWorkspaceGroupSessionDetails = (workspaceId: string, groupId: string) => {
  const sessions = listGroupSessions(groupId)
    .filter((conversation) => conversation.workspaceId === workspaceId.trim())

  return sessions.map<WorkspaceGroupSessionPayload>((conversation) => {
    const allMessages = listConversationMessages(conversation.id)
    const messageWindow = sliceConversationMessages(allMessages)
    return {
      conversation,
      messages: messageWindow.messages,
      agentSessions: collectWorkspaceGroupAgentSessions(allMessages),
      totalMessageCount: messageWindow.totalMessageCount,
      returnedMessageCount: messageWindow.returnedMessageCount,
      hasMoreBefore: messageWindow.hasMoreBefore,
    }
  })
}

export const getWorkspaceGroupSessionDetail = (
  workspaceId: string,
  groupId: string,
  sessionId: string,
  options?: Pick<ConversationWindowOptions, 'limit' | 'beforeMessageId'>,
) => {
  const session = listGroupSessions(groupId).find((conversation) => {
    return conversation.id === sessionId && conversation.workspaceId === workspaceId.trim()
  })

  if (!session) {
    return null
  }

  const allMessages = listConversationMessages(session.id)
  const messageWindow = sliceConversationMessages(allMessages, options)
  return {
    conversation: session,
    messages: messageWindow.messages,
    agentSessions: collectWorkspaceGroupAgentSessions(allMessages),
    totalMessageCount: messageWindow.totalMessageCount,
    returnedMessageCount: messageWindow.returnedMessageCount,
    hasMoreBefore: messageWindow.hasMoreBefore,
  }
}

export const updateWorkspaceGroupSessionExecutor = (
  workspaceId: string,
  groupId: string,
  sessionId: string,
  executorId: string,
) => {
  const detail = getWorkspaceGroupSessionDetail(workspaceId, groupId, sessionId)
  if (!detail) {
    return null
  }

  const nextConversation = {
    ...detail.conversation,
    executorId: executorId.trim() || undefined,
    updatedAt: new Date().toISOString(),
  }
  saveConversation(nextConversation)
  return nextConversation
}

/**
 * 任务会话快照的轻量投影：只取 conversation + 消息计数 + 最后一条时间，
 * 并提供 turnId 存在性判断，避免会话快照广播时全量读取消息数组。
 */
export const getTaskConversationSnapshotSummary = (
  task: Task,
  project?: Project,
  workspaceId?: string,
  workspaceSessionId?: string,
) => {
  const conversation = ensureTaskConversation(task, project, workspaceId, workspaceSessionId)
  const summary = getConversationMessageSummary(conversation.id)

  return {
    conversation,
    messageCount: summary.messageCount,
    latestMessageAt: summary.latestMessage?.createdAt,
    hasTurnId: (turnId: string) => hasConversationMessageWithTurnId(conversation.id, turnId),
  }
}

export const getTaskConversationWithMessages = (
  task: Task,
  project?: Project,
  workspaceId?: string,
  workspaceSessionId?: string,
  options?: ConversationWindowOptions,
) => {
  const conversation = ensureTaskConversation(task, project, workspaceId, workspaceSessionId)
  const allMessages = listConversationMessages(conversation.id)
  const useCursorWindow = Boolean(
    options?.limit
      || options?.beforeMessageId?.trim()
      || options?.afterMessageId?.trim(),
  )
  const messageWindow = useCursorWindow
    ? sliceMessageWindow(allMessages, {
        limit: options?.limit,
        beforeMessageId: options?.beforeMessageId,
        afterMessageId: options?.afterMessageId,
      })
    : null
  const messages = messageWindow?.messages ?? sliceMessagesByRecentTurns(allMessages, options?.recentTurns)
  console.log('[task-conversation] load', JSON.stringify({
    taskId: task.id,
    requestedWorkspaceId: workspaceId ?? null,
    requestedWorkspaceSessionId: workspaceSessionId ?? null,
    conversationId: conversation.id,
    conversationWorkspaceId: conversation.workspaceId ?? null,
    conversationWorkspaceSessionId: conversation.workspaceSessionId ?? null,
    messageCount: allMessages.length,
    returnedMessageCount: messages.length,
    recentTurns: options?.recentTurns ?? null,
    limit: options?.limit ?? null,
    beforeMessageId: options?.beforeMessageId ?? null,
    afterMessageId: options?.afterMessageId ?? null,
  }))
  return {
    conversation,
    messages,
    totalMessageCount: messageWindow?.totalMessageCount ?? allMessages.length,
    returnedMessageCount: messageWindow?.returnedMessageCount ?? messages.length,
    hasMoreBefore: messageWindow?.hasMoreBefore ?? (messages.length < allMessages.length),
    recentTurns: options?.recentTurns,
  }
}

export const forkTaskConversationUntilMessage = (params: {
  task: Task
  project?: Project
  sourceWorkspaceId?: string
  sourceWorkspaceSessionId?: string
  targetWorkspaceId?: string
  targetWorkspaceSessionId: string
  sourceMessageId: string
}) => {
  const sourcePayload = getTaskConversationWithMessages(
    params.task,
    params.project,
    params.sourceWorkspaceId,
    params.sourceWorkspaceSessionId,
  )
  let sourceIndex = -1
  for (let index = sourcePayload.messages.length - 1; index >= 0; index -= 1) {
    const message = sourcePayload.messages[index]
    if (message.id === params.sourceMessageId || readForkAnchorMessageId(message) === params.sourceMessageId) {
      sourceIndex = index
      break
    }
  }
  if (sourceIndex < 0) {
    return null
  }

  const targetConversation = ensureTaskConversation(
    params.task,
    params.project,
    params.targetWorkspaceId,
    params.targetWorkspaceSessionId,
  )
  const sourceMessages = sourcePayload.messages.slice(0, sourceIndex + 1)
  const messageIdMap = new Map<string, string>()
  const copiedMessages = sourceMessages.map((message) => {
    return cloneConversationMessageForFork(message, targetConversation.id, messageIdMap)
  }).map((message) => ({
    ...message,
    replyToMessageId: message.replyToMessageId ? messageIdMap.get(message.replyToMessageId) : undefined,
  }))

  for (const message of copiedMessages) {
    saveConversationMessage(message)
  }

  return {
    conversation: targetConversation,
    copiedMessages,
    sourceMessageCount: sourceMessages.length,
  } satisfies ForkTaskConversationResult
}

export const copyTaskConversationScope = (params: {
  task: Task
  project?: Project
  sourceWorkspaceId?: string
  sourceWorkspaceSessionId?: string
  targetWorkspaceId?: string
  targetWorkspaceSessionId?: string
}) => {
  const sourcePayload = getTaskConversationWithMessages(
    params.task,
    params.project,
    params.sourceWorkspaceId,
    params.sourceWorkspaceSessionId,
  )
  const targetConversation = ensureTaskConversation(
    params.task,
    params.project,
    params.targetWorkspaceId,
    params.targetWorkspaceSessionId,
  )
  const existingTargetMessages = listVisibleConversationMessages(listConversationMessages(targetConversation.id))
  if (existingTargetMessages.length > 0) {
    return {
      conversation: targetConversation,
      copiedMessages: [],
      sourceMessageCount: sourcePayload.messages.length,
    }
  }

  const messageIdMap = new Map<string, string>()
  const copiedMessages = sourcePayload.messages
    .map((message) => cloneConversationMessageForFork(message, targetConversation.id, messageIdMap))
    .map((message) => ({
      ...message,
      replyToMessageId: message.replyToMessageId ? messageIdMap.get(message.replyToMessageId) : undefined,
    }))

  for (const message of copiedMessages) {
    saveConversationMessage(message)
  }

  return {
    conversation: targetConversation,
    copiedMessages,
    sourceMessageCount: sourcePayload.messages.length,
  }
}

const toBindingSummary = (binding: ChannelBindingRecord): ConversationBindingSummary => ({
  id: binding.id,
  channelType: binding.channelType,
  externalChatId: binding.externalChatId,
  externalThreadId: binding.externalThreadId,
  bindingMode: binding.bindingMode,
})

export const getConversationDetail = (conversationId: string): ConversationDetailPayload | null => {
  const conversation = getConversation(conversationId)
  if (!conversation) {
    return null
  }

  return {
    conversation,
    messages: listConversationMessages(conversation.id),
    channelBindings: listConversationChannelBindings(conversation.id).map(toBindingSummary),
  }
}

export const deleteConversationMessagesByAnchor = (conversationId: string, anchorMessageId: string) => {
  const normalizedAnchorMessageId = anchorMessageId.trim()
  if (!normalizedAnchorMessageId) {
    return { deletedMessageIds: [] as string[] }
  }

  const allMessages = listConversationMessages(conversationId)
  const directMatches = allMessages.filter((message) => {
    return message.id === normalizedAnchorMessageId
      || readForkAnchorMessageId(message) === normalizedAnchorMessageId
  })

  if (directMatches.length === 0) {
    return { deletedMessageIds: [] as string[] }
  }

  const matchedTurnIds = new Set(
    directMatches
      .map((message) => readTimelineTurnId(message))
      .filter((turnId): turnId is string => Boolean(turnId)),
  )

  const deletedMessageIds = new Set<string>()
  for (const message of allMessages) {
    const timelineTurnId = readTimelineTurnId(message)
    const matchesAnchor = message.id === normalizedAnchorMessageId
      || readForkAnchorMessageId(message) === normalizedAnchorMessageId
    const matchesTurn = Boolean(timelineTurnId && matchedTurnIds.has(timelineTurnId))

    if (!matchesAnchor && !matchesTurn) {
      continue
    }

    deletedMessageIds.add(message.id)
    deleteConversationMessage(message.id, conversationId)
  }

  return { deletedMessageIds: [...deletedMessageIds] }
}

export const listConversationsByScope = (params: {
  projectIds?: string[]
  taskIds?: string[]
}) => {
  const projectIds = new Set(params.projectIds ?? [])
  const taskIds = new Set(params.taskIds ?? [])
  const canAccess = (scope?: { projectId?: string; taskId?: string }) => {
    if (scope?.taskId && taskIds.has(scope.taskId)) {
      return true
    }

    if (scope?.projectId && projectIds.has(scope.projectId)) {
      return true
    }

    return false
  }

  return listConversations()
    .filter((conversation) => {
      if (canAccess(conversation)) {
        return true
      }

      return listConversationChannelBindings(conversation.id).some(canAccess)
    })
    .map<ConversationListItem>((conversation) => {
      const messages = listConversationMessages(conversation.id)
      return {
        conversation,
        messageCount: messages.length,
        latestMessage: messages.at(-1),
        channelBindings: listConversationChannelBindings(conversation.id).map(toBindingSummary),
      }
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.latestMessage?.createdAt ?? left.conversation.updatedAt)
      const rightTime = Date.parse(right.latestMessage?.createdAt ?? right.conversation.updatedAt)
      return rightTime - leftTime
    })
}

/**
 * @会话 解析（跨渠道共用）：用户可见会话（工作区群聊 + 任务会话 + 私聊 + 主聊天会话）按标题完整匹配。
 * 主聊天会话不在 conversations 存储里，由调用方经 app state 传入。
 */
export const resolveMentionedConversationIdsForUser = (params: {
  message: string
  userId: string
  scopedState: { projects: ReadonlyArray<{ id: string }>; tasks: ReadonlyArray<{ id: string }> }
  mainChatSessions?: ReadonlyArray<{ id: string; title?: string | null }>
}) => {
  const scopedConversations = listConversationsByScope({
    projectIds: params.scopedState.projects.map((project) => project.id),
    taskIds: params.scopedState.tasks.map((task) => task.id),
  }).map((item) => item.conversation)
  const dmConversations = listDmConversationsForUser(params.userId).map((item) => item.conversation)
  const conversations = [...scopedConversations, ...dmConversations, ...(params.mainChatSessions ?? [])]
  const targets = conversations
    .filter((conversation) => conversation.title?.trim())
    .map((conversation) => ({ id: conversation.id, name: conversation.title!.trim() }))

  return {
    mentionedIds: new Set(resolveChatMentionTargetIds(params.message, targets)),
    conversations,
  }
}

/** @工作区 解析（跨渠道共用）：按工作区名完整匹配（引用型提及，不通知成员）。 */
export const resolveMentionedWorkspaceIds = (
  message: string,
  workspaces: ReadonlyArray<{ id: string; name: string }>,
): Set<string> => {
  const targets = workspaces
    .filter((workspace) => workspace.name.trim())
    .map((workspace) => ({ id: workspace.id, name: workspace.name.trim() }))
  return new Set(resolveChatMentionTargetIds(message, targets))
}
