/**
 * [INPUT]: Shared contracts plus web-only API response and request shapes.
 * [OUTPUT]: Typed API surface consumed by web request methods and UI components.
 * [POS]: Web API type registry; cross-runtime contracts must be re-exported from packages/shared.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type {
  AgentConfig,
  AgentRunningStatus,
  AgentTaskRunFailureCode,
  AutomationRecord,
  AutomationRunRecord,
  AutomationTriggerRecord,
  AppResources,
  AppState,
  CollaborationWorkspace,
  ExecutionModelOption,
  ExecutorRecord,
  GitHubResourceBinding,
  GitHubResourceBindingFilter,
  GitHubResourceBindingRole,
  GitHubResourceBindingStatus,
  GitHubResourceType,
  MainChatSession,
  ModelProfileRuntimeSettings,
  ModelProfileVisibility,
  Project,
  RailwayConnectionSummary,
  RailwayDeploymentSummary,
  RailwayResourceBinding,
  RailwayResourceBindingFilter,
  RailwayResourceBindingRole,
  RailwayResourceBindingStatus,
  RailwayResourceType,
  Task,
  TaskAgentRetrySessionMode,
  TaskComment,
  TaskCommentDispatchOutcome,
  TaskCommentMention,
  UserMentionNotification,
  TaskProposal,
  WorkspaceSession,
  WorkspaceSessionTitleOrigin,
  TeamActivity,
  TeamRole,
  ToolCall,
  Workspace,
  WorkspaceDesktopSandboxAction,
  WorkspaceDesktopSandboxClientNetworkHint,
  WorkspaceDesktopSandboxDisplayProfile,
  WorkspaceDesktopSandboxDto,
} from '@shared/types'
export type { TaskAgentRetrySessionMode } from '@shared/types'
import type { CustomAgentTransferPackage } from '@shared/custom-agent'
import type { SkillFileDetail, SkillRecord } from '@shared/skill'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskCommentReactionEmoji } from '@shared/task-comment-reaction'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type { WorkspaceEnvironmentStatusSnapshot } from '@shared/task-environment'
import type { TaskGitPullRequestResult } from '@shared/task-git-ops'
import type { TaskSubagentObservation } from '@shared/subagent-role'
import type {
  WorkspaceSessionEventsPage,
  WorkspaceSessionEventRecord,
  WorkspaceSessionRuntimeSnapshot,
  WorkspaceSessionSnapshot,
  WorkspaceSessionTurnRecord,
} from '@shared/workspace-session-history'
import type { WorkspaceSessionUnreadStoreSnapshot } from '@shared/workspace-session-unread'
import type {
  ExecutorAgentSessionDetail,
  ExecutorAgentSessionsResult,
  ExecutorAgentSessionSource,
} from '@shared/types'
import type { RuntimeEnvironmentConfig, RuntimeEnvironmentEffectiveSummary, RuntimeEnvironmentExecutionPayload, RuntimeEnvironmentSummary } from '@shared/runtime-environment'
import type { UserNotificationSettings } from '@shared/user-notification-settings'
import type { UserExperimentalSettings } from '@shared/user-experimental-settings'

export type { TeamActivity, TeamRole } from '@shared/types'
export type { CollaborationWorkspace } from '@shared/types'
export type {
  RailwayConnectionSummary,
  RailwayDeploymentSummary,
  RailwayResourceBinding,
  RailwayResourceBindingFilter,
  RailwayResourceBindingRole,
  RailwayResourceBindingStatus,
  RailwayResourceType,
} from '@shared/types'
export type {
  PersonalAccessToken,
  PersonalAccessTokenCreateResponse,
  PersonalAccessTokenListResponse,
} from '@shared/auth'
export type {
  GitHubResourceBinding,
  GitHubResourceBindingFilter,
  GitHubResourceBindingRole,
  GitHubResourceBindingStatus,
  GitHubResourceType,
  ProjectGitHubWorkflowJobLogsResponse,
  ProjectGitHubWorkflowJobSummary,
  ProjectGitHubWorkflowRunJobsResponse,
  ProjectGitHubWorkflowRunsResponse,
  ProjectGitHubWorkflowRunSummary,
  ProjectIssuesResponse,
  ProjectIssueSummary,
  ProjectPullRequestBulkSyncResult,
  ProjectPullRequestListResponse,
  ProjectPullRequestReviewSummary,
  ProjectPullRequestReviewWorkflowResponse,
  ProjectPullRequestSyncResult,
} from '@shared/types'
export type { SkillFileDetail, SkillImportResult, SkillRecord } from '@shared/skill'
export type { TaskGitPullRequestResult } from '@shared/task-git-ops'
export type {
  WorkspaceSessionEventsPage,
  WorkspaceSessionEventRecord,
  WorkspaceSessionRuntimeSnapshot,
  WorkspaceSessionSnapshot,
  WorkspaceSessionTurnRecord,
} from '@shared/workspace-session-history'

export type { UserNotificationSettings }
export type { UserExperimentalSettings }

export type GitIdentityConfig = {
  personal: {
    name: string
    email: string
    hasToken: boolean
  }
}

export type GitIdentityHealth = {
  personal: { configured: boolean; hasCredentialToken: boolean }
}

export type GitProvider = 'github' | 'gitlab' | 'generic'

export type GitCredentialSummary = {
  id: string
  label: string
  provider: GitProvider
  host: string
  authMode: 'pat' | 'ssh'
  name: string
  email: string
  hasPatToken: boolean
  hasSshPrivateKey: boolean
  sshPublicKey?: string
  sshKeyFingerprint?: string
  activated: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type GitCredentialCreatePayload = {
  label: string
  provider: GitProvider
  host: string
  authMode: 'pat'
  name: string
  email: string
  patToken: string
  isDefault?: boolean
}

export type GitCredentialUpdatePayload = {
  label?: string
  provider?: GitProvider
  host?: string
  authMode?: 'pat' | 'ssh'
  name?: string
  email?: string
  patToken?: string
  isDefault?: boolean
}

export type UserGitPatVerification = {
  ok: boolean
  provider?: GitProvider
  account?: string
  message: string
}

export type GitHubAppInstallationSummary = {
  installationId: number
  accountLogin: string
  accountType: 'User' | 'Organization' | string
  provider: 'github'
  providerHost: string
  repositorySelection: 'all' | 'selected' | string
  permissions: Record<string, string>
  hasAccessToken: boolean
  accessTokenExpiresAt?: string
  suspendedAt?: string
  commitAuthorName?: string
  commitAuthorEmail?: string
  createdAt: string
  updatedAt: string
}

export type GitHubAppInstallationsResponse = {
  configured: boolean
  appSlug?: string
  oauthConfigured: boolean
  oauthAuthorized: boolean
  installations: GitHubAppInstallationSummary[]
}

export type GitHubAppRepositorySummary = {
  id: number
  name: string
  fullName: string
  ownerLogin: string
  private: boolean
  archived: boolean
  disabled: boolean
  fork: boolean
  defaultBranch?: string
  htmlUrl?: string
  cloneUrl: string
  sshUrl?: string
  /** 聚合列表（含协作/组织仓库）时携带：提供访问的 GitHub App installation id */
  installationId?: number
}

