// [INPUT]: 资源供给请求
// [OUTPUT]: 供给结果
// [POS]: 工作区资源供给
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { parsePrimaryAgentMcpServers, type McpServerPolicy } from '@shared/mcp'
import { normalizeAgentConfig } from '@shared/agent-config'
import { cloneSkillToWorkspace, cloneWorkspaceSkills } from '../repositories/skill'
import { and, eq } from 'drizzle-orm'

import { loadState, saveStateMeta } from '../storage/app-state-store'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { workspaceResourceSyncLinks } from '../storage/postgres/schema'
import { cloneWorkspaceModelProfiles } from '../storage/postgres/model-profile-store'
import {
  getWorkspaceRuntimeEnvironmentConfig,
  setWorkspaceRuntimeEnvironmentConfig,
} from '../storage/postgres/runtime-environment-store'
import {
  getWorkspaceEnvironmentTemplateConfig,
  setWorkspaceEnvironmentTemplateConfig,
} from '../storage/postgres/workspace-environment-template-store'

type ProvisionWorkspaceResourcesInput = {
  ownerUserId: string
  sourceWorkspaceId?: string
  targetWorkspaceId: string
}

const cloneWorkspaceMcpServers = (params: {
  servers: McpServerPolicy[]
  ownerUserId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
}) => {
  const clonedServers = params.servers
    .filter((server) => (
      !server.managedBySystem
      && server.ownerUserId === params.ownerUserId
      && server.visibility === 'workspace'
      && server.workspaceId === params.sourceWorkspaceId
    ))
    .map((server) => ({
      ...server,
      id: crypto.randomUUID(),
      workspaceId: params.targetWorkspaceId,
    }))

  return clonedServers.length > 0 ? [...params.servers, ...clonedServers] : params.servers
}

const saveWorkspaceResourceSyncLink = async (input: {
  ownerUserId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
}) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(workspaceResourceSyncLinks)
    .values({
      sourceWorkspaceId: input.sourceWorkspaceId,
      targetWorkspaceId: input.targetWorkspaceId,
      ownerUserId: input.ownerUserId,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
}

const listTargetWorkspaceIdsForSource = async (input: {
  ownerUserId: string
  sourceWorkspaceId: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ targetWorkspaceId: workspaceResourceSyncLinks.targetWorkspaceId })
    .from(workspaceResourceSyncLinks)
    .where(and(
      eq(workspaceResourceSyncLinks.sourceWorkspaceId, input.sourceWorkspaceId),
      eq(workspaceResourceSyncLinks.ownerUserId, input.ownerUserId),
    ))

  return rows.map((row) => row.targetWorkspaceId).filter(Boolean)
}

export const provisionWorkspaceResourcesFromSourceWorkspace = async (input: ProvisionWorkspaceResourcesInput) => {
  const sourceWorkspaceId = input.sourceWorkspaceId?.trim()
  const targetWorkspaceId = input.targetWorkspaceId.trim()
  if (!sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId) {
    return { modelProfiles: 0, skills: 0, mcpServers: 0 }
  }

  const [modelProfiles, skills, runtimeEnvironmentConfig, environmentTemplate] = await Promise.all([
    cloneWorkspaceModelProfiles({
      ownerUserId: input.ownerUserId,
      sourceWorkspaceId,
      targetWorkspaceId,
    }),
    Promise.resolve(cloneWorkspaceSkills({
      ownerUserId: input.ownerUserId,
      sourceWorkspaceId,
      targetWorkspaceId,
    })),
    getWorkspaceRuntimeEnvironmentConfig(sourceWorkspaceId),
    getWorkspaceEnvironmentTemplateConfig(sourceWorkspaceId),
  ])

  await Promise.all([
    runtimeEnvironmentConfig
      ? setWorkspaceRuntimeEnvironmentConfig(targetWorkspaceId, runtimeEnvironmentConfig)
      : Promise.resolve(),
    environmentTemplate
      ? setWorkspaceEnvironmentTemplateConfig(targetWorkspaceId, environmentTemplate)
      : Promise.resolve(),
  ])

  await saveWorkspaceResourceSyncLink({
    ownerUserId: input.ownerUserId,
    sourceWorkspaceId,
    targetWorkspaceId,
  })

  const state = loadState()
  const currentMcpServers = parsePrimaryAgentMcpServers({ mcpServers: state.config.mcpServers })
  const nextMcpServers = cloneWorkspaceMcpServers({
    servers: currentMcpServers,
    ownerUserId: input.ownerUserId,
    sourceWorkspaceId,
    targetWorkspaceId,
  })

  if (nextMcpServers.length !== currentMcpServers.length) {
    saveStateMeta({
      ...state,
      config: normalizeAgentConfig({
        ...state.config,
        mcpServers: nextMcpServers,
      }),
    })
  }

  return {
    modelProfiles: modelProfiles.length,
    skills: skills.length,
    mcpServers: nextMcpServers.length - currentMcpServers.length,
    runtimeEnvironment: runtimeEnvironmentConfig ? 1 : 0,
    environmentTemplate: environmentTemplate ? 1 : 0,
  }
}

export const syncSkillToProvisionedWorkspaces = async (input: {
  ownerUserId: string
  sourceWorkspaceId?: string | null
  skillId: string
}) => {
  const sourceWorkspaceId = input.sourceWorkspaceId?.trim()
  if (!sourceWorkspaceId) {
    return []
  }

  const targetWorkspaceIds = await listTargetWorkspaceIdsForSource({
    ownerUserId: input.ownerUserId,
    sourceWorkspaceId,
  })

  return targetWorkspaceIds
    .map((targetWorkspaceId) => cloneSkillToWorkspace({
      skillId: input.skillId,
      ownerUserId: input.ownerUserId,
      targetWorkspaceId,
    }))
    .filter((skill) => skill !== null)
}
