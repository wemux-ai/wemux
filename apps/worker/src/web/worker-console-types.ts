// [INPUT]: 控制台类型输入
// [OUTPUT]: 类型定义
// [POS]: Worker Console 类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WorkerProjectBinding = {
  projectId?: string
  repoUrl?: string
  localPath: string
}

export type WorkerConfig = {
  cloudUrl: string
  machineId: string
  machineName: string
  executorName?: string
  executorId?: string
  executorToken?: string
  lastPairedPairingCode?: string
  opencodeConfigContent?: string
  codexConfigContent?: string
  codexAuthContent?: string
  claudeCodeConfigContent?: string
  piAgentDir?: string
  defaultModel?: string
  agentSettings?: unknown
  mcpServers?: unknown[]
  workspaceRoot: string
  maxConcurrency: number
  labels: string[]
  capabilities: string[]
  localServerPort: number
  projectBindings?: WorkerProjectBinding[]
}

export type WorkerRuntimeState = {
  daemonMode: 'idle' | 'starting' | 'running' | 'unpaired' | 'disconnected'
  paired: boolean
  connected: boolean
  executorId?: string
  effectiveCloudUrl?: string
  routeSelection?: {
    bootstrapCloudUrl: string
    assignedCloudUrl?: string
    selectedCloudUrl?: string
    countryCode?: string
    continentCode?: string
    matchedRouteId?: string
    assignedLabels: string[]
    selectedLabels: string[]
    managedRoutingLabels: string[]
    candidateResults: Array<{
      id: string
      cloudUrl: string
      labels: string[]
      reachable: boolean
      latencyMs?: number
      statusCode?: number
      error?: string
    }>
    resolutionError?: string
    updatedAt: string
  }
  lastConnectAttemptAt?: string
  lastHeartbeatAt?: string
  lastTaskAt?: string
  lastDisconnectAt?: string
  runningTaskIds: string[]
  queuedTaskIds: string[]
  mesh?: {
    enabled: boolean
    status: 'disabled' | 'installing' | 'connecting' | 'ready' | 'degraded' | 'error'
    meshNodeId?: string
    meshIpv4?: string
    meshHostname?: string
    natType?: string
    routeMode?: 'direct' | 'relayed' | 'unknown'
    peers?: Array<{
      executorId?: string
      meshNodeId: string
      meshIpv4?: string
      latencyMs?: number
      lossRate?: number
      routeMode: 'direct' | 'relayed' | 'unknown'
      tunnelProto?: string
      lastSeenAt: string
    }>
    errorMessage?: string
    reportedAt: string
  }
  lastError?: string
}

export type WorkerMcpServer = {
  id: string
  name: string
  target: string
  transport: string
  capabilityMode: string
  enabled: boolean
  materialized: boolean
  kind: 'builtin' | 'stdio' | 'remote' | 'custom'
  endpoint?: string
  command?: string
  headerKeys: string[]
  actingUserScoped: boolean
}

export type WorkerMcpStatus = {
  configuredCount: number
  enabledCount: number
  materializedCount: number
  builtinEnabled: boolean
  builtinReady: boolean
  actingUserMode: 'request-scoped' | 'pairing-required' | 'disabled'
  servers: WorkerMcpServer[]
}

export type WorkerDoctorItem = {
  id: string
  category?: string
  label?: string
  ok: boolean
  detail: string
  hint?: string
}

export type WorkerDoctorPayload = {
  items?: WorkerDoctorItem[]
  summary?: {
    total: number
    passed: number
    failed: number
    ok: boolean
  }
  cloudProbe?: { message?: string }
  officialSiteProbe?: { message?: string }
  config?: unknown
  runtime?: WorkerRuntimeState
}

export type Locale = 'en' | 'zh'

export type ConsoleTabId = 'overview' | 'settings' | 'bindings' | 'doctor' | 'sessions'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger'

export type ActionTone = 'primary' | 'secondary' | 'danger'

export type ConsoleAction = {
  label: string
  onClick: () => void
  tone?: ActionTone
  disabled?: boolean
}

export type ConsoleMetric = {
  label: string
  value: string
  tone?: StatusTone
}

export type ConsoleDetail = {
  label: string
  value: string
}

export type AgentSessionSource = 'claude' | 'opencode' | 'codex' | 'pi'

export type AgentSessionSummary = {
  id: string
  source: AgentSessionSource
  title: string
  cwd: string
  startedAt?: string
  lastUpdatedAt: string
  entryCount: number
}

export type AgentSessionEntry = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  timestamp?: string
}

export type AgentSessionDetail = AgentSessionSummary & {
  entries: AgentSessionEntry[]
}

export type AgentSessionsPayload = {
  sessions: AgentSessionSummary[]
  counts: Record<AgentSessionSource, number>
}
