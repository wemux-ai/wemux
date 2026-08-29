/**
 * [INPUT]: Custom-Agent records, editable drafts, transfer packages, and mounted capability policies.
 * [OUTPUT]: Lossless draft/config conversion, validation, duplication, and portable import helpers.
 * [POS]: Web editing boundary for custom Agent configuration; project/workspace allowlists must survive every save.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import {
  parseCustomAgentPortablePackage,
  parseCustomAgentTemplatePackage,
  parseCustomAgentTransferPackage,
  readCustomAgentConfig,
  writeCustomAgentConfig,
} from '@shared/custom-agent'
import type { McpServerPolicy } from '@shared/mcp'
import {
  normalizeSkillApprovalMode,
  normalizeSkillScope,
  normalizeSkillSlug,
  type SkillSelectionPolicy,
} from '@shared/skill'

import { asRecord, createId } from './helpers'
import type {
  CustomAgentDraft,
  CustomAgentDraftValidation,
  CustomAgentProfile,
} from './types'
import type { AgentRecord } from '../api'

export const createCustomAgentDraft = (): CustomAgentDraft => ({
  name: '',
  endpoint: '',
  role: '',
  summary: '',
  avatarUrl: '',
  instructions: '',
  preferredRuntime: 'Pi',
  preferredModel: '',
  defaultExecutorId: '',
  category: 'general',
  tagsText: '',
  owner: '',
  notes: '',
  allowedMention: true,
  allowedDelegate: true,
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramThreadId: '',
  telegramWebhookSecret: '',
  feishuEnabled: false,
  feishuConnectionMode: 'manual',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuEncryptKey: '',
  feishuVerificationToken: '',
  wechatEnabled: false,
  wechatBotToken: '',
  wechatBotId: '',
  wechatWechatUserId: '',
  wechatBaseUrl: '',
  discordEnabled: false,
  discordBotToken: '',
  discordGuildId: '',
  slackEnabled: false,
  slackBotToken: '',
  slackAppToken: '',
  wecomEnabled: false,
  wecomCorpId: '',
  wecomAgentId: '',
  wecomSecret: '',
  wecomCallbackToken: '',
  wecomEncodingAesKey: '',
  wecomDefaultTouser: '',
  whatsappEnabled: false,
  whatsappPhoneNumberId: '',
  whatsappAccessToken: '',
  whatsappVerifyToken: '',
  dingtalkEnabled: false,
  dingtalkAppKey: '',
  dingtalkAppSecret: '',
  workspaceIdsText: '',
  projectIdsText: '',
  visibility: 'private',
  enabled: true,
  archived: false,
  canWriteFiles: true,
  canRunCommands: true,
  delegatePreset: 'custom',
  defaultDelegateSessionRole: 'general',
  defaultDelegatePrompt: '',
  delegateSessionMode: 'new-session',
  delegateBaseBranchMode: 'task',
  delegateBaseBranch: '',
  delegateWorkingDirectoryMode: 'inherit',
  skills: [],
  mcpServers: [],
})

export const toggleCustomAgentScopeId = (value: string, scopeId: string) => {
  const normalizedScopeId = scopeId.trim()
  const currentIds = Array.from(new Set(value.split('\n').map((item) => item.trim()).filter(Boolean)))
  if (!normalizedScopeId) return currentIds.join('\n')
  return currentIds.includes(normalizedScopeId)
    ? currentIds.filter((item) => item !== normalizedScopeId).join('\n')
    : [...currentIds, normalizedScopeId].join('\n')
}

export const parseCustomAgentProfile = (agent: Pick<AgentRecord, 'config'>): CustomAgentProfile => {
  return readCustomAgentConfig(agent.config)
}

const profileToDraft = (params: {
  name: string
  endpoint?: string | null
  profile: CustomAgentProfile
}): CustomAgentDraft => {
  const { endpoint, name, profile } = params
  return {
    name,
    endpoint: endpoint ?? '',
    role: profile.role,
    summary: profile.summary,
    avatarUrl: profile.avatarUrl,
    instructions: profile.instructions,
    preferredRuntime: profile.preferredRuntime,
    preferredModel: profile.preferredModel,
    defaultExecutorId: profile.defaultExecutorId,
    category: profile.category,
    tagsText: profile.tags.join('\n'),
    owner: profile.owner,
    notes: profile.notes,
    allowedMention: profile.allowedModes.includes('mention'),
    allowedDelegate: profile.allowedModes.includes('delegate'),
    telegramEnabled: profile.channels.telegram.enabled,
    telegramBotToken: profile.channels.telegram.botToken,
    telegramChatId: profile.channels.telegram.chatId,
    telegramThreadId: profile.channels.telegram.threadId,
    telegramWebhookSecret: profile.channels.telegram.webhookSecret,
    feishuEnabled: profile.channels.feishu.enabled,
    feishuConnectionMode: profile.channels.feishu.connectionMode,
    feishuAppId: profile.channels.feishu.appId,
    feishuAppSecret: profile.channels.feishu.appSecret,
    feishuEncryptKey: profile.channels.feishu.encryptKey,
    feishuVerificationToken: profile.channels.feishu.verificationToken,
    wechatEnabled: profile.channels.wechat.enabled,
    wechatBotToken: profile.channels.wechat.botToken,
    wechatBotId: profile.channels.wechat.botId,
    wechatWechatUserId: profile.channels.wechat.wechatUserId,
    wechatBaseUrl: profile.channels.wechat.baseUrl,
    discordEnabled: profile.channels.discord.enabled,
    discordBotToken: profile.channels.discord.botToken,
    discordGuildId: profile.channels.discord.guildId,
    slackEnabled: profile.channels.slack.enabled,
    slackBotToken: profile.channels.slack.botToken,
    slackAppToken: profile.channels.slack.appToken,
    wecomEnabled: profile.channels.wecom.enabled,
    wecomCorpId: profile.channels.wecom.corpId,
    wecomAgentId: profile.channels.wecom.agentId,
    wecomSecret: profile.channels.wecom.secret,
    wecomCallbackToken: profile.channels.wecom.callbackToken,
    wecomEncodingAesKey: profile.channels.wecom.encodingAesKey,
    wecomDefaultTouser: profile.channels.wecom.defaultTouser,
    whatsappEnabled: profile.channels.whatsapp.enabled,
    whatsappPhoneNumberId: profile.channels.whatsapp.phoneNumberId,
    whatsappAccessToken: profile.channels.whatsapp.accessToken,
    whatsappVerifyToken: profile.channels.whatsapp.verifyToken,
    dingtalkEnabled: profile.channels.dingtalk.enabled,
    dingtalkAppKey: profile.channels.dingtalk.appKey,
    dingtalkAppSecret: profile.channels.dingtalk.appSecret,
    workspaceIdsText: profile.workspaceIds.join('\n'),
    projectIdsText: profile.projectIds.join('\n'),
    visibility: profile.visibility,
    enabled: profile.enabled,
    archived: profile.archived,
    canWriteFiles: profile.canWriteFiles,
    canRunCommands: profile.canRunCommands,
    delegatePreset: profile.delegatePreset,
    defaultDelegateSessionRole: profile.defaultDelegateSessionRole,
    defaultDelegatePrompt: profile.defaultDelegatePrompt,
    delegateSessionMode: profile.delegateSessionMode,
    delegateBaseBranchMode: profile.delegateBaseBranchMode,
    delegateBaseBranch: profile.delegateBaseBranch,
    delegateWorkingDirectoryMode: profile.delegateWorkingDirectoryMode,
    skills: profile.skills,
    mcpServers: profile.mcpServers,
  }
}

export const toCustomAgentDraft = (agent: AgentRecord | null): CustomAgentDraft => {
  if (!agent) {
    return createCustomAgentDraft()
  }

  return profileToDraft({
    name: agent.name,
    endpoint: agent.endpoint,
    profile: parseCustomAgentProfile(agent),
  })
}

export const toCustomAgentDraftFromTransferPackage = (
  value: import('@shared/custom-agent').CustomAgentTransferPackage | Record<string, unknown>,
): CustomAgentDraft => {
  const portable = parseCustomAgentTransferPackage(value)
  return profileToDraft({
    name: portable.agent.name,
    endpoint: portable.agent.endpoint,
    profile: portable.agent.config,
  })
}

export const toCustomAgentDraftFromTemplatePackage = (
  value: import('@shared/custom-agent').CustomAgentTemplatePackage | Record<string, unknown>,
): CustomAgentDraft => {
  const portable = parseCustomAgentTemplatePackage(value)
  return profileToDraft({
    name: portable.draft.name,
    endpoint: portable.draft.endpoint,
    profile: portable.draft.config,
  })
}

export const toCustomAgentDraftFromPortablePackage = (
  value: import('@shared/custom-agent').CustomAgentPortablePackage | Record<string, unknown>,
): CustomAgentDraft => {
  const portable = parseCustomAgentPortablePackage(value)
  if (portable.kind === 'vibemux-custom-agent-template') {
    return toCustomAgentDraftFromTemplatePackage(portable)
  }

  return toCustomAgentDraftFromTransferPackage(portable)
}

export const buildCustomAgentConfig = (draft: CustomAgentDraft, currentConfig?: Record<string, unknown>) => {
  return writeCustomAgentConfig(asRecord(currentConfig), {
    role: draft.role.trim(),
    summary: draft.summary.trim(),
    avatarUrl: draft.avatarUrl.trim(),
    instructions: draft.instructions.trim(),
    preferredRuntime: draft.preferredRuntime,
    preferredModel: draft.preferredModel.trim(),
    defaultExecutorId: draft.defaultExecutorId.trim(),
    category: draft.category,
    tags: draft.tagsText.split('\n').map((item) => item.trim()).filter(Boolean),
    owner: draft.owner.trim(),
    notes: draft.notes.trim(),
    allowedModes: [
      ...(draft.allowedMention ? ['mention' as const] : []),
      ...(draft.allowedDelegate ? ['delegate' as const] : []),
    ],
    channels: {
      telegram: {
        enabled: draft.telegramEnabled,
        botToken: draft.telegramBotToken.trim(),
        chatId: draft.telegramChatId.trim(),
        threadId: draft.telegramThreadId.trim(),
        webhookSecret: draft.telegramWebhookSecret.trim(),
      },
      feishu: {
        enabled: draft.feishuEnabled,
        connectionMode: draft.feishuConnectionMode,
        appId: draft.feishuAppId.trim(),
        appSecret: draft.feishuAppSecret.trim(),
        encryptKey: draft.feishuEncryptKey.trim(),
        verificationToken: draft.feishuVerificationToken.trim(),
      },
      wechat: {
        enabled: draft.wechatEnabled,
        botToken: draft.wechatBotToken.trim(),
        botId: draft.wechatBotId.trim(),
        wechatUserId: draft.wechatWechatUserId.trim(),
        baseUrl: draft.wechatBaseUrl.trim(),
      },
      discord: {
        enabled: draft.discordEnabled,
        botToken: draft.discordBotToken.trim(),
        guildId: draft.discordGuildId.trim(),
      },
      slack: {
        enabled: draft.slackEnabled,
        botToken: draft.slackBotToken.trim(),
        appToken: draft.slackAppToken.trim(),
      },
      wecom: {
        enabled: draft.wecomEnabled,
        corpId: draft.wecomCorpId.trim(),
        agentId: draft.wecomAgentId.trim(),
        secret: draft.wecomSecret.trim(),
        callbackToken: draft.wecomCallbackToken.trim(),
        encodingAesKey: draft.wecomEncodingAesKey.trim(),
        defaultTouser: draft.wecomDefaultTouser.trim(),
      },
      whatsapp: {
        enabled: draft.whatsappEnabled,
        phoneNumberId: draft.whatsappPhoneNumberId.trim(),
        accessToken: draft.whatsappAccessToken.trim(),
        verifyToken: draft.whatsappVerifyToken.trim(),
      },
      dingtalk: {
        enabled: draft.dingtalkEnabled,
        appKey: draft.dingtalkAppKey.trim(),
        appSecret: draft.dingtalkAppSecret.trim(),
        connectionMode: 'stream',
      },
    },
    workspaceIds: draft.workspaceIdsText.split('\n').map((item) => item.trim()).filter(Boolean),
    projectIds: draft.projectIdsText.split('\n').map((item) => item.trim()).filter(Boolean),
    visibility: draft.visibility,
    enabled: draft.enabled,
    archived: draft.archived,
    canWriteFiles: draft.canWriteFiles,
    canRunCommands: draft.canRunCommands,
    delegatePreset: draft.delegatePreset,
    defaultDelegateSessionRole: draft.defaultDelegateSessionRole,
    defaultDelegatePrompt: draft.defaultDelegatePrompt.trim(),
    delegateSessionMode: draft.delegateSessionMode,
    delegateBaseBranchMode: draft.delegateBaseBranchMode,
    delegateBaseBranch: draft.delegateBaseBranch.trim(),
    delegateWorkingDirectoryMode: draft.delegateWorkingDirectoryMode,
    skills: draft.skills,
    mcpServers: draft.mcpServers,
  })
}

export const validateCustomAgentDraft = (draft: CustomAgentDraft): CustomAgentDraftValidation => {
  const errors: string[] = []
  const warnings: string[] = []
  const workspaceIds = draft.workspaceIdsText.split('\n').map((item) => item.trim()).filter(Boolean)
  const projectIds = draft.projectIdsText.split('\n').map((item) => item.trim()).filter(Boolean)
  const duplicateSkillNames = draft.skills
    .map((item) => item.name.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) !== index)
  const duplicateMcpTargets = draft.mcpServers
    .map((item) => `${item.name.trim().toLowerCase()}::${item.target.trim().toLowerCase()}`)
    .filter((item) => item !== '::')
    .filter((item, index, list) => list.indexOf(item) !== index)

  if (!draft.name.trim()) {
    errors.push('名称不能为空。')
  }

  if (!draft.allowedMention && !draft.allowedDelegate) {
    errors.push('至少要启用一种调用方式。')
  }

  if (draft.telegramEnabled && !draft.telegramBotToken.trim()) {
    errors.push('启用 Telegram 前需要填写 Bot Token。')
  }

  if (draft.feishuEnabled && (!draft.feishuAppId.trim() || !draft.feishuAppSecret.trim())) {
    errors.push('启用飞书前需要填写 App ID 和 App Secret。')
  }

  if (draft.wechatEnabled && !draft.wechatBotToken.trim()) {
    errors.push('启用微信前需要先完成扫码绑定。')
  }

  if (draft.discordEnabled && !draft.discordBotToken.trim()) {
    errors.push('启用 Discord 前需要填写 Bot Token。')
  }

  if (draft.slackEnabled && (!draft.slackBotToken.trim() || !draft.slackAppToken.trim())) {
    errors.push('启用 Slack 前需要填写 Bot Token 和 App Token。')
  }

  if (draft.wecomEnabled && (!draft.wecomCorpId.trim() || !draft.wecomAgentId.trim() || !draft.wecomSecret.trim())) {
    errors.push('启用企业微信前需要填写 Corp ID、Agent ID 和 Secret。')
  }

  if (draft.whatsappEnabled && (!draft.whatsappPhoneNumberId.trim() || !draft.whatsappAccessToken.trim())) {
    errors.push('启用 WhatsApp 前需要填写 Phone Number ID 和 Access Token。')
  }

  if (draft.dingtalkEnabled && (!draft.dingtalkAppKey.trim() || !draft.dingtalkAppSecret.trim())) {
    errors.push('启用钉钉前需要填写 AppKey 和 AppSecret。')
  }

  if (!draft.summary.trim()) {
    warnings.push('建议填写角色摘要，便于在工作区里快速识别。')
  }

  if (!draft.instructions.trim()) {
    warnings.push('建议填写长期指令，否则这个 Agent 的行为边界会比较弱。')
  }

  if (!draft.canWriteFiles && !draft.canRunCommands) {
    warnings.push('当前同时禁止写文件和跑命令，它更像一个只读分析 Agent。')
  }

  if (!draft.telegramEnabled && draft.telegramBotToken.trim()) {
    warnings.push('已填写 Telegram 凭据但未启用 Telegram 渠道。')
  }

  if (draft.telegramEnabled && !draft.telegramChatId.trim()) {
    warnings.push('当前 Telegram 没有默认 Chat ID，`channel.send` 不能主动推送，但 webhook 回话仍可正常回复。')
  }

  if (draft.telegramEnabled && !draft.telegramWebhookSecret.trim()) {
    warnings.push('建议为 Telegram webhook 配置 Secret Token，避免外部伪造请求。')
  }

  if (!draft.wechatEnabled && draft.wechatBotToken.trim()) {
    warnings.push('已绑定微信但未启用微信渠道。')
  }

  if (draft.allowedDelegate && !draft.preferredModel.trim()) {
    warnings.push(`这个 Agent 允许正式委派，但还没有设置默认模型，实际会使用 ${draft.preferredRuntime} 的默认模型。`)
  }

  if (draft.allowedDelegate && !draft.defaultDelegatePrompt.trim()) {
    warnings.push('这个 Agent 允许正式委派，但还没有设置默认委派说明模板，每次仍然需要手动补充任务重点。')
  }

  if (draft.allowedDelegate && draft.delegatePreset === 'custom' && !draft.defaultDelegatePrompt.trim()) {
    warnings.push('当前委派策略还是自定义空模板，建议直接套用一个预设，避免每次手动组织提示。')
  }

  if (draft.allowedDelegate && draft.delegateBaseBranchMode === 'custom' && !draft.delegateBaseBranch.trim()) {
    warnings.push('当前委派基线分支选择了自定义，但还没有填写具体分支名。')
  }

  if (draft.allowedDelegate && draft.delegateSessionMode === 'reuse-current' && draft.delegateWorkingDirectoryMode !== 'inherit') {
    warnings.push('当前选择复用当前会话时，工作目录模式建议保持“继承当前工作区”，否则容易和已有会话上下文打架。')
  }

  if (draft.skills.length > 0 && duplicateSkillNames.length > 0) {
    warnings.push('当前挂载的 Skills 里存在重复项，执行时会自动去重，但建议清理。')
  }

  if (draft.mcpServers.length > 0 && duplicateMcpTargets.length > 0) {
    warnings.push('当前 MCP 列表里存在重复 server/target 组合，执行时可能造成能力描述重复。')
  }

  if (workspaceIds.length > 0 && new Set(workspaceIds).size !== workspaceIds.length) {
    warnings.push('工作区白名单里有重复 ID，建议清理。')
  }

  if (projectIds.length > 0 && new Set(projectIds).size !== projectIds.length) {
    warnings.push('项目白名单里有重复 ID，建议清理。')
  }

  if (draft.allowedDelegate && !draft.canWriteFiles && !draft.canRunCommands) {
    warnings.push('这个 Agent 允许正式委派，但执行权限是只读，适合作为分析/评审 Agent，不适合直接交付改动。')
  }

  if (!draft.allowedDelegate && (draft.defaultDelegatePrompt.trim() || draft.defaultDelegateSessionRole !== 'general')) {
    warnings.push('当前未启用正式委派，默认委派角色或模板暂时不会生效。')
  }

  if (draft.archived && draft.enabled) {
    warnings.push('归档中的 Agent 不会出现在可调用列表里，即使“启用 Agent”为开。')
  }

  return { errors, warnings }
}

export const duplicateCustomAgentDraft = (draft: CustomAgentDraft): CustomAgentDraft => {
  return {
    ...draft,
    name: draft.name.trim() ? `${draft.name.trim()} Copy` : 'Agent Copy',
    archived: false,
    enabled: true,
    skills: draft.skills.map((item) => ({ ...item, id: createId('skill') })),
    mcpServers: draft.mcpServers.map((item) => ({ ...item, id: createId('mcp') })),
  }
}

export const createAgentSkillSelection = (seed?: Partial<SkillSelectionPolicy>): SkillSelectionPolicy => {
  const name = seed?.name?.trim() || 'new-skill'
  return {
    id: seed?.id?.trim() || createId('skill'),
    skillId: seed?.skillId?.trim() || undefined,
    slug: normalizeSkillSlug(seed?.slug || name) ?? undefined,
    name,
    description: seed?.description?.trim() || undefined,
    enabled: seed?.enabled !== false,
    scope: normalizeSkillScope(seed?.scope),
    approvalMode: normalizeSkillApprovalMode(seed?.approvalMode),
    tags: Array.isArray(seed?.tags) ? seed.tags.map((tag) => tag.trim()).filter(Boolean) : [],
  }
}

export const createAgentMcpServer = (seed?: Partial<McpServerPolicy>): McpServerPolicy => {
  const target = seed?.target?.trim() || ''
  const inferredTransport: McpServerPolicy['transport'] = target.startsWith('stdio://')
    ? 'stdio'
    : target.startsWith('sse://')
      ? 'sse'
      : target.startsWith('http://') || target.startsWith('https://')
        ? (target.includes('/sse') ? 'sse' : 'http')
        : 'custom'

  return {
    id: seed?.id?.trim() || createId('mcp'),
    name: seed?.name?.trim() || 'new-mcp',
    target,
    transport: seed?.transport ?? inferredTransport,
    enabled: seed?.enabled !== false,
    capabilityMode: seed?.capabilityMode === 'resources+tools' ? 'resources+tools' : 'resources',
    managedBySystem: seed?.managedBySystem === true,
  }
}
