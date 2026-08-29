// [INPUT]: 已鉴权 Hono app，desktop-sandbox 请求（displayProfile/clientNetwork/action）
// [OUTPUT]: /api/tasks/:id/desktop-sandbox/* 路由
// [POS]: 桌面沙箱控制 HTTP 协议层（dev-only 访问控制）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type {
  Project,
  Task,
  WorkspaceSession,
  Workspace,
  WorkspaceDesktopSandboxDto,
  WorkspaceDesktopSandboxRequest,
} from '@shared/types'
import {
  resolveWorkspaceDesktopSandboxDisplaySettings,
  type WorkspaceDesktopSandboxDisplayProfile,
} from '@shared/types'
import { loadState } from '../storage/app-state-store'
import { getAuthorizedTask, getUserIdFromHeader, jsonError } from './shared'
import {
  getWorkspaceSessionRecordForTaskContext,
  listProjectWorkspacesForUser,
  listWorkspaceSessionsForTaskContext,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd,
} from './task-route-support'
import { executorRegistry } from '../control-plane/executor-registry'
import { buildPreviewHost, buildPreviewPublicUrl, normalizePreviewHostSlug, toPreviewTunnelWsUrl } from '../services/preview-hostname'
import { previewSessionService } from '../services/preview-session-service'
import type { PreviewSource } from '../services/preview-session-record'
import { requireDesktopSandboxDevOnlyAccess } from '../services/desktop-sandbox-dev-access'

const desktopSandboxScopeSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
})

const desktopSandboxDisplayProfileSchema = z.enum(['auto', '1080p', '720p', '480p'])

const desktopSandboxClientNetworkSchema = z.object({
  effectiveType: z.string().trim().max(32).optional(),
  downlinkMbps: z.number().positive().max(10000).optional(),
  rttMs: z.number().nonnegative().max(120000).optional(),
  saveData: z.boolean().optional(),
}).partial()

const desktopSandboxStartSchema = desktopSandboxScopeSchema.extend({
  displayProfile: desktopSandboxDisplayProfileSchema.optional(),
  clientNetwork: desktopSandboxClientNetworkSchema.optional(),
})

const desktopSandboxActionSchema = desktopSandboxScopeSchema.extend({
  action: z.enum(['terminal', 'file-manager', 'note', 'demo-window']),
})

const desktopSandboxCommandSchema = desktopSandboxScopeSchema.extend({
  command: z.string().trim().min(1).max(12000),
})

const buildAgentUsageHint = () => [
  'Agent can operate the wemux Desktop Sandbox through the local worker CLI:',
  '```bash',
  'if [ -n "${VIBEMUX_WORKER_RUNNER:-}" ] && [ -n "${VIBEMUX_WORKER_ENTRY:-}" ]; then',
  '  "$VIBEMUX_WORKER_RUNNER" "$VIBEMUX_WORKER_ENTRY" desktop-sandbox status',
  'elif [ -n "${VIBEMUX_WORKER_LAUNCHER:-}" ]; then',
  '  "$VIBEMUX_WORKER_LAUNCHER" desktop-sandbox status',
  'else',
  '  wemux-worker desktop-sandbox status',
  'fi',
  '```',
  'Useful subcommands: `start`, `stop`, `command --command "..."`, `read-file --path ...`, `write-file --path ... --content ...`, `action --action terminal`, `cli-command --command "..."`.',
].join('\n')

const logDesktopSandboxPreview = (message: string, details: Record<string, unknown>) => {
  console.log('[desktop-sandbox-preview]', message, details)
}

const describeTunnelUrl = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return 'invalid-url'
  }
}

const DESKTOP_PREVIEW_PURPOSE = 'desktop' as const
const DEFAULT_NOVNC_WEBSOCKET_PATH = 'websockify'
const LOCAL_DESKTOP_PREVIEW_BASE_HOST = 'wemux.localtest.me'
const DEFAULT_LOCAL_DESKTOP_SERVER_PORT = '18989'
const DEFAULT_LOCAL_DESKTOP_WEB_PORT = '15173'

const isAllowedDesktopStreamHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

const withTrailingSlash = (value: string) => value.endsWith('/') ? value : `${value}/`

const getHeaderValue = (headers: Headers, name: string) => headers.get(name)?.trim() || ''

const getForwardedHeaderValue = (headers: Headers, name: string) => (
  getHeaderValue(headers, name)
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) || ''
)

const parseHeaderUrl = (value: string) => {
  try {
    return value ? new URL(value) : null
  } catch {
    return null
  }
}

