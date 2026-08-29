/**
 * [INPUT]: Existing chat shapes (ChatMessage, TaskComment) plus tool-call, attachment and delivery contracts.
 * [OUTPUT]: Unified Thread/Message/Part/Run domain types shared by main chat, workspace, group chat and task comments.
 * [POS]: Pure domain contract for the unified conversation model; storage adapters and transports map onto it.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { TaskChatAttachment } from './task-chat-attachment'
import type { AgentType } from './agent-type'
import type {
  AgentRunningStatus,
  ConversationHandoffSnapshot,
  MainChatRuntimeContinuation,
  ModelTokenUsage,
  TaskCommentMention,
  TaskProposal,
  ToolCall,
} from './types'

/**
 * 行业对齐命名：Thread(会话) / Message(消息) / Part(消息内容块) / Run(一次执行) / Step(执行步骤)。
 * 与 ChatMessage、ConversationMessageRecord、ConversationTurn、TaskComment 并存过渡，
 * 待旧形状退场后 ThreadMessage 可直接改名为 Message。
 */

export type ThreadKind = 'main' | 'workspace' | 'group' | 'task-comments' | 'dm'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type MessageAuthorType = 'user' | 'agent' | 'system'

/**
 * Thread 的运行态与续跑上下文，落库为 conversations.runtime_json。
 * 这些字段最终属于 Run 或独立的 session-runtime 表，过渡期整体挂在 Thread 上。
 */
export interface ThreadRuntimeState {
  cwd?: string
  agentRunningStatus?: AgentRunningStatus
  currentStep?: string
  runtimeSessionIds?: Partial<Record<AgentType, string>>
  runtimeContinuations?: MainChatRuntimeContinuation[]
  handoffSnapshot?: ConversationHandoffSnapshot
}

export interface MessageAuthor {
  type: MessageAuthorType
  id?: string
  name?: string
}

export interface MessageReaction {
  /**
   * 消息级 reactions 允许自由 emoji（表情回复/点赞）；任务评论 reactions 仍用
   * 固定列表（TASK_COMMENT_REACTION_EMOJIS，由 server 校验），此处不收紧类型。
   */
  emoji: string
  userIds: string[]
}

/**
 * 一条消息的内容 = 有序的 Part 数组，对齐 Anthropic content blocks 与 AI SDK parts。
 * 四个场景原先各自发明的「侧挂 toolCalls/reasoning」与「混排 entries」在此收敛为同一形状。
 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool_call'
      toolCallId: string
      name: string
      /** 保持 ToolCall.args 的原始序列化形式，避免往返时重新 stringify 造成漂移。 */
      args: string
      startedAt: string
      workspaceId?: string
      metadata?: ToolCall['metadata']
    }
  | {
      type: 'tool_result'
      toolCallId: string
      result?: string
      finishedAt?: string
    }
  | { type: 'attachment'; attachment: TaskChatAttachment }
  | { type: 'proposal'; taskProposal?: TaskProposal }

/**
 * 评论专属字段（replyToId / mentions / reactions / editedAt / deletedAt / resolvedAt）
 * 保留在领域模型里，因为 TaskComment 编解码器要用；但它们不落 messages 表 ——
 * 评论继续用 task_collaboration.comments_json 存储，主对话不产生这些值。
 */
export interface ThreadMessage {
  id: string
  threadId: string
  role: MessageRole
  author?: MessageAuthor
  parts: MessagePart[]
  replyToId?: string
  mentions?: TaskCommentMention[]
  reactions?: MessageReaction[]
  /** 原 ChatMessage.externalRef（@文档 引用等）镜像到 messages.external_ref_json。 */
  externalRef?: Record<string, unknown>
  createdAt: string
  editedAt?: string
  deletedAt?: string
  resolvedAt?: string
  resolvedByUserId?: string
}

/** 领域别名：等旧形状退场后可将这两个名字提升为主名。 */
export type Message = ThreadMessage
export type Part = MessagePart
