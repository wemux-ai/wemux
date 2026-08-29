// [INPUT]: 已鉴权 Hono app，preview 打开/停止/分享请求
// [OUTPUT]: /api/tasks/:id/preview/*、/api/previews/* 路由（open/stop/share/revoke）
// [POS]: 工作区预览 HTTP 协议层（open/stop/share）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import {
  createWorkspaceEnvironmentStatusSnapshot,
  getWorkspaceEnvironmentProbeUrl,
  resolveWorkspaceEnvironmentStatusFromProbe,
} from '@shared/task-environment'
import { resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type {
  CreatePreviewShareRequest,
  GetPreviewResponse,
  GetTaskPreviewResponse,
  OpenPreviewRequest,
  OpenPreviewResponse,
  Project,
  ResolveWorkspacePreviewSourceResponse,
  RevokePreviewShareResponse,
  StopPreviewResponse,
  Task,
  WorkspaceSession,
  Workspace,
} from '@shared/types'
import type { PreviewAdditionalSourceBinding } from '../services/preview-session-record'
import { executorRegistry } from '../control-plane/executor-registry'
import { executorWsService } from '../control-plane/executor-ws-service'
import { refreshProjectVersionControlFromExecutor } from '../control-plane/executor-repo-service'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { buildPreviewHost, buildPreviewPublicUrl, resolveExternalRequestScheme, toPreviewTunnelWsUrl } from '../services/preview-hostname'
import { canUseExecutorPreviewPublicProxy } from '../services/preview-public-proxy'
import { resolvePreviewAccessRoute } from '../services/executor-mesh-route-service'
import { previewSessionService } from '../services/preview-session-service'
import {
  buildRuntimeEnvironmentReferenceContext,
  resolveScopedRuntimeEnvironment,
} from '../services/runtime-environment-service'
import { getWorkspaceEnvironmentTemplate } from '../services/workspace-environment-template-service'
import { resolveWorkspaceRepoPath } from '../services/workspace-repo-path'
import { loadState } from '../storage/app-state-store'
import { getAuthorizedTask, getUserIdFromHeader, jsonError } from './shared'
import {
  getWorkspaceSessionRecordForTaskContext,
  listProjectWorkspacesForUser,
  listWorkspaceSessionsForTaskContext,
  hydrateWorkspaceSessionWithLocalWorktree,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd,
  resolveWorkspaceWorkingDirectoryMode,
  saveWorkspaceDirectorySessions,
} from './task-route-support'

const openPreviewSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
  autoStart: z.boolean().optional(),
  meshSourceExecutorId: z.string().trim().min(1).optional(),
})

const getCurrentPreviewSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
  meshSourceExecutorId: z.string().trim().min(1).optional(),
  expectedExecutorId: z.string().trim().min(1).optional(),
})

const getPreviewRouteSchema = z.object({
  meshSourceExecutorId: z.string().trim().min(1).optional(),
})

const resolveWorkspacePreviewSourceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  meshSourceExecutorId: z.string().trim().min(1).optional(),
})

const sharePreviewSchema = z.object({
  expiresInMinutes: z.number().int().min(5).max(10080).optional(),
})

const logPreviewOpen = (message: string, details: Record<string, unknown>) => {
  console.log('[preview-open]', message, details)
}

const describeTunnelUrl = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return 'invalid-url'
  }
}

const dispatchPreviewIngressRegistration = (params: {
  executorId: string
  previewSessionId: string
  workspaceId: string
  publicHost: string
  targetUrl: string
  additionalTargetUrls: string[]
  transport: 'gateway-public-proxy'
}) => {
  return executorWsService.dispatchTask(params.executorId, {
    type: 'preview.ingress.register',
    previewSessionId: params.previewSessionId,
    workspaceId: params.workspaceId,
    publicHost: params.publicHost,
    targetUrl: params.targetUrl,
    additionalTargetUrls: params.additionalTargetUrls,
    transport: params.transport,
    at: new Date().toISOString(),
  })
}

const dispatchPreviewIngressUnregister = (params: {
  executorId: string
  previewSessionId: string
}) => {
  return executorWsService.dispatchTask(params.executorId, {
    type: 'preview.ingress.unregister',
    previewSessionId: params.previewSessionId,
    at: new Date().toISOString(),
  })
}

const resolvePreviewAccessMode = (executorId: string) => {
  if (canUseExecutorPreviewPublicProxy(executorId)) {
    return 'public-proxy' as const
  }
  return 'tunnel' as const
}

