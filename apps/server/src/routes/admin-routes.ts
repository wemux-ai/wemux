// [INPUT]: 已鉴权 Hono app + requireAuth，管理员查询参数（limit 等）
import { getEnv } from '@shared/env'
// [OUTPUT]: /api/admin/* 管理路由（审计 / analytics / 用户管理 / 总账号体系）
// [POS]: 管理员控制面 HTTP 协议层；用户管理以 role(owner/admin) 为准，isInternal 为兼容位
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  getUserById,
  getUserTeams,
  listAdminAccounts,
  listAuthEventsByUser,
  listRecentAuthEvents,
  listUsersForAdmin,
  revokeAllUserSessions,
  setUserLastLogin,
  updateUserRole,
  updateUserStatus,
  updateUserSupportNote,
  type UserRole,
} from '../repositories/auth'
import { getUserIdFromHeader } from './shared'
import { listPendingApprovalRequests, listRecentAuditLogs, saveAuditLog } from '../storage/governance-store'
import { getMeta, saveMeta } from '../storage/app-state-store'
import { buildTokenQuotaSnapshot, getTokenQuotaPolicy, setTokenQuotaPolicy, clearTokenQuotaPolicy } from '../services/token-quota-service'
import { listUsageEvents } from '../services/usage-event-service'
import { resolveUsagePeriod, summarizeUsageEvents } from '../services/usage-summary-service'
import { buildAdminAnalytics } from '../services/admin-analytics-service'
import { listNodes } from '../storage/postgres/distributed-task-store'
import { listPersistedExecutors as listPersistedExecutorsFromExecutorStore } from '../storage/postgres/executor-store'
import { clusterConfig } from '../cluster/config'
import { getAdminAnalyticsProvider } from '../services/gate/admin-analytics-gate'
import { aggregateCommunityUsage } from '../storage/postgres/community-usage-store'
import { listFeedbackItems } from '../storage/postgres/feedback-store'
import { getCommercialGate } from '../services/gate/commercial-gate'

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

/** 管理员准入：role(owner/admin) 为权威，isInternal 为兼容位（老内部账号）。
 * env 白名单：`WEMUX_ADMIN_EMAILS`（逗号分隔邮箱）→ 视为 owner（超级管理员），
 * 无需改数据库即可在部署层指定超管；空列表则按既有 role/isInternal 判定。 */
export const resolveAdminAccess = (user: { role?: UserRole; isInternal?: boolean; email?: string | null } | null | undefined) => {
  if (!user) {
    return { allowed: false, role: 'user' as const }
  }
  const envOwner = resolveEnvAdminEmails().has(user.email?.trim().toLowerCase() ?? '')
  const role = envOwner ? ('owner' as const)
    : (user.role === 'owner' || user.role === 'admin' ? user.role : user.isInternal ? ('admin' as const) : ('user' as const))
  return { allowed: role !== 'user', role }
}

