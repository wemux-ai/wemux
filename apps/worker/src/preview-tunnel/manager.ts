// [INPUT]: 隧道请求
// [OUTPUT]: 隧道管理
// [POS]: 预览隧道管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  ControlPlaneToExecutorMessage,
  ExecutorToControlPlaneMessage,
  PreviewBindAckFrame,
  PreviewBindFrame,
  PreviewHttpRequestBodyFrame,
  PreviewHttpRequestEndFrame,
  PreviewHttpRequestStartFrame,
  PreviewTunnelBinaryFrameHeader,
  PreviewWsCloseFrame,
  PreviewWsDataFrame,
  PreviewWsOpenFrame,
  PreviewTunnelFrame,
  PreviewTunnelPingFrame,
  WorkerConfig,
} from '@shared/types'
import {
  decodePreviewTunnelBinaryFrame,
  normalizePreviewTunnelChunkBytes,
  PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES,
} from '@shared/types'
import { resolvePreviewTunnelWsUrl } from '../control-plane/cloud-url'
import { localPreviewHttpProxy } from './local-http-proxy'
import { localPreviewWebSocketProxy } from './local-websocket-proxy'

type PreviewTunnelConnection = {
  socket: WebSocket
  previewSessionId: string
  executorId: string
  closedByManager: boolean
  targetUrl: string
  injectNavigationBridge: boolean
  binaryPayloads: boolean
  negotiatedChunkBytes: number
  messageQueue: Promise<void>
  sendQueue: PreviewTunnelQueuedMessage[]
  sendQueueScheduled: boolean
  sendQueueBytes: number
  tunnelSocket: WorkerPreviewTunnelSocket
}

type PreviewTunnelSendPriority = 'control' | 'interactive' | 'bulk'

type PreviewTunnelQueuedMessage = {
  priority: PreviewTunnelSendPriority
  payload: string | Uint8Array
  size: number
}

type WorkerPreviewTunnelSocket = {
  sendControl: (data: string | Uint8Array) => void
  sendInteractive: (data: string | Uint8Array) => void
  sendBulk: (data: string | Uint8Array) => void
}

const connections = new Map<string, PreviewTunnelConnection>()
const PREVIEW_TUNNEL_SEND_BUFFER_HIGH_WATERMARK_BYTES = 512 * 1024

const nowIso = () => new Date().toISOString()

const parseFrame = (raw: string) => JSON.parse(raw) as PreviewTunnelFrame

const readBinaryMessage = async (data: unknown): Promise<Uint8Array | null> => {
  if (typeof data === 'string') {
    return null
  }

  if (data instanceof Uint8Array) {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }

  return null
}

const logPreviewTunnel = (message: string, details: Record<string, unknown>) => {
  console.log('[preview-tunnel]', message, details)
}

const describeTunnelUrl = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return 'invalid-url'
  }
}

const emitStatus = (params: {
  send: (message: ExecutorToControlPlaneMessage) => boolean
  executorId: string
  previewSessionId: string
  status: 'connecting' | 'open' | 'closed' | 'error'
  message?: string
}) => {
  params.send({
    type: 'preview.tunnel.status',
    executorId: params.executorId,
    previewSessionId: params.previewSessionId,
    status: params.status,
    message: params.message,
    at: nowIso(),
  })
}

const getBufferedAmount = (socket: WebSocket) => {
  const bufferedAmount = (socket as WebSocket & { bufferedAmount?: number }).bufferedAmount
  return Math.max(0, Math.floor(bufferedAmount ?? 0))
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

const measurePayloadBytes = (payload: string | Uint8Array) => {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload)
  }

  return payload.byteLength
}

