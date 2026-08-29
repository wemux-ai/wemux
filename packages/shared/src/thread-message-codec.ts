/**
 * [INPUT]: Legacy ChatMessage / TaskComment records and their tool-call, reasoning and attachment fields.
 * [OUTPUT]: Lossless converters between legacy chat shapes and the unified ThreadMessage/MessagePart model, plus the non-content extras (usage, runtime status, finish reason) carried alongside.
 * [POS]: Pure codec boundary for the unified conversation model; no storage or transport side effects.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { MessagePart, MessageReaction, ThreadMessage } from './thread-message'
import { TASK_COMMENT_REACTION_EMOJIS } from './task-comment-reaction'
import type { TaskCommentReactionEmoji } from './task-comment-reaction'
import type { ChatMessage, ModelTokenUsage, TaskComment, ToolCall } from './types'

/**
 * Part 规范顺序：reasoning → tool_call/tool_result → text → attachment → proposal。
 * 固定顺序让往返可比较，也让渲染层不必再排序。
 */
const PART_ORDER: Record<MessagePart['type'], number> = {
  reasoning: 0,
  tool_call: 1,
  tool_result: 2,
  text: 3,
  attachment: 4,
  proposal: 5,
}

export const sortMessageParts = (parts: MessagePart[]): MessagePart[] => {
  return parts
    .map((part, index) => ({ part, index }))
    .sort((left, right) => {
      const orderDiff = PART_ORDER[left.part.type] - PART_ORDER[right.part.type]
      return orderDiff !== 0 ? orderDiff : left.index - right.index
    })
    .map((item) => item.part)
}

/**
 * ToolCall 是「调用 + 结果」同体的对象，拆成配对的两个 Part。
 * 仅当 result 或 finishedAt 存在时才产出 tool_result，
 * 这样「未完成的调用」在往返后不会凭空长出一个空结果。
 */
export const toolCallToParts = (toolCall: ToolCall): MessagePart[] => {
  const parts: MessagePart[] = [{
    type: 'tool_call',
    toolCallId: toolCall.id,
    name: toolCall.name,
    args: toolCall.args,
    startedAt: toolCall.startedAt,
    ...(toolCall.workspaceId === undefined ? {} : { workspaceId: toolCall.workspaceId }),
    ...(toolCall.metadata === undefined ? {} : { metadata: toolCall.metadata }),
  }]

  if (toolCall.result !== undefined || toolCall.finishedAt !== undefined) {
    parts.push({
      type: 'tool_result',
      toolCallId: toolCall.id,
      ...(toolCall.result === undefined ? {} : { result: toolCall.result }),
      ...(toolCall.finishedAt === undefined ? {} : { finishedAt: toolCall.finishedAt }),
    })
  }

  return parts
}

/** 按 toolCallId 把 tool_call / tool_result 合回 ToolCall，配不上的结果被丢弃而非造出假调用。 */
export const partsToToolCalls = (parts: MessagePart[]): ToolCall[] => {
  const results = new Map<string, { result?: string; finishedAt?: string }>()
  for (const part of parts) {
    if (part.type === 'tool_result') {
      results.set(part.toolCallId, { result: part.result, finishedAt: part.finishedAt })
    }
  }

  return parts.flatMap((part) => {
    if (part.type !== 'tool_call') {
      return []
    }

    const paired = results.get(part.toolCallId)
    return [{
      id: part.toolCallId,
      name: part.name,
      args: part.args,
      startedAt: part.startedAt,
      ...(paired?.result === undefined ? {} : { result: paired.result }),
      ...(paired?.finishedAt === undefined ? {} : { finishedAt: paired.finishedAt }),
      ...(part.workspaceId === undefined ? {} : { workspaceId: part.workspaceId }),
      ...(part.metadata === undefined ? {} : { metadata: part.metadata }),
    } satisfies ToolCall]
  })
}

export const collectPartText = (parts: MessagePart[]): string => {
  return parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
}

/** content 在关系表里降级为 parts 的纯文本投影，专供全文搜索与列表预览。 */
export const projectPartsToPlainText = collectPartText

