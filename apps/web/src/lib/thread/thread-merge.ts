/**
 * [INPUT]: 会话消息、历史时间线事件、乐观队列与快照 —— 均为纯数据，无 React 闭包
 * [OUTPUT]: 去重/合并/排序/仲裁/乐观队列（upsert/销账）的纯函数集合，
 *   供 useThread 与三套聊天栈共用
 * [POS]: P2 收敛的合并核心；从 workspace-session-chat-conversation.ts /
 *   workspace-session-chat-history-timeline.ts / workspace-session-chat-socket-sync.ts 搬出，
 *   行为未变；消息函数已泛型化为 `{ id: string }` 以同时服务主对话的 ChatMessage
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { TaskChatQueueEntry, TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { ChatTimelineEvent } from '@shared/timeline'
import { isWorkspaceSessionBusy } from '../workspace-session-status'
import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'
import type {
  ConversationMessageRecord,
  ConversationRecord,
  TaskConversationPayload,
} from '../api'

export const INITIAL_CONVERSATION_PAGE_SIZE = 50
export const INITIAL_CONVERSATION_TURN_WINDOW = 20
export const CONVERSATION_PAGE_SIZE = 50

export const dedupeConversationMessages = <TMessage extends { id: string }>(messages: TMessage[]) => {
  const seen = new Set<string>()
  const normalized: TMessage[] = []

  for (const message of messages) {
    if (seen.has(message.id)) {
      continue
    }

    seen.add(message.id)
    normalized.push(message)
  }

  return normalized
}

export const appendConversationMessages = <TMessage extends { id: string }>(
  currentMessages: TMessage[],
  nextMessages: TMessage[],
) => {
  return dedupeConversationMessages([
    ...currentMessages,
    ...nextMessages,
  ])
}

export const prependConversationMessages = <TMessage extends { id: string }>(
  currentMessages: TMessage[],
  olderMessages: TMessage[],
) => {
  return dedupeConversationMessages([
    ...olderMessages,
    ...currentMessages,
  ])
}

/**
 * 乐观队列条目：`clientMessageId` 是传输层关联 ID（发送前 `crypto.randomUUID()` 生成，
 * 服务端落库时回显在 `ChatMessage.externalRef`），销账时按它匹配，不按内容/位置。
 */
export interface OptimisticQueuedMessage<TMessage extends { id: string }> {
  clientMessageId: string
  message: TMessage
}

/**
 * 插入/替换乐观队列条目（同 clientMessageId 时整体替换，保证同一次发送只有一个乐观气泡）。
 */
export const upsertOptimisticMessage = <TMessage extends { id: string }>(
  queue: OptimisticQueuedMessage<TMessage>[],
  message: TMessage,
  clientMessageId: string,
) => {
  const existingIndex = queue.findIndex((item) => item.clientMessageId === clientMessageId)
  const nextItem: OptimisticQueuedMessage<TMessage> = { clientMessageId, message }
  if (existingIndex === -1) {
    return [...queue, nextItem]
  }

  return queue.map((item, index) => index === existingIndex ? nextItem : item)
}

/**
 * 按 clientMessageId 销账：服务端已落库回显（`externalRef.clientMessageId` 命中）后
 * 移除对应乐观条目，乐观气泡让位给真实消息。
 */
export const settleOptimisticMessages = <TMessage extends { id: string }>(
  queue: OptimisticQueuedMessage<TMessage>[],
  clientMessageId: string,
) => {
  if (!clientMessageId) {
    return queue
  }

  return queue.filter((item) => item.clientMessageId !== clientMessageId)
}

export const buildConversationPayload = (
  conversation: ConversationRecord,
  messages: ConversationMessageRecord[],
  totalMessageCount: number,
  hasMoreBefore: boolean,
): TaskConversationPayload => {
  return {
    conversation,
    messages,
    totalMessageCount,
    returnedMessageCount: messages.length,
    hasMoreBefore,
  }
}

export const getConversationLatestMessageAt = (messages: ConversationMessageRecord[]) => {
  return messages.at(-1)?.createdAt
}

export const conversationContainsLatestMessage = (
  messages: ConversationMessageRecord[],
  chatSession: TaskChatSessionSnapshot | null,
) => {
  if (!chatSession) {
    return true
  }

  const expectedLatestMessageAt = chatSession.conversation.latestMessageAt?.trim() || ''
  if (!expectedLatestMessageAt) {
    return chatSession.conversation.messageCount === 0 || messages.length > 0
  }

  return getConversationLatestMessageAt(messages) === expectedLatestMessageAt
}

