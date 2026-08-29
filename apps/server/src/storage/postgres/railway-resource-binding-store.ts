// [INPUT]: Shared Railway resource binding contracts and Drizzle persistence.
// [OUTPUT]: Idempotent binding upserts and scoped binding queries.
// [POS]: Authoritative local relationship store between Railway deployments and wemux contexts.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import crypto from 'node:crypto'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import {
  buildRailwayResourceBindingContextKey,
  type RailwayResourceBinding,
  type RailwayResourceBindingFilter,
  type RailwayResourceBindingUpsertInput,
} from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { railwayResourceBindings } from './schema'

type RailwayResourceBindingRow = typeof railwayResourceBindings.$inferSelect

const mapRailwayResourceBindingRow = (
  row: RailwayResourceBindingRow,
): RailwayResourceBinding => ({
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

export const listRailwayResourceBindings = async (
  filter: RailwayResourceBindingFilter = {},
): Promise<RailwayResourceBinding[]> => {
  await ensurePostgresReady()
  const filters = []
  const projectId = filter.projectId?.trim()
  const projectIds = filter.projectIds?.map((id) => id.trim()).filter(Boolean) ?? []
  const resourceId = filter.resourceId?.trim()
  const taskId = filter.taskId?.trim()
  const workspaceId = filter.workspaceId?.trim()
  const workspaceSessionId = filter.workspaceSessionId?.trim()

  if (projectId) {
    filters.push(eq(railwayResourceBindings.projectId, projectId))
  } else if (filter.projectIds && projectIds.length === 0) {
    return []
  } else if (projectIds.length > 0) {
    filters.push(inArray(railwayResourceBindings.projectId, projectIds))
  }
  if (filter.resourceType) {
    filters.push(eq(railwayResourceBindings.resourceType, filter.resourceType))
  }
  if (resourceId) {
    filters.push(eq(railwayResourceBindings.resourceId, resourceId))
  }
  if (taskId) {
    filters.push(eq(railwayResourceBindings.taskId, taskId))
  }
  if (workspaceId) {
    filters.push(eq(railwayResourceBindings.workspaceId, workspaceId))
  }
  if (workspaceSessionId) {
    filters.push(eq(railwayResourceBindings.workspaceSessionId, workspaceSessionId))
  }
  if (filter.status) {
    filters.push(eq(railwayResourceBindings.status, filter.status))
  }

  let query = getDrizzleDb()
    .select()
    .from(railwayResourceBindings)
    .$dynamic()

  if (filters.length > 0) {
    query = query.where(and(...filters))
  }

  return (await query.orderBy(desc(railwayResourceBindings.updatedAt)))
    .map(mapRailwayResourceBindingRow)
}

export const upsertRailwayResourceBinding = async (
  input: RailwayResourceBindingUpsertInput,
): Promise<RailwayResourceBinding> => {
  await ensurePostgresReady()
  const provider = input.provider ?? 'railway'
  const resourceId = input.resourceId.trim()
  const projectId = input.projectId.trim()
  const taskId = input.taskId?.trim() || undefined
  const workspaceId = input.workspaceId?.trim() || undefined
  const workspaceSessionId = input.workspaceSessionId?.trim() || undefined
  const role = input.role ?? 'reference'
  const incomingStatus = input.status ?? 'confirmed'
  const contextKey = buildRailwayResourceBindingContextKey({
    taskId,
    workspaceId,
    workspaceSessionId,
  })

  if (!resourceId || !projectId) {
    throw new Error('Railway resource binding requires resourceId and projectId.')
  }

  const confidence = input.confidence ?? null
  const createdByUserId = input.createdByUserId?.trim() || null
  const acceptsIncomingDecision = sql<boolean>`(
    ${incomingStatus} <> 'suggested'
    OR ${railwayResourceBindings.status} = 'suggested'
  )`
  const now = new Date().toISOString()
  const rows = await getDrizzleDb()
    .insert(railwayResourceBindings)
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
        railwayResourceBindings.provider,
        railwayResourceBindings.resourceType,
        railwayResourceBindings.resourceId,
        railwayResourceBindings.contextKey,
        railwayResourceBindings.role,
      ],
      set: {
        projectId,
        taskId: taskId ?? null,
        workspaceId: workspaceId ?? null,
        workspaceSessionId: workspaceSessionId ?? null,
        status: sql`CASE
          WHEN ${acceptsIncomingDecision} THEN ${incomingStatus}
          ELSE ${railwayResourceBindings.status}
        END`,
        source: sql`CASE
          WHEN ${acceptsIncomingDecision} THEN ${input.source}
          ELSE ${railwayResourceBindings.source}
        END`,
        confidence: sql`CASE
          WHEN ${acceptsIncomingDecision}
            THEN COALESCE(${confidence}, ${railwayResourceBindings.confidence})
          ELSE ${railwayResourceBindings.confidence}
        END`,
        createdByUserId: sql`CASE
          WHEN ${acceptsIncomingDecision}
            THEN COALESCE(${createdByUserId}, ${railwayResourceBindings.createdByUserId})
          ELSE ${railwayResourceBindings.createdByUserId}
        END`,
        updatedAt: sql`CASE
          WHEN ${acceptsIncomingDecision} THEN ${now}
          ELSE ${railwayResourceBindings.updatedAt}
        END`,
      },
    })
    .returning()
  const saved = rows[0]
  if (!saved) {
    throw new Error('Failed to persist Railway resource binding.')
  }

  return mapRailwayResourceBindingRow(saved)
}

export const upsertRailwayResourceBindings = async (
  inputs: RailwayResourceBindingUpsertInput[],
) => Promise.all(inputs.map(upsertRailwayResourceBinding))

/**
 * 清理陈旧的 branch_match suggested 绑定：deployment id 已不在事实表中（被新部署取代或环境删除）。
 * 只删 suggested + branch_match，不碰 confirmed/rejected（人工确认不可被启发式覆盖）。
 */
export const deleteStaleRailwaySuggestedBindings = async (
  activeDeploymentIds: Set<string>,
): Promise<number> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select({ id: railwayResourceBindings.id, resourceId: railwayResourceBindings.resourceId })
    .from(railwayResourceBindings)
    .where(and(
      eq(railwayResourceBindings.source, 'branch_match'),
      eq(railwayResourceBindings.status, 'suggested'),
    ))

  const staleIds = rows
    .filter((row) => {
      const deploymentId = row.resourceId.split(':').pop()
      return !deploymentId || !activeDeploymentIds.has(deploymentId)
    })
    .map((row) => row.id)

  if (staleIds.length === 0) {
    return 0
  }

  await getDrizzleDb()
    .delete(railwayResourceBindings)
    .where(inArray(railwayResourceBindings.id, staleIds))
  return staleIds.length
}
