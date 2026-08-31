// [INPUT]: 连接路由请求
import { getEnv } from '@shared/env'
// [OUTPUT]: 路由选择结果
// [POS]: executor 连接路由
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorConnectionRouteCandidate, ExecutorConnectionRouteResponse } from '@shared/types'

const DOMESTIC_REALTIME_BASE_URL_ENV = 'VIBEMUX_DOMESTIC_REALTIME_BASE_URL'
const DOMESTIC_EXECUTOR_LABELS_ENV = 'VIBEMUX_DOMESTIC_EXECUTOR_LABELS'
const DOMESTIC_COUNTRY_CODES_ENV = 'VIBEMUX_DOMESTIC_COUNTRY_CODES'
const EXECUTOR_ROUTE_RULES_ENV = 'VIBEMUX_EXECUTOR_ROUTE_RULES_JSON'

const DEFAULT_DOMESTIC_EXECUTOR_LABELS = ['route:hk', 'realtime:hk']
const DEFAULT_DOMESTIC_COUNTRY_CODES = ['CN']

type HeaderSource = Headers | {
  get?: (name: string) => string | null | undefined
} | Record<string, string | undefined | null>

type ExecutorRouteRule = {
  id: string
  cloudUrl: string
  labels: string[]
  countries?: string[]
  continents?: string[]
}

const resolveExecutorRouteByLabels = (labels?: string[]) => {
  const normalizedLabels = new Set((labels ?? []).map((label) => normalizeLabel(label)))
  if (normalizedLabels.size === 0) {
    return null
  }

  return getExecutorRouteRules().find((rule) => rule.labels.some((label) => normalizedLabels.has(label))) ?? null
}

type RawExecutorRouteRule = {
  id?: unknown
  cloudUrl?: unknown
  labels?: unknown
  countries?: unknown
  continents?: unknown
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')
const normalizeLabel = (value: string) => value.trim().toLowerCase()
const normalizeCountryCode = (value: string) => value.trim().toUpperCase()
const normalizeContinentCode = (value: string) => value.trim().toUpperCase()

const getHeaderValue = (headers: HeaderSource | undefined, name: string) => {
  if (!headers) {
    return ''
  }

  if (typeof headers.get === 'function') {
    return headers.get(name)?.trim() || ''
  }

  const normalizedName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
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

const getDomesticExecutorLabels = () => {
  const configured = process.env[DOMESTIC_EXECUTOR_LABELS_ENV]?.trim()
  if (!configured) {
    return DEFAULT_DOMESTIC_EXECUTOR_LABELS
  }

  const values = configured
    .split(',')
    .map((value) => normalizeLabel(value))
    .filter(Boolean)

  return values.length > 0 ? values : DEFAULT_DOMESTIC_EXECUTOR_LABELS
}

const getDomesticCountryCodes = () => {
  const configured = process.env[DOMESTIC_COUNTRY_CODES_ENV]?.trim()
  if (!configured) {
    return DEFAULT_DOMESTIC_COUNTRY_CODES
  }

  const values = configured
    .split(',')
    .map((value) => normalizeCountryCode(value))
    .filter(Boolean)

  return values.length > 0 ? values : DEFAULT_DOMESTIC_COUNTRY_CODES
}

const normalizeStringArray = (value: unknown, normalizer: (value: string) => string) => {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizer(entry))
      .filter(Boolean),
  ))
}

const normalizeRouteRule = (raw: RawExecutorRouteRule): ExecutorRouteRule | null => {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const cloudUrl = typeof raw.cloudUrl === 'string' ? trimTrailingSlash(raw.cloudUrl.trim()) : ''
  const labels = normalizeStringArray(raw.labels, normalizeLabel)
  const countries = normalizeStringArray(raw.countries, normalizeCountryCode)
  const continents = normalizeStringArray(raw.continents, normalizeContinentCode)

  if (!id || !cloudUrl || labels.length === 0) {
    return null
  }

  return {
    id,
    cloudUrl,
    labels,
    countries: countries.length > 0 ? countries : undefined,
    continents: continents.length > 0 ? continents : undefined,
  }
}

const getConfiguredExecutorRouteRules = (): ExecutorRouteRule[] => {
  const raw = process.env[EXECUTOR_ROUTE_RULES_ENV]?.trim()
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => normalizeRouteRule((entry ?? {}) as RawExecutorRouteRule))
      .filter((entry): entry is ExecutorRouteRule => Boolean(entry))
  } catch (error) {
    console.warn('[executor-connection-route] failed to parse route rules', error instanceof Error ? error.message : 'unknown error')
    return []
  }
}

