// [INPUT]: Authenticated task, workspace, and workspace-session Git API requests.
// [OUTPUT]: Authorized control-plane responses that delegate scoped Git work to the selected worker.
// [POS]: HTTP protocol boundary for workspace Git inspection and mutation.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { syncTaskStatusFromReviewReady, syncTaskStatusFromWorkMerged, touchTaskStatus } from '@shared/task-status-flow'
import { applyWorkspaceCodeStateToSession, mergeWorkspaceSession, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { AppState, Project, ProjectPullRequestState, Task, WorkspaceSession, Workspace } from '@shared/types'
import { buildWorkspaceDeliverySummary, type WorkspaceDeliverySummary } from '@shared/workspace-delivery'
import { executorRegistry } from '../control-plane/executor-registry'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { executorWsService } from '../control-plane/executor-ws-service'
import { lookupPullRequest } from '../services/github-pull-request-service'
import { registerProjectPullRequestContext } from '../services/project-pull-request-review-service'
import { loadState, saveTaskAndWait, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { saveWorkspace } from '../storage/distributed-task-store'
import { getAuthorizedTask, jsonError, getUserIdFromHeader, withState } from './shared'
import {
  getWorkspaceSessionRecordForTaskContext,
  listActiveTaskWorkspaceBindings,
  listProjectWorkspacesForUser,
  listWorkspaceSessionsForTaskContext,
  rememberRecentBaseBranch,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd,
} from './task-route-support'

const resolveTaskWorkspace = (userId: string, project: Project, task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (workspaceSessionId?.trim()) {
    const session = listWorkspaceSessionsForTaskContext(task.id).find((item) => item.id === workspaceSessionId.trim())
    if (session) {
      return listProjectWorkspacesForUser(userId, project).find((item) => item.id === session.workspaceId) ?? null
    }
  }

  const targetWorkspaceId = workspaceId?.trim() || listActiveTaskWorkspaceBindings(task.id)[0]?.workspaceId
  if (!targetWorkspaceId) {
    return null
  }

  return listProjectWorkspacesForUser(userId, project).find((item) => item.id === targetWorkspaceId) ?? null
}

const normalizeProjectPullRequestState = (value?: string): ProjectPullRequestState => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'open' || normalized === 'merged' || normalized === 'closed') {
    return normalized
  }

  return 'unknown'
}

const resolveWorkspaceSessionForTaskContext = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (!workspaceId) {
    return null
  }

  return getWorkspaceSessionRecordForTaskContext(task.id, workspaceId, workspaceSessionId)
}

const resolveTaskExecutorContext = (params: {
  userId: string
  state: AppState
  project: Project
  task: Task
  workspace?: Workspace | null
  session?: WorkspaceSession | null
}) => {
  const workspace = params.workspace ?? resolveTaskWorkspace(params.userId, params.project, params.task)
  const session = params.session ?? resolveWorkspaceSessionForTaskContext(params.task, workspace?.id)
  const executorId = resolveWorkspaceSessionExecutorId(session, workspace?.executorNodeId)
  const executor = executorId
    ? executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
    : undefined

  return {
    workspace,
    session,
    executorId,
    workspaceRoot: executor?.workspaceRoot || params.state.config.workspaceRoot,
  }
}

const resolveTaskGitIdentitySafely = async (
  userId: string,
  project: Project,
  session?: WorkspaceSession | null,
) => {
  try {
    return await resolveUserProjectGitIdentity({
      userId,
      projectId: project.id,
      mode: 'personal',
      repoUrl: project.gitUrl,
      gitAuthPreference: session?.gitAuthPreference,
    })
  } catch {
    return undefined
  }
}

const resolveTaskBaseBranch = (task: Task, project: Project, workspace?: Workspace | null, session?: WorkspaceSession | null) => {
  return session?.baseBranch?.trim()
    || task.baseBranch?.trim()
    || task.baseBranchHint?.trim()
    || workspace?.suggestedBaseBranch?.trim()
    || workspace?.defaultBranch?.trim()
    || project.defaultBranch?.trim()
    || 'main'
}

