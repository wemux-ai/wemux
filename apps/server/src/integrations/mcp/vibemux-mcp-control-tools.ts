// [INPUT]: Authenticated Wemux MCP control requests and scoped control-plane state.
// [OUTPUT]: Project, workspace, executor, conversation, and channel control tools.
// [POS]: MCP control-plane adapter; workspace creation consumes configured execution defaults.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import { DEFAULT_AGENT_TYPE } from '@shared/agent-type'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { deriveProjectColor, normalizeHexColor } from '@shared/project-color'
import type { AppState, MainChatSession, Project, ProjectEnvironmentTemplate, WorkspaceRecord } from '@shared/types'
import { canDeleteWorkspaceRecord } from '@shared/workspace-lifecycle'
import { canUserUseExecutorForProject, listVisibleExecutorsForUser } from '../../control-plane/collaboration'
import { getConversationDetail } from '../../control-plane/conversation-service'
import { countExecutorActiveTasks } from '../../control-plane/task-dispatch'
import { removeTaskChatQueueEntriesForWorkspace } from '../../control-plane/task-chat-service'
import { addUserProject, getUserById } from '../../repositories/auth'
import { createMainChatSession, ensureMainChatState, switchMainChatSession } from '../../routes/project-main-chat'
import { createProjectRecord, normalizeProjectEnvironmentTemplate, normalizeRecentBaseBranches } from '../../routes/project-route-shared'
import {
  detachWorkspaceIdsFromTask,
  getScopedWorkspaceForProject,
  getWorkspaceBranchSnapshot,
  listProjectWorkspacesForUser,
} from '../../routes/task-route-support'
import { listAgentChannelSummaries, sendAgentChannelMessage } from '../../services/agent-channel-service'
import { validateProjectExecutorPathAccess } from '../../services/project-executor-ownership'
import { searchSessions } from '../../services/session-search-service'
import { canUserManageProjectWorkspace, getProjectWorkspaceManagementDeniedMessage } from '../../services/project-workspace-management-access'
import { scheduleWorkspaceDeletionCleanup } from '../../services/workspace-deletion-cleanup-service'
import {
  deleteProject,
  deleteTaskWorkspaceBindings,
  deleteWorkspaceSessions,
  saveProject,
  saveStateMeta,
  saveTask,
} from '../../storage/app-state-store'
import {
  deactivateProjectBinding,
  deleteWorkspaces,
  getWorkspace,
  listProjectBindings,
  listWorkspaces,
  saveWorkspace,
  saveWorkspaceAndWait,
} from '../../storage/distributed-task-store'
import { ErrorCode, McpError, type McpServer } from './sdk'
import {
  listProjectsForMcpActor,
  requireProject,
  resolveMcpCreatorIdentity,
  summarizeConversation,
  summarizeProject,
  summarizeTask,
  toToolResult,
  type VibemuxMcpContext,
} from './vibemux-mcp-context'

export const sortWorkspacesForRuntimeAgent = <T extends Pick<WorkspaceRecord, 'createdBy'>>(
  workspaces: T[],
  runtimeAgentId?: string,
) => {
  const normalizedAgentId = runtimeAgentId?.trim()
  if (!normalizedAgentId) {
    return workspaces
  }

  const isOwnedByRuntimeAgent = (workspace: T) => (
    workspace.createdBy?.type === 'agent'
    && workspace.createdBy.id === normalizedAgentId
  )

  return [...workspaces].sort((left, right) => (
    Number(isOwnedByRuntimeAgent(right)) - Number(isOwnedByRuntimeAgent(left))
  ))
}

const projectUpdateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  color: z.string().trim().optional(),
  rootPath: z.string().trim().optional(),
  versionControl: z.enum(['none', 'git-local', 'git-remote']).optional(),
  gitUrl: z.string().trim().optional(),
  defaultBranch: z.string().trim().optional(),
  preferredExecutorId: z.string().trim().optional().nullable(),
  recentBaseBranches: z.array(z.string()).optional(),
  environmentTemplate: z.object({
    installCommand: z.string().trim().optional(),
    buildCommand: z.string().trim().optional(),
    testCommand: z.string().trim().optional(),
    lintCommand: z.string().trim().optional(),
    branchNamePattern: z.string().trim().optional(),
    startCommandTemplate: z.string().trim().optional(),
    stopCommandTemplate: z.string().trim().optional(),
    nukeCommandTemplate: z.string().trim().optional(),
    appPort: z.string().trim().optional(),
    healthPath: z.string().trim().optional(),
    logsCommandTemplate: z.string().trim().optional(),
    ports: z.array(z.object({
      id: z.string().trim().min(1),
      domain: z.string().trim().optional(),
      port: z.string().trim().min(1),
      note: z.string().trim().optional(),
      type: z.enum(['generated', 'custom']).optional(),
    })).optional(),
    configPath: z.string().trim().optional(),
    source: z.enum(['manual', 'vibemux-yml']).optional(),
    imported: z.object({
      installCommand: z.string().trim().optional(),
      buildCommand: z.string().trim().optional(),
      testCommand: z.string().trim().optional(),
      lintCommand: z.string().trim().optional(),
      branchNamePattern: z.string().trim().optional(),
      startCommandTemplate: z.string().trim().optional(),
      stopCommandTemplate: z.string().trim().optional(),
      nukeCommandTemplate: z.string().trim().optional(),
      appPort: z.string().trim().optional(),
      healthPath: z.string().trim().optional(),
      logsCommandTemplate: z.string().trim().optional(),
      ports: z.array(z.object({
        id: z.string().trim().min(1),
        domain: z.string().trim().optional(),
        port: z.string().trim().min(1),
        note: z.string().trim().optional(),
        type: z.enum(['generated', 'custom']).optional(),
      })).optional(),
      configPath: z.string().trim().optional(),
    }).optional(),
  }).nullable().optional(),
})

const projectSelectSchema = z.object({
  projectId: z.string().min(1),
})

const sessionSchema = z.object({
  sessionId: z.string().min(1),
})

const sessionRenameSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().trim().min(1).max(80),
})

const workspaceSchema = z.object({
  workspaceId: z.string().min(1),
})

const conversationListSchema = z.object({
  projectId: z.string().trim().optional(),
  taskId: z.string().trim().optional(),
})

const conversationSchema = z.object({
  conversationId: z.string().min(1),
})

const sessionSearchSchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().positive().max(50).optional(),
})

const channelSchema = z.object({
  agentId: z.string().trim().optional(),
  agentName: z.string().trim().optional(),
})

const channelSendSchema = channelSchema.extend({
  channel: z.enum(['auto', 'telegram', 'feishu', 'wechat', 'discord', 'slack', 'wecom', 'whatsapp', 'dingtalk']).default('auto'),
  message: z.string().trim().min(1),
  attachments: z.array(z.object({
    id: z.string().trim().min(1),
    url: z.string().trim().min(1),
    filename: z.string().trim().max(240).optional(),
    contentType: z.string().trim().max(120).optional(),
  })).max(5).optional(),
})

const summarizeExecutor = (executor: ReturnType<typeof listVisibleExecutorsForUser>[number]) => {
  const bindings = listProjectBindings().filter((binding) => binding.nodeId === executor.executorId)
  return {
    executorId: executor.executorId,
    name: executor.name,
    machineName: executor.machineName,
    status: executor.status,
    visibility: executor.visibility,
    teamId: executor.teamId,
    workspaceRoot: executor.workspaceRoot,
    maxConcurrency: executor.maxConcurrency,
    capabilities: executor.capabilities,
    labels: executor.labels,
    activeTaskCount: countExecutorActiveTasks(executor.executorId),
    bindingCount: bindings.length,
    projectIds: bindings.map((binding) => binding.projectId),
    createdAt: executor.createdAt,
    lastSeenAt: executor.lastSeenAt,
  }
}

const normalizeEnvironmentTemplateInput = (
  template?: z.infer<typeof projectUpdateSchema>['environmentTemplate'],
): ProjectEnvironmentTemplate | null | undefined => {
  if (template === undefined) {
    return undefined
  }

  if (template === null) {
    return null
  }

  return {
    ...template,
    source: template.source ?? 'manual',
  }
}

const findVisibleWorkspace = (ctx: VibemuxMcpContext, workspaceId: string) => {
  const state = ctx.getState()
  for (const project of state.projects) {
    const workspace = getScopedWorkspaceForProject(ctx.userId, project, workspaceId)
    if (workspace) {
      return { project, workspace }
    }
  }

  return null
}

