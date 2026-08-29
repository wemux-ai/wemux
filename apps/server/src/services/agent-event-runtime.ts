/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Product events, persisted agent inbox items, custom-agent chat runtime.
 * [OUTPUT]: Durable event delivery, bounded retries, audited AgentTaskRun observability, wait/resume matching, and background Agent turns.
 * [POS]: Generic Agent runtime loop; business modules publish events but never prescribe the next action.
 */
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { InboxReplyTarget } from '@shared/inbox'
import type { AppState, ChatMessage, MainChatSession, ModelTokenUsage, TaskAgentRetrySessionMode } from '@shared/types'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { getUserById } from '../repositories/auth'
import {
  cancelAgentTask,
  completeAgentTask,
  createAgentTask,
  failAgentTask,
  getAgent,
  getAllAgents,
  getAgentTask,
  getAgentTasks,
  getAgentTasksByStatus,
  startAgentTask,
  updatePendingAgentTaskPayload,
  waitAgentTask,
  agentHeartbeat,
  type AgentTask,
} from '../repositories/agent'
import { createMainChatSession, ensureMainChatState, runMainChatResponse } from '../routes/project-main-chat'
import { resolveNewCustomAgentChatSessionDefaults } from '../routes/project-main-chat-session'
import { loadState, saveStateMeta, saveTask } from '../storage/app-state-store'
import { createAgentTaskRun, getAgentTaskRun, updateAgentTaskRun } from '../storage/postgres/agent-task-run-store'
import { withPostgresLease } from '../storage/postgres/db'
import { resolveAgentOwnerUserId } from './agent-channel-session-service'
import { buildAgentAttentionContextCapsule } from './agent-attention-context'
import { buildBrainFileDigestContext, buildWorkspaceBrainContextSnapshot } from './workspace-brain-service'
import { bindMainChatExecutionAbortSignal, stopMainChatExecution } from './main-chat-runtime-state'
import {
  buildTaskQuickCreatePrompt,
  findQuickCreatedTask,
  readTaskQuickCreateRequest,
  resolveTaskQuickCreateOriginId,
  TASK_QUICK_CREATE_EVENT_TYPE,
} from './task-quick-create-service'
import {
  classifyAgentTaskRunFailure,
  createAgentTaskRunTranscriptCapture,
  summarizeAgentTaskRunTranscript,
} from './agent-task-run-service'
import { publishTaskAgentActivityChange, publishTaskAgentTranscriptChange } from './task-agent-activity-stream'
import { buildAgentEventInboxItem } from './agent-event-inbox'
import {
  archiveAgentTaskInboxItems,
  copyAgentTaskInboxLinks,
  linkAgentTaskInboxItem,
  markAgentTaskInboxItemsRead,
  type AgentTaskInboxRelation,
} from './agent-inbox-service'
import { archiveInboxItem, markInboxItemRead, publishInboxItem } from './inbox-service'
import { recordUsageEvent } from './usage-event-service'

export type AgentEventActor = {
  type: 'user' | 'agent' | 'system'
  id?: string
}

export type AgentEventInput = {
  type: string
  targetAgentId?: string
  actingUserId?: string
  actor: AgentEventActor
  scope?: Record<string, string>
  payload?: Record<string, unknown>
  conversationKey?: string
  idempotencyKey?: string
  sourceAgentEventId?: string
  sourceInboxItemId?: string
  traceId?: string
  chainStartedAt?: string
  hopCount?: number
  replyTo?: InboxReplyTarget
}

export type AgentWaitCondition = {
  eventTypes: string[]
  match?: Record<string, string>
}

export const AGENT_HEARTBEAT_EVENT_TYPE = 'agent.heartbeat.tick'

type PersistedAgentEvent = {
  kind: 'agent_event'
  actingUserId?: string
  actor: AgentEventActor
  scope: Record<string, string>
  payload: Record<string, unknown>
  conversationKey: string
  resumesEventId?: string
  idempotencyKey?: string
  mergedIdempotencyKeys?: string[]
  attempt: number
  retrySource: 'initial' | 'manual' | 'infrastructure'
  retrySessionMode?: TaskAgentRetrySessionMode
  autoRetryCount: number
  availableAt?: string
}

export type AgentEventDispatch = {
  task: AgentTask
  status: 'queued' | 'coalesced' | 'deduplicated'
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)

const readPositiveInteger = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
)

const readNonNegativeInteger = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
)

const readEvent = (task: AgentTask): PersistedAgentEvent | null => {
  const payload = asRecord(task.payload)
  if (payload.kind !== 'agent_event') return null
  return {
    kind: 'agent_event',
    actingUserId: typeof payload.actingUserId === 'string' ? payload.actingUserId : undefined,
    actor: asRecord(payload.actor) as AgentEventActor,
    scope: asRecord(payload.scope) as Record<string, string>,
    payload: asRecord(payload.payload),
    conversationKey: typeof payload.conversationKey === 'string' ? payload.conversationKey : `event:${task.id}`,
    resumesEventId: typeof payload.resumesEventId === 'string' ? payload.resumesEventId : undefined,
    idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : undefined,
    mergedIdempotencyKeys: Array.isArray(payload.mergedIdempotencyKeys)
      ? payload.mergedIdempotencyKeys.filter((item): item is string => typeof item === 'string')
      : [],
    attempt: readPositiveInteger(payload.attempt, 1),
    retrySource: payload.retrySource === 'manual' || payload.retrySource === 'infrastructure'
      ? payload.retrySource
      : 'initial',
    retrySessionMode: payload.retrySessionMode === 'resume' || payload.retrySessionMode === 'fresh'
      ? payload.retrySessionMode
      : undefined,
    autoRetryCount: readNonNegativeInteger(payload.autoRetryCount, 0),
    availableAt: typeof payload.availableAt === 'string' ? payload.availableAt : undefined,
  }
}

const readFollowUpComments = (event: Pick<PersistedAgentEvent, 'payload'>) => (
  Array.isArray(event.payload.followUpComments)
    ? event.payload.followUpComments.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
)

export const collectAgentEventCommentIds = (event: Pick<PersistedAgentEvent, 'scope' | 'payload'>) => Array.from(new Set([
  event.scope.commentId,
  ...readFollowUpComments(event).map((comment) => typeof comment.commentId === 'string' ? comment.commentId : undefined),
].filter((commentId): commentId is string => Boolean(commentId))))

const resolveAgentEventActorName = (actor: AgentEventActor) => {
  if (actor.type === 'system') return '系统'
  if (!actor.id) return undefined
  if (actor.type === 'user') return getUserById(actor.id)?.name ?? actor.id
  return getAgent(actor.id)?.name ?? actor.id
}

