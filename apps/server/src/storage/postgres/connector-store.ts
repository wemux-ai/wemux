/**
 * [INPUT]: Drizzle schema, authenticated user/workspace scope.
 * [OUTPUT]: Persistent connector connection ownership records.
 * [POS]: Postgres connector store——连接归属（谁拥有、哪个组织），执行仍由 open-connector runtime 承担
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { getDrizzleDb } from './drizzle-db'
import { connectorConnections } from './schema-core'

export type ConnectorConnectionRecord = typeof connectorConnections.$inferSelect
export type ConnectorConnectionInsert = typeof connectorConnections.$inferInsert

export const createConnectorConnectionRecord = async (record: ConnectorConnectionInsert) => {
  const db = getDrizzleDb()
  await db.insert(connectorConnections).values(record).onConflictDoNothing()
  return record as ConnectorConnectionRecord
}

export const listConnectorConnectionRecordsForUser = async (
  userId: string,
  workspaceIds: string[],
): Promise<ConnectorConnectionRecord[]> => {
  const db = getDrizzleDb()
  const userWorkspaceIds = [...new Set(workspaceIds.map((id) => id.trim()).filter(Boolean))]

  // 可见规则：个人连接（仅本人）OR 我所在组织的连接（成员共享，不限 owner）
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(
      userWorkspaceIds.length > 0
        ? or(
            and(
              eq(connectorConnections.ownerUserId, userId),
              isNull(connectorConnections.workspaceId),
            ),
            inArray(connectorConnections.workspaceId, userWorkspaceIds),
          )
        : and(
            eq(connectorConnections.ownerUserId, userId),
            isNull(connectorConnections.workspaceId),
          ),
    )
    .orderBy(desc(connectorConnections.updatedAt))

  return rows
}

export const getConnectorConnectionRecord = async (id: string) => {
  const db = getDrizzleDb()
  const rows = await db.select().from(connectorConnections).where(eq(connectorConnections.id, id)).limit(1)
  return rows[0] ?? null
}

export const deleteConnectorConnectionRecord = async (id: string) => {
  const db = getDrizzleDb()
  await db.delete(connectorConnections).where(eq(connectorConnections.id, id))
}

export const updateConnectorConnectionRecordStatus = async (
  id: string,
  status: ConnectorConnectionRecord['status'],
  message?: string,
) => {
  const db = getDrizzleDb()
  await db
    .update(connectorConnections)
    .set({ status, message: message ?? null, updatedAt: new Date().toISOString() })
    .where(eq(connectorConnections.id, id))
}

export const updateConnectorConnectionRecordScope = async (
  id: string,
  scope: { workspaceId: string | null; visibility: 'personal' | 'workspace' },
) => {
  const db = getDrizzleDb()
  await db
    .update(connectorConnections)
    .set({ workspaceId: scope.workspaceId, visibility: scope.visibility, updatedAt: new Date().toISOString() })
    .where(eq(connectorConnections.id, id))
}
