/**
 * [INPUT]: Canonical pull request snapshots and project-resource scope.
 * [OUTPUT]: Globally deduplicated PR persistence with project-scoped projections.
 * [POS]: GitHub pull request fact store; task/workspace relationships live in resource bindings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type { ProjectPullRequestReviewSummary } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import {
  resolveGitHubProjectResourceScope,
  upsertGitHubProjectResource,
} from './github-project-resource-store'
import { projectPullRequests } from './schema'

type ProjectPullRequestRow = typeof projectPullRequests.$inferSelect

const mapProjectPullRequestRow = (
  row: ProjectPullRequestRow,
  projectId = row.projectId,
): ProjectPullRequestReviewSummary => ({
  id: row.id,
  provider: row.provider,
  projectId,
  repoHost: row.repoHost,
  repoOwner: row.repoOwner,
  repoName: row.repoName,
  repoFullName: row.repoFullName,
  repoUrl: row.repoUrl,
  number: Number(row.number),
  url: row.url ?? undefined,
  title: row.title,
  body: row.body,
  authorLogin: row.authorLogin ?? undefined,
  state: row.state,
  merged: row.merged,
  draft: row.draft,
  baseBranch: row.baseBranch,
  compareBranch: row.compareBranch,
  headOwner: row.headOwner ?? undefined,
  headRepo: row.headRepo ?? undefined,
  additions: Number(row.additions),
  deletions: Number(row.deletions),
  changedFiles: Number(row.changedFiles),
  files: Array.isArray(row.filesJson) ? row.filesJson : [],
  matchedWorkspaceId: row.matchedWorkspaceId ?? undefined,
  matchedWorkspaceSessionId: row.matchedWorkspaceSessionId ?? undefined,
  matchedTaskId: row.matchedTaskId ?? undefined,
  matchedTaskTitle: row.matchedTaskTitle ?? undefined,
  syncedAt: row.syncedAt,
  createdAt: row.prCreatedAt ?? undefined,
  updatedAt: row.prUpdatedAt ?? undefined,
  mergedAt: row.mergedAt ?? undefined,
  closedAt: row.closedAt ?? undefined,
})

export type ProjectPullRequestListOptions = {
  projectId?: string
  projectIds?: string[]
  limit?: number
  offset?: number
}

const normalizeListLimit = (value?: number) => Math.min(Math.max(Math.floor(value ?? 0), 0) || 50, 100)
const normalizeListOffset = (value?: number) => Math.max(Math.floor(value ?? 0), 0)

export const listProjectPullRequests = async (
  options?: string | ProjectPullRequestListOptions,
): Promise<ProjectPullRequestReviewSummary[]> => {
  await ensurePostgresReady()
  const normalizedOptions = typeof options === 'string' ? { projectId: options } : (options ?? {})
  const projectId = normalizedOptions.projectId?.trim()
  const projectIds = normalizedOptions.projectIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const hasProjectScope = Boolean(projectId) || normalizedOptions.projectIds !== undefined
  const projectScope = hasProjectScope
    ? await resolveGitHubProjectResourceScope({
        resourceType: 'pull_request',
        projectIds: projectId ? [projectId] : projectIds,
      })
    : undefined
  const limit = normalizedOptions.limit ? normalizeListLimit(normalizedOptions.limit) : undefined
  const offset = normalizeListOffset(normalizedOptions.offset)
  const filters = []

  if (hasProjectScope && projectScope?.size === 0) {
    return []
  }
  if (projectScope) {
    filters.push(inArray(projectPullRequests.id, [...projectScope.keys()]))
  }

  let dbQuery = getDrizzleDb()
    .select()
    .from(projectPullRequests)
    .$dynamic()

  if (filters.length > 0) {
    dbQuery = dbQuery.where(and(...filters))
  }

  dbQuery = dbQuery.orderBy(
    sql`CASE WHEN ${projectPullRequests.state} = 'open' THEN 0 WHEN ${projectPullRequests.state} = 'unknown' THEN 1 ELSE 2 END`,
    sql`${projectPullRequests.prUpdatedAt} DESC NULLS LAST`,
    desc(projectPullRequests.updatedAt),
  )

  if (limit) {
    dbQuery = dbQuery.limit(limit).offset(offset)
  }

  const rows = await dbQuery
  return rows.map((row) => mapProjectPullRequestRow(
    row,
    projectScope?.get(row.id) ?? row.projectId,
  ))
}

export const getProjectPullRequestById = async (
  id: string,
): Promise<ProjectPullRequestReviewSummary | null> => {
  await ensurePostgresReady()
  const normalizedId = id.trim()
  if (!normalizedId) {
    return null
  }

  const row = (await getDrizzleDb()
    .select()
    .from(projectPullRequests)
    .where(eq(projectPullRequests.id, normalizedId))
    .limit(1))[0]
  return row ? mapProjectPullRequestRow(row) : null
}

export const upsertProjectPullRequests = async (
  pullRequests: ProjectPullRequestReviewSummary[],
): Promise<ProjectPullRequestReviewSummary[]> => {
  await ensurePostgresReady()
  const saved: ProjectPullRequestReviewSummary[] = []
  for (const pullRequest of pullRequests) {
    const now = new Date().toISOString()
    const rows = await getDrizzleDb()
      .insert(projectPullRequests)
      .values({
        id: pullRequest.id,
        provider: pullRequest.provider,
        projectId: pullRequest.projectId,
        repoHost: pullRequest.repoHost,
        repoOwner: pullRequest.repoOwner,
        repoName: pullRequest.repoName,
        repoFullName: pullRequest.repoFullName,
        repoUrl: pullRequest.repoUrl,
        number: pullRequest.number,
        url: pullRequest.url ?? null,
        title: pullRequest.title,
        body: pullRequest.body,
        authorLogin: pullRequest.authorLogin ?? null,
        state: pullRequest.state,
        merged: pullRequest.merged,
        draft: pullRequest.draft,
        baseBranch: pullRequest.baseBranch,
        compareBranch: pullRequest.compareBranch,
        headOwner: pullRequest.headOwner ?? null,
        headRepo: pullRequest.headRepo ?? null,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        changedFiles: pullRequest.changedFiles,
        filesJson: pullRequest.files,
        matchedWorkspaceId: null,
        matchedWorkspaceSessionId: null,
        matchedTaskId: null,
        matchedTaskTitle: null,
        syncedAt: pullRequest.syncedAt,
        prCreatedAt: pullRequest.createdAt ?? null,
        prUpdatedAt: pullRequest.updatedAt ?? null,
        mergedAt: pullRequest.mergedAt ?? null,
        closedAt: pullRequest.closedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectPullRequests.provider,
          projectPullRequests.repoHost,
          projectPullRequests.repoOwner,
          projectPullRequests.repoName,
          projectPullRequests.number,
        ],
        set: {
          repoFullName: pullRequest.repoFullName,
          repoUrl: pullRequest.repoUrl,
          url: pullRequest.url ?? null,
          title: pullRequest.title,
          body: pullRequest.body,
          authorLogin: pullRequest.authorLogin ?? null,
          state: pullRequest.state,
          merged: pullRequest.merged,
          draft: pullRequest.draft,
          baseBranch: pullRequest.baseBranch,
          compareBranch: pullRequest.compareBranch,
          headOwner: pullRequest.headOwner ?? null,
          headRepo: pullRequest.headRepo ?? null,
          additions: pullRequest.additions,
          deletions: pullRequest.deletions,
          changedFiles: pullRequest.changedFiles,
          filesJson: pullRequest.files,
          syncedAt: pullRequest.syncedAt,
          prCreatedAt: pullRequest.createdAt ?? null,
          prUpdatedAt: pullRequest.updatedAt ?? null,
          mergedAt: pullRequest.mergedAt ?? null,
          closedAt: pullRequest.closedAt ?? null,
          updatedAt: now,
        },
      })
      .returning()
    const row = rows[0]
    if (row) {
      await upsertGitHubProjectResource({
        resourceType: 'pull_request',
        resourceId: row.id,
        projectId: pullRequest.projectId,
      })
      saved.push(mapProjectPullRequestRow(row, pullRequest.projectId))
    }
  }

  return saved
}
