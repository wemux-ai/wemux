// [INPUT]: HTTP 代理输入
// [OUTPUT]: 代理结果
// [POS]: 本地 HTTP 代理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  PreviewNavigationBridgeMessage,
  PreviewHttpAbortFrame,
  PreviewHttpRequestBodyFrame,
  PreviewHttpRequestEndFrame,
  PreviewHttpRequestStartFrame,
  PreviewHttpResponseBodyFrame,
  PreviewHttpResponseEndFrame,
  PreviewHttpResponseStartFrame,
  PreviewTunnelBinaryFrameHeader,
} from '@shared/types'
import {
  PREVIEW_NAVIGATION_BRIDGE_MESSAGE_TYPE,
  encodePreviewTunnelBinaryFrame,
  PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES,
} from '@shared/types'

type WorkerPreviewTunnelSocket = {
  sendControl: (data: string | Uint8Array) => void
  sendInteractive: (data: string | Uint8Array) => void
  sendBulk: (data: string | Uint8Array) => void
}

type PendingHttpRequest = {
  method: string
  pathWithQuery: string
  headers: Array<[string, string]>
  bodyChunks: Uint8Array[]
  hasBody: boolean
  startRequest?: () => void
  injectNavigationBridge: boolean
}

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
const FETCH_DECODED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  // Node fetch transparently decodes compressed bodies, so these headers would
  // make the browser try to decode already-decoded tunnel payloads again.
  'content-encoding',
])
const DEFAULT_CHUNK_BYTES = PREVIEW_TUNNEL_DEFAULT_CHUNK_BYTES
const PREVIEW_NAVIGATION_BRIDGE_MARKER = 'data-wemux-preview-navigation-bridge'
const previewNavigationBridgeMessageType: PreviewNavigationBridgeMessage['type'] = PREVIEW_NAVIGATION_BRIDGE_MESSAGE_TYPE
const PREVIEW_NAVIGATION_BRIDGE_SCRIPT = `<script ${PREVIEW_NAVIGATION_BRIDGE_MARKER}>(()=>{if(window.__wemuxPreviewNavigationBridgeInstalled)return;window.__wemuxPreviewNavigationBridgeInstalled=true;const t=${JSON.stringify(previewNavigationBridgeMessageType)};let e="";const n=o=>{const r=window.location.href;if(r===e)return;e=r;try{window.parent&&window.parent!==window&&window.parent.postMessage({type:t,href:r,navigationType:o},"*")}catch{}};const o=t=>window.setTimeout(()=>n(t),0);const r=window.history.pushState,i=window.history.replaceState;typeof r=="function"&&(window.history.pushState=function(...t){const e=r.apply(this,t);return o("push"),e});typeof i=="function"&&(window.history.replaceState=function(...t){const e=i.apply(this,t);return o("replace"),e});window.addEventListener("popstate",()=>o("pop"));window.addEventListener("hashchange",()=>o("hash"));window.addEventListener("pageshow",()=>o("pageshow"));n("load");})();</script>`

const pendingRequests = new Map<string, PendingHttpRequest>()
const inflightRequestControllers = new Map<string, AbortController>()

const nowIso = () => new Date().toISOString()

const buildPendingKey = (previewSessionId: string, streamId: string) => `${previewSessionId}:${streamId}`

const sendFrame = (
  socket: WorkerPreviewTunnelSocket,
  frame:
    | PreviewHttpResponseStartFrame
    | PreviewHttpResponseBodyFrame
    | PreviewHttpResponseEndFrame
    | PreviewHttpAbortFrame,
) => {
  socket.sendControl(JSON.stringify(frame))
}

const sendBinaryFrame = (
  socket: WorkerPreviewTunnelSocket,
  header: PreviewTunnelBinaryFrameHeader,
  payload: Uint8Array,
) => {
  socket.sendBulk(encodePreviewTunnelBinaryFrame(header, payload))
}

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

const resolveUpstreamUrl = (targetUrl: string, pathWithQuery: string) => {
  const baseUrl = new URL(targetUrl)
  const requestUrl = new URL(pathWithQuery, baseUrl)
  requestUrl.pathname = joinBasePath(baseUrl.pathname, requestUrl.pathname)
  return requestUrl.toString()
}

const normalizeRequestHeaders = (headers: Array<[string, string]>) => {
  const next = new Headers()
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalized)) {
      continue
    }
    if (normalized === 'accept-encoding') {
      continue
    }
    next.set(name, value)
  }
  next.set('accept-encoding', 'identity')
  return next
}

