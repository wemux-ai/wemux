import { CUSTOM_AGENT_DELEGATE_PRESET_OPTIONS } from '@shared/custom-agent'
import type { CustomAgentDelegatePreset, CustomAgentDelegateSessionMode } from '@shared/custom-agent'
import type { Task, WorkingDirectoryMode } from '@shared/types'

import { includesAny } from './helpers'
import { parseCustomAgentProfile } from './draft'
import type {
  AgentInvocationMode,
  CustomAgentProfile,
  SubAgentSessionRole,
} from './types'
import type { AgentRecord } from '../api'

export const SUB_AGENT_SESSION_ROLE_OPTIONS: Array<{ value: SubAgentSessionRole; label: string; description: string }> = [
  { value: 'general', label: '通用协作', description: '适合临时并行处理和专项执行' },
  { value: 'tester', label: '测试', description: '适合测试、验证和复测' },
  { value: 'doc-writer', label: '文档', description: '适合更新文档、说明和发布记录' },
  { value: 'reviewer', label: '评审', description: '适合代码审查、风险检查和验收' },
  { value: 'researcher', label: '研究', description: '适合调研、排查和背景分析' },
]

export const resolveDelegatePresetOption = (preset: CustomAgentDelegatePreset) => {
  return CUSTOM_AGENT_DELEGATE_PRESET_OPTIONS.find((item) => item.value === preset) ?? CUSTOM_AGENT_DELEGATE_PRESET_OPTIONS[0]
}

export const inferSubAgentSessionRole = (agent: AgentRecord | null): SubAgentSessionRole => {
  if (!agent) {
    return 'general'
  }

  const profile = parseCustomAgentProfile(agent)
  const haystack = [
    agent.name,
    profile.role,
    profile.summary,
    profile.instructions,
    profile.category,
    profile.tags.join(' '),
  ].join(' ').toLowerCase()

  if (includesAny(haystack, ['test', 'qa', 'e2e', '测试', '验证', '验收'])) {
    return 'tester'
  }
  if (includesAny(haystack, ['doc', 'docs', '文档', 'release note', 'changelog'])) {
    return 'doc-writer'
  }
  if (includesAny(haystack, ['review', 'reviewer', '审查', '评审', '风险'])) {
    return 'reviewer'
  }
  if (includesAny(haystack, ['research', '研究', '调研', 'investigate', '分析'])) {
    return 'researcher'
  }

  return 'general'
}

export const resolveDefaultSubAgentSessionRole = (agent: AgentRecord | null): SubAgentSessionRole => {
  if (!agent) {
    return 'general'
  }

  const profile = parseCustomAgentProfile(agent)
  return profile.defaultDelegateSessionRole || inferSubAgentSessionRole(agent)
}

export const resolveDefaultDelegatePrompt = (agent: AgentRecord | null) => {
  if (!agent) {
    return ''
  }

  return parseCustomAgentProfile(agent).defaultDelegatePrompt.trim()
}

export const resolveDefaultDelegatePreset = (agent: AgentRecord | null): CustomAgentDelegatePreset => {
  if (!agent) {
    return 'custom'
  }

  return parseCustomAgentProfile(agent).delegatePreset
}

export const resolveDefaultDelegateSessionMode = (agent: AgentRecord | null): CustomAgentDelegateSessionMode => {
  if (!agent) {
    return 'new-session'
  }

  return parseCustomAgentProfile(agent).delegateSessionMode
}

export const resolveDefaultDelegateBaseBranch = (
  agent: AgentRecord | null,
  params: {
    task: Pick<Task, 'baseBranch' | 'baseBranchHint'>
    projectDefaultBranch?: string
  },
) => {
  if (!agent) {
    return params.task.baseBranch?.trim() || params.task.baseBranchHint?.trim() || params.projectDefaultBranch?.trim() || undefined
  }

  const profile = parseCustomAgentProfile(agent)
  if (profile.delegateBaseBranchMode === 'custom') {
    return profile.delegateBaseBranch.trim() || undefined
  }
  if (profile.delegateBaseBranchMode === 'project-default') {
    return params.projectDefaultBranch?.trim() || params.task.baseBranch?.trim() || params.task.baseBranchHint?.trim() || undefined
  }

  return params.task.baseBranch?.trim() || params.task.baseBranchHint?.trim() || params.projectDefaultBranch?.trim() || undefined
}

