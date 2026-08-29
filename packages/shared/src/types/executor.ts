import type { SkillFileContent, SkillFileInventoryEntry, SkillTrustLevel } from '../skill'
import type { TaskChatAttachment } from '../task-chat-attachment'

import type {
  AgentRuntimeSettings,
  AgentSettings,
  ExecutorBillingClass,
  ExecutionModelOption,
  ExecutorConnectionStatus,
  ExecutorManagedBy,
  ExecutorRuntimeClass,
  ExecutorSource,
  ExecutorVisibility,
  GitAuthMode,
  GitAuthSourceType,
  GitProvider,
  ModelProfileRuntimeSettings,
  NodeStatus,
  OpenCodeExecutionConfig,
  ProjectVersionControl,
  WorkerUpdateSettings,
} from './core'
import type { AgentType } from './core'
import type { AgentPromptResultBase } from './agent-prompt'
import type { WorkerMeshEnrollmentConfig, WorkerMeshStatus } from './mesh'
import type {
  WorkspaceTerminalSessionDescriptor,
  WorkspaceTerminalSessionSnapshot,
} from '../workspace-terminal'

export interface ExecutorDescriptor {
  executorId: string
  machineId: string
  machineName: string
  name: string
  connectedNodeId?: string
  realtimeBaseUrl?: string
  previewExposureMode?: 'private' | 'public-ingress'
  previewIngressPort?: number
  previewIngressBaseUrl?: string
  previewIngressDetectedPublicIp?: string
  previewIngressDetectedLanIp?: string
  previewIngressReachable?: boolean
  previewIngressLastCheckedAt?: string
  previewIngressLastError?: string
  executorSource?: ExecutorSource
  managedBy?: ExecutorManagedBy
  runtimeClass?: ExecutorRuntimeClass
  billingClass?: ExecutorBillingClass
  note?: string
  ownerUserId: string
  teamId?: string
  workspaceIds?: string[]
  visibility: ExecutorVisibility
  status: ExecutorConnectionStatus
  workspaceRoot: string
  maxConcurrency: number
  localServerPort?: number
  localServerInstanceId?: string
  capabilities: string[]
  labels: string[]
  sshPubkey?: string
  platform?: string
  version?: string
  lastSeenAt?: string
  managedCloudLifecycle?: ExecutorManagedCloudLifecycleSnapshot
  createdAt: string
}

export interface ExecutorManagedCloudLifecycleSnapshot {
  state: 'active' | 'stopped' | 'auto-stopped'
  startedAt?: string
  stoppedAt?: string
  stopReason?: string
  lastActivityAt?: string
  idleDurationMs?: number
}

export interface ExecutorCpuSnapshot {
  coreCount: number
  model?: string
  averageSpeedMhz?: number
  loadAverage?: [number, number, number]
  usagePercent?: number
}

export interface ExecutorMemorySnapshot {
  totalBytes: number
  freeBytes: number
  usedBytes: number
}

export interface ExecutorDiskSnapshot {
  path: string
  totalBytes: number
  freeBytes: number
  availableBytes: number
  usedBytes: number
}

export interface ExecutorSystemSnapshot {
  platform: string
  arch: string
  hostname: string
  release: string
  version?: string
  nodeVersion: string
  workerVersion: string
  systemUptimeSec: number
  processUptimeSec: number
}

export interface ExecutorTelemetrySnapshot {
  capturedAt: string
  cpu: ExecutorCpuSnapshot
  memory: ExecutorMemorySnapshot
  disk?: ExecutorDiskSnapshot
  system: ExecutorSystemSnapshot
}

export interface ExecutorLatencySnapshot {
  roundTripMs: number
  sampledAt: string
}

export interface ExecutorPresenceSnapshot {
  runningTaskIds: string[]
  queuedTaskIds: string[]
  lastHeartbeatAt: string
  telemetry?: ExecutorTelemetrySnapshot
  latency?: ExecutorLatencySnapshot
  mesh?: WorkerMeshStatus
}

