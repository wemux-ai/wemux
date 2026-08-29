// [INPUT]: 已鉴权 Hono app，任务 worktree/环境请求
// [OUTPUT]: /api/tasks/:id/cleanup、ensure-worktree、environment/*、open-vscode 路由
// [POS]: 任务 worktree/环境 HTTP 协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { resolveProjectEnvironmentPreview } from '@shared/project-environment-template'
import {
  createWorkspaceEnvironmentStatusSnapshot,
  getWorkspaceEnvironmentProbeUrl,
  resolveWorkspaceEnvironmentStatusFromProbe,
} from '@shared/task-environment'
import { createExecutionLog, deriveExecutionCenter } from '@shared/task-orchestrator'
import { applyWorkspaceCodeStateToSession, buildWorkspaceTaskExecutionView, buildWorkspaceCodeBranchName, mergeWorkspaceSession, resolveWorkspaceCodeBranchName, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { AppState, ExecutorTerminalRequestMode, Project, Task, WorkspaceSession, Workspace } from '@shared/types'
import type { WorkspaceRuntimeSource } from '@shared/workspace-runtime'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { buildVsCodeOpenCommandAttempts } from '@shared/vscode-open-command'
import { executorRegistry } from '../control-plane/executor-registry'
import { recordAdminOperationAudit } from '../control-plane/governance-service'
import { refreshProjectVersionControlFromExecutor } from '../control-plane/executor-repo-service'
import { executorWsService } from '../control-plane/executor-ws-service'
import { getWorkspaceEnvironmentTemplate } from '../services/workspace-environment-template-service'
import { cleanupWorkspaceWorktrees } from '../services/workspace-cleanup-service'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { resolveScopedRuntimeEnvironment } from '../services/runtime-environment-service'
import { deleteTask, deleteTaskWorkspaceBindings, deleteWorkspaceSessions, loadState, saveTask, saveTaskAndWait, saveWorkspaceSession, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { deleteWorkspaces, saveWorkspace } from '../storage/distributed-task-store'
import { getAuthorizedTask, getScopedState, getUserIdFromHeader, jsonError, withState } from './shared'
import {
  detachWorkspaceIdsFromTask,
  ensureTaskWorkspaceBindingState,
  ensureWorkspaceSessionRecord,
  getScopedWorkspaceForProject,
  hasOriginalDirSessionConflict,
  listActiveTaskWorkspaceBindings,
  listProjectWorkspacesForUser,
  listWorkspaceSessionsForTaskContext,
  hydrateWorkspaceSessionWithLocalWorktree,
  resolveEffectiveWorkspaceWorktreeSession,
  saveWorkspaceDirectorySessions,
  resolveWorkspaceWorkingDirectoryMode,
  resolveWorkspaceSessionCwd,
  upsertWorkspaceSessionInState,
} from './task-route-support'
import { publishEnvironmentObservation } from './task-worktree-observation'
import { resolveWorkspaceRepoPath } from '../services/workspace-repo-path'
import { probeWorkspaceDirectoryOnExecutor, shouldEnsureWorkspaceDirectoryOnExecutor } from '../services/task-chat-dispatch/workspace-directory-ready'
import { createWorkspaceOperationTimelineWriter } from '../services/workspace-session-operation-timeline'
import { appendTerminalCommandDiagnostic } from '../services/terminal-command-diagnostics'

const taskEnvironmentActionSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  workspaceSessionId: z.string().trim().min(1).optional(),
  createNewSession: z.boolean().optional(),
})
const taskWorktreeEnsureSchema = taskEnvironmentActionSchema.extend({
  autoEnvironmentInstall: z.boolean().optional(),
})
const taskEnvironmentStatusQuerySchema = taskEnvironmentActionSchema.pick({
  workspaceId: true,
  workspaceSessionId: true,
})

const saveWorkspaceSessionEnvironmentRuntime = async (params: {
  task: Task
  session: WorkspaceSession
  status: import('@shared/task-environment').WorkspaceEnvironmentStatusSnapshot
  source: WorkspaceRuntimeSource
  executorId?: string
}) => {
  const nextSession = mergeWorkspaceSession(params.task, params.session, {
    runtimeSummary: {
      ...params.session.runtimeSummary,
      environment: {
        ...params.status,
        source: params.source,
        workspaceSessionId: params.session.id,
        reportedByExecutorId: params.executorId?.trim() || undefined,
      },
    },
  })
  await saveWorkspaceSessionAndWait(nextSession)
  return nextSession
}

const taskWorkspaceBranchSwitchSchema = z.object({
  workspaceId: z.string().trim().min(1),
  workspaceSessionId: z.string().trim().min(1),
  branchName: z.string().trim().min(1),
})

const probeWorkspaceEnvironmentStatus = async (params: {
  executorId: string
  preview: {
    appUrl?: string
    healthUrl?: string
  }
}) => {
  const url = getWorkspaceEnvironmentProbeUrl(params.preview)
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

const resolveEnvironmentStatusAfterAction = async (params: {
  action: 'start' | 'stop' | 'logs'
  executorId: string
  exitCode: number
  preview: {
    appUrl?: string
    healthUrl?: string
  }
  failureMessage: string
}) => {
  const url = getWorkspaceEnvironmentProbeUrl(params.preview)
  if (params.exitCode !== 0) {
    return createWorkspaceEnvironmentStatusSnapshot({
      status: 'error',
      message: params.failureMessage,
      url,
    })
  }

  if (params.action === 'start') {
    if (!url) {
      return createWorkspaceEnvironmentStatusSnapshot({
        status: 'starting',
        message: '环境启动命令已在后台提交。',
      })
    }

    const probeStatus = await probeWorkspaceEnvironmentStatus({
      executorId: params.executorId,
      preview: params.preview,
    })
    if (probeStatus.status === 'running') {
      return probeStatus
    }

    return createWorkspaceEnvironmentStatusSnapshot({
      status: 'starting',
      message: '环境启动命令已提交，正在等待地址可访问。',
      url,
      httpStatus: probeStatus.httpStatus,
    })
  }

  if (params.action === 'stop') {
    if (!url) {
      return createWorkspaceEnvironmentStatusSnapshot({
        status: 'stopped',
        message: '环境停止命令已执行。',
      })
    }

    const probeStatus = await probeWorkspaceEnvironmentStatus({
      executorId: params.executorId,
      preview: params.preview,
    })
    if (probeStatus.status === 'running') {
      return createWorkspaceEnvironmentStatusSnapshot({
        status: 'stopping',
        message: '环境停止命令已执行，正在等待地址下线。',
        url,
        httpStatus: probeStatus.httpStatus,
      })
    }

    return createWorkspaceEnvironmentStatusSnapshot({
      status: 'stopped',
      message: '环境已停止。',
      url,
    })
  }

  return await probeWorkspaceEnvironmentStatus({
    executorId: params.executorId,
    preview: params.preview,
  })
}

const executeTaskEnvironmentCommand = async (params: {
  state: AppState
  project: Project
  task: Task
  workspace?: Workspace | null
  session: WorkspaceSession
  executorId: string
  cwd: string
  action: 'start' | 'stop' | 'logs'
  command: string
  mode?: ExecutorTerminalRequestMode
}) => {
  const runtimeEnvironment = params.workspace
    ? await resolveScopedRuntimeEnvironment({
        projectId: params.project.id,
        workspaceId: params.workspace.id,
      }).then((result) => result?.payload).catch(() => undefined)
    : undefined
  const result = await executorWsService.requestTerminalCommand(params.executorId, params.command, params.cwd, {
    mode: params.mode,
    runtimeEnvironment,
  }).catch((error) => ({
    command: params.command,
    cwd: params.cwd,
    stdout: '',
    stderr: error instanceof Error ? error.message : '环境命令执行失败。',
    exitCode: 1,
    detached: false,
    mode: params.mode,
    at: new Date().toISOString(),
  }))

  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').trim()
  const message = result.exitCode === 0
    ? params.action === 'start'
      ? result.mode === 'background' || result.detached
        ? '环境启动命令已提交。'
        : '环境已启动。'
      : params.action === 'stop'
        ? '环境停止命令已执行。'
        : '环境日志已获取。'
    : output || '环境命令执行失败。'
  const updatedAt = new Date().toISOString()
  const nextTask: Task = {
    ...params.task,
    updatedAt,
    currentStep: message,
    logs: [...params.task.logs, createExecutionLog(result.exitCode === 0 ? 'system' : 'review', `${message}${output ? `\n${output}` : ''}`)],
  }
  const nextSession = mergeWorkspaceSession(params.task, params.session, {
    currentStep: message,
    agentRunningStatus: result.exitCode === 0 ? 'idle' : 'error',
    runtimeStatus: result.exitCode === 0 ? 'idle' : 'error',
    terminalReason: result.exitCode === 0 ? undefined : message,
    lastRuntimeEventAt: updatedAt,
    runtimeSequence: params.session.runtimeSequence + 1,
    updatedAt,
    lastActiveAt: updatedAt,
  })

  await saveTaskAndWait(nextTask)
  await saveWorkspaceSessionAndWait(nextSession)
  publishEnvironmentObservation({
    project: params.project,
    task: nextTask,
    session: nextSession,
    workspaceId: params.workspace?.id,
    action: params.action,
    message,
    output,
    command: params.command,
    exitCode: result.exitCode,
    cwd: params.cwd,
  })

  return {
    result,
    output,
    message,
    task: nextTask,
    session: nextSession,
    state: upsertWorkspaceSessionInState({
      ...params.state,
      tasks: params.state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)),
    }, nextSession),
  }
}

