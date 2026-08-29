// [INPUT]: Raw custom-agent configs, transfer packages, templates, and capability policies.
// [OUTPUT]: Normalized custom-agent contracts, scope matching, and backward-compatible serialization.
// [POS]: Shared validation and compatibility boundary for custom agents across web, server, and worker.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import { RUNTIME_IDS, type RuntimeId } from './agent-type'
import type { McpServerPolicy } from './mcp'
import { createStableId, inferMcpTransport, isRecord } from './utils'
import {
  normalizeSkillApprovalMode,
  normalizeSkillScope,
  normalizeSkillSlug,
  type SkillSelectionPolicy,
} from './skill'
import type { WorkspaceSessionAgentInvocationMode, WorkspaceSessionRole, WorkingDirectoryMode } from './types'

export const CUSTOM_AGENT_CATEGORIES = ['general', 'engineering', 'product', 'design', 'research', 'ops'] as const
export const CUSTOM_AGENT_DELEGATE_PRESETS = ['custom', 'executor', 'tester', 'reviewer', 'doc-writer', 'researcher'] as const
export const CUSTOM_AGENT_DELEGATE_SESSION_MODES = ['new-session', 'reuse-current'] as const
export const CUSTOM_AGENT_DELEGATE_BASE_BRANCH_MODES = ['task', 'project-default', 'custom'] as const
export const CUSTOM_AGENT_DELEGATE_WORKING_DIRECTORY_MODES = ['inherit', 'worktree', 'original-dir'] as const

export type CustomAgentCategory = typeof CUSTOM_AGENT_CATEGORIES[number]
export type CustomAgentDelegatePreset = typeof CUSTOM_AGENT_DELEGATE_PRESETS[number]
export type CustomAgentDelegateSessionMode = typeof CUSTOM_AGENT_DELEGATE_SESSION_MODES[number]
export type CustomAgentDelegateBaseBranchMode = typeof CUSTOM_AGENT_DELEGATE_BASE_BRANCH_MODES[number]
export type CustomAgentDelegateWorkingDirectoryMode = typeof CUSTOM_AGENT_DELEGATE_WORKING_DIRECTORY_MODES[number]
export type CustomAgentVisibility = 'private' | 'workspace'

export interface CustomAgentTelegramChannelConfig {
  enabled: boolean
  botToken: string
  chatId: string
  threadId: string
  webhookSecret: string
}

export interface CustomAgentFeishuChannelConfig {
  enabled: boolean
  connectionMode: 'manual' | 'long-connection'
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
}

export interface CustomAgentWechatChannelConfig {
  enabled: boolean
  /** iLink（智联）Bot token，扫码绑定后回填 */
  botToken: string
  /** iLink bot id，扫码绑定后回填 */
  botId: string
  /** 绑定个人微信号的微信用户 id，扫码绑定后回填 */
  wechatUserId: string
  /** iLink 网关 base url（默认 https://ilinkai.weixin.qq.com） */
  baseUrl: string
}

export interface CustomAgentDiscordChannelConfig {
  enabled: boolean
  /** Discord Bot token */
  botToken: string
  /** 限定的 guild id（可选；空 = 任意服务器） */
  guildId: string
}

export interface CustomAgentSlackChannelConfig {
  enabled: boolean
  /** Slack Bot User OAuth token（xoxb-...） */
  botToken: string
  /** Slack Socket Mode App-Level token（xapp-...，用于免公网收事件） */
  appToken: string
}

export interface CustomAgentDingtalkChannelConfig {
  enabled: boolean
  /** 钉钉企业内部应用 AppKey（clientId） */
  appKey: string
  /** 钉钉企业内部应用 AppSecret（clientSecret） */
  appSecret: string
  /** stream = Stream 模式长连接（免公网，推荐）；manual 预留 HTTP 回调 */
  connectionMode: 'manual' | 'stream'
}

