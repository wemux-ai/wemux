import { and, asc, desc, eq, gt, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionEventsPage,
  WorkspaceSessionHistoryProjection,
  WorkspaceSessionRuntimeSnapshot,
  WorkspaceSessionTurnRecord,
} from '@shared/workspace-session-history'
import {
  resolveWorkspaceSessionHistoryLatestPreviewText,
  resolveWorkspaceSessionEventVisibility,
  resolveWorkspaceSessionSystemMessageVisibility,
  type WorkspaceSessionEventVisibility,
} from '@shared/workspace-session-history'
import { sanitizeToolCallForPersistence, sanitizeToolCallsForPersistence } from '@shared/tool-call-persistence'
import type { ModelTokenUsage, WorkspaceSessionPendingRevision } from '@shared/types'
import type { AgentRunningStatus, WorkspaceSessionRuntimeStatus, ToolCall } from '@shared/types'
import {
  publishWorkspaceSessionHistoryEvent,
  publishWorkspaceSessionHistoryRuntime,
} from '../../services/workspace-session-history-ws-service'
import { ensurePostgresReady } from './db'
import { getDrizzleDb, withDrizzleTransaction, type DrizzleDb } from './drizzle-db'
import { cloneJson } from './helpers'
import {
  workspaceSessionHistoryEvents,
  workspaceSessionHistoryProjection,
  workspaceSessionHistoryRuntime,
  workspaceSessionHistoryTurns,
} from './schema'

type WorkspaceSessionHistoryTurnRow = typeof workspaceSessionHistoryTurns.$inferSelect
type WorkspaceSessionHistoryEventRow = typeof workspaceSessionHistoryEvents.$inferSelect
type WorkspaceSessionHistoryRuntimeRow = typeof workspaceSessionHistoryRuntime.$inferSelect
type WorkspaceSessionHistoryProjectionRow = typeof workspaceSessionHistoryProjection.$inferSelect

type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]
type DrizzleExecutor = DrizzleDb | DrizzleTx

type PersistWorkspaceSessionTurnHistoryInput = {
  sessionId: string
  taskId: string
  workspaceId: string
  turn: WorkspaceSessionTurnRecord
  events: WorkspaceSessionEventRecord[]
  runtime: WorkspaceSessionRuntimeSnapshot
  sourceSessionId?: string
  pendingRevision?: WorkspaceSessionPendingRevision
}

type DeleteWorkspaceSessionTurnInput = {
  sessionId: string
  taskId: string
  workspaceId: string
  turnId: string
  deletedMessageId: string
}

type AppendWorkspaceSessionSystemMessageInput = {
  sessionId: string
  taskId: string
  workspaceId: string
  message: string
  visibility?: WorkspaceSessionEventVisibility
  eventId?: string
  turnId?: string
  createdAt?: string
}

type WorkspaceSessionTurnDeleteResult =
  | {
      ok: true
      event: Extract<WorkspaceSessionEventRecord, { kind: 'turn_deleted' }>
      runtime: WorkspaceSessionRuntimeSnapshot | null
    }
  | {
      ok: false
      reason: 'not_found' | 'already_deleted' | 'not_latest' | 'has_assistant_output'
    }

type WorkspaceSessionTurnDeleteFailureReason = Extract<
  WorkspaceSessionTurnDeleteResult,
  { ok: false }
>['reason']

/** Snake_case CTE result used only by rebuildWorkspaceSessionHistoryProjection. */
type RebuiltProjectionQueryRow = {
  session_id: string | null
  task_id: string | null
  workspace_id: string | null
  latest_turn_id: string | null
  latest_event_kind: WorkspaceSessionEventRecord['kind'] | null
  latest_event_seq: number | null
  total_event_count: number | null
  last_event_at: string | null
  latest_user_message_id: string | null
  latest_user_message_preview: string | null
  latest_assistant_message_id: string | null
  latest_assistant_message_preview: string | null
  last_persisted_turn_started_at: string | null
  last_persisted_turn_finished_at: string | null
  last_persisted_turn_status: WorkspaceSessionTurnRecord['status'] | null
  deleted_turn_count: number | null
  updated_at: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const normalizeUsageNumber = (value: unknown) => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

const normalizeModelTokenUsage = (usage: unknown): ModelTokenUsage | undefined => {
  if (!isRecord(usage)) {
    return undefined
  }

  const inputTokens = normalizeUsageNumber(usage.inputTokens)
  const outputTokens = normalizeUsageNumber(usage.outputTokens)
  const reasoningTokens = normalizeUsageNumber(usage.reasoningTokens)
  const cacheReadTokens = normalizeUsageNumber(usage.cacheReadTokens)
  const cacheWriteTokens = normalizeUsageNumber(usage.cacheWriteTokens)
  const totalTokens = normalizeUsageNumber(usage.totalTokens)
    || (inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens)

  if (
    totalTokens <= 0
    && inputTokens <= 0
    && outputTokens <= 0
    && reasoningTokens <= 0
    && cacheReadTokens <= 0
    && cacheWriteTokens <= 0
  ) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
    totalTokens,
  }
}

const mapTurnRow = (row: WorkspaceSessionHistoryTurnRow): WorkspaceSessionTurnRecord => ({
  id: row.id,
  sessionId: row.sessionId,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt ?? undefined,
  firstSessionSeq: row.firstSeq ?? undefined,
  lastSessionSeq: row.lastSeq ?? undefined,
  eventCount: row.eventCount,
  usage: normalizeModelTokenUsage(row.usageJson),
  lineage: row.lineageJson ?? undefined,
})

const resolveUserMessageIdFromTurnEvents = (events: WorkspaceSessionEventRecord[]) => {
  return events.find((event) => event.kind === 'user_message')?.payload.messageId
}