const getLegacyDomesticRouteRule = () => {
  const domesticRealtimeBaseUrl = trimTrailingSlash(process.env[DOMESTIC_REALTIME_BASE_URL_ENV]?.trim() || '')
  if (!domesticRealtimeBaseUrl) {
    return null
  }

  return {
    id: 'domestic-hk',
    cloudUrl: domesticRealtimeBaseUrl,
    labels: getDomesticExecutorLabels(),
    countries: getDomesticCountryCodes(),
  } satisfies ExecutorRouteRule
}

const getExecutorRouteRules = () => {
  const configuredRules = getConfiguredExecutorRouteRules()
  if (configuredRules.length > 0) {
    return configuredRules
  }

  const legacyRule = getLegacyDomesticRouteRule()
  return legacyRule ? [legacyRule] : []
}

const resolveRequestCountryCode = (headers?: HeaderSource) => {
  const countryCode = normalizeCountryCode(getHeaderValue(headers, 'cf-ipcountry'))
  if (!countryCode || countryCode === 'XX' || countryCode === 'T1') {
    return ''
  }

  return countryCode
}

const resolveRequestContinentCode = (headers?: HeaderSource) => {
  const continentCode = normalizeContinentCode(getHeaderValue(headers, 'cf-ipcontinent'))
  return continentCode || ''
}

const resolvePublicBaseUrl = (params: {
  requestUrl: string
  headers?: HeaderSource
}) => {
  const forwardedProto = getForwardedHeaderValue(params.headers, 'x-forwarded-proto')
  const forwardedHost = getForwardedHeaderValue(params.headers, 'x-forwarded-host')
  if (forwardedProto && forwardedHost) {
    return trimTrailingSlash(`${forwardedProto}://${forwardedHost}`)
  }

  const host = getHeaderValue(params.headers, 'host')
  if (host) {
    const protocol = forwardedProto || new URL(params.requestUrl).protocol.replace(':', '')
    return trimTrailingSlash(`${protocol}://${host}`)
  }

  const requestOrigin = trimTrailingSlash(new URL(params.requestUrl).origin)
  if (requestOrigin) {
    return requestOrigin
  }

  return trimTrailingSlash(getEnv('WEMUX_PUBLIC_BASE_URL')?.trim() || '')
}

const doesRouteRuleMatch = (params: {
  rule: ExecutorRouteRule
  countryCode: string
  continentCode: string
}) => {
  const countryMatched = params.rule.countries?.includes(params.countryCode) ?? false
  const continentMatched = params.rule.continents?.includes(params.continentCode) ?? false

  if (params.rule.countries?.length || params.rule.continents?.length) {
    return countryMatched || continentMatched
  }

  return false
}

const dedupeRouteCandidates = (candidates: ExecutorConnectionRouteCandidate[]) => {
  const seen = new Set<string>()
  const deduped: ExecutorConnectionRouteCandidate[] = []

  for (const candidate of candidates) {
    const cloudUrl = trimTrailingSlash(candidate.cloudUrl.trim())
    if (!cloudUrl) {
      continue
    }

    if (seen.has(cloudUrl)) {
      continue
    }

    seen.add(cloudUrl)
    deduped.push({
      ...candidate,
      cloudUrl,
      labels: Array.from(new Set(candidate.labels.map((label) => normalizeLabel(label)).filter(Boolean))),
    })
  }

  return deduped
}

export const resolveExecutorConnectionRoute = (params: {
  requestUrl: string
  headers?: HeaderSource
}): ExecutorConnectionRouteResponse => {
  const publicBaseUrl = resolvePublicBaseUrl(params)
  const countryCode = resolveRequestCountryCode(params.headers)
  const continentCode = resolveRequestContinentCode(params.headers)
  const routeRules = getExecutorRouteRules()
  const matchedRule = routeRules.find((rule) => doesRouteRuleMatch({
    rule,
    countryCode,
    continentCode,
  }))

  const assignedCloudUrl = matchedRule?.cloudUrl || publicBaseUrl
  const assignedLabels = matchedRule?.labels ?? []
  const managedRoutingLabels = Array.from(new Set(
    routeRules.flatMap((rule) => rule.labels.map((label) => normalizeLabel(label))),
  ))
  const candidates = dedupeRouteCandidates([
    ...(matchedRule
      ? [{
          id: matchedRule.id,
          cloudUrl: matchedRule.cloudUrl,
          labels: matchedRule.labels,
        }]
      : []),
    {
      id: 'public-default',
      cloudUrl: publicBaseUrl,
      labels: [],
    },
  ])

  return {
    assignedCloudUrl,
    assignedLabels,
    managedRoutingLabels,
    countryCode: countryCode || undefined,
    continentCode: continentCode || undefined,
    matchedRouteId: matchedRule?.id,
    candidates,
  }
}

export const resolveExecutorRealtimeBaseUrlFromLabels = (labels?: string[]) => {
  return resolveExecutorRouteByLabels(labels)?.cloudUrl || ''
}