export interface CustomAgentWhatsappChannelConfig {
  enabled: boolean
  /** WhatsApp Business 手机号 ID（Meta Cloud API） */
  phoneNumberId: string
  /** Meta 系统用户访问令牌（Graph API） */
  accessToken: string
  /** webhook 验证令牌（自定义，与 Meta 后台配置一致） */
  verifyToken: string
}

export interface CustomAgentWecomChannelConfig {
  enabled: boolean
  /** 企业微信企业 ID（corpid） */
  corpId: string
  /** 自建应用 AgentId */
  agentId: string
  /** 自建应用 Secret（用于取 access_token） */
  secret: string
  /** 回调 Token（URL 验证签名用） */
  callbackToken: string
  /** 回调 EncodingAESKey（消息 AES 解密用，43 位） */
  encodingAesKey: string
  /** 默认接收人 userid（channel.send 主动推送用；留空则发最近入站对端） */
  defaultTouser: string
}

export interface CustomAgentChannelsConfig {
  telegram: CustomAgentTelegramChannelConfig
  feishu: CustomAgentFeishuChannelConfig
  wechat: CustomAgentWechatChannelConfig
  discord: CustomAgentDiscordChannelConfig
  slack: CustomAgentSlackChannelConfig
  wecom: CustomAgentWecomChannelConfig
  whatsapp: CustomAgentWhatsappChannelConfig
  dingtalk: CustomAgentDingtalkChannelConfig
}

export const CUSTOM_AGENT_DELEGATE_PRESET_OPTIONS: Array<{
  value: CustomAgentDelegatePreset
  label: string
  description: string
  sessionRole: WorkspaceSessionRole
  defaultPrompt: string
}> = [
  {
    value: 'custom',
    label: '自定义',
    description: '保留你自己定义的委派角色和说明模板。',
    sessionRole: 'general',
    defaultPrompt: '',
  },
  {
    value: 'executor',
    label: '通用执行',
    description: '适合直接推进专项执行、排查和落地处理。',
    sessionRole: 'general',
    defaultPrompt: '请在独立子会话里推进这个专项任务，先给结论和执行计划，再落地处理，并在结束后回传可直接消费的摘要。',
  },
  {
    value: 'tester',
    label: '测试验收',
    description: '适合回归测试、验证修复和验收场景。',
    sessionRole: 'tester',
    defaultPrompt: '请重点验证本次改动涉及的主流程、回归路径和用户明确指定的模块；先看环境是否可用，再结合日志、console、network 和截图给出结论。',
  },
  {
    value: 'reviewer',
    label: '风险评审',
    description: '适合代码审查、边界检查和上线风险识别。',
    sessionRole: 'reviewer',
    defaultPrompt: '请站在评审视角审查这次改动，优先关注兼容性、错误处理、边界条件和潜在回归，输出按优先级排序的问题列表。',
  },
  {
    value: 'doc-writer',
    label: '文档补齐',
    description: '适合 README、发布说明和使用文档同步。',
    sessionRole: 'doc-writer',
    defaultPrompt: '请根据当前改动补齐相关文档，优先写清新增能力、配置方式、限制条件和用户可见变化，并给出建议更新点。',
  },
  {
    value: 'researcher',
    label: '调研排查',
    description: '适合问题调研、链路排查和背景分析。',
    sessionRole: 'researcher',
    defaultPrompt: '请围绕当前问题做调研和排查，区分事实、推断和待验证点，最后给出结论摘要、证据和建议下一步。',
  },
]

