// [INPUT]: Shared persisted domain contracts and Drizzle PostgreSQL column builders.
// [OUTPUT]: Core control-plane tables, including task collaboration comments, subscriber IDs, and per-message finish reasons.
// [POS]: Authoritative Drizzle schema for core app state; DDL changes require generated migrations.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { sql } from 'drizzle-orm'
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import type { UsageEventBillingStatus, UsageEventRunKind, UsageEventTokenCounts } from '@shared/usage-events'
import type {
  AgentRunningStatus,
  AgentType,
  ClusterNode,
  CreatorIdentity,
  DistributedTask,
  DriveFileContentType,
  DriveFileType,
  DriveFileVisibility,
  DrivePermissionRole,
  DrivePermissionPrincipalType,
  DriveFileShareRecord,
  ConversationMentionScope,
  ConversationMentionStatus,
  ConversationMentionType,
  ConversationShareAccessScope,
  ConversationShareType,
  ProfileVisibility,
  WorkRecordType,
  WorkRecordTargetType,
  MessageFinishReason,
  MessagePart,
  MessageReaction,
  MessageRole,
  ModelTokenUsage,
  Project,
  ProjectBinding,
  ProjectCommandPreset,
  ProjectEnvironmentTemplate,
  Task,
  TaskCommentMention,
  TaskRun,
  TaskWorkspaceBinding,
  TeamRole,
  ThreadRuntimeState,
  WorkspaceLocalWorktree,
  WorkspacePresenceState,
  WorkspaceRecord,
  WorkspaceSession,
  WorkspaceSessionPendingRevision,
  WorkspaceSessionRuntimeStatus,
  FeedbackType,
  FeedbackStatus,
  FeedbackSource,
  FeedbackOriginRef,
  FeedbackNormalized,
  FeedbackGithubRef,
  FeedbackRoutingTarget,
  TelemetryEventType,
} from '@shared/types'
import type {
  WorkspaceSessionEventRecord,
  WorkspaceSessionTurnRecord,
} from '@shared/workspace-session-history'
import type { ToolCall } from '@shared/types'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatContextRef } from '@shared/task-chat-context'
import type { TaskChatMessageRuntimeConfig } from '@shared/task-chat-session'

export const userStatus = ['active', 'suspended', 'banned'] as const
export type UserStatus = (typeof userStatus)[number]

export const userRole = ['user', 'admin', 'owner'] as const
export type UserRole = (typeof userRole)[number]

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  /** 用户 ID（@username）：全局唯一、可搜索；老用户回填前为 null */
  username: text('username').unique(),
  /** 用户 ID 最近修改时间（修改后 30 天冷静期） */
  usernameUpdatedAt: text('username_updated_at'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  onboardingCompletedAt: text('onboarding_completed_at'),
  onboardingDismissedAt: text('onboarding_dismissed_at'),
  onboardingPath: text('onboarding_path').$type<'existing-repo' | 'quickstart' | 'team'>(),
  authProvider: text('auth_provider').$type<'password' | 'google'>().notNull(),
  isInternal: boolean('is_internal').notNull(),
  /** 账号状态：active / suspended（停用）/ banned（封禁） */
  status: text('status').$type<UserStatus>().notNull().default('active'),
  /** 角色：user / admin / owner（owner=总管理员，isInternal 保留为兼容位） */
  role: text('role').$type<UserRole>().notNull().default('user'),
  emailVerifiedAt: text('email_verified_at'),
  lastLoginAt: text('last_login_at'),
  lastLoginIp: text('last_login_ip'),
  suspendedUntil: text('suspended_until'),
  bannedReason: text('banned_reason'),
  bannedAt: text('banned_at'),
  supportNote: text('support_note'),
  /** 客服备注工作状态：pending / in_progress / resolved（null = 未设置备注状态） */
  supportNoteStatus: text('support_note_status').$type<'pending' | 'in_progress' | 'resolved'>(),
  initialAgentProvisionedAt: text('initial_agent_provisioned_at'),
  /** 账号归属合作商（"他们是哪家公司的人"）；null = 非合作商账号 */
  partnerId: text('partner_id'),
  createdAt: text('created_at').notNull(),
})

/**
 * 登录 / 验证 / 账号安全事件（登录记录、验证邮件、封禁等）。
 * 与 audit_logs 分工：auth_events=用户侧安全审计；audit_logs=管理操作审计。
 */
export const authEvents = pgTable('auth_events', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  email: text('email'),
  eventType: text('event_type').notNull(),
  provider: text('provider'),
  result: text('result').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('auth_events_user_created_idx').on(table.userId, table.createdAt.desc()),
  index('auth_events_email_created_idx').on(table.email, table.createdAt.desc()),
])

export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id').primaryKey(),
  /** 职位/角色，如「前端工程师」 */
  title: text('title'),
  /** 所属部门/团队（自由文本标签，仅展示） */
  department: text('department'),
  /** 技能标签 */
  skills: jsonb('skills').$type<string[] | null>(),
  /** 当前周期 OKR */
  okrJson: jsonb('okr_json').$type<unknown>(),
  /** 最近工作摘要（由 Agent 定期生成） */
  workSummaryJson: jsonb('work_summary_json').$type<unknown>(),
  visibility: text('visibility').$type<ProfileVisibility>().notNull().default('team'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentProfiles = pgTable('agent_profiles', {
  /** custom agent id */
  agentId: text('agent_id').primaryKey(),
  /** 身份描述 */
  identityJson: jsonb('identity_json').$type<unknown>().notNull(),
  /** Agent OKR */
  okrJson: jsonb('okr_json').$type<unknown>(),
  /** 活动日志摘要 */
  activityLogJson: jsonb('activity_log_json').$type<unknown>(),
  /** 健康评分 0-1 */
  healthScore: doublePrecision('health_score'),
  lastActiveAt: text('last_active_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workRecords = pgTable('work_records', {
  id: text('id').primaryKey(),
  actorType: text('actor_type').$type<'user' | 'agent'>().notNull(),
  actorId: text('actor_id').notNull(),
  recordType: text('record_type').$type<WorkRecordType>().notNull(),
  targetType: text('target_type').$type<WorkRecordTargetType>().notNull(),
  targetId: text('target_id'),
  title: text('title').notNull(),
  summary: text('summary'),
  metadataJson: jsonb('metadata_json').$type<unknown>(),
  occurredAt: text('occurred_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('work_records_actor_idx').on(table.actorType, table.actorId, table.occurredAt),
  index('work_records_target_idx').on(table.targetType, table.targetId),
])

export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const collabWorkspaces = pgTable('collab_workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  ownerUserId: text('owner_user_id').notNull(),
  /** 组织归属合作商（"组织归部署代理"）；null = 普通组织 */
  partnerId: text('partner_id'),
  /** 调度大脑（feature）：协作空间级开关，默认关闭 */
  brainEnabled: boolean('brain_enabled').notNull().default(false),
  /** 调度大脑 Agent id（群负责人优先，可显式指定） */
  brainAgentId: text('brain_agent_id'),
  /** 调度大脑行为提示词/注意事项（用户可编辑，覆盖默认模板） */
  brainInstructions: text('brain_instructions'),
  legacyTeamId: text('legacy_team_id').unique(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('collab_workspaces_partner_idx').on(table.partnerId),
])

export const collabWorkspaceMembers = pgTable('collab_workspace_members', {
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').$type<TeamRole>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
])

export const collabWorkspaceProjects = pgTable('collab_workspace_projects', {
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.projectId] }),
])

