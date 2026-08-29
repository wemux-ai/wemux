import { z } from 'zod'
import { normalizeAssistantReplyText, type TaskChatDataParts, type TaskChatMessage, type TaskChatRuntimeUpdate } from '@shared/task-chat'
import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import {
  TASK_CHAT_HISTORY_PROTOCOL,
  TASK_CHAT_PROTOCOL_VERSION,
  TASK_CHAT_QUEUE_PROTOCOL,
  TASK_CHAT_STREAM_PROTOCOL,
  type TaskChatSessionSnapshot,
} from '@shared/task-chat-session'
import { compareTimelineEvents, type ChatTimelineEvent } from '@shared/timeline'
import type { ExecutionLog, Task } from '@shared/types'
import {
  isWorkspaceLifecycleSystemMessage,
  workspaceSessionEventRecordToTimelineEvent,
  type WorkspaceSessionEventRecord,
} from '@shared/workspace-session-history'
import type { ConversationMessageRecord } from './api'

export type { TaskChatDataParts, TaskChatMessage } from '@shared/task-chat'
export type { ChatTimelineEvent } from '@shared/timeline'

type TaskChatMessageWithCreatedAt = TaskChatMessage & {
  createdAt?: string
}

const isOrphanWorkspaceLifecycleSystemEvent = (event: WorkspaceSessionEventRecord) => (
  event.kind === 'system_message'
  && event.turnId.startsWith('system:')
  && isWorkspaceLifecycleSystemMessage(event.payload.message)
)

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.string(),
  result: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  workspaceId: z.string().optional(),
}).passthrough()

const attachmentSchema = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
}).passthrough()

const gitDiffFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
}).passthrough()

const gitChangeSummarySchema = z.object({
  fileCount: z.number(),
  additions: z.number(),
  deletions: z.number(),
  files: z.array(gitDiffFileSchema),
  patch: z.string().optional(),
}).passthrough()

const taskResultDeliverySchema = z.object({
  mode: z.enum(['summary', 'branch', 'commit']),
}).passthrough()

const workspaceExecutorSchema = z.object({
  executorId: z.string(),
  name: z.string().optional(),
  executorSource: z.enum(['customer-worker', 'managed-cloud']).optional(),
  managedBy: z.enum(['user', 'vibemux']).optional(),
  runtimeClass: z.enum(['user-worker', 'managed-worker']).optional(),
  status: z.enum(['pairing', 'paired', 'online', 'offline', 'disabled']).optional(),
}).passthrough()

const creatorIdentitySchema = z.object({
  type: z.enum(['user', 'agent']),
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
}).passthrough()

const timelineEventSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('user_message'),
    messageId: z.string(),
    text: z.string(),
    authorId: z.string().optional(),
    author: creatorIdentitySchema.optional(),
    attachments: z.array(attachmentSchema).optional(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('assistant_message'),
    messageId: z.string(),
    text: z.string(),
    authorName: z.string().optional(),
    executionModel: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('system_message'),
    message: z.string(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('delivery_result'),
    message: z.string(),
    remoteBranchName: z.string().optional(),
    commitShas: z.array(z.string()).optional(),
    delivery: taskResultDeliverySchema.optional(),
    changeSummary: gitChangeSummarySchema.optional(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('thinking'),
    partId: z.string(),
    messageId: z.string().optional(),
    text: z.string(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('tool_call'),
    toolCall: toolCallSchema,
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('interaction'),
    interaction: z.object({
      id: z.string(),
      type: z.enum(['question', 'approval', 'permission']),
      status: z.enum(['pending', 'answered', 'cancelled']),
      title: z.string(),
      prompt: z.string().optional(),
      provider: z.string().optional(),
      toolName: z.string().optional(),
    }).passthrough(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('status'),
    status: z.enum(['idle', 'thinking', 'executing', 'waiting', 'complete', 'error']),
    step: z.string(),
    workspaceExecutor: workspaceExecutorSchema.optional(),
  }),
  z.object({
    id: z.string(),
    ts: z.string(),
    turnId: z.string(),
    seq: z.number(),
    kind: z.literal('error'),
    message: z.string(),
  }),
])

const taskStreamSchema = z.object({
  id: z.string(),
  agentRunningStatus: z.enum(['idle', 'thinking', 'executing', 'waiting', 'complete', 'error']),
  currentStep: z.string(),
  toolCalls: z.array(toolCallSchema).optional(),
}).passthrough()

const taskChatSessionSnapshotSchema = z.object({
  protocol: z.object({
    version: z.literal(TASK_CHAT_PROTOCOL_VERSION),
    stream: z.literal(TASK_CHAT_STREAM_PROTOCOL),
    history: z.literal(TASK_CHAT_HISTORY_PROTOCOL),
    queue: z.literal(TASK_CHAT_QUEUE_PROTOCOL),
  }).passthrough(),
  scope: z.object({
    mode: z.enum(['task', 'workspace']),
    taskId: z.string(),
    workspaceId: z.string().optional(),
    sessionKey: z.string(),
  }).passthrough(),
  runtime: z.object({
    agentRunningStatus: z.enum(['idle', 'thinking', 'executing', 'waiting', 'complete', 'error']),
    currentStep: z.string(),
    needsHumanConfirm: z.boolean(),
    agentSessionId: z.string().optional(),
    opencodeSessionId: z.string().optional(),
    executorNodeId: z.string().optional(),
  }).passthrough(),
  conversation: z.object({
    conversationId: z.string().optional(),
    messageCount: z.number(),
    latestMessageAt: z.string().optional(),
  }).passthrough(),
  queue: z.object({
    sessionKey: z.string(),
    status: z.enum(['empty', 'queued']),
    items: z.array(z.object({
      id: z.string(),
      sessionKey: z.string(),
      taskId: z.string(),
      workspaceId: z.string().optional(),
      workspaceSessionId: z.string().optional(),
      message: z.string(),
      attachments: z.array(attachmentSchema).optional(),
      createdAt: z.string(),
      createdBy: z.string().optional(),
    }).passthrough()),
  }).passthrough(),
}).passthrough()

const taskSubagentObservationSchema = z.object({
  id: z.string(),
  ts: z.string(),
  kind: z.enum(['action', 'terminal', 'browser-console', 'network', 'screenshot']),
  level: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string(),
  detail: z.string().optional(),
  url: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export const taskChatDataPartSchemas: {
  [K in keyof TaskChatDataParts]: z.ZodType<TaskChatDataParts[K]>
} = {
  timeline_event: timelineEventSchema,
  task: taskStreamSchema as z.ZodType<TaskChatRuntimeUpdate>,
  session: taskChatSessionSnapshotSchema as z.ZodType<TaskChatSessionSnapshot>,
  notice: z.object({
    level: z.enum(['info', 'warning', 'error']),
    message: z.string(),
  }),
  observation: taskSubagentObservationSchema as z.ZodType<TaskSubagentObservation>,
}

const logToTextPart = (content: string) => [{ type: 'text' as const, text: content }]

const getLegacyMessageContent = (message: TaskChatMessage) => {
  const content = (message as TaskChatMessage & { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

const readExternalRefString = (
  externalRef: ConversationMessageRecord['externalRef'],
  key: string,
) => {
  if (!externalRef || typeof externalRef !== 'object') {
    return undefined
  }

  const value = externalRef[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const readExternalRefExecutionModel = (externalRef: ConversationMessageRecord['externalRef']) => {
  return readExternalRefString(externalRef, 'executionModel')
}

export const getMessageParts = (message: TaskChatMessage) => {
  if (Array.isArray(message.parts)) {
    return message.parts
  }

  const legacyContent = getLegacyMessageContent(message)
  return legacyContent ? logToTextPart(legacyContent) : []
}

export const normalizeAssistantLogForChat = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed.startsWith('[分布式结果]')) {
    return trimmed
  }

  const withoutPrefix = trimmed.replace(/^\[分布式结果\]\s*/, '')
  const withoutPresetSummary = withoutPrefix.replace(/^已执行项目预设命令：\n(?:- .*\n?)+\n*/u, '')
  return withoutPresetSummary
}

export const normalizeAssistantMessageForDisplay = (content: string, userMessage?: string) => {
  return normalizeAssistantReplyText(normalizeAssistantLogForChat(content), userMessage)
}

const matchExecutionLogScope = (log: ExecutionLog, workspaceId?: string, workspaceSessionId?: string) => {
  if (!workspaceId) {
    return !log.workspaceId
  }

  if (log.workspaceId !== workspaceId) {
    return false
  }

  if (!workspaceSessionId) {
    return !log.workspaceSessionId
  }

  return log.workspaceSessionId === workspaceSessionId
}

export const mapExecutionLogsToTaskChatMessages = (
  logs: ExecutionLog[],
  workspaceId?: string,
  workspaceSessionId?: string,
): TaskChatMessage[] => {
  return logs
    .filter((log) => matchExecutionLogScope(log, workspaceId, workspaceSessionId))
    .filter((log) => log.role === 'user' || log.role === 'agent')
    .map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      role: log.role === 'user' ? 'user' : 'assistant',
      parts: logToTextPart(log.role === 'agent' ? normalizeAssistantMessageForDisplay(log.content) : log.content),
    } as TaskChatMessageWithCreatedAt))
}

export const mapTaskToTaskChatMessages = (task: Task, workspaceId?: string, workspaceSessionId?: string): TaskChatMessage[] => {
  const messages = mapExecutionLogsToTaskChatMessages(task.logs, workspaceId, workspaceSessionId)
  const hasUserMessage = messages.some((message) => message.role === 'user')
  const fallbackDescription = task.description.trim()

  if (workspaceId || hasUserMessage || !fallbackDescription) {
    return messages
  }

  return [
    {
      id: `task-${task.id}-initial-user`,
      createdAt: task.createdAt,
      role: 'user',
      parts: logToTextPart(fallbackDescription),
    } as TaskChatMessageWithCreatedAt,
    ...messages,
  ]
}

const getTimelineEventFromConversationMessage = (message: ConversationMessageRecord): ChatTimelineEvent | null => {
  const externalRef = message.externalRef
  if (!externalRef || typeof externalRef !== 'object') {
    return null
  }

  if ('timelineEvent' in externalRef && externalRef.timelineEvent && typeof externalRef.timelineEvent === 'object') {
    const event = externalRef.timelineEvent as ChatTimelineEvent
    if (event.kind !== 'user_message' && event.kind !== 'assistant_message') {
      return event
    }

    const attachments = normalizeTaskChatAttachments((externalRef as { attachments?: unknown }).attachments)
    const agentName = event.kind === 'assistant_message' ? readExternalRefString(externalRef, 'agentName') : undefined
    const executionModel = event.kind === 'assistant_message'
      ? readExternalRefExecutionModel(externalRef)
      : undefined
    const nextEvent = attachments.length > 0 && !event.attachments?.length
      ? { ...event, attachments }
      : event

    if (nextEvent.kind !== 'assistant_message') {
      return nextEvent
    }

    return {
      ...nextEvent,
      authorName: nextEvent.authorName ?? agentName,
      executionModel: nextEvent.executionModel ?? executionModel,
    }
  }

  if ('observation' in externalRef && externalRef.observation && typeof externalRef.observation === 'object') {
    void (externalRef.observation as TaskSubagentObservation)
    return {
      id: `observation:${message.id}`,
      ts: message.createdAt,
      turnId: `observation:${message.id}`,
      seq: 1,
      kind: 'assistant_message',
      messageId: message.id,
      text: message.content,
    }
  }

  const legacyEvent = (externalRef as { taskChatEvent?: unknown }).taskChatEvent
  if (!legacyEvent || typeof legacyEvent !== 'object') {
    return null
  }

  const event = legacyEvent as {
    id?: string
    kind?: string
    order?: number
    status?: string
    currentStep?: string
    toolCall?: Task['toolCalls'][number]
    content?: string
  }

  const base = {
    id: event.id ?? message.id,
    ts: message.createdAt,
    turnId: `legacy:${message.conversationId}`,
    seq: event.order ?? 0,
  }

  if (event.kind === 'reasoning') {
    return { ...base, kind: 'thinking', partId: event.id ?? message.id, text: event.content ?? '' }
  }

  if (event.kind === 'tool' && event.toolCall) {
    return { ...base, kind: 'tool_call', toolCall: event.toolCall }
  }

  if (event.kind === 'status') {
    return {
      ...base,
      kind: 'status',
      status: (event.status as Task['agentRunningStatus']) ?? 'thinking',
      step: event.currentStep ?? '',
    }
  }

  return null
}

export const mapConversationMessagesToTaskChatMessages = (messages: ConversationMessageRecord[]): TaskChatMessage[] => {
  return messages.flatMap((message) => {
    const event = getTimelineEventFromConversationMessage(message)
    if (event?.kind === 'user_message' || event?.kind === 'assistant_message') {
      return [{
        id: event.messageId,
        createdAt: message.createdAt,
        role: event.kind === 'user_message' ? 'user' : 'assistant',
        parts: logToTextPart(event.text),
        ...(event.kind === 'assistant_message' && event.executionModel ? { executionModel: event.executionModel } : {}),
        attachments: event.attachments,
      } as TaskChatMessageWithCreatedAt]
    }

    if (event) {
      return []
    }

    if (message.role !== 'user' && message.role !== 'assistant') {
      return []
    }

    return [{
      id: message.id,
      createdAt: message.createdAt,
      role: message.role === 'user' ? 'user' : 'assistant',
      parts: logToTextPart(message.content),
      ...(message.role === 'assistant' && readExternalRefExecutionModel(message.externalRef)
        ? { executionModel: readExternalRefExecutionModel(message.externalRef) }
        : {}),
      attachments: normalizeTaskChatAttachments((message.externalRef as { attachments?: unknown } | undefined)?.attachments),
    } as TaskChatMessageWithCreatedAt]
  })
}

export const getMessageCreatedAt = (message: TaskChatMessage) => {
  return (message as TaskChatMessageWithCreatedAt).createdAt
}

export const getMessageText = (message: TaskChatMessage) => {
  return getMessageParts(message)
    .filter((part): part is Extract<TaskChatMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
}

export const mapConversationMessagesToTimelineEvents = (messages: ConversationMessageRecord[]): ChatTimelineEvent[] => {
  let currentTurnId = ''
  let fallbackSeq = 0

  const events: ChatTimelineEvent[] = []

  for (const message of messages) {
    const event = getTimelineEventFromConversationMessage(message)
    if (event) {
      if (event.kind === 'user_message') {
        currentTurnId = event.turnId
        fallbackSeq = event.seq
      }
      events.push(event)
      continue
    }

    if (message.role !== 'user' && message.role !== 'assistant') {
      continue
    }

    if (message.role === 'user') {
      currentTurnId = `legacy-turn:${message.id}`
      fallbackSeq = 1
      events.push({
        id: `legacy-user:${message.id}`,
        ts: message.createdAt,
        turnId: currentTurnId,
        seq: fallbackSeq,
        kind: 'user_message',
        messageId: message.id,
        text: message.content,
        authorId: message.senderId,
        attachments: normalizeTaskChatAttachments((message.externalRef as { attachments?: unknown } | undefined)?.attachments),
      })
      continue
    }

    const turnId = currentTurnId || `legacy-turn:${message.id}`
    fallbackSeq += 1
    events.push({
      id: `legacy-assistant:${message.id}`,
      ts: message.createdAt,
      turnId,
      seq: fallbackSeq,
      kind: 'assistant_message',
      messageId: message.id,
      text: message.content,
      authorName: readExternalRefString(message.externalRef, 'agentName'),
      executionModel: readExternalRefExecutionModel(message.externalRef),
    })
  }

  return events.sort(compareTimelineEvents)
}

export const mapWorkspaceSessionHistoryEventsToTimeline = (
  events: WorkspaceSessionEventRecord[],
): ChatTimelineEvent[] => {
  return events
    .filter((event) => !isOrphanWorkspaceLifecycleSystemEvent(event))
    .map((event) => workspaceSessionEventRecordToTimelineEvent(event))
    .filter((event): event is ChatTimelineEvent => Boolean(event))
    .sort(compareTimelineEvents)
}

export const enrichUserTimelineAuthorsFromConversationMessages = (
  timeline: ChatTimelineEvent[],
  messages: ConversationMessageRecord[],
) => {
  if (timeline.length === 0 || messages.length === 0) {
    return timeline
  }

  const messagesById = new Map(messages.map((message) => [message.id, message] as const))
  let changed = false
  const nextTimeline = timeline.map((event) => {
    if (event.kind !== 'user_message' || event.authorId) {
      return event
    }

    const sourceMessage = messagesById.get(event.messageId)
    if (!sourceMessage || sourceMessage.role !== 'user') {
      return event
    }

    const nextEvent = {
      ...event,
      authorId: event.authorId ?? sourceMessage.senderId,
    }
    changed = changed
      || nextEvent.authorId !== event.authorId
    return nextEvent
  })

  return changed ? nextTimeline : timeline
}

export const mapTaskToTimelineEvents = (task: Task, workspaceId?: string, workspaceSessionId?: string): ChatTimelineEvent[] => {
  let currentTurnId = ''
  const events: ChatTimelineEvent[] = []
  let seq = 0

  const scopedLogs = task.logs
    .filter((log) => matchExecutionLogScope(log, workspaceId, workspaceSessionId))
    .filter((log) => log.role === 'user' || log.role === 'agent')

  const hasUserLog = scopedLogs.some((log) => log.role === 'user')
  if (!workspaceId && !workspaceSessionId && !hasUserLog && task.description.trim()) {
    currentTurnId = `task-turn:initial:${task.id}`
    seq += 1
    events.push({
      id: `task-user:initial:${task.id}`,
      ts: task.createdAt,
      turnId: currentTurnId,
      seq,
      kind: 'user_message',
      messageId: `task-${task.id}-initial-user`,
      text: task.description.trim(),
    })
  }

  scopedLogs.forEach((log) => {
    const text = log.role === 'agent'
      ? normalizeAssistantMessageForDisplay(log.content)
      : log.content.trim()
    if (!text) {
      return
    }

    if (log.role === 'user') {
      currentTurnId = `task-turn:${log.id}`
      seq = 1
      events.push({
        id: `task-user:${log.id}`,
        ts: log.createdAt,
        turnId: currentTurnId,
        seq,
        kind: 'user_message',
        messageId: log.id,
        text,
      })
      return
    }

    const turnId = currentTurnId || `task-turn:${log.id}`
    seq += 1
    events.push({
      id: `task-assistant:${log.id}`,
      ts: log.createdAt,
      turnId,
      seq,
      kind: 'assistant_message',
      messageId: log.id,
      text,
    })
  })

  return events.sort(compareTimelineEvents)
}