const isAllowedPreviewHost = (hostname: string) => {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
}

const resolvePreviewContext = (params: {
  userId: string
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}) => {
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
  const resolvedWorkspaceId = session?.workspaceId ?? requestedWorkspaceId
  const workspace = resolvedWorkspaceId
    ? workspaces.find((item) => item.id === resolvedWorkspaceId) ?? null
    : null

  if (!workspace || !session || session.workspaceId !== workspace.id) {
    return null
  }

  const executorId = resolveWorkspaceSessionExecutorId(session, workspace.executorNodeId)
  if (!executorId) {
    return null
  }

  const executor = executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
  const workspaceRoot = executor?.workspaceRoot
  const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
    resolveEffectiveWorkspaceWorktreeSession(params.task.id, session, workspace.executorNodeId),
    workspace,
  )
  const cwd = resolveWorkspaceSessionCwd(workspaceRoot, params.project, effectiveWorktreeSession, workspace)
  if (!cwd) {
    return null
  }

  return {
    workspace,
    session,
    executorId,
    executor,
    cwd,
  }
}

const resolvePreviewSource = (params: {
  appUrl: string
  healthUrl?: string
}) => {
  const url = new URL(params.appUrl)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isAllowedPreviewHost(url.hostname)) {
    return null
  }

  return {
    appUrl: params.appUrl,
    healthUrl: params.healthUrl,
    targetProtocol: url.protocol === 'https:' ? 'https' as const : 'http' as const,
    targetHost: url.hostname,
    targetPort: Number(url.port || (url.protocol === 'https:' ? '443' : '80')),
    targetBasePath: url.pathname || '/',
  }
}

const resolveAdditionalPreviewSources = (appUrls: string[]) => {
  const sources = appUrls
    .map((appUrl) => resolvePreviewSource({ appUrl }))
    .filter((item): item is NonNullable<ReturnType<typeof resolvePreviewSource>> => Boolean(item))
  const deduped = new Map<string, (typeof sources)[number]>()
  for (const source of sources) {
    deduped.set(source.appUrl, source)
  }
  return Array.from(deduped.values())
}

type ResolvedPreviewSource = NonNullable<ReturnType<typeof resolvePreviewSource>>
type ResolvedPreviewDomainBinding = NonNullable<ReturnType<typeof resolveProjectEnvironmentPreview>>['domainBindings'][number]

const normalizeConfiguredPreviewHost = (domain?: string) => {
  const trimmed = domain?.trim()
  if (!trimmed) {
    return ''
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    return url.host.toLowerCase()
  } catch {
    return ''
  }
}

const buildPublicUrlForHost = (params: {
  requestUrl: string
  headers: Headers
  publicHost: string
}) => {
  const scheme = resolveExternalRequestScheme({
    requestUrl: params.requestUrl,
    headers: params.headers,
  })
  return `${scheme}://${params.publicHost}/`
}

const buildPreviewSourceBinding = (params: {
  requestUrl: string
  headers: Headers
  projectName: string
  previewId: string
  executor?: Parameters<typeof buildPreviewHost>[0]['executor']
  source: ResolvedPreviewSource
  domainBinding?: ResolvedPreviewDomainBinding
  fallbackProjectName?: string
}): PreviewAdditionalSourceBinding => {
  const configuredHost = normalizeConfiguredPreviewHost(params.domainBinding?.domain)
  const projectName = params.fallbackProjectName ?? params.projectName
  const publicHost = configuredHost || buildPreviewHost({
    requestUrl: params.requestUrl,
    headers: params.headers,
    projectName,
    previewId: params.previewId,
    executor: params.executor,
  })
  const publicUrl = configuredHost
    ? buildPublicUrlForHost({
        requestUrl: params.requestUrl,
        headers: params.headers,
        publicHost,
      })
    : buildPreviewPublicUrl({
        requestUrl: params.requestUrl,
        headers: params.headers,
        projectName,
        previewId: params.previewId,
        executor: params.executor,
      })

  return {
    id: params.domainBinding?.id,
    appUrl: params.source.appUrl,
    publicHost,
    publicUrl,
    port: params.domainBinding?.port ?? params.source.targetPort,
    note: params.domainBinding?.note,
    domainType: params.domainBinding?.type,
  }
}

