/**
 * [INPUT]: Persisted workspace-session Agent bindings, acting-user scope, and runtime capability policies.
 * [OUTPUT]: Enabled bound Agent capabilities plus stable task runtime snapshots; legacy name fallback stays owner-scoped.
 * [POS]: Workspace execution capability resolver; assignment authorization remains in task-agent-assignment-service.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { isCustomAgentEnabled, readCustomAgentConfig } from '@shared/custom-agent'
import { mergeOpenCodeExecutionConfig } from '@shared/opencode-execution-config'
import type { McpServerPolicy } from '@shared/mcp'
import type { AgentRecord, ExecutorSkillPackage, OpenCodeExecutionConfig, WorkspaceSession } from '@shared/types'
import { getAllAgents } from '../repositories/agent'
import { getPrimaryAgentMcpServers } from './primary-agent-mcp'
import { dedupeRuntimeSkills, resolvePrimaryAgentSkills, resolveRuntimeSkillPackages, resolveSkillSelections } from './skill-service'

const RUNTIME_CAPABILITY_SNAPSHOT_ENV_KEY = 'VIBEMUX_RUNTIME_CAPABILITY_SNAPSHOT'

type RuntimeCapabilitySnapshot = {
  runtimeSkillPackages?: ExecutorSkillPackage[]
  mcpServers?: McpServerPolicy[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const dedupeMcpServers = (servers: McpServerPolicy[]) => {
  const seen = new Set<string>()
  return servers.filter((server) => {
    const key = server.id?.trim() || server.name.trim()
    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

const normalizeSelectedMcpServerIds = (session?: Pick<WorkspaceSession, 'enabledMcpServerIds'> | null) => {
  return new Set(
    (Array.isArray(session?.enabledMcpServerIds) ? session.enabledMcpServerIds : [])
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

const stripRuntimeCapabilitySnapshotFromEnv = (runtimeEnv?: Record<string, string>) => {
  if (!runtimeEnv || !(RUNTIME_CAPABILITY_SNAPSHOT_ENV_KEY in runtimeEnv)) {
    return runtimeEnv
  }

  const nextEntries = Object.entries(runtimeEnv).filter(([key]) => key !== RUNTIME_CAPABILITY_SNAPSHOT_ENV_KEY)
  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined
}

const normalizeRuntimeCapabilitySnapshot = (snapshot?: RuntimeCapabilitySnapshot | null): RuntimeCapabilitySnapshot => {
  return {
    runtimeSkillPackages: Array.isArray(snapshot?.runtimeSkillPackages) ? snapshot.runtimeSkillPackages : undefined,
    mcpServers: Array.isArray(snapshot?.mcpServers) ? dedupeMcpServers(snapshot.mcpServers) : undefined,
  }
}

const parseRuntimeCapabilitySnapshot = (runtimeEnv?: Record<string, string>): RuntimeCapabilitySnapshot | null => {
  const raw = runtimeEnv?.[RUNTIME_CAPABILITY_SNAPSHOT_ENV_KEY]?.trim()
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return null
    }

    return normalizeRuntimeCapabilitySnapshot({
      runtimeSkillPackages: Array.isArray(parsed.runtimeSkillPackages)
        ? parsed.runtimeSkillPackages as ExecutorSkillPackage[]
        : undefined,
      mcpServers: Array.isArray(parsed.mcpServers)
        ? parsed.mcpServers as McpServerPolicy[]
        : undefined,
    })
  } catch {
    return null
  }
}

const encodeRuntimeCapabilitySnapshot = (snapshot: RuntimeCapabilitySnapshot) => {
  const normalized = normalizeRuntimeCapabilitySnapshot(snapshot)
  if (!normalized.runtimeSkillPackages?.length && !normalized.mcpServers?.length) {
    return undefined
  }

  return JSON.stringify(normalized)
}

export const selectBoundCustomAgent = (
  catalog: AgentRecord[],
  session?: Pick<WorkspaceSession, 'customAgentId' | 'customAgentName'> | null,
  userId?: string,
) => {
  if (!session?.customAgentId?.trim() && !session?.customAgentName?.trim()) {
    return null
  }

  const customAgentId = session.customAgentId?.trim()
  const customAgentName = session.customAgentName?.trim()
  const agent = customAgentId
    ? catalog.find((item) => item.id === customAgentId)
    : userId?.trim() && customAgentName
      ? catalog.find((item) => item.ownerUserId === userId.trim() && item.name.trim() === customAgentName)
      : null

  if (!agent || agent.type.trim().toLowerCase() === 'main') {
    return null
  }

  const profile = readCustomAgentConfig(agent.config)
  if (!isCustomAgentEnabled(profile)) {
    return null
  }

  return { agent, profile }
}

export const resolveBoundCustomAgent = (
  session?: Pick<WorkspaceSession, 'customAgentId' | 'customAgentName'> | null,
  userId?: string,
) => selectBoundCustomAgent(getAllAgents(), session, userId)

export const resolveExecutionSkillsForSession = (params: {
  projectId?: string
  workspaceId?: string
  userId?: string
  session?: Pick<WorkspaceSession, 'customAgentId' | 'customAgentName'> | null
}) => {
  const primarySkills = resolvePrimaryAgentSkills({
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    userId: params.userId,
  })
  const boundCustomAgent = resolveBoundCustomAgent(params.session, params.userId)
  if (!boundCustomAgent) {
    return primarySkills
  }

  const customSkills = resolveSkillSelections(boundCustomAgent.profile.skills, {
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    userId: params.userId,
  })

  return dedupeRuntimeSkills([...primarySkills, ...customSkills], {
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    preferredSkillIds: new Set(customSkills.map((skill) => skill.id)),
  })
}

export const resolveExecutionMcpServerNamesForSession = (params: {
  userId?: string
  session?: Pick<WorkspaceSession, 'customAgentId' | 'customAgentName' | 'enabledMcpServerIds'> | null
  primaryMcpServers?: McpServerPolicy[]
}) => {
  return resolveExecutionMcpServersForSession(params).map((server) => server.name)
}

export const resolveExecutionMcpServersForSession = (params: {
  userId?: string
  session?: Pick<WorkspaceSession, 'customAgentId' | 'customAgentName' | 'enabledMcpServerIds'> | null
  primaryMcpServers?: McpServerPolicy[]
}) => {
  const boundCustomAgent = resolveBoundCustomAgent(params.session, params.userId)
  const selectedServerIds = normalizeSelectedMcpServerIds(params.session)
  const availableServers = dedupeMcpServers([
    ...(params.primaryMcpServers ?? getPrimaryAgentMcpServers(undefined, params.userId)).filter((server) => server.enabled),
    ...(boundCustomAgent?.profile.mcpServers.filter((server) => server.enabled) ?? []),
  ])

  if (selectedServerIds.size === 0) {
    return availableServers
  }

  return availableServers.filter((server) => selectedServerIds.has(server.id))
}

export const resolveExecutionOpencodeConfigForSession = (params: {
  baseConfig?: OpenCodeExecutionConfig
  userId?: string
  session?: Pick<WorkspaceSession, 'customAgentId' | 'customAgentName'> | null
}) => {
  const boundCustomAgent = resolveBoundCustomAgent(params.session, params.userId)
  if (!boundCustomAgent) {
    return params.baseConfig
  }

  const customMcpServers = boundCustomAgent.profile.mcpServers.filter((server) => server.enabled)
  if (customMcpServers.length === 0) {
    return params.baseConfig
  }

  return mergeOpenCodeExecutionConfig(params.baseConfig, {
    mcpServers: customMcpServers,
  })
}

export const resolveTaskRuntimeCapabilitySnapshot = (params: {
  projectId?: string
  workspaceId?: string
  userId?: string
  runtimeEnv?: Record<string, string>
  runtimeSkillPackages?: ExecutorSkillPackage[]
  mcpServers?: McpServerPolicy[]
  opencodeConfig?: OpenCodeExecutionConfig
}) => {
  const persistedSnapshot = parseRuntimeCapabilitySnapshot(params.runtimeEnv)
  const runtimeSkillPackages = Array.isArray(params.runtimeSkillPackages)
    ? params.runtimeSkillPackages
    : (persistedSnapshot?.runtimeSkillPackages
      ?? resolveRuntimeSkillPackages({
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        userId: params.userId,
      }))
  const mcpServers = Array.isArray(params.mcpServers)
    ? dedupeMcpServers(params.mcpServers)
    : dedupeMcpServers(persistedSnapshot?.mcpServers ?? params.opencodeConfig?.mcpServers ?? [])

  const snapshotValue = encodeRuntimeCapabilitySnapshot({
    runtimeSkillPackages,
    mcpServers,
  })
  const baseRuntimeEnv = stripRuntimeCapabilitySnapshotFromEnv(params.runtimeEnv)
  const runtimeEnv = snapshotValue
    ? {
        ...(baseRuntimeEnv ?? {}),
        [RUNTIME_CAPABILITY_SNAPSHOT_ENV_KEY]: snapshotValue,
      }
    : baseRuntimeEnv
  const opencodeConfig = mcpServers.length > 0
    ? mergeOpenCodeExecutionConfig(params.opencodeConfig, { mcpServers })
    : params.opencodeConfig

  return {
    runtimeSkillPackages,
    mcpServers,
    runtimeEnv,
    opencodeConfig,
  }
}

export const withoutRuntimeCapabilitySnapshotEnv = (runtimeEnv?: Record<string, string>) => {
  return stripRuntimeCapabilitySnapshotFromEnv(runtimeEnv)
}
