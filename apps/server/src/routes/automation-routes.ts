// [INPUT]: 已鉴权 Hono app，自动化/触发器/运行请求体（Zod schema）
// [OUTPUT]: /api/projects/:projectId/automations、/api/automations/:id、/api/automation-triggers/:id 等 CRUD/触发/运行路由
// [POS]: 自动化 HTTP 协议层（CRUD/触发/运行）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { automationService } from '../services/automation-service'
import {
  automationRunSchema,
  automationSchema,
  automationTriggerSchema,
  automationTriggerUpdateSchema,
  automationUpdateSchema,
  getAuthorizedProject,
  getUserIdFromHeader,
  jsonError,
} from './shared'
import { loadState } from '../storage/app-state-store'

const getAuthorizedAutomation = (userId: string, automationId: string) => {
  const detail = automationService.getDetail(automationId)
  if (!detail) {
    return { automation: null, project: null, status: 404 as const, message: '自动化不存在。' }
  }

  const state = loadState()
  const projectResult = getAuthorizedProject(state, userId, detail.projectId)
  if (!projectResult.project) {
    return { automation: null, project: null, status: projectResult.status, message: projectResult.message }
  }

  return { automation: detail, project: projectResult.project, status: 200 as const, message: '' }
}

export const registerAutomationRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/projects/:projectId/automations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectId = c.req.param('projectId')
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    return c.json({ automations: automationService.listByProject(projectId) })
  })

  app.post('/api/projects/:projectId/automations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectId = c.req.param('projectId')
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const payload = automationSchema.parse(await c.req.json())
    const automation = automationService.create(projectResult.project, userId, payload)
    return c.json({ automation }, 201)
  })

  app.get('/api/automations/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const result = getAuthorizedAutomation(userId, c.req.param('id'))
    if (!result.automation) {
      return jsonError(c, result.message, result.status)
    }

    return c.json({ automation: result.automation })
  })

  app.patch('/api/automations/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const result = getAuthorizedAutomation(userId, c.req.param('id'))
    if (!result.automation) {
      return jsonError(c, result.message, result.status)
    }

    const payload = automationUpdateSchema.parse(await c.req.json())
    const automation = automationService.update(result.automation.id, payload)
    return c.json({ automation })
  })

  app.get('/api/automations/:id/runs', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const result = getAuthorizedAutomation(userId, c.req.param('id'))
    if (!result.automation) {
      return jsonError(c, result.message, result.status)
    }

    return c.json({ runs: result.automation.runs })
  })

  app.post('/api/automations/:id/run', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const result = getAuthorizedAutomation(userId, c.req.param('id'))
    if (!result.automation) {
      return jsonError(c, result.message, result.status)
    }

    const payload = automationRunSchema.parse(await c.req.json())
    const run = await automationService.runNow(result.automation.id, payload)
    return c.json({ run })
  })

  app.post('/api/automations/:id/triggers', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const result = getAuthorizedAutomation(userId, c.req.param('id'))
    if (!result.automation) {
      return jsonError(c, result.message, result.status)
    }

    const payload = automationTriggerSchema.parse(await c.req.json())
    const created = automationService.createTrigger(result.automation.id, payload)
    return c.json(created, 201)
  })

  app.patch('/api/automation-triggers/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const existingTrigger = automationService.getTrigger(c.req.param('id'))
    if (!existingTrigger) {
      return jsonError(c, 'Trigger 不存在。', 404)
    }
    const detail = automationService.getDetail(existingTrigger.automationId)
    if (!detail) {
      return jsonError(c, '自动化不存在。', 404)
    }
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, detail.projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const trigger = automationService.updateTrigger(c.req.param('id'), automationTriggerUpdateSchema.parse(await c.req.json()))
    if (!trigger) {
      return jsonError(c, 'Trigger 不存在。', 404)
    }

    return c.json({ trigger })
  })

  app.delete('/api/automation-triggers/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const triggerId = c.req.param('id')
    const trigger = automationService.getTrigger(triggerId)
    if (!trigger) {
      return jsonError(c, 'Trigger 不存在。', 404)
    }

    const detail = automationService.getDetail(trigger.automationId)
    if (!detail) {
      return jsonError(c, '自动化不存在。', 404)
    }
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, detail.projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    automationService.deleteTrigger(triggerId)
    return c.json({ ok: true })
  })

  app.post('/api/automation-triggers/:id/rotate-secret', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const trigger = automationService.getTrigger(c.req.param('id'))
    if (!trigger) {
      return jsonError(c, 'Webhook trigger 不存在。', 404)
    }
    const detail = automationService.getDetail(trigger.automationId)
    if (!detail) {
      return jsonError(c, '自动化不存在。', 404)
    }
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, detail.projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const rotated = automationService.rotateTriggerSecret(trigger.id)
    if (!rotated?.trigger) {
      return jsonError(c, 'Webhook trigger 不存在。', 404)
    }

    return c.json(rotated)
  })

  app.post('/api/automation-triggers/:id/fire', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const trigger = automationService.getTrigger(c.req.param('id'))
    if (!trigger) {
      return jsonError(c, 'Trigger 不存在。', 404)
    }

    const detail = automationService.getDetail(trigger.automationId)
    if (!detail) {
      return jsonError(c, '自动化不存在。', 404)
    }
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, detail.projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const payload = automationRunSchema.parse(await c.req.json())
    const run = await automationService.fireApiTrigger(trigger.id, payload)
    return c.json({ run })
  })

  app.post('/api/automation-triggers/public/:publicId/fire', async (c) => {
    const rawBody = await c.req.raw.text()
    let payload: Record<string, unknown> | undefined
    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>
        }
      } catch {
        return c.json({ message: 'Webhook payload 必须是合法 JSON。' }, 400)
      }
    }

    try {
      const run = await automationService.fireWebhook(c.req.param('publicId'), rawBody, c.req.raw.headers, payload)
      return c.json({ run })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook 触发失败。'
      const status = message.includes('鉴权') ? 401 : message.includes('不存在') ? 404 : 400
      return c.json({ message }, status as 400 | 401 | 404)
    }
  })
}
