// [INPUT]: Authenticated MCP scope, persisted users/Agents, app state, and conversation snapshots.
// [OUTPUT]: MCP context helpers, actor-aware creator identity, resource summaries, and JSON tool results.
// [POS]: Shared server MCP adapter boundary used by all Wemux product tools.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { readCustomAgentConfig } from '@shared/custom-agent'
import type { AgentRecord, AppState, CreatorIdentity, Project, Task, TaskRun } from '@shared/types'
import type { ConversationListItem } from '../../control-plane/conversation-service'
import { getAgent } from '../../repositories/agent'
import { getUserById } from '../../repositories/auth'
import { resolveCustomAgentProjectAccess } from '../../services/task-agent-assignment-service'
import { ErrorCode, McpError } from './sdk'

export const JSON_MIME_TYPE = 'application/json'

export type WemuxMcpContext = {
  userId: string
  runtimeAgentId?: string
  getState: () => AppState
  getConversations: () => ConversationListItem[]
}

type CreatorIdentityLookups = {
  getAgentById: (agentId: string) => Pick<AgentRecord, 'id' | 'name' | 'ownerUserId' | 'config'> | null
  getUserById: (userId: string) => { id: string; name: string; avatarUrl?: string } | null
}

export const resolveMcpCreatorIdentity = (
  ctx: Pick<WemuxMcpContext, 'runtimeAgentId' | 'userId'>,
  lookups: CreatorIdentityLookups = { getAgentById: getAgent, getUserById },
): CreatorIdentity => {
  const runtimeAgentId = ctx.runtimeAgentId?.trim()
  if (runtimeAgentId) {
    const agent = lookups.getAgentById(runtimeAgentId)
    if (!agent || (agent.ownerUserId && agent.ownerUserId !== ctx.userId)) {
      throw new McpError(ErrorCode.InvalidParams, '创建任务或工作区的 Agent 不存在或无权使用。')
    }
    const profile = readCustomAgentConfig(agent.config)
    return {
      type: 'agent',
      id: agent.id,
      name: agent.name.trim() || agent.id,
      avatarUrl: profile.avatarUrl.trim() || undefined,
    }
  }

  const user = lookups.getUserById(ctx.userId)
  if (!user) {
    throw new McpError(ErrorCode.InvalidParams, '创建任务或工作区的用户不存在。')
  }
  return {
    type: 'user',
    id: user.id,
    name: user.name.trim() || user.id,
    avatarUrl: user.avatarUrl?.trim() || undefined,
  }
}

export const toJsonResource = (uri: URL, payload: unknown) => ({
  contents: [
    {
      uri: uri.toString(),
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(payload, null, 2),
    },
  ],
})

export const toToolResult = (payload: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    },
  ],
})

export const readEntityId = (uri: URL) => uri.pathname.replace(/^\/+/, '').trim()

export const countTasksByStatus = (tasks: Task[]) => ({
  backlog: tasks.filter((task) => task.status === 'backlog').length,
  todo: tasks.filter((task) => task.status === 'todo').length,
  inProgress: tasks.filter((task) => task.status === 'in_progress').length,
  inReview: tasks.filter((task) => task.status === 'in_review').length,
  done: tasks.filter((task) => task.status === 'done').length,
  blocked: tasks.filter((task) => task.status === 'blocked').length,
  cancelled: tasks.filter((task) => task.status === 'cancelled').length,
})

export const summarizeProject = (project: Project, tasks: Task[]) => ({
  id: project.id,
  name: project.name,
  color: project.color,
  rootPath: project.rootPath,
  versionControl: project.versionControl,
  gitUrl: project.gitUrl,
  defaultBranch: project.defaultBranch,
  preferredExecutorId: project.preferredExecutorId,
  recentBaseBranches: project.recentBaseBranches,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  taskCount: tasks.length,
  taskStatus: countTasksByStatus(tasks),
})