const sendResponseBodyChunk = (params: {
  socket: WorkerPreviewTunnelSocket
  previewSessionId: string
  streamId: string
  chunk: Uint8Array
  seq: number
  binaryPayloads: boolean
}) => {
  if (params.binaryPayloads) {
    sendBinaryFrame(params.socket, {
      type: 'preview.http.response.body.binary',
      previewSessionId: params.previewSessionId,
      streamId: params.streamId,
      sentAt: nowIso(),
      seq: params.seq,
    }, params.chunk)
    return
  }

  const bodyFrame: PreviewHttpResponseBodyFrame = {
    type: 'preview.http.response.body',
    previewSessionId: params.previewSessionId,
    streamId: params.streamId,
    sentAt: nowIso(),
    seq: params.seq,
    encoding: 'base64',
  data: Buffer.from(params.chunk).toString('base64'),
  }
  params.socket.sendBulk(JSON.stringify(bodyFrame))
}

const collectResponseHeaders = (response: Response) => {
  const responseHeaders: Array<[string, string]> = []
  const getSetCookie = (response.headers as Headers & {
    getSetCookie?: () => string[]
  }).getSetCookie

  response.headers.forEach((value, name) => {
    const normalized = name.toLowerCase()
    if (normalized === 'set-cookie') {
      return
    }
    if (FETCH_DECODED_RESPONSE_HEADERS.has(normalized)) {
      return
    }
    responseHeaders.push([name, value])
  })

  for (const cookie of getSetCookie?.call(response.headers) ?? []) {
    responseHeaders.push(['set-cookie', cookie])
  }

  return responseHeaders
}

const shouldInjectPreviewNavigationBridge = (request: PendingHttpRequest, response: Response) => {
  if (!request.injectNavigationBridge) {
    return false
  }

  const method = request.method.toUpperCase()
  if (method === 'HEAD' || response.status === 204 || response.status === 304) {
    return false
  }

  return response.headers.get('content-type')?.toLowerCase().includes('text/html') ?? false
}

