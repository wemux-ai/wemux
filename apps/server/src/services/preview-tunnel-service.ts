// [INPUT]: tunnel 请求
// [OUTPUT]: 隧道管理
// [POS]: preview tunnel 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getEnv } from '@shared/env'
import type {
  PreviewHttpAbortFrame,
  PreviewHttpRequestBodyFrame,
  PreviewHttpRequestEndFrame,
  PreviewHttpRequestStartFrame,
  PreviewHttpResponseBodyFrame,
  PreviewHttpResponseEndFrame,
  PreviewHttpResponseStartFrame,
  PreviewTunnelMetricsDto,
  PreviewTunnelBinaryFrameHeader,
  PreviewTunnelFrame,
  PreviewTunnelPingFrame,
  PreviewTunnelPongFrame,
  PreviewWsCloseFrame,
  PreviewWsDataFrame,
  PreviewWsOpenFrame,
  PreviewWsOpenedFrame,
} from '@shared/types'
import {
  encodePreviewTunnelBinaryFrame,
  normalizePreviewTunnelChunkBytes,
} from '@shared/types'
import { previewSessionService } from './preview-session-service'

type PreviewTunnelSocket = {
  OPEN: number
  readyState: number
  bufferedAmount?: number
  send: (data: string | Uint8Array | Buffer) => void
  close: (code?: number, reason?: string) => void
}

type PreviewGatewaySocket = {
  OPEN: number
  readyState: number
  protocol?: string
  send: (data: string | Uint8Array | Buffer) => void
  close: (code?: number, reason?: string) => void
}

type PreviewTunnelConnection = {
  previewSessionId: string
  connectionId: string
  socket: PreviewTunnelSocket
  binaryPayloads: boolean
  negotiatedChunkBytes: number
  sendQueue: PreviewTunnelQueuedMessage[]
  sendQueueScheduled: boolean
  sendQueueBytes: number
}

type PreviewTunnelSendPriority = 'control' | 'interactive' | 'bulk'

type PreviewTunnelQueuedMessage = {
  priority: PreviewTunnelSendPriority
  size: number
  payload: string | Uint8Array
}

type PendingHttpResponse = {
  resolve: (value: Response) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onTimeout: () => void
  pathWithQuery?: string
  targetUrl?: string
  status?: number
  headers?: Array<[string, string]>
  stream?: ReadableStream<Uint8Array>
  streamController?: ReadableStreamDefaultController<Uint8Array>
  started: boolean
}

type PreviewGatewayWebSocket = {
  previewSessionId: string
  streamId: string
  socket: PreviewGatewaySocket
  opened: boolean
  nextSeq: number
  pendingFrames: PreviewWsDataFrame[]
  pendingBinaryFrames: Array<{
    header: PreviewTunnelBinaryFrameHeader
    payload: Buffer
  }>
  openTimer?: ReturnType<typeof setTimeout>
}

const REQUEST_TIMEOUT_MS = 30_000
const WEBSOCKET_OPEN_TIMEOUT_MS = 10_000
const TUNNEL_LATENCY_PING_INTERVAL_MS = 15_000
const PREVIEW_TUNNEL_SEND_BUFFER_HIGH_WATERMARK_BYTES = 512 * 1024
const PREVIEW_ACCESS_COOKIE = 'vmx_preview_access'
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])
const TUNNEL_DECODED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  // The worker streams decoded fetch bodies through the tunnel.
  'content-encoding',
])

const connections = new Map<string, PreviewTunnelConnection>()
const pendingResponses = new Map<string, PendingHttpResponse>()
const gatewayWebSockets = new Map<string, PreviewGatewayWebSocket>()
const pendingTunnelLatencyPings = new Map<string, {
  pingId: string
  sentAtMs: number
}>()
const tunnelLatencyIntervals = new Map<string, ReturnType<typeof setInterval>>()
const previewTunnelResponseDebugEnabled = getEnv('WEMUX_PREVIEW_TUNNEL_DEBUG') === '1'
const previewTunnelResponseLogSampleRate = (() => {
  const raw = Number(getEnv('WEMUX_PREVIEW_TUNNEL_RESPONSE_LOG_SAMPLE_RATE') ?? '0')
  if (!Number.isFinite(raw)) {
    return 0
  }
  return Math.max(0, Math.min(1, raw))
})()

const nowIso = () => new Date().toISOString()

const buildPendingKey = (previewSessionId: string, streamId: string) => `${previewSessionId}:${streamId}`

const countActiveStreams = (previewSessionId: string) => {
  let total = 0
  for (const key of pendingResponses.keys()) {
    if (key.startsWith(`${previewSessionId}:`)) {
      total += 1
    }
  }
  for (const key of gatewayWebSockets.keys()) {
    if (key.startsWith(`${previewSessionId}:`)) {
      total += 1
    }
  }
  return total
}

const refreshPendingTimeout = (previewSessionId: string, streamId: string) => {
  const pending = pendingResponses.get(buildPendingKey(previewSessionId, streamId))
  if (!pending) {
    return
  }

  clearTimeout(pending.timer)
  pending.timer = setTimeout(() => {
    pending.onTimeout()
  }, REQUEST_TIMEOUT_MS)
}