const drainSendQueue = (connection: PreviewTunnelConnection) => {
  connection.sendQueueScheduled = false
  if (connection.socket.readyState !== connection.socket.OPEN) {
    connection.sendQueue.length = 0
    connection.sendQueueBytes = 0
    return
  }

  while (connection.sendQueue.length > 0) {
    if (getBufferedAmount(connection.socket) >= PREVIEW_TUNNEL_SEND_BUFFER_HIGH_WATERMARK_BYTES) {
      connection.sendQueueScheduled = true
      setTimeout(() => {
        const current = connections.get(connection.previewSessionId)
        if (current?.socket === connection.socket) {
          drainSendQueue(current)
        }
      }, 8)
      return
    }

    const next = connection.sendQueue.shift()
    if (!next) {
      break
    }

    connection.sendQueueBytes = Math.max(0, connection.sendQueueBytes - next.size)
    connection.socket.send(next.payload)
  }
}

const enqueueSocketPayload = (
  connection: PreviewTunnelConnection,
  payload: string | Uint8Array,
  priority: PreviewTunnelSendPriority,
) => {
  const queued: PreviewTunnelQueuedMessage = {
    priority,
    payload,
    size: measurePayloadBytes(payload),
  }
  connection.sendQueue.push(queued)
  connection.sendQueue.sort((left, right) => getQueuedMessageWeight(left.priority) - getQueuedMessageWeight(right.priority))
  connection.sendQueueBytes += queued.size
  if (!connection.sendQueueScheduled) {
    connection.sendQueueScheduled = true
    queueMicrotask(() => {
      const current = connections.get(connection.previewSessionId)
      if (current?.socket === connection.socket) {
        drainSendQueue(current)
      }
    })
  }
}

const closeConnection = (previewSessionId: string, reason?: string) => {
  const connection = connections.get(previewSessionId)
  if (!connection) {
    return
  }

  localPreviewWebSocketProxy.closePreviewSession(previewSessionId, reason)
  connection.closedByManager = true
  connection.sendQueue.length = 0
  connection.sendQueueBytes = 0
  try {
    connection.socket.close(1000, reason)
  } catch {
    connection.socket.close()
  }
  connections.delete(previewSessionId)
}

const handleServerFrame = (params: {
  frame: PreviewTunnelFrame
  connection: PreviewTunnelConnection
  send: (message: ExecutorToControlPlaneMessage) => boolean
}) => {
  if (params.frame.type === 'preview.bind.ack') {
    const ack = params.frame as PreviewBindAckFrame
    if (!ack.accepted) {
      logPreviewTunnel('bind rejected', {
        previewSessionId: params.connection.previewSessionId,
        executorId: params.connection.executorId,
        reason: ack.reason || 'preview tunnel bind rejected',
      })
      emitStatus({
        send: params.send,
        executorId: params.connection.executorId,
        previewSessionId: params.connection.previewSessionId,
        status: 'error',
        message: ack.reason || 'preview tunnel bind rejected',
      })
      closeConnection(params.connection.previewSessionId, ack.reason || 'preview bind rejected')
      return
    }

    params.connection.binaryPayloads = ack.binaryPayloads === true
    params.connection.negotiatedChunkBytes = normalizePreviewTunnelChunkBytes(ack.maxChunkBytes)
    logPreviewTunnel('bind accepted', {
      previewSessionId: params.connection.previewSessionId,
      executorId: params.connection.executorId,
      publicHost: ack.publicHost,
      binaryPayloads: params.connection.binaryPayloads,
      negotiatedChunkBytes: params.connection.negotiatedChunkBytes,
    })
    emitStatus({
      send: params.send,
      executorId: params.connection.executorId,
      previewSessionId: params.connection.previewSessionId,
      status: 'open',
    })
    return
  }

  if (params.frame.type === 'preview.tunnel.ping') {
    const ping = params.frame as PreviewTunnelPingFrame
    params.connection.tunnelSocket.sendControl(JSON.stringify({
      type: 'preview.tunnel.pong',
      previewSessionId: params.connection.previewSessionId,
      sentAt: nowIso(),
      pingId: ping.pingId,
    }))
    return
  }

  if (params.frame.type === 'preview.http.request.start') {
    localPreviewHttpProxy.handleStart({
      frame: params.frame as PreviewHttpRequestStartFrame,
      socket: params.connection.tunnelSocket,
      targetUrl: params.connection.targetUrl,
      injectNavigationBridge: params.connection.injectNavigationBridge,
      binaryPayloads: params.connection.binaryPayloads,
      chunkBytes: params.connection.negotiatedChunkBytes,
    })
    return
  }

  if (params.frame.type === 'preview.http.request.body') {
    localPreviewHttpProxy.handleBody(params.frame as PreviewHttpRequestBodyFrame)
    return
  }

  if (params.frame.type === 'preview.http.request.end') {
    localPreviewHttpProxy.handleEnd({
      frame: params.frame as PreviewHttpRequestEndFrame,
    })
    return
  }

  if (params.frame.type === 'preview.http.abort') {
    localPreviewHttpProxy.abort(params.frame.previewSessionId, params.frame.streamId)
    return
  }

  if (params.frame.type === 'preview.ws.open') {
    localPreviewWebSocketProxy.open({
      frame: params.frame as PreviewWsOpenFrame,
      socket: params.connection.tunnelSocket,
      targetUrl: params.connection.targetUrl,
      binaryPayloads: params.connection.binaryPayloads,
    })
    return
  }

  if (params.frame.type === 'preview.ws.data') {
    localPreviewWebSocketProxy.handleData(params.frame as PreviewWsDataFrame)
    return
  }

  if (params.frame.type === 'preview.ws.close') {
    localPreviewWebSocketProxy.handleClose(params.frame as PreviewWsCloseFrame)
  }
}