const buildAdditionalPreviewSourceBindings = (params: {
  requestUrl: string
  headers: Headers
  projectName: string
  previewId: string
  executor?: Parameters<typeof buildPreviewHost>[0]['executor']
  sources: ResolvedPreviewSource[]
  domainBindings?: ResolvedPreviewDomainBinding[]
}) => {
  const sourcesByAppUrl = new Map(params.sources.map((source) => [source.appUrl, source]))
  const domainBindings = params.domainBindings?.filter((binding) => !binding.primary) ?? []
  if (domainBindings.length > 0) {
    return domainBindings
      .map((domainBinding, index) => {
        const source = sourcesByAppUrl.get(domainBinding.appUrl)
        if (!source) {
          return null
        }
        const portLabel = source.targetPort ? `-${source.targetPort}` : ''
        return buildPreviewSourceBinding({
          requestUrl: params.requestUrl,
          headers: params.headers,
          projectName: params.projectName,
          previewId: params.previewId,
          executor: params.executor,
          source,
          domainBinding,
          fallbackProjectName: `${params.projectName}${domainBinding.note ? `-${domainBinding.note}` : portLabel || `-${index + 1}`}`,
        })
      })
      .filter((binding): binding is PreviewAdditionalSourceBinding => Boolean(binding))
  }

  return params.sources
    .filter((source) => !params.domainBindings?.some((binding) => binding.primary && binding.appUrl === source.appUrl))
    .map<PreviewAdditionalSourceBinding>((source, index) => {
      const portLabel = source.targetPort ? `-${source.targetPort}` : ''
      return buildPreviewSourceBinding({
        requestUrl: params.requestUrl,
        headers: params.headers,
        projectName: params.projectName,
        previewId: params.previewId,
        executor: params.executor,
        source,
        fallbackProjectName: `${params.projectName}${portLabel || `-${index + 1}`}`,
      })
    })
}

const probePreviewSource = async (params: {
  executorId: string
  source: {
    appUrl: string
    healthUrl?: string
  }
}) => {
  const url = getWorkspaceEnvironmentProbeUrl(params.source)
  if (!url) {
    return createWorkspaceEnvironmentStatusSnapshot({
      status: 'unsupported',
      message: '当前环境模板没有配置可探测地址。',
    })
  }

  try {
    const probe = await executorWsService.requestHttpProbe(params.executorId, url, { timeoutMs: 8000 })
    return resolveWorkspaceEnvironmentStatusFromProbe({
      probe,
      url,
    })
  } catch (error) {
    return createWorkspaceEnvironmentStatusSnapshot({
      status: 'error',
      message: error instanceof Error ? error.message : '环境地址探测失败。',
      url,
    })
  }
}

export const runPreviewEnvironmentCommand = async (params: {
  executorId: string
  command?: string
  cwd: string
  mode?: 'wait' | 'background'
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
}) => {
  if (!params.command?.trim()) {
    return { ok: true as const, output: '' }
  }

  const result = await executorWsService.requestTerminalCommand(params.executorId, params.command, params.cwd, {
    mode: params.mode,
    runtimeEnvironment: params.runtimeEnvironment,
  })
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').trim()
  return {
    ok: result.exitCode === 0,
    output,
  }
}

const resolveTaskGitIdentitySafely = async (userId: string, project: Project) => {
  try {
    return await resolveUserProjectGitIdentity({
      userId,
      projectId: project.id,
      mode: 'personal',
      repoUrl: project.gitUrl,
    })
  } catch {
    return undefined
  }
}

