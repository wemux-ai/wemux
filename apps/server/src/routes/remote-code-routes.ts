// [INPUT]: 已鉴权 Hono app，remote-code 请求
// [OUTPUT]: /api/tasks/:id/remote-code/* 路由（current/open/stop）
// [POS]: 远端代码管理 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type {
  Project,
  RuntimeEnvironmentExecutionPayload,
  Task,
  WorkspaceSession,
  Workspace,
  WorkspaceRemoteCodeDto,
  WorkspaceRemoteCodeOperation,
  WorkspaceRemoteCodeResponse,
  WorkspaceRemoteCodeResult,
} from '@shared/types'
import { resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import { loadState } from '../storage/app-state-store'
import { executorRegistry } from '../control-plane/executor-registry'
import { refreshProjectVersionControlFromExecutor } from '../control-plane/executor-repo-service'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { executorWsService } from '../control-plane/executor-ws-service'
import { executorWsRequests } from '../control-plane/executor-ws-requests'
import { buildPreviewHost, buildPreviewPublicUrl, toPreviewTunnelWsUrl } from '../services/preview-hostname'
import { previewSessionService } from '../services/preview-session-service'
import type { PreviewSource } from '../services/preview-session-record'
import { resolveScopedRuntimeEnvironment } from '../services/runtime-environment-service'
import { resolveWorkspaceRepoPath } from '../services/workspace-repo-path'
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

const CODE_SERVER_PREVIEW_PURPOSE = 'code-server' as const
const REMOTE_CODE_STATUS_TIMEOUT_MS = 5_000
const inFlightRemoteCodeStatusRequests = new Map<string, Promise<WorkspaceRemoteCodeResult>>()

const remoteCodeScopeSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
})

const isAllowedRemoteCodeHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

const resolveRemoteCodeSource = (localUrl: string): PreviewSource | null => {
  let url: URL
  try {
    url = new URL(localUrl)
  } catch {
    return null
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isAllowedRemoteCodeHost(url.hostname)) {
    return null
  }

  return {
    appUrl: url.toString(),
    targetProtocol: url.protocol === 'https:' ? 'https' : 'http',
    targetHost: url.hostname,
    targetPort: Number(url.port || (url.protocol === 'https:' ? '443' : '80')),
    targetBasePath: url.pathname || '/',
  }
}

const resolveRemoteCodeContext = (params: {
  userId: string
  task: Task
  project: Project
  workspaceId?: string
  workspaceSessionId?: string
}): {
  workspace: Workspace
  workspaceSession: WorkspaceSession
  executorId: string
  cwd: string
} | null => {
  const workspaces = listProjectWorkspacesForUser(params.userId, params.project)
  const workspaceSessions = listWorkspaceSessionsForTaskContext(params.task.id)
  const requestedWorkspaceId = params.workspaceId?.trim()
  const requestedWorkspaceSessionId = params.workspaceSessionId?.trim()
  const workspaceSession = requestedWorkspaceSessionId
    ? requestedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(params.task.id, requestedWorkspaceId, requestedWorkspaceSessionId)
      : workspaceSessions.find((item) => item.id === requestedWorkspaceSessionId) ?? null
    : requestedWorkspaceId
      ? getWorkspaceSessionRecordForTaskContext(params.task.id, requestedWorkspaceId)
      : workspaceSessions[0] ?? null
  const workspaceId = workspaceSession?.workspaceId ?? requestedWorkspaceId
  const workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId) ?? null
    : null

  if (!workspace || !workspaceSession || workspaceSession.workspaceId !== workspace.id) {
    return null
  }

  const executorId = resolveWorkspaceSessionExecutorId(workspaceSession, workspace.executorNodeId)
  if (!executorId) {
    return null
  }

  const executor = executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
  const effectiveSession = hydrateWorkspaceSessionWithLocalWorktree(
    resolveEffectiveWorkspaceWorktreeSession(params.task.id, workspaceSession, workspace.executorNodeId),
    workspace,
  )
  const cwd = resolveWorkspaceSessionCwd(executor?.workspaceRoot, params.project, effectiveSession, workspace)
  if (!cwd) {
    return null
  }

  return {
    workspace,
    workspaceSession,
    executorId,
    cwd,
  }
}

const toRemoteCodeDto = (params: {
  task: Task
  executorId: string
  result: WorkspaceRemoteCodeResult
  previewId?: string
  publicUrl?: string
  iframeUrl?: string
}): WorkspaceRemoteCodeDto => {
  const { password: _password, ...safeResult } = params.result
  return {
    ...safeResult,
    taskId: params.task.id,
    executorId: params.executorId,
    previewId: params.previewId,
    publicUrl: params.publicUrl,
    iframeUrl: params.iframeUrl,
    passwordAvailable: Boolean(_password),
  }
}