export interface CustomAgentConfig {
  role: string
  summary: string
  avatarUrl: string
  instructions: string
  preferredRuntime: RuntimeId
  preferredModel: string
  defaultExecutorId: string
  allowedModes: WorkspaceSessionAgentInvocationMode[]
  workspaceIds: string[]
  projectIds: string[]
  visibility: CustomAgentVisibility
  tags: string[]
  category: CustomAgentCategory
  owner: string
  notes: string
  enabled: boolean
  archived: boolean
  canWriteFiles: boolean
  canRunCommands: boolean
  delegatePreset: CustomAgentDelegatePreset
  defaultDelegateSessionRole: WorkspaceSessionRole
  defaultDelegatePrompt: string
  delegateSessionMode: CustomAgentDelegateSessionMode
  delegateBaseBranchMode: CustomAgentDelegateBaseBranchMode
  delegateBaseBranch: string
  delegateWorkingDirectoryMode: CustomAgentDelegateWorkingDirectoryMode
  channels: CustomAgentChannelsConfig
  skills: SkillSelectionPolicy[]
  mcpServers: McpServerPolicy[]
}

export interface CustomAgentTransferPackage {
  kind: 'vibemux-custom-agent'
  version: 1
  exportedAt: string
  source: {
    app: string
  }
  template?: {
    id?: string
  }
  agent: {
    name: string
    type: 'custom'
    endpoint: string | null
    config: CustomAgentConfig
  }
}

export interface CustomAgentTemplatePackage {
  kind: 'vibemux-custom-agent-template'
  version: 1
  exportedAt: string
  source: {
    app: string
  }
  template: {
    name: string
    summary: string
    description: string
    category: CustomAgentCategory
    tags: string[]
  }
  draft: {
    name: string
    endpoint: string | null
    config: CustomAgentConfig
  }
}

export type CustomAgentPortablePackage = CustomAgentTransferPackage | CustomAgentTemplatePackage

const toTrimmedString = (value: unknown, max = 4000) => {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().slice(0, max)
}

const normalizeStringList = (value: unknown, maxItems = 24, maxItemLength = 80) => {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, maxItemLength))
      .filter(Boolean),
  )).slice(0, maxItems)
}

const normalizeSkillTags = (value: unknown) => normalizeStringList(value, 24, 32)

const parseSkillSelection = (value: unknown, index: number): SkillSelectionPolicy | null => {
  if (typeof value === 'string') {
    const name = value.trim().slice(0, 120)
    if (!name) {
      return null
    }

    return {
      id: createStableId('skill', name, index),
      slug: normalizeSkillSlug(name) ?? undefined,
      name,
      enabled: true,
      scope: 'agent',
      approvalMode: 'auto',
      tags: [],
    }
  }

  const record = asRecord(value)
  const name = toTrimmedString(record.name, 120)
  if (!name) {
    return null
  }

  return {
    id: toTrimmedString(record.id, 120) || createStableId('skill', name, index),
    skillId: toTrimmedString(record.skillId, 120) || undefined,
    slug: normalizeSkillSlug(typeof record.slug === 'string' ? record.slug : name) ?? undefined,
    name,
    description: toTrimmedString(record.description, 240) || undefined,
    enabled: record.enabled !== false,
    scope: normalizeSkillScope(record.scope),
    approvalMode: normalizeSkillApprovalMode(record.approvalMode),
    tags: normalizeSkillTags(record.tags),
  }
}

const normalizeSkillSelections = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => parseSkillSelection(item, index))
    .filter((item): item is SkillSelectionPolicy => item !== null)
    .slice(0, 64)
}

const normalizeCustomAgentVisibility = (value: unknown): CustomAgentVisibility => {
  return value === 'workspace' ? 'workspace' : 'private'
}

const parseMcpServer = (value: unknown, index: number): McpServerPolicy | null => {
  const record = asRecord(value)
  const name = toTrimmedString(record.name, 120)
  const target = toTrimmedString(record.target, 400)
  if (!name || !target) {
    return null
  }

  return {
    id: toTrimmedString(record.id, 120) || createStableId('mcp', name, index),
    name,
    target,
    transport: record.transport === 'http' || record.transport === 'sse' || record.transport === 'stdio'
      ? record.transport
      : inferMcpTransport(target),
    enabled: record.enabled !== false,
    capabilityMode: record.capabilityMode === 'resources+tools' ? 'resources+tools' : 'resources',
    managedBySystem: record.managedBySystem === true,
  }
}

