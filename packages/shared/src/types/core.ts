import type { AgentType, RuntimeId } from '../agent-type'
import type { McpServerPolicy } from '../mcp'

export type { AgentType, RuntimeId } from '../agent-type'

export type AgentManaged = 'ai' | 'none'

export type ExecutorVisibility = 'private' | 'team'
export type ExecutorSource = 'customer-worker' | 'managed-cloud'
export type ExecutorManagedBy = 'user' | 'vibemux'
export type ExecutorRuntimeClass = 'user-worker' | 'managed-worker'
export type ExecutorBillingClass = 'standard' | 'managed'

export type TaskGitIdentityMode = 'personal'
export type GitAuthMode = 'pat' | 'ssh' | 'github-app'
export type GitAuthSourceType = 'user-credential' | 'github-app-installation'
export type GitProvider = 'github' | 'gitlab' | 'generic'
export type WorkspacePublishPolicy = 'none' | 'push-branch' | 'pull-request'
export type WorkspaceGitAuthPreference = 'project-default' | 'github-app' | 'credential'

export interface OpenCodeExecutionConfig {
  model?: string
  agent?: string
  variant?: string
  permissionPolicy?: string
  env?: Record<string, string>
  provider?: Record<string, Record<string, unknown> & {
    models?: Record<string, Record<string, unknown>>
    options?: {
      baseURL?: string
      apiKey?: string
      [key: string]: unknown
    }
  }>
  mcpServers?: McpServerPolicy[]
}

export type ExecutorConnectionStatus = 'pairing' | 'paired' | 'online' | 'offline' | 'disabled'

export type NodeStatus = 'online' | 'busy' | 'offline' | 'maintenance'

export type TaskExecutionMode = 'local' | 'remote' | 'auto'

export type DistributedTaskStatus =
  | 'draft'
  | 'queued'
  | 'assigned'
  | 'preparing'
  | 'executing'
  | 'syncing_back'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'timed_out'
  | 'lost'

export type DistributedReturnMode = 'summary' | 'branch' | 'commit'

export type SyncBackStrategy = 'none' | 'pull-branch'

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled'

export type AgentRunningStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'complete' | 'error'

export type WorkspaceSessionRuntimeStatus = 'idle' | 'queued' | 'running' | 'waiting' | 'completed' | 'error' | 'lost' | 'cancelled'

export type OrchestrationStepStatus = 'pending' | 'running' | 'done'

export type WorktreeStatus = 'planned' | 'created' | 'cleaned'
export type WorkingDirectoryMode = 'worktree' | 'original-dir'

export type AdapterStatus = 'online' | 'degraded' | 'offline'

export type ProjectVersionControl = 'none' | 'git-local' | 'git-remote'

export interface ToolCall {
  id: string
  name: string
  args: string
  result?: string
  startedAt: string
  finishedAt?: string
  workspaceId?: string
  metadata?: {
    resultPreviewKind?: 'task_created'
    resultPreviewTaskId?: string
  }
}

export interface AgentAdapter {
  id: AgentType
  name: AgentType
  runtimeId: RuntimeId
  transport: 'STDIO' | 'SDK' | 'RPC'
  status: AdapterStatus
  heartbeatAt: string
  strengths: string[]
  limitations: string[]
}

export interface ExecutionModelOption {
  id: string
  label: string
  providerId: string
  modelId: string
  baseUrl?: string
  isDefault?: boolean
  source?: 'catalog' | 'runtime' | 'bundled' | 'hosted'
  profileId?: string
  profileName?: string
}

export type ModelProfileVisibility = 'private' | 'team' | 'workspace'
export type ModelProfileSource = 'manual' | 'worker-import' | 'hosted'
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface CollaborationWorkspace {
  id: string
  name: string
  description?: string
  avatarUrl?: string
  ownerUserId: string
  legacyTeamId?: string
  activeExecutorNodeId?: string
  /** 调度大脑（feature）：协作空间级开关/Agent/行为提示词 */
  brainEnabled?: boolean
  brainAgentId?: string
  brainInstructions?: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  workspaceId: string
  userId: string
  role: WorkspaceRole
}

export type LegacyTeam = CollaborationWorkspace

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type CodexApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never'
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type CodexReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none'
export type ClaudeCodePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'
export type WorkerUpdateExitMode = 'manual' | 'auto'

export interface OpenCodeAgentSettings {
  _runtime: 'OpenCode'
  defaultModel: string
  agent: string
  permissionPolicy: string
}

export interface CodexAgentSettings {
  _runtime: 'Codex'
  defaultModel: string
  sandbox: CodexSandboxMode
  approval: CodexApprovalMode
  reasoningEffort: CodexReasoningEffort
  reasoningSummary: CodexReasoningSummary
}

