// [INPUT]: 已鉴权 Hono app，GitHub 资源/评审请求
// [OUTPUT]: /api/github/resource-bindings、/api/review/* 路由（bindings/pull-requests/sync/workflow）
// [POS]: GitHub 资源绑定与 PR 评审 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { createExecutionLog, createTaskFromRequirement, deriveExecutionCenter } from '@shared/task-orchestrator'
import type {
  AppState,
  GitHubResourceBindingRole,
  GitHubResourceType,
  Project,
  ProjectPullRequestReviewSummary,
  ProjectPullRequestReviewWorkflowResponse,
  Task,
} from '@shared/types'
import { enqueueTaskChatMessage } from '../control-plane/task-chat-service'
import { scheduleTaskChatQueueDrain } from '../services/task-chat-dispatch'
import {
  getReviewWorkflowJobLogs,
  getReviewWorkflowRunJobs,
  listReviewIssues,
  listReviewPullRequestWorkflowRuns,
  listReviewPullRequests,
  registerProjectPullRequestContext,
  listReviewWorkflowRuns,
  syncProjectPullRequests,
  syncReviewPullRequests,
} from '../services/project-pull-request-review-service'
import { requireReviewCenterAccess } from '../services/review-center-access'
import { loadState, saveTaskAndWait, saveTaskWorkspaceBinding, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { listProjectIssues } from '../storage/postgres/project-issue-store'
import { listProjectWorkflowRuns } from '../storage/postgres/project-workflow-run-store'
import {
  listGitHubResourceBindings,
  upsertGitHubResourceBinding,
} from '../storage/postgres/github-resource-binding-store'
import { hasGitHubProjectResource } from '../storage/postgres/github-project-resource-store'
import { getAuthorizedProject, getScopedState, getUserIdFromHeader, jsonError, withClusterState, withState } from './shared'
import {
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  listProjectWorkspacesForUser,
  upsertTaskWorkspaceBindingInState,
  upsertWorkspaceSessionInState,
} from './task-route-support'

const pullRequestListQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  scope: z.enum(['full', 'summary']).optional().default('full'),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

const issueListQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
  refresh: z.enum(['1', 'true']).optional(),
})

const actionListQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
  refresh: z.enum(['1', 'true']).optional(),
})

const resourceBindingQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  resourceType: z.enum(['pull_request', 'issue', 'workflow_run']).optional(),
  resourceId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  workspaceSessionId: z.string().trim().optional(),
  status: z.enum(['suggested', 'confirmed', 'rejected']).optional(),
})

const resourceBindingPayloadSchema = z.object({
  projectId: z.string().trim().min(1),
  resourceType: z.enum(['pull_request', 'issue', 'workflow_run']),
  resourceId: z.string().trim().min(1),
  taskId: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
  role: z.enum(['delivery', 'reference', 'review', 'execution']).optional(),
  status: z.enum(['confirmed', 'rejected']).optional(),
})

const pullRequestBulkSyncSchema = z.object({
  projectIds: z.array(z.string().trim().min(1)).optional(),
}).optional()

const pullRequestWorkflowSchema = z.object({
  mode: z.enum(['ai-review']).optional().default('ai-review'),
}).optional()

const decodePullRequestIdParam = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const resolveDefaultResourceBindingRole = (
  resourceType: GitHubResourceType,
): GitHubResourceBindingRole => {
  if (resourceType === 'pull_request') return 'delivery'
  if (resourceType === 'workflow_run') return 'execution'
  return 'reference'
}

const DEFAULT_PULL_REQUEST_PAGE_SIZE = 30

const parseReviewOffsetCursor = (value?: string) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const normalizePullRequestPageSize = (value?: number) => Math.min(value ?? DEFAULT_PULL_REQUEST_PAGE_SIZE, 100)

const parsePullRequestListProjectIds = (url: string, projectId?: string) => {
  const searchParams = new URL(url).searchParams
  const projectIds = searchParams.getAll('projectId')
  if (projectId) {
    projectIds.push(projectId)
  }

  return Array.from(new Set(
    projectIds
      .map((id) => id.trim())
      .filter(Boolean),
  ))
}

