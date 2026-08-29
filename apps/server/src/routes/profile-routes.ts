// [INPUT]: 已鉴权 Hono app + 画像读写请求
// [OUTPUT]: /api/users/:userId/profile、/api/agents/:agentId/profile、/api/my/profile、/api/users/:userId/work-records
// [POS]: 画像 HTTP 协议层；消费方是 Agent（决策上下文）与人类；隔离：private 仅本人，team 需共同组织，public 公开
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { and, asc, eq, ilike, ne, or } from 'drizzle-orm'
import { haveSharedWorkspace, isWorkspaceMember } from '../repositories/workspace'
import { filterVisibleUserIds } from '../services/user-visibility-service'
import { getAgent } from '../storage/postgres/agent-store'
import { getUserById } from '../storage/postgres/auth-store'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { users } from '../storage/postgres/schema'
import { getWorkspaceOverview } from '../services/workspace-overview-service'
import {
  createWorkRecord,
  getAgentProfile,
  getUserProfile,
  listWorkRecords,
  upsertAgentProfile,
  upsertUserProfile,
} from '../repositories/profile-store'
import { getUserIdFromHeader, jsonError } from './shared'

const userProfileSchema = z.object({
  title: z.string().trim().max(100).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(50).nullable().optional(),
  okrJson: z.unknown().nullable().optional(),
  workSummaryJson: z.unknown().nullable().optional(),
  visibility: z.enum(['private', 'team', 'public']).optional(),
})

const agentProfileSchema = z.object({
  identityJson: z.unknown().nullable().optional(),
  okrJson: z.unknown().nullable().optional(),
  activityLogJson: z.unknown().nullable().optional(),
  healthScore: z.number().min(0).max(1).nullable().optional(),
  lastActiveAt: z.string().nullable().optional(),
})

/** 用户画像读取隔离：private 仅本人；team 需共同组织；public 公开 */
const canReadUserProfile = async (viewerUserId: string, targetUserId: string, visibility: string) => {
  if (viewerUserId === targetUserId) return true
  if (visibility === 'public') return true
  if (visibility === 'team') return haveSharedWorkspace(viewerUserId, targetUserId)
  return false
}

/** Agent 画像读取隔离：owner 本人或与其有共同组织的用户 */
const canReadAgentProfile = async (viewerUserId: string, ownerUserId: string | null) => {
  if (ownerUserId === null) return true
  if (ownerUserId === viewerUserId) return true
  return haveSharedWorkspace(viewerUserId, ownerUserId)
}

