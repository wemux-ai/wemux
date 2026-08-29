import type { PreviewAccessRoute } from './mesh'

export type PreviewExecutionSurface = 'private-node' | 'managed-cloud'

export type PreviewSessionPurpose = 'app' | 'desktop' | 'code-server'

export type PreviewAccessMode = 'tunnel' | 'public-proxy'

export type PreviewSessionStatus =
  | 'opening'
  | 'waiting_tunnel'
  | 'active'
  | 'stopping'
  | 'closed'
  | 'error'

export type PreviewTunnelClientStatus = 'connecting' | 'open' | 'closed' | 'error'

export const PREVIEW_NAVIGATION_BRIDGE_MESSAGE_TYPE = 'vibemux.preview.navigation' as const

export interface PreviewNavigationBridgeMessage {
  type: typeof PREVIEW_NAVIGATION_BRIDGE_MESSAGE_TYPE
  href: string
  navigationType?: 'load' | 'push' | 'replace' | 'pop' | 'hash' | 'pageshow'
}

export interface PreviewAdditionalSourceDto {
  appUrl: string
  healthUrl?: string
  publicUrl?: string
  previewHost?: string
  iframeUrl?: string
  port?: number
  note?: string
  domainType?: 'generated' | 'custom'
}

export interface WorkspacePreviewSourceSummary {
  // 该端口的隧道/公网预览域名(gateway/tunnel transport 使用)
  publicUrl: string
  previewHost: string
  // 源应用 loopback 地址(local-direct/public-direct transport 使用),如 http://127.0.0.1:3000/
  appUrl: string
  port?: number
  note?: string
  primary: boolean
}

export interface WorkspacePreviewSummary {
  previewId: string
  // 该 preview session 的远端 transport:'gateway'(公网预览域名)或 'tunnel'(隧道预览域名)
  remoteTransport: 'gateway' | 'tunnel'
  sources: WorkspacePreviewSourceSummary[]
}

export interface PreviewDomainBindingDto {
  id?: string
  appUrl: string
  publicUrl: string
  previewHost: string
  iframeUrl?: string
  port?: number
  note?: string
  domainType?: 'generated' | 'custom'
  primary?: boolean
}

export interface PreviewViewerAccess {
  iframeUrl: string
  publicUrl: string
  previewHost: string
  additionalSourceAccess?: Array<{
    appUrl: string
    iframeUrl: string
    publicUrl: string
    previewHost: string
    port?: number
    note?: string
    domainType?: 'generated' | 'custom'
  }>
  grantType: 'owner' | 'share'
  expiresAt?: string
}

export interface PreviewShareState {
  enabled: boolean
  shareUrl?: string
  expiresAt?: string
  revokedAt?: string
}

export interface PreviewTunnelMetricsDto {
  negotiatedChunkBytes?: number
  binaryPayloads?: boolean
  activeStreams?: number
  requestCount?: number
  requestBytes?: number
  responseBytes?: number
  wsFrameCount?: number
  wsBytes?: number
  abortCount?: number
  timeoutCount?: number
  reconnectCount?: number
  currentBufferedAmount?: number
  peakBufferedAmount?: number
  currentSendQueueDepth?: number
  peakSendQueueDepth?: number
  currentSendQueueBytes?: number
  peakSendQueueBytes?: number
  updatedAt?: string
}

export interface PreviewSessionDto {
  previewId: string
  purpose: PreviewSessionPurpose
  projectId: string
  taskId: string
  workspaceId: string
  workspaceSessionId: string
  executorId: string
  executionSurface: PreviewExecutionSurface
  accessMode: PreviewAccessMode
  status: PreviewSessionStatus
  publicUrl: string
  previewHost: string
  sourceAppUrl: string
  domainBindings?: PreviewDomainBindingDto[]
  additionalSourceAppUrls: PreviewAdditionalSourceDto[]
  healthUrl?: string
  createdAt: string
  updatedAt: string
  tunnelClientStatus?: PreviewTunnelClientStatus
  tunnelConnectedAt?: string
  tunnelLatencyMs?: number
  tunnelLatencySampledAt?: string
  tunnelMetrics?: PreviewTunnelMetricsDto
  lastError?: string
  share: PreviewShareState
}

export interface OpenPreviewRequest {
  workspaceId?: string
  workspaceSessionId?: string
  autoStart?: boolean
  meshSourceExecutorId?: string
}

export interface OpenPreviewResponse {
  preview: PreviewSessionDto
  viewer: PreviewViewerAccess
  accessRoute?: PreviewAccessRoute
}

export interface GetPreviewResponse {
  preview: PreviewSessionDto
  viewer: PreviewViewerAccess
  accessRoute?: PreviewAccessRoute
}

export interface ResolveWorkspacePreviewSourceResponse {
  preview: PreviewSessionDto
  viewer: PreviewViewerAccess
  sourceAppUrl: string
  sourceViewerUrl: string
  accessRoute?: PreviewAccessRoute
}

export interface GetTaskPreviewResponse {
  preview: PreviewSessionDto | null
  viewer: PreviewViewerAccess | null
  accessRoute?: PreviewAccessRoute
}

export interface StopPreviewResponse {
  previewId: string
  status: 'closed' | 'stopping'
  closedAt: string
}

export interface CreatePreviewShareRequest {
  expiresInMinutes?: number
}

export interface CreatePreviewShareResponse {
  previewId: string
  share: {
    enabled: true
    shareUrl: string
    expiresAt: string
  }
}

export interface RevokePreviewShareResponse {
  previewId: string
  share: {
    enabled: false
    revokedAt: string
  }
}