export const driveFiles = pgTable('drive_files', {
  id: text('id').primaryKey(),
  /** 所属协作组织（collab_workspaces.id）；null = 个人文件 */
  workspaceId: text('workspace_id'),
  /** 父目录（folder 的 id）；null = 根目录 */
  parentId: text('parent_id'),
  name: text('name').notNull(),
  /** 'folder' | 'file'；目录也是 drive_files 一行，靠 parent_id 组树 */
  fileType: text('file_type').$type<DriveFileType>().notNull(),
  /** 文件 MIME 类型（folder 为 null） */
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  /** 对象存储路径（folder 为 null） */
  s3Key: text('s3_key'),
  thumbnailS3Key: text('thumbnail_s3_key'),
  /** 文件内容大类：document / image / video / archive / code / other */
  contentType: text('content_type').$type<DriveFileContentType>().notNull().default('other'),
  /** 提取的纯文本（md/html/txt 等可读文件，供全文搜索 ILIKE 匹配）；二进制为 null */
  searchText: text('search_text'),
  version: integer('version').notNull().default(1),
  visibility: text('visibility').$type<DriveFileVisibility>().notNull().default('team'),
  /** 回收站软删标记（R8.3 生命周期）：null = 正常；非空 = 已移入回收站，到期物理删除。 */
  deletedAt: text('deleted_at'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('drive_files_workspace_idx').on(table.workspaceId, table.parentId, table.name),
  index('drive_files_deleted_at_idx').on(table.deletedAt),
])

/**
 * 工作区大脑（Wemux Brain）纳入的云盘文件：用户把云盘文件设为大脑上下文，
 * 大脑整理出 digest 供 Agent 快上下文引用。文件更新（digestAt < file.updatedAt）时重新整理。
 */
export const workspaceBrainFiles = pgTable('workspace_brain_files', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  fileId: text('file_id').notNull(),
  /** 大脑整理后的文件摘要（要点/约定/结论） */
  digest: text('digest'),
  enabled: boolean('enabled').notNull().default(true),
  /** 最后整理时间（对比 file.updatedAt 判断过期） */
  digestAt: text('digest_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('workspace_brain_files_ws_idx').on(table.workspaceId),
  index('workspace_brain_files_file_idx').on(table.fileId),
  uniqueIndex('workspace_brain_files_ws_file_uq').on(table.workspaceId, table.fileId),
])

/**
 * 附件引用索引（R8.3 孤儿判定基础）：记录 Drive 文件被哪些会话消息/任务评论引用。
 * 孤儿 = 无任何引用记录；引用删除时同步清理本表。
 */
export const driveFileReferences = pgTable('drive_file_references', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull(),
  /** 'conversation_message' | 'task_comment' | 'task' */
  refType: text('ref_type').$type<'conversation_message' | 'task_comment' | 'task'>().notNull(),
  refId: text('ref_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  unique('drive_file_references_file_ref_key').on(table.fileId, table.refType, table.refId),
  index('drive_file_references_ref_idx').on(table.refType, table.refId),
])

export const driveFileShares = pgTable('drive_file_shares', {
  fileId: text('file_id').primaryKey(),
  /** 分享 token（匿名访问凭据，URL 安全） */
  token: text('token').notNull().unique(),
  /** 过期时间；null = 永久有效 */
  expiresAt: text('expires_at'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
})

export const driveFileVersions = pgTable('drive_file_versions', {
  id: text('id').primaryKey(),
  fileId: text('file_id').notNull(),
  version: integer('version').notNull(),
  s3Key: text('s3_key').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('drive_file_versions_file_idx').on(table.fileId, table.version),
])

export const driveFilePermissions = pgTable('drive_file_permissions', {
  fileId: text('file_id').notNull(),
  /** 'user' | 'agent' | 'workspace' */
  principalType: text('principal_type').$type<DrivePermissionPrincipalType>().notNull(),
  principalId: text('principal_id').notNull(),
  /** 'owner' | 'manage' | 'edit' | 'read' */
  role: text('role').$type<DrivePermissionRole>().notNull(),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.fileId, table.principalType, table.principalId] }),
])

export const teamMembers = pgTable('team_members', {
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').$type<TeamRole>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.userId] }),
])

export const teamInvitations = pgTable('team_invitations', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  email: text('email').notNull(),
  role: text('role').$type<TeamRole>().notNull(),
  invitedBy: text('invited_by').notNull(),
  status: text('status').$type<'pending' | 'accepted' | 'declined' | 'expired'>().notNull(),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
})

export const teamActivities = pgTable('team_activities', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  detailsJson: jsonb('details_json').$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
})

export const userProjects = pgTable('user_projects', {
  userId: text('user_id').notNull(),
  projectId: text('project_id').notNull(),
  accessType: text('access_type').$type<'owner' | 'member'>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.projectId] }),
])

export const teamProjects = pgTable('team_projects', {
  teamId: text('team_id').notNull(),
  projectId: text('project_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.projectId] }),
])

export const personalAccessTokens = pgTable('personal_access_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('personal_access_tokens_user_id_idx').on(table.userId),
  index('personal_access_tokens_hash_idx').on(table.tokenHash),
])

export const revokedAuthTokens = pgTable('revoked_auth_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at').notNull(),
}, (table) => [
  index('revoked_auth_tokens_expires_at_idx').on(table.expiresAt),
])

export const projectGitCredentialBindings = pgTable('project_git_credential_bindings', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  credentialId: text('credential_id'),
  authSourceType: text('auth_source_type').notNull(),
  githubInstallationId: bigint('github_installation_id', { mode: 'number' }),
  githubRepositoryId: bigint('github_repository_id', { mode: 'number' }),
  githubAccountLogin: text('github_account_login'),
  githubAccountType: text('github_account_type'),
  githubRepositoryName: text('github_repository_name'),
  providerHost: text('provider_host'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('project_git_credential_bindings_project_id_user_id_key').on(table.projectId, table.userId),
])

