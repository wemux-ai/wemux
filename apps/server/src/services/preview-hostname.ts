// [INPUT]: preview 主机名输入
import { getEnv } from '@shared/env'
// [OUTPUT]: 解析结果
// [POS]: preview 主机名
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash } from 'node:crypto'
import type { ExecutorDescriptor } from '@shared/types'
import { resolveExecutorRealtimeBaseUrl } from './executor-realtime-routing'

const PREVIEW_BASE_DOMAIN_ENV = 'VIBEMUX_PROJECT_PREVIEW_BASE_DOMAIN'
const PREVIEW_SCHEME_ENV = 'VIBEMUX_PROJECT_PREVIEW_SCHEME'
const DOMESTIC_PREVIEW_BASE_DOMAIN_ENV = 'VIBEMUX_DOMESTIC_PREVIEW_BASE_DOMAIN'
const DOMESTIC_REALTIME_BASE_URL_ENV = 'VIBEMUX_DOMESTIC_REALTIME_BASE_URL'
const DOMESTIC_EXECUTOR_LABELS_ENV = 'VIBEMUX_DOMESTIC_EXECUTOR_LABELS'
const LOCAL_PREVIEW_HOST = 'wemux.localtest.me'
const DEFAULT_PREVIEW_HOST = 'wemux.xyz'
const DEFAULT_LOCAL_PREVIEW_WEB_PORT = '15173'
const DEFAULT_LOCAL_PREVIEW_SERVER_PORT = '18989'
const DEFAULT_DOMESTIC_EXECUTOR_LABELS = ['route:hk', 'realtime:hk']

type HeaderSource = Headers | {
  get?: (name: string) => string | null | undefined
} | Record<string, string | undefined | null>

type ExecutorRoutingInfo = Pick<ExecutorDescriptor, 'labels' | 'connectedNodeId'> | null | undefined

export const normalizePreviewHostSlug = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.slice(0, 16) || 'project'
}

export const normalizePreviewHostId = (value: string) => {
  const normalized = value.trim() || 'preview'
  const digest = createHash('sha256').update(normalized).digest()
  const shortCode = digest.readBigUInt64BE(0) % BigInt(36 ** 6)
  return shortCode.toString(36).padStart(6, '0')
}

export const normalizeRequestHost = (host: string) => {
  return host.trim().toLowerCase()
}

const normalizeExecutorLabel = (value: string) => value.trim().toLowerCase()

const getDomesticExecutorLabels = () => {
  const configured = process.env[DOMESTIC_EXECUTOR_LABELS_ENV]?.trim()
  if (!configured) {
    return DEFAULT_DOMESTIC_EXECUTOR_LABELS
  }

  const values = configured
    .split(',')
    .map((value) => normalizeExecutorLabel(value))
    .filter(Boolean)

  return values.length > 0 ? values : DEFAULT_DOMESTIC_EXECUTOR_LABELS
}

const buildOrigin = (protocol: string, host: string) => `${protocol}://${host}`

const normalizeHostWithoutPort = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, '')

export const isLocalPreviewHost = (host: string) => {
  const normalized = normalizeHostWithoutPort(host)
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized === 'host.docker.internal'
    || normalized.endsWith('.localtest.me')
}

const getHeaderValue = (headers: HeaderSource | undefined, name: string) => {
  if (!headers) {
    return ''
  }

  if (typeof headers.get === 'function') {
    return headers.get(name)?.trim() || ''
  }

  const expectedName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expectedName) {
      return `${value ?? ''}`.trim()
    }
  }

  return ''
}

const getForwardedHeaderValue = (headers: HeaderSource | undefined, name: string) => {
  const raw = getHeaderValue(headers, name)
  if (!raw) {
    return ''
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) || ''
}

const parseHeaderUrlHost = (value: string) => {
  if (!value) {
    return ''
  }

  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return ''
  }
}

const parseHeaderUrlScheme = (value: string) => {
  if (!value) {
    return undefined
  }

  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? protocol.slice(0, -1) as 'http' | 'https' : undefined
  } catch {
    return undefined
  }
}

