import {
  LOCAL_WORKER_ENDPOINTS,
  isAllowedPreviewMeshRouteHost,
  type LocalWorkerEndpoint,
} from './browser-local-network-access'

export type TerminalTransport = 'server' | 'local-direct' | 'public-gateway'
export type TerminalRemoteTransportKind = 'gateway' | 'tunnel'
export type TerminalTransportPreference = 'auto' | TerminalTransport
export type TerminalTransportProbeStatus = 'idle' | 'probing' | 'ok' | 'error' | 'unavailable'

export type TerminalTransportProbeSnapshot = {
  status: TerminalTransportProbeStatus
  roundTripMs?: number
  error?: string
}

export type TerminalTransportOption = {
  transport: TerminalTransport
  label: string
  available: boolean
  status: TerminalTransportProbeStatus
  latencyMs?: number
  detail: string
  error?: string
}

/**
 * The terminal is the only surface that overrides the page origin with the
 * executor's realtime base URL (it comes from the connected control-plane node's
 * registered `url`). A stale or misconfigured node URL therefore breaks terminals
 * while every other API call keeps working, so validate it before trusting it and
 * let callers fall back to the page origin.
 */
export const shouldUseExecutorRealtimeBaseUrlForTerminal = (params: {
  executorRealtimeBaseUrl?: string
  currentPageOrigin?: string
}) => {
  const executorRealtimeBaseUrl = params.executorRealtimeBaseUrl?.trim() || ''
  if (!executorRealtimeBaseUrl) {
    return false
  }

  let realtimeUrl: URL
  try {
    realtimeUrl = new URL(toComparableHttpUrl(executorRealtimeBaseUrl))
  } catch {
    return false
  }

  if (realtimeUrl.protocol !== 'http:' && realtimeUrl.protocol !== 'https:') {
    return false
  }

  const currentPageOrigin = params.currentPageOrigin?.trim()
    || (typeof window !== 'undefined' ? window.location.origin : '')
  if (!currentPageOrigin) {
    return true
  }

  try {
    // An https page can never open a ws:// socket — browsers block it as mixed
    // content, and no amount of retrying recovers. Prefer the page origin.
    if (new URL(currentPageOrigin).protocol === 'https:' && realtimeUrl.protocol === 'http:') {
      return false
    }
  } catch {
    return true
  }

  return true
}

export const canUseLocalDirectTerminal = (params: {
  workspaceExecutorId?: string
  localWorkerExecutorId?: string
}) => {
  const workspaceExecutorId = params.workspaceExecutorId?.trim() || ''
  const localWorkerExecutorId = params.localWorkerExecutorId?.trim() || ''
  return Boolean(workspaceExecutorId && localWorkerExecutorId && workspaceExecutorId === localWorkerExecutorId)
}

export const resolveLocalDirectTerminalUnavailableDetail = (params: {
  workspaceExecutorId?: string
  localWorkerExecutorId?: string
}) => {
  const workspaceExecutorId = params.workspaceExecutorId?.trim() || ''
  const localWorkerExecutorId = params.localWorkerExecutorId?.trim() || ''

  if (!workspaceExecutorId) {
    return '当前工作区还没有绑定执行节点'
  }

  if (!localWorkerExecutorId) {
    return '浏览器未探测到本机 Worker，或本机 Worker 还没有连上 executor'
  }

  if (workspaceExecutorId !== localWorkerExecutorId) {
    return '当前工作区运行在其他 executor 上，本机 Worker 只能直连自己承载的工作区'
  }

  return '当前会话未提供这条链路'
}

export const buildLocalDirectTerminalWsUrl = (params: {
  ticket: string
  wsUrl?: string
}) => {
  const ticket = params.ticket.trim()
  if (!ticket) {
    return ''
  }

  const baseUrl = params.wsUrl?.trim() || LOCAL_WORKER_ENDPOINTS.production.terminalDirectWsUrl
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('ticket', ticket)
    return url.toString()
  } catch {
    return ''
  }
}

export const buildLocalTerminalMeshBridgeWsUrl = (params: {
  ticket: string
  targetWsUrl?: string
  endpoint?: LocalWorkerEndpoint
}) => {
  const ticket = params.ticket.trim()
  const targetWsUrl = params.targetWsUrl?.trim() || ''
  const endpoint = params.endpoint ?? LOCAL_WORKER_ENDPOINTS.production
  if (!ticket || !targetWsUrl) {
    return ''
  }

  try {
    const target = new URL(targetWsUrl)
    if (target.protocol !== 'ws:' || target.pathname !== '/api/terminal-mesh/ws' || !target.searchParams.get('vmx_mesh_token')) {
      return ''
    }
    if (!isAllowedPreviewMeshRouteHost(target.hostname)) {
      return ''
    }
    const bridge = new URL(endpoint.terminalDirectWsUrl)
    bridge.pathname = '/api/terminal-mesh-bridge/ws'
    bridge.search = ''
    bridge.searchParams.set('target', target.toString())
    bridge.searchParams.set('ticket', ticket)
    return bridge.toString()
  } catch {
    return ''
  }
}

export const buildPublicTerminalGatewayWsUrl = (params: {
  ticket: string
  wsUrl?: string
}) => {
  const ticket = params.ticket.trim()
  const wsUrl = params.wsUrl?.trim() || ''
  if (!ticket || !wsUrl) {
    return ''
  }

  try {
    const url = new URL(wsUrl)
    if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || url.pathname !== '/api/terminal-public/ws') {
      return ''
    }
    url.searchParams.set('ticket', ticket)
    return url.toString()
  } catch {
    return ''
  }
}

