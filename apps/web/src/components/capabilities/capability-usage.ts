import type { McpServerPolicy } from '@shared/mcp'
import {
  type SkillRecord,
  type SkillSelectionPolicy,
} from '@shared/skill'

import { parseCustomAgentProfile } from '../../lib/custom-agent'
import { normalizeLookupKey } from '../../lib/custom-agent/helpers'
import type { AgentRecord } from '../../lib/api'

export type CapabilityUsageItem = {
  agentId: string
  agentName: string
  enabled: boolean
  kind: 'skill' | 'mcp'
  piToolReady?: boolean
  runtime: string
  scope?: SkillSelectionPolicy['scope']
  approvalMode?: SkillSelectionPolicy['approvalMode']
}

export type CapabilityUsageSummary = {
  enabledByCount: number
  items: CapabilityUsageItem[]
  piToolReadyCount: number
  usedByCount: number
  usedByPiAgentsCount: number
}

const matchSkillSelection = (selection: SkillSelectionPolicy, skill: SkillRecord) => {
  const selectionKeys = [selection.skillId, selection.slug, selection.name]
    .map((value) => normalizeLookupKey(value ?? ''))
    .filter(Boolean)
  const skillKeys = [
    normalizeLookupKey(skill.id),
    normalizeLookupKey(skill.slug),
    normalizeLookupKey(skill.name),
  ]

  return selectionKeys.some((key) => skillKeys.includes(key))
}

const matchMcpServer = (mounted: McpServerPolicy, server: McpServerPolicy) => {
  const mountedTarget = mounted.target.trim()
  const serverTarget = server.target.trim()
  const mountedComposite = normalizeLookupKey(`${mounted.name}::${mountedTarget}`)
  const serverComposite = normalizeLookupKey(`${server.name}::${serverTarget}`)

  return mountedComposite === serverComposite
    || (Boolean(mountedTarget) && normalizeLookupKey(mountedTarget) === normalizeLookupKey(serverTarget))
}

export const buildSkillUsageSummary = (params: {
  agents: AgentRecord[]
  skill: SkillRecord
}) => {
  const items = params.agents
    .flatMap<CapabilityUsageItem>((agent) => {
      const profile = parseCustomAgentProfile(agent)
      const matches = profile.skills.filter((selection) => matchSkillSelection(selection, params.skill))
      if (matches.length === 0) {
        return []
      }

      return matches.map((selection) => ({
        agentId: agent.id,
        agentName: agent.name,
        enabled: selection.enabled,
        kind: 'skill',
        runtime: profile.preferredRuntime ?? 'Pi',
        scope: selection.scope,
        approvalMode: selection.approvalMode,
      }))
    })

  return {
    items,
    usedByCount: items.length,
    enabledByCount: items.filter((item) => item.enabled).length,
    usedByPiAgentsCount: items.filter((item) => item.runtime === 'Pi' && item.enabled).length,
    piToolReadyCount: 0,
  } satisfies CapabilityUsageSummary
}

export const buildMcpUsageSummary = (params: {
  agents: AgentRecord[]
  server: McpServerPolicy
}) => {
  const items = params.agents
    .flatMap<CapabilityUsageItem>((agent) => {
      const profile = parseCustomAgentProfile(agent)
      const matches = profile.mcpServers.filter((mounted) => matchMcpServer(mounted, params.server))
      if (matches.length === 0) {
        return []
      }

      return matches.map((mounted) => ({
        agentId: agent.id,
        agentName: agent.name,
        enabled: mounted.enabled,
        kind: 'mcp',
        runtime: profile.preferredRuntime ?? 'Pi',
        piToolReady: profile.preferredRuntime === 'Pi'
          && mounted.enabled
          && mounted.capabilityMode === 'resources+tools',
      }))
    })

  return {
    items,
    usedByCount: items.length,
    enabledByCount: items.filter((item) => item.enabled).length,
    usedByPiAgentsCount: items.filter((item) => item.runtime === 'Pi' && item.enabled).length,
    piToolReadyCount: items.filter((item) => item.piToolReady).length,
  } satisfies CapabilityUsageSummary
}
