/**
 * [INPUT]: Canonical issue snapshots and project-resource scope.
 * [OUTPUT]: Globally deduplicated issue persistence with project-scoped projections.
 * [POS]: GitHub issue fact store; task/workspace relationships live in resource bindings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type { ProjectIssueLabelSummary, ProjectIssueSummary } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import {
  resolveGitHubProjectResourceScope,
  upsertGitHubProjectResource,
} from './github-project-resource-store'
import { projectIssues } from './schema'

type ProjectIssueRow = typeof projectIssues.$inferSelect

const mapProjectIssueRow = (
  row: ProjectIssueRow,
  projectId = row.projectId,
): ProjectIssueSummary => ({
  id: row.id,
  projectId,
  repoFullName: row.repoFullName,
  number: Number(row.number),
  title: row.title,
  body: row.body,
  state: row.state === 'closed' ? 'closed' : 'open',
  url: row.url ?? undefined,
  authorLogin: row.authorLogin ?? undefined,
  labels: Array.isArray(row.labelsJson) ? row.labelsJson : [],
  assigneeLogins: Array.isArray(row.assigneeLoginsJson) ? row.assigneeLoginsJson : [],
  comments: Number(row.comments),
  createdAt: row.issueCreatedAt ?? undefined,
  updatedAt: row.issueUpdatedAt ?? undefined,
  closedAt: row.closedAt ?? undefined,
})

export type ProjectIssueUpsertInput = ProjectIssueSummary & {
  provider: string
  repoHost: string
  repoOwner: string
  repoName: string
  repoUrl: string
}

export type ProjectIssueListOptions = {
  projectId?: string
  projectIds?: string[]
  state?: 'open' | 'closed' | 'all'
  limit?: number
  offset?: number
}

const normalizeListLimit = (value?: number) => Math.min(Math.max(Math.floor(value ?? 0), 0) || 50, 100)
const normalizeListOffset = (value?: number) => Math.max(Math.floor(value ?? 0), 0)

export const listProjectIssues = async (
  options?: ProjectIssueListOptions,
): Promise<ProjectIssueSummary[]> => {
  await ensurePostgresReady()
  const normalizedOptions = options ?? {}
  const projectId = normalizedOptions.projectId?.trim()
  const projectIds = normalizedOptions.projectIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const hasProjectScope = Boolean(projectId) || normalizedOptions.projectIds !== undefined
  const projectScope = hasProjectScope
    ? await resolveGitHubProjectResourceScope({
        resourceType: 'issue',
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
    filters.push(inArray(projectIssues.id, [...projectScope.keys()]))
  }

  const stateFilter = normalizedOptions.state ?? 'open'
  if (stateFilter !== 'all') {
    filters.push(eq(projectIssues.state, stateFilter))
  }

  let dbQuery = getDrizzleDb()
    .select()
    .from(projectIssues)
    .$dynamic()

  if (filters.length > 0) {
    dbQuery = dbQuery.where(and(...filters))
  }

  dbQuery = dbQuery.orderBy(
    sql`CASE WHEN ${projectIssues.state} = 'open' THEN 0 ELSE 1 END`,
    sql`${projectIssues.issueUpdatedAt} DESC NULLS LAST`,
    desc(projectIssues.updatedAt),
  )

  if (limit) {
    dbQuery = dbQuery.limit(limit).offset(offset)
  }

  const rows = await dbQuery
  return rows.map((row) => mapProjectIssueRow(
    row,
    projectScope?.get(row.id) ?? row.projectId,
  ))
}

export const getProjectIssueById = async (
  id: string,
): Promise<ProjectIssueSummary | null> => {
  await ensurePostgresReady()
  const normalizedId = id.trim()
  if (!normalizedId) {
    return null
  }

  const row = (await getDrizzleDb()
    .select()
    .from(projectIssues)
    .where(eq(projectIssues.id, normalizedId))
    .limit(1))[0]
  return row ? mapProjectIssueRow(row) : null
}

export const upsertProjectIssues = async (
  issues: ProjectIssueUpsertInput[],
): Promise<ProjectIssueSummary[]> => {
  await ensurePostgresReady()
  const saved: ProjectIssueSummary[] = []
  for (const issue of issues) {
    const now = new Date().toISOString()
    const rows = await getDrizzleDb()
      .insert(projectIssues)
      .values({
        id: issue.id,
        provider: issue.provider,
        projectId: issue.projectId,
        repoHost: issue.repoHost,
        repoOwner: issue.repoOwner,
        repoName: issue.repoName,
        repoFullName: issue.repoFullName,
        repoUrl: issue.repoUrl,
        number: issue.number,
        url: issue.url ?? null,
        title: issue.title,
        body: issue.body,
        authorLogin: issue.authorLogin ?? null,
        state: issue.state,
        labelsJson: issue.labels,
        assigneeLoginsJson: issue.assigneeLogins,
        comments: issue.comments,
        syncedAt: now,
        issueCreatedAt: issue.createdAt ?? null,
        issueUpdatedAt: issue.updatedAt ?? null,
        closedAt: issue.closedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectIssues.provider,
          projectIssues.repoHost,
          projectIssues.repoOwner,
          projectIssues.repoName,
          projectIssues.number,
        ],
        set: {
          repoFullName: issue.repoFullName,
          repoUrl: issue.repoUrl,
          url: issue.url ?? null,
          title: issue.title,
          body: issue.body,
          authorLogin: issue.authorLogin ?? null,
          state: issue.state,
          labelsJson: issue.labels,
          assigneeLoginsJson: issue.assigneeLogins,
          comments: issue.comments,
          syncedAt: now,
          issueCreatedAt: issue.createdAt ?? null,
          issueUpdatedAt: issue.updatedAt ?? null,
          closedAt: issue.closedAt ?? null,
          updatedAt: now,
        },
      })
      .returning()
    const row = rows[0]
    if (row) {
      await upsertGitHubProjectResource({
        resourceType: 'issue',
        resourceId: row.id,
        projectId: issue.projectId,
      })
      saved.push(mapProjectIssueRow(row, issue.projectId))
    }
  }

  return saved
}