const toComparableHttpUrl = (value: string) => (
  value.startsWith('wss://')
    ? value.replace('wss://', 'https://')
    : value.startsWith('ws://')
      ? value.replace('ws://', 'http://')
      : value
)

export const resolveTerminalRemoteTransportKind = (params: {
  executorRealtimeBaseUrl?: string
  currentPageOrigin?: string
}): TerminalRemoteTransportKind => {
  const executorRealtimeBaseUrl = params.executorRealtimeBaseUrl?.trim() || ''
  if (!executorRealtimeBaseUrl) {
    return 'tunnel'
  }

  const currentPageOrigin = params.currentPageOrigin?.trim()
    || (typeof window !== 'undefined' ? window.location.origin : '')
  if (!currentPageOrigin) {
    return 'gateway'
  }

  try {
    const realtimeUrl = new URL(toComparableHttpUrl(executorRealtimeBaseUrl))
    const currentUrl = new URL(currentPageOrigin)
    return realtimeUrl.hostname === currentUrl.hostname && realtimeUrl.port === currentUrl.port
      ? 'tunnel'
      : 'gateway'
  } catch {
    return 'gateway'
  }
}

export const resolveTerminalRemoteTransportName = (transport: TerminalRemoteTransportKind) => (
  transport === 'gateway' ? '公网终端入口' : '云端 Tunnel'
)

export const resolveTerminalRemoteTransportUnavailableDetail = (transport: TerminalRemoteTransportKind) => (
  transport === 'gateway'
    ? '当前节点未配置公网终端入口，终端仍通过云端 Tunnel 中转'
    : '当前节点已走公网终端入口，这个终端暂时没有单独的云端 Tunnel 入口'
)

export const resolveTerminalTransportLabel = (
  transport: TerminalTransport,
  remoteTransport: TerminalRemoteTransportKind = 'tunnel',
) => (
  transport === 'local-direct'
    ? '本地连接'
    : transport === 'public-gateway'
      ? resolveTerminalRemoteTransportName('gateway')
      : resolveTerminalRemoteTransportName(remoteTransport)
)

export const resolveTerminalTransportOptions = (params: {
  remoteTransport?: TerminalRemoteTransportKind
  localDirectDetail?: string
  localDirectUnavailableDetail?: string
  publicGatewayDetail?: string
  publicGatewayUnavailableDetail?: string
  serverDetail?: string
  serverUrl?: string
  transportProbes?: Partial<Record<TerminalTransport, TerminalTransportProbeSnapshot>>
}) => {
  const serverProbe = params.transportProbes?.server
  const localDirectProbe = params.transportProbes?.['local-direct']
  const publicGatewayProbe = params.transportProbes?.['public-gateway']

  return (['local-direct', 'public-gateway', 'server'] as const).map((transport) => {
    const probe = transport === 'local-direct'
      ? localDirectProbe
      : transport === 'public-gateway'
        ? publicGatewayProbe
        : serverProbe
    const available = transport === 'server'
      ? Boolean(params.serverUrl) && probe?.status !== 'unavailable'
      : transport === 'public-gateway'
        ? Boolean(probe && probe.status !== 'unavailable')
      : Boolean(probe && probe.status !== 'unavailable')
    const fallbackDetail = transport === 'local-direct'
      ? params.localDirectDetail || '本机 Worker 直连'
      : transport === 'public-gateway'
        ? params.publicGatewayDetail || '公网终端入口直连'
      : params.serverUrl || params.serverDetail || '云端连接'
    const unavailableDetail = transport === 'local-direct'
      ? params.localDirectUnavailableDetail || '当前会话未提供这条链路'
      : transport === 'public-gateway'
        ? params.publicGatewayUnavailableDetail || '当前节点未配置公网终端入口'
      : '当前会话未提供这条链路'

    return {
      transport,
      label: resolveTerminalTransportLabel(transport, params.remoteTransport),
      available,
      status: available ? probe?.status ?? 'idle' : 'unavailable',
      latencyMs: probe?.roundTripMs,
      detail: available ? fallbackDetail : unavailableDetail,
      error: probe?.error,
    } satisfies TerminalTransportOption
  })
}

export const resolveActiveTerminalTransport = (params: {
  preference: TerminalTransportPreference
  serverAvailable: boolean
  localDirectAvailable: boolean
  publicGatewayAvailable?: boolean
  transportProbes?: Partial<Record<TerminalTransport, TerminalTransportProbeSnapshot>>
}) => {
  const available = new Set<TerminalTransport>()
  if (params.serverAvailable) {
    available.add('server')
  }
  if (params.localDirectAvailable) {
    available.add('local-direct')
  }
  if (params.publicGatewayAvailable) {
    available.add('public-gateway')
  }

  if (params.preference !== 'auto') {
    if (available.has(params.preference)) {
      return params.preference
    }
    return available.has('server') ? 'server' : 'local-direct'
  }

  const successfulCandidates = Array.from(available)
    .map((transport) => ({
      transport,
      roundTripMs: params.transportProbes?.[transport]?.roundTripMs,
      status: params.transportProbes?.[transport]?.status,
    }))
    .filter((candidate) => candidate.status === 'ok' && typeof candidate.roundTripMs === 'number')
    .sort((left, right) => (left.roundTripMs ?? Number.POSITIVE_INFINITY) - (right.roundTripMs ?? Number.POSITIVE_INFINITY))

  if (successfulCandidates[0]?.transport) {
    return successfulCandidates[0].transport
  }

  if (params.localDirectAvailable) {
    return 'local-direct'
  }

  if (params.publicGatewayAvailable) {
    return 'public-gateway'
  }

  return 'server'
}
