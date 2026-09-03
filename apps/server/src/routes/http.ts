// [INPUT]: Hono app
// [OUTPUT]: /api/bootstrap、/api/state/stream 等基础 HTTP 路由
// [POS]: 基础/引导/状态流 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'
import { hashStatePayload } from '@shared/state-payload-hash'
import { loadState, getMeta } from '../storage/app-state-store'
import { registerExecutorControlPlaneRoutes } from './executor-control-plane-routes'
import { enterpriseRouteRegistrations } from '../extension-registry'
import { registerAuthRoutes } from './auth-routes'
import { registerDevChatE2ERoutes } from './dev-chat-e2e-routes'
import { registerAdminRoutes } from './admin-routes'
import { registerCommunityChannelRoutes } from './community-channel-routes'
import { registerFeedbackRoutes } from './feedback-routes'
import { registerFeedbackChannelRoutes } from './feedback-channel-routes'
import { registerCommunityUsageRoutes } from './community-usage-routes'
import { registerAutomationRoutes } from './automation-routes'
import { registerClusterRoutes } from './cluster-routes'
import { registerConversationRoutes } from './conversation-routes'
import { registerMeetingIntelligenceRoutes } from './meeting-intelligence-routes'
import { registerDeviceTokenRoutes } from './device-tokens-routes'
import { registerConnectorRoutes } from './connector-routes'
import { registerConversationShareRoutes } from './conversation-share-routes'
import { registerCollaborationWorkspaceRoutes } from './collaboration-workspace-routes'
import { registerConnectionRoutes } from './connection-routes'
import { registerDriveRoutes } from './drive-routes'
import { registerGlobalSearchRoutes } from './global-search-routes'
import { registerProfileRoutes } from './profile-routes'
import { registerOrgRoutes } from './org-routes'
import { registerAgentUniverseRoutes } from './agent-universe-routes'
import { registerProjectRoutes } from './project-routes'
import { registerProjectMemberRoutes } from './project-member-routes'
import { registerProjectGitBindingRoutes } from './project-git-binding-routes'
import { registerRuntimeEnvironmentRoutes } from './runtime-environment-routes'
import { registerDesktopSandboxRoutes } from './desktop-sandbox-routes'
import { registerRemoteCodeRoutes } from './remote-code-routes'
import { registerPreviewGatewayRoutes } from './preview-gateway-routes'
import { registerPreviewRoutes } from './preview-routes'
import { registerWorkerInstallRoutes } from './worker-install-routes'
import { registerReviewRoutes } from './review-routes'
import { registerRailwayRoutes } from './railway-routes'
import { createStateStream } from '../services/state-stream'
import { getScopedState, getUserIdFromHeader, getUserIdFromHeaderAsync } from './shared'
import { createApiTiming, timedJson } from './api-timing'
import { registerMcpRoutes } from './mcp-routes'
import { registerSkillRoutes } from './skill-routes'
import { registerSystemRoutes } from './system-routes'
import { registerUsageRoutes } from './usage-routes'
import { getUserById, resolveEffectiveUserStatus } from '../repositories/auth'
import { registerTaskRoutes } from './task-routes'
import { registerTaskCommentNotificationRoutes } from './task-comment-notification-routes'
import { registerTaskFieldRoutes } from './task-field-routes'
import { registerUserGitCredentialRoutes } from './user-git-credential-routes'
import { registerUserGitHubAppRoutes } from './user-github-app-routes'
import { registerGitHubWebhookRoutes } from './github-webhook-routes'
import { registerWorkspaceGroupChatRoutes } from './workspace-group-chat-routes'
import { registerWorkspaceShareRoutes } from './workspace-share-routes'
import { registerWorkspaceSessionHistoryRoutes } from './workspace-session-history-routes'
import { auth, resolveTrustedOrigins } from '../services/better-auth-service'
import { getWorkspaceSessionUnreadStoreSnapshotForUser } from '../services/workspace-session-unread-store'
import { resolveLegacyDomainRedirect } from '../domain-redirect'
import { resolveLegacyPathRedirect } from '../legacy-path-redirects'

const API_CORS_HEADERS = ['Content-Type', 'Authorization']