const buildWorkspaceSessionTurnLineage = (params: {
  sourceSessionId?: string
  pendingRevision?: WorkspaceSessionPendingRevision
  events: WorkspaceSessionEventRecord[]
}) => {
  if (!params.pendingRevision && !params.sourceSessionId) {
    return undefined
  }

  return {
    sourceSessionId: params.sourceSessionId,
    sourceTurnId: params.pendingRevision?.sourceTurnId,
    sourceUserMessageId: params.pendingRevision?.sourceUserMessageId,
    sourceAssistantMessageId: params.pendingRevision?.sourceAssistantMessageId,
    revision: params.pendingRevision ? {
      ...params.pendingRevision,
      sourceUserMessageId: params.pendingRevision.sourceUserMessageId || resolveUserMessageIdFromTurnEvents(params.events) || '',
      sourceAssistantMessageId: params.pendingRevision.sourceAssistantMessageId,
    } : undefined,
  } satisfies NonNullable<WorkspaceSessionTurnRecord['lineage']>
}

const mapEventRow = (row: WorkspaceSessionHistoryEventRow): WorkspaceSessionEventRecord => {
  const base = {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    sessionSeq: row.sessionSeq,
    turnSeq: row.turnSeq,
    createdAt: row.createdAt,
    visibility: row.visibility as WorkspaceSessionEventVisibility,
  }

  switch (row.kind) {
    case 'user_message':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'user_message' }>['payload'],
      }
    case 'assistant_message':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'assistant_message' }>['payload'],
      }
    case 'system_message':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'system_message' }>['payload'],
      }
    case 'delivery_result':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'delivery_result' }>['payload'],
      }
    case 'thinking':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'thinking' }>['payload'],
      }
    case 'tool_call':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'tool_call' }>['payload'],
      }
    case 'interaction':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'interaction' }>['payload'],
      }
    case 'status':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'status' }>['payload'],
      }
    case 'error':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'error' }>['payload'],
      }
    case 'turn_deleted':
      return {
        ...base,
        kind: row.kind,
        payload: row.payloadJson as Extract<WorkspaceSessionEventRecord, { kind: 'turn_deleted' }>['payload'],
      }
  }
}

const matchesWorkspaceSessionEventVisibility = (
  event: WorkspaceSessionEventRecord,
  visibility: WorkspaceSessionEventVisibility | 'all',
) => visibility === 'all'
  ? true
  : event.visibility === visibility

// Keep unused helpers referenced so future visibility filters stay discoverable.
void matchesWorkspaceSessionEventVisibility
void resolveWorkspaceSessionEventVisibility

const mapRuntimeRow = (row: WorkspaceSessionHistoryRuntimeRow): WorkspaceSessionRuntimeSnapshot => ({
  sessionId: row.sessionId,
  taskId: row.taskId ?? undefined,
  workspaceId: row.workspaceId,
  agentRunningStatus: row.agentRunningStatus,
  runtimeStatus: row.runtimeStatus ?? undefined,
  currentStep: row.currentStep,
  queueStatus: row.queueStatus,
  activeToolCalls: row.activeToolCallsJson ?? [],
  lastEventSeq: row.lastEventSeq,
  lastEventAt: row.lastEventAt ?? undefined,
  updatedAt: row.updatedAt,
})

