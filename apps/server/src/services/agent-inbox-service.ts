/**
 * [INPUT]: Logical Agent inbox items and AgentTask execution attempts (initial, coalesced, retry, resume).
 * [OUTPUT]: Many-to-many links plus inbox execution projections and lifecycle state propagation.
 * [POS]: Bridge between the shared inbox read model and the existing AgentTask/AgentTaskRun execution model.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, desc, eq, inArray } from 'drizzle-orm'

import type { InboxExecutionSummary, InboxGroupListResponse, InboxQueryScope } from '@shared/inbox'
import type { AgentTaskRunRecord } from '@shared/types'
import { archiveInboxItem, listInboxGroups, listInboxGroupItems, markInboxItemRead } from './inbox-service'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { schedulePersistence } from '../storage/postgres/helpers'
import { agentTaskInboxItems, agentTaskRuns, agentTasks, inboxItems } from '../storage/postgres/schema'

export type AgentTaskInboxRelation = 'primary' | 'coalesced' | 'retry' | 'resume'

export const linkAgentTaskInboxItem = (
  agentTaskId: string,
  inboxItemId: string,
  relation: AgentTaskInboxRelation,
) => {
  schedulePersistence(
    `link-agent-task-inbox:${agentTaskId}:${inboxItemId}`,
    getDrizzleDb().insert(agentTaskInboxItems).values({
      agentTaskId,
      inboxItemId,
      relation,
      createdAt: new Date().toISOString(),
    }).onConflictDoNothing(),
  )
}

export const copyAgentTaskInboxLinks = (
  sourceAgentTaskId: string,
  targetAgentTaskId: string,
  relation: Extract<AgentTaskInboxRelation, 'retry' | 'resume'>,
) => {
  schedulePersistence(`copy-agent-task-inbox:${targetAgentTaskId}`, (async () => {
    const links = await getDrizzleDb().select({ inboxItemId: agentTaskInboxItems.inboxItemId })
      .from(agentTaskInboxItems)
      .where(eq(agentTaskInboxItems.agentTaskId, sourceAgentTaskId))
    if (links.length === 0) return
    await getDrizzleDb().insert(agentTaskInboxItems).values(links.map((link) => ({
      agentTaskId: targetAgentTaskId,
      inboxItemId: link.inboxItemId,
      relation,
      createdAt: new Date().toISOString(),
    }))).onConflictDoNothing()
  })())
}

const listAgentTaskInboxItemIds = async (agentTaskId: string) => {
  const rows = await getDrizzleDb().select({ inboxItemId: agentTaskInboxItems.inboxItemId })
    .from(agentTaskInboxItems)
    .where(eq(agentTaskInboxItems.agentTaskId, agentTaskId))
  return [...new Set(rows.map((row) => row.inboxItemId))]
}

export const markAgentTaskInboxItemsRead = (agentTaskId: string, agentId: string) => {
  schedulePersistence(`read-agent-task-inbox:${agentTaskId}`, (async () => {
    const ids = await listAgentTaskInboxItemIds(agentTaskId)
    await Promise.all(ids.map((id) => markInboxItemRead(agentId, id, 'agent')))
  })())
}

export const archiveAgentTaskInboxItems = (agentTaskId: string, agentId: string) => {
  schedulePersistence(`archive-agent-task-inbox:${agentTaskId}`, (async () => {
    const ids = await listAgentTaskInboxItemIds(agentTaskId)
    await Promise.all(ids.map((id) => archiveInboxItem(agentId, id, 'agent')))
  })())
}

type AgentInboxExecutionRow = {
  inboxItemId: string
  agentTaskId: string
  taskStatus: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'canceled'
  taskStartedAt: string | null
  taskCompletedAt: string | null
  runId: string | null
  runStatus: AgentTaskRunRecord['status'] | null
  failureCode: AgentTaskRunRecord['failureCode'] | null
  failureMessage: string | null
  conversationSessionId: string | null
  attempt: number | null
}

const summarizeExecutionRows = (rows: AgentInboxExecutionRow[]): InboxExecutionSummary => {
  if (rows.length === 0) {
    return { status: 'dispatch_fault', attemptCount: 0 }
  }
  const latest = rows[0]!
  return {
    status: latest.runStatus ?? latest.taskStatus,
    attemptCount: Math.max(...rows.map((row) => row.attempt ?? 1)),
    latestAgentTaskId: latest.agentTaskId,
    latestRunId: latest.runId ?? undefined,
    conversationSessionId: latest.conversationSessionId ?? undefined,
    failureCode: latest.failureCode ?? undefined,
    failureMessage: latest.failureMessage ?? undefined,
    startedAt: latest.taskStartedAt ?? undefined,
    completedAt: latest.taskCompletedAt ?? undefined,
  }
}

export const listAgentInboxExecutions = async (inboxItemIds: string[]) => {
  if (inboxItemIds.length === 0) return new Map<string, InboxExecutionSummary>()
  const rows = await getDrizzleDb().select({
    inboxItemId: agentTaskInboxItems.inboxItemId,
    agentTaskId: agentTasks.id,
    taskStatus: agentTasks.status,
    taskStartedAt: agentTasks.startedAt,
    taskCompletedAt: agentTasks.completedAt,
    runId: agentTaskRuns.id,
    runStatus: agentTaskRuns.status,
    failureCode: agentTaskRuns.failureCode,
    failureMessage: agentTaskRuns.failureMessage,
    conversationSessionId: agentTaskRuns.conversationSessionId,
    attempt: agentTaskRuns.attempt,
  }).from(agentTaskInboxItems)
    .innerJoin(agentTasks, eq(agentTasks.id, agentTaskInboxItems.agentTaskId))
    .leftJoin(agentTaskRuns, eq(agentTaskRuns.agentTaskId, agentTasks.id))
    .where(inArray(agentTaskInboxItems.inboxItemId, inboxItemIds))
    .orderBy(desc(agentTasks.createdAt))

  const grouped = new Map<string, AgentInboxExecutionRow[]>()
  for (const row of rows as AgentInboxExecutionRow[]) {
    const group = grouped.get(row.inboxItemId) ?? []
    group.push(row)
    grouped.set(row.inboxItemId, group)
  }
  return new Map([...grouped.entries()].map(([itemId, itemRows]) => [
    itemId,
    summarizeExecutionRows(itemRows),
  ]))
}

export const listAgentInboxGroups = async (params: {
  agentId: string
  section?: InboxQueryScope
  cursor?: string
  limit?: number
  workspaceId?: string
}): Promise<InboxGroupListResponse> => {
  const response = await listInboxGroups({
    recipientType: 'agent',
    recipientId: params.agentId,
    section: params.section,
    cursor: params.cursor,
    limit: params.limit,
    workspaceId: params.workspaceId,
  })
  const itemIds = response.groups.map((group) => group.latestItem.id)
  const executions = await listAgentInboxExecutions(itemIds)
  return {
    ...response,
    groups: response.groups.map((group) => ({
      ...group,
      execution: group.latestItem.kind === 'observe'
        ? { status: 'not_woken' as const, attemptCount: 0 }
        : executions.get(group.latestItem.id) ?? { status: 'dispatch_fault' as const, attemptCount: 0 },
    })),
  }
}

export const listAgentInboxGroupItems = async (params: {
  agentId: string
  groupKey: string
  section?: InboxQueryScope
  cursor?: string
  limit?: number
  workspaceId?: string
}) => {
  const response = await listInboxGroupItems({
    recipientType: 'agent',
    recipientId: params.agentId,
    groupKey: params.groupKey,
    section: params.section,
    cursor: params.cursor,
    limit: params.limit,
    workspaceId: params.workspaceId,
  })
  const executions = await listAgentInboxExecutions(response.items.map((item) => item.id))
  return {
    ...response,
    items: response.items.map((item) => ({
      ...item,
      execution: item.kind === 'observe'
        ? { status: 'not_woken' as const, attemptCount: 0 }
        : executions.get(item.id) ?? { status: 'dispatch_fault' as const, attemptCount: 0 },
    })),
  }
}

export const listAgentInboxAttempts = async (params: {
  agentId: string
  inboxItemId: string
}) => {
  const owned = await getDrizzleDb().select({ id: inboxItems.id }).from(inboxItems).where(and(
    eq(inboxItems.id, params.inboxItemId),
    eq(inboxItems.recipientType, 'agent'),
    eq(inboxItems.recipientId, params.agentId),
  )).limit(1)
  if (owned.length === 0) return []

  return getDrizzleDb().select({
    agentTaskId: agentTasks.id,
    type: agentTasks.type,
    status: agentTasks.status,
    result: agentTasks.resultJson,
    createdAt: agentTasks.createdAt,
    startedAt: agentTasks.startedAt,
    completedAt: agentTasks.completedAt,
    relation: agentTaskInboxItems.relation,
    run: agentTaskRuns,
  }).from(agentTaskInboxItems)
    .innerJoin(agentTasks, eq(agentTasks.id, agentTaskInboxItems.agentTaskId))
    .leftJoin(agentTaskRuns, eq(agentTaskRuns.agentTaskId, agentTasks.id))
    .where(eq(agentTaskInboxItems.inboxItemId, params.inboxItemId))
    .orderBy(desc(agentTasks.createdAt))
}
