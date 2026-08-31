import {
  WORKER_CONSOLE_PORT_BASES,
  buildWorkerConsolePortCandidates,
  type WorkerConsolePortEnvironment,
} from '@shared/worker-console-ports'
import type { ExecutorLocalAccessCandidate, ExecutorLocalAccessPlan } from '@shared/types'
import { request } from './api/client'

export type LocalNetworkAccessStatus = 'unsupported' | 'unknown' | 'granted' | 'denied'

export type LocalWorkerHealthProbeResult = {
  ok: boolean
  readable: boolean
  status?: number
  statusText?: string
  checkedAt: string
  url: string
  executorId?: string
  error?: string
}

export type LocalWorkerEnvironment = WorkerConsolePortEnvironment
export type LocalDirectPreviewEligibilityParams = {
  sourceAppUrl?: string
  workspaceExecutorId?: string
  localWorkerExecutorId?: string
}

export type LocalWorkerEndpoint = {
  environment: LocalWorkerEnvironment
  port: number
  baseUrl: string
  healthUrl: string
  statusUrl: string
  doctorUrl: string
  terminalDirectWsUrl: string
  probeUrl?: string
  expectedExecutorId?: string
  expectedInstanceId?: string
}

export type LocalWorkerPreviewMeshBridgeParams = {
  previewId: string
  routeUrl?: string
  endpoint?: LocalWorkerEndpoint
}

export type LocalWorkerExecutorProbeResult = {
  executorId?: string
  endpoint?: LocalWorkerEndpoint
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

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

export const isAllowedPreviewMeshRouteHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized || LOOPBACK_HOSTNAMES.has(normalized) || normalized.startsWith('127.')) {
    return false
  }

  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    return true
  }

  return isPrivateIpv4(normalized)
}

const buildLocalWorkerEndpoint = (environment: LocalWorkerEnvironment, port = WORKER_CONSOLE_PORT_BASES[environment]): LocalWorkerEndpoint => {
  const baseUrl = `http://127.0.0.1:${port}`
  return {
    environment,
    port,
    baseUrl,
    healthUrl: `${baseUrl}/api/health`,
    statusUrl: `${baseUrl}/api/status`,
    doctorUrl: `${baseUrl}/api/doctor`,
    terminalDirectWsUrl: `ws://127.0.0.1:${port}/api/terminal-direct/ws`,
  }
}

const buildPlannedLocalWorkerEndpoint = (candidate: ExecutorLocalAccessCandidate): LocalWorkerEndpoint => ({
  ...buildLocalWorkerEndpoint(resolveCurrentLocalWorkerEnvironment(), candidate.port),
  probeUrl: `http://127.0.0.1:${candidate.port}/api/local-access/identity`,
  expectedExecutorId: candidate.executorId,
  expectedInstanceId: candidate.instanceId,
})

export const LOCAL_WORKER_ENDPOINTS = {
  development: buildLocalWorkerEndpoint('development'),
  preview: buildLocalWorkerEndpoint('preview'),
  production: buildLocalWorkerEndpoint('production'),
} satisfies Record<LocalWorkerEnvironment, LocalWorkerEndpoint>

export const buildLocalWorkerPreviewMeshBridgeUrl = ({
  previewId,
  routeUrl,
  endpoint,
}: LocalWorkerPreviewMeshBridgeParams) => {
  const target = routeUrl?.trim() || ''
  const normalizedPreviewId = previewId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  const localEndpoint = endpoint ?? resolveLocalWorkerEndpoints()[0]
  if (!target || !normalizedPreviewId || !localEndpoint) {
    return ''
  }

  try {
    const targetUrl = new URL(target)
    if (targetUrl.protocol !== 'http:' || !targetUrl.pathname.startsWith('/api/preview-mesh/http/')) {
      return ''
    }
    if (!isAllowedPreviewMeshRouteHost(targetUrl.hostname)) {
      return ''
    }
    if (!targetUrl.searchParams.get('vmx_mesh_token')) {
      return ''
    }

    const endpointUrl = new URL(localEndpoint.baseUrl)
    const bridgeUrl = new URL(endpointUrl.toString())
    bridgeUrl.hostname = `preview-${normalizedPreviewId}.127.0.0.1.nip.io`
    bridgeUrl.pathname = '/api/preview-mesh-bridge/bootstrap'
    bridgeUrl.search = ''
    bridgeUrl.searchParams.set('target', targetUrl.toString())
    return bridgeUrl.toString()
  } catch {
    return ''
  }
}

