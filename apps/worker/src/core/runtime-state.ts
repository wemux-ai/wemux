// [INPUT]: 运行时状态输入
// [OUTPUT]: 状态管理
// [POS]: 运行时状态
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkerConfig, WorkerMeshStatus } from '@shared/types'

export interface WorkerRouteProbeRuntimeState {
  id: string
  cloudUrl: string
  labels: string[]
  reachable: boolean
  latencyMs?: number
  statusCode?: number
  error?: string
}

export interface WorkerRouteSelectionRuntimeState {
  bootstrapCloudUrl: string
  assignedCloudUrl?: string
  selectedCloudUrl?: string
  countryCode?: string
  continentCode?: string
  matchedRouteId?: string
  assignedLabels: string[]
  selectedLabels: string[]
  managedRoutingLabels: string[]
  candidateResults: WorkerRouteProbeRuntimeState[]
  resolutionError?: string
  updatedAt: string
}

export interface WorkerRuntimeState {
  daemonMode: 'idle' | 'starting' | 'running' | 'unpaired' | 'disconnected'
  paired: boolean
  connected: boolean
  localConsole?: {
    enabled: boolean
    port?: number
    instanceId?: string
    localUrl?: string
    disabledReason?: string
  }
  executorId?: string
  effectiveCloudUrl?: string
  routeSelection?: WorkerRouteSelectionRuntimeState
  lastConnectAttemptAt?: string
  lastHeartbeatAt?: string
  lastTaskAt?: string
  lastDisconnectAt?: string
  runningTaskIds: string[]
  queuedTaskIds: string[]
  mesh?: WorkerMeshStatus
  lastError?: string
  startedAt?: string
  featureFlags?: import('@shared/user-experimental-settings').ExecutorFeatureFlags
  config?: WorkerConfig
}

const runtimeState: WorkerRuntimeState = {
  daemonMode: 'idle',
  paired: false,
  connected: false,
  runningTaskIds: [],
  queuedTaskIds: [],
}

const cloneRouteSelectionState = (routeSelection?: WorkerRouteSelectionRuntimeState) => {
  if (!routeSelection) {
    return undefined
  }

  return {
    ...routeSelection,
    assignedLabels: [...routeSelection.assignedLabels],
    selectedLabels: [...routeSelection.selectedLabels],
    managedRoutingLabels: [...routeSelection.managedRoutingLabels],
    candidateResults: routeSelection.candidateResults.map((result) => ({
      ...result,
      labels: [...result.labels],
    })),
  }
}

export const getWorkerRuntimeState = () => ({
  ...runtimeState,
  routeSelection: cloneRouteSelectionState(runtimeState.routeSelection),
  runningTaskIds: [...runtimeState.runningTaskIds],
  queuedTaskIds: [...runtimeState.queuedTaskIds],
  mesh: runtimeState.mesh
    ? {
        ...runtimeState.mesh,
        peers: runtimeState.mesh.peers?.map((peer) => ({ ...peer })),
      }
    : undefined,
})

export const sanitizeWorkerConfig = (config: WorkerConfig): WorkerConfig => ({
  ...config,
  executorToken: config.executorToken?.trim() ? '[redacted]' : undefined,
  opencodeConfigContent: config.opencodeConfigContent?.trim() ? '[redacted]' : '',
  codexConfigContent: config.codexConfigContent?.trim() ? '[redacted]' : '',
  codexAuthContent: config.codexAuthContent?.trim() ? '[redacted]' : '',
  claudeCodeConfigContent: config.claudeCodeConfigContent?.trim() ? '[redacted]' : '',
  mcpServers: config.mcpServers?.map((server) => ({
    ...server,
    target: server.target?.trim() ? '[redacted]' : server.target,
  })),
})

export const getSafeWorkerRuntimeState = () => {
  const state = getWorkerRuntimeState()
  return {
    ...state,
    config: state.config ? sanitizeWorkerConfig(state.config) : undefined,
  }
}

export const updateWorkerRuntimeState = (patch: Partial<WorkerRuntimeState>) => {
  Object.assign(runtimeState, patch)
}
