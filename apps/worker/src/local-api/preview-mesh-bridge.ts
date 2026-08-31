// [INPUT]: 本地 preview 请求
// [OUTPUT]: mesh 桥接
// [POS]: preview mesh 桥
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import http from 'node:http'
import type { Duplex } from 'node:stream'
import { createRequire } from 'node:module'
import { WebSocket as NodeWebSocket, type RawData } from 'ws'

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

const PREVIEW_MESH_HTTP_PREFIX = '/api/preview-mesh/http/'
const PREVIEW_MESH_WS_PREFIX = '/api/preview-mesh/ws/'
const PREVIEW_MESH_BRIDGE_BOOTSTRAP_PATH = '/api/preview-mesh-bridge/bootstrap'
const TERMINAL_MESH_WS_PATH = '/api/terminal-mesh/ws'
const TERMINAL_MESH_BRIDGE_WS_PATH = '/api/terminal-mesh-bridge/ws'
const PREVIEW_MESH_BRIDGE_COOKIE = 'vmx_mesh_bridge_target'
const PREVIEW_MESH_BRIDGE_HOST_SUFFIX = '.127.0.0.1.nip.io'
const PREVIEW_MESH_BRIDGE_HOST_PREFIX = 'preview-'
const MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS = 'WEMUX_MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS'
const WS_CONNECTING = 0
const WS_OPEN = 1

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

const parseRequestUrl = (request: http.IncomingMessage) => new URL(request.url || '/', 'http://127.0.0.1')

const getHostName = (request: http.IncomingMessage) => {
  const host = request.headers.host
  const rawHost = Array.isArray(host) ? host[0] : host
  return rawHost?.split(':')[0]?.trim().toLowerCase() || ''
}

const encodeCookieValue = (value: string) => Buffer.from(value).toString('base64url')

const decodeCookieValue = (value: string) => {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return ''
  }
}

const readCookie = (request: http.IncomingMessage, name: string) => {
  const cookie = request.headers.cookie
  const rawCookie = Array.isArray(cookie) ? cookie.join('; ') : cookie
  if (!rawCookie) {
    return ''
  }

  for (const part of rawCookie.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === name) {
      return rest.join('=')
    }
  }
  return ''
}

const sendJson = (response: http.ServerResponse, statusCode: number, payload: unknown) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(`${JSON.stringify(payload)}\n`)
}

const getPreviewIdFromMeshPath = (pathname: string, prefix: string) => {
  if (!pathname.startsWith(prefix)) {
    return ''
  }
  return decodeURIComponent(pathname.slice(prefix.length).split('/')[0] || '')
}

const getMeshPathAfterPreviewId = (pathname: string, prefix: string, previewId: string) => {
  const base = `${prefix}${encodeURIComponent(previewId)}`
  if (!pathname.startsWith(base)) {
    return '/'
  }
  return pathname.slice(base.length) || '/'
}

export const buildPreviewMeshBridgeHost = (previewId: string) => {
  const normalized = previewId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  return normalized ? `${PREVIEW_MESH_BRIDGE_HOST_PREFIX}${normalized}${PREVIEW_MESH_BRIDGE_HOST_SUFFIX}` : ''
}

export const isPreviewMeshBridgeHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  return normalized.startsWith(PREVIEW_MESH_BRIDGE_HOST_PREFIX)
    && normalized.endsWith(PREVIEW_MESH_BRIDGE_HOST_SUFFIX)
}

const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = parts
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

const isLoopbackHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized.startsWith('127.')
}

export const isAllowedMeshBridgeTargetHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  if (isLoopbackHost(normalized)) {
    return process.env[MESH_BRIDGE_ALLOW_LOOPBACK_TARGETS] === '1'
  }

  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    return true
  }

  return isPrivateIpv4(normalized)
}

export const validatePreviewMeshBridgeTarget = (targetUrl: string) => {
  try {
    const target = new URL(targetUrl)
    if (target.protocol !== 'http:') {
      return null
    }
    if (!isAllowedMeshBridgeTargetHost(target.hostname)) {
      return null
    }
    if (!target.pathname.startsWith(PREVIEW_MESH_HTTP_PREFIX)) {
      return null
    }
    if (!target.searchParams.get('vmx_mesh_token')?.trim()) {
      return null
    }
    const previewId = getPreviewIdFromMeshPath(target.pathname, PREVIEW_MESH_HTTP_PREFIX)
    if (!previewId) {
      return null
    }
    return {
      target,
      previewId,
      initialPath: getMeshPathAfterPreviewId(target.pathname, PREVIEW_MESH_HTTP_PREFIX, previewId),
    }
  } catch {
    return null
  }
}

