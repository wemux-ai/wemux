import type {
  CustomAgentCategory,
  CustomAgentConfig,
  CustomAgentDelegateBaseBranchMode,
  CustomAgentDelegatePreset,
  CustomAgentDelegateSessionMode,
  CustomAgentDelegateWorkingDirectoryMode,
  CustomAgentTemplatePackage,
  CustomAgentVisibility,
} from '@shared/custom-agent'
import type { McpServerPolicy } from '@shared/mcp'
import type { SkillRecord, SkillSelectionPolicy } from '@shared/skill'
import type { RuntimeId, WorkspaceSessionAgentInvocationMode, WorkspaceSessionRole } from '@shared/types'

import type { AgentRecord } from '../api'

export type AgentInvocationMode = WorkspaceSessionAgentInvocationMode
export type SubAgentSessionRole = WorkspaceSessionRole
export type CustomAgentAvailabilityReasonCode =
  | 'disabled'
  | 'archived'
  | 'mode_disabled'
  | 'runtime_unavailable'
  | 'workspace_required'
  | 'workspace_mismatch'
  | 'project_required'
  | 'project_mismatch'

export type CustomAgentAvailabilityReason = {
  code: CustomAgentAvailabilityReasonCode
  message: string
}

export type CustomAgentAvailabilityReport = {
  available: boolean
  mode: AgentInvocationMode
  blockers: CustomAgentAvailabilityReason[]
  highlights: string[]
}

export type CustomAgentProfile = CustomAgentConfig

export type CustomAgentDraft = {
  name: string
  endpoint: string
  role: string
  summary: string
  avatarUrl: string
  instructions: string
  preferredRuntime: RuntimeId
  preferredModel: string
  defaultExecutorId: string
  category: CustomAgentCategory
  tagsText: string
  owner: string
  notes: string
  allowedMention: boolean
  allowedDelegate: boolean
  telegramEnabled: boolean
  telegramBotToken: string
  telegramChatId: string
  telegramThreadId: string
  telegramWebhookSecret: string
  feishuEnabled: boolean
  feishuConnectionMode: 'manual' | 'long-connection'
  feishuAppId: string
  feishuAppSecret: string
  feishuEncryptKey: string
  feishuVerificationToken: string
  wechatEnabled: boolean
  wechatBotToken: string
  wechatBotId: string
  wechatWechatUserId: string
  wechatBaseUrl: string
  discordEnabled: boolean
  discordBotToken: string
  discordGuildId: string
  slackEnabled: boolean
  slackBotToken: string
  slackAppToken: string
  wecomEnabled: boolean
  wecomCorpId: string
  wecomAgentId: string
  wecomSecret: string
  wecomCallbackToken: string
  wecomEncodingAesKey: string
  wecomDefaultTouser: string
  whatsappEnabled: boolean
  whatsappPhoneNumberId: string
  whatsappAccessToken: string
  whatsappVerifyToken: string
  dingtalkEnabled: boolean
  dingtalkAppKey: string
  dingtalkAppSecret: string
  workspaceIdsText: string
  projectIdsText: string
  visibility: CustomAgentVisibility
  enabled: boolean
  archived: boolean
  canWriteFiles: boolean
  canRunCommands: boolean
  delegatePreset: CustomAgentDelegatePreset
  defaultDelegateSessionRole: SubAgentSessionRole
  defaultDelegatePrompt: string
  delegateSessionMode: CustomAgentDelegateSessionMode
  delegateBaseBranchMode: CustomAgentDelegateBaseBranchMode
  delegateBaseBranch: string
  delegateWorkingDirectoryMode: CustomAgentDelegateWorkingDirectoryMode
  skills: SkillSelectionPolicy[]
  mcpServers: McpServerPolicy[]
}

export type CustomAgentDraftValidation = {
  errors: string[]
  warnings: string[]
}

export type CustomAgentTemplateLibraryItem = {
  id: string
  package: CustomAgentTemplatePackage
  savedAt: string
  updatedAt: string
  version: number
  history: Array<{
    version: number
    updatedAt: string
    templateName: string
    templateSummary: string
    draftName: string
  }>
}

export type CustomAgentTemplateDiffSummary = {
  changed: boolean
  lines: string[]
}

export type CustomAgentPortabilityIssue = {
  code: string
  level: 'error' | 'warning' | 'info'
  message: string
}

export type CustomAgentPortabilityReport = {
  score: number
  status: 'ready' | 'needs-attention' | 'blocked'
  issues: CustomAgentPortabilityIssue[]
  missingSkillNames: string[]
  unresolvedMcpNames: string[]
}

export type CustomAgentTemplateId = 'executor' | 'tester' | 'reviewer' | 'doc-writer' | 'researcher'

export type CustomAgentTemplateOption = {
  id: CustomAgentTemplateId
  label: string
  summary: string
  description: string
  category: CustomAgentCategory
  avatarUrl: string
  role: string
  instructions: string
  preferredRuntime: RuntimeId
  preferredModel: string
  allowedMention: boolean
  allowedDelegate: boolean
  canWriteFiles: boolean
  canRunCommands: boolean
  delegatePreset: CustomAgentDelegatePreset
  defaultDelegateSessionRole: SubAgentSessionRole
  defaultDelegatePrompt: string
  delegateSessionMode: CustomAgentDelegateSessionMode
  delegateBaseBranchMode: CustomAgentDelegateBaseBranchMode
  delegateBaseBranch: string
  delegateWorkingDirectoryMode: CustomAgentDelegateWorkingDirectoryMode
  tags: string[]
  recommendedSkillQueries: string[]
  recommendedMcpQueries: string[]
}

export type CustomAgentTemplateRecommendation = {
  skills: SkillRecord[]
  mcpServers: McpServerPolicy[]
}

export type AgentMentionMatch = {
  agent: AgentRecord
  profile: CustomAgentProfile
  token: string
  start: number
  end: number
}