export interface ExecutorRecord extends ExecutorDescriptor {
  presence?: ExecutorPresenceSnapshot
}

export type ExecutorLocalAccessCandidateRole = 'target' | 'mesh-source'

export interface ExecutorLocalAccessCandidate {
  executorId: string
  instanceId?: string
  port: number
  role: ExecutorLocalAccessCandidateRole
}

export interface ExecutorLocalAccessPlan {
  targetExecutorId?: string
  candidates: ExecutorLocalAccessCandidate[]
  expiresAt: string
}

export interface WorkerRuntimeSnapshot {
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
  mesh?: WorkerMeshStatus
  lastError?: string
  startedAt?: string
}

export interface WorkerDoctorItem {
  id: string
  category: 'tooling' | 'filesystem' | 'config' | 'network'
  label: string
  ok: boolean
  detail: string
  hint?: string
}

export interface WorkerDoctorSummary {
  total: number
  passed: number
  failed: number
  ok: boolean
}

export interface WorkerDoctorProbe {
  ok: boolean
  status?: number
  url?: string
  message: string
}

export interface WorkerDoctorChecks {
  git: boolean
  opencodeAvailable: boolean
  codexCliAvailable: boolean
  codexAuthenticated: boolean
  claudeCliAvailable: boolean
  claudeAuthenticated: boolean
  opencodeConfigLoaded: boolean
  codexConfigLoaded: boolean
  claudeConfigLoaded: boolean
  workerHomeWritable: boolean
  workspaceConfigured: boolean
  workspaceReady: boolean
  machineIdConfigured: boolean
  paired: boolean
  cloudUrlConfigured: boolean
  cloudReachable: boolean
  officialSiteReachable: boolean
}

export interface WorkerDoctorPayload {
  config?: WorkerConfig
  checks?: Partial<WorkerDoctorChecks>
  items?: WorkerDoctorItem[]
  summary?: WorkerDoctorSummary
  cloudProbe?: WorkerDoctorProbe
  officialSiteProbe?: WorkerDoctorProbe
  runtime?: WorkerRuntimeSnapshot
}

export interface ExecutorPairingCodeRecord {
  pairingCode: string
  ownerUserId: string
  teamId?: string
  workspaceIds?: string[]
  visibility: ExecutorVisibility
  previewExposureMode?: 'private' | 'public-ingress'
  label?: string
  createdAt: string
  expiresAt: string
  usedAt?: string
}

export interface TaskRuntimeGitIdentity {
  mode: 'personal'
  authMode?: GitAuthMode
  authSourceType?: GitAuthSourceType
  provider?: GitProvider
  host?: string
  userId?: string
  name?: string
  email?: string
  agentCoAuthorName?: string
  agentCoAuthorEmail?: string
  gitIdentityId?: string
  credentialId?: string
  githubInstallationId?: number
  githubRepositoryId?: number
  githubRepositoryName?: string
  githubAccountLogin?: string
  githubAccountType?: string
  credentialToken?: string
}

export interface WorkerConfig {
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
  claudeCodeCredentialsContent?: string
  piAgentDir?: string
  defaultModel?: string
  agentSettings: AgentSettings
  workerUpdateSettings?: WorkerUpdateSettings
  mcpServers?: OpenCodeExecutionConfig['mcpServers']
  runtimeSkillPackages?: ExecutorSkillPackage[]
  workspaceRoot: string
  maxConcurrency: number
  labels: string[]
  capabilities: string[]
  localServerPort: number
  previewExposureMode?: 'private' | 'public-ingress'
  previewIngressPort?: number
  previewProxySecret?: string
  meshEnrollment?: WorkerMeshEnrollmentConfig
  featureFlags?: import('../user-experimental-settings').ExecutorFeatureFlags
  projectBindings?: WorkerProjectBinding[]
}

export interface WorkerProjectBinding {
  projectId?: string
  repoUrl?: string
  localPath: string
}