const isSocketOpen = (
  socket: PreviewTunnelSocket | PreviewGatewaySocket | undefined,
) => {
  if (!socket) {
    return false
  }

  return socket.readyState === socket.OPEN || socket.readyState === 1
}

const getBufferedAmount = (socket: PreviewTunnelSocket | undefined) => {
  return Math.max(0, Math.floor(socket?.bufferedAmount ?? 0))
}

const measurePayloadBytes = (payload: string | Uint8Array) => {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload)
  }

  return payload.byteLength
}

const shouldLogPreviewHttpResponse = () => {
  return previewTunnelResponseDebugEnabled
    || (previewTunnelResponseLogSampleRate > 0 && Math.random() < previewTunnelResponseLogSampleRate)
}

const updateConnectionMetrics = (
  connection: PreviewTunnelConnection,
  patch: Partial<PreviewTunnelMetricsDto>,
) => {
  const currentMetrics = previewSessionService.getTunnelMetrics(connection.previewSessionId) ?? {}
  const bufferedAmount = getBufferedAmount(connection.socket)
  const sendQueueDepth = connection.sendQueue.length
  const sendQueueBytes = connection.sendQueueBytes
  previewSessionService.updateTunnelMetrics(connection.previewSessionId, {
    ...patch,
    negotiatedChunkBytes: connection.negotiatedChunkBytes,
    binaryPayloads: connection.binaryPayloads,
    currentBufferedAmount: bufferedAmount,
    peakBufferedAmount: Math.max(
      currentMetrics.peakBufferedAmount ?? 0,
      patch.peakBufferedAmount ?? 0,
      bufferedAmount,
    ),
    currentSendQueueDepth: sendQueueDepth,
    peakSendQueueDepth: Math.max(
      currentMetrics.peakSendQueueDepth ?? 0,
      patch.peakSendQueueDepth ?? 0,
      sendQueueDepth,
    ),
    currentSendQueueBytes: sendQueueBytes,
    peakSendQueueBytes: Math.max(
      currentMetrics.peakSendQueueBytes ?? 0,
      patch.peakSendQueueBytes ?? 0,
      sendQueueBytes,
    ),
  })
}

const getQueuedMessageWeight = (priority: PreviewTunnelSendPriority) => {
  if (priority === 'control') {
    return 0
  }
  if (priority === 'interactive') {
    return 1
  }
  return 2
}

const drainSendQueue = (connection: PreviewTunnelConnection): boolean => {
  connection.sendQueueScheduled = false
  if (!isSocketOpen(connection.socket)) {
    connection.sendQueue.length = 0
    connection.sendQueueBytes = 0
    updateConnectionMetrics(connection, {})
    return false
  }

  while (connection.sendQueue.length > 0) {
    if (getBufferedAmount(connection.socket) >= PREVIEW_TUNNEL_SEND_BUFFER_HIGH_WATERMARK_BYTES) {
      connection.sendQueueScheduled = true
      setTimeout(() => {
        const current = connections.get(connection.previewSessionId)
        if (current?.connectionId === connection.connectionId) {
          drainSendQueue(current)
        }
      }, 8)
      updateConnectionMetrics(connection, {})
      return false
    }

    const next = connection.sendQueue.shift()
    if (!next) {
      break
    }

    connection.sendQueueBytes = Math.max(0, connection.sendQueueBytes - next.size)
    connection.socket.send(next.payload)
  }

  updateConnectionMetrics(connection, {})
  return true
}

const enqueueTunnelPayload = (
  connection: PreviewTunnelConnection,
  payload: string | Uint8Array,
  priority: PreviewTunnelSendPriority,
) => {
  const queued: PreviewTunnelQueuedMessage = {
    priority,
    size: measurePayloadBytes(payload),
    payload,
  }
  connection.sendQueue.push(queued)
  connection.sendQueue.sort((left, right) => getQueuedMessageWeight(left.priority) - getQueuedMessageWeight(right.priority))
  connection.sendQueueBytes += queued.size
  updateConnectionMetrics(connection, {})
  if (!connection.sendQueueScheduled) {
    connection.sendQueueScheduled = true
    queueMicrotask(() => {
      const current = connections.get(connection.previewSessionId)
      if (current?.connectionId === connection.connectionId) {
        drainSendQueue(current)
      }
    })
  }
}

