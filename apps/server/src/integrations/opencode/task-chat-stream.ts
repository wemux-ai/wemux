import { normalizeAssistantReplyText } from '@shared/task-chat'
import type { TaskChatDataParts } from '@shared/task-chat'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import { markTaskExecutionFinished } from '@shared/task-status-flow'
import type { ModelTokenUsage } from '@shared/types'
import type { Task, WorkspaceSession } from '@shared/types'
import type { ChatTimelineEvent, ChatTimelineInteraction, ChatTimelineWorkspaceExecutor } from '@shared/timeline'
import type { TaskGitChangeSummary } from '@shared/task-git-ops'

export interface AgentMessageResult {
  ok: boolean
  output: string
  turnId?: string
  executionModel?: string
  usage?: ModelTokenUsage
  agentSessionId?: string
  opencodeSessionId?: string
  runtimeContinuations?: WorkspaceSession['runtimeContinuations']
  taskRunId?: string
  toolCalls?: Task['toolCalls']
  approvalRequests?: string[]
  agentRunningStatus?: Task['agentRunningStatus']
  currentStep?: string
  filesChanged?: string[]
  changeSummary?: TaskGitChangeSummary
  commitShas?: string[]
  remoteBranchName?: string
  delivery?: NonNullable<Task['result']>['delivery']
  conversationTimeline?: ChatTimelineEvent[]
}

export type TaskChatStreamPart =
  | {
      type: 'data-timeline_event'
      data: TaskChatDataParts['timeline_event']
      transient?: boolean
    }
  | {
      type: 'data-task'
      data: TaskChatDataParts['task']
      transient?: boolean
    }
  | {
      type: 'data-session'
      data: TaskChatDataParts['session']
      transient?: boolean
    }
  | {
      type: 'data-notice'
      data: TaskChatDataParts['notice']
      transient?: boolean
    }
  | {
      type: 'text-start' | 'reasoning-start' | 'text-end' | 'reasoning-end'
      id: string
    }
  | {
      type: 'text-delta' | 'reasoning-delta'
      id: string
      delta: string
    }

export interface TaskChatStreamWriter {
  write: (part: TaskChatStreamPart) => void
}

export interface TimelineCollector {
  turnId: string
  nextSeq: () => number
  upsert: (event: ChatTimelineEvent) => ChatTimelineEvent
  values: () => ChatTimelineEvent[]
}

export const createTimelineCollector = (turnId: string): TimelineCollector => {
  let seq = 0
  const events = new Map<string, ChatTimelineEvent>()

  return {
    turnId,
    nextSeq: () => {
      seq += 1
      return seq
    },
    upsert: (event) => {
      const existing = events.get(event.id)
      const nextEvent = existing ? { ...event, seq: existing.seq } : event
      events.set(event.id, nextEvent)
      return nextEvent
    },
    values: () => [...events.values()].sort((left, right) => left.seq - right.seq),
  }
}

const createTimelineEventBase = (collector: TimelineCollector, id: string, ts: string) => {
  return {
    id,
    ts,
    turnId: collector.turnId,
    seq: collector.nextSeq(),
  }
}

export const createUserMessageEvent = (
  collector: TimelineCollector,
  messageId: string,
  text: string,
  ts: string,
  attachments?: TaskChatAttachment[],
  author?: {
    authorId?: string
    author?: Extract<ChatTimelineEvent, { kind: 'user_message' }>['author']
  },
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:user:${messageId}`, ts),
    kind: 'user_message',
    messageId,
    text,
    ...(author?.authorId ? { authorId: author.authorId } : {}),
    ...(author?.author ? { author: author.author } : {}),
    ...(attachments?.length ? { attachments } : {}),
  })
}

export const createAssistantMessageEvent = (
  collector: TimelineCollector,
  messageId: string,
  text: string,
  ts: string,
  eventMessageId = messageId,
  authorName?: string,
  executionModel?: string,
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:assistant:${eventMessageId}`, ts),
    kind: 'assistant_message',
    messageId: eventMessageId,
    text,
    ...(authorName ? { authorName } : {}),
    ...(executionModel ? { executionModel } : {}),
  })
}

export const createSystemMessageEvent = (
  collector: TimelineCollector,
  message: string,
  ts: string,
  eventId: string = crypto.randomUUID(),
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:system:${eventId}`, ts),
    kind: 'system_message',
    message,
  })
}

export const createThinkingEvent = (
  collector: TimelineCollector,
  partId: string,
  text: string,
  ts: string,
  messageId?: string,
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:thinking:${partId}`, ts),
    kind: 'thinking',
    partId,
    messageId,
    text,
  })
}

export const createToolCallEvent = (
  collector: TimelineCollector,
  toolCall: Task['toolCalls'][number],
  ts: string,
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:tool:${toolCall.id}`, ts),
    kind: 'tool_call',
    toolCall,
  })
}

export const createInteractionEvent = (
  collector: TimelineCollector,
  interaction: ChatTimelineInteraction,
  ts: string,
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:interaction:${interaction.id}`, ts),
    kind: 'interaction',
    interaction,
  })
}

