// [INPUT]: 已鉴权 Hono app，技能扫描/导入/管理请求
// [OUTPUT]: /api/skills* 路由（scan/import/files/CRUD）
// [POS]: Skill 目录 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { isManagedSystemSkill } from '@shared/skill'
import { isWorkspaceResourceVisible } from '@shared/workspace-scope'
import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { SkillSlugConflictError, deleteSkill, getSkill, listSkills, listSkillVersions, readSkillFile, updateSkill, updateSkillFile, createSkill } from '../repositories/skill'
import { loadState } from '../storage/app-state-store'
import { ensureTeamMember, ensureWorkspaceMember, getScopedState, getUserIdFromHeader, jsonError } from './shared'
import { importSkillFromDownload, importSkillsFromGit, scanGlobalSkills, scanProjectSkills } from '../services/skill-service'
import { syncSkillToProvisionedWorkspaces } from '../services/workspace-resource-provisioning-service'

const skillVisibilitySchema = z.enum(['private', 'workspace']).default('private')

const createSkillSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  description: z.string().trim().optional(),
  markdown: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  visibility: skillVisibilitySchema.optional(),
  workspaceId: z.string().trim().optional(),
})

const updateSkillSchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().optional(),
  description: z.string().trim().optional(),
  markdown: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  visibility: skillVisibilitySchema.optional(),
  workspaceId: z.string().trim().optional(),
})

const updateSkillFileSchema = z.object({
  path: z.string().trim().min(1),
  content: z.string(),
})

const scanSkillSchema = z.object({
  scope: z.enum(['project', 'global']).optional(),
  executorId: z.string().trim().optional(),
  projectIds: z.array(z.string().trim().min(1)).optional(),
})

const importSkillSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('git'),
    url: z.string().trim().min(1),
    ref: z.string().trim().optional(),
    subdirectory: z.string().trim().optional(),
  }),
  z.object({
    mode: z.literal('download'),
    url: z.string().trim().min(1),
  }),
])

const canReadSkill = (params: {
  skill: NonNullable<ReturnType<typeof getSkill>>
  userId: string
  scopedProjectIds: Set<string>
}) => {
  const { skill, userId, scopedProjectIds } = params
  if (skill.sourceType === 'project') {
    return Boolean(skill.sourceRef && scopedProjectIds.has(skill.sourceRef))
  }

  if (!skill.ownerUserId || skill.ownerUserId === userId) {
    return true
  }

  const workspaceId = skill.workspaceId?.trim() || ''
  return skill.visibility === 'workspace'
    && Boolean(workspaceId)
    && ensureTeamMember(workspaceId, userId)
}

const canManageSkill = (skill: NonNullable<ReturnType<typeof getSkill>>, userId: string) => {
  if (isManagedSystemSkill(skill)) {
    return false
  }

  return !skill.ownerUserId || skill.ownerUserId === userId
}