const requireSession = (state: AppState, sessionId: string, userId: string) => {
  const mainState = ensureMainChatState(state, userId)
  const session = mainState.mainChatSessions.find((item) => item.id === sessionId)
  if (!session) {
    throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
  }

  return { mainState, session }
}

export const registerVibemuxMcpControlTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  server.registerTool('executor.list', {
    title: 'Executor List',
    description: '列出当前用户可见的执行节点',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
  }, async () => {
    return toToolResult({
      executors: listVisibleExecutorsForUser(ctx.userId).map(summarizeExecutor),
    })
  })

  server.registerTool('project.list', {
    title: 'Project List',
    description: '列出当前用户可访问的项目摘要',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
  }, async () => {
    const state = ctx.getState()
    return toToolResult({
      projects: listProjectsForMcpActor(ctx, state)
        .map((project) => summarizeProject(project, state.tasks.filter((task) => task.projectId === project.id))),
    })
  })

  server.registerTool('project.get', {
    title: 'Project Detail',
    description: '读取项目详情、任务和工作区',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
    },
  }, async ({ projectId }) => {
    const state = ctx.getState()
    const project = requireProject(state, projectId)
    return toToolResult({
      project: summarizeProject(project, state.tasks.filter((task) => task.projectId === project.id)),
      tasks: state.tasks.filter((task) => task.projectId === project.id).map((task) => summarizeTask(task, project)),
      workspaces: listProjectWorkspacesForUser(ctx.userId, project),
    })
  })

  server.registerTool('project.create', {
    title: 'Create Project',
    description: '创建项目',
    inputSchema: {
      name: z.string().min(1).describe('项目名称'),
      gitUrl: z.string().optional().describe('Git 仓库地址'),
      defaultBranch: z.string().optional().describe('默认分支'),
    },
  }, async ({ name, gitUrl, defaultBranch }) => {
    const state = ctx.getState()
    if (state.projects.some((project) => project.name === name.trim())) {
      throw new McpError(ErrorCode.InvalidParams, '项目已存在。')
    }
    const creator = getUserById(ctx.userId)
    const project = createProjectRecord({ name, gitUrl: gitUrl || '', defaultBranch }, creator ?? undefined)
    saveProject(project)
    addUserProject(ctx.userId, project.id, 'owner')
    saveStateMeta({
      ...state,
      selectedProjectId: project.id,
    })
    return toToolResult({ ok: true, project: summarizeProject(project, []) })
  })

  server.registerTool('project.update', {
    title: 'Update Project',
    description: '更新项目基础配置',
    inputSchema: projectUpdateSchema,
  }, async (input) => {
    const state = ctx.getState()
    const project = requireProject(state, input.projectId)
    const gitUrl = input.gitUrl !== undefined ? input.gitUrl.trim() : project.gitUrl
    const defaultBranch = input.defaultBranch?.trim() || project.defaultBranch || 'main'
    const preferredExecutorId = input.preferredExecutorId !== undefined ? input.preferredExecutorId?.trim() || undefined : project.preferredExecutorId
    if (preferredExecutorId) {
      const access = canUserUseExecutorForProject({ userId: ctx.userId, projectId: project.id, executorId: preferredExecutorId })
      if (!access.ok) {
        throw new McpError(ErrorCode.InvalidParams, access.message)
      }
    }

    const updated: Project = {
      ...project,
      name: input.name?.trim() || project.name,
      color: input.color !== undefined ? normalizeHexColor(input.color) ?? project.color ?? deriveProjectColor(input.name?.trim() || project.name) : project.color,
      rootPath: input.rootPath !== undefined ? input.rootPath.trim() || undefined : project.rootPath,
      versionControl: input.versionControl ?? project.versionControl ?? (gitUrl ? 'git-remote' : 'none'),
      gitUrl,
      defaultBranch,
      preferredExecutorId,
      recentBaseBranches: input.recentBaseBranches !== undefined
        ? normalizeRecentBaseBranches(input.recentBaseBranches, defaultBranch)
        : project.recentBaseBranches,
      environmentTemplate: input.environmentTemplate !== undefined
        ? normalizeProjectEnvironmentTemplate(normalizeEnvironmentTemplateInput(input.environmentTemplate))
        : project.environmentTemplate,
      updatedAt: new Date().toISOString(),
    }
    saveProject(updated)
    return toToolResult({ ok: true, project: summarizeProject(updated, state.tasks.filter((task) => task.projectId === updated.id)) })
  })

  server.registerTool('project.select', {
    title: 'Select Project',
    description: '切换当前选中项目',
    inputSchema: projectSelectSchema,
  }, async ({ projectId }) => {
    const state = ctx.getState()
    const project = requireProject(state, projectId)
    const firstTask = state.tasks.find((task) => task.projectId === project.id)
    saveStateMeta({
      ...state,
      selectedProjectId: project.id,
      selectedTaskId: firstTask?.id || '',
    })
    return toToolResult({ ok: true, projectId: project.id, projectName: project.name, selectedTaskId: firstTask?.id || null })
  })

  server.registerTool('project.delete', {
    title: 'Delete Project',
    description: '删除项目以及关联任务/工作区',
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
    },
  }, async ({ projectId }) => {
    const state = ctx.getState()
    const project = requireProject(state, projectId)
    const workspaceIds = listWorkspaces().filter((item) => item.projectId === projectId).map((item) => item.id)
    for (const binding of listProjectBindings().filter((item) => item.projectId === projectId)) {
      deactivateProjectBinding(binding.projectId, binding.nodeId)
    }
    if (workspaceIds.length > 0) {
      deleteWorkspaces(workspaceIds)
    }
    deleteProject(projectId)
    const projects = state.projects.filter((item) => item.id !== projectId)
    const tasks = state.tasks.filter((item) => item.projectId !== projectId)
    saveStateMeta({
      ...state,
      selectedProjectId: state.selectedProjectId === projectId ? projects[0]?.id ?? '' : state.selectedProjectId,
      selectedTaskId: tasks.some((task) => task.id === state.selectedTaskId) ? state.selectedTaskId : tasks[0]?.id ?? '',
    })
    return toToolResult({ ok: true, projectId: project.id, name: project.name })
  })

  server.registerTool('session.list', {
    title: 'Session List',
    description: '列出主对话会话',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
  }, async () => {
    const state = ensureMainChatState(ctx.getState(), ctx.userId)
    return toToolResult({
      sessions: state.mainChatSessions.map((session) => ({
        id: session.id,
        title: session.title,
        executorId: session.executorId,
        messageCount: session.messageCount ?? session.messages?.length ?? 0,
        selected: session.id === state.selectedMainChatSessionId,
        updatedAt: session.updatedAt,
      })),
    })
  })

  server.registerTool('session.get', {
    title: 'Session Detail',
    description: '读取单个主对话会话',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: sessionSchema,
  }, async ({ sessionId }) => {
    const { mainState, session } = requireSession(ctx.getState(), sessionId, ctx.userId)
    return toToolResult({
      session,
      selected: session.id === mainState.selectedMainChatSessionId,
    })
  })

  server.registerTool('session.create', {
    title: 'Create Session',
    description: '新建主对话会话',
    inputSchema: {
      title: z.string().optional().describe('会话标题'),
    },
  }, async ({ title }) => {
    const state = ensureMainChatState(ctx.getState(), ctx.userId)
    const session = createMainChatSession(title?.trim() || '新会话')
    saveStateMeta({
      ...state,
      mainChatSessions: [session, ...state.mainChatSessions],
      selectedMainChatSessionId: session.id,
    })
    return toToolResult({ ok: true, session })
  })

  server.registerTool('session.select', {
    title: 'Select Session',
    description: '切换主对话会话',
    inputSchema: sessionSchema,
  }, async ({ sessionId }) => {
    const nextState = switchMainChatSession(ensureMainChatState(ctx.getState(), ctx.userId), sessionId)
    if (!nextState.mainChatSessions.some((item) => item.id === sessionId)) {
      throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
    }
    saveStateMeta(nextState)
    const session = nextState.mainChatSessions.find((item) => item.id === sessionId)!
    return toToolResult({ ok: true, sessionId: session.id, title: session.title })
  })

  server.registerTool('session.rename', {
    title: 'Rename Session',
    description: '重命名主对话会话',
    inputSchema: sessionRenameSchema,
  }, async ({ sessionId, title }) => {
    const state = ensureMainChatState(ctx.getState(), ctx.userId)
    const session = state.mainChatSessions.find((item) => item.id === sessionId)
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
    }
    const nextSessions = state.mainChatSessions.map((item) => (
      item.id === sessionId
        ? { ...item, title: title.trim(), updatedAt: new Date().toISOString() } satisfies MainChatSession
        : item
    ))
    saveStateMeta({
      ...state,
      mainChatSessions: nextSessions,
    })
    return toToolResult({ ok: true, sessionId, title: title.trim() })
  })

  server.registerTool('session.delete', {
    title: 'Delete Session',
    description: '删除主对话会话',
    inputSchema: sessionSchema,
  }, async ({ sessionId }) => {
    const state = ensureMainChatState(ctx.getState(), ctx.userId)
    if (state.mainChatSessions.length <= 1) {
      throw new McpError(ErrorCode.InvalidParams, '至少需要保留一个会话。')
    }
    const session = state.mainChatSessions.find((item) => item.id === sessionId)
    if (!session) {
      throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
    }
    const nextSessions = state.mainChatSessions.filter((item) => item.id !== sessionId)
    const nextSelectedId = sessionId === state.selectedMainChatSessionId
      ? nextSessions[0]?.id ?? ''
      : state.selectedMainChatSessionId
    const activeSession = nextSessions.find((item) => item.id === nextSelectedId) ?? nextSessions[0]
    saveStateMeta({
      ...state,
      mainChatSessions: nextSessions,
      selectedMainChatSessionId: nextSelectedId,
    })
    return toToolResult({ ok: true, sessionId, title: session.title })
  })

  server.registerTool('workspace.list', {
    title: 'Workspace List',
    description: '列出当前用户可访问的工作区，可按项目过滤',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      projectId: z.string().min(1).optional().describe('可选，项目 ID'),
    },
  }, async ({ projectId }) => {
    const state = ctx.getState()
    const projects = projectId
      ? [requireProject(state, projectId)]
      : state.projects
    const workspaces = projects.flatMap((project) => listProjectWorkspacesForUser(ctx.userId, project))
    return toToolResult({
      projectId: projectId ?? null,
      workspaces: sortWorkspacesForRuntimeAgent(workspaces, ctx.runtimeAgentId),
    })
  })

  server.registerTool('workspace.get', {
    title: 'Workspace Detail',
    description: '读取工作区详情',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: workspaceSchema,
  }, async ({ workspaceId }) => {
    const match = findVisibleWorkspace(ctx, workspaceId)
    if (!match) {
      throw new McpError(ErrorCode.InvalidParams, '工作区不存在或无权访问。')
    }
    return toToolResult({
      workspace: match.workspace,
      project: summarizeProject(match.project, ctx.getState().tasks.filter((task) => task.projectId === match.project.id)),
    })
  })

  server.registerTool('workspace.create', {
    title: 'Create Workspace',
    description: '创建受管工作区。name 是人可见的工作目标名称；由调用 Agent 根据任务与自身上下文自行命名。',
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
      executorNodeId: z.string().min(1).optional().describe('可选，执行节点 ID；未提供时使用模型设置中的默认节点'),
      agentType: z.enum(['Pi', 'OpenCode', 'Codex', 'ClaudeCode']).optional().describe('可选，Coding Agent；未提供时使用模型设置中的默认 Agent'),
      name: z.string().min(1).describe('工作区对人可见的业务名称。请简洁描述工作目标；不要添加 Agent 身份前缀、任务 ID 或本地路径。'),
    },
  }, async ({ projectId, executorNodeId, agentType, name }) => {
    const state = ctx.getState()
    const project = requireProject(state, projectId)
    const resolvedExecutorNodeId = executorNodeId?.trim() || state.config.workspaceExecutionDefaults.executorNodeId
    if (!resolvedExecutorNodeId) {
      throw new McpError(ErrorCode.InvalidParams, '未设置执行节点，请先在模型设置中保存默认工作区执行配置。')
    }
    const resolvedAgentType = agentType ?? state.config.workspaceExecutionDefaults.agentType ?? DEFAULT_AGENT_TYPE
    const access = canUserUseExecutorForProject({ userId: ctx.userId, projectId, executorId: resolvedExecutorNodeId })
    if (!access.ok) {
      throw new McpError(ErrorCode.InvalidParams, access.message)
    }
    const pathAccess = validateProjectExecutorPathAccess({
      project,
      executorId: resolvedExecutorNodeId,
      bindings: listProjectBindings(),
      executors: listVisibleExecutorsForUser(ctx.userId),
    })
    if (!pathAccess.ok) {
      throw new McpError(ErrorCode.InvalidParams, pathAccess.message)
    }
    const timestamp = new Date().toISOString()
    const workingDirectoryMode = project.versionControl === 'none' ? 'original-dir' : 'worktree'
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      projectId: project.id,
      createdBy: resolveMcpCreatorIdentity(ctx),
      executorNodeId: resolvedExecutorNodeId,
      agentType: resolvedAgentType,
      name: name.trim(),
      status: 'pending_repo',
      repoReady: false,
      repoPath: undefined,
      worktreeRootPath: undefined,
      source: 'manual',
      workingDirectoryMode,
      defaultBranch: project.defaultBranch,
      suggestedBaseBranch: project.recentBaseBranches?.[0] || project.defaultBranch,
      ownerUserId: ctx.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await saveWorkspaceAndWait(workspace)
    return toToolResult({
      ok: true,
      workspace: listProjectWorkspacesForUser(ctx.userId, project).find((item) => item.id === workspace.id) ?? workspace,
    })
  })

  server.registerTool('workspace.update', {
    title: 'Update Workspace',
    description: '更新工作区名称或执行节点',
    inputSchema: {
      workspaceId: z.string().min(1).describe('工作区 ID'),
      name: z.string().min(1).describe('新名称'),
      executorNodeId: z.string().min(1).optional().describe('新的执行节点 ID'),
    },
  }, async ({ workspaceId, name, executorNodeId }) => {
    const state = ctx.getState()
    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      throw new McpError(ErrorCode.InvalidParams, '工作区不存在。')
    }
    const project = requireProject(state, workspace.projectId)
    const nextExecutorId = executorNodeId?.trim() || workspace.executorNodeId
    const access = canUserUseExecutorForProject({ userId: ctx.userId, projectId: project.id, executorId: nextExecutorId })
    if (!access.ok) {
      throw new McpError(ErrorCode.InvalidParams, access.message)
    }
    const pathAccess = validateProjectExecutorPathAccess({
      project,
      executorId: nextExecutorId,
      bindings: listProjectBindings(),
      executors: listVisibleExecutorsForUser(ctx.userId),
    })
    if (!pathAccess.ok) {
      throw new McpError(ErrorCode.InvalidParams, pathAccess.message)
    }
    const repoPath = listProjectBindings()
      .find((binding) => binding.projectId === project.id && binding.nodeId === nextExecutorId && binding.isActive)
      ?.pathHint?.trim() || undefined
    const nextWorkspace: WorkspaceRecord = {
      ...workspace,
      name: name.trim(),
      executorNodeId: nextExecutorId,
      repoPath,
      repoReady: Boolean(repoPath),
      status: repoPath ? 'ready' : 'pending_repo',
      updatedAt: new Date().toISOString(),
    }
    saveWorkspace(nextWorkspace)
    return toToolResult({ ok: true, workspace: listProjectWorkspacesForUser(ctx.userId, project).find((item) => item.id === nextWorkspace.id) ?? nextWorkspace })
  })

  server.registerTool('workspace.branches', {
    title: 'Workspace Branches',
    description: '读取工作区当前可用分支',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: workspaceSchema,
  }, async ({ workspaceId }) => {
    const match = findVisibleWorkspace(ctx, workspaceId)
    if (!match) {
      throw new McpError(ErrorCode.InvalidParams, '工作区不存在或无权访问。')
    }
    return toToolResult(await getWorkspaceBranchSnapshot(ctx.userId, match.project, match.workspace))
  })

  server.registerTool('workspace.delete', {
    title: 'Delete Workspace',
    description: '删除工作区并清理关联会话',
    inputSchema: workspaceSchema,
  }, async ({ workspaceId }) => {
    const state = ctx.getState()
    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      throw new McpError(ErrorCode.InvalidParams, '工作区不存在。')
    }
    const project = requireProject(state, workspace.projectId)
    const scopedWorkspace = getScopedWorkspaceForProject(ctx.userId, project, workspaceId)
    if (!scopedWorkspace) {
      throw new McpError(ErrorCode.InvalidParams, '工作区不存在或无权访问。')
    }
    if (!canDeleteWorkspaceRecord(workspace)) {
      throw new McpError(ErrorCode.InvalidParams, '绑定生成的工作区不支持单独删除。')
    }
    if (!(await canUserManageProjectWorkspace({ userId: ctx.userId, project, workspace }))) {
      throw new McpError(ErrorCode.InvalidParams, getProjectWorkspaceManagementDeniedMessage('delete'))
    }

    const workspaceSessions = state.workspaceSessions.filter((session) => session.workspaceId === workspaceId)
    const timestamp = new Date().toISOString()
    const workspaceIdSet = new Set([workspaceId])
    const nextTasks = state.tasks.map((task) => detachWorkspaceIdsFromTask(task, workspaceIdSet, timestamp))
    nextTasks.forEach((task, index) => {
      if (task !== state.tasks[index]) {
        saveTask(task)
      }
    })
    deleteTaskWorkspaceBindings({ workspaceIds: [workspaceId] })
    deleteWorkspaceSessions({ workspaceIds: [workspaceId] })
    // 工作区删除是最高优先级：连同全部会话的排队消息一起清空，避免遗留队列指向已删除会话。
    await removeTaskChatQueueEntriesForWorkspace({ workspaceId })
    deleteWorkspaces([workspaceId])
    scheduleWorkspaceDeletionCleanup({
      state,
      project,
      workspace,
      workspaceSessions,
      userId: ctx.userId,
    })
    return toToolResult({
      ok: true,
      workspaceId,
      name: workspace.name,
      detail: '节点清理指令已下发，后台会继续清理相关运行资源、本地目录与分支。',
    })
  })

  server.registerTool('conversation.list', {
    title: 'Conversation List',
    description: '列出可访问的统一会话',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: conversationListSchema,
  }, async ({ projectId, taskId }) => {
    const conversations = ctx.getConversations()
      .filter((item) => !projectId || item.conversation.projectId === projectId)
      .filter((item) => !taskId || item.conversation.taskId === taskId)
    return toToolResult({
      conversations: conversations.map(summarizeConversation),
    })
  })

  server.registerTool('conversation.get', {
    title: 'Conversation Detail',
    description: '读取统一会话详情',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: conversationSchema,
  }, async ({ conversationId }) => {
    const visible = ctx.getConversations().some((item) => item.conversation.id === conversationId)
    if (!visible) {
      throw new McpError(ErrorCode.InvalidParams, '会话不存在或无权访问。')
    }
    const detail = getConversationDetail(conversationId)
    if (!detail) {
      throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
    }
    return toToolResult(detail)
  })

  server.registerTool('session.search', {
    title: 'Search Sessions',
    description: '按关键词搜索可访问的会话及命中的消息片段',
    inputSchema: sessionSearchSchema,
  }, async ({ query, limit }) => {
    const hits = await searchSessions({
      query,
      viewer: { type: 'user', id: ctx.userId },
      limit,
    })
    return toToolResult({
      hits: hits.map((hit) => ({
        conversation: {
          id: hit.conversation.id,
          title: hit.conversation.title,
          kind: hit.conversation.kind,
          visibility: hit.conversation.visibility,
          workspaceId: hit.conversation.workspaceId,
          updatedAt: hit.conversation.updatedAt,
        },
        matchedMessages: hit.matchedMessages.map((message) => ({
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
      })),
    })
  })

  server.registerTool('channel.list', {
    title: 'Agent Channel List',
    description: '读取某个 Agent 当前可用的外部渠道配置摘要',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: channelSchema,
  }, async ({ agentId, agentName }) => {
    const summary = listAgentChannelSummaries({ userId: ctx.userId, agentId, agentName })
    if (!summary) {
      throw new McpError(ErrorCode.InvalidParams, 'Agent 不存在。')
    }

    return toToolResult(summary)
  })

  server.registerTool('channel.send', {
    title: 'Send Agent Channel Message',
    description: '通过指定 Agent 的 Telegram、飞书或微信渠道发送消息；微信支持携带附件（图片自动走 CDN 上传，其他按文件发送）',
    inputSchema: channelSendSchema,
  }, async ({ agentId, agentName, channel, message, attachments }) => {
    const result = await sendAgentChannelMessage({
      userId: ctx.userId,
      agentId,
      agentName,
      channel,
      message,
      attachments: attachments?.map((attachment) => ({
        ...attachment,
        filename: attachment.filename?.trim() || attachment.url.split('/').pop()?.split('?')[0] || 'attachment.bin',
      })),
    })

    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message || '渠道消息发送失败。')
    }

    return toToolResult({
      ok: true,
      agent: result.agent,
      channel: result.channel,
      message: '消息已发送。',
    })
  })

}
