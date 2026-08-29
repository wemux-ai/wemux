import type { AgentRecord } from '../../lib/api'
import type { AgentRunningStatus, ChatMessage, ToolCall } from '@shared/types'

export type ChatBubbleMessage = ChatMessage & {
  streaming?: boolean
  timelineOrder: number
}

export type ChatImage = NonNullable<ChatMessage['attachments']>[number]

export type ChatTimelineEntry =
  | {
      id: string
      kind: 'thinking'
      createdAt: string
      timelineOrder: number
      content: string
    }
  | {
      id: string
      kind: 'status'
      createdAt: string
      timelineOrder: number
      status: AgentRunningStatus
      currentStep: string
    }
  | {
      id: string
      kind: 'tool'
      createdAt: string
      timelineOrder: number
      toolCall: ToolCall
    }
  | {
      id: string
      kind: 'assistant'
      createdAt: string
      timelineOrder: number
      messageId: string
      text: string
    }

export type ChatAgentStatus = AgentRecord['status'] | 'unknown'

export type ChatAgentListItem = {
  id: string
  name: string
  role: string
  kind: 'primary' | 'custom' | 'unavailable' | 'loading'
  status: ChatAgentStatus
  avatarUrl: string
  avatarClassName: string
  canCreateSession: boolean
}
