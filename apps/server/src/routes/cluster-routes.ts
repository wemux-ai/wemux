// [INPUT]: 已鉴权 Hono app，内部集群请求（executor request）、project-bindings 请求
// [OUTPUT]: /api/internal/cluster/*、/api/cluster/nodes、/api/project-bindings、/api/distributed-tasks 路由
// [POS]: 集群/节点/绑定/分布式任务 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { syncTaskStatusFromReviewReady, syncTaskStatusFromWorkMerged, touchTaskStatus } from '@shared/task-status-flow'
import { applyWorkspaceCodeStateToSession, mergeWorkspaceSession } from '@shared/task-workspace'
import { resolveTaskWorktreePath } from '@shared/workspace-paths'
import type { AppState, DistributedTask, Task } from '@shared/types'
import { clusterConfig } from '../cluster/config'
import { chooseExecutorNode } from '../cluster/scheduler'
import { canUserUseExecutorForProject } from '../control-plane/collaboration'
import { executorRegistry } from '../control-plane/executor-registry'
import { recordAdminOperationAudit } from '../control-plane/governance-service'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { executorWsService } from '../control-plane/executor-ws-service'
import { chooseControlPlaneExecutorForTask } from '../control-plane/scheduler'
import { reconcileControlPlaneTaskQueue, requestExecutorTaskCancellation } from '../control-plane/task-dispatch'
import { stopTaskChatExecution } from '../services/task-chat-dispatch'
import { syncDistributedTaskEvent, syncDistributedTaskResult } from '../cluster/task-sync'
import { lookupPullRequest } from '../services/github-pull-request-service'
import { buildExecutionDescriptionWithSkills, resolveRuntimeSkills } from '../services/skill-service'
import { getTaskRunByDistributedTaskId, getWorkspaceSession, loadState, saveTaskAndWait, saveTaskRunAndWait, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { deactivateProjectBinding, getDistributedTask, listNodes, listProjectBindings, listWorkspaces, saveDistributedTaskAndWait, updateDistributedTaskAndWait, upsertProjectBinding } from '../storage/distributed-task-store'
import { cancelDistributedTask, createDistributedTaskRecord, distributedTaskSchema, ensureClusterToken, getAuthorizedProject, getAuthorizedTask, getScopedState, getUserIdFromHeader, isDistributedTaskTerminal, jsonError, projectBindingSchema, resetDistributedTask, sanitizeDistributedTaskForClient, withClusterState, withState } from './shared'
import { getWorkspaceSessionRecordForTaskContext, resolveEffectiveWorkspaceWorktreeSession } from './task-route-support'

const buildPullRequestTitle = (task: Task) => {
  const raw = (task.title?.trim() || task.description?.trim() || 'Worker delivery update').replace(/\s+/g, ' ')
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

const appendExecutionRun = (task: Task, _payload: {
  distributedTaskId: string
  executorNodeId: string
  returnMode: DistributedTask['returnMode']
  gitIdentityMode?: DistributedTask['gitIdentityMode']
}) => ({
  ...task,
  executionHistory: task.executionHistory,
})

export const registerClusterRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  const requireClusterAccess: MiddlewareHandler = async (c, next) => {
    if (!ensureClusterToken(c)) {
      return c.json({ message: '无权限访问集群内部接口。' }, 401)
    }

    await next()
  }

  const runtimeEnvironmentExecutionPayloadSchema = z.object({
    mode: z.enum(['process-env', 'env-file']),
    variables: z.record(z.string(), z.string()),
    fileName: z.string().trim().optional(),
    fileContent: z.string().optional(),
  })

  const internalExecutorRequestSchema = z.discriminatedUnion('operation', [
    z.object({
      operation: z.literal('repo-probe'),
      localPath: z.string().trim().min(1),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('pat-verification'),
      provider: z.enum(['github', 'gitlab']),
      host: z.string().trim().min(1),
      patToken: z.string().min(1),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('ssh-verification'),
      host: z.string().trim().min(1),
      sshPrivateKey: z.string().min(1),
      repoUrl: z.string().trim().optional(),
      sshUser: z.string().trim().optional(),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('telemetry'),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('doctor'),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('terminal-command'),
      command: z.string().trim().min(1),
      cwd: z.string().trim().optional(),
      mode: z.enum(['wait', 'background']).optional(),
      runtimeEnvironment: runtimeEnvironmentExecutionPayloadSchema.optional(),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('terminal-session-list'),
      scope: z.enum(['workspace', 'executor']).optional(),
      workspaceId: z.string().trim().optional(),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('terminal-session-create'),
      terminalId: z.string().trim().min(1),
      scope: z.enum(['workspace', 'executor']),
      workspaceId: z.string().trim().optional(),
      title: z.string().trim().optional(),
      cwd: z.string().trim().optional(),
      cols: z.number().int().positive().max(1000).optional(),
      rows: z.number().int().positive().max(1000).optional(),
      ownerUserId: z.string().trim().optional(),
      runtimeEnvironment: runtimeEnvironmentExecutionPayloadSchema.optional(),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
    z.object({
      operation: z.literal('terminal-session-close'),
      terminalId: z.string().trim().min(1),
      scope: z.enum(['workspace', 'executor']),
      workspaceId: z.string().trim().optional(),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
  ])

  app.post('/api/internal/cluster/executors/:executorId/request', requireClusterAccess, async (c) => {
    const executorId = c.req.param('executorId')
    const payload = internalExecutorRequestSchema.parse(await c.req.json())

    try {
      switch (payload.operation) {
        case 'repo-probe':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestRepoProbeOnLocalNode(executorId, payload.localPath, payload.timeoutMs),
          })
        case 'pat-verification':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestPatVerificationOnLocalNode(
              executorId,
              payload.provider,
              payload.host,
              payload.patToken,
              payload.timeoutMs,
            ),
          })
        case 'ssh-verification':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestSshVerificationOnLocalNode(
              executorId,
              {
                host: payload.host,
                sshPrivateKey: payload.sshPrivateKey,
                repoUrl: payload.repoUrl,
                sshUser: payload.sshUser,
              },
              payload.timeoutMs,
            ),
          })
        case 'telemetry':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestTelemetryOnLocalNode(executorId, payload.timeoutMs),
          })
        case 'doctor':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestDoctorOnLocalNode(executorId, payload.timeoutMs),
          })
        case 'terminal-command':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestTerminalCommandOnLocalNode(
              executorId,
              payload.command,
              payload.cwd,
              {
                mode: payload.mode,
                runtimeEnvironment: payload.runtimeEnvironment,
                timeoutMs: payload.timeoutMs,
              },
            ),
          })
        case 'terminal-session-list':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestTerminalSessionListOnLocalNode(executorId, {
              scope: payload.scope,
              workspaceId: payload.workspaceId,
            }, payload.timeoutMs),
          })
        case 'terminal-session-create':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestTerminalSessionCreateOnLocalNode(executorId, {
              terminalId: payload.terminalId,
              scope: payload.scope,
              workspaceId: payload.workspaceId,
              title: payload.title,
              cwd: payload.cwd,
              cols: payload.cols,
              rows: payload.rows,
              ownerUserId: payload.ownerUserId,
              runtimeEnvironment: payload.runtimeEnvironment,
            }, payload.timeoutMs),
          })
        case 'terminal-session-close':
          return c.json({
            handledByNodeId: clusterConfig.nodeId,
            result: await executorWsService.requestTerminalSessionCloseOnLocalNode(executorId, {
              terminalId: payload.terminalId,
              scope: payload.scope,
              workspaceId: payload.workspaceId,
            }, payload.timeoutMs),
          })
      }
    } catch (error) {
      return c.json({
        message: error instanceof Error ? error.message : '跨节点执行器请求失败。',
      }, 503)
    }
  })

  app.get('/api/cluster/nodes', requireAuth, async (c) => {
    return c.json({ nodes: listNodes(), currentNodeId: clusterConfig.nodeId })
  })

  // 跨节点 task chat stop relay：由 owning node 上的 stopTaskChatExecutionAcrossNodes 转发而来，
  // 在本节点命中 AbortController（幂等；重复 stop 无害）。
  app.post('/api/internal/cluster/task-chat/stop', requireClusterAccess, async (c) => {
    const payload = await c.req.json().catch(() => null) as {
      taskId?: string
      workspaceId?: string
      workspaceSessionId?: string
    } | null
    const taskId = payload?.taskId?.trim()
    if (!taskId) {
      return c.json({ message: 'taskId 缺失。' }, 400)
    }

    const stopped = stopTaskChatExecution({
      taskId,
      workspaceId: payload?.workspaceId?.trim() || undefined,
      workspaceSessionId: payload?.workspaceSessionId?.trim() || undefined,
    })
    return c.json({ stopped, handledByNodeId: clusterConfig.nodeId })
  })

  app.get('/api/project-bindings', requireAuth, async (c) => {
    return c.json({ bindings: listProjectBindings(), currentNodeId: clusterConfig.nodeId })
  })

  app.post('/api/project-bindings', requireAuth, async (c) => {
    const payload = projectBindingSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, payload.projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    const project = projectResult.project
    const now = new Date().toISOString()
    upsertProjectBinding({
      projectId: project.id,
      nodeId: payload.nodeId,
      repoUrl: project.gitUrl,
      defaultBranch: project.defaultBranch ?? 'main',
      pathHint: payload.pathHint.trim() || undefined,
      mode: payload.pathHint.trim() ? 'manual' : 'auto',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    return c.json(await withState(withClusterState(state), '项目绑定已更新。', userId))
  })

  app.delete('/api/project-bindings/:projectId/:nodeId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const projectId = c.req.param('projectId')
    const nodeId = c.req.param('nodeId')
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)

    deactivateProjectBinding(projectId, nodeId)
    return c.json(await withState(withClusterState(state), '项目绑定已删除。', userId))
  })

  app.post('/api/project-bindings/:projectId/validate', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const projectId = c.req.param('projectId')
    const nodeId = c.req.query('nodeId')?.trim()
    const state = loadState()
    const projectResult = getAuthorizedProject(state, userId, projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)
    if (!nodeId) return c.json({ ok: false, message: '缺少节点 ID。' }, 400)

    const binding = state.projectBindings.find((item) => item.projectId === projectId && item.nodeId === nodeId)
    const targetPath = binding?.pathHint?.trim() || ''
    if (!targetPath) {
      return c.json({ ok: true, message: '该节点未设置固定仓库目录。任务执行时会自动克隆到节点工作区。' })
    }

    const access = canUserUseExecutorForProject({
      userId,
      projectId,
      executorId: nodeId,
    })
    if (!access.ok) {
      return c.json({ ok: false, message: access.message }, 403)
    }

    try {
      const result = await executorWsService.requestRepoProbe(nodeId, targetPath)
      return c.json({
        ok: result.ok,
        name: result.name,
        gitUrl: result.gitUrl,
        versionControl: result.versionControl,
        defaultBranch: result.defaultBranch,
        message: result.message,
      }, result.ok ? 200 : 400)
    } catch (error) {
      return c.json({ ok: false, message: error instanceof Error ? error.message : '执行器目录探测失败。' }, 503)
    }
  })

  app.get('/api/distributed-tasks', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = getScopedState(loadState(), userId)
    return c.json({ tasks: state.distributedTasks })
  })

  app.get('/api/distributed-tasks/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const task = getDistributedTask(c.req.param('id'))
    if (!task) return c.json({ message: '分布式任务不存在。' }, 404)
    const projectResult = getAuthorizedProject(loadState(), userId, task.projectId)
    if (!projectResult.project) return jsonError(c, projectResult.message, projectResult.status)
    return c.json({ task: sanitizeDistributedTaskForClient(task) })
  })

  app.post('/api/distributed-tasks/:id/pull-request', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({
      title: z.string().trim().optional(),
      body: z.string().optional(),
      baseBranch: z.string().trim().optional(),
    }).parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const distributedTask = getDistributedTask(c.req.param('id'))
    if (!distributedTask) {
      return c.json({ message: '分布式任务不存在。' }, 404)
    }

    const taskResult = getAuthorizedTask(state, userId, distributedTask.originTaskId)
    if (!taskResult.task || !taskResult.project) {
      return jsonError(c, taskResult.message, taskResult.status)
    }

    if (!distributedTask.workspaceId) {
      return c.json({ message: '当前分布式任务没有关联工作区，无法创建 PR。' }, 400)
    }

    const session = distributedTask.workspaceSessionId
      ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, distributedTask.workspaceId, distributedTask.workspaceSessionId)
      : getWorkspaceSession(distributedTask.workspaceId)
    const workspace = listWorkspaces().find((item) => item.id === distributedTask.workspaceId && item.projectId === distributedTask.projectId)
    if (!workspace) {
      return c.json({ message: '关联工作区不存在。' }, 404)
    }
    const effectiveWorktreeSession = session
      ? applyWorkspaceCodeStateToSession(
          resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, session, distributedTask.executorNodeId || workspace.executorNodeId),
          workspace,
        )
      : null
    if (!effectiveWorktreeSession || effectiveWorktreeSession.worktreeStatus !== 'created') {
      return c.json({ message: '当前 worktree 尚未准备完成，无法创建 PR。' }, 400)
    }

    const executorId = distributedTask.executorNodeId?.trim() || workspace.executorNodeId?.trim() || effectiveWorktreeSession.executorNodeId?.trim() || ''
    if (!executorId) {
      return c.json({ message: '当前分布式任务没有绑定执行节点。' }, 400)
    }

    const executor = executorRegistry.listExecutorsWithPresence().find((item) => item.executorId === executorId)
    const worktreePath = resolveTaskWorktreePath(
      executor?.workspaceRoot || state.config.workspaceRoot,
      taskResult.project,
      {
        id: taskResult.task.id,
        workspaceId: distributedTask.workspaceId,
        worktreeId: effectiveWorktreeSession.worktreeId,
      },
    )
    const compareBranch = effectiveWorktreeSession.branchName.trim()
    const baseBranch = payload.baseBranch?.trim()
      || effectiveWorktreeSession.baseBranch?.trim()
      || taskResult.task.baseBranch?.trim()
      || taskResult.task.baseBranchHint?.trim()
      || workspace.suggestedBaseBranch?.trim()
      || workspace.defaultBranch?.trim()
      || taskResult.project.defaultBranch?.trim()
      || 'main'
    const title = payload.title?.trim()
      || distributedTask.result?.delivery?.pullRequest?.title
      || buildPullRequestTitle(taskResult.task)
    const body = payload.body?.trim()
      || distributedTask.result?.delivery?.pullRequest?.description
      || buildPullRequestBody(taskResult.task, baseBranch, compareBranch)

    const gitIdentity = await resolveUserProjectGitIdentity({
      userId,
      projectId: taskResult.project.id,
      mode: 'personal',
      repoUrl: taskResult.project.gitUrl,
    }).catch(() => undefined)
    if (
      !gitIdentity?.credentialToken
      || !['pat', 'github-app'].includes(gitIdentity.authMode ?? '')
      || gitIdentity.provider !== 'github'
    ) {
      return c.json({ message: '创建 PR 目前需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。' }, 400)
    }

    const pullRequest = await executorWsService.requestGitPullRequest(executorId, {
      worktreePath,
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

    if (!pullRequest.ok) {
      return c.json({ message: pullRequest.message }, 400)
    }

    const updatedAt = new Date().toISOString()
    const currentDelivery = distributedTask.result?.delivery
    const nextDistributedTask: DistributedTask = currentDelivery && distributedTask.result
      ? {
          ...distributedTask,
          updatedAt,
          result: {
            ...distributedTask.result,
            delivery: {
              ...currentDelivery,
              pullRequest: {
                ready: true,
                remoteReady: true,
                repoUrl: taskResult.project.gitUrl,
                title,
                description: body,
                baseBranch,
                compareBranch: pullRequest.compareBranch,
                number: pullRequest.number,
                url: pullRequest.url,
                state: pullRequest.state,
              },
              syncFailureReason: undefined,
            },
          },
        }
      : distributedTask

    await updateDistributedTaskAndWait(nextDistributedTask)
    const taskUpdatedAt = new Date().toISOString()
    const currentStep = pullRequest.url ? `主节点已创建 PR：${pullRequest.url}` : pullRequest.message
    const updatedTask: Task = {
      ...syncTaskStatusFromReviewReady(taskResult.task, taskUpdatedAt),
      currentStep,
      needsHumanConfirm: true,
      agentRunningStatus: 'complete',
    }
    await saveTaskAndWait(updatedTask)
    syncDistributedTaskEvent({
      taskId: nextDistributedTask.id,
      status: nextDistributedTask.status,
      message: currentStep,
      at: updatedAt,
    })

    if (distributedTask.workspaceId) {
      const session = distributedTask.workspaceSessionId
        ? getWorkspaceSessionRecordForTaskContext(updatedTask.id, distributedTask.workspaceId, distributedTask.workspaceSessionId)
        : getWorkspaceSession(distributedTask.workspaceId)
      if (session) {
        const nextSession = mergeWorkspaceSession(updatedTask, session, {
          currentStep,
          needsHumanConfirm: true,
          agentRunningStatus: 'complete',
          updatedAt: taskUpdatedAt,
          lastActiveAt: taskUpdatedAt,
        })
        await saveWorkspaceSessionAndWait(nextSession)
      }
    }

    return c.json({
      ...(await withState(withClusterState(loadState()), pullRequest.message, userId)),
      pullRequest,
    })
  })

  app.post('/api/distributed-tasks/:id/pull-request/status', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const distributedTask = getDistributedTask(c.req.param('id'))
    if (!distributedTask) {
      return c.json({ message: '分布式任务不存在。' }, 404)
    }

    const taskResult = getAuthorizedTask(state, userId, distributedTask.originTaskId)
    if (!taskResult.task || !taskResult.project) {
      return jsonError(c, taskResult.message, taskResult.status)
    }

    const storedPullRequest = distributedTask.result?.delivery?.pullRequest
    if (!distributedTask.workspaceId && !storedPullRequest?.compareBranch?.trim()) {
      return c.json({ message: '当前分布式任务缺少工作区分支信息，无法刷新 PR 状态。' }, 400)
    }

    const session = distributedTask.workspaceId
      ? (
          distributedTask.workspaceSessionId
            ? getWorkspaceSessionRecordForTaskContext(taskResult.task.id, distributedTask.workspaceId, distributedTask.workspaceSessionId)
            : getWorkspaceSession(distributedTask.workspaceId)
        )
      : null
    const workspace = distributedTask.workspaceId
      ? listWorkspaces().find((item) => item.id === distributedTask.workspaceId && item.projectId === distributedTask.projectId)
      : null
    const effectiveSession = session && workspace
      ? applyWorkspaceCodeStateToSession(session, workspace)
      : session
    const baseBranch = storedPullRequest?.baseBranch?.trim()
      || effectiveSession?.baseBranch?.trim()
      || taskResult.task.baseBranch?.trim()
      || taskResult.task.baseBranchHint?.trim()
      || workspace?.suggestedBaseBranch?.trim()
      || workspace?.defaultBranch?.trim()
      || taskResult.project.defaultBranch?.trim()
      || 'main'
    const compareBranch = storedPullRequest?.compareBranch?.trim() || effectiveSession?.branchName?.trim() || ''

    const gitIdentity = await resolveUserProjectGitIdentity({
      userId,
      projectId: taskResult.project.id,
      mode: 'personal',
      repoUrl: taskResult.project.gitUrl,
    }).catch(() => undefined)

    const refreshed = await lookupPullRequest({
      repoUrl: storedPullRequest?.repoUrl?.trim() || taskResult.project.gitUrl,
      number: storedPullRequest?.number,
      baseBranch,
      compareBranch,
      gitIdentity,
    })

    if (!refreshed.ok || !refreshed.pullRequest) {
      return c.json({ message: refreshed.message }, 400)
    }

    const nextPullRequest = refreshed.pullRequest
    const updatedAt = new Date().toISOString()
    const currentDelivery = distributedTask.result?.delivery
    const nextDistributedTask: DistributedTask = currentDelivery && distributedTask.result
      ? {
          ...distributedTask,
          updatedAt,
          result: {
            ...distributedTask.result,
            delivery: {
              ...currentDelivery,
              pullRequest: {
                ready: true,
                remoteReady: true,
                repoUrl: storedPullRequest?.repoUrl?.trim() || taskResult.project.gitUrl,
                title: nextPullRequest.title || storedPullRequest?.title,
                description: nextPullRequest.body || storedPullRequest?.description,
                baseBranch: nextPullRequest.baseBranch || baseBranch,
                compareBranch: nextPullRequest.compareBranch || compareBranch,
                number: nextPullRequest.number,
                url: nextPullRequest.url,
                state: nextPullRequest.state,
              },
              syncFailureReason: undefined,
            },
          },
        }
      : distributedTask

    await updateDistributedTaskAndWait(nextDistributedTask)

    const taskUpdatedAt = new Date().toISOString()
    const currentStep = nextPullRequest.merged
      ? (nextPullRequest.url ? `PR 已合并：${nextPullRequest.url}` : `PR #${nextPullRequest.number} 已合并`)
      : nextPullRequest.state === 'open'
        ? (nextPullRequest.url ? `PR 审核中：${nextPullRequest.url}` : `PR #${nextPullRequest.number} 审核中`)
        : (nextPullRequest.url ? `PR 已关闭：${nextPullRequest.url}` : `PR #${nextPullRequest.number} 已关闭`)
    const updatedTask: Task = nextPullRequest.merged
      ? {
          ...syncTaskStatusFromWorkMerged(taskResult.task, taskUpdatedAt),
          currentStep,
          needsHumanConfirm: false,
          agentRunningStatus: 'complete',
        }
      : nextPullRequest.state === 'open'
        ? {
            ...syncTaskStatusFromReviewReady(taskResult.task, taskUpdatedAt),
            currentStep,
            needsHumanConfirm: true,
            agentRunningStatus: 'complete',
          }
        : {
            ...touchTaskStatus(taskResult.task, taskUpdatedAt),
            currentStep,
            needsHumanConfirm: true,
            agentRunningStatus: 'complete',
          }
    await saveTaskAndWait(updatedTask)

    syncDistributedTaskEvent({
      taskId: nextDistributedTask.id,
      status: nextDistributedTask.status,
      message: currentStep,
      at: updatedAt,
    })

    if (distributedTask.workspaceId) {
      const nextSession = session
        ? mergeWorkspaceSession(updatedTask, session, {
            currentStep,
            needsHumanConfirm: !nextPullRequest.merged,
            updatedAt: taskUpdatedAt,
            lastActiveAt: taskUpdatedAt,
          })
        : null
      if (nextSession) {
        await saveWorkspaceSessionAndWait(nextSession)
      }
    }

    return c.json({
      ...(await withState(withClusterState(loadState()), refreshed.message, userId)),
      pullRequest: {
        ok: true,
        message: refreshed.message,
        provider: refreshed.provider,
        title: nextPullRequest.title || storedPullRequest?.title || buildPullRequestTitle(taskResult.task),
        body: nextPullRequest.body || storedPullRequest?.description || buildPullRequestBody(taskResult.task, baseBranch, compareBranch),
        baseBranch: nextPullRequest.baseBranch || baseBranch,
        compareBranch: nextPullRequest.compareBranch || compareBranch,
        number: nextPullRequest.number,
        url: nextPullRequest.url,
        state: nextPullRequest.state,
      },
    })
  })

  app.post('/api/distributed-tasks', requireAuth, async (c) => {
    const payload = distributedTaskSchema.parse(await c.req.json())
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskResult = getAuthorizedTask(state, userId, payload.originTaskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const distributedTask = await createDistributedTaskRecord({
      project: taskResult.project,
      task: taskResult.task,
      config: state.config,
      userId,
      taskRunId: crypto.randomUUID(),
      description: buildExecutionDescriptionWithSkills(
        payload.description,
        resolveRuntimeSkills({
          projectId: taskResult.project.id,
        }),
      ),
      initialStatus: 'queued',
      priority: payload.priority,
      timeoutSec: payload.timeoutSec,
      executorNodeId: payload.executorNodeId ?? clusterConfig.nodeId,
      returnMode: payload.returnMode,
      syncBackStrategy: payload.syncBackStrategy,
      gitIdentityMode: payload.gitIdentityMode,
    })

    await saveTaskRunAndWait({
      id: distributedTask.originTaskRunId!,
      taskId: taskResult.task.id,
      projectId: taskResult.project.id,
      distributedTaskId: distributedTask.id,
      executorNodeId: distributedTask.executorNodeId,
      baseBranch: taskResult.task.baseBranch,
      returnMode: payload.returnMode,
      gitIdentityMode: payload.gitIdentityMode,
      executionModel: taskResult.task.executionModel,
      status: distributedTask.status,
      createdAt: distributedTask.createdAt,
      updatedAt: distributedTask.updatedAt,
    })

    await saveDistributedTaskAndWait(distributedTask)
    const nextTask = appendExecutionRun({
      ...taskResult.task,
      executionMode: 'remote' as const,
      updatedAt: new Date().toISOString(),
    }, {
      distributedTaskId: distributedTask.id,
      executorNodeId: distributedTask.executorNodeId ?? clusterConfig.nodeId,
      returnMode: payload.returnMode,
      gitIdentityMode: payload.gitIdentityMode,
    })
    await saveTaskAndWait(nextTask)
    reconcileControlPlaneTaskQueue()

    const nextState: AppState = {
      ...state,
      tasks: state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)),
    }

    return c.json(await withState(withClusterState(nextState), '分布式任务已创建。', userId))
  })

  app.post('/api/distributed-tasks/:id/assign', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = z.object({ executorNodeId: z.string().min(1) }).parse(await c.req.json())
    const state = loadState()
    const distributedTask = getDistributedTask(c.req.param('id'))
    if (!distributedTask) {
      return c.json({ message: '分布式任务不存在。' }, 404)
    }

    const taskResult = getAuthorizedTask(state, userId, distributedTask.originTaskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    let executorOnline = payload.executorNodeId === clusterConfig.nodeId
    if (payload.executorNodeId !== clusterConfig.nodeId) {
      const access = canUserUseExecutorForProject({
        userId,
        projectId: distributedTask.projectId,
        executorId: payload.executorNodeId,
      })
      if (!access.ok) {
        return c.json({ message: access.message }, 403)
      }

      executorOnline = access.executor.status === 'online'
    }

    const status = 'queued'
    const nextMessage = executorOnline
      ? '执行节点已更新，任务会尽快开始。'
      : '当前节点不在线，任务已加入等待队列，节点上线后会自动运行。'

    const updatedDistributedTask: DistributedTask = {
      ...distributedTask,
      executorNodeId: payload.executorNodeId,
      status,
      idempotencyKey: crypto.randomUUID(),
      workerEventSequence: undefined,
      startedAt: undefined,
      completedAt: undefined,
      result: undefined,
      errorMessage: undefined,
      leaseExpiresAt: undefined,
      updatedAt: new Date().toISOString(),
    }
    await updateDistributedTaskAndWait(updatedDistributedTask)
    const taskRun = getTaskRunByDistributedTaskId(updatedDistributedTask.id)
    if (taskRun) {
      await saveTaskRunAndWait({
        ...taskRun,
        executorNodeId: payload.executorNodeId,
        status,
        updatedAt: updatedDistributedTask.updatedAt,
      })
    }
    syncDistributedTaskEvent({
      taskId: updatedDistributedTask.id,
      status,
      message: nextMessage,
      at: updatedDistributedTask.updatedAt,
    })

    const syncedTask = loadState().tasks.find((item) => item.id === taskResult.task.id) ?? taskResult.task

    const updatedTask: Task = {
      ...syncedTask,
      executionMode: 'remote' as const,
      status: 'todo' as const,
      currentStep: nextMessage,
      agentRunningStatus: 'thinking' as const,
      updatedAt: updatedDistributedTask.updatedAt,
    }
    await saveTaskAndWait(updatedTask)
    if (updatedDistributedTask.workspaceId) {
      const session = updatedDistributedTask.workspaceSessionId
        ? getWorkspaceSessionRecordForTaskContext(updatedTask.id, updatedDistributedTask.workspaceId, updatedDistributedTask.workspaceSessionId)
        : getWorkspaceSession(updatedDistributedTask.workspaceId)
      if (session) {
        await saveWorkspaceSessionAndWait(mergeWorkspaceSession(updatedTask, session, {
          executorNodeId: payload.executorNodeId,
          distributedTaskId: updatedDistributedTask.id,
          agentRunningStatus: 'thinking',
          runtimeStatus: 'queued',
          runtimeOwnerExecutorId: payload.executorNodeId,
          lastHeartbeatAt: undefined,
          lastRuntimeEventAt: updatedDistributedTask.updatedAt,
          terminalReason: undefined,
          runtimeSequence: session.runtimeSequence + 1,
          currentStep: nextMessage,
          updatedAt: updatedDistributedTask.updatedAt,
          lastActiveAt: updatedDistributedTask.updatedAt,
        }))
      }
    }
    reconcileControlPlaneTaskQueue()

    const nextState: AppState = {
      ...state,
      tasks: state.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item)),
    }

    recordAdminOperationAudit({
      actorUserId: userId,
      projectId: distributedTask.projectId,
      taskId: distributedTask.originTaskId,
      workspaceId: updatedDistributedTask.workspaceId,
      eventType: 'admin.distributed_task.assigned',
      payload: {
        distributedTaskId: updatedDistributedTask.id,
        executorNodeId: payload.executorNodeId,
        status,
      },
    })
    return c.json(await withState(withClusterState(nextState), nextMessage, userId))
  })

  app.post('/api/distributed-tasks/:id/cancel', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const distributedTask = getDistributedTask(c.req.param('id'))
    if (!distributedTask) return c.json({ message: '分布式任务不存在。' }, 404)

    const taskResult = getAuthorizedTask(state, userId, distributedTask.originTaskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    if (isDistributedTaskTerminal(distributedTask.status)) {
      return c.json({ message: '当前任务已经结束。' }, 400)
    }

    if (distributedTask.status === 'executing' || distributedTask.status === 'syncing_back') {
      const accepted = requestExecutorTaskCancellation(distributedTask, '主节点请求取消任务')
      if (!accepted) {
        return c.json({ message: '执行节点当前不可达，无法发送取消请求。' }, 400)
      }

      syncDistributedTaskEvent({
        taskId: distributedTask.id,
        status: distributedTask.status,
        message: '已向执行节点发送取消请求',
        at: new Date().toISOString(),
      })
      recordAdminOperationAudit({
        actorUserId: userId,
        projectId: distributedTask.projectId,
        taskId: distributedTask.originTaskId,
        workspaceId: distributedTask.workspaceId,
        eventType: 'admin.distributed_task.cancel_requested',
        payload: {
          distributedTaskId: distributedTask.id,
          status: distributedTask.status,
          executorNodeId: distributedTask.executorNodeId,
        },
      })
      return c.json(await withState(withClusterState(loadState()), '已发送取消请求。', userId))
    }

    cancelDistributedTask(distributedTask, '任务已由主节点取消')
    reconcileControlPlaneTaskQueue()
    recordAdminOperationAudit({
      actorUserId: userId,
      projectId: distributedTask.projectId,
      taskId: distributedTask.originTaskId,
      workspaceId: distributedTask.workspaceId,
      eventType: 'admin.distributed_task.cancelled',
      payload: {
        distributedTaskId: distributedTask.id,
        previousStatus: distributedTask.status,
        executorNodeId: distributedTask.executorNodeId,
      },
    })
    return c.json(await withState(withClusterState(loadState()), '分布式任务已取消。', userId))
  })

  app.post('/api/distributed-tasks/:id/retry', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const distributedTask = getDistributedTask(c.req.param('id'))
    if (!distributedTask) return c.json({ message: '分布式任务不存在。' }, 404)

    const taskResult = getAuthorizedTask(state, userId, distributedTask.originTaskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    if (!isDistributedTaskTerminal(distributedTask.status)) {
      return c.json({ message: '只有已结束的分布式任务才能重试。' }, 400)
    }

    const preferredExecutor = distributedTask.executorNodeId
      ? canUserUseExecutorForProject({
        userId,
        projectId: distributedTask.projectId,
        executorId: distributedTask.executorNodeId,
      })
      : null
    const scheduling = preferredExecutor?.ok
      ? { candidate: { executor: preferredExecutor.executor } }
      : chooseControlPlaneExecutorForTask({
        currentExecutorId: distributedTask.executorNodeId,
        projectId: distributedTask.projectId,
        userId,
      })
    const nextExecutorNodeId = scheduling.candidate?.executor.executorId
      ?? chooseExecutorNode(distributedTask.projectId, 'auto', distributedTask.executorNodeId ? [distributedTask.executorNodeId] : [])
    const updatedDistributedTask = resetDistributedTask(distributedTask, nextExecutorNodeId ?? clusterConfig.nodeId, '主节点已重试该分布式任务')
    const updatedTask = {
      ...taskResult.task,
      status: 'todo' as const,
      executionMode: 'remote' as const,
      updatedAt: updatedDistributedTask.updatedAt,
    }
    await saveTaskAndWait(updatedTask)
    if (updatedDistributedTask.workspaceId) {
      const session = updatedDistributedTask.workspaceSessionId
        ? getWorkspaceSessionRecordForTaskContext(updatedTask.id, updatedDistributedTask.workspaceId, updatedDistributedTask.workspaceSessionId)
        : getWorkspaceSession(updatedDistributedTask.workspaceId)
      if (session) {
        await saveWorkspaceSessionAndWait(mergeWorkspaceSession(updatedTask, session, {
          distributedTaskId: updatedDistributedTask.id,
          executorNodeId: updatedDistributedTask.executorNodeId,
          runtimeStatus: 'queued',
          runtimeOwnerExecutorId: updatedDistributedTask.executorNodeId,
          lastHeartbeatAt: undefined,
          lastRuntimeEventAt: updatedDistributedTask.updatedAt,
          terminalReason: undefined,
          runtimeSequence: session.runtimeSequence + 1,
          updatedAt: updatedDistributedTask.updatedAt,
          lastActiveAt: updatedDistributedTask.updatedAt,
        }))
      }
    }
    reconcileControlPlaneTaskQueue()

    recordAdminOperationAudit({
      actorUserId: userId,
      projectId: distributedTask.projectId,
      taskId: distributedTask.originTaskId,
      workspaceId: updatedDistributedTask.workspaceId,
      eventType: 'admin.distributed_task.retried',
      payload: {
        distributedTaskId: updatedDistributedTask.id,
        nextExecutorNodeId: updatedDistributedTask.executorNodeId,
        previousStatus: distributedTask.status,
      },
    })

    return c.json(await withState(withClusterState(loadState()), '分布式任务已重新排队。', userId))
  })

  app.post('/api/distributed-tasks/:id/takeover', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const payload = z.object({ executorNodeId: z.string().min(1).optional() }).parse(await c.req.json())
    const distributedTask = getDistributedTask(c.req.param('id'))
    if (!distributedTask) return c.json({ message: '分布式任务不存在。' }, 404)

    const taskResult = getAuthorizedTask(state, userId, distributedTask.originTaskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)
    if (distributedTask.status === 'executing' || distributedTask.status === 'syncing_back') {
      return c.json({ message: '正在执行中的任务暂不支持强制接管。' }, 400)
    }

    const updatedDistributedTask = resetDistributedTask(distributedTask, payload.executorNodeId ?? clusterConfig.nodeId, '主节点已接管该分布式任务')
    const updatedTask = {
      ...taskResult.task,
      status: 'todo' as const,
      executionMode: 'remote' as const,
      updatedAt: updatedDistributedTask.updatedAt,
    }
    await saveTaskAndWait(updatedTask)
    if (updatedDistributedTask.workspaceId) {
      const session = updatedDistributedTask.workspaceSessionId
        ? getWorkspaceSessionRecordForTaskContext(updatedTask.id, updatedDistributedTask.workspaceId, updatedDistributedTask.workspaceSessionId)
        : getWorkspaceSession(updatedDistributedTask.workspaceId)
      if (session) {
        await saveWorkspaceSessionAndWait(mergeWorkspaceSession(updatedTask, session, {
          distributedTaskId: updatedDistributedTask.id,
          executorNodeId: updatedDistributedTask.executorNodeId,
          runtimeStatus: 'queued',
          runtimeOwnerExecutorId: updatedDistributedTask.executorNodeId,
          lastHeartbeatAt: undefined,
          lastRuntimeEventAt: updatedDistributedTask.updatedAt,
          terminalReason: undefined,
          runtimeSequence: session.runtimeSequence + 1,
          updatedAt: updatedDistributedTask.updatedAt,
          lastActiveAt: updatedDistributedTask.updatedAt,
        }))
      }
    }
    reconcileControlPlaneTaskQueue()

    recordAdminOperationAudit({
      actorUserId: userId,
      projectId: distributedTask.projectId,
      taskId: distributedTask.originTaskId,
      workspaceId: updatedDistributedTask.workspaceId,
      eventType: 'admin.distributed_task.taken_over',
      payload: {
        distributedTaskId: updatedDistributedTask.id,
        nextExecutorNodeId: updatedDistributedTask.executorNodeId,
        previousStatus: distributedTask.status,
      },
    })

    return c.json(await withState(withClusterState(loadState()), '分布式任务已接管。', userId))
  })

  app.get('/api/internal/cluster/summary', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = getScopedState(loadState(), userId)
    return c.json({
      currentNodeId: clusterConfig.nodeId,
      onlineNodes: state.nodes.filter((node) => node.status === 'online').length,
      busyNodes: state.nodes.filter((node) => node.status === 'busy').length,
      offlineNodes: state.nodes.filter((node) => node.status === 'offline').length,
      distributedTasks: {
        total: state.distributedTasks.length,
        queued: state.distributedTasks.filter((task) => task.status === 'queued').length,
        active: state.distributedTasks.filter((task) => ['assigned', 'preparing', 'executing', 'syncing_back'].includes(task.status)).length,
      },
    })
  })
}
