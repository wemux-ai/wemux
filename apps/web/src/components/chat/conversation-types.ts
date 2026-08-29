import type { ReactNode } from 'react'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { ChatTimelineInteraction, ChatTimelineWorkspaceExecutor } from '@shared/timeline'
import type { MessageFinishReason, TaskResultDelivery } from '@shared/types/task-domain'
import type { TaskGitChangeSummary } from '@shared/task-git-ops'
import type { AgentRunningStatus, ModelTokenUsage, ToolCall } from '@shared/types'
import type { AgentType } from '@shared/agent-type'
import type { MessagePart } from '@shared/thread-message'

export interface ConversationMessage {
  id: string
  sourceId?: string
  anchorId?: string
  role: 'user' | 'assistant'
  text: string
  createdAt?: string
  streaming?: boolean
  authorType?: 'user' | 'agent' | 'system'
  authorId?: string
  authorName?: string
  avatarUrl?: string
  avatarFallback?: string
  avatarRuntime?: AgentType
  agentRunningStatus?: AgentRunningStatus
  currentStep?: string
  executionModel?: string
  /**
   * 结束原因。'aborted' 的 text 是片段，必须显式标注，
   * 否则片段与完整回答在时间线上长得一模一样。
   */
  finishReason?: MessageFinishReason
  attachments?: TaskChatAttachment[]
  /** 用户消息里 @ 引用的 Drive 文档（externalRef.referencedDocs，reference_doc） */
  referencedDocs?: Array<{ id: string; name: string; workspaceId: string | null }>
  /**
   * 有序内容块，复用 `@shared/thread-message` 的 `MessagePart`。可选、渲染层回落 `text` ——
   * 过渡期两者并存，等所有生产端都填充 parts 后 text 才能退场。
   */
  parts?: MessagePart[]
  actions?: ReactNode
  afterContent?: ReactNode
}

export interface ConversationStatus {
  status: AgentRunningStatus
  step: string
  startedAt?: string
  finishedAt?: string
  workspaceExecutor?: ChatTimelineWorkspaceExecutor
}

export type ConversationTurnEntry =
  | {
      kind: 'thinking'
      id: string
      content: string
    }
  | {
      kind: 'tool'
      id: string
      tool: ToolCall
      changeSummary?: TaskGitChangeSummary
    }
  | {
      kind: 'interaction'
      id: string
      interaction: ChatTimelineInteraction
      createdAt?: string
    }
  | {
      kind: 'assistant'
      id: string
      message: ConversationMessage
    }
  | {
      kind: 'delivery_result'
      id: string
      message: string
      createdAt?: string
      remoteBranchName?: string
      commitShas?: string[]
      delivery?: TaskResultDelivery
      changeSummary?: TaskGitChangeSummary
    }
  | {
      kind: 'change_summary'
      id: string
      changeSummary: TaskGitChangeSummary
      createdAt?: string
    }

export interface ConversationTurn {
  id: string
  user?: ConversationMessage
  /** 用户消息里 @ 引用的会话（externalRef.mentions 中 targetType=conversation） */
  conversationReferences?: Array<{ id: string; title: string }>
  /** 用户消息里 @ 引用的 Drive 文档（externalRef.referencedDocs） */
  referencedDocs?: Array<{ id: string; name: string; workspaceId: string | null }>
  entries: ConversationTurnEntry[]
  status?: ConversationStatus
  error?: { message: string }
  usage?: ModelTokenUsage
  isCurrent: boolean
  anchorId?: string
  highlighted?: boolean
  renderRevisionKey?: string
}
