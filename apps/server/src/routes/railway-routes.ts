// [INPUT]: Railway 连接/同步/部署/绑定/webhook HTTP 请求。
// [OUTPUT]: 归一化响应（连接摘要、部署事实、绑定、webhook 触发）。
// [POS]: Railway 插件控制面路由（连接 + 同步 + 绑定 + webhook 收口）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  connectRailway,
  disconnectRailway,
  getRailwayConnection,
} from '../services/railway-connection-service'
import {
  countRailwayProjects,
  hasRailwayProjectResource,
  listRailwayDeploymentsForProject,
  resyncRailwayProjectByRailwayProjectId,
  syncRailwayForUser,
} from '../services/railway-sync-service'
import {
  listRailwayResourceBindings,
  upsertRailwayResourceBinding,
} from '../storage/postgres/railway-resource-binding-store'
import { loadState } from '../storage/app-state-store'
import { getAuthorizedProject, getScopedState, getUserIdFromHeader, jsonError } from './shared'
import { listProjectWorkspacesForUser } from './task-route-support'

const connectionPayloadSchema = z.object({
  token: z.string().trim().min(1),
})

const resourceBindingQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  resourceType: z.enum(['deployment']).optional(),
  resourceId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  workspaceSessionId: z.string().trim().optional(),
  status: z.enum(['suggested', 'confirmed', 'rejected']).optional(),
})

const resourceBindingPayloadSchema = z.object({
  projectId: z.string().trim().min(1),
  resourceType: z.enum(['deployment']),
  resourceId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
  role: z.enum(['delivery', 'reference', 'review', 'execution']).optional(),
  status: z.enum(['confirmed', 'rejected']).optional(),
})

const listRailwayConnectionHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const connection = await getRailwayConnection(userId)
  return c.json({ connection, projectCount: await countRailwayProjects() })
}

const connectRailwayHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const payload = connectionPayloadSchema.parse(await c.req.json())

  try {
    const { connection } = await connectRailway(userId, payload.token)
    // 首次同步失败不阻断连接建立（token 已校验通过），但要把失败暴露给前端。
    const syncResult = await syncRailwayForUser(userId)
    return c.json({ connection, sync: syncResult })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Railway 连接失败。'
    return jsonError(c, message, 400)
  }
}

const disconnectRailwayHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  await disconnectRailway(userId)
  return c.json({ ok: true })
}

const syncRailwayHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const result = await syncRailwayForUser(userId)
  if (!result.ok) {
    return jsonError(c, result.message, 400)
  }
  return c.json(result)
}

const listRailwayDeploymentsHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const state = loadState()
  const projectId = c.req.query('projectId')?.trim()
  if (!projectId) {
    return jsonError(c, '缺少 projectId。', 400)
  }
  const projectResult = getAuthorizedProject(state, userId, projectId)
  if (!projectResult.project) {
    return jsonError(c, projectResult.message, projectResult.status)
  }

  return c.json({
    deployments: await listRailwayDeploymentsForProject(projectResult.project.id),
  })
}

const listRailwayResourceBindingsHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const state = loadState()
  const query = resourceBindingQuerySchema.parse(c.req.query())
  const scopedState = getScopedState(state, userId)
  const scopedProjectIds = new Set(scopedState.projects.map((project) => project.id))
  const requestedProjectIds = new URL(c.req.url).searchParams.getAll('projectId').map((id) => id.trim()).filter(Boolean)
  if (requestedProjectIds.length > 0) {
    for (const projectId of requestedProjectIds) {
      if (!scopedProjectIds.has(projectId)) {
        return jsonError(c, '项目不存在，或当前账号无权访问。', 404)
      }
    }
  }

  return c.json({
    bindings: await listRailwayResourceBindings({
      projectIds: requestedProjectIds.length > 0 ? requestedProjectIds : [...scopedProjectIds],
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      taskId: query.taskId,
      workspaceId: query.workspaceId,
      workspaceSessionId: query.workspaceSessionId,
      status: query.status,
    }),
  })
}

const upsertRailwayResourceBindingHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const state = loadState()
  const payload = resourceBindingPayloadSchema.parse(await c.req.json())
  const projectResult = getAuthorizedProject(state, userId, payload.projectId)
  if (!projectResult.project) {
    return jsonError(c, projectResult.message, projectResult.status)
  }
  if (!payload.taskId && !payload.workspaceId && !payload.workspaceSessionId) {
    return jsonError(c, '关联至少需要任务、工作区或工作区会话之一。', 400)
  }

  const resourceBelongsToProject = await hasRailwayProjectResource({
    resourceId: payload.resourceId,
    projectId: projectResult.project.id,
  })
  if (!resourceBelongsToProject) {
    return jsonError(c, 'Railway 部署不存在，或不属于当前项目。', 404)
  }

  if (payload.taskId) {
    const task = state.tasks.find((item) => item.id === payload.taskId)
    if (!task || task.projectId !== projectResult.project.id) {
      return jsonError(c, '任务不存在，或不属于当前项目。', 400)
    }
  }

  const projectWorkspaces = listProjectWorkspacesForUser(userId, projectResult.project)
  const workspace = payload.workspaceId
    ? projectWorkspaces.find((item) => item.id === payload.workspaceId)
    : undefined
  if (payload.workspaceId && !workspace) {
    return jsonError(c, '工作区不存在，或不属于当前项目。', 400)
  }

  const workspaceSession = payload.workspaceSessionId
    ? state.workspaceSessions.find((item) => item.id === payload.workspaceSessionId)
    : undefined
  if (
    payload.workspaceSessionId
    && (
      !workspaceSession
      || !projectWorkspaces.some((item) => item.id === workspaceSession.workspaceId)
      || (workspace && workspace.id !== workspaceSession.workspaceId)
    )
  ) {
    return jsonError(c, '工作区会话不存在，或不属于当前项目上下文。', 400)
  }

  const resolvedWorkspaceId = workspace?.id ?? workspaceSession?.workspaceId
  if (
    payload.taskId
    && resolvedWorkspaceId
    && !state.taskWorkspaceBindings.some((binding) => (
      binding.taskId === payload.taskId
      && binding.workspaceId === resolvedWorkspaceId
    ))
  ) {
    return jsonError(c, '任务与工作区不属于同一执行上下文。', 400)
  }

  const binding = await upsertRailwayResourceBinding({
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    projectId: projectResult.project.id,
    taskId: payload.taskId,
    workspaceId: resolvedWorkspaceId,
    workspaceSessionId: workspaceSession?.id,
    role: payload.role ?? 'reference',
    status: payload.status ?? 'confirmed',
    source: 'manual',
    confidence: 100,
    createdByUserId: userId,
  })

  return c.json({ binding })
}

const railwayWebhookHandler = async (c: Context) => {
  const payload = await c.req.json().catch(() => null) as { resource?: { project?: { id?: string } } } | null
  const railwayProjectId = payload?.resource?.project?.id?.trim()
  if (!railwayProjectId) {
    return c.json({ ok: true, skipped: true, reason: 'missing project id' })
  }

  // payload 无签名，只当触发信号：定向重同步对应 railway 项目（事实以 GraphQL 为准）。
  try {
    const synced = await resyncRailwayProjectByRailwayProjectId(railwayProjectId)
    return c.json({ ok: true, synced })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Railway webhook 处理失败。'
    console.error('[railway-webhook]', message)
    return c.json({ ok: false, message }, 500)
  }
}

export const registerRailwayRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/railway/connection', requireAuth, listRailwayConnectionHandler)
  app.post('/api/railway/connection', requireAuth, connectRailwayHandler)
  app.delete('/api/railway/connection', requireAuth, disconnectRailwayHandler)
  app.post('/api/railway/sync', requireAuth, syncRailwayHandler)
  app.get('/api/railway/deployments', requireAuth, listRailwayDeploymentsHandler)
  app.get('/api/railway/resource-bindings', requireAuth, listRailwayResourceBindingsHandler)
  app.post('/api/railway/resource-bindings', requireAuth, upsertRailwayResourceBindingHandler)

  // webhook 收口：无鉴权（Railway 无签名），只做定向重同步触发。
  app.post('/api/railway/webhook', railwayWebhookHandler)
}