export const userGitCredentials = pgTable('user_git_credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  label: text('label').notNull(),
  provider: text('provider').$type<'github' | 'gitlab' | 'generic'>().notNull(),
  host: text('host').notNull(),
  authMode: text('auth_mode').$type<'pat' | 'ssh' | 'github-app'>().notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  patTokenEncrypted: text('pat_token_encrypted'),
  sshPublicKey: text('ssh_public_key'),
  sshPrivateKeyEncrypted: text('ssh_private_key_encrypted'),
  sshKeyFingerprint: text('ssh_key_fingerprint'),
  activatedAt: text('activated_at'),
  isDefault: boolean('is_default').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const githubAppInstallations = pgTable('github_app_installations', {
  installationId: bigint('installation_id', { mode: 'number' }).primaryKey(),
  accountId: bigint('account_id', { mode: 'number' }),
  accountLogin: text('account_login').notNull(),
  accountType: text('account_type').notNull(),
  provider: text('provider').$type<'github' | 'gitlab' | 'generic'>().notNull(),
  providerHost: text('provider_host').notNull(),
  repositorySelection: text('repository_selection').notNull(),
  permissionsJson: jsonb('permissions_json').$type<Record<string, string>>().notNull(),
  accessTokenEncrypted: text('access_token_encrypted'),
  accessTokenExpiresAt: text('access_token_expires_at'),
  suspendedAt: text('suspended_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const githubAppUserLinks = pgTable('github_app_user_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  installationId: bigint('installation_id', { mode: 'number' }).notNull(),
  commitAuthorName: text('commit_author_name'),
  commitAuthorEmail: text('commit_author_email'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('github_app_user_links_user_id_installation_id_key').on(table.userId, table.installationId),
])

export const githubAppConnectionStates = pgTable('github_app_connection_states', {
  stateHash: text('state_hash').primaryKey(),
  userId: text('user_id').notNull(),
  commitAuthorName: text('commit_author_name').notNull(),
  commitAuthorEmail: text('commit_author_email').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
})

export const githubAppUserAuths = pgTable('github_app_user_auths', {
  userId: text('user_id').primaryKey(),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workspaceResourceSyncLinks = pgTable('workspace_resource_sync_links', {
  sourceWorkspaceId: text('source_workspace_id').notNull(),
  targetWorkspaceId: text('target_workspace_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceWorkspaceId, table.targetWorkspaceId, table.ownerUserId] }),
])

export const workspacePresence = pgTable('workspace_presence', {
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  state: text('state').$type<WorkspacePresenceState>().notNull(),
  activeWorkspaceSessionId: text('active_workspace_session_id'),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  index('workspace_presence_last_seen_idx').on(table.lastSeenAt),
])

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayOrder: integer('display_order'),
  color: text('color'),
  workspaceId: text('workspace_id'),
  visibility: text('visibility').$type<Project['visibility']>().notNull(),
  gitUrl: text('git_url').notNull(),
  localPath: text('local_path').notNull(),
  versionControl: text('version_control').$type<Project['versionControl']>().notNull(),
  defaultBranch: text('default_branch').notNull(),
  preferredExecutorId: text('preferred_executor_id'),
  repositoryCloneStatus: text('repository_clone_status').$type<Project['repositoryCloneStatus']>(),
  repositoryCloneMessage: text('repository_clone_message'),
  commandPresetsJson: jsonb('command_presets_json').$type<ProjectCommandPreset[]>().notNull(),
  defaultCommandPresetId: text('default_command_preset_id'),
  environmentTemplateJson: jsonb('environment_template_json').$type<ProjectEnvironmentTemplate>(),
  recentBaseBranchesJson: jsonb('recent_base_branches_json').$type<string[]>().notNull(),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  parentTaskId: text('parent_task_id'),
  creatorJson: jsonb('creator_json').$type<CreatorIdentity>(),
  originType: text('origin_type').$type<Task['originType']>(),
  originId: text('origin_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  assigneeId: text('assignee_id'),
  assigneeAgentId: text('assignee_agent_id'),
  assigneeAgentGroupId: text('assignee_agent_group_id'),
  status: text('status').$type<Task['status']>().notNull(),
  agentType: text('agent_type').$type<Task['agentType']>().notNull(),
  executionModel: text('execution_model'),
  opencodeConfigJson: jsonb('opencode_config_json').$type<Task['opencodeConfig']>(),
  executionMode: text('execution_mode').$type<Task['executionMode']>().notNull(),
  agentManaged: text('agent_managed').$type<Task['agentManaged']>().notNull(),
  priority: text('priority').$type<Task['priority']>().notNull(),
  retryCount: integer('retry_count').notNull(),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  dueAt: text('due_at'),
  updatedAt: text('updated_at').notNull(),
  baseBranch: text('base_branch').notNull(),
  acceptanceCriteria: text('acceptance_criteria'),
  draftId: text('draft_id'),
  draftSavedAt: text('draft_saved_at'),
  recommendedTitle: text('recommended_title'),
  commandPresetId: text('command_preset_id'),
  baseBranchHint: text('base_branch_hint'),
  autoReviewJson: jsonb('auto_review_json').$type<Record<string, unknown>>(),
  requirementType: text('requirement_type').$type<Task['requirementType']>().notNull(),
  needsHumanConfirm: boolean('needs_human_confirm').notNull(),
  agentRunningStatus: text('agent_running_status').$type<AgentRunningStatus>().notNull(),
  currentStep: text('current_step').notNull(),
  /** 任务级附件（R8.5）：Drive 引用或上传副本，真相副本在 Drive 云盘。 */
  attachmentsJson: jsonb('attachments_json').$type<TaskChatAttachment[]>().notNull().default([]),
  /** 任务级表情反应（R8.5）：自由 emoji，{emoji, userIds} 列表。 */
  reactionsJson: jsonb('reactions_json').$type<MessageReaction[]>().notNull().default([]),
  /** 完成时间（R8.5）：status 流转到 done 时落时间戳（统计基础字段）。 */
  completedAt: text('completed_at'),
}, (table) => [
  uniqueIndex('tasks_origin_key')
    .on(table.originType, table.originId)
    .where(sql`${table.originId} is not null`),
  index('tasks_project_created_idx').on(table.projectId, table.createdAt.desc()),
])

export const taskCollaboration = pgTable('task_collaboration', {
  taskId: text('task_id').primaryKey(),
  commentsJson: jsonb('comments_json').$type<unknown[]>().notNull(),
  subscriberIdsJson: jsonb('subscriber_ids_json').$type<string[]>().notNull().default([]),
  toolCallsJson: jsonb('tool_calls_json').$type<ToolCall[]>().notNull(),
  historyJson: jsonb('history_json').$type<unknown[]>().notNull(),
  orchestrationJson: jsonb('orchestration_json').$type<unknown[]>().notNull(),
  validationChecksJson: jsonb('validation_checks_json').$type<unknown[]>().notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const taskRuns = pgTable('task_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  projectId: text('project_id').notNull(),
  distributedTaskId: text('distributed_task_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  executorNodeId: text('executor_node_id'),
  baseBranch: text('base_branch'),
  returnMode: text('return_mode'),
  gitIdentityMode: text('git_identity_mode'),
  agentSessionId: text('agent_session_id'),
  executionModel: text('execution_model'),
  usageJson: jsonb('usage_json').$type<ModelTokenUsage>(),
  status: text('status').$type<TaskRun['status']>().notNull(),
  summary: text('summary'),
  resultJson: jsonb('result_json').$type<TaskRun['result']>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('task_runs_task_created_idx').on(table.taskId, table.createdAt.desc()),
])

/**
 * 统一 token 用量事件表：所有 Agent 执行（task / main_chat / workspace_turn / agent_event）
 * 的 token 消耗收敛到唯一权威落点，按 (runKind, runId) 幂等去重。
 */
export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  runKind: text('run_kind').$type<UsageEventRunKind>().notNull(),
  runId: text('run_id').notNull(),
  userId: text('user_id').notNull(),
  agentId: text('agent_id'),
  agentName: text('agent_name'),
  conversationId: text('conversation_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  taskId: text('task_id'),
  projectId: text('project_id'),
  executorNodeId: text('executor_node_id'),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  executionModel: text('execution_model'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  /** 官方托管用量积分结算状态（Phase 2）：none 默认 / hosted_pending 待结算 / hosted_settled 已结算。 */
  billingStatus: text('billing_status').$type<UsageEventBillingStatus>().notNull().default('none'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  unique('usage_events_run_kind_run_id_key').on(table.runKind, table.runId),
  index('usage_events_user_created_idx').on(table.userId, table.createdAt.desc()),
  index('usage_events_agent_created_idx').on(table.agentId, table.createdAt.desc()),
  index('usage_events_workspace_created_idx').on(table.workspaceId, table.createdAt.desc()),
])



/**
 * 产品一手 telemetry 事件表：自有 analytics 数据源（漏斗 / 激活 / 留存），
 * 数据只进自家 Postgres，不发给任何第三方分析工具。
 */
export const telemetryEvents = pgTable('telemetry_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').$type<TelemetryEventType>().notNull(),
  userId: text('user_id'),
  teamId: text('team_id'),
  projectId: text('project_id'),
  workspaceId: text('workspace_id'),
  taskId: text('task_id'),
  executorNodeId: text('executor_node_id'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('telemetry_events_type_created_idx').on(table.eventType, table.createdAt.desc()),
  index('telemetry_events_user_created_idx').on(table.userId, table.createdAt.desc()),
  index('telemetry_events_created_idx').on(table.createdAt.desc()),
])

/**
 * 社区版匿名使用上报（collector 侧追加式表）：每个自托管实例按 installId 定期回传聚合计数，
 * 每次上报一行；不存任何内容类数据（仓库名/任务标题/用户内容），字段白名单见 shared community-usage。
 */
export const communityUsageReports = pgTable('community_usage_reports', {
  id: text('id').primaryKey(),
  installId: text('install_id').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  appVersion: text('app_version').notNull().default(''),
  os: text('os').notNull().default(''),
  deploymentMode: text('deployment_mode').notNull().default(''),
  usersTotal: integer('users_total').notNull().default(0),
  teamsTotal: integer('teams_total').notNull().default(0),
  tasksTotal: integer('tasks_total').notNull().default(0),
  conversationsTotal: integer('conversations_total').notNull().default(0),
  agentRunsTotal: integer('agent_runs_total').notNull().default(0),
  receivedAt: text('received_at').notNull(),
}, (table) => [
  index('community_usage_reports_install_received_idx').on(table.installId, table.receivedAt.desc()),
  index('community_usage_reports_received_idx').on(table.receivedAt.desc()),
])

/** 用户反馈（bug / 功能建议）：全渠道唯一收件箱（产品内/飞书/Discord/GitHub 反向同步）。 */
export const feedbackItems = pgTable('feedback_items', {
  id: text('id').primaryKey(),
  type: text('type').$type<FeedbackType>().notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').$type<FeedbackStatus>().notNull().default('open'),
  userId: text('user_id'),
  userEmail: text('user_email'),
  /** 客服会话（统一 conversation 模型）id；历史数据为空。 */
  conversationId: text('conversation_id'),
  source: text('source').$type<FeedbackSource>().notNull().default('product'),
  /** 渠道消息锚点（原路回复用）；产品内来源为空。 */
  originRef: jsonb('origin_ref').$type<FeedbackOriginRef>(),
  /** AI 规范化产物；原文永远保留在 body。 */
  normalized: jsonb('normalized').$type<FeedbackNormalized>(),
  /** 分诊去向：internal=受限维护队列 / community=公开仓 / none=仅客服闭环；空=未分诊。 */
  routing: text('routing').$type<FeedbackRoutingTarget>(),
  /** promote 到公开仓或受限维护队列后的 GitHub 引用。 */
  githubRef: jsonb('github_ref').$type<FeedbackGithubRef>(),
  /** 用户同意脱敏后公开为社区提案；默认 false，未同意的内容不出实例。 */
  consentPublic: boolean('consent_public').notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('feedback_items_status_created_idx').on(table.status, table.createdAt.desc()),
  index('feedback_items_user_created_idx').on(table.userId, table.createdAt.desc()),
])

export const taskWorkspaceBindings = pgTable('task_workspace_bindings', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  status: text('status').$type<TaskWorkspaceBinding['status']>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('task_workspace_bindings_task_id_workspace_id_key').on(table.taskId, table.workspaceId),
])

export const workspaceSessions = pgTable('workspace_sessions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  displayOrder: integer('display_order'),
  pinnedAt: text('pinned_at'),
  title: text('title').notNull(),
  titleOrigin: text('title_origin').$type<WorkspaceSession['titleOrigin']>().notNull(),
  status: text('status').$type<WorkspaceSession['status']>().notNull(),
  sessionKind: text('session_kind').$type<WorkspaceSession['sessionKind']>().notNull(),
  sessionRole: text('session_role').$type<WorkspaceSession['sessionRole']>().notNull(),
  sessionOrigin: text('session_origin').$type<WorkspaceSession['sessionOrigin']>().notNull(),
  parentSessionId: text('parent_session_id'),
  rootSessionId: text('root_session_id'),
  forkMode: text('fork_mode').$type<WorkspaceSession['forkMode']>(),
  forkedFromSessionId: text('forked_from_session_id'),
  forkedFromMessageId: text('forked_from_message_id'),
  forkRevisionJson: jsonb('fork_revision_json').$type<WorkspaceSession['forkRevision']>(),
  pendingRevisionJson: jsonb('pending_revision_json').$type<WorkspaceSessionPendingRevision>(),
  sharedWorktreeSourceSessionId: text('shared_worktree_source_session_id'),
  executorNodeId: text('executor_node_id'),
  agentType: text('agent_type').$type<AgentType>(),
  customAgentId: text('custom_agent_id'),
  customAgentName: text('custom_agent_name'),
  agentInvocationMode: text('agent_invocation_mode').$type<WorkspaceSession['agentInvocationMode']>(),
  mountedSkillNamesJson: jsonb('mounted_skill_names_json').$type<string[]>(),
  mountedMcpServerNamesJson: jsonb('mounted_mcp_server_names_json').$type<string[]>(),
  enabledMcpServerIdsJson: jsonb('enabled_mcp_server_ids_json').$type<string[]>(),
  delegatedPrompt: text('delegated_prompt'),
  executionModel: text('execution_model'),
  agentSettingsJson: jsonb('agent_settings_json').$type<WorkspaceSession['agentSettings']>(),
  opencodeConfigJson: jsonb('opencode_config_json').$type<WorkspaceSession['opencodeConfig']>(),
  gitIdentityMode: text('git_identity_mode').$type<WorkspaceSession['gitIdentityMode']>(),
  publishPolicy: text('publish_policy').$type<WorkspaceSession['publishPolicy']>().notNull(),
  gitAuthPreference: text('git_auth_preference').$type<WorkspaceSession['gitAuthPreference']>().notNull(),
  distributedTaskId: text('distributed_task_id'),
  agentSessionId: text('agent_session_id'),
  runtimeContinuationsJson: jsonb('runtime_continuations_json').$type<WorkspaceSession['runtimeContinuations']>(),
  handoffSnapshotJson: jsonb('handoff_snapshot_json').$type<WorkspaceSession['handoffSnapshot']>(),
  baseBranch: text('base_branch'),
  worktreeId: text('worktree_id').notNull(),
  worktreeUniqueId: integer('worktree_unique_id'),
  branchName: text('branch_name').notNull(),
  worktreeStatus: text('worktree_status').$type<WorkspaceSession['worktreeStatus']>().notNull(),
  workingDirectoryMode: text('working_directory_mode').$type<WorkspaceSession['workingDirectoryMode']>().notNull(),
  needsHumanConfirm: boolean('needs_human_confirm').notNull(),
  agentRunningStatus: text('agent_running_status').$type<AgentRunningStatus>().notNull(),
  runtimeStatus: text('runtime_status').$type<WorkspaceSessionRuntimeStatus>().notNull(),
  runtimeSessionId: text('runtime_session_id'),
  runtimeOwnerExecutorId: text('runtime_owner_executor_id'),
  runtimeStartedAt: text('runtime_started_at'),
  lastHeartbeatAt: text('last_heartbeat_at'),
  lastRuntimeEventAt: text('last_runtime_event_at'),
  terminalReason: text('terminal_reason'),
  runtimeSummaryJson: jsonb('runtime_summary_json').$type<WorkspaceSession['runtimeSummary']>(),
  deliverySummaryJson: jsonb('delivery_summary_json').$type<WorkspaceSession['deliverySummary']>(),
  runtimeSequence: integer('runtime_sequence').notNull(),
  currentStep: text('current_step').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('workspace_sessions_workspace_idx').on(table.workspaceId, table.updatedAt.desc()),
  index('workspace_sessions_executor_idx').on(table.executorNodeId),
  index('workspace_sessions_distributed_task_idx').on(table.distributedTaskId),
])

export const executionLogs = pgTable('execution_logs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('execution_logs_task_idx').on(table.taskId, table.createdAt.desc()),
  index('execution_logs_workspace_session_idx').on(table.workspaceSessionId, table.createdAt.desc()),
])

export const nodes = pgTable('nodes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url'),
  relayUrl: text('relay_url'),
  status: text('status').$type<ClusterNode['status']>().notNull(),
  version: text('version'),
  region: text('region'),
  maxConcurrentTasks: integer('max_concurrent_tasks').notNull(),
  lastHeartbeatAt: text('last_heartbeat_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const nodeCapabilities = pgTable('node_capabilities', {
  nodeId: text('node_id').notNull(),
  capability: text('capability').notNull(),
}, (table) => [
  primaryKey({ columns: [table.nodeId, table.capability] }),
])

export const projectBindings = pgTable('project_bindings', {
  projectId: text('project_id').notNull(),
  nodeId: text('node_id').notNull(),
  repoUrl: text('repo_url').notNull(),
  defaultBranch: text('default_branch').notNull(),
  pathHint: text('path_hint'),
  isActive: boolean('is_active').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.nodeId] }),
])

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  creatorJson: jsonb('creator_json').$type<CreatorIdentity>(),
  displayOrder: integer('display_order'),
  executorNodeId: text('executor_node_id').notNull(),
  agentType: text('agent_type').$type<AgentType>().notNull(),
  name: text('name').notNull(),
  status: text('status').$type<WorkspaceRecord['status']>().notNull(),
  repoReady: boolean('repo_ready').notNull(),
  repoPath: text('repo_path'),
  worktreeRootPath: text('worktree_root_path'),
  source: text('source').$type<WorkspaceRecord['source']>().notNull(),
  workingDirectoryMode: text('working_directory_mode').$type<WorkspaceRecord['workingDirectoryMode']>().notNull(),
  autoCommitEnabled: boolean('auto_commit_enabled'),
  defaultBranch: text('default_branch'),
  suggestedBaseBranch: text('suggested_base_branch'),
  codeBaseBranch: text('code_base_branch'),
  codeBranchName: text('code_branch_name'),
  codeRemoteHeadSha: text('code_remote_head_sha'),
  codeSyncedAt: text('code_synced_at'),
  ownerUserId: text('owner_user_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('workspaces_project_idx').on(table.projectId, table.updatedAt.desc()),
  index('workspaces_executor_idx').on(table.executorNodeId),
])