export const createStatusEvent = (
  collector: TimelineCollector,
  status: Task['agentRunningStatus'],
  step: string,
  ts: string,
  workspaceExecutor?: ChatTimelineWorkspaceExecutor,
): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `turn:${collector.turnId}:status:${status}:${step}`, ts),
    kind: 'status',
    status,
    step,
    ...(workspaceExecutor ? { workspaceExecutor } : {}),
  })
}

export const createErrorEvent = (collector: TimelineCollector, message: string, ts: string): ChatTimelineEvent => {
  return collector.upsert({
    ...createTimelineEventBase(collector, `error:${collector.turnId}`, ts),
    kind: 'error',
    message,
  })
}

export const writeTimelineEvent = (
  writer: TaskChatStreamWriter | undefined,
  event: ChatTimelineEvent,
) => {
  writer?.write({
    type: 'data-timeline_event',
    data: event,
    transient: true,
  })
}

export const emitTextDelta = (
  writer: TaskChatStreamWriter,
  state: Map<string, string>,
  active: Set<string>,
  partId: string,
  fullText: string,
  delta?: string,
  type: 'text' | 'reasoning' = 'text',
) => {
  const previous = state.get(partId) ?? ''
  const nextDelta = delta ?? (fullText.startsWith(previous) ? fullText.slice(previous.length) : fullText)

  if (!active.has(partId)) {
    writer.write({ type: type === 'text' ? 'text-start' : 'reasoning-start', id: partId })
    active.add(partId)
  }

  if (nextDelta) {
    writer.write({
      type: type === 'text' ? 'text-delta' : 'reasoning-delta',
      id: partId,
      delta: nextDelta,
    })
  }

  state.set(partId, fullText)
}

export const finishActiveParts = (
  writer: TaskChatStreamWriter,
  partIds: Set<string>,
  type: 'text' | 'reasoning',
) => {
  for (const partId of partIds) {
    writer.write({ type: type === 'text' ? 'text-end' : 'reasoning-end', id: partId })
  }
  partIds.clear()
}

export const resetStreamingPartState = (
  writer: TaskChatStreamWriter | undefined,
  state: Map<string, string>,
  active: Set<string>,
  type: 'text' | 'reasoning',
) => {
  if (writer) {
    finishActiveParts(writer, active, type)
  } else {
    active.clear()
  }

  state.clear()
}

export const extractAssistantText = (parts: Array<{ type: string; text?: string }>, userMessage?: string) => {
  const joined = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')

  return normalizeAssistantReplyText(joined, userMessage)
}

export const extractStreamingText = (parts: Map<string, string>, userMessage?: string) => {
  return normalizeAssistantReplyText(
    [...parts.values()]
      .join('')
      .trim(),
    userMessage,
  )
}

export const applyAgentMessageResultToTask = (task: Task, result: AgentMessageResult): Task => {
  const replyAt = new Date().toISOString()
  const replyText = result.output || '操作失败'
  const needsHumanConfirm = result.ok && (result.agentRunningStatus === 'complete' || result.agentRunningStatus === 'idle')
  const nextTask = markTaskExecutionFinished(task, result.ok, replyAt)

  return {
    ...nextTask,
    toolCalls: result.toolCalls ?? nextTask.toolCalls,
    result: result.delivery
      ? {
          taskId: nextTask.id,
          status: result.ok ? 'completed' : 'failed',
          returnMode: nextTask.result?.returnMode ?? 'summary',
          summary: replyText,
          output: replyText,
          filesChanged: result.filesChanged ?? [],
          remoteBranchName: result.remoteBranchName,
          commitShas: result.commitShas,
          startedAt: nextTask.result?.startedAt ?? replyAt,
          completedAt: replyAt,
          durationSec: nextTask.result?.durationSec ?? 0,
          executorNodeId: nextTask.result?.executorNodeId ?? '',
          agentSessionId: result.agentSessionId ?? result.opencodeSessionId,
          opencodeSessionId: result.opencodeSessionId,
          delivery: result.delivery,
        }
      : nextTask.result,
    logs: [
      ...nextTask.logs,
      {
        id: crypto.randomUUID(),
        role: 'agent',
        content: replyText,
        createdAt: replyAt,
      },
    ],
    needsHumanConfirm,
    agentRunningStatus: result.agentRunningStatus ?? (result.ok ? 'complete' : 'error'),
    currentStep: result.currentStep ?? (result.ok ? '任务详情对话已完成' : '任务详情对话失败'),
  }
}

export const writeFinalTextResult = (
  writer: TaskChatStreamWriter,
  result: AgentMessageResult,
) => {
  const textPartId = crypto.randomUUID()

  if (result.output) {
    writer.write({ type: 'text-start', id: textPartId })
    writer.write({ type: 'text-delta', id: textPartId, delta: result.output })
    writer.write({ type: 'text-end', id: textPartId })
  }
}
