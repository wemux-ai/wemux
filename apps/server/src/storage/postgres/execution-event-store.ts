import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'

import type { ExecutionEventCursor, ExecutionEventLayer, ExecutionEventLogRecord, ExecutionEventSeverity, ExecutionEventType } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { schedulePersistence } from './helpers'
import { executionEventLogs } from './schema'

type ExecutionEventRow = typeof executionEventLogs.$inferSelect

type CreateExecutionEventInput = {
  occurredAt?: string
  eventType: ExecutionEventType
  severity?: ExecutionEventSeverity
  isFailure?: boolean
  message: string
  payload?: Record<string, unknown>
  executorId?: string
  executorName?: string
  taskId?: string
  originTaskId?: string
  projectId?: string
  ownerUserId?: string
  teamId?: string
  layer?: ExecutionEventLayer
}

const ERROR_STATUSES = new Set(['failed', 'lost', 'timed_out'])
const recentHeartbeatFingerprints = new Map<string, { fingerprint: string; occurredAt: number }>()

const truncate = (value: string, maxLength = 280) => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}...`
}

const summarizePayload = (payload?: Record<string, unknown>) => {
  if (!payload) {
    return ''
  }

  if (typeof payload.runningTaskIds !== 'undefined' || typeof payload.queuedTaskIds !== 'undefined') {
    const running = Array.isArray(payload.runningTaskIds) ? payload.runningTaskIds.length : 0
    const queued = Array.isArray(payload.queuedTaskIds) ? payload.queuedTaskIds.length : 0
    return `running=${running}, queued=${queued}`
  }

  if (typeof payload.accepted === 'boolean') {
    return payload.accepted ? 'accepted=true' : `accepted=false${payload.reason ? `, reason=${String(payload.reason)}` : ''}`
  }

  if (typeof payload.status === 'string') {
    return truncate(
      [
        `status=${payload.status}`,
        payload.message ? `message=${String(payload.message)}` : '',
      ].filter(Boolean).join(', '),
    )
  }

  if (payload.task && typeof payload.task === 'object' && payload.task !== null) {
    const task = payload.task as Record<string, unknown>
    return truncate(
      [
        task.status ? `status=${String(task.status)}` : '',
        task.returnMode ? `returnMode=${String(task.returnMode)}` : '',
        task.errorMessage ? `error=${String(task.errorMessage)}` : '',
      ].filter(Boolean).join(', '),
    )
  }

  return truncate(JSON.stringify(payload))
}

const detectLayer = (eventType: ExecutionEventType, message: string, payload?: Record<string, unknown>): ExecutionEventLayer => {
  const haystack = `${eventType} ${message} ${payload ? JSON.stringify(payload) : ''}`.toLowerCase()

  if (haystack.includes('pair') || haystack.includes('配对')) return 'pairing'
  if (haystack.includes('disconnect') || haystack.includes('reconnect') || haystack.includes('heartbeat') || haystack.includes('websocket') || haystack.includes('连接')) return 'connection'
  if (haystack.includes('repo') || haystack.includes('clone') || haystack.includes('checkout') || haystack.includes('workspace') || haystack.includes('worktree') || haystack.includes('仓库')) return 'repo_prepare'
  if (haystack.includes('opencode') || haystack.includes('model') || haystack.includes('session')) return 'opencode'
  if (haystack.includes('git') || haystack.includes('patch') || haystack.includes('branch') || haystack.includes('commit')) return 'git'
  if (haystack.includes('sync') || haystack.includes('回传') || haystack.includes('回写') || haystack.includes('upload')) return 'sync_back'
  return 'unknown'
}

const detectSeverity = (input: CreateExecutionEventInput): ExecutionEventSeverity => {
  if (input.severity) {
    return input.severity
  }

  if (input.eventType === 'error') {
    return 'error'
  }

  if (input.eventType === 'disconnect' || input.eventType === 'reconnect') {
    return 'connection'
  }

  if (input.eventType === 'heartbeat') {
    return 'normal'
  }

  return 'state_change'
}

const detectFailure = (input: CreateExecutionEventInput) => {
  if (typeof input.isFailure === 'boolean') {
    return input.isFailure
  }

  if (input.eventType === 'error' || input.eventType === 'disconnect') {
    return true
  }

  if (input.payload?.accepted === false) {
    return true
  }

  if (typeof input.payload?.status === 'string' && ERROR_STATUSES.has(input.payload.status)) {
    return true
  }

  if (input.payload?.task && typeof input.payload.task === 'object' && input.payload.task !== null) {
    const status = (input.payload.task as Record<string, unknown>).status
    return typeof status === 'string' && ERROR_STATUSES.has(status)
  }

  return false
}

const shouldSkipEvent = (input: CreateExecutionEventInput, occurredAt: string) => {
  if (input.eventType !== 'heartbeat' || !input.executorId) {
    return false
  }

  const running = Array.isArray(input.payload?.runningTaskIds) ? input.payload?.runningTaskIds.join(',') : ''
  const queued = Array.isArray(input.payload?.queuedTaskIds) ? input.payload?.queuedTaskIds.join(',') : ''
  const fingerprint = `${running}|${queued}`
  const currentAt = new Date(occurredAt).getTime()
  const previous = recentHeartbeatFingerprints.get(input.executorId)

  recentHeartbeatFingerprints.set(input.executorId, { fingerprint, occurredAt: currentAt })

  if (previous && previous.fingerprint === fingerprint && currentAt - previous.occurredAt < 60_000) {
    return true
  }

  if (recentHeartbeatFingerprints.size > 200) {
    const threshold = Date.now() - 10 * 60_000
    for (const [executorId, snapshot] of recentHeartbeatFingerprints.entries()) {
      if (snapshot.occurredAt < threshold) {
        recentHeartbeatFingerprints.delete(executorId)
      }
    }
  }

  return false
}

const mapRow = (row: ExecutionEventRow): ExecutionEventLogRecord => ({
  id: row.id,
  occurredAt: row.occurredAt,
  eventType: row.eventType,
  severity: row.severity,
  isFailure: row.isFailure,
  message: row.message,
  payloadSummary: row.payloadSummary,
  rawPayload: row.payloadJson ?? undefined,
  executorId: row.executorId ?? undefined,
  executorName: row.executorName ?? undefined,
  taskId: row.taskId ?? undefined,
  originTaskId: row.originTaskId ?? undefined,
  projectId: row.projectId ?? undefined,
  layer: row.layer ?? undefined,
})

export const createExecutionEvent = (input: CreateExecutionEventInput) => {
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  if (shouldSkipEvent(input, occurredAt)) {
    return
  }

  const severity = detectSeverity(input)
  const isFailure = detectFailure(input)
  const layer = input.layer ?? detectLayer(input.eventType, input.message, input.payload)
  const payloadSummary = summarizePayload(input.payload)

  schedulePersistence(
    `execution-event:${input.eventType}:${input.executorId ?? 'unknown'}`,
    (async () => {
      await ensurePostgresReady()
      await getDrizzleDb()
        .insert(executionEventLogs)
        .values({
          id: crypto.randomUUID(),
          occurredAt,
          eventType: input.eventType,
          severity,
          isFailure,
          message: input.message,
          payloadSummary,
          payloadJson: input.payload ?? null,
          executorId: input.executorId ?? null,
          executorName: input.executorName ?? null,
          taskId: input.taskId ?? null,
          originTaskId: input.originTaskId ?? null,
          projectId: input.projectId ?? null,
          ownerUserId: input.ownerUserId ?? null,
          teamId: input.teamId ?? null,
          layer,
        })
    })(),
  )
}

export const listExecutionEvents = async (params: {
  taskId?: string
  executorId?: string
  eventType?: ExecutionEventType
  layer?: ExecutionEventLayer
  failuresOnly?: boolean
  limit?: number
  cursor?: ExecutionEventCursor
  projectIds?: string[]
  executorIds?: string[]
  ownerUserId?: string
}) => {
  await ensurePostgresReady()
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500)
  const filters = []

  if (params.taskId) {
    filters.push(or(eq(executionEventLogs.taskId, params.taskId), eq(executionEventLogs.originTaskId, params.taskId)))
  }

  if (params.executorId) {
    filters.push(eq(executionEventLogs.executorId, params.executorId))
  }

  if (params.eventType) {
    filters.push(eq(executionEventLogs.eventType, params.eventType))
  }

  if (params.layer) {
    filters.push(eq(executionEventLogs.layer, params.layer))
  }

  if (params.failuresOnly) {
    filters.push(eq(executionEventLogs.isFailure, true))
  }

  if (params.cursor) {
    filters.push(or(
      lt(executionEventLogs.occurredAt, params.cursor.occurredAt),
      and(eq(executionEventLogs.occurredAt, params.cursor.occurredAt), lt(executionEventLogs.id, params.cursor.id)),
    ))
  }

  const scopeClauses = []
  if (params.projectIds && params.projectIds.length > 0) {
    scopeClauses.push(and(
      isNotNull(executionEventLogs.projectId),
      inArray(executionEventLogs.projectId, params.projectIds),
    ))
  }
  if (params.executorIds && params.executorIds.length > 0) {
    scopeClauses.push(and(
      isNull(executionEventLogs.projectId),
      inArray(executionEventLogs.executorId, params.executorIds),
    ))
  }
  if (params.ownerUserId) {
    scopeClauses.push(and(
      isNull(executionEventLogs.projectId),
      isNull(executionEventLogs.executorId),
      eq(executionEventLogs.ownerUserId, params.ownerUserId),
    ))
  }

  if (scopeClauses.length === 0) {
    return { events: [], nextCursor: null }
  }

  filters.push(or(...scopeClauses))

  const rows = await getDrizzleDb()
    .select()
    .from(executionEventLogs)
    .where(and(...filters))
    .orderBy(desc(executionEventLogs.occurredAt))
    .limit(limit)

  const events = rows.map(mapRow)
  const nextCursor = events.length === limit
    ? {
      occurredAt: events[events.length - 1]!.occurredAt,
      id: events[events.length - 1]!.id,
    }
    : null

  return {
    events,
    nextCursor,
  }
}