export const taskCustomFieldDefinitions = pgTable('task_custom_field_definitions', {
  id: text('id').primaryKey(),
  /** 项目级归属：该项目下所有任务共享字段。 */
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  /** 稳定标识（API/统计引用，创建后不可改）。 */
  key: text('key').notNull(),
  /** text | number | select | multi_select | date | user | duration | checkbox | url */
  type: text('type').notNull(),
  /** select/multi_select 的选项数组。 */
  optionsJson: jsonb('options_json').$type<Array<{ label: string; value: string; color?: string }>>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  defaultJson: jsonb('default_json').$type<unknown>(),
  displayOrder: integer('display_order').notNull().default(0),
  /** 软删/归档：保留历史值。 */
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('task_custom_field_definitions_project_key_key').on(table.projectId, table.key),
  index('task_custom_field_definitions_project_idx').on(table.projectId, table.displayOrder),
])

export const taskCustomFieldValues = pgTable('task_custom_field_values', {
  taskId: text('task_id').notNull(),
  fieldId: text('field_id').notNull(),
  valueJson: jsonb('value_json').$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.fieldId] }),
])

export const workspaceLocalWorktrees = pgTable('workspace_local_worktrees', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  executorNodeId: text('executor_node_id').notNull(),
  codeBaseBranch: text('code_base_branch'),
  codeBranchName: text('code_branch_name').notNull(),
  workingDirectoryMode: text('working_directory_mode').$type<WorkspaceLocalWorktree['workingDirectoryMode']>().notNull(),
  localPath: text('local_path'),
  worktreeId: text('worktree_id'),
  worktreeUniqueId: integer('worktree_unique_id'),
  status: text('status').$type<WorkspaceLocalWorktree['status']>().notNull(),
  sourceWorkspaceSessionId: text('source_workspace_session_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('workspace_local_worktrees_workspace_id_executor_node_id_key').on(table.workspaceId, table.executorNodeId),
  index('workspace_local_worktrees_workspace_executor_idx').on(table.workspaceId, table.executorNodeId),
  index('workspace_local_worktrees_updated_idx').on(table.updatedAt.desc()),
])

