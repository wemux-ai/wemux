// [INPUT]: Railway Account Token + 目标范围（用户全量 / 单 railway 项目）。
// [OUTPUT]: 事实表 upsert + 分支匹配 suggested 绑定 + 读取查询。
// [POS]: Railway 同步编排（连接 → 项目 → 环境 → 部署 → 事实表 → 绑定）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import {
  buildRailwayResourceId,
  isRailwayDeploymentStatus,
  type RailwayDeploymentStatus,
  type RailwayDeploymentSummary,
} from '@shared/types'
import { loadState } from '../storage/app-state-store'
import { listWorkspaces } from '../storage/distributed-task-store'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { railwayDeployments, railwayProjectResources, railwayProjects } from '../storage/postgres/schema'
import { upsertRailwayResourceBinding, deleteStaleRailwaySuggestedBindings } from '../storage/postgres/railway-resource-binding-store'
import { loadRailwayToken, listRailwayConnectionSummaries, markRailwayConnectionError, markRailwayConnectionSynced } from './railway-connection-service'
import {
  listRailwayDeployments,
  listRailwayEnvironments,
  listRailwayProjects,
  type RailwayDeploymentFact,
  type RailwayProjectFact,
} from './railway-graphql-client'

const normalizeBranch = (value?: string | null) => value?.trim() || ''

export type RailwaySyncResult = { ok: true; projectCount: number } | { ok: false; message: string }

type RailwayDeploymentRow = typeof railwayDeployments.$inferSelect

const mapDeploymentRow = (row: RailwayDeploymentRow): RailwayDeploymentSummary => ({
  id: row.id,
  railwayProjectId: row.railwayProjectId,
  environmentId: row.environmentId,
  environmentName: row.environmentName,
  isEphemeral: row.isEphemeral,
  prNumber: row.prNumber ?? undefined,
  prTitle: row.prTitle ?? undefined,
  prRepo: row.prRepo ?? undefined,
  branch: row.branch ?? undefined,
  baseBranch: row.baseBranch ?? undefined,
  serviceId: row.serviceId ?? undefined,
  serviceName: row.serviceName ?? undefined,
  status: row.status,
  url: row.url ?? undefined,
  staticUrl: row.staticUrl ?? undefined,
  isLatest: row.isLatest,
  syncedAt: row.syncedAt,
  updatedAt: row.updatedAt,
})

const normalizeStatus = (status: string): RailwayDeploymentStatus => (
  isRailwayDeploymentStatus(status) ? status : 'REMOVED'
)

const upsertRailwayProjects = async (projects: RailwayProjectFact[]) => {
  if (projects.length === 0) return
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(railwayProjects)
    .values(projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      primaryEnvironmentId: project.primaryEnvironmentId ?? null,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })))
    .onConflictDoUpdate({
      target: railwayProjects.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        primaryEnvironmentId: sql`excluded.primary_environment_id`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
}

const upsertDeploymentSnapshot = async (params: {
  railwayProjectId: string
  environmentId: string
  environmentName: string
  isEphemeral: boolean
  prNumber?: number
  prTitle?: string
  prRepo?: string
  branch?: string
  baseBranch?: string
  deployment: RailwayDeploymentFact
  isLatest: boolean
}) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const { deployment } = params
  await getDrizzleDb()
    .insert(railwayDeployments)
    .values({
      id: deployment.id,
      railwayProjectId: params.railwayProjectId,
      environmentId: params.environmentId,
      environmentName: params.environmentName,
      isEphemeral: params.isEphemeral,
      prNumber: params.prNumber ?? null,
      prTitle: params.prTitle ?? null,
      prRepo: params.prRepo ?? null,
      branch: params.branch ?? null,
      baseBranch: params.baseBranch ?? null,
      serviceId: deployment.serviceId ?? null,
      serviceName: deployment.serviceName ?? null,
      status: normalizeStatus(deployment.status),
      url: deployment.url ?? null,
      staticUrl: deployment.staticUrl ?? null,
      isLatest: params.isLatest,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [railwayDeployments.railwayProjectId, railwayDeployments.environmentId, railwayDeployments.serviceId],
      set: {
        id: deployment.id,
        environmentName: params.environmentName,
        isEphemeral: params.isEphemeral,
        prNumber: params.prNumber ?? null,
        prTitle: params.prTitle ?? null,
        prRepo: params.prRepo ?? null,
        branch: params.branch ?? null,
        baseBranch: params.baseBranch ?? null,
        serviceName: deployment.serviceName ?? null,
        status: normalizeStatus(deployment.status),
        url: deployment.url ?? null,
        staticUrl: deployment.staticUrl ?? null,
        isLatest: params.isLatest,
        syncedAt: now,
        updatedAt: now,
      },
    })
}

