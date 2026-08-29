/**
 * [INPUT]: 协作空间分组 CRUD 与成员归类请求。
 * [OUTPUT]: collab_workspace_groups / collab_workspace_group_members 读写。
 * [POS]: 空间内分组存储层；成员校验（必须是空间成员/可用 Agent）在路由层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDrizzleDb } from './drizzle-db'
import { collabWorkspaceGroupMembers, collabWorkspaceGroups } from './schema-core'

export type WorkspaceGroupRow = typeof collabWorkspaceGroups.$inferSelect
export type WorkspaceGroupMemberRow = typeof collabWorkspaceGroupMembers.$inferSelect

export type WorkspaceGroupWithMembers = WorkspaceGroupRow & {
  members: Array<{ memberType: 'user' | 'agent'; memberId: string }>
}

export const listWorkspaceGroups = async (workspaceId: string): Promise<WorkspaceGroupWithMembers[]> => {
  const groups = await getDrizzleDb().select().from(collabWorkspaceGroups)
    .where(eq(collabWorkspaceGroups.workspaceId, workspaceId))
    .orderBy(asc(collabWorkspaceGroups.sortOrder), asc(collabWorkspaceGroups.createdAt))
  if (groups.length === 0) {
    return []
  }
  const groupIds = groups.map((group) => group.id)
  const memberRows = await getDrizzleDb().select().from(collabWorkspaceGroupMembers)
    .where(inArray(collabWorkspaceGroupMembers.groupId, groupIds))
  const membersByGroupId = new Map<string, WorkspaceGroupMemberRow[]>()
  for (const row of memberRows) {
    const list = membersByGroupId.get(row.groupId) ?? []
    list.push(row)
    membersByGroupId.set(row.groupId, list)
  }
  return groups.map((group) => ({
    ...group,
    members: (membersByGroupId.get(group.id) ?? []).map((row) => ({
      memberType: row.memberType,
      memberId: row.memberId,
    })),
  }))
}

export const createWorkspaceGroup = async (params: { workspaceId: string; name: string }) => {
  const existing = await getDrizzleDb().select({ id: collabWorkspaceGroups.id }).from(collabWorkspaceGroups)
    .where(and(
      eq(collabWorkspaceGroups.workspaceId, params.workspaceId),
      eq(collabWorkspaceGroups.name, params.name.trim()),
    )).limit(1)
  if (existing.length > 0) {
    return null
  }
  const groups = await getDrizzleDb().select({ count: collabWorkspaceGroups.sortOrder }).from(collabWorkspaceGroups)
    .where(eq(collabWorkspaceGroups.workspaceId, params.workspaceId))
  const now = new Date().toISOString()
  const group = {
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId,
    name: params.name.trim(),
    sortOrder: groups.length,
    createdAt: now,
  }
  await getDrizzleDb().insert(collabWorkspaceGroups).values(group)
  return group
}

export const renameWorkspaceGroup = async (groupId: string, name: string) => {
  const trimmed = name.trim()
  if (!trimmed) return null
  const [updated] = await getDrizzleDb().update(collabWorkspaceGroups)
    .set({ name: trimmed })
    .where(eq(collabWorkspaceGroups.id, groupId))
    .returning()
  return updated ?? null
}

export const deleteWorkspaceGroup = async (groupId: string) => {
  await getDrizzleDb().delete(collabWorkspaceGroupMembers).where(eq(collabWorkspaceGroupMembers.groupId, groupId))
  const [deleted] = await getDrizzleDb().delete(collabWorkspaceGroups)
    .where(eq(collabWorkspaceGroups.id, groupId))
    .returning({ id: collabWorkspaceGroups.id })
  return Boolean(deleted)
}

export const addWorkspaceGroupMember = async (params: {
  groupId: string
  memberType: 'user' | 'agent'
  memberId: string
}) => {
  const [row] = await getDrizzleDb().insert(collabWorkspaceGroupMembers).values({
    groupId: params.groupId,
    memberType: params.memberType,
    memberId: params.memberId,
    createdAt: new Date().toISOString(),
  }).onConflictDoNothing().returning()
  return row ?? null
}

export const removeWorkspaceGroupMember = async (params: {
  groupId: string
  memberType: 'user' | 'agent'
  memberId: string
}) => {
  const [deleted] = await getDrizzleDb().delete(collabWorkspaceGroupMembers)
    .where(and(
      eq(collabWorkspaceGroupMembers.groupId, params.groupId),
      eq(collabWorkspaceGroupMembers.memberType, params.memberType),
      eq(collabWorkspaceGroupMembers.memberId, params.memberId),
    ))
    .returning({ id: collabWorkspaceGroupMembers.groupId })
  return Boolean(deleted)
}