export const LOCAL_WORKER_HEALTH_URL = LOCAL_WORKER_ENDPOINTS.production.healthUrl
export const LOCAL_WORKER_STATUS_URL = LOCAL_WORKER_ENDPOINTS.production.statusUrl
export const LOCAL_WORKER_DOCTOR_URL = LOCAL_WORKER_ENDPOINTS.production.doctorUrl
const LOCAL_NETWORK_PERMISSION_NAMES = ['local-network-access', 'local-network'] as const
const DEFAULT_LOCAL_WORKER_HEALTH_TIMEOUT_MS = 3000
const LOCAL_WORKER_EXECUTOR_CACHE_TTL_MS = 30_000

type BrowserPermissionState = PermissionState | 'prompt' | 'unsupported' | 'unknown'

export const normalizeLocalNetworkAccessStatus = (state: BrowserPermissionState | null | undefined): LocalNetworkAccessStatus => {
  if (state === 'granted' || state === 'denied' || state === 'unsupported') {
    return state
  }

  return 'unknown'
}

const resolveCurrentLocalWorkerEnvironment = (): LocalWorkerEnvironment => {
  if (typeof window === 'undefined') {
    return 'production'
  }

  const hostname = window.location.hostname.toLowerCase()
  // 兼容窗口：新旧域名都识别
  if (
    hostname === 'vibemux.xyz'
    || hostname.endsWith('.wemux.xyz')
    || hostname === 'wemux.xyz'
    || hostname.endsWith('.wemux.xyz')
  ) {
    return 'preview'
  }
  if (
    hostname === 'vibemux.com'
    || hostname.endsWith('.wemux.com')
    || hostname === 'wemux.ai'
    || hostname.endsWith('.wemux.ai')
  ) {
    return 'production'
  }
  return 'development'
}

export const resolveLocalWorkerEndpoints = ({
  currentEnvironment = resolveCurrentLocalWorkerEnvironment(),
}: {
  currentEnvironment?: LocalWorkerEnvironment
} = {}) => {
  const orderedEnvironments: LocalWorkerEnvironment[] = [
    currentEnvironment,
    'development',
    'preview',
    'production',
  ]
  const seenEnvironments = new Set<LocalWorkerEnvironment>()
  const seenPorts = new Set<number>()
  const endpoints: LocalWorkerEndpoint[] = []
  const environments = orderedEnvironments.filter((environment) => {
    if (seenEnvironments.has(environment)) {
      return false
    }
    seenEnvironments.add(environment)
    return true
  })
  const addEndpoint = (environment: LocalWorkerEnvironment, port: number) => {
    if (seenPorts.has(port)) {
      return
    }
    seenPorts.add(port)
    endpoints.push(buildLocalWorkerEndpoint(environment, port))
  }

  // Most workers bind their environment's base port. Probe those first so a
  // normal installation does not walk an entire fallback range.
  for (const environment of environments) {
    addEndpoint(environment, WORKER_CONSOLE_PORT_BASES[environment])
  }

  for (const environment of environments) {
    for (const port of buildWorkerConsolePortCandidates({ environment })) {
      addEndpoint(environment, port)
    }
  }

  return endpoints
}

const normalizeExecutorId = (value?: string) => value?.trim() || ''

export const resolveLocalNetworkAccessStatus = async (): Promise<LocalNetworkAccessStatus> => {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unsupported'
  }

  for (const name of LOCAL_NETWORK_PERMISSION_NAMES) {
    try {
      const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor)
      return normalizeLocalNetworkAccessStatus(status.state)
    } catch {
      // The LNA permission name is still browser-specific. Try the next known name.
    }
  }

  return 'unknown'
}

const readExecutorId = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as { executorId?: unknown; runtime?: { executorId?: unknown } }
  const executorId = typeof record.executorId === 'string'
    ? record.executorId
    : typeof record.runtime?.executorId === 'string'
      ? record.runtime.executorId
      : ''
  return executorId.trim() || undefined
}

const readInstanceId = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as {
    instanceId?: unknown
    runtime?: { localConsole?: { instanceId?: unknown } }
  }
  const instanceId = typeof record.instanceId === 'string'
    ? record.instanceId
    : typeof record.runtime?.localConsole?.instanceId === 'string'
      ? record.runtime.localConsole.instanceId
      : ''
  return instanceId.trim() || undefined
}

