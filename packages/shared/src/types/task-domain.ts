/**
 * [INPUT]: Shared task, workspace, execution, conversation, and delivery primitives.
 * [OUTPUT]: Cross-app task-domain records and contracts, including creator identity, comment collaboration, task subscribers, and assistant message finish reasons.
 * [POS]: Pure shared type boundary; must not depend on web, server storage, or worker side effects.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { McpServerPolicy } from '../mcp'
import type { TaskChatAttachment } from '../task-chat-attachment'
import type { MessageReaction } from '../thread-message'
import type { TaskCommentReactionEmoji } from '../task-comment-reaction'
import type { WorkspaceResourceVisibility } from '../workspace-scope'
import type { RuntimeEnvironmentExecutionPayload } from '../runtime-environment'
import type { WorkspaceDeliverySummary } from '../workspace-delivery'
import type { WorkspaceSessionHistoryProjection } from '../workspace-session-history'
import type { WorkspaceRuntimeSummary, WorkspaceSessionRuntimeSummary } from '../workspace-runtime'
import type { AgentType } from '../agent-type'

import type {
  AgentManaged,
  AgentRunningStatus,
  AgentRuntimeSettings,
  ConversationHandoffSnapshot,
  DistributedReturnMode,
  DistributedTaskStatus,
  ExecutionLog,
  MainChatRuntimeContinuation,
  OpenCodeExecutionConfig,
  OrchestrationStep,
  ProjectVersionControl,
  StatusHistoryEntry,
  SyncBackStrategy,
  TaskExecutionMode,
  TaskGitIdentityMode,
  TaskStatus,
  WorkspaceGitAuthPreference,
  WorkspacePublishPolicy,
  WorkspaceSessionRuntimeStatus,
  ToolCall,
  ValidationCheck,
  WorkingDirectoryMode,
  WorktreeStatus,
} from './core'
import type { TaskGitChangeSummary } from '../task-git-ops'
import type { AgentWorkdirStatus, ExecutorSkillPackage, TaskRuntimeGitIdentity } from './executor'

export type TaskAgentRetrySessionMode = 'resume' | 'fresh'

export type AgentTaskRunStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'

export type AgentTaskRunFailureCode =
  | 'canceled'
  | 'context_poisoned'
  | 'delivery_missing'
  | 'infrastructure_interrupted'
  | 'infrastructure_unavailable'
  | 'execution_failed'

export interface AgentTaskRunRecord {
  id: string
  agentTaskId: string
  eventId: string
  agentId: string
  taskId?: string
  projectId?: string
  conversationSessionId?: string
  attempt: number
  retrySource: 'initial' | 'manual' | 'infrastructure'
  retrySessionMode?: TaskAgentRetrySessionMode
  status: AgentTaskRunStatus
  failureCode?: AgentTaskRunFailureCode
  failureMessage?: string
  transcript: ChatMessage[]
  usage?: ModelTokenUsage
  startedAt?: string
  completedAt?: string
  lastHeartbeatAt?: string
  createdAt: string
  updatedAt: string
}

export type AgentRecord = {
  id: string
  name: string
  type: string
  status: 'online' | 'offline' | 'error'
  endpoint: string | null
  config: Record<string, unknown>
  ownerUserId?: string
  createdAt: string
  updatedAt: string
  lastHeartbeatAt: string | null
  workDir: string
  workDirStatus: AgentWorkdirStatus
}

export type CreatorIdentity = {
  type: 'user' | 'agent'
  id: string
  name: string
  avatarUrl?: string
}

export type TaskOriginType = 'agent_quick_create'

export interface ProjectBinding {
  projectId: string
  nodeId: string
  repoUrl: string
  defaultBranch: string
  pathHint?: string
  mode?: 'auto' | 'manual'
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProjectCommandPreset {
  id: string
  name: string
  installCommand?: string
  buildCommand?: string
  testCommand?: string
  lintCommand?: string
  branchNamePattern?: string
}

export interface ProjectEnvironmentTemplateFields {
  installCommand?: string
  buildCommand?: string
  testCommand?: string
  lintCommand?: string
  branchNamePattern?: string
  startCommandTemplate?: string
  stopCommandTemplate?: string
  nukeCommandTemplate?: string
  appPort?: string
  healthPath?: string
  logsCommandTemplate?: string
  ports?: ProjectEnvironmentPort[]
  previewDomainBindings?: PreviewDomainBinding[]
}

export interface ImportedProjectEnvironmentTemplate extends ProjectEnvironmentTemplateFields {
  configPath?: string
}

export type PreviewDomainBindingType = 'generated' | 'custom'

export interface PreviewDomainBinding {
  id: string
  domain?: string
  port: number
  note?: string
  type?: PreviewDomainBindingType
}

export interface ProjectEnvironmentPort {
  id: string
  port: string
  note?: string
  domain?: string
  type?: PreviewDomainBindingType
}

export type ProjectEnvironmentTemplateSource = 'manual' | 'vibemux-yml'

export interface ProjectEnvironmentTemplate extends ProjectEnvironmentTemplateFields {
  configPath?: string
  source: ProjectEnvironmentTemplateSource
  imported?: ImportedProjectEnvironmentTemplate
}

export interface TaskBranchDelivery {
  branchName: string
  repoUrl: string
  baseBranch: string
  pushed: boolean
  suggestedNextStep: string
  reason?: string
}

export interface TaskPullRequestPrep {
  ready: boolean
  remoteReady: boolean
  repoUrl: string
  title?: string
  description?: string
  baseBranch: string
  compareBranch?: string
  number?: number
  url?: string
  state?: string
  reason?: string
}

export interface TaskResultDelivery {
  mode: DistributedReturnMode
  branch?: TaskBranchDelivery
  pullRequest?: TaskPullRequestPrep
  syncFailureReason?: string
}

export interface ModelTokenUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens: number
}

export interface TaskExecutionResult {
  taskId: string
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out'
  returnMode: DistributedReturnMode
  summary: string
  output?: string
  filesChanged: string[]
  changeSummary?: TaskGitChangeSummary
  remoteBranchName?: string
  commitShas?: string[]
  startedAt: string
  completedAt: string
  durationSec: number
  executorNodeId: string
  workspaceId?: string
  workspaceSessionId?: string
  agentSessionId?: string
  opencodeSessionId?: string
  usage?: ModelTokenUsage
  delivery?: TaskResultDelivery
}

export interface TaskExecutionRun {
  id: string
  distributedTaskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  executorNodeId?: string
  baseBranch?: string
  returnMode?: DistributedReturnMode
  gitIdentityMode?: TaskGitIdentityMode
  agentSessionId?: string
  opencodeSessionId?: string
  status: 'planned' | 'draft' | 'queued' | 'assigned' | 'preparing' | 'executing' | 'syncing_back' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'lost'
  summary?: string
  executionModel?: string
  usage?: ModelTokenUsage
  result?: TaskExecutionResult
  createdAt: string
  updatedAt: string
}

export interface TaskDraftState {
  acceptanceCriteria?: string
  draftId?: string
  draftSavedAt?: string
  recommendedTitle?: string
  baseBranchHint?: string
  requirementType?: 'task' | 'requirement'
}

export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'
export type TaskDifficulty = 'easy' | 'medium' | 'hard'

export interface TaskAssignmentState {
  status: TaskStatus
  assigneeId?: string
  assigneeAgentId?: string
  assigneeAgentGroupId?: string
  priority: TaskPriority
  retryCount: number
  createdAt: string
  startedAt?: string
  dueAt?: string
  updatedAt: string
}

export interface TaskExecutionBinding {
  agentType: AgentType
  executionModel?: string
  opencodeConfig?: OpenCodeExecutionConfig
  executionMode: TaskExecutionMode
  gitIdentityMode?: TaskGitIdentityMode
  agentManaged: AgentManaged
  baseBranch?: string
}

export interface TaskRuntimeState {
  needsHumanConfirm: boolean
  agentRunningStatus: AgentRunningStatus
  currentStep: string
}

export interface TaskExecutionHistoryView {
  executionHistory: TaskExecutionRun[]
}

export interface TaskCollaborationState {
  comments: TaskComment[]
  subscriberIds?: string[]
  toolCalls: ToolCall[]
  logs: ExecutionLog[]
  history: StatusHistoryEntry[]
  orchestration: OrchestrationStep[]
  validationChecks: ValidationCheck[]
}

export interface TaskCommentMention {
  targetType: 'user' | 'agent' | 'all' | 'agent_group'
  targetId: string
  targetName: string
}

export interface TaskCommentDispatchOutcome extends TaskCommentMention {
  status: 'mentioned' | 'queued' | 'coalesced' | 'deduplicated' | 'blocked'
  eventId?: string
  message?: string
}

export interface TaskComment {
  id: string
  authorType?: 'user' | 'agent' | 'system'
  authorId?: string
  authorName?: string
  authorAvatarUrl?: string
  parentCommentId?: string
  mentions?: TaskCommentMention[]
  reactions?: TaskCommentReaction[]
  attachments?: TaskChatAttachment[]
  idempotencyKey?: string
  content: string
  createdAt: string
  editedAt?: string
  deletedAt?: string
  resolvedAt?: string
  resolvedByUserId?: string
}

export interface TaskCommentReaction {
  emoji: TaskCommentReactionEmoji
  userIds: string[]
}

export interface TaskCommentNotification {
  kind: 'task_comment'
  id: string
  userId: string
  projectId: string
  taskId: string
  taskTitle: string
  commentId: string
  comment: string
  actorType: 'user' | 'agent' | 'system'
  actorId?: string
  actorName: string
  readAt?: string
  createdAt: string
}

export interface WorkspaceGroupChatMentionNotification {
  kind: 'workspace_group_chat'
  id: string
  userId: string
  workspaceId: string
  groupId: string
  groupTitle: string
  sessionId: string
  messageId: string
  message: string
  actorType: 'user' | 'agent' | 'system'
  actorId?: string
  actorName: string
  readAt?: string
  createdAt: string
}

export type UserMentionNotification = TaskCommentNotification | WorkspaceGroupChatMentionNotification

export interface TaskRun extends TaskExecutionRun {
  taskId: string
  projectId: string
}

export interface TaskRecord extends TaskDraftState, TaskAssignmentState, TaskExecutionBinding, TaskRuntimeState {
  id: string
  projectId: string
  parentTaskId?: string
  createdBy?: CreatorIdentity
  originType?: TaskOriginType
  originId?: string
  title: string
  description: string
  /** 任务级附件（R8.5）：Drive 引用附件列表。 */
  attachments?: TaskChatAttachment[]
  /** 任务级表情反应（R8.5）：自由 emoji。 */
  reactions?: MessageReaction[]
  /** 完成时间（R8.5）：status 流转到 done 时落时间戳。 */
  completedAt?: string
  result?: TaskExecutionResult
}

