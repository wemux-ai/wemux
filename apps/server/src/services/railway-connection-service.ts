// [INPUT]: Authenticated user-scoped Railway Account Token mutations.
// [OUTPUT]: Normalized connection summary and encrypted token access.
// [POS]: Server persistence and encryption boundary for Railway connections.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import type { RailwayConnectionSummary } from '@shared/types'

import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { railwayConnections } from '../storage/postgres/schema'
import { fetchRailwayMe, type RailwayMe } from './railway-graphql-client'
import { decryptSecret, encryptSecret } from './secret-crypto'

type RailwayConnectionRow = typeof railwayConnections.$inferSelect

const mapRow = (row: RailwayConnectionRow): RailwayConnectionSummary => ({
  id: row.id,
  userId: row.userId,
  accountEmail: row.accountEmail ?? undefined,
  accountName: row.accountName ?? undefined,
  status: row.status,
  lastSyncedAt: row.lastSyncedAt ?? undefined,
  lastError: row.lastError ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  hasToken: true,
})

const findConnectionRow = async (userId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(railwayConnections)
    .where(eq(railwayConnections.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

/** 解密并返回该用户的 Railway Account Token；无连接或解密失败返回 null。 */
export const loadRailwayToken = async (userId: string): Promise<string | null> => {
  const row = await findConnectionRow(userId)
  if (!row) return null
  try {
    return decryptSecret(row.tokenEncrypted)
  } catch {
    return null
  }
}

export const getRailwayConnection = async (userId: string): Promise<RailwayConnectionSummary | null> => {
  const row = await findConnectionRow(userId)
  return row ? mapRow(row) : null
}

export const listRailwayConnectionSummaries = async (): Promise<RailwayConnectionSummary[]> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .select()
    .from(railwayConnections)
    .orderBy(railwayConnections.updatedAt)
  return rows.map(mapRow)
}

/** 校验 token 并建立/刷新连接。失败抛错（含校验失败详情）。 */
export const connectRailway = async (
  userId: string,
  token: string,
): Promise<{ connection: RailwayConnectionSummary; me: RailwayMe }> => {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error('Railway Account Token 不能为空。')
  }

  const verify = await fetchRailwayMe(trimmed)
  if (!verify.ok) {
    throw new Error(verify.message)
  }

  const now = new Date().toISOString()
  const existing = await findConnectionRow(userId)
  const id = existing?.id ?? randomUUID()

  await ensurePostgresReady()
  if (existing) {
    await getDrizzleDb()
      .update(railwayConnections)
      .set({
        tokenEncrypted: encryptSecret(trimmed),
        accountEmail: verify.data.email ?? null,
        accountName: verify.data.name ?? null,
        status: 'connected',
        lastError: null,
        updatedAt: now,
      })
      .where(eq(railwayConnections.id, id))
  } else {
    await getDrizzleDb()
      .insert(railwayConnections)
      .values({
        id,
        userId,
        tokenEncrypted: encryptSecret(trimmed),
        accountEmail: verify.data.email ?? null,
        accountName: verify.data.name ?? null,
        status: 'connected',
        lastSyncedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
  }

  const connection = await getRailwayConnection(userId)
  if (!connection) {
    throw new Error('Railway 连接保存失败。')
  }

  return { connection, me: verify.data }
}

export const markRailwayConnectionSynced = async (userId: string) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .update(railwayConnections)
    .set({ lastSyncedAt: now, status: 'connected', lastError: null, updatedAt: now })
    .where(eq(railwayConnections.userId, userId))
}

export const markRailwayConnectionError = async (userId: string, message: string) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  await getDrizzleDb()
    .update(railwayConnections)
    .set({ lastError: message, status: 'error', updatedAt: now })
    .where(eq(railwayConnections.userId, userId))
}

export const disconnectRailway = async (userId: string): Promise<boolean> => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb()
    .delete(railwayConnections)
    .where(eq(railwayConnections.userId, userId))
    .returning({ id: railwayConnections.id })
  return rows.length > 0
}