const buildPullRequestTitle = (task: Task) => {
  const raw = (task.title?.trim() || task.description?.trim() || 'Workspace update').replace(/\s+/g, ' ')
  return raw.length > 72 ? `${raw.slice(0, 69)}...` : raw
}

const buildPullRequestBody = (task: Task, baseBranch: string, compareBranch: string) => {
  return [
    '## Summary',
    `- ${task.description?.trim() || task.title?.trim() || 'Workspace update'}`,
    '',
    '## Branches',
    `- Base: ${baseBranch}`,
    `- Compare: ${compareBranch}`,
    task.acceptanceCriteria?.trim()
      ? ['', '## Acceptance Criteria', task.acceptanceCriteria.trim()].join('\n')
      : '',
  ].filter(Boolean).join('\n')
}

const normalizePullRequestField = (value?: string | null) => value?.trim() || ''

const hasSamePullRequestSnapshot = (
  task: Task,
  nextPullRequest: {
    repoUrl: string
    title: string
    body: string
    baseBranch: string
    compareBranch: string
    number?: number
    url?: string
    state?: string
  },
) => {
  const currentPullRequest = task.result?.delivery?.pullRequest
  if (!currentPullRequest) {
    return false
  }

  return normalizePullRequestField(currentPullRequest.repoUrl) === normalizePullRequestField(nextPullRequest.repoUrl)
    && normalizePullRequestField(currentPullRequest.title) === normalizePullRequestField(nextPullRequest.title)
    && normalizePullRequestField(currentPullRequest.description) === normalizePullRequestField(nextPullRequest.body)
    && normalizePullRequestField(currentPullRequest.baseBranch) === normalizePullRequestField(nextPullRequest.baseBranch)
    && normalizePullRequestField(currentPullRequest.compareBranch) === normalizePullRequestField(nextPullRequest.compareBranch)
    && currentPullRequest.number === nextPullRequest.number
    && normalizePullRequestField(currentPullRequest.url) === normalizePullRequestField(nextPullRequest.url)
    && normalizePullRequestField(currentPullRequest.state) === normalizePullRequestField(nextPullRequest.state)
}

export const buildWorkspaceSessionPullRequestDeliverySummary = (
  task: Task,
  session: WorkspaceSession,
) => {
  return buildWorkspaceDeliverySummary([task], session.workspaceId, [session])
}

const hasSameWorkspaceSessionPullRequestDelivery = (
  current?: WorkspaceDeliverySummary,
  next?: WorkspaceDeliverySummary,
) => {
  const currentPullRequest = current?.pullRequest
  const nextPullRequest = next?.pullRequest
  if (!currentPullRequest || !nextPullRequest) {
    return currentPullRequest === nextPullRequest
  }

  return currentPullRequest.state === nextPullRequest.state
    && currentPullRequest.number === nextPullRequest.number
    && normalizePullRequestField(currentPullRequest.url) === normalizePullRequestField(nextPullRequest.url)
    && normalizePullRequestField(currentPullRequest.compareBranch) === normalizePullRequestField(nextPullRequest.compareBranch)
    && currentPullRequest.workspaceId === nextPullRequest.workspaceId
    && currentPullRequest.workspaceSessionId === nextPullRequest.workspaceSessionId
}