const ensurePreviewWorkspaceDirectory = async (params: {
  state: ReturnType<typeof loadState>
  userId: string
  task: Task
  project: Project
  workspace: Workspace
  session: WorkspaceSession
  executorId: string
  cwd: string
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
}) => {
  const effectiveProject = await refreshProjectVersionControlFromExecutor(params.userId, params.project, params.executorId)
  const executorWorkspaceRoot = executorRegistry.getExecutor(params.executorId)?.workspaceRoot?.trim()
  const workspaceRoot = executorWorkspaceRoot || params.state.config.workspaceRoot
  const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
    resolveEffectiveWorkspaceWorktreeSession(params.task.id, params.session, params.workspace.executorNodeId),
    params.workspace,
  )
  const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(params.workspace, effectiveWorktreeSession)
  const worktreeDirectoryReady = workingDirectoryMode === 'worktree' && effectiveWorktreeSession.worktreeStatus === 'created'
    ? await executorWsService.requestDirectoryBrowse(params.executorId, params.cwd, params.cwd, 5000)
      .then((result) => result.ok)
      .catch(() => false)
    : false
  const shouldEnsureWorkspaceDirectory = effectiveProject.versionControl !== 'none'
    && (workingDirectoryMode === 'original-dir' || effectiveWorktreeSession.worktreeStatus !== 'created' || !worktreeDirectoryReady)

  if (!shouldEnsureWorkspaceDirectory) {
    return {
      ok: true as const,
      session: params.session,
      cwd: params.cwd,
    }
  }

  const repoPath = resolveWorkspaceRepoPath({
    project: effectiveProject,
    workspaceRoot,
    workspace: params.workspace,
    session: effectiveWorktreeSession,
  })
  const preferredBranch = effectiveWorktreeSession.baseBranch?.trim()
    || params.task.baseBranchHint?.trim()
    || params.workspace.suggestedBaseBranch?.trim()
    || params.workspace.defaultBranch?.trim()
    || effectiveProject.defaultBranch
  const result = await executorWsService.requestWorktreeEnsure(params.executorId, {
    workspaceId: params.workspace.id,
    ownerUserId: params.workspace.ownerUserId ?? params.userId,
    repoPath,
    repoUrl: effectiveProject.gitUrl?.trim() || undefined,
    preferredBranch,
    branchName: effectiveWorktreeSession.branchName,
    worktreePath: params.cwd,
    workingDirectoryMode,
    gitIdentity: await resolveTaskGitIdentitySafely(params.userId, effectiveProject),
    runtimeEnvironment: params.runtimeEnvironment,
  }).catch((error) => ({
    ok: false as const,
    message: error instanceof Error ? error.message : '预览前准备工作目录失败。',
  }))

  if (!result.ok) {
    return {
      ok: false as const,
      message: result.message,
    }
  }

  const ensuredCwd = result.worktreePath?.trim() || params.cwd
  const nextSession = saveWorkspaceDirectorySessions({
    task: params.task,
    currentSession: params.session,
    effectiveSession: effectiveWorktreeSession,
    patch: {
      worktreeStatus: 'created',
      updatedAt: new Date().toISOString(),
    },
  })

  return {
    ok: true as const,
    session: nextSession,
    cwd: ensuredCwd,
  }
}

const shouldRunPreviewStartCommand = (params: {
  autoStart?: boolean
  created: boolean
  sessionStatus: 'opening' | 'waiting_tunnel' | 'active' | 'stopping' | 'closed' | 'error'
  tunnelClientStatus?: 'connecting' | 'open' | 'closed' | 'error'
  startCommand?: string
}) => {
  if (params.autoStart === false || !params.startCommand?.trim()) {
    return false
  }

  if (params.created) {
    return true
  }

  if (params.sessionStatus === 'error' || params.sessionStatus === 'closed') {
    return true
  }

  return params.tunnelClientStatus === 'closed' || params.tunnelClientStatus === 'error'
}

const resolvePreviewWorkspaceScope = (params: {
  userId: string
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const workspaces = listProjectWorkspacesForUser(params.userId, params.project)
  const sessions = listWorkspaceSessionsForTaskContext(params.task.id)
  const requestedWorkspaceSessionId = params.workspaceSessionId?.trim()
  const session = requestedWorkspaceSessionId
    ? sessions.find((item) => item.id === requestedWorkspaceSessionId) ?? null
    : null
  const workspaceId = params.workspaceId?.trim() || session?.workspaceId || ''
  const workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId) ?? null
    : null

  if (!workspace) {
    return null
  }
  if (session && session.workspaceId !== workspace.id) {
    return null
  }

  return {
    workspace,
    session,
  }
}

const ensurePreviewEnvironmentStarted = async (params: {
  executorId: string
  sessionId: string
  source: {
    appUrl: string
    healthUrl?: string
  }
  startCommand?: string
  cwd: string
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
}) => {
  const probeStatus = await probePreviewSource({
    executorId: params.executorId,
    source: params.source,
  })
  if (probeStatus.status === 'running') {
    return { ok: true as const }
  }

  const started = await runPreviewEnvironmentCommand({
    executorId: params.executorId,
    command: params.startCommand,
    cwd: params.cwd,
    mode: 'background',
    runtimeEnvironment: params.runtimeEnvironment,
  }).catch((error) => ({
    ok: false as const,
    output: error instanceof Error ? error.message : '环境启动失败。',
  }))

  if (!started.ok) {
    previewSessionService.markError(params.sessionId, started.output || '环境启动失败。')
    return {
      ok: false as const,
      message: started.output || '环境启动失败。',
    }
  }

  return { ok: true as const }
}