const parseHostUrl = (host: string) => {
  try {
    return host ? new URL(`http://${host}`) : null
  } catch {
    return null
  }
}

const getHeaderUrlHost = (headers: Headers, name: string) => parseHeaderUrl(getHeaderValue(headers, name))?.host.toLowerCase() || ''

const getHeaderUrlScheme = (headers: Headers, name: string) => {
  const protocol = parseHeaderUrl(getHeaderValue(headers, name))?.protocol
  return protocol === 'http:' || protocol === 'https:' ? protocol.slice(0, -1) as 'http' | 'https' : undefined
}

const resolveDesktopRequestHost = (params: {
  requestUrl: string
  headers: Headers
}) => {
  const candidates = [
    getForwardedHeaderValue(params.headers, 'x-forwarded-host'),
    getHeaderUrlHost(params.headers, 'origin'),
    getHeaderUrlHost(params.headers, 'referer'),
    getHeaderValue(params.headers, 'host'),
    new URL(params.requestUrl).host,
  ].map((value) => value.toLowerCase()).filter(Boolean)

  return candidates.find(isLocaltestHost) || candidates[0] || new URL(params.requestUrl).host.toLowerCase()
}

const resolveDesktopRequestScheme = (params: {
  requestUrl: string
  headers: Headers
}) => {
  const forwardedProto = getForwardedHeaderValue(params.headers, 'x-forwarded-proto')
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto
  }
  const originScheme = getHeaderUrlScheme(params.headers, 'origin')
  if (originScheme) {
    return originScheme
  }
  const refererScheme = getHeaderUrlScheme(params.headers, 'referer')
  if (refererScheme) {
    return refererScheme
  }
  return new URL(params.requestUrl).protocol === 'https:' ? 'https' : 'http'
}

const resolveDesktopServerRequestScheme = (requestUrl: string) => (
  new URL(requestUrl).protocol === 'https:' ? 'https' : 'http'
)

const isLocaltestHost = (host: string) => {
  return parseHostUrl(host)?.hostname.toLowerCase().endsWith('.localtest.me') ?? false
}

const getConfiguredLocalDesktopServerPort = () => {
  const candidates = [
    process.env.HYBRID_SERVER_PORT,
    process.env.VIBEMUX_SERVER_PORT,
    process.env.PORT,
  ]

  return candidates
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value && /^\d+$/.test(value)))
    ?? DEFAULT_LOCAL_DESKTOP_SERVER_PORT
}

const getConfiguredLocalDesktopWebPort = () => (
  process.env.HYBRID_WEB_PORT?.trim() || DEFAULT_LOCAL_DESKTOP_WEB_PORT
)

const isLocalDesktopWebPort = (port: string) => {
  return port === getConfiguredLocalDesktopWebPort()
    || port === DEFAULT_LOCAL_DESKTOP_WEB_PORT
}

const resolveLocalDesktopServerPort = (params: {
  requestUrl: string
  headers: Headers
}) => {
  const requestUrl = new URL(params.requestUrl)
  const candidates = [
    requestUrl.host,
    getHeaderValue(params.headers, 'host'),
    getForwardedHeaderValue(params.headers, 'x-forwarded-host'),
  ]

  for (const candidate of candidates) {
    const port = parseHostUrl(candidate)?.port
    if (port && !isLocalDesktopWebPort(port)) {
      return port
    }
  }

  return getConfiguredLocalDesktopServerPort()
}

const resolveLocalDesktopServerHost = (params: {
  requestUrl: string
  headers: Headers
}) => {
  const requestUrl = new URL(params.requestUrl)
  const port = resolveLocalDesktopServerPort(params)
  const hostname = requestUrl.hostname.toLowerCase()
  const host = requestUrl.host.toLowerCase()

  if (host && !isLocalDesktopWebPort(requestUrl.port)) {
    return host
  }

  return `${hostname}${port ? `:${port}` : ''}`
}

