/**
 * [INPUT]: Shared GitHub resource binding contracts and Drizzle persistence.
 * [OUTPUT]: Idempotent binding upserts and scoped binding queries.
 * [POS]: Authoritative local relationship store between GitHub resources and wemux contexts.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import crypto from 'node:crypto'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import {
  buildGitHubResourceBindingContextKey,
  type GitHubResourceBinding,
  type GitHubResourceBindingFilter,
  type GitHubResourceBindingUpsertInput,
} from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { githubResourceBindings } from './schema'

type GitHubResourceBindingRow = typeof githubResourceBindings.$inferSelect

const mapGitHubResourceBindingRow = (
  row: GitHubResourceBindingRow,
): GitHubResourceBinding => ({
  id: row.id,
  provider: row.provider,
  resourceType: row.resourceType,
  resourceId: row.resourceId,
  projectId: row.projectId,
  taskId: row.taskId ?? undefined,
  workspaceId: row.workspaceId ?? undefined,
  workspaceSessionId: row.workspaceSessionId ?? undefined,
  role: row.role,
  status: row.status,
  source: row.source,
  confidence: row.confidence ?? undefined,
  createdByUserId: row.createdByUserId ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const listGitHubResourceBindings = async (
  filter: GitHubResourceBindingFilter = {},
): Promise<GitHubResourceBinding[]> => {
  await ensurePostgresReady()
  const filters = []
  const projectId = filter.projectId?.trim()
  const projectIds = filter.projectIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const resourceId = filter.resourceId?.trim()
  const taskId = filter.taskId?.trim()
  const workspaceId = filter.workspaceId?.trim()
  const workspaceSessionId = filter.workspaceSessionId?.trim()

  if (projectId) {
    filters.push(eq(githubResourceBindings.projectId, projectId))
  } else if (filter.projectIds && projectIds.length === 0) {
    return []
  } else if (projectIds.length > 0) {
    filters.push(inArray(githubResourceBindings.projectId, projectIds))
  }
  if (filter.resourceType) {
    filters.push(eq(githubResourceBindings.resourceType, filter.resourceType))
  }
  if (resourceId) {
    filters.push(eq(githubResourceBindings.resourceId, resourceId))
  }
  if (taskId) {
    filters.push(eq(githubResourceBindings.taskId, taskId))
  }
  if (workspaceId) {
    filters.push(eq(githubResourceBindings.workspaceId, workspaceId))
  }
  if (workspaceSessionId) {
    filters.push(eq(githubResourceBindings.workspaceSessionId, workspaceSessionId))
  }
  if (filter.status) {
    filters.push(eq(githubResourceBindings.status, filter.status))
  }

  let query = getDrizzleDb()
    .select()
    .from(githubResourceBindings)
    .$dynamic()

  if (filters.length > 0) {
    query = query.where(and(...filters))
  }

  return (await query.orderBy(desc(githubResourceBindings.updatedAt)))
    .map(mapGitHubResourceBindingRow)
}

export const upsertGitHubResourceBinding = async (
  input: GitHubResourceBindingUpsertInput,
): Promise<GitHubResourceBinding> => {
  await ensurePostgresReady()
  const provider = input.provider ?? 'github'
  const resourceId = input.resourceId.trim()
  const projectId = input.projectId.trim()
  const taskId = input.taskId?.trim() || undefined
  const workspaceId = input.workspaceId?.trim() || undefined
  const workspaceSessionId = input.workspaceSessionId?.trim() || undefined
  const role = input.role ?? 'reference'
  const incomingStatus = input.status ?? 'confirmed'
  const contextKey = buildGitHubResourceBindingContextKey({
    taskId,
    workspaceId,
    workspaceSessionId,
  })

  if (!resourceId || !projectId) {
    throw new Error('GitHub resource binding requires resourceId and projectId.')
  }

  const confidence = input.confidence ?? null
  const createdByUserId = input.createdByUserId?.trim() || null
  const acceptsIncomingDecision = sql<boolean>`(
    ${incomingStatus} <> 'suggested'
    OR ${githubResourceBindings.status} = 'suggested'
  )`
  const now = new Date().toISOString()
  const rows = await getDrizzleDb()
    .insert(githubResourceBindings)
    .values({
      id: crypto.randomUUID(),
      provider,
      resourceType: input.resourceType,
      resourceId,
      projectId,
      contextKey,
      taskId: taskId ?? null,
      workspaceId: workspaceId ?? null,
      workspaceSessionId: workspaceSessionId ?? null,
      role,
      status: incomingStatus,
      source: input.source,
      confidence,
      createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        githubResourceBindings.provider,
        githubResourceBindings.resourceType,
        githubResourceBindings.resourceId,
        githubResourceBindings.contextKey,
        githubResourceBindings.role,
      ],
      set: {
        projectId,
        taskId: taskId ?? null,
        workspaceId: workspaceId ?? null,
        workspaceSessionId: workspaceSessionId ?? null,
        status: sql`CASE
          WHEN ${acceptsIncomingDecision} THEN ${incomingStatus}
          ELSE ${githubResourceBindings.status}
        END`,
        source: sql`CASE
          WHEN ${acceptsIncomingDecision} THEN ${input.source}
          ELSE ${githubResourceBindings.source}
        END`,
        confidence: sql`CASE
          WHEN ${acceptsIncomingDecision}
            THEN COALESCE(${confidence}, ${githubResourceBindings.confidence})
          ELSE ${githubResourceBindings.confidence}
        END`,
        createdByUserId: sql`CASE
          WHEN ${acceptsIncomingDecision}
            THEN COALESCE(${createdByUserId}, ${githubResourceBindings.createdByUserId})
          ELSE ${githubResourceBindings.createdByUserId}
        END`,
        updatedAt: sql`CASE
          WHEN ${acceptsIncomingDecision} THEN ${now}
          ELSE ${githubResourceBindings.updatedAt}
        END`,
      },
    })
    .returning()
  const saved = rows[0]
  if (!saved) {
    throw new Error('Failed to persist GitHub resource binding.')
  }

  return mapGitHubResourceBindingRow(saved)
}

export const upsertGitHubResourceBindings = async (
  inputs: GitHubResourceBindingUpsertInput[],
) => Promise.all(inputs.map(upsertGitHubResourceBinding))