export const distributedTasks = pgTable('distributed_tasks', {
  id: text('id').primaryKey(),
  originTaskId: text('origin_task_id').notNull(),
  originTaskRunId: text('origin_task_run_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  workspaceBranchName: text('workspace_branch_name'),
  projectId: text('project_id').notNull(),
  localPath: text('local_path'),
  versionControl: text('version_control').$type<DistributedTask['versionControl']>(),
  requestedByUserId: text('requested_by_user_id'),
  requestedByAgentId: text('requested_by_agent_id'),
  sourceAgentEventId: text('source_agent_event_id'),
  agentType: text('agent_type').$type<DistributedTask['agentType']>().notNull(),
  executionModel: text('execution_model'),
  mcpServersJson: jsonb('mcp_servers_json').$type<DistributedTask['mcpServers']>(),
  runtimeSkillPackagesJson: jsonb('runtime_skill_packages_json').$type<DistributedTask['runtimeSkillPackages']>(),
  opencodeConfigJson: jsonb('opencode_config_json').$type<DistributedTask['opencodeConfig']>(),
  runtimeEnvJson: jsonb('runtime_env_json').$type<DistributedTask['runtimeEnv']>(),
  workingDirectoryMode: text('working_directory_mode').$type<DistributedTask['workingDirectoryMode']>().notNull(),
  autoCommitEnabled: boolean('auto_commit_enabled'),
  repoUrl: text('repo_url').notNull(),
  defaultBranch: text('default_branch').notNull(),
  baseCommit: text('base_commit').notNull(),
  description: text('description').notNull(),
  commandPresetJson: jsonb('command_preset_json').$type<ProjectCommandPreset>(),
  status: text('status').$type<DistributedTask['status']>().notNull(),
  priority: text('priority').$type<DistributedTask['priority']>().notNull(),
  timeoutSec: integer('timeout_sec').notNull(),
  originNodeId: text('origin_node_id').notNull(),
  executorNodeId: text('executor_node_id'),
  returnMode: text('return_mode').$type<DistributedTask['returnMode']>().notNull(),
  syncBackStrategy: text('sync_back_strategy').$type<DistributedTask['syncBackStrategy']>().notNull(),
  gitIdentityMode: text('git_identity_mode').$type<DistributedTask['gitIdentityMode']>(),
  publishPolicy: text('publish_policy').$type<DistributedTask['publishPolicy']>().notNull(),
  gitAuthPreference: text('git_auth_preference').$type<DistributedTask['gitAuthPreference']>().notNull(),
  gitIdentityJson: jsonb('git_identity_json').$type<DistributedTask['gitIdentity']>(),
  idempotencyKey: text('idempotency_key').notNull(),
  workerEventSequence: integer('worker_event_sequence'),
  retryCount: integer('retry_count').notNull(),
  leaseExpiresAt: text('lease_expires_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  errorMessage: text('error_message'),
  resultJson: jsonb('result_json').$type<DistributedTask['result']>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('distributed_tasks_project_idx').on(table.projectId, table.updatedAt.desc()),
  index('distributed_tasks_workspace_session_idx').on(table.workspaceSessionId),
  index('distributed_tasks_executor_idx').on(table.executorNodeId, table.status),
  index('distributed_tasks_idempotency_key_idx').on(table.idempotencyKey),
])

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  /**
   * 统一会话模型的 Thread 归属列。此前代码把工作区会话 id 以 `__workspace_session__:` 前缀
   * 编码进 created_by，该 hack 由 conversation-store 的 encode/decode 维持；本列用于取代它。
   */
  workspaceSessionId: text('workspace_session_id'),
  projectId: text('project_id'),
  taskId: text('task_id'),
  groupId: text('group_id'),
  title: text('title').notNull(),
  kind: text('kind').$type<'workspace' | 'project' | 'task' | 'dm' | 'external-thread' | 'main' | 'feedback'>().notNull(),
  chatMode: text('chat_mode').$type<'direct' | 'group'>().notNull(),
  status: text('status').$type<'active' | 'archived'>().notNull(),
  externalSyncMode: text('external_sync_mode').$type<'internal' | 'mirror' | 'bidirectional'>().notNull(),
  orchestratorAgentId: text('orchestrator_agent_id'),
  executorId: text('executor_id'),
  executionModel: text('execution_model'),
  pinnedAt: text('pinned_at'),
  sourceChannel: text('source_channel').$type<'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'>(),
  externalChatId: text('external_chat_id'),
  externalThreadId: text('external_thread_id'),
  externalConversationId: text('external_conversation_id'),
  externalUserId: text('external_user_id'),
  /** 主对话运行态与续跑上下文；最终归属 Run/session-runtime，过渡期挂在 Thread 上。 */
  runtimeJson: jsonb('runtime_json').$type<ThreadRuntimeState>(),
  createdBy: text('created_by'),
  visibility: text('visibility').$type<'public' | 'private'>().notNull().default('public'),
  /** 群简介（组织群聊）。 */
  description: text('description'),
  /** 群公告正文（组织群聊，置顶展示）。 */
  announcement: text('announcement'),
  /** 群公告最后更新时间。 */
  announcementUpdatedAt: text('announcement_updated_at'),
  /** 群公告最后更新人 userId。 */
  announcementUpdatedBy: text('announcement_updated_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('conversations_task_idx').on(table.taskId, table.updatedAt.desc()),
  index('conversations_project_idx').on(table.projectId, table.updatedAt.desc()),
  index('conversations_workspace_mode_idx').on(table.workspaceId, table.chatMode, table.updatedAt.desc()),
  index('conversations_workspace_session_idx').on(table.workspaceSessionId, table.updatedAt.desc()),
])

export const conversationMembers = pgTable('conversation_members', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  memberType: text('member_type').$type<'user' | 'agent'>().notNull(),
  memberId: text('member_id').notNull(),
  role: text('role').$type<'owner' | 'member' | 'orchestrator'>().notNull(),
  /** 拉入该成员的会话成员（@临时拉群时记录） */
  invitedBy: text('invited_by'),
  /** 成员在场窗口起点；@临时拉群踢出后用 joinedAt/leftAt 过滤历史消息 */
  joinedAt: text('joined_at').notNull().default('1970-01-01T00:00:00.000Z'),
  /** 成员被踢出时间；NULL 表示仍在场 */
  leftAt: text('left_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('conversation_members_conversation_id_member_type_member_id_key').on(table.conversationId, table.memberType, table.memberId),
  index('conversation_members_member_idx').on(table.memberType, table.memberId),
])

/**
 * 会话分享/转发记录（forward、link、与 user/agent 定向分享）。
 * 与 `conversation_shares`（dev 已有，按 conversation 建模的链接分享）并存：
 * 本表以 source_kind 支持 conversation 与 main_chat 两类来源，并记录定向目标与权限。
 */
export const sessionShares = pgTable('session_shares', {
  id: text('id').primaryKey(),
  sourceKind: text('source_kind').$type<'conversation' | 'main_chat' | 'workspace_session'>().notNull(),
  sourceId: text('source_id').notNull(),
  workspaceId: text('workspace_id'),
  targetType: text('target_type').$type<'user' | 'agent' | 'link'>().notNull(),
  targetId: text('target_id'),
  permission: text('permission').$type<'read' | 'comment'>().notNull().default('read'),
  shareTokenHash: text('share_token_hash'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  revokedAt: text('revoked_at'),
  expiresAt: text('expires_at'),
}, (table) => [
  unique('session_shares_source_kind_source_id_target_type_target_id_key').on(table.sourceKind, table.sourceId, table.targetType, table.targetId),
  index('session_shares_source_idx').on(table.sourceKind, table.sourceId, table.revokedAt),
  index('session_shares_target_idx').on(table.targetType, table.targetId, table.revokedAt),
  index('session_shares_token_idx').on(table.shareTokenHash),
])

/**
 * 工作区共享授权（分享/协作）：scope 区分整个工作区 / 所有会话 / 单个会话；
 * permission 三档：read（查看）/ edit（可编辑，能发消息）/ collaborate（可协助，发送 + 管理操作）。
 * 分享动作 = 授权 + 发链接消息到指定会话；协作动作 = 仅授权（对方在工作区侧看到）。
 */
export const workspaceShares = pgTable('workspace_shares', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  scope: text('scope').$type<'workspace' | 'all_sessions' | 'session'>().notNull(),
  sessionId: text('session_id'),
  targetType: text('target_type').$type<'user' | 'agent'>().notNull(),
  targetId: text('target_id').notNull(),
  permission: text('permission').$type<'read' | 'edit' | 'collaborate'>().notNull().default('read'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  revokedAt: text('revoked_at'),
}, (table) => [
  unique('workspace_shares_workspace_scope_session_target_key').on(table.workspaceId, table.scope, table.sessionId, table.targetType, table.targetId),
  index('workspace_shares_target_idx').on(table.targetType, table.targetId, table.revokedAt),
  index('workspace_shares_workspace_idx').on(table.workspaceId, table.revokedAt),
])

export const conversationShares = pgTable('conversation_shares', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  /** 分享的具体消息（可为空 = 分享整个会话） */
  messageId: text('message_id'),
  sharedBy: text('shared_by').notNull(),
  /** 'user' | 'agent' */
  sharedByType: text('shared_by_type').$type<'user' | 'agent'>().notNull(),
  /** 'link' | 'forward' */
  shareType: text('share_type').$type<ConversationShareType>().notNull().default('link'),
  /** 转发到的目标会话（forward 类型） */
  targetConversationId: text('target_conversation_id'),
  /** 'members' | 'link' | 'public' */
  accessScope: text('access_scope').$type<ConversationShareAccessScope>().notNull().default('members'),
  /** 访问令牌（link 类型用） */
  shareToken: text('share_token').unique(),
  expiresAt: text('expires_at'),
  metadataJson: jsonb('metadata_json').$type<unknown>(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('conversation_shares_conv_idx').on(table.conversationId, table.createdAt),
])

export const conversationMentions = pgTable('conversation_mentions', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  messageId: text('message_id'),
  /** 发起 @ 的人/Agent */
  mentionerId: text('mentioner_id').notNull(),
  mentionerType: text('mentioner_type').$type<'user' | 'agent'>().notNull(),
  /** 被 @ 的人/Agent/会话 */
  mentionedId: text('mentioned_id').notNull(),
  mentionedType: text('mentioned_type').$type<ConversationMentionType>().notNull(),
  /** 'agent_in_chat' | 'share_conversation' | 'reference_doc' */
  mentionScope: text('mention_scope').$type<ConversationMentionScope>().notNull().default('agent_in_chat'),
  contextJson: jsonb('context_json').$type<unknown>(),
  /** 'pending' | 'acknowledged' | 'acted' */
  status: text('status').$type<ConversationMentionStatus>().notNull().default('pending'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('conversation_mentions_mentioned_idx').on(table.mentionedId, table.status, table.createdAt),
])

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  senderId: text('sender_id'),
  /** parts 的纯文本投影，供全文搜索与列表预览；真相在 partsJson。 */
  content: text('content').notNull(),
  contentType: text('content_type').$type<'text' | 'markdown' | 'json'>().notNull(),
  replyToMessageId: text('reply_to_message_id'),
  externalRefJson: jsonb('external_ref_json').$type<Record<string, unknown>>(),
  /** 统一会话模型的消息内容真相：有序 MessagePart 数组。 */
  partsJson: jsonb('parts_json').$type<MessagePart[]>(),
  /** 消息级 reactions（表情回复/点赞）：自由 emoji，{emoji, userIds} 列表。 */
  reactionsJson: jsonb('reactions_json').$type<MessageReaction[]>().notNull().default([]),
  /** 行业对齐的 role，与 senderType 过渡共存（'agent'→'assistant'）。 */
  role: text('role').$type<MessageRole>(),
  authorName: text('author_name'),
  /** 过渡列：usage 的领域归属是 Run，runs 表落地后本列迁移并移除。 */
  usageJson: jsonb('usage_json').$type<ModelTokenUsage>(),
  /** 过渡列：主对话逐消息运行态，同样随 runs 表落地后收敛。 */
  runtimeStatusJson: jsonb('runtime_status_json').$type<{ agentRunningStatus?: AgentRunningStatus; currentStep?: string }>(),
  /**
   * assistant 消息的结束原因。NULL 表示仍在生成或历史未记录，
   * 因此「是否片段」只认显式 'aborted'，不把 NULL 当成完整回答。
   */
  finishReason: text('finish_reason').$type<MessageFinishReason>(),
  /**
   * 线程内显式顺序。createdAt 不足以定序：同一 tick 内创建的用户消息与
   * assistant 占位消息时间戳相同，按 (createdAt, id) 排序会让回答排到提问之前。
   */
  seq: integer('seq').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('messages_conversation_seq_idx').on(table.conversationId, table.seq),
  unique('messages_conversation_id_seq_key').on(table.conversationId, table.seq),
])

