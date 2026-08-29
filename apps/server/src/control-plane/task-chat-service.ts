// [INPUT]: 任务对话消息（task+workspace 作用域）
// [OUTPUT]: 会话快照/入队/停止/备用通道
// [POS]: 任务对话服务（排队/备用通道）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildWorkspaceTaskExecutionView, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import {
  buildTaskChatSessionKey,
  normalizeTaskChatMessageRuntimeConfig,
  resolveTaskChatSessionMode,
  TASK_CHAT_HISTORY_PROTOCOL,
  TASK_CHAT_PROTOCOL_VERSION,
  TASK_CHAT_QUEUE_PROTOCOL,
  TASK_CHAT_STREAM_PROTOCOL,
  type TaskChatQueueEntry,
  type TaskChatQueueState,
  type TaskChatSessionSnapshot,
} from '@shared/task-chat-session'
import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import { normalizeTaskChatContextRefs } from '@shared/task-chat-context'
import type { CreatorIdentity, Project, Task } from '@shared/types'
import { getTaskConversationSnapshotSummary } from './conversation-service'
import {
  resolveExecutionMcpServerNamesForSession,
  resolveExecutionSkillsForSession,
} from '../services/custom-agent-runtime'
import {
  resolveEffectiveWorkspaceRuntimeStatus,
  toAgentRunningStatusFromRuntimeStatus,
} from '../services/task-workspace-runtime-state'
import { getMeta, getWorkspaceSession, getWorkspaceSessionById } from '../storage/app-state-store'
import {
  claimTaskChatQueueItemDb,
  completeTaskChatQueueItemDb,
  deleteLegacyTaskChatQueuesMetaDb,
  enqueueTaskChatQueueItemDb,
  listPendingTaskChatQueueEntriesFromMirror,
  pendingTaskChatQueueMirrorSnapshot,
  releaseTaskChatQueueItemDb,
  removeTaskChatQueueItemDb,
  removeTaskChatQueueItemsForWorkspaceDb,
  removeTaskChatQueueItemsForWorkspaceSessionDb,
} from '../storage/postgres/task-chat-queue-store'

const TASK_CHAT_QUEUE_META_KEY = 'taskChatQueues'
const MAX_TASK_CHAT_QUEUE_RETRIES = 2

export const buildTaskChatQueueTurnId = (queueId: string) => `task-chat-queue:${queueId}`

type TaskChatQueueClaim = {
  claimId: string
  claimedAt: string
  claimedBy?: string
} & TaskChatQueueEntry

type StoredTaskChatQueueState = {
  pending: TaskChatQueueEntry[]
  inflight: TaskChatQueueClaim[]
}

const sortQueueItems = <T extends TaskChatQueueEntry>(items: T[]) => {
  return [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export const createEmptyStoredTaskChatQueueState = (): StoredTaskChatQueueState => ({
  pending: [],
  inflight: [],
})

const toQueueEntry = (claim: TaskChatQueueClaim): TaskChatQueueEntry => {
  return {
    id: claim.id,
    sessionKey: claim.sessionKey,
    taskId: claim.taskId,
    workspaceId: claim.workspaceId,
    workspaceSessionId: claim.workspaceSessionId,
    taskRunId: claim.taskRunId,
    requestedByAgentId: claim.requestedByAgentId,
    sourceAgentEventId: claim.sourceAgentEventId,
    author: claim.author,
    dedupeKey: claim.dedupeKey,
    message: claim.message,
    attachments: claim.attachments,
    contextRefs: claim.contextRefs,
    runtimeConfig: claim.runtimeConfig,
    createdAt: claim.createdAt,
    createdBy: claim.createdBy,
    retryCount: claim.retryCount,
  }
}

const normalizeCreatorIdentity = (value: unknown): CreatorIdentity | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const type = record.type === 'user' || record.type === 'agent' ? record.type : undefined
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const avatarUrl = typeof record.avatarUrl === 'string' ? record.avatarUrl.trim() : ''
  if (!type || !id || !name) {
    return undefined
  }

  return {
    type,
    id,
    name,
    avatarUrl: avatarUrl || undefined,
  }
}

const normalizeQueueEntry = (value: unknown): TaskChatQueueEntry | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey.trim() : ''
  const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId.trim() : undefined
  const workspaceSessionId = typeof record.workspaceSessionId === 'string' ? record.workspaceSessionId.trim() : undefined
  const taskRunId = typeof record.taskRunId === 'string' ? record.taskRunId.trim() : undefined
  const requestedByAgentId = typeof record.requestedByAgentId === 'string' ? record.requestedByAgentId.trim() : undefined
  const sourceAgentEventId = typeof record.sourceAgentEventId === 'string' ? record.sourceAgentEventId.trim() : undefined
  const dedupeKey = typeof record.dedupeKey === 'string' ? record.dedupeKey.trim() : undefined
  const message = typeof record.message === 'string' ? record.message : ''
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : ''
  const createdBy = typeof record.createdBy === 'string' ? record.createdBy.trim() : undefined
  const retryCount = typeof record.retryCount === 'number' && Number.isFinite(record.retryCount) && record.retryCount >= 0
    ? Math.floor(record.retryCount)
    : 0
  if (!id || !sessionKey || !createdAt) {
    return null
  }

  return {
    id,
    sessionKey,
    taskId: taskId || undefined,
    workspaceId: workspaceId || undefined,
    workspaceSessionId: workspaceSessionId || undefined,
    taskRunId: taskRunId || undefined,
    requestedByAgentId: requestedByAgentId || undefined,
    sourceAgentEventId: sourceAgentEventId || undefined,
    author: normalizeCreatorIdentity(record.author),
    dedupeKey: dedupeKey || undefined,
    message,
    attachments: normalizeTaskChatAttachments(record.attachments),
    contextRefs: normalizeTaskChatContextRefs(record.contextRefs),
    runtimeConfig: normalizeTaskChatMessageRuntimeConfig(record.runtimeConfig),
    createdAt,
    createdBy: createdBy || undefined,
    retryCount,
  }
}