export const buildDesktopPreviewAccessTarget = (params: {
  requestUrl: string
  headers: Headers
  projectName: string
  previewId: string
  executor?: Parameters<typeof buildPreviewHost>[0]['executor']
}) => {
  const requestHost = resolveDesktopRequestHost({
    requestUrl: params.requestUrl,
    headers: params.headers,
  })

  if (isLocaltestHost(requestHost)) {
    const serverHost = resolveLocalDesktopServerHost({
      requestUrl: params.requestUrl,
      headers: params.headers,
    })
    const serverPort = parseHostUrl(serverHost)?.port || resolveLocalDesktopServerPort({
      requestUrl: params.requestUrl,
      headers: params.headers,
    })
    const port = serverPort ? `:${serverPort}` : ''
    const hostSlug = normalizePreviewHostSlug(params.projectName)
    const publicHost = `${hostSlug}-preview--${params.previewId}.${LOCAL_DESKTOP_PREVIEW_BASE_HOST}${port}`
    const scheme = resolveDesktopRequestScheme({
      requestUrl: params.requestUrl,
      headers: params.headers,
    })
    const serverScheme = resolveDesktopServerRequestScheme(params.requestUrl)
    const tunnelUrl = new URL(`${serverScheme === 'https' ? 'wss' : 'ws'}://${serverHost}`)
    tunnelUrl.pathname = '/api/preview-tunnels/ws'
    tunnelUrl.search = ''
    tunnelUrl.hash = ''
    return {
      publicHost,
      publicUrl: `${scheme}://${publicHost}/`,
      tunnelUrl: tunnelUrl.toString(),
    }
  }

  return {
    publicHost: buildPreviewHost({
      requestUrl: params.requestUrl,
      headers: params.headers,
      projectName: params.projectName,
      previewId: params.previewId,
      executor: params.executor,
    }),
    publicUrl: buildPreviewPublicUrl({
      requestUrl: params.requestUrl,
      headers: params.headers,
      projectName: params.projectName,
      previewId: params.previewId,
      executor: params.executor,
    }),
    tunnelUrl: toPreviewTunnelWsUrl({
      requestUrl: params.requestUrl,
      headers: params.headers,
      executor: params.executor,
    }),
  }
}

const resolveDesktopPreviewSource = (streamUrl: string): {
  source: PreviewSource
  password?: string
  viewerPath?: string
  websocketPath?: string
} | null => {
  let url: URL
  try {
    url = new URL(streamUrl)
  } catch {
    return null
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isAllowedDesktopStreamHost(url.hostname)) {
    return null
  }

  const pathname = url.pathname || '/'
  const isVncIndexPath = pathname.endsWith('/vnc/index.html')
  const basePath = isVncIndexPath
    ? pathname.slice(0, -'/vnc/index.html'.length) || '/'
    : pathname.endsWith('/vnc.html')
    ? pathname.slice(0, -'/vnc.html'.length) || '/'
    : pathname.endsWith('/index.html')
      ? pathname.slice(0, -'/index.html'.length) || '/'
      : pathname
  const sourceUrl = new URL(url.origin)
  sourceUrl.pathname = withTrailingSlash(basePath)
  sourceUrl.search = ''
  sourceUrl.hash = ''

  return {
    source: {
      appUrl: sourceUrl.toString(),
      targetProtocol: url.protocol === 'https:' ? 'https' : 'http',
      targetHost: url.hostname,
      targetPort: Number(url.port || (url.protocol === 'https:' ? '443' : '80')),
      targetBasePath: sourceUrl.pathname || '/',
    },
    password: url.searchParams.get('password') || undefined,
    viewerPath: isVncIndexPath ? '/vnc/index.html' : pathname.endsWith('/index.html') ? '/index.html' : '/vnc.html',
    websocketPath: url.searchParams.get('path') || DEFAULT_NOVNC_WEBSOCKET_PATH,
  }
}

const buildDesktopViewUrl = (params: {
  viewerIframeUrl: string
  password?: string
  displayProfile?: WorkspaceDesktopSandboxDisplayProfile
  viewerPath?: string
  websocketPath?: string
}) => {
  const viewUrl = new URL(params.viewerIframeUrl)
  const viewerToken = viewUrl.searchParams.get('vmx_viewer_token') || ''
  const websocketPort = viewUrl.port || (viewUrl.protocol === 'https:' ? '443' : '80')
  const displaySettings = resolveWorkspaceDesktopSandboxDisplaySettings({
    profile: params.displayProfile,
  })

  viewUrl.pathname = params.viewerPath || '/vnc.html'
  viewUrl.search = ''
  viewUrl.hash = ''
  viewUrl.searchParams.set('autoconnect', 'true')
  viewUrl.searchParams.set('resize', 'scale')
  viewUrl.searchParams.set('quality', String(displaySettings.noVncQuality))
  viewUrl.searchParams.set('compression', String(displaySettings.noVncCompression))
  if (params.password) {
    viewUrl.searchParams.set('password', params.password)
  }
  viewUrl.searchParams.set('host', viewUrl.hostname)
  viewUrl.searchParams.set('port', websocketPort)
  viewUrl.searchParams.set('path', params.websocketPath || DEFAULT_NOVNC_WEBSOCKET_PATH)
  if (viewerToken) {
    viewUrl.searchParams.set('vmx_viewer_token', viewerToken)
  }

  return viewUrl.toString()
}