const formatBackgroundCommandFailure = (result: {
  stdout?: string
  stderr?: string
}) => {
  return [result.stdout?.trim(), result.stderr?.trim()]
    .filter(Boolean)
    .join('\n')
    .trim()
}

const startAutoEnvironmentInstall = async (params: {
  executorId: string
  project: Project
  session: WorkspaceSession
  cwd: string
  workspaceEnvironmentTemplate?: import('@shared/types').ProjectEnvironmentTemplate | null
  runtimeEnvironment?: import('@shared/runtime-environment').RuntimeEnvironmentExecutionPayload
}) => {
  const preview = resolveProjectEnvironmentPreview({
    project: params.project,
    session: params.session,
    cwd: params.cwd,
    workspaceEnvironmentTemplate: params.workspaceEnvironmentTemplate,
  })
  const command = preview?.installCommand?.trim()
  if (!command) {
    return {
      ok: true,
      message: '',
    }
  }

  const result = await executorWsService.requestTerminalCommand(
    params.executorId,
    command,
    params.cwd,
    {
      mode: 'background',
      runtimeEnvironment: params.runtimeEnvironment,
    },
  ).catch((error) => ({
    command,
    cwd: params.cwd,
    stdout: '',
    stderr: error instanceof Error ? error.message : '项目预设 install 后台启动失败。',
    exitCode: 1,
    detached: false,
    mode: 'background' as const,
    at: new Date().toISOString(),
  }))

  if (result.exitCode === 0) {
    return {
      ok: true,
      message: result.detached
        ? '项目预设 install 已在 worker 后台启动。'
        : '项目预设 install 已执行完成。',
    }
  }

  const failureOutput = appendTerminalCommandDiagnostic({
    command,
    exitCode: result.exitCode,
    output: formatBackgroundCommandFailure(result),
  })
  return {
    ok: false,
    message: [
      '工作目录已准备，但项目预设 install 后台启动失败。',
      failureOutput,
    ].filter(Boolean).join('\n\n'),
  }
}

const executeAutoPreparedWorktreeInstallCommand = async (params: {
  state: AppState
  project: Project
  task: Task
  workspace: Workspace
  session: WorkspaceSession
  executorId: string
  cwd: string
  command: string
  runtimeEnvironment?: import('@shared/runtime-environment').RuntimeEnvironmentExecutionPayload
}) => {
  const result = await executorWsService.requestTerminalCommand(
    params.executorId,
    params.command,
    params.cwd,
    {
      mode: 'wait',
      runtimeEnvironment: params.runtimeEnvironment,
    },
  ).catch((error) => ({
    command: params.command,
    cwd: params.cwd,
    stdout: '',
    stderr: error instanceof Error ? error.message : '自动安装命令执行失败。',
    exitCode: 1,
    detached: false,
    mode: 'wait' as const,
    at: new Date().toISOString(),
  }))
  const rawOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').trim()
  const output = appendTerminalCommandDiagnostic({
    command: params.command,
    exitCode: result.exitCode,
    output: rawOutput,
  })
  const message = result.exitCode === 0
    ? '自动安装完成。'
    : output || '自动安装失败。'
  const updatedAt = new Date().toISOString()
  const nextTask: Task = {
    ...params.task,
    updatedAt,
    currentStep: message,
    logs: [...params.task.logs, createExecutionLog(
      result.exitCode === 0 ? 'system' : 'review',
      `${message} ${params.command}${output ? `\n${output}` : ''}`,
    )],
  }
  const nextSession = mergeWorkspaceSession(params.task, params.session, {
    currentStep: message,
    agentRunningStatus: result.exitCode === 0 ? 'idle' : 'error',
    runtimeStatus: result.exitCode === 0 ? 'idle' : 'error',
    terminalReason: result.exitCode === 0 ? undefined : message,
    lastRuntimeEventAt: updatedAt,
    runtimeSequence: params.session.runtimeSequence + 1,
    updatedAt,
    lastActiveAt: updatedAt,
  })

  await saveTaskAndWait(nextTask)
  await saveWorkspaceSessionAndWait(nextSession)
  publishEnvironmentObservation({
    project: params.project,
    task: nextTask,
    session: nextSession,
    workspaceId: params.workspace.id,
    action: 'start',
    message,
    output,
    command: params.command,
    exitCode: result.exitCode,
    cwd: params.cwd,
  })

  return {
    result,
    output,
    message,
    task: nextTask,
    session: nextSession,
    state: upsertWorkspaceSessionInState({
      ...params.state,
      tasks: params.state.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)),
    }, nextSession),
  }
}

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

const resolveWorkspaceSessionForTaskContext = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (workspaceSessionId?.trim()) {
    return listWorkspaceSessionsForTaskContext(task.id).find((session) => session.id === workspaceSessionId.trim()) ?? null
  }
  const targetWorkspaceId = workspaceId?.trim() || listActiveTaskWorkspaceBindings(task.id)[0]?.workspaceId
  if (!targetWorkspaceId) {
    return null
  }

  return listWorkspaceSessionsForTaskContext(task.id).find((session) => session.workspaceId === targetWorkspaceId) ?? null
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
    executor,
    workspace,
    session,
    executorId,
    repoPath: resolveWorkspaceRepoPath({
      project: params.project,
      workspaceRoot: executor?.workspaceRoot || params.state.config.workspaceRoot,
      workspace,
      session,
    }),
    workspaceRoot: executor?.workspaceRoot || params.state.config.workspaceRoot,
    executorName: executor?.name || workspace?.executorName || executorId,
  }
}