const buildQueueTurnId = (queueId: string) => `task-chat-queue:${queueId}`

const readExternalRefTurnId = (externalRef: ConversationMessageRecord['externalRef']) => {
  if (!externalRef || typeof externalRef !== 'object') {
    return ''
  }

  const directTurnId = 'turnId' in externalRef && typeof externalRef.turnId === 'string'
    ? externalRef.turnId.trim()
    : ''
  if (directTurnId) {
    return directTurnId
  }

  const timelineEvent = 'timelineEvent' in externalRef && externalRef.timelineEvent && typeof externalRef.timelineEvent === 'object'
    ? externalRef.timelineEvent as Record<string, unknown>
    : null
  return typeof timelineEvent?.turnId === 'string' ? timelineEvent.turnId.trim() : ''
}

const normalizeComparableText = (value: string) => value.trim().replace(/\s+/g, ' ')

const getAttachmentIds = (attachments?: { id: string }[]) => {
  return (attachments ?? []).map((attachment) => attachment.id).filter(Boolean).sort()
}

const haveSameAttachments = (
  queueAttachments: TaskChatQueueEntry['attachments'],
  messageAttachments: TaskChatQueueEntry['attachments'],
) => {
  const queueAttachmentIds = getAttachmentIds(queueAttachments)
  const messageAttachmentIds = getAttachmentIds(messageAttachments)
  if (queueAttachmentIds.length !== messageAttachmentIds.length) {
    return false
  }

  return queueAttachmentIds.every((id, index) => id === messageAttachmentIds[index])
}

const readExternalRefAttachments = (externalRef: ConversationMessageRecord['externalRef']) => {
  if (!externalRef || typeof externalRef !== 'object' || !('attachments' in externalRef)) {
    return []
  }

  return Array.isArray(externalRef.attachments)
    ? externalRef.attachments.filter((attachment): attachment is NonNullable<TaskChatQueueEntry['attachments']>[number] => {
      return Boolean(attachment && typeof attachment === 'object' && 'id' in attachment && typeof attachment.id === 'string')
    })
    : []
}

export const filterQueuedMessagesAlreadyInConversation = (
  queueItems: TaskChatQueueEntry[],
  messages: ConversationMessageRecord[],
  timeline: ChatTimelineEvent[] = [],
) => {
  if (queueItems.length === 0 || (messages.length === 0 && timeline.length === 0)) {
    return queueItems
  }

  const userMessages = messages.filter((message) => message.role === 'user')
  const userEvents = timeline.filter((event): event is Extract<ChatTimelineEvent, { kind: 'user_message' }> => {
    return event.kind === 'user_message'
  })

  return queueItems.filter((queueItem) => {
    const queueTurnId = buildQueueTurnId(queueItem.id)
    const queuedText = normalizeComparableText(queueItem.message)
    const isAlreadyInConversation = userMessages.some((message) => {
      const turnId = readExternalRefTurnId(message.externalRef)
      if (turnId === queueTurnId) {
        return true
      }

      return normalizeComparableText(message.content) === queuedText
        && haveSameAttachments(queueItem.attachments, readExternalRefAttachments(message.externalRef))
    })
    const isAlreadyInTimeline = userEvents.some((event) => {
      if (event.turnId === queueTurnId) {
        return true
      }

      return normalizeComparableText(event.text) === queuedText
        && haveSameAttachments(queueItem.attachments, event.attachments)
    })

    return !isAlreadyInConversation && !isAlreadyInTimeline
  })
}

export const isConversationCacheFresh = (
  payload: TaskConversationPayload | null,
  chatSession: TaskChatSessionSnapshot | null,
) => {
  if (!payload || !chatSession) {
    return false
  }

  if (chatSession.conversation.messageCount !== payload.totalMessageCount) {
    return false
  }

  const expectedLatestMessageAt = chatSession.conversation.latestMessageAt?.trim() || ''
  const cachedLatestMessageAt = getConversationLatestMessageAt(payload.messages)?.trim() || ''
  return expectedLatestMessageAt === cachedLatestMessageAt
}

export const mergeHistorySnapshotTimeline = (
  currentTimeline: ChatTimelineEvent[],
  incomingTimeline: ChatTimelineEvent[],
) => {
  if (incomingTimeline.length === 0) {
    return currentTimeline
  }

  const mergedTimeline = new Map<string, ChatTimelineEvent>()
  for (const event of [...currentTimeline, ...incomingTimeline]) {
    mergedTimeline.set(event.id, event)
  }

  return [...mergedTimeline.values()].sort((left, right) => {
    return new Date(left.ts).getTime() - new Date(right.ts).getTime() || left.seq - right.seq
  })
}