const getConfiguredLocalPreviewWebPort = () => (
  process.env.HYBRID_WEB_PORT?.trim() || DEFAULT_LOCAL_PREVIEW_WEB_PORT
)

const getConfiguredLocalPreviewServerPort = () => {
  const candidates = [
    process.env.HYBRID_SERVER_PORT,
    getEnv('WEMUX_SERVER_PORT'),
    process.env.PORT,
  ]

  return candidates
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value && /^\d+$/.test(value)))
    ?? DEFAULT_LOCAL_PREVIEW_SERVER_PORT
}

const isLocalPreviewWebPort = (port: string) => (
  port === getConfiguredLocalPreviewWebPort() || port === DEFAULT_LOCAL_PREVIEW_WEB_PORT
)

const resolveLocalPreviewRequestHost = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  const candidates = [
    getForwardedHeaderValue(params.headers, 'x-forwarded-host'),
    parseHeaderUrlHost(getHeaderValue(params.headers, 'origin')),
    parseHeaderUrlHost(getHeaderValue(params.headers, 'referer')),
    getHeaderValue(params.headers, 'host'),
    new URL(params.requestUrl).host,
  ].map((value) => normalizeRequestHost(value)).filter(Boolean)

  return candidates.find(isLocalPreviewHost) || ''
}

const resolveLocalPreviewServerPort = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  const candidates = [
    new URL(params.requestUrl).host,
    getHeaderValue(params.headers, 'host'),
    getForwardedHeaderValue(params.headers, 'x-forwarded-host'),
  ]

  for (const candidate of candidates) {
    const port = (() => {
      try {
        return new URL(`http://${candidate}`).port
      } catch {
        return ''
      }
    })()
    if (port && !isLocalPreviewWebPort(port)) {
      return port
    }
  }

  return getConfiguredLocalPreviewServerPort()
}

const resolveLocalPreviewRequestScheme = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  const forwardedProto = getForwardedHeaderValue(params.headers, 'x-forwarded-proto')
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto
  }

  const originScheme = parseHeaderUrlScheme(getHeaderValue(params.headers, 'origin'))
  if (originScheme) {
    return originScheme
  }

  const refererScheme = parseHeaderUrlScheme(getHeaderValue(params.headers, 'referer'))
  if (refererScheme) {
    return refererScheme
  }

  return new URL(params.requestUrl).protocol === 'http:' ? 'http' : 'https'
}

const resolveExternalHost = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  const forwardedHost = getForwardedHeaderValue(params.headers, 'x-forwarded-host')
  if (forwardedHost) {
    return normalizeRequestHost(forwardedHost)
  }

  const requestHost = getHeaderValue(params.headers, 'host')
  if (requestHost) {
    return normalizeRequestHost(requestHost)
  }

  return normalizeRequestHost(new URL(params.requestUrl).host)
}

export const resolveExternalRequestScheme = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  if (resolveLocalPreviewRequestHost(params)) {
    return resolveLocalPreviewRequestScheme(params)
  }

  const configured = process.env[PREVIEW_SCHEME_ENV]?.trim()
  if (configured === 'http' || configured === 'https') {
    return configured
  }

  const forwardedProto = getForwardedHeaderValue(params.headers, 'x-forwarded-proto')
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto
  }

  if (!isLocalPreviewHost(resolveExternalHost(params))) {
    return 'https'
  }

  return new URL(params.requestUrl).protocol === 'http:' ? 'http' : 'https'
}

export const resolvePreviewBaseDomain = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  const localPreviewRequestHost = resolveLocalPreviewRequestHost(params)
  if (localPreviewRequestHost) {
    const port = resolveLocalPreviewServerPort(params)
    return `${LOCAL_PREVIEW_HOST}${port ? `:${port}` : ''}`
  }

  const configured = process.env[PREVIEW_BASE_DOMAIN_ENV]?.trim()
  if (configured) {
    return configured
  }

  const url = new URL(`http://${resolveExternalHost(params)}`)
  const hostname = url.hostname.toLowerCase()
  const port = url.port ? `:${url.port}` : ''
  if (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localtest.me')
  ) {
    return `${LOCAL_PREVIEW_HOST}${port}`
  }

  return DEFAULT_PREVIEW_HOST
}

