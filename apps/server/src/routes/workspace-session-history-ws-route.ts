// [INPUT]: Hono app + WS upgrade，会话历史实时订阅（lastSessionSeq/visibility）
// [OUTPUT]: 工作区会话历史 WS 路由（增量事件流）
// [POS]: 工作区会话历史 WS 实时协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono } from 'hono'
import { z } from 'zod'
import type { WorkspaceSessionEventVisibility } from '@shared/workspace-session-history'
import { parseTokenUserId } from '../repositories/auth'
import {
  registerWorkspaceSessionHistoryWsConnection,
  sendWorkspaceSessionHistoryWsMessage,
  unregisterWorkspaceSessionHistoryWsConnection,
} from '../services/workspace-session-history-ws-service'
import { loadState } from '../storage/app-state-store'
import { getWorkspace } from '../storage/distributed-task-store'
import {
  getWorkspaceSessionRuntimeSnapshot,
  listWorkspaceSessionEvents,
} from '../storage/postgres/workspace-session-history-store'
import { getAuthorizedProject, jsonError } from './shared'

const querySchema = z.object({
  lastSessionSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  visibility: z.enum(['transcript', 'diagnostic', 'hidden', 'all']).optional(),
})

const resolveVisibleWorkspaceSession = (params: {
  userId: string
  workspaceId: string
  workspaceSessionId: string
}) => {
  const state = loadState()
  const workspace = getWorkspace(params.workspaceId)
  if (!workspace) {
    return {
      status: 404 as const,
      message: '工作区不存在。',
    }
  }

  const projectResult = getAuthorizedProject(state, params.userId, workspace.projectId)
  if (!projectResult.project) {
    return {
      status: projectResult.status,
      message: projectResult.message,
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
      message: '工作区会话不存在。',
    }
  }

  return {
    status: 200 as const,
    workspace,
    workspaceSession,
  }
}

export const registerWorkspaceSessionHistoryWsRoute = (app: Hono, upgradeWebSocket: any) => {
  app.get(
    '/api/workspaces/:workspaceId/sessions/:workspaceSessionId/history-ws',
    async (c, next) => {
      const token = c.req.query('token') || c.req.header('Authorization')?.replace(/^Bearer\s+/, '')
      const userId = token ? parseTokenUserId(token) : null
      if (!userId) {
        return c.json({ message: '未登录' }, 401)
      }

      const workspaceId = c.req.param('workspaceId')
      const workspaceSessionId = c.req.param('workspaceSessionId')
      const query = querySchema.parse(c.req.query())
      const access = resolveVisibleWorkspaceSession({ userId, workspaceId, workspaceSessionId })
      if (access.status !== 200) {
        return jsonError(c, access.message, access.status)
      }

      const [initialRuntime, initialEventsPage] = await Promise.all([
        getWorkspaceSessionRuntimeSnapshot(workspaceSessionId),
        listWorkspaceSessionEvents({
          sessionId: workspaceSessionId,
          afterSessionSeq: query.lastSessionSeq,
          limit: query.limit ?? 20,
          visibility: query.visibility as WorkspaceSessionEventVisibility | 'all' | undefined,
        }),
      ])

      console.info('[workspace-session-history][ws] preload', JSON.stringify({
        workspaceId,
        workspaceSessionId,
        lastSessionSeq: query.lastSessionSeq ?? null,
        limit: query.limit ?? 20,
        visibility: query.visibility ?? 'transcript',
        initialEventCount: initialEventsPage.events.length,
        initialFirstSessionSeq: initialEventsPage.events[0]?.sessionSeq ?? null,
        initialLastSessionSeq: initialEventsPage.events.at(-1)?.sessionSeq ?? null,
        runtimeLastEventSeq: initialRuntime?.lastEventSeq ?? null,
      }))

      ;(c as any).set('workspaceSessionHistorySessionId', workspaceSessionId)
      ;(c as any).set('workspaceSessionHistoryInitialRuntime', initialRuntime)
      ;(c as any).set('workspaceSessionHistoryInitialEvents', initialEventsPage.events)
      ;(c as any).set('workspaceSessionHistoryInitialHasMoreBefore', initialEventsPage.hasMoreBefore)
      ;(c as any).set('workspaceSessionHistoryInitialHasMoreAfter', initialEventsPage.hasMoreAfter)
      ;(c as any).set('workspaceSessionHistoryInitialTotalCount', initialEventsPage.totalCount)
      ;(c as any).set('workspaceSessionHistoryLastSessionSeq', query.lastSessionSeq)
      ;(c as any).set('workspaceSessionHistoryVisibility', query.visibility)
      await next()
    },
    upgradeWebSocket((c: any) => {
      const sessionId = c.get('workspaceSessionHistorySessionId') as string
      const initialRuntime = c.get('workspaceSessionHistoryInitialRuntime')
      const initialEvents = c.get('workspaceSessionHistoryInitialEvents')
      const initialHasMoreBefore = c.get('workspaceSessionHistoryInitialHasMoreBefore')
      const initialHasMoreAfter = c.get('workspaceSessionHistoryInitialHasMoreAfter')
      const initialTotalCount = c.get('workspaceSessionHistoryInitialTotalCount')
      const lastSessionSeq = c.get('workspaceSessionHistoryLastSessionSeq') as number | undefined
      const visibility = c.get('workspaceSessionHistoryVisibility') as WorkspaceSessionEventVisibility | 'all' | undefined
      let subscriberId = ''

      const sendError = (ws: any, message: string) => {
        sendWorkspaceSessionHistoryWsMessage(ws, {
          type: 'workspace_session_history.error',
          message,
        })
      }

      return {
        onOpen(_: Event, ws: any) {
          try {
            subscriberId = registerWorkspaceSessionHistoryWsConnection({
              sessionId,
              socket: ws,
              visibility,
              lastSessionSeq,
              initialRuntime,
              initialEvents,
              initialHasMoreBefore,
              initialHasMoreAfter,
              initialTotalCount,
            })
            console.info('[workspace-session-history][ws] subscribed', JSON.stringify({
              sessionId,
              subscriberId,
              lastSessionSeq: lastSessionSeq ?? null,
              initialEventCount: Array.isArray(initialEvents) ? initialEvents.length : 0,
              runtimeLastEventSeq: initialRuntime?.lastEventSeq ?? null,
            }))
          } catch (error) {
            sendError(ws, error instanceof Error ? error.message : '工作区会话历史订阅失败。')
            ws.close(1011, 'workspace session history subscribe failed')
          }
        },
        onMessage(event: MessageEvent<string>, ws: any) {
          const raw = String(event.data ?? '').trim()
          if (raw === 'ping') {
            ws.send('pong')
          }
        },
        onClose() {
          if (subscriberId) {
            unregisterWorkspaceSessionHistoryWsConnection(sessionId, subscriberId)
          }
        },
      }
    }),
  )
}
