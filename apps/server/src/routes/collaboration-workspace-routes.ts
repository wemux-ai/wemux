// [INPUT]: 已鉴权 Hono app，协作工作区与成员请求
// [OUTPUT]: /api/collab/workspaces* 路由
// [POS]: 协作工作区（多成员/群聊）HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { createTeam, createTeamAndWait, isTeamAdmin, updateTeam, updateTeamAndWait } from '../repositories/auth'
import { isWorkspaceMember, listUserWorkspaces, listWorkspaceMembers } from '../repositories/workspace'
import {
  buildMyContextOverview,
  buildWorkspaceBrainOverview,
  canManageWorkspaceBrain,
  getWorkspaceBrainConfig,
  listWorkspaceBrainFiles,
  resolveWorkspaceBrainBillingAccess,
  saveWorkspaceBrainConfig,
  setWorkspaceBrainFile,
} from '../services/workspace-brain-service'
import { provisionWorkspaceResourcesFromSourceWorkspace } from '../services/workspace-resource-provisioning-service'
import {
  addWorkspaceGroupMember,
  createWorkspaceGroup,
  deleteWorkspaceGroup,
  listWorkspaceGroups,
  removeWorkspaceGroupMember,
  renameWorkspaceGroup,
} from '../storage/postgres/workspace-group-store'
import { getUserIdFromHeader, publishState } from './shared'
import { loadState } from '../storage/app-state-store'
import { getCommercialGate } from '../services/gate/commercial-gate'

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1),
  sourceWorkspaceId: z.string().trim().optional(),
})

const brainConfigSchema = z.object({
  enabled: z.boolean().optional(),
  brainAgentId: z.string().trim().min(1).optional(),
  brainInstructions: z.string().trim().max(8000).optional(),
})

export const registerCollaborationWorkspaceRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/collab/workspaces', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    return c.json({ workspaces: await listUserWorkspaces(userId) })
  })

  app.post('/api/collab/workspaces', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = createWorkspaceSchema.parse(await c.req.json().catch(() => ({})))
    const quotaAccess = await getCommercialGate().resolveFreeWorkspaceQuotaAccess(userId)
    if (!quotaAccess.allowed) {
      return c.json({ message: quotaAccess.message, billingQuotaAccess: quotaAccess }, 429)
    }
    const team = await createTeamAndWait(payload.name, userId)
    await provisionWorkspaceResourcesFromSourceWorkspace({
      ownerUserId: userId,
      sourceWorkspaceId: payload.sourceWorkspaceId,
      targetWorkspaceId: team.id,
    })
    getCommercialGate().recordFreeWorkspaceCreation(userId, team.id, team.createdAt)
    publishState(loadState())

    return c.json({
      workspace: {
        id: team.id,
        name: team.name,
        description: team.description,
        avatarUrl: team.avatarUrl,
        ownerUserId: userId,
        legacyTeamId: team.id,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
      message: 'Workspace 已创建。',
    }, 201)
  })

  app.put('/api/collab/workspaces/:workspaceId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!isTeamAdmin(workspaceId, userId)) {
      return c.json({ message: '无权限修改这个组织。' }, 403)
    }

    const payload = createWorkspaceSchema.parse(await c.req.json().catch(() => ({})))
    const team = await updateTeamAndWait(workspaceId, { name: payload.name })
    if (!team) {
      return c.json({ message: '组织不存在。' }, 404)
    }
    publishState(loadState())

    return c.json({
      workspace: {
        id: team.id,
        name: team.name,
        description: team.description,
        avatarUrl: team.avatarUrl,
        ownerUserId: userId,
        legacyTeamId: team.id,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
      message: '组织名称已更新。',
    })
  })

  app.get('/api/collab/workspaces/:workspaceId/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }

    return c.json({ members: await listWorkspaceMembers(workspaceId) })
  })

  // —— 空间内分组（P2）：成员按组分栏（人 + Agent 混合）——
  app.get('/api/collab/workspaces/:workspaceId/groups', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    return c.json({ groups: await listWorkspaceGroups(workspaceId) })
  })

  app.post('/api/collab/workspaces/:workspaceId/groups', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    const payload = z.object({ name: z.string().trim().min(1).max(40) }).parse(await c.req.json().catch(() => ({})))
    const group = await createWorkspaceGroup({ workspaceId, name: payload.name })
    if (!group) {
      return c.json({ message: '分组已存在。' }, 400)
    }
    return c.json({ group, message: '分组已创建。' }, 201)
  })

  app.put('/api/collab/workspaces/:workspaceId/groups/:groupId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const groupId = c.req.param('groupId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    const payload = z.object({ name: z.string().trim().min(1).max(40) }).parse(await c.req.json().catch(() => ({})))
    const group = await renameWorkspaceGroup(groupId, payload.name)
    if (!group) {
      return c.json({ message: '分组不存在。' }, 404)
    }
    return c.json({ group, message: '分组已更新。' })
  })

  app.delete('/api/collab/workspaces/:workspaceId/groups/:groupId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const groupId = c.req.param('groupId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    const ok = await deleteWorkspaceGroup(groupId)
    if (!ok) {
      return c.json({ message: '分组不存在。' }, 404)
    }
    return c.json({ ok: true, message: '分组已删除。' })
  })

  app.post('/api/collab/workspaces/:workspaceId/groups/:groupId/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const groupId = c.req.param('groupId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    const payload = z.object({
      memberType: z.enum(['user', 'agent']),
      memberId: z.string().trim().min(1),
    }).parse(await c.req.json().catch(() => ({})))

    // 成员校验：user 必须是空间成员；agent 必须存在。
    if (payload.memberType === 'user') {
      const members = await listWorkspaceMembers(workspaceId)
      if (!members.some((member) => member.id === payload.memberId)) {
        return c.json({ message: '该用户不是空间成员。' }, 400)
      }
    }
    const row = await addWorkspaceGroupMember({ groupId, memberType: payload.memberType, memberId: payload.memberId })
    return c.json({ ok: true, added: Boolean(row), message: row ? '成员已加入分组。' : '成员已在分组中。' })
  })

  app.delete('/api/collab/workspaces/:workspaceId/groups/:groupId/members/:memberType/:memberId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const groupId = c.req.param('groupId')
    const memberType = c.req.param('memberType')
    const memberId = c.req.param('memberId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    if (memberType !== 'user' && memberType !== 'agent') {
      return c.json({ message: '成员类型无效。' }, 400)
    }
    const ok = await removeWorkspaceGroupMember({ groupId, memberType, memberId })
    return c.json({ ok, message: ok ? '成员已移出分组。' : '成员不在分组中。' })
  })

  // —— 调度大脑（feature）：协作空间级配置读写 + 计费门控 ——
  app.get('/api/collab/workspaces/:workspaceId/brain', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    const config = await getWorkspaceBrainConfig(workspaceId)
    if (!config) {
      return c.json({ message: '组织不存在。' }, 404)
    }
    const billing = await resolveWorkspaceBrainBillingAccess({ userId, teamId: workspaceId })
    return c.json({ config, billing })
  })

  app.put('/api/collab/workspaces/:workspaceId/brain', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await canManageWorkspaceBrain(workspaceId, userId))) {
      return c.json({ message: '只有组织 owner/admin 可以修改调度大脑配置。' }, 403)
    }
    const payload = brainConfigSchema.parse(await c.req.json().catch(() => ({})))
    const billing = await resolveWorkspaceBrainBillingAccess({ userId, teamId: workspaceId })
    if (billing.enforcementEnabled && billing.requiresPaid && !billing.allowed) {
      return c.json({ message: billing.message, billing }, 402)
    }
    const ok = await saveWorkspaceBrainConfig(workspaceId, payload)
    if (!ok) {
      return c.json({ message: '组织不存在。' }, 404)
    }
    const config = await getWorkspaceBrainConfig(workspaceId)
    return c.json({ config, billing, message: '调度大脑配置已更新。' })
  })

  // 云盘文件纳入大脑上下文（P0）
  app.get('/api/collab/workspaces/:workspaceId/brain/files', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    return c.json({ files: await listWorkspaceBrainFiles(workspaceId) })
  })

  // 大脑只读视图聚合（P1）：事件流 + 持续摘要 + 分发记录 + 已纳入文件
  app.get('/api/collab/workspaces/:workspaceId/brain/overview', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    return c.json(await buildWorkspaceBrainOverview(workspaceId))
  })

  // 大脑个人上下文聚合（P3）：我的云盘 + 我参与的时间线 + 我关心的待办
  app.get('/api/collab/workspaces/:workspaceId/brain/my-context', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await isWorkspaceMember(workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }
    return c.json(await buildMyContextOverview({ userId, workspaceId }))
  })

  app.put('/api/collab/workspaces/:workspaceId/brain/files/:fileId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const fileId = c.req.param('fileId')
    const payload = z.object({ enabled: z.boolean() }).parse(await c.req.json().catch(() => ({})))
    const result = await setWorkspaceBrainFile({ workspaceId, fileId, enabled: payload.enabled, userId })
    if (!result.ok) {
      return c.json({ message: result.message }, 400)
    }
    return c.json({ files: await listWorkspaceBrainFiles(workspaceId), message: result.message })
  })
}