const normalizeWorkspaceSessionMessagePreview = (value: string, limit = 240) => {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    return ''
  }

  return normalized.length > limit
    ? `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
    : normalized
}

const mapProjectionRow = (row: WorkspaceSessionHistoryProjectionRow): WorkspaceSessionHistoryProjection => {
  const projection: WorkspaceSessionHistoryProjection = {
    sessionId: row.sessionId,
    taskId: row.taskId ?? undefined,
    workspaceId: row.workspaceId,
    latestTurnId: row.latestTurnId ?? undefined,
    latestEventKind: row.latestEventKind ?? undefined,
    latestEventSeq: row.latestEventSeq,
    totalEventCount: row.totalEventCount,
    lastEventAt: row.lastEventAt ?? undefined,
    latestUserMessageId: row.latestUserMessageId ?? undefined,
    latestUserMessagePreview: row.latestUserMessagePreview ?? undefined,
    latestAssistantMessageId: row.latestAssistantMessageId ?? undefined,
    latestAssistantMessagePreview: row.latestAssistantMessagePreview ?? undefined,
    lastPersistedTurnStartedAt: row.lastPersistedTurnStartedAt ?? undefined,
    lastPersistedTurnFinishedAt: row.lastPersistedTurnFinishedAt ?? undefined,
    lastPersistedTurnStatus: row.lastPersistedTurnStatus ?? undefined,
    deletedTurnCount: row.deletedTurnCount,
    updatedAt: row.updatedAt,
    hasPersistedHistory: row.totalEventCount > 0,
  }

  return {
    ...projection,
    latestPreviewText: resolveWorkspaceSessionHistoryLatestPreviewText(projection),
  }
}

const upsertWorkspaceSessionHistoryProjection = async (
  executor: DrizzleExecutor,
  projection: Omit<WorkspaceSessionHistoryProjection, 'hasPersistedHistory' | 'latestPreviewText'>,
) => {
  const values = {
    sessionId: projection.sessionId,
    taskId: projection.taskId,
    workspaceId: projection.workspaceId,
    latestTurnId: projection.latestTurnId ?? null,
    latestEventKind: projection.latestEventKind ?? null,
    latestEventSeq: projection.latestEventSeq,
    totalEventCount: projection.totalEventCount,
    lastEventAt: projection.lastEventAt ?? null,
    latestUserMessageId: projection.latestUserMessageId ?? null,
    latestUserMessagePreview: projection.latestUserMessagePreview ?? null,
    latestAssistantMessageId: projection.latestAssistantMessageId ?? null,
    latestAssistantMessagePreview: projection.latestAssistantMessagePreview ?? null,
    lastPersistedTurnStartedAt: projection.lastPersistedTurnStartedAt ?? null,
    lastPersistedTurnFinishedAt: projection.lastPersistedTurnFinishedAt ?? null,
    lastPersistedTurnStatus: projection.lastPersistedTurnStatus ?? null,
    deletedTurnCount: projection.deletedTurnCount,
    updatedAt: projection.updatedAt,
  }

  await executor
    .insert(workspaceSessionHistoryProjection)
    .values(values)
    .onConflictDoUpdate({
      target: workspaceSessionHistoryProjection.sessionId,
      set: {
        taskId: values.taskId,
        workspaceId: values.workspaceId,
        latestTurnId: values.latestTurnId,
        latestEventKind: values.latestEventKind,
        latestEventSeq: values.latestEventSeq,
        totalEventCount: values.totalEventCount,
        lastEventAt: values.lastEventAt,
        latestUserMessageId: values.latestUserMessageId,
        latestUserMessagePreview: values.latestUserMessagePreview,
        latestAssistantMessageId: values.latestAssistantMessageId,
        latestAssistantMessagePreview: values.latestAssistantMessagePreview,
        lastPersistedTurnStartedAt: values.lastPersistedTurnStartedAt,
        lastPersistedTurnFinishedAt: values.lastPersistedTurnFinishedAt,
        lastPersistedTurnStatus: values.lastPersistedTurnStatus,
        deletedTurnCount: values.deletedTurnCount,
        updatedAt: values.updatedAt,
      },
    })
}

const buildWorkspaceSessionHistoryProjectionFromEvents = (params: {
  sessionId: string
  taskId: string
  workspaceId: string
  turn: WorkspaceSessionTurnRecord
  events: WorkspaceSessionEventRecord[]
  totalEventCount: number
  deletedTurnCount: number
  previousProjection?: WorkspaceSessionHistoryProjection | null
}) => {
  const latestEvent = params.events.at(-1)
  const latestUserMessage = [...params.events].reverse().find((event) => event.kind === 'user_message')
  const latestAssistantMessage = [...params.events].reverse().find((event) => event.kind === 'assistant_message')

  return {
    sessionId: params.sessionId,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    latestTurnId: latestEvent?.turnId ?? params.turn.id,
    latestEventKind: latestEvent?.kind ?? params.previousProjection?.latestEventKind,
    latestEventSeq: latestEvent?.sessionSeq ?? params.previousProjection?.latestEventSeq ?? 0,
    totalEventCount: params.totalEventCount,
    lastEventAt: latestEvent?.createdAt ?? params.previousProjection?.lastEventAt,
    latestUserMessageId: latestUserMessage?.kind === 'user_message'
      ? latestUserMessage.payload.messageId
      : params.previousProjection?.latestUserMessageId,
    latestUserMessagePreview: latestUserMessage?.kind === 'user_message'
      ? normalizeWorkspaceSessionMessagePreview(latestUserMessage.payload.text)
      : params.previousProjection?.latestUserMessagePreview,
    latestAssistantMessageId: latestAssistantMessage?.kind === 'assistant_message'
      ? latestAssistantMessage.payload.messageId
      : params.previousProjection?.latestAssistantMessageId,
    latestAssistantMessagePreview: latestAssistantMessage?.kind === 'assistant_message'
      ? normalizeWorkspaceSessionMessagePreview(latestAssistantMessage.payload.text)
      : params.previousProjection?.latestAssistantMessagePreview,
    lastPersistedTurnStartedAt: params.turn.startedAt,
    lastPersistedTurnFinishedAt: params.turn.finishedAt,
    lastPersistedTurnStatus: params.turn.status,
    deletedTurnCount: params.deletedTurnCount,
    updatedAt: latestEvent?.createdAt ?? params.turn.finishedAt ?? params.turn.startedAt,
  } satisfies Omit<WorkspaceSessionHistoryProjection, 'hasPersistedHistory' | 'latestPreviewText'>
}

const lockWorkspaceSessionHistory = async (tx: DrizzleTx, sessionId: string) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`)
}

const getLastSessionSeq = async (tx: DrizzleTx, sessionId: string) => {
  const rows = await tx
    .select({
      lastSessionSeq: sql<number>`COALESCE(MAX(${workspaceSessionHistoryEvents.sessionSeq}), 0)`.mapWith(Number),
    })
    .from(workspaceSessionHistoryEvents)
    .where(eq(workspaceSessionHistoryEvents.sessionId, sessionId))

  return rows[0]?.lastSessionSeq ?? 0
}

const getLastTurnSeq = async (tx: DrizzleTx, sessionId: string, turnId: string) => {
  const rows = await tx
    .select({
      lastTurnSeq: sql<number>`COALESCE(MAX(${workspaceSessionHistoryEvents.turnSeq}), 0)`.mapWith(Number),
    })
    .from(workspaceSessionHistoryEvents)
    .where(and(
      eq(workspaceSessionHistoryEvents.sessionId, sessionId),
      eq(workspaceSessionHistoryEvents.turnId, turnId),
    ))

  return rows[0]?.lastTurnSeq ?? 0
}

const selectProjectionBySessionId = async (executor: DrizzleExecutor, sessionId: string) => {
  const rows = await executor
    .select()
    .from(workspaceSessionHistoryProjection)
    .where(eq(workspaceSessionHistoryProjection.sessionId, sessionId))
    .limit(1)

  return rows[0] ? mapProjectionRow(rows[0]) : null
}