const resolveDesktopSandboxContext = (params: {
  userId: string
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}): {
  workspace: Workspace
  session: WorkspaceSession
  executorId: string
  cwd?: string
} | null => {
  const workspaces = listProjectWorkspacesForUser(params.userId, params.project)
  const sessions = listWorkspaceSessionsForTaskContext(params.task.id)
  const requestedWorkspaceId = params.workspaceId?.trim()
  const requestedWorkspaceSessionId = params.workspaceSessionId?.trim()
  const session = requestedWorkspaceSessionId
    ? requestedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(params.task.id, requestedWorkspaceId, requestedWorkspaceSessionId)
      : sessions.find((item) => item.id === requestedWorkspaceSessionId) ?? null
    : requestedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(params.task.id, requestedWorkspaceId)
      : sessions[0] ?? null
  const workspaceId = session?.workspaceId ?? requestedWorkspaceId
  const workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId) ?? null
    : null

  if (!workspace || !session || session.workspaceId !== workspace.id) {
    return null
  }

  const executorId = resolveWorkspaceSessionExecutorId(session, workspace.executorNodeId)
  if (!executorId) {
    return null
  }

  const executor = executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
  const effectiveSession = resolveEffectiveWorkspaceWorktreeSession(params.task.id, session, workspace.executorNodeId)
  const cwd = resolveWorkspaceSessionCwd(executor?.workspaceRoot, params.project, effectiveSession, workspace)

  return {
    workspace,
    session,
    executorId,
    cwd,
  }
}