const normalizeQueueClaim = (value: unknown): TaskChatQueueClaim | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const base = normalizeQueueEntry(record)
  const claimId = typeof record.claimId === 'string' ? record.claimId.trim() : ''
  const claimedAt = typeof record.claimedAt === 'string' ? record.claimedAt : ''
  const claimedBy = typeof record.claimedBy === 'string' ? record.claimedBy.trim() : undefined
  if (!base || !claimId || !claimedAt) {
    return null
  }

  return {
    ...base,
    claimId,
    claimedAt,
    claimedBy: claimedBy || undefined,
  }
}

const TASK_CHAT_QUEUE_CLAIM_TIMEOUT_MS = 5 * 60 * 1000
const isExpiredClaim = (claim: TaskChatQueueClaim) => {
  const claimedAt = new Date(claim.claimedAt).getTime()
  if (Number.isNaN(claimedAt)) {
    return true
  }

  return Date.now() - claimedAt >= TASK_CHAT_QUEUE_CLAIM_TIMEOUT_MS
}

export const restoreExpiredTaskChatQueueClaims = (state: StoredTaskChatQueueState): StoredTaskChatQueueState => {
  const expiredClaims = state.inflight.filter(isExpiredClaim)
  if (expiredClaims.length === 0) {
    return state
  }

  return {
    pending: sortQueueItems([
      ...state.pending.filter((item) => !expiredClaims.some((claim) => claim.id === item.id)),
      ...expiredClaims.map(toQueueEntry),
    ]),
    inflight: sortQueueItems(state.inflight.filter((claim) => !isExpiredClaim(claim))),
  }
}

const normalizeStoredTaskChatQueues = (value: unknown): StoredTaskChatQueueState => {
  if (Array.isArray(value)) {
    return {
      pending: sortQueueItems(value.map((item) => normalizeQueueEntry(item)).filter((item): item is TaskChatQueueEntry => Boolean(item))),
      inflight: [],
    }
  }

  if (!value || typeof value !== 'object') {
    return {
      pending: [],
      inflight: [],
    }
  }

  const record = value as { pending?: unknown; inflight?: unknown }
  return {
    pending: sortQueueItems(Array.isArray(record.pending) ? record.pending.map((item) => normalizeQueueEntry(item)).filter((item): item is TaskChatQueueEntry => Boolean(item)) : []),
    inflight: sortQueueItems(Array.isArray(record.inflight) ? record.inflight.map((item) => normalizeQueueClaim(item)).filter((item): item is TaskChatQueueClaim => Boolean(item)) : []),
  }
}

const listTaskChatQueueEntriesFromMirrorForSession = (sessionKey: string) => {
  return sortQueueItems(listPendingTaskChatQueueEntriesFromMirror(sessionKey))
}

export const listTaskChatQueueEntries = (taskId?: string, workspaceId?: string, workspaceSessionId?: string) => {
  const sessionKey = buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId)
  return listTaskChatQueueEntriesFromMirrorForSession(sessionKey)
}