export const resolveDefaultDelegateWorkingDirectoryMode = (
  agent: AgentRecord | null,
  fallback?: WorkingDirectoryMode,
): WorkingDirectoryMode | undefined => {
  if (!agent) {
    return fallback
  }

  const mode = parseCustomAgentProfile(agent).delegateWorkingDirectoryMode
  if (mode === 'inherit') {
    return fallback
  }

  return mode
}

export const buildAgentPromptEnvelope = (params: {
  agent: AgentRecord
  profile: CustomAgentProfile
  mode: AgentInvocationMode
  task: Task
  message: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const permissionLines = [
    params.profile.canWriteFiles ? '可以直接修改文件' : '不要修改文件，只做分析和建议',
    params.profile.canRunCommands ? '可以运行必要命令' : '不要运行命令，只基于上下文输出',
  ]
  const enabledSkills = params.profile.skills.filter((item) => item.enabled)
  const enabledMcpServers = params.profile.mcpServers.filter((item) => item.enabled)
  const delegatePreset = resolveDelegatePresetOption(params.profile.delegatePreset)
  const scopeLines = [
    `@调用: ${params.profile.allowedModes.includes('mention') ? '允许' : '禁用'}`,
    `正式委派: ${params.profile.allowedModes.includes('delegate') ? `允许，${params.profile.delegateSessionMode === 'reuse-current' ? '复用当前会话执行' : '新建 workspace session 执行'}` : '禁用'}`,
  ]
  const delegateStrategyLines = [
    `会话策略: ${params.profile.delegateSessionMode === 'reuse-current' ? '复用当前会话' : '新建子会话'}`,
    `基线分支: ${params.profile.delegateBaseBranchMode === 'custom' ? (params.profile.delegateBaseBranch || '未填写') : params.profile.delegateBaseBranchMode === 'project-default' ? '项目默认分支' : '任务当前分支'}`,
    `工作目录: ${params.profile.delegateWorkingDirectoryMode === 'inherit' ? '继承当前工作区' : params.profile.delegateWorkingDirectoryMode}`,
  ]

  return [
    '你现在以自定义 Agent 身份工作。',
    '',
    '[Agent 身份]',
    `名称: ${params.agent.name}`,
    `角色: ${params.profile.role || params.agent.type || '协作 Agent'}`,
    `定位: ${params.profile.summary || '在当前工作区上下文中协助完成任务。'}`,
    '',
    '[长期指令]',
    params.profile.instructions || '遵守当前任务上下文，优先给出可执行结果，并保持简洁。',
    '',
    '[已挂载 Skills]',
    enabledSkills.length > 0
      ? enabledSkills.map((item) => `- ${item.name} (${item.scope} / ${item.approvalMode === 'approval' ? '需审批' : '自动'})`).join('\n')
      : '- 未额外挂载 Skills',
    '',
    '[已挂载 MCP]',
    enabledMcpServers.length > 0
      ? enabledMcpServers.map((item) => `- ${item.name} (${item.transport} / ${item.capabilityMode}) -> ${item.target}`).join('\n')
      : '- 未额外挂载 MCP',
    '',
    '[工作区策略]',
    ...scopeLines.map((line) => `- ${line}`),
    ...delegateStrategyLines.map((line) => `- ${line}`),
    '',
    '[本次调用]',
    `模式: ${params.mode === 'delegate' ? '正式委派' : '工作区 @ 调用'}`,
    `委派策略: ${params.mode === 'delegate' ? delegatePreset.label : '当前未启用'}`,
    `任务: ${params.task.title}`,
    `任务描述: ${params.task.description}`,
    `工作区: ${params.workspaceId || '未指定'}`,
    `工作区会话: ${params.workspaceSessionId || '默认会话'}`,
    '',
    '[执行边界]',
    ...permissionLines.map((line) => `- ${line}`),
    '- 所有输出都回到当前工作区对话主线。',
    '- 完成后先给结论，再给必要细节。',
    '',
    '[用户请求]',
    params.message.trim(),
  ].join('\n')
}
