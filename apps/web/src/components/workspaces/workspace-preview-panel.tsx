/**
 * [INPUT]: Workspace preview session/source state, executor network addresses, and workspace preview actions.
 * [OUTPUT]: Transport selection, navigation helpers, and the /workspace preview surface.
 * [POS]: Shared workspace Preview UI for /workspace and /workspaces; chooses direct, mesh, and remote transports without owning Preview lifecycle APIs.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import {
  PREVIEW_NAVIGATION_BRIDGE_MESSAGE_TYPE,
  type PreviewNavigationBridgeMessage,
  type ExecutorRecord,
  type PreviewAccessRoute,
  type PreviewSessionDto,
  type WorkspacePreviewSourceOption,
} from '@shared/types'
import { buildWorkspacePreviewSourceOptions, resolvePreviewSourceLabel } from '@shared/types'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Copy,
  ExternalLink,
  ShieldAlert,
  Link2,
  Loader2,
  Monitor,
  MoreHorizontal,
  RefreshCw,
  Rocket,
  Smartphone,
  Square,
  Tablet,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { buildLocalWorkerPreviewMeshBridgeUrl, canUseLocalDirectPreview, readLocalWorkerExecutor, type LocalWorkerEndpoint } from '../../lib/browser-local-network-access'
import { formatLatencyValue } from '../../lib/executor-latency'
import { isWorkspacePreviewConnected } from '../../lib/workspace-preview-status'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { cn } from '../../lib/utils'
import { buildWorkspacePanelUiScopeKey, useWorkspacePanelUiField } from './workspace-panel-ui-store'
import { useWorkbenchResource } from './workbench-resource-registry'
import { useWorkspaceSidePanelHeaderActions } from './workspace-side-panel-header-actions'

export { canUseLocalDirectPreview } from '../../lib/browser-local-network-access'

const IFRAME_LOADING_TIMEOUT_MS = 8_000
const TRANSPORT_PROBE_TIMEOUT_MS = 2_500

type PreviewViewportMode = 'desktop' | 'tablet' | 'mobile'
type PreviewViewportOrientation = 'portrait' | 'landscape'
export type PreviewTransport = 'local-direct' | 'public-direct' | 'mesh-bridge' | 'gateway' | 'tunnel'
export type PreviewTransportPreference = 'auto' | PreviewTransport
export type PreviewTransportProbeSnapshot = {
  status: 'idle' | 'probing' | 'ok' | 'error' | 'unavailable'
  roundTripMs?: number
  error?: string
}

const PREVIEW_VIEWPORTS: Array<{
  mode: PreviewViewportMode
  label: string
  icon: typeof Monitor
  frameClassName: string
}> = [
  {
    mode: 'desktop',
    label: '电脑',
    icon: Monitor,
    frameClassName: 'h-full w-full',
  },
  {
    mode: 'tablet',
    label: '平板',
    icon: Tablet,
    frameClassName: 'w-full',
  },
  {
    mode: 'mobile',
    label: '手机',
    icon: Smartphone,
    frameClassName: 'w-full',
  },
]

const resolvePreviewFrameStyle = (
  viewportMode: PreviewViewportMode,
  viewportOrientation: PreviewViewportOrientation,
): CSSProperties | undefined => {
  if (viewportMode === 'desktop') {
    return undefined
  }

  if (viewportMode === 'tablet') {
    return viewportOrientation === 'landscape'
      ? {
          width: 'min(100%, 1194px)',
          aspectRatio: '1194 / 834',
          maxHeight: 'min(calc(100% - 8rem), 760px)',
        }
      : {
          width: 'min(100%, 834px)',
          aspectRatio: '834 / 1194',
          maxHeight: 'min(calc(100% - 10rem), 680px)',
        }
  }

  return viewportOrientation === 'landscape'
    ? {
        width: 'min(100%, 852px)',
        aspectRatio: '852 / 393',
        maxHeight: 'min(calc(100% - 10rem), 420px)',
      }
    : {
        width: 'min(100%, 393px)',
        aspectRatio: '393 / 852',
        maxHeight: 'min(calc(100% - 10rem), 700px)',
      }
}

type WorkspacePreviewPanelProps = {
  busyAction: null | 'open' | 'refresh' | 'stop' | 'share' | 'revoke'
  executorId?: string
  executor?: Pick<ExecutorRecord, 'previewIngressDetectedLanIp' | 'previewIngressDetectedPublicIp'> | null
  iframeUrl?: string
  preview: PreviewSessionDto | null
  previewAccessRoute?: PreviewAccessRoute | null
  shareUrl?: string
  sourceAppUrl?: string
  previewSources?: WorkspacePreviewSourceOption[]
  uiScopeKey?: string
  resourceActive?: boolean
  onOpen: () => void
  onOpenExternal: (targetUrl?: string, options?: { transport?: 'public-direct' }) => void
  onRefresh: () => void
  onRevokeShare: () => void
  onShare: () => void
  onStop: () => void
}

const resolvePreviewStatusTone = (preview: PreviewSessionDto | null) => {
  if (isWorkspacePreviewConnected(preview)) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  }
  if (preview?.accessMode !== 'public-proxy' && preview?.status === 'active' && preview.tunnelClientStatus === 'error') {
    return 'border-rose-500/20 bg-rose-500/10 text-rose-200'
  }
  if (preview?.accessMode !== 'public-proxy' && preview?.status === 'active' && preview.tunnelClientStatus === 'closed') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-200'
  }

  const status = preview?.status
  if (status === 'active') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  if (status === 'waiting_tunnel' || status === 'opening') return 'border-sky-500/20 bg-sky-500/10 text-sky-200'
  if (status === 'error') return 'border-rose-500/20 bg-rose-500/10 text-rose-200'
  if (status === 'closed' || status === 'stopping') return 'border-zinc-800 bg-zinc-950 text-zinc-400'
  return 'border-zinc-800 bg-zinc-950 text-zinc-300'
}

const resolvePreviewStatusTextTone = (preview: PreviewSessionDto | null) => {
  if (isWorkspacePreviewConnected(preview)) {
    return 'text-emerald-200'
  }
  if (preview?.accessMode !== 'public-proxy' && preview?.status === 'active' && preview.tunnelClientStatus === 'error') {
    return 'text-rose-200'
  }
  if (preview?.accessMode !== 'public-proxy' && preview?.status === 'active' && preview.tunnelClientStatus === 'closed') {
    return 'text-amber-200'
  }

  const status = preview?.status
  if (status === 'active') return 'text-emerald-200'
  if (status === 'waiting_tunnel' || status === 'opening') return 'text-sky-200'
  if (status === 'error') return 'text-rose-200'
  if (status === 'closed' || status === 'stopping') return 'text-zinc-400'
  return 'text-zinc-300'
}

export const resolvePreviewTransportName = (transport: PreviewTransport) => {
  if (transport === 'local-direct') {
    return '本地连接'
  }
  if (transport === 'public-direct') {
    return '公网 IP 直连'
  }
  if (transport === 'mesh-bridge') {
    return 'Mesh Bridge'
  }
  if (transport === 'gateway') {
    return '公网预览域名'
  }
  return '隧道预览域名'
}

export const resolvePreviewRemoteTransport = (preview: PreviewSessionDto | null): PreviewTransport | null => {
  if (!preview) {
    return null
  }
  return preview.accessMode === 'public-proxy' ? 'gateway' : 'tunnel'
}

export const resolvePreviewTransportLabel = (preview: PreviewSessionDto | null, transportOverride?: PreviewTransport) => {
  if (transportOverride) {
    return resolvePreviewTransportName(transportOverride)
  }
  const remoteTransport = resolvePreviewRemoteTransport(preview)
  return remoteTransport ? resolvePreviewTransportName(remoteTransport) : 'Preview'
}

export const resolveSelectedPreviewSourceRemoteIframeUrl = (params: {
  selectedPreviewSource: WorkspacePreviewSourceOption | null
  fallbackIframeUrl?: string
}) => {
  const selectedPreviewSourceAccessUrl = params.selectedPreviewSource?.accessUrl?.trim() || ''
  const selectedPreviewSourceAppUrl = params.selectedPreviewSource?.appUrl?.trim() || ''

  if (selectedPreviewSourceAccessUrl) {
    if (!selectedPreviewSourceAppUrl) {
      return selectedPreviewSourceAccessUrl
    }

    try {
      const accessUrl = new URL(selectedPreviewSourceAccessUrl)
      const sourceAppUrl = new URL(selectedPreviewSourceAppUrl)
      if (accessUrl.origin !== sourceAppUrl.origin) {
        return selectedPreviewSourceAccessUrl
      }
    } catch {
      if (selectedPreviewSourceAccessUrl !== selectedPreviewSourceAppUrl) {
        return selectedPreviewSourceAccessUrl
      }
    }
  }

  return params.fallbackIframeUrl?.trim() || ''
}

export const resolveRemotePreviewBaseUrl = (params: {
  preview: PreviewSessionDto | null
  selectedPreviewSource: WorkspacePreviewSourceOption | null
  iframeUrl?: string
}) => {
  const selectedRemoteIframeUrl = resolveSelectedPreviewSourceRemoteIframeUrl({
    selectedPreviewSource: params.selectedPreviewSource,
    fallbackIframeUrl: params.iframeUrl,
  })
  const selectedPreviewSourceAccessUrl = params.selectedPreviewSource?.accessUrl?.trim() || ''

  return selectedRemoteIframeUrl || params.preview?.publicUrl?.trim() || selectedPreviewSourceAccessUrl
}

export const resolveAuthorizedPreviewCopyUrl = (params: {
  preview: PreviewSessionDto | null
  selectedPreviewSource: WorkspacePreviewSourceOption | null
  iframeUrl?: string
}) => {
  const selectedRemoteIframeUrl = resolveSelectedPreviewSourceRemoteIframeUrl({
    selectedPreviewSource: params.selectedPreviewSource,
    fallbackIframeUrl: params.iframeUrl,
  })
  if (selectedRemoteIframeUrl) {
    return selectedRemoteIframeUrl
  }
  return params.iframeUrl?.trim() || params.preview?.publicUrl?.trim() || ''
}

export const resolveVisiblePreviewError = (params: {
  previewLastError?: string
  connected: boolean
  iframeLoaded: boolean
  iframeLoadTimedOut: boolean
}) => {
  const previewLastError = params.previewLastError?.trim()
  if (!previewLastError) {
    return ''
  }

  if (params.connected && params.iframeLoaded && !params.iframeLoadTimedOut) {
    return ''
  }

  return previewLastError
}

const resolvePreviewAccessRouteLabel = (route?: PreviewAccessRoute | null) => {
  if (!route) {
    return ''
  }

  if (route.mode === 'mesh-direct') {
    return 'Mesh Direct'
  }
  if (route.mode === 'mesh-relayed') {
    return 'Mesh Relay'
  }
  return '公网预览域名'
}

export const resolvePreviewDomainLabel = (preview: PreviewSessionDto | null) => {
  if (preview?.accessMode === 'public-proxy') {
    return '公网预览域名'
  }
  return '隧道预览域名'
}

export const resolvePreviewShareActionLabel = (preview: PreviewSessionDto | null) => {
  if (preview?.share.enabled) {
    return '撤销分享'
  }
  return `公开${resolvePreviewDomainLabel(preview)}分享链接`
}

export const resolvePreviewShareCopyLabel = (preview: PreviewSessionDto | null) => `复制${resolvePreviewDomainLabel(preview)}分享链接`

const resolvePreviewAccessRouteTone = (route?: PreviewAccessRoute | null) => {
  if (route?.mode === 'mesh-direct') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
  }
  if (route?.mode === 'mesh-relayed') {
    return 'border-sky-500/20 bg-sky-500/10 text-sky-200'
  }
  return 'border-zinc-800 bg-zinc-950 text-zinc-400'
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/

const resolveLoopbackPreviewUrl = (sourceAppUrl?: string) => {
  const normalizedSourceAppUrl = sourceAppUrl?.trim() || ''
  if (!normalizedSourceAppUrl) {
    return ''
  }

  try {
    const sourceUrl = new URL(normalizedSourceAppUrl)
    if (!LOOPBACK_HOSTNAMES.has(sourceUrl.hostname)) {
      return ''
    }
    sourceUrl.hostname = '127.0.0.1'
    return sourceUrl.toString()
  } catch {
    return ''
  }
}

const normalizePreviewHostname = (hostname: string) => hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')

const isPreviewIpHostname = (hostname: string) => {
  const normalized = normalizePreviewHostname(hostname)
  if (!IPV4_PATTERN.test(normalized)) {
    return false
  }

  return normalized
    .split('.')
    .every((part) => {
      const value = Number(part)
      return Number.isInteger(value) && value >= 0 && value <= 255
    })
}

const isHostedPreviewHostname = (hostname: string) => {
  const normalized = normalizePreviewHostname(hostname)
  // 兼容窗口：新旧 preview 域名都按托管域名处理，后续可移除 wemux.* 分支
  return normalized === 'vibemux.xyz'
    || normalized.endsWith('.wemux.xyz')
    || normalized === 'wemux.xyz'
    || normalized.endsWith('.wemux.xyz')
    || normalized === 'vibemux.localtest.me'
    || normalized.endsWith('.wemux.localtest.me')
    || normalized === 'wemux.localtest.me'
    || normalized.endsWith('.wemux.localtest.me')
}

const resolveCookieUnsafePreviewHostReason = (hostname: string) => {
  const normalized = normalizePreviewHostname(hostname)
  if (!normalized) {
    return ''
  }

  if (LOOPBACK_HOSTNAMES.has(normalized) || normalized.startsWith('127.')) {
    return 'loopback'
  }
  if (isPreviewIpHostname(normalized)) {
    return 'ip'
  }
  if (normalized.endsWith('.nip.io')) {
    return 'nip'
  }
  if (!isHostedPreviewHostname(normalized)) {
    return 'external'
  }
  return ''
}

export const resolvePreviewCookieAccessWarning = (params: {
  previewUrl?: string
  currentPageHostname?: string
}) => {
  const previewUrl = params.previewUrl?.trim() || ''
  if (!previewUrl) {
    return null
  }

  try {
    const parsedPreviewUrl = new URL(previewUrl)
    const reason = resolveCookieUnsafePreviewHostReason(parsedPreviewUrl.hostname)
    if (!reason) {
      return null
    }

    const currentHostname = normalizePreviewHostname(params.currentPageHostname || '')
    return {
      reason,
      host: parsedPreviewUrl.host,
      origin: parsedPreviewUrl.origin,
      isHostedWemuxPage: currentHostname === 'vibemux.xyz' || currentHostname.endsWith('.vibemux.xyz') || currentHostname === 'wemux.xyz' || currentHostname.endsWith('.wemux.xyz'),
    }
  } catch {
    return null
  }
}

const probePreviewTransport = async (url: string): Promise<PreviewTransportProbeSnapshot> => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = controller
    ? setTimeout(() => controller.abort(), TRANSPORT_PROBE_TIMEOUT_MS)
    : null
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  try {
    await fetch(url, {
      cache: 'no-store',
      mode: 'no-cors',
      signal: controller?.signal,
    })
    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    return {
      status: 'ok',
      roundTripMs: Math.max(0, Math.round(endedAt - startedAt)),
    }
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Transport probe failed.',
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

const resolvePreviewTransportProbeTargets = (params: {
  canAttemptLocalDirectPreview: boolean
  localDirectBaseUrl?: string
  publicDirectBaseUrl?: string
  meshBridgeBaseUrl?: string
  preview: PreviewSessionDto | null
  previewAccessUrl?: string
  previewBaseUrl?: string
}) => {
  const remoteTransport = resolvePreviewRemoteTransport(params.preview)
  const remoteUrl = params.previewAccessUrl || params.previewBaseUrl || ''

  return {
    'local-direct': params.canAttemptLocalDirectPreview ? params.localDirectBaseUrl?.trim() || '' : '',
    'public-direct': params.publicDirectBaseUrl?.trim() || '',
    'mesh-bridge': params.meshBridgeBaseUrl?.trim() || '',
    gateway: remoteTransport === 'gateway' ? remoteUrl : '',
    tunnel: remoteTransport === 'tunnel' ? remoteUrl : '',
  } satisfies Record<PreviewTransport, string>
}

export const resolveActivePreviewTransport = (params: {
  preference: PreviewTransportPreference
  preview: PreviewSessionDto | null
  canAttemptLocalDirectPreview: boolean
  localDirectPreviewFailed: boolean
  publicDirectBaseUrl?: string
  meshBridgeBaseUrl?: string
  transportProbes?: Partial<Record<PreviewTransport, PreviewTransportProbeSnapshot>>
}) => {
  const remoteTransport = resolvePreviewRemoteTransport(params.preview) ?? 'tunnel'
  const canUseLocalDirect = params.canAttemptLocalDirectPreview && !params.localDirectPreviewFailed
  const canUsePublicDirect = Boolean(params.publicDirectBaseUrl?.trim())
  const canUseMeshBridge = Boolean(params.meshBridgeBaseUrl?.trim())
  const available = new Set<PreviewTransport>([remoteTransport])
  if (canUseLocalDirect) {
    available.add('local-direct')
  }
  if (canUsePublicDirect) {
    available.add('public-direct')
  }
  if (canUseMeshBridge) {
    available.add('mesh-bridge')
  }

  if (params.preference !== 'auto') {
    if (available.has(params.preference)) {
      return params.preference
    }
    return available.has(remoteTransport) ? remoteTransport : 'local-direct'
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

  if (canUseLocalDirect) {
    return 'local-direct'
  }

  if (canUsePublicDirect) {
    return 'public-direct'
  }

  if (canUseMeshBridge) {
    return 'mesh-bridge'
  }

  return remoteTransport
}

export const resolvePreviewTransportOptions = (params: {
  preview: PreviewSessionDto | null
  canAttemptLocalDirectPreview: boolean
  allowOnDemandTunnel?: boolean
  localDirectBaseUrl?: string
  publicDirectBaseUrl?: string
  meshBridgeBaseUrl?: string
  previewAccessUrl?: string
  previewBaseUrl?: string
  transportProbes?: Partial<Record<PreviewTransport, PreviewTransportProbeSnapshot>>
}) => {
  const probeTargets = resolvePreviewTransportProbeTargets(params)
  const remoteTransport = resolvePreviewRemoteTransport(params.preview)

  return (['local-direct', 'public-direct', 'mesh-bridge', 'gateway', 'tunnel'] as const).map((transport) => {
    const url = probeTargets[transport]
    const probe = params.transportProbes?.[transport]
    const available = Boolean(url)
      || (transport === 'tunnel' && !remoteTransport && Boolean(params.allowOnDemandTunnel))
    const fallbackLatencyMs = transport === 'tunnel' && remoteTransport === 'tunnel'
      ? params.preview?.tunnelLatencyMs
      : undefined
    return {
      transport,
      label: resolvePreviewTransportName(transport),
      available,
      url,
      status: available ? probe?.status ?? 'idle' : 'unavailable',
      latencyMs: probe?.roundTripMs ?? fallbackLatencyMs,
      error: probe?.error,
    }
  })
}

const resolvePreviewPrimaryActionLabel = (preview: PreviewSessionDto | null) => {
  if (!preview || preview.status === 'closed' || preview.status === 'stopping') {
    return '启动 Preview'
  }
  return '连接 Preview'
}

export const shouldOpenRemotePreviewForTransport = (params: {
  activeTransport: PreviewTransport
  preview: PreviewSessionDto | null
}) => {
  if (params.activeTransport === 'local-direct' || params.activeTransport === 'public-direct' || params.activeTransport === 'mesh-bridge') {
    return false
  }

  return !isWorkspacePreviewConnected(params.preview)
}

export const shouldReconnectWaitingRemotePreview = (preview: Pick<PreviewSessionDto, 'status'> | null) => (
  preview?.status === 'opening' || preview?.status === 'waiting_tunnel'
)

export const resolvePublicDirectExternalReason = (params: {
  activeTransport: PreviewTransport
  pageProtocol?: string
  previewUrl?: string
}) => {
  if (params.activeTransport !== 'public-direct' || !params.previewUrl?.trim()) {
    return ''
  }

  try {
    const previewUrl = new URL(params.previewUrl)
    if (params.pageProtocol === 'https:' && previewUrl.protocol === 'http:') {
      return 'mixed-content'
    }
  } catch {
    return 'public-ip'
  }

  return 'public-ip'
}

const isPreviewNavigationBridgeMessage = (value: unknown): value is PreviewNavigationBridgeMessage => (
  typeof value === 'object'
  && value !== null
  && (value as { type?: unknown }).type === PREVIEW_NAVIGATION_BRIDGE_MESSAGE_TYPE
  && typeof (value as { href?: unknown }).href === 'string'
)

export const normalizePreviewPathInput = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }

  try {
    const parsed = new URL(trimmed)
    return `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  }
}

export const resolvePreviewNavigationBridgePath = (params: {
  href: string
  previewBaseUrl?: string
}) => {
  if (!params.previewBaseUrl) {
    return null
  }

  try {
    const previewBase = new URL(params.previewBaseUrl)
    const nextUrl = new URL(params.href)
    if (nextUrl.origin !== previewBase.origin) {
      return null
    }

    nextUrl.searchParams.delete('vmx_viewer_token')
    nextUrl.searchParams.delete('vmx_transport')
    const search = nextUrl.searchParams.toString()
    return {
      path: `${nextUrl.pathname || '/'}${search ? `?${search}` : ''}${nextUrl.hash}`,
      url: nextUrl.toString(),
    }
  } catch {
    return null
  }
}

export const resolvePreviewDisplayPath = (value?: string) => {
  if (!value) {
    return '/'
  }

  try {
    const parsed = new URL(value)
    stripPreviewBootstrapSearchParams(parsed)
    const search = parsed.searchParams.toString()
    return `${parsed.pathname || '/'}${search ? `?${search}` : ''}${parsed.hash}`
  } catch {
    return '/'
  }
}

const stripPreviewBootstrapSearchParams = (value: URL) => {
  value.searchParams.delete('vmx_viewer_token')
  value.searchParams.delete('vmx_transport')
}

export const resolvePreviewStableAccessUrl = (value?: string) => {
  if (!value) {
    return ''
  }

  try {
    const parsed = new URL(value)
    stripPreviewBootstrapSearchParams(parsed)
    return parsed.toString()
  } catch {
    return value.trim()
  }
}

export const resolvePreviewDisplayUrl = (value?: string) => {
  if (!value) {
    return '/'
  }

  try {
    const parsed = new URL(value)
    stripPreviewBootstrapSearchParams(parsed)
    const search = parsed.searchParams.toString()
    return `${parsed.origin}${parsed.pathname || '/'}${search ? `?${search}` : ''}${parsed.hash}`
  } catch {
    return value.trim() || '/'
  }
}

export const resolvePreviewAddressNavigation = (params: {
  value: string
  bootstrapIframeUrl?: string
  cookieBackedBaseUrl?: string
  useBootstrapToken: boolean
  rebaseAbsoluteUrl?: boolean
}) => {
  const buildPreviewNavigationResult = (nextPath: string) => {
    const currentPreviewUrl = resolvePreviewNavigationUrl({
      bootstrapIframeUrl: params.bootstrapIframeUrl,
      cookieBackedBaseUrl: params.cookieBackedBaseUrl,
      previewPath: nextPath,
      useBootstrapToken: false,
    })

    return {
      previewPath: nextPath,
      iframeUrl: resolvePreviewNavigationUrl({
        bootstrapIframeUrl: params.bootstrapIframeUrl,
        cookieBackedBaseUrl: params.cookieBackedBaseUrl,
        previewPath: nextPath,
        useBootstrapToken: params.useBootstrapToken,
      }),
      currentPreviewUrl,
      displayUrl: resolvePreviewDisplayUrl(currentPreviewUrl),
    }
  }

  const fallbackPath = normalizePreviewPathInput(params.value)
  const trimmed = params.value.trim()
  if (!trimmed) {
    return buildPreviewNavigationResult(fallbackPath)
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return buildPreviewNavigationResult(fallbackPath)
    }

    stripPreviewBootstrapSearchParams(parsed)
    const displayUrl = resolvePreviewDisplayUrl(parsed.toString())
    if (params.rebaseAbsoluteUrl) {
      return buildPreviewNavigationResult(resolvePreviewDisplayPath(displayUrl))
    }
    const navigationBaseUrl = params.cookieBackedBaseUrl || params.bootstrapIframeUrl
    if (navigationBaseUrl) {
      try {
        const navigationBase = new URL(navigationBaseUrl)
        if (parsed.origin === navigationBase.origin) {
          return buildPreviewNavigationResult(resolvePreviewDisplayPath(displayUrl))
        }
      } catch {
        return buildPreviewNavigationResult(fallbackPath)
      }
    }

    return {
      previewPath: resolvePreviewDisplayPath(displayUrl),
      iframeUrl: displayUrl,
      currentPreviewUrl: displayUrl,
      displayUrl,
    }
  } catch {
    return buildPreviewNavigationResult(fallbackPath)
  }
}

export const buildPreviewIframeUrl = (
  baseUrl: string | undefined,
  previewPath: string,
  options?: { includeBootstrapToken?: boolean },
) => {
  if (!baseUrl) {
    return ''
  }

  try {
    const base = new URL(baseUrl)
    const target = new URL(normalizePreviewPathInput(previewPath), base.origin)
    const token = base.searchParams.get('vmx_viewer_token')
    if (options?.includeBootstrapToken && token && !target.searchParams.has('vmx_viewer_token')) {
      target.searchParams.set('vmx_viewer_token', token)
    }
    return target.toString()
  } catch {
    return baseUrl
  }
}

export const resolvePreviewNavigationUrl = ({
  bootstrapIframeUrl,
  cookieBackedBaseUrl,
  previewPath,
  useBootstrapToken,
}: {
  bootstrapIframeUrl?: string
  cookieBackedBaseUrl?: string
  previewPath: string
  useBootstrapToken: boolean
}) => {
  if (useBootstrapToken) {
    return buildPreviewIframeUrl(bootstrapIframeUrl, previewPath, { includeBootstrapToken: true })
  }

  return buildPreviewIframeUrl(cookieBackedBaseUrl || bootstrapIframeUrl, previewPath)
}

const resolveLocalPreviewSiteWarning = (publicUrl?: string) => {
  if (!publicUrl || typeof window === 'undefined') {
    return null
  }

  try {
    const currentUrl = new URL(window.location.href)
    if (!LOOPBACK_HOSTNAMES.has(currentUrl.hostname)) {
      return null
    }

    const previewUrl = new URL(publicUrl)
    if (!previewUrl.hostname.endsWith('.localtest.me')) {
      return null
    }

    const previewBaseDomain = previewUrl.hostname.replace(/^[^.]+\./, '')
    const suggestedHost = `app.${previewBaseDomain}`
    const suggestedOrigin = `${currentUrl.protocol}//${suggestedHost}${currentUrl.port ? `:${currentUrl.port}` : ''}`
    return {
      suggestedHost,
      suggestedOrigin,
    }
  } catch {
    return null
  }
}

export const resolveDirectPreviewAccessUrl = (params: {
  sourceAppUrl?: string
  targetHost?: string
}) => {
  const sourceAppUrl = params.sourceAppUrl?.trim() || ''
  const targetHost = params.targetHost?.trim().replace(/^\[|\]$/g, '') || ''
  if (!sourceAppUrl || !targetHost) {
    return ''
  }

  try {
    const sourceUrl = new URL(sourceAppUrl)
    if (!LOOPBACK_HOSTNAMES.has(sourceUrl.hostname)) {
      return ''
    }
    sourceUrl.hostname = targetHost
    return sourceUrl.toString()
  } catch {
    return ''
  }
}

export function WorkspacePreviewPanel({
  busyAction,
  executorId,
  executor,
  iframeUrl,
  preview,
  previewAccessRoute,
  shareUrl,
  sourceAppUrl,
  previewSources,
  uiScopeKey,
  resourceActive = true,
  onOpen,
  onOpenExternal,
  onRefresh,
  onRevokeShare,
  onShare,
  onStop,
}: WorkspacePreviewPanelProps) {
  const resolvedPreviewSources = previewSources?.length
    ? previewSources
    : buildWorkspacePreviewSourceOptions({
        preview,
        fallbackSourceAppUrl: sourceAppUrl,
      })
  const panelUiScopeKey = uiScopeKey || buildWorkspacePanelUiScopeKey({
    workspaceId: preview?.workspaceId,
    workspaceSessionId: preview?.workspaceSessionId,
    panel: 'preview',
  })
  const [selectedPreviewSourceAppUrl, setSelectedPreviewSourceAppUrl] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'selectedPreviewSourceAppUrl', '')
  const selectedPreviewSource = resolvedPreviewSources.find((source) => source.appUrl === selectedPreviewSourceAppUrl)
    ?? resolvedPreviewSources.find((source) => source.primary)
    ?? resolvedPreviewSources[0]
    ?? null
  const directSourceAppUrl = selectedPreviewSource?.appUrl || sourceAppUrl || preview?.sourceAppUrl
  const previewConnected = isWorkspacePreviewConnected(preview)
  const selectedPreviewSourceRemoteIframeUrl = resolveSelectedPreviewSourceRemoteIframeUrl({
    selectedPreviewSource,
    fallbackIframeUrl: iframeUrl,
  })
  const authorizedPreviewCopyUrl = resolveAuthorizedPreviewCopyUrl({
    preview,
    selectedPreviewSource,
    iframeUrl,
  })
  const previewBaseUrl = resolveRemotePreviewBaseUrl({
    preview,
    selectedPreviewSource,
    iframeUrl,
  })
  const localDirectBaseUrl = resolveLoopbackPreviewUrl(directSourceAppUrl)
  const publicDirectBaseUrl = resolveDirectPreviewAccessUrl({
    sourceAppUrl: directSourceAppUrl,
    targetHost: executor?.previewIngressDetectedPublicIp,
  })
  const [iframeLoading, setIframeLoading] = useState(false)
  const [iframeLoadTimedOut, setIframeLoadTimedOut] = useState(false)
  const [viewportMode, setViewportMode] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'viewportMode', 'desktop')
  const [viewportOrientation, setViewportOrientation] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'viewportOrientation', 'portrait')
  const [previewPath, setPreviewPath] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'previewPath', '/')
  const [previewAddressDraft, setPreviewAddressDraft] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'previewAddressDraft', '/')
  const [previewNavigationHistory, setPreviewNavigationHistory] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'previewNavigationHistory', ['/'])
  const [previewNavigationHistoryIndex, setPreviewNavigationHistoryIndex] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'previewNavigationHistoryIndex', 0)
  const [iframeReloadKey, setIframeReloadKey] = useState(0)
  const [iframeSrc, setIframeSrc] = useState('')
  const [currentPreviewUrl, setCurrentPreviewUrl] = useState('')
  const [previewViewerAccessBootstrapped, setPreviewViewerAccessBootstrapped] = useState(false)
  const [localWorkerExecutorId, setLocalWorkerExecutorId] = useState<string>()
  const [localWorkerEndpoint, setLocalWorkerEndpoint] = useState<LocalWorkerEndpoint>()
  const [transportPreference, setTransportPreference] = useWorkspacePanelUiField(panelUiScopeKey, 'preview', 'transportPreference', 'auto')
  const [transportProbes, setTransportProbes] = useState<Partial<Record<PreviewTransport, PreviewTransportProbeSnapshot>>>({})
  const [localDirectPreviewFailed, setLocalDirectPreviewFailed] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const resourceHandlers = useMemo(() => ({
    pause: () => iframeRef.current?.contentWindow?.postMessage({ type: 'vibemux:resource-pause' }, '*'),
    resume: () => iframeRef.current?.contentWindow?.postMessage({ type: 'vibemux:resource-resume' }, '*'),
    dispose: () => iframeRef.current?.contentWindow?.postMessage({ type: 'vibemux:resource-dispose' }, '*'),
  }), [])
  const resourceStatus = useWorkbenchResource({
    resourceKey: `preview:${panelUiScopeKey}`,
    type: 'iframe',
    active: resourceActive,
    handlers: resourceHandlers,
  })
  const previewPathRef = useRef('/')
  const previewNavigationHistoryRef = useRef<string[]>(['/'])
  const previewNavigationHistoryIndexRef = useRef(0)
  const previewAddressDraftFocusedRef = useRef(false)
  const previewAddressDraftBlurHandledRef = useRef(false)
  const remotePreviewOpenRequestRef = useRef('')
  const headerActions = useWorkspaceSidePanelHeaderActions()
  const localPreviewSiteWarning = resolveLocalPreviewSiteWarning(preview?.publicUrl)
  const primaryActionLabel = resolvePreviewPrimaryActionLabel(preview)
  const activeViewport = PREVIEW_VIEWPORTS.find((viewport) => viewport.mode === viewportMode) ?? PREVIEW_VIEWPORTS[0]
  const ActiveViewportIcon = activeViewport.icon
  const activeFrameStyle = resolvePreviewFrameStyle(viewportMode, viewportOrientation)
  const copyableSourceAppUrl = directSourceAppUrl || preview?.sourceAppUrl || ''
  const copyablePublicSourceAppUrl = resolveDirectPreviewAccessUrl({
    sourceAppUrl: copyableSourceAppUrl,
    targetHost: executor?.previewIngressDetectedPublicIp,
  })
  const copyableLanSourceAppUrl = resolveDirectPreviewAccessUrl({
    sourceAppUrl: copyableSourceAppUrl,
    targetHost: executor?.previewIngressDetectedLanIp,
  })
  const canAttemptLocalDirectPreview = canUseLocalDirectPreview({
    sourceAppUrl: directSourceAppUrl,
    workspaceExecutorId: executorId || preview?.executorId,
    localWorkerExecutorId,
  })
  const meshBridgeBaseUrl = previewAccessRoute?.mode === 'mesh-direct' || previewAccessRoute?.mode === 'mesh-relayed'
    ? buildLocalWorkerPreviewMeshBridgeUrl({
        previewId: previewAccessRoute.previewSessionId,
        routeUrl: previewAccessRoute.url,
        endpoint: localWorkerEndpoint,
      })
    : ''
  const transportOptions = resolvePreviewTransportOptions({
    preview,
    canAttemptLocalDirectPreview,
    allowOnDemandTunnel: Boolean(directSourceAppUrl),
    localDirectBaseUrl,
    publicDirectBaseUrl,
    meshBridgeBaseUrl,
    previewAccessUrl: iframeUrl || previewBaseUrl,
    previewBaseUrl,
    transportProbes,
  })
  // Preview transport priority is:
  // 1) local-direct for same-machine loopback previews owned by the local worker
  // 2) public-direct for public nodes when the app port is exposed on the node IP
  // 3) mesh-bridge when the local worker can reach the target worker over EasyTier
  // 4) platform preview domain for public-proxy previews
  // 5) Tunnel as the existing compatibility fallback
  const activeTransport = resolveActivePreviewTransport({
    preference: transportPreference,
    preview,
    canAttemptLocalDirectPreview,
    localDirectPreviewFailed,
    publicDirectBaseUrl,
    meshBridgeBaseUrl,
    transportProbes,
  })
  const activeTransportLatencyMs = transportOptions.find((option) => option.transport === activeTransport)?.latencyMs
  const previewAccessRouteLabel = resolvePreviewAccessRouteLabel(previewAccessRoute)
  const shouldOpenRemotePreview = shouldOpenRemotePreviewForTransport({
    activeTransport,
    preview,
  })
  const activePreviewBaseUrl = activeTransport === 'local-direct'
    ? localDirectBaseUrl || previewBaseUrl
    : activeTransport === 'public-direct'
      ? publicDirectBaseUrl || previewBaseUrl
    : activeTransport === 'mesh-bridge'
      ? meshBridgeBaseUrl || previewBaseUrl
    : previewBaseUrl
  const publicDirectExternalReason = resolvePublicDirectExternalReason({
    activeTransport,
    pageProtocol: typeof window === 'undefined' ? '' : window.location.protocol,
    previewUrl: activePreviewBaseUrl,
  })
  const shouldOpenPublicDirectExternally = Boolean(publicDirectExternalReason)
  const canRenderInlinePreview = !shouldOpenPublicDirectExternally
  const connected = activeTransport === 'local-direct' || activeTransport === 'public-direct' || activeTransport === 'mesh-bridge'
    ? Boolean(activePreviewBaseUrl)
    : previewConnected
  const reconnecting = activeTransport !== 'local-direct' && activeTransport !== 'public-direct' && activeTransport !== 'mesh-bridge' && Boolean(preview && !previewConnected && iframeSrc)
  const cookieBackedPreviewBaseUrl = activePreviewBaseUrl
  const bootstrapIframeUrl = activeTransport === 'local-direct' || activeTransport === 'public-direct' || activeTransport === 'mesh-bridge'
    ? activePreviewBaseUrl
    : selectedPreviewSourceRemoteIframeUrl || activePreviewBaseUrl
  const stableBootstrapIframeUrl = resolvePreviewStableAccessUrl(bootstrapIframeUrl)
  const stableCookieBackedPreviewBaseUrl = resolvePreviewStableAccessUrl(cookieBackedPreviewBaseUrl)
  const previewSurfaceResetKey = [
    panelUiScopeKey,
    preview?.previewId || '',
    activeTransport,
    stableBootstrapIframeUrl,
    stableCookieBackedPreviewBaseUrl,
  ].join(':')
  const previewSurfaceResetKeyRef = useRef(previewSurfaceResetKey)
  const transportProbeKey = [
    preview?.previewId || '',
    resolvePreviewRemoteTransport(preview) || '',
    canAttemptLocalDirectPreview ? 'local' : 'remote',
    resolvePreviewStableAccessUrl(localDirectBaseUrl),
    resolvePreviewStableAccessUrl(publicDirectBaseUrl),
    resolvePreviewStableAccessUrl(meshBridgeBaseUrl),
    resolvePreviewStableAccessUrl(selectedPreviewSourceRemoteIframeUrl || previewBaseUrl),
    resolvePreviewStableAccessUrl(previewBaseUrl),
  ].join(':')
  const shouldUseBootstrapToken = activeTransport !== 'local-direct' && activeTransport !== 'public-direct' && activeTransport !== 'mesh-bridge' && Boolean(iframeUrl) && !previewViewerAccessBootstrapped
  const hasRenderableSurface = Boolean(canRenderInlinePreview && iframeSrc && (activeTransport === 'local-direct' || activeTransport === 'public-direct' || activeTransport === 'mesh-bridge' || preview))
  const visiblePreviewError = resolveVisiblePreviewError({
    previewLastError: preview?.lastError,
    connected,
    iframeLoaded: previewViewerAccessBootstrapped,
    iframeLoadTimedOut,
  })
  const cookieAccessWarning = resolvePreviewCookieAccessWarning({
    previewUrl: currentPreviewUrl || iframeSrc || activePreviewBaseUrl,
    currentPageHostname: typeof window === 'undefined' ? '' : window.location.hostname,
  })
  const previewNoticeVisible = Boolean(visiblePreviewError || localPreviewSiteWarning)
  const externalPreviewUrl = currentPreviewUrl || iframeSrc || activePreviewBaseUrl
  const canOpenExternalPreview = Boolean(externalPreviewUrl && (connected || shouldOpenPublicDirectExternally || preview))
  const shouldShowRemoteConnectingState = shouldOpenRemotePreview && (!connected || !iframeSrc)
  const additionalPreviewDomainBindings = resolvedPreviewSources.filter((source) => !source.primary && source.accessUrl)
  const canGoBack = previewNavigationHistoryIndex > 0
  const canGoForward = previewNavigationHistoryIndex < previewNavigationHistory.length - 1
  const canToggleOrientation = viewportMode !== 'desktop'

  useEffect(() => {
    if (!resolvedPreviewSources.length) {
      setSelectedPreviewSourceAppUrl('')
      return
    }
    setSelectedPreviewSourceAppUrl((current) => {
      if (current && resolvedPreviewSources.some((source) => source.appUrl === current)) {
        return current
      }
      return resolvedPreviewSources.find((source) => source.primary)?.appUrl || resolvedPreviewSources[0]?.appUrl || ''
    })
  }, [resolvedPreviewSources])

  useEffect(() => {
    if (resourceStatus !== 'active') {
      return
    }

    let cancelled = false
    void readLocalWorkerExecutor({
      expectedExecutorId: executorId || preview?.executorId,
    }).then((localWorker) => {
      if (!cancelled) {
        setLocalWorkerExecutorId(localWorker.executorId)
        setLocalWorkerEndpoint(localWorker.endpoint)
      }
    })
    return () => {
      cancelled = true
    }
  }, [executorId, preview?.executorId])

  useEffect(() => {
    if (!canAttemptLocalDirectPreview) {
      setLocalDirectPreviewFailed(false)
    }
  }, [canAttemptLocalDirectPreview])

  useEffect(() => {
    setLocalDirectPreviewFailed(false)
  }, [preview?.previewId])

  useEffect(() => {
    if (!shouldOpenRemotePreview) {
      remotePreviewOpenRequestRef.current = ''
    }
  }, [shouldOpenRemotePreview])

  useEffect(() => {
    let cancelled = false
    const probeTargets = resolvePreviewTransportProbeTargets({
      canAttemptLocalDirectPreview,
      localDirectBaseUrl,
      publicDirectBaseUrl,
      preview,
      previewAccessUrl: iframeUrl || previewBaseUrl,
      previewBaseUrl,
      meshBridgeBaseUrl,
    })

    setTransportProbes({
      'local-direct': probeTargets['local-direct'] ? { status: 'probing' } : { status: 'unavailable' },
      'mesh-bridge': probeTargets['mesh-bridge'] ? { status: 'probing' } : { status: 'unavailable' },
      gateway: probeTargets.gateway ? { status: 'probing' } : { status: 'unavailable' },
      tunnel: probeTargets.tunnel ? { status: 'probing' } : { status: 'unavailable' },
    })

    void Promise.all(
      (Object.entries(probeTargets) as Array<[PreviewTransport, string]>)
        .filter(([, url]) => Boolean(url))
        .map(async ([transport, url]) => {
          const next = await probePreviewTransport(url)
          if (cancelled) {
            return
          }
          setTransportProbes((current) => {
            const previous = current[transport]
            if (previous?.status === next.status && previous?.roundTripMs === next.roundTripMs && previous?.error === next.error) {
              return current
            }
            return {
              ...current,
              [transport]: next,
            }
          })
        }),
    )

    return () => {
      cancelled = true
    }
  }, [resourceStatus, transportProbeKey])

  useEffect(() => {
    setIframeLoading(Boolean(iframeSrc) && canRenderInlinePreview)
    setIframeLoadTimedOut(false)
  }, [canRenderInlinePreview, iframeSrc])

  useEffect(() => {
    previewPathRef.current = previewPath
  }, [previewPath])

  useEffect(() => {
    previewNavigationHistoryRef.current = previewNavigationHistory
    previewNavigationHistoryIndexRef.current = previewNavigationHistoryIndex
  }, [previewNavigationHistory, previewNavigationHistoryIndex])

  useEffect(() => {
    const previewSurfaceChanged = previewSurfaceResetKeyRef.current !== previewSurfaceResetKey
    previewSurfaceResetKeyRef.current = previewSurfaceResetKey
    const displayPath = resolvePreviewDisplayPath(bootstrapIframeUrl || cookieBackedPreviewBaseUrl)
    const hasStoredNavigation = previewPath !== '/'
      || previewAddressDraft !== '/'
      || previewNavigationHistory.length > 1
    const nextNavigation = resolvePreviewAddressNavigation({
      value: hasStoredNavigation ? previewAddressDraft || previewPath : displayPath,
      bootstrapIframeUrl,
      cookieBackedBaseUrl: cookieBackedPreviewBaseUrl,
      useBootstrapToken: Boolean(iframeUrl),
      rebaseAbsoluteUrl: previewSurfaceChanged,
    })
    setPreviewPath(nextNavigation.previewPath)
    previewPathRef.current = nextNavigation.previewPath
    if (!hasStoredNavigation) {
      setPreviewNavigationHistory([nextNavigation.displayUrl])
      setPreviewNavigationHistoryIndex(0)
      previewNavigationHistoryRef.current = [nextNavigation.displayUrl]
      previewNavigationHistoryIndexRef.current = 0
    }
    setIframeReloadKey(0)
    setPreviewViewerAccessBootstrapped(false)
    setIframeSrc(nextNavigation.iframeUrl)
    setCurrentPreviewUrl(nextNavigation.currentPreviewUrl)
    if (!hasStoredNavigation) {
      setPreviewAddressDraft(nextNavigation.displayUrl)
    }
  }, [previewSurfaceResetKey])

  useEffect(() => {
    if (activeTransport === 'local-direct' || activeTransport === 'public-direct' || activeTransport === 'mesh-bridge') {
      if (!activePreviewBaseUrl) {
        setIframeSrc('')
        setPreviewViewerAccessBootstrapped(false)
      }
      return
    }

    if (!connected) {
      setIframeSrc('')
      setPreviewViewerAccessBootstrapped(false)
      return
    }

    if (iframeSrc) {
      return
    }

    const nextNavigation = resolvePreviewAddressNavigation({
      value: currentPreviewUrl || previewPath,
      bootstrapIframeUrl,
      cookieBackedBaseUrl: cookieBackedPreviewBaseUrl,
      useBootstrapToken: shouldUseBootstrapToken,
    })
    setPreviewPath(nextNavigation.previewPath)
    previewPathRef.current = nextNavigation.previewPath
    setIframeSrc(nextNavigation.iframeUrl)
    setCurrentPreviewUrl(nextNavigation.currentPreviewUrl)
    if (!previewAddressDraftFocusedRef.current) {
      setPreviewAddressDraft(nextNavigation.displayUrl)
    }
  }, [
    activePreviewBaseUrl,
    activeTransport,
    bootstrapIframeUrl,
    connected,
    currentPreviewUrl,
    cookieBackedPreviewBaseUrl,
    iframeSrc,
    previewPath,
    shouldUseBootstrapToken,
  ])

  useEffect(() => {
    if (!shouldOpenRemotePreview || activeTransport === 'local-direct' || activeTransport === 'public-direct' || activeTransport === 'mesh-bridge' || busyAction === 'open') {
      return
    }

    const reason = transportPreference !== 'auto'
      ? transportPreference
      : localDirectPreviewFailed
        ? 'fallback'
        : shouldReconnectWaitingRemotePreview(preview)
          ? 'reconnect'
          : ''
    if (!reason) {
      return
    }

    const requestKey = `${reason}:${preview?.previewId || 'new'}`
    if (remotePreviewOpenRequestRef.current === requestKey) {
      return
    }

    remotePreviewOpenRequestRef.current = requestKey
    onOpen()
  }, [
    activeTransport,
    busyAction,
    localDirectPreviewFailed,
    onOpen,
    preview?.previewId,
    shouldOpenRemotePreview,
    transportPreference,
  ])

  useEffect(() => {
    const handlePreviewNavigationMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isPreviewNavigationBridgeMessage(event.data)) {
        return
      }

      const next = resolvePreviewNavigationBridgePath({
        href: event.data.href,
        previewBaseUrl: cookieBackedPreviewBaseUrl || bootstrapIframeUrl,
      })
      if (!next || next.path === previewPathRef.current) {
        if (next?.url) {
          setCurrentPreviewUrl(next.url)
          if (!previewAddressDraftFocusedRef.current) {
            setPreviewAddressDraft(resolvePreviewDisplayUrl(next.url))
          }
        }
        return
      }

      setPreviewPath(next.path)
      previewPathRef.current = next.path
      setCurrentPreviewUrl(next.url)
      if (!previewAddressDraftFocusedRef.current) {
        setPreviewAddressDraft(resolvePreviewDisplayUrl(next.url))
      }

      const nextDisplayUrl = resolvePreviewDisplayUrl(next.url)
      const currentHistory = previewNavigationHistoryRef.current
      const currentHistoryIndex = previewNavigationHistoryIndexRef.current
      let nextHistory = [...currentHistory]
      let nextHistoryIndex = currentHistoryIndex

      if (event.data.navigationType === 'replace' || event.data.navigationType === 'load' || event.data.navigationType === 'pageshow') {
        nextHistory[currentHistoryIndex] = nextDisplayUrl
      } else if (event.data.navigationType === 'pop') {
        const existingIndex = currentHistory.lastIndexOf(nextDisplayUrl)
        if (existingIndex >= 0) {
          nextHistoryIndex = existingIndex
        } else {
          nextHistory = [...currentHistory.slice(0, currentHistoryIndex + 1), nextDisplayUrl]
          nextHistoryIndex = nextHistory.length - 1
        }
      } else {
        nextHistory = [...currentHistory.slice(0, currentHistoryIndex + 1), nextDisplayUrl]
        nextHistoryIndex = nextHistory.length - 1
      }

      previewNavigationHistoryRef.current = nextHistory
      previewNavigationHistoryIndexRef.current = nextHistoryIndex
      setPreviewNavigationHistory(nextHistory)
      setPreviewNavigationHistoryIndex(nextHistoryIndex)
    }

    window.addEventListener('message', handlePreviewNavigationMessage)
    return () => window.removeEventListener('message', handlePreviewNavigationMessage)
  }, [bootstrapIframeUrl, cookieBackedPreviewBaseUrl])

  useEffect(() => {
    if (!canRenderInlinePreview || !iframeLoading || !iframeSrc) {
      return
    }

    const timer = window.setTimeout(() => {
      setIframeLoadTimedOut(true)
      setIframeLoading(false)
      if (activeTransport === 'local-direct') {
        setLocalDirectPreviewFailed(true)
      }
    }, IFRAME_LOADING_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [activeTransport, canRenderInlinePreview, iframeLoading, iframeSrc])

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(successMessage)
    } catch {
      toast.error('复制失败，请手动复制。')
    }
  }

  const cycleViewportMode = () => {
    const currentIndex = PREVIEW_VIEWPORTS.findIndex((viewport) => viewport.mode === viewportMode)
    const next = PREVIEW_VIEWPORTS[(currentIndex + 1) % PREVIEW_VIEWPORTS.length] ?? PREVIEW_VIEWPORTS[0]
    setViewportMode(next.mode)
    if (next.mode === 'desktop') {
      setViewportOrientation('portrait')
    }
  }

  const toggleViewportOrientation = () => {
    if (viewportMode === 'desktop') {
      return
    }

    setViewportOrientation((current) => current === 'portrait' ? 'landscape' : 'portrait')
  }

  const commitPreviewPathDraft = () => {
    const nextNavigation = resolvePreviewAddressNavigation({
      value: previewAddressDraft,
      bootstrapIframeUrl,
      cookieBackedBaseUrl: cookieBackedPreviewBaseUrl,
      useBootstrapToken: shouldUseBootstrapToken,
    })
    if (nextNavigation.currentPreviewUrl === currentPreviewUrl) {
      setPreviewAddressDraft(nextNavigation.displayUrl)
      return
    }

    setPreviewPath(nextNavigation.previewPath)
    previewPathRef.current = nextNavigation.previewPath
    setIframeSrc(nextNavigation.iframeUrl)
    setCurrentPreviewUrl(nextNavigation.currentPreviewUrl)
    setPreviewAddressDraft(nextNavigation.displayUrl)
    setPreviewNavigationHistory((current) => {
      const nextHistory = [...current.slice(0, previewNavigationHistoryIndex + 1), nextNavigation.displayUrl]
      previewNavigationHistoryRef.current = nextHistory
      previewNavigationHistoryIndexRef.current = nextHistory.length - 1
      setPreviewNavigationHistoryIndex(nextHistory.length - 1)
      return nextHistory
    })
  }

  const navigatePreviewHistory = (direction: -1 | 1) => {
    const nextIndex = previewNavigationHistoryIndex + direction
    const nextAddress = previewNavigationHistory[nextIndex]
    if (!nextAddress) {
      return
    }

    const nextNavigation = resolvePreviewAddressNavigation({
      value: nextAddress,
      bootstrapIframeUrl,
      cookieBackedBaseUrl: cookieBackedPreviewBaseUrl,
      useBootstrapToken: shouldUseBootstrapToken,
    })
    setPreviewNavigationHistoryIndex(nextIndex)
    setPreviewPath(nextNavigation.previewPath)
    previewPathRef.current = nextNavigation.previewPath
    previewNavigationHistoryIndexRef.current = nextIndex
    setIframeSrc(nextNavigation.iframeUrl)
    setCurrentPreviewUrl(nextNavigation.currentPreviewUrl)
    setPreviewAddressDraft(nextNavigation.displayUrl)
  }

  const reloadPreviewPage = () => {
    if (!iframeSrc) {
      return
    }

    setIframeLoadTimedOut(false)
    setIframeLoading(true)
    const nextNavigation = resolvePreviewAddressNavigation({
      value: currentPreviewUrl || previewPath,
      bootstrapIframeUrl,
      cookieBackedBaseUrl: cookieBackedPreviewBaseUrl,
      useBootstrapToken: shouldUseBootstrapToken,
    })
    setPreviewPath(nextNavigation.previewPath)
    previewPathRef.current = nextNavigation.previewPath
    setIframeSrc(nextNavigation.iframeUrl)
    setCurrentPreviewUrl(nextNavigation.currentPreviewUrl)
    setPreviewAddressDraft(nextNavigation.displayUrl)
    setIframeReloadKey((current) => current + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <div className="relative flex min-w-0 flex-wrap items-center gap-1.5 border-b border-zinc-900 px-2 py-1 sm:flex-nowrap sm:gap-2">
          <div className="flex h-7 min-w-0 basis-full items-center rounded-md border border-zinc-800 bg-zinc-900/70 px-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:min-w-[200px] sm:basis-0 sm:flex-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={cycleViewportMode}
              className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label={`切换预览尺寸，当前 ${activeViewport.label}`}
              title={`切换预览尺寸，当前 ${activeViewport.label}`}
            >
              <ActiveViewportIcon className="h-3.5 w-3.5" />
            </Button>
            {canToggleOrientation ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleViewportOrientation}
                className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                aria-label={viewportOrientation === 'portrait' ? '切换横屏' : '切换竖屏'}
                title={viewportOrientation === 'portrait' ? '切换横屏' : '切换竖屏'}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            <div className="mx-1 h-3 w-px shrink-0 bg-zinc-700" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => navigatePreviewHistory(-1)}
              disabled={!canRenderInlinePreview || !iframeSrc || !canGoBack}
              className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="后退"
              title="后退"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => navigatePreviewHistory(1)}
              disabled={!canRenderInlinePreview || !iframeSrc || !canGoForward}
              className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="前进"
              title="前进"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={reloadPreviewPage}
              disabled={!canRenderInlinePreview || !iframeSrc || busyAction === 'refresh'}
              className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="刷新当前网页"
              title="刷新当前网页"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <form
              className="flex min-w-0 flex-1 items-center"
              onSubmit={(event) => {
                event.preventDefault()
                commitPreviewPathDraft()
                previewAddressDraftBlurHandledRef.current = true
                event.currentTarget.querySelector('input')?.blur()
              }}
            >
              <input
                value={previewAddressDraft}
                onChange={(event) => setPreviewAddressDraft(event.target.value)}
                onFocus={() => {
                  previewAddressDraftFocusedRef.current = true
                }}
                onBlur={() => {
                  previewAddressDraftFocusedRef.current = false
                  if (previewAddressDraftBlurHandledRef.current) {
                    previewAddressDraftBlurHandledRef.current = false
                    return
                  }
                  commitPreviewPathDraft()
                }}
                disabled={!connected}
                aria-label="Preview 路径"
                className="h-6 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed disabled:text-zinc-600"
                placeholder="/"
              />
            </form>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenExternal(externalPreviewUrl)}
              disabled={!canOpenExternalPreview}
              className="h-7 w-7 shrink-0 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="在新窗口打开"
              title="在新窗口打开"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            {cookieAccessWarning ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-md border border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:text-amber-100"
                    aria-label="当前 Preview 不是域名化入口"
                    title="当前 Preview 不是域名化入口"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel className="flex items-center gap-2 text-amber-100">
                    <ShieldAlert className="h-4 w-4 text-amber-300" />
                    当前 Preview 不是域名化入口
                  </DropdownMenuLabel>
                  <div className="px-2 pb-2 text-xs leading-5 text-zinc-400">
                    <p>
                      iframe 正在通过 <code className="text-amber-200">{cookieAccessWarning.host}</code> 访问源应用，登录态 cookie 可能不会在嵌入的 Preview 中稳定生效。
                    </p>
                    <p className="mt-1">
                      需要登录验证时，建议外部打开，或切到公网预览域名 / 隧道预览域名这类 <code className="text-amber-200">*.wemux.xyz</code> 域名入口。
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onOpenExternal(externalPreviewUrl)}
                    disabled={!externalPreviewUrl}
                  >
                    <ExternalLink className="h-4 w-4" />
                    外部打开
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:flex-none">
            {resolvedPreviewSources.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedPreviewSource}
                    className={cn(
                      'h-7 min-w-0 max-w-[12rem] shrink rounded-md border px-2 text-[11px] font-medium sm:max-w-none sm:shrink-0',
                      'border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50',
                    )}
                    aria-label="切换预览端口"
                    title="切换预览端口"
                  >
                    <span className="truncate">
                      {selectedPreviewSource ? resolvePreviewSourceLabel(selectedPreviewSource) : '选择端口'}
                    </span>
                    <ChevronDown className="h-3 w-3 text-zinc-500" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Preview Ports</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={selectedPreviewSource?.appUrl || ''}
                    onValueChange={(value) => {
                      if (value === selectedPreviewSource?.appUrl) {
                        return
                      }
                      setPreviewViewerAccessBootstrapped(false)
                      setIframeSrc('')
                      setCurrentPreviewUrl('')
                      setPreviewPath('/')
                      previewPathRef.current = '/'
                      setPreviewNavigationHistory(['/'])
                      setPreviewNavigationHistoryIndex(0)
                      previewNavigationHistoryRef.current = ['/']
                      previewNavigationHistoryIndexRef.current = 0
                      setPreviewAddressDraft('/')
                      setSelectedPreviewSourceAppUrl(value)
                    }}
                  >
                    {resolvedPreviewSources.map((source) => (
                      <DropdownMenuRadioItem key={source.appUrl} value={source.appUrl} className="items-start">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-zinc-200">{resolvePreviewSourceLabel(source)}</span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">{source.appUrl}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!preview && !directSourceAppUrl}
                  className={cn(
                    'h-7 min-w-0 max-w-[11rem] shrink rounded-md border px-2 text-[11px] font-medium sm:max-w-none sm:shrink-0',
                    'border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50',
                  )}
                  aria-label="切换 Preview transport"
                  title="切换 Preview transport"
                >
                  <span className={cn('truncate', resolvePreviewStatusTextTone(preview))}>
                    {resolvePreviewTransportLabel(preview, activeTransport)}
                  </span>
                  {preview || activeTransport === 'local-direct' ? (
                    <>
                      <span className="text-zinc-600">·</span>
                      <span className={cn(resolvePreviewStatusTextTone(preview))}>
                        {formatLatencyValue(activeTransportLatencyMs)}
                      </span>
                    </>
                  ) : null}
                  <ChevronDown className="h-3 w-3 text-zinc-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Preview Transport</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={transportPreference}
                  onValueChange={(value) => {
                    if (value !== 'auto' && value !== 'local-direct' && value !== 'public-direct' && value !== 'mesh-bridge' && value !== 'gateway' && value !== 'tunnel') {
                      return
                    }
                    if (value === 'local-direct') {
                      setLocalDirectPreviewFailed(false)
                    }
                    setTransportPreference(value)
                  }}
                >
                  <DropdownMenuRadioItem value="auto" className="items-start">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-zinc-500">自动选择</span>
                      <span className="block truncate text-sm text-zinc-200">
                        当前会优先使用 {resolvePreviewTransportName(activeTransport)}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                  {transportOptions.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.transport}
                      value={option.transport}
                      disabled={!option.available}
                      className="items-start"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm text-zinc-200">{option.label}</span>
                          <span className="shrink-0 text-[11px] text-zinc-500">{formatLatencyValue(option.latencyMs)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {option.available
                            ? !option.url
                              ? '按需启动远端 Preview 通道'
                              : option.status === 'error'
                                ? option.error || '当前不可达'
                                : option.transport === 'public-direct'
                                  ? `${option.url} · 默认外部打开`
                                  : option.url
                            : '当前会话未提供这条链路'}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {previewAccessRouteLabel ? (
              <span
                className={cn(
                  'inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[11px] font-medium',
                  resolvePreviewAccessRouteTone(previewAccessRoute),
                )}
                title={previewAccessRoute?.url || previewAccessRouteLabel}
              >
                {previewAccessRouteLabel}
              </span>
            ) : null}

            <div className="flex shrink-0 items-center gap-0.5">
              {shouldOpenRemotePreview ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={onOpen}
                  disabled={busyAction === 'open'}
                  className="h-7 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                >
                  {busyAction === 'open' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Rocket className="mr-1 h-3 w-3" />}
                  {primaryActionLabel}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!preview && !directSourceAppUrl}
                    className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    aria-label="Preview 更多操作"
                    title="Preview 更多操作"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Preview</DropdownMenuLabel>
                  {copyableSourceAppUrl ? (
                    <DropdownMenuItem
                      onSelect={() => void copyText(copyableSourceAppUrl, '源地址已复制。')}
                      className="items-start"
                    >
                      <Copy className="mt-0.5 h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-zinc-500">源应用地址</span>
                        <span className="block truncate text-sm text-zinc-200">{copyableSourceAppUrl}</span>
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  {copyablePublicSourceAppUrl ? (
                    <DropdownMenuItem
                      onSelect={() => void copyText(copyablePublicSourceAppUrl, '公网地址已复制。')}
                      className="items-start"
                    >
                      <Copy className="mt-0.5 h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-zinc-500">公网地址</span>
                        <span className="block truncate text-sm text-zinc-200">{copyablePublicSourceAppUrl}</span>
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  {copyableLanSourceAppUrl ? (
                    <DropdownMenuItem
                      onSelect={() => void copyText(copyableLanSourceAppUrl, '局域网地址已复制。')}
                      className="items-start"
                    >
                      <Copy className="mt-0.5 h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-zinc-500">局域网地址</span>
                        <span className="block truncate text-sm text-zinc-200">{copyableLanSourceAppUrl}</span>
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  {preview ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() => void copyText(authorizedPreviewCopyUrl, `${resolvePreviewDomainLabel(preview)}已复制。`)}
                        className="items-start"
                        disabled={!authorizedPreviewCopyUrl}
                      >
                        <Copy className="mt-0.5 h-4 w-4" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs text-zinc-500">{resolvePreviewDomainLabel(preview)}</span>
                          <span className="block truncate text-sm text-zinc-200">{authorizedPreviewCopyUrl || preview.publicUrl}</span>
                        </span>
                      </DropdownMenuItem>
                      {additionalPreviewDomainBindings.map((source) => (
                        <DropdownMenuItem
                          key={`${source.appUrl}:${source.accessUrl}`}
                          onSelect={() => void copyText(source.accessUrl, '端口访问链接已复制。')}
                          className="items-start"
                        >
                          <Copy className="mt-0.5 h-4 w-4" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs text-zinc-500">{resolvePreviewSourceLabel(source)}</span>
                            <span className="block truncate text-sm text-zinc-200">{source.accessUrl}</span>
                          </span>
                        </DropdownMenuItem>
                      ))}
                      {copyableSourceAppUrl ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem onSelect={onRefresh} disabled={busyAction === 'refresh'}>
                        {busyAction === 'refresh'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <RefreshCw className="h-4 w-4" />}
                        刷新 Preview 状态
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={preview.share.enabled ? onRevokeShare : onShare}
                        disabled={busyAction === 'share' || busyAction === 'revoke'}
                      >
                        {busyAction === 'share' || busyAction === 'revoke'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Link2 className="h-4 w-4" />}
                        {resolvePreviewShareActionLabel(preview)}
                      </DropdownMenuItem>
                      {shareUrl ? (
                        <DropdownMenuItem onSelect={() => void copyText(shareUrl, `${resolvePreviewDomainLabel(preview)}分享链接已复制。`)}>
                          <Copy className="h-4 w-4" />
                          {resolvePreviewShareCopyLabel(preview)}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={onStop} disabled={busyAction === 'stop'}>
                        {busyAction === 'stop'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Square className="h-4 w-4" />}
                        停止 Preview
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              {headerActions}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          {previewNoticeVisible ? (
            <div className="flex flex-col gap-1.5 px-3 py-2 text-xs text-zinc-400">
              {visiblePreviewError ? (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/8 p-3 text-rose-200">
                  {visiblePreviewError}
                </div>
              ) : null}
              {localPreviewSiteWarning ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-amber-100">
                  <p className="text-sm font-medium">本地 Preview 需要同站点 host</p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/80">
                    当前 Wemux 页面还是 <code>127.0.0.1</code> 或 <code>localhost</code>，但 Preview iframe 在 <code>*.{localPreviewSiteWarning.suggestedHost.replace(/^app\./, '')}</code>。
                    浏览器会把它当成跨站点 iframe，导致 Preview 授权 cookie 无法在后续请求里带回。
                  </p>
                  <p className="mt-2 text-xs leading-5 text-amber-100/80">
                    重新从 <code>{localPreviewSiteWarning.suggestedOrigin}</code> 打开当前页面，再连接 Preview。当前 hybrid 开发环境应该默认收口到这个同站点 host。
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1">
          {shouldOpenPublicDirectExternally ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
              <div className="max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
                <p className="text-base font-medium text-zinc-100">公网 IP 直连需要外部打开</p>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  这条路线会直接访问服务器 IP 和端口，适合快速诊断节点端口是否通。为了避免 HTTPS 控制台内嵌 HTTP 页面被浏览器拦截，Wemux 不在这里嵌入加载它。
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  如果想在 Preview 面板内直接查看页面，请切到「公网预览域名」或「隧道预览域名」。
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onOpenExternal(externalPreviewUrl, { transport: 'public-direct' })}
                    disabled={!externalPreviewUrl}
                    className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    外部打开
                  </Button>
                  {externalPreviewUrl ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(externalPreviewUrl, '公网直连地址已复制。')}
                      className="h-8 rounded-md border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      复制地址
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : !hasRenderableSurface ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
              <p className="text-base font-medium text-zinc-100">
                {activeTransport === 'local-direct' || activeTransport === 'mesh-bridge' ? '正在准备本地直连 Preview' : 'Preview 还没启动'}
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                {activeTransport === 'local-direct' || activeTransport === 'mesh-bridge'
                  ? '检测到当前工作区可以直连本机 localhost。等源应用就绪后，这里会直接显示本地页面，不会先启动隧道。'
                  : 'Preview 需要先准备远端访问链路。切到公网访问或 Tunnel 后，Wemux 会按需启动对应的 Preview 通道。'}
              </p>
            </div>
          ) : shouldShowRemoteConnectingState ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
              <p className="text-base font-medium text-zinc-100">Preview 正在建立连接</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                预览链路还没完全就绪。等链路准备完成后，这里才会加载页面，避免在源应用未就绪时直接打开外部地址导致 502。
              </p>
            </div>
          ) : (
            <div className="relative flex h-full min-h-[320px] justify-center overflow-auto bg-[#0a0a0b] px-0">
              {iframeLoading || reconnecting ? (
                <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-100 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300" />
                  <span className="truncate">{reconnecting ? 'Preview 隧道正在重连…' : '正在加载 Preview…'}</span>
                </div>
              ) : null}
              {iframeLoadTimedOut ? (
                <div className="absolute inset-x-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-zinc-950/95 px-3 py-2 text-xs text-amber-50 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                  <span className="min-w-0 flex-1">
                    {activeTransport === 'local-direct' || activeTransport === 'mesh-bridge'
                      ? '本地直连没有及时加载成功，正在回退到现有 Preview 通道。源应用可能还在编译，或当前 localhost 页面暂时不可达。'
                      : '页面加载时间偏长。隧道已连通，源应用可能还在编译，或当前路径返回了慢响应。'}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={reloadPreviewPage}
                    className="h-7 shrink-0 border-amber-400/30 bg-amber-400/10 px-2 text-[11px] text-amber-50 hover:bg-amber-400/20 hover:text-amber-50"
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    重试
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenExternal(externalPreviewUrl)}
                    className="h-7 shrink-0 border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100 hover:bg-zinc-800 hover:text-zinc-50"
                  >
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    新窗口
                  </Button>
                </div>
              ) : null}
              <div
                className={cn(
                  activeViewport.frameClassName,
                  'relative overflow-hidden bg-white transition-[height,max-height,max-width,width] duration-200',
                  activeViewport.mode === 'desktop'
                    ? ''
                    : 'my-3 rounded-xl border border-zinc-800 shadow-[0_20px_80px_rgba(0,0,0,0.35)]',
                )}
                style={activeFrameStyle}
              >
                {resourceStatus !== 'disposed' ? <iframe
                  key={`${iframeSrc}:${iframeReloadKey}`}
                  name="workspace-preview-panel"
                  title="Workspace preview"
                  ref={iframeRef}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-presentation allow-downloads allow-popups"
                  allow="accelerometer; autoplay; camera; encrypted-media; fullscreen; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; payment; usb; vr; xr-spatial-tracking; screen-wake-lock; magnetometer; ambient-light-sensor; battery; gamepad; picture-in-picture; display-capture; bluetooth;"
                  src={iframeSrc}
                  className="h-full w-full border-0"
                  onLoad={() => {
                    setPreviewViewerAccessBootstrapped(true)
                    setIframeLoadTimedOut(false)
                    setIframeLoading(false)
                    if (activeTransport === 'local-direct' || activeTransport === 'mesh-bridge') {
                      setLocalDirectPreviewFailed(false)
                    }
                  }}
                /> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
