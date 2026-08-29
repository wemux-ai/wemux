// [INPUT]: task_chat_queue_items / task_chat_session_leases Drizzle schema and cluster node identity.
// [OUTPUT]: Cross-node atomic queue operations (enqueue/claim/complete/release/remove/sweep),
//           a per-node pending-queue read mirror, and session execution lease acquire/renew/release.
// [POS]: Postgres-backed multi-node task chat queue and session execution lease store.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { sql } from 'drizzle-orm'

import { normalizeTaskChatAttachments } from '@shared/task-chat-attachment'
import { normalizeTaskChatContextRefs } from '@shared/task-chat-context'
import {
  normalizeTaskChatMessageRuntimeConfig,
  type TaskChatMessageRuntimeConfig,
  type TaskChatQueueEntry,
} from '@shared/task-chat-session'
import type { CreatorIdentity } from '@shared/types'

import { clusterConfig } from '../../cluster/config'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import { appMeta } from './schema'

export const TASK_CHAT_QUEUE_CLAIM_TIMEOUT_MS = 5 * 60 * 1000
export const TASK_CHAT_QUEUE_MAX_RETRIES = 2
export const TASK_CHAT_SESSION_LEASE_TTL_MS = 5 * 60 * 1000

export const TASK_CHAT_QUEUE_ITEMS_TABLE = 'task_chat_queue_items'

export type TaskChatQueueClaim = TaskChatQueueEntry & {
  claimId: string
  claimedAt: string
  claimedBy?: string
}

export type TaskChatSessionLease = {
  sessionKey: string
  leaseId: string
  claimedByNodeId: string
  leaseExpiresAt: string
}

type TaskChatQueueRow = {
  id: string
  session_key: string
  task_id: string | null
  workspace_id: string | null
  workspace_session_id: string | null
  task_run_id: string | null
  requested_by_agent_id: string | null
  source_agent_event_id: string | null
  author_json: CreatorIdentity | null
  dedupe_key: string | null
  message: string
  attachments_json: unknown
  context_refs_json: unknown
  runtime_config_json: unknown
  created_at: string
  created_by: string | null
  retry_count: number
  status: 'pending' | 'claimed'
  claim_id: string | null
  claimed_at: string | null
  claimed_by: string | null
  lease_expires_at: string | null
  updated_at: string
}

const normalizeQueueRowEntry = (row: TaskChatQueueRow): TaskChatQueueEntry => ({
  id: row.id,
  sessionKey: row.session_key,
  taskId: row.task_id || undefined,
  workspaceId: row.workspace_id || undefined,
  workspaceSessionId: row.workspace_session_id || undefined,
  taskRunId: row.task_run_id || undefined,
  requestedByAgentId: row.requested_by_agent_id || undefined,
  sourceAgentEventId: row.source_agent_event_id || undefined,
  author: row.author_json ?? undefined,
  dedupeKey: row.dedupe_key || undefined,
  message: row.message,
  attachments: normalizeTaskChatAttachments(row.attachments_json),
  contextRefs: normalizeTaskChatContextRefs(row.context_refs_json),
  runtimeConfig: normalizeTaskChatMessageRuntimeConfig(row.runtime_config_json),
  createdAt: row.created_at,
  createdBy: row.created_by || undefined,
  retryCount: row.retry_count,
})

const normalizeQueueRowClaim = (row: TaskChatQueueRow): TaskChatQueueClaim | null => {
  const base = normalizeQueueRowEntry(row)
  if (!row.claim_id || !row.claimed_at) {
    return null
  }

  return {
    ...base,
    claimId: row.claim_id,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by || undefined,
  }
}

