// [INPUT]: 用量统计请求（当前用户 / 用户 Agent / 团队成员）。
// [OUTPUT]: 多维 token 用量汇总（个人、Agent、团队视角）。
// [POS]: usage API 路由；权限上用户只能看自己，团队 owner/admin 可看成员。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { Hono, MiddlewareHandler } from 'hono'
import type { UsageEventRecord } from '@shared/usage-events'
import { getTeamMemberRole, getTeamMembers, getUserTeams } from '../repositories/auth'
import { getAgent, getAllAgents, getUserAgents, updateAgent } from '../repositories/agent'
import { isCustomAgentEnabled, readCustomAgentConfig } from '@shared/custom-agent'
import { resolveUsagePeriod, summarizeUsageEvents, type UsageSummary } from '../services/usage-summary-service'
import { listUsageEvents } from '../services/usage-event-service'
import { buildTokenQuotaSnapshot, clearTokenQuotaPolicy, getTokenQuotaPolicy, isQuotaManagedByAdmin, setTokenQuotaPolicy, type TokenQuotaAction, type TokenQuotaPeriod } from '../services/token-quota-service'
import { getTeamModelPolicyView, setTeamModelPolicy } from '../services/team-model-policy-service'
import { getWorkspace } from '../storage/distributed-task-store'
import { getUserIdFromHeader } from './shared'

const isTeamAdmin = (role: string | null) => role === 'owner' || role === 'admin'

/** 给 byWorkspace 聚合补上工作区名称，便于看板按工作区辨识。 */
const attachWorkspaceNames = (summary: UsageSummary): UsageSummary => {
  if (summary.byWorkspace.length === 0) {
    return summary
  }
  return {
    ...summary,
    byWorkspace: summary.byWorkspace.map((row) => ({
      ...row,
      workspaceName: row.workspaceId ? getWorkspace(row.workspaceId)?.name ?? null : null,
    })),
  }
}

const resolveMyTeamAdminView = (userId: string) => {
  const teams = getUserTeams(userId)
  const adminTeam = teams.find((team) => isTeamAdmin(getTeamMemberRole(team.id, userId)))
  return adminTeam ?? null
}