export const injectPreviewNavigationBridge = (html: string) => {
  if (!html || html.includes(PREVIEW_NAVIGATION_BRIDGE_MARKER)) {
    return html
  }

  const headCloseIndex = html.search(/<\/head\s*>/i)
  if (headCloseIndex >= 0) {
    return `${html.slice(0, headCloseIndex)}${PREVIEW_NAVIGATION_BRIDGE_SCRIPT}${html.slice(headCloseIndex)}`
  }

  const bodyCloseIndex = html.search(/<\/body\s*>/i)
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${PREVIEW_NAVIGATION_BRIDGE_SCRIPT}${html.slice(bodyCloseIndex)}`
  }

  return `${html}${PREVIEW_NAVIGATION_BRIDGE_SCRIPT}`
}

const startUpstreamRequest = (params: {
  socket: WorkerPreviewTunnelSocket
  previewSessionId: string
  streamId: string
  targetUrl: string
  request: PendingHttpRequest
  binaryPayloads: boolean
  chunkBytes: number
}) => {
  void performRequest(params)
}

const concatBodyChunks = (chunks: Uint8Array[]) => {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const sendResponseBody = (params: {
  socket: WorkerPreviewTunnelSocket
  previewSessionId: string
  streamId: string
  body: Uint8Array
  binaryPayloads: boolean
  chunkBytes: number
}) => {
  let seq = 0
  for (let offset = 0; offset < params.body.byteLength; offset += params.chunkBytes) {
    sendResponseBodyChunk({
      socket: params.socket,
      previewSessionId: params.previewSessionId,
      streamId: params.streamId,
      chunk: params.body.subarray(offset, offset + params.chunkBytes),
      seq,
      binaryPayloads: params.binaryPayloads,
    })
    seq += 1
  }
}

const performRequest = async (params: {
  socket: WorkerPreviewTunnelSocket
  previewSessionId: string
  streamId: string
  targetUrl: string
  request: PendingHttpRequest
  binaryPayloads: boolean
  chunkBytes: number
}) => {
  const key = buildPendingKey(params.previewSessionId, params.streamId)
  const controller = new AbortController()
  inflightRequestControllers.set(key, controller)
  const upstreamUrl = resolveUpstreamUrl(params.targetUrl, params.request.pathWithQuery)

  try {
    const body = params.request.hasBody
      ? concatBodyChunks(params.request.bodyChunks)
      : undefined

    const response = await fetch(upstreamUrl, {
      method: params.request.method,
      headers: normalizeRequestHeaders(params.request.headers),
      body,
      signal: controller.signal,
    })

    const injectNavigationBridge = shouldInjectPreviewNavigationBridge(params.request, response)
    const startFrame: PreviewHttpResponseStartFrame = {
      type: 'preview.http.response.start',
      previewSessionId: params.previewSessionId,
      streamId: params.streamId,
      sentAt: nowIso(),
      status: response.status,
      headers: collectResponseHeaders(response),
    }
  sendFrame(params.socket, startFrame)

    if (injectNavigationBridge) {
      const html = await response.text()
      sendResponseBody({
        socket: params.socket,
        previewSessionId: params.previewSessionId,
        streamId: params.streamId,
        body: new TextEncoder().encode(injectPreviewNavigationBridge(html)),
        binaryPayloads: params.binaryPayloads,
        chunkBytes: params.chunkBytes,
      })
    } else if (response.body) {
      const reader = response.body.getReader()
      let seq = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        const chunk = value ?? new Uint8Array(0)
        for (let offset = 0; offset < chunk.byteLength; offset += params.chunkBytes) {
          sendResponseBodyChunk({
            socket: params.socket,
            previewSessionId: params.previewSessionId,
            streamId: params.streamId,
            chunk: chunk.subarray(offset, offset + params.chunkBytes),
            seq,
            binaryPayloads: params.binaryPayloads,
          })
          seq += 1
        }
      }
    }

    const endFrame: PreviewHttpResponseEndFrame = {
      type: 'preview.http.response.end',
      previewSessionId: params.previewSessionId,
      streamId: params.streamId,
      sentAt: nowIso(),
    }
    params.socket.sendBulk(JSON.stringify(endFrame))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'local preview upstream request failed'
    const errorCode = typeof error === 'object' && error && 'cause' in error
      ? (error as { cause?: { code?: string } }).cause?.code
      : undefined
    const abortFrame: PreviewHttpAbortFrame = {
      type: 'preview.http.abort',
      previewSessionId: params.previewSessionId,
      streamId: params.streamId,
      sentAt: nowIso(),
      code: controller.signal.aborted ? 'client_closed' : 'upstream_connect_failed',
      message: controller.signal.aborted
        ? `Preview upstream request was aborted: ${upstreamUrl}`
        : `Failed to reach preview upstream ${upstreamUrl}${errorCode ? ` (${errorCode})` : ''}: ${errorMessage}`,
    }
    sendFrame(params.socket, abortFrame)
  } finally {
    inflightRequestControllers.delete(key)
  }
}

export const localPreviewHttpProxy = {
  handleStart(params: {
    frame: PreviewHttpRequestStartFrame
    socket: WorkerPreviewTunnelSocket
    targetUrl: string
    injectNavigationBridge?: boolean
    binaryPayloads: boolean
    chunkBytes?: number
  }) {
    const pending: PendingHttpRequest = {
      method: params.frame.method,
      pathWithQuery: params.frame.pathWithQuery,
      headers: params.frame.headers,
      hasBody: params.frame.hasBody,
      bodyChunks: [],
      injectNavigationBridge: params.injectNavigationBridge !== false && params.frame.injectNavigationBridge !== false,
    }
    pendingRequests.set(buildPendingKey(params.frame.previewSessionId, params.frame.streamId), pending)
    pending.startRequest = () => startUpstreamRequest({
      socket: params.socket,
      previewSessionId: params.frame.previewSessionId,
      streamId: params.frame.streamId,
      targetUrl: params.frame.targetUrl || params.targetUrl,
      request: pending,
      binaryPayloads: params.binaryPayloads,
      chunkBytes: params.chunkBytes ?? DEFAULT_CHUNK_BYTES,
    })

    if (!pending.hasBody) {
      pendingRequests.delete(buildPendingKey(params.frame.previewSessionId, params.frame.streamId))
      pending.startRequest()
    }
  },

  handleBody(frame: PreviewHttpRequestBodyFrame) {
    const pending = pendingRequests.get(buildPendingKey(frame.previewSessionId, frame.streamId))
    if (!pending) {
      return
    }

    pending.bodyChunks.push(Buffer.from(frame.data, 'base64'))
  },

  handleBinaryBody(header: PreviewTunnelBinaryFrameHeader, payload: Uint8Array) {
    if (header.type !== 'preview.http.request.body.binary') {
      return
    }

    const pending = pendingRequests.get(buildPendingKey(header.previewSessionId, header.streamId))
    if (!pending) {
      return
    }

    pending.bodyChunks.push(payload)
  },

  handleEnd(params: {
    frame: PreviewHttpRequestEndFrame
  }) {
    const key = buildPendingKey(params.frame.previewSessionId, params.frame.streamId)
    const pending = pendingRequests.get(key)
    if (!pending) {
      return
    }

    pendingRequests.delete(key)
    pending.startRequest?.()
  },

  abort(previewSessionId: string, streamId: string) {
    const key = buildPendingKey(previewSessionId, streamId)
    const pending = pendingRequests.get(key)
    pendingRequests.delete(key)
    inflightRequestControllers.get(key)?.abort()
  },
}