export const channelBindings = pgTable('channel_bindings', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  projectId: text('project_id'),
  taskId: text('task_id'),
  conversationId: text('conversation_id').notNull(),
  channelType: text('channel_type').$type<'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'>().notNull(),
  externalChatId: text('external_chat_id').notNull(),
  externalThreadId: text('external_thread_id'),
  bindingMode: text('binding_mode').$type<'mirror' | 'bidirectional'>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('channel_bindings_conversation_idx').on(table.conversationId),
])

export const workspaceSessionHistoryTurns = pgTable('workspace_session_history_turns', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id').notNull(),
  status: text('status').$type<WorkspaceSessionTurnRecord['status']>().notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  firstSeq: integer('first_seq'),
  lastSeq: integer('last_seq'),
  eventCount: integer('event_count').notNull(),
  usageJson: jsonb('usage_json').$type<ModelTokenUsage>(),
  lineageJson: jsonb('lineage_json').$type<WorkspaceSessionTurnRecord['lineage']>(),
}, (table) => [
  index('workspace_session_history_turns_session_idx').on(table.sessionId, table.startedAt.desc()),
])

export const workspaceSessionHistoryEvents = pgTable('workspace_session_history_events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id').notNull(),
  turnId: text('turn_id').notNull(),
  sessionSeq: integer('session_seq').notNull(),
  turnSeq: integer('turn_seq').notNull(),
  kind: text('kind').$type<WorkspaceSessionEventRecord['kind']>().notNull(),
  visibility: text('visibility').notNull(),
  createdAt: text('created_at').notNull(),
  payloadJson: jsonb('payload_json').$type<WorkspaceSessionEventRecord['payload']>().notNull(),
}, (table) => [
  unique('workspace_session_history_events_session_id_session_seq_key').on(table.sessionId, table.sessionSeq),
  index('idx_workspace_session_history_events_session_seq_v2').on(table.sessionId, table.sessionSeq),
  index('idx_workspace_session_history_events_turn_seq_v2').on(table.turnId, table.turnSeq),
])

