/**
 * [INPUT]: 已登录用户的项目成员管理请求（列表 / 拉人 / 移除 / 同组织候选）
 * [OUTPUT]: 项目成员 CRUD 路由；变更经 withState 广播，被拉入者 SSE 收到新 scoped state
 * [POS]: 私有项目「拉人可见」的成员管理入口（user_projects member 行）；可见性判定本身在 getScopedState / isProjectAccessible，此处不重复过滤
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  addUserProjectAndWait,
  getProjectMemberEntries,
  getUserById,
  getUserProjectIds,
  removeUserProjectAndWait,
} from '../repositories/auth'
import { listUserWorkspaces, listWorkspaceMembers } from '../repositories/workspace'
import { loadState } from '../storage/app-state-store'
import { getAuthorizedProject, getUserIdFromHeader, jsonError, withClusterState, withState } from './shared'

type ProjectOwnerView = {
  ownerId: string
  ownerEntry: { userId: string; accessType: 'owner' | 'member' } | null
}

/**
 * 项目所有者解析：user_projects 里的 owner 行优先；历史项目兜底 createdById（虚拟 owner，不落库）。
 */
export const resolveProjectOwner = (
  project: { createdById?: string },
  memberEntries: Array<{ userId: string; accessType: 'owner' | 'member' }>,
): ProjectOwnerView => {
  const ownerEntry = memberEntries.find((entry) => entry.accessType === 'owner') ?? null
  if (ownerEntry) {
    return { ownerId: ownerEntry.userId, ownerEntry }
  }
  const createdById = project.createdById?.trim() || ''
  return { ownerId: createdById, ownerEntry: null }
}

const addMemberSchema = z.object({
  userId: z.string().trim().min(1),
})

/** 与操作者共享至少一个组织的用户 id 集合（v1 拉人边界：仅同组织可见可拉） */
const listSharedOrgMemberIds = async (userId: string): Promise<Set<string>> => {
  const workspaces = await listUserWorkspaces(userId)
  const memberIds = new Set<string>()
  for (const workspace of workspaces) {
    for (const member of await listWorkspaceMembers(workspace.id)) {
      memberIds.add(member.id)
    }
  }
  return memberIds
}

export const registerProjectMemberRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/projects/:id/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(loadState(), userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const memberEntries = getProjectMemberEntries(projectId)
    const { ownerId } = resolveProjectOwner(projectResult.project, memberEntries)
    const seen = new Set<string>()
    const members = memberEntries
      .map((entry) => ({ ...entry, user: getUserById(entry.userId) }))
      .filter((entry): entry is { userId: string; accessType: 'owner' | 'member'; user: NonNullable<ReturnType<typeof getUserById>> } => Boolean(entry.user))
      .map(({ userId: memberUserId, accessType, user }) => {
        seen.add(memberUserId)
        return {
          userId: memberUserId,
          accessType,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl ?? undefined,
        }
      })
    if (ownerId && !seen.has(ownerId)) {
      const ownerUser = getUserById(ownerId)
      if (ownerUser) {
        members.unshift({
          userId: ownerUser.id,
          accessType: 'owner',
          name: ownerUser.name,
          email: ownerUser.email,
          avatarUrl: ownerUser.avatarUrl ?? undefined,
        })
      }
    }
    return c.json({ members })
  })

  app.get('/api/projects/:id/member-candidates', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const projectResult = getAuthorizedProject(loadState(), userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }
    const { ownerId } = resolveProjectOwner(projectResult.project, getProjectMemberEntries(projectId))
    if (ownerId !== userId) {
      return jsonError(c, '只有项目所有者可以管理成员。', 403)
    }

    const memberIds = new Set(getProjectMemberEntries(projectId).map((entry) => entry.userId))
    const sharedMemberIds = await listSharedOrgMemberIds(userId)
    const candidates = [...sharedMemberIds]
      .filter((candidateId) => candidateId !== userId && !memberIds.has(candidateId))
      .map((candidateId) => getUserById(candidateId))
      .filter((user): user is NonNullable<ReturnType<typeof getUserById>> => Boolean(user))
      .map((resolved) => ({
        userId: resolved.id,
        name: resolved.name,
        email: resolved.email,
        avatarUrl: resolved.avatarUrl ?? undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return c.json({ candidates })
  })

  app.post('/api/projects/:id/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }
    const memberEntries = getProjectMemberEntries(projectId)
    const { ownerId } = resolveProjectOwner(projectResult.project, memberEntries)
    if (!ownerId || ownerId !== userId) {
      return jsonError(c, '只有项目所有者可以管理成员。', 403)
    }

    const payload = addMemberSchema.parse(await c.req.json().catch(() => ({})))
    if (!getUserById(payload.userId)) {
      return jsonError(c, '目标用户不存在。', 404)
    }
    if (payload.userId === userId) {
      return jsonError(c, '不能把自己加为成员。', 400)
    }
    if (getUserProjectIds(payload.userId).includes(projectId)) {
      return jsonError(c, '该用户已在项目中。', 400)
    }
    const sharedMemberIds = await listSharedOrgMemberIds(userId)
    if (!sharedMemberIds.has(payload.userId)) {
      return jsonError(c, '仅能分享给与你同组织的成员。', 403)
    }

    await addUserProjectAndWait(payload.userId, projectId, 'member')
    const target = getUserById(payload.userId)
    return c.json(await withState(
      withClusterState(state),
      `已把 ${target?.name || '成员'} 拉入项目。`,
      userId,
    ))
  })

  app.delete('/api/projects/:id/members/:memberUserId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const memberUserId = c.req.param('memberUserId').trim()
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }
    const memberEntries = getProjectMemberEntries(projectId)
    const { ownerId } = resolveProjectOwner(projectResult.project, memberEntries)
    if (!ownerId || ownerId !== userId) {
      return jsonError(c, '只有项目所有者可以管理成员。', 403)
    }
    if (memberUserId === ownerId) {
      return jsonError(c, '不能移除项目所有者。', 400)
    }
    if (!memberEntries.some((entry) => entry.userId === memberUserId && entry.accessType === 'member')) {
      return jsonError(c, '该用户不是项目成员。', 404)
    }

    await removeUserProjectAndWait(memberUserId, projectId)
    const target = getUserById(memberUserId)
    return c.json(await withState(
      withClusterState(state),
      `已移除成员 ${target?.name || ''}。`,
      userId,
    ))
  })
}