export const registerSkillRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/skills', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.query('workspaceId')?.trim() || ''
    const scopedProjectIds = new Set(getScopedState(loadState(), userId).projects.map((project) => project.id))
    const skills = listSkills()
      .filter((skill) => canReadSkill({ skill, userId, scopedProjectIds }))
      .filter((skill) => !workspaceId || skill.sourceType === 'project' || isWorkspaceResourceVisible(skill, { userId, workspaceId }))

    return c.json({ skills })
  })

  app.post('/api/skills/scan', requireAuth, async (c) => {
    const payload = scanSkillSchema.parse(await c.req.json().catch(() => ({})))
    const userId = getUserIdFromHeader(c)!
    const result = payload.scope === 'global'
      ? await scanGlobalSkills(userId, {
          preferredExecutorId: payload.executorId,
        })
      : await Promise.resolve().then(() => {
          const scopedState = getScopedState(loadState(), userId)
          const selectedProjects = payload.projectIds?.length
            ? scopedState.projects.filter((project) => payload.projectIds?.includes(project.id))
            : scopedState.projects

          return scanProjectSkills(selectedProjects, userId, {
            preferredExecutorId: payload.executorId,
          })
        })
    return c.json(result)
  })

  app.post('/api/skills/import', requireAuth, async (c) => {
    const payload = importSkillSchema.parse(await c.req.json())
    const result = payload.mode === 'git'
      ? await importSkillsFromGit({
          url: payload.url,
          ref: payload.ref,
          subdirectory: payload.subdirectory,
        })
      : await importSkillFromDownload({ url: payload.url })

    return c.json(result)
  })

  app.get('/api/skills/:id', requireAuth, async (c) => {
    const skill = getSkill(c.req.param('id'))
    if (!skill) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    const userId = getUserIdFromHeader(c)!
    const scopedProjectIds = new Set(getScopedState(loadState(), userId).projects.map((project) => project.id))
    if (!canReadSkill({ skill, userId, scopedProjectIds })) {
      return jsonError(c, '无权访问这个 Skill。', 403)
    }

    return c.json({ skill })
  })

  app.get('/api/skills/:id/files', requireAuth, async (c) => {
    const skill = getSkill(c.req.param('id'))
    if (!skill) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    const userId = getUserIdFromHeader(c)!
    const scopedProjectIds = new Set(getScopedState(loadState(), userId).projects.map((project) => project.id))
    if (!canReadSkill({ skill, userId, scopedProjectIds })) {
      return jsonError(c, '无权访问这个 Skill。', 403)
    }

    const file = readSkillFile(c.req.param('id'), c.req.query('path') ?? 'SKILL.md')
    if (!file) {
      return jsonError(c, 'Skill 文件不存在。', 404)
    }

    return c.json(file)
  })

  app.post('/api/skills', requireAuth, async (c) => {
    const payload = createSkillSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const visibility = payload.visibility ?? 'private'
    const workspaceId = payload.workspaceId?.trim() || undefined
    if (visibility === 'workspace') {
      if (!workspaceId) {
        return jsonError(c, '共享到组织时必须选择组织。', 400)
      }
      if (!(await ensureWorkspaceMember(workspaceId, userId))) {
        return jsonError(c, '你不是该组织成员，不能共享这个 Skill。', 403)
      }
    }

    let skill
    try {
      skill = createSkill({
        name: payload.name,
        slug: payload.slug,
        description: payload.description,
        markdown: payload.markdown?.trim() || `# ${payload.name}\n\n请补充这个 skill 的使用说明。`,
        enabled: payload.enabled ?? true,
        visibility,
        ownerUserId: visibility === 'workspace' ? userId : null,
        workspaceId: visibility === 'workspace' ? workspaceId ?? null : null,
        sourceType: 'manual',
        compatibility: 'compatible',
        trustLevel: 'markdown_only',
      })
    } catch (error) {
      if (error instanceof SkillSlugConflictError) {
        return jsonError(c, error.message, 409)
      }
      throw error
    }
    await syncSkillToProvisionedWorkspaces({
      ownerUserId: userId,
      sourceWorkspaceId: visibility === 'workspace' ? workspaceId : undefined,
      skillId: skill.id,
    })

    return c.json({ skill }, 201)
  })

  app.put('/api/skills/:id', requireAuth, async (c) => {
    const payload = updateSkillSchema.parse(await c.req.json())
    const existing = getSkill(c.req.param('id'))
    if (!existing) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    const userId = getUserIdFromHeader(c)!
    if (!canManageSkill(existing, userId)) {
      if (isManagedSystemSkill(existing)) {
        return jsonError(c, '系统官方 Skill 不能直接修改。', 403)
      }
      return jsonError(c, '只有创建者可以修改这个 Skill。', 403)
    }

    const visibility = payload.visibility ?? existing.visibility
    const workspaceId = payload.workspaceId !== undefined
      ? (payload.workspaceId.trim() || undefined)
      : (existing.workspaceId || undefined)
    if (visibility === 'workspace') {
      if (!workspaceId) {
        return jsonError(c, '共享到组织时必须选择组织。', 400)
      }
      if (!(await ensureWorkspaceMember(workspaceId, userId))) {
        return jsonError(c, '你不是该组织成员，不能共享这个 Skill。', 403)
      }
    }

    let skill
    try {
      skill = updateSkill(c.req.param('id'), {
        ...payload,
        visibility,
        ownerUserId: existing.ownerUserId || userId,
        workspaceId: visibility === 'workspace' ? workspaceId ?? null : null,
      })
    } catch (error) {
      if (error instanceof SkillSlugConflictError) {
        return jsonError(c, error.message, 409)
      }
      throw error
    }
    if (!skill) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    return c.json({ skill })
  })

  app.patch('/api/skills/:id/files', requireAuth, async (c) => {
    const payload = updateSkillFileSchema.parse(await c.req.json())
    const existing = getSkill(c.req.param('id'))
    if (!existing) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    const userId = getUserIdFromHeader(c)!
    if (!canManageSkill(existing, userId)) {
      if (isManagedSystemSkill(existing)) {
        return jsonError(c, '系统官方 Skill 不能直接修改。', 403)
      }
      return jsonError(c, '只有创建者可以修改这个 Skill。', 403)
    }

    const file = updateSkillFile(c.req.param('id'), payload.path, payload.content)
    if (!file) {
      return jsonError(c, 'Skill 文件不存在。', 404)
    }

    return c.json(file)
  })

  app.delete('/api/skills/:id', requireAuth, async (c) => {
    const existing = getSkill(c.req.param('id'))
    if (!existing) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    const userId = getUserIdFromHeader(c)!
    if (!canManageSkill(existing, userId)) {
      if (isManagedSystemSkill(existing)) {
        return jsonError(c, '系统官方 Skill 不能直接删除。', 403)
      }
      return jsonError(c, '只有创建者可以删除这个 Skill。', 403)
    }

    const deleted = deleteSkill(c.req.param('id'))
    if (!deleted) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    return c.json({ ok: true })
  })

  app.get('/api/skills/:id/versions', requireAuth, async (c) => {
    const skill = getSkill(c.req.param('id'))
    if (!skill) {
      return jsonError(c, 'Skill 不存在。', 404)
    }

    const versions = await listSkillVersions(c.req.param('id'))
    return c.json({ ok: true, versions })
  })
}