export const registerPreviewRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/tasks/:id/preview/current', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = getCurrentPreviewSchema.parse(c.req.query())
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) {
      return jsonError(c, taskResult.message, taskResult.status)
    }

    const scope = resolvePreviewWorkspaceScope({
      userId,
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!scope) {
      return c.json({ message: '工作区不存在。' }, 404)
    }

    const session = previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: taskResult.task.id,
      workspaceId: scope.workspace.id,
      ownerUserId: userId,
      executorId: payload.expectedExecutorId,
    })
    if (!session) {
      const response: GetTaskPreviewResponse = {
        preview: null,
        viewer: null,
      }
      return c.json(response)
    }

    const viewer = previewSessionService.issueViewerAccess(session.id)
    if (!viewer) {
      return c.json({ message: 'preview viewer token 创建失败。' }, 500)
    }

    const response: GetTaskPreviewResponse = {
      preview: previewSessionService.toDto(session),
      viewer,
      accessRoute: resolvePreviewAccessRoute({
        session,
        sourceExecutorId: payload.meshSourceExecutorId,
      }),
    }
    return c.json(response)
  })

  app.post('/api/tasks/:id/preview/open', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = openPreviewSchema.parse(await c.req.json().catch(() => ({}))) as OpenPreviewRequest
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) {
      return jsonError(c, taskResult.message, taskResult.status)
    }

    const context = resolvePreviewContext({
      userId,
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!context) {
      return c.json({ message: '工作区会话不存在，或当前工作区会话没有可用执行节点。' }, 404)
    }

    const prepareReferenceContext = buildRuntimeEnvironmentReferenceContext({
      platform: {
        project: taskResult.project,
        workspace: context.workspace,
        workspaceSession: context.session,
        task: taskResult.task,
        executor: context.executor,
      },
      missingPlatformVariable: 'preserve',
    })
    // Prepare-phase resolve: allow missing preview.* so workspace setup does not fail before publicUrl exists.
    const prepareRuntimeEnvironment = await resolveScopedRuntimeEnvironment({
      workspaceId: context.workspace.id,
      referenceContext: prepareReferenceContext,
    })
      .then((value) => value?.payload)
      .catch(() => undefined)
    const prepared = await ensurePreviewWorkspaceDirectory({
      state,
      userId,
      task: taskResult.task,
      project: taskResult.project,
      workspace: context.workspace,
      session: context.session,
      executorId: context.executorId,
      cwd: context.cwd,
      runtimeEnvironment: prepareRuntimeEnvironment,
    })
    if (!prepared.ok) {
      return c.json({ message: prepared.message }, 502)
    }
    context.session = prepared.session
    context.cwd = prepared.cwd

    const workspaceEnvironmentTemplate = await getWorkspaceEnvironmentTemplate(context.workspace.id)
    const preview = resolveProjectEnvironmentPreview({
      project: taskResult.project,
      session: context.session,
      cwd: context.cwd,
      workspaceEnvironmentTemplate,
    })
    if (!preview?.appUrl) {
      return c.json({ message: '当前环境模板没有配置应用地址。' }, 422)
    }

    const source = resolvePreviewSource({
      appUrl: preview.appUrl,
      healthUrl: preview.healthUrl,
    })
    if (!source) {
      return c.json({ message: '当前应用地址不是受支持的本地 HTTP 预览地址。' }, 422)
    }

    const previewId = crypto.randomUUID()
    const additionalSources = resolveAdditionalPreviewSources(
      preview.additionalAppUrls?.filter((item) => item !== preview.appUrl) ?? [],
    )
    const primaryDomainBinding = preview.domainBindings.find((binding) => binding.primary) ?? preview.domainBindings[0]
    const sourceBinding = buildPreviewSourceBinding({
      requestUrl: c.req.url,
      headers: c.req.raw.headers,
      projectName: taskResult.project.name,
      previewId,
      executor: context.executor,
      source,
      domainBinding: primaryDomainBinding,
    })
    const additionalSourceBindings = buildAdditionalPreviewSourceBindings({
      requestUrl: c.req.url,
      headers: c.req.raw.headers,
      projectName: taskResult.project.name,
      previewId,
      executor: context.executor,
      sources: [source, ...additionalSources],
      domainBindings: preview.domainBindings,
    })
    const publicHost = sourceBinding.publicHost
    const publicUrl = sourceBinding.publicUrl
    // Final resolve after publicUrl is known: missing preview platform vars must fail loudly.
    let runtimeEnvironment = prepareRuntimeEnvironment
    try {
      const finalResolved = await resolveScopedRuntimeEnvironment({
        workspaceId: context.workspace.id,
        referenceContext: buildRuntimeEnvironmentReferenceContext({
          platform: {
            project: taskResult.project,
            workspace: context.workspace,
            workspaceSession: context.session,
            task: taskResult.task,
            executor: context.executor,
            preview: {
              publicUrl,
              publicHost,
              port: sourceBinding.port ?? source.targetPort,
            },
          },
          missingPlatformVariable: 'error',
        }),
      })
      runtimeEnvironment = finalResolved?.payload
    } catch (error) {
      const message = error instanceof Error ? error.message : '环境变量引用解析失败。'
      return c.json({ message }, 422)
    }
    const accessMode = resolvePreviewAccessMode(context.executorId)
    const existingPreview = previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: taskResult.task.id,
      workspaceId: context.workspace.id,
      ownerUserId: userId,
      executorId: context.executorId,
    })
    if (existingPreview && existingPreview.accessMode !== accessMode) {
      if (existingPreview.accessMode === 'public-proxy') {
        dispatchPreviewIngressUnregister({
          executorId: context.executorId,
          previewSessionId: existingPreview.id,
        })
      } else {
        executorWsService.dispatchTask(context.executorId, {
          type: 'preview.tunnel.close',
          previewSessionId: existingPreview.id,
          at: new Date().toISOString(),
        })
      }
      previewSessionService.close(existingPreview.id, accessMode === 'public-proxy' ? 'replaced_by_public_proxy' : 'replaced_by_tunnel')
      logPreviewOpen('closed stale preview with mismatched access mode', {
        taskId: taskResult.task.id,
        workspaceId: context.workspace.id,
        workspaceSessionId: context.session.id,
        executorId: context.executorId,
        previewSessionId: existingPreview.id,
        previousAccessMode: existingPreview.accessMode,
        nextAccessMode: accessMode,
      })
    }

    const created = previewSessionService.createOrReuseSession({
      previewId,
      projectId: taskResult.project.id,
      taskId: taskResult.task.id,
      workspaceId: context.workspace.id,
      workspaceSessionId: context.session.id,
      executorId: context.executorId,
      ownerUserId: userId,
      source,
      sourceBinding,
      additionalSources,
      additionalSourceBindings,
      publicHost,
      publicUrl,
      accessMode,
    })
    logPreviewOpen('session resolved', {
      taskId: taskResult.task.id,
      workspaceId: context.workspace.id,
      workspaceSessionId: context.session.id,
      executorId: context.executorId,
      previewSessionId: created.session.id,
      created: created.created,
      status: created.session.status,
      tunnelClientStatus: created.session.tunnelClientStatus,
      publicHost: created.session.publicHost,
      sourceAppUrl: source.appUrl,
    })

    if (shouldRunPreviewStartCommand({
      autoStart: payload.autoStart,
      created: created.created,
      sessionStatus: created.session.status,
      tunnelClientStatus: created.session.tunnelClientStatus,
      startCommand: preview.startCommand,
    })) {
      const started = await ensurePreviewEnvironmentStarted({
        executorId: context.executorId,
        sessionId: created.session.id,
        source,
        cwd: context.cwd,
        startCommand: preview.startCommand,
        runtimeEnvironment,
      })
      if (!started.ok) {
        logPreviewOpen('start command failed', {
          previewSessionId: created.session.id,
          executorId: context.executorId,
          message: started.message,
        })
        return c.json({ message: started.message }, 502)
      }
    }

    let session = created.session
    const additionalTargetUrls = [...new Set(additionalSources.map((item) => item.appUrl))]
    let viewer = null
    if (session.accessMode === 'public-proxy') {
      const dispatched = dispatchPreviewIngressRegistration({
        executorId: context.executorId,
        previewSessionId: session.id,
        workspaceId: session.workspaceId,
        publicHost: session.publicHost,
        targetUrl: source.appUrl,
        additionalTargetUrls,
        transport: 'gateway-public-proxy',
      })
      logPreviewOpen(dispatched ? 'public ingress register dispatched' : 'public ingress register dispatch failed', {
        previewSessionId: session.id,
        executorId: context.executorId,
      })
      if (!dispatched) {
        previewSessionService.markError(session.id, '执行器当前不在线，无法注册公网 preview ingress。')
        return c.json({ message: '执行器当前不在线，无法注册公网 preview ingress。' }, 502)
      }
      previewSessionService.markActive(
        session.id,
        'managed-cloud',
        session.accessMode,
      )
      session = previewSessionService.getSessionById(session.id) ?? session
      viewer = viewer ?? previewSessionService.issueViewerAccess(session.id)
    } else {
      let tunnelToken: string | null = created.created ? created.tunnelToken : null
      if (!created.created && (session.status !== 'active' || session.tunnelClientStatus !== 'open')) {
        tunnelToken = previewSessionService.rotateTunnelToken(session.id)
        session = previewSessionService.getSessionById(session.id) ?? session
        logPreviewOpen('tunnel token rotated', {
          previewSessionId: session.id,
          executorId: context.executorId,
          status: session.status,
          tunnelClientStatus: session.tunnelClientStatus,
        })
      }

      if (tunnelToken) {
        const tunnelUrl = toPreviewTunnelWsUrl({
          requestUrl: c.req.url,
          headers: c.req.raw.headers,
          executor: context.executor,
        })
        logPreviewOpen('dispatching tunnel open', {
          previewSessionId: session.id,
          executorId: context.executorId,
          tunnelUrl: describeTunnelUrl(tunnelUrl),
          targetUrl: source.appUrl,
        })
        const dispatched = executorWsService.dispatchTask(context.executorId, {
          type: 'preview.tunnel.open',
          previewSessionId: session.id,
          workspaceId: session.workspaceId,
          tunnelUrl,
          tunnelToken,
          targetUrl: source.appUrl,
          injectNavigationBridge: true,
          at: new Date().toISOString(),
        })
        logPreviewOpen(dispatched ? 'tunnel open dispatched' : 'tunnel open dispatch failed', {
          previewSessionId: session.id,
          executorId: context.executorId,
        })
        if (!dispatched) {
          previewSessionService.markError(session.id, '执行器当前不在线，无法建立 preview tunnel。')
          return c.json({ message: '执行器当前不在线，无法建立 preview tunnel。' }, 502)
        }
        session = previewSessionService.getSessionById(session.id) ?? session
      }
      viewer = previewSessionService.issueViewerAccess(session.id)
    }

    if (!viewer) {
      return c.json({ message: 'preview viewer token 创建失败。' }, 500)
    }

    const response: OpenPreviewResponse = {
      preview: previewSessionService.toDto(session),
      viewer,
      accessRoute: resolvePreviewAccessRoute({
        session,
        sourceExecutorId: payload.meshSourceExecutorId,
        targetExecutor: context.executor,
      }),
    }
    return c.json(response)
  })

  app.get('/api/previews/:previewId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = getPreviewRouteSchema.parse(c.req.query())
    const session = previewSessionService.getOwnerSession(c.req.param('previewId'), userId)
    if (!session) {
      return c.json({ message: 'Preview 不存在。' }, 404)
    }

    const viewer = previewSessionService.issueViewerAccess(session.id)
    if (!viewer) {
      return c.json({ message: 'preview viewer token 创建失败。' }, 500)
    }

    const response: GetPreviewResponse = {
      preview: previewSessionService.toDto(session),
      viewer,
      accessRoute: resolvePreviewAccessRoute({
        session,
        sourceExecutorId: payload.meshSourceExecutorId,
      }),
    }
    return c.json(response)
  })

  app.get('/api/workspaces/:workspaceId/preview-source', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = resolveWorkspacePreviewSourceSchema.parse({
      workspaceId: c.req.param('workspaceId'),
      ...c.req.query(),
    })
    const session = previewSessionService.listActiveSessionsForWorkspaces([payload.workspaceId]).get(payload.workspaceId)
    if (!session || session.ownerUserId !== userId) {
      return c.json({ message: '当前工作区没有可用预览。' }, 404)
    }

    const preview = previewSessionService.toDto(session)
    const matchedAdditionalSource = preview.additionalSourceAppUrls.find((source) => source.port === payload.port)
    const sourceAppUrl = matchedAdditionalSource?.appUrl || (preview.domainBindings?.[0]?.port === payload.port ? preview.sourceAppUrl : '')
    if (!sourceAppUrl) {
      return c.json({ message: '当前工作区没有这个预览端口。' }, 404)
    }

    const viewer = previewSessionService.issueViewerAccess(session.id)
    if (!viewer) {
      return c.json({ message: 'preview viewer token 创建失败。' }, 500)
    }

    const sourceViewerUrl = viewer.additionalSourceAccess?.find((source) => source.port === payload.port)?.iframeUrl
      || (preview.domainBindings?.[0]?.port === payload.port ? viewer.iframeUrl : '')
    if (!sourceViewerUrl) {
      return c.json({ message: '当前预览端口入口不可用。' }, 404)
    }

    const response: ResolveWorkspacePreviewSourceResponse = {
      preview,
      viewer,
      sourceAppUrl,
      sourceViewerUrl,
      accessRoute: resolvePreviewAccessRoute({
        session,
        sourceExecutorId: payload.meshSourceExecutorId,
      }),
    }
    return c.json(response)
  })

  app.post('/api/previews/:previewId/stop', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const session = previewSessionService.getOwnerSession(c.req.param('previewId'), userId)
    if (!session) {
      return c.json({ message: 'Preview 不存在。' }, 404)
    }

    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, session.taskId)
    if (!taskResult.task || !taskResult.project) {
      return jsonError(c, taskResult.message, taskResult.status)
    }

    const context = resolvePreviewContext({
      userId,
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: session.workspaceId,
      workspaceSessionId: session.workspaceSessionId,
    })
    if (!context) {
      previewSessionService.close(session.id, 'stopped_by_user')
      const response: StopPreviewResponse = {
        previewId: session.id,
        status: 'closed',
        closedAt: new Date().toISOString(),
      }
      return c.json(response)
    }

    const workspaceEnvironmentTemplate = await getWorkspaceEnvironmentTemplate(context.workspace.id)
    const preview = resolveProjectEnvironmentPreview({
      project: taskResult.project,
      session: context.session,
      cwd: context.cwd,
      workspaceEnvironmentTemplate,
    })
    if (preview?.stopCommand?.trim()) {
      await runPreviewEnvironmentCommand({
        executorId: context.executorId,
        command: preview.stopCommand,
        cwd: context.cwd,
        runtimeEnvironment: await resolveScopedRuntimeEnvironment({ workspaceId: context.workspace.id }).then((value) => value?.payload).catch(() => undefined),
      }).catch(() => null)
    }

    if (session.accessMode === 'public-proxy') {
      dispatchPreviewIngressUnregister({
        executorId: context.executorId,
        previewSessionId: session.id,
      })
    } else {
      executorWsService.dispatchTask(context.executorId, {
        type: 'preview.tunnel.close',
        previewSessionId: session.id,
        at: new Date().toISOString(),
      })
    }
    previewSessionService.close(session.id, 'stopped_by_user')

    const response: StopPreviewResponse = {
      previewId: session.id,
      status: 'closed',
      closedAt: new Date().toISOString(),
    }
    return c.json(response)
  })

  app.post('/api/previews/:previewId/share', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = sharePreviewSchema.parse(await c.req.json().catch(() => ({}))) as CreatePreviewShareRequest
    const session = previewSessionService.getOwnerSession(c.req.param('previewId'), userId)
    if (!session) {
      return c.json({ message: 'Preview 不存在。' }, 404)
    }
    if (session.purpose === 'code-server') {
      return c.json({ message: 'Code Server preview 不支持分享。' }, 403)
    }
    if (session.status !== 'active' && session.status !== 'waiting_tunnel') {
      return c.json({ message: '当前 preview 状态不支持生成分享链接。' }, 409)
    }

    const response = previewSessionService.createShare(session.id, payload.expiresInMinutes ?? 1440)
    if (!response) {
      return c.json({ message: '分享链接创建失败。' }, 500)
    }
    return c.json(response)
  })

  app.post('/api/previews/:previewId/share/revoke', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const session = previewSessionService.getOwnerSession(c.req.param('previewId'), userId)
    if (!session) {
      return c.json({ message: 'Preview 不存在。' }, 404)
    }

    const revokedAt = previewSessionService.revokeShare(session.id)
    if (!revokedAt) {
      return c.json({ message: '分享链接撤销失败。' }, 500)
    }

    const response: RevokePreviewShareResponse = {
      previewId: session.id,
      share: {
        enabled: false,
        revokedAt,
      },
    }
    return c.json(response)
  })
}
