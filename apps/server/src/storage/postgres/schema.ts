import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique } from 'drizzle-orm/pg-core'

import type {
  AgentTaskRunFailureCode,
  AgentTaskRunStatus,
  AgentType,
  AutomationRecord,
  AutomationRunRecord,
  AutomationTriggerRecord,
  ExecutionEventLayer,
  ExecutionEventSeverity,
  ExecutionEventType,
  ExecutorDescriptor,
  ExecutorPairingCodeRecord,
  GitHubResourceBindingRole,
  GitHubResourceBindingSource,
  GitHubResourceBindingStatus,
  GitHubResourceType,
  ModelProfile,
  ModelProfileRuntimeSettings,
  ModelProfileSource,
  ModelTokenUsage,
  ProjectEnvironmentTemplate,
  ProjectIssueLabelSummary,
  ProjectPullRequestFileSummary,
  ProjectPullRequestReviewSummary,
  ChatMessage,
  RailwayDeploymentStatus,
  RailwayResourceBindingRole,
  RailwayResourceBindingSource,
  RailwayResourceBindingStatus,
  RailwayResourceType,
} from '@shared/types'
import type {
  SkillCompatibility,
  SkillFileContent,
  SkillFileInventoryEntry,
  SkillSourceType,
  SkillTrustLevel,
} from '@shared/skill'
import type { WorkspaceResourceVisibility } from '@shared/workspace-scope'
import type {
  InboxActorType,
  InboxItemKind,
  InboxItemReason,
  InboxRecipientType,
  InboxReplyTarget,
  InboxScope,
} from '@shared/inbox'
import type { RuntimeEnvironmentConfig } from '@shared/runtime-environment'
import type { PreviewSessionRecord } from '../../services/preview-session-record'

// Better Auth uses singular table names and camelCase columns by default.
// Keep these definitions in Drizzle so auth DDL is reviewed and versioned with the rest of the schema.
export const betterAuthUsers = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
})

export const betterAuthSessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => betterAuthUsers.id, { onDelete: 'cascade' }),
}, (table) => [
  index('session_userId_idx').on(table.userId),
])

export const betterAuthAccounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  // better-auth 1.7 scopes account identities by issuer. Existing rows are
  // backfilled by migration 0002 before the NOT NULL constraint applies.
  issuer: text('issuer').notNull(),
  userId: text('userId').notNull().references(() => betterAuthUsers.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
}, (table) => [
  index('account_userId_idx').on(table.userId),
])

export const betterAuthVerifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull(),
}, (table) => [
  index('verification_identifier_idx').on(table.identifier),
])