const buildErrorResponse = (status: number, message: string) => {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

const isAllowedPreviewTargetUrl = (previewSessionId: string, targetUrl?: string) => {
  if (!targetUrl) {
    return true
  }

  const session = previewSessionService.getSessionById(previewSessionId)
  if (!session) {
    return false
  }

  return [session.source, ...session.additionalSources].some((source) => source.appUrl === targetUrl)
}

const normalizePort = (url: URL) => {
  if (url.port) {
    return url.port
  }

  return url.protocol === 'https:' ? '443' : '80'
}

const stripBasePathPrefix = (pathname: string, basePath: string) => {
  const normalizedBase = basePath === '/' ? '' : basePath.replace(/\/+$/, '')
  if (!normalizedBase) {
    return pathname || '/'
  }

  if (pathname === normalizedBase) {
    return '/'
  }

  if (pathname.startsWith(`${normalizedBase}/`)) {
    return pathname.slice(normalizedBase.length) || '/'
  }

  return pathname || '/'
}

const rewriteLocationHeader = (previewSessionId: string, location: string) => {
  const session = previewSessionService.getSessionById(previewSessionId)
  if (!session) {
    return location
  }

  let locationUrl: URL
  try {
    if (location.startsWith('/')) {
      locationUrl = new URL(location, session.source.appUrl)
    } else {
      locationUrl = new URL(location)
    }
  } catch {
    return location
  }

  const sourceUrl = new URL(session.source.appUrl)
  const sameUpstreamOrigin = locationUrl.hostname === sourceUrl.hostname
    && normalizePort(locationUrl) === normalizePort(sourceUrl)
    && locationUrl.protocol === sourceUrl.protocol
  if (!sameUpstreamOrigin) {
    return location
  }

  const publicUrl = new URL(session.publicUrl)
  publicUrl.pathname = stripBasePathPrefix(locationUrl.pathname, sourceUrl.pathname)
  publicUrl.search = locationUrl.search
  publicUrl.hash = locationUrl.hash
  return publicUrl.toString()
}

const rewriteSetCookieHeader = (previewSessionId: string, cookie: string) => {
  const session = previewSessionService.getSessionById(previewSessionId)
  if (!session) {
    return cookie
  }

  const targetHost = session.source.targetHost.replace(/^\[|\]$/g, '')
  const escapedHost = targetHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cookieDomainPattern = new RegExp(`;\\s*Domain=(?:${escapedHost}|localhost|127\\.0\\.0\\.1|\\[::1\\]|::1)(?=;|$)`, 'i')
  return cookie.replace(cookieDomainPattern, '')
}

const buildResponseHeaders = (previewSessionId: string, responseHeaders?: Array<[string, string]>) => {
  const headers = new Headers()
  for (const [name, value] of responseHeaders ?? []) {
    const normalized = name.toLowerCase()
    if (TUNNEL_DECODED_RESPONSE_HEADERS.has(normalized)) {
      continue
    }

    if (normalized === 'location') {
      headers.append(name, rewriteLocationHeader(previewSessionId, value))
      continue
    }

    if (normalized === 'set-cookie') {
      headers.append(name, rewriteSetCookieHeader(previewSessionId, value))
      continue
    }

    headers.append(name, value)
  }
  return headers
}

const logPreviewHttpResponse = (params: {
  previewSessionId: string
  streamId: string
  status: number
  headers?: Array<[string, string]>
  pathWithQuery?: string
  targetUrl?: string
}) => {
  if (!shouldLogPreviewHttpResponse()) {
    return
  }

  const contentType = params.headers?.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || ''
  const contentEncoding = params.headers?.find(([name]) => name.toLowerCase() === 'content-encoding')?.[1] || ''
  const contentLength = params.headers?.find(([name]) => name.toLowerCase() === 'content-length')?.[1] || ''
  console.log('[preview-tunnel-http] response start', {
    previewSessionId: params.previewSessionId,
    streamId: params.streamId,
    status: params.status,
    contentType,
    contentEncoding,
    contentLength,
    pathWithQuery: params.pathWithQuery,
    targetUrl: params.targetUrl,
  })
}

const stripPreviewAccessCookie = (cookieHeader: string) => {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.startsWith(`${PREVIEW_ACCESS_COOKIE}=`))
    .join('; ')
}

const normalizeRequestHeaders = (request: Request, previewSessionId: string) => {
  const headers: Array<[string, string]> = []
  request.headers.forEach((value, name) => {
    const normalized = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalized)) {
      return
    }
    if (normalized === 'cookie') {
      const sanitized = stripPreviewAccessCookie(value)
      if (sanitized) {
        headers.push([name, sanitized])
      }
      return
    }
    headers.push([name, value])
  })

  const requestUrl = new URL(request.url)
  headers.push(['x-forwarded-host', requestUrl.host])
  headers.push(['x-forwarded-proto', requestUrl.protocol.replace(':', '')])
  headers.push(['x-vibemux-preview-id', previewSessionId])
  return headers
}

const sendFrame = (
  connection: PreviewTunnelConnection,
  frame: PreviewTunnelFrame,
  priority: PreviewTunnelSendPriority = 'control',
) => {
  enqueueTunnelPayload(connection, JSON.stringify(frame), priority)
}

const sendBinaryFrame = (
  connection: PreviewTunnelConnection,
  header: PreviewTunnelBinaryFrameHeader,
  payload: Uint8Array,
  priority: PreviewTunnelSendPriority = 'bulk',
) => {
  enqueueTunnelPayload(connection, encodePreviewTunnelBinaryFrame(header, payload), priority)
}