export type GitHubAppRepositoriesResponse = {
  repositories: GitHubAppRepositorySummary[]
}

export type GitHubAppUserRepositoriesResponse = {
  oauthConfigured: boolean
  authorized: boolean
  repositories: GitHubAppRepositorySummary[]
  message?: string
}

export type GitHubAppAuthorizeUrlResponse = {
  oauthConfigured: boolean
  url?: string
  message?: string
}

export type GitHubAppConnectUrlResponse = {
  configured: true
  url?: string
  alreadyInstalled?: boolean
  installations?: GitHubAppInstallationSummary[]
  message?: string
}

export type ProjectGitCredentialBinding = {
  id: string
  projectId: string
  userId: string
  authSourceType: 'user-credential' | 'github-app-installation'
  credentialId?: string
  githubInstallationId?: number
  githubRepositoryId?: number
  githubAccountLogin?: string
  githubAccountType?: string
  githubRepositoryName?: string
  providerHost?: string
  createdAt: string
  updatedAt: string
}

export type ProjectGitCredentialBindingMemberStatus = {
  id: string
  email: string
  name: string
  avatarUrl?: string
  hasBinding: boolean
}

export type ProjectGitCredentialBindingResponse = {
  binding: ProjectGitCredentialBinding | null
  credential: GitCredentialSummary | null
  credentials: GitCredentialSummary[]
  members: ProjectGitCredentialBindingMemberStatus[]
}

export type ManagedCloudExecutorPayload = {
  workspaceId?: string
  name?: string
  maxConcurrency?: number
  autoStart?: boolean
}

export type ManagedCloudRuntimeStatus = {
  providerName: 'disabled' | 'unsafe-local-process' | 'docker-cli' | 'boxlite-cli' | 'ascii-box-cli' | 'ascii-box-sdk' | 'cloudflare-sandbox'
  isolationMode: 'disabled' | 'host-process' | 'container'
  hostMode: 'none' | 'control-plane-host' | 'remote-docker-host' | 'remote-boxlite-host' | 'remote-cloudflare-sandbox'
  available: boolean
  poolSize: number
  target: string
  message: string
}

export type ManagedCloudRuntimeTargetStatus = {
  id: string
  displayName?: string
  enabled: boolean
  egressMode: 'default' | 'none'
  hostMode: 'none' | 'control-plane-host' | 'remote-docker-host' | 'remote-boxlite-host' | 'remote-cloudflare-sandbox'
  target: string
  image: string
  available: boolean
  assignedExecutorCount: number
  serverVersion?: string
  imageCached?: boolean
  failureStage?: 'config' | 'daemon' | 'image'
  message: string
}

export type ManagedCloudRuntimePrewarmResult = {
  targetId: string
  target: string
  ok: boolean
  message: string
}

export type ManagedCloudUsageRecord = {
  id: string
  workspaceId?: string
  workspaceName?: string
  workspaceSessionId?: string
  workspaceSessionTitle?: string
  projectId?: string
  projectName?: string
  executorId?: string
  targetId?: string
  providerName: ManagedCloudRuntimeStatus['providerName']
  sku: string
  vcpu: number
  memoryGb: number
  startedAt: string
  endedAt: string
  durationSeconds: number
  billableSeconds: number
  computeHours: number
  billableComputeHours: number
  coreSeconds: number
  costUsd: number
  revenueUsd: number
  estimatedProviderCostUsd: number
  grossMarginUsd: number
  grossMarginPercent: number
  status: 'completed' | 'failed' | 'stopped' | 'estimated'
  usageKind?: 'runtime-lease' | 'turn'
}

export type ManagedCloudUsageSummary = {
  plan: 'free' | 'pro' | 'team'
  includedComputeHours: number
  usedComputeHours: number
  remainingComputeHours: number
  overageComputeHours: number
  computeHourPriceUsd: number
  estimatedProviderCostUsd: number
  grossMarginUsd: number
  grossMarginPercent: number
  includedCreditUsd: number
  usedUsd: number
  remainingUsd: number
  overageUsd: number
  usagePercent: number
  softLimitExceeded: boolean
  message: string
}

export type ManagedCloudUsageResponse = {
  summary: ManagedCloudUsageSummary
  records: ManagedCloudUsageRecord[]
}

export type WorkspaceDesktopSandboxResponse = {
  desktop: WorkspaceDesktopSandboxDto
}

export type WorkspaceDesktopSandboxScopePayload = {
  workspaceId?: string
  workspaceSessionId?: string
}

export type WorkspaceDesktopSandboxOpenPayload = WorkspaceDesktopSandboxScopePayload & {
  displayProfile?: WorkspaceDesktopSandboxDisplayProfile
  clientNetwork?: WorkspaceDesktopSandboxClientNetworkHint
}

export type WorkspaceDesktopSandboxActionPayload = WorkspaceDesktopSandboxScopePayload & {
  action: WorkspaceDesktopSandboxAction
}

export type WorkspaceDesktopSandboxCommandPayload = WorkspaceDesktopSandboxScopePayload & {
  command: string
}

export type AutomationListItem = AutomationRecord & {
  triggers: AutomationTriggerRecord[]
  lastRun: AutomationRunRecord | null
}

export type AutomationDetail = AutomationRecord & {
  triggers: AutomationTriggerRecord[]
  runs: AutomationRunRecord[]
}

export type AutomationMutationPayload = Omit<
  AutomationRecord,
  'id'
  | 'projectId'
  | 'ownerUserId'
  | 'createdAt'
  | 'updatedAt'
  | 'lastTriggeredAt'
  | 'lastEnqueuedAt'
  | 'legacyAgentId'
  | 'legacyCronId'
>

export type AutomationUpdatePayload = Partial<AutomationMutationPayload>

export type AutomationTriggerMutationPayload = {
  kind: AutomationTriggerRecord['kind']
  label?: string
  cronExpression?: string
  timezone?: string
  signingMode?: AutomationTriggerRecord['signingMode']
  replayWindowSec?: number
  enabled?: boolean
}

export type AutomationTriggerUpdatePayload = Partial<Omit<AutomationTriggerMutationPayload, 'kind'>>