export const projectRuntimeEnvironmentConfigs = pgTable('project_runtime_environment_configs', {
  projectId: text('project_id').primaryKey(),
  deliveryMode: text('delivery_mode').$type<RuntimeEnvironmentConfig['mode']>().notNull(),
  fileName: text('file_name'),
  contentEncrypted: text('content_encrypted').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workspaceRuntimeEnvironmentConfigs = pgTable('workspace_runtime_environment_configs', {
  workspaceId: text('workspace_id').primaryKey(),
  deliveryMode: text('delivery_mode').$type<RuntimeEnvironmentConfig['mode']>().notNull(),
  fileName: text('file_name'),
  contentEncrypted: text('content_encrypted').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workspaceEnvironmentTemplateConfigs = pgTable('workspace_environment_template_configs', {
  workspaceId: text('workspace_id').primaryKey(),
  templateJson: jsonb('template_json').$type<ProjectEnvironmentTemplate>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const previewSessions = pgTable('preview_sessions', {
  id: text('id').primaryKey(),
  purpose: text('purpose').$type<PreviewSessionRecord['purpose']>().notNull(),
  projectId: text('project_id').notNull(),
  taskId: text('task_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  workspaceSessionId: text('workspace_session_id').notNull(),
  executorId: text('executor_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  executionSurface: text('execution_surface').$type<PreviewSessionRecord['executionSurface']>().notNull(),
  accessMode: text('access_mode').$type<PreviewSessionRecord['accessMode']>().notNull(),
  status: text('status').$type<PreviewSessionRecord['status']>().notNull(),
  closeReason: text('close_reason').$type<PreviewSessionRecord['closeReason']>(),
  sourceJson: jsonb('source_json').$type<{
    source: PreviewSessionRecord['source']
    sourceBinding?: PreviewSessionRecord['sourceBinding']
    additionalSources?: PreviewSessionRecord['additionalSources']
    additionalSourceBindings?: PreviewSessionRecord['additionalSourceBindings']
  } | PreviewSessionRecord['source']>().notNull(),
  publicHost: text('public_host').notNull(),
  publicUrl: text('public_url').notNull(),
  tunnelTokenHash: text('tunnel_token_hash').notNull(),
  tunnelConnectedAt: text('tunnel_connected_at'),
  tunnelDisconnectedAt: text('tunnel_disconnected_at'),
  tunnelClientStatus: text('tunnel_client_status').$type<PreviewSessionRecord['tunnelClientStatus']>(),
  tunnelConnectionId: text('tunnel_connection_id'),
  tunnelConnectedNodeId: text('tunnel_connected_node_id'),
  shareTokenHash: text('share_token_hash'),
  shareUrl: text('share_url'),
  shareTokenExpiresAt: text('share_token_expires_at'),
  shareRevokedAt: text('share_revoked_at'),
  lastShareIssuedAt: text('last_share_issued_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('preview_sessions_workspace_idx').on(table.workspaceSessionId, table.updatedAt.desc()),
  index('preview_sessions_owner_idx').on(table.ownerUserId, table.updatedAt.desc()),
  index('preview_sessions_public_host_idx').on(table.publicHost),
  index('preview_sessions_task_workspace_purpose_idx').on(table.taskId, table.workspaceId, table.purpose, table.updatedAt.desc()),
])

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
})

export const storageChangeEvents = pgTable('storage_change_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tableName: text('table_name').notNull(),
  operation: text('operation').$type<'INSERT' | 'UPDATE' | 'DELETE'>().notNull(),
  eventKey: text('event_key').unique(),
  sourceNodeId: text('source_node_id'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('storage_change_events_changed_at_idx').on(table.changedAt),
])

export const activeFreeExecutionSessions = pgTable('active_free_execution_sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  sessionKey: text('session_key').notNull(),
  kind: text('kind').$type<'main_chat' | 'custom_agent_chat' | 'task_chat' | 'workspace_group_chat'>().notNull(),
  startedAt: text('started_at').notNull(),
}, (table) => [
  index('active_free_execution_sessions_user_id_idx').on(table.userId),
  index('active_free_execution_sessions_started_at_idx').on(table.startedAt),
])

export const modelProfiles = pgTable('model_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  visibility: text('visibility').$type<ModelProfile['visibility']>().notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  teamId: text('team_id'),
  workspaceId: text('workspace_id'),
  source: text('source').$type<ModelProfileSource>().notNull(),
  sourceExecutorId: text('source_executor_id'),
  enabled: boolean('enabled').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_model_profiles_owner_user_id').on(table.ownerUserId),
  index('idx_model_profiles_team_id').on(table.teamId),
])

export const modelProfileBindings = pgTable('model_profile_bindings', {
  id: text('id').primaryKey(),
  modelProfileId: text('model_profile_id').notNull(),
  agentType: text('agent_type').$type<AgentType>().notNull(),
  providerId: text('provider_id').notNull(),
  modelId: text('model_id').notNull(),
  label: text('label').notNull(),
  baseUrl: text('base_url'),
  apiTokenEncrypted: text('api_token_encrypted'),
  isDefault: boolean('is_default').notNull(),
  runtimeSettingsJson: jsonb('runtime_settings_json').$type<ModelProfileRuntimeSettings>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_model_profile_bindings_profile_id').on(table.modelProfileId),
])

export const telegramChats = pgTable('telegram_chats', {
  chatId: text('chat_id').notNull(),
  threadId: text('thread_id'),
  type: text('type').$type<'group' | 'main' | 'task'>().notNull(),
  entityId: text('entity_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  // (chat_id, thread_id) 唯一，但 thread_id 可为空（main/group 无 topic 会话）。
  // 原复合主键会把 thread_id 隐式变 NOT NULL，null thread_id 会静默插不进去；
  // 改用 NULLS NOT DISTINCT 唯一约束（PG15+）既保唯一又允许 null。
  unique('telegram_chats_chat_thread_key').on(table.chatId, table.threadId).nullsNotDistinct(),
])

export const telegramSessions = pgTable('telegram_sessions', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  threadId: text('thread_id'),
  userId: text('user_id'),
  stateJson: jsonb('state_json').$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('telegram_sessions_chat_idx').on(table.chatId, table.threadId),
])

export const executionEventLogs = pgTable('execution_event_logs', {
  id: text('id').primaryKey(),
  occurredAt: text('occurred_at').notNull(),
  eventType: text('event_type').$type<ExecutionEventType>().notNull(),
  severity: text('severity').$type<ExecutionEventSeverity>().notNull(),
  isFailure: boolean('is_failure').notNull(),
  message: text('message').notNull(),
  payloadSummary: text('payload_summary').notNull(),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  executorId: text('executor_id'),
  executorName: text('executor_name'),
  taskId: text('task_id'),
  originTaskId: text('origin_task_id'),
  projectId: text('project_id'),
  ownerUserId: text('owner_user_id'),
  teamId: text('team_id'),
  layer: text('layer').$type<ExecutionEventLayer>(),
}, (table) => [
  index('execution_event_logs_occurred_at_idx').on(table.occurredAt.desc()),
  index('execution_event_logs_task_idx').on(table.taskId, table.occurredAt.desc()),
  index('execution_event_logs_origin_task_idx').on(table.originTaskId, table.occurredAt.desc()),
  index('execution_event_logs_executor_idx').on(table.executorId, table.occurredAt.desc()),
  index('execution_event_logs_project_idx').on(table.projectId, table.occurredAt.desc()),
  index('execution_event_logs_owner_idx').on(table.ownerUserId, table.occurredAt.desc()),
  index('execution_event_logs_type_idx').on(table.eventType, table.occurredAt.desc()),
  index('execution_event_logs_layer_idx').on(table.layer, table.occurredAt.desc()),
  index('execution_event_logs_failure_idx').on(table.isFailure, table.occurredAt.desc()),
])

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').$type<AutomationRecord['status']>().notNull(),
  priority: text('priority').$type<AutomationRecord['priority']>().notNull(),
  difficulty: text('difficulty').$type<AutomationRecord['difficulty']>().notNull(),
  agentType: text('agent_type').$type<AutomationRecord['agentType']>().notNull(),
  executionModel: text('execution_model'),
  opencodeConfigJson: jsonb('opencode_config_json').$type<AutomationRecord['opencodeConfig']>(),
  workspaceId: text('workspace_id').notNull(),
  workspaceSessionId: text('workspace_session_id'),
  baseBranch: text('base_branch'),
  returnMode: text('return_mode').$type<AutomationRecord['returnMode']>().notNull(),
  syncBackStrategy: text('sync_back_strategy').$type<AutomationRecord['syncBackStrategy']>().notNull(),
  gitIdentityMode: text('git_identity_mode').$type<AutomationRecord['gitIdentityMode']>().notNull(),
  concurrencyPolicy: text('concurrency_policy').$type<AutomationRecord['concurrencyPolicy']>().notNull(),
  catchUpPolicy: text('catch_up_policy').$type<AutomationRecord['catchUpPolicy']>().notNull(),
  taskTemplateJson: jsonb('task_template_json').$type<AutomationRecord['taskTemplate']>().notNull(),
  variablesJson: jsonb('variables_json').$type<AutomationRecord['variables']>().notNull(),
  lastTriggeredAt: text('last_triggered_at'),
  lastEnqueuedAt: text('last_enqueued_at'),
  legacyAgentId: text('legacy_agent_id'),
  legacyCronId: text('legacy_cron_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const automationTriggers = pgTable('automation_triggers', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull(),
  kind: text('kind').$type<AutomationTriggerRecord['kind']>().notNull(),
  label: text('label'),
  enabled: boolean('enabled').notNull(),
  cronExpression: text('cron_expression'),
  timezone: text('timezone'),
  nextRunAt: text('next_run_at'),
  signingMode: text('signing_mode').$type<AutomationTriggerRecord['signingMode']>(),
  secretEncrypted: text('secret_encrypted'),
  publicId: text('public_id'),
  replayWindowSec: integer('replay_window_sec'),
  lastFiredAt: text('last_fired_at'),
  lastResult: text('last_result'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_automation_triggers_due').on(table.kind, table.enabled, table.nextRunAt),
  index('idx_automation_triggers_public_id').on(table.publicId),
])

export const automationRuns = pgTable('automation_runs', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull(),
  triggerId: text('trigger_id'),
  source: text('source').$type<AutomationRunRecord['source']>().notNull(),
  status: text('status').$type<AutomationRunRecord['status']>().notNull(),
  triggerPayloadJson: jsonb('trigger_payload_json').$type<Record<string, unknown>>(),
  resolvedVariablesJson: jsonb('resolved_variables_json').$type<Record<string, string | number | boolean>>(),
  linkedTaskId: text('linked_task_id'),
  linkedTaskRunId: text('linked_task_run_id'),
  linkedDistributedTaskId: text('linked_distributed_task_id'),
  coalescedIntoRunId: text('coalesced_into_run_id'),
  failureReason: text('failure_reason'),
  idempotencyKey: text('idempotency_key'),
  triggeredAt: text('triggered_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_automation_runs_automation_id').on(table.automationId, table.createdAt.desc()),
  index('idx_automation_runs_linked_task_id').on(table.linkedTaskId),
])

export const executorPairingCodes = pgTable('executor_pairing_codes', {
  pairingCode: text('pairing_code').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  teamId: text('team_id'),
  workspaceIdsJson: jsonb('workspace_ids_json').$type<string[]>().notNull(),
  visibility: text('visibility').$type<ExecutorPairingCodeRecord['visibility']>().notNull(),
  previewExposureMode: text('preview_exposure_mode').$type<ExecutorPairingCodeRecord['previewExposureMode']>(),
  label: text('label'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
}, (table) => [
  index('idx_executor_pairing_codes_owner_user_id').on(table.ownerUserId),
  index('idx_executor_pairing_codes_expires_at').on(table.expiresAt),
  index('idx_executor_pairing_codes_used_at').on(table.usedAt),
])

export const executors = pgTable('executors', {
  id: text('id').primaryKey(),
  machineId: text('machine_id').notNull(),
  machineName: text('machine_name').notNull(),
  name: text('name').notNull(),
  connectedNodeId: text('connected_node_id'),
  previewExposureMode: text('preview_exposure_mode').$type<ExecutorDescriptor['previewExposureMode']>(),
  previewIngressPort: integer('preview_ingress_port'),
  previewIngressBaseUrl: text('preview_ingress_base_url'),
  previewIngressDetectedPublicIp: text('preview_ingress_detected_public_ip'),
  previewIngressDetectedLanIp: text('preview_ingress_detected_lan_ip'),
  previewIngressReachable: boolean('preview_ingress_reachable'),
  previewIngressLastCheckedAt: text('preview_ingress_last_checked_at'),
  previewIngressLastError: text('preview_ingress_last_error'),
  previewProxySecret: text('preview_proxy_secret'),
  executorSource: text('executor_source').$type<ExecutorDescriptor['executorSource']>().notNull(),
  managedBy: text('managed_by').$type<ExecutorDescriptor['managedBy']>().notNull(),
  runtimeClass: text('runtime_class').$type<ExecutorDescriptor['runtimeClass']>().notNull(),
  billingClass: text('billing_class').$type<ExecutorDescriptor['billingClass']>().notNull(),
  note: text('note'),
  ownerUserId: text('owner_user_id').notNull(),
  teamId: text('team_id'),
  workspaceIdsJson: jsonb('workspace_ids_json').$type<string[]>().notNull(),
  visibility: text('visibility').$type<ExecutorDescriptor['visibility']>().notNull(),
  status: text('status').$type<ExecutorDescriptor['status']>().notNull(),
  workspaceRoot: text('workspace_root').notNull(),
  maxConcurrency: integer('max_concurrency').notNull(),
  capabilitiesJson: jsonb('capabilities_json').$type<string[]>().notNull(),
  labelsJson: jsonb('labels_json').$type<string[]>().notNull(),
  sshPubkey: text('ssh_pubkey'),
  platform: text('platform'),
  version: text('version'),
  lastSeenAt: text('last_seen_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
}, (table) => [
  index('executors_owner_idx').on(table.ownerUserId, table.updatedAt.desc()),
])

export const projectIssues = pgTable('project_issues', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  projectId: text('project_id').notNull(),
  repoHost: text('repo_host').notNull(),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  repoFullName: text('repo_full_name').notNull(),
  repoUrl: text('repo_url').notNull(),
  number: integer('number').notNull(),
  url: text('url'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorLogin: text('author_login'),
  state: text('state').notNull(),
  labelsJson: jsonb('labels_json').$type<ProjectIssueLabelSummary[]>().notNull(),
  assigneeLoginsJson: jsonb('assignee_logins_json').$type<string[]>().notNull(),
  comments: integer('comments').notNull(),
  syncedAt: text('synced_at').notNull(),
  issueCreatedAt: text('issue_created_at'),
  issueUpdatedAt: text('issue_updated_at'),
  closedAt: text('closed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('project_issues_provider_repo_host_repo_owner_repo_name_number_key')
    .on(table.provider, table.repoHost, table.repoOwner, table.repoName, table.number),
  index('project_issues_project_updated_idx')
    .on(table.projectId, table.issueUpdatedAt.desc().nullsLast(), table.updatedAt.desc()),
  index('project_issues_repo_number_idx')
    .on(table.repoHost, table.repoOwner, table.repoName, table.number),
])

export const projectPullRequests = pgTable('project_pull_requests', {
  id: text('id').primaryKey(),
  provider: text('provider').$type<ProjectPullRequestReviewSummary['provider']>().notNull(),
  projectId: text('project_id').notNull(),
  repoHost: text('repo_host').notNull(),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  repoFullName: text('repo_full_name').notNull(),
  repoUrl: text('repo_url').notNull(),
  number: integer('number').notNull(),
  url: text('url'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorLogin: text('author_login'),
  state: text('state').$type<ProjectPullRequestReviewSummary['state']>().notNull(),
  merged: boolean('merged').notNull(),
  draft: boolean('draft').notNull(),
  baseBranch: text('base_branch').notNull(),
  compareBranch: text('compare_branch').notNull(),
  headOwner: text('head_owner'),
  headRepo: text('head_repo'),
  additions: integer('additions').notNull(),
  deletions: integer('deletions').notNull(),
  changedFiles: integer('changed_files').notNull(),
  filesJson: jsonb('files_json').$type<ProjectPullRequestFileSummary[]>().notNull(),
  matchedWorkspaceId: text('matched_workspace_id'),
  matchedWorkspaceSessionId: text('matched_workspace_session_id'),
  matchedTaskId: text('matched_task_id'),
  matchedTaskTitle: text('matched_task_title'),
  syncedAt: text('synced_at').notNull(),
  prCreatedAt: text('pr_created_at'),
  prUpdatedAt: text('pr_updated_at'),
  mergedAt: text('merged_at'),
  closedAt: text('closed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('project_pull_requests_provider_repo_host_repo_owner_repo_name_number_key')
    .on(table.provider, table.repoHost, table.repoOwner, table.repoName, table.number),
  index('project_pull_requests_project_updated_idx')
    .on(table.projectId, table.prUpdatedAt.desc().nullsLast(), table.updatedAt.desc()),
  index('project_pull_requests_workspace_idx')
    .on(table.matchedWorkspaceId, table.updatedAt.desc()),
  index('project_pull_requests_branch_idx')
    .on(table.projectId, table.compareBranch, table.baseBranch),
])

export const githubResourceBindings = pgTable('github_resource_bindings', {
  id: text('id').primaryKey(),
  provider: text('provider').$type<'github'>().notNull(),
  resourceType: text('resource_type').$type<GitHubResourceType>().notNull(),
  resourceId: text('resource_id').notNull(),
  projectId: text('project_id').notNull(),
  contextKey: text('context_key').notNull(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  role: text('role').$type<GitHubResourceBindingRole>().notNull(),
  status: text('status').$type<GitHubResourceBindingStatus>().notNull(),
  source: text('source').$type<GitHubResourceBindingSource>().notNull(),
  confidence: integer('confidence'),
  createdByUserId: text('created_by_user_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('github_resource_bindings_resource_context_role_key')
    .on(table.provider, table.resourceType, table.resourceId, table.contextKey, table.role),
  index('github_resource_bindings_project_resource_idx')
    .on(table.projectId, table.resourceType, table.resourceId),
  index('github_resource_bindings_task_idx')
    .on(table.taskId, table.status, table.updatedAt.desc()),
  index('github_resource_bindings_workspace_idx')
    .on(table.workspaceId, table.status, table.updatedAt.desc()),
  index('github_resource_bindings_session_idx')
    .on(table.workspaceSessionId, table.status, table.updatedAt.desc()),
])

export const githubProjectResources = pgTable('github_project_resources', {
  provider: text('provider').$type<'github'>().notNull(),
  resourceType: text('resource_type').$type<GitHubResourceType>().notNull(),
  resourceId: text('resource_id').notNull(),
  projectId: text('project_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({
    name: 'github_project_resources_resource_project_pk',
    columns: [table.provider, table.resourceType, table.resourceId, table.projectId],
  }),
  index('github_project_resources_project_idx')
    .on(table.projectId, table.resourceType, table.updatedAt.desc()),
  index('github_project_resources_resource_idx')
    .on(table.provider, table.resourceType, table.resourceId),
])

export const railwayConnections = pgTable('railway_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenEncrypted: text('token_encrypted').notNull(),
  accountEmail: text('account_email'),
  accountName: text('account_name'),
  status: text('status').$type<'connected' | 'error' | 'disconnected'>().notNull(),
  lastSyncedAt: text('last_synced_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('railway_connections_user_id_key').on(table.userId),
  index('railway_connections_user_idx').on(table.userId, table.updatedAt.desc()),
])

export const railwayProjects = pgTable('railway_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  primaryEnvironmentId: text('primary_environment_id'),
  syncedAt: text('synced_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('railway_projects_updated_idx').on(table.updatedAt.desc()),
])

export const railwayProjectResources = pgTable('railway_project_resources', {
  railwayProjectId: text('railway_project_id').notNull(),
  projectId: text('project_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({
    name: 'railway_project_resources_project_pk',
    columns: [table.railwayProjectId, table.projectId],
  }),
  index('railway_project_resources_project_idx')
    .on(table.projectId, table.updatedAt.desc()),
  index('railway_project_resources_railway_project_idx')
    .on(table.railwayProjectId),
])

export const railwayDeployments = pgTable('railway_deployments', {
  id: text('id').primaryKey(),
  railwayProjectId: text('railway_project_id').notNull(),
  environmentId: text('environment_id').notNull(),
  environmentName: text('environment_name').notNull(),
  isEphemeral: boolean('is_ephemeral').notNull(),
  prNumber: integer('pr_number'),
  prTitle: text('pr_title'),
  prRepo: text('pr_repo'),
  branch: text('branch'),
  baseBranch: text('base_branch'),
  serviceId: text('service_id'),
  serviceName: text('service_name'),
  status: text('status').$type<RailwayDeploymentStatus>().notNull(),
  url: text('url'),
  staticUrl: text('static_url'),
  isLatest: boolean('is_latest').notNull(),
  syncedAt: text('synced_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('railway_deployments_env_service_key')
    .on(table.railwayProjectId, table.environmentId, table.serviceId),
  index('railway_deployments_project_updated_idx')
    .on(table.railwayProjectId, table.updatedAt.desc()),
  index('railway_deployments_branch_idx')
    .on(table.railwayProjectId, table.branch),
  index('railway_deployments_env_idx')
    .on(table.environmentId, table.isLatest, table.updatedAt.desc()),
])

export const railwayResourceBindings = pgTable('railway_resource_bindings', {
  id: text('id').primaryKey(),
  provider: text('provider').$type<'railway'>().notNull(),
  resourceType: text('resource_type').$type<RailwayResourceType>().notNull(),
  resourceId: text('resource_id').notNull(),
  projectId: text('project_id').notNull(),
  contextKey: text('context_key').notNull(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  role: text('role').$type<RailwayResourceBindingRole>().notNull(),
  status: text('status').$type<RailwayResourceBindingStatus>().notNull(),
  source: text('source').$type<RailwayResourceBindingSource>().notNull(),
  confidence: integer('confidence'),
  createdByUserId: text('created_by_user_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('railway_resource_bindings_resource_context_role_key')
    .on(table.provider, table.resourceType, table.resourceId, table.contextKey, table.role),
  index('railway_resource_bindings_project_resource_idx')
    .on(table.projectId, table.resourceType, table.resourceId),
  index('railway_resource_bindings_task_idx')
    .on(table.taskId, table.status, table.updatedAt.desc()),
  index('railway_resource_bindings_workspace_idx')
    .on(table.workspaceId, table.status, table.updatedAt.desc()),
  index('railway_resource_bindings_session_idx')
    .on(table.workspaceSessionId, table.status, table.updatedAt.desc()),
])

export const projectWorkflowRuns = pgTable('project_workflow_runs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  projectId: text('project_id').notNull(),
  repoHost: text('repo_host').notNull(),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  repoFullName: text('repo_full_name').notNull(),
  repoUrl: text('repo_url').notNull(),
  runId: bigint('run_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  displayTitle: text('display_title').notNull(),
  runNumber: integer('run_number').notNull(),
  runAttempt: integer('run_attempt').notNull(),
  status: text('status').notNull(),
  conclusion: text('conclusion'),
  event: text('event').notNull(),
  headBranch: text('head_branch').notNull(),
  headSha: text('head_sha').notNull(),
  url: text('url'),
  syncedAt: text('synced_at').notNull(),
  runCreatedAt: text('run_created_at'),
  runUpdatedAt: text('run_updated_at'),
  runStartedAt: text('run_started_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('project_workflow_runs_provider_repo_host_repo_owner_repo_name_run_id_key')
    .on(table.provider, table.repoHost, table.repoOwner, table.repoName, table.runId),
  index('project_workflow_runs_project_updated_idx')
    .on(table.projectId, table.runUpdatedAt.desc().nullsLast(), table.updatedAt.desc()),
  index('project_workflow_runs_repo_run_idx')
    .on(table.repoHost, table.repoOwner, table.repoName, table.runId),
  index('project_workflow_runs_branch_idx')
    .on(table.projectId, table.headBranch),
])

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').$type<'online' | 'offline' | 'error'>().notNull(),
  endpoint: text('endpoint'),
  configJson: jsonb('config_json').$type<Record<string, unknown>>().notNull(),
  ownerUserId: text('owner_user_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastHeartbeatAt: text('last_heartbeat_at'),
}, (table) => [
  index('agents_owner_idx').on(table.ownerUserId, table.updatedAt.desc()),
])

export const agentTasks = pgTable('agent_tasks', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  type: text('type').notNull(),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  status: text('status').$type<'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'>().notNull(),
  resultJson: jsonb('result_json').$type<Record<string, unknown>>(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('agent_tasks_agent_idx').on(table.agentId, table.createdAt.desc()),
])

export const agentTaskRuns = pgTable('agent_task_runs', {
  id: text('id').primaryKey(),
  agentTaskId: text('agent_task_id').notNull(),
  eventId: text('event_id').notNull(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id'),
  projectId: text('project_id'),
  conversationSessionId: text('conversation_session_id'),
  attempt: integer('attempt').notNull(),
  retrySource: text('retry_source').$type<'initial' | 'manual' | 'infrastructure'>().notNull(),
  retrySessionMode: text('retry_session_mode').$type<'resume' | 'fresh'>(),
  status: text('status').$type<AgentTaskRunStatus>().notNull(),
  failureCode: text('failure_code').$type<AgentTaskRunFailureCode>(),
  failureMessage: text('failure_message'),
  transcriptJson: jsonb('transcript_json').$type<ChatMessage[]>().notNull(),
  usageJson: jsonb('usage_json').$type<ModelTokenUsage>(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  lastHeartbeatAt: text('last_heartbeat_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('agent_task_runs_agent_task_id_key').on(table.agentTaskId),
  unique('agent_task_runs_event_id_key').on(table.eventId),
  index('agent_task_runs_task_created_idx').on(table.taskId, table.createdAt.desc()),
  index('agent_task_runs_status_heartbeat_idx').on(table.status, table.lastHeartbeatAt),
])

export const agentCrons = pgTable('agent_crons', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull(),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
  createdAt: text('created_at').notNull(),
})

export const agentHeartbeats = pgTable('agent_heartbeats', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  metricsJson: jsonb('metrics_json').$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('agent_heartbeats_agent_created_idx').on(table.agentId, table.createdAt),
])

export const skills = pgTable('skills', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  markdown: text('markdown').notNull(),
  sourceType: text('source_type').$type<SkillSourceType>().notNull(),
  enabled: boolean('enabled').notNull(),
  visibility: text('visibility').$type<WorkspaceResourceVisibility>().notNull(),
  ownerUserId: text('owner_user_id'),
  workspaceId: text('workspace_id'),
  sourceLocator: text('source_locator'),
  sourceRef: text('source_ref'),
  trustLevel: text('trust_level').$type<SkillTrustLevel>().notNull(),
  compatibility: text('compatibility').$type<SkillCompatibility>().notNull(),
  fileInventoryJson: jsonb('file_inventory_json').$type<SkillFileInventoryEntry[]>().notNull(),
  filesJson: jsonb('files_json').$type<Record<string, SkillFileContent | string>>().notNull(),
  categoriesJson: jsonb('categories_json').$type<string[]>().notNull(),
  currentVersionId: text('current_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_skills_owner_user_id').on(table.ownerUserId),
  index('idx_skills_workspace_id').on(table.workspaceId),
])

export const skillVersions = pgTable('skill_versions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  markdown: text('markdown').notNull(),
  fileInventoryJson: jsonb('file_inventory_json').$type<SkillFileInventoryEntry[]>().notNull(),
  filesJson: jsonb('files_json').$type<Record<string, SkillFileContent | string>>().notNull(),
  sourceLocator: text('source_locator'),
  sourceRef: text('source_ref'),
  trustLevel: text('trust_level').$type<SkillTrustLevel>().notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
}, (table) => [
  unique('skill_versions_skill_id_version_number_key').on(table.skillId, table.versionNumber),
  index('skill_versions_skill_id_idx').on(table.skillId, table.versionNumber.desc()),
])

export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  projectId: text('project_id'),
  taskId: text('task_id'),
  runtime: text('runtime').$type<AgentType>().notNull(),
  mode: text('mode').$type<'assist' | 'coordinate' | 'managed'>().notNull(),
  status: text('status').$type<'running' | 'waiting' | 'completed' | 'failed'>().notNull(),
  agentSessionId: text('agent_session_id'),
  contextSnapshotJson: jsonb('context_snapshot_json').$type<Record<string, unknown>>(),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('agent_sessions_task_idx').on(table.taskId, table.updatedAt.desc()),
  index('agent_sessions_runtime_session_idx').on(table.agentSessionId, table.updatedAt.desc()),
])

export const agentActions = pgTable('agent_actions', {
  id: text('id').primaryKey(),
  agentSessionId: text('agent_session_id').notNull(),
  actionType: text('action_type').notNull(),
  capabilityName: text('capability_name'),
  inputJson: jsonb('input_json').$type<Record<string, unknown>>(),
  resultJson: jsonb('result_json').$type<Record<string, unknown>>(),
  status: text('status').$type<'started' | 'completed' | 'failed' | 'waiting_approval'>().notNull(),
  approvalStatus: text('approval_status').$type<'not_required' | 'pending' | 'approved' | 'rejected'>().notNull(),
  riskLevel: text('risk_level').$type<'low' | 'medium' | 'high'>().notNull(),
  errorMessage: text('error_message'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
}, (table) => [
  index('agent_actions_session_idx').on(table.agentSessionId, table.startedAt.desc()),
])

export const approvalRequests = pgTable('approval_requests', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  agentActionId: text('agent_action_id').notNull(),
  requestedByAgentSessionId: text('requested_by_agent_session_id').notNull(),
  approverUserId: text('approver_user_id'),
  title: text('title').notNull(),
  detail: text('detail'),
  status: text('status').$type<'pending' | 'approved' | 'rejected' | 'expired'>().notNull(),
  riskLevel: text('risk_level').$type<'low' | 'medium' | 'high'>().notNull(),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('approval_requests_status_idx').on(table.status, table.createdAt.desc()),
])

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  projectId: text('project_id'),
  taskId: text('task_id'),
  conversationId: text('conversation_id'),
  agentSessionId: text('agent_session_id'),
  approvalRequestId: text('approval_request_id'),
  channelBindingId: text('channel_binding_id'),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type').$type<'user' | 'agent' | 'system' | 'channel'>().notNull(),
  actorId: text('actor_id'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('audit_logs_task_idx').on(table.taskId, table.createdAt.desc()),
  index('audit_logs_conversation_idx').on(table.conversationId, table.createdAt.desc()),
])

/**
 * 人与 Agent 共用的收件箱。收件人是 (recipientType, recipientId)，
 * 取代原先的 task_comment_notifications 与 workspace_group_chat_mention_notifications。
 */
export const inboxItems = pgTable('inbox_items', {
  id: text('id').primaryKey(),
  recipientType: text('recipient_type').$type<InboxRecipientType>().notNull(),
  recipientId: text('recipient_id').notNull(),
  kind: text('kind').$type<InboxItemKind>().notNull(),
  reason: text('reason').$type<InboxItemReason>().notNull(),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type').$type<InboxActorType>().notNull(),
  actorId: text('actor_id'),
  actorName: text('actor_name').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  scopeJson: jsonb('scope_json').$type<InboxScope>().notNull(),
  groupKey: text('group_key').notNull(),
  replyToJson: jsonb('reply_to_json').$type<InboxReplyTarget>().notNull(),
  traceId: text('trace_id').notNull(),
  chainStartedAt: text('chain_started_at').notNull(),
  sourceInboxItemId: text('source_inbox_item_id'),
  hopCount: integer('hop_count').notNull().default(0),
  dedupeKey: text('dedupe_key').notNull(),
  readAt: text('read_at'),
  snoozedUntil: text('snoozed_until'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  unique('inbox_items_recipient_dedupe_key').on(table.recipientType, table.recipientId, table.dedupeKey),
  index('inbox_items_recipient_open_idx')
    .on(table.recipientType, table.recipientId, table.archivedAt, table.readAt, table.createdAt.desc()),
  index('inbox_items_recipient_group_idx')
    .on(table.recipientType, table.recipientId, table.groupKey, table.createdAt.desc()),
  index('inbox_items_snooze_idx').on(table.snoozedUntil),
  index('inbox_items_trace_idx').on(table.traceId),
])

export const agentTaskInboxItems = pgTable('agent_task_inbox_items', {
  agentTaskId: text('agent_task_id').notNull(),
  inboxItemId: text('inbox_item_id').notNull(),
  relation: text('relation').$type<'primary' | 'coalesced' | 'retry' | 'resume'>().notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.agentTaskId, table.inboxItemId] }),
  index('agent_task_inbox_items_task_idx').on(table.agentTaskId),
  index('agent_task_inbox_items_item_idx').on(table.inboxItemId),
])

// --- 会议智能（feature 云端三通道，feature 承接） ---

/// 会议实体：端侧判定 → 云端创建/更新（feature §8.3）
export const meetingEntities = pgTable('meeting_entities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  roomId: text('room_id'),
  deviceId: text('device_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  speakerIds: jsonb('speaker_ids').$type<string[]>().notNull().default([]),
  status: text('status').$type<'active' | 'closed'>().notNull(),
  summary: text('summary'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('meeting_entities_user_idx').on(table.userId),
])

/// 价值片段：通道① cloud_db 的结构化落库（feature §8.2）
export const meetingSegments = pgTable('meeting_segments', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id'),
  userId: text('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  roomId: text('room_id'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  durationSec: integer('duration_sec').notNull(),
  transcript: text('transcript').notNull(),
  speakerId: text('speaker_id'),
  valueLabel: text('value_label'),
  confidence: real('confidence'),
  channels: jsonb('channels').$type<string[]>().notNull(),
  isMeeting: boolean('is_meeting').notNull(),
  meetingTitle: text('meeting_title'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('meeting_segments_user_idx').on(table.userId),
  index('meeting_segments_meeting_idx').on(table.meetingId),
])

/// 推送设备 token 注册（feature 离线推送网关的端侧注册表）
export const deviceTokens = pgTable('device_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  platform: text('platform').$type<'android' | 'ios'>().notNull(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('device_tokens_user_idx').on(table.userId),
  unique('device_tokens_user_token_idx').on(table.userId, table.token),
])

// Core / high-risk tables used by auth, conversation, distributed-task, app-state, session history.
export * from './schema-core'