const executeDesktopSandboxRequest = async (params: {
  task: Task
  project: Project
  ownerUserId: string
  context: NonNullable<ReturnType<typeof resolveDesktopSandboxContext>>
  request: WorkspaceDesktopSandboxRequest
  requestUrl: string
  requestHeaders: Headers
}): Promise<WorkspaceDesktopSandboxDto> => {
  const { executorWsRequests } = await import('../control-plane/executor-ws-requests')
  const result = await executorWsRequests.requestDesktopSandbox(params.context.executorId, {
    request: {
      ...params.request,
      cwd: params.context.cwd,
    },
  })

  const desktop: WorkspaceDesktopSandboxDto = {
    ...result,
    taskId: params.task.id,
    workspaceId: params.context.workspace.id,
    workspaceSessionId: params.context.session.id,
    executorId: params.context.executorId,
    cwd: params.context.cwd,
    agentUsageHint: buildAgentUsageHint(),
  }

  if (desktop.phase !== 'ready' || !desktop.streamUrl) {
    return {
      ...desktop,
      streamRedirectUrl: desktop.viewUrl || '',
    }
  }

  const resolvedSource = resolveDesktopPreviewSource(desktop.streamUrl)
  if (!resolvedSource) {
    return {
      ...desktop,
      streamRedirectUrl: desktop.viewUrl || '',
    }
  }

  const executor = executorRegistry.getExecutor(params.context.executorId)
  const existingDesktopPreview = previewSessionService.getOwnerSessionForTaskWorkspace({
    taskId: params.task.id,
    workspaceId: params.context.workspace.id,
    ownerUserId: params.ownerUserId,
    purpose: DESKTOP_PREVIEW_PURPOSE,
  })
  let previewId = (
    existingDesktopPreview
    && existingDesktopPreview.executorId === params.context.executorId
    && existingDesktopPreview.source.appUrl === resolvedSource.source.appUrl
    && existingDesktopPreview.status !== 'closed'
    && existingDesktopPreview.status !== 'error'
  )
    ? existingDesktopPreview.id
    : crypto.randomUUID()
  let previewAccess = buildDesktopPreviewAccessTarget({
    requestUrl: params.requestUrl,
    headers: params.requestHeaders,
    projectName: params.project.name,
    previewId,
    executor,
  })
  if (
    existingDesktopPreview
    && existingDesktopPreview.publicHost.trim().toLowerCase() !== previewAccess.publicHost.trim().toLowerCase()
  ) {
    previewSessionService.close(existingDesktopPreview.id, 'unknown')
    previewId = crypto.randomUUID()
    previewAccess = buildDesktopPreviewAccessTarget({
      requestUrl: params.requestUrl,
      headers: params.requestHeaders,
      projectName: params.project.name,
      previewId,
      executor,
    })
  }

  const created = previewSessionService.createOrReuseSession({
    previewId,
    purpose: DESKTOP_PREVIEW_PURPOSE,
    projectId: params.project.id,
    taskId: params.task.id,
    workspaceId: params.context.workspace.id,
    workspaceSessionId: params.context.session.id,
    executorId: params.context.executorId,
    ownerUserId: params.ownerUserId,
    source: resolvedSource.source,
    additionalSources: [],
    publicHost: previewAccess.publicHost,
    publicUrl: previewAccess.publicUrl,
  })
  logDesktopSandboxPreview('session resolved', {
    taskId: params.task.id,
    workspaceId: params.context.workspace.id,
    workspaceSessionId: params.context.session.id,
    executorId: params.context.executorId,
    previewSessionId: created.session.id,
    created: created.created,
    status: created.session.status,
    tunnelClientStatus: created.session.tunnelClientStatus,
    publicHost: created.session.publicHost,
    sourceAppUrl: resolvedSource.source.appUrl,
  })

  let session = created.session
  let tunnelToken: string | null = created.created ? created.tunnelToken : null
  if (!created.created && (session.status !== 'active' || session.tunnelClientStatus !== 'open')) {
    tunnelToken = previewSessionService.rotateTunnelToken(session.id)
    session = previewSessionService.getSessionById(session.id) ?? session
    logDesktopSandboxPreview('tunnel token rotated', {
      previewSessionId: session.id,
      executorId: params.context.executorId,
      status: session.status,
      tunnelClientStatus: session.tunnelClientStatus,
    })
  }

  if (tunnelToken) {
    const { executorWsService } = await import('../control-plane/executor-ws-service')
    logDesktopSandboxPreview('dispatching tunnel open', {
      previewSessionId: session.id,
      executorId: params.context.executorId,
      tunnelUrl: describeTunnelUrl(previewAccess.tunnelUrl),
      targetUrl: resolvedSource.source.appUrl,
    })
    const dispatched = executorWsService.dispatchTask(params.context.executorId, {
      type: 'preview.tunnel.open',
      previewSessionId: session.id,
      tunnelUrl: previewAccess.tunnelUrl,
      tunnelToken,
      targetUrl: resolvedSource.source.appUrl,
      injectNavigationBridge: true,
      at: new Date().toISOString(),
    })
    logDesktopSandboxPreview(dispatched ? 'tunnel open dispatched' : 'tunnel open dispatch failed', {
      previewSessionId: session.id,
      executorId: params.context.executorId,
    })
    if (!dispatched) {
      previewSessionService.markError(session.id, '执行器当前不在线，无法建立 Desktop preview tunnel。')
      throw new Error('执行器当前不在线，无法建立 Desktop preview tunnel。')
    }
    session = previewSessionService.getSessionById(session.id) ?? session
  }

  const viewer = previewSessionService.issueViewerAccess(session.id)
  if (!viewer) {
    throw new Error('Desktop preview viewer token 创建失败。')
  }

  const viewUrl = buildDesktopViewUrl({
    viewerIframeUrl: viewer.iframeUrl,
    password: desktop.password || resolvedSource.password,
    displayProfile: desktop.effectiveDisplayProfile || desktop.displayProfile,
    viewerPath: resolvedSource.viewerPath,
    websocketPath: resolvedSource.websocketPath,
  })

  return {
    ...desktop,
    viewUrl,
    previewId: session.id,
    previewHost: session.publicHost,
    streamRedirectUrl: viewUrl,
  }
}

const closeDesktopPreviewTunnel = (params: {
  taskId: string
  workspaceId: string
  executorId: string
  ownerUserId: string
}) => {
  const session = previewSessionService.getOwnerSessionForTaskWorkspace({
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    ownerUserId: params.ownerUserId,
    purpose: DESKTOP_PREVIEW_PURPOSE,
  })
  if (!session) {
    return
  }

  void import('../control-plane/executor-ws-service').then(({ executorWsService }) => {
    executorWsService.dispatchTask(params.executorId, {
      type: 'preview.tunnel.close',
      previewSessionId: session.id,
      at: new Date().toISOString(),
    })
  })
  previewSessionService.close(session.id, 'stopped_by_user')
}

