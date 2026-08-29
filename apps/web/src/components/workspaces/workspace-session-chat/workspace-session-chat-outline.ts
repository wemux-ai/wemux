import type { WorkspaceSessionEventRecord } from '@shared/workspace-session-history'
import type { ConversationMessageRecord } from '../../../lib/api'
import { mapConversationMessagesToTimelineEvents } from '../../../lib/workspace-session-chat-ui'
import type { TimelineTurnDisplay } from './workspace-session-chat-helpers'

export type TaskChatOutlineItem = {
  anchorId: string
  turnId: string
  messageId: string
  text: string
  isCurrent: boolean
}

const TASK_CHAT_TURN_OUTLINE_PREVIEW_LIMIT = 72

export const buildTaskChatTurnAnchorId = (turnId: string) => `workspace-session-turn-anchor-${turnId}`

const normalizeTaskChatOutlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

export const summarizeTaskChatOutlineText = (value: string) => {
  const normalized = normalizeTaskChatOutlineText(value)
  if (normalized.length <= TASK_CHAT_TURN_OUTLINE_PREVIEW_LIMIT) {
    return normalized
  }

  return `${normalized.slice(0, TASK_CHAT_TURN_OUTLINE_PREVIEW_LIMIT - 1).trimEnd()}...`
}

export const mapDisplayTimelineToOutlineItems = (displayTimeline: TimelineTurnDisplay[]): TaskChatOutlineItem[] => {
  return displayTimeline.flatMap((turn) => {
    const userText = turn.user?.text?.trim()
    const userMessageId = turn.user?.messageId?.trim()
    if (!userText || !userMessageId) {
      return []
    }

    return [{
      anchorId: buildTaskChatTurnAnchorId(turn.id),
      turnId: turn.id,
      messageId: userMessageId,
      text: summarizeTaskChatOutlineText(userText),
      isCurrent: turn.isCurrent,
    }]
  })
}

export const mapConversationMessagesToOutlineItems = (messages: ConversationMessageRecord[]): TaskChatOutlineItem[] => {
  return mapConversationMessagesToTimelineEvents(messages)
    .flatMap((event) => {
      if (event.kind !== 'user_message') {
        return []
      }

      const userText = event.text.trim()
      if (!userText) {
        return []
      }

      return [{
        anchorId: buildTaskChatTurnAnchorId(event.turnId),
        turnId: event.turnId,
        messageId: event.messageId,
        text: summarizeTaskChatOutlineText(userText),
        isCurrent: false,
      }]
    })
}

export const mapWorkspaceSessionEventsToOutlineItems = (events: WorkspaceSessionEventRecord[]): TaskChatOutlineItem[] => {
  const deletedTurnIds = new Set(
    events
      .filter((event) => event.kind === 'turn_deleted')
      .map((event) => event.payload.deletedTurnId),
  )

  return events.flatMap((event) => {
    if (event.kind !== 'user_message' || deletedTurnIds.has(event.turnId)) {
      return []
    }

    const userText = event.payload.text.trim()
    if (!userText) {
      return []
    }

    return [{
      anchorId: buildTaskChatTurnAnchorId(event.turnId),
      turnId: event.turnId,
      messageId: event.payload.messageId,
      text: summarizeTaskChatOutlineText(userText),
      isCurrent: false,
    }]
  })
}

export const mergeTaskChatOutlineItems = (
  historyItems: TaskChatOutlineItem[],
  visibleItems: TaskChatOutlineItem[],
): TaskChatOutlineItem[] => {
  const merged = [...historyItems]
  const indexByTurnId = new Map<string, number>()

  merged.forEach((item, index) => {
    indexByTurnId.set(item.turnId, index)
  })

  for (const item of visibleItems) {
    const existingIndex = indexByTurnId.get(item.turnId)
    if (typeof existingIndex === 'number') {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...item,
      }
      continue
    }

    indexByTurnId.set(item.turnId, merged.length)
    merged.push(item)
  }

  return merged
}