export const listTaskChatQueueEntriesForWorkspaceSession = (workspaceId?: string, workspaceSessionId?: string) => {
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  const normalizedWorkspaceSessionId = workspaceSessionId?.trim() || ''
  if (!normalizedWorkspaceId || !normalizedWorkspaceSessionId) {
    return []
  }

  const entries: TaskChatQueueEntry[] = []
  for (const items of pendingTaskChatQueueMirrorSnapshot().values()) {
    for (const item of items) {
      if (item.workspaceId === normalizedWorkspaceId && item.workspaceSessionId === normalizedWorkspaceSessionId) {
        entries.push(item)
      }
    }
  }
  return sortQueueItems(entries)
}

export const getTaskChatQueueState = (taskId?: string, workspaceId?: string, workspaceSessionId?: string): TaskChatQueueState => {
  const sessionKey = buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId)
  const items = listTaskChatQueueEntries(taskId, workspaceId, workspaceSessionId)

  return {
    sessionKey,
    status: items.length > 0 ? 'queued' : 'empty',
    items,
  }
}

export const enqueueTaskChatQueueState = (state: StoredTaskChatQueueState, item: TaskChatQueueEntry): StoredTaskChatQueueState => {
  if (item.dedupeKey) {
    const hasDuplicate = [...state.pending, ...state.inflight].some((entry) => (
      entry.sessionKey === item.sessionKey
      && entry.dedupeKey === item.dedupeKey
    ))
    if (hasDuplicate) {
      return state
    }
  }

  return {
    ...state,
    pending: sortQueueItems([...state.pending, item]),
  }
}

export const claimTaskChatQueueState = (state: StoredTaskChatQueueState, params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
  claimedBy?: string
}) => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  const nextPending = sortQueueItems(state.pending.filter((item) => item.sessionKey === sessionKey))
  const item = nextPending[0]
  if (!item || item.id !== params.queueId) {
    return { state, claim: null }
  }

  const claim: TaskChatQueueClaim = {
    ...item,
    claimId: crypto.randomUUID(),
    claimedAt: new Date().toISOString(),
    claimedBy: params.claimedBy,
  }

  return {
    state: {
      pending: state.pending.filter((entry) => entry.id !== item.id),
      inflight: sortQueueItems([...state.inflight.filter((entry) => entry.id !== item.id), claim]),
    },
    claim,
  }
}

export const completeTaskChatQueueClaimState = (state: StoredTaskChatQueueState, params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
  claimId: string
}): StoredTaskChatQueueState => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)

  return {
    pending: state.pending,
    inflight: state.inflight.filter((item) => !(item.sessionKey === sessionKey && item.id === params.queueId && item.claimId === params.claimId)),
  }
}

export const releaseTaskChatQueueClaimState = (state: StoredTaskChatQueueState, params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
  claimId: string
}): { state: StoredTaskChatQueueState; restoredItem: TaskChatQueueEntry | null; dropped: boolean } => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  const claim = state.inflight.find((item) => item.sessionKey === sessionKey && item.id === params.queueId && item.claimId === params.claimId)
  if (!claim) {
    return { state, restoredItem: null, dropped: false }
  }

  const nextRetryCount = Math.max(claim.retryCount ?? 0, 0) + 1
  if (nextRetryCount > MAX_TASK_CHAT_QUEUE_RETRIES) {
    return {
      state: completeTaskChatQueueClaimState(state, params),
      restoredItem: null,
      dropped: true,
    }
  }

  const restoredItem: TaskChatQueueEntry = {
    ...toQueueEntry(claim),
    retryCount: nextRetryCount,
  }

  return {
    state: {
      pending: sortQueueItems([...state.pending.filter((item) => item.id !== restoredItem.id), restoredItem]),
      inflight: state.inflight.filter((item) => !(item.sessionKey === sessionKey && item.id === params.queueId && item.claimId === params.claimId)),
    },
    restoredItem,
    dropped: false,
  }
}

export const removeTaskChatQueueEntryState = (state: StoredTaskChatQueueState, params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
}): StoredTaskChatQueueState => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)

  return {
    pending: state.pending.filter((item) => !(item.sessionKey === sessionKey && item.id === params.queueId)),
    inflight: state.inflight.filter((item) => !(item.sessionKey === sessionKey && item.id === params.queueId)),
  }
}