const upsertRuntimeSnapshot = async (
  executor: DrizzleExecutor,
  runtime: WorkspaceSessionRuntimeSnapshot,
) => {
  const activeToolCalls = runtime.activeToolCalls ?? []
  await executor
    .insert(workspaceSessionHistoryRuntime)
    .values({
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      workspaceId: runtime.workspaceId,
      agentRunningStatus: runtime.agentRunningStatus,
      runtimeStatus: runtime.runtimeStatus ?? null,
      currentStep: runtime.currentStep,
      queueStatus: runtime.queueStatus,
      activeToolCallsJson: activeToolCalls,
      lastEventSeq: runtime.lastEventSeq,
      lastEventAt: runtime.lastEventAt ?? null,
      updatedAt: runtime.updatedAt,
    })
    .onConflictDoUpdate({
      target: workspaceSessionHistoryRuntime.sessionId,
      set: {
        taskId: runtime.taskId,
        workspaceId: runtime.workspaceId,
        agentRunningStatus: runtime.agentRunningStatus,
        runtimeStatus: runtime.runtimeStatus ?? null,
        currentStep: runtime.currentStep,
        queueStatus: runtime.queueStatus,
        activeToolCallsJson: activeToolCalls,
        lastEventSeq: runtime.lastEventSeq,
        lastEventAt: runtime.lastEventAt ?? null,
        updatedAt: runtime.updatedAt,
      },
    })
}

export const initWorkspaceSessionHistoryStore = async () => {
  await ensurePostgresReady()
}

export const getWorkspaceSessionHistoryProjection = async (sessionId: string) => {
  await ensurePostgresReady()
  return cloneJson(await selectProjectionBySessionId(getDrizzleDb(), sessionId))
}

export const workspaceSessionHasPersistedHistory = async (sessionId: string) => {
  const projection = await getWorkspaceSessionHistoryProjection(sessionId)
  return projection?.hasPersistedHistory ?? false
}