export type AutomationRunMutationPayload = {
  triggerId?: string
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

export type AutomationTriggerSecretResponse = {
  trigger: AutomationTriggerRecord
  secret?: string
}

export type AuthUser = {
  id: string
  email: string
  name: string
  /** 用户 ID（@username）：全局唯一；老用户回填前可能为空 */
  username?: string
  /** 用户 ID 最近修改时间（30 天冷静期用） */
  usernameUpdatedAt?: string
  avatarUrl?: string
  bio?: string
  onboardingCompletedAt?: string
  onboardingDismissedAt?: string
  onboardingPath?: 'existing-repo' | 'quickstart' | 'team'
  authProvider?: 'password' | 'google'
  isInternal?: boolean
  status?: 'active' | 'suspended' | 'banned'
  role?: 'user' | 'admin' | 'owner'
  createdAt?: string
  lastLoginAt?: string
  billingAccess?: {
    action: 'create_task' | 'execute_task'
    allowed: boolean
    enforcementEnabled: boolean
    requiresPaid: boolean
    hasActiveSubscription: boolean
    activeSubscriptionIds: string[]
    plan: 'free' | 'pro' | 'team' | 'unknown'
    status: 'active' | 'inactive' | 'not-required' | 'enforcement-disabled'
    message: string
  }
}

export type DevLoginAccountSummary = {
  id: string
  label: string
  description: string
  email: string
  name: string
}

export type AppBrand = {
  name: string
  site: string
  edition: string
}

export type DevLoginAccountsResponse = {
  enabled: boolean
  accounts: DevLoginAccountSummary[]
  turnstile?: {
    enabled: boolean
    siteKey: string
  }
  email?: {
    provider: 'console' | 'cloudflare'
    configured: boolean
    from: string
  }
  google?: {
    configured: boolean
  }
  brand?: AppBrand
}

export type DevLoginResponse = {
  user: AuthUser
  token: string
}

export type GoogleLoginPrepareResponse = {
  ok: boolean
  message?: string
}

export type BillingCustomer = {
  id: string
  userId: string
  creemCustomerId: string
  email: string
  name?: string
  environment: 'live' | 'test'
  createdAt: string
  updatedAt: string
}

export type BillingCheckout = {
  id: string
  userId?: string
  teamId?: string
  creemCustomerId?: string
  creemSubscriptionId?: string
  creemOrderId?: string
  productId: string
  productName?: string
  status: string
  checkoutUrl?: string
  successUrl?: string
  requestId?: string
  metadata: Record<string, unknown>
  environment: 'live' | 'test'
  createdAt: string
  updatedAt: string
}

export type BillingSubscription = {
  id: string
  userId?: string
  teamId?: string
  creemCustomerId?: string
  productId: string
  productName?: string
  status: string
  accessGranted: boolean
  currentPeriodStartAt?: string
  currentPeriodEndAt?: string
  canceledAt?: string
  metadata: Record<string, unknown>
  environment: 'live' | 'test'
  lastEventId?: string
  lastEventType?: string
  createdAt: string
  updatedAt: string
}

export type BillingQuotaMetric = {
  limit: number | null
  used: number
  remaining: number | null
}

export type BillingQuotaSnapshot = {
  dailyExecutionSessions: BillingQuotaMetric
  concurrentExecutionSessions: BillingQuotaMetric
  activeWorkspaces: BillingQuotaMetric
  dailyWorkspaceCreations: BillingQuotaMetric
  privateExecutors: BillingQuotaMetric
}

export type BillingStatusResponse = {
  scope: {
    type: 'user' | 'team'
    id: string
    name?: string
  }
  quota: BillingQuotaSnapshot
  freeQuota: BillingQuotaSnapshot
  access: {
    action: 'create_task' | 'execute_task'
    allowed: boolean
    enforcementEnabled: boolean
    requiresPaid: boolean
    hasActiveSubscription: boolean
    activeSubscriptionIds: string[]
    plan: 'free' | 'pro' | 'team' | 'unknown'
    status: 'active' | 'inactive' | 'not-required' | 'enforcement-disabled'
    message: string
  }
  scopeFeatureAccess: null | {
    feature: 'create_task' | 'execute_task' | 'premium_models' | 'team_features'
    allowed: boolean
    enforcementEnabled: boolean
    requiresPaid: boolean
    plan: 'free' | 'pro' | 'team' | 'unknown'
    requiredPlan: 'free' | 'pro' | 'team' | 'unknown'
    hasActiveSubscription: boolean
    activeSubscriptionIds: string[]
    message: string
  }
  policy: {
    enforcementEnabled: boolean
    scopeType: 'user' | 'team'
    scopeId: string
    plan: 'free' | 'pro' | 'team' | 'unknown'
    hasActiveSubscription: boolean
    activeSubscriptionIds: string[]
    features: Record<'create_task' | 'execute_task' | 'premium_models' | 'team_features', {
      feature: 'create_task' | 'execute_task' | 'premium_models' | 'team_features'
      allowed: boolean
      enforcementEnabled: boolean
      requiresPaid: boolean
      plan: 'free' | 'pro' | 'team' | 'unknown'
      requiredPlan: 'free' | 'pro' | 'team' | 'unknown'
      hasActiveSubscription: boolean
      activeSubscriptionIds: string[]
      message: string
    }>
  }
  environment: 'live' | 'test'
  customer: BillingCustomer | null
  seatAccess: null | {
    allowed: boolean
    enforcementEnabled: boolean
    teamId: string
    role: TeamRole
    includedSeats?: number
    occupiedSeats: number
    reservedSeats: number
    availableSeats?: number
    activeSubscriptionId?: string
    message: string
  }
  checkouts: BillingCheckout[]
  subscriptions: BillingSubscription[]
}

export type ModelTokenUsage = {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens: number
}

export type ModelUsageSummaryResponse = {
  ok: boolean
  summary: {
    totals: {
      runCount: number
      recordedTokenRunCount: number
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      totalTokens: number
    }
    daily: Array<{
      date: string
      runCount: number
      recordedTokenRunCount: number
      totalTokens: number
    }>
    byModel: Array<{
      executionModel: string
      providerId: string
      modelId: string
      runCount: number
      recordedTokenRunCount: number
      usage: ModelTokenUsage
      lastUsedAt: string
    }>
    byProvider: Array<{
      providerId: string
      runCount: number
      recordedTokenRunCount: number
      usage: ModelTokenUsage
      lastUsedAt: string
    }>
  }
}

export type AdminAuditLogRecord = {
  id: string
  workspaceId?: string
  projectId?: string
  taskId?: string
  conversationId?: string
  agentSessionId?: string
  approvalRequestId?: string
  channelBindingId?: string
  eventType: string
  actorType: 'user' | 'agent' | 'system' | 'channel'
  actorId?: string
  payload?: Record<string, unknown>
  createdAt: string
}

export type AdminApprovalRequestRecord = {
  id: string
  workspaceId?: string
  agentActionId: string
  requestedByAgentSessionId: string
  approverUserId?: string
  title: string
  detail?: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  riskLevel: 'low' | 'medium' | 'high'
  expiresAt?: string
  createdAt: string
  updatedAt: string
}

export type AdminAuditResponse = {
  pendingApprovals: AdminApprovalRequestRecord[]
  logs: AdminAuditLogRecord[]
}

export type GoogleBridgeResponse = {
  user?: AuthUser
  token?: string
  needsLogin?: boolean
  message?: string
}

export type Team = import('@shared/types').Team

export type TeamMember = {
  id: string
  email: string
  name: string
  /** 用户 ID（@username） */
  username?: string
  avatarUrl?: string
  createdAt: string
  role: TeamRole
}

export type ProjectAssignee = {
  id: string
  email: string
  name: string
  avatarUrl?: string
  kind?: 'user' | 'agent' | 'all'
}

export type TaskAssignmentOptions = {
  startMode: 'now' | 'parked'
  handoffPrompt?: string
  idempotencyKey?: string
}

export type StartAssignedAgentPayload = {
  handoffPrompt?: string
  idempotencyKey?: string
}

export type AddTaskCommentPayload = {
  content: string
  parentCommentId?: string
  mentions?: Array<Pick<TaskCommentMention, 'targetType' | 'targetId'>>
  attachments?: TaskChatAttachment[]
  idempotencyKey?: string
}

export type AddTaskCommentResponse = ApiResponse & {
  comment: TaskComment
  commentDispatches: TaskCommentDispatchOutcome[]
}

export type TaskCommentPreviewResponse = {
  commentDispatches: TaskCommentDispatchOutcome[]
}

export type UpdateTaskCommentPayload = {
  content: string
  mentions?: Array<Pick<TaskCommentMention, 'targetType' | 'targetId'>>
  attachments?: TaskChatAttachment[]
}

export type TaskCommentMutationResponse = ApiResponse & {
  comment: TaskComment
}

export type TaskCommentReactionPayload = {
  emoji: TaskCommentReactionEmoji
  active: boolean
}

export type TaskCommentResolutionPayload = {
  resolved: boolean
}

export type TaskSubscriberPayload = {
  userId: string
  subscribed: boolean
}

export type UserMentionNotificationResponse = {
  notifications: UserMentionNotification[]
  unreadCount: number
}

export type TeamInvitation = import('@shared/types').TeamInvitation

export type TeamExecutorRecord = ExecutorRecord & {
  sharedProjectIds: string[]
  sharedWorkspaceIds: string[]
}

export type CollaborationWorkspaceCreatePayload = {
  name: string
  sourceWorkspaceId?: string
}

export type CollaborationWorkspaceUpdatePayload = {
  name: string
}

export type RuntimeEnvironmentResponse = {
  config: RuntimeEnvironmentConfig | null
  summary: RuntimeEnvironmentSummary | null
  effectiveSummary?: RuntimeEnvironmentEffectiveSummary | null
  payload?: RuntimeEnvironmentExecutionPayload | null
  message?: string
  fileWrite?: {
    ok: boolean
    fileName?: string
    path?: string
    message?: string
  } | null
}

export type RuntimeEnvironmentUpdatePayload = {
  config: RuntimeEnvironmentConfig | null
  workspaceSessionId?: string
}

export type ModelProfileCreatePayload = {
  name: string
  description?: string
  visibility?: ModelProfileVisibility | 'workspace'
  teamId?: string
  workspaceId?: string
  bindings: Array<{
    agentType: Task['agentType']
    providerId: string
    modelId: string
    label?: string
    baseUrl?: string
    apiToken?: string
    clearApiToken?: boolean
    isDefault?: boolean
    runtimeSettings?: ModelProfileRuntimeSettings
  }>
}

export type ModelProfileUpdatePayload = Omit<ModelProfileCreatePayload, 'visibility'> & {
  visibility: ModelProfileVisibility | 'workspace'
  bindings: Array<ModelProfileCreatePayload['bindings'][number] & { id?: string }>
}

export type ModelProfileImportPayload = {
  executorId: string
  agentType: Task['agentType']
  visibility: ModelProfileVisibility | 'workspace'
  teamId?: string
  workspaceId?: string
}

export type ConversationRecord = import('@shared/types').ConversationRecord

export type ConversationMessageRecord = import('@shared/types').ConversationMessageRecord

export type FeishuBindingSession = {
  sessionId: string
  status: 'pending' | 'success' | 'error'
  qrCodeUrl: string
  expiresInSeconds: number
  message?: string
}

export type WechatBindingSession = {
  sessionId: string
  status: 'pending' | 'wait' | 'scaned' | 'success' | 'error' | 'expired' | 'need_verifycode' | 'verify_code_blocked'
  qrCodeUrl: string
  message?: string
  wechatUserId?: string
  requiresVerifyCode?: boolean
}

export type ConversationBindingRecord = {
  id: string
  channelType: 'telegram' | 'feishu' | 'wechat'
  externalChatId: string
  externalThreadId?: string
  bindingMode: 'mirror' | 'bidirectional'
}

export type TaskConversationPayload = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  totalMessageCount: number
  returnedMessageCount: number
  hasMoreBefore: boolean
  recentTurns?: number
}

