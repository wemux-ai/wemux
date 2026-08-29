// [INPUT]: WS 代理输入
// [OUTPUT]: 代理结果
// [POS]: 本地 WS 代理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  PreviewTunnelBinaryFrameHeader,
  PreviewWsCloseFrame,
  PreviewWsDataFrame,
  PreviewWsOpenFrame,
  PreviewWsOpenedFrame,
} from '@shared/types'
import { encodePreviewTunnelBinaryFrame } from '@shared/types'
import { WebSocket as NodeWebSocket, type RawData } from 'ws'

type WorkerPreviewTunnelSocket = {
  sendControl: (data: string | Uint8Array) => void
  sendInteractive: (data: string | Uint8Array) => void
  sendBulk: (data: string | Uint8Array) => void
}

type PendingWebSocketConnection = {
  previewSessionId: string
  streamId: string
  socket: NodeWebSocket
  tunnelSocket: WorkerPreviewTunnelSocket
  opened: boolean
  nextSeq: number
  queuedFrames: PreviewWsDataFrame[]
  closedByControl: boolean
  binaryPayloads: boolean
}

const pendingConnections = new Map<string, PendingWebSocketConnection>()

const nowIso = () => new Date().toISOString()

const buildPendingKey = (previewSessionId: string, streamId: string) => `${previewSessionId}:${streamId}`