export const validateTerminalMeshBridgeTarget = (targetUrl: string) => {
  try {
    const target = new URL(targetUrl)
    if (target.protocol !== 'ws:' || target.pathname !== TERMINAL_MESH_WS_PATH) {
      return null
    }
    if (!isAllowedMeshBridgeTargetHost(target.hostname)) {
      return null
    }
    if (!target.searchParams.get('vmx_mesh_token')?.trim()) {
      return null
    }
    return target
  } catch {
    return null
  }
}

const resolveStoredMeshTarget = (request: http.IncomingMessage) => {
  const encoded = readCookie(request, PREVIEW_MESH_BRIDGE_COOKIE)
  const decoded = encoded ? decodeCookieValue(encoded) : ''
  return decoded ? validatePreviewMeshBridgeTarget(decoded) : null
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

const normalizeHttpRequestHeaders = (headers: http.IncomingHttpHeaders) => {
  const next = new Headers()
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(name) || name === 'accept-encoding') {
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

const resolveMeshProxyUrl = (params: {
  storedTarget: NonNullable<ReturnType<typeof validatePreviewMeshBridgeTarget>>
  requestUrl: URL
  protocol: 'http' | 'ws'
}) => {
  const upstream = new URL(params.storedTarget.target.toString())
  upstream.protocol = `${params.protocol}:`
  upstream.pathname = `${params.protocol === 'ws' ? PREVIEW_MESH_WS_PREFIX : PREVIEW_MESH_HTTP_PREFIX}${encodeURIComponent(params.storedTarget.previewId)}${params.requestUrl.pathname || '/'}`
  const token = params.storedTarget.target.searchParams.get('vmx_mesh_token') || ''
  upstream.search = params.requestUrl.search
  upstream.searchParams.set('vmx_mesh_token', token)
  return upstream
}

const proxyHttpRequest = async (params: {
  request: http.IncomingMessage
  response: http.ServerResponse
  upstreamUrl: URL
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
  const upstream = await fetch(params.upstreamUrl, init)
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

const bridgeWebSocketServer = new WebSocketServer({ noServer: true })

const proxyWebSocketRequest = (params: {
  request: http.IncomingMessage
  socket: Duplex
  head: Buffer
  upstreamUrl: URL
}) => {
  bridgeWebSocketServer.handleUpgrade(params.request, params.socket, params.head, (clientSocket) => {
    const upstreamSocket = new NodeWebSocket(params.upstreamUrl.toString())
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
        clientSocket.close(1011, error.message || 'mesh preview websocket failed')
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
  })
}

export const handlePreviewMeshBridgeHttp = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => {
  const url = parseRequestUrl(request)
  if (request.method === 'GET' && url.pathname === PREVIEW_MESH_BRIDGE_BOOTSTRAP_PATH) {
    const targetUrl = url.searchParams.get('target')?.trim() || ''
    const validated = validatePreviewMeshBridgeTarget(targetUrl)
    if (!validated) {
      sendJson(response, 400, { message: 'invalid mesh preview target' })
      return true
    }

    const redirectUrl = new URL(`${validated.initialPath}${validated.target.search}`, 'http://127.0.0.1')
    redirectUrl.searchParams.delete('vmx_mesh_token')
    response.statusCode = 302
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Set-Cookie', `${PREVIEW_MESH_BRIDGE_COOKIE}=${encodeCookieValue(targetUrl)}; Path=/; HttpOnly; SameSite=Lax`)
    response.setHeader('Location', `${redirectUrl.pathname}${redirectUrl.search}${validated.target.hash}`)
    response.end()
    return true
  }

  if (!isPreviewMeshBridgeHost(getHostName(request))) {
    return false
  }

  const storedTarget = resolveStoredMeshTarget(request)
  if (!storedTarget) {
    sendJson(response, 401, { message: 'missing mesh preview bridge target' })
    return true
  }

  await proxyHttpRequest({
    request,
    response,
    upstreamUrl: resolveMeshProxyUrl({
      storedTarget,
      requestUrl: url,
      protocol: 'http',
    }),
  })
  return true
}

export const handlePreviewMeshBridgeUpgrade = (
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => {
  const url = parseRequestUrl(request)
  if (url.pathname === TERMINAL_MESH_BRIDGE_WS_PATH) {
    const target = validateTerminalMeshBridgeTarget(url.searchParams.get('target')?.trim() || '')
    const ticket = url.searchParams.get('ticket')?.trim() || ''
    if (!target || !ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return true
    }

    target.searchParams.set('ticket', ticket)
    proxyWebSocketRequest({
      request,
      socket,
      head,
      upstreamUrl: target,
    })
    return true
  }

  if (!isPreviewMeshBridgeHost(getHostName(request))) {
    return false
  }

  const storedTarget = resolveStoredMeshTarget(request)
  if (!storedTarget) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return true
  }

  proxyWebSocketRequest({
    request,
    socket,
    head,
    upstreamUrl: resolveMeshProxyUrl({
      storedTarget,
      requestUrl: parseRequestUrl(request),
      protocol: 'ws',
    }),
  })
  return true
}