export interface LocalPathProbeResult {
  ok: boolean
  path?: string
  name?: string
  versionControl?: ProjectVersionControl
  gitUrl?: string
  defaultBranch?: string
  message: string
}

export interface PatVerificationResult {
  ok: boolean
  provider?: GitProvider
  account?: string
  message: string
}

export interface SshVerificationResult {
  ok: boolean
  host: string
  sshUser: string
  repoUrl?: string
  message: string
}

export interface ExecutorDirectoryEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  sizeBytes?: number
}

export interface ExecutorDirectoryBrowseResult {
  ok: boolean
  path: string
  rootPath: string
  parentPath?: string
  entries: ExecutorDirectoryEntry[]
  message?: string
}

export interface ExecutorFileReadResult {
  ok: boolean
  path: string
  rootPath: string
  content?: string
  contentType?: string
  encoding?: 'utf8' | 'base64'
  sizeBytes?: number
  truncated?: boolean
  message?: string
}

export interface ExecutorFileWriteResult {
  ok: boolean
  path: string
  rootPath: string
  sizeBytes?: number
  message?: string
}

export type AgentWorkdirStatus = 'ready' | 'missing' | 'error'

export interface ExecutorAgentWorkdirFileEntry {
  path: string
  type: 'file' | 'directory'
  sizeBytes: number
  modifiedAt: string
  sha256?: string
}

export interface ExecutorAgentWorkdirSummary {
  agentId: string
  rootPath: string
  workDirPath: string
  systemPath: string
  status: AgentWorkdirStatus
  totalFiles: number
  totalDirectories: number
  totalSizeBytes: number
  lastUsedAt?: string
  lastSessionId?: string
  lastScannedAt?: string
  manifestVersion: number
  snapshotVersion: number
}

export interface ExecutorAgentWorkdirResult {
  ok: boolean
  workdir: ExecutorAgentWorkdirSummary
  files: ExecutorAgentWorkdirFileEntry[]
  message?: string
}

export interface ExecutorAgentWorkdirDownloadResult {
  ok: boolean
  relativePath: string
  filename?: string
  contentBase64?: string
  message?: string
}

export interface ExecutorAgentWorkdirReadResult {
  ok: boolean
  relativePath: string
  content?: string
  sizeBytes?: number
  truncated?: boolean
  message?: string
}

export type ExecutorAgentSessionSource = 'claude' | 'opencode' | 'codex' | 'pi'

export interface ExecutorAgentSessionSummary {
  id: string
  source: ExecutorAgentSessionSource
  title: string
  cwd: string
  startedAt?: string
  lastUpdatedAt: string
  entryCount: number
}

export interface ExecutorAgentSessionEntry {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  timestamp?: string
}

export interface ExecutorAgentSessionDetail extends ExecutorAgentSessionSummary {
  entries: ExecutorAgentSessionEntry[]
}

export interface ExecutorAgentSessionsResult {
  ok: boolean
  sessions: ExecutorAgentSessionSummary[]
  counts: Record<ExecutorAgentSessionSource, number>
  message?: string
}

export interface ExecutorAgentSessionReadResult {
  ok: boolean
  session?: ExecutorAgentSessionDetail
  message?: string
}

export interface ExecutorSkillPackage {
  name: string
  slug: string
  description: string | null
  markdown: string
  sourceLocator: string
  trustLevel: SkillTrustLevel
  fileInventory: SkillFileInventoryEntry[]
  files: Record<string, SkillFileContent>
}

export type ExecutorSkillScanMode = 'project' | 'global'

export interface ExecutorSkillScanResult {
  ok: boolean
  scanMode: ExecutorSkillScanMode
  rootPath: string
  scannedRoots: string[]
  packages: ExecutorSkillPackage[]
  warnings: string[]
  message?: string
}

export type RepoBranchSource = 'remote' | 'local-only'

