// [INPUT]: 已鉴权 Hono app，工作区会话历史查询参数
// [OUTPUT]: /api/workspaces/:workspaceId/sessions/:workspaceSessionId/* 路由（runtime/events/turns/history-delete-turn）
// [POS]: 工作区会话历史 HTTP 查询协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { WorkspaceSessionEventVisibility } from '@shared/workspace-session-history'
import { loadState } from '../storage/app-state-store'
import { getWorkspace } from '../storage/distributed-task-store'
import { resolveUserWorkspaceShareAccess } from '../services/workspace-share-service'
import {
  deleteWorkspaceSessionTurn,
  getWorkspaceSessionRuntimeSnapshot,
  listWorkspaceSessionEvents,
  listWorkspaceSessionTurns,
} from '../storage/postgres/workspace-session-history-store'
import { createApiTiming, timedJson } from './api-timing'
import { getAuthorizedProject, getUserIdFromHeader, jsonError } from './shared'

const sessionEventsQuerySchema = z.object({
  afterSessionSeq: z.coerce.number().int().min(0).optional(),
  beforeSessionSeq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  visibility: z.enum(['transcript', 'diagnostic', 'hidden', 'all']).optional(),
})

const deleteTurnSchema = z.object({
  turnId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
})

const resolveVisibleWorkspaceSession = (params: {
  userId: string
  workspaceId: string
  workspaceSessionId: string
}, options?: { requireSend?: boolean; requireCollaborate?: boolean }) => {
  const state = loadState()
  const workspace = getWorkspace(params.workspaceId)
  if (!workspace) {
    return {
      status: 404 as const,
      body: { message: '工作区不存在。' },
      state,
    }
  }

  const projectResult = getAuthorizedProject(state, params.userId, workspace.projectId)
  if (!projectResult.project) {
    // 共享协作人兜底：通过 workspace_shares 授权访问（read 可读；edit/collaborate 可发）
    const project = state.projects.find((item) => item.id === workspace.projectId)
    const collabWorkspaceId = project?.workspaceId
    if (!collabWorkspaceId) {
      return {
        status: projectResult.status,
        body: { message: projectResult.message },
        state,
      }
    }
    const access = resolveUserWorkspaceShareAccess(params.userId, collabWorkspaceId, params.workspaceSessionId)
    const shareAllowed = access.ok && (
      options?.requireCollaborate
        ? access.permission === 'collaborate'
        : options?.requireSend
          ? (access.permission === 'edit' || access.permission === 'collaborate')
          : true
    )
    if (!shareAllowed) {
      return {
        status: 403 as const,
        body: { message: '工作区会话不可访问。' },
        state,
      }
    }
  }

  const workspaceSession = state.workspaceSessions.find((session) => (
    session.id === params.workspaceSessionId
    && session.workspaceId === params.workspaceId
    && session.status !== 'archived'
  ))
  if (!workspaceSession) {
    return {
      status: 404 as const,
      body: { message: '工作区会话不存在。' },
      state,
    }
  }

  return {
    status: 200 as const,
    state,
    workspace,
    project: projectResult.project ?? null,
    workspaceSession,
  }
}

export const resolveWorkspaceSessionDeleteTurnHttpResult = (
  result: Awaited<ReturnType<typeof deleteWorkspaceSessionTurn>>,
) => {
  if (result.ok) {
    return {
      status: 200 as const,
      body: {
        ok: true as const,
        status: 'deleted' as const,
        event: result.event,
        runtime: result.runtime,
      },
    }
  }

  switch (result.reason) {
    case 'not_found':
      return {
        status: 404 as const,
        body: { message: '目标工作区回合不存在。' },
      }
    case 'already_deleted':
      return {
        status: 200 as const,
        body: { ok: true as const, status: 'noop' as const },
      }
    case 'not_latest':
      return {
        status: 409 as const,
        body: { message: '当前仅支持删除最新一轮尚未继续展开的用户消息。' },
      }
    case 'has_assistant_output':
      return {
        status: 409 as const,
        body: { message: '这一轮已经产生回复或工具输出，暂不支持直接删除。' },
      }
  }
}

export const registerWorkspaceSessionHistoryRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/workspaces/:workspaceId/sessions/:workspaceSessionId', requireAuth, async (c) => {
    const workspaceId = c.req.param('workspaceId')
    const workspaceSessionId = c.req.param('workspaceSessionId')
    const timingMeta = {
      route: '/api/workspaces/:workspaceId/sessions/:sessionId',
      method: 'GET',
      workspaceId,
      workspaceSessionId,
    }
    const timing = createApiTiming(c, timingMeta)
    const authState = timing.measureSync('auth/state', () => {
      const userId = getUserIdFromHeader(c)!
      const query = sessionEventsQuerySchema.parse(c.req.query())
      const access = resolveVisibleWorkspaceSession({ userId, workspaceId, workspaceSessionId })
      if (access.status !== 200) {
        return access
      }

      return {
        ...access,
        query,
      }
    })
    if (authState.status !== 200) {
      return timedJson(c, timing, authState.status, authState.body, timingMeta)
    }

    const snapshot = await timing.measure('DB query', async () => {
      const [history, runtime] = await Promise.all([
        listWorkspaceSessionEvents({
          sessionId: workspaceSessionId,
          afterSessionSeq: authState.query.afterSessionSeq,
          beforeSessionSeq: authState.query.beforeSessionSeq,
          limit: authState.query.limit,
          visibility: authState.query.visibility as WorkspaceSessionEventVisibility | 'all' | undefined,
        }),
        getWorkspaceSessionRuntimeSnapshot(workspaceSessionId),
      ])

      return {
        session: authState.workspaceSession,
        history,
        runtime,
      }
    })

    return timedJson(c, timing, 200, snapshot, timingMeta)
  })

  app.get('/api/workspaces/:workspaceId/sessions/:workspaceSessionId/runtime', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const workspaceSessionId = c.req.param('workspaceSessionId')
    const access = resolveVisibleWorkspaceSession({ userId, workspaceId, workspaceSessionId })
    if (access.status !== 200) {
      return jsonError(c, access.body.message, access.status)
    }

    const runtime = await getWorkspaceSessionRuntimeSnapshot(workspaceSessionId)
    if (!runtime) {
      return jsonError(c, '工作区会话运行态不存在。', 404)
    }

    return c.json(runtime)
  })

  app.get('/api/workspaces/:workspaceId/sessions/:workspaceSessionId/events', requireAuth, async (c) => {
    const workspaceId = c.req.param('workspaceId')
    const workspaceSessionId = c.req.param('workspaceSessionId')
    const timingMeta = {
      route: '/api/workspaces/:workspaceId/sessions/:sessionId/events',
      method: 'GET',
      workspaceId,
      workspaceSessionId,
    }
    const timing = createApiTiming(c, timingMeta)
    const authState = timing.measureSync('auth/state', () => {
      const userId = getUserIdFromHeader(c)!
      const query = sessionEventsQuerySchema.parse(c.req.query())
      const access = resolveVisibleWorkspaceSession({ userId, workspaceId, workspaceSessionId })
      if (access.status !== 200) {
        return access
      }

      return {
        status: 200 as const,
        query,
      }
    })
    if (authState.status !== 200) {
      return timedJson(c, timing, authState.status, authState.body, timingMeta)
    }

    const page = await timing.measure('DB query', () => listWorkspaceSessionEvents({
      sessionId: workspaceSessionId,
      afterSessionSeq: authState.query.afterSessionSeq,
      beforeSessionSeq: authState.query.beforeSessionSeq,
      limit: authState.query.limit,
      visibility: authState.query.visibility as WorkspaceSessionEventVisibility | 'all' | undefined,
    }))

    return timedJson(c, timing, 200, page, timingMeta)
  })

  app.get('/api/workspaces/:workspaceId/sessions/:workspaceSessionId/turns', requireAuth, async (c) => {
    const workspaceId = c.req.param('workspaceId')
    const workspaceSessionId = c.req.param('workspaceSessionId')
    const timingMeta = {
      route: '/api/workspaces/:workspaceId/sessions/:sessionId/turns',
      method: 'GET',
      workspaceId,
      workspaceSessionId,
    }
    const timing = createApiTiming(c, timingMeta)
    const authState = timing.measureSync('auth/state', () => {
      const userId = getUserIdFromHeader(c)!
      const access = resolveVisibleWorkspaceSession({ userId, workspaceId, workspaceSessionId })
      if (access.status !== 200) {
        return access
      }

      return { status: 200 as const }
    })
    if (authState.status !== 200) {
      return timedJson(c, timing, authState.status, authState.body, timingMeta)
    }

    const turns = await timing.measure('DB query', () => listWorkspaceSessionTurns(workspaceSessionId))
    return timedJson(c, timing, 200, {
      sessionId: workspaceSessionId,
      turns,
    }, timingMeta)
  })

  app.post('/api/workspaces/:workspaceId/sessions/:workspaceSessionId/history-delete-turn', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const workspaceSessionId = c.req.param('workspaceSessionId')
    const payload = deleteTurnSchema.parse(await c.req.json().catch(() => ({})))
    const access = resolveVisibleWorkspaceSession({ userId, workspaceId, workspaceSessionId }, { requireCollaborate: true })
    if (access.status !== 200) {
      return jsonError(c, access.body.message, access.status)
    }

    const result = await deleteWorkspaceSessionTurn({
      sessionId: workspaceSessionId,
      taskId: workspaceSessionId,
      workspaceId,
      turnId: payload.turnId,
      deletedMessageId: payload.messageId,
    })

    const response = resolveWorkspaceSessionDeleteTurnHttpResult(result)
    return c.json(response.body, response.status)
  })
}