const normalizeMcpServers = (value: unknown) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => parseMcpServer(item, index))
    .filter((item): item is McpServerPolicy => item !== null)
    .slice(0, 32)
}

const CUSTOM_AGENT_PREFERRED_RUNTIMES = [...RUNTIME_IDS] as const

const normalizePreferredRuntime = (value: unknown): RuntimeId => {
  if (typeof value !== 'string') {
    return 'Pi'
  }

  if (value === 'inherit') {
    return 'Pi'
  }

  return RUNTIME_IDS.includes(value as RuntimeId) ? value as RuntimeId : 'Pi'
}

const customAgentConfigSchema = z.object({
  role: z.string().trim().max(120).default(''),
  summary: z.string().trim().max(240).default(''),
  avatarUrl: z.string().trim().max(4000).default(''),
  instructions: z.string().trim().max(12000).default(''),
  preferredRuntime: z.enum(CUSTOM_AGENT_PREFERRED_RUNTIMES).default('Pi'),
  preferredModel: z.string().trim().max(120).default(''),
  defaultExecutorId: z.string().trim().default(''),
  allowedModes: z.array(z.enum(['mention', 'delegate'])).default(['mention', 'delegate']).transform((value): WorkspaceSessionAgentInvocationMode[] => {
    const next = Array.from(new Set(value)) as WorkspaceSessionAgentInvocationMode[]
    return next.length > 0 ? next : ['mention', 'delegate']
  }),
  workspaceIds: z.array(z.string()).default([]).transform((value) => normalizeStringList(value, 64, 128)),
  projectIds: z.array(z.string()).default([]).transform((value) => normalizeStringList(value, 64, 128)),
  visibility: z.enum(['private', 'workspace']).default('private'),
  tags: z.array(z.string()).default([]).transform((value) => normalizeStringList(value, 24, 32)),
  category: z.enum(CUSTOM_AGENT_CATEGORIES).default('general'),
  owner: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(4000).default(''),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  canWriteFiles: z.boolean().default(true),
  canRunCommands: z.boolean().default(true),
  delegatePreset: z.enum(CUSTOM_AGENT_DELEGATE_PRESETS).default('custom'),
  defaultDelegateSessionRole: z.enum(['general', 'tester', 'doc-writer', 'reviewer', 'researcher']).default('general'),
  defaultDelegatePrompt: z.string().trim().max(4000).default(''),
  delegateSessionMode: z.enum(CUSTOM_AGENT_DELEGATE_SESSION_MODES).default('new-session'),
  delegateBaseBranchMode: z.enum(CUSTOM_AGENT_DELEGATE_BASE_BRANCH_MODES).default('task'),
  delegateBaseBranch: z.string().trim().max(120).default(''),
  delegateWorkingDirectoryMode: z.enum(CUSTOM_AGENT_DELEGATE_WORKING_DIRECTORY_MODES).default('inherit'),
  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string().trim().max(240).default(''),
      chatId: z.string().trim().max(120).default(''),
      threadId: z.string().trim().max(120).default(''),
      webhookSecret: z.string().trim().max(240).default(''),
    }).default({ enabled: false, botToken: '', chatId: '', threadId: '', webhookSecret: '' }),
    feishu: z.object({
      enabled: z.boolean().default(false),
      connectionMode: z.enum(['manual', 'long-connection']).default('manual'),
      appId: z.string().trim().max(240).default(''),
      appSecret: z.string().trim().max(240).default(''),
      encryptKey: z.string().trim().max(240).default(''),
      verificationToken: z.string().trim().max(240).default(''),
    }).default({ enabled: false, connectionMode: 'manual', appId: '', appSecret: '', encryptKey: '', verificationToken: '' }),
    wechat: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string().trim().max(240).default(''),
      botId: z.string().trim().max(120).default(''),
      wechatUserId: z.string().trim().max(120).default(''),
      baseUrl: z.string().trim().max(240).default(''),
    }).default({ enabled: false, botToken: '', botId: '', wechatUserId: '', baseUrl: '' }),
    discord: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string().trim().max(240).default(''),
      guildId: z.string().trim().max(120).default(''),
    }).default({ enabled: false, botToken: '', guildId: '' }),
    slack: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string().trim().max(240).default(''),
      appToken: z.string().trim().max(240).default(''),
    }).default({ enabled: false, botToken: '', appToken: '' }),
    wecom: z.object({
      enabled: z.boolean().default(false),
      corpId: z.string().trim().max(120).default(''),
      agentId: z.string().trim().max(120).default(''),
      secret: z.string().trim().max(240).default(''),
      callbackToken: z.string().trim().max(240).default(''),
      encodingAesKey: z.string().trim().max(120).default(''),
      defaultTouser: z.string().trim().max(120).default(''),
    }).default({ enabled: false, corpId: '', agentId: '', secret: '', callbackToken: '', encodingAesKey: '', defaultTouser: '' }),
    whatsapp: z.object({
      enabled: z.boolean().default(false),
      phoneNumberId: z.string().trim().max(120).default(''),
      accessToken: z.string().trim().max(400).default(''),
      verifyToken: z.string().trim().max(240).default(''),
    }).default({ enabled: false, phoneNumberId: '', accessToken: '', verifyToken: '' }),
    dingtalk: z.object({
      enabled: z.boolean().default(false),
      appKey: z.string().trim().max(240).default(''),
      appSecret: z.string().trim().max(240).default(''),
      connectionMode: z.enum(['manual', 'stream']).default('stream'),
    }).default({ enabled: false, appKey: '', appSecret: '', connectionMode: 'stream' }),
  }).default({
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
      threadId: '',
      webhookSecret: '',
    },
    feishu: {
      enabled: false,
      connectionMode: 'manual',
      appId: '',
      appSecret: '',
      encryptKey: '',
      verificationToken: '',
    },
    wechat: {
      enabled: false,
      botToken: '',
      botId: '',
      wechatUserId: '',
      baseUrl: '',
    },
    discord: {
      enabled: false,
      botToken: '',
      guildId: '',
    },
    slack: {
      enabled: false,
      botToken: '',
      appToken: '',
    },
    wecom: {
      enabled: false,
      corpId: '',
      agentId: '',
      secret: '',
      callbackToken: '',
      encodingAesKey: '',
      defaultTouser: '',
    },
    whatsapp: {
      enabled: false,
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
    },
    dingtalk: {
      enabled: false,
      appKey: '',
      appSecret: '',
      connectionMode: 'stream',
    },
  }),
  skills: z.array(z.unknown()).default([]).transform((value) => normalizeSkillSelections(value)),
  mcpServers: z.array(z.unknown()).default([]).transform((value) => normalizeMcpServers(value)),
})