export interface RepoBranchSnapshotResult {
  ok: boolean
  branches: string[]
  defaultBranch: string
  currentBranch?: string
  versionControl?: ProjectVersionControl
  /** 按分支名标注来源：remote=已推送在线分支；local-only=仅本地存在（未推送）。 */
  branchSources?: Record<string, RepoBranchSource>
  message?: string
}

export interface ExecutorWorktreeResult {
  ok: boolean
  message: string
  worktreePath?: string
  currentBranch?: string
  deletedLocalBranch?: string
  deletedRemoteBranch?: string
}

export interface ExecutorWorkspaceOperationEvent {
  phase: string
  message: string
  at: string
}

export interface ExecutorAgentPromptResult extends AgentPromptResultBase {
  abortReason?: ExecutorAgentPromptAbortReason
}

export type ExecutorAgentPromptAbortReason =
  | 'user_stop'
  | 'server_abort'
  | 'server_timeout'
  | 'executor_disconnected'
  | 'executor_reconnect'
  | 'control_plane_disconnect'
  | 'unknown'

export interface ExecutorAgentPromptEvent {
  agentType: AgentType
  type:
    | 'session.status'
    | 'message.updated'
    | 'message.part.updated'
    | 'message.part.delta'
    | 'interaction.pending'
    | 'permission.updated'
    | 'session.error'
    | 'session.idle'
  properties: Record<string, unknown>
}

export interface ExecutorPairRequest {
  pairingCode: string
  machineId: string
  machineName: string
  name: string
  workspaceRoot: string
  maxConcurrency: number
  labels: string[]
  capabilities: string[]
  platform?: string
  version?: string
}

export interface ExecutorPairResponse {
  executorId: string
  executorToken: string
  executor: ExecutorDescriptor
}

export interface ExecutorConnectionRouteResponse {
  assignedCloudUrl: string
  assignedLabels: string[]
  managedRoutingLabels: string[]
  countryCode?: string
  continentCode?: string
  matchedRouteId?: string
  candidates?: ExecutorConnectionRouteCandidate[]
}

export interface ExecutorConnectionRouteCandidate {
  id: string
  cloudUrl: string
  labels: string[]
}

export type ExecutorTerminalRequestMode = 'wait' | 'background'

export interface ExecutorTerminalResult {
  command: string
  cwd?: string
  stdout: string
  stderr: string
  exitCode: number
  mode?: ExecutorTerminalRequestMode
  detached?: boolean
  pid?: number
  at: string
}

export interface ExecutorHttpProbeResult {
  ok: boolean
  reachable: boolean
  url: string
  statusCode?: number
  finalUrl?: string
  error?: string
  responseTimeMs?: number
  at: string
}

export interface ExecutorTerminalSessionOutput {
  terminalId: string
  terminalKey: string
  clientId?: string
  stream: 'stdout' | 'stderr' | 'system'
  chunk: string
  at: string
}

export interface ExecutorTerminalSessionsResult {
  ok: boolean
  sessions: WorkspaceTerminalSessionDescriptor[]
  message?: string
}

export interface ExecutorTerminalSessionCreateResult {
  ok: boolean
  session?: WorkspaceTerminalSessionDescriptor
  sessions?: WorkspaceTerminalSessionDescriptor[]
  created: boolean
  message?: string
}

export interface ExecutorTerminalSessionAttachResult {
  ok: boolean
  session?: WorkspaceTerminalSessionDescriptor
  snapshot?: WorkspaceTerminalSessionSnapshot
  message?: string
}

export interface ExecutorTerminalLocalAttachTicketResult {
  ok: boolean
  ticket?: string
  expiresAt?: string
  wsUrl?: string
  transport?: 'local-direct' | 'mesh-direct' | 'mesh-relayed' | 'terminal-public-gateway'
  message?: string
}

export interface ExecutorTerminalSessionCloseResult {
  ok: boolean
  closed: boolean
  session?: WorkspaceTerminalSessionDescriptor
  sessions?: WorkspaceTerminalSessionDescriptor[]
  message?: string
}
