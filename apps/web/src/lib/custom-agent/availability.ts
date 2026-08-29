/**
 * [INPUT]: Custom-Agent profiles, invocation scope/mode, and available Skills/MCP runtimes.
 * [OUTPUT]: Scope-aware availability and portability reports for Agent invocation UI.
 * [POS]: Web-side presentation policy; server authorization remains the final source of truth.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { hasCustomAgentScopeRestrictions, isCustomAgentEnabled, matchesCustomAgentScope } from '@shared/custom-agent'
import { getRuntimeDescriptor, resolveAgentTypeForRuntimeId } from '@shared/agent-type'
import type { McpServerPolicy } from '@shared/mcp'
import type { SkillRecord } from '@shared/skill'

import { normalizeLookupKey } from './helpers'
import { parseCustomAgentProfile, validateCustomAgentDraft } from './draft'
import type {
  AgentInvocationMode,
  CustomAgentAvailabilityReason,
  CustomAgentAvailabilityReport,
  CustomAgentDraft,
  CustomAgentPortabilityIssue,
  CustomAgentPortabilityReport,
} from './types'
import type { AgentRecord } from '../api'

export const buildCustomAgentPortabilityReport = (
  draft: CustomAgentDraft,
  params: {
    availableSkills: SkillRecord[]
    availableMcpServers: McpServerPolicy[]
  },
): CustomAgentPortabilityReport => {
  const issues: CustomAgentPortabilityIssue[] = []
  const { errors, warnings } = validateCustomAgentDraft(draft)
  const skillCatalogKeys = new Set(
    params.availableSkills.flatMap((skill) => [
      normalizeLookupKey(skill.id),
      normalizeLookupKey(skill.slug),
      normalizeLookupKey(skill.name),
    ]).filter(Boolean),
  )
  const globalMcpKeys = new Set(
    params.availableMcpServers.flatMap((server) => [
      normalizeLookupKey(`${server.name}::${server.target}`),
      normalizeLookupKey(server.target),
    ]).filter(Boolean),
  )
  const missingSkillNames = draft.skills
    .filter((skill) => skill.enabled)
    .filter((skill) => {
      const keys = [skill.skillId, skill.slug, skill.name]
        .map((item) => normalizeLookupKey(item ?? ''))
        .filter(Boolean)

      return keys.length > 0 && !keys.some((key) => skillCatalogKeys.has(key))
    })
    .map((skill) => skill.name)
  const unresolvedMcpNames = draft.mcpServers
    .filter((server) => server.enabled)
    .filter((server) => {
      const target = server.target.trim()
      if (!target || server.managedBySystem) {
        return false
      }

      return !globalMcpKeys.has(normalizeLookupKey(`${server.name}::${target}`))
        && !globalMcpKeys.has(normalizeLookupKey(target))
    })
    .map((server) => server.name)

  errors.forEach((message, index) => {
    issues.push({ code: `draft-error-${index + 1}`, level: 'error', message })
  })
  warnings.forEach((message, index) => {
    issues.push({ code: `draft-warning-${index + 1}`, level: 'warning', message })
  })

  draft.mcpServers
    .filter((server) => server.enabled && !server.target.trim())
    .forEach((server, index) => {
      issues.push({
        code: `mcp-target-empty-${index + 1}`,
        level: 'error',
        message: `MCP「${server.name}」还没有填写 target，导出后在别的环境里无法直接恢复。`,
      })
    })

  if (missingSkillNames.length > 0) {
    issues.push({
      code: 'missing-skills',
      level: 'warning',
      message: `有 ${missingSkillNames.length} 个已启用 Skill 在当前工作区目录里找不到：${missingSkillNames.join(' / ')}。`,
    })
  }

  if (unresolvedMcpNames.length > 0) {
    issues.push({
      code: 'unresolved-mcp',
      level: 'warning',
      message: `有 ${unresolvedMcpNames.length} 个 MCP 不是系统 registry 里的现成项，迁移时需要手动确认目标环境也提供它：${unresolvedMcpNames.join(' / ')}。`,
    })
  }

  if (draft.allowedDelegate && draft.delegateSessionMode === 'reuse-current' && draft.delegateWorkingDirectoryMode === 'inherit') {
    issues.push({
      code: 'reuse-current-compatible',
      level: 'info',
      message: '当前委派策略会复用现有 workspace session，适合评审、调研和轻量协作。',
    })
  }

  const errorCount = issues.filter((item) => item.level === 'error').length
  const warningCount = issues.filter((item) => item.level === 'warning').length
  const infoCount = issues.filter((item) => item.level === 'info').length
  const score = Math.max(0, 100 - errorCount * 35 - warningCount * 12 - infoCount * 2)

  return {
    score,
    status: errorCount > 0 ? 'blocked' : warningCount > 0 ? 'needs-attention' : 'ready',
    issues,
    missingSkillNames,
    unresolvedMcpNames,
  }
}

export const isCustomAgentAvailableInScope = (
  agent: AgentRecord,
  scope: {
    projectId?: string
    collaborationWorkspaceId?: string
    agentWorkspaceId?: string
    workspaceId?: string
  },
) => {
  const profile = parseCustomAgentProfile(agent)
  if (!isCustomAgentEnabled(profile)) {
    return false
  }

  if (!resolveAgentTypeForRuntimeId(profile.preferredRuntime)) {
    return false
  }

  return matchesCustomAgentScope(profile, scope)
}

export const getCustomAgentAvailabilityReport = (
  agent: AgentRecord,
  params: {
    mode: AgentInvocationMode
    projectId?: string
    collaborationWorkspaceId?: string
    agentWorkspaceId?: string
    workspaceId?: string
  },
): CustomAgentAvailabilityReport => {
  const profile = parseCustomAgentProfile(agent)
  const blockers: CustomAgentAvailabilityReason[] = []
  const highlights: string[] = []
  const modeLabel = params.mode === 'mention' ? '@ 调用' : '正式委派'

  if (!profile.enabled) {
    blockers.push({ code: 'disabled', message: '这个 Agent 当前已停用。' })
  }
  if (profile.archived) {
    blockers.push({ code: 'archived', message: '这个 Agent 已归档，不会出现在可调用列表里。' })
  }
  if (!resolveAgentTypeForRuntimeId(profile.preferredRuntime)) {
    blockers.push({
      code: 'runtime_unavailable',
      message: `${getRuntimeDescriptor(profile.preferredRuntime).label} 还没有接入当前 Wemux worker，暂时不能调用这个 Agent。`,
    })
  }
  if (!profile.allowedModes.includes(params.mode)) {
    blockers.push({ code: 'mode_disabled', message: `这个 Agent 没有启用${modeLabel}。` })
  }
  if (hasCustomAgentScopeRestrictions(profile) && !matchesCustomAgentScope(profile, params)) {
    blockers.push({
      code: profile.workspaceIds.length > 0 ? 'workspace_mismatch' : 'project_mismatch',
      message: '这个 Agent 没有开放给当前项目或组织。',
    })
  }

  highlights.push(`${modeLabel}：${profile.allowedModes.includes(params.mode) ? '已启用' : '未启用'}`)
  highlights.push(`执行权限：${profile.canWriteFiles ? '可写文件' : '只读'} / ${profile.canRunCommands ? '可跑命令' : '不跑命令'}`)

  return {
    available: blockers.length === 0,
    mode: params.mode,
    blockers,
    highlights,
  }
}

export const matchesCustomAgentQuery = (agent: AgentRecord, query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  const profile = parseCustomAgentProfile(agent)
  const haystack = [
    agent.name,
    profile.role,
    profile.summary,
    profile.instructions,
    profile.owner,
    profile.tags.join(' '),
    profile.category,
    agent.type,
  ].join(' ').toLowerCase()

  return haystack.includes(normalizedQuery)
}