export interface ClaudeCodeAgentSettings {
  _runtime: 'ClaudeCode'
  defaultModel: string
  permissionMode: ClaudeCodePermissionMode
  planMode: boolean
}

export interface PiAgentSettings {
  _runtime: 'Pi'
  defaultModel: string
  agentDir?: string
}

export interface WorkerUpdateSettings {
  exitMode: WorkerUpdateExitMode
}

export interface AgentSettings {
  OpenCode: OpenCodeAgentSettings
  Codex: CodexAgentSettings
  ClaudeCode: ClaudeCodeAgentSettings
  Pi: PiAgentSettings
}

/** @deprecated Use AgentSettings directly. Kept for backward compatibility. */
export type RuntimeSettingsById<T extends RuntimeId = RuntimeId> = AgentSettings[T]

export type AgentRuntimeSettings =
  | OpenCodeAgentSettings
  | CodexAgentSettings
  | ClaudeCodeAgentSettings
  | PiAgentSettings

export type ModelProfileRuntimeSettings =
  | Partial<OpenCodeAgentSettings>
  | Partial<CodexAgentSettings>
  | Partial<ClaudeCodeAgentSettings>
  | Partial<PiAgentSettings>

export interface ModelProfileBinding {
  id: string
  agentType: AgentType
  providerId: string
  modelId: string
  label: string
  baseUrl?: string
  apiToken?: string
  hasApiToken?: boolean
  clearApiToken?: boolean
  isDefault?: boolean
  runtimeSettings?: ModelProfileRuntimeSettings
}

export interface ResolvedModelImportBinding {
  providerId: string
  modelId: string
  label: string
  baseUrl?: string
  apiToken?: string
  runtimeSettings?: ModelProfileRuntimeSettings
}

export interface ModelProfile {
  id: string
  name: string
  description?: string
  visibility: ModelProfileVisibility
  ownerUserId: string
  teamId?: string
  workspaceId?: string
  source: ModelProfileSource
  sourceExecutorId?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  bindings: ModelProfileBinding[]
}

export interface ExecutionCenter {
  activeTaskId: string
  queuedTaskIds: string[]
  lastReviewAt: string
}

export interface StatusHistoryEntry {
  id: string
  label: string
  at: string
  kind?: 'status' | 'assignment'
  actor?: TaskHistoryIdentity
  assignee?: TaskHistoryIdentity
}

export interface TaskHistoryIdentity {
  type: 'user' | 'agent' | 'system'
  id?: string
  name: string
  avatarUrl?: string
}

export interface OrchestrationStep {
  id: string
  key: 'understand' | 'worktree' | 'select_agent' | 'dispatch' | 'verify' | 'handoff'
  title: string
  detail: string
  status: OrchestrationStepStatus
}

export interface ValidationCheck {
  id: string
  label: string
  passed: boolean
}

export interface ExecutionLog {
  id: string
  role: 'system' | 'user' | 'agent' | 'review'
  content: string
  createdAt: string
  launchId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

export interface ConversationHandoffEntry {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface ConversationHandoffSnapshot {
  updatedAt: string
  messageCount: number
  latestUserMessage?: string
  latestAssistantMessage?: string
  summaryLines: string[]
  recentMessages: ConversationHandoffEntry[]
}

export interface MainChatRuntimeContinuation {
  runtimeId: RuntimeId
  scopeKey: string
  nativeSessionId: string
  executorId?: string
  customAgentId?: string
  executionModel?: string
  cwdHash?: string
  updatedAt: string
}

export type ExecutionEventType =
  | 'task.assign'
  | 'task.ack'
  | 'task.event'
  | 'task.result'
  | 'heartbeat'
  | 'reconnect'
  | 'disconnect'
  | 'error'

export type ExecutionEventSeverity = 'normal' | 'state_change' | 'error' | 'connection'

export type ExecutionEventLayer = 'pairing' | 'connection' | 'repo_prepare' | 'opencode' | 'git' | 'sync_back' | 'unknown'

export interface ExecutionEventLogRecord {
  id: string
  occurredAt: string
  eventType: ExecutionEventType
  severity: ExecutionEventSeverity
  isFailure: boolean
  message: string
  payloadSummary: string
  rawPayload?: Record<string, unknown>
  executorId?: string
  executorName?: string
  taskId?: string
  originTaskId?: string
  projectId?: string
  layer?: ExecutionEventLayer
}

export interface ExecutionEventCursor {
  occurredAt: string
  id: string
}

export interface ClusterNode {
  nodeId: string
  name: string
  url?: string
  relayUrl?: string
  status: NodeStatus
  capabilities: string[]
  activeTasks: number
  maxConcurrentTasks: number
  region?: string
  hasProjectBinding?: boolean
  lastHeartbeatAt: string
  version?: string
}