const handleServerMessage = async (params: {
  data: unknown
  connection: PreviewTunnelConnection
  send: (message: ExecutorToControlPlaneMessage) => boolean
}) => {
  const binaryMessage = await readBinaryMessage(params.data)
  if (binaryMessage) {
    if (!params.connection.binaryPayloads) {
      throw new Error('preview tunnel binary payloads not negotiated')
    }

    const decoded = decodePreviewTunnelBinaryFrame(binaryMessage)
    if (!decoded) {
      throw new Error('invalid preview tunnel binary frame')
    }
    handleServerBinaryFrame({
      header: decoded.header,
      payload: decoded.payload,
      connection: params.connection,
    })
    return
  }

  handleServerFrame({
    frame: parseFrame(String(params.data)),
    connection: params.connection,
    send: params.send,
  })
}

const queueServerMessage = (params: {
  data: unknown
  connection: PreviewTunnelConnection
  send: (message: ExecutorToControlPlaneMessage) => boolean
}) => {
  params.connection.messageQueue = params.connection.messageQueue
    .catch(() => undefined)
    .then(() => handleServerMessage(params))
    .catch((error) => {
      emitStatus({
        send: params.send,
        executorId: params.connection.executorId,
        previewSessionId: params.connection.previewSessionId,
        status: 'error',
        message: error instanceof Error ? error.message : 'invalid preview tunnel frame',
      })
    })
}

const handleServerBinaryFrame = (params: {
  header: PreviewTunnelBinaryFrameHeader
  payload: Uint8Array
  connection: PreviewTunnelConnection
}) => {
  if (params.header.previewSessionId !== params.connection.previewSessionId) {
    params.connection.socket.close(4410, 'preview session mismatch')
    return
  }

  if (params.header.type === 'preview.http.request.body.binary') {
    localPreviewHttpProxy.handleBinaryBody(params.header, params.payload)
    return
  }

  if (params.header.type === 'preview.ws.data.binary') {
    localPreviewWebSocketProxy.handleBinaryData(params.header, params.payload)
  }
}