const normalizeBasePath = (pathname: string) => {
  if (!pathname || pathname === '/') {
    return ''
  }

  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

const joinBasePath = (basePath: string, requestPath: string) => {
  const normalizedBase = normalizeBasePath(basePath)
  if (!normalizedBase) {
    return requestPath || '/'
  }

  if (requestPath === normalizedBase || requestPath.startsWith(`${normalizedBase}/`)) {
    return requestPath || '/'
  }

  return `${normalizedBase}${requestPath || '/'}`
}

const normalizeWebSocketUrl = (targetUrl: string, pathWithQuery: string) => {
  const baseUrl = new URL(targetUrl)
  const requestUrl = new URL(pathWithQuery, baseUrl)
  requestUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  requestUrl.pathname = joinBasePath(baseUrl.pathname, requestUrl.pathname)
  return requestUrl.toString()
}

const buildWebSocketOrigin = (upstreamUrl: string) => {
  const url = new URL(upstreamUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.origin
}

const normalizeHeaders = (headers: Array<[string, string]>, upstreamUrl: string) => {
  const normalized: Record<string, string> = {}
  const upstreamOrigin = buildWebSocketOrigin(upstreamUrl)
  let hasOrigin = false
  for (const [name, value] of headers) {
    if (name.toLowerCase() === 'origin') {
      hasOrigin = true
      normalized[name] = upstreamOrigin
      continue
    }
    normalized[name] = value
  }
  if (!hasOrigin) {
    normalized.origin = upstreamOrigin
  }
  return normalized
}

const sendFrame = (
  socket: WorkerPreviewTunnelSocket,
  frame: PreviewWsOpenedFrame | PreviewWsDataFrame | PreviewWsCloseFrame,
) => {
  socket.sendControl(JSON.stringify(frame))
}

const sendBinaryFrame = (
  socket: WorkerPreviewTunnelSocket,
  header: PreviewTunnelBinaryFrameHeader,
  payload: Uint8Array,
) => {
  socket.sendInteractive(encodePreviewTunnelBinaryFrame(header, payload))
}

const flushQueuedFrames = (connection: PendingWebSocketConnection) => {
  if (!connection.queuedFrames.length) {
    return
  }

  const frames = [...connection.queuedFrames]
  connection.queuedFrames.length = 0
  for (const frame of frames) {
    if (frame.opcode === 'binary') {
      connection.socket.send(Buffer.from(frame.data, 'base64'))
      continue
    }

    connection.socket.send(frame.data)
  }
}

const closeLocalConnection = (params: {
  previewSessionId: string
  streamId: string
  code?: number
  reason?: string
  notifyRemote?: boolean
}) => {
  const key = buildPendingKey(params.previewSessionId, params.streamId)
  const connection = pendingConnections.get(key)
  if (!connection) {
    return
  }

  pendingConnections.delete(key)

  if (params.notifyRemote !== false) {
    const closeFrame: PreviewWsCloseFrame = {
      type: 'preview.ws.close',
      previewSessionId: params.previewSessionId,
      streamId: params.streamId,
      sentAt: nowIso(),
      code: params.code,
      reason: params.reason,
    }
    sendFrame(connection.tunnelSocket, closeFrame)
  }

  try {
    connection.closedByControl = true
    connection.socket.close(params.code, params.reason)
  } catch {
    connection.socket.close()
  }
}

const toBase64 = (payload: RawData) => {
  if (Buffer.isBuffer(payload)) {
    return payload.toString('base64')
  }

  if (Array.isArray(payload)) {
    return Buffer.concat(payload).toString('base64')
  }

  return Buffer.from(payload).toString('base64')
}

const toBuffer = (payload: RawData) => {
  if (Buffer.isBuffer(payload)) {
    return payload
  }

  if (Array.isArray(payload)) {
    return Buffer.concat(payload)
  }

  return Buffer.from(payload)
}

const toUtf8 = (payload: RawData) => {
  if (typeof payload === 'string') {
    return payload
  }

  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf8')
  }

  if (Array.isArray(payload)) {
    return Buffer.concat(payload).toString('utf8')
  }

  return Buffer.from(new Uint8Array(payload)).toString('utf8')
}

export const localPreviewWebSocketProxy = {
  open(params: {
    frame: PreviewWsOpenFrame
    socket: WorkerPreviewTunnelSocket
    targetUrl: string
    binaryPayloads: boolean
  }) {
    const key = buildPendingKey(params.frame.previewSessionId, params.frame.streamId)
    closeLocalConnection({
      previewSessionId: params.frame.previewSessionId,
      streamId: params.frame.streamId,
      notifyRemote: false,
    })

    const upstreamUrl = normalizeWebSocketUrl(params.frame.targetUrl || params.targetUrl, params.frame.pathWithQuery)
    const upstreamSocket = new NodeWebSocket(
      upstreamUrl,
      params.frame.subprotocols.length > 0 ? params.frame.subprotocols : undefined,
      {
        headers: normalizeHeaders(params.frame.headers, upstreamUrl),
      },
    )

    const connection: PendingWebSocketConnection = {
      previewSessionId: params.frame.previewSessionId,
      streamId: params.frame.streamId,
      socket: upstreamSocket,
      tunnelSocket: params.socket,
      opened: false,
      nextSeq: 0,
      queuedFrames: [],
      closedByControl: false,
      binaryPayloads: params.binaryPayloads,
    }
    pendingConnections.set(key, connection)

    upstreamSocket.on('open', () => {
      const current = pendingConnections.get(key)
      if (!current) {
        return
      }

      current.opened = true
      const openedFrame: PreviewWsOpenedFrame = {
        type: 'preview.ws.opened',
        previewSessionId: current.previewSessionId,
        streamId: current.streamId,
        sentAt: nowIso(),
        accepted: true,
        selectedSubprotocol: current.socket.protocol || undefined,
      }
      sendFrame(current.tunnelSocket, openedFrame)
      flushQueuedFrames(current)
    })

    upstreamSocket.on('message', (payload: RawData, isBinary: boolean) => {
      const current = pendingConnections.get(key)
      if (!current) {
        return
      }

      const sentAt = nowIso()
      const seq = current.nextSeq
      current.nextSeq += 1
      if (isBinary && current.binaryPayloads) {
        sendBinaryFrame(current.tunnelSocket, {
          type: 'preview.ws.data.binary',
          previewSessionId: current.previewSessionId,
          streamId: current.streamId,
          sentAt,
          seq,
        }, toBuffer(payload))
        return
      }

      const frame: PreviewWsDataFrame = isBinary
        ? {
            type: 'preview.ws.data',
            previewSessionId: current.previewSessionId,
            streamId: current.streamId,
            sentAt,
            seq,
            opcode: 'binary',
            encoding: 'base64',
            data: toBase64(payload),
          }
        : {
            type: 'preview.ws.data',
            previewSessionId: current.previewSessionId,
            streamId: current.streamId,
            sentAt,
            seq,
            opcode: 'text',
            encoding: 'utf8',
            data: toUtf8(payload),
          }
      current.tunnelSocket.sendInteractive(JSON.stringify(frame))
    })

    upstreamSocket.on('close', (code: number, reasonBuffer: Buffer) => {
      const current = pendingConnections.get(key)
      if (!current) {
        return
      }

      pendingConnections.delete(key)
      if (current.closedByControl) {
        return
      }

      const closeFrame: PreviewWsCloseFrame = {
        type: 'preview.ws.close',
        previewSessionId: current.previewSessionId,
        streamId: current.streamId,
        sentAt: nowIso(),
        code: code || undefined,
        reason: reasonBuffer.toString() || undefined,
      }
      sendFrame(current.tunnelSocket, closeFrame)
    })

    upstreamSocket.on('error', () => {
      const current = pendingConnections.get(key)
      if (!current) {
        return
      }

      if (!current.opened) {
        pendingConnections.delete(key)
        const openedFrame: PreviewWsOpenedFrame = {
          type: 'preview.ws.opened',
          previewSessionId: current.previewSessionId,
          streamId: current.streamId,
          sentAt: nowIso(),
          accepted: false,
          status: 502,
          message: 'local preview websocket connect failed',
        }
        sendFrame(current.tunnelSocket, openedFrame)
      }
    })
  },

  handleData(frame: PreviewWsDataFrame) {
    const connection = pendingConnections.get(buildPendingKey(frame.previewSessionId, frame.streamId))
    if (!connection) {
      return
    }

    if (!connection.opened || connection.socket.readyState !== NodeWebSocket.OPEN) {
      connection.queuedFrames.push(frame)
      return
    }

    if (frame.opcode === 'binary') {
      connection.socket.send(Buffer.from(frame.data, 'base64'))
      return
    }

    connection.socket.send(frame.data)
  },

  handleBinaryData(header: PreviewTunnelBinaryFrameHeader, payload: Uint8Array) {
    if (header.type !== 'preview.ws.data.binary') {
      return
    }

    const connection = pendingConnections.get(buildPendingKey(header.previewSessionId, header.streamId))
    if (!connection || !connection.binaryPayloads) {
      return
    }

    if (!connection.opened || connection.socket.readyState !== NodeWebSocket.OPEN) {
      connection.queuedFrames.push({
        type: 'preview.ws.data',
        previewSessionId: header.previewSessionId,
        streamId: header.streamId,
        sentAt: header.sentAt,
        seq: header.seq,
        opcode: 'binary',
        encoding: 'base64',
        data: Buffer.from(payload).toString('base64'),
      })
      return
    }

    connection.socket.send(Buffer.from(payload))
  },

  handleClose(frame: PreviewWsCloseFrame) {
    closeLocalConnection({
      previewSessionId: frame.previewSessionId,
      streamId: frame.streamId,
      code: frame.code,
      reason: frame.reason,
      notifyRemote: false,
    })
  },

  closePreviewSession(previewSessionId: string, reason?: string) {
    for (const connection of pendingConnections.values()) {
      if (connection.previewSessionId !== previewSessionId) {
        continue
      }

      closeLocalConnection({
        previewSessionId: connection.previewSessionId,
        streamId: connection.streamId,
        code: 1001,
        reason,
        notifyRemote: false,
      })
    }
  },

  closeAll(reason?: string) {
    for (const connection of pendingConnections.values()) {
      closeLocalConnection({
        previewSessionId: connection.previewSessionId,
        streamId: connection.streamId,
        code: 1001,
        reason,
        notifyRemote: false,
      })
    }
  },
}