const clearTunnelLatencyProbe = (previewSessionId: string) => {
  pendingTunnelLatencyPings.delete(previewSessionId)
  const interval = tunnelLatencyIntervals.get(previewSessionId)
  if (!interval) {
    return
  }

  clearInterval(interval)
  tunnelLatencyIntervals.delete(previewSessionId)
}

const sendTunnelLatencyPing = (connection: PreviewTunnelConnection) => {
  if (!isSocketOpen(connection.socket)) {
    return false
  }

  const existing = pendingTunnelLatencyPings.get(connection.previewSessionId)
  if (existing && Date.now() - existing.sentAtMs < REQUEST_TIMEOUT_MS) {
    return false
  }

  const pingId = crypto.randomUUID()
  const sentAtMs = Date.now()
  pendingTunnelLatencyPings.set(connection.previewSessionId, {
    pingId,
    sentAtMs,
  })

  const pingFrame: PreviewTunnelPingFrame = {
    type: 'preview.tunnel.ping',
    previewSessionId: connection.previewSessionId,
    sentAt: new Date(sentAtMs).toISOString(),
    pingId,
  }
  sendFrame(connection, pingFrame, 'control')
  return true
}

const scheduleTunnelLatencyProbe = (connection: PreviewTunnelConnection) => {
  clearTunnelLatencyProbe(connection.previewSessionId)
  const tick = () => {
    const current = connections.get(connection.previewSessionId)
    if (!current || current.connectionId !== connection.connectionId) {
      return
    }

    sendTunnelLatencyPing(current)
  }

  tunnelLatencyIntervals.set(
    connection.previewSessionId,
    setInterval(tick, TUNNEL_LATENCY_PING_INTERVAL_MS),
  )
  tick()
}

const rejectPending = (previewSessionId: string, streamId: string, message: string) => {
  const key = buildPendingKey(previewSessionId, streamId)
  const pending = pendingResponses.get(key)
  if (!pending) {
    return
  }

  clearTimeout(pending.timer)
  pendingResponses.delete(key)
  if (pending.streamController) {
    try {
      pending.streamController.error(new Error(message))
    } catch {
      // Ignore already closed streams.
    }
  }
  pending.reject(new Error(message))
  const connection = connections.get(previewSessionId)
  if (connection) {
    updateConnectionMetrics(connection, {
      activeStreams: countActiveStreams(previewSessionId),
    })
  }
}

const dropGatewayWebSocket = (
  previewSessionId: string,
  streamId: string,
) => {
  const key = buildPendingKey(previewSessionId, streamId)
  const gatewaySocket = gatewayWebSockets.get(key)
  if (!gatewaySocket) {
    return null
  }

  if (gatewaySocket.openTimer) {
    clearTimeout(gatewaySocket.openTimer)
  }

  gatewayWebSockets.delete(key)
  const connection = connections.get(previewSessionId)
  if (connection) {
    updateConnectionMetrics(connection, {
      activeStreams: countActiveStreams(previewSessionId),
    })
  }
  return gatewaySocket
}

const disconnectGatewayWebSocket = (
  previewSessionId: string,
  streamId: string,
  code?: number,
  reason?: string,
) => {
  const gatewaySocket = dropGatewayWebSocket(previewSessionId, streamId)
  if (!gatewaySocket || !isSocketOpen(gatewaySocket.socket)) {
    return
  }

  try {
    gatewaySocket.socket.close(code, reason)
  } catch {
    gatewaySocket.socket.close()
  }
}

const flushGatewayFrames = (
  connection: PreviewTunnelConnection,
  gatewaySocket: PreviewGatewayWebSocket,
) => {
  if (!gatewaySocket.pendingFrames.length && !gatewaySocket.pendingBinaryFrames.length) {
    return
  }

  const frames = [
    ...gatewaySocket.pendingFrames.map((frame) => ({
      seq: frame.seq,
      send: () => sendFrame(connection, frame, 'interactive'),
    })),
    ...gatewaySocket.pendingBinaryFrames.map((frame) => ({
      seq: frame.header.seq,
      send: () => sendBinaryFrame(connection, frame.header, frame.payload, 'interactive'),
    })),
  ].sort((left, right) => left.seq - right.seq)
  gatewaySocket.pendingFrames.length = 0
  gatewaySocket.pendingBinaryFrames.length = 0
  for (const frame of frames) {
    frame.send()
  }
}

const sendGatewayWebSocketData = (params: {
  connection: PreviewTunnelConnection
  gatewaySocket: PreviewGatewayWebSocket
  payload: string | Buffer
}) => {
  const sentAt = nowIso()
  const seq = params.gatewaySocket.nextSeq
  params.gatewaySocket.nextSeq += 1
  const metrics = previewSessionService.getTunnelMetrics(params.gatewaySocket.previewSessionId)
  const payloadBytes = typeof params.payload === 'string'
    ? Buffer.byteLength(params.payload)
    : params.payload.byteLength
  updateConnectionMetrics(params.connection, {
    wsFrameCount: (metrics?.wsFrameCount ?? 0) + 1,
    wsBytes: (metrics?.wsBytes ?? 0) + payloadBytes,
  })

  if (Buffer.isBuffer(params.payload) && params.connection.binaryPayloads) {
    sendBinaryFrame(params.connection, {
      type: 'preview.ws.data.binary',
      previewSessionId: params.gatewaySocket.previewSessionId,
      streamId: params.gatewaySocket.streamId,
      sentAt,
      seq,
    }, params.payload, 'interactive')
    return
  }

  const frame: PreviewWsDataFrame = {
    type: 'preview.ws.data',
    previewSessionId: params.gatewaySocket.previewSessionId,
    streamId: params.gatewaySocket.streamId,
    sentAt,
    seq,
    opcode: typeof params.payload === 'string' ? 'text' : 'binary',
    encoding: typeof params.payload === 'string' ? 'utf8' : 'base64',
    data: typeof params.payload === 'string' ? params.payload : params.payload.toString('base64'),
  }
  sendFrame(params.connection, frame, 'interactive')
}