const customAgentTransferAgentSchema = z.object({
  name: z.string().trim().max(80).default('Imported Agent'),
  type: z.literal('custom').default('custom'),
  endpoint: z.string().trim().max(4000).nullable().optional().transform((value) => value?.trim() || null),
  config: z.unknown().transform((value) => normalizeCustomAgentConfig(value)),
})

const customAgentTransferPackageSchema = z.object({
  kind: z.literal('vibemux-custom-agent'),
  version: z.literal(1),
  exportedAt: z.string().trim().min(1),
  source: z.object({
    app: z.string().trim().min(1).default('vibemux'),
  }).default({ app: 'vibemux' }),
  template: z.object({
    id: z.string().trim().max(80).optional(),
  }).optional(),
  agent: customAgentTransferAgentSchema,
})

const customAgentTemplatePackageSchema = z.object({
  kind: z.literal('vibemux-custom-agent-template'),
  version: z.literal(1),
  exportedAt: z.string().trim().min(1),
  source: z.object({
    app: z.string().trim().min(1).default('vibemux'),
  }).default({ app: 'vibemux' }),
  template: z.object({
    name: z.string().trim().max(80).default('Agent Template'),
    summary: z.string().trim().max(240).default(''),
    description: z.string().trim().max(4000).default(''),
    category: z.enum(CUSTOM_AGENT_CATEGORIES).default('general'),
    tags: z.array(z.string()).default([]).transform((value) => normalizeStringList(value, 24, 32)),
  }),
  draft: z.object({
    name: z.string().trim().max(80).default('Agent Copy'),
    endpoint: z.string().trim().max(4000).nullable().optional().transform((value) => value?.trim() || null),
    config: z.unknown().transform((value) => normalizeCustomAgentConfig(value)),
  }),
})

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export const normalizeCustomAgentConfig = (value: unknown): CustomAgentConfig => {
  const record = asRecord(value)

  return customAgentConfigSchema.parse({
    role: toTrimmedString(record.role, 120),
    summary: toTrimmedString(record.summary, 240),
    avatarUrl: toTrimmedString(record.avatarUrl, 4000),
    instructions: toTrimmedString(record.instructions, 12000),
    preferredRuntime: normalizePreferredRuntime(record.preferredRuntime),
    preferredModel: toTrimmedString(record.preferredModel, 120),
    defaultExecutorId: toTrimmedString(record.defaultExecutorId, 128),
    allowedModes: Array.isArray(record.allowedModes) ? record.allowedModes : undefined,
    workspaceIds: Array.isArray(record.workspaceIds) ? record.workspaceIds : undefined,
    projectIds: Array.isArray(record.projectIds) ? record.projectIds : undefined,
    visibility: normalizeCustomAgentVisibility(record.visibility),
    tags: Array.isArray(record.tags) ? record.tags : undefined,
    category: record.category,
    owner: toTrimmedString(record.owner, 120),
    notes: toTrimmedString(record.notes, 4000),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
    archived: typeof record.archived === 'boolean' ? record.archived : undefined,
    canWriteFiles: true,
    canRunCommands: true,
    delegatePreset: record.delegatePreset,
    defaultDelegateSessionRole: record.defaultDelegateSessionRole,
    defaultDelegatePrompt: toTrimmedString(record.defaultDelegatePrompt, 4000),
    delegateSessionMode: record.delegateSessionMode,
    delegateBaseBranchMode: record.delegateBaseBranchMode,
    delegateBaseBranch: toTrimmedString(record.delegateBaseBranch, 120),
    delegateWorkingDirectoryMode: record.delegateWorkingDirectoryMode,
    channels: asRecord(record.channels),
    skills: Array.isArray(record.skills) ? record.skills : undefined,
    mcpServers: Array.isArray(record.mcpServers) ? record.mcpServers : undefined,
  }) as CustomAgentConfig
}