const attachTaskPullRequestResult = (params: {
  task: Task
  repoUrl: string
  title: string
  body: string
  baseBranch: string
  compareBranch: string
  number?: number
  url?: string
  state?: string
  updatedAt: string
  executorNodeId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const nextResult = params.task.result
    ? {
        ...params.task.result,
        workspaceId: params.workspaceId ?? params.task.result.workspaceId,
        workspaceSessionId: params.workspaceSessionId ?? params.task.result.workspaceSessionId,
        delivery: {
          ...(params.task.result.delivery ?? { mode: params.task.result.returnMode }),
          pullRequest: {
            ready: true,
            remoteReady: true,
            repoUrl: params.repoUrl,
            title: params.title,
            description: params.body,
            baseBranch: params.baseBranch,
            compareBranch: params.compareBranch,
            number: params.number,
            url: params.url,
            state: params.state,
          },
          syncFailureReason: undefined,
        },
      }
    : {
        taskId: params.task.id,
        status: 'completed' as const,
        returnMode: 'commit' as const,
        summary: 'PR status recorded.',
        filesChanged: [],
        startedAt: params.updatedAt,
        completedAt: params.updatedAt,
        durationSec: 0,
        executorNodeId: params.executorNodeId ?? params.task.executionHistory.at(-1)?.executorNodeId ?? '',
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId,
        delivery: {
          mode: 'commit' as const,
          pullRequest: {
            ready: true,
            remoteReady: true,
            repoUrl: params.repoUrl,
            title: params.title,
            description: params.body,
            baseBranch: params.baseBranch,
            compareBranch: params.compareBranch,
            number: params.number,
            url: params.url,
            state: params.state,
          },
        },
      }

  return {
    ...params.task,
    updatedAt: params.updatedAt,
    result: nextResult,
  } satisfies Task
}

const resolveTaskGitTarget = (params: {
  userId: string
  state: AppState
  project: Project
  task: Task
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const workspace = resolveTaskWorkspace(params.userId, params.project, params.task, params.workspaceId, params.workspaceSessionId)
  const session = resolveWorkspaceSessionForTaskContext(params.task, workspace?.id || params.workspaceId, params.workspaceSessionId)
  const context = resolveTaskExecutorContext({
    userId: params.userId,
    state: params.state,
    project: params.project,
    task: params.task,
    workspace,
    session,
  })
  const effectiveWorktreeSession = context.session
    ? applyWorkspaceCodeStateToSession(
        resolveEffectiveWorkspaceWorktreeSession(params.task.id, context.session, workspace?.executorNodeId),
        workspace ?? {
          id: context.session.workspaceId,
          name: '',
          codeBaseBranch: context.session.baseBranch,
          codeBranchName: context.session.branchName,
          suggestedBaseBranch: params.project.defaultBranch,
          defaultBranch: params.project.defaultBranch,
          workingDirectoryMode: context.session.workingDirectoryMode,
        },
      )
    : null
  const baseBranch = resolveTaskBaseBranch(params.task, params.project, context.workspace, effectiveWorktreeSession ?? context.session)
  const compareBranch = effectiveWorktreeSession?.branchName?.trim() || ''

  return {
    ...context,
    worktreePath: context.session
      ? resolveWorkspaceSessionCwd(context.workspaceRoot, params.project, effectiveWorktreeSession ?? context.session, context.workspace)
      : undefined,
    baseBranch,
    compareBranch,
    effectiveWorktreeSession,
  }
}

export const registerTaskGitRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/tasks/:id/git/commit-diff', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')
    const workspaceSessionId = c.req.query('workspaceSessionId')
    const commitSha = c.req.query('sha')?.trim() || ''
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', commitSha, files: [], patch: '' })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId,
      workspaceSessionId,
    })

    if (!commitSha) {
      return c.json({ ok: false, message: '缺少 commit SHA。', commitSha: '', files: [], patch: '' })
    }
    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', commitSha, files: [], patch: '' })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再查看 commit diff。', commitSha, files: [], patch: '' })
    }

    const result = await executorWsService.requestGitCommitDiff(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      commitSha,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '读取 commit diff 失败。',
      commitSha,
      files: [],
      patch: '',
    }))

    return c.json(result)
  })

  app.get('/api/tasks/:id/git/diff', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')
    const workspaceSessionId = c.req.query('workspaceSessionId')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', baseBranch: taskResult.project.defaultBranch || 'main', currentBranch: '', aheadCommits: 0, files: [], patch: '' })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId,
      workspaceSessionId,
    })

    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', baseBranch: target.baseBranch, currentBranch: '', aheadCommits: 0, files: [], patch: '' })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再查看 Git diff。', baseBranch: target.baseBranch, currentBranch: '', aheadCommits: 0, files: [], patch: '' })
    }

    const result = await executorWsService.requestGitDiff(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      baseBranch: target.baseBranch,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '读取 Git diff 失败。',
      baseBranch: target.baseBranch,
      currentBranch: target.compareBranch,
      aheadCommits: 0,
      files: [],
      patch: '',
    }))

    return c.json(result)
  })

  app.get('/api/tasks/:id/git/working-tree-diff', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')
    const workspaceSessionId = c.req.query('workspaceSessionId')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', currentBranch: '', files: [], patch: '' })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId,
      workspaceSessionId,
    })

    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', currentBranch: '', files: [], patch: '' })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再查看当前工作区 Git 改动。', currentBranch: '', files: [], patch: '' })
    }

    const result = await executorWsService.requestGitWorkingTreeDiff(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '读取当前工作区 Git 改动失败。',
      currentBranch: target.compareBranch,
      files: [],
      patch: '',
    }))

    return c.json(result)
  })

  app.get('/api/tasks/:id/git/status', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', currentBranch: '', changes: [] })
    }
    const target = resolveTaskGitTarget({
      userId, state, project: taskResult.project, task: taskResult.task,
      workspaceId: c.req.query('workspaceId'), workspaceSessionId: c.req.query('workspaceSessionId'),
    })
    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', currentBranch: '', changes: [] })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再查看 Git 改动。', currentBranch: '', changes: [] })
    }
    const result = await executorWsService.requestGitStatus(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project, target.session),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '读取 Git 状态失败。',
      currentBranch: target.compareBranch,
      changes: [],
    }))
    return c.json(result)
  })

  app.get('/api/tasks/:id/git/file-diff', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const path = c.req.query('path')?.trim() || ''
    const stage = z.enum(['staged', 'unstaged']).catch('unstaged').parse(c.req.query('stage'))
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', path, stage, patch: '' })
    }
    const target = resolveTaskGitTarget({
      userId, state, project: taskResult.project, task: taskResult.task,
      workspaceId: c.req.query('workspaceId'), workspaceSessionId: c.req.query('workspaceSessionId'),
    })
    if (!path) return c.json({ ok: false, message: '缺少文件路径。', path, stage, patch: '' })
    if (!target.executorId || !target.session || !target.worktreePath) {
      return c.json({ ok: false, message: !target.executorId ? '当前工作区会话还没有绑定执行节点。' : '请先准备工作目录，再查看文件 diff。', path, stage, patch: '' })
    }
    const result = await executorWsService.requestGitFileDiff(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      path,
      stage,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project, target.session),
    }).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : '读取文件 diff 失败。', path, stage, patch: '' }))
    return c.json(result)
  })

  app.post('/api/tasks/:id/git/change', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const payload = z.object({
      workspaceId: z.string().trim().min(1).optional(),
      workspaceSessionId: z.string().trim().min(1).optional(),
      action: z.enum(['stage', 'unstage', 'discard']),
      paths: z.array(z.string().trim().min(1)).min(1).max(200),
    }).parse(await c.req.json().catch(() => ({})))
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', changedPaths: [] })
    }
    const target = resolveTaskGitTarget({
      userId, state, project: taskResult.project, task: taskResult.task,
      workspaceId: payload.workspaceId, workspaceSessionId: payload.workspaceSessionId,
    })
    if (!target.executorId || !target.session || !target.worktreePath) {
      return c.json({ ok: false, message: !target.executorId ? '当前工作区会话还没有绑定执行节点。' : '请先准备工作目录，再更新 Git 改动。', changedPaths: [] })
    }
    const result = await executorWsService.requestGitChange(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      action: payload.action,
      paths: payload.paths,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project, target.session),
    }).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : '更新 Git 改动失败。', changedPaths: [] }))
    return c.json(result)
  })

  app.post('/api/tasks/:id/git/commit-staged', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const payload = z.object({
      workspaceId: z.string().trim().min(1).optional(),
      workspaceSessionId: z.string().trim().min(1).optional(),
      commitMessage: z.string().trim().min(1).max(2000),
      push: z.boolean().optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const taskResult = getAuthorizedTask(state, userId, c.req.param('id'))
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', branchName: '', changedFiles: [] })
    }
    if (payload.push && taskResult.project.versionControl !== 'git-remote') {
      return c.json({ ok: false, message: '本地 Git 项目不能推送远端。', branchName: '', changedFiles: [] })
    }
    const target = resolveTaskGitTarget({
      userId, state, project: taskResult.project, task: taskResult.task,
      workspaceId: payload.workspaceId, workspaceSessionId: payload.workspaceSessionId,
    })
    if (!target.executorId || !target.session || !target.worktreePath) {
      return c.json({ ok: false, message: !target.executorId ? '当前工作区会话还没有绑定执行节点。' : '请先准备工作目录，再提交改动。', branchName: target.compareBranch, changedFiles: [] })
    }
    const result = await executorWsService.requestGitCommit(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      branchName: target.compareBranch || undefined,
      commitMessage: payload.commitMessage,
      push: payload.push && taskResult.project.versionControl === 'git-remote',
      stagedOnly: true,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project, target.session),
    }).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : '提交已暂存改动失败。', branchName: target.compareBranch, changedFiles: [] }))
    return c.json(result)
  })

  app.get('/api/tasks/:id/git/graph', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const workspaceId = c.req.query('workspaceId')
    const workspaceSessionId = c.req.query('workspaceSessionId')
    const limit = z.coerce.number().min(10).max(120).optional().parse(c.req.query('limit') || undefined)
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', baseBranch: taskResult.project.defaultBranch || 'main', currentBranch: '', limit: limit ?? 40, commitCount: 0, graph: '', commits: [] })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId,
      workspaceSessionId,
    })

    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', baseBranch: target.baseBranch, currentBranch: '', limit: limit ?? 40, commitCount: 0, graph: '', commits: [] })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再查看 Git graph。', baseBranch: target.baseBranch, currentBranch: '', limit: limit ?? 40, commitCount: 0, graph: '', commits: [] })
    }

    const result = await executorWsService.requestGitGraph(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      baseBranch: target.baseBranch,
      limit,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '读取 Git graph 失败。',
      baseBranch: target.baseBranch,
      currentBranch: target.compareBranch,
      limit: limit ?? 40,
      commitCount: 0,
      graph: '',
      commits: [],
    }))

    return c.json(result)
  })

  app.post('/api/tasks/:id/git/rebase', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const payload = z.object({
      workspaceId: z.string().trim().min(1).optional(),
      workspaceSessionId: z.string().trim().min(1).optional(),
      baseBranch: z.string().trim().min(1).optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl === 'none') {
      return c.json({ ok: false, message: '当前项目未启用 Git。', baseBranch: taskResult.project.defaultBranch || 'main', currentBranch: '', conflicts: false, conflictedFiles: [] })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })

    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', baseBranch: target.baseBranch, currentBranch: '', conflicts: false, conflictedFiles: [] })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再执行 rebase。', baseBranch: target.baseBranch, currentBranch: '', conflicts: false, conflictedFiles: [] })
    }

    const requestedBaseBranch = payload.baseBranch?.trim() || target.baseBranch
    const result = await executorWsService.requestGitRebase(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl?.trim() || undefined,
      baseBranch: requestedBaseBranch,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '执行 rebase 失败。',
      baseBranch: requestedBaseBranch,
      currentBranch: target.compareBranch,
      conflicts: false,
      conflictedFiles: [],
    }))

    if (result.ok) {
      const updatedAt = new Date().toISOString()
      if (target.session) {
        if (target.workspace) {
          saveWorkspace({
            ...target.workspace,
            codeBaseBranch: requestedBaseBranch,
            updatedAt,
          })
        }
        const nextSession = mergeWorkspaceSession(taskResult.task, target.session, {
          baseBranch: requestedBaseBranch,
          updatedAt,
        })
        await saveWorkspaceSessionAndWait(nextSession)
      } else {
        const nextTask: Task = {
          ...taskResult.task,
          baseBranch: requestedBaseBranch,
          updatedAt,
        }
        await saveTaskAndWait(nextTask)
      }

      rememberRecentBaseBranch(taskResult.project, requestedBaseBranch)
    }

    return c.json(result)
  })

  app.post('/api/tasks/:id/git/pull-request', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const payload = z.object({
      workspaceId: z.string().trim().min(1).optional(),
      workspaceSessionId: z.string().trim().min(1).optional(),
      title: z.string().trim().optional(),
      body: z.string().optional(),
      baseBranch: z.string().trim().optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl !== 'git-remote') {
      return c.json({
        ok: false,
        message: taskResult.project.versionControl === 'none' ? '当前项目未启用 Git。' : '本地 Git 项目暂不支持直接创建 PR。',
        provider: null,
        title: payload.title?.trim() || buildPullRequestTitle(taskResult.task),
        body: payload.body?.trim() || '',
        baseBranch: payload.baseBranch?.trim() || taskResult.project.defaultBranch || 'main',
        compareBranch: '',
      })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    const baseBranch = payload.baseBranch?.trim() || target.baseBranch
    const compareBranch = target.compareBranch
    const title = payload.title?.trim() || buildPullRequestTitle(taskResult.task)
    const body = payload.body?.trim() || buildPullRequestBody(taskResult.task, baseBranch, compareBranch)

    if (!target.executorId) {
      return c.json({ ok: false, message: '当前工作区会话还没有绑定执行节点。', provider: null, title, body, baseBranch, compareBranch })
    }
    if (!target.session || !target.worktreePath) {
      return c.json({ ok: false, message: '请先准备工作目录，再创建 PR。', provider: null, title, body, baseBranch, compareBranch })
    }
    if (target.session.publishPolicy !== 'pull-request') {
      return c.json({
        ok: false,
        message: '当前工作区会话未启用 PR 发布权限。请先把会话发布策略切换为允许创建 PR。',
        provider: null,
        title,
        body,
        baseBranch,
        compareBranch,
      })
    }

    const gitIdentity = await resolveTaskGitIdentitySafely(userId, taskResult.project, target.session)
    if (
      !gitIdentity?.credentialToken
      || !['pat', 'github-app'].includes(gitIdentity.authMode ?? '')
      || gitIdentity.provider !== 'github'
    ) {
      return c.json({
        ok: false,
        message: '创建 PR 目前需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
        provider: null,
        title,
        body,
        baseBranch,
        compareBranch,
      })
    }

    const result = await executorWsService.requestGitPullRequest(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: taskResult.project.gitUrl,
      title,
      body,
      baseBranch,
      compareBranch,
      gitIdentity,
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : '创建 PR 失败。',
      provider: 'github' as const,
      title,
      body,
      baseBranch,
      compareBranch,
    }))

    if (result.ok) {
      const updatedAt = new Date().toISOString()
      const currentStep = result.url ? `PR 已创建：${result.url}` : result.message
      await registerProjectPullRequestContext({
        project: taskResult.project,
        taskId: taskResult.task.id,
        workspaceId: target.workspace?.id,
        workspaceSessionId: target.session?.id,
        userId,
        source: 'manual',
        role: 'delivery',
        pullRequest: {
          number: result.number,
          url: result.url,
          title: result.title,
          body: result.body,
          state: normalizeProjectPullRequestState(result.state),
          baseBranch: result.baseBranch,
          compareBranch: result.compareBranch,
          updatedAt,
        },
      })
      const taskWithPullRequest = attachTaskPullRequestResult({
        task: taskResult.task,
        repoUrl: taskResult.project.gitUrl,
        title: result.title,
        body: result.body,
        baseBranch: result.baseBranch,
      compareBranch: result.compareBranch,
      number: result.number,
      url: result.url,
      state: result.state,
      updatedAt,
      executorNodeId: target.executorId,
      workspaceId: target.workspace?.id,
      workspaceSessionId: target.session?.id,
    })
      const nextTask: Task = {
        ...syncTaskStatusFromReviewReady(taskWithPullRequest, updatedAt),
        currentStep,
        needsHumanConfirm: true,
        agentRunningStatus: 'complete',
      }
      const deliverySummary = target.session
        ? buildWorkspaceSessionPullRequestDeliverySummary(nextTask, target.session)
        : undefined
      const nextSession = mergeWorkspaceSession(taskResult.task, target.session, {
        currentStep,
        needsHumanConfirm: true,
        deliverySummary,
        updatedAt,
        lastActiveAt: updatedAt,
      })
      await saveTaskAndWait(nextTask)
      await saveWorkspaceSessionAndWait(nextSession)
      const nextTasks = state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item))
      const nextWorkspaceSessions = state.workspaceSessions.map((item) => (item.id === nextSession.id ? nextSession : item))
      const nextState: AppState = {
        ...state,
        tasks: nextTasks,
      }
      await withState({
        ...nextState,
        workspaceSessions: nextWorkspaceSessions,
      }, undefined, userId)
    }

    return c.json(result)
  })

  app.post('/api/tasks/:id/git/pull-request/status', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const payload = z.object({
      workspaceId: z.string().trim().min(1).optional(),
      workspaceSessionId: z.string().trim().min(1).optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    if (taskResult.project.versionControl !== 'git-remote') {
      return c.json({
        ok: false,
        message: taskResult.project.versionControl === 'none' ? '当前项目未启用 Git。' : '本地 Git 项目暂不支持刷新远端 PR 状态。',
        provider: null,
        title: taskResult.task.result?.delivery?.pullRequest?.title || buildPullRequestTitle(taskResult.task),
        body: taskResult.task.result?.delivery?.pullRequest?.description || '',
        baseBranch: taskResult.task.result?.delivery?.pullRequest?.baseBranch || taskResult.project.defaultBranch || 'main',
        compareBranch: taskResult.task.result?.delivery?.pullRequest?.compareBranch || '',
        number: taskResult.task.result?.delivery?.pullRequest?.number,
        url: taskResult.task.result?.delivery?.pullRequest?.url,
        state: taskResult.task.result?.delivery?.pullRequest?.state,
      })
    }

    const target = resolveTaskGitTarget({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
      workspaceId: payload.workspaceId,
      workspaceSessionId: payload.workspaceSessionId,
    })
    const storedPullRequest = taskResult.task.result?.delivery?.pullRequest
    const baseBranch = storedPullRequest?.baseBranch?.trim() || target.baseBranch
    const compareBranch = storedPullRequest?.compareBranch?.trim() || target.compareBranch
    const title = storedPullRequest?.title || buildPullRequestTitle(taskResult.task)
    const body = storedPullRequest?.description || buildPullRequestBody(taskResult.task, baseBranch, compareBranch)

    const refreshed = await lookupPullRequest({
      repoUrl: storedPullRequest?.repoUrl?.trim() || taskResult.project.gitUrl,
      number: storedPullRequest?.number,
      baseBranch,
      compareBranch,
      gitIdentity: await resolveTaskGitIdentitySafely(userId, taskResult.project),
    })

    if (!refreshed.ok || !refreshed.pullRequest) {
      return c.json({
        ok: false,
        message: refreshed.message,
        provider: refreshed.provider,
        title,
        body,
        baseBranch,
        compareBranch,
        number: storedPullRequest?.number,
        url: storedPullRequest?.url,
        state: storedPullRequest?.state,
      })
    }

    const updatedAt = new Date().toISOString()
    const nextPullRequest = refreshed.pullRequest
    const nextPullRequestSnapshot = {
      repoUrl: storedPullRequest?.repoUrl?.trim() || taskResult.project.gitUrl,
      title: nextPullRequest.title || title,
      body: nextPullRequest.body || body,
      baseBranch: nextPullRequest.baseBranch || baseBranch,
      compareBranch: nextPullRequest.compareBranch || compareBranch,
      number: nextPullRequest.number,
      url: nextPullRequest.url,
      state: normalizeProjectPullRequestState(nextPullRequest.state),
    }
    await registerProjectPullRequestContext({
      project: taskResult.project,
      taskId: taskResult.task.id,
      workspaceId: target.workspace?.id,
      workspaceSessionId: target.session?.id,
      userId,
      source: 'manual',
      role: 'delivery',
      pullRequest: {
        ...nextPullRequestSnapshot,
        merged: nextPullRequest.merged,
        updatedAt,
      },
    })
    const taskWithPullRequest = attachTaskPullRequestResult({
      task: taskResult.task,
      ...nextPullRequestSnapshot,
      updatedAt,
      executorNodeId: target.executorId,
      workspaceId: target.workspace?.id,
      workspaceSessionId: target.session?.id,
    })
    const currentStep = nextPullRequest.merged
      ? (nextPullRequest.url ? `PR 已合并：${nextPullRequest.url}` : `PR #${nextPullRequest.number} 已合并`)
      : nextPullRequest.state === 'open'
        ? (nextPullRequest.url ? `PR 审核中：${nextPullRequest.url}` : `PR #${nextPullRequest.number} 审核中`)
        : (nextPullRequest.url ? `PR 已关闭：${nextPullRequest.url}` : `PR #${nextPullRequest.number} 已关闭`)
    const nextTask: Task = nextPullRequest.merged
      ? {
          ...syncTaskStatusFromWorkMerged(taskWithPullRequest, updatedAt),
          currentStep,
          needsHumanConfirm: false,
          agentRunningStatus: 'complete',
        }
      : nextPullRequest.state === 'open'
        ? {
            ...syncTaskStatusFromReviewReady(taskWithPullRequest, updatedAt),
            currentStep,
            needsHumanConfirm: true,
            agentRunningStatus: 'complete',
          }
        : {
            ...touchTaskStatus(taskWithPullRequest, updatedAt),
            currentStep,
            needsHumanConfirm: true,
            agentRunningStatus: 'complete',
          }
    const nextNeedsHumanConfirm = !nextPullRequest.merged
    const nextSessionDeliverySummary = target.session
      ? buildWorkspaceSessionPullRequestDeliverySummary(nextTask, target.session)
      : undefined
    const sessionAlreadySynced = !target.session || (
      target.session.currentStep === currentStep
      && target.session.needsHumanConfirm === nextNeedsHumanConfirm
      && target.session.agentRunningStatus === 'complete'
      && hasSameWorkspaceSessionPullRequestDelivery(target.session.deliverySummary, nextSessionDeliverySummary)
    )

    if (
      hasSamePullRequestSnapshot(taskResult.task, nextPullRequestSnapshot)
      && taskResult.task.status === nextTask.status
      && taskResult.task.currentStep === currentStep
      && taskResult.task.needsHumanConfirm === nextNeedsHumanConfirm
      && taskResult.task.agentRunningStatus === 'complete'
      && sessionAlreadySynced
    ) {
      return c.json({
        ok: true,
        message: refreshed.message,
        provider: refreshed.provider,
        title: nextPullRequestSnapshot.title,
        body: nextPullRequestSnapshot.body,
        baseBranch: nextPullRequestSnapshot.baseBranch,
        compareBranch: nextPullRequestSnapshot.compareBranch,
        number: nextPullRequestSnapshot.number,
        url: nextPullRequestSnapshot.url,
        state: nextPullRequestSnapshot.state,
      })
    }

    await saveTaskAndWait(nextTask)

    let nextWorkspaceSessions = state.workspaceSessions
    if (target.session) {
      const nextSession = mergeWorkspaceSession(taskResult.task, target.session, {
        currentStep,
        needsHumanConfirm: !nextPullRequest.merged,
        deliverySummary: nextSessionDeliverySummary,
        updatedAt,
        lastActiveAt: updatedAt,
      })
      await saveWorkspaceSessionAndWait(nextSession)
      nextWorkspaceSessions = state.workspaceSessions.map((item) => (item.id === nextSession.id ? nextSession : item))
    }

    await withState({
      ...state,
      tasks: state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)),
      workspaceSessions: nextWorkspaceSessions,
    }, undefined, userId)

    return c.json({
      ok: true,
      message: refreshed.message,
      provider: refreshed.provider,
      title: nextPullRequestSnapshot.title,
      body: nextPullRequestSnapshot.body,
      baseBranch: nextPullRequestSnapshot.baseBranch,
      compareBranch: nextPullRequestSnapshot.compareBranch,
      number: nextPullRequestSnapshot.number,
      url: nextPullRequestSnapshot.url,
      state: nextPullRequestSnapshot.state,
    })
  })
}