export const registerUsageRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/usage/summary', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const period = resolveUsagePeriod(c.req.query('period'))
    const events = await listUsageEvents({ userId })
    return c.json({
      ok: true,
      period,
      summary: attachWorkspaceNames(summarizeUsageEvents(events, period)),
    })
  })

  app.get('/api/usage/agents', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const period = resolveUsagePeriod(c.req.query('period'))
    const ownedAgentIds = new Set(getUserAgents(userId).map((agent) => agent.id))
    // 保留两类事件：用户自己的 Agent 实体执行；以及未绑定 Agent 实体的执行
    // （工作区 coding agent / 分布式任务 / 默认 Agent 聊天，无 agentId，按 agentName 聚合）。
    const events = (await listUsageEvents({ userId }))
      .filter((event) => !event.agentId || ownedAgentIds.has(event.agentId))
    return c.json({
      ok: true,
      period,
      summary: attachWorkspaceNames(summarizeUsageEvents(events, period)),
    })
  })

  app.get('/api/usage/team', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const requestedTeamId = c.req.query('teamId')?.trim() || resolveMyTeamAdminView(userId)?.id
    if (!requestedTeamId) {
      return c.json({ ok: false, message: '你不是任何团队的 owner/admin，无法查看团队用量。' }, 403)
    }
    const role = getTeamMemberRole(requestedTeamId, userId)
    if (!isTeamAdmin(role)) {
      return c.json({ ok: false, message: '仅团队 owner/admin 可查看成员用量。' }, 403)
    }

    const period = resolveUsagePeriod(c.req.query('period'))
    const members = getTeamMembers(requestedTeamId)
    const memberIds = members.map((member) => member.id)
    const events = await listUsageEvents({ userIds: memberIds })
    const summary = summarizeUsageEvents(events, period)

    return c.json({
      ok: true,
      teamId: requestedTeamId,
      period,
      summary: attachWorkspaceNames(summary),
      members: await buildTeamMemberUsage(members, events, period),
    })
  })

  // 协作区管理员：设置 / 关闭成员 token 配额
  app.put('/api/usage/team/member-quota', requireAuth, async (c) => {
    const actorId = getUserIdFromHeader(c)
    if (!actorId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const body = await c.req.json().catch(() => null) as {
      teamId?: unknown
      userId?: unknown
      period?: unknown
      limitTokens?: unknown
      action?: unknown
    } | null
    const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : ''
    const targetUserId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!teamId || !targetUserId) {
      return c.json({ ok: false, message: 'teamId 与 userId 必填。' }, 400)
    }
    if (!isTeamAdmin(getTeamMemberRole(teamId, actorId))) {
      return c.json({ ok: false, message: '仅协作区 owner/admin 可管理成员配额。' }, 403)
    }
    if (!getTeamMembers(teamId).some((member) => member.id === targetUserId)) {
      return c.json({ ok: false, message: '目标用户不是本协作区成员。' }, 400)
    }
    const period = body?.period === 'day' || body?.period === 'month' ? body.period as TokenQuotaPeriod : 'month'
    const action = body?.action === 'warn' || body?.action === 'block' ? body.action as TokenQuotaAction : 'block'
    const limitTokens = typeof body?.limitTokens === 'number' && Number.isFinite(body.limitTokens)
      ? Math.round(body.limitTokens)
      : Number(body?.limitTokens)
    if (!Number.isFinite(limitTokens) || limitTokens < 0) {
      return c.json({ ok: false, message: '配额上限必须是非负整数。' }, 400)
    }
    if (limitTokens === 0) {
      clearTokenQuotaPolicy(targetUserId)
      return c.json({ ok: true, message: '已关闭该成员 token 配额。', quota: await buildTokenQuotaSnapshot(targetUserId) })
    }
    setTokenQuotaPolicy({ userId: targetUserId, period, limitTokens, action, setBy: 'team_admin' })
    return c.json({ ok: true, message: '成员配额已更新。', quota: await buildTokenQuotaSnapshot(targetUserId) })
  })

  // 协作区管理员：团队 Agent 列表（团队成员拥有的 Agent + 团队执行用量）
  app.get('/api/usage/team/agents', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const teamId = c.req.query('teamId')?.trim()
    if (!teamId) {
      return c.json({ ok: false, message: 'teamId 必填。' }, 400)
    }
    if (!isTeamAdmin(getTeamMemberRole(teamId, userId))) {
      return c.json({ ok: false, message: '仅协作区 owner/admin 可管理团队 Agent。' }, 403)
    }
    const period = resolveUsagePeriod(c.req.query('period'))
    const members = getTeamMembers(teamId)
    const memberIds = new Set(members.map((member) => member.id))
    const agents = getAllAgents().filter((agent) => agent.ownerUserId && memberIds.has(agent.ownerUserId))
    const events = await listUsageEvents({ userIds: [...memberIds] })
    const usageByAgentId = new Map<string, { runCount: number; totalTokens: number }>()
    for (const event of events) {
      if (!event.agentId) {
        continue
      }
      const row = usageByAgentId.get(event.agentId) ?? { runCount: 0, totalTokens: 0 }
      row.runCount += 1
      row.totalTokens += event.totalTokens
      usageByAgentId.set(event.agentId, row)
    }
    const ownerNameById = new Map(members.map((member) => [member.id, member.name]))
    return c.json({
      ok: true,
      teamId,
      period,
      agents: agents.map((agent) => {
        const profile = readCustomAgentConfig(agent.config)
        const usage = usageByAgentId.get(agent.id)
        return {
          agentId: agent.id,
          name: agent.name,
          ownerUserId: agent.ownerUserId,
          ownerName: agent.ownerUserId ? ownerNameById.get(agent.ownerUserId) ?? null : null,
          enabled: isCustomAgentEnabled(profile),
          status: agent.status,
          runCount: usage?.runCount ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
        }
      }).sort((left, right) => right.totalTokens - left.totalTokens),
    })
  })

  // 协作区管理员：启停团队 Agent（Agent 仍归成员所有，管理员只做治理）
  app.put('/api/usage/team/agents/:agentId/enabled', requireAuth, async (c) => {
    const actorId = getUserIdFromHeader(c)
    if (!actorId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const teamId = c.req.query('teamId')?.trim()
    const agentId = c.req.param('agentId')?.trim()
    if (!teamId || !agentId) {
      return c.json({ ok: false, message: 'teamId 与 agentId 必填。' }, 400)
    }
    if (!isTeamAdmin(getTeamMemberRole(teamId, actorId))) {
      return c.json({ ok: false, message: '仅协作区 owner/admin 可管理团队 Agent。' }, 403)
    }
    const body = await c.req.json().catch(() => null) as { enabled?: unknown } | null
    const enabled = body?.enabled === true
    const agent = getAgent(agentId)
    if (!agent) {
      return c.json({ ok: false, message: 'Agent 不存在。' }, 404)
    }
    if (!agent.ownerUserId || !getTeamMembers(teamId).some((member) => member.id === agent.ownerUserId)) {
      return c.json({ ok: false, message: '该 Agent 不属于本协作区成员。' }, 400)
    }
    const config = { ...(agent.config ?? {}) }
    config.enabled = enabled
    const updated = updateAgent(agentId, {
      name: agent.name,
      type: agent.type,
      endpoint: agent.endpoint,
      config,
    })
    return c.json({
      ok: true,
      agentId,
      enabled: updated ? isCustomAgentEnabled(readCustomAgentConfig(updated.config)) : enabled,
    })
  })

  app.get('/api/usage/team/models', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const teamId = c.req.query('teamId')?.trim()
    if (!teamId) {
      return c.json({ ok: false, message: 'teamId 必填。' }, 400)
    }
    if (!isTeamAdmin(getTeamMemberRole(teamId, userId))) {
      return c.json({ ok: false, message: '仅协作区 owner/admin 可管理模型白名单。' }, 403)
    }
    return c.json({ ok: true, teamId, policy: getTeamModelPolicyView(teamId) })
  })

  // 协作区管理员：设置团队模型白名单（null/空数组 = 关闭不限）
  app.put('/api/usage/team/models', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    const body = await c.req.json().catch(() => null) as {
      teamId?: unknown
      allowedModelIds?: unknown
    } | null
    const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : ''
    if (!teamId) {
      return c.json({ ok: false, message: 'teamId 必填。' }, 400)
    }
    if (!isTeamAdmin(getTeamMemberRole(teamId, userId))) {
      return c.json({ ok: false, message: '仅协作区 owner/admin 可管理模型白名单。' }, 403)
    }
    const allowedModelIds = Array.isArray(body?.allowedModelIds)
      ? body.allowedModelIds.filter((id): id is string => typeof id === 'string')
      : null
    return c.json({ ok: true, teamId, policy: setTeamModelPolicy(teamId, allowedModelIds) })
  })

  app.get('/api/usage/quota', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    return c.json({
      ok: true,
      quota: await buildTokenQuotaSnapshot(userId),
    })
  })

  app.put('/api/usage/quota', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ ok: false, message: '未登录' }, 401)
    }
    // 配额被协作区/平台管理员管理后，用户自设入口锁定，防止绕过治理。
    if (isQuotaManagedByAdmin(getTokenQuotaPolicy(userId))) {
      return c.json({ ok: false, message: '你的 token 配额由管理员统一管理，无法自行修改。请联系管理员调整。' }, 409)
    }
    const body = await c.req.json().catch(() => null) as {
      period?: unknown
      limitTokens?: unknown
      action?: unknown
    } | null
    const period = body?.period === 'day' || body?.period === 'month' ? body.period as TokenQuotaPeriod : 'month'
    const action = body?.action === 'warn' || body?.action === 'block' ? body.action as TokenQuotaAction : 'block'
    const limitTokens = typeof body?.limitTokens === 'number' && Number.isFinite(body.limitTokens)
      ? Math.round(body.limitTokens)
      : Number(body?.limitTokens)
    if (!Number.isFinite(limitTokens) || limitTokens < 0) {
      return c.json({ ok: false, message: '配额上限必须是非负整数。' }, 400)
    }
    if (limitTokens === 0) {
      clearTokenQuotaPolicy(userId)
      return c.json({ ok: true, message: '已关闭 token 配额。', quota: await buildTokenQuotaSnapshot(userId) })
    }
    setTokenQuotaPolicy({ userId, period, limitTokens, action })
    return c.json({ ok: true, message: '配额已更新。', quota: await buildTokenQuotaSnapshot(userId) })
  })
}