export const filterKnownWorkspaceSessionHistoryEvents = (
  events: WorkspaceSessionEventRecord[],
  knownEventIds: ReadonlySet<string>,
) => {
  if (events.length === 0 || knownEventIds.size === 0) {
    return events
  }

  return events.filter((event) => !knownEventIds.has(event.id))
}

export const mergeWorkspaceSessionHistoryEvents = (
  current: WorkspaceSessionEventRecord[] | undefined,
  incoming: WorkspaceSessionEventRecord[],
) => {
  if (incoming.length === 0) {
    return current ?? []
  }

  const merged = new Map<string, WorkspaceSessionEventRecord>()
  for (const event of current ?? []) {
    merged.set(event.id, event)
  }
  for (const event of incoming) {
    merged.set(event.id, event)
  }

  return [...merged.values()].sort((left, right) => left.sessionSeq - right.sessionSeq)
}

export const prependHistoryPageTimeline = (
  currentTimeline: ChatTimelineEvent[],
  incomingTimeline: ChatTimelineEvent[],
  resolveHistorySessionSeq: (eventId: string) => number | undefined,
) => {
  if (incomingTimeline.length === 0) {
    return currentTimeline
  }

  const mergedTimeline = new Map<string, ChatTimelineEvent>()
  for (const event of [...incomingTimeline, ...currentTimeline]) {
    mergedTimeline.set(event.id, event)
  }

  return [...mergedTimeline.values()].sort((left, right) => {
    const leftSeq = resolveHistorySessionSeq(left.id)
    const rightSeq = resolveHistorySessionSeq(right.id)
    if (typeof leftSeq === 'number' && typeof rightSeq === 'number' && leftSeq !== rightSeq) {
      return leftSeq - rightSeq
    }

    return new Date(left.ts).getTime() - new Date(right.ts).getTime() || left.seq - right.seq
  })
}

const isTaskChatSessionSnapshotBusy = (snapshot: TaskChatSessionSnapshot | null) => {
  if (!snapshot) {
    return false
  }

  return isWorkspaceSessionBusy({
    agentRunningStatus: snapshot.runtime.agentRunningStatus,
    needsHumanConfirm: snapshot.runtime.needsHumanConfirm,
    runtimeStatus: snapshot.runtime.runtimeStatus,
  })
}

const hasIncomingTaskChatQueueItems = (
  current: TaskChatSessionSnapshot,
  incoming: TaskChatSessionSnapshot,
) => {
  if (incoming.queue.items.length === 0) {
    return false
  }

  const currentQueueIds = new Set(current.queue.items.map((item) => item.id))
  return incoming.queue.items.some((item) => !currentQueueIds.has(item.id))
}

const hasIncomingTaskChatQueueRemoval = (
  current: TaskChatSessionSnapshot,
  incoming: TaskChatSessionSnapshot,
) => {
  if (incoming.queue.items.length >= current.queue.items.length) {
    return false
  }

  const incomingQueueIds = new Set(incoming.queue.items.map((item) => item.id))
  return current.queue.items.some((item) => !incomingQueueIds.has(item.id))
}

export const resolveIncomingTaskChatSessionSnapshot = (
  current: TaskChatSessionSnapshot | null,
  incoming: TaskChatSessionSnapshot | null,
) => {
  if (!incoming) {
    return isTaskChatSessionSnapshotBusy(current) ? current : incoming
  }

  if (!current) {
    return incoming
  }

  if (current.scope.sessionKey !== incoming.scope.sessionKey) {
    return incoming
  }

  const currentRuntimeSequence = current.runtime.runtimeSequence
  const incomingRuntimeSequence = incoming.runtime.runtimeSequence
  if (
    typeof currentRuntimeSequence === 'number'
    && typeof incomingRuntimeSequence === 'number'
    && incomingRuntimeSequence < currentRuntimeSequence
  ) {
    if (hasIncomingTaskChatQueueItems(current, incoming)) {
      return {
        ...current,
        conversation: incoming.conversation,
        queue: incoming.queue,
      }
    }

    if (hasIncomingTaskChatQueueRemoval(current, incoming)) {
      return {
        ...current,
        queue: incoming.queue,
      }
    }

    return current
  }

  if (
    isTaskChatSessionSnapshotBusy(current)
    && !isTaskChatSessionSnapshotBusy(incoming)
    && (
      typeof currentRuntimeSequence !== 'number'
      || typeof incomingRuntimeSequence !== 'number'
      || incomingRuntimeSequence <= currentRuntimeSequence
    )
  ) {
    return current
  }

  return incoming
}
