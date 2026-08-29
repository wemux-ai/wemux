// [INPUT]: 预览入口 HTTP 输入
// [OUTPUT]: 服务
// [POS]: 预览入口服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'
import { WebSocket as NodeWebSocket, type RawData } from 'ws'
import type { WorkerConfig } from '@shared/types'
import { previewIngressRegistry } from './registry'

type NodeFetchRequestInit = RequestInit & {
  duplex?: 'half'
}

type AsyncIterableReadableStream = AsyncIterable<Uint8Array>

type PreviewWebSocketServer = {
  handleUpgrade: (
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (clientSocket: NodeWebSocket) => void,
  ) => void
  close: () => void
}

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws') as {
  WebSocketServer: new (options: { noServer: true }) => PreviewWebSocketServer
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
  'content-encoding',
])

const PREVIEW_HTTP_PREFIX = '/api/preview-ingress/http/'
const PREVIEW_WS_PREFIX = '/api/preview-ingress/ws/'
const PREVIEW_MESH_HTTP_PREFIX = '/api/preview-mesh/http/'
const PREVIEW_MESH_WS_PREFIX = '/api/preview-mesh/ws/'
const TERMINAL_MESH_WS_PATH = '/api/terminal-mesh/ws'
const TERMINAL_PUBLIC_WS_PATH = '/api/terminal-public/ws'
const DEFAULT_PREVIEW_INGRESS_HOST = '0.0.0.0'
const WS_CONNECTING = 0
const WS_OPEN = 1

const parseRequestUrl = (request: http.IncomingMessage) => new URL(request.url || '/', 'http://127.0.0.1')

const getPreviewIdFromPath = (pathname: string, prefix: string) => {
  if (!pathname.startsWith(prefix)) {
    return ''
  }
  return decodeURIComponent(pathname.slice(prefix.length).split('/')[0] || '')
}

const sendJson = (response: http.ServerResponse, statusCode: number, payload: unknown) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
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
  return requestUrl
}

const normalizeHttpRequestHeaders = (headers: http.IncomingHttpHeaders) => {
  const next = new Headers()
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(name) || name === 'accept-encoding' || name === 'authorization') {
      continue
    }
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        next.append(rawName, value)
      }
      continue
    }
    if (typeof rawValue === 'string') {
      next.set(rawName, rawValue)
    }
  }
  next.set('accept-encoding', 'identity')
  return next
}

const pipeNodeRequestBody = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

const resolveTargetUrl = (previewId: string, rawTargetUrl?: string | null) => {
  const route = previewIngressRegistry.get(previewId)
  if (!route) {
    return null
  }
  const targetUrl = rawTargetUrl?.trim()
  if (!targetUrl) {
    return route.targetUrl
  }
  return route.additionalTargetUrls.includes(targetUrl) ? targetUrl : null
}

const copyResponseHeaders = (upstream: Response, response: http.ServerResponse) => {
  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  upstream.headers.forEach((value, name) => {
    if (FETCH_DECODED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      return
    }
    response.setHeader(name, value)
  })
  const cookies = getSetCookie?.call(upstream.headers) ?? []
  if (cookies.length > 0) {
    response.setHeader('set-cookie', cookies)
  }
}

