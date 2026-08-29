/**
 * [INPUT]: Canonical workflow run snapshots and project-resource scope.
 * [OUTPUT]: Globally deduplicated run persistence with project-scoped projections.
 * [POS]: GitHub Actions run fact store; execution-context relationships live in resource bindings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import type {
  ProjectGitHubWorkflowRunConclusion,
  ProjectGitHubWorkflowRunStatus,
  ProjectGitHubWorkflowRunSummary,
} from '@shared/types'
import { buildGitHubRepositoryResourceId } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import {
  resolveGitHubProjectResourceScope,
  upsertGitHubProjectResource,
} from './github-project-resource-store'
import { projectWorkflowRuns } from './schema'

type ProjectWorkflowRunRow = typeof projectWorkflowRuns.$inferSelect

const normalizeStatus = (value: string): ProjectGitHubWorkflowRunStatus => {
  if (
    value === 'queued'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'waiting'
    || value === 'requested'
    || value === 'pending'
  ) {
    return value
  }
  return 'unknown'
}

const normalizeConclusion = (value: string | null): ProjectGitHubWorkflowRunConclusion | undefined => {
  if (!value) return undefined
  if (
    value === 'success'
    || value === 'failure'
    || value === 'neutral'
    || value === 'cancelled'
    || value === 'skipped'
    || value === 'timed_out'
    || value === 'action_required'
    || value === 'startup_failure'
    || value === 'stale'
  ) {
    return value
  }
  return 'unknown'
}

const mapProjectWorkflowRunRow = (
  row: ProjectWorkflowRunRow,
  projectId = row.projectId,
): ProjectGitHubWorkflowRunSummary => ({
  id: String(row.runId),
  resourceId: row.id,
  projectId,
  repoFullName: row.repoFullName,
  name: row.name,
  displayTitle: row.displayTitle,
  runNumber: Number(row.runNumber),
  runAttempt: Number(row.runAttempt),
  status: normalizeStatus(row.status),
  conclusion: normalizeConclusion(row.conclusion),
  event: row.event,
  headBranch: row.headBranch,
  headSha: row.headSha,
  url: row.url ?? undefined,
  createdAt: row.runCreatedAt ?? undefined,
  updatedAt: row.runUpdatedAt ?? undefined,
  runStartedAt: row.runStartedAt ?? undefined,
})

export type ProjectWorkflowRunUpsertInput = ProjectGitHubWorkflowRunSummary & {
  provider: string
  repoHost: string
  repoOwner: string
  repoName: string
  repoUrl: string
}

export type ProjectWorkflowRunListOptions = {
  projectId?: string
  projectIds?: string[]
  limit?: number
  offset?: number
}

export const buildProjectWorkflowRunResourceId = (params: {
  provider?: string
  repoHost: string
  repoOwner: string
  repoName: string
  runId: string | number
}) => {
  if ((params.provider ?? 'github') !== 'github') {
    return [
      params.provider,
      params.repoHost.trim().toLowerCase(),
      params.repoOwner.trim().toLowerCase(),
      params.repoName.trim().toLowerCase(),
      String(params.runId).trim(),
    ].join(':')
  }

  return buildGitHubRepositoryResourceId({
    repoHost: params.repoHost,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    nativeId: params.runId,
  })
}

const normalizeListLimit = (value?: number) => Math.min(Math.max(Math.floor(value ?? 0), 0) || 50, 100)
const normalizeListOffset = (value?: number) => Math.max(Math.floor(value ?? 0), 0)

export const listProjectWorkflowRuns = async (
  options?: ProjectWorkflowRunListOptions,
): Promise<ProjectGitHubWorkflowRunSummary[]> => {
  await ensurePostgresReady()
  const normalizedOptions = options ?? {}
  const projectId = normalizedOptions.projectId?.trim()
  const projectIds = normalizedOptions.projectIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const hasProjectScope = Boolean(projectId) || normalizedOptions.projectIds !== undefined
  const projectScope = hasProjectScope
    ? await resolveGitHubProjectResourceScope({
        resourceType: 'workflow_run',
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
    filters.push(inArray(projectWorkflowRuns.id, [...projectScope.keys()]))
  }

  let dbQuery = getDrizzleDb()
    .select()
    .from(projectWorkflowRuns)
    .$dynamic()

  if (filters.length > 0) {
    dbQuery = dbQuery.where(and(...filters))
  }

  dbQuery = dbQuery.orderBy(
    sql`CASE WHEN ${projectWorkflowRuns.status} = 'in_progress' THEN 0 WHEN ${projectWorkflowRuns.status} = 'queued' THEN 1 ELSE 2 END`,
    sql`${projectWorkflowRuns.runUpdatedAt} DESC NULLS LAST`,
    desc(projectWorkflowRuns.updatedAt),
  )

  if (limit) {
    dbQuery = dbQuery.limit(limit).offset(offset)
  }

  const rows = await dbQuery
  return rows.map((row) => mapProjectWorkflowRunRow(
    row,
    projectScope?.get(row.id) ?? row.projectId,
  ))
}

export const getProjectWorkflowRunById = async (
  id: string,
): Promise<ProjectGitHubWorkflowRunSummary | null> => {
  await ensurePostgresReady()
  const normalizedId = id.trim()
  if (!normalizedId) {
    return null
  }
  const runId = Number.parseInt(normalizedId, 10)

  const row = (await getDrizzleDb()
    .select()
    .from(projectWorkflowRuns)
    .where(eq(projectWorkflowRuns.id, normalizedId))
    .limit(1))[0]
  if (row) {
    return mapProjectWorkflowRunRow(row)
  }
  if (!Number.isFinite(runId)) {
    return null
  }

  const legacyRow = (await getDrizzleDb()
    .select()
    .from(projectWorkflowRuns)
    .where(eq(projectWorkflowRuns.runId, runId))
    .limit(1))[0]
  return legacyRow ? mapProjectWorkflowRunRow(legacyRow) : null
}

export const upsertProjectWorkflowRuns = async (
  runs: ProjectWorkflowRunUpsertInput[],
): Promise<ProjectGitHubWorkflowRunSummary[]> => {
  await ensurePostgresReady()
  const saved: ProjectGitHubWorkflowRunSummary[] = []
  for (const run of runs) {
    const now = new Date().toISOString()
    const rows = await getDrizzleDb()
      .insert(projectWorkflowRuns)
      .values({
        id: buildProjectWorkflowRunResourceId({
          provider: run.provider,
          repoHost: run.repoHost,
          repoOwner: run.repoOwner,
          repoName: run.repoName,
          runId: run.id,
        }),
        provider: run.provider,
        projectId: run.projectId,
        repoHost: run.repoHost,
        repoOwner: run.repoOwner,
        repoName: run.repoName,
        repoFullName: run.repoFullName,
        repoUrl: run.repoUrl,
        runId: Number(run.id),
        name: run.name,
        displayTitle: run.displayTitle,
        runNumber: run.runNumber,
        runAttempt: run.runAttempt,
        status: run.status,
        conclusion: run.conclusion ?? null,
        event: run.event,
        headBranch: run.headBranch,
        headSha: run.headSha,
        url: run.url ?? null,
        syncedAt: now,
        runCreatedAt: run.createdAt ?? null,
        runUpdatedAt: run.updatedAt ?? null,
        runStartedAt: run.runStartedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectWorkflowRuns.provider,
          projectWorkflowRuns.repoHost,
          projectWorkflowRuns.repoOwner,
          projectWorkflowRuns.repoName,
          projectWorkflowRuns.runId,
        ],
        set: {
          repoFullName: run.repoFullName,
          repoUrl: run.repoUrl,
          name: run.name,
          displayTitle: run.displayTitle,
          runNumber: run.runNumber,
          runAttempt: run.runAttempt,
          status: run.status,
          conclusion: run.conclusion ?? null,
          event: run.event,
          headBranch: run.headBranch,
          headSha: run.headSha,
          url: run.url ?? null,
          syncedAt: now,
          runCreatedAt: run.createdAt ?? null,
          runUpdatedAt: run.updatedAt ?? null,
          runStartedAt: run.runStartedAt ?? null,
          updatedAt: now,
        },
      })
      .returning()
    const row = rows[0]
    if (row) {
      await upsertGitHubProjectResource({
        resourceType: 'workflow_run',
        resourceId: row.id,
        projectId: run.projectId,
      })
      saved.push(mapProjectWorkflowRunRow(row, run.projectId))
    }
  }

  return saved
}