export const registerProfileRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 用户搜索（跨空间私聊发起）：按用户 ID/姓名/邮箱 ILIKE，仅返回有限条数防枚举；排除自己。
  app.get('/api/users/search', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const rawQuery = c.req.query('q')?.trim() || ''
    const workspaceId = c.req.query('workspaceId')?.trim() || undefined
    const connectionSearch = c.req.query('connection') === '1'
    if (!rawQuery || rawQuery.length < 2) {
      return c.json({ users: [] })
    }

    const pattern = `%${rawQuery.replace(/[%_]/g, '\\$&')}%`
    const rows = await getDrizzleDb()
      .select({ id: users.id, name: users.name, username: users.username, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(
        eq(users.status, 'active'),
        ne(users.id, userId),
        or(
          ilike(users.name, pattern),
          ilike(users.email, pattern),
          ilike(users.username, pattern),
        ),
      ))
      .orderBy(asc(users.name))
      .limit(20)

    // 好友请求需要先找到外部用户；普通搜索仍只返回当前空间可见用户。
    const visible = connectionSearch && workspaceId && await isWorkspaceMember(workspaceId, userId)
      ? rows.map((row) => row.id)
      : await filterVisibleUserIds(userId, rows.map((row) => row.id), workspaceId)
    const visibleSet = new Set(visible)

    return c.json({
      users: rows
        .filter((row) => visibleSet.has(row.id))
        .slice(0, 10)
        .map((row) => ({
          id: row.id,
          name: row.name,
          username: row.username ?? undefined,
          email: row.email,
          avatarUrl: row.avatarUrl ?? undefined,
        })),
    })
  })

  // 我的画像（本人，含工作记录）
  app.get('/api/my/profile', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const [profile, workRecords] = await Promise.all([
      getUserProfile(userId),
      listWorkRecords('user', userId, 20),
    ])
    return c.json({ profile, workRecords })
  })

  app.put('/api/my/profile', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const parsed = userProfileSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    const profile = await upsertUserProfile(userId, parsed.data)
    return c.json({ profile })
  })

  // 用户画像（读，含隔离；profile 可为 null = 用户未设置画像，但返回基础信息供页面展示）
  app.get('/api/users/:userId/profile', requireAuth, async (c) => {
    const viewerId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    const user = getUserById(targetUserId)
    if (!user) return jsonError(c, '用户不存在。', 404)
    const profile = await getUserProfile(targetUserId)
    if (profile && !(await canReadUserProfile(viewerId, targetUserId, profile.visibility))) {
      return jsonError(c, '无权查看该用户画像。', 403)
    }
    return c.json({
      profile,
      user: { id: user.id, name: user.name, username: user.username ?? null, avatarUrl: user.avatarUrl ?? null, bio: user.bio ?? null },
    })
  })

  // 用户工作记录（读，隔离：本人或共同组织）
  app.get('/api/users/:userId/work-records', requireAuth, async (c) => {
    const viewerId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    if (viewerId !== targetUserId && !(await haveSharedWorkspace(viewerId, targetUserId))) {
      return jsonError(c, '无权查看该用户工作记录。', 403)
    }
    const records = await listWorkRecords('user', targetUserId, 50)
    return c.json({ workRecords: records })
  })

  // Agent 工作记录（读，隔离：owner 本人或共同组织）
  app.get('/api/agents/:agentId/work-records', requireAuth, async (c) => {
    const viewerId = getUserIdFromHeader(c)!
    const agentId = c.req.param('agentId')
    const agent = getAgent(agentId)
    if (!agent) return jsonError(c, 'Agent 不存在。', 404)
    if (!(await canReadAgentProfile(viewerId, agent.ownerUserId ?? null))) {
      return jsonError(c, '无权查看该 Agent 工作记录。', 403)
    }
    const records = await listWorkRecords('agent', agentId, 50)
    return c.json({ workRecords: records })
  })

  // 组织组织概览（隔离：仅空间成员，由 isWorkspaceMember 保证）
  app.get('/api/collab/workspaces/:workspaceId/overview', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '不是该组织成员。', 403)
    }
    const overview = await getWorkspaceOverview(workspaceId)
    return c.json({ overview })
  })

  // Agent 画像（读，隔离：owner 本人或共同组织）
  app.get('/api/agents/:agentId/profile', requireAuth, async (c) => {
    const viewerId = getUserIdFromHeader(c)!
    const agentId = c.req.param('agentId')
    const agent = getAgent(agentId)
    if (!agent) return jsonError(c, 'Agent 不存在。', 404)
    if (!(await canReadAgentProfile(viewerId, agent.ownerUserId ?? null))) {
      return jsonError(c, '无权查看该 Agent 画像。', 403)
    }
    const profile = await getAgentProfile(agentId)
    return c.json({ profile })
  })

  // Agent 画像（写，仅 owner 本人）
  app.put('/api/agents/:agentId/profile', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const agentId = c.req.param('agentId')
    const agent = getAgent(agentId)
    if (!agent) return jsonError(c, 'Agent 不存在。', 404)
    if (agent.ownerUserId && agent.ownerUserId !== userId) {
      return jsonError(c, '只有 Agent 的所有者才能更新画像。', 403)
    }
    const parsed = agentProfileSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    const profile = await upsertAgentProfile(agentId, parsed.data)
    return c.json({ profile })
  })

  // 工作记录写入（内部/Agent 使用：任务完成、Drive 文件创建等事件回写）
  app.post('/api/work-records', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const parsed = z.object({
      actorType: z.enum(['user', 'agent']),
      actorId: z.string().min(1),
      recordType: z.enum(['task_completed', 'task_dispatched', 'drive_file_created', 'drive_file_updated', 'conversation']),
      targetType: z.enum(['task', 'drive_file', 'conversation', 'workspace']),
      targetId: z.string().nullable().optional(),
      title: z.string().min(1).max(200),
      summary: z.string().max(1000).nullable().optional(),
      metadataJson: z.unknown().nullable().optional(),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    // 只允许记录自己的行为（user 必须是本人；agent 必须 owner 是本人）
    if (parsed.data.actorType === 'user' && parsed.data.actorId !== userId) {
      return jsonError(c, '只能记录自己的行为。', 403)
    }
    if (parsed.data.actorType === 'agent') {
      const agent = getAgent(parsed.data.actorId)
      if (!agent || (agent.ownerUserId && agent.ownerUserId !== userId)) {
        return jsonError(c, 'Agent 不存在或无权记录。', 403)
      }
    }
    const record = await createWorkRecord(parsed.data)
    return c.json({ workRecord: record }, 201)
  })
}