export const previewTunnelManager = {
  open(
    message: Extract<ControlPlaneToExecutorMessage, { type: 'preview.tunnel.open' }>,
    config: WorkerConfig,
    send: (message: ExecutorToControlPlaneMessage) => boolean,
  ) {
    closeConnection(message.previewSessionId, 'replaced')
    emitStatus({
      send,
      executorId: config.executorId!,
      previewSessionId: message.previewSessionId,
      status: 'connecting',
    })

    const baseUrl = resolvePreviewTunnelWsUrl({
      cloudUrl: config.cloudUrl,
      tunnelUrl: message.tunnelUrl,
    })
    const url = `${baseUrl}?preview_session_id=${encodeURIComponent(message.previewSessionId)}&token=${encodeURIComponent(message.tunnelToken)}`
    const socket = new WebSocket(url)
    const connection: PreviewTunnelConnection = {
      socket,
      previewSessionId: message.previewSessionId,
      executorId: config.executorId!,
      closedByManager: false,
      targetUrl: message.targetUrl,
      injectNavigationBridge: message.injectNavigationBridge !== false,
      binaryPayloads: false,
      negotiatedChunkBytes: PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES,
      messageQueue: Promise.resolve(),
      sendQueue: [],
      sendQueueScheduled: false,
      sendQueueBytes: 0,
      tunnelSocket: {
        sendControl: (data) => enqueueSocketPayload(connection, data, 'control'),
        sendInteractive: (data) => enqueueSocketPayload(connection, data, 'interactive'),
        sendBulk: (data) => enqueueSocketPayload(connection, data, 'bulk'),
      },
    }
    connections.set(message.previewSessionId, connection)

    logPreviewTunnel('connecting', {
      previewSessionId: message.previewSessionId,
      executorId: config.executorId,
      tunnelUrl: describeTunnelUrl(baseUrl),
      targetUrl: message.targetUrl,
    })

    socket.addEventListener('open', () => {
      const current = connections.get(message.previewSessionId)
      if (!current || current.socket !== socket) {
        return
      }

      logPreviewTunnel('websocket open', {
        previewSessionId: message.previewSessionId,
        executorId: config.executorId,
      })
      const bind: PreviewBindFrame = {
        type: 'preview.bind',
        previewSessionId: message.previewSessionId,
        sentAt: nowIso(),
        protocolVersion: 'preview-tunnel.v1',
        executorId: config.executorId!,
        binaryPayloads: true,
        preferredChunkBytes: PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES,
      }
      connection.tunnelSocket.sendControl(JSON.stringify(bind))
    })

    socket.addEventListener('message', (event) => {
      const current = connections.get(message.previewSessionId)
      if (!current || current.socket !== socket) {
        return
      }

      queueServerMessage({
        data: event.data,
        connection: current,
        send,
      })
    })

    socket.addEventListener('error', () => {
      const current = connections.get(message.previewSessionId)
      if (!current || current.socket !== socket) {
        return
      }

      logPreviewTunnel('websocket error', {
        previewSessionId: message.previewSessionId,
        executorId: config.executorId,
      })
      emitStatus({
        send,
        executorId: config.executorId!,
        previewSessionId: message.previewSessionId,
        status: 'error',
        message: 'preview tunnel websocket error',
      })
    })

    socket.addEventListener('close', (event) => {
      const current = connections.get(message.previewSessionId)
      if (!current || current.socket !== socket) {
        return
      }

      connections.delete(message.previewSessionId)
      logPreviewTunnel('websocket closed', {
        previewSessionId: message.previewSessionId,
        executorId: config.executorId,
        code: event.code,
        reason: event.reason?.trim() || undefined,
        closedByManager: current.closedByManager,
      })
      emitStatus({
        send,
        executorId: config.executorId!,
        previewSessionId: message.previewSessionId,
        status: 'closed',
        message: current.closedByManager ? undefined : (event.reason?.trim() || `code=${event.code}`),
      })
    })
  },

  close(previewSessionId: string, reason?: string) {
    closeConnection(previewSessionId, reason)
  },

  closeAll(reason?: string) {
    localPreviewWebSocketProxy.closeAll(reason)
    for (const previewSessionId of connections.keys()) {
      closeConnection(previewSessionId, reason)
    }
  },
}