/** 解析 WEMUX_ADMIN_EMAILS（逗号分隔邮箱）为小写 Set；空/未配置返回空集。 */
export const resolveEnvAdminEmails = (): Set<string> => {
  const raw = (process.env.VIBEMUX_ADMIN_EMAILS || getEnv('WEMUX_ADMIN_EMAILS') || '').trim()
  if (!raw) {
    return new Set()
  }
  return new Set(raw.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
}

const adminAudit = (actorId: string, eventType: string, payload: Record<string, unknown>) => {
  saveAuditLog({
    id: crypto.randomUUID(),
    eventType,
    actorType: 'user',
    actorId,
    payload,
    createdAt: new Date().toISOString(),
  })
}

const ANALYTICS_DAY_OPTIONS = [7, 14, 30, 90]

export const resolveAnalyticsDays = (value: string | undefined): number => {
  const parsed = value ? Number.parseInt(value, 10) : 14
  if (!Number.isFinite(parsed)) {
    return 14
  }
  if (parsed <= 7) {
    return 7
  }
  if (parsed >= 90) {
    return 90
  }
  return ANALYTICS_DAY_OPTIONS.find((option) => option >= parsed) ?? 30
}

/**
 * owner 角色变更护栏（HTTP 与 MCP 共用）：
 * - 不能把自己的角色从 owner 降级（避免平台无 owner）；
 * - 不能移除最后一个 owner。
 * 返回错误消息（null = 允许）。
 */
export const resolveOwnerRoleChangeGuard = (params: {
  actorId: string
  targetUserId: string
  targetRole?: UserRole
  requestedRole: UserRole
  ownerCount: number
}): string | null => {
  const { actorId, targetUserId, targetRole, requestedRole, ownerCount } = params
  if (targetUserId === actorId && requestedRole !== 'owner') {
    return '不能降低自己的管理员角色。'
  }
  if (targetRole === 'owner' && requestedRole !== 'owner' && ownerCount <= 1) {
    return '平台至少需要保留一名总管理员（owner）。'
  }
  return null
}

const userListQuerySchema = z.object({
  status: z.string().optional(),
  role: z.string().optional(),
  provider: z.string().optional(),
  plan: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const statusSchema = z.enum(['active', 'suspended', 'banned'])

export const registerAdminRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/admin/audit', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const user = getUserById(userId)
    if (!resolveAdminAccess(user).allowed) {
      return c.json({ message: '只有内部管理员可以访问审计后台。' }, 403)
    }

    const query = auditQuerySchema.parse({ limit: c.req.query('limit') })

    return c.json({
      pendingApprovals: listPendingApprovalRequests(),
      logs: listRecentAuditLogs(query.limit ?? 50),
    })
  })

  // 自有 analytics 看板数据：基础数字 + 漏斗 + 交付趋势 + 最近事件
  app.get('/api/admin/analytics', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const user = getUserById(userId)
    if (!resolveAdminAccess(user).allowed) {
      return c.json({ message: '只有内部管理员可以访问 analytics 看板。' }, 403)
    }

    const days = resolveAnalyticsDays(c.req.query('days'))
    const [base, product] = await Promise.all([
      buildAdminAnalytics(days),
      getAdminAnalyticsProvider().buildProductAnalytics(),
    ])
    return c.json({ ...base, ...(product as Record<string, unknown>) })
  })

  // 社区版匿名使用上报看板：自托管安装/活跃/版本分布/聚合计数（collector 数据）
  app.get('/api/admin/community-usage', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const user = getUserById(userId)
    if (!resolveAdminAccess(user).allowed) {
      return c.json({ message: '只有内部管理员可以访问社区版遥测看板。' }, 403)
    }
    return c.json(await aggregateCommunityUsage())
  })

  // ==========================================================================
  // 用户管理（feature 账户体系）：admin 可查 / 管状态与配额；owner 可管角色
  // ==========================================================================

  const requireAdmin = (minRole: 'admin' | 'owner' = 'admin'): MiddlewareHandler => async (c, next) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const access = resolveAdminAccess(getUserById(userId))
    if (!access.allowed) {
      return c.json({ message: '无管理员权限' }, 403)
    }
    if (minRole === 'owner' && access.role !== 'owner') {
      return c.json({ message: '仅总管理员（owner）可执行此操作。' }, 403)
    }
    await next()
  }

  // 多后端节点状态（P0-6/P1-4）：列出集群全部节点 + 各自 /api/ready 探测 + 本节点健康摘要。
  app.get('/api/admin/nodes', requireAuth, requireAdmin(), async (c) => {
    const nodes = listNodes()
    const executors = listPersistedExecutorsFromExecutorStore()
    const executorCountByNode = new Map<string, number>()
    for (const entry of executors) {
      const nodeId = entry.executor.connectedNodeId
      if (nodeId) {
        executorCountByNode.set(nodeId, (executorCountByNode.get(nodeId) ?? 0) + 1)
      }
    }

    // 逐个节点探测 /api/ready（免鉴权，只作为存活参考；失败不阻断列表）。
    const probes = await Promise.all(nodes.map(async (node) => {
      const url = (node.url || node.relayUrl || '').replace(/\/+$/, '')
      if (!url) {
        return { nodeId: node.nodeId, ready: null, error: 'no-url' }
      }
      try {
        const response = await fetch(`${url}/api/ready`, {
          signal: AbortSignal.timeout(5000),
        })
        const body = await response.json().catch(() => null) as { ok?: boolean } | null
        return { nodeId: node.nodeId, ready: response.status === 200 && body?.ok === true, error: null }
      } catch (error) {
        return { nodeId: node.nodeId, ready: false, error: error instanceof Error ? error.message : 'unreachable' }
      }
    }))

    return c.json({
      currentNodeId: clusterConfig.nodeId,
      nodes: nodes.map((node) => ({
        nodeId: node.nodeId,
        name: node.name,
        region: node.region ?? null,
        status: node.status,
        url: node.url ?? null,
        relayUrl: node.relayUrl ?? null,
        version: node.version ?? null,
        maxConcurrentTasks: node.maxConcurrentTasks,
        activeTasks: node.activeTasks,
        hasProjectBinding: node.hasProjectBinding,
        capabilities: node.capabilities,
        lastHeartbeatAt: node.lastHeartbeatAt,
        heartbeatAgeMs: node.lastHeartbeatAt
          ? Math.max(0, Date.now() - new Date(node.lastHeartbeatAt).getTime())
          : null,
        isCurrent: node.nodeId === clusterConfig.nodeId,
        executorCount: executorCountByNode.get(node.nodeId) ?? 0,
        probe: probes.find((item) => item.nodeId === node.nodeId) ?? null,
      })),
    })
  })

  app.get('/api/admin/users', requireAuth, requireAdmin(), async (c) => {
    const query = userListQuerySchema.parse({
      status: c.req.query('status'),
      role: c.req.query('role'),
      provider: c.req.query('provider'),
      plan: c.req.query('plan'),
      q: c.req.query('q'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    })
    const { users: list, total } = listUsersForAdmin(query)
    // 附带套餐信息（plan 筛选在内存层再做一次）
    const withPlan = await Promise.all(list.map(async (user) => {
      const snapshot = await getCommercialGate().resolveBillingPolicySnapshot(user.id)
      return { ...user, plan: snapshot.plan }
    }))
    let filtered = withPlan
    if (query.plan && query.plan !== 'all') {
      filtered = filtered.filter((item) => item.plan === query.plan)
    }
    return c.json({ users: filtered, total })
  })

  app.get('/api/admin/users/:userId', requireAuth, requireAdmin(), async (c) => {
    const targetUserId = c.req.param('userId')
    const user = getUserById(targetUserId)
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }

    const period = resolveUsagePeriod(c.req.query('period') ?? '30d')
    const adminAnalytics = getAdminAnalyticsProvider()
    const [billingSnapshot, tokenQuota, tokenQuotaSnapshot, usageEvents, authEventList, overview, dailyActivity] = await Promise.all([
      getCommercialGate().resolveBillingPolicySnapshot(user.id),
      getTokenQuotaPolicy(user.id),
      buildTokenQuotaSnapshot(user.id),
      listUsageEvents({ userId: user.id }),
      Promise.resolve(listAuthEventsByUser(user.id, 50)),
      adminAnalytics.buildUserOverview(user.id),
      adminAnalytics.buildUserDailyActivity(user.id),
    ])
    const usage = summarizeUsageEvents(usageEvents, period)

    return c.json({
      user,
      teams: getUserTeams(user.id),
      billing: {
        plan: billingSnapshot.plan,
        hasActiveSubscription: billingSnapshot.hasActiveSubscription,
        activeSubscriptionIds: billingSnapshot.activeSubscriptionIds,
        subscriptions: billingSnapshot.activeSubscriptionIds,
      },
      tokenQuota,
      quotaSnapshot: {
        usedTokens: tokenQuotaSnapshot.usedTokens,
        limitTokens: tokenQuotaSnapshot.limitTokens,
        usagePercent: tokenQuotaSnapshot.usagePercent,
        remainingTokens: tokenQuotaSnapshot.remainingTokens,
        periodStart: tokenQuotaSnapshot.periodStart,
        message: tokenQuotaSnapshot.message,
      },
      usage: {
        period,
        totals: usage.totals,
        daily: usage.daily.slice(0, 30),
        byModel: usage.byModel.slice(0, 5),
        byAgent: usage.byAgent.slice(0, 5),
        byProvider: usage.byProvider.slice(0, 5),
        byWorkspace: usage.byWorkspace.slice(0, 5),
      },
      overview,
      authEvents: authEventList,
      dailyActivity,
    })
  })

  app.get('/api/admin/users/:userId/activity', requireAuth, requireAdmin(), async (c) => {
    const targetUserId = c.req.param('userId')
    const user = getUserById(targetUserId)
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }
    return c.json(await getAdminAnalyticsProvider().buildUserActivity(user.id))
  })

  app.get('/api/admin/users/:userId/audit', requireAuth, requireAdmin(), async (c) => {
    const targetUserId = c.req.param('userId')
    const user = getUserById(targetUserId)
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }
    return c.json(await getAdminAnalyticsProvider().buildUserAudit(user.id))
  })

  app.patch('/api/admin/users/:userId/status', requireAuth, requireAdmin(), async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    const payload = z.object({
      status: statusSchema,
      reason: z.string().max(500).optional(),
      suspendedUntil: z.string().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    if (targetUserId === actorId && payload.status === 'banned') {
      return c.json({ message: '不能封禁自己的账号。' }, 400)
    }

    const user = updateUserStatus({
      userId: targetUserId,
      status: payload.status,
      reason: payload.reason,
      suspendedUntil: payload.suspendedUntil,
      actorId,
    })
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }

    if (payload.status !== 'active') {
      // 封禁/停用：强制下线（清 better-auth 会话），wemux token 由 requireAuth 状态阻断兜底
      await revokeAllUserSessions(targetUserId)
    }
    adminAudit(actorId, `admin_user_${payload.status}`, { targetUserId, reason: payload.reason, suspendedUntil: payload.suspendedUntil })
    return c.json({ user, ok: true })
  })

  app.patch('/api/admin/users/:userId/role', requireAuth, requireAdmin('owner'), async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    const payload = z.object({ role: z.enum(['user', 'admin', 'owner']) }).parse(await c.req.json().catch(() => ({})))

    const target = getUserById(targetUserId)
    if (!target) {
      return c.json({ message: '用户不存在' }, 404)
    }

    // owner 保护：不能把自己降级（避免平台无 owner）；不能移除最后一个 owner
    const guardError = resolveOwnerRoleChangeGuard({
      actorId,
      targetUserId,
      targetRole: target.role,
      requestedRole: payload.role,
      ownerCount: listAdminAccounts().filter((item) => item.role === 'owner').length,
    })
    if (guardError) {
      return c.json({ message: guardError }, 400)
    }

    const user = updateUserRole(targetUserId, payload.role, actorId)
    adminAudit(actorId, 'admin_user_role_changed', { targetUserId, role: payload.role, previousRole: target.role })
    return c.json({ user, ok: true })
  })

  app.put('/api/admin/users/:userId/token-quota', requireAuth, requireAdmin(), async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    const payload = z.object({
      period: z.enum(['day', 'month']).optional(),
      limitTokens: z.number().int().min(0),
      action: z.enum(['warn', 'block']).optional(),
      enabled: z.boolean().optional(),
    }).parse(await c.req.json().catch(() => ({})))

    if (!getUserById(targetUserId)) {
      return c.json({ message: '用户不存在' }, 404)
    }

    if (payload.limitTokens === 0) {
      clearTokenQuotaPolicy(targetUserId)
    } else {
      setTokenQuotaPolicy({
        userId: targetUserId,
        period: payload.period ?? 'month',
        limitTokens: payload.limitTokens,
        action: payload.action ?? 'block',
        enabled: payload.enabled ?? true,
        setBy: 'platform_admin',
      })
    }
    adminAudit(actorId, 'admin_user_token_quota_updated', { targetUserId, ...payload })
    return c.json({ ok: true, policy: getTokenQuotaPolicy(targetUserId) })
  })

  app.get('/api/admin/users/:userId/auth-events', requireAuth, requireAdmin(), async (c) => {
    const targetUserId = c.req.param('userId')
    const limit = z.coerce.number().int().min(1).max(200).parse(c.req.query('limit') || '50')
    return c.json({ authEvents: listAuthEventsByUser(targetUserId, limit) })
  })

  app.post('/api/admin/users/:userId/revoke-sessions', requireAuth, requireAdmin(), async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    if (!getUserById(targetUserId)) {
      return c.json({ message: '用户不存在' }, 404)
    }
    const count = await revokeAllUserSessions(targetUserId)
    adminAudit(actorId, 'admin_user_force_logout', { targetUserId })
    return c.json({ ok: true, revokedSessions: count })
  })

  app.put('/api/admin/users/:userId/note', requireAuth, requireAdmin(), async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const targetUserId = c.req.param('userId')
    const payload = z.object({
      note: z.string().max(2000),
      status: z.enum(['pending', 'in_progress', 'resolved']).optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const user = updateUserSupportNote(targetUserId, payload.note, payload.status, actorId)
    if (!user) {
      return c.json({ message: '用户不存在' }, 404)
    }
    adminAudit(actorId, 'admin_user_note_updated', { targetUserId, note: user.supportNote, status: user.supportNoteStatus })
    return c.json({ user, ok: true })
  })

  app.get('/api/admin/users/:userId/feedback', requireAuth, requireAdmin(), async (c) => {
    const targetUserId = c.req.param('userId')
    if (!getUserById(targetUserId)) {
      return c.json({ message: '用户不存在' }, 404)
    }
    const items = await listFeedbackItems({ userId: targetUserId, limit: 50 })
    return c.json({ feedback: items })
  })

  // ==========================================================================
  // 总账号体系（管理员设置）：仅 owner 可见
  // ==========================================================================

  const ACCOUNT_SYSTEM_META_KEY = 'settings:account-system'

  app.get('/api/admin/settings/account-system', requireAuth, requireAdmin('owner'), async (c) => {
    return c.json({
      settings: getMeta<{ openRegistration?: boolean; ownerEmail?: string }>(ACCOUNT_SYSTEM_META_KEY, {}),
      admins: listAdminAccounts(),
    })
  })

  app.put('/api/admin/settings/account-system', requireAuth, requireAdmin('owner'), async (c) => {
    const actorId = getUserIdFromHeader(c)!
    const payload = z.object({
      openRegistration: z.boolean().optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const current = getMeta<{ openRegistration?: boolean }>(ACCOUNT_SYSTEM_META_KEY, {})
    const next = { ...current, ...payload }
    saveMeta(ACCOUNT_SYSTEM_META_KEY, next)
    adminAudit(actorId, 'admin_account_system_updated', { ...payload })
    return c.json({ settings: next, ok: true })
  })

  app.get('/api/admin/admins', requireAuth, requireAdmin(), async (c) => {
    return c.json({ admins: listAdminAccounts() })
  })

  // 登录审计：auth_events 全站视图（admin）
  app.get('/api/admin/auth-events', requireAuth, requireAdmin(), async (c) => {
    const limit = z.coerce.number().int().min(1).max(200).parse(c.req.query('limit') || '50')
    return c.json({ authEvents: listRecentAuthEvents(limit) })
  })
}