const clearEnvironmentLatestFlags = async (railwayProjectId: string, environmentId: string) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .update(railwayDeployments)
    .set({ isLatest: false })
    .where(and(
      eq(railwayDeployments.railwayProjectId, railwayProjectId),
      eq(railwayDeployments.environmentId, environmentId),
    ))
}

const deleteStaleDeployments = async (
  railwayProjectId: string,
  keepEnvironmentIds: Set<string>,
) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ id: railwayDeployments.id, environmentId: railwayDeployments.environmentId })
    .from(railwayDeployments)
    .where(eq(railwayDeployments.railwayProjectId, railwayProjectId))
  const staleIds = rows
    .filter((row) => !keepEnvironmentIds.has(row.environmentId))
    .map((row) => row.id)
  if (staleIds.length === 0) return
  await getDrizzleDb()
    .delete(railwayDeployments)
    .where(inArray(railwayDeployments.id, staleIds))
}

const syncRailwayProjectEnvironments = async (token: string, project: RailwayProjectFact) => {
  const environmentsResult = await listRailwayEnvironments(token, project.id)
  if (!environmentsResult.ok) {
    throw new Error(`同步 Railway 项目「${project.name}」的环境失败：${environmentsResult.message}`)
  }

  const keepEnvironmentIds = new Set<string>()
  for (const environment of environmentsResult.data) {
    keepEnvironmentIds.add(environment.id)
    const deploymentsResult = await listRailwayDeployments(token, {
      projectId: project.id,
      environmentId: environment.id,
    })
    if (!deploymentsResult.ok) {
      // 单个环境失败不阻断整个项目：跳过并保留旧快照。
      console.warn(`[railway-sync] 跳过环境 ${environment.id}：${deploymentsResult.message}`)
      continue
    }

    // 每个 service 取最新一条部署。
    const latestByService = new Map<string, RailwayDeploymentFact>()
    for (const deployment of deploymentsResult.data) {
      const key = deployment.serviceId?.trim() || 'default'
      const current = latestByService.get(key)
      if (!current || (deployment.updatedAt ?? '') > (current.updatedAt ?? '')) {
        latestByService.set(key, deployment)
      }
    }

    const facts = [...latestByService.values()]
    if (facts.length === 0) continue

    const latestOverall = facts.reduce((acc, fact) => (
      (fact.updatedAt ?? '') >= (acc.updatedAt ?? '') ? fact : acc
    ), facts[0])

    await clearEnvironmentLatestFlags(project.id, environment.id)
    for (const deployment of facts) {
      await upsertDeploymentSnapshot({
        railwayProjectId: project.id,
        environmentId: environment.id,
        environmentName: environment.name,
        isEphemeral: environment.isEphemeral,
        prNumber: environment.prNumber,
        prTitle: environment.prTitle,
        prRepo: environment.prRepo,
        branch: environment.branch,
        baseBranch: environment.baseBranch,
        deployment,
        isLatest: deployment.id === latestOverall.id,
      })
    }
  }

  await deleteStaleDeployments(project.id, keepEnvironmentIds)
}

const syncRailwayProject = async (token: string, project: RailwayProjectFact) => {
  await syncRailwayProjectEnvironments(token, project)
}

export const syncRailwayForUser = async (userId: string): Promise<RailwaySyncResult> => {
  const token = await loadRailwayToken(userId)
  if (!token) {
    return { ok: false, message: '尚未连接 Railway 账号。' }
  }

  try {
    const projectsResult = await listRailwayProjects(token)
    if (!projectsResult.ok) {
      throw new Error(projectsResult.message)
    }

    await upsertRailwayProjects(projectsResult.data)
    for (const project of projectsResult.data) {
      await syncRailwayProject(token, project)
    }

    await suggestRailwayDeploymentBindings()
    await cleanupStaleRailwaySuggestedBindings()
    await markRailwayConnectionSynced(userId)
    return { ok: true, projectCount: projectsResult.data.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Railway 同步失败。'
    await markRailwayConnectionError(userId, message)
    return { ok: false, message }
  }
}

/** 供 webhook 触发：按 railway project id 定向重同步所有已连接账号。 */
export const resyncRailwayProjectByRailwayProjectId = async (railwayProjectId: string) => {
  const connections = await listRailwayConnectionSummaries()
  let synced = 0
  for (const connection of connections) {
    const token = await loadRailwayToken(connection.userId)
    if (!token) continue
    try {
      const projectsResult = await listRailwayProjects(token)
      if (!projectsResult.ok) continue
      const project = projectsResult.data.find((item) => item.id === railwayProjectId)
      if (!project) continue
      await syncRailwayProject(token, project)
      synced += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : '重同步失败。'
      await markRailwayConnectionError(connection.userId, message)
    }
  }
  if (synced > 0) {
    await suggestRailwayDeploymentBindings()
    await cleanupStaleRailwaySuggestedBindings()
  }
  return synced
}

// ─── 绑定建议（分支匹配） ──────────────────────────────────────────

const associateRailwayProject = async (railwayProjectId: string, projectId: string) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(railwayProjectResources)
    .values({ railwayProjectId, projectId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [railwayProjectResources.railwayProjectId, railwayProjectResources.projectId],
      set: { updatedAt: now },
    })
}