export const workspaceSessionHistoryRuntime = pgTable('workspace_session_history_runtime', {
  sessionId: text('session_id').primaryKey(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id').notNull(),
  agentRunningStatus: text('agent_running_status').$type<AgentRunningStatus>().notNull(),
  runtimeStatus: text('runtime_status').$type<WorkspaceSessionRuntimeStatus>(),
  currentStep: text('current_step').notNull(),
  queueStatus: text('queue_status').$type<'idle' | 'queued' | 'running'>().notNull(),
  activeToolCallsJson: jsonb('active_tool_calls_json').$type<ToolCall[]>().notNull(),
  lastEventSeq: integer('last_event_seq').notNull(),
  lastEventAt: text('last_event_at'),
  updatedAt: text('updated_at').notNull(),
})

export const connectorConnections = pgTable('connector_connections', {
  id: text('id').primaryKey(),
  /** provider service（github / notion / …） */
  service: text('service').notNull(),
  /** open-connector 命名连接名（vx-<rand>），同一 service 下唯一 */
  connectionName: text('connection_name').notNull(),
  authType: text('auth_type').notNull(),
  /** 创建者（用户） */
  ownerUserId: text('owner_user_id').notNull(),
  /** 所属协作组织（collab_workspaces.id）；null = 个人连接 */
  workspaceId: text('workspace_id'),
  visibility: text('visibility').$type<'personal' | 'workspace'>().notNull(),
  status: text('status').$type<'ok' | 'error'>().notNull(),
  message: text('message'),
  /** open-connector 返回的安全账号标签（displayName），不含凭据 */
  accountLabel: text('account_label'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_connector_connections_service_name').on(table.service, table.connectionName),
  index('idx_connector_connections_owner').on(table.ownerUserId),
  index('idx_connector_connections_workspace').on(table.workspaceId),
])

export const workspaceSessionHistoryProjection = pgTable('workspace_session_history_projection', {
  sessionId: text('session_id').primaryKey(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id').notNull(),
  latestTurnId: text('latest_turn_id'),
  latestEventKind: text('latest_event_kind').$type<WorkspaceSessionEventRecord['kind']>(),
  latestEventSeq: integer('latest_event_seq').notNull(),
  totalEventCount: integer('total_event_count').notNull(),
  lastEventAt: text('last_event_at'),
  latestUserMessageId: text('latest_user_message_id'),
  latestUserMessagePreview: text('latest_user_message_preview'),
  latestAssistantMessageId: text('latest_assistant_message_id'),
  latestAssistantMessagePreview: text('latest_assistant_message_preview'),
  lastPersistedTurnStartedAt: text('last_persisted_turn_started_at'),
  lastPersistedTurnFinishedAt: text('last_persisted_turn_finished_at'),
  lastPersistedTurnStatus: text('last_persisted_turn_status').$type<WorkspaceSessionTurnRecord['status']>(),
  deletedTurnCount: integer('deleted_turn_count').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_workspace_session_history_projection_workspace_updated_at').on(table.workspaceId, table.updatedAt.desc()),
  index('idx_workspace_session_history_projection_task_updated_at').on(table.taskId, table.updatedAt.desc()),
])









// ─────────────────────────────────────────────────────────────
// Admin Ops（运维看板）：备份 / 备份策略 / R2 用量快照
// ─────────────────────────────────────────────────────────────

/** R2 / 对象存储用量快照（定时采集：Cloudflare R2 API 权威 + 本地 list 兜底）。 */
export const r2UsageSnapshots = pgTable('r2_usage_snapshots', {
  id: text('id').primaryKey(),
  bucket: text('bucket').notNull(),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  objectCount: integer('object_count').notNull().default(0),
  egressBytes: bigint('egress_bytes', { mode: 'number' }).notNull().default(0),
  requests: integer('requests').notNull().default(0),
  source: text('source').$type<'cloudflare-api' | 'local-list'>().notNull().default('local-list'),
  capturedAt: text('captured_at').notNull(),
}, (table) => [
  index('r2_usage_snapshots_bucket_time_idx').on(table.bucket, table.capturedAt.desc()),
])

// ─────────────────────────────────────────────────────────────
// Admin Ops（运维看板）：数据库快速切换（P3）——实例注册 / 数据转移 / 切换事件
// ─────────────────────────────────────────────────────────────

/**
 * Web Push 订阅（feature P3）：每行一个浏览器 PushSubscription，按 endpoint 去重；
 * 服务端用 VAPID 向 endpoint 发 push，实现页面关闭也能收通知。
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  /** PushSubscription.endpoint（各浏览器/推送服务唯一，天然去重键）。 */
  endpoint: text('endpoint').notNull().unique(),
  /** 订阅密钥（PushSubscription.getKey('p256dh'），base64url）。 */
  p256dh: text('p256dh').notNull(),
  /** 订阅认证密钥（PushSubscription.getKey('auth'），base64url）。 */
  auth: text('auth').notNull(),
  /** 订阅来源设备/浏览器描述（便于用户管理多设备）。 */
  userAgent: text('user_agent'),
  /** 最近一次成功投递时间（过期清理参考）。 */
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('push_subscriptions_user_id_idx').on(table.userId),
])

/**
 * 会话（conversation：群聊/任务会话）已读游标（feature P2）：
 * 每用户每会话一行，未读数 = 该会话在 lastReadAt 之后由他人发送的消息数。
 */
export const conversationReadState = pgTable('conversation_read_state', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  /** 已读游标：只统计 createdAt 严格大于此值的他人消息为未读。 */
  lastReadAt: text('last_read_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  unique('conversation_read_state_user_conversation_unique').on(table.userId, table.conversationId),
  index('conversation_read_state_user_idx').on(table.userId),
])


/**
 * 用户连接（好友）：组织内的外部联系人关系。
 * 双向确认：requester 发起 → addressee 接受后双方互见；pending 只对发起方有意义。
 */
export const userConnections = pgTable('user_connections', {
  id: text('id').primaryKey(),
  /** 关系只在这个协作空间内有效；历史无范围记录保留为 null，但不再授予可见性。 */
  workspaceId: text('workspace_id'),
  requesterId: text('requester_id').notNull(),
  addresseeId: text('addressee_id').notNull(),
  /** pending（待对方接受）/ accepted（已连接，双方互见） */
  status: text('status').$type<'pending' | 'accepted'>().notNull().default('pending'),
  createdAt: text('created_at').notNull(),
  respondedAt: text('responded_at'),
}, (table) => [
  unique('user_connections_workspace_pair_unique').on(table.workspaceId, table.requesterId, table.addresseeId),
  index('user_connections_workspace_idx').on(table.workspaceId, table.status),
  index('user_connections_addressee_idx').on(table.addresseeId, table.status),
  index('user_connections_requester_idx').on(table.requesterId, table.status),
])

/**
 * 协作空间内成员分组（人 + Agent 混合）：空间内协作子集，如「市场营销组」「开发研发组」。
 * 一个成员可属于多个分组；分组用于成员归类展示与后续 @组 通知。
 */
export const collabWorkspaceGroups = pgTable('collab_workspace_groups', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('collab_workspace_groups_ws_idx').on(table.workspaceId),
])