export const probeLocalWorkerHealth = async ({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LOCAL_WORKER_HEALTH_TIMEOUT_MS,
  url = resolveLocalWorkerEndpoints()[0]?.healthUrl ?? LOCAL_WORKER_HEALTH_URL,
}: {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  url?: string
} = {}): Promise<LocalWorkerHealthProbeResult> => {
  const checkedAt = new Date().toISOString()
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    try {
      const response = await fetchImpl(url, {
        cache: 'no-store',
        signal: controller?.signal,
      })
      const payload = await response.json().catch(() => null)
      return {
        ok: response.ok,
        readable: true,
        status: response.status,
        statusText: response.statusText,
        checkedAt,
        url,
        executorId: readExecutorId(payload),
        error: response.ok ? undefined : `HTTP ${response.status}`,
      }
    } catch (error) {
      if (controller?.signal.aborted) {
        return {
          ok: false,
          readable: false,
          checkedAt,
          url,
          error: 'Timed out while checking the local worker.',
        }
      }

      const opaqueResponse = await fetchImpl(url, {
        cache: 'no-store',
        mode: 'no-cors',
        signal: controller?.signal,
      })
      return {
        ok: true,
        readable: opaqueResponse.type !== 'opaque',
        status: opaqueResponse.type === 'opaque' ? undefined : opaqueResponse.status,
        statusText: opaqueResponse.type === 'opaque' ? undefined : opaqueResponse.statusText,
        checkedAt,
        url,
      }
    }
  } catch (error) {
    return {
      ok: false,
      readable: false,
      checkedAt,
      url,
      error: error instanceof Error ? error.message : 'Local worker health check failed.',
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

const readLocalWorkerIdentityFromUrl = async ({
  fetchImpl,
  timeoutMs,
  url,
}: {
  fetchImpl: typeof fetch
  timeoutMs: number
  url: string
}) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null

  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      signal: controller?.signal,
    })
    if (!response.ok) {
      return undefined
    }

    const payload = await response.json().catch(() => null)
    return {
      executorId: readExecutorId(payload),
      instanceId: readInstanceId(payload),
    }
  } catch {
    return undefined
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

const readLocalWorkerIdentity = async ({
  endpoint,
  fetchImpl,
  timeoutMs,
}: {
  endpoint: LocalWorkerEndpoint
  fetchImpl: typeof fetch
  timeoutMs: number
}) => {
  const urls = endpoint.probeUrl && endpoint.probeUrl !== endpoint.statusUrl
    ? [endpoint.probeUrl, endpoint.statusUrl]
    : [endpoint.statusUrl]

  for (const url of urls) {
    const identity = await readLocalWorkerIdentityFromUrl({ fetchImpl, timeoutMs, url })
    if (identity?.executorId) {
      return identity
    }
  }
  return undefined
}

export const readLocalWorkerExecutorId = async ({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LOCAL_WORKER_HEALTH_TIMEOUT_MS,
  url = resolveLocalWorkerEndpoints()[0]?.statusUrl ?? LOCAL_WORKER_STATUS_URL,
}: {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  url?: string
} = {}) => {
  return (await readLocalWorkerIdentityFromUrl({ fetchImpl, timeoutMs, url }))?.executorId
}

type LocalWorkerExecutorProbeCacheEntry = {
  expiresAt: number
  promise: Promise<LocalWorkerExecutorProbeResult>
}

const localWorkerExecutorProbeCache = new WeakMap<typeof fetch, Map<string, LocalWorkerExecutorProbeCacheEntry>>()

const probeLocalWorkerExecutor = async ({
  endpoints,
  expectedExecutorId,
  fetchImpl,
  timeoutMs,
}: {
  endpoints: LocalWorkerEndpoint[]
  expectedExecutorId: string
  fetchImpl: typeof fetch
  timeoutMs: number
}): Promise<LocalWorkerExecutorProbeResult> => {
  if (await resolveLocalNetworkAccessStatus() === 'denied') {
    return {}
  }

  let firstReachable: LocalWorkerExecutorProbeResult = {}
  const preferredEndpointCount = Math.min(3, endpoints.length)

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index]
    const identity = await readLocalWorkerIdentity({
      endpoint,
      fetchImpl,
      timeoutMs,
    })
    const executorId = identity?.executorId
    if (executorId) {
      if (endpoint.expectedExecutorId && normalizeExecutorId(executorId) !== normalizeExecutorId(endpoint.expectedExecutorId)) {
        continue
      }
      if (endpoint.expectedInstanceId && identity?.instanceId !== endpoint.expectedInstanceId) {
        continue
      }
      const result = { executorId, endpoint }
      if (!firstReachable.executorId) {
        firstReachable = result
      }
      if (
        endpoint.expectedExecutorId
        || !expectedExecutorId
        || normalizeExecutorId(executorId) === expectedExecutorId
      ) {
        return result
      }
    }

    // The first endpoints are the base ports for each environment. Once one
    // responds, it can provide local-direct or mesh access without probing
    // every collision fallback port for an exact executor match.
    if (index + 1 === preferredEndpointCount && firstReachable.executorId) {
      return firstReachable
    }
  }

  return firstReachable
}

