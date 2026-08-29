/**
 * [INPUT]: Canonical GitHub resource identity and wemux project scope.
 * [OUTPUT]: Idempotent project-resource links and scoped resource projections.
 * [POS]: Project membership authority for globally unique GitHub resources.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { and, eq, inArray } from 'drizzle-orm'

import type { GitHubResourceType } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { githubProjectResources } from './schema'

const normalizeProjectIds = (projectIds: string[]) => (
  projectIds
    .map((projectId) => projectId.trim())
    .filter((projectId, index, items) => Boolean(projectId) && items.indexOf(projectId) === index)
)

export const upsertGitHubProjectResource = async (params: {
  resourceType: GitHubResourceType
  resourceId: string
  projectId: string
}) => {
  await ensurePostgresReady()
  const resourceId = params.resourceId.trim()
  const projectId = params.projectId.trim()
  if (!resourceId || !projectId) {
    throw new Error('GitHub project resource requires resourceId and projectId.')
  }

  const now = new Date().toISOString()
  await getDrizzleDb()
    .insert(githubProjectResources)
    .values({
      provider: 'github',
      resourceType: params.resourceType,
      resourceId,
      projectId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        githubProjectResources.provider,
        githubProjectResources.resourceType,
        githubProjectResources.resourceId,
        githubProjectResources.projectId,
      ],
      set: {
        updatedAt: now,
      },
    })
}

export const hasGitHubProjectResource = async (params: {
  resourceType: GitHubResourceType
  resourceId: string
  projectId: string
}) => {
  await ensurePostgresReady()
  const resourceId = params.resourceId.trim()
  const projectId = params.projectId.trim()
  if (!resourceId || !projectId) {
    return false
  }

  const row = (await getDrizzleDb()
    .select({ resourceId: githubProjectResources.resourceId })
    .from(githubProjectResources)
    .where(and(
      eq(githubProjectResources.provider, 'github'),
      eq(githubProjectResources.resourceType, params.resourceType),
      eq(githubProjectResources.resourceId, resourceId),
      eq(githubProjectResources.projectId, projectId),
    ))
    .limit(1))[0]
  return Boolean(row)
}

export const resolveGitHubProjectResourceScope = async (params: {
  resourceType: GitHubResourceType
  projectIds: string[]
}) => {
  await ensurePostgresReady()
  const projectIds = normalizeProjectIds(params.projectIds)
  if (projectIds.length === 0) {
    return new Map<string, string>()
  }

  const links = await getDrizzleDb()
    .select({
      resourceId: githubProjectResources.resourceId,
      projectId: githubProjectResources.projectId,
    })
    .from(githubProjectResources)
    .where(and(
      eq(githubProjectResources.provider, 'github'),
      eq(githubProjectResources.resourceType, params.resourceType),
      inArray(githubProjectResources.projectId, projectIds),
    ))

  const linksByProjectId = new Map<string, string[]>()
  for (const link of links) {
    const resourceIds = linksByProjectId.get(link.projectId) ?? []
    resourceIds.push(link.resourceId)
    linksByProjectId.set(link.projectId, resourceIds)
  }

  const projectIdByResourceId = new Map<string, string>()
  for (const projectId of projectIds) {
    for (const resourceId of linksByProjectId.get(projectId) ?? []) {
      if (!projectIdByResourceId.has(resourceId)) {
        projectIdByResourceId.set(resourceId, projectId)
      }
    }
  }
  return projectIdByResourceId
}