const buildWebSocketOrigin = (upstreamUrl: string) => {
  const url = new URL(upstreamUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.origin
}

const normalizeWebSocketUrl = (targetUrl: string, pathWithQuery: string) => {
  const upstreamUrl = resolveUpstreamUrl(targetUrl, pathWithQuery)
  upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return upstreamUrl.toString()
}

const parseEncodedJsonHeader = <T>(value: string | string[] | undefined): T | null => {
  const encoded = Array.isArray(value) ? value[0] : value
  if (!encoded?.trim()) {
    return null
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

const normalizeWebSocketHeaders = (headers: Array<[string, string]>, upstreamUrl: string) => {
  const normalized: Record<string, string> = {}
  const upstreamOrigin = buildWebSocketOrigin(upstreamUrl)
  let hasOrigin = false
  for (const [name, value] of headers) {
    const lower = name.toLowerCase()
    if (lower === 'authorization' || lower.startsWith('x-vibemux-preview-')) {
      continue
    }
    if (lower === 'origin') {
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

const toBuffer = (payload: RawData) => {
  if (Buffer.isBuffer(payload)) {
    return payload
  }
  if (Array.isArray(payload)) {
    return Buffer.concat(payload)
  }
  return Buffer.from(payload)
}

const isWsOpen = (socket: Pick<NodeWebSocket, 'readyState'>) => socket.readyState === WS_OPEN

const isWsOpenOrConnecting = (socket: Pick<NodeWebSocket, 'readyState'>) => (
  socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING
)

const normalizeWsCloseCode = (code: number) => (
  code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 && code !== 1015
    ? code
    : 1000
)

const proxyWebSocketRequest = (params: {
  webSocketServer: PreviewWebSocketServer
  request: http.IncomingMessage
  socket: Duplex
  head: Buffer
  targetUrl: string
  pathWithQuery: string
}) => {
  params.webSocketServer.handleUpgrade(params.request, params.socket, params.head, (clientSocket) => {
    const relayHeaders = parseEncodedJsonHeader<Array<[string, string]>>(params.request.headers['x-vibemux-preview-relay-headers']) ?? []
    const relaySubprotocols = parseEncodedJsonHeader<string[]>(params.request.headers['x-vibemux-preview-relay-subprotocols']) ?? []
    const upstreamUrl = normalizeWebSocketUrl(params.targetUrl, params.pathWithQuery)
    const upstreamSocket = new NodeWebSocket(
      upstreamUrl,
      relaySubprotocols.length > 0 ? relaySubprotocols : undefined,
      { headers: normalizeWebSocketHeaders(relayHeaders, upstreamUrl) },
    )
    upstreamSocket.on('message', (payload) => {
      if (isWsOpen(clientSocket)) {
        clientSocket.send(toBuffer(payload))
      }
    })
    upstreamSocket.on('close', (code, reason) => {
      if (isWsOpen(clientSocket)) {
        clientSocket.close(normalizeWsCloseCode(code), Buffer.from(reason).toString('utf8') || undefined)
      }
    })
    upstreamSocket.on('error', (error) => {
      if (isWsOpen(clientSocket)) {
        clientSocket.close(1011, error.message || 'upstream websocket failed')
      }
    })
    clientSocket.on('message', (payload) => {
      if (isWsOpen(upstreamSocket)) {
        upstreamSocket.send(toBuffer(payload))
      }
    })
    clientSocket.on('close', (code, reason) => {
      if (isWsOpenOrConnecting(upstreamSocket)) {
        upstreamSocket.close(code, Buffer.from(reason).toString('utf8') || undefined)
      }
    })
    clientSocket.on('error', () => {
      if (isWsOpenOrConnecting(upstreamSocket)) {
        upstreamSocket.close(1011, 'client websocket failed')
      }
    })
  })
}

const isAuthorized = (request: http.IncomingMessage, sharedSecret: string) => {
  if (!sharedSecret) {
    return false
  }
  const authorization = request.headers.authorization?.trim() || ''
  return authorization === `Bearer ${sharedSecret}`
}

type MeshPreviewAccessTokenPayload = {
  kind: 'preview-mesh-access'
  previewSessionId: string
  workspaceId: string
  executorId: string
  sourceExecutorId?: string
  exp: number
  iat: number
  nonce: string
}

type MeshTerminalAccessTokenPayload = {
  kind: 'terminal-mesh-access'
  workspaceId: string
  terminalId: string
  executorId: string
  sourceExecutorId?: string
  exp: number
  iat: number
  nonce: string
}

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
}

const parseMeshPreviewAccessToken = (
  token: string,
  sharedSecret: string,
): MeshPreviewAccessTokenPayload | null => {
  const dotIndex = token.indexOf('.')
  if (!sharedSecret || dotIndex === -1) {
    return null
  }

  const encoded = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)
  const expectedSignature = createHmac('sha256', sharedSecret).update(encoded).digest('base64url')
  if (!safeEqual(signature, expectedSignature)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<MeshPreviewAccessTokenPayload>
    if (
      payload.kind !== 'preview-mesh-access'
      || typeof payload.previewSessionId !== 'string'
      || !payload.previewSessionId.trim()
      || typeof payload.workspaceId !== 'string'
      || !payload.workspaceId.trim()
      || typeof payload.executorId !== 'string'
      || !payload.executorId.trim()
      || typeof payload.exp !== 'number'
      || payload.exp <= Date.now()
      || typeof payload.iat !== 'number'
      || typeof payload.nonce !== 'string'
      || !payload.nonce
    ) {
      return null
    }

    return {
      kind: 'preview-mesh-access',
      previewSessionId: payload.previewSessionId,
      workspaceId: payload.workspaceId,
      executorId: payload.executorId,
      sourceExecutorId: typeof payload.sourceExecutorId === 'string' ? payload.sourceExecutorId : undefined,
      exp: payload.exp,
      iat: payload.iat,
      nonce: payload.nonce,
    }
  } catch {
    return null
  }
}

const parseMeshTerminalAccessToken = (
  token: string,
  sharedSecret: string,
): MeshTerminalAccessTokenPayload | null => {
  const dotIndex = token.indexOf('.')
  if (!sharedSecret || dotIndex === -1) {
    return null
  }

  const encoded = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)
  const expectedSignature = createHmac('sha256', sharedSecret).update(encoded).digest('base64url')
  if (!safeEqual(signature, expectedSignature)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<MeshTerminalAccessTokenPayload>
    if (
      payload.kind !== 'terminal-mesh-access'
      || typeof payload.workspaceId !== 'string'
      || !payload.workspaceId.trim()
      || typeof payload.terminalId !== 'string'
      || !payload.terminalId.trim()
      || typeof payload.executorId !== 'string'
      || !payload.executorId.trim()
      || typeof payload.exp !== 'number'
      || payload.exp <= Date.now()
      || typeof payload.iat !== 'number'
      || typeof payload.nonce !== 'string'
      || !payload.nonce
    ) {
      return null
    }

    return {
      kind: 'terminal-mesh-access',
      workspaceId: payload.workspaceId,
      terminalId: payload.terminalId,
      executorId: payload.executorId,
      sourceExecutorId: typeof payload.sourceExecutorId === 'string' ? payload.sourceExecutorId : undefined,
      exp: payload.exp,
      iat: payload.iat,
      nonce: payload.nonce,
    }
  } catch {
    return null
  }
}

const getMeshPreviewAccessToken = (request: http.IncomingMessage, url: URL) => {
  const authorization = request.headers.authorization?.trim() || ''
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim()
  }
  return url.searchParams.get('vmx_mesh_token')?.trim() || ''
}

const getMeshAccessToken = (request: http.IncomingMessage, url: URL) => {
  const authorization = request.headers.authorization?.trim() || ''
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim()
  }
  return url.searchParams.get('vmx_mesh_token')?.trim() || ''
}

const authorizeMeshPreviewRequest = (params: {
  request: http.IncomingMessage
  url: URL
  previewId: string
  route: NonNullable<ReturnType<typeof previewIngressRegistry.get>>
  sharedSecret: string
}) => {
  const token = getMeshPreviewAccessToken(params.request, params.url)
  const payload = parseMeshPreviewAccessToken(token, params.sharedSecret)
  if (!payload) {
    return false
  }

  return payload.previewSessionId === params.previewId
    && payload.workspaceId === params.route.workspaceId
    && payload.executorId === params.route.executorId
}

const authorizeMeshTerminalRequest = (params: {
  request: http.IncomingMessage
  url: URL
  sharedSecret: string
  executorId?: string
}) => {
  const token = getMeshAccessToken(params.request, params.url)
  const payload = parseMeshTerminalAccessToken(token, params.sharedSecret)
  if (!payload) {
    return false
  }

  return !params.executorId || payload.executorId === params.executorId
}

const getMeshPathWithQuery = (url: URL, previewId: string, prefix: string) => {
  const encodedPreviewId = encodeURIComponent(previewId)
  const prefixWithPreview = `${prefix}${encodedPreviewId}`
  const rawPath = url.pathname.startsWith(prefixWithPreview)
    ? url.pathname.slice(prefixWithPreview.length)
    : '/'
  url.searchParams.delete('vmx_mesh_token')
  const search = url.searchParams.toString()
  return `${rawPath || '/'}${search ? `?${search}` : ''}`
}

const proxyHttpRequest = async (params: {
  request: http.IncomingMessage
  response: http.ServerResponse
  targetUrl: string
  pathWithQuery: string
}) => {
  const body = params.request.method === 'GET' || params.request.method === 'HEAD'
    ? undefined
    : await pipeNodeRequestBody(params.request)
  const init: NodeFetchRequestInit = {
    method: params.request.method,
    headers: normalizeHttpRequestHeaders(params.request.headers),
    body,
    duplex: body ? 'half' : undefined,
  }
  const upstream = await fetch(resolveUpstreamUrl(params.targetUrl, params.pathWithQuery), init)

  params.response.statusCode = upstream.status
  copyResponseHeaders(upstream, params.response)
  if (!upstream.body) {
    params.response.end()
    return
  }

  for await (const chunk of upstream.body as unknown as AsyncIterableReadableStream) {
    params.response.write(Buffer.from(chunk))
  }
  params.response.end()
}

const buildLoopbackOriginForWebSocketUrl = (value: string) => {
  try {
    const url = new URL(value)
    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${url.host}`
  } catch {
    return 'http://127.0.0.1'
  }
}

const proxyRawWebSocketRequest = (params: {
  webSocketServer: PreviewWebSocketServer
  request: http.IncomingMessage
  socket: Duplex
  head: Buffer
  upstreamUrl: string
}) => {
  params.webSocketServer.handleUpgrade(params.request, params.socket, params.head, (clientSocket) => {
    const upstreamSocket = new NodeWebSocket(params.upstreamUrl, undefined, {
      headers: {
        origin: buildLoopbackOriginForWebSocketUrl(params.upstreamUrl),
      },
    })
    upstreamSocket.on('message', (payload) => {
      if (isWsOpen(clientSocket)) {
        clientSocket.send(toBuffer(payload))
      }
    })
    upstreamSocket.on('close', (code, reason) => {
      if (isWsOpen(clientSocket)) {
        clientSocket.close(code || 1000, Buffer.from(reason).toString('utf8') || undefined)
      }
    })
    upstreamSocket.on('error', (error) => {
      if (isWsOpen(clientSocket)) {
        clientSocket.close(1011, error.message || 'upstream websocket failed')
      }
    })
    clientSocket.on('message', (payload) => {
      if (isWsOpen(upstreamSocket)) {
        upstreamSocket.send(toBuffer(payload))
      }
    })
    clientSocket.on('close', (code, reason) => {
      if (isWsOpenOrConnecting(upstreamSocket)) {
        upstreamSocket.close(normalizeWsCloseCode(code), Buffer.from(reason).toString('utf8') || undefined)
      }
    })
  })
}

export const buildPreviewIngressBaseUrl = (params: {
  publicIp: string
  port: number
}) => {
  const host = params.publicIp.includes(':') && !params.publicIp.startsWith('[')
    ? `[${params.publicIp}]`
    : params.publicIp
  return `http://${host}:${params.port}`
}

export const shouldEnablePreviewIngress = (config: WorkerConfig) => {
  return config.previewExposureMode === 'public-ingress'
    && typeof config.previewIngressPort === 'number'
    && Number.isFinite(config.previewIngressPort)
    && config.previewIngressPort > 0
}

export const startPreviewIngressServer = (params: {
  port: number
  sharedSecret: string
  listenHost?: string
  executorId?: string
  terminalDirectWsUrl?: string
}) => {
  const server = http.createServer(async (request, response) => {
    try {
      const url = parseRequestUrl(request)
      if (request.method === 'GET' && url.pathname === '/health') {
        if (!isAuthorized(request, params.sharedSecret)) {
          sendJson(response, 401, { message: 'unauthorized' })
          return
        }
        sendJson(response, 200, { ok: true, service: 'worker-preview-ingress' })
        return
      }

      if (!url.pathname.startsWith(PREVIEW_HTTP_PREFIX)) {
        if (!url.pathname.startsWith(PREVIEW_MESH_HTTP_PREFIX)) {
          sendJson(response, 404, { message: 'preview ingress endpoint not found' })
          return
        }

        const previewId = getPreviewIdFromPath(url.pathname, PREVIEW_MESH_HTTP_PREFIX)
        const route = previewId ? previewIngressRegistry.get(previewId) : null
        if (!previewId || !route) {
          sendJson(response, 404, { message: 'preview mesh target unavailable' })
          return
        }
        if (!authorizeMeshPreviewRequest({
          request,
          url,
          previewId,
          route,
          sharedSecret: params.sharedSecret,
        })) {
          sendJson(response, 401, { message: 'unauthorized' })
          return
        }

        await proxyHttpRequest({
          request,
          response,
          targetUrl: route.targetUrl,
          pathWithQuery: getMeshPathWithQuery(url, previewId, PREVIEW_MESH_HTTP_PREFIX),
        })
        return
      }

      if (!isAuthorized(request, params.sharedSecret)) {
        sendJson(response, 401, { message: 'unauthorized' })
        return
      }

      const previewId = getPreviewIdFromPath(url.pathname, PREVIEW_HTTP_PREFIX)
      const pathWithQuery = request.headers['x-vibemux-preview-path']
      const targetUrl = resolveTargetUrl(
        previewId,
        typeof request.headers['x-vibemux-preview-target-url'] === 'string'
          ? request.headers['x-vibemux-preview-target-url']
          : undefined,
      )
      if (!previewId) {
        sendJson(response, 400, { message: 'missing preview id' })
        return
      }
      if (!pathWithQuery || typeof pathWithQuery !== 'string') {
        sendJson(response, 400, { message: 'missing preview path' })
        return
      }
      if (!targetUrl) {
        sendJson(response, 404, { message: 'preview target unavailable' })
        return
      }

      await proxyHttpRequest({
        request,
        response,
        targetUrl,
        pathWithQuery,
      })
    } catch (error) {
      sendJson(response, 502, {
        message: error instanceof Error ? error.message : 'preview ingress proxy failed',
      })
    }
  })

  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on('close', () => {
    webSocketServer.close()
  })
  server.on('upgrade', (request, socket, head) => {
    const url = parseRequestUrl(request)

    if (!url.pathname.startsWith(PREVIEW_WS_PREFIX) && !url.pathname.startsWith(PREVIEW_MESH_WS_PREFIX) && url.pathname !== TERMINAL_MESH_WS_PATH && url.pathname !== TERMINAL_PUBLIC_WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    if (url.pathname === TERMINAL_PUBLIC_WS_PATH) {
      const ticket = url.searchParams.get('ticket')?.trim() || ''
      if (!ticket || !params.terminalDirectWsUrl) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const upstreamUrl = new URL(params.terminalDirectWsUrl)
      upstreamUrl.searchParams.set('ticket', ticket)
      proxyRawWebSocketRequest({
        webSocketServer,
        request,
        socket,
        head,
        upstreamUrl: upstreamUrl.toString(),
      })
      return
    }

    if (url.pathname === TERMINAL_MESH_WS_PATH) {
      const ticket = url.searchParams.get('ticket')?.trim() || ''
      if (!ticket || !params.terminalDirectWsUrl || !authorizeMeshTerminalRequest({
        request,
        url,
        sharedSecret: params.sharedSecret,
        executorId: params.executorId,
      })) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const upstreamUrl = new URL(params.terminalDirectWsUrl)
      upstreamUrl.searchParams.set('ticket', ticket)
      proxyRawWebSocketRequest({
        webSocketServer,
        request,
        socket,
        head,
        upstreamUrl: upstreamUrl.toString(),
      })
      return
    }

    if (url.pathname.startsWith(PREVIEW_MESH_WS_PREFIX)) {
      const previewId = getPreviewIdFromPath(url.pathname, PREVIEW_MESH_WS_PREFIX)
      const route = previewId ? previewIngressRegistry.get(previewId) : null
      if (!previewId || !route || !authorizeMeshPreviewRequest({
        request,
        url,
        previewId,
        route,
        sharedSecret: params.sharedSecret,
      })) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      const pathWithQuery = getMeshPathWithQuery(url, previewId, PREVIEW_MESH_WS_PREFIX)
      proxyWebSocketRequest({
        webSocketServer,
        request,
        socket,
        head,
        targetUrl: route.targetUrl,
        pathWithQuery,
      })
      return
    }

    if (!isAuthorized(request, params.sharedSecret)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const previewId = getPreviewIdFromPath(url.pathname, PREVIEW_WS_PREFIX)
    const pathWithQuery = url.searchParams.get('path')?.trim() || ''
    const targetUrl = resolveTargetUrl(previewId, url.searchParams.get('targetUrl'))
    if (!previewId || !pathWithQuery || !targetUrl) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    proxyWebSocketRequest({
      webSocketServer,
      request,
      socket,
      head,
      targetUrl,
      pathWithQuery,
    })
  })

  server.listen(params.port, params.listenHost || DEFAULT_PREVIEW_INGRESS_HOST, () => {
    console.log('[preview-ingress] listening', JSON.stringify({
      host: params.listenHost || DEFAULT_PREVIEW_INGRESS_HOST,
      port: params.port,
    }))
  })

  return server
}