const buildTeamMemberUsage = async (
  members: Array<{ id: string; name: string; role?: string }>,
  events: UsageEventRecord[],
  period: '7d' | '30d' | 'all',
) => {
  const now = Date.now()
  const cutoff = period === 'all' ? 0 : now - (period === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000
  // 全量成员（含无用量记录的成员），便于管理员查看/预设配额
  const rows = new Map<string, { userId: string; userName: string; role: string | undefined; runCount: number; totalTokens: number }>(
    members.map((member) => [member.id, {
      userId: member.id,
      userName: member.name,
      role: member.role,
      runCount: 0,
      totalTokens: 0,
    }]),
  )

  for (const event of events) {
    const at = Date.parse(event.createdAt)
    if (Number.isFinite(at) && at < cutoff) {
      continue
    }
    const row = rows.get(event.userId)
    if (!row) {
      continue
    }
    row.runCount += 1
    row.totalTokens += event.totalTokens
  }

  // 团队 owner/admin 视角：附上每个成员的配额快照（复用 buildTokenQuotaSnapshot 口径）
  const rowsWithQuota = await Promise.all([...rows.values()].map(async (row) => ({
    ...row,
    quota: await buildTokenQuotaSnapshot(row.userId),
  })))

  return rowsWithQuota.sort((left, right) => right.totalTokens - left.totalTokens)
}

export type { UsageSummary }

