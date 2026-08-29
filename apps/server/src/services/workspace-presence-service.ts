// [INPUT]: presence 上报（viewing/working）
// [OUTPUT]: 记录/查询（TTL 60s）
// [POS]: 工作区 presence 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { and, eq, gte, inArray, ne } from 'drizzle-orm'

import type { WorkspacePresenceState, WorkspacePresenceUser } from '@shared/types'
import { getUserById } from '../repositories/auth'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { workspacePresence } from '../storage/postgres/schema'

const WORKSPACE_PRESENCE_TTL_MS = 60_000

const resolvePresenceThreshold = (nowMs = Date.now()) => (
  new Date(nowMs - WORKSPACE_PRESENCE_TTL_MS).toISOString()
)

const mapPresenceRow = (row: typeof workspacePresence.$inferSelect): WorkspacePresenceUser => {
  const user = getUserById(row.userId)
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    name: user?.name?.trim() || row.userId,
    avatarUrl: user?.avatarUrl,
    state: row.state,
    lastSeenAt: row.lastSeenAt,
    activeWorkspaceSessionId: row.activeWorkspaceSessionId ?? undefined,
  }
}

export const recordWorkspacePresence = async (params: {
  workspaceId: string
  userId: string
  state: WorkspacePresenceState
  activeWorkspaceSessionId?: string
}) => {
  const workspaceId = params.workspaceId.trim()
  const userId = params.userId.trim()
  if (!workspaceId || !userId) {
    return null
  }

  await ensurePostgresReady()
  const lastSeenAt = new Date().toISOString()
  const rows = await getDrizzleDb()
    .insert(workspacePresence)
    .values({
      workspaceId,
      userId,
      state: params.state,
      activeWorkspaceSessionId: params.activeWorkspaceSessionId?.trim() || null,
      lastSeenAt,
    })
    .onConflictDoUpdate({
      target: [workspacePresence.workspaceId, workspacePresence.userId],
      set: {
        state: params.state,
        activeWorkspaceSessionId: params.activeWorkspaceSessionId?.trim() || null,
        lastSeenAt,
      },
    })
    .returning()

  return rows[0] ? mapPresenceRow(rows[0]) : null
}

export const listWorkspacePresenceUsers = async (workspaceId: string, options: {
  excludeUserId?: string
} = {}) => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) {
    return []
  }

  await ensurePostgresReady()
  const filters = [
    eq(workspacePresence.workspaceId, normalizedWorkspaceId),
    gte(workspacePresence.lastSeenAt, resolvePresenceThreshold()),
  ]
  const excludedUserId = options.excludeUserId?.trim()
  if (excludedUserId) {
    filters.push(ne(workspacePresence.userId, excludedUserId))
  }
  const rows = await getDrizzleDb()
    .select()
    .from(workspacePresence)
    .where(and(...filters))

  return rows
    .map(mapPresenceRow)
    .sort((left, right) => {
      if (left.state !== right.state) {
        return left.state === 'working' ? -1 : 1
      }
      return right.lastSeenAt.localeCompare(left.lastSeenAt)
    })
}

export const listWorkspacePresenceByWorkspaceId = async (
  workspaceIds: string[],
  options: {
    excludeUserId?: string
  } = {},
) => {
  const normalizedWorkspaceIds = Array.from(new Set(workspaceIds.map((id) => id.trim()).filter(Boolean)))
  if (normalizedWorkspaceIds.length === 0) {
    return {}
  }

  await ensurePostgresReady()
  const filters = [
    inArray(workspacePresence.workspaceId, normalizedWorkspaceIds),
    gte(workspacePresence.lastSeenAt, resolvePresenceThreshold()),
  ]
  const excludedUserId = options.excludeUserId?.trim()
  if (excludedUserId) {
    filters.push(ne(workspacePresence.userId, excludedUserId))
  }
  const rows = await getDrizzleDb()
    .select()
    .from(workspacePresence)
    .where(and(...filters))

  const result: Record<string, WorkspacePresenceUser[]> = {}
  for (const row of rows) {
    const record = mapPresenceRow(row)
    result[record.workspaceId] = [...(result[record.workspaceId] ?? []), record]
  }
  for (const records of Object.values(result)) {
    records.sort((left, right) => {
      if (left.state !== right.state) {
        return left.state === 'working' ? -1 : 1
      }
      return right.lastSeenAt.localeCompare(left.lastSeenAt)
    })
  }
  return result
}