export type ChatMessageDecodeExtras = {
  usage?: ModelTokenUsage
  agentRunningStatus?: ChatMessage['agentRunningStatus']
  currentStep?: string
  /** 结束原因不属于 parts（不是内容），与 usage 同样走 extras 旁路。 */
  finishReason?: ChatMessage['finishReason']
  /** 线程内单调序号（P0 分配），游标分页读取更早历史的游标。 */
  seq?: number
}

export type ChatMessageEncodeResult = {
  message: ThreadMessage
  /** usage 从 message 上移到 Run，故单独返回而不是塞进 ThreadMessage。 */
  extras: ChatMessageDecodeExtras
}

/**
 * ChatMessage → ThreadMessage。
 * 归一化约定：空 content 不产出 text part；空 reasoning 数组视同缺省。
 */
export const chatMessageToThreadMessage = (
  message: ChatMessage,
  threadId: string,
): ChatMessageEncodeResult => {
  const parts: MessagePart[] = []

  for (const reasoning of message.reasoning ?? []) {
    parts.push({ type: 'reasoning', text: reasoning })
  }

  for (const toolCall of message.toolCalls ?? []) {
    parts.push(...toolCallToParts(toolCall))
  }

  if (message.content !== '') {
    parts.push({ type: 'text', text: message.content })
  }

  for (const attachment of message.attachments ?? []) {
    parts.push({ type: 'attachment', attachment })
  }

  if (message.taskProposal !== undefined) {
    parts.push({
      type: 'proposal',
      ...(message.taskProposal === undefined ? {} : { taskProposal: message.taskProposal }),
    })
  }

  const author = message.authorType === undefined
    && message.authorId === undefined
    && message.authorName === undefined
    ? undefined
    : {
        type: message.authorType ?? 'user',
        ...(message.authorId === undefined ? {} : { id: message.authorId }),
        ...(message.authorName === undefined ? {} : { name: message.authorName }),
      }

  return {
    message: {
      id: message.id,
      threadId,
      role: message.role,
      ...(author === undefined ? {} : { author }),
      parts: sortMessageParts(parts),
      ...(message.replyToMessageId === undefined ? {} : { replyToId: message.replyToMessageId }),
      ...(message.externalRef === undefined ? {} : { externalRef: message.externalRef }),
      createdAt: message.createdAt,
    },
    extras: {
      ...(message.usage === undefined ? {} : { usage: message.usage }),
      ...(message.agentRunningStatus === undefined ? {} : { agentRunningStatus: message.agentRunningStatus }),
      ...(message.currentStep === undefined ? {} : { currentStep: message.currentStep }),
      ...(message.finishReason === undefined ? {} : { finishReason: message.finishReason }),
    },
  }
}