export type WorkspaceSessionDeleteTurnResponse =
  | {
      ok: true
      status: 'deleted'
      event: Extract<WorkspaceSessionEventRecord, { kind: 'turn_deleted' }>
      runtime: WorkspaceSessionRuntimeSnapshot | null
    }
  | {
      ok: true
      status: 'noop'
    }

export type TaskImportableAgentSessionsPayload = ExecutorAgentSessionsResult & {
  executorId: string
  executorName: string
  workspaceId: string
  workspaceSessionId?: string
}

export type TaskImportableAgentSessionPayload = {
  ok: boolean
  executorId: string
  executorName: string
  workspaceId: string
  workspaceSessionId?: string
  session?: ExecutorAgentSessionDetail
  message?: string
}

export type TaskImportAgentSessionResponse = ApiResponse & {
  ok: boolean
  executorId: string
  executorName: string
  workspaceId: string
  workspaceSessionId: string
  workspaceSession: WorkspaceSession
  source: ExecutorAgentSessionSource
  sessionId: string
  sessionTitle: string
  importedCount: number
  skippedCount: number
  snapshot: TaskChatSessionSnapshot
  message?: string
}

export type EnqueueTaskChatMessageResponse = {
  snapshot: TaskChatSessionSnapshot
  message?: string
}