export const appendWorkspaceSessionSystemMessage = async (
  input: AppendWorkspaceSessionSystemMessageInput,
) => {
  const message = input.message.trim()
  if (!message) {
    return null
  }

  const timestamp = input.createdAt ?? new Date().toISOString()
  let persistedEvent: Extract<WorkspaceSessionEventRecord, { kind: 'system_message' }> | null = null

  await withDrizzleTransaction(async (tx) => {
    await lockWorkspaceSessionHistory(tx, input.sessionId)
    const previousProjection = await selectProjectionBySessionId(tx, input.sessionId)
    const nextSessionSeq = (await getLastSessionSeq(tx, input.sessionId)) + 1
    const turnId = input.turnId?.trim() || `system:${input.eventId ?? crypto.randomUUID()}`
    const nextTurnSeq = (await getLastTurnSeq(tx, input.sessionId, turnId)) + 1

    persistedEvent = {
      id: input.eventId?.trim() || crypto.randomUUID(),
      sessionId: input.sessionId,
      turnId,
      sessionSeq: nextSessionSeq,
      turnSeq: nextTurnSeq,
      createdAt: timestamp,
      kind: 'system_message',
      visibility: input.visibility ?? resolveWorkspaceSessionSystemMessageVisibility({
        message,
        turnId,
      }),
      payload: {
        message,
      },
    }

    await tx
      .insert(workspaceSessionHistoryEvents)
      .values({
        id: persistedEvent.id,
        sessionId: input.sessionId,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        turnId: persistedEvent.turnId,
        sessionSeq: persistedEvent.sessionSeq,
        turnSeq: persistedEvent.turnSeq,
        kind: persistedEvent.kind,
        visibility: persistedEvent.visibility,
        createdAt: persistedEvent.createdAt,
        payloadJson: persistedEvent.payload,
      })
      .onConflictDoNothing()

    await tx
      .update(workspaceSessionHistoryRuntime)
      .set({
        lastEventSeq: persistedEvent.sessionSeq,
        lastEventAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(workspaceSessionHistoryRuntime.sessionId, input.sessionId))

    const nextProjection = {
      sessionId: input.sessionId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      latestTurnId: turnId,
      latestEventKind: 'system_message' as const,
      latestEventSeq: persistedEvent.sessionSeq,
      totalEventCount: (previousProjection?.totalEventCount ?? 0) + 1,
      lastEventAt: timestamp,
      latestUserMessageId: previousProjection?.latestUserMessageId,
      latestUserMessagePreview: previousProjection?.latestUserMessagePreview,
      latestAssistantMessageId: previousProjection?.latestAssistantMessageId,
      latestAssistantMessagePreview: previousProjection?.latestAssistantMessagePreview,
      lastPersistedTurnStartedAt: previousProjection?.lastPersistedTurnStartedAt,
      lastPersistedTurnFinishedAt: previousProjection?.lastPersistedTurnFinishedAt,
      lastPersistedTurnStatus: previousProjection?.lastPersistedTurnStatus,
      deletedTurnCount: previousProjection?.deletedTurnCount ?? 0,
      updatedAt: timestamp,
    } satisfies Omit<WorkspaceSessionHistoryProjection, 'hasPersistedHistory' | 'latestPreviewText'>
    await upsertWorkspaceSessionHistoryProjection(tx, nextProjection)
  })

  if (persistedEvent) {
    publishWorkspaceSessionHistoryEvent(input.sessionId, persistedEvent)
  }

  return cloneJson(persistedEvent)
}

const logWorkspaceSessionHistoryStoreMetric = (event: string, detail: Record<string, unknown>) => {
  console.info(`[workspace-session-history][store] ${event}`, JSON.stringify(detail))
}

const rebuildWorkspaceSessionHistoryProjection = async (tx: DrizzleTx, sessionId: string) => {
  const projectionResult = await tx.execute(sql`
    WITH deleted_turns AS (
      SELECT payload_json->>'deletedTurnId' AS deleted_turn_id
      FROM workspace_session_history_events
      WHERE session_id = ${sessionId} AND kind = 'turn_deleted'
    ),
    visible_events AS (
      SELECT *
      FROM workspace_session_history_events
      WHERE session_id = ${sessionId}
        AND kind <> 'turn_deleted'
        AND turn_id NOT IN (SELECT deleted_turn_id FROM deleted_turns WHERE deleted_turn_id IS NOT NULL)
    ),
    latest_event AS (
      SELECT *
      FROM visible_events
      ORDER BY session_seq DESC
      LIMIT 1
    ),
    latest_user_message AS (
      SELECT *
      FROM visible_events
      WHERE kind = 'user_message'
      ORDER BY session_seq DESC
      LIMIT 1
    ),
    latest_assistant_message AS (
      SELECT *
      FROM visible_events
      WHERE kind = 'assistant_message'
      ORDER BY session_seq DESC
      LIMIT 1
    ),
    latest_turn AS (
      SELECT *
      FROM workspace_session_history_turns
      WHERE session_id = ${sessionId}
      ORDER BY first_seq DESC NULLS LAST, started_at DESC
      LIMIT 1
    ),
    deleted_turn_stats AS (
      SELECT COUNT(*)::int AS deleted_turn_count
      FROM workspace_session_history_events
      WHERE session_id = ${sessionId} AND kind = 'turn_deleted'
    )
    SELECT
      latest_event.session_id,
      latest_event.task_id,
      latest_event.workspace_id,
      latest_event.turn_id AS latest_turn_id,
      latest_event.kind AS latest_event_kind,
      latest_event.session_seq AS latest_event_seq,
      (SELECT COUNT(*)::int FROM visible_events) AS total_event_count,
      latest_event.created_at AS last_event_at,
      latest_user_message.payload_json->>'messageId' AS latest_user_message_id,
      latest_user_message.payload_json->>'text' AS latest_user_message_preview,
      latest_assistant_message.payload_json->>'messageId' AS latest_assistant_message_id,
      latest_assistant_message.payload_json->>'text' AS latest_assistant_message_preview,
      latest_turn.started_at AS last_persisted_turn_started_at,
      latest_turn.finished_at AS last_persisted_turn_finished_at,
      latest_turn.status AS last_persisted_turn_status,
      deleted_turn_stats.deleted_turn_count,
      COALESCE(latest_event.created_at, latest_turn.finished_at, latest_turn.started_at) AS updated_at
    FROM latest_event
    CROSS JOIN deleted_turn_stats
    LEFT JOIN latest_user_message ON TRUE
    LEFT JOIN latest_assistant_message ON TRUE
    LEFT JOIN latest_turn ON TRUE
  `)

  const rebuiltRow = (projectionResult.rows as RebuiltProjectionQueryRow[])[0]
  if (!rebuiltRow || !rebuiltRow.session_id || !rebuiltRow.task_id || !rebuiltRow.workspace_id) {
    await tx
      .delete(workspaceSessionHistoryProjection)
      .where(eq(workspaceSessionHistoryProjection.sessionId, sessionId))
    return null
  }

  const rebuiltProjection = mapProjectionRow({
    sessionId: rebuiltRow.session_id,
    taskId: rebuiltRow.task_id,
    workspaceId: rebuiltRow.workspace_id,
    latestTurnId: rebuiltRow.latest_turn_id,
    latestEventKind: rebuiltRow.latest_event_kind,
    latestEventSeq: rebuiltRow.latest_event_seq ?? 0,
    totalEventCount: rebuiltRow.total_event_count ?? 0,
    lastEventAt: rebuiltRow.last_event_at,
    latestUserMessageId: rebuiltRow.latest_user_message_id,
    latestUserMessagePreview: normalizeWorkspaceSessionMessagePreview(rebuiltRow.latest_user_message_preview ?? ''),
    latestAssistantMessageId: rebuiltRow.latest_assistant_message_id,
    latestAssistantMessagePreview: normalizeWorkspaceSessionMessagePreview(rebuiltRow.latest_assistant_message_preview ?? ''),
    lastPersistedTurnStartedAt: rebuiltRow.last_persisted_turn_started_at,
    lastPersistedTurnFinishedAt: rebuiltRow.last_persisted_turn_finished_at,
    lastPersistedTurnStatus: rebuiltRow.last_persisted_turn_status,
    deletedTurnCount: rebuiltRow.deleted_turn_count ?? 0,
    updatedAt: rebuiltRow.updated_at ?? new Date().toISOString(),
  })
  await upsertWorkspaceSessionHistoryProjection(tx, rebuiltProjection)
  return rebuiltProjection
}

export const persistWorkspaceSessionTurnHistory = async (input: PersistWorkspaceSessionTurnHistoryInput) => {
  if (input.events.length === 0) {
    return
  }

  const sortedEvents = [...input.events].sort((left, right) => left.turnSeq - right.turnSeq)
  let insertedEvents: WorkspaceSessionEventRecord[] = []
  let persistedTurnEvents: WorkspaceSessionEventRecord[] = []
  let persistedRuntime: WorkspaceSessionRuntimeSnapshot | null = null
  let publishedRuntime: WorkspaceSessionRuntimeSnapshot | null = null
  const persistedLineage = buildWorkspaceSessionTurnLineage({
    sourceSessionId: input.sourceSessionId,
    pendingRevision: input.pendingRevision,
    events: sortedEvents,
  })

  await withDrizzleTransaction(async (tx) => {
    await lockWorkspaceSessionHistory(tx, input.sessionId)
    const previousProjection = await selectProjectionBySessionId(tx, input.sessionId)
    const nextSessionSeq = (await getLastSessionSeq(tx, input.sessionId)) + 1
    const candidateEvents = sortedEvents.map((event, index) => {
      const nextEvent = {
        ...event,
        sessionSeq: nextSessionSeq + index,
      }

      if (nextEvent.kind !== 'tool_call') {
        return nextEvent
      }

      return {
        ...nextEvent,
        payload: {
          toolCall: sanitizeToolCallForPersistence(nextEvent.payload.toolCall),
        },
      }
    })

    for (const event of candidateEvents) {
      const insertResult = await tx
        .insert(workspaceSessionHistoryEvents)
        .values({
          id: event.id,
          sessionId: input.sessionId,
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          turnId: input.turn.id,
          sessionSeq: event.sessionSeq,
          turnSeq: event.turnSeq,
          kind: event.kind,
          visibility: event.visibility,
          createdAt: event.createdAt,
          payloadJson: event.payload,
        })
        .onConflictDoNothing()
        .returning({ id: workspaceSessionHistoryEvents.id })

      if (insertResult.length > 0) {
        insertedEvents.push(event)
      }
    }

    const persistedTurnRows = await tx
      .select()
      .from(workspaceSessionHistoryEvents)
      .where(and(
        eq(workspaceSessionHistoryEvents.sessionId, input.sessionId),
        eq(workspaceSessionHistoryEvents.turnId, input.turn.id),
      ))
      .orderBy(asc(workspaceSessionHistoryEvents.sessionSeq))

    persistedTurnEvents = persistedTurnRows.map(mapEventRow)
    const firstSeq = persistedTurnEvents[0]?.sessionSeq ?? null
    const lastSeq = persistedTurnEvents.at(-1)?.sessionSeq ?? null
    persistedRuntime = {
      ...input.runtime,
      activeToolCalls: sanitizeToolCallsForPersistence(input.runtime.activeToolCalls ?? []),
      lastEventSeq: lastSeq ?? input.runtime.lastEventSeq,
      lastEventAt: persistedTurnEvents.at(-1)?.createdAt ?? input.runtime.lastEventAt,
    }
    publishedRuntime = {
      ...input.runtime,
      lastEventSeq: lastSeq ?? input.runtime.lastEventSeq,
      lastEventAt: persistedTurnEvents.at(-1)?.createdAt ?? input.runtime.lastEventAt,
    }

    await tx
      .insert(workspaceSessionHistoryTurns)
      .values({
        id: input.turn.id,
        sessionId: input.sessionId,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        status: input.turn.status,
        startedAt: input.turn.startedAt,
        finishedAt: input.turn.finishedAt ?? null,
        firstSeq,
        lastSeq,
        eventCount: persistedTurnEvents.length,
        usageJson: input.turn.usage ?? null,
        lineageJson: persistedLineage ?? input.turn.lineage ?? null,
      })
      .onConflictDoUpdate({
        target: workspaceSessionHistoryTurns.id,
        set: {
          status: input.turn.status,
          finishedAt: input.turn.finishedAt ?? null,
          firstSeq,
          lastSeq,
          eventCount: persistedTurnEvents.length,
          usageJson: input.turn.usage ?? null,
          lineageJson: persistedLineage ?? input.turn.lineage ?? null,
        },
      })

    await upsertRuntimeSnapshot(tx, persistedRuntime)

    const nextProjection = buildWorkspaceSessionHistoryProjectionFromEvents({
      sessionId: input.sessionId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      turn: {
        ...input.turn,
        firstSessionSeq: firstSeq ?? undefined,
        lastSessionSeq: lastSeq ?? undefined,
        eventCount: persistedTurnEvents.length,
        lineage: persistedLineage ?? input.turn.lineage,
      },
      events: persistedTurnEvents,
      totalEventCount: (previousProjection?.totalEventCount ?? 0) + insertedEvents.length,
      deletedTurnCount: previousProjection?.deletedTurnCount ?? 0,
      previousProjection,
    })
    await upsertWorkspaceSessionHistoryProjection(tx, nextProjection)
  })

  for (const event of insertedEvents) {
    publishWorkspaceSessionHistoryEvent(input.sessionId, event)
  }
  if (publishedRuntime) {
    publishWorkspaceSessionHistoryRuntime(input.sessionId, publishedRuntime)
  }
}

export const getWorkspaceSessionRuntimeSnapshot = async (sessionId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(workspaceSessionHistoryRuntime)
    .where(eq(workspaceSessionHistoryRuntime.sessionId, sessionId))
    .limit(1)

  return cloneJson(rows[0] ? mapRuntimeRow(rows[0]) : null)
}

export const listWorkspaceSessionTurns = async (sessionId: string, limit = 50) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(workspaceSessionHistoryTurns)
    .where(eq(workspaceSessionHistoryTurns.sessionId, sessionId))
    .orderBy(desc(workspaceSessionHistoryTurns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 200))

  return cloneJson(rows.map(mapTurnRow))
}