/** ThreadMessage → ChatMessage，配合 extras 还原 usage/运行态。 */
export const threadMessageToChatMessage = (
  message: ThreadMessage,
  extras: ChatMessageDecodeExtras = {},
): ChatMessage => {
  const reasoning = message.parts.flatMap((part) => (part.type === 'reasoning' ? [part.text] : []))
  const toolCalls = partsToToolCalls(message.parts)
  const attachments = message.parts.flatMap((part) => (part.type === 'attachment' ? [part.attachment] : []))
  const proposal = message.parts.find((part) => part.type === 'proposal')

  return {
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: collectPartText(message.parts),
    createdAt: message.createdAt,
    ...(message.author?.type === undefined ? {} : { authorType: message.author.type }),
    ...(message.author?.id === undefined ? {} : { authorId: message.author.id }),
    ...(message.author?.name === undefined ? {} : { authorName: message.author.name }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(message.reactions === undefined ? {} : { reactions: message.reactions }),
    ...(message.replyToId === undefined ? {} : { replyToMessageId: message.replyToId }),
    ...(message.externalRef === undefined ? {} : { externalRef: message.externalRef }),
    ...(proposal?.type === 'proposal' && proposal.taskProposal !== undefined
      ? { taskProposal: proposal.taskProposal }
      : {}),
    ...(extras.agentRunningStatus === undefined ? {} : { agentRunningStatus: extras.agentRunningStatus }),
    ...(extras.currentStep === undefined ? {} : { currentStep: extras.currentStep }),
    ...(reasoning.length === 0 ? {} : { reasoning }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(extras.usage === undefined ? {} : { usage: extras.usage }),
    ...(extras.finishReason === undefined ? {} : { finishReason: extras.finishReason }),
    ...(extras.seq === undefined ? {} : { seq: extras.seq }),
  }
}

const toMessageReactions = (reactions: TaskComment['reactions']): MessageReaction[] | undefined => {
  return reactions === undefined ? undefined : reactions.map((reaction) => ({
    emoji: reaction.emoji,
    userIds: reaction.userIds,
  }))
}

/**
 * TaskComment → ThreadMessage。评论的可编辑/软删/reaction 落在 Message 字段而非 Part，
 * 证明同一模型能覆盖 CRUD 型对话而不必上事件溯源。
 */
export const taskCommentToThreadMessage = (comment: TaskComment, threadId: string): ThreadMessage => {
  const parts: MessagePart[] = []

  if (comment.content !== '') {
    parts.push({ type: 'text', text: comment.content })
  }

  for (const attachment of comment.attachments ?? []) {
    parts.push({ type: 'attachment', attachment })
  }

  const reactions = toMessageReactions(comment.reactions)

  return {
    id: comment.id,
    threadId,
    role: comment.authorType === 'agent' ? 'assistant' : comment.authorType === 'system' ? 'system' : 'user',
    ...(comment.authorType === undefined && comment.authorId === undefined && comment.authorName === undefined
      ? {}
      : {
          author: {
            type: comment.authorType ?? 'user',
            ...(comment.authorId === undefined ? {} : { id: comment.authorId }),
            ...(comment.authorName === undefined ? {} : { name: comment.authorName }),
          },
        }),
    parts: sortMessageParts(parts),
    ...(comment.parentCommentId === undefined ? {} : { replyToId: comment.parentCommentId }),
    ...(comment.mentions === undefined ? {} : { mentions: comment.mentions }),
    ...(reactions === undefined ? {} : { reactions }),
    createdAt: comment.createdAt,
    ...(comment.editedAt === undefined ? {} : { editedAt: comment.editedAt }),
    ...(comment.deletedAt === undefined ? {} : { deletedAt: comment.deletedAt }),
    ...(comment.resolvedAt === undefined ? {} : { resolvedAt: comment.resolvedAt }),
    ...(comment.resolvedByUserId === undefined ? {} : { resolvedByUserId: comment.resolvedByUserId }),
  }
}

/** ThreadMessage → TaskComment。authorAvatarUrl / idempotencyKey 由写入侧保留，不进领域模型。 */
export const threadMessageToTaskComment = (message: ThreadMessage): TaskComment => {
  const attachments = message.parts.flatMap((part) => (part.type === 'attachment' ? [part.attachment] : []))

  return {
    id: message.id,
    ...(message.author?.type === undefined ? {} : { authorType: message.author.type }),
    ...(message.author?.id === undefined ? {} : { authorId: message.author.id }),
    ...(message.author?.name === undefined ? {} : { authorName: message.author.name }),
    ...(message.replyToId === undefined ? {} : { parentCommentId: message.replyToId }),
    ...(message.mentions === undefined ? {} : { mentions: message.mentions }),
    // 任务评论 reactions 仍为固定列表（产品约束）；消息级自由 emoji 超出部分在此丢弃。
    ...(message.reactions === undefined
      ? {}
      : {
          reactions: message.reactions
            .filter((reaction) => (TASK_COMMENT_REACTION_EMOJIS as readonly string[]).includes(reaction.emoji))
            .map((reaction) => ({
              emoji: reaction.emoji as TaskCommentReactionEmoji,
              userIds: reaction.userIds,
            })),
        }),
    ...(attachments.length === 0 ? {} : { attachments }),
    content: collectPartText(message.parts),
    createdAt: message.createdAt,
    ...(message.editedAt === undefined ? {} : { editedAt: message.editedAt }),
    ...(message.deletedAt === undefined ? {} : { deletedAt: message.deletedAt }),
    ...(message.resolvedAt === undefined ? {} : { resolvedAt: message.resolvedAt }),
    ...(message.resolvedByUserId === undefined ? {} : { resolvedByUserId: message.resolvedByUserId }),
  }
}