const isLocalDevelopmentOrigin = (origin: string) => {
  if (process.env.NODE_ENV === 'production') return false

  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

const resolveApiCorsOrigin = (origin: string) => {
  if (!origin) return null
  if (resolveTrustedOrigins().includes(origin)) return origin
  if (isLocalDevelopmentOrigin(origin)) return origin
  return null
}

const resolveMainChatStateMode = (value?: string) => {
  return value?.trim() === 'summary' ? 'summary' as const : 'full' as const
}

const resolveStateScope = (value?: string) => {
  const normalizedValue = value?.trim()
  if (normalizedValue === 'workspaces') {
    return 'workspaces' as const
  }
  if (normalizedValue === 'kanban') {
    return 'kanban' as const
  }
  return 'default' as const
}

const resolveStateFocus = (query: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => ({
  taskId: query.taskId?.trim() || undefined,
  workspaceId: query.workspaceId?.trim() || undefined,
  workspaceSessionId: query.workspaceSessionId?.trim() || undefined,
})

const buildBootstrapPayloadDetail = (
  state: ReturnType<typeof getScopedState>,
  mainChat: 'full' | 'summary',
  scope: 'default' | 'workspaces' | 'kanban',
  focus?: {
    taskId?: string
    workspaceId?: string
    workspaceSessionId?: string
  },
) => ({
  main_chat_mode: mainChat,
  scope,
  focus_task: Boolean(focus?.taskId),
  focus_workspace: Boolean(focus?.workspaceId),
  focus_workspace_session: Boolean(focus?.workspaceSessionId),
  project_count: state.projects.length,
  task_count: state.tasks.length,
  distributed_task_count: state.distributedTasks.length,
  task_workspace_binding_count: state.taskWorkspaceBindings.length,
  workspace_session_count: state.workspaceSessions.length,
  main_chat_session_count: state.mainChatSessions.length,
  main_chat_message_count: state.mainChatSessions.reduce((count, session) => count + (session.messages?.length ?? 0), 0),
  main_chat_total_message_count: state.mainChatSessions.reduce((count, session) => count + (session.messageCount ?? session.messages?.length ?? 0), 0),
  project_binding_count: state.projectBindings.length,
  node_count: state.nodes.length,
})

export const createHttpApp = () => {
  const app = new Hono()

  app.use('*', async (c, next) => {
    const redirectUrl = resolveLegacyDomainRedirect(c.req.url, c.req.header('host'))
    if (redirectUrl) {
      // 301 是可缓存的永久重定向，搜索引擎迁移（Search Console 地址更改）只接受 301；
      // 非 GET/HEAD 保留 308，避免 legacy API 客户端的方法被改写为 GET。
      const method = c.req.method.toUpperCase()
      return c.redirect(redirectUrl, method === 'GET' || method === 'HEAD' ? 301 : 308)
    }

    const pathRedirect = resolveLegacyPathRedirect(c.req.url)
    if (pathRedirect) {
      return c.redirect(pathRedirect, 301)
    }

    await next()
  })

  app.use('/api/*', cors({
    origin: resolveApiCorsOrigin,
    allowHeaders: API_CORS_HEADERS,
    credentials: true,
  }))
  app.use('/api/*', compress({ threshold: 1024 }))
  app.use('/uploads/*', cors())
  app.use('/mcp', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID', 'mcp-protocol-version', 'mcp-session-id', 'x-executor-token', 'x-wemux-acting-user', 'x-wemux-runtime-agent'],
    exposeHeaders: ['mcp-protocol-version', 'mcp-session-id'],
  }))
  app.use('/mcp/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID', 'mcp-protocol-version', 'mcp-session-id', 'x-executor-token', 'x-wemux-acting-user', 'x-wemux-runtime-agent'],
    exposeHeaders: ['mcp-protocol-version', 'mcp-session-id'],
  }))

  const requireAuth: MiddlewareHandler = async (c, next) => {
    const userId = await getUserIdFromHeaderAsync(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const user = getUserById(userId)
    if (user) {
      const effectiveStatus = resolveEffectiveUserStatus(user)
      if (effectiveStatus === 'banned') {
        return c.json({ message: '账号已被封禁，请联系管理员。' }, 403)
      }
      if (effectiveStatus === 'suspended') {
        return c.json({ message: '账号已停用，请联系管理员。' }, 403)
      }
    }

    c.set('userId', userId)
    await next()
  }

  app.get('/api/bootstrap', requireAuth, async (c) => {
    const mainChat = resolveMainChatStateMode(c.req.query('mainChat'))
    const scope = resolveStateScope(c.req.query('scope'))
    const focus = resolveStateFocus({
      taskId: c.req.query('taskId'),
      workspaceId: c.req.query('workspaceId'),
      workspaceSessionId: c.req.query('workspaceSessionId'),
    })
    const timing = createApiTiming(c, {
      route: '/api/bootstrap',
      method: 'GET',
      detail: { main_chat_mode: mainChat, scope },
    })
    const scopedState = timing.measureSync('auth/state', () => {
      const userId = getUserIdFromHeader(c)!
      return getScopedState(loadState(), userId, { mainChat, scope, focus })
    })
    const workspaceSessionUnreadSnapshot = scope === 'workspaces'
      ? getWorkspaceSessionUnreadStoreSnapshotForUser(getUserIdFromHeader(c)!)
      : undefined
    const statePayload = JSON.stringify(scopedState)
    const stateHash = hashStatePayload(statePayload)
    return timedJson(c, timing, 200, { state: scopedState, stateHash, workspaceSessionUnreadSnapshot, message: 'ok' }, {
      route: '/api/bootstrap',
      method: 'GET',
      detail: buildBootstrapPayloadDetail(scopedState, mainChat, scope, focus),
    })
  })

  app.get('/api/state/stream', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const mainChat = resolveMainChatStateMode(c.req.query('mainChat'))
    const scope = resolveStateScope(c.req.query('scope'))
    const focus = resolveStateFocus({
      taskId: c.req.query('taskId'),
      workspaceId: c.req.query('workspaceId'),
      workspaceSessionId: c.req.query('workspaceSessionId'),
    })
    const lastStateHash = c.req.query('lastStateHash')?.trim() || undefined
    const stream = createStateStream(
      (state) => getScopedState(state, userId, { mainChat, scope, focus }),
      () => loadState(),
      { lastStateHash },
    )

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  })

  // 公开注册开关：openRegistration=false 时阻断 better-auth 的邮箱注册（保留登录/验证/找回）
  app.all('/api/identity/sign-up/email', async (c) => {
    const settings = getMeta<{ openRegistration?: boolean }>('settings:account-system', {})
    if (settings.openRegistration === false) {
      return c.json({ message: '当前暂不开放注册，请联系管理员创建账号。' }, 403)
    }
    return auth.handler(c.req.raw)
  })

  app.all('/api/identity/*', async (c) => {
    return auth.handler(c.req.raw)
  })

  registerWorkerInstallRoutes(app)
  registerPreviewGatewayRoutes(app)
  registerClusterRoutes(app, requireAuth)
  registerConversationRoutes(app, requireAuth)
  registerConversationShareRoutes(app, requireAuth)
  registerMeetingIntelligenceRoutes(app, requireAuth)
  registerDeviceTokenRoutes(app, requireAuth)
  registerCollaborationWorkspaceRoutes(app, requireAuth)
  registerConnectionRoutes(app, requireAuth)
  registerDriveRoutes(app, requireAuth)
  registerGlobalSearchRoutes(app, requireAuth)
  registerProfileRoutes(app, requireAuth)
  registerOrgRoutes(app, requireAuth)
  registerAgentUniverseRoutes(app, requireAuth)
  registerWorkspaceGroupChatRoutes(app, requireAuth)
  registerWorkspaceShareRoutes(app, requireAuth)
  registerWorkspaceSessionHistoryRoutes(app, requireAuth)
  registerMcpRoutes(app, requireAuth)
  registerSkillRoutes(app, requireAuth)
  registerExecutorControlPlaneRoutes(app, requireAuth)
  registerProjectRoutes(app, requireAuth)
  registerProjectMemberRoutes(app, requireAuth)
  registerProjectGitBindingRoutes(app, requireAuth)
  registerRuntimeEnvironmentRoutes(app, requireAuth)
  registerDesktopSandboxRoutes(app, requireAuth)
  registerRemoteCodeRoutes(app, requireAuth)
  registerAuthRoutes(app, requireAuth)
  registerDevChatE2ERoutes(app, requireAuth)
  registerAdminRoutes(app, requireAuth)
  registerCommunityChannelRoutes(app, requireAuth)
  registerFeedbackRoutes(app, requireAuth)
  registerFeedbackChannelRoutes(app, requireAuth)
  registerAutomationRoutes(app, requireAuth)
  registerGitHubWebhookRoutes(app)
  registerCommunityUsageRoutes(app)
  registerConnectorRoutes(app, requireAuth)
  registerPreviewRoutes(app, requireAuth)
  registerReviewRoutes(app, requireAuth)
  registerRailwayRoutes(app, requireAuth)
  registerTaskRoutes(app, requireAuth)
  registerTaskCommentNotificationRoutes(app, requireAuth)
  registerTaskFieldRoutes(app, requireAuth)
  registerUserGitCredentialRoutes(app, requireAuth)
  registerUserGitHubAppRoutes(app, requireAuth)
  registerSystemRoutes(app, requireAuth)
  registerUsageRoutes(app, requireAuth)
  for (const registerEnterprise of enterpriseRouteRegistrations) {
    registerEnterprise(app, requireAuth)
  }

  return app
}