export const deleteWorkspaceSessionPersistedHistory = async (params: {
  workspaceIds?: string[]
  sessionIds?: string[]
}) => {
  const workspaceIdSet = params.workspaceIds ? [...new Set(params.workspaceIds.filter(Boolean))] : []
  const sessionIdSet = params.sessionIds ? [...new Set(params.sessionIds.filter(Boolean))] : []

  if (workspaceIdSet.length === 0 && sessionIdSet.length === 0) {
    return
  }

  await withDrizzleTransaction(async (tx) => {
    if (workspaceIdSet.length > 0 && sessionIdSet.length > 0) {
      const bothTables = [
        workspaceSessionHistoryProjection,
        workspaceSessionHistoryRuntime,
        workspaceSessionHistoryEvents,
        workspaceSessionHistoryTurns,
      ] as const
      for (const table of bothTables) {
        await tx
          .delete(table)
          .where(and(
            inArray(table.workspaceId, workspaceIdSet),
            inArray(table.sessionId, sessionIdSet),
          ))
      }
      return
    }

    if (workspaceIdSet.length > 0) {
      const tables = [
        workspaceSessionHistoryProjection,
        workspaceSessionHistoryRuntime,
        workspaceSessionHistoryEvents,
        workspaceSessionHistoryTurns,
      ] as const
      for (const table of tables) {
        await tx.delete(table).where(inArray(table.workspaceId, workspaceIdSet))
      }
      return
    }

    const tables = [
      workspaceSessionHistoryProjection,
      workspaceSessionHistoryRuntime,
      workspaceSessionHistoryEvents,
      workspaceSessionHistoryTurns,
    ] as const
    for (const table of tables) {
      await tx.delete(table).where(inArray(table.sessionId, sessionIdSet))
    }
  })
}