const parseGitHubResourceBindingProjectIds = (url: string, projectId?: string) => (
  parsePullRequestListProjectIds(url, projectId)
)

const summarizePullRequestListItem = (
  pullRequest: ProjectPullRequestReviewSummary,
): ProjectPullRequestReviewSummary => ({
  id: pullRequest.id,
  provider: pullRequest.provider,
  projectId: pullRequest.projectId,
  repoHost: '',
  repoOwner: '',
  repoName: '',
  repoFullName: '',
  repoUrl: '',
  number: pullRequest.number,
  url: pullRequest.url,
  title: '',
  body: '',
  authorLogin: undefined,
  state: pullRequest.state,
  merged: pullRequest.merged,
  draft: pullRequest.draft,
  baseBranch: pullRequest.baseBranch,
  compareBranch: pullRequest.compareBranch,
  headOwner: undefined,
  headRepo: undefined,
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  files: [],
  matchedWorkspaceId: pullRequest.matchedWorkspaceId,
  matchedWorkspaceSessionId: pullRequest.matchedWorkspaceSessionId,
  matchedTaskId: pullRequest.matchedTaskId,
  matchedTaskTitle: pullRequest.matchedTaskTitle,
  syncedAt: pullRequest.syncedAt,
  createdAt: pullRequest.createdAt,
  updatedAt: pullRequest.updatedAt,
  mergedAt: pullRequest.mergedAt,
  closedAt: pullRequest.closedAt,
})

const stripPullRequestListDetails = (pullRequests: Awaited<ReturnType<typeof listReviewPullRequests>>) => (
  pullRequests.map(summarizePullRequestListItem)
)

const buildPullRequestListResponse = (
  pullRequests: Awaited<ReturnType<typeof listReviewPullRequests>>,
  params: {
    hasMore: boolean
    offset: number
    scope: 'full' | 'summary'
  },
) => {
  const responsePullRequests = params.scope === 'summary'
    ? stripPullRequestListDetails(pullRequests)
    : pullRequests

  return {
    pullRequests: responsePullRequests,
    lastSyncedAt: pullRequests[0]?.syncedAt,
    hasMore: params.hasMore,
    nextCursor: params.hasMore ? String(params.offset + pullRequests.length) : undefined,
  }
}

const listGitHubResourceBindingsHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const state = loadState()
  const query = resourceBindingQuerySchema.parse(c.req.query())
  const scopedState = getScopedState(state, userId)
  const scopedProjectIds = new Set(scopedState.projects.map((project) => project.id))
  const requestedProjectIds = parseGitHubResourceBindingProjectIds(c.req.url, query.projectId)
  if (requestedProjectIds.length > 0) {
    for (const projectId of requestedProjectIds) {
      if (!scopedProjectIds.has(projectId)) {
        return jsonError(c, '项目不存在，或当前账号无权访问。', 404)
      }
    }
  }

  return c.json({
    bindings: await listGitHubResourceBindings({
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

const upsertGitHubResourceBindingHandler = async (c: Context) => {
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

  const resourceBelongsToProject = await hasGitHubProjectResource({
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    projectId: projectResult.project.id,
  })
  if (!resourceBelongsToProject) {
    return jsonError(c, 'GitHub 资源不存在，或不属于当前项目。', 404)
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

  const binding = await upsertGitHubResourceBinding({
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    projectId: projectResult.project.id,
    taskId: payload.taskId,
    workspaceId: resolvedWorkspaceId,
    workspaceSessionId: workspaceSession?.id,
    role: payload.role ?? resolveDefaultResourceBindingRole(payload.resourceType),
    status: payload.status ?? 'confirmed',
    source: 'manual',
    confidence: 100,
    createdByUserId: userId,
  })

  return c.json({ binding })
}

const listProjectGitHubPullRequestsHandler = async (c: Context) => {
  const userId = getUserIdFromHeader(c)!
  const state = loadState()
  const query = pullRequestListQuerySchema.parse(c.req.query())
  const requestedProjectIds = parsePullRequestListProjectIds(c.req.url, query.projectId)
  const offset = parseReviewOffsetCursor(query.cursor)
  const limit = normalizePullRequestPageSize(query.limit)
  const pageLimit = limit + 1
  if (requestedProjectIds.length > 0) {
    const authorizedProjectIds: string[] = []
    for (const projectId of requestedProjectIds) {
      const projectResult = getAuthorizedProject(state, userId, projectId)
      if (!projectResult.project) {
        return jsonError(c, projectResult.message, projectResult.status)
      }
      authorizedProjectIds.push(projectResult.project.id)
    }

    const pagePullRequests = await listReviewPullRequests({
      projectIds: authorizedProjectIds,
      limit: pageLimit,
      offset,
    })
    const hasMore = pagePullRequests.length > limit
    return c.json(buildPullRequestListResponse(pagePullRequests.slice(0, limit), {
      hasMore,
      offset,
      scope: query.scope,
    }))
  }

  const scopedState = getScopedState(state, userId)
  const pagePullRequests = await listReviewPullRequests({
    projectIds: scopedState.projects.map((project) => project.id),
    limit: pageLimit,
    offset,
  })
  const hasMore = pagePullRequests.length > limit
  return c.json(buildPullRequestListResponse(pagePullRequests.slice(0, limit), {
    hasMore,
    offset,
    scope: query.scope,
  }))
}

const sanitizeWorkflowTitlePart = (value: string, fallback: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, 80)
}

const buildPullRequestReviewTaskTitle = (pullRequest: ProjectPullRequestReviewWorkflowResponse['pullRequest']) => (
  `Review PR #${pullRequest.number}: ${sanitizeWorkflowTitlePart(pullRequest.title, pullRequest.compareBranch || pullRequest.repoFullName)}`
).slice(0, 120)

const buildPullRequestReviewPrompt = (params: {
  pullRequest: ProjectPullRequestReviewWorkflowResponse['pullRequest']
  project: Project
}) => {
  const { pullRequest, project } = params
  const files = pullRequest.files.slice(0, 80).map((file) => (
    `- ${file.status} ${file.path} (+${file.additions}/-${file.deletions})${file.previousPath ? `, renamed from ${file.previousPath}` : ''}`
  )).join('\n')
  const body = pullRequest.body.trim()
  return [
    `请作为 reviewer 审查这个 GitHub Pull Request，并给出可执行的 review 结论。`,
    '',
    `Project: ${project.name}`,
    `Repository: ${pullRequest.repoFullName}`,
    `PR: #${pullRequest.number} ${pullRequest.title}`,
    `URL: ${pullRequest.url || 'N/A'}`,
    `Author: ${pullRequest.authorLogin || 'unknown'}`,
    `Base: ${pullRequest.baseBranch || project.defaultBranch || 'main'}`,
    `Head: ${pullRequest.compareBranch}`,
    `Changed: ${pullRequest.changedFiles} files, +${pullRequest.additions}/-${pullRequest.deletions}`,
    '',
    body ? `PR description:\n${body}` : 'PR description: N/A',
    '',
    files ? `Changed files:\n${files}` : 'Changed files: N/A',
    '',
    [
      'Review checklist:',
      '1. 总结这个 PR 做了什么。',
      '2. 检查明显 bug、回归风险、遗漏测试、类型/边界问题。',
      '3. 对高风险文件优先阅读 diff 和本地代码上下文。',
      '4. 输出 blocking issues、non-blocking suggestions、以及是否建议合并。',
      '5. 如果需要修改代码，先说明建议，再等待我确认或给出小范围 patch 方案。',
    ].join('\n'),
  ].join('\n')
}

const findExistingWorkflowTask = (state: AppState, pullRequestId: string) => {
  const marker = `review:${pullRequestId}`
  return state.tasks.find((task) => task.description.includes(marker)) ?? null
}

const createWorkflowTask = (params: {
  state: AppState
  project: Project
  pullRequest: ProjectPullRequestReviewWorkflowResponse['pullRequest']
}): Task => {
  const title = buildPullRequestReviewTaskTitle(params.pullRequest)
  const prompt = buildPullRequestReviewPrompt({
    pullRequest: params.pullRequest,
    project: params.project,
  })
  const task = createTaskFromRequirement(
    params.project,
    `${prompt}\n\nreview:${params.pullRequest.id}`,
    'medium',
    title,
    'none',
    'OpenCode',
    undefined,
    params.pullRequest.baseBranch || params.project.defaultBranch || 'main',
    params.state.config,
  )
  return {
    ...task,
    priority: 'medium',
    baseBranchHint: params.pullRequest.baseBranch || params.project.defaultBranch || 'main',
    currentStep: 'PR review workflow 已创建，等待 reviewer 会话执行。',
    logs: [
      ...task.logs,
      createExecutionLog('system', `已从 PR #${params.pullRequest.number} 创建 review workflow。`),
    ],
  }
}

const selectWorkflowWorkspace = (params: {
  userId: string
  project: Project
  pullRequest: ProjectPullRequestReviewWorkflowResponse['pullRequest']
}) => {
  const workspaces = listProjectWorkspacesForUser(params.userId, params.project)
  if (params.pullRequest.matchedWorkspaceId) {
    const matched = workspaces.find((workspace) => workspace.id === params.pullRequest.matchedWorkspaceId)
    if (matched) {
      return matched
    }
  }

  return workspaces.find((workspace) => workspace.status !== 'archived') ?? null
}

const findExistingWorkflowSession = (params: {
  state: AppState
  taskId: string
  workspaceId: string
}) => {
  const workspaceHasTaskBinding = params.state.taskWorkspaceBindings.some((binding) => (
    binding.taskId === params.taskId
    && binding.workspaceId === params.workspaceId
    && binding.status === 'active'
  ))
  if (!workspaceHasTaskBinding) {
    return null
  }

  return params.state.workspaceSessions.find((session) => (
    session.workspaceId === params.workspaceId
    && session.status !== 'archived'
    && session.sessionRole === 'reviewer'
  )) ?? null
}

const startPullRequestReviewWorkflow = async (params: {
  state: AppState
  userId: string
  project: Project
  pullRequest: ProjectPullRequestReviewWorkflowResponse['pullRequest']
}) => {
  const workspace = selectWorkflowWorkspace(params)
  if (!workspace) {
    return {
      ok: false as const,
      status: 409 as const,
      message: '这个项目还没有可用工作区。请先在 Workspaces 里为项目创建一个工作区，再启动 PR review workflow。',
    }
  }

  const existingTask = findExistingWorkflowTask(params.state, params.pullRequest.id)
  const createdTask = !existingTask
  const task = existingTask ?? createWorkflowTask(params)
  const bindingState = ensureTaskWorkspaceBindingState({
    task,
    workspaceId: workspace.id,
    updatedAt: new Date().toISOString(),
  })
  const workflowTask = bindingState.task
  const existingWorkflowSession = findExistingWorkflowSession({
    state: params.state,
    taskId: workflowTask.id,
    workspaceId: workspace.id,
  })
  const session = existingWorkflowSession ?? ensureWorkspaceSessionRecord({
    task: workflowTask,
    workspaceId: workspace.id,
    executorNodeId: workspace.executorNodeId,
    workspace,
    createNewSession: true,
    title: `PR #${params.pullRequest.number} review`,
    titleOrigin: 'system',
    sessionKind: 'subagent',
    sessionRole: 'reviewer',
    agentInvocationMode: 'delegate',
    delegatedPrompt: buildPullRequestReviewPrompt({
      pullRequest: params.pullRequest,
      project: params.project,
    }),
    workingDirectoryMode: workspace.workingDirectoryMode,
  })
  const createdWorkspaceSession = !existingWorkflowSession
  const nextTask: Task = {
    ...workflowTask,
    updatedAt: new Date().toISOString(),
    currentStep: 'PR review workflow 已启动，reviewer 消息已入队。',
    logs: [
      ...workflowTask.logs,
      createExecutionLog('system', `已在工作区 ${workspace.name} 启动 PR #${params.pullRequest.number} review。`, workspace.id),
    ],
  }

  await saveTaskAndWait(nextTask)
  saveTaskWorkspaceBinding(bindingState.binding)
  await saveWorkspaceSessionAndWait(session)
  const matchedPullRequest = await registerProjectPullRequestContext({
    project: params.project,
    taskId: nextTask.id,
    workspaceId: workspace.id,
    workspaceSessionId: session.id,
    userId: params.userId,
    source: 'review_workflow',
    role: 'review',
    pullRequest: params.pullRequest,
  }) ?? {
    ...params.pullRequest,
    matchedWorkspaceId: workspace.id,
    matchedWorkspaceSessionId: session.id,
    matchedTaskId: nextTask.id,
    matchedTaskTitle: nextTask.title,
  }
  await enqueueTaskChatMessage({
    taskId: nextTask.id,
    workspaceId: workspace.id,
    workspaceSessionId: session.id,
    message: buildPullRequestReviewPrompt({
      pullRequest: params.pullRequest,
      project: params.project,
    }),
    createdBy: params.userId,
  })
  scheduleTaskChatQueueDrain({
    taskId: nextTask.id,
    workspaceId: workspace.id,
    workspaceSessionId: session.id,
  })

  const taskList = createdTask
    ? [nextTask, ...params.state.tasks]
    : params.state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item))
  const nextState = upsertWorkspaceSessionInState(upsertTaskWorkspaceBindingInState({
    ...params.state,
    tasks: taskList,
    selectedTaskId: nextTask.id,
    selectedProjectId: params.project.id,
    executionCenter: deriveExecutionCenter(taskList, params.state.executionCenter),
  }, bindingState.binding), session)
  const scoped = await withState(
    withClusterState(nextState),
    'PR review workflow 已启动。',
    params.userId,
    { includeResources: false },
  )

  return {
    ok: true as const,
    state: scoped.state,
    response: {
      ok: true,
      message: 'PR review workflow 已启动。',
      pullRequest: matchedPullRequest,
      taskId: nextTask.id,
      workspaceId: workspace.id,
      workspaceSessionId: session.id,
      createdTask,
      createdWorkspaceSession,
    } satisfies ProjectPullRequestReviewWorkflowResponse,
  }
}

export const registerReviewRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/github/resource-bindings', requireAuth, listGitHubResourceBindingsHandler)
  app.post('/api/github/resource-bindings', requireAuth, upsertGitHubResourceBindingHandler)
  app.get('/api/github/pull-requests', requireAuth, listProjectGitHubPullRequestsHandler)

  app.get('/api/review/resource-bindings', requireReviewCenterAccess, requireAuth, listGitHubResourceBindingsHandler)
  app.post('/api/review/resource-bindings', requireReviewCenterAccess, requireAuth, upsertGitHubResourceBindingHandler)
  app.get('/api/review/pull-requests', requireReviewCenterAccess, requireAuth, listProjectGitHubPullRequestsHandler)

  app.post('/api/review/pull-requests/sync', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const scopedState = getScopedState(state, userId)
    const payload = pullRequestBulkSyncSchema.parse(await c.req.json().catch(() => undefined))
    const requestedProjectIds = new Set(payload?.projectIds ?? [])
    const projects = requestedProjectIds.size > 0
      ? scopedState.projects.filter((project) => requestedProjectIds.has(project.id))
      : scopedState.projects

    return c.json(await syncReviewPullRequests({
      state,
      userId,
      projects,
    }))
  })

  app.post('/api/review/pull-requests/:id/workflow/start', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    pullRequestWorkflowSchema.parse(await c.req.json().catch(() => undefined))
    const pullRequestId = decodePullRequestIdParam(c.req.param('id'))
    const scopedState = getScopedState(state, userId)
    const scopedProjectIds = new Set(scopedState.projects.map((project) => project.id))
    const pullRequest = (await listReviewPullRequests({
      projectIds: [...scopedProjectIds],
    }))
      .find((item) => item.id === pullRequestId && scopedProjectIds.has(item.projectId))
    if (!pullRequest) {
      return jsonError(c, 'PR 不存在，或当前账号无权访问。', 404)
    }

    const projectResult = getAuthorizedProject(state, userId, pullRequest.projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    const result = await startPullRequestReviewWorkflow({
      state,
      userId,
      project: projectResult.project,
      pullRequest,
    })
    if (!result.ok) {
      return c.json({ message: result.message }, result.status)
    }

    return c.json({
      state: result.state,
      ...result.response,
    })
  })

  app.get('/api/review/pull-requests/:id/actions', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const pullRequestId = decodePullRequestIdParam(c.req.param('id'))
    const scopedState = getScopedState(state, userId)
    const scopedProjectIds = new Set(scopedState.projects.map((project) => project.id))
    const pullRequest = (await listReviewPullRequests({
      projectIds: [...scopedProjectIds],
    }))
      .find((item) => item.id === pullRequestId && scopedProjectIds.has(item.projectId))
    if (!pullRequest) {
      return jsonError(c, 'PR 不存在，或当前账号无权访问。', 404)
    }

    const projectResult = getAuthorizedProject(state, userId, pullRequest.projectId)
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    return c.json(await listReviewPullRequestWorkflowRuns({
      userId,
      project: projectResult.project,
      pullRequest,
    }))
  })

  app.get('/api/review/actions', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const query = actionListQuerySchema.parse(c.req.query())
    const scopedState = getScopedState(state, userId)
    if (query.projectId) {
      const projectResult = getAuthorizedProject(state, userId, query.projectId)
      if (!projectResult.project) {
        return jsonError(c, projectResult.message, projectResult.status)
      }
    }

    const projectIds = query.projectId
      ? [query.projectId]
      : scopedState.projects.map((project) => project.id)

    if (!query.refresh) {
      const dbRuns = await listProjectWorkflowRuns({
        projectIds,
        limit: query.limit,
      })
      if (dbRuns.length > 0) {
        return c.json({
          ok: true,
          message: '已从同步数据加载 workflow runs。',
          runs: dbRuns,
        })
      }
    }

    return c.json(await listReviewWorkflowRuns({
      userId,
      projects: scopedState.projects,
      projectFilterId: query.projectId,
      cursor: query.cursor,
      limit: query.limit,
    }))
  })

  app.get('/api/review/actions/:projectId/:runId/jobs', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, c.req.param('projectId'))
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    return c.json(await getReviewWorkflowRunJobs({
      userId,
      project: projectResult.project,
      runId: c.req.param('runId'),
    }))
  })

  app.get('/api/review/actions/:projectId/:runId/jobs/:jobId/logs', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, c.req.param('projectId'))
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    return c.json(await getReviewWorkflowJobLogs({
      userId,
      project: projectResult.project,
      runId: c.req.param('runId'),
      jobId: c.req.param('jobId'),
    }))
  })

  app.get('/api/review/issues', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const query = issueListQuerySchema.parse(c.req.query())
    const scopedState = getScopedState(state, userId)
    if (query.projectId) {
      const projectResult = getAuthorizedProject(state, userId, query.projectId)
      if (!projectResult.project) {
        return jsonError(c, projectResult.message, projectResult.status)
      }
    }

    const projectIds = query.projectId
      ? [query.projectId]
      : scopedState.projects.map((project) => project.id)

    if (!query.refresh) {
      const dbIssues = await listProjectIssues({
        projectIds,
        state: query.state,
        limit: query.limit,
      })
      if (dbIssues.length > 0) {
        return c.json({
          ok: true,
          message: '已从同步数据加载 issues。',
          issues: dbIssues,
        })
      }
    }

    return c.json(await listReviewIssues({
      userId,
      projects: scopedState.projects,
      state: query.state,
      projectFilterId: query.projectId,
      cursor: query.cursor,
      limit: query.limit,
    }))
  })

  app.post('/api/projects/:id/pull-requests/sync', requireReviewCenterAccess, requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, c.req.param('id'))
    if (!projectResult.project) {
      return jsonError(c, projectResult.message, projectResult.status)
    }

    return c.json(await syncProjectPullRequests({
      state,
      userId,
      project: projectResult.project,
    }))
  })
}