export const suggestRailwayDeploymentBindings = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(railwayDeployments)
    .where(eq(railwayDeployments.isLatest, true))
  if (rows.length === 0) return

  const state = loadState()
  const workspaces = listWorkspaces()
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const sessionsByBranch = new Map<string, typeof state.workspaceSessions>()
  for (const session of state.workspaceSessions) {
    if (session.status === 'archived') continue
    const branch = normalizeBranch(session.branchName)
    if (!branch) continue
    const group = sessionsByBranch.get(branch) ?? []
    group.push(session)
    sessionsByBranch.set(branch, group)
  }

  for (const row of rows) {
    const branch = normalizeBranch(row.branch)
    if (!branch) continue
    const sessions = sessionsByBranch.get(branch) ?? []
    for (const session of sessions) {
      const workspace = workspaceById.get(session.workspaceId)
      if (!workspace) continue
      await associateRailwayProject(row.railwayProjectId, workspace.projectId)
      await upsertRailwayResourceBinding({
        resourceType: 'deployment',
        resourceId: buildRailwayResourceId({
          railwayProjectId: row.railwayProjectId,
          environmentId: row.environmentId,
          deploymentId: row.id,
        }),
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        workspaceSessionId: session.id,
        role: 'reference',
        status: 'suggested',
        source: 'branch_match',
        confidence: 80,
      })
    }
  }
}

const cleanupStaleRailwaySuggestedBindings = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ id: railwayDeployments.id })
    .from(railwayDeployments)
  await deleteStaleRailwaySuggestedBindings(new Set(rows.map((row) => row.id)))
}

// ─── 读取（API 用） ────────────────────────────────────────────────

export const listRailwayDeploymentsForProject = async (projectId: string): Promise<RailwayDeploymentSummary[]> => {
  await ensurePostgresReady()
  const associations = await getDrizzleDb()
    .select({ railwayProjectId: railwayProjectResources.railwayProjectId })
    .from(railwayProjectResources)
    .where(eq(railwayProjectResources.projectId, projectId))
  const railwayProjectIds = associations.map((item) => item.railwayProjectId)
  if (railwayProjectIds.length === 0) return []

  const rows = await getDrizzleDb()
    .select()
    .from(railwayDeployments)
    .where(inArray(railwayDeployments.railwayProjectId, railwayProjectIds))
    .orderBy(desc(railwayDeployments.updatedAt))
  return rows.map(mapDeploymentRow)
}

export const listRailwayProjectsForProject = async (projectId: string) => {
  await ensurePostgresReady()
  const associations = await getDrizzleDb()
    .select({ railwayProjectId: railwayProjectResources.railwayProjectId })
    .from(railwayProjectResources)
    .where(eq(railwayProjectResources.projectId, projectId))
  const railwayProjectIds = associations.map((item) => item.railwayProjectId)
  if (railwayProjectIds.length === 0) return []

  return getDrizzleDb()
    .select()
    .from(railwayProjects)
    .where(inArray(railwayProjects.id, railwayProjectIds))
    .orderBy(desc(railwayProjects.updatedAt))
}

export const countRailwayProjects = async (): Promise<number> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ id: railwayProjects.id })
    .from(railwayProjects)
  return rows.length
}

/** 校验 deployment 资源是否属于某 wemux 项目（resourceId 尾段为 deployment id）。 */
export const hasRailwayProjectResource = async (params: {
  resourceId: string
  projectId: string
}): Promise<boolean> => {
  const deploymentId = params.resourceId.trim().split(':').pop()
  if (!deploymentId) return false

  await ensurePostgresReady()
  const deploymentRows = await getDrizzleDb()
    .select({ railwayProjectId: railwayDeployments.railwayProjectId })
    .from(railwayDeployments)
    .where(eq(railwayDeployments.id, deploymentId))
    .limit(1)
  const deployment = deploymentRows[0]
  if (!deployment) return false

  const associationRows = await getDrizzleDb()
    .select({ railwayProjectId: railwayProjectResources.railwayProjectId })
    .from(railwayProjectResources)
    .where(and(
      eq(railwayProjectResources.railwayProjectId, deployment.railwayProjectId),
      eq(railwayProjectResources.projectId, params.projectId),
    ))
    .limit(1)
  return associationRows.length > 0
}