export const summarizeTask = (task: Task, project?: Project | null) => ({
  id: task.id,
  projectId: task.projectId,
  projectName: project?.name,
  parentTaskId: task.parentTaskId,
  createdBy: task.createdBy,
  title: task.title,
  description: task.description,
  acceptanceCriteria: task.acceptanceCriteria,
  requirementType: task.requirementType,
  status: task.status,
  assigneeId: task.assigneeId,
  assigneeAgentId: task.assigneeAgentId,
  assigneeAgentGroupId: task.assigneeAgentGroupId,
  agentManaged: task.agentManaged,
  agentType: task.agentType,
  executionModel: task.executionModel,
  executionMode: task.executionMode,
  baseBranch: task.baseBranch,
  baseBranchHint: task.baseBranchHint,
  needsHumanConfirm: task.needsHumanConfirm,
  agentRunningStatus: task.agentRunningStatus,
  currentStep: task.currentStep,
  retryCount: task.retryCount,
  attachments: task.attachments,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
})

export const summarizeTaskRun = (taskRun: TaskRun) => ({
  id: taskRun.id,
  taskId: taskRun.taskId,
  projectId: taskRun.projectId,
  distributedTaskId: taskRun.distributedTaskId,
  workspaceId: taskRun.workspaceId,
  workspaceSessionId: taskRun.workspaceSessionId,
  executorNodeId: taskRun.executorNodeId,
  baseBranch: taskRun.baseBranch,
  returnMode: taskRun.returnMode,
  gitIdentityMode: taskRun.gitIdentityMode,
  agentSessionId: taskRun.agentSessionId,
  opencodeSessionId: taskRun.opencodeSessionId,
  status: taskRun.status,
  summary: taskRun.summary,
  result: taskRun.result,
  createdAt: taskRun.createdAt,
  updatedAt: taskRun.updatedAt,
})

export const summarizeConversation = (item: ConversationListItem) => ({
  id: item.conversation.id,
  title: item.conversation.title,
  kind: item.conversation.kind,
  status: item.conversation.status,
  externalSyncMode: item.conversation.externalSyncMode,
  projectId: item.conversation.projectId,
  taskId: item.conversation.taskId,
  workspaceId: item.conversation.workspaceId,
  createdAt: item.conversation.createdAt,
  updatedAt: item.conversation.updatedAt,
  messageCount: item.messageCount,
  latestMessage: item.latestMessage
    ? {
        role: item.latestMessage.role,
        content: item.latestMessage.content,
        createdAt: item.latestMessage.createdAt,
      }
    : undefined,
  channelBindings: item.channelBindings,
})

export const requireProject = (state: AppState, projectId: string) => {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) {
    throw new McpError(ErrorCode.InvalidParams, '项目不存在。')
  }

  return project
}

export const listProjectsForMcpActor = (
  ctx: Pick<WemuxMcpContext, 'runtimeAgentId' | 'userId'>,
  state: AppState,
) => {
  const runtimeAgentId = ctx.runtimeAgentId?.trim()
  if (!runtimeAgentId) return state.projects

  const agent = getAgent(runtimeAgentId)
  if (!agent) {
    throw new McpError(ErrorCode.InvalidParams, '当前运行 Agent 不存在。')
  }

  return state.projects.filter((project) => resolveCustomAgentProjectAccess({
    agent,
    userId: ctx.userId,
    projectId: project.id,
    collaborationWorkspaceId: project.workspaceId,
    mode: 'delegate',
  }).ok)
}

export const requireProjectForMcpActor = (
  ctx: Pick<WemuxMcpContext, 'runtimeAgentId' | 'userId'>,
  state: AppState,
  projectId: string,
) => {
  const project = requireProject(state, projectId)
  if (!ctx.runtimeAgentId?.trim()) return project

  if (!listProjectsForMcpActor(ctx, state).some((item) => item.id === project.id)) {
    throw new McpError(ErrorCode.InvalidParams, '当前 Agent 未开放给这个项目或组织。')
  }
  return project
}

export const requireTask = (state: AppState, taskId: string) => {
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) {
    throw new McpError(ErrorCode.InvalidParams, '任务不存在。')
  }

  return task
}

export const requireConversation = (conversations: ConversationListItem[], conversationId: string) => {
  const conversation = conversations.find((item) => item.conversation.id === conversationId)
  if (!conversation) {
    throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
  }

  return conversation
}
