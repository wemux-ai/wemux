/**
 * [INPUT]: workspace_shares 表（Postgres）中的工作区共享授权记录
 * [OUTPUT]: 授权 CRUD + 按目标/工作区/会话解析访问权限（read/edit/collaborate）
 * [POS]: 分享/协作授权存储层；分享=授权+发链接消息，协作=仅授权；鉴权消费方为 workspace 会话读写链路
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { WorkspaceSharePermission, WorkspaceShareRecord, WorkspaceShareScope, WorkspaceShareTargetType } from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { workspaceShares } from './schema'

type WorkspaceShareRow = typeof workspaceShares.$inferSelect

const cache = {
  shares: [] as WorkspaceShareRecord[],
}

const mapWorkspaceShareRow = (row: WorkspaceShareRow): WorkspaceShareRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  scope: row.scope as WorkspaceShareScope,
  sessionId: row.sessionId ?? undefined,
  targetType: row.targetType as WorkspaceShareTargetType,
  targetId: row.targetId,
  permission: row.permission as WorkspaceSharePermission,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  revokedAt: row.revokedAt ?? undefined,
})

export const initWorkspaceShareStore = async () => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().select().from(workspaceShares).orderBy(workspaceShares.createdAt)
  cache.shares = rows.map(mapWorkspaceShareRow)
}

const isActive = (share: WorkspaceShareRecord) => !share.revokedAt

/** 记录在案（含已撤销，用于幂等 upsert 时定位旧记录） */
export const listWorkspaceShareRecords = (): WorkspaceShareRecord[] => cloneJson(cache.shares)

/** 对某目标生效中的授权 */
export const listActiveWorkspaceSharesForTarget = (targetType: WorkspaceShareTargetType, targetId: string): WorkspaceShareRecord[] => {
  return cache.shares.filter((share) => share.targetType === targetType && share.targetId === targetId && isActive(share))
}

/** 对某工作区生效中的授权（含会话级） */
export const listActiveWorkspaceSharesForWorkspace = (workspaceId: string): WorkspaceShareRecord[] => {
  return cache.shares.filter((share) => share.workspaceId === workspaceId && isActive(share))
}

export type GrantWorkspaceShareParams = {
  workspaceId: string
  scope: WorkspaceShareScope
  sessionId?: string
  targetType: WorkspaceShareTargetType
  targetId: string
  permission: WorkspaceSharePermission
  createdBy: string
}

/**
 * 授权/更新：同一 workspace+scope+session+target 已有记录时复用并刷新权限，
 * 避免重复行；已撤销的旧记录重新激活。
 */
export const grantWorkspaceShare = async (params: GrantWorkspaceShareParams): Promise<WorkspaceShareRecord> => {
  const now = new Date().toISOString()
  const existing = cache.shares.find((share) => (
    share.workspaceId === params.workspaceId
    && share.scope === params.scope
    && (share.sessionId ?? '') === (params.sessionId ?? '')
    && share.targetType === params.targetType
    && share.targetId === params.targetId
  ))

  const next: WorkspaceShareRecord = existing
    ? { ...existing, permission: params.permission, revokedAt: undefined, updatedAt: now }
    : {
        id: crypto.randomUUID(),
        workspaceId: params.workspaceId,
        scope: params.scope,
        sessionId: params.sessionId,
        targetType: params.targetType,
        targetId: params.targetId,
        permission: params.permission,
        createdBy: params.createdBy,
        createdAt: now,
        updatedAt: now,
      }

  if (existing) {
    cache.shares = cache.shares.map((share) => share.id === existing.id ? next : share)
  } else {
    cache.shares.push(next)
  }

  await getDrizzleDb()
    .insert(workspaceShares)
    .values({
      id: next.id,
      workspaceId: next.workspaceId,
      scope: next.scope,
      sessionId: next.sessionId ?? null,
      targetType: next.targetType,
      targetId: next.targetId,
      permission: next.permission,
      createdBy: next.createdBy,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
      revokedAt: next.revokedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [workspaceShares.workspaceId, workspaceShares.scope, workspaceShares.sessionId, workspaceShares.targetType, workspaceShares.targetId],
      set: {
        permission: next.permission,
        updatedAt: next.updatedAt,
        revokedAt: next.revokedAt ?? null,
      },
    })

  return cloneJson(next)
}

export const revokeWorkspaceShare = async (shareId: string): Promise<WorkspaceShareRecord | null> => {
  const target = cache.shares.find((share) => share.id === shareId)
  if (!target) {
    return null
  }
  const now = new Date().toISOString()
  const next: WorkspaceShareRecord = { ...target, revokedAt: now, updatedAt: now }
  cache.shares = cache.shares.map((share) => share.id === shareId ? next : share)

  await getDrizzleDb()
    .update(workspaceShares)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(workspaceShares.id, shareId))

  return cloneJson(next)
}

export type ResolvedWorkspaceShareAccess =
  | { ok: true, permission: WorkspaceSharePermission, shareIds: string[] }
  | { ok: false }

/**
 * 解析某用户对工作区（可选会话）的生效授权。
 * - 用户级授权（targetType='user'）优先；Agent 目标不参与用户访问解析。
 * - 范围匹配：scope='workspace' 覆盖任意会话；'all_sessions' 覆盖该工作区所有会话；
 *   'session' 仅覆盖指定 sessionId。
 */
export const resolveWorkspaceShareAccess = (
  userId: string,
  workspaceId: string,
  sessionId?: string,
): ResolvedWorkspaceShareAccess => {
  const matched: Array<{ permission: WorkspaceSharePermission; shareId: string }> = []
  for (const share of cache.shares) {
    if (share.targetType !== 'user' || share.targetId !== userId || !isActive(share) || share.workspaceId !== workspaceId) {
      continue
    }
    if (share.scope === 'workspace' || share.scope === 'all_sessions') {
      matched.push({ permission: share.permission, shareId: share.id })
      continue
    }
    if (sessionId && share.sessionId === sessionId) {
      matched.push({ permission: share.permission, shareId: share.id })
    }
  }

  if (matched.length === 0) {
    return { ok: false }
  }

  // 取最高权限（collaborate > edit > read）
  const rank: Record<WorkspaceSharePermission, number> = { read: 1, edit: 2, collaborate: 3 }
  const best = matched.reduce((current, item) => rank[item.permission] > rank[current.permission] ? item : current)
  return {
    ok: true,
    permission: best.permission,
    shareIds: matched.map((item) => item.shareId),
  }
}

/** 目标收到的工作区级授权（对方视角「共享给我」：整个工作区/所有会话条目） */
export const listSharedWorkspacesForTarget = (targetType: WorkspaceShareTargetType, targetId: string) => {
  return listActiveWorkspaceSharesForTarget(targetType, targetId)
    .filter((share) => share.scope === 'workspace' || share.scope === 'all_sessions')
}

/** 目标收到的会话级授权（对方视角「共享给我的会话」） */
export const listSharedSessionsForTarget = (targetType: WorkspaceShareTargetType, targetId: string): WorkspaceShareRecord[] => {
  return listActiveWorkspaceSharesForTarget(targetType, targetId)
    .filter((share) => share.scope === 'session')
}

export const resetWorkspaceShareStoreCache = () => {
  cache.shares = []
}