const resolveFirstOpenableTaskWorkspaceCwd = async (executorId: string, candidateCwds: string[]) => {
  const normalizedCandidateCwds = Array.from(new Set(candidateCwds.map((cwd) => cwd.trim()).filter(Boolean)))
  if (normalizedCandidateCwds.length <= 1) {
    return normalizedCandidateCwds
  }

  for (const cwd of normalizedCandidateCwds) {
    try {
      const result = await executorWsService.requestDirectoryBrowse(executorId, cwd, cwd)
      if (result.ok) {
        return [cwd]
      }
    } catch {
      // Ignore directory probe failures and fall back to the next candidate path.
    }
  }

  return [normalizedCandidateCwds[0]]
}

const isExecutorWorkspaceDirectoryReady = async (params: {
  executorId: string
  cwd: string
  workingDirectoryMode: 'worktree' | 'original-dir'
  worktreeStatus?: string | null
}) => {
  if (params.workingDirectoryMode === 'original-dir') {
    const probe = await probeWorkspaceDirectoryOnExecutor({
      executorId: params.executorId,
      cwd: params.cwd,
      browseDirectory: executorWsService.requestDirectoryBrowse,
    })

    return probe.ready
  }

  const probe = await shouldEnsureWorkspaceDirectoryOnExecutor({
    executorId: params.executorId,
    cwd: params.cwd,
    workingDirectoryMode: params.workingDirectoryMode,
    worktreeStatus: params.worktreeStatus,
    browseDirectory: executorWsService.requestDirectoryBrowse,
  })

  return !probe.shouldEnsure
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

const isWorkspaceSessionBranchSwitchBlocked = (session: Pick<WorkspaceSession, 'runtimeStatus' | 'agentRunningStatus'>) => {
  return session.runtimeStatus === 'running'
    || session.runtimeStatus === 'waiting'
    || session.agentRunningStatus === 'thinking'
    || session.agentRunningStatus === 'executing'
    || session.agentRunningStatus === 'waiting'
}

export const shouldSkipGitCleanupForProject = (project: Pick<Project, 'versionControl'>) => {
  return project.versionControl === 'none'
}

export const getWorkspaceBranchSwitchBlockedMessage = (project: Pick<Project, 'versionControl'>) => {
  return project.versionControl === 'none'
    ? '当前项目按本地目录模式运行，暂不支持切换 Git 分支。'
    : ''
}

export const registerTaskWorktreeRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.post('/api/tasks/:id/cleanup', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)
    const project = taskResult.project.preferredExecutorId
      ? await refreshProjectVersionControlFromExecutor(userId, taskResult.project, taskResult.project.preferredExecutorId)
      : taskResult.project
    if (shouldSkipGitCleanupForProject(project)) {
      return c.json(await withState(state, '当前项目按本地目录模式运行，无需清理隔离目录。', userId))
    }

    const context = resolveTaskExecutorContext({
      userId,
      state,
      project,
      task: taskResult.task,
    })
    if (!context.executorId) {
      return c.json({ state: getScopedState(state, userId), message: '当前工作区会话还没有绑定执行节点。' }, 400)
    }

    const effectiveWorktreePath = context.session
      ? resolveWorkspaceSessionCwd(context.workspaceRoot, project, context.session, context.workspace)
      : undefined
    if (!effectiveWorktreePath) {
      return c.json({ state: getScopedState(state, userId), message: '当前任务还没有可清理的工作区上下文。' }, 400)
    }
    const cleanupResult = await executorWsService.requestWorktreeCleanup(context.executorId, {
      workspaceId: context.workspace?.id ?? context.session?.workspaceId,
      ownerUserId: context.workspace?.ownerUserId ?? userId,
      repoPath: context.repoPath,
      repoUrl: project.gitUrl?.trim() || undefined,
      worktreePath: effectiveWorktreePath,
      workingDirectoryMode: resolveWorkspaceWorkingDirectoryMode(context.workspace, context.session),
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : 'worktree 清理失败。',
    }))
    const updatedAt = new Date().toISOString()
    const nextTask = {
      ...taskResult.task,
      updatedAt,
      currentStep: cleanupResult.message,
      logs: [...taskResult.task.logs, createExecutionLog(cleanupResult.ok ? 'system' : 'review', cleanupResult.message)],
    }
    const nextSession = context.session
      ? mergeWorkspaceSession(taskResult.task, context.session, {
          worktreeStatus: cleanupResult.ok ? 'cleaned' : context.session.worktreeStatus,
          currentStep: cleanupResult.message,
          agentRunningStatus: cleanupResult.ok ? 'idle' : 'error',
          updatedAt,
          lastActiveAt: updatedAt,
        })
      : undefined

    await saveTaskAndWait(nextTask)
    const tasks = state.tasks.map((item) => (item.id === taskId ? nextTask : item))
    if (nextSession) {
      saveWorkspaceSession(nextSession)
    }
    const nextState: AppState = nextSession
      ? upsertWorkspaceSessionInState({ ...state, tasks }, nextSession)
      : { ...state, tasks }

    recordAdminOperationAudit({
      actorUserId: userId,
      projectId: project.id,
      taskId: taskResult.task.id,
      workspaceId: context.workspace?.id,
      eventType: 'admin.task_worktree.cleaned',
      payload: {
        executorId: context.executorId,
        workspaceSessionId: context.session?.id,
        worktreePath: effectiveWorktreePath,
        ok: cleanupResult.ok,
      },
    })

    return c.json(await withState(nextState, cleanupResult.ok ? 'worktree 已清理。' : cleanupResult.message, userId))
  })

  app.post('/api/tasks/:id/ensure-worktree', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = taskWorktreeEnsureSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    let project = taskResult.project
    const workspace = payload.workspaceId || payload.workspaceSessionId
      ? resolveTaskWorkspace(userId, taskResult.project, taskResult.task, payload.workspaceId, payload.workspaceSessionId)
      : null
    if ((payload.workspaceId || payload.workspaceSessionId) && !workspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }
    const existingSession = workspace
      ? resolveWorkspaceSessionForTaskContext(taskResult.task, workspace.id, payload.workspaceSessionId)
      : null
    const workspaceSessionExecutorId = resolveWorkspaceSessionExecutorId(existingSession, workspace?.executorNodeId)
    if (workspace) {
      project = await refreshProjectVersionControlFromExecutor(userId, project, workspaceSessionExecutorId)
    }

    const bindingState = workspace && state.tasks.some((task) => task.id === taskResult.task?.id)
      ? ensureTaskWorkspaceBindingState({
          task: taskResult.task,
          workspaceId: workspace.id,
          updatedAt: new Date().toISOString(),
        })
      : null
    const session = workspace
      ? ensureWorkspaceSessionRecord({
          task: bindingState?.task ?? taskResult.task,
          workspaceId: workspace.id,
          executorNodeId: workspaceSessionExecutorId,
          workspace,
          workspaceSessionId: payload.workspaceSessionId,
          createNewSession: payload.createNewSession,
        })
      : null
    if (workspace && session && resolveWorkspaceWorkingDirectoryMode(workspace, session) === 'original-dir' && hasOriginalDirSessionConflict({
      state,
      workspaceId: workspace.id,
      currentSessionId: session.id,
    })) {
      return c.json({ message: '原始目录模式下同一工作区同一时间只允许一个会话准备或执行。' }, 409)
    }
    const nextTaskBase: Task = session
      ? buildWorkspaceTaskExecutionView(bindingState?.task ?? taskResult.task, session)
      : (bindingState?.task ?? taskResult.task)

    const context = resolveTaskExecutorContext({
      userId,
      state,
      project,
      task: nextTaskBase,
      workspace,
      session,
    })
    if (!context.executorId) {
      return c.json({ state: getScopedState(state, userId), message: '当前工作区会话还没有绑定执行节点。' }, 400)
    }

    const runtimeWorkspace = context.workspace
    if (!runtimeWorkspace || !context.session) {
      return c.json({ state: getScopedState(state, userId), message: '请先选择工作区后再准备工作目录。' }, 400)
    }
    const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
      applyWorkspaceCodeStateToSession(
        resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, runtimeWorkspace.executorNodeId),
        runtimeWorkspace,
      ),
      runtimeWorkspace,
    )
    const effectiveWorktreePath = resolveWorkspaceSessionCwd(context.workspaceRoot, project, effectiveWorktreeSession, runtimeWorkspace)
    if (!effectiveWorktreePath) {
      return c.json({ state: getScopedState(state, userId), message: '请先选择工作区后再准备工作目录。' }, 400)
    }
    const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(runtimeWorkspace, effectiveWorktreeSession)
    const worktreeDirectoryReady = await isExecutorWorkspaceDirectoryReady({
      executorId: context.executorId,
      cwd: effectiveWorktreePath,
      workingDirectoryMode,
      worktreeStatus: effectiveWorktreeSession.worktreeStatus,
    })
    if (
      workingDirectoryMode === 'worktree'
      && effectiveWorktreeSession.worktreeStatus === 'created'
      && worktreeDirectoryReady
      && !payload.autoEnvironmentInstall
    ) {
      return c.json({
        ...(await withState(state, '当前工作区目录已经准备好。', userId)),
        workspaceSessionId: context.session.id,
        workspaceSession: context.session,
      })
    }
    const runtimeEnvironment = await resolveScopedRuntimeEnvironment({
      projectId: project.id,
      workspaceId: runtimeWorkspace.id,
    }).then((result) => result?.payload).catch(() => undefined)
    const createResult = workingDirectoryMode === 'worktree' && effectiveWorktreeSession.worktreeStatus === 'created' && worktreeDirectoryReady
      ? {
          ok: true as const,
          message: '当前工作区目录已经准备好。',
        }
      : await executorWsService.requestWorktreeEnsure(context.executorId, {
          workspaceId: runtimeWorkspace.id,
          ownerUserId: runtimeWorkspace.ownerUserId ?? userId,
          repoPath: project.versionControl === 'none' ? undefined : context.repoPath,
          repoUrl: project.versionControl === 'none' ? undefined : (project.gitUrl?.trim() || undefined),
          preferredBranch: nextTaskBase.baseBranch?.trim() || nextTaskBase.baseBranchHint?.trim() || project.defaultBranch,
          branchName: effectiveWorktreeSession.branchName,
          worktreePath: effectiveWorktreePath,
          workingDirectoryMode,
          gitIdentity: await resolveTaskGitIdentitySafely(userId, project),
          runtimeEnvironment,
          onOperationEvent: createWorkspaceOperationTimelineWriter({
            taskId,
            workspaceId: runtimeWorkspace.id,
            workspaceSessionId: context.session.id,
            turnId: `system:workspace-ensure-worktree:${context.session.id}`,
          }),
        }).catch((error) => ({
          ok: false as const,
          message: error instanceof Error ? error.message : '工作目录准备失败。',
        }))
    const workspaceEnvironmentTemplate = context.workspace
      ? await getWorkspaceEnvironmentTemplate(context.workspace.id)
      : null
    const installResult = createResult.ok && payload.autoEnvironmentInstall && context.session
      ? await startAutoEnvironmentInstall({
          executorId: context.executorId,
          project,
          session: effectiveWorktreeSession,
          cwd: effectiveWorktreePath,
          workspaceEnvironmentTemplate,
          runtimeEnvironment,
        })
      : null
    const ensureMessage = installResult?.message
      ? `${createResult.message}\n${installResult.message}`
      : createResult.message
    const updatedAt = new Date().toISOString()
    const nextTask: Task = {
      ...nextTaskBase,
      currentStep: ensureMessage,
      updatedAt,
      logs: [...taskResult.task.logs, createExecutionLog(
        createResult.ok && (installResult?.ok ?? true) ? 'system' : 'review',
        ensureMessage,
      )],
    }
    const nextSession = context.session
      ? saveWorkspaceDirectorySessions({
          task: taskResult.task,
          currentSession: context.session,
          effectiveSession: effectiveWorktreeSession,
          patch: {
            executorNodeId: context.executorId || context.session.executorNodeId,
            runtimeOwnerExecutorId: context.executorId || context.session.runtimeOwnerExecutorId,
            worktreeStatus: createResult.ok ? 'created' : (worktreeDirectoryReady ? effectiveWorktreeSession.worktreeStatus : 'planned'),
            agentRunningStatus: createResult.ok && (installResult?.ok ?? true) ? 'idle' : 'error',
            currentStep: ensureMessage,
            updatedAt,
            lastActiveAt: updatedAt,
          },
        })
      : undefined

    if (state.tasks.some((task) => task.id === taskResult.task.id)) {
      saveTask(nextTask)
    }
    const nextState: AppState = nextSession
      ? upsertWorkspaceSessionInState({
          ...state,
          projects: state.projects.map((item) => (item.id === project.id ? project : item)),
          tasks: state.tasks.map((item) => (item.id === taskId ? nextTask : item)),
        }, nextSession)
      : {
          ...state,
          projects: state.projects.map((item) => (item.id === project.id ? project : item)),
          tasks: state.tasks.map((item) => (item.id === taskId ? nextTask : item)),
        }

    recordAdminOperationAudit({
      actorUserId: userId,
      projectId: project.id,
      taskId: taskResult.task.id,
      workspaceId: runtimeWorkspace.id,
      eventType: 'admin.task_worktree.ensured',
      payload: {
        executorId: context.executorId,
        workspaceSessionId: context.session.id,
        worktreePath: effectiveWorktreePath,
        ok: createResult.ok,
        createNewSession: payload.createNewSession === true,
        autoEnvironmentInstall: payload.autoEnvironmentInstall === true,
      },
    })

    if (!createResult.ok) {
      return c.json(await withState(nextState, ensureMessage, userId), 400)
    }

    return c.json(await withState(nextState, ensureMessage, userId))
  })

  app.post('/api/tasks/:id/workspace-branch', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = taskWorkspaceBranchSwitchSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const workspace = resolveTaskWorkspace(userId, taskResult.project, taskResult.task, payload.workspaceId, payload.workspaceSessionId)
    if (!workspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }
    const session = resolveWorkspaceSessionForTaskContext(taskResult.task, workspace.id, payload.workspaceSessionId)
    if (!session) {
      return c.json({ state: getScopedState(state, userId), message: '工作区会话不存在。' }, 404)
    }
    const executorId = resolveWorkspaceSessionExecutorId(session, workspace.executorNodeId)
    const project = await refreshProjectVersionControlFromExecutor(userId, taskResult.project, executorId)
    const branchSwitchBlockedMessage = getWorkspaceBranchSwitchBlockedMessage(project)
    if (branchSwitchBlockedMessage) {
      return c.json({ state: getScopedState(state, userId), message: branchSwitchBlockedMessage }, 400)
    }

    if (isWorkspaceSessionBranchSwitchBlocked(session)) {
      return c.json({ state: getScopedState(state, userId), message: '当前会话正在运行，暂时不能切换分支。' }, 409)
    }

    const branchName = payload.branchName.trim()
    const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
      applyWorkspaceCodeStateToSession(
        resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, session, workspace.executorNodeId),
        workspace,
      ),
      workspace,
    )
    const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(workspace, effectiveWorktreeSession)
    const context = resolveTaskExecutorContext({
      userId,
      state,
      project,
      task: buildWorkspaceTaskExecutionView(taskResult.task, session),
      workspace,
      session,
    })
    if (!context.executorId || !context.session) {
      return c.json({ state: getScopedState(state, userId), message: '当前工作区没有可用执行节点。' }, 400)
    }

    const effectiveWorktreePath = resolveWorkspaceSessionCwd(context.workspaceRoot, project, effectiveWorktreeSession, workspace)
    if (!effectiveWorktreePath) {
      return c.json({ state: getScopedState(state, userId), message: '当前工作区没有可用目录。' }, 400)
    }
    const worktreeDirectoryReady = await isExecutorWorkspaceDirectoryReady({
      executorId: context.executorId,
      cwd: effectiveWorktreePath,
      workingDirectoryMode,
      worktreeStatus: effectiveWorktreeSession.worktreeStatus,
    })
    if (
      workingDirectoryMode === 'worktree'
      && effectiveWorktreeSession.worktreeStatus === 'created'
      && worktreeDirectoryReady
      && (effectiveWorktreeSession.baseBranch?.trim() || '') === branchName
    ) {
      return c.json({
        ...(await withState(state, `当前工作区已经基于分支 ${branchName} 准备。`, userId)),
        workspaceSessionId: session.id,
        workspaceSession: session,
      })
    }

    const repoUrl = project.gitUrl?.trim() || undefined
    const gitIdentity = await resolveTaskGitIdentitySafely(userId, project)
    let operationOk = false
    let operationMessage = ''
    const currentWorkspaceCodeBranchName = resolveWorkspaceCodeBranchName({
      workspace,
      fallbackSession: effectiveWorktreeSession,
      fallbackBaseBranch: branchName,
    })
    const workspaceCodeBranchName = workingDirectoryMode === 'worktree'
      ? buildWorkspaceCodeBranchName({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          discriminator: `${branchName}-${Date.now().toString(36)}`,
        })
      : currentWorkspaceCodeBranchName
    let nextBranchName = workspaceCodeBranchName
    let nextBaseBranch = branchName
    let nextWorktreeStatus = effectiveWorktreeSession.worktreeStatus

    if (workingDirectoryMode === 'original-dir') {
      const checkoutResult = await executorWsService.requestGitCheckout(context.executorId, {
        worktreePath: effectiveWorktreePath,
        repoUrl,
        branchName,
        gitIdentity,
      }).catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : '切换分支失败。',
        currentBranch: '',
      }))

      operationOk = checkoutResult.ok
      operationMessage = checkoutResult.message
      nextBranchName = checkoutResult.currentBranch?.trim() || branchName
      nextWorktreeStatus = 'created'
    } else {
      if (effectiveWorktreeSession.worktreeStatus === 'created' && worktreeDirectoryReady) {
        const dirtyResult = await executorWsService.requestGitWorkingTreeDiff(context.executorId, {
          worktreePath: effectiveWorktreePath,
          repoUrl,
          gitIdentity,
        }).catch((error) => ({
          ok: false as const,
          message: error instanceof Error ? error.message : '读取当前工作区改动失败。',
          currentBranch: '',
          files: [],
        }))

        if (!dirtyResult.ok) {
          return c.json({ state: getScopedState(state, userId), message: dirtyResult.message }, 400)
        }

        if (dirtyResult.files.length > 0) {
          return c.json({ state: getScopedState(state, userId), message: '当前隔离目录有未提交改动，请先处理后再切换分支。' }, 409)
        }

        const cleanupResult = await executorWsService.requestWorktreeCleanup(context.executorId, {
          workspaceId: workspace.id,
          ownerUserId: workspace.ownerUserId ?? userId,
          repoPath: context.repoPath,
          repoUrl,
          worktreePath: effectiveWorktreePath,
          workingDirectoryMode,
        }).catch((error) => ({
          ok: false as const,
          message: error instanceof Error ? error.message : '清理当前隔离目录失败。',
        }))

        if (!cleanupResult.ok) {
          return c.json({ state: getScopedState(state, userId), message: cleanupResult.message }, 400)
        }

        nextWorktreeStatus = 'planned'
      }

      const runtimeWorkspace = context.workspace
      if (!runtimeWorkspace) {
        return c.json({ state: getScopedState(state, userId), message: '当前任务没有可用的工作区。' }, 400)
      }
      const runtimeEnvironment = await resolveScopedRuntimeEnvironment({
        projectId: taskResult.project.id,
        workspaceId: runtimeWorkspace.id,
      }).then((result) => result?.payload).catch(() => undefined)
      const ensureResult = await executorWsService.requestWorktreeEnsure(context.executorId, {
        workspaceId: runtimeWorkspace.id,
        ownerUserId: runtimeWorkspace.ownerUserId ?? userId,
        repoPath: context.repoPath,
        repoUrl,
        preferredBranch: branchName,
        startPointMode: 'preferred-branch',
        branchName: workspaceCodeBranchName,
        worktreePath: effectiveWorktreePath,
        workingDirectoryMode,
        gitIdentity,
        runtimeEnvironment,
        onOperationEvent: createWorkspaceOperationTimelineWriter({
          taskId,
          workspaceId: runtimeWorkspace.id,
          workspaceSessionId: context.session.id,
          turnId: `system:workspace-branch-switch:${context.session.id}`,
        }),
      }).catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : '重新准备工作目录失败。',
      }))

      operationOk = ensureResult.ok
      operationMessage = ensureResult.message
      nextWorktreeStatus = ensureResult.ok ? 'created' : 'planned'
    }

    const updatedAt = new Date().toISOString()
    if (operationOk) {
      saveWorkspace({
        ...workspace,
        codeBaseBranch: nextBaseBranch,
        codeBranchName: nextBranchName,
        codeRemoteHeadSha: undefined,
        codeSyncedAt: undefined,
        updatedAt,
      })
    }
    const nextTask: Task = {
      ...taskResult.task,
      updatedAt,
      currentStep: operationMessage,
      logs: [...taskResult.task.logs, createExecutionLog(operationOk ? 'system' : 'review', operationMessage)],
    }
    const nextSession = saveWorkspaceDirectorySessions({
      task: taskResult.task,
      currentSession: session,
      effectiveSession: effectiveWorktreeSession,
      patch: {
        baseBranch: nextBaseBranch,
        branchName: nextBranchName,
        worktreeStatus: nextWorktreeStatus,
        currentStep: operationMessage,
        agentRunningStatus: operationOk ? 'idle' : 'error',
        updatedAt,
        lastActiveAt: updatedAt,
      },
    })

    saveTask(nextTask)
    const nextState = upsertWorkspaceSessionInState({
      ...state,
      projects: state.projects.map((item) => (item.id === project.id ? project : item)),
      tasks: state.tasks.map((item) => (item.id === taskId ? nextTask : item)),
    }, nextSession)

    return c.json({
      ...(await withState(nextState, operationMessage, userId)),
      workspaceSessionId: nextSession.id,
      workspaceSession: nextSession,
    }, operationOk ? 200 : 400)
  })

  app.post('/api/tasks/:id/environment/:action', requireAuth, async (c) => {
    const action = z.enum(['start', 'stop', 'logs']).parse(c.req.param('action'))
    const userId = getUserIdFromHeader(c)!
    const payload = taskEnvironmentActionSchema.parse(await c.req.json().catch(() => ({})))
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const workspace = payload.workspaceId || payload.workspaceSessionId
      ? resolveTaskWorkspace(userId, taskResult.project, taskResult.task, payload.workspaceId, payload.workspaceSessionId)
      : null
    if ((payload.workspaceId || payload.workspaceSessionId) && !workspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }
    const existingSession = workspace
      ? resolveWorkspaceSessionForTaskContext(taskResult.task, workspace.id, payload.workspaceSessionId)
      : null
    const workspaceSessionExecutorId = resolveWorkspaceSessionExecutorId(existingSession, workspace?.executorNodeId)
    const effectiveProject = workspace
      ? await refreshProjectVersionControlFromExecutor(userId, taskResult.project, workspaceSessionExecutorId)
      : taskResult.project

    const bindingState = workspace
      ? ensureTaskWorkspaceBindingState({
          task: taskResult.task,
          workspaceId: workspace.id,
          updatedAt: new Date().toISOString(),
        })
      : null
    const binding = bindingState?.binding ?? null
    let session = workspace
      ? ensureWorkspaceSessionRecord({
          task: bindingState?.task ?? taskResult.task,
          workspaceId: workspace.id,
          executorNodeId: workspaceSessionExecutorId,
          workspace,
          workspaceSessionId: payload.workspaceSessionId,
          createNewSession: payload.createNewSession,
        })
      : resolveWorkspaceSessionForTaskContext(taskResult.task, payload.workspaceId, payload.workspaceSessionId)

    const nextTaskBase: Task = session
      ? buildWorkspaceTaskExecutionView(bindingState?.task ?? taskResult.task, session)
      : (bindingState?.task ?? taskResult.task)
    const context = resolveTaskExecutorContext({
      userId,
      state,
      project: effectiveProject,
      task: nextTaskBase,
      workspace,
      session,
    })
    if (!context.executorId || !context.session) {
      return c.json({ state: getScopedState(state, userId), message: '请先绑定工作区与会话后再执行环境动作。' }, 400)
    }

    const runtimeWorkspace = context.workspace
    if (!runtimeWorkspace) {
      return c.json({ state: getScopedState(state, userId), message: '当前任务没有可用的工作区。' }, 400)
    }
    const workspaceEnvironmentTemplate = await getWorkspaceEnvironmentTemplate(runtimeWorkspace.id)
    if (!taskResult.project.environmentTemplate && !workspaceEnvironmentTemplate) {
      return c.json({ state: getScopedState(state, userId), message: '当前项目和工作区都还没有可用的环境模板。' }, 400)
    }
    const effectiveWorktreeSession = hydrateWorkspaceSessionWithLocalWorktree(
      applyWorkspaceCodeStateToSession(
        resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, runtimeWorkspace.executorNodeId),
        runtimeWorkspace,
      ),
      runtimeWorkspace,
    )
    const effectiveWorktreePath = resolveWorkspaceSessionCwd(context.workspaceRoot, effectiveProject, effectiveWorktreeSession, context.workspace)
    if (!effectiveWorktreePath) {
      return c.json({ state: getScopedState(state, userId), message: '当前任务还没有可用的工作区目录。' }, 400)
    }
    const workingDirectoryMode = resolveWorkspaceWorkingDirectoryMode(runtimeWorkspace, effectiveWorktreeSession)
    const worktreeDirectoryReady = await isExecutorWorkspaceDirectoryReady({
      executorId: context.executorId,
      cwd: effectiveWorktreePath,
      workingDirectoryMode,
      worktreeStatus: effectiveWorktreeSession.worktreeStatus,
    })
    let taskForEnvironmentCommand = nextTaskBase
    let installState: AppState = state
    let installResult: Awaited<ReturnType<typeof executeAutoPreparedWorktreeInstallCommand>> | null = null
    if (
      action === 'start'
      && !worktreeDirectoryReady
    ) {
      const runtimeEnvironment = await resolveScopedRuntimeEnvironment({
        projectId: effectiveProject.id,
        workspaceId: runtimeWorkspace.id,
      }).then((result) => result?.payload).catch(() => undefined)
      const createResult = await executorWsService.requestWorktreeEnsure(context.executorId, {
        workspaceId: runtimeWorkspace.id,
        ownerUserId: runtimeWorkspace.ownerUserId ?? userId,
        repoPath: effectiveProject.versionControl === 'none' ? undefined : context.repoPath,
        repoUrl: effectiveProject.versionControl === 'none' ? undefined : (effectiveProject.gitUrl?.trim() || undefined),
        preferredBranch: nextTaskBase.baseBranch?.trim() || nextTaskBase.baseBranchHint?.trim() || effectiveProject.defaultBranch,
        branchName: effectiveWorktreeSession.branchName,
        worktreePath: effectiveWorktreePath,
        workingDirectoryMode,
        gitIdentity: await resolveTaskGitIdentitySafely(userId, effectiveProject),
        runtimeEnvironment,
        onOperationEvent: createWorkspaceOperationTimelineWriter({
          taskId,
          workspaceId: runtimeWorkspace.id,
          workspaceSessionId: context.session.id,
          turnId: `system:workspace-environment-start-prepare:${context.session.id}`,
        }),
      }).catch((error) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : '工作目录准备失败。',
      }))
      const updatedAt = new Date().toISOString()
      const nextSession = saveWorkspaceDirectorySessions({
        task: taskResult.task,
        currentSession: context.session,
        effectiveSession: effectiveWorktreeSession,
        patch: {
          executorNodeId: context.executorId || context.session.executorNodeId,
          runtimeOwnerExecutorId: context.executorId || context.session.runtimeOwnerExecutorId,
          worktreeStatus: createResult.ok ? 'created' : (worktreeDirectoryReady ? effectiveWorktreeSession.worktreeStatus : 'planned'),
          agentRunningStatus: createResult.ok ? 'idle' : 'error',
          currentStep: createResult.message,
          updatedAt,
          lastActiveAt: updatedAt,
        },
      })
      const nextTask = {
        ...nextTaskBase,
        updatedAt,
        logs: [...taskResult.task.logs, createExecutionLog(createResult.ok ? 'system' : 'review', createResult.message)],
      }
      saveTask(nextTask)
      if (!createResult.ok) {
        const nextState = upsertWorkspaceSessionInState({
          ...state,
          tasks: state.tasks.map((item) => (item.id === taskId ? nextTask : item)),
        }, nextSession)
        return c.json(await withState(nextState, createResult.message, userId), 400)
      }

      session = nextSession
      taskForEnvironmentCommand = nextTask
      installState = upsertWorkspaceSessionInState({
        ...state,
        tasks: state.tasks.map((item) => (item.id === taskId ? nextTask : item)),
      }, nextSession)
    }

    const preview = resolveProjectEnvironmentPreview({
      project: effectiveProject,
      session: session ?? context.session,
      cwd: effectiveWorktreePath,
      workspaceEnvironmentTemplate,
    })
    if (!preview) {
      return c.json({ state: getScopedState(state, userId), message: '环境模板渲染失败，请检查会话 unique id 与模板内容。' }, 400)
    }

    const command = action === 'start'
      ? preview.startCommand
      : action === 'stop'
        ? preview.stopCommand
        : preview.logsCommand
    if (!command) {
      return c.json({ state: getScopedState(state, userId), message: action === 'logs' ? '当前模板没有配置日志命令。' : '当前模板缺少对应命令。' }, 400)
    }

    if (action === 'start' && installState !== state) {
      const installCommand = preview.installCommand?.trim()
      if (installCommand) {
        installResult = await executeAutoPreparedWorktreeInstallCommand({
          state: installState,
          project: effectiveProject,
          task: taskForEnvironmentCommand,
          workspace: runtimeWorkspace,
          session: session ?? context.session,
          executorId: context.executorId,
          cwd: effectiveWorktreePath,
          command: installCommand,
          runtimeEnvironment: await resolveScopedRuntimeEnvironment({
            projectId: effectiveProject.id,
            workspaceId: runtimeWorkspace.id,
          }).then((result) => result?.payload).catch(() => undefined),
        })
        session = installResult.session
        taskForEnvironmentCommand = installResult.task
        installState = installResult.state
        if (installResult.result.exitCode !== 0) {
          const message = `自动安装失败，已停止启动环境。${installResult.output ? `\n${installResult.output}` : ''}`
          return c.json({
            ...(await withState(installResult.state, message, userId)),
            output: installResult.output,
            appUrl: preview.appUrl,
            healthUrl: preview.healthUrl,
            command: installCommand,
            exitCode: installResult.result.exitCode,
          }, 400)
        }
      }
    }

    const execution = await executeTaskEnvironmentCommand({
      state: installState,
      project: effectiveProject,
      task: taskForEnvironmentCommand,
      workspace,
      session: session ?? context.session,
      executorId: context.executorId,
      cwd: effectiveWorktreePath,
      action,
      command,
      mode: action === 'start' ? 'background' : 'wait',
    })
    const environmentStatus = await resolveEnvironmentStatusAfterAction({
      action,
      executorId: context.executorId,
      exitCode: execution.result.exitCode,
      preview,
      failureMessage: execution.message,
    })
    await saveWorkspaceSessionEnvironmentRuntime({
      task: nextTaskBase,
      session: session ?? context.session,
      status: environmentStatus,
      source: 'server-probe',
      executorId: context.executorId,
    })

    return c.json({
      ...(await withState(execution.state, execution.message, userId)),
      output: execution.output,
      appUrl: preview.appUrl,
      healthUrl: preview.healthUrl,
      environmentStatus,
      command,
      exitCode: execution.result.exitCode,
    }, execution.result.exitCode === 0 ? 200 : 400)
  })

  app.get('/api/tasks/:id/environment/status', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = taskEnvironmentStatusQuerySchema.parse(c.req.query())
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const workspace = payload.workspaceId || payload.workspaceSessionId
      ? resolveTaskWorkspace(userId, taskResult.project, taskResult.task, payload.workspaceId, payload.workspaceSessionId)
      : null
    if ((payload.workspaceId || payload.workspaceSessionId) && !workspace) {
      return c.json({ message: '工作区不存在或无权访问。' }, 404)
    }
    const session = resolveWorkspaceSessionForTaskContext(taskResult.task, workspace?.id, payload.workspaceSessionId)
    const workspaceSessionExecutorId = resolveWorkspaceSessionExecutorId(session, workspace?.executorNodeId)

    const effectiveProject = workspace
      ? await refreshProjectVersionControlFromExecutor(userId, taskResult.project, workspaceSessionExecutorId)
      : taskResult.project
    const workspaceEnvironmentTemplate = workspace
      ? await getWorkspaceEnvironmentTemplate(workspace.id)
      : null
    if (!effectiveProject.environmentTemplate && !workspaceEnvironmentTemplate) {
      const environmentStatus = createWorkspaceEnvironmentStatusSnapshot({
        status: 'unsupported',
        message: '当前项目和工作区都还没有可用的环境模板。',
      })
      return c.json({
        state: getScopedState(state, userId),
        message: environmentStatus.message,
        environmentStatus,
      })
    }
    const context = resolveTaskExecutorContext({
      userId,
      state,
      project: effectiveProject,
      task: taskResult.task,
      workspace,
      session,
    })
    if (!context.executorId || !context.session) {
      return c.json({ state: getScopedState(state, userId), message: '请先绑定工作区与会话后再检查环境状态。' }, 400)
    }

    const effectiveWorktreeSession = context.workspace
      ? hydrateWorkspaceSessionWithLocalWorktree(
          applyWorkspaceCodeStateToSession(
            resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, context.workspace.executorNodeId),
            context.workspace,
          ),
          context.workspace,
        )
      : resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, undefined)
    const effectiveWorktreePath = resolveWorkspaceSessionCwd(context.workspaceRoot, effectiveProject, effectiveWorktreeSession, context.workspace)
    if (!effectiveWorktreePath) {
      return c.json({ state: getScopedState(state, userId), message: '当前任务还没有可用的工作区目录。' }, 400)
    }

    const preview = resolveProjectEnvironmentPreview({
      project: effectiveProject,
      session: context.session,
      cwd: effectiveWorktreePath,
      workspaceEnvironmentTemplate,
    })
    if (!preview) {
      const environmentStatus = createWorkspaceEnvironmentStatusSnapshot({
        status: 'unsupported',
        message: '环境模板渲染失败，请检查会话 unique id 与模板内容。',
      })
      return c.json({
        state: getScopedState(state, userId),
        message: environmentStatus.message,
        environmentStatus,
      })
    }

    const environmentStatus = await probeWorkspaceEnvironmentStatus({
      executorId: context.executorId,
      preview,
    })
    await saveWorkspaceSessionEnvironmentRuntime({
      task: taskResult.task,
      session: context.session,
      status: environmentStatus,
      source: 'server-probe',
      executorId: context.executorId,
    })

    return c.json({
      state: getScopedState(state, userId),
      message: environmentStatus.message,
      environmentStatus,
    })
  })

  app.post('/api/tasks/:id/open-vscode', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const context = resolveTaskExecutorContext({
      userId,
      state,
      project: taskResult.project,
      task: taskResult.task,
    })
    if (!context.executorId) {
      return c.json({ state: getScopedState(state, userId), message: '当前工作区会话还没有绑定执行节点。' }, 400)
    }

    const effectiveWorktreeSession = context.session
      ? context.workspace
        ? hydrateWorkspaceSessionWithLocalWorktree(
            applyWorkspaceCodeStateToSession(
              resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, context.workspace.executorNodeId),
              context.workspace,
            ),
            context.workspace,
          )
        : resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, undefined)
      : null
    const effectiveWorktreePath = effectiveWorktreeSession
      ? resolveWorkspaceSessionCwd(context.workspaceRoot, taskResult.project, effectiveWorktreeSession, context.workspace)
      : undefined
    if (!effectiveWorktreePath) {
      return c.json({ message: '当前任务还没有可打开的工作区目录。' }, 400)
    }
    const candidateCwds = Array.from(new Set([
      effectiveWorktreeSession?.worktreeStatus !== 'cleaned' ? effectiveWorktreePath : '',
      context.repoPath || '',
      context.workspaceRoot || '',
    ].filter(Boolean)))
    const openableCwds = await resolveFirstOpenableTaskWorkspaceCwd(context.executorId, candidateCwds)
    const commands = buildVsCodeOpenCommandAttempts({
      platform: context.executor?.platform,
    })
    let lastFailureMessage = ''
    const runtimeWorkspace = context.workspace
    if (!runtimeWorkspace) {
      return c.json({ message: '当前任务没有可用的工作区。' }, 400)
    }
    const runtimeEnvironment = await resolveScopedRuntimeEnvironment({
      projectId: taskResult.project.id,
      workspaceId: runtimeWorkspace.id,
    }).then((result) => result?.payload).catch(() => undefined)

    for (const cwd of openableCwds) {
      for (const command of commands) {
        try {
          const response = await executorWsService.requestTerminalCommand(context.executorId, command, cwd, {
            mode: 'background',
            runtimeEnvironment,
          })
          if (response.exitCode === 0) {
            return c.json(await withState(state, `已在工作站 ${context.executorName} 打开 VS Code。`, userId))
          }
          lastFailureMessage = response.stderr.trim() || response.stdout.trim() || lastFailureMessage
        } catch (error) {
          lastFailureMessage = error instanceof Error ? error.message : lastFailureMessage
        }
      }
    }

    if (lastFailureMessage) {
      return c.json({ state: getScopedState(state, userId), message: `工作站 ${context.executorName} 打开 VS Code 失败：${lastFailureMessage}` }, 400)
    }

    return c.json({ state: getScopedState(state, userId), message: `工作站 ${context.executorName} 上未找到可用的 VS Code CLI。` }, 400)
  })

  app.delete('/api/tasks/:id/workspaces', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task || !taskResult.project) return jsonError(c, taskResult.message, taskResult.status)

    const associatedWorkspaceIds = listActiveTaskWorkspaceBindings(taskResult.task.id).map((binding) => binding.workspaceId)

    if (associatedWorkspaceIds.length === 0) {
      return c.json(await withState(state, '任务下没有可处理的工作区。', userId))
    }

    const associatedWorkspaceIdSet = new Set(associatedWorkspaceIds)
    const associatedWorkspaces = listProjectWorkspacesForUser(userId, taskResult.project)
      .filter((workspace) => associatedWorkspaceIdSet.has(workspace.id))
    const deletableWorkspaceIds = associatedWorkspaces
      .filter((workspace) => canDeleteWorkspaceRecord(workspace) && (!workspace.ownerUserId || workspace.ownerUserId === userId))
      .map((workspace) => workspace.id)
    const deletableWorkspaceIdSet = new Set(deletableWorkspaceIds)
    for (const workspace of associatedWorkspaces) {
      if (!deletableWorkspaceIdSet.has(workspace.id)) {
        continue
      }

      const cleanupResult = await cleanupWorkspaceWorktrees({
        state,
        project: taskResult.project,
        workspace,
        sessions: state.workspaceSessions.filter((session) => session.workspaceId === workspace.id),
        userId,
        deleteLocalBranch: false,
        deleteRemoteBranch: false,
      })
      if (!cleanupResult.ok) {
        return c.json({ message: cleanupResult.message }, 409)
      }
    }
    const timestamp = new Date().toISOString()
    const nextTasks = state.tasks.map((task) => {
      if (task.id === taskResult.task.id) {
        return detachWorkspaceIdsFromTask(task, associatedWorkspaceIdSet, timestamp)
      }
      if (!deletableWorkspaceIds.length) {
        return task
      }
      return detachWorkspaceIdsFromTask(task, deletableWorkspaceIdSet, timestamp)
    })

    nextTasks.forEach((task, index) => {
      if (task !== state.tasks[index]) {
        saveTask(task)
      }
    })

    if (deletableWorkspaceIds.length) {
      deleteWorkspaces(deletableWorkspaceIds)
    }
    deleteTaskWorkspaceBindings({ taskId, workspaceIds: associatedWorkspaceIds })

    const preservedCount = associatedWorkspaceIds.length - deletableWorkspaceIds.length
    const messageParts = []
    if (deletableWorkspaceIds.length > 0) {
      messageParts.push(`已删除 ${deletableWorkspaceIds.length} 个自建工作区`)
    }
    messageParts.push(`已解除当前任务的 ${associatedWorkspaceIds.length} 个工作区关联`)
    if (preservedCount > 0) {
      messageParts.push(`${preservedCount} 个项目工作区已保留`)
    }

    const nextState: AppState = {
      ...state,
      tasks: nextTasks,
      taskWorkspaceBindings: state.taskWorkspaceBindings.filter((binding) => !(binding.taskId === taskId && associatedWorkspaceIdSet.has(binding.workspaceId))),
      workspaceSessions: state.workspaceSessions,
    }
    return c.json(await withState(nextState, `${messageParts.join('，')}。`, userId))
  })

  app.delete('/api/tasks/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const state = loadState()
    const taskId = c.req.param('id')
    const taskResult = getAuthorizedTask(state, userId, taskId)
    if (!taskResult.task) return jsonError(c, taskResult.message, taskResult.status)

    if (taskResult.project) {
      const project = taskResult.project.preferredExecutorId
        ? await refreshProjectVersionControlFromExecutor(userId, taskResult.project, taskResult.project.preferredExecutorId)
        : taskResult.project
      const context = resolveTaskExecutorContext({
        userId,
        state,
        project,
        task: taskResult.task,
      })
      if (context.executorId && project.versionControl !== 'none') {
        const effectiveWorktreeSession = context.session
          ? context.workspace
            ? hydrateWorkspaceSessionWithLocalWorktree(
                applyWorkspaceCodeStateToSession(
                  resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, context.workspace.executorNodeId),
                  context.workspace,
                ),
                context.workspace,
              )
            : resolveEffectiveWorkspaceWorktreeSession(taskResult.task.id, context.session, undefined)
          : null
        const effectiveWorktreePath = effectiveWorktreeSession
          ? resolveWorkspaceSessionCwd(context.workspaceRoot, project, effectiveWorktreeSession, context.workspace)
          : undefined
        if (effectiveWorktreePath) {
          await executorWsService.requestWorktreeCleanup(context.executorId, {
            workspaceId: context.workspace?.id ?? effectiveWorktreeSession?.workspaceId,
            ownerUserId: context.workspace?.ownerUserId ?? userId,
            repoPath: context.repoPath,
            repoUrl: project.gitUrl?.trim() || undefined,
            worktreePath: effectiveWorktreePath,
            workingDirectoryMode: resolveWorkspaceWorkingDirectoryMode(context.workspace, effectiveWorktreeSession),
          }).catch(() => undefined)
        }
      }
    }

    deleteTask(taskId)
    const tasks = state.tasks.filter((item) => item.id !== taskId)
    const nextState: AppState = {
      ...state,
      tasks,
      executionCenter: deriveExecutionCenter(tasks, state.executionCenter),
    }
    return c.json(await withState(nextState, '任务已删除。', userId))
  })
}