export const readCustomAgentConfig = (config: unknown): CustomAgentConfig => {
  const root = asRecord(config)
  return normalizeCustomAgentConfig(root.customAgent)
}

export const createCustomAgentTransferPackage = (
  agent: {
    name: string
    endpoint?: string | null
    config?: unknown
  },
  options?: {
    exportedAt?: string
    templateId?: string
    sourceApp?: string
  },
): CustomAgentTransferPackage => {
  return customAgentTransferPackageSchema.parse({
    kind: 'vibemux-custom-agent',
    version: 1,
    exportedAt: options?.exportedAt?.trim() || new Date().toISOString(),
    source: {
      app: options?.sourceApp?.trim() || 'vibemux',
    },
    template: options?.templateId?.trim()
      ? {
        id: options.templateId.trim(),
      }
      : undefined,
    agent: {
      name: agent.name,
      type: 'custom',
      endpoint: agent.endpoint ?? null,
      config: readCustomAgentConfig(agent.config),
    },
  }) as CustomAgentTransferPackage
}

export const parseCustomAgentTransferPackage = (value: unknown): CustomAgentTransferPackage => {
  const record = asRecord(value)
  const candidate = 'agent' in record
    ? value
    : {
      kind: 'vibemux-custom-agent',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: {
        app: 'vibemux',
      },
      agent: record,
    }

  return customAgentTransferPackageSchema.parse(candidate) as CustomAgentTransferPackage
}

