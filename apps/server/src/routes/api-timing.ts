// [INPUT]: Hono app 与请求上下文
// [OUTPUT]: API 请求耗时观测中间件
// [POS]: 请求耗时观测中间件
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Context } from 'hono'
import { emitStructuredLog } from '../services/observability-log-service'

type ApiTimingSegmentName =
  | 'auth/state'
  | 'repo probe'
  | 'workspace list build'
  | 'DB query'
  | 'serialize'

type ApiTimingMeta = {
  route: string
  method?: string
  projectId?: string
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  detail?: Record<string, string | number | boolean | null>
}

type ApiTimingLogMeta = ApiTimingMeta & {
  status: number
  responseBytes?: number
}

const API_TIMING_SEGMENTS: ApiTimingSegmentName[] = [
  'auth/state',
  'repo probe',
  'workspace list build',
  'DB query',
  'serialize',
]

const sanitizeServerTimingName = (name: string) => (
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'segment'
)

const roundDuration = (durationMs: number) => Math.round(durationMs * 10) / 10

const resolveRequestId = (c: Context) => {
  const headerRequestId = c.req.header('x-request-id')?.trim()
  if (headerRequestId) {
    return headerRequestId.slice(0, 128)
  }

  return crypto.randomUUID()
}

export const createApiTiming = (c: Context, meta: ApiTimingMeta) => {
  const startedAt = performance.now()
  const requestId = resolveRequestId(c)
  const segments: Record<ApiTimingSegmentName, number> = {
    'auth/state': 0,
    'repo probe': 0,
    'workspace list build': 0,
    'DB query': 0,
    serialize: 0,
  }

  const record = (name: ApiTimingSegmentName, durationMs: number) => {
    segments[name] += durationMs
  }

  const measure = async <T>(name: ApiTimingSegmentName, action: () => Promise<T>) => {
    const segmentStartedAt = performance.now()
    try {
      return await action()
    } finally {
      record(name, performance.now() - segmentStartedAt)
    }
  }

  const measureSync = <T>(name: ApiTimingSegmentName, action: () => T) => {
    const segmentStartedAt = performance.now()
    try {
      return action()
    } finally {
      record(name, performance.now() - segmentStartedAt)
    }
  }

  const buildServerTimingHeader = (totalMs: number) => [
    ...API_TIMING_SEGMENTS.map((name) => `${sanitizeServerTimingName(name)};dur=${roundDuration(segments[name])}`),
    `total;dur=${roundDuration(totalMs)}`,
  ].join(', ')

  const finalize = (logMeta: ApiTimingLogMeta) => {
    const totalMs = performance.now() - startedAt
    const roundedTotalMs = roundDuration(totalMs)
    c.header('Server-Timing', buildServerTimingHeader(totalMs))
    c.header('X-Request-Id', requestId)

    emitStructuredLog({
      event: 'api_timing',
      route: meta.route,
      method: logMeta.method ?? meta.method ?? c.req.method,
      status: logMeta.status,
      request_id: requestId,
      project_id: logMeta.projectId ?? meta.projectId ?? null,
      task_id: logMeta.taskId ?? meta.taskId ?? null,
      workspace_id: logMeta.workspaceId ?? meta.workspaceId ?? null,
      workspace_session_id: logMeta.workspaceSessionId ?? meta.workspaceSessionId ?? null,
      response_bytes: logMeta.responseBytes ?? null,
      detail: {
        ...(meta.detail ?? {}),
        ...(logMeta.detail ?? {}),
      },
      total_ms: roundedTotalMs,
      segments: {
        ...Object.fromEntries(
          API_TIMING_SEGMENTS.map((name) => [name, roundDuration(segments[name])]),
        ),
        total: roundedTotalMs,
      },
    })
  }

  return {
    measure,
    measureSync,
    finalize,
  }
}

export const timedJson = <T>(
  c: Context,
  timing: ReturnType<typeof createApiTiming>,
  status: 200 | 400 | 401 | 403 | 404 | 409 | 500 | 503,
  body: T,
  meta: ApiTimingMeta,
) => {
  const serializedBody = timing.measureSync('serialize', () => JSON.stringify(body))
  timing.finalize({
    ...meta,
    status,
    responseBytes: Buffer.byteLength(serializedBody),
  })

  return c.body(serializedBody ?? null, status, { 'Content-Type': 'application/json' })
}
