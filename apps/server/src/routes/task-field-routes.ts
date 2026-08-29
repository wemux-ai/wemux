/**
 * [INPUT]: 项目级自定义字段管理请求与任务字段值读写请求。
 * [OUTPUT]: /api/projects/:id/task-fields（定义 CRUD）、/api/tasks/:id/fields（值读写）、/api/projects/:id/task-field-stats（统计）。
 * [POS]: 项目级任务自定义字段 HTTP 协议层（R8.5）；工时 = duration 字段。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { loadState } from '../storage/app-state-store'
import { getAuthorizedTask, getScopedState, getUserIdFromHeader, jsonError } from './shared'
import {
  archiveTaskFieldDefinition,
  createTaskFieldDefinition,
  getTaskCustomFieldValue,
  listTaskCustomFieldValues,
  listTaskFieldDefinitions,
  updateTaskFieldDefinition,
  upsertTaskCustomFieldValues,
  type TaskCustomFieldType,
} from '../repositories/task-field-store'

const FIELD_TYPES: TaskCustomFieldType[] = ['text', 'number', 'select', 'multi_select', 'date', 'user', 'duration', 'checkbox', 'url']

const fieldDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, '字段 key 只能包含小写字母、数字与下划线。'),
  type: z.enum(FIELD_TYPES as [TaskCustomFieldType, ...TaskCustomFieldType[]]),
  options: z.array(z.object({ label: z.string().min(1), value: z.string().min(1), color: z.string().optional() })).optional(),
  required: z.boolean().optional(),
  defaultJson: z.unknown().optional(),
  displayOrder: z.number().int().min(0).optional(),
})

const updateFieldDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  options: z.array(z.object({ label: z.string().min(1), value: z.string().min(1), color: z.string().optional() })).optional(),
  required: z.boolean().optional(),
  defaultJson: z.unknown().optional(),
  displayOrder: z.number().int().min(0).optional(),
})

const taskFieldValuesSchema = z.record(z.string(), z.unknown())

const ensureProjectVisible = (userId: string, projectId: string) => {
  const scopedState = getScopedState(loadState(), userId)
  return scopedState.projects.some((project) => project.id === projectId)
}

export const registerTaskFieldRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 字段定义列表
  app.get('/api/projects/:id/task-fields', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    if (!ensureProjectVisible(userId, projectId)) {
      return jsonError(c, '项目不存在或无权访问。', 403)
    }
    const includeArchived = c.req.query('includeArchived') === 'true'
    const fields = await listTaskFieldDefinitions(projectId, includeArchived)
    return c.json({ fields })
  })

  // 创建字段定义
  app.post('/api/projects/:id/task-fields', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    if (!ensureProjectVisible(userId, projectId)) {
      return jsonError(c, '项目不存在或无权访问。', 403)
    }
    const payload = fieldDefinitionSchema.parse(await c.req.json().catch(() => ({})))
    const existing = await listTaskFieldDefinitions(projectId)
    if (existing.some((field) => field.key === payload.key)) {
      return jsonError(c, `字段 key ${payload.key} 已存在。`, 409)
    }
    const field = await createTaskFieldDefinition({
      projectId,
      ...payload,
      displayOrder: payload.displayOrder ?? existing.length,
    })
    return c.json({ field }, 201)
  })

  // 更新字段定义（key/type 不可改）
  app.patch('/api/projects/:id/task-fields/:fieldId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    if (!ensureProjectVisible(userId, projectId)) {
      return jsonError(c, '项目不存在或无权访问。', 403)
    }
    const payload = updateFieldDefinitionSchema.parse(await c.req.json().catch(() => ({})))
    const field = await updateTaskFieldDefinition({ fieldId: c.req.param('fieldId'), ...payload })
    if (!field) {
      return jsonError(c, '字段不存在。', 404)
    }
    return c.json({ field })
  })

  // 归档字段（软删，保留历史值）
  app.delete('/api/projects/:id/task-fields/:fieldId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    if (!ensureProjectVisible(userId, projectId)) {
      return jsonError(c, '项目不存在或无权访问。', 403)
    }
    const fieldId = c.req.param('fieldId')
    const fields = await listTaskFieldDefinitions(projectId)
    if (!fields.some((field) => field.id === fieldId)) {
      return jsonError(c, '字段不存在。', 404)
    }
    await archiveTaskFieldDefinition(fieldId)
    return c.json({ message: '字段已归档。' })
  })

  // 任务字段值（读取）
  app.get('/api/tasks/:id/fields', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task) {
      return jsonError(c, taskResult.message, taskResult.status)
    }
    const values = await listTaskCustomFieldValues(taskResult.task.id)
    return c.json({ values })
  })

  // 任务字段值（写入）
  app.put('/api/tasks/:id/fields', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task) {
      return jsonError(c, taskResult.message, taskResult.status)
    }
    const values = taskFieldValuesSchema.parse(await c.req.json().catch(() => ({})))
    const nextValues = await upsertTaskCustomFieldValues({ taskId: taskResult.task.id, values })
    return c.json({ values: nextValues })
  })

  // 任务统计（R8.5）：按状态计数 + 字段聚合（工时求和等）
  app.get('/api/projects/:id/task-field-stats', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('id')
    const scopedState = getScopedState(loadState(), userId)
    const project = scopedState.projects.find((item) => item.id === projectId)
    if (!project) {
      return jsonError(c, '项目不存在或无权访问。', 403)
    }

    const projectTasks = scopedState.tasks.filter((task) => task.projectId === projectId)
    const statusCounts = projectTasks.reduce<Record<string, number>>((result, task) => {
      result[task.status] = (result[task.status] ?? 0) + 1
      return result
    }, {})

    const fields = await listTaskFieldDefinitions(projectId)
    const fieldAggregates: Record<string, { type: string; count: number; sum?: number }> = {}
    for (const field of fields) {
      let count = 0
      let sum = 0
      for (const task of projectTasks) {
        const value = await getTaskCustomFieldValue(task.id, field.id)
        if (value === undefined || value === null || value === '') {
          continue
        }
        count += 1
        if (field.type === 'duration' || field.type === 'number') {
          const numeric = typeof value === 'object' && value !== null
            ? Number((value as { value?: unknown }).value ?? 0)
            : Number(value)
          if (Number.isFinite(numeric)) {
            sum += numeric
          }
        }
      }
      fieldAggregates[field.key] = {
        type: field.type,
        count,
        ...(field.type === 'duration' || field.type === 'number' ? { sum: Math.round(sum * 100) / 100 } : {}),
      }
    }

    const completedCount = projectTasks.filter((task) => task.status === 'done').length
    const completedAtCount = projectTasks.filter((task) => Boolean(task.completedAt)).length
    return c.json({
      totalCount: projectTasks.length,
      statusCounts,
      completedCount,
      completedAtCount,
      fields: fieldAggregates,
    })
  })
}