const ensureAgentEventTaskRun = (task: AgentTask, event = readEvent(task)) => {
  if (!event) return null
  return createAgentTaskRun({
    agentTaskId: task.id,
    eventId: task.id,
    agentId: task.agentId,
    taskId: event.scope.taskId,
    projectId: event.scope.projectId,
    attempt: event.attempt,
    retrySource: event.retrySource,
    retrySessionMode: event.retrySessionMode,
    status: task.status,
    startedAt: task.startedAt ?? undefined,
    completedAt: task.completedAt ?? undefined,
    createdAt: task.createdAt,
  })
}

const POISONED_AGENT_EVENT_FAILURE_PATTERNS = [
  /\bcontext(?:[_ ](?:length|window))?(?:[_ ](?:exceeded|overflow|limit))/i,
  /\bmaximum context\b/i,
  /\bprompt is too long\b/i,
  /\btoo many tokens\b/i,
  /\biteration[_ ]limit\b/i,
  /\bmax(?:imum)? iterations?\b/i,
  /\binvalid[_ ]request(?:[_ ]error)?\b/i,
  /\brequest too large\b/i,
  /\bcodex[_ ]semantic[_ ]inactivity\b/i,
  /\bagent[_ ]fallback(?:[_ ]message)?\b/i,
  /上下文.{0,12}(?:超限|溢出|过长|太长)/,
  /迭代.{0,8}(?:上限|超限|次数过多)/,
] as const

export const isPoisonedAgentEventFailure = (error: unknown) => (
  typeof error === 'string'
  && POISONED_AGENT_EVENT_FAILURE_PATTERNS.some((pattern) => pattern.test(error))
)

export const resolveAgentEventRetrySessionMode = (
  task: Pick<AgentTask, 'result'>,
  requestedMode: TaskAgentRetrySessionMode = 'resume',
): TaskAgentRetrySessionMode => (
  isPoisonedAgentEventFailure(task.result?.error) ? 'fresh' : requestedMode
)

const publishAgentTaskActivityChange = (task: AgentTask) => {
  const taskId = readEvent(task)?.scope.taskId
  if (taskId) publishTaskAgentActivityChange(taskId)
}

export const buildCoalescedAgentEventPayload = (
  task: AgentTask,
  event: AgentEventInput,
  idempotencyKey?: string,
) => {
  const persisted = readEvent(task)
  if (!persisted) return task.payload

  return {
    ...task.payload,
    payload: {
      ...persisted.payload,
      followUpComments: [
        ...readFollowUpComments(persisted),
        {
          actor: event.actor,
          commentId: event.scope?.commentId,
          parentCommentId: event.payload?.parentCommentId,
          comment: event.payload?.comment,
          triggerKind: event.payload?.triggerKind,
        },
      ],
    },
    mergedIdempotencyKeys: idempotencyKey
      ? [...(persisted.mergedIdempotencyKeys ?? []), idempotencyKey]
      : persisted.mergedIdempotencyKeys ?? [],
  }
}