export const collabWorkspaceGroupMembers = pgTable('collab_workspace_group_members', {
  groupId: text('group_id').notNull(),
  /** user（组织成员）| agent（自定义 Agent） */
  memberType: text('member_type').$type<'user' | 'agent'>().notNull(),
  memberId: text('member_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.memberType, table.memberId] }),
  index('collab_workspace_group_members_group_idx').on(table.groupId),
])

/**
 * Task Chat 消息队列（多节点）：每队列项一行，claim 用原子条件 UPDATE。
 * 取代早期存于 app_meta JSON + 单进程 Promise 锁的实现；
 * dedupe 由 session_key + dedupe_key 部分唯一索引保证；
 * 过期 claim 由清扫任务回退到 pending（lease_expires_at 裁决）。
 */
export const taskChatQueueItems = pgTable('task_chat_queue_items', {
  id: text('id').primaryKey(),
  sessionKey: text('session_key').notNull(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  taskRunId: text('task_run_id'),
  requestedByAgentId: text('requested_by_agent_id'),
  sourceAgentEventId: text('source_agent_event_id'),
  authorJson: jsonb('author_json').$type<CreatorIdentity>(),
  dedupeKey: text('dedupe_key'),
  message: text('message').notNull(),
  attachmentsJson: jsonb('attachments_json').$type<TaskChatAttachment[]>(),
  contextRefsJson: jsonb('context_refs_json').$type<TaskChatContextRef[]>(),
  runtimeConfigJson: jsonb('runtime_config_json').$type<TaskChatMessageRuntimeConfig>(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
  retryCount: integer('retry_count').notNull().default(0),
  /** pending（可被 claim）| claimed（已被某节点 claim，lease_expires_at 到期前独占） */
  status: text('status').$type<'pending' | 'claimed'>().notNull().default('pending'),
  claimId: text('claim_id'),
  claimedAt: text('claimed_at'),
  claimedBy: text('claimed_by'),
  leaseExpiresAt: text('lease_expires_at'),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('task_chat_queue_items_session_status_idx').on(table.sessionKey, table.status, table.createdAt),
  uniqueIndex('task_chat_queue_items_dedupe_idx')
    .on(table.sessionKey, table.dedupeKey)
    .where(sql`${table.dedupeKey} IS NOT NULL`),
])

/**
 * Task Chat 会话执行租约（多节点）：session_key 唯一，避免两个节点同时执行同一会话。
 * 进程内 execution slot 只做本地提示，跨节点硬裁决以本表为准；
 * 持有节点周期续租，崩溃后 lease 到期可被其他节点接管。
 */
export const taskChatSessionLeases = pgTable('task_chat_session_leases', {
  sessionKey: text('session_key').primaryKey(),
  leaseId: text('lease_id').notNull(),
  claimedByNodeId: text('claimed_by_node_id').notNull(),
  taskId: text('task_id'),
  workspaceId: text('workspace_id'),
  workspaceSessionId: text('workspace_session_id'),
  leaseExpiresAt: text('lease_expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('task_chat_session_leases_expires_idx').on(table.leaseExpiresAt),
])
