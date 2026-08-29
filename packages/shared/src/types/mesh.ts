export type WorkerMeshRuntimeStatus =
  | 'disabled'
  | 'installing'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'error'

export type WorkerMeshRouteMode = 'direct' | 'relayed' | 'unknown'

export type MeshTransportMode =
  | 'mesh-direct'
  | 'mesh-relayed'
  | 'preview-gateway'
  | 'terminal-public-gateway'
  | 'control-plane-ws'

export interface WorkerMeshPeer {
  executorId?: string
  meshNodeId: string
  meshIpv4?: string
  latencyMs?: number
  lossRate?: number
  routeMode: WorkerMeshRouteMode
  tunnelProto?: string
  lastSeenAt: string
}

export interface WorkerMeshStatus {
  enabled: boolean
  status: WorkerMeshRuntimeStatus
  meshNodeId?: string
  meshIpv4?: string
  meshHostname?: string
  natType?: string
  routeMode?: WorkerMeshRouteMode
  peers?: WorkerMeshPeer[]
  errorMessage?: string
  reportedAt: string
}

export interface WorkerMeshEnrollmentConfig {
  enabled: boolean
  networkName?: string
  networkSecret?: string
  peers: string[]
  ipv4?: string
  hostname?: string
  previewProxyPort?: number
  terminalProxyPort?: number
}

export interface WorkspaceMeshRoute {
  workspaceId: string
  sourceExecutorId?: string
  targetExecutorId: string
  mode: MeshTransportMode
  meshIpv4?: string
  port?: number
  url?: string
  checkedAt: string
}

export interface PreviewAccessRoute extends WorkspaceMeshRoute {
  previewSessionId: string
  mode: Extract<MeshTransportMode, 'mesh-direct' | 'mesh-relayed' | 'preview-gateway'>
  expiresAt?: string
}

export interface TerminalAccessRoute extends WorkspaceMeshRoute {
  terminalId: string
  mode: Extract<MeshTransportMode, 'mesh-direct' | 'mesh-relayed' | 'terminal-public-gateway' | 'control-plane-ws'>
  expiresAt?: string
}