// ponytail: project from the in-memory AgentTask cache; add an indexed task_id
// column only when activity volume makes this scan measurable.
export const listTaskAgentActivities = (taskId: string) => {
  const mainChatSessions = loadState().mainChatSessions
  return getAllAgents()
    .flatMap((agent) => getAgentTasks(agent.id, Number.MAX_SAFE_INTEGER).flatMap((task) => {
      const event = readEvent(task)
      if (event?.scope.taskId !== taskId) return []
      const profile = readCustomAgentConfig(agent.config)
      const triggerKind = typeof event.payload.triggerKind === 'string'
        ? event.payload.triggerKind
        : task.type === 'task.assigned'
          ? 'assignment'
          : task.type === 'task.status.changed'
            ? 'status'
            : task.type === 'workspace.session.completed'
              ? 'workspace_completed'
              : task.type === 'workspace.session.waiting'
                ? 'workspace_waiting'
                : task.type === 'workspace.session.failed'
                  ? 'workspace_failed'
            : 'event'

      const run = getAgentTaskRun(task.id)
      const includedCommentIds = collectAgentEventCommentIds(event)
      const resultSessionId = typeof task.result?.sessionId === 'string' ? task.result.sessionId : undefined
      const conversationSessionId = resultSessionId ?? run?.conversationSessionId ?? mainChatSessions.find((session) => (
        session.customAgentId === agent.id
        && session.externalConversationId === `agent-runtime:${event.conversationKey}`
      ))?.id

      return [{
        id: task.id,
        agentId: agent.id,
        agentName: agent.name,
        agentAvatarUrl: profile.avatarUrl || undefined,
        eventType: task.type,
        triggerKind,
        triggerActorType: event.actor.type,
        triggerActorId: event.actor.id,
        triggerActorName: resolveAgentEventActorName(event.actor),
        actingUserId: event.actingUserId,
        actingUserName: event.actingUserId ? getUserById(event.actingUserId)?.name ?? event.actingUserId : undefined,
        includedCommentIds,
        commentId: event.scope.commentId,
        comment: typeof event.payload.comment === 'string' ? event.payload.comment : undefined,
        coalescedCommentCount: readFollowUpComments(event).length,
        conversationSessionId,
        retryOfEventId: typeof task.payload.retryOfEventId === 'string' ? task.payload.retryOfEventId : undefined,
        attempt: event.attempt,
        retrySource: event.retrySource,
        retrySessionMode: event.retrySessionMode,
        recommendedRetrySessionMode: task.status === 'failed' || task.status === 'canceled'
          ? resolveAgentEventRetrySessionMode(task)
          : undefined,
        retryScheduledAt: event.availableAt,
        runId: run?.id,
        transcriptAvailable: Boolean(run?.transcript.length || conversationSessionId),
        summaryPreview: summarizeAgentTaskRunTranscript(run?.transcript ?? []),
        failureCode: run?.failureCode,
        failureMessage: run?.failureMessage,
        lastHeartbeatAt: run?.lastHeartbeatAt,
        updatedAt: run?.updatedAt ?? task.completedAt ?? task.startedAt ?? task.createdAt,
        usage: run?.usage,
        status: task.status,
        result: task.result,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
      }]
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

const isAgentRuntimeEventPrompt = (message: ChatMessage) => (
  message.role === 'user' && message.content.trimStart().startsWith('[Agent Runtime Event]')
)

export const selectAgentEventTranscriptMessages = (messages: ChatMessage[], eventId: string) => {
  const eventIdLine = `eventId: ${eventId}`
  const start = messages.findIndex((message) => (
    isAgentRuntimeEventPrompt(message)
    && message.content.split('\n').some((line) => line.trim() === eventIdLine)
  ))
  if (start < 0) return []

  const nextEventOffset = messages.slice(start + 1).findIndex(isAgentRuntimeEventPrompt)
  const end = nextEventOffset < 0 ? messages.length : start + 1 + nextEventOffset
  return messages.slice(start, end)
}

export const isActiveAgentEventTask = (task: AgentTask) => (
  task.status === 'pending' || task.status === 'running' || task.status === 'waiting'
)

export const listActiveAgentEventTaskIds = (projectId: string) => Array.from(new Set(
  getAllAgents().flatMap((agent) => getAgentTasks(agent.id, Number.MAX_SAFE_INTEGER).flatMap((task) => {
    const event = readEvent(task)
    return isActiveAgentEventTask(task) && event?.scope.projectId === projectId && event.scope.taskId
      ? [event.scope.taskId]
      : []
  })),
))

const readWaitCondition = (task: AgentTask): AgentWaitCondition | null => {
  const waitFor = asRecord(asRecord(task.result).waitFor)
  const eventTypes = Array.isArray(waitFor.eventTypes)
    ? waitFor.eventTypes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
  if (eventTypes.length === 0) return null
  const match = Object.fromEntries(
    Object.entries(asRecord(waitFor.match)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return { eventTypes, match }
}

export const findPendingAgentCommentTask = (
  tasks: AgentTask[],
  taskId: string,
  conversationKey: string,
) => tasks.find((task) => {
  const persisted = readEvent(task)
  return task.status === 'pending'
    && persisted?.scope.taskId === taskId
    && persisted.conversationKey === conversationKey
})

export const matchesAgentWaitCondition = (condition: AgentWaitCondition, event: AgentEventInput) => {
  if (!condition.eventTypes.includes(event.type)) return false
  const values = { ...event.scope, ...event.payload }
  return Object.entries(condition.match ?? {}).every(([key, expected]) => values[key] === expected)
}

export const canAgentReceiveEvent = (agentId: string, event: AgentEventInput) => (
  !event.targetAgentId || event.targetAgentId === agentId
)

const persistAgentEventInbox = (params: {
  agentId: string
  agentTaskId: string
  event: AgentEventInput
  relation: AgentTaskInboxRelation
  itemId?: string
}) => {
  const actorName = resolveAgentEventActorName(params.event.actor)
  const input = buildAgentEventInboxItem({
    agentId: params.agentId,
    actorName,
    event: params.event,
    itemId: params.itemId,
  })
  void publishInboxItem(input)
    .then(({ item }) => linkAgentTaskInboxItem(params.agentTaskId, item.id, params.relation))
    .catch((error) => console.error('[agent-event-runtime] persist inbox item failed', error))
  return input.itemId
}

const enqueue = (agentId: string, event: AgentEventInput, resumesEventId?: string): AgentEventDispatch => {
  const idempotencyKey = event.idempotencyKey?.trim()
  if (idempotencyKey) {
    const existing = getAgentTasks(agentId, Number.MAX_SAFE_INTEGER)
      .find((task) => {
        const persisted = readEvent(task)
        return persisted?.idempotencyKey === idempotencyKey
          || persisted?.mergedIdempotencyKeys?.includes(idempotencyKey)
      })
    if (existing) return { task: existing, status: 'deduplicated' }
  }

  const conversationKey = event.conversationKey?.trim() || `agent:${agentId}`
  const taskId = event.scope?.taskId
  if (taskId && event.type.startsWith('task.comment.')) {
    const existing = findPendingAgentCommentTask(
      getAgentTasks(agentId, Number.MAX_SAFE_INTEGER),
      taskId,
      conversationKey,
    )
    const persisted = existing ? readEvent(existing) : null
    if (existing && persisted) {
      const updated = updatePendingAgentTaskPayload(
        existing.id,
        buildCoalescedAgentEventPayload(existing, event, idempotencyKey),
      )
      if (updated) {
        persistAgentEventInbox({
          agentId,
          agentTaskId: updated.id,
          event,
          relation: 'coalesced',
        })
        publishAgentTaskActivityChange(updated)
        return { task: updated, status: 'coalesced' }
      }
    }
  }

  const itemId = crypto.randomUUID()
  const task = createAgentTask(agentId, event.type, {
    kind: 'agent_event',
    inboxItemId: itemId,
    traceId: event.traceId ?? itemId,
    chainStartedAt: event.chainStartedAt ?? new Date().toISOString(),
    sourceInboxItemId: event.sourceInboxItemId,
    hopCount: event.hopCount ?? 0,
    replyTo: event.replyTo,
    actingUserId: event.actingUserId,
    actor: event.actor,
    scope: event.scope ?? {},
    payload: event.payload ?? {},
    conversationKey,
    resumesEventId,
    idempotencyKey,
    attempt: 1,
    retrySource: 'initial',
    autoRetryCount: 0,
  })
  ensureAgentEventTaskRun(task)
  persistAgentEventInbox({
    agentId,
    agentTaskId: task.id,
    event,
    relation: resumesEventId ? 'resume' : 'primary',
    itemId,
  })
  if (resumesEventId) copyAgentTaskInboxLinks(resumesEventId, task.id, 'resume')
  updatePendingAgentTaskPayload(task.id, {
    ...task.payload,
    inboxItemId: itemId,
  })
  publishAgentTaskActivityChange(task)
  return { task, status: 'queued' }
}

export const publishAgentEventWithOutcome = (event: AgentEventInput) => {
  const resumedAgentIds = new Set<string>()
  const dispatches: AgentEventDispatch[] = []

  for (const waitingTask of getAgentTasksByStatus('waiting')) {
    if (event.actor.type === 'agent' && event.actor.id === waitingTask.agentId) continue
    if (!canAgentReceiveEvent(waitingTask.agentId, event)) continue
    const condition = readWaitCondition(waitingTask)
    if (!condition || !matchesAgentWaitCondition(condition, event)) continue

    const previousEvent = readEvent(waitingTask)
    completeAgentTask(waitingTask.id, {
      ...asRecord(waitingTask.result),
      resumedBy: event.type,
    })
    const completedWaitingTask = getAgentTask(waitingTask.id)
    updateAgentTaskRun(waitingTask.id, {
      status: 'completed',
      completedAt: completedWaitingTask?.completedAt ?? new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    })
    publishAgentTaskActivityChange(waitingTask)
    if (!resumedAgentIds.has(waitingTask.agentId)) {
      const resumedTask = enqueue(waitingTask.agentId, {
        ...event,
        actingUserId: event.actingUserId || previousEvent?.actingUserId,
        conversationKey: previousEvent?.conversationKey || event.conversationKey,
      }, waitingTask.id)
      dispatches.push(resumedTask)
      resumedAgentIds.add(waitingTask.agentId)
    }
  }

  if (event.targetAgentId && !resumedAgentIds.has(event.targetAgentId)) {
    const queuedTask = enqueue(event.targetAgentId, event, event.sourceAgentEventId)
    dispatches.push(queuedTask)
  }

  return dispatches
}

export const publishAgentEvent = (event: AgentEventInput) => publishAgentEventWithOutcome(event)
  .filter((dispatch) => dispatch.status === 'queued')
  .map((dispatch) => dispatch.task)

export const canCancelAgentEvent = (task: AgentTask) => (
  task.status === 'pending' || task.status === 'running' || task.status === 'waiting'
)

export const canRetryAgentEvent = (task: AgentTask) => task.status === 'failed' || task.status === 'canceled'

export const cancelAgentEvent = (eventId: string) => {
  const task = getAgentTask(eventId)
  const event = task ? readEvent(task) : null
  if (!task || !event || !canCancelAgentEvent(task)) return false
  if (task.status !== 'running') {
    const canceled = cancelAgentTask(task.id)
    if (canceled) {
      const canceledTask = getAgentTask(task.id)
      updateAgentTaskRun(task.id, {
        status: 'canceled',
        failureCode: 'canceled',
        failureMessage: '已由用户取消。',
        completedAt: canceledTask?.completedAt ?? new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      })
      publishAgentTaskActivityChange(task)
    }
    return canceled
  }

  const agent = getAgent(task.agentId)
  const runtimeUserId = event.actingUserId?.trim() || (agent ? resolveAgentOwnerUserId(agent) : '')
  const sessionId = typeof task.result?.sessionId === 'string'
    ? task.result.sessionId
    : loadState().mainChatSessions.find((session) => (
        session.customAgentId === task.agentId
        && session.externalConversationId === `agent-runtime:${event.conversationKey}`
      ))?.id
  if (!runtimeUserId || !sessionId || !stopMainChatExecution({ userId: runtimeUserId, sessionId })) return false
  const canceled = cancelAgentTask(task.id, { sessionId })
  if (canceled) {
    const canceledTask = getAgentTask(task.id)
    updateAgentTaskRun(task.id, {
      status: 'canceled',
      failureCode: 'canceled',
      failureMessage: '已由用户取消。',
      conversationSessionId: sessionId,
      completedAt: canceledTask?.completedAt ?? new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    })
    publishAgentTaskActivityChange(task)
  }
  return canceled
}

export const buildRetriedAgentEventPayload = (
  task: AgentTask,
  actingUserId?: string,
  options: {
    source?: 'manual' | 'infrastructure'
    availableAt?: string
    sessionMode?: TaskAgentRetrySessionMode
  } = {},
) => {
  const {
    idempotencyKey: _idempotencyKey,
    mergedIdempotencyKeys: _mergedIdempotencyKeys,
    retryOfEventId: _retryOfEventId,
    attempt: _attempt,
    retrySource: _retrySource,
    retrySessionMode: _retrySessionMode,
    autoRetryCount: _autoRetryCount,
    availableAt: _availableAt,
    ...payload
  } = task.payload
  const event = readEvent(task)
  const source = options.source ?? 'manual'
  const retrySessionMode = resolveAgentEventRetrySessionMode(task, options.sessionMode)
  return {
    ...payload,
    ...(task.type === TASK_QUICK_CREATE_EVENT_TYPE
      ? {
          quickCreateOriginId: typeof task.payload.quickCreateOriginId === 'string'
            ? task.payload.quickCreateOriginId
            : task.id,
        }
      : {}),
    ...(actingUserId ? { actingUserId } : {}),
    retryOfEventId: task.id,
    attempt: (event?.attempt ?? 1) + 1,
    retrySource: source,
    retrySessionMode,
    autoRetryCount: source === 'infrastructure' ? (event?.autoRetryCount ?? 0) + 1 : 0,
    ...(options.availableAt ? { availableAt: options.availableAt } : {}),
  }
}

const AGENT_EVENT_AUTO_RETRY_DELAYS_MS = [5_000, 15_000] as const

export const buildAutomaticAgentEventRetryPayload = (task: AgentTask, now = Date.now()) => {
  const event = readEvent(task)
  const delayMs = AGENT_EVENT_AUTO_RETRY_DELAYS_MS[event?.autoRetryCount ?? 0]
  if (delayMs === undefined) return null
  return buildRetriedAgentEventPayload(task, undefined, {
    source: 'infrastructure',
    availableAt: new Date(now + delayMs).toISOString(),
  })
}

export const retryAgentEvent = (
  eventId: string,
  actingUserId?: string,
  sessionMode: TaskAgentRetrySessionMode = 'resume',
) => {
  const task = getAgentTask(eventId)
  if (!task || !readEvent(task) || !canRetryAgentEvent(task)) return null
  const retried = createAgentTask(task.agentId, task.type, buildRetriedAgentEventPayload(task, actingUserId, { sessionMode }))
  ensureAgentEventTaskRun(retried)
  copyAgentTaskInboxLinks(task.id, retried.id, 'retry')
  publishAgentTaskActivityChange(retried)
  return retried
}

export const setAgentEventWait = (params: {
  eventId: string
  agentId: string
  condition: AgentWaitCondition
}) => {
  const task = getAgentTask(params.eventId)
  if (!task || task.agentId !== params.agentId || !readEvent(task)) {
    return false
  }
  waitAgentTask(task.id, { waitFor: params.condition })
  updateAgentTaskRun(task.id, {
    status: 'waiting',
    lastHeartbeatAt: new Date().toISOString(),
  })
  publishAgentTaskActivityChange(task)
  return true
}

const pickExecutorId = (userId: string, agentDefaultExecutorId?: string) => {
  const visible = listVisibleExecutorsForUser(userId)
  const preferred = agentDefaultExecutorId?.trim()
  return visible.find((item) => item.executorId === preferred && item.status === 'online')?.executorId
    ?? visible.find((item) => item.status === 'online')?.executorId
}

export const resolveAgentDispatchReadiness = (agentId: string, actingUserId?: string) => {
  const agent = getAgent(agentId)
  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return { ok: false as const, message: '目标自定义 Agent 不存在。' }
  }

  const profile = readCustomAgentConfig(agent.config)
  if (!profile.enabled || profile.archived) {
    return { ok: false as const, message: '目标 Agent 当前不可用。' }
  }

  const userId = actingUserId?.trim() || resolveAgentOwnerUserId(agent)
  if (!userId) {
    return { ok: false as const, message: '目标 Agent 没有可用的 acting user。' }
  }

  const executorId = pickExecutorId(userId, profile.defaultExecutorId)
  if (!executorId) {
    return {
      ok: false as const,
      message: '当前 Agent 所属用户没有在线执行节点。',
      retryableInfrastructure: true as const,
    }
  }

  return { ok: true as const, agent, profile, userId, executorId }
}

const ensureRuntimeSession = (params: {
  state: AppState
  agentId: string
  userId: string
  conversationKey: string
  title: string
  defaultExecutorId?: string
  forceFresh?: boolean
}) => {
  const normalizedState = ensureMainChatState(params.state, params.userId)
  const externalConversationId = `agent-runtime:${params.conversationKey}`
  const existing = params.forceFresh
    ? undefined
    : normalizedState.mainChatSessions.find((session) => (
        session.customAgentId === params.agentId && session.externalConversationId === externalConversationId
      ))
  if (existing) {
    const executorId = pickExecutorId(params.userId, existing.executorId || params.defaultExecutorId)
    if (!executorId || existing.executorId === executorId) {
      return { state: normalizedState, session: existing }
    }
    const session = { ...existing, executorId }
    return {
      state: {
        ...normalizedState,
        mainChatSessions: normalizedState.mainChatSessions.map((item) => (item.id === session.id ? session : item)),
      },
      session,
    }
  }

  const defaults = resolveNewCustomAgentChatSessionDefaults({
    sessions: normalizedState.mainChatSessions,
    selectedSessionId: normalizedState.selectedMainChatSessionId,
    customAgentId: params.agentId,
  })
  const session: MainChatSession = createMainChatSession(params.title, {
    customAgentId: params.agentId,
    executorId: defaults.executorId || pickExecutorId(params.userId, params.defaultExecutorId),
    executionModel: defaults.executionModel,
    externalConversationId,
  })
  return {
    state: { ...normalizedState, mainChatSessions: [session, ...normalizedState.mainChatSessions] },
    session,
  }
}

export const buildAgentEventPrompt = (task: AgentTask, event: PersistedAgentEvent) => {
  const quickCreateRequest = readTaskQuickCreateRequest(task)
  if (quickCreateRequest) {
    const authorizedProjects = Array.isArray(event.payload.authorizedProjects)
      ? event.payload.authorizedProjects.flatMap((value) => {
          const project = asRecord(value)
          const id = typeof project.id === 'string' ? project.id.trim() : ''
          const name = typeof project.name === 'string' ? project.name.trim() : ''
          return id && name ? [{ id, name }] : []
        })
      : []
    return buildTaskQuickCreatePrompt({
      eventId: task.id,
      agentId: task.agentId,
      request: quickCreateRequest,
      authorizedProjects,
    })
  }

  const handoffPrompt = typeof event.payload.handoffPrompt === 'string'
    ? event.payload.handoffPrompt.trim()
    : ''
  const agentGroupId = typeof event.payload.assigneeAgentGroupId === 'string'
    ? event.payload.assigneeAgentGroupId.trim()
    : ''
  const agentGroupTitle = typeof event.payload.assigneeAgentGroupTitle === 'string'
    ? event.payload.assigneeAgentGroupTitle.trim()
    : ''
  const contextCapsule = buildAgentAttentionContextCapsule({
    agentId: task.agentId,
    eventId: task.id,
    eventType: task.type,
    event,
  })
  // v3.6 工作区公共上下文：任何带 workspace 范围的事件，注入工作区上下文快照（所有 Agent 共享）
  const workspaceContextId = typeof event.scope.workspaceId === 'string' && event.scope.workspaceId.trim()
    ? event.scope.workspaceId.trim()
    : ''
  const workspaceContextSnapshot = workspaceContextId
    ? buildWorkspaceBrainContextSnapshot(workspaceContextId)
    : ''
  const isWorkspaceAttention = task.type === 'workspace.session.completed'
    || task.type === 'workspace.session.waiting'
    || task.type === 'workspace.session.failed'
  const isHeartbeatTick = task.type === AGENT_HEARTBEAT_EVENT_TYPE
  const isBrainReview = task.type === 'brain.event.review'

  return [
    '[Agent Runtime Event]',
    `agentId: ${task.agentId}`,
    `eventId: ${task.id}`,
    `eventType: ${task.type}`,
    `actor: ${event.actor.type}:${event.actor.id || 'unknown'}`,
    `scope: ${JSON.stringify(event.scope)}`,
    `payload: ${JSON.stringify(event.payload)}`,
    event.resumesEventId ? `resumesEventId: ${event.resumesEventId}` : '',
    '[Context Capsule]',
    JSON.stringify(contextCapsule),
    '',
    workspaceContextSnapshot
      ? `[Workspace Context]\n${workspaceContextSnapshot}`
      : '',
    handoffPrompt ? '[Assignment Handoff]' : '',
    handoffPrompt
      ? '以下内容是指派人对本次运行的范围指令。优先遵循它，不要把它当作需要回复的任务评论：'
      : '',
    handoffPrompt ? handoffPrompt : '',
    agentGroupId
      ? `你是 Squad「${agentGroupTitle || agentGroupId}」的明确负责人，本轮由你接单并协调交付；不要根据成员顺序推断或改派负责人。`
      : '',
    '你被一个产品事件唤醒。请基于目标和现有上下文自行判断下一步，可调用 Wemux 工具完成操作。',
    '需要等待外部结果时，把 agent.wait 作为本轮最后一个工具调用。已经可交付时，使用对应产品工具写回结果，然后结束本轮。',
    event.scope.taskId
      ? `这是刚收到的任务 ${event.scope.taskId}。优先处理本次新任务事件；先用 task.get 读取完整上下文，并在开始推进时用 task.update_status 标记为 in_progress。`
      : '',
    event.scope.projectId
      ? [
          `这是项目 ${event.scope.projectId} 下的任务，优先遵循工作区原则。`,
          `只要涉及仓库、代码、文档、配置、Git、测试或产物，先用 workspace.list（Pi 实际工具名 vibemux__workspace_list）按 projectId 查找工作区。用户明确指定工作区时遵循用户；否则只复用 createdBy.type=agent 且 createdBy.id=${task.agentId} 的工作区，优先选择已绑定当前任务的自建工作区。`,
          '当前已经是 Task 事件，不要再创建影子 Task。没有当前 Agent 自己创建的可用工作区时，用 workspace.create（vibemux__workspace_create）新建。',
          '只有用户在当前消息中明确要求直接创建工作区时，普通对话才允许跳过 Task 创建；Agent 自己认为方便不算用户指定。',
          '需要实际编辑或执行时，优先使用 task.execute（vibemux__task_execute）指向该项目工作区，让 Coding Agent 在工作区的 canonical cwd 中完成；不要在项目原目录或 ~/.wemux* / ~/.vibemux* 历史工作区目录中扫描、修改或执行。派发失败时优先重试或如实说明原因，不要静默换个位置执行后当作已交付。',
          '只有纯评论、状态查询、等待外部事件，或没有项目/仓库的任务，才可以不创建工作区。',
        ].join('\n')
      : '',
    isWorkspaceAttention
      ? [
          '这是一次工作区执行 Attention。Context Capsule 是领取时的服务端快照，不是完整执行记录。',
          '先用 task.execution.get、workspace.session.runtime、workspace.session.get 和 conversation.get_task_conversation 读取当前权威状态、实际 Transcript、修改和测试结果；不要只依据任务顶层状态或旧对话记忆。',
          '确认真实结果后，自主决定继续执行、在任务评论中询问人类、回复任务或结束。一次 Attention 只产生一次最终回复或交付动作。',
        ].join('\n')
      : '',
    isHeartbeatTick
      ? [
          '这是一次定时心跳唤醒（agent.heartbeat.tick）。',
          '先用 agent.inbox.list 检查收件箱，按需查看渠道消息与任务进度。',
          '只处理已指派/已提及/已到达你收件箱的事项；不要主动寻找未被分配的工作。',
          '有需要处理的事项就按既有上下文处理；没有时简短汇报当前状态即可（保持低成本）。',
          '如配置了记忆维护约定（vibemux-memory），可按需更新记忆文件。',
          '不要为心跳创建影子任务，不要重复处理已在进行的任务；本轮没有外部等待时直接结束。',
        ].join('\n')
      : '',
    isBrainReview
      ? [
          '你是该工作区的协作协调 Agent。本轮是工作区事件监督 Review，请审查事件上下文、Workspace Context 与 eventHistorySnapshot。',
          '识别本次事件的意图：是需要执行的工作、需要回复的问询、还是可以归档的噪音。',
          '典型协作闭环（背后无声地主动协作）：',
          '- 群里发现 bug / 需要落地的工作 → 用 task.create 建任务（用户明确要求落地时），task.assign 派给最相关的工作区 Agent（CTO/执行者按职责匹配），等待结果；',
          '- 需要直接回复/汇报 → 用 workspace.group_chat.send 把结论插回工作区群聊，或用 task.comment.add 回复；',
          '- 简单问询、引导、摘要 → 直接用低成本方式处理，不要为小事唤醒大模型执行。',
          '处理原则：',
          '- 派发目标 Agent 必须属于该工作区（绝不外派）；派发用 agent.event.emit / agent.delegate 或 task.assign。',
          '- 有负责人或已被认领的事件 → 不碰，不覆盖人工指派，直接结束；',
          '- 没有合适处理方式 → 不强行动作，说明原因后结束。',
          '不要创建影子任务；不要代替执行 Agent 调用 task.execute。',
          '本轮结束前用一句话给出结论：审查了什么、做了什么决定。',
        ].join('\n')
      : '',
    isBrainReview && typeof event.payload.brainInstructions === 'string' && event.payload.brainInstructions.trim()
      ? `[Workspace Brain Instructions]\n${event.payload.brainInstructions.trim()}`
      : '',
    event.scope.taskId
      ? `本轮未调用 agent.wait 时，必须用 task.delivery.report 写入 Agent 评论并更新任务状态：等待人工或无法继续用 blocked，可交付等待验收用 in_review，只有验收条件已满足时才用 done。`
      : '',
  ].filter(Boolean).join('\n')
}

const normalizeRuntimeToolName = (name: string) => name
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '.')
  .replace(/^\.+|\.+$/g, '')

export const hasTaskDeliveryReport = (toolCalls?: Array<{ name: string }>) => (
  toolCalls?.some((toolCall) => {
    const normalizedName = normalizeRuntimeToolName(toolCall.name)
    return normalizedName === 'task.delivery.report' || normalizedName.endsWith('.task.delivery.report')
  }) ?? false
)

export const resolveAgentEventReplyParentCommentId = (
  event: Pick<PersistedAgentEvent, 'scope' | 'payload'>,
) => {
  const parentCommentId = typeof event.payload.parentCommentId === 'string'
    ? event.payload.parentCommentId.trim()
    : ''
  return parentCommentId || event.scope.commentId?.trim() || undefined
}

export const findRunningAgentEventContext = (agentId: string, taskId: string) => {
  const task = getAgentTasks(agentId, Number.MAX_SAFE_INTEGER)
    .find((candidate) => candidate.status === 'running' && readEvent(candidate)?.scope.taskId === taskId)
  const event = task ? readEvent(task) : null
  return task && event
    ? {
        eventId: task.id,
        inboxItemId: typeof task.payload.inboxItemId === 'string' ? task.payload.inboxItemId : undefined,
        traceId: typeof task.payload.traceId === 'string' ? task.payload.traceId : undefined,
        chainStartedAt: typeof task.payload.chainStartedAt === 'string' ? task.payload.chainStartedAt : undefined,
        hopCount: typeof task.payload.hopCount === 'number' ? task.payload.hopCount : 0,
        replyParentCommentId: resolveAgentEventReplyParentCommentId(event),
      }
    : undefined
}

export const findRunningAgentEventId = (agentId: string, taskId: string) => (
  findRunningAgentEventContext(agentId, taskId)?.eventId
)

const AGENT_CLAIM_STEP = 'Agent 已领取任务，正在分析上下文。'

const claimAssignedTask = (event: PersistedAgentEvent, agentId: string) => {
  const taskId = event.scope.taskId
  if (!taskId) return null

  const task = loadState().tasks.find((item) => item.id === taskId)
  if (!task || task.assigneeAgentId !== agentId || task.status !== 'todo') return null

  const timestamp = new Date().toISOString()
  saveTask({
    ...task,
    status: 'in_progress',
    startedAt: task.startedAt ?? timestamp,
    currentStep: AGENT_CLAIM_STEP,
    updatedAt: timestamp,
  })
  return {
    status: task.status,
    startedAt: task.startedAt,
    currentStep: task.currentStep,
  }
}

const restoreFailedTaskClaim = (
  event: PersistedAgentEvent,
  agentId: string,
  previous: ReturnType<typeof claimAssignedTask>,
) => {
  const taskId = event.scope.taskId
  if (!taskId || !previous) return

  const task = loadState().tasks.find((item) => item.id === taskId)
  if (
    !task
    || task.assigneeAgentId !== agentId
    || task.status !== 'in_progress'
    || task.currentStep !== AGENT_CLAIM_STEP
  ) return

  saveTask({
    ...task,
    status: previous.status,
    startedAt: previous.startedAt,
    currentStep: previous.currentStep,
    updatedAt: new Date().toISOString(),
  })
}

const buildMissingDeliveryPrompt = (task: AgentTask, event: PersistedAgentEvent) => [
  '[Task Delivery Required]',
  `agentId: ${task.agentId}`,
  `eventId: ${task.id}`,
  `taskId: ${event.scope.taskId}`,
  '上一轮没有通过 task.delivery.report 写入任务状态和交付评论。',
  '现在不要只解释结果；请立即调用 task.delivery.report。状态选择：blocked 表示需要人类行动，in_review 表示可交付待验收，done 只用于已满足验收条件的任务。',
].join('\n')

export const isRetryableAgentInfrastructureResponse = (response: {
  aborted?: boolean
  message?: string
}) => response.aborted === true || response.message?.includes('执行器当前未在线，无法运行工作区对话。') === true

const failAgentEvent = (
  task: AgentTask,
  message: string,
  retryableInfrastructure: boolean,
  sessionId?: string,
) => {
  failAgentTask(task.id, message, sessionId ? { sessionId } : {})
  const failedTask = getAgentTask(task.id)
  updateAgentTaskRun(task.id, {
    status: 'failed',
    failureCode: classifyAgentTaskRunFailure({
      message,
      retryableInfrastructure,
      poisoned: isPoisonedAgentEventFailure(message),
    }),
    failureMessage: message,
    conversationSessionId: sessionId,
    completedAt: failedTask?.completedAt ?? new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
  })
  publishAgentTaskActivityChange(task)
  if (!retryableInfrastructure) return

  const retryPayload = buildAutomaticAgentEventRetryPayload(getAgentTask(task.id) ?? task)
  if (!retryPayload) return
  const retried = createAgentTask(task.agentId, task.type, retryPayload)
  ensureAgentEventTaskRun(retried)
  copyAgentTaskInboxLinks(task.id, retried.id, 'retry')
  publishAgentTaskActivityChange(retried)
}

const isAgentEventAvailable = (event: PersistedAgentEvent, now = Date.now()) => {
  if (!event.availableAt) return true
  const availableAt = Date.parse(event.availableAt)
  return !Number.isFinite(availableAt) || availableAt <= now
}

const runPendingAgentEvent = async (task: AgentTask) => {
  const latestTask = getAgentTask(task.id)
  if (!latestTask || (latestTask.status !== 'pending' && latestTask.status !== 'running')) return
  const event = readEvent(task)!
  ensureAgentEventTaskRun(latestTask, event)
  if (!isAgentEventAvailable(event)) return
  const readiness = resolveAgentDispatchReadiness(task.agentId, event.actingUserId)
  if (!readiness.ok) {
    failAgentEvent(task, readiness.message, readiness.retryableInfrastructure === true)
    return
  }

  const { agent, profile, userId } = readiness
    let claimedTask: ReturnType<typeof claimAssignedTask> = null
    let executionBinding: ReturnType<typeof bindMainChatExecutionAbortSignal> | null = null
    let retryableInfrastructureFailure = false
    let runtimeSessionId: string | undefined
    let runUsage: ModelTokenUsage | undefined
    let transcriptCapture: ReturnType<typeof createAgentTaskRunTranscriptCapture> | null = null
    try {
      const runtime = ensureRuntimeSession({
        state: loadState(),
        agentId: agent.id,
        userId,
        conversationKey: event.conversationKey,
        title: `Agent Event · ${task.type}`,
        defaultExecutorId: profile.defaultExecutorId,
        forceFresh: event.retrySessionMode === 'fresh',
      })
      if (!runtime.session.executorId) throw new Error('当前 Agent 所属用户没有在线执行节点。')
      runtimeSessionId = runtime.session.id
      saveStateMeta(runtime.state)
      executionBinding = bindMainChatExecutionAbortSignal({ userId, sessionId: runtime.session.id })
      startAgentTask(task.id)
      const primaryInboxItemId = typeof task.payload.inboxItemId === 'string' ? task.payload.inboxItemId : ''
      if (primaryInboxItemId) void markInboxItemRead(agent.id, primaryInboxItemId, 'agent')
      markAgentTaskInboxItemsRead(task.id, agent.id)
      const startedTask = getAgentTask(task.id)
      const initialPrompt = buildAgentEventPrompt(task, event)
      // P4 慢上下文注入：带 workspace 范围的事件注入已纳入文件的 digest 摘要段（按需检索，不进全文）
      const workspaceIdForDigest = typeof event.scope.workspaceId === 'string' && event.scope.workspaceId.trim()
        ? event.scope.workspaceId.trim()
        : ''
      const brainFileDigestContext = workspaceIdForDigest
        ? await buildBrainFileDigestContext(workspaceIdForDigest).catch(() => '')
        : ''
      const enrichedPrompt = brainFileDigestContext
        ? `${initialPrompt}\n\n${brainFileDigestContext}`
        : initialPrompt
      agentHeartbeat(agent.id, 'online', {
        source: 'agent_event',
        eventType: task.type,
        runId: task.id,
        sessionId: runtime.session.id,
      })
      updateAgentTaskRun(task.id, {
        status: 'running',
        conversationSessionId: runtime.session.id,
        startedAt: startedTask?.startedAt ?? new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      })
      transcriptCapture = createAgentTaskRunTranscriptCapture({
        agentTaskId: task.id,
        agentId: agent.id,
        agentName: agent.name,
        prompt: enrichedPrompt,
        startedAt: startedTask?.startedAt ?? new Date().toISOString(),
        onHeartbeat: () => publishAgentTaskActivityChange(task),
        onTranscriptChange: event.scope.taskId
          ? () => publishTaskAgentTranscriptChange(event.scope.taskId!, task.id)
          : undefined,
      })
      publishAgentTaskActivityChange(task)
      claimedTask = claimAssignedTask(event, agent.id)
      let response = await runMainChatResponse({
        state: runtime.state,
        userId,
        sessionId: runtime.session.id,
        message: enrichedPrompt,
        signal: executionBinding.signal,
        onEvent: transcriptCapture.onEvent,
      })
      saveStateMeta(response.state)
      runUsage = transcriptCapture.recordUsage(response.usage)
      const responseSession = response.state.mainChatSessions.find((session) => session.id === runtime.session.id)
      if (responseSession) {
        transcriptCapture.replaceTranscript(selectAgentEventTranscriptMessages(responseSession.messages ?? [], task.id))
      }

      const latest = getAgentTask(task.id)
      if (latest?.status === 'canceled') {
        restoreFailedTaskClaim(event, agent.id, claimedTask)
        return
      }
      if (latest?.status === 'waiting') {
        waitAgentTask(task.id, { ...asRecord(latest.result), sessionId: runtime.session.id })
        updateAgentTaskRun(task.id, {
          status: 'waiting',
          conversationSessionId: runtime.session.id,
          usage: runUsage,
          lastHeartbeatAt: new Date().toISOString(),
        })
        publishAgentTaskActivityChange(task)
        return
      }
      if (response.status !== 200) {
        retryableInfrastructureFailure = isRetryableAgentInfrastructureResponse(response)
        throw new Error(response.message || 'Agent 事件处理失败。')
      }
      const quickCreateRequest = readTaskQuickCreateRequest(task)
      const quickCreatedTask = quickCreateRequest
        ? findQuickCreatedTask(loadState().tasks, resolveTaskQuickCreateOriginId(task))
        : null
      if (quickCreateRequest && !quickCreatedTask) {
        throw new Error('Agent 未通过 task.create 创建 quick-create 任务。')
      }
      if (event.scope.taskId && !hasTaskDeliveryReport(response.toolCalls)) {
        const deliveryPrompt = buildMissingDeliveryPrompt(task, event)
        transcriptCapture.appendPrompt(deliveryPrompt)
        response = await runMainChatResponse({
          state: response.state,
          userId,
          sessionId: runtime.session.id,
          message: deliveryPrompt,
          signal: executionBinding.signal,
          onEvent: transcriptCapture.onEvent,
        })
        saveStateMeta(response.state)
        runUsage = transcriptCapture.recordUsage(response.usage)
        const deliverySession = response.state.mainChatSessions.find((session) => session.id === runtime.session.id)
        if (deliverySession) {
          transcriptCapture.replaceTranscript(selectAgentEventTranscriptMessages(deliverySession.messages ?? [], task.id))
        }
        if (getAgentTask(task.id)?.status === 'canceled') {
          restoreFailedTaskClaim(event, agent.id, claimedTask)
          return
        }
        if (response.status !== 200) {
          retryableInfrastructureFailure = isRetryableAgentInfrastructureResponse(response)
          throw new Error(response.message || 'Agent 事件处理失败。')
        }
        if (!hasTaskDeliveryReport(response.toolCalls)) {
          throw new Error('Agent 未通过 task.delivery.report 写入任务状态和交付评论。')
        }
      }
      completeAgentTask(task.id, { message: response.message ?? '', sessionId: runtime.session.id })
      const completedTask = getAgentTask(task.id)
      updateAgentTaskRun(task.id, {
        status: 'completed',
        taskId: quickCreatedTask?.id,
        projectId: quickCreatedTask?.projectId,
        conversationSessionId: runtime.session.id,
        usage: runUsage,
        completedAt: completedTask?.completedAt ?? new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
      })
      // 统一 usage 事件：Agent 事件 / 收件箱执行链路。
      await recordUsageEvent({
        runKind: 'agent_event',
        runId: task.id,
        userId,
        agentId: agent.id,
        agentName: agent.name,
        conversationId: runtime.session.id,
        taskId: quickCreatedTask?.id,
        projectId: quickCreatedTask?.projectId,
        workspaceId: event.scope.workspaceId,
        workspaceSessionId: event.scope.workspaceSessionId,
        usage: runUsage,
        createdAt: completedTask?.completedAt ?? new Date().toISOString(),
      })
      if (primaryInboxItemId) void archiveInboxItem(agent.id, primaryInboxItemId, 'agent')
      archiveAgentTaskInboxItems(task.id, agent.id)
      publishAgentTaskActivityChange(task)
      if (
        quickCreateRequest
        && quickCreatedTask?.assigneeAgentId
        && quickCreatedTask.status !== 'backlog'
        && quickCreateRequest.assignmentStartMode !== 'parked'
      ) {
        publishAgentEvent({
          type: 'task.assigned',
          targetAgentId: quickCreatedTask.assigneeAgentId,
          actingUserId: event.actingUserId,
          actor: { type: 'agent', id: task.agentId },
          scope: { projectId: quickCreatedTask.projectId, taskId: quickCreatedTask.id },
          payload: {
            title: quickCreatedTask.title,
            description: quickCreatedTask.description,
            status: quickCreatedTask.status,
            handoffPrompt: quickCreateRequest.request,
          },
          conversationKey: `task:${quickCreatedTask.id}`,
          idempotencyKey: `task-assigned-after-quick-create:${quickCreatedTask.id}:${quickCreatedTask.assigneeAgentId}`,
          sourceAgentEventId: task.id,
        })
      }
    } catch (error) {
      restoreFailedTaskClaim(event, agent.id, claimedTask)
      if (getAgentTask(task.id)?.status !== 'canceled') {
        const message = error instanceof Error ? error.message : String(error)
        transcriptCapture?.fail(message)
        failAgentEvent(
          task,
          message,
          retryableInfrastructureFailure,
          runtimeSessionId,
        )
      }
  } finally {
    transcriptCapture?.finish()
    executionBinding?.cleanup()
  }
}

const MAX_CONCURRENT_EVENTS_PER_AGENT = 3

export const selectRunnableAgentEvents = (tasks: AgentTask[]) => {
  const selected: AgentTask[] = []
  const busyThreads = new Set<string>()
  const perAgent = new Map<string, number>()
  for (const task of tasks) {
    const event = readEvent(task)
    if (!event || !isAgentEventAvailable(event)) continue
    const threadKey = `${task.agentId}:${event.conversationKey}`
    if (busyThreads.has(threadKey)) continue
    const agentCount = perAgent.get(task.agentId) ?? 0
    if (agentCount >= MAX_CONCURRENT_EVENTS_PER_AGENT) continue
    busyThreads.add(threadKey)
    perAgent.set(task.agentId, agentCount + 1)
    selected.push(task)
  }
  return selected
}

export const runPendingAgentEvents = async () => {
  const pending = [
    ...getAgentTasksByStatus('running'),
    ...getAgentTasksByStatus('pending'),
  ]
  await Promise.all(selectRunnableAgentEvents(pending).map(runPendingAgentEvent))
}

export const reconcileAgentEventInboxLinks = async () => {
  let reconciled = 0
  for (const agent of getAllAgents()) {
    for (const task of getAgentTasks(agent.id, Number.MAX_SAFE_INTEGER)) {
      const event = readEvent(task)
      const itemId = typeof task.payload.inboxItemId === 'string' ? task.payload.inboxItemId : ''
      if (!event || !itemId) continue
      const input: AgentEventInput = {
        type: task.type,
        targetAgentId: task.agentId,
        actingUserId: event.actingUserId,
        actor: event.actor,
        scope: event.scope,
        payload: event.payload,
        conversationKey: event.conversationKey,
        idempotencyKey: event.idempotencyKey,
        sourceAgentEventId: event.resumesEventId,
        sourceInboxItemId: typeof task.payload.sourceInboxItemId === 'string' ? task.payload.sourceInboxItemId : undefined,
        traceId: typeof task.payload.traceId === 'string' ? task.payload.traceId : itemId,
        chainStartedAt: typeof task.payload.chainStartedAt === 'string' ? task.payload.chainStartedAt : task.createdAt,
        hopCount: typeof task.payload.hopCount === 'number' ? task.payload.hopCount : 0,
        replyTo: task.payload.replyTo as InboxReplyTarget | undefined,
      }
      const inboxInput = buildAgentEventInboxItem({
        agentId: task.agentId,
        actorName: resolveAgentEventActorName(event.actor),
        event: input,
        itemId,
      })
      const { item } = await publishInboxItem(inboxInput)
      linkAgentTaskInboxItem(task.id, item.id, event.retrySource === 'initial' ? 'primary' : 'retry')
      if (event.resumesEventId) copyAgentTaskInboxLinks(event.resumesEventId, task.id, 'resume')
      const retryOfEventId = typeof task.payload.retryOfEventId === 'string' ? task.payload.retryOfEventId : ''
      if (retryOfEventId) copyAgentTaskInboxLinks(retryOfEventId, task.id, 'retry')
      reconciled += 1
    }
  }
  return reconciled
}

let scheduler: NodeJS.Timeout | null = null
let draining = false

export const startAgentEventRuntime = () => {
  if (scheduler) return
  scheduler = setInterval(() => {
    if (draining) return
    draining = true
    void withPostgresLease('vibemux:scheduler:agent-events', runPendingAgentEvents)
      .catch((error) => console.error('[agent-event-runtime] drain failed', error))
      .finally(() => { draining = false })
  }, 1_000)
}

export const stopAgentEventRuntime = () => {
  if (scheduler) clearInterval(scheduler)
  scheduler = null
}