export const createCustomAgentTemplatePackage = (
  agent: {
    name: string
    endpoint?: string | null
    config?: unknown
  },
  options?: {
    exportedAt?: string
    sourceApp?: string
    templateName?: string
    templateSummary?: string
    templateDescription?: string
    draftName?: string
  },
): CustomAgentTemplatePackage => {
  const config = readCustomAgentConfig(agent.config)
  const templateName = options?.templateName?.trim() || `${agent.name.trim() || 'Agent'} Template`
  const draftName = options?.draftName?.trim() || `${agent.name.trim() || 'Agent'} Copy`

  return customAgentTemplatePackageSchema.parse({
    kind: 'vibemux-custom-agent-template',
    version: 1,
    exportedAt: options?.exportedAt?.trim() || new Date().toISOString(),
    source: {
      app: options?.sourceApp?.trim() || 'vibemux',
    },
    template: {
      name: templateName,
      summary: options?.templateSummary?.trim() || config.summary,
      description: options?.templateDescription?.trim() || config.notes || config.role,
      category: config.category,
      tags: config.tags,
    },
    draft: {
      name: draftName,
      endpoint: agent.endpoint ?? null,
      config,
    },
  }) as CustomAgentTemplatePackage
}

export const parseCustomAgentTemplatePackage = (value: unknown): CustomAgentTemplatePackage => {
  return customAgentTemplatePackageSchema.parse(value) as CustomAgentTemplatePackage
}

export const parseCustomAgentPortablePackage = (value: unknown): CustomAgentPortablePackage => {
  const record = asRecord(value)
  if (record.kind === 'vibemux-custom-agent-template') {
    return parseCustomAgentTemplatePackage(value)
  }

  return parseCustomAgentTransferPackage(value)
}

export const writeCustomAgentConfig = (config: Record<string, unknown> | undefined, customAgent: unknown) => {
  return {
    ...asRecord(config),
    customAgent: normalizeCustomAgentConfig(customAgent),
  }
}

export const isCustomAgentEnabled = (config: CustomAgentConfig) => {
  return config.enabled && !config.archived
}

export type CustomAgentScope = {
  projectId?: string
  collaborationWorkspaceId?: string
  agentWorkspaceId?: string
  /** @deprecated Use collaborationWorkspaceId or agentWorkspaceId to make the workspace kind explicit. */
  workspaceId?: string
}

export const hasCustomAgentScopeRestrictions = (
  config: Pick<CustomAgentConfig, 'workspaceIds' | 'projectIds'>,
) => config.workspaceIds.length > 0 || config.projectIds.length > 0

export const resolveCustomAgentVisibility = (config: Pick<CustomAgentConfig, 'visibility'>): CustomAgentVisibility => {
  return config.visibility === 'workspace' ? 'workspace' : 'private'
}

/**
 * Agent 侧边栏分区：归属了协作区（workspaceIds 非空）或共享可见性 → 协作区 agent；否则 → 用户私有 agent。
 * 与项目侧边栏的「协作区 / 私人」分组语义对齐。
 */
export const resolveAgentScopeKind = (
  config: Pick<CustomAgentConfig, 'visibility' | 'workspaceIds'>,
): 'workspace' | 'private' => {
  if (config.workspaceIds.length > 0 || resolveCustomAgentVisibility(config) === 'workspace') {
    return 'workspace'
  }

  return 'private'
}