export type WorkspaceChatGroupMember = {
  id: string
  conversationId: string
  memberType: 'user' | 'agent'
  memberId: string
  role: 'owner' | 'member' | 'orchestrator'
  invitedBy?: string
  joinedAt: string
  leftAt?: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceChatGroupDetail = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  members: WorkspaceChatGroupMember[]
}

export type WorkspaceChatGroupSummary = {
  conversation: ConversationRecord
  members: WorkspaceChatGroupMember[]
  messageCount: number
  latestMessage?: ConversationMessageRecord
}

export type WorkspaceChatGroupSessionSummary = {
  conversation: ConversationRecord
  messageCount: number
  latestMessage?: ConversationMessageRecord
}

export type WorkspaceChatGroupSessionDetail = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  totalMessageCount: number
  returnedMessageCount: number
  hasMoreBefore: boolean
}

export type WorkspaceChatAgentOption = {
  id: string
  name: string
  role: string
  avatarUrl?: string
  status: 'online' | 'offline' | 'error' | 'unknown'
  kind: 'primary' | 'custom'
}

export type ConversationVisibility = 'public' | 'private'

export type ConversationShareSourceKind = 'conversation' | 'main_chat' | 'workspace_session'
export type ConversationShareTargetType = 'user' | 'agent' | 'link'
export type ConversationSharePermission = 'read' | 'comment'

export type ConversationShareRecord = {
  id: string
  sourceKind: ConversationShareSourceKind
  sourceId: string
  workspaceId?: string
  targetType: ConversationShareTargetType
  targetId?: string
  permission: ConversationSharePermission
  shareTokenHash?: string
  createdBy: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
  expiresAt?: string
}

export type SessionSearchHit = {
  conversation: ConversationRecord
  matchedMessages: ConversationMessageRecord[]
}

export type SessionSearchResponse = {
  hits: SessionSearchHit[]
}

export type ForwardSessionsTarget = {
  targetType: 'user' | 'agent'
  targetId: string
}

export type ForwardSessionsPayload = {
  conversationIds?: string[]
  mainChatSessionIds?: string[]
  workspaceSessionIds?: string[]
  targets: ForwardSessionsTarget[]
  permission?: ConversationSharePermission
}

export type ForwardSessionsResponse = {
  shares: ConversationShareRecord[]
}

export type CreateSessionSharePayload = {
  targetType: ConversationShareTargetType
  targetId?: string
  permission?: ConversationSharePermission
  expiresInMinutes?: number
}

export type CreateSessionShareResponse = {
  share: ConversationShareRecord
  token?: string
}

export type SharedWithMeEntry =
  | { share: ConversationShareRecord, sourceKind: 'conversation', conversation: ConversationRecord }
  | { share: ConversationShareRecord, sourceKind: 'main_chat', mainChatSession: MainChatSession }
  | { share: ConversationShareRecord, sourceKind: 'workspace_session', workspaceSession: import('@shared/types').WorkspaceSession, workspaceId: string, projectId: string, taskId: string | null }

export type SharedWorkspaceEntry = {
  share: import('@shared/types').WorkspaceShareRecord
  workspace: {
    id: string
    name: string
    description?: string
    avatarUrl?: string
    ownerUserId: string
  } | null
  sessionTitle?: string
  /** 跳转 /workspace 所需参数 */
  route?: {
    projectId?: string
    workspaceId?: string
    workspaceSessionId?: string
  }
}

export type PublicSessionPayload =
  | { sourceKind: 'conversation', conversation: ConversationRecord, messages: ConversationMessageRecord[], permission: ConversationSharePermission }
  | { sourceKind: 'main_chat', session: MainChatSession, messages: MainChatSession['messages'], permission: ConversationSharePermission }

export type AgentRecord = import('@shared/types').AgentRecord

export type AgentUniverseGraph = import('@shared/types').AgentUniverseGraph
export type AgentUniverseNode = import('@shared/types').AgentUniverseNode
export type AgentUniverseEdge = import('@shared/types').AgentUniverseEdge

export type AgentWorkdirStatus = import('@shared/types').AgentWorkdirStatus
export type AgentWorkdirSummary = import('@shared/types').ExecutorAgentWorkdirSummary
export type AgentWorkdirFileEntry = import('@shared/types').ExecutorAgentWorkdirFileEntry

export type AgentMindFile = { fileId: string | null; content: string }
export type AgentMindFiles = {
  soul: AgentMindFile
  user: AgentMindFile
  memory: AgentMindFile
}
export type AgentWorkdirReadResult = import('@shared/types').ExecutorAgentWorkdirReadResult

export type AgentUpdatePayload = {
  name: string
  type: string
  endpoint?: string
  config?: Record<string, unknown>
}

export type AgentChannelResponse = {
  channels: {
    telegram: {
      enabled: boolean
      botToken: string
      chatId: string
      threadId: string
      webhookSecret: string
    }
    feishu: {
      enabled: boolean
      connectionMode: 'manual' | 'long-connection'
      appId: string
      appSecret: string
      encryptKey: string
      verificationToken: string
      webhookUrl: string
    }
    wechat: {
      enabled: boolean
      botToken: string
      botId: string
      wechatUserId: string
      baseUrl: string
    }
    discord: {
      enabled: boolean
      botToken: string
      guildId: string
    }
    slack: {
      enabled: boolean
      botToken: string
      appToken: string
    }
    wecom: {
      enabled: boolean
      corpId: string
      agentId: string
      secret: string
      callbackToken: string
      encodingAesKey: string
      defaultTouser: string
    }
    whatsapp: {
      enabled: boolean
      phoneNumberId: string
      accessToken: string
      verifyToken: string
    }
    dingtalk: {
      enabled: boolean
      appKey: string
      appSecret: string
      connectionMode: 'manual' | 'stream'
    }
  }
  webhookUrls: {
    telegram: string
    feishu: string
    wecom: string
    whatsapp: string
  }
  syncStatus: {
    telegramWebhookRegistered: boolean
    warnings: string[]
  }
  telegramWebhookInfo: {
    url: string
    hasCustomCertificate: boolean
    pendingUpdateCount: number
    lastErrorDate?: number
    lastErrorMessage: string
    maxConnections?: number
    allowedUpdates: string[]
  } | null
}

export type AgentImportResult = {
  originalName: string
  importedName: string
  renamed: boolean
}

export type MainChatStreamEvent = {
  type: string
  content: string
  agentId?: string
  abortReason?: string
  partId?: string
  reasoning?: string[]
  state?: AppState
  taskProposal?: TaskProposal
  toolCall?: ToolCall
  toolCalls?: ToolCall[]
  status?: AgentRunningStatus
  currentStep?: string
  clientMessageId?: string
}