const loadExecutorLocalAccessPlan = async (expectedExecutorId?: string) => {
  const search = new URLSearchParams({ allowMesh: '1' })
  if (expectedExecutorId) {
    search.set('targetExecutorId', expectedExecutorId)
  }
  return request<ExecutorLocalAccessPlan>(`/api/control-plane/executors/local-access-plan?${search.toString()}`)
}

export const readLocalWorkerExecutor = async ({
  endpoints,
  expectedExecutorId,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LOCAL_WORKER_HEALTH_TIMEOUT_MS,
  cacheTtlMs = LOCAL_WORKER_EXECUTOR_CACHE_TTL_MS,
  planLoader = loadExecutorLocalAccessPlan,
}: {
  endpoints?: LocalWorkerEndpoint[]
  expectedExecutorId?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  cacheTtlMs?: number
  planLoader?: (expectedExecutorId?: string) => Promise<ExecutorLocalAccessPlan>
} = {}): Promise<LocalWorkerExecutorProbeResult> => {
  const normalizedExpectedExecutorId = normalizeExecutorId(expectedExecutorId)
  const cacheKey = [
    normalizedExpectedExecutorId,
    ...(endpoints?.map((endpoint) => endpoint.statusUrl) ?? ['server-plan']),
  ].join('|')
  let fetchCache = localWorkerExecutorProbeCache.get(fetchImpl)
  if (!fetchCache) {
    fetchCache = new Map()
    localWorkerExecutorProbeCache.set(fetchImpl, fetchCache)
  }

  const now = Date.now()
  for (const [key, entry] of fetchCache) {
    if (entry.expiresAt <= now) {
      fetchCache.delete(key)
    }
  }
  const cached = fetchCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = (async () => {
    let probeEndpoints = endpoints
    if (!probeEndpoints) {
      try {
        const plan = await planLoader(normalizedExpectedExecutorId || undefined)
        probeEndpoints = plan.candidates.map(buildPlannedLocalWorkerEndpoint)
      } catch {
        return {}
      }
    }
    if (!probeEndpoints.length) {
      return {}
    }
    return probeLocalWorkerExecutor({
      endpoints: probeEndpoints,
      expectedExecutorId: normalizedExpectedExecutorId,
      fetchImpl,
      timeoutMs,
    })
  })()
  fetchCache.set(cacheKey, {
    expiresAt: now + Math.max(0, cacheTtlMs),
    promise,
  })
  return promise
}

export const canUseLocalDirectPreview = ({
  sourceAppUrl,
  workspaceExecutorId,
  localWorkerExecutorId,
}: LocalDirectPreviewEligibilityParams) => {
  const normalizedSourceAppUrl = sourceAppUrl?.trim() || ''
  const normalizedWorkspaceExecutorId = workspaceExecutorId?.trim() || ''
  const normalizedLocalWorkerExecutorId = localWorkerExecutorId?.trim() || ''

  if (!normalizedSourceAppUrl || !normalizedWorkspaceExecutorId || !normalizedLocalWorkerExecutorId) {
    return false
  }

  if (normalizedWorkspaceExecutorId !== normalizedLocalWorkerExecutorId) {
    return false
  }

  try {
    const sourceUrl = new URL(normalizedSourceAppUrl)
    return LOOPBACK_HOSTNAMES.has(sourceUrl.hostname)
  } catch {
    return false
  }
}

export const requestLocalNetworkAccessWithWorkerProbe = async () => {
  const before = await resolveLocalNetworkAccessStatus()
  if (before === 'denied') {
    return {
      status: before,
      probe: null,
    }
  }

  const probe = await probeLocalWorkerHealth()
  const status = await resolveLocalNetworkAccessStatus()
  return {
    status,
    probe,
  }
}