export interface TaskView extends TaskRecord, TaskCollaborationState, TaskExecutionHistoryView {}

export type Task = TaskView

export interface WorkspaceRecord {
  id: string
  projectId: string
  createdBy?: CreatorIdentity
  displayOrder?: number
  executorNodeId: string
  agentType: Task['agentType']
  name: string
  status: 'ready' | 'pending_repo' | 'missing_repo' | 'archived'
  repoReady: boolean
  repoPath?: string
  worktreeRootPath?: string
  source: 'binding' | 'workspace-root' | 'manual'
  workingDirectoryMode: WorkingDirectoryMode
  autoCommitEnabled?: boolean
  versionControl?: ProjectVersionControl
  defaultBranch?: string
  suggestedBaseBranch?: string
  codeBaseBranch?: string
  codeBranchName?: string
  codeRemoteHeadSha?: string
  codeSyncedAt?: string
  ownerUserId?: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceLocalWorktree {
  id: string
  workspaceId: string
  executorNodeId: string
  codeBaseBranch?: string
  codeBranchName: string
  workingDirectoryMode: WorkingDirectoryMode
  localPath?: string
  worktreeId?: string
  worktreeUniqueId?: number
  status: WorktreeStatus
  sourceWorkspaceSessionId?: string
  updatedAt: string
  createdAt: string
}

export interface WorkspaceViewState {
  executorName: string
  executorStatus: 'online' | 'paired' | 'offline' | 'error'
  runtimeSummary?: WorkspaceRuntimeSummary
  deliverySummary?: WorkspaceDeliverySummary
  ownerUserName?: string
  ownerAvatarUrl?: string
}

export interface WorkspaceView extends WorkspaceRecord, WorkspaceViewState {}

export type Workspace = WorkspaceView

export type WorkspacePresenceState = 'viewing' | 'working'

export interface WorkspacePresenceUser {
  workspaceId: string
  userId: string
  name: string
  avatarUrl?: string
  state: WorkspacePresenceState
  lastSeenAt: string
  activeWorkspaceSessionId?: string
}

export interface TaskWorkspaceBinding {
  id: string
  taskId: string
  workspaceId: string
  status: 'active' | 'detached' | 'archived'
  createdAt: string
  updatedAt: string
}

export type WorkspaceSessionAgentInvocationMode = 'mention' | 'delegate'
export type WorkspaceSessionKind = 'primary' | 'subagent'
export type WorkspaceSessionRole = 'general' | 'tester' | 'doc-writer' | 'reviewer' | 'researcher'
export type WorkspaceSessionTitleOrigin = 'system' | 'ai' | 'manual'
export type WorkspaceSessionOrigin = 'manual' | 'delegate' | 'fork'
export type WorkspaceSessionForkMode = 'local' | 'worktree'
export type WorkspaceSessionRevisionKind = 'rewrite-user-turn' | 'retry-assistant-turn'

export interface WorkspaceSessionPendingRevision {
  kind: WorkspaceSessionRevisionKind
  sourceTurnId?: string
  sourceUserMessageId: string
  sourceAssistantMessageId?: string
}

export interface WorkspaceSessionForkRevision extends WorkspaceSessionPendingRevision {}

export interface WorkspaceSession {
  id: string
  workspaceId: string
  displayOrder?: number
  pinnedAt?: string
  title: string
  titleOrigin: WorkspaceSessionTitleOrigin
  status: 'active' | 'archived'
  sessionKind: WorkspaceSessionKind
  sessionRole: WorkspaceSessionRole
  sessionOrigin: WorkspaceSessionOrigin
  parentSessionId?: string
  rootSessionId?: string
  forkMode?: WorkspaceSessionForkMode
  forkedFromSessionId?: string
  forkedFromMessageId?: string
  forkRevision?: WorkspaceSessionForkRevision
  pendingRevision?: WorkspaceSessionPendingRevision
  sharedWorktreeSourceSessionId?: string
  executorNodeId?: string
  agentType?: Task['agentType']
  customAgentId?: string
  customAgentName?: string
  agentInvocationMode?: WorkspaceSessionAgentInvocationMode
  mountedSkillNames?: string[]
  mountedMcpServerNames?: string[]
  enabledMcpServerIds?: string[]
  delegatedPrompt?: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  opencodeConfig?: OpenCodeExecutionConfig
  gitIdentityMode?: TaskGitIdentityMode
  publishPolicy?: WorkspacePublishPolicy
  gitAuthPreference?: WorkspaceGitAuthPreference
  distributedTaskId?: string
  agentSessionId?: string
  opencodeSessionId?: string
  runtimeContinuations?: MainChatRuntimeContinuation[]
  handoffSnapshot?: ConversationHandoffSnapshot
  baseBranch?: string
  worktreeId: string
  worktreeUniqueId?: number
  branchName: string
  worktreeStatus: WorktreeStatus
  workingDirectoryMode: WorkingDirectoryMode
  needsHumanConfirm: boolean
  agentRunningStatus: AgentRunningStatus
  runtimeStatus: WorkspaceSessionRuntimeStatus
  runtimeSessionId?: string
  runtimeOwnerExecutorId?: string
  runtimeStartedAt?: string
  lastHeartbeatAt?: string
  lastRuntimeEventAt?: string
  terminalReason?: string
  runtimeSummary?: WorkspaceSessionRuntimeSummary
  runtimeSequence: number
  currentStep: string
  deliverySummary?: WorkspaceDeliverySummary
  historyProjection?: WorkspaceSessionHistoryProjection
  lastActiveAt: string
  createdAt: string
  updatedAt: string
}

export interface DistributedTask {
  id: string
  originTaskId: string
  originTaskRunId?: string
  workspaceId?: string
  workspaceSessionId?: string
  workspaceBranchName?: string
  projectId: string
  rootPath?: string
  versionControl?: ProjectVersionControl
  requestedByUserId?: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  agentType: Task['agentType']
  agentSettings?: AgentRuntimeSettings
  mcpServers?: OpenCodeExecutionConfig['mcpServers']
  runtimeSkillPackages?: ExecutorSkillPackage[]
  runtimeEnv?: Record<string, string>
  executionModel?: string
  opencodeConfig?: OpenCodeExecutionConfig
  workingDirectoryMode?: WorkingDirectoryMode
  autoCommitEnabled?: boolean
  repoUrl: string
  defaultBranch: string
  baseCommit: string
  description: string
  commandPreset?: ProjectCommandPreset
  status: DistributedTaskStatus
  priority: 'none' | 'low' | 'medium' | 'high'
  timeoutSec: number
  originNodeId: string
  executorNodeId?: string
  returnMode: DistributedReturnMode
  syncBackStrategy: SyncBackStrategy
  gitIdentityMode?: TaskGitIdentityMode
  publishPolicy?: WorkspacePublishPolicy
  gitAuthPreference?: WorkspaceGitAuthPreference
  gitIdentity?: TaskRuntimeGitIdentity
  idempotencyKey: string
  workerEventSequence?: number
  retryCount: number
  leaseExpiresAt?: string
  startedAt?: string
  completedAt?: string
  errorMessage?: string
  result?: TaskExecutionResult
  createdAt: string
  updatedAt: string
}

export interface DistributedTaskRuntimeEnvironment {
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
}

export interface Project {
  id: string
  name: string
  displayOrder?: number
  color?: string | null
  workspaceId?: string
  visibility?: WorkspaceResourceVisibility
  rootPath?: string
  versionControl?: ProjectVersionControl
  gitUrl: string
  defaultBranch?: string
  preferredExecutorId?: string
  repositoryCloneStatus?: 'cloning' | 'failed'
  repositoryCloneMessage?: string
  environmentTemplate?: ProjectEnvironmentTemplate
  recentBaseBranches?: string[]
  createdById?: string
  createdByName?: string
  createdByAvatarUrl?: string
  createdAt: string
  updatedAt: string
}

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer'
export type TeamInvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired'

export type Team = {
  id: string
  name: string
  description?: string
  avatarUrl?: string
  createdAt: string
  updatedAt: string
}

export type TeamInvitation = {
  id: string
  teamId: string
  email: string
  role: TeamRole
  status: TeamInvitationStatus
  token: string
  expiresAt: string
  createdAt: string
}

/** 'main' 承载主对话(/chat 与 Agent 页面)迁入统一会话模型后的 Thread。 */
export type ConversationKind = 'workspace' | 'project' | 'task' | 'dm' | 'external-thread' | 'main' | 'feedback'
export type ConversationChatMode = 'direct' | 'group'
export type ConversationStatus = 'active' | 'archived'
export type ConversationExternalSyncMode = 'internal' | 'mirror' | 'bidirectional'
export type ConversationMessageContentType = 'text' | 'markdown' | 'json'

export type ConversationRecord = {
  id: string
  workspaceId?: string
  workspaceSessionId?: string
  projectId?: string
  taskId?: string
  groupId?: string
  title: string
  kind: ConversationKind
  chatMode: ConversationChatMode
  status: ConversationStatus
  externalSyncMode: ConversationExternalSyncMode
  orchestratorAgentId?: string
  executorId?: string
  createdBy?: string
  /** 会话可见性：public 时工作区成员可访问；private 时仅成员与显式分享可访问。 */
  visibility?: 'public' | 'private'
  /** 群简介（仅组织群聊的群级 conversation 使用）。 */
  description?: string
  /** 群公告正文（置顶展示；仅组织群聊的群级 conversation 使用）。 */
  announcement?: string
  /** 群公告最后更新时间。 */
  announcementUpdatedAt?: string
  /** 群公告最后更新人 userId。 */
  announcementUpdatedBy?: string
  /** 会话置顶时间（DM / 群聊子会话可置顶；清除时为 null 保证序列化后可识别）。 */
  pinnedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type ConversationMessageRecord = {
  id: string
  conversationId: string
  /** sender_type 删除后以 role 为唯一真相；channel-bot 归为 'system'。 */
  role: 'user' | 'assistant' | 'system' | 'tool'
  senderId?: string
  /** 发送者显示名（反馈/客服场景的创始人署名等）。 */
  authorName?: string
  content: string
  contentType: ConversationMessageContentType
  replyToMessageId?: string
  externalRef?: Record<string, unknown>
  /** 消息级 reactions（表情回复/点赞），真相在 messages.reactions_json。 */
  reactions?: MessageReaction[]
  createdAt: string
}

export interface TeamActivity {
  id: string
  teamId: string
  userId?: string
  action: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface TaskProposal {
  id: string
  projectId: string
  title: string
  description: string
  difficulty: TaskDifficulty
  agentManaged: Task['agentManaged']
  agentType: Task['agentType']
  executionModel?: string
  opencodeConfig?: OpenCodeExecutionConfig
}

/**
 * 一条 assistant 消息为何结束。
 * 缺省（undefined）表示「仍在生成中或未记录」，因此渲染层判断「是否片段」必须
 * 以显式值为准，不能把 undefined 当成完整回答。
 * 与 ExecutorAgentPromptAbortReason 是两个层级：后者只描述中止原因，无法表达
 * end_turn / max_tokens / tool_use 这类正常收尾。
 */
export type MessageFinishReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'aborted' | 'error'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  authorType?: 'user' | 'agent' | 'system'
  authorId?: string
  authorName?: string
  attachments?: TaskChatAttachment[]
  taskProposal?: TaskProposal
  agentRunningStatus?: AgentRunningStatus
  currentStep?: string
  reasoning?: string[]
  toolCalls?: ToolCall[]
  usage?: ModelTokenUsage
  /** 结束原因。'aborted' 的消息内容是片段，UI 需要显式标注而不是伪装成完整回答。 */
  finishReason?: MessageFinishReason
  /** 客户端发送时生成的关联 id，回填自 `clientMessageId`，用于替代乐观消息位置匹配。 */
  externalRef?: {
    clientMessageId?: string
    /** 用户消息里 @ 引用的 Drive 文档（mentionedType='doc' / mentionScope='reference_doc'）。 */
    referencedDocs?: Array<{ id: string; name: string; workspaceId: string | null }>
  }
  /** 消息级表情回复/点赞（R8.1）：自由 emoji，真相在 messages.reactions_json。 */
  reactions?: MessageReaction[]
  /** 引用式回复（R8.1）：被回复消息 id。 */
  replyToMessageId?: string
  /** 线程内单调序号（P0 分配）。仅冷加载端点返回，客户端用它做游标分页读取更早历史。 */
  seq?: number
}

export interface MainChatSession {
  id: string
  title: string
  pinnedAt?: string
  customAgentId?: string
  executorId?: string
  workspaceId?: string
  /**
   * 会话归属用户（R10.1 可见性基础）。真相在 conversations.createdBy（main thread）；
   * 内存态从 threads 读回，新建会话时写入。批 3「取消公开」依赖此字段判定 owner。
   */
  ownerUserId?: string
  cwd?: string
  executionModel?: string
  runtimeSessionIds?: Partial<Record<AgentType, string>>
  runtimeContinuations?: MainChatRuntimeContinuation[]
  handoffSnapshot?: ConversationHandoffSnapshot
  sourceChannel?: 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'
  externalConversationId?: string
  externalUserId?: string
  externalChatId?: string
  externalThreadId?: string
  agentRunningStatus?: AgentRunningStatus
  currentStep?: string
  /**
   * Absent on summarized list/broadcast payloads (`summarizeMainChatSession` with
   * `previewMessages: 0`) — those carry `messageCount`/`latestMessagePreview`
   * instead. Present (possibly truncated) once a session has been cold-loaded
   * via `getMainChatSession`.
   */
  messages?: ChatMessage[]
  messagesLoaded?: boolean
  messageCount?: number
  visibility?: 'public' | 'private'
  /**
   * Derived single-line preview of the newest user/assistant message. Summarized
   * list payloads drop `messages`, so session lists read this instead. Produced
   * by `summarizeMainChatSession`; never persisted and never sent by clients.
   */
  latestMessagePreview?: string
  createdAt: string
  updatedAt: string
}

export type AutomationStatus = 'active' | 'paused' | 'archived'
export type AutomationTriggerKind = 'schedule' | 'webhook' | 'api'
export type AutomationTriggerSigningMode = 'bearer' | 'hmac_sha256'
export type AutomationRunSource = 'schedule' | 'manual' | 'api' | 'webhook'
export type AutomationRunStatus = 'received' | 'task_created' | 'skipped' | 'coalesced' | 'failed' | 'completed'
export type AutomationConcurrencyPolicy = 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue'
export type AutomationCatchUpPolicy = 'skip_missed' | 'enqueue_missed_with_cap'

export interface AutomationVariable {
  name: string
  label?: string | null
  type: 'text' | 'number' | 'boolean' | 'select'
  required: boolean
  defaultValue?: string | number | boolean | null
  options?: string[]
}

export interface AutomationTaskTemplate {
  acceptanceCriteria?: string
  initialChatMessage?: string
  customTitleMode?: 'fixed' | 'template'
}

export interface AutomationRecord {
  id: string
  projectId: string
  ownerUserId: string
  title: string
  description: string
  status: AutomationStatus
  priority: Task['priority']
  difficulty: TaskDifficulty
  agentType: Task['agentType']
  executionModel?: string
  opencodeConfig?: OpenCodeExecutionConfig
  workspaceId: string
  workspaceSessionId?: string
  baseBranch?: string
  returnMode: DistributedReturnMode
  syncBackStrategy: SyncBackStrategy
  gitIdentityMode: 'personal'
  concurrencyPolicy: AutomationConcurrencyPolicy
  catchUpPolicy: AutomationCatchUpPolicy
  taskTemplate?: AutomationTaskTemplate
  variables: AutomationVariable[]
  lastTriggeredAt?: string
  lastEnqueuedAt?: string
  createdAt: string
  updatedAt: string
  legacyAgentId?: string
  legacyCronId?: string
}

export interface AutomationTriggerRecord {
  id: string
  automationId: string
  kind: AutomationTriggerKind
  label?: string | null
  enabled: boolean
  cronExpression?: string | null
  timezone?: string | null
  nextRunAt?: string | null
  signingMode?: AutomationTriggerSigningMode | null
  secretEncrypted?: string | null
  publicId?: string | null
  replayWindowSec?: number | null
  lastFiredAt?: string | null
  lastResult?: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationRunRecord {
  id: string
  automationId: string
  triggerId?: string | null
  source: AutomationRunSource
  status: AutomationRunStatus
  triggerPayload?: Record<string, unknown> | null
  resolvedVariables?: Record<string, string | number | boolean> | null
  linkedTaskId?: string | null
  linkedTaskRunId?: string | null
  linkedDistributedTaskId?: string | null
  coalescedIntoRunId?: string | null
  failureReason?: string | null
  idempotencyKey?: string | null
  triggeredAt: string
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}
