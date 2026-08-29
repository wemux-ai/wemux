// [INPUT]: 画像领域输入（UpdateUserProfileInput / UpdateAgentProfileInput / WorkRecord）
// [OUTPUT]: user_profiles / agent_profiles / work_records 表 CRUD
// [POS]: 画像 Postgres 存储层；可见性/隔离校验在路由层（haveSharedWorkspace），本层不鉴权
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import type {
  AgentProfileRecord,
  UpdateAgentProfileInput,
  UpdateUserProfileInput,
  UserProfileRecord,
  WorkRecord,
  WorkRecordType,
} from '@shared/types'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { agentProfiles, userProfiles, workRecords } from '../storage/postgres/schema-core'

const nowIso = () => new Date().toISOString()

// ---------- 用户画像 ----------

export const getUserProfile = async (userId: string): Promise<UserProfileRecord | null> => {
  const rows = await getDrizzleDb().select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)
  return rows[0] ?? null
}

/** 批量查询成员画像（图谱装配用；inArray 空数组时返回空） */
export const getUserProfilesByWorkspaceMembers = async (userIds: string[]): Promise<UserProfileRecord[]> => {
  if (userIds.length === 0) return []
  return getDrizzleDb().select().from(userProfiles).where(inArray(userProfiles.userId, userIds))
}

export const upsertUserProfile = async (userId: string, input: UpdateUserProfileInput): Promise<UserProfileRecord> => {
  const now = nowIso()
  const existing = await getUserProfile(userId)
  const record: UserProfileRecord = {
    userId,
    title: input.title !== undefined ? input.title : (existing?.title ?? null),
    department: input.department !== undefined ? input.department : (existing?.department ?? null),
    skills: input.skills !== undefined ? input.skills : (existing?.skills ?? null),
    okrJson: input.okrJson !== undefined ? input.okrJson : (existing?.okrJson ?? null),
    workSummaryJson: input.workSummaryJson !== undefined ? input.workSummaryJson : (existing?.workSummaryJson ?? null),
    visibility: input.visibility ?? existing?.visibility ?? 'team',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await getDrizzleDb()
    .insert(userProfiles)
    .values(record)
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        title: record.title,
        department: record.department,
        skills: record.skills,
        okrJson: record.okrJson,
        workSummaryJson: record.workSummaryJson,
        visibility: record.visibility,
        updatedAt: record.updatedAt,
      },
    })
  return record
}

// ---------- Agent 画像 ----------

export const getAgentProfile = async (agentId: string): Promise<AgentProfileRecord | null> => {
  const rows = await getDrizzleDb().select().from(agentProfiles).where(eq(agentProfiles.agentId, agentId)).limit(1)
  return rows[0] ?? null
}

export const upsertAgentProfile = async (agentId: string, input: UpdateAgentProfileInput): Promise<AgentProfileRecord> => {
  const now = nowIso()
  const existing = await getAgentProfile(agentId)
  const record: AgentProfileRecord = {
    agentId,
    identityJson: input.identityJson !== undefined ? input.identityJson : (existing?.identityJson ?? null),
    okrJson: input.okrJson !== undefined ? input.okrJson : (existing?.okrJson ?? null),
    activityLogJson: input.activityLogJson !== undefined ? input.activityLogJson : (existing?.activityLogJson ?? null),
    healthScore: input.healthScore !== undefined ? input.healthScore : (existing?.healthScore ?? null),
    lastActiveAt: input.lastActiveAt !== undefined ? input.lastActiveAt : (existing?.lastActiveAt ?? null),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await getDrizzleDb()
    .insert(agentProfiles)
    .values({ ...record, identityJson: record.identityJson ?? {} })
    .onConflictDoUpdate({
      target: agentProfiles.agentId,
      set: {
        identityJson: record.identityJson ?? {},
        okrJson: record.okrJson,
        activityLogJson: record.activityLogJson,
        healthScore: record.healthScore,
        lastActiveAt: record.lastActiveAt,
        updatedAt: record.updatedAt,
      },
    })
  return record
}

// ---------- 工作记录 ----------

export const listWorkRecords = async (
  actorType: 'user' | 'agent',
  actorId: string,
  limit = 20,
  opts?: { from?: string; to?: string },
): Promise<WorkRecord[]> => {
  const conditions = [eq(workRecords.actorType, actorType), eq(workRecords.actorId, actorId)]
  if (opts?.from) conditions.push(gte(workRecords.occurredAt, opts.from))
  if (opts?.to) conditions.push(lte(workRecords.occurredAt, opts.to))
  return getDrizzleDb()
    .select()
    .from(workRecords)
    .where(and(...conditions))
    .orderBy(desc(workRecords.occurredAt))
    .limit(limit)
}

export const createWorkRecord = async (input: {
  actorType: 'user' | 'agent'
  actorId: string
  recordType: WorkRecordType
  targetType: WorkRecord['targetType']
  targetId?: string | null
  title: string
  summary?: string | null
  metadataJson?: unknown | null
  occurredAt?: string
}): Promise<WorkRecord> => {
  const now = nowIso()
  const record: WorkRecord = {
    id: randomUUID(),
    actorType: input.actorType,
    actorId: input.actorId,
    recordType: input.recordType,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    title: input.title,
    summary: input.summary ?? null,
    metadataJson: input.metadataJson ?? null,
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  }
  await getDrizzleDb().insert(workRecords).values(record)
  return record
}