const queueGatewayWebSocketData = (params: {
  connection?: PreviewTunnelConnection
  gatewaySocket: PreviewGatewayWebSocket
  payload: string | Buffer
}) => {
  const sentAt = nowIso()
  const seq = params.gatewaySocket.nextSeq
  params.gatewaySocket.nextSeq += 1

  if (Buffer.isBuffer(params.payload) && params.connection?.binaryPayloads) {
    params.gatewaySocket.pendingBinaryFrames.push({
      header: {
        type: 'preview.ws.data.binary',
        previewSessionId: params.gatewaySocket.previewSessionId,
        streamId: params.gatewaySocket.streamId,
        sentAt,
        seq,
      },
      payload: params.payload,
    })
    return
  }

  params.gatewaySocket.pendingFrames.push({
    type: 'preview.ws.data',
    previewSessionId: params.gatewaySocket.previewSessionId,
    streamId: params.gatewaySocket.streamId,
    sentAt,
    seq,
    opcode: typeof params.payload === 'string' ? 'text' : 'binary',
    encoding: typeof params.payload === 'string' ? 'utf8' : 'base64',
    data: typeof params.payload === 'string' ? params.payload : params.payload.toString('base64'),
  })
}

export const previewTunnelService = {
  registerConnection(
    previewSessionId: string,
    connectionId: string,
    socket: PreviewTunnelSocket,
    options: { binaryPayloads?: boolean, negotiatedChunkBytes?: number } = {},
  ) {
    const existing = connections.get(previewSessionId)
    if (existing && existing.connectionId !== connectionId && isSocketOpen(existing.socket)) {
      existing.socket.close(4409, 'replaced by newer preview tunnel')
    }

    const connection: PreviewTunnelConnection = {
      previewSessionId,
      connectionId,
      socket,
      binaryPayloads: options.binaryPayloads === true,
      negotiatedChunkBytes: normalizePreviewTunnelChunkBytes(options.negotiatedChunkBytes),
      sendQueue: [],
      sendQueueScheduled: false,
      sendQueueBytes: 0,
    }
    connections.set(previewSessionId, connection)
    updateConnectionMetrics(connection, {
      reconnectCount: (previewSessionService.getTunnelMetrics(previewSessionId)?.reconnectCount ?? 0) + 1,
    })
    scheduleTunnelLatencyProbe(connection)
  },

  unregisterConnection(previewSessionId: string, connectionId: string, reason?: string) {
    const current = connections.get(previewSessionId)
    if (!current || current.connectionId !== connectionId) {
      return
    }

    connections.delete(previewSessionId)
    clearTunnelLatencyProbe(previewSessionId)
    previewSessionService.updateTunnelMetrics(previewSessionId, {
      activeStreams: 0,
      currentBufferedAmount: 0,
      currentSendQueueDepth: 0,
      currentSendQueueBytes: 0,
    })

    for (const key of gatewayWebSockets.keys()) {
      if (!key.startsWith(`${previewSessionId}:`)) {
        continue
      }

      const gatewaySocket = gatewayWebSockets.get(key)
      if (!gatewaySocket) {
        continue
      }

      disconnectGatewayWebSocket(
        gatewaySocket.previewSessionId,
        gatewaySocket.streamId,
        1013,
        reason || 'preview tunnel disconnected',
      )
    }

    for (const key of pendingResponses.keys()) {
      if (!key.startsWith(`${previewSessionId}:`)) {
        continue
      }

      const pending = pendingResponses.get(key)
      if (!pending) {
        continue
      }

      clearTimeout(pending.timer)
      pendingResponses.delete(key)
      if (pending.streamController) {
        try {
          pending.streamController.error(new Error(reason || 'preview tunnel disconnected'))
        } catch {
          // Ignore already closed streams.
        }
      }
      pending.reject(new Error(reason || 'preview tunnel disconnected'))
    }
  },

  handleFrame(frame: PreviewTunnelFrame) {
    const connection = connections.get(frame.previewSessionId)
    if (connection) {
      if (frame.type === 'preview.http.response.start') {
        updateConnectionMetrics(connection, {
          activeStreams: countActiveStreams(frame.previewSessionId),
        })
      }
      if (frame.type === 'preview.ws.data') {
        const bytes = Buffer.byteLength(frame.data, frame.encoding === 'base64' ? 'base64' : 'utf8')
        const metrics = previewSessionService.getTunnelMetrics(frame.previewSessionId)
        updateConnectionMetrics(connection, {
          wsFrameCount: (metrics?.wsFrameCount ?? 0) + 1,
          wsBytes: (metrics?.wsBytes ?? 0) + bytes,
        })
      }
    }

    if (frame.type === 'preview.tunnel.pong') {
      const pong = frame as PreviewTunnelPongFrame
      const pending = pendingTunnelLatencyPings.get(pong.previewSessionId)
      if (!pending || pending.pingId !== pong.pingId) {
        return
      }

      pendingTunnelLatencyPings.delete(pong.previewSessionId)
      previewSessionService.updateTunnelLatency(
        pong.previewSessionId,
        Math.max(0, Date.now() - pending.sentAtMs),
      )
      return
    }

    if (frame.type === 'preview.http.response.start') {
      const message = frame as PreviewHttpResponseStartFrame
      const pending = pendingResponses.get(buildPendingKey(frame.previewSessionId, frame.streamId))
      if (!pending) {
        return
      }

      refreshPendingTimeout(frame.previewSessionId, frame.streamId)
      pending.status = message.status
      pending.headers = message.headers
      logPreviewHttpResponse({
        previewSessionId: frame.previewSessionId,
        streamId: frame.streamId,
        status: message.status,
        headers: message.headers,
        pathWithQuery: pending.pathWithQuery,
        targetUrl: pending.targetUrl,
      })
      if (pending.started) {
        return
      }

      const responseStream = new ReadableStream<Uint8Array>({
        start(controller) {
          pending.streamController = controller
        },
      })
      pending.stream = responseStream
      pending.started = true
      pending.resolve(new Response(responseStream, {
        status: pending.status,
        headers: buildResponseHeaders(frame.previewSessionId, pending.headers),
      }))
      return
    }

    if (frame.type === 'preview.http.response.body') {
      const message = frame as PreviewHttpResponseBodyFrame
      const pending = pendingResponses.get(buildPendingKey(frame.previewSessionId, frame.streamId))
      if (!pending) {
        return
      }

      refreshPendingTimeout(frame.previewSessionId, frame.streamId)
      pending.streamController?.enqueue(Buffer.from(message.data, 'base64'))
      if (connection) {
        const metrics = previewSessionService.getTunnelMetrics(frame.previewSessionId)
        updateConnectionMetrics(connection, {
          responseBytes: (metrics?.responseBytes ?? 0) + Buffer.byteLength(message.data, 'base64'),
        })
      }
      return
    }

    if (frame.type === 'preview.http.response.end') {
      const message = frame as PreviewHttpResponseEndFrame
      const key = buildPendingKey(message.previewSessionId, message.streamId)
      const pending = pendingResponses.get(key)
      if (!pending) {
        return
      }

      clearTimeout(pending.timer)
      pendingResponses.delete(key)
      if (connection) {
        updateConnectionMetrics(connection, {
          activeStreams: countActiveStreams(frame.previewSessionId),
        })
      }
      if (!pending.started) {
        pending.resolve(new Response(null, {
          status: pending.status ?? 204,
          headers: buildResponseHeaders(message.previewSessionId, pending.headers),
        }))
        return
      }

      pending.streamController?.close()
      return
    }

    if (frame.type === 'preview.http.abort') {
      const message = frame as PreviewHttpAbortFrame
      if (connection) {
        const metrics = previewSessionService.getTunnelMetrics(message.previewSessionId)
        updateConnectionMetrics(connection, {
          abortCount: message.code === 'client_closed' ? (metrics?.abortCount ?? 0) + 1 : metrics?.abortCount,
          timeoutCount: message.code === 'gateway_timeout' ? (metrics?.timeoutCount ?? 0) + 1 : metrics?.timeoutCount,
        })
      }
      rejectPending(message.previewSessionId, message.streamId, message.message || message.code)
      return
    }

    if (frame.type === 'preview.ws.opened') {
      const message = frame as PreviewWsOpenedFrame
      const gatewaySocket = gatewayWebSockets.get(buildPendingKey(message.previewSessionId, message.streamId))
      if (!gatewaySocket) {
        return
      }

      if (gatewaySocket.openTimer) {
        clearTimeout(gatewaySocket.openTimer)
        gatewaySocket.openTimer = undefined
      }

      if (!message.accepted) {
        disconnectGatewayWebSocket(
          message.previewSessionId,
          message.streamId,
          message.status === 401 ? 1008 : 1013,
          message.message || 'preview websocket open rejected',
        )
        return
      }

      gatewaySocket.opened = true
      const connection = connections.get(message.previewSessionId)
      if (connection) {
        flushGatewayFrames(connection, gatewaySocket)
      }
      return
    }

    if (frame.type === 'preview.ws.data') {
      const message = frame as PreviewWsDataFrame
      const gatewaySocket = gatewayWebSockets.get(buildPendingKey(message.previewSessionId, message.streamId))
      if (!gatewaySocket || !isSocketOpen(gatewaySocket.socket)) {
        return
      }

      if (message.opcode === 'binary') {
        gatewaySocket.socket.send(Buffer.from(message.data, 'base64'))
        return
      }

      gatewaySocket.socket.send(message.data)
      return
    }

    if (frame.type === 'preview.ws.close') {
      const message = frame as PreviewWsCloseFrame
      disconnectGatewayWebSocket(
        message.previewSessionId,
        message.streamId,
        message.code,
        message.reason,
      )
    }
  },

  handleBinaryFrame(header: PreviewTunnelBinaryFrameHeader, payload: Uint8Array) {
    const connection = connections.get(header.previewSessionId)
    if (!connection?.binaryPayloads) {
      return
    }

    if (header.type === 'preview.ws.data.binary') {
      const gatewaySocket = gatewayWebSockets.get(buildPendingKey(header.previewSessionId, header.streamId))
      if (!gatewaySocket || !isSocketOpen(gatewaySocket.socket)) {
        return
      }

      gatewaySocket.socket.send(Buffer.from(payload))
      const metrics = previewSessionService.getTunnelMetrics(header.previewSessionId)
      updateConnectionMetrics(connection, {
        wsFrameCount: (metrics?.wsFrameCount ?? 0) + 1,
        wsBytes: (metrics?.wsBytes ?? 0) + payload.byteLength,
      })
      return
    }

    if (header.type !== 'preview.http.response.body.binary') {
      return
    }

    const pending = pendingResponses.get(buildPendingKey(header.previewSessionId, header.streamId))
    if (!pending) {
      return
    }

    refreshPendingTimeout(header.previewSessionId, header.streamId)
    pending.streamController?.enqueue(payload)
    const metrics = previewSessionService.getTunnelMetrics(header.previewSessionId)
    updateConnectionMetrics(connection, {
      responseBytes: (metrics?.responseBytes ?? 0) + payload.byteLength,
    })
  },

  async proxyHttpRequest(previewSessionId: string, request: Request, targetUrl?: string) {
    const connection = connections.get(previewSessionId)
    if (!connection || !isSocketOpen(connection.socket)) {
      return buildErrorResponse(502, 'Preview tunnel is not connected yet.')
    }

    if (!isAllowedPreviewTargetUrl(previewSessionId, targetUrl)) {
      return buildErrorResponse(403, 'Preview target URL is not allowed for this session.')
    }

    const streamId = crypto.randomUUID()
    const key = buildPendingKey(previewSessionId, streamId)
    const requestUrl = new URL(request.url)
    const pathWithQuery = `${requestUrl.pathname}${requestUrl.search}`
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null

    const abortRequest = (code: PreviewHttpAbortFrame['code'], message: string) => {
      rejectPending(previewSessionId, streamId, message)
      if (!isSocketOpen(connection.socket)) {
        return
      }

      const abortFrame: PreviewHttpAbortFrame = {
        type: 'preview.http.abort',
        previewSessionId,
        streamId,
        sentAt: nowIso(),
        code,
        message,
      }
      const metrics = previewSessionService.getTunnelMetrics(previewSessionId)
      updateConnectionMetrics(connection, {
        abortCount: code === 'client_closed' ? (metrics?.abortCount ?? 0) + 1 : metrics?.abortCount,
        timeoutCount: code === 'gateway_timeout' ? (metrics?.timeoutCount ?? 0) + 1 : metrics?.timeoutCount,
        activeStreams: countActiveStreams(previewSessionId),
      })
      sendFrame(connection, abortFrame, 'control')
    }

    const responsePromise = new Promise<Response>((resolve, reject) => {
      pendingResponses.set(key, {
        resolve,
        reject,
        timer: setTimeout(() => undefined, REQUEST_TIMEOUT_MS),
        onTimeout: () => {
          abortRequest('gateway_timeout', 'preview tunnel request timed out')
        },
        pathWithQuery,
        targetUrl,
        started: false,
      })
      refreshPendingTimeout(previewSessionId, streamId)
    })
    updateConnectionMetrics(connection, {
      activeStreams: countActiveStreams(previewSessionId),
      requestCount: (previewSessionService.getTunnelMetrics(previewSessionId)?.requestCount ?? 0) + 1,
    })

    const startFrame: PreviewHttpRequestStartFrame = {
      type: 'preview.http.request.start',
      previewSessionId,
      streamId,
      sentAt: nowIso(),
      requestId: crypto.randomUUID(),
      method: request.method,
      pathWithQuery,
      targetUrl,
      headers: normalizeRequestHeaders(request, previewSessionId),
      hasBody,
    }
    sendFrame(connection, startFrame, 'control')

    if (hasBody && request.body) {
      const reader = request.body.getReader()
      let requestBodySeq = 0
      let requestBodyBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const chunk = Buffer.from(value ?? new Uint8Array(0))
        for (let offset = 0; offset < chunk.length; offset += connection.negotiatedChunkBytes) {
          const slice = chunk.subarray(offset, offset + connection.negotiatedChunkBytes)
          requestBodyBytes += slice.byteLength
          if (connection.binaryPayloads) {
            sendBinaryFrame(connection, {
              type: 'preview.http.request.body.binary',
              previewSessionId,
              streamId,
              sentAt: nowIso(),
              seq: requestBodySeq,
            }, slice, 'bulk')
          } else {
            const bodyFrame: PreviewHttpRequestBodyFrame = {
              type: 'preview.http.request.body',
              previewSessionId,
              streamId,
              sentAt: nowIso(),
              seq: requestBodySeq,
              encoding: 'base64',
              data: slice.toString('base64'),
            }
            sendFrame(connection, bodyFrame, 'bulk')
          }
          requestBodySeq += 1
        }
      }
      const metrics = previewSessionService.getTunnelMetrics(previewSessionId)
      updateConnectionMetrics(connection, {
        requestBytes: (metrics?.requestBytes ?? 0) + requestBodyBytes,
      })
    }

    const endFrame: PreviewHttpRequestEndFrame = {
      type: 'preview.http.request.end',
      previewSessionId,
      streamId,
      sentAt: nowIso(),
    }
    sendFrame(connection, endFrame, 'bulk')

    if (request.signal.aborted) {
      abortRequest('client_closed', 'preview client request was already aborted')
      return buildErrorResponse(499, 'Preview request was aborted by the client.')
    }

    const handleAbort = () => {
      abortRequest('client_closed', 'preview client request aborted')
    }
    request.signal.addEventListener('abort', handleAbort, { once: true })

    try {
      return await responsePromise
    } catch (error) {
      pendingResponses.delete(key)
      if (request.signal.aborted) {
        return buildErrorResponse(499, 'Preview request was aborted by the client.')
      }
      return buildErrorResponse(502, error instanceof Error ? error.message : 'preview proxy failed')
    } finally {
      request.signal.removeEventListener('abort', handleAbort)
    }
  },

  openGatewayWebSocket(params: {
    previewSessionId: string
    socket: PreviewGatewaySocket
    pathWithQuery: string
    targetUrl?: string
    headers: Array<[string, string]>
    subprotocols: string[]
  }) {
    const connection = connections.get(params.previewSessionId)
    if (!connection || !isSocketOpen(connection.socket)) {
      params.socket.close(1013, 'preview tunnel is not connected yet')
      return null
    }

    if (!isAllowedPreviewTargetUrl(params.previewSessionId, params.targetUrl)) {
      params.socket.close(1008, 'preview target URL is not allowed')
      return null
    }

    const streamId = crypto.randomUUID()
    const key = buildPendingKey(params.previewSessionId, streamId)
    const gatewaySocket: PreviewGatewayWebSocket = {
      previewSessionId: params.previewSessionId,
      streamId,
      socket: params.socket,
      opened: false,
      nextSeq: 0,
      pendingFrames: [],
      pendingBinaryFrames: [],
      openTimer: setTimeout(() => {
        disconnectGatewayWebSocket(
          params.previewSessionId,
          streamId,
          1013,
          'preview websocket open timed out',
        )
      }, WEBSOCKET_OPEN_TIMEOUT_MS),
    }
    gatewayWebSockets.set(key, gatewaySocket)
    updateConnectionMetrics(connection, {
      activeStreams: countActiveStreams(params.previewSessionId),
    })

    const openFrame: PreviewWsOpenFrame = {
      type: 'preview.ws.open',
      previewSessionId: params.previewSessionId,
      streamId,
      sentAt: nowIso(),
      pathWithQuery: params.pathWithQuery,
      targetUrl: params.targetUrl,
      headers: params.headers,
      subprotocols: params.subprotocols,
    }
    sendFrame(connection, openFrame, 'control')
    return streamId
  },

  pushGatewayWebSocketData(
    previewSessionId: string,
    streamId: string,
    payload: string | Buffer,
  ) {
    const gatewaySocket = gatewayWebSockets.get(buildPendingKey(previewSessionId, streamId))
    if (!gatewaySocket) {
      return
    }

    const connection = connections.get(previewSessionId)
    if (!connection || !isSocketOpen(connection.socket) || !gatewaySocket.opened) {
      queueGatewayWebSocketData({
        connection,
        gatewaySocket,
        payload,
      })
      return
    }

    sendGatewayWebSocketData({
      connection,
      gatewaySocket,
      payload,
    })
  },

  closeGatewayWebSocket(
    previewSessionId: string,
    streamId: string,
    code?: number,
    reason?: string,
  ) {
    const gatewaySocket = dropGatewayWebSocket(previewSessionId, streamId)
    if (!gatewaySocket) {
      return
    }

    const connection = connections.get(previewSessionId)
    if (!connection || !isSocketOpen(connection.socket)) {
      return
    }

    const closeFrame: PreviewWsCloseFrame = {
      type: 'preview.ws.close',
      previewSessionId,
      streamId,
      sentAt: nowIso(),
      code,
      reason,
    }
    updateConnectionMetrics(connection, {
      activeStreams: countActiveStreams(previewSessionId),
    })
    sendFrame(connection, closeFrame, 'control')
  },
}