export const enqueueTaskChatMessage = async (params: {
  id?: string
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  taskRunId?: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  author?: CreatorIdentity
  dedupeKey?: string
  message: string
  attachments?: TaskChatQueueEntry['attachments']
  contextRefs?: TaskChatQueueEntry['contextRefs']
  runtimeConfig?: TaskChatQueueEntry['runtimeConfig']
  createdBy?: string
}): Promise<TaskChatQueueEntry> => {
  const item: TaskChatQueueEntry = {
    id: params.id?.trim() || crypto.randomUUID(),
    sessionKey: buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId),
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    taskRunId: params.taskRunId?.trim() || undefined,
    requestedByAgentId: params.requestedByAgentId?.trim() || undefined,
    sourceAgentEventId: params.sourceAgentEventId?.trim() || undefined,
    author: params.author,
    dedupeKey: params.dedupeKey?.trim() || undefined,
    message: params.message.trim(),
    attachments: normalizeTaskChatAttachments(params.attachments),
    contextRefs: normalizeTaskChatContextRefs(params.contextRefs),
    runtimeConfig: normalizeTaskChatMessageRuntimeConfig(params.runtimeConfig),
    createdAt: new Date().toISOString(),
    createdBy: params.createdBy,
    retryCount: 0,
  }

  return enqueueTaskChatQueueItemDb(item)
}

export const removeTaskChatQueueEntry = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
}) => {
  return removeTaskChatQueueItemDb({
    sessionKey: buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId),
    queueId: params.queueId,
  })
}

export const removeTaskChatQueueEntriesForWorkspaceSessionState = (state: StoredTaskChatQueueState, params: {
  workspaceId: string
  workspaceSessionId: string
}): StoredTaskChatQueueState => {
  const workspaceId = params.workspaceId.trim()
  const workspaceSessionId = params.workspaceSessionId.trim()
  if (!workspaceId || !workspaceSessionId) {
    return state
  }

  return {
    pending: state.pending.filter((item) => !(
      item.workspaceId === workspaceId
      && item.workspaceSessionId === workspaceSessionId
    )),
    inflight: state.inflight.filter((item) => !(
      item.workspaceId === workspaceId
      && item.workspaceSessionId === workspaceSessionId
    )),
  }
}

export const removeTaskChatQueueEntriesForWorkspaceSession = (params: {
  workspaceId: string
  workspaceSessionId: string
}) => {
  return removeTaskChatQueueItemsForWorkspaceSessionDb({
    workspaceId: params.workspaceId.trim(),
    workspaceSessionId: params.workspaceSessionId.trim(),
  })
}

export const removeTaskChatQueueEntriesForWorkspaceState = (state: StoredTaskChatQueueState, params: {
  workspaceId: string
}): StoredTaskChatQueueState => {
  const workspaceId = params.workspaceId.trim()
  if (!workspaceId) {
    return state
  }

  return {
    pending: state.pending.filter((item) => item.workspaceId !== workspaceId),
    inflight: state.inflight.filter((item) => item.workspaceId !== workspaceId),
  }
}

export const removeTaskChatQueueEntriesForWorkspace = (params: {
  workspaceId: string
}) => {
  return removeTaskChatQueueItemsForWorkspaceDb({
    workspaceId: params.workspaceId.trim(),
  })
}

export const claimTaskChatQueueEntry = async (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
  claimedBy?: string
}) => {
  return claimTaskChatQueueItemDb({
    sessionKey: buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId),
    queueId: params.queueId,
    claimedBy: params.claimedBy,
  })
}

export const completeTaskChatQueueClaim = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
  claimId: string
}) => {
  return completeTaskChatQueueItemDb({
    sessionKey: buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId),
    queueId: params.queueId,
    claimId: params.claimId,
  })
}

export const releaseTaskChatQueueClaim = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  queueId: string
  claimId: string
}) => {
  return releaseTaskChatQueueItemDb({
    sessionKey: buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId),
    queueId: params.queueId,
    claimId: params.claimId,
  })
}