export const registerDesktopSandboxRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.use('/api/tasks/:id/desktop-sandbox/*', requireDesktopSandboxDevOnlyAccess)

  const resolveRequestContext = (params: {
    userId: string
    taskId: string
    workspaceId?: string
    workspaceSessionId?: string
  }) => {
    const state = loadState()
    const taskResult = getAuthorizedTask(state, params.userId, params.taskId)
    if (!taskResult.task || !taskResult.project) {
      return {
        ok: false as const,
        message: taskResult.message,
        status: taskResult.status,
      }
    }

    const context = resolveDesktopSandboxContext({
      userId: params.userId,
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: params.workspaceId,
      workspaceSessionId: params.workspaceSessionId,
    })
    if (!context) {
      return {
        ok: false as const,
        message: '工作区会话不存在，或当前工作区会话没有可用执行节点。',
        status: 404 as const,
      }
    }

    return {
      ok: true as const,
      task: taskResult.task,
      project: taskResult.project,
      context,
    }
  }

  app.get('/api/tasks/:id/desktop-sandbox/current', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = desktopSandboxScopeSchema.parse(c.req.query())
    const resolved = resolveRequestContext({
      userId,
      taskId: c.req.param('id'),
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!resolved.ok) {
      return jsonError(c, resolved.message, resolved.status)
    }

    return c.json({
      desktop: await executeDesktopSandboxRequest({
        task: resolved.task,
        project: resolved.project,
        ownerUserId: userId,
        context: resolved.context,
        request: { operation: 'status' },
        requestUrl: c.req.url,
        requestHeaders: c.req.raw.headers,
      }),
    })
  })

  app.post('/api/tasks/:id/desktop-sandbox/open', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = desktopSandboxStartSchema.parse(await c.req.json().catch(() => ({})))
    const resolved = resolveRequestContext({
      userId,
      taskId: c.req.param('id'),
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!resolved.ok) {
      return jsonError(c, resolved.message, resolved.status)
    }

    return c.json({
      desktop: await executeDesktopSandboxRequest({
        task: resolved.task,
        project: resolved.project,
        ownerUserId: userId,
        context: resolved.context,
        request: {
          operation: 'start',
          displayProfile: payload.displayProfile,
          clientNetwork: payload.clientNetwork,
        },
        requestUrl: c.req.url,
        requestHeaders: c.req.raw.headers,
      }),
    })
  })

  app.post('/api/tasks/:id/desktop-sandbox/stop', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = desktopSandboxScopeSchema.parse(await c.req.json().catch(() => ({})))
    const resolved = resolveRequestContext({
      userId,
      taskId: c.req.param('id'),
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!resolved.ok) {
      return jsonError(c, resolved.message, resolved.status)
    }

    const desktop = await executeDesktopSandboxRequest({
      task: resolved.task,
      project: resolved.project,
      ownerUserId: userId,
      context: resolved.context,
      request: { operation: 'stop' },
      requestUrl: c.req.url,
      requestHeaders: c.req.raw.headers,
    })
    closeDesktopPreviewTunnel({
      taskId: resolved.task.id,
      workspaceId: resolved.context.workspace.id,
      executorId: resolved.context.executorId,
      ownerUserId: userId,
    })

    return c.json({ desktop })
  })

  app.post('/api/tasks/:id/desktop-sandbox/action', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = desktopSandboxActionSchema.parse(await c.req.json())
    const resolved = resolveRequestContext({
      userId,
      taskId: c.req.param('id'),
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!resolved.ok) {
      return jsonError(c, resolved.message, resolved.status)
    }

    return c.json({
      desktop: await executeDesktopSandboxRequest({
        task: resolved.task,
        project: resolved.project,
        ownerUserId: userId,
        context: resolved.context,
        request: { operation: 'desktop.action', action: payload.action },
        requestUrl: c.req.url,
        requestHeaders: c.req.raw.headers,
      }),
    })
  })

  app.post('/api/tasks/:id/desktop-sandbox/command', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = desktopSandboxCommandSchema.parse(await c.req.json())
    const resolved = resolveRequestContext({
      userId,
      taskId: c.req.param('id'),
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!resolved.ok) {
      return jsonError(c, resolved.message, resolved.status)
    }

    return c.json({
      desktop: await executeDesktopSandboxRequest({
        task: resolved.task,
        project: resolved.project,
        ownerUserId: userId,
        context: resolved.context,
        request: { operation: 'command', command: payload.command },
        requestUrl: c.req.url,
        requestHeaders: c.req.raw.headers,
      }),
    })
  })
}