export const upsertWorkspaceSessionRuntimeSnapshot = async (runtime: WorkspaceSessionRuntimeSnapshot) => {
  const persistedRuntime = {
    ...runtime,
    activeToolCalls: sanitizeToolCallsForPersistence(runtime.activeToolCalls ?? []),
  }

  await ensurePostgresReady()
  await upsertRuntimeSnapshot(getDrizzleDb(), persistedRuntime)
  publishWorkspaceSessionHistoryRuntime(runtime.sessionId, runtime)
}

export const deleteWorkspaceSessionTurn = async (
  input: DeleteWorkspaceSessionTurnInput,
): Promise<WorkspaceSessionTurnDeleteResult> => {
  let persistedEvent: Extract<WorkspaceSessionEventRecord, { kind: 'turn_deleted' }> | null = null
  let persistedRuntime: WorkspaceSessionRuntimeSnapshot | null = null
  let failureReason: WorkspaceSessionTurnDeleteFailureReason | null = null

  await withDrizzleTransaction(async (tx) => {
    await lockWorkspaceSessionHistory(tx, input.sessionId)

    const turnRows = await tx
      .select()
      .from(workspaceSessionHistoryTurns)
      .where(and(
        eq(workspaceSessionHistoryTurns.sessionId, input.sessionId),
        eq(workspaceSessionHistoryTurns.id, input.turnId),
      ))
      .limit(1)
    const turnRow = turnRows[0]
    if (!turnRow) {
      failureReason = 'not_found'
      return
    }

    const deletionRows = await tx
      .select()
      .from(workspaceSessionHistoryEvents)
      .where(and(
        eq(workspaceSessionHistoryEvents.sessionId, input.sessionId),
        eq(workspaceSessionHistoryEvents.kind, 'turn_deleted'),
        sql`${workspaceSessionHistoryEvents.payloadJson}->>'deletedTurnId' = ${input.turnId}`,
      ))
      .limit(1)
    if (deletionRows.length > 0) {
      failureReason = 'already_deleted'
      return
    }

    const latestTurnRows = await tx
      .select()
      .from(workspaceSessionHistoryTurns)
      .where(eq(workspaceSessionHistoryTurns.sessionId, input.sessionId))
      .orderBy(
        sql`${workspaceSessionHistoryTurns.firstSeq} DESC NULLS LAST`,
        desc(workspaceSessionHistoryTurns.startedAt),
      )
      .limit(1)
    const latestTurn = latestTurnRows[0]
    if (!latestTurn || latestTurn.id !== input.turnId) {
      failureReason = 'not_latest'
      return
    }

    const outputRows = await tx
      .select()
      .from(workspaceSessionHistoryEvents)
      .where(and(
        eq(workspaceSessionHistoryEvents.sessionId, input.sessionId),
        eq(workspaceSessionHistoryEvents.turnId, input.turnId),
        inArray(workspaceSessionHistoryEvents.kind, [
          'assistant_message',
          'system_message',
          'thinking',
          'tool_call',
          'error',
        ]),
      ))
      .limit(1)
    if (outputRows.length > 0) {
      failureReason = 'has_assistant_output'
      return
    }

    const nextSessionSeq = (await getLastSessionSeq(tx, input.sessionId)) + 1
    const timestamp = new Date().toISOString()
    persistedEvent = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      sessionSeq: nextSessionSeq,
      turnSeq: (turnRow.eventCount || 0) + 1,
      createdAt: timestamp,
      visibility: 'hidden',
      kind: 'turn_deleted',
      payload: {
        deletedTurnId: input.turnId,
        deletedMessageId: input.deletedMessageId,
      },
    }

    const deletedEvent = persistedEvent

    await tx
      .insert(workspaceSessionHistoryEvents)
      .values({
        id: deletedEvent.id,
        sessionId: input.sessionId,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        turnId: input.turnId,
        sessionSeq: deletedEvent.sessionSeq,
        turnSeq: deletedEvent.turnSeq,
        kind: deletedEvent.kind,
        visibility: deletedEvent.visibility,
        createdAt: deletedEvent.createdAt,
        payloadJson: deletedEvent.payload,
      })

    await tx
      .update(workspaceSessionHistoryTurns)
      .set({
        status: 'cancelled',
        finishedAt: timestamp,
        lastSeq: deletedEvent.sessionSeq,
        eventCount: deletedEvent.turnSeq,
      })
      .where(and(
        eq(workspaceSessionHistoryTurns.sessionId, input.sessionId),
        eq(workspaceSessionHistoryTurns.id, input.turnId),
      ))

    const runtimeRows = await tx
      .select()
      .from(workspaceSessionHistoryRuntime)
      .where(eq(workspaceSessionHistoryRuntime.sessionId, input.sessionId))
      .limit(1)
    const runtimeRow = runtimeRows[0]
    if (runtimeRow) {
      persistedRuntime = {
        ...mapRuntimeRow(runtimeRow),
        lastEventSeq: deletedEvent.sessionSeq,
        lastEventAt: deletedEvent.createdAt,
        updatedAt: deletedEvent.createdAt,
      }

      await tx
        .update(workspaceSessionHistoryRuntime)
        .set({
          lastEventSeq: persistedRuntime.lastEventSeq,
          lastEventAt: persistedRuntime.lastEventAt ?? null,
          updatedAt: persistedRuntime.updatedAt,
        })
        .where(eq(workspaceSessionHistoryRuntime.sessionId, input.sessionId))
    }

    await rebuildWorkspaceSessionHistoryProjection(tx, input.sessionId)
  })

  if (!persistedEvent) {
    return {
      ok: false,
      reason: failureReason ?? 'not_found',
    }
  }

  publishWorkspaceSessionHistoryEvent(input.sessionId, persistedEvent)
  if (persistedRuntime) {
    publishWorkspaceSessionHistoryRuntime(input.sessionId, persistedRuntime)
  }

  return {
    ok: true,
    event: persistedEvent,
    runtime: persistedRuntime,
  }
}