export const shouldUseDomesticPreviewRouting = (executor?: ExecutorRoutingInfo) => {
  const labels = executor?.labels ?? []
  if (labels.length === 0) {
    return false
  }

  const currentLabels = new Set(labels.map((label) => normalizeExecutorLabel(label)))
  return getDomesticExecutorLabels().some((label) => currentLabels.has(label))
}

const resolveEffectivePreviewBaseDomain = (params: {
  requestUrl: string
  headers?: HeaderSource
  executor?: ExecutorRoutingInfo
}) => {
  if (shouldUseDomesticPreviewRouting(params.executor)) {
    const configured = process.env[DOMESTIC_PREVIEW_BASE_DOMAIN_ENV]?.trim()
    if (configured) {
      return configured
    }
  }

  return resolvePreviewBaseDomain({
    requestUrl: params.requestUrl,
    headers: params.headers,
  })
}

export const buildPreviewHost = (params: {
  requestUrl: string
  headers?: HeaderSource
  projectName: string
  previewId: string
  executor?: ExecutorRoutingInfo
}) => {
  const hostSlug = normalizePreviewHostSlug(params.projectName)
  const label = `${hostSlug}-preview--${normalizePreviewHostId(params.previewId)}`
  return `${label}.${resolveEffectivePreviewBaseDomain(params)}`
}

export const buildPreviewPublicUrl = (params: {
  requestUrl: string
  headers?: HeaderSource
  projectName: string
  previewId: string
  executor?: ExecutorRoutingInfo
}) => {
  const host = buildPreviewHost(params)
  const scheme = resolveExternalRequestScheme(params)
  return `${buildOrigin(scheme, host)}/`
}

export const normalizePreviewPublicUrl = (params: {
  publicHost: string
  publicUrl?: string
  fallbackScheme?: 'http' | 'https'
}) => {
  const fallbackScheme = params.fallbackScheme ?? (isLocalPreviewHost(params.publicHost) ? 'http' : 'https')
  const fallbackUrl = `${buildOrigin(fallbackScheme, params.publicHost)}/`
  const candidate = params.publicUrl?.trim()
  if (!candidate) {
    return fallbackUrl
  }

  try {
    const url = new URL(candidate)
    const pathname = url.pathname && url.pathname !== '' ? url.pathname : '/'
    return `${buildOrigin(url.protocol.replace(':', ''), params.publicHost)}${pathname}${url.search}${url.hash}`
  } catch {
    return fallbackUrl
  }
}

export const toPreviewTunnelWsUrl = (params: string | {
  requestUrl: string
  headers?: HeaderSource
  executor?: ExecutorRoutingInfo
}): string => {
  if (typeof params !== 'string') {
    const routedRealtimeBaseUrl = resolveExecutorRealtimeBaseUrl(params.executor)
    if (routedRealtimeBaseUrl) {
      return toPreviewTunnelWsUrl(routedRealtimeBaseUrl)
    }

    if (shouldUseDomesticPreviewRouting(params.executor)) {
      const configured = process.env[DOMESTIC_REALTIME_BASE_URL_ENV]?.trim()
      if (configured) {
        return toPreviewTunnelWsUrl(configured)
      }
    }
  }

  const requestUrl = typeof params === 'string' ? params : params.requestUrl
  const headers = typeof params === 'string' ? undefined : params.headers
  const externalScheme = resolveExternalRequestScheme({ requestUrl, headers })
  // Build from the external host instead of mutating the internal request URL,
  // otherwise a proxy-only port like :18989 can leak into the public WS URL.
  const url = new URL(`${externalScheme === 'https' ? 'wss' : 'ws'}://${resolveExternalHost({ requestUrl, headers })}`)
  url.pathname = '/api/preview-tunnels/ws'
  url.search = ''
  url.hash = ''
  return url.toString()
}
