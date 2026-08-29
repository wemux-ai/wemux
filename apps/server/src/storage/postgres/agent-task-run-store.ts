/**
 * [INPUT]: Task Agent event attempts, lifecycle patches, transcript snapshots, usage, and heartbeats.
 * [OUTPUT]: Independently persisted AgentTaskRun records keyed by AgentTask/event ID.
 * [POS]: Postgres repository for task-scoped Agent run observability; it does not own Main Chat sessions.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { desc, eq } from 'drizzle-orm'

import type { AgentTaskRunRecord } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { agentTaskRuns } from './schema'

type AgentTaskRunRow = typeof agentTaskRuns.$inferSelect

const runsByAgentTaskId = new Map<string, AgentTaskRunRecord>()

const mapRow = (row: AgentTaskRunRow): AgentTaskRunRecord => ({
  id: row.id,
  agentTaskId: row.agentTaskId,
  eventId: row.eventId,
  agentId: row.agentId,
  taskId: row.taskId ?? undefined,
  projectId: row.projectId ?? undefined,
  conversationSessionId: row.conversationSessionId ?? undefined,
  attempt: row.attempt,
  retrySource: row.retrySource,
  retrySessionMode: row.retrySessionMode ?? undefined,
  status: row.status,
  failureCode: row.failureCode ?? undefined,
  failureMessage: row.failureMessage ?? undefined,
  transcript: row.transcriptJson ?? [],
  usage: row.usageJson ?? undefined,
  startedAt: row.startedAt ?? undefined,
  completedAt: row.completedAt ?? undefined,
  lastHeartbeatAt: row.lastHeartbeatAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const persistAgentTaskRun = async (run: AgentTaskRunRecord) => {
  await ensurePostgresReady()
  await getDrizzleDb()
    .insert(agentTaskRuns)
    .values({
      id: run.id,
      agentTaskId: run.agentTaskId,
      eventId: run.eventId,
      agentId: run.agentId,
      taskId: run.taskId ?? null,
      projectId: run.projectId ?? null,
      conversationSessionId: run.conversationSessionId ?? null,
      attempt: run.attempt,
      retrySource: run.retrySource,
      retrySessionMode: run.retrySessionMode ?? null,
      status: run.status,
      failureCode: run.failureCode ?? null,
      failureMessage: run.failureMessage ?? null,
      transcriptJson: run.transcript,
      usageJson: run.usage ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      lastHeartbeatAt: run.lastHeartbeatAt ?? null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })
    .onConflictDoUpdate({
      target: agentTaskRuns.agentTaskId,
      set: {
        eventId: run.eventId,
        agentId: run.agentId,
        taskId: run.taskId ?? null,
        projectId: run.projectId ?? null,
        conversationSessionId: run.conversationSessionId ?? null,
        attempt: run.attempt,
        retrySource: run.retrySource,
        retrySessionMode: run.retrySessionMode ?? null,
        status: run.status,
        failureCode: run.failureCode ?? null,
        failureMessage: run.failureMessage ?? null,
        transcriptJson: run.transcript,
        usageJson: run.usage ?? null,
        startedAt: run.startedAt ?? null,
        completedAt: run.completedAt ?? null,
        lastHeartbeatAt: run.lastHeartbeatAt ?? null,
        updatedAt: run.updatedAt,
      },
    })
}

export const refreshAgentTaskRunStore = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(agentTaskRuns)
    .orderBy(desc(agentTaskRuns.createdAt))
  runsByAgentTaskId.clear()
  for (const row of rows) {
    const run = mapRow(row)
    runsByAgentTaskId.set(run.agentTaskId, run)
  }
}

export const initAgentTaskRunStore = refreshAgentTaskRunStore

export const getAgentTaskRun = (agentTaskId: string) => {
  const run = runsByAgentTaskId.get(agentTaskId)
  return run ? cloneJson(run) : null
}

export const createAgentTaskRun = (
  input: Omit<AgentTaskRunRecord, 'id' | 'transcript' | 'createdAt' | 'updatedAt'> & {
    transcript?: AgentTaskRunRecord['transcript']
    createdAt?: string
  },
) => {
  const existing = runsByAgentTaskId.get(input.agentTaskId)
  if (existing) return cloneJson(existing)

  const now = input.createdAt ?? new Date().toISOString()
  const run: AgentTaskRunRecord = {
    ...input,
    id: crypto.randomUUID(),
    transcript: cloneJson(input.transcript ?? []),
    createdAt: now,
    updatedAt: now,
  }
  runsByAgentTaskId.set(run.agentTaskId, run)
  schedulePersistence(`create-agent-task-run:${run.agentTaskId}`, persistAgentTaskRun(run))
  return cloneJson(run)
}

export const updateAgentTaskRun = (
  agentTaskId: string,
  patch: Partial<Omit<AgentTaskRunRecord, 'id' | 'agentTaskId' | 'eventId' | 'agentId' | 'createdAt'>>,
) => {
  const run = runsByAgentTaskId.get(agentTaskId)
  if (!run) return null

  Object.assign(run, cloneJson(patch), { updatedAt: new Date().toISOString() })
  schedulePersistence(`update-agent-task-run:${agentTaskId}`, persistAgentTaskRun(cloneJson(run)))
  return cloneJson(run)
}
