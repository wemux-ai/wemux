/**
 * [INPUT]: Authenticated MCP context plus authorized projects, tasks, workspaces, sessions, and user-owned Agents.
 * [OUTPUT]: Workspace/session MCP tools and an owner-scoped Agent catalog for the acting user.
 * [POS]: MCP workspace control surface; code execution still delegates to worker/executor services.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { z } from 'zod'
import { getUserAgents } from '../../repositories/agent'
import { listWorkspaces } from '../../storage/distributed-task-store'
import { listWorkspaceSessions, getWorkspaceSessionById, saveTask, saveWorkspaceSession } from '../../storage/app-state-store'
import { SERVER_AGENT_TYPES } from '../../services/server-agent'
import { parsePrimaryAgentMcpServers, VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { syncTaskStatusFromReviewReady } from '@shared/task-status-flow'
import { mergeWorkspaceSession, resolveWorkspaceSessionExecutorId } from '@shared/task-workspace'
import type { AppState, Project, Task } from '@shared/types'
import { executorWsService } from '../../control-plane/executor-ws-service'
import { resolveUserProjectGitIdentity } from '../../control-plane/task-git-identity'
import {
  getWorkspaceSessionRecordForTaskContext,
  listProjectWorkspacesForUser,
  resolveEffectiveWorkspaceWorktreeSession,
  resolveWorkspaceSessionCwd,
} from '../../routes/task-route-support'
import { ErrorCode, McpError, type McpServer } from './sdk'
import {
  requireProject,
  requireTask,
  toToolResult,
  type WemuxMcpContext,
} from './wemux-mcp-context'

const summarizeWorkspaceSession = (session: Awaited<ReturnType<typeof getWorkspaceSessionById>>) => {
  if (!session) return null
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    title: session.title,
    titleOrigin: session.titleOrigin,
    status: session.status,
    sessionKind: session.sessionKind,
    sessionRole: session.sessionRole,
    sessionOrigin: session.sessionOrigin,
    parentSessionId: session.parentSessionId,
    agentType: session.agentType,
    customAgentId: session.customAgentId,
    customAgentName: session.customAgentName,
    executionModel: session.executionModel,
    executorNodeId: session.executorNodeId,
    agentInvocationMode: session.agentInvocationMode,
    mountedSkillNames: session.mountedSkillNames,
    mountedMcpServerNames: session.mountedMcpServerNames,
    enabledMcpServerIds: session.enabledMcpServerIds,
    delegatedPrompt: session.delegatedPrompt,
    baseBranch: session.baseBranch,
    distributedTaskId: session.distributedTaskId,
    agentSessionId: session.agentSessionId,
    opencodeSessionId: session.opencodeSessionId,
    displayOrder: session.displayOrder,
    pinnedAt: session.pinnedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

const summarizeAgent = (agent: ReturnType<typeof getUserAgents>[number]) => ({
  id: agent.id,
  type: agent.type,
  name: agent.name,
  endpoint: agent.endpoint,
  ownerUserId: agent.ownerUserId,
  workDir: agent.workDir,
  workDirStatus: agent.workDirStatus,
  createdAt: agent.createdAt,
  updatedAt: agent.updatedAt,
  lastHeartbeatAt: agent.lastHeartbeatAt,
})

const normalizePullRequestField = (value?: string | null) => value?.trim() || ''

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

const resolveTaskWorkspace = (userId: string, project: Project, workspaceId?: string, workspaceSessionId?: string) => {
  const targetWorkspaceId = workspaceId?.trim()
  if (targetWorkspaceId) {
    return listProjectWorkspacesForUser(userId, project).find((item) => item.id === targetWorkspaceId) ?? null
  }

  if (workspaceSessionId?.trim()) {
    const session = listWorkspaceSessions().find((item) => item.id === workspaceSessionId.trim())
    if (session) {
      return listProjectWorkspacesForUser(userId, project).find((item) => item.id === session.workspaceId) ?? null
    }
  }

  return null
}

const resolveWorkspaceSessionForTaskContext = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (!workspaceId) {
    return null
  }

  return getWorkspaceSessionRecordForTaskContext(task.id, workspaceId, workspaceSessionId)
}

const resolveWorkspaceGitTarget = (params: {
  userId: string
  state: AppState
  projectId: string
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const task = requireTask(params.state, params.taskId)
  const project = requireProject(params.state, params.projectId)
  if (task.projectId !== project.id) {
    throw new McpError(ErrorCode.InvalidParams, '任务不属于指定项目。')
  }

  const workspace = resolveTaskWorkspace(params.userId, project, params.workspaceId, params.workspaceSessionId)
  if (!workspace || workspace.projectId !== project.id) {
    throw new McpError(ErrorCode.InvalidParams, '工作区不存在或无权访问。')
  }

  const session = resolveWorkspaceSessionForTaskContext(task, workspace.id, params.workspaceSessionId)
  if (!session || session.workspaceId !== workspace.id) {
    throw new McpError(ErrorCode.InvalidParams, '工作区会话不存在或不属于当前任务。')
  }

  const binding = params.state.taskWorkspaceBindings.find((item) => (
    item.taskId === task.id
    && item.workspaceId === workspace.id
    && item.status === 'active'
  ))
  if (!binding) {
    throw new McpError(ErrorCode.InvalidParams, '当前任务未绑定到这个工作区。')
  }

  const executorId = resolveWorkspaceSessionExecutorId(session, workspace.executorNodeId)
  const effectiveWorktreeSession = resolveEffectiveWorkspaceWorktreeSession(task.id, session, workspace.executorNodeId)
  const baseBranch = session.baseBranch?.trim()
    || task.baseBranch?.trim()
    || task.baseBranchHint?.trim()
    || workspace.suggestedBaseBranch?.trim()
    || workspace.defaultBranch?.trim()
    || project.defaultBranch?.trim()
    || 'main'
  const compareBranch = effectiveWorktreeSession?.branchName?.trim() || ''

  return {
    task,
    project,
    workspace,
    session,
    executorId,
    baseBranch,
    compareBranch,
    worktreePath: resolveWorkspaceSessionCwd(params.state.config.workspaceRoot, project, effectiveWorktreeSession ?? session, workspace),
  }
}

const resolveTaskGitIdentityForSession = async (params: {
  userId: string
  projectId: string
  repoUrl: string
  session?: { gitAuthPreference?: 'project-default' | 'github-app' | 'credential' } | null
}) => {
  return await resolveUserProjectGitIdentity({
    userId: params.userId,
    projectId: params.projectId,
    mode: 'personal',
    repoUrl: params.repoUrl,
    gitAuthPreference: params.session?.gitAuthPreference === 'github-app' || params.session?.gitAuthPreference === 'credential'
      ? params.session.gitAuthPreference
      : 'project-default',
  })
}

export const registerWemuxMcpWorkspaceSessionTools = (server: McpServer, ctx: WemuxMcpContext) => {
  server.registerTool('workspace.session.list', {
    title: 'Workspace Session List',
    description: '列出某个任务关联的所有工作区会话',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
      workspaceId: z.string().trim().optional().describe('可选，按工作区 ID 过滤'),
    },
  }, async ({ taskId, workspaceId }) => {
    const state = ctx.getState()
    requireTask(state, taskId)

    // Find workspaces bound to this task
    const taskBindings = state.taskWorkspaceBindings.filter((b) => b.taskId === taskId && b.status === 'active')
    const taskWorkspaceIds = new Set(taskBindings.map((b) => b.workspaceId))

    // Get sessions from those workspaces
    const allSessions = listWorkspaceSessions()
    const filtered = allSessions
      .filter((s) => taskWorkspaceIds.has(s.workspaceId))
      .filter((s) => !workspaceId || s.workspaceId === workspaceId)

    return toToolResult({
      taskId,
      workspaceId: workspaceId || null,
      total: filtered.length,
      sessions: filtered.map(summarizeWorkspaceSession).filter(Boolean),
    })
  })

  // ===== workspace.session.get =====
  server.registerTool('workspace.session.get', {
    title: 'Workspace Session Detail',
    description: '读取单个工作区会话的详情',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      sessionId: z.string().min(1).describe('工作区会话 ID'),
    },
  }, async ({ sessionId }) => {
    const session = getWorkspaceSessionById(sessionId)
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, '工作区会话不存在。')
    }

    // Get the workspace info
    const workspace = listWorkspaces().find((w) => w.id === session.workspaceId)
    const state = ctx.getState()
    const project = workspace ? state.projects.find((p) => p.id === workspace.projectId) : undefined

    return toToolResult({
      session: summarizeWorkspaceSession(session),
      workspace: workspace ? {
        id: workspace.id,
        projectId: workspace.projectId,
        name: workspace.name,
        status: workspace.status,
        executorNodeId: workspace.executorNodeId,
      } : null,
      project: project ? {
        id: project.id,
        name: project.name,
      } : null,
    })
  })

  // ===== workspace.session.runtime =====
  server.registerTool('workspace.session.runtime', {
    title: 'Workspace Session Runtime',
    description: '获取某个任务的运行时视图，包含所有工作区会话状态、分布式任务状态',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
    },
  }, async ({ taskId }) => {
    const state = ctx.getState()
    const task = requireTask(state, taskId)

    // Workspaces bound to task
    const taskBindings = state.taskWorkspaceBindings.filter((b) => b.taskId === taskId)
    const taskWorkspaceIds = new Set(taskBindings.map((b) => b.workspaceId))
    const workspaces = listWorkspaces().filter((w) => taskWorkspaceIds.has(w.id))

    // Sessions from those workspaces
    const sessions = listWorkspaceSessions()
      .filter((s) => taskWorkspaceIds.has(s.workspaceId))

    // Distributed tasks
    const distributedTasks = state.distributedTasks
      ?.filter((dt) => dt.originTaskId === taskId) ?? []

    return toToolResult({
      taskId,
      task: {
        id: task.id,
        status: task.status,
        agentRunningStatus: task.agentRunningStatus,
        currentStep: task.currentStep,
      },
      workspaces: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        executorNodeId: w.executorNodeId,
      })),
      sessions: sessions.map(summarizeWorkspaceSession).filter(Boolean),
      distributedTasks: distributedTasks.map((dt) => ({
        id: dt.id,
        status: dt.status,
        executorNodeId: dt.executorNodeId,
        createdAt: dt.createdAt,
        updatedAt: dt.updatedAt,
      })),
    })
  })

  // ===== workspace.git.push_branch =====
  server.registerTool('workspace.git.push_branch', {
    title: 'Workspace Git Push Branch',
    description: '通过平台托管 Git 身份推送当前工作区会话分支',
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
      taskId: z.string().min(1).describe('任务 ID'),
      workspaceId: z.string().min(1).describe('工作区 ID'),
      workspaceSessionId: z.string().min(1).describe('工作区会话 ID'),
      branchName: z.string().trim().optional().describe('可选，目标分支名，默认使用当前会话分支'),
    },
  }, async ({ projectId, taskId, workspaceId, workspaceSessionId, branchName }) => {
    const target = resolveWorkspaceGitTarget({
      userId: ctx.userId,
      state: ctx.getState(),
      projectId,
      taskId,
      workspaceId,
      workspaceSessionId,
    })
    if (!target.executorId || !target.session || !target.worktreePath) {
      throw new McpError(ErrorCode.InvalidParams, '当前工作区会话还没有准备好工作目录或执行节点。')
    }
    if (target.session.publishPolicy !== 'push-branch' && target.session.publishPolicy !== 'pull-request') {
      throw new McpError(ErrorCode.InvalidParams, '当前工作区会话未启用分支推送权限。')
    }

    const gitIdentity = await resolveTaskGitIdentityForSession({
      userId: ctx.userId,
      projectId: target.project.id,
      repoUrl: target.project.gitUrl,
      session: target.session,
    })
    if (!gitIdentity?.credentialToken) {
      throw new McpError(ErrorCode.InvalidParams, '当前工作区会话缺少可用的 Git 发布身份。')
    }

    const result = await executorWsService.requestGitPush(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: target.project.gitUrl?.trim() || undefined,
      branchName: branchName?.trim() || target.compareBranch,
      gitIdentity,
    })

    return toToolResult(result)
  })

  // ===== workspace.git.create_pull_request =====
  server.registerTool('workspace.git.create_pull_request', {
    title: 'Workspace Git Create Pull Request',
    description: '通过平台托管 Git 身份为当前工作区会话创建 PR',
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
      taskId: z.string().min(1).describe('任务 ID'),
      workspaceId: z.string().min(1).describe('工作区 ID'),
      workspaceSessionId: z.string().min(1).describe('工作区会话 ID'),
      title: z.string().trim().optional().describe('PR 标题'),
      body: z.string().optional().describe('PR 正文'),
      baseBranch: z.string().trim().optional().describe('Base 分支'),
    },
  }, async ({ projectId, taskId, workspaceId, workspaceSessionId, title, body, baseBranch }) => {
    const target = resolveWorkspaceGitTarget({
      userId: ctx.userId,
      state: ctx.getState(),
      projectId,
      taskId,
      workspaceId,
      workspaceSessionId,
    })
    if (!target.executorId || !target.session || !target.worktreePath || !target.workspace) {
      throw new McpError(ErrorCode.InvalidParams, '当前工作区会话还没有准备好工作目录或执行节点。')
    }
    if (target.session.publishPolicy !== 'pull-request') {
      throw new McpError(ErrorCode.InvalidParams, '当前工作区会话未启用 PR 发布权限。')
    }

    const resolvedBaseBranch = baseBranch?.trim() || target.baseBranch
    const resolvedCompareBranch = target.compareBranch
    const resolvedTitle = title?.trim() || buildPullRequestTitle(target.task)
    const resolvedBody = body?.trim() || buildPullRequestBody(target.task, resolvedBaseBranch, resolvedCompareBranch)
    const gitIdentity = await resolveTaskGitIdentityForSession({
      userId: ctx.userId,
      projectId: target.project.id,
      repoUrl: target.project.gitUrl,
      session: target.session,
    })
    if (
      !gitIdentity?.credentialToken
      || !['pat', 'github-app'].includes(gitIdentity.authMode ?? '')
      || gitIdentity.provider !== 'github'
    ) {
      throw new McpError(ErrorCode.InvalidParams, '当前工作区会话缺少可用于创建 GitHub PR 的发布身份。')
    }

    const result = await executorWsService.requestGitPullRequest(target.executorId, {
      worktreePath: target.worktreePath,
      repoUrl: target.project.gitUrl,
      title: resolvedTitle,
      body: resolvedBody,
      baseBranch: resolvedBaseBranch,
      compareBranch: resolvedCompareBranch,
      gitIdentity,
    })

    if (result.ok) {
      const updatedAt = new Date().toISOString()
      const currentStep = result.url ? `PR 已创建：${result.url}` : result.message
      const nextTask: Task = {
        ...syncTaskStatusFromReviewReady(attachTaskPullRequestResult({
          task: target.task,
          repoUrl: target.project.gitUrl,
          title: result.title,
          body: result.body,
          baseBranch: result.baseBranch,
          compareBranch: result.compareBranch,
          number: result.number,
          url: result.url,
          state: result.state,
          updatedAt,
          executorNodeId: target.executorId,
          workspaceId: target.workspace.id,
          workspaceSessionId: target.session.id,
        }), updatedAt),
        currentStep,
        needsHumanConfirm: true,
        agentRunningStatus: 'complete',
      }
      const nextSession = mergeWorkspaceSession(target.task, target.session, {
        currentStep,
        needsHumanConfirm: true,
        agentRunningStatus: 'complete',
        updatedAt,
        lastActiveAt: updatedAt,
      })
      saveTask(nextTask)
      saveWorkspaceSession(nextSession)
    }

    return toToolResult(result)
  })

  // ===== agent.list =====
  server.registerTool('agent.list', {
    title: 'Agent List',
    description: '列出可协作的自定义 Agent。自定义 Agent 运行时不会暴露系统主运行时，避免把平台入口误当成评论或交付作者。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      type: z.string().optional().describe('可选，按 Agent 类型过滤（如 main, custom）'),
    },
  }, async ({ type }) => {
    const agents = getUserAgents(ctx.userId)
      .filter((a) => !type || a.type.toLowerCase() === type.toLowerCase())
      .filter((agent) => !ctx.runtimeAgentId || agent.type.trim().toLowerCase() !== 'main')

    return toToolResult({
      total: agents.length,
      agents: agents.map(summarizeAgent),
    })
  })

  // ===== agent.types =====
  server.registerTool('agent.types', {
    title: 'Agent Types',
    description: '列出支持的 Agent Runtime 类型',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
  }, async () => {
    return toToolResult({
      types: SERVER_AGENT_TYPES,
      description: {
        OpenCode: '通用编码 Agent，零配置，适合大多数任务',
        Codex: '大规模重构、多文件编辑',
        ClaudeCode: '复杂推理、架构设计',
        Pi: '自定义流程、MCP 编排',
      },
    })
  })

  // ===== mcp.list =====
  server.registerTool('mcp.list', {
    title: 'MCP Server List',
    description: '列出当前已配置的 MCP Server',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
  }, async () => {
    const state = ctx.getState()
    const servers = parsePrimaryAgentMcpServers(state.config)

    return toToolResult({
      total: servers.length,
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        target: s.target,
        transport: s.transport,
        enabled: s.enabled,
        managedBySystem: s.managedBySystem,
        ownerUserId: s.ownerUserId,
      })),
    })
  })
}