export const listWorkspaceSessionEvents = async (params: {
  sessionId: string
  afterSessionSeq?: number
  beforeSessionSeq?: number
  limit?: number
  visibility?: WorkspaceSessionEventVisibility | 'all'
}) => {
  const startedAt = Date.now()
  await ensurePostgresReady()
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const visibility = params.visibility ?? 'transcript'
  const useBackwardPage = typeof params.beforeSessionSeq === 'number'
    || (typeof params.afterSessionSeq !== 'number' && typeof params.beforeSessionSeq !== 'number')

  const buildEventConditions = (extra: SQL[] = []) => {
    const conditions: SQL[] = [
      eq(workspaceSessionHistoryEvents.sessionId, params.sessionId),
      ...extra,
    ]
    if (visibility !== 'all') {
      conditions.push(eq(workspaceSessionHistoryEvents.visibility, visibility))
    }
    return and(...conditions)
  }

  const pageConditions: SQL[] = []
  if (typeof params.afterSessionSeq === 'number') {
    pageConditions.push(gt(workspaceSessionHistoryEvents.sessionSeq, params.afterSessionSeq))
  }
  if (typeof params.beforeSessionSeq === 'number') {
    pageConditions.push(lt(workspaceSessionHistoryEvents.sessionSeq, params.beforeSessionSeq))
  }

  let eventRows: WorkspaceSessionHistoryEventRow[]
  if (useBackwardPage) {
    const descendingRows = await getDrizzleDb()
      .select()
      .from(workspaceSessionHistoryEvents)
      .where(buildEventConditions(pageConditions))
      .orderBy(desc(workspaceSessionHistoryEvents.sessionSeq))
      .limit(limit)
    eventRows = descendingRows.slice().reverse()
  } else {
    eventRows = await getDrizzleDb()
      .select()
      .from(workspaceSessionHistoryEvents)
      .where(buildEventConditions(pageConditions))
      .orderBy(asc(workspaceSessionHistoryEvents.sessionSeq))
      .limit(limit)
  }

  let events = eventRows.map(mapEventRow)

  if (events.length > 0 && useBackwardPage) {
    const leadingTurnId = events[0]?.turnId
    const firstSeq = events[0]?.sessionSeq
    if (leadingTurnId && typeof firstSeq === 'number') {
      const leadingTurnRows = await getDrizzleDb()
        .select()
        .from(workspaceSessionHistoryEvents)
        .where(buildEventConditions([
          eq(workspaceSessionHistoryEvents.turnId, leadingTurnId),
          lt(workspaceSessionHistoryEvents.sessionSeq, firstSeq),
        ]))
        .orderBy(asc(workspaceSessionHistoryEvents.sessionSeq))
      const leadingTurnEvents = leadingTurnRows.map(mapEventRow)
      if (leadingTurnEvents.length > 0) {
        events = [...leadingTurnEvents, ...events]
      }
    }
  }

  const firstSeq = events[0]?.sessionSeq
  const lastSeq = events.at(-1)?.sessionSeq
  const countBeforeRows = typeof firstSeq === 'number'
    ? await getDrizzleDb()
      .select({ sessionSeq: workspaceSessionHistoryEvents.sessionSeq })
      .from(workspaceSessionHistoryEvents)
      .where(buildEventConditions([lt(workspaceSessionHistoryEvents.sessionSeq, firstSeq)]))
      .orderBy(desc(workspaceSessionHistoryEvents.sessionSeq))
      .limit(2000)
    : null
  const countAfterRows = typeof lastSeq === 'number'
    ? await getDrizzleDb()
      .select({ sessionSeq: workspaceSessionHistoryEvents.sessionSeq })
      .from(workspaceSessionHistoryEvents)
      .where(buildEventConditions([gt(workspaceSessionHistoryEvents.sessionSeq, lastSeq)]))
      .orderBy(asc(workspaceSessionHistoryEvents.sessionSeq))
      .limit(2000)
    : null
  const totalRows = await getDrizzleDb()
    .select({ count: sql<number>`COUNT(*)::int`.mapWith(Number) })
    .from(workspaceSessionHistoryEvents)
    .where(buildEventConditions())
  const totalCount = totalRows[0]?.count ?? 0
  const countBefore = countBeforeRows?.length ?? 0
  const countAfter = countAfterRows?.length ?? 0

  const page: WorkspaceSessionEventsPage = {
    protocolVersion: 'v1alpha1',
    sessionId: params.sessionId,
    events,
    totalCount,
    hasMoreBefore: countBefore > 0,
    hasMoreAfter: countAfter > 0,
    visibility,
  }

  logWorkspaceSessionHistoryStoreMetric('list-events', {
    sessionId: params.sessionId,
    afterSessionSeq: params.afterSessionSeq ?? null,
    beforeSessionSeq: params.beforeSessionSeq ?? null,
    useBackwardPage,
    returnedCount: events.length,
    totalCount,
    visibility,
    firstSessionSeq: firstSeq ?? null,
    lastSessionSeq: lastSeq ?? null,
    hasMoreBefore: page.hasMoreBefore,
    hasMoreAfter: page.hasMoreAfter,
    durationMs: Date.now() - startedAt,
  })

  return cloneJson(page)
}