const appendCodeServerFolderQuery = (url: string | undefined, cwd: string | undefined) => {
  if (!url || !cwd?.trim()) {
    return url
  }

  try {
    const next = new URL(url)
    if (!next.searchParams.has('folder') && !next.searchParams.has('workspace')) {
      next.searchParams.set('folder', cwd)
    }
    return next.toString()
  } catch {
    return url
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

const ensureRemoteCodeWorkspaceDirectory = async (params: {
  state: ReturnType<typeof loadState>
  userId: string
  task: Task
  project: Project
  context: NonNullable<ReturnType<typeof resolveRemoteCodeContext>>
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
}) => {
  const effectiveProject = await refreshProjectVersionControlFromExecutor(params.userId, params.project, params.context.executorId)
  const executorWorkspaceRoot = executorRegistry.getExecutor(params.context.executorId)?.workspaceRoot?.trim()
  const workspaceRoot = executorWorkspaceRoot || params.state.config.workspaceRoot
  const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
    resolveEffectiveWorkspaceWorktreeSession(params.task.id, params.context.workspaceSession, params.context.workspace.executorNodeId),
    params.context.workspace,
  )
  const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(params.context.workspace, effectiveWorktreeSession)
  const worktreeDirectoryReady = workingDirectoryMode === 'worktree' && effectiveWorktreeSession.worktreeStatus === 'created'
    ? await executorWsService.requestDirectoryBrowse(params.context.executorId, params.context.cwd, params.context.cwd, 5000)
      .then((result) => result.ok)
      .catch(() => false)
    : false
  const shouldEnsureWorkspaceDirectory = effectiveProject.versionControl !== 'none'
    && (workingDirectoryMode === 'original-dir' || effectiveWorktreeSession.worktreeStatus !== 'created' || !worktreeDirectoryReady)

  if (!shouldEnsureWorkspaceDirectory) {
    return {
      ok: true as const,
      context: params.context,
    }
  }

  const repoPath = resolveWorkspaceRepoPath({
    project: effectiveProject,
    workspaceRoot,
    workspace: params.context.workspace,
    session: effectiveWorktreeSession,
  })
  const preferredBranch = effectiveWorktreeSession.baseBranch?.trim()
    || params.task.baseBranchHint?.trim()
    || params.context.workspace.suggestedBaseBranch?.trim()
    || params.context.workspace.defaultBranch?.trim()
    || effectiveProject.defaultBranch
  const result = await executorWsService.requestWorktreeEnsure(params.context.executorId, {
    workspaceId: params.context.workspace.id,
    ownerUserId: params.context.workspace.ownerUserId ?? params.userId,
    repoPath,
    repoUrl: effectiveProject.gitUrl?.trim() || undefined,
    preferredBranch,
    branchName: effectiveWorktreeSession.branchName,
    worktreePath: params.context.cwd,
    workingDirectoryMode,
    gitIdentity: await resolveTaskGitIdentitySafely(params.userId, effectiveProject),
    runtimeEnvironment: params.runtimeEnvironment,
  }).catch((error) => ({
    ok: false as const,
    message: error instanceof Error ? error.message : '打开 Remote Code 前准备工作目录失败。',
  }))

  if (!result.ok) {
    return {
      ok: false as const,
      message: result.message,
    }
  }

  const nextSession = saveWorkspaceDirectorySessions({
    task: params.task,
    currentSession: params.context.workspaceSession,
    effectiveSession: effectiveWorktreeSession,
    patch: {
      worktreeStatus: 'created',
      updatedAt: new Date().toISOString(),
    },
  })

  return {
    ok: true as const,
    context: {
      ...params.context,
      workspaceSession: nextSession,
      cwd: result.worktreePath?.trim() || params.context.cwd,
    },
  }
}

const executeRemoteCode = async (params: {
  task: Task
  context: NonNullable<ReturnType<typeof resolveRemoteCodeContext>>
  operation: WorkspaceRemoteCodeOperation
}) => {
  const requestRemoteCode = () => executorWsRequests.requestRemoteCode(params.context.executorId, {
    request: {
      operation: params.operation,
      workspaceId: params.context.workspace.id,
      workspaceSessionId: params.context.workspaceSession.id,
      cwd: params.context.cwd,
    },
  }, params.operation === 'status' ? REMOTE_CODE_STATUS_TIMEOUT_MS : undefined)

  if (params.operation !== 'status') {
    return requestRemoteCode()
  }

  const requestKey = [
    params.context.executorId,
    params.context.workspace.id,
    params.context.workspaceSession.id,
    params.context.cwd,
  ].join('|')
  const existingRequest = inFlightRemoteCodeStatusRequests.get(requestKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = requestRemoteCode()
  inFlightRemoteCodeStatusRequests.set(requestKey, request)
  const clearRequest = () => {
    if (inFlightRemoteCodeStatusRequests.get(requestKey) === request) {
      inFlightRemoteCodeStatusRequests.delete(requestKey)
    }
  }
  void request.then(clearRequest, clearRequest)
  return request
}

const openRemoteCodePreview = async (params: {
  task: Task
  project: Project
  ownerUserId: string
  context: NonNullable<ReturnType<typeof resolveRemoteCodeContext>>
  result: WorkspaceRemoteCodeResult
  requestUrl: string
  requestHeaders: Headers
}): Promise<WorkspaceRemoteCodeResponse> => {
  if (!params.result.ok || params.result.phase !== 'ready' || !params.result.localUrl) {
    return {
      remoteCode: toRemoteCodeDto({
        task: params.task,
        executorId: params.context.executorId,
        result: params.result,
      }),
    }
  }

  const source = resolveRemoteCodeSource(params.result.localUrl)
  if (!source) {
    return {
      remoteCode: toRemoteCodeDto({
        task: params.task,
        executorId: params.context.executorId,
        result: {
          ...params.result,
          ok: false,
          phase: 'error',
          error: 'Code Server 只允许暴露本机 HTTP 地址。',
        },
      }),
    }
  }

  const previewId = crypto.randomUUID()
  const executor = executorRegistry.getExecutor(params.context.executorId)
  const publicHost = buildPreviewHost({
    requestUrl: params.requestUrl,
    headers: params.requestHeaders,
    projectName: params.project.name,
    previewId,
    executor,
  })
  const publicUrl = buildPreviewPublicUrl({
    requestUrl: params.requestUrl,
    headers: params.requestHeaders,
    projectName: params.project.name,
    previewId,
    executor,
  })
  const created = previewSessionService.createOrReuseSession({
    previewId,
    purpose: CODE_SERVER_PREVIEW_PURPOSE,
    projectId: params.project.id,
    taskId: params.task.id,
    workspaceId: params.context.workspace.id,
    workspaceSessionId: params.context.workspaceSession.id,
    executorId: params.context.executorId,
    ownerUserId: params.ownerUserId,
    source,
    additionalSources: [],
    publicHost,
    publicUrl,
  })

  let session = created.session
  let tunnelToken: string | null = created.created ? created.tunnelToken : null
  if (!created.created && (session.status !== 'active' || session.tunnelClientStatus !== 'open')) {
    tunnelToken = previewSessionService.rotateTunnelToken(session.id)
    session = previewSessionService.getSessionById(session.id) ?? session
  }

  if (tunnelToken) {
    const dispatched = executorWsService.dispatchTask(params.context.executorId, {
      type: 'preview.tunnel.open',
      previewSessionId: session.id,
      tunnelUrl: toPreviewTunnelWsUrl({
        requestUrl: params.requestUrl,
        headers: params.requestHeaders,
        executor,
      }),
      tunnelToken,
      targetUrl: source.appUrl,
      injectNavigationBridge: false,
      at: new Date().toISOString(),
    })
    if (!dispatched) {
      previewSessionService.markError(session.id, '执行器当前不在线，无法建立 Code Server tunnel。')
      return {
        remoteCode: toRemoteCodeDto({
          task: params.task,
          executorId: params.context.executorId,
          result: {
            ...params.result,
            ok: false,
            phase: 'error',
            error: '执行器当前不在线，无法建立 Code Server tunnel。',
          },
        }),
      }
    }
    session = previewSessionService.getSessionById(session.id) ?? session
  }

  const viewer = previewSessionService.issueViewerAccess(session.id)
  const codeServerViewer = viewer
    ? {
        ...viewer,
        publicUrl: appendCodeServerFolderQuery(viewer.publicUrl, params.result.cwd) ?? viewer.publicUrl,
        iframeUrl: appendCodeServerFolderQuery(viewer.iframeUrl, params.result.cwd) ?? viewer.iframeUrl,
      }
    : null
  const preview = previewSessionService.toDto(session)
  return {
    remoteCode: toRemoteCodeDto({
      task: params.task,
      executorId: params.context.executorId,
      result: params.result,
      previewId: session.id,
      publicUrl: codeServerViewer?.publicUrl ?? appendCodeServerFolderQuery(session.publicUrl, params.result.cwd),
      iframeUrl: codeServerViewer?.iframeUrl,
    }),
    preview,
    viewer: codeServerViewer,
    passwordOnce: params.result.password,
  }
}

export const registerRemoteCodeRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const resolveRequest = async (c: Context, source: 'query' | 'body') => {
    const userId = getUserIdFromHeader(c)!
    const taskId = c.req.param('id')
    if (!taskId) {
      return {
        ok: false as const,
        response: () => c.json({ message: '任务不存在。' }, 404),
      }
    }
    const payload = remoteCodeScopeSchema.parse(
      source === 'query' ? c.req.query() : await c.req.json().catch(() => ({})),
    )
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) {
      return {
        ok: false as const,
        response: () => jsonError(c, taskResult.message, taskResult.status),
      }
    }

    const context = resolveRemoteCodeContext({
      userId,
      task: taskResult.task,
      project: taskResult.project,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    if (!context) {
      return {
        ok: false as const,
        response: () => c.json({ message: '工作区会话不存在，或当前任务没有可用执行节点。' }, 404),
      }
    }

    return {
      ok: true as const,
      userId,
      task: taskResult.task,
      project: taskResult.project,
      context,
    }
  }

  app.get('/api/tasks/:id/remote-code/current', requireAuth, async (c) => {
    const resolved = await resolveRequest(c, 'query')
    if (!resolved.ok) return resolved.response()

    const result = await executeRemoteCode({
      task: resolved.task,
      context: resolved.context,
      operation: 'status',
    })
    const session = previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: resolved.task.id,
      workspaceId: resolved.context.workspace.id,
      ownerUserId: resolved.userId,
      purpose: CODE_SERVER_PREVIEW_PURPOSE,
    })
    const viewer = session ? previewSessionService.issueViewerAccess(session.id) : null
    const codeServerViewer = viewer
      ? {
          ...viewer,
          publicUrl: appendCodeServerFolderQuery(viewer.publicUrl, result.cwd) ?? viewer.publicUrl,
          iframeUrl: appendCodeServerFolderQuery(viewer.iframeUrl, result.cwd) ?? viewer.iframeUrl,
        }
      : null
    return c.json({
      remoteCode: toRemoteCodeDto({
        task: resolved.task,
        executorId: resolved.context.executorId,
        result,
        previewId: session?.id,
        publicUrl: codeServerViewer?.publicUrl,
        iframeUrl: codeServerViewer?.iframeUrl,
      }),
      preview: session ? previewSessionService.toDto(session) : null,
      viewer: codeServerViewer,
    } satisfies WorkspaceRemoteCodeResponse)
  })

  app.post('/api/tasks/:id/remote-code/open', requireAuth, async (c) => {
    const resolved = await resolveRequest(c, 'body')
    if (!resolved.ok) return resolved.response()

    const runtimeEnvironment = await resolveScopedRuntimeEnvironment({ workspaceId: resolved.context.workspace.id })
      .then((value) => value?.payload)
      .catch(() => undefined)
    const prepared = await ensureRemoteCodeWorkspaceDirectory({
      state: loadState(),
      userId: resolved.userId,
      task: resolved.task,
      project: resolved.project,
      context: resolved.context,
      runtimeEnvironment,
    })
    if (!prepared.ok) {
      return c.json({ message: prepared.message }, 502)
    }

    const result = await executeRemoteCode({
      task: resolved.task,
      context: prepared.context,
      operation: 'start',
    })
    const response = await openRemoteCodePreview({
      task: resolved.task,
      project: resolved.project,
      ownerUserId: resolved.userId,
      context: prepared.context,
      result,
      requestUrl: c.req.url,
      requestHeaders: c.req.raw.headers,
    })
    return c.json(response)
  })

  app.post('/api/tasks/:id/remote-code/stop', requireAuth, async (c) => {
    const resolved = await resolveRequest(c, 'body')
    if (!resolved.ok) return resolved.response()

    const result = await executeRemoteCode({
      task: resolved.task,
      context: resolved.context,
      operation: 'stop',
    })
    const session = previewSessionService.getOwnerSessionForTaskWorkspace({
      taskId: resolved.task.id,
      workspaceId: resolved.context.workspace.id,
      ownerUserId: resolved.userId,
      purpose: CODE_SERVER_PREVIEW_PURPOSE,
    })
    if (session) {
      executorWsService.dispatchTask(resolved.context.executorId, {
        type: 'preview.tunnel.close',
        previewSessionId: session.id,
        at: new Date().toISOString(),
      })
      previewSessionService.close(session.id, 'stopped_by_user')
    }

    return c.json({
      remoteCode: toRemoteCodeDto({
        task: resolved.task,
        executorId: resolved.context.executorId,
        result,
      }),
      preview: null,
      viewer: null,
    } satisfies WorkspaceRemoteCodeResponse)
  })
}
