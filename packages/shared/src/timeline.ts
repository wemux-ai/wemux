// [INPUT]: 时间线事件输入
// [OUTPUT]: 事件类型
// [POS]: Timeline 契约
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  AgentRunningStatus,
  CreatorIdentity,
  ExecutorConnectionStatus,
  ExecutorManagedBy,
  ExecutorRuntimeClass,
  ExecutorSource,
  TaskResultDelivery,
  ToolCall,
} from './types'
import type { TaskGitChangeSummary } from './task-git-ops'
import type { TaskChatAttachment } from './task-chat-attachment'

export interface ChatTimelineWorkspaceExecutor {
  executorId: string
  name?: string
  executorSource?: ExecutorSource
  managedBy?: ExecutorManagedBy
  runtimeClass?: ExecutorRuntimeClass
  status?: ExecutorConnectionStatus
}

export interface ChatTimelineInteraction {
  id: string
  type: 'question' | 'approval' | 'permission'
  status: 'pending' | 'answered' | 'cancelled'
  title: string
  prompt?: string
  provider?: string
  toolName?: string
}

export type ChatTimelineEvent =
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'user_message'
      messageId: string
      text: string
      authorId?: string
      author?: CreatorIdentity
      attachments?: TaskChatAttachment[]
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'assistant_message'
      messageId: string
      text: string
      authorName?: string
      executionModel?: string
      attachments?: TaskChatAttachment[]
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'system_message'
      message: string
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'delivery_result'
      message: string
      remoteBranchName?: string
      commitShas?: string[]
      delivery?: TaskResultDelivery
      changeSummary?: TaskGitChangeSummary
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'thinking'
      partId: string
      messageId?: string
      text: string
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'tool_call'
      toolCall: ToolCall
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'interaction'
      interaction: ChatTimelineInteraction
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'status'
      status: AgentRunningStatus
      step: string
      workspaceExecutor?: ChatTimelineWorkspaceExecutor
    }
  | {
      id: string
      ts: string
      turnId: string
      seq: number
      kind: 'error'
      message: string
    }

export const isUserMessageEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'user_message' }> => event.kind === 'user_message'

export const isAssistantMessageEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'assistant_message' }> => event.kind === 'assistant_message'

export const isSystemMessageEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'system_message' }> => event.kind === 'system_message'

export const isDeliveryResultEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'delivery_result' }> => event.kind === 'delivery_result'

export const isThinkingEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'thinking' }> => event.kind === 'thinking'

export const isToolCallEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'tool_call' }> => event.kind === 'tool_call'

export const isInteractionEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'interaction' }> => event.kind === 'interaction'

export const isStatusEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'status' }> => event.kind === 'status'

export const isErrorEvent = (
  event: ChatTimelineEvent,
): event is Extract<ChatTimelineEvent, { kind: 'error' }> => event.kind === 'error'

export const compareTimelineEvents = (left: ChatTimelineEvent, right: ChatTimelineEvent) => {
  const timeDiff = new Date(left.ts).getTime() - new Date(right.ts).getTime()
  if (timeDiff !== 0) {
    return timeDiff
  }

  const turnDiff = left.turnId.localeCompare(right.turnId)
  if (turnDiff !== 0) {
    return turnDiff
  }

  return left.seq - right.seq
}

const sameAssistantAttachments = (
  left: Extract<ChatTimelineEvent, { kind: 'assistant_message' }>,
  right: Extract<ChatTimelineEvent, { kind: 'assistant_message' }>,
) => {
  const leftAttachments = left.attachments ?? []
  const rightAttachments = right.attachments ?? []
  if (leftAttachments.length !== rightAttachments.length) {
    return false
  }

  return leftAttachments.every((attachment, index) => {
    const other = rightAttachments[index]
    if (!other) {
      return false
    }

    return attachment.id === other.id
      && attachment.url === other.url
      && attachment.filename === other.filename
      && attachment.contentType === other.contentType
  })
}

const isDuplicateAssistantEvent = (
  previous: ChatTimelineEvent | undefined,
  current: ChatTimelineEvent,
) => {
  if (!previous || previous.kind !== 'assistant_message' || current.kind !== 'assistant_message') {
    return false
  }

  return previous.turnId === current.turnId
    && previous.text === current.text
    && previous.authorName === current.authorName
    && previous.executionModel === current.executionModel
    && sameAssistantAttachments(previous, current)
}

const isDuplicateThinkingEvent = (
  previous: ChatTimelineEvent | undefined,
  current: ChatTimelineEvent,
) => {
  if (!previous || previous.kind !== 'thinking' || current.kind !== 'thinking') {
    return false
  }

  const previousText = previous.text.trim()
  const currentText = current.text.trim()

  return previous.turnId === current.turnId
    && (
      previous.partId === current.partId
      || (previousText.length > 0 && previousText === currentText)
    )
}

export const collapseDuplicateAssistantEvents = (events: ChatTimelineEvent[]) => {
  const collapsed: ChatTimelineEvent[] = []

  for (const event of events) {
    const previous = collapsed.at(-1)
    if (isDuplicateAssistantEvent(previous, event) || isDuplicateThinkingEvent(previous, event)) {
      collapsed[collapsed.length - 1] = event
      continue
    }

    collapsed.push(event)
  }

  return collapsed
}

export const upsertTimelineEvent = (events: ChatTimelineEvent[], event: ChatTimelineEvent) => {
  const existingIndex = events.findIndex((item) => item.id === event.id)
  if (existingIndex === -1) {
    const lastEvent = events.at(-1)
    if (!lastEvent || compareTimelineEvents(lastEvent, event) <= 0) {
      return [...events, event]
    }

    return [...events, event].sort(compareTimelineEvents)
  }

  const next = [...events]
  next[existingIndex] = event

  const previousEvent = next[existingIndex - 1]
  const nextEvent = next[existingIndex + 1]
  const keepsOrder = (!previousEvent || compareTimelineEvents(previousEvent, event) <= 0)
    && (!nextEvent || compareTimelineEvents(event, nextEvent) <= 0)
  if (!keepsOrder) {
    next.sort(compareTimelineEvents)
  }

  return next
}