// 启动期一次性迁移：把历史 app_meta JSON 里的队列项迁入关系表（best-effort，瞬态队列可丢可重发）。
export const migrateLegacyTaskChatQueuesFromMeta = async () => {
  const legacy = normalizeStoredTaskChatQueues(getMeta<unknown>(TASK_CHAT_QUEUE_META_KEY, []))
  const entries = [...legacy.pending, ...legacy.inflight.map(toQueueEntry)]
  for (const entry of entries) {
    try {
      await enqueueTaskChatQueueItemDb(entry)
    } catch (error) {
      console.warn('[task-chat-queue] legacy queue entry migration failed', {
        queueId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (entries.length > 0) {
    await deleteLegacyTaskChatQueuesMetaDb()
    console.log(`[task-chat-queue] migrated ${entries.length} legacy queue entries from app_meta`)
  }
}

export const buildTaskChatSessionSnapshot = (params: {
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}): TaskChatSessionSnapshot => {
  const sessionKey = buildTaskChatSessionKey(params.task.id, params.workspaceId, params.workspaceSessionId)
  const workspaceSession = params.workspaceSessionId
    ? getWorkspaceSessionById(params.workspaceSessionId)
    : params.workspaceId
      ? getWorkspaceSession(params.workspaceId)
      : null
  const scopedTask = params.workspaceId && workspaceSession
    ? buildWorkspaceTaskExecutionView(params.task, workspaceSession)
    : params.task
  const conversationSummary = getTaskConversationSnapshotSummary(params.task, params.project, params.workspaceId, params.workspaceSessionId)
  const visibleQueueItems = listTaskChatQueueEntries(params.task.id, params.workspaceId, params.workspaceSessionId)
    .filter((item) => !conversationSummary.hasTurnId(buildTaskChatQueueTurnId(item.id)))
  const latestMessageAt = conversationSummary.latestMessageAt
  const mountedSkills = resolveExecutionSkillsForSession({
    projectId: params.project.id,
    workspaceId: params.workspaceId,
    session: workspaceSession,
  })
  const mountedSkillNames = workspaceSession?.mountedSkillNames?.length
    ? workspaceSession.mountedSkillNames
    : mountedSkills.map((skill) => skill.name)
  const mountedMcpServerNames = workspaceSession?.mountedMcpServerNames?.length
    ? workspaceSession.mountedMcpServerNames
    : resolveExecutionMcpServerNamesForSession({ session: workspaceSession })
  const effectiveRuntimeStatus = workspaceSession
    ? resolveEffectiveWorkspaceRuntimeStatus(workspaceSession)
    : undefined
  const effectiveAgentRunningStatus = workspaceSession && effectiveRuntimeStatus
    ? toAgentRunningStatusFromRuntimeStatus(effectiveRuntimeStatus)
    : scopedTask.agentRunningStatus
  const effectiveCurrentStep = workspaceSession && effectiveRuntimeStatus === 'lost'
    ? workspaceSession.terminalReason?.trim() || '执行器已离线，会话状态已标记为异常。'
    : scopedTask.currentStep
  const effectiveTerminalReason = workspaceSession && effectiveRuntimeStatus === 'lost'
    ? workspaceSession.terminalReason?.trim() || '执行器已离线，会话状态已标记为异常。'
    : workspaceSession?.terminalReason

  return {
    protocol: {
      version: TASK_CHAT_PROTOCOL_VERSION,
      stream: TASK_CHAT_STREAM_PROTOCOL,
      history: TASK_CHAT_HISTORY_PROTOCOL,
      queue: TASK_CHAT_QUEUE_PROTOCOL,
    },
    scope: {
      mode: resolveTaskChatSessionMode(params.workspaceId, params.workspaceSessionId),
      taskId: params.task.id,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
      sessionKey,
    },
    runtime: {
      agentRunningStatus: effectiveAgentRunningStatus,
      runtimeStatus: effectiveRuntimeStatus ?? workspaceSession?.runtimeStatus,
      currentStep: effectiveCurrentStep,
      needsHumanConfirm: scopedTask.needsHumanConfirm,
      agentSessionId: workspaceSession?.agentSessionId ?? workspaceSession?.opencodeSessionId,
      opencodeSessionId: workspaceSession?.opencodeSessionId,
      executorNodeId: resolveWorkspaceSessionExecutorId(workspaceSession),
      runtimeOwnerExecutorId: workspaceSession?.runtimeOwnerExecutorId,
      runtimeSessionId: workspaceSession?.runtimeSessionId,
      runtimeStartedAt: workspaceSession?.runtimeStartedAt,
      lastHeartbeatAt: workspaceSession?.lastHeartbeatAt,
      lastRuntimeEventAt: workspaceSession?.lastRuntimeEventAt,
      terminalReason: effectiveTerminalReason,
      runtimeSequence: workspaceSession?.runtimeSequence,
      sessionKind: workspaceSession?.sessionKind,
      sessionRole: workspaceSession?.sessionRole,
      parentSessionId: workspaceSession?.parentSessionId,
      rootSessionId: workspaceSession?.rootSessionId,
      customAgentId: workspaceSession?.customAgentId,
      customAgentName: workspaceSession?.customAgentName,
      agentInvocationMode: workspaceSession?.agentInvocationMode,
      mountedSkillNames,
      mountedMcpServerNames,
    },
    conversation: {
      conversationId: conversationSummary.conversation.id,
      messageCount: conversationSummary.messageCount,
      latestMessageAt,
    },
    queue: {
      sessionKey,
      status: visibleQueueItems.length > 0 ? 'queued' : 'empty',
      items: visibleQueueItems,
    },
  }
}