export type AgentTaskRecord = {
  id: string
  agentId: string
  type: string
  payload: Record<string, unknown>
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'
  result: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export type TaskAgentActivityRecord = {
  id: string
  agentId: string
  agentName: string
  agentAvatarUrl?: string
  eventType: string
  triggerKind: string
  triggerActorType: 'user' | 'agent' | 'system'
  triggerActorId?: string
  triggerActorName?: string
  actingUserId?: string
  actingUserName?: string
  includedCommentIds: string[]
  commentId?: string
  comment?: string
  coalescedCommentCount: number
  conversationSessionId?: string
  retryOfEventId?: string
  attempt: number
  retrySource: 'initial' | 'manual' | 'infrastructure'
  retrySessionMode?: TaskAgentRetrySessionMode
  recommendedRetrySessionMode?: TaskAgentRetrySessionMode
  retryScheduledAt?: string
  runId?: string
  transcriptAvailable?: boolean
  summaryPreview?: string
  failureCode?: AgentTaskRunFailureCode
  failureMessage?: string
  lastHeartbeatAt?: string
  updatedAt?: string
  usage?: ModelTokenUsage
  status: AgentTaskRecord['status']
  result: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export type AgentCronRecord = {
  id: string
  agentId: string
  name: string
  cronExpression: string
  payload: Record<string, unknown>
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
}

export type AgentHeartbeatRecord = {
  id: string
  agentId: string
  status: string
  metrics: Record<string, unknown>
  createdAt: string
}

export type SkillScanSkipped = {
  subjectId: string
  subjectName: string
  subjectType: 'project' | 'executor'
  attemptedPaths?: string[]
  executorId?: string | null
  executorName?: string | null
  path: string | null
  reason: string
}

export type SkillScanResult = {
  scope: 'project' | 'global'
  scannedProjects: number
  scannedExecutors: number
  discovered: number
  imported: SkillRecord[]
  updated: SkillRecord[]
  skipped: SkillScanSkipped[]
  warnings: string[]
}

export type WorkerConsoleRuntime = {
  daemonMode: 'idle' | 'starting' | 'running' | 'unpaired' | 'disconnected'
  paired: boolean
  connected: boolean
  executorId?: string
  lastConnectAttemptAt?: string
  lastHeartbeatAt?: string
  lastTaskAt?: string
  lastDisconnectAt?: string
  runningTaskIds: string[]
  queuedTaskIds: string[]
  lastError?: string
  startedAt?: string
}

export type WorkerConsoleConfig = {
  cloudUrl: string
  machineId: string
  machineName: string
  executorName?: string
  executorId?: string
  workspaceRoot: string
  maxConcurrency: number
  labels: string[]
  capabilities: string[]
  localServerPort: number
}

export type WorkerDoctorItem = {
  id: string
  category: 'tooling' | 'filesystem' | 'config' | 'network'
  label: string
  ok: boolean
  detail: string
  hint?: string
}

export type WorkerDoctorPayload = {
  config?: WorkerConsoleConfig
  checks?: {
    git?: boolean
    opencodeAvailable?: boolean
    codexCliAvailable?: boolean
    codexAuthenticated?: boolean
    claudeCliAvailable?: boolean
    claudeAuthenticated?: boolean
    opencodeConfigLoaded?: boolean
    codexConfigLoaded?: boolean
    claudeConfigLoaded?: boolean
    workerHomeWritable?: boolean
    workspaceConfigured?: boolean
    workspaceReady?: boolean
    machineIdConfigured?: boolean
    paired?: boolean
    cloudUrlConfigured?: boolean
    cloudReachable?: boolean
    officialSiteReachable?: boolean
  }
  summary?: {
    total: number
    passed: number
    failed: number
    ok: boolean
  }
  items?: WorkerDoctorItem[]
  cloudProbe?: {
    ok: boolean
    status?: number
    url?: string
    message: string
  }
  officialSiteProbe?: {
    ok: boolean
    status?: number
    url?: string
    message: string
  }
  runtime?: WorkerConsoleRuntime
}

export type WorkerConsolePayload = {
  config: WorkerConsoleConfig
  runtime: WorkerConsoleRuntime
  doctor: WorkerDoctorPayload
}

export type ProjectPayload = {
  name: string
  gitUrl: string
  color?: Project['color']
  workspaceId?: string
  visibility?: Project['visibility']
  rootPath?: string
  versionControl?: Project['versionControl']
  pathHint?: string
  defaultBranch?: string
  preferredExecutorId?: string
  gitCredentialId?: string
  githubInstallationId?: number
  githubRepositoryId?: number
  githubRepositoryName?: string
  environmentTemplate?: Project['environmentTemplate'] | null
  recentBaseBranches?: string[]
}

export type CreateTaskPayload = {
  projectId: string
  parentTaskId?: string
  description: string
  priority: Task['priority']
  status?: Task['status']
  title?: string
  startedAt?: string
  dueAt?: string
  acceptanceCriteria?: string
  draftId?: string
  draftSavedAt?: string
  recommendedTitle?: string
  baseBranchHint?: string
  requirementType?: 'task' | 'requirement'
  assigneeId?: string
  assigneeAgentId?: string
  assignmentStartMode?: 'now' | 'parked'
  handoffPrompt?: string
  idempotencyKey?: string
  chatMessage?: string
  agentManaged?: Task['agentManaged']
  agentType?: Task['agentType']
  executionModel?: Task['executionModel']
  executionMode?: Task['executionMode']
  preferredExecutorId?: string
  returnMode?: 'summary' | 'branch' | 'commit'
  syncBackStrategy?: 'none' | 'pull-branch'
  gitIdentityMode?: 'personal'
  baseBranch?: string
}

export type TaskQuickCreatePayload = {
  creatorAgentId: string
  request: string
  projectSelection:
    | { mode: 'fixed'; projectId: string }
    | { mode: 'agent' }
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  status?: 'backlog' | 'todo'
  assignmentStartMode?: 'now' | 'parked'
  idempotencyKey?: string
}

export type TaskQuickCreateResponse = {
  creationRunId: string
  agentTaskRunId?: string
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'
  dispatchStatus: 'queued' | 'coalesced' | 'deduplicated'
}

export type TaskQuickCreateStatusResponse = {
  creationRunId: string
  agentTaskRunId?: string
  status: TaskQuickCreateResponse['status']
  failureCode?: string
  failureMessage?: string
  task?: Task
}

export type ExecuteTaskPayload = {
  workspaceId: string
  workspaceSessionId?: string
  createNewSession?: boolean
  delegatedPrompt?: string
  baseBranch?: string
  returnMode?: 'summary' | 'branch' | 'commit'
  syncBackStrategy?: 'none' | 'pull-branch'
  gitIdentityMode?: 'personal'
}

export type UpdateTaskPayload = {
  title?: string
  description: string
  acceptanceCriteria?: string
  priority: Task['priority']
  startedAt?: string | null
  dueAt?: string | null
}

export type ApiResponse = {
  state: AppState
  stateHash?: string
  resources?: AppResources
  workspaceSessionUnreadSnapshot?: WorkspaceSessionUnreadStoreSnapshot
  message?: string
}

export type TaskMutationResponse = {
  message?: string
  task: Task
  workspaceSession?: WorkspaceSession | null
  workspaceSessionId?: string
}

export type TaskWorkspaceBindingResponse = ApiResponse & {
  taskId?: string
  task?: Task
  workspaceId?: string
  workspace?: Workspace
  workspaces?: Workspace[]
  workspaceSessionId?: string
  workspaceSession?: WorkspaceSession
}

export type CreateWorkspaceResponse = {
  state?: AppState
  project?: Project
  taskId?: string
  task?: Task
  workspace: Workspace
  workspaces: Workspace[]
  workspaceSessionId?: string
  workspaceSession?: WorkspaceSession
  workspaceTitleOrigin?: WorkspaceSessionTitleOrigin
  message: string
}

export type WorkspaceTitleSuggestionResponse = {
  ok: boolean
  title: string
  source: 'ai' | 'fallback'
  model?: string
  fallbackTitle?: string
  reason?: string
  message?: string
}

export type WorkspaceSessionUnreadStateResponse = {
  snapshot: WorkspaceSessionUnreadStoreSnapshot
}

export type WorkspaceSessionUnreadStateSaveResponse = {
  applied: boolean
  updatedAt: string
}

export type WorkspaceSessionForkMode = 'local' | 'worktree'

export type TaskEnvironmentActionResponse = ApiResponse & {
  output?: string
  appUrl?: string
  healthUrl?: string
  environmentStatus?: WorkspaceEnvironmentStatusSnapshot
  command?: string
  exitCode?: number
}

export type TaskEnvironmentStatusResponse = ApiResponse & {
  environmentStatus: WorkspaceEnvironmentStatusSnapshot
}

export type RecordTaskObservationPayload = {
  workspaceId?: string
  workspaceSessionId?: string
  kind: TaskSubagentObservation['kind']
  level?: TaskSubagentObservation['level']
  title: string
  detail?: string
  url?: string
  attachments?: TaskChatAttachment[]
  metadata?: Record<string, unknown>
}

export type GitHubResourceBindingMutationPayload = Pick<
  GitHubResourceBindingFilter,
  'taskId' | 'workspaceId' | 'workspaceSessionId'
> & {
  projectId: string
  resourceType: GitHubResourceType
  resourceId: string
  role?: GitHubResourceBindingRole
  status?: Extract<GitHubResourceBindingStatus, 'confirmed' | 'rejected'>
}

export type GitHubResourceBindingResponse = {
  binding: GitHubResourceBinding
}

export type RailwayResourceBindingMutationPayload = Pick<
  RailwayResourceBindingFilter,
  'taskId' | 'workspaceId' | 'workspaceSessionId'
> & {
  projectId: string
  resourceType: RailwayResourceType
  resourceId: string
  role?: RailwayResourceBindingRole
  status?: Extract<RailwayResourceBindingStatus, 'confirmed' | 'rejected'>
}

export type RailwayResourceBindingResponse = {
  binding: RailwayResourceBinding
}

export type RailwayConnectionResponse = {
  connection: RailwayConnectionSummary | null
  projectCount: number
  sync?: { ok: boolean; projectCount?: number; message?: string }
}

export type RailwayDeploymentListResponse = {
  deployments: RailwayDeploymentSummary[]
}

// worker 侧托管 ChatGPT 账号（Codex OAuth 设备码登录后的账户记录）
export type { CodexAccountRecord } from '@shared/types'

// ---- Feedback（bug / 功能建议 + 与创始人直接沟通）----

export type FeedbackItem = import('@shared/types').FeedbackItem
export type FeedbackMessage = import('@shared/types').FeedbackMessage
export type FeedbackAttachment = import('@shared/types').FeedbackAttachment
export type FeedbackSubmitPayload = import('@shared/types').FeedbackSubmitPayload
export type FeedbackSendMessagePayload = import('@shared/types').FeedbackSendMessagePayload

export type FeedbackListResponse = {
  feedback: FeedbackItem[]
}

export type FeedbackMutationResponse = {
  feedback: FeedbackItem
}

export type FeedbackDetailResponse = import('@shared/types').FeedbackDetailResponse

export type FeedbackSendMessageResponse = {
  feedback: FeedbackItem
  message: FeedbackMessage
}

export type FeedbackStatusUpdatePayload = {
  status?: FeedbackItem['status']
  routing?: FeedbackItem['routing']
}

// ---- 自有 telemetry / analytics ----

export type TelemetryEventType = import('@shared/types').TelemetryEventType

export type AdminAnalyticsResponse = {
  totals: {
    users: number
    executors: number
    onlineExecutors: number
    tasks: number
    deliveries: number
  }
  funnel: Array<{ eventType: TelemetryEventType; count: number }>
  dailyDeliveries: Array<{ date: string; count: number }>
  dailyEvents: Array<{ date: string; count: number }>
  dailyActiveUsers: Array<{ date: string; loginUsers: number; eventUsers: number; executionUsers: number }>
  retention: { cohort: number; d1: number; d7: number }
  retentionCurve: Array<{ date: string; cohort: number; d1: number | null; d7: number | null }>
  dailyTasks: Array<{ date: string; created: number; delivered: number }>
  weeklyDeliveries: Array<{ week: string; count: number }>
  deliveryRate: { completed: number; delivered: number }
  executionQuality: {
    statusCounts: Array<{ status: string; count: number }>
    completed: number
    delivered: number
    avgDurationSec: number
    retryRate: number
    failureCodes: Array<{ code: string; count: number }>
  }
  activeUsers: { wau: number; mau: number; totalUsers: number }
  weeklyRetention: { cohort: number; w1: number; w2: number }
  channels: Array<{ channel: string; conversations: number }>
  executors: { total: number; online: number; byRuntimeClass: Array<{ runtimeClass: string; count: number }>; onlineTrend: Array<{ date: string; count: number }> }
  feedback: { total: number; open: number; byType: Array<{ type: string; count: number }> }
  recentEvents: Array<import('@shared/types').TelemetryEventRecord>
}

// ---- feature 账户体系：Admin 用户管理 ----

export type AdminUserStatus = 'active' | 'suspended' | 'banned'
export type AdminUserRole = 'user' | 'admin' | 'owner'

export type AdminUserRecord = AuthUser & {
  status: AdminUserStatus
  role: AdminUserRole
  emailVerifiedAt?: string
  lastLoginAt?: string
  lastLoginIp?: string
  suspendedUntil?: string
  bannedReason?: string
  bannedAt?: string
  supportNote?: string
  supportNoteStatus?: 'pending' | 'in_progress' | 'resolved'
  plan?: string
}

export type AdminAuthEventRecord = {
  id: string
  userId?: string
  email?: string
  eventType: string
  provider?: string
  result: 'success' | 'fail' | 'blocked'
  ip?: string
  userAgent?: string
  metadataJson?: Record<string, unknown>
  createdAt: string
}

export type AdminTokenQuotaPolicy = {
  userId: string
  period: 'day' | 'month'
  limitTokens: number
  action: 'warn' | 'block'
  enabled: boolean
  updatedAt: string
} | null

export type AdminUserListResponse = {
  users: AdminUserRecord[]
  total: number
}

export type AdminUserDetailResponse = {
  user: AdminUserRecord
  teams: Array<{ id: string; name: string; createdAt: string; updatedAt: string }>
  billing: {
    plan: string
    hasActiveSubscription: boolean
    activeSubscriptionIds: string[]
    subscriptions: string[]
  }
  tokenQuota: AdminTokenQuotaPolicy
  quotaSnapshot: {
    usedTokens: number
    limitTokens: number | null
    usagePercent: number | null
    remainingTokens: number | null
    periodStart: string | null
    message: string
  }
  usage: {
    period: string
    totals: { runCount: number; totalTokens: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
    daily: Array<{ date: string; runCount: number; totalTokens: number }>
    byModel: Array<{ executionModel: string | null; providerId: string | null; runCount: number; totals: AdminUsageTotals }>
    byAgent: Array<{ agentId: string | null; agentName: string | null; runCount: number; totals: AdminUsageTotals }>
    byProvider: Array<{ providerId: string | null; runCount: number; totals: AdminUsageTotals }>
    byWorkspace: Array<{ workspaceId: string | null; workspaceName: string | null; runCount: number; totals: AdminUsageTotals }>
  }
  overview: {
    credit: {
      accountId: string
      balanceCredits: number
      totalGranted: number
      totalSpent: number
      totalRefunded: number
      updatedAt: string
    } | null
    subscriptions: Array<{
      id: string
      productName: string | null
      status: string
      currentPeriodStartAt: string | null
      currentPeriodEndAt: string | null
      canceledAt: string | null
      amountPaid: number | null
      environment: 'live' | 'test'
      updatedAt: string
    }>
    failedLogins: {
      last7d: number
      last30d: number
      lastFailedAt: string | null
      lastFailedIp: string | null
    }
    onlineSessions: number
  }
  authEvents: AdminAuthEventRecord[]
  dailyActivity: Array<{ date: string; logins: number; events: number; runs: number }>
}

export type AdminUsageTotals = {
  runCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type AdminUserAuditResponse = {
  logs: Array<{
    id: string
    eventType: string
    actorType: string
    actorId: string | null
    role: 'actor' | 'target' | 'both'
    payload: Record<string, unknown> | null
    createdAt: string
  }>
}

export type AdminUserActivityResponse = {
  tasks: {
    total: number
    created: number
    assigned: number
    inReview: number
    done: number
    recent: Array<{ id: string; title: string; status: string; projectId: string; createdAt: string; updatedAt: string }>
  }
  workspaces: {
    memberOf: number
    owned: number
    recent: Array<{ id: string; name: string; role: string; updatedAt: string }>
  }
  executors: {
    total: number
    online: number
    lastSeenAt: string | null
  }
  agents: {
    total: number
    online: number
    error: number
    offline: number
  }
}

export type AdminAuthEventsResponse = {
  authEvents: AdminAuthEventRecord[]
}

export type AdminAccountSystemResponse = {
  settings: { openRegistration?: boolean }
  admins: AdminUserRecord[]
}

export type CommunityChannelsConfig = {
  discordUrl?: string
  wechatQrUrl?: string
}

export type AdminCommunityChannelsResponse = {
  channels: CommunityChannelsConfig
  ok: boolean
}

export type PasswordBridgeResponse = {
  user?: AuthUser
  token?: string
  needsLogin?: boolean
  needsVerification?: boolean
  email?: string
  message?: string
}

// —— Agent Brain（feature）：协作空间级配置 ——
export type WorkspaceBrainConfig = {
  enabled: boolean
  brainAgentId?: string
  brainInstructions?: string
}

export type WorkspaceBrainBillingAccess = {
  allowed: boolean
  enforcementEnabled: boolean
  requiresPaid: boolean
  plan: string
  message?: string
}

export type WorkspaceBrainFile = {
  id: string
  workspaceId: string
  fileId: string
  digest: string | null
  enabled: boolean
  digestAt: string | null
  createdAt: string
  updatedAt: string
  fileName?: string
}

/** 空间内分组（P2）：成员归类（人 + Agent 混合）。 */
export type WorkspaceGroupWithMembers = {
  id: string
  workspaceId: string
  name: string
  sortOrder: number
  createdAt: string
  members: Array<{ memberType: 'user' | 'agent'; memberId: string }>
}

/** 大脑只读视图（P1）：事件流 + 持续摘要 + 分发记录 + 已纳入文件 */
export type WorkspaceBrainContextItem = {
  at: string
  kind: 'group_chat' | 'event' | 'task' | 'session'
  source?: string
  text: string
}

export type WorkspaceBrainContext = {
  updatedAt: string
  summaryLines: string[]
  recentItems: WorkspaceBrainContextItem[]
}

export type WorkspaceBrainDispatchRecord = {
  id: string
  agentId: string
  agentName: string
  type: string
  status: string
  createdAt: string
  completedAt: string | null
  triggerKind?: string
  sourceText?: string
  sessionId?: string
}

export type WorkspaceBrainOverview = {
  enabled: boolean
  brainAgentId?: string
  context: WorkspaceBrainContext
  dispatchRecords: WorkspaceBrainDispatchRecord[]
  files: WorkspaceBrainFile[]
}

/** 大脑个人上下文（P3）：我的云盘 + 我参与的时间线 + 我关心的待办 */
export type WorkspaceBrainMyContext = {
  personalFiles: Array<{ id: string; name: string; fileType: string; updatedAt: string }>
  participations: Array<{
    conversationId: string
    title: string
    kind: string
    messageCount: number
    activeMinutes: number
  }>
  todos: Array<{ id: string; title: string; unreadCount: number }>
  brainFileCount: number
}