export const partitionAgentsByScope = <T extends { config: Record<string, unknown> }>(agents: readonly T[]) => {
  const workspaceAgents: T[] = []
  const privateAgents: T[] = []

  for (const agent of agents) {
    const config = readCustomAgentConfig(agent.config)
    if (resolveAgentScopeKind(config) === 'workspace') {
      workspaceAgents.push(agent)
      continue
    }

    privateAgents.push(agent)
  }

  return {
    workspaceAgents,
    privateAgents,
  }
}

export const isCustomAgentVisibleInWorkspace = (
  config: Pick<CustomAgentConfig, 'visibility' | 'workspaceIds' | 'projectIds'>,
  scope: {
    userId: string
    ownerUserId?: string | null
    workspaceId?: string
  },
) => {
  const workspaceId = scope.workspaceId?.trim()
  const ownerUserId = scope.ownerUserId?.trim()
  const isOwner = Boolean(ownerUserId && scope.userId.trim() === ownerUserId)

  // 老数据：未归属任何 workspace / project → 全局兼容，任何 workspace 可见。
  if (config.workspaceIds.length === 0 && config.projectIds.length === 0) {
    return true
  }

  if (!workspaceId) {
    return isOwner || hasCustomAgentScopeRestrictions(config)
  }

  if (!config.workspaceIds.includes(workspaceId)) {
    return false
  }

  // workspace 共享：当前 workspace 所有成员可见；私有：仅创建者本人。
  return resolveCustomAgentVisibility(config) === 'workspace' || isOwner
}

/**
 * 任务指派 / 评论 Mention 场景的统一访问判断（含 visibility 语义）。
 * - 未归属任何 workspace / project（老数据全局）→ 共享 agent 任意用户可用，私有 agent 仅创建者。
 * - 归属 workspace 的 agent → 必须匹配当前 workspace（及 project 若有）；共享 → 成员可用，私有 → 仅创建者。
 */
export const isCustomAgentAccessible = (
  config: Pick<CustomAgentConfig, 'visibility' | 'workspaceIds' | 'projectIds'>,
  scope: {
    userId?: string
    ownerUserId?: string | null
    workspaceId?: string
    projectId?: string
  },
) => {
  const userId = scope.userId?.trim() || ''
  const ownerUserId = scope.ownerUserId?.trim()
  const isOwner = Boolean(ownerUserId && userId && userId === ownerUserId)
  const workspaceId = scope.workspaceId?.trim()
  const projectId = scope.projectId?.trim()

  // projectIds 限定：非空时必须匹配当前项目。
  if (config.projectIds.length > 0 && !(projectId && config.projectIds.includes(projectId))) {
    return false
  }

  // 老数据：未归属任何 workspace → 全局兼容（共享成员可用 / 私有仅创建者）。
  if (config.workspaceIds.length === 0) {
    return resolveCustomAgentVisibility(config) === 'workspace' || isOwner
  }

  // 归属 workspace：必须匹配当前 workspace。
  if (!workspaceId || !config.workspaceIds.includes(workspaceId)) {
    return false
  }

  // 共享 → 成员可用；私有 → 仅创建者。
  return resolveCustomAgentVisibility(config) === 'workspace' || isOwner
}

export const matchesCustomAgentScope = (
  config: Pick<CustomAgentConfig, 'workspaceIds' | 'projectIds'>,
  scope: CustomAgentScope,
) => {
  if (!hasCustomAgentScopeRestrictions(config)) {
    return true
  }

  const projectId = scope.projectId?.trim()
  const workspaceIds = [
    scope.collaborationWorkspaceId,
    scope.agentWorkspaceId,
    scope.workspaceId,
  ].map((workspaceId) => workspaceId?.trim()).filter((workspaceId): workspaceId is string => Boolean(workspaceId))
  return Boolean(
    (projectId && config.projectIds.includes(projectId))
    || workspaceIds.some((workspaceId) => config.workspaceIds.includes(workspaceId)),
  )
}