const sortQueueRows = <T extends TaskChatQueueEntry>(items: T[]) => {
  return [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export const toTaskChatQueueClaim = (row: TaskChatQueueRow): TaskChatQueueClaim | null => {
  return normalizeQueueRowClaim(row)
}

// ---------------------------------------------------------------------------
// Per-node pending-queue read mirror
//
// 读路径（listTaskChatQueueEntries / snapshot 构建）保持同步 API，从镜像读取。
// 镜像在启动、storage-change 事件、本地变更后全量刷新（队列行是瞬态小表）。
// ---------------------------------------------------------------------------

let pendingQueueMirror = new Map<string, TaskChatQueueEntry[]>()

export const listPendingTaskChatQueueEntriesFromMirror = (sessionKey: string) => {
  return pendingQueueMirror.get(sessionKey) ?? []
}

export const pendingTaskChatQueueMirrorSnapshot = () => {
  return pendingQueueMirror
}

export const refreshTaskChatQueueMirror = async () => {
  const db = getDrizzleDb()
  const rows = await db.execute(sql`
    SELECT * FROM task_chat_queue_items
    WHERE status = 'pending'
    ORDER BY created_at ASC, id ASC
  `)
  const next = new Map<string, TaskChatQueueEntry[]>()
  for (const raw of rows.rows as TaskChatQueueRow[]) {
    const entry = normalizeQueueRowEntry(raw)
    const sessionEntries = next.get(entry.sessionKey) ?? []
    sessionEntries.push(entry)
    next.set(entry.sessionKey, sessionEntries)
  }
  for (const entries of next.values()) {
    sortQueueRows(entries)
  }
  pendingQueueMirror = next
}

export const resetTaskChatQueueMirrorForTests = () => {
  pendingQueueMirror = new Map<string, TaskChatQueueEntry[]>()
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export const enqueueTaskChatQueueItemDb = async (entry: TaskChatQueueEntry): Promise<TaskChatQueueEntry> => {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  const inserted = await db.execute(sql`
    INSERT INTO task_chat_queue_items (
      id, session_key, task_id, workspace_id, workspace_session_id, task_run_id,
      requested_by_agent_id, source_agent_event_id, author_json, dedupe_key,
      message, attachments_json, context_refs_json, runtime_config_json,
      created_at, created_by, retry_count, status, updated_at
    ) VALUES (
      ${entry.id}, ${entry.sessionKey}, ${entry.taskId ?? null}, ${entry.workspaceId ?? null},
      ${entry.workspaceSessionId ?? null}, ${entry.taskRunId ?? null},
      ${entry.requestedByAgentId ?? null}, ${entry.sourceAgentEventId ?? null},
      ${entry.author ? sql`${JSON.stringify(entry.author)}::jsonb` : null},
      ${entry.dedupeKey ?? null},
      ${entry.message},
      ${entry.attachments ? sql`${JSON.stringify(entry.attachments)}::jsonb` : null},
      ${entry.contextRefs ? sql`${JSON.stringify(entry.contextRefs)}::jsonb` : null},
      ${entry.runtimeConfig ? sql`${JSON.stringify(entry.runtimeConfig)}::jsonb` : null},
      ${entry.createdAt}, ${entry.createdBy ?? null}, ${entry.retryCount ?? 0}, 'pending', ${now}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `)
  if (inserted.rows.length > 0) {
    await refreshTaskChatQueueMirror()
    return entry
  }

  // 主键或 (session_key, dedupe_key) 冲突：返回既有条目（dedupe 命中优先）。
  const dedupeLookup = entry.dedupeKey
    ? sql`dedupe_key = ${entry.dedupeKey}`
    : sql`FALSE`
  const existing = await db.execute(sql`
    SELECT * FROM task_chat_queue_items
    WHERE session_key = ${entry.sessionKey}
      AND (${dedupeLookup} OR id = ${entry.id})
    LIMIT 1
  `)
  const existingRow = existing.rows[0] as TaskChatQueueRow | undefined
  if (!existingRow) {
    // 竞态窗口极小：插入冲突但查询不到时，重试一次镜像后的再查询。
    await refreshTaskChatQueueMirror()
    const retried = await db.execute(sql`
      SELECT * FROM task_chat_queue_items
      WHERE session_key = ${entry.sessionKey}
        AND (${dedupeLookup} OR id = ${entry.id})
      LIMIT 1
    `)
    const retriedRow = retried.rows[0] as TaskChatQueueRow | undefined
    if (!retriedRow) {
      throw new Error(`task chat queue item conflict without existing row: ${entry.id}`)
    }
    await refreshTaskChatQueueMirror()
    return normalizeQueueRowEntry(retriedRow)
  }
  await refreshTaskChatQueueMirror()
  return normalizeQueueRowEntry(existingRow)
}

// ---------------------------------------------------------------------------
// Claim / complete / release
// ---------------------------------------------------------------------------

export const claimTaskChatQueueItemDb = async (params: {
  sessionKey: string
  queueId: string
  claimedBy?: string
  claimTimeoutMs?: number
}): Promise<TaskChatQueueClaim | null> => {
  const db = getDrizzleDb()
  const now = new Date()
  const claimedAt = now.toISOString()
  const leaseExpiresAt = new Date(now.getTime() + (params.claimTimeoutMs ?? TASK_CHAT_QUEUE_CLAIM_TIMEOUT_MS)).toISOString()
  const claimId = crypto.randomUUID()

  const claimed = await db.execute(sql`
    UPDATE task_chat_queue_items
    SET status = 'claimed',
        claim_id = ${claimId},
        claimed_at = ${claimedAt},
        claimed_by = ${params.claimedBy ?? null},
        lease_expires_at = ${leaseExpiresAt},
        updated_at = ${claimedAt}
    WHERE id = ${params.queueId}
      AND session_key = ${params.sessionKey}
      AND status = 'pending'
      AND id = (
        SELECT head.id FROM task_chat_queue_items AS head
        WHERE head.session_key = ${params.sessionKey} AND head.status = 'pending'
        ORDER BY head.created_at ASC, head.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
    RETURNING *
  `)
  const claim = (claimed.rows[0] as TaskChatQueueRow | undefined)
    ? normalizeQueueRowClaim(claimed.rows[0] as TaskChatQueueRow)
    : null
  if (claim) {
    await refreshTaskChatQueueMirror()
  }
  return claim
}

export const completeTaskChatQueueItemDb = async (params: {
  sessionKey: string
  queueId: string
  claimId: string
}) => {
  const db = getDrizzleDb()
  await db.execute(sql`
    DELETE FROM task_chat_queue_items
    WHERE id = ${params.queueId}
      AND session_key = ${params.sessionKey}
      AND claim_id = ${params.claimId}
      AND status = 'claimed'
  `)
  await refreshTaskChatQueueMirror()
}

export const releaseTaskChatQueueItemDb = async (params: {
  sessionKey: string
  queueId: string
  claimId: string
}): Promise<{ restoredItem: TaskChatQueueEntry | null; dropped: boolean }> => {
  const now = new Date().toISOString()
  return withDrizzleTransaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT * FROM task_chat_queue_items
      WHERE id = ${params.queueId}
        AND session_key = ${params.sessionKey}
        AND status = 'claimed'
        AND claim_id = ${params.claimId}
      FOR UPDATE
    `)
    const row = locked.rows[0] as TaskChatQueueRow | undefined
    if (!row) {
      return { restoredItem: null, dropped: false }
    }

    const nextRetryCount = (row.retry_count ?? 0) + 1
    if (nextRetryCount > TASK_CHAT_QUEUE_MAX_RETRIES) {
      await tx.execute(sql`
        DELETE FROM task_chat_queue_items
        WHERE id = ${params.queueId} AND session_key = ${params.sessionKey}
      `)
      return { restoredItem: null, dropped: true }
    }

    await tx.execute(sql`
      UPDATE task_chat_queue_items
      SET status = 'pending',
          retry_count = ${nextRetryCount},
          claim_id = NULL,
          claimed_at = NULL,
          claimed_by = NULL,
          lease_expires_at = NULL,
          updated_at = ${now}
      WHERE id = ${params.queueId} AND session_key = ${params.sessionKey}
    `)
    return {
      restoredItem: {
        ...normalizeQueueRowEntry(row),
        retryCount: nextRetryCount,
      },
      dropped: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export const removeTaskChatQueueItemDb = async (params: {
  sessionKey: string
  queueId: string
}) => {
  const db = getDrizzleDb()
  await db.execute(sql`
    DELETE FROM task_chat_queue_items
    WHERE id = ${params.queueId} AND session_key = ${params.sessionKey}
  `)
  await refreshTaskChatQueueMirror()
}

export const removeTaskChatQueueItemsForWorkspaceSessionDb = async (params: {
  workspaceId: string
  workspaceSessionId: string
}) => {
  const db = getDrizzleDb()
  await db.execute(sql`
    DELETE FROM task_chat_queue_items
    WHERE workspace_id = ${params.workspaceId}
      AND workspace_session_id = ${params.workspaceSessionId}
  `)
  await refreshTaskChatQueueMirror()
}

export const removeTaskChatQueueItemsForWorkspaceDb = async (params: {
  workspaceId: string
}) => {
  const db = getDrizzleDb()
  await db.execute(sql`
    DELETE FROM task_chat_queue_items
    WHERE workspace_id = ${params.workspaceId}
  `)
  await refreshTaskChatQueueMirror()
}

// ---------------------------------------------------------------------------
// Expired claim sweep
// ---------------------------------------------------------------------------

export type TaskChatQueueDrainTarget = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

let drainScheduler: ((target: TaskChatQueueDrainTarget) => void) | null = null

export const registerTaskChatQueueDrainScheduler = (scheduler: (target: TaskChatQueueDrainTarget) => void) => {
  drainScheduler = scheduler
}

export const sweepExpiredTaskChatQueueClaimsDb = async (): Promise<TaskChatQueueDrainTarget[]> => {
  const now = new Date().toISOString()
  const db = getDrizzleDb()
  const restored = await db.execute(sql`
    UPDATE task_chat_queue_items
    SET status = 'pending',
        claim_id = NULL,
        claimed_at = NULL,
        claimed_by = NULL,
        lease_expires_at = NULL,
        updated_at = ${now}
    WHERE status = 'claimed' AND lease_expires_at < ${now}
    RETURNING task_id, workspace_id, workspace_session_id
  `)
  await db.execute(sql`
    DELETE FROM task_chat_session_leases
    WHERE lease_expires_at < ${now}
  `)
  await refreshTaskChatQueueMirror()

  const targets: TaskChatQueueDrainTarget[] = []
  for (const row of restored.rows as Array<{ task_id: string | null; workspace_id: string | null; workspace_session_id: string | null }>) {
    targets.push({
      taskId: row.task_id || undefined,
      workspaceId: row.workspace_id || undefined,
      workspaceSessionId: row.workspace_session_id || undefined,
    })
    if (drainScheduler) {
      drainScheduler({
        taskId: row.task_id || undefined,
        workspaceId: row.workspace_id || undefined,
        workspaceSessionId: row.workspace_session_id || undefined,
      })
    }
  }
  return targets
}

let sweepTimer: ReturnType<typeof setInterval> | null = null

export const startTaskChatQueueSweepSchedule = (intervalMs = 30_000) => {
  if (sweepTimer !== null) {
    return
  }

  sweepTimer = setInterval(() => {
    void sweepExpiredTaskChatQueueClaimsDb().catch((error) => {
      console.error('[task-chat-queue] expired claim sweep failed', error)
    })
  }, intervalMs)
  sweepTimer.unref?.()
}

export const stopTaskChatQueueSweepSchedule = () => {
  if (sweepTimer !== null) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

// ---------------------------------------------------------------------------
// Session execution lease
// ---------------------------------------------------------------------------

// 查询会话当前执行租约（跨节点 stop 定位 owning node 用；只读，不做到期清理）。
export const getTaskChatSessionLeaseDb = async (sessionKey: string): Promise<TaskChatSessionLease | null> => {
  const db = getDrizzleDb()
  const rows = await db.execute(sql`
    SELECT * FROM task_chat_session_leases
    WHERE session_key = ${sessionKey}
    LIMIT 1
  `)
  const row = rows.rows[0] as { lease_id: string; claimed_by_node_id: string; lease_expires_at: string } | undefined
  if (!row) {
    return null
  }

  return {
    sessionKey,
    leaseId: row.lease_id,
    claimedByNodeId: row.claimed_by_node_id,
    leaseExpiresAt: row.lease_expires_at,
  }
}

export const acquireTaskChatSessionLeaseDb = async (params: {
  sessionKey: string
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  leaseId?: string
  ttlMs?: number
}): Promise<TaskChatSessionLease | null> => {
  const db = getDrizzleDb()
  const now = new Date()
  const nowIso = now.toISOString()
  const ttlMs = params.ttlMs ?? TASK_CHAT_SESSION_LEASE_TTL_MS
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
  const leaseId = params.leaseId?.trim() || crypto.randomUUID()
  const nodeId = clusterConfig.nodeId

  const inserted = await db.execute(sql`
    INSERT INTO task_chat_session_leases (
      session_key, lease_id, claimed_by_node_id, task_id, workspace_id, workspace_session_id,
      lease_expires_at, created_at, updated_at
    ) VALUES (
      ${params.sessionKey}, ${leaseId}, ${nodeId},
      ${params.taskId ?? null}, ${params.workspaceId ?? null}, ${params.workspaceSessionId ?? null},
      ${expiresAt}, ${nowIso}, ${nowIso}
    )
    ON CONFLICT (session_key) DO NOTHING
    RETURNING session_key
  `)
  if (inserted.rows.length > 0) {
    return {
      sessionKey: params.sessionKey,
      leaseId,
      claimedByNodeId: nodeId,
      leaseExpiresAt: expiresAt,
    }
  }

  const tookOver = await db.execute(sql`
    UPDATE task_chat_session_leases
    SET lease_id = ${leaseId},
        claimed_by_node_id = ${nodeId},
        lease_expires_at = ${expiresAt},
        updated_at = ${nowIso}
    WHERE session_key = ${params.sessionKey} AND lease_expires_at < ${nowIso}
    RETURNING session_key
  `)
  if (tookOver.rows.length > 0) {
    return {
      sessionKey: params.sessionKey,
      leaseId,
      claimedByNodeId: nodeId,
      leaseExpiresAt: expiresAt,
    }
  }

  return null
}

export const renewTaskChatSessionLeaseDb = async (params: {
  sessionKey: string
  leaseId: string
  ttlMs?: number
}): Promise<boolean> => {
  const db = getDrizzleDb()
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + (params.ttlMs ?? TASK_CHAT_SESSION_LEASE_TTL_MS)).toISOString()
  const renewed = await db.execute(sql`
    UPDATE task_chat_session_leases
    SET lease_expires_at = ${expiresAt}, updated_at = ${nowIso}
    WHERE session_key = ${params.sessionKey} AND lease_id = ${params.leaseId}
    RETURNING session_key
  `)
  return renewed.rows.length > 0
}

export const releaseTaskChatSessionLeaseDb = async (params: {
  sessionKey: string
  leaseId: string
}) => {
  const db = getDrizzleDb()
  await db.execute(sql`
    DELETE FROM task_chat_session_leases
    WHERE session_key = ${params.sessionKey} AND lease_id = ${params.leaseId}
  `)
}

// 启动期一次性清理：删除历史 taskChatQueues app_meta 键（迁移后不再使用）。
export const deleteLegacyTaskChatQueuesMetaDb = async () => {
  const db = getDrizzleDb()
  await db.delete(appMeta).where(sql`${appMeta.key} = 'taskChatQueues'`)
}

// 启动初始化：镜像填充 + 过期 claim 清扫调度（清扫负责恢复崩溃节点的 claim）。
export const initTaskChatQueueStore = async () => {
  await refreshTaskChatQueueMirror()
  startTaskChatQueueSweepSchedule()
}
