import { listVisibleExecutorsForUser } from '../../control-plane/collaboration'
import { getConversationDetail } from '../../control-plane/conversation-service'
import { listProjectWorkspacesForUser } from '../../routes/task-route-support'
import { ErrorCode, McpError, ResourceTemplate, type McpServer } from './sdk'
import {
  JSON_MIME_TYPE,
  readEntityId,
  requireConversation,
  requireProject,
  requireTask,
  summarizeConversation,
  summarizeProject,
  summarizeTask,
  toJsonResource,
  type VibemuxMcpContext,
} from './vibemux-mcp-context'

const summarizeExecutor = (ctx: VibemuxMcpContext, executor: ReturnType<typeof listVisibleExecutorsForUser>[number]) => ({
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
  activeProjectIds: ctx.getState().projects
    .filter((project) => project.preferredExecutorId === executor.executorId)
    .map((project) => project.id),
  createdAt: executor.createdAt,
  lastSeenAt: executor.lastSeenAt,
})

const listVisibleWorkspaces = (ctx: VibemuxMcpContext) => {
  const state = ctx.getState()
  return state.projects.flatMap((project) => listProjectWorkspacesForUser(ctx.userId, project))
}

export const registerVibemuxMcpResources = (server: McpServer, ctx: VibemuxMcpContext, ResourceTemplateCtor: typeof ResourceTemplate) => {
  server.registerResource('workspace-overview', 'vibemux://overview', {
    title: 'Workspace Overview',
    description: '当前用户可见的项目、任务和会话总览',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const state = ctx.getState()
    const conversations = ctx.getConversations()
    return toJsonResource(uri, {
      generatedAt: new Date().toISOString(),
      projects: state.projects.length,
      tasks: state.tasks.length,
      conversations: conversations.length,
      selectedProjectId: state.selectedProjectId,
      selectedTaskId: state.selectedTaskId,
      selectedMainChatSessionId: state.selectedMainChatSessionId,
    })
  })

  server.registerResource('projects', 'vibemux://projects', {
    title: 'Projects',
    description: '当前用户可访问的项目列表',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const state = ctx.getState()
    return toJsonResource(uri, {
      projects: state.projects.map((project) => summarizeProject(project, state.tasks.filter((task) => task.projectId === project.id))),
    })
  })

  server.registerResource('tasks', 'vibemux://tasks', {
    title: 'Tasks',
    description: '当前用户可访问的任务列表',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const state = ctx.getState()
    return toJsonResource(uri, {
      tasks: state.tasks.map((task) => summarizeTask(task, state.projects.find((project) => project.id === task.projectId))),
    })
  })

  server.registerResource('conversations', 'vibemux://conversations', {
    title: 'Conversations',
    description: '当前用户可访问的统一会话列表',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    return toJsonResource(uri, {
      conversations: ctx.getConversations().map(summarizeConversation),
    })
  })

  server.registerResource('executors', 'vibemux://executors', {
    title: 'Executors',
    description: '当前用户可见的执行节点列表',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    return toJsonResource(uri, {
      executors: listVisibleExecutorsForUser(ctx.userId).map((executor) => summarizeExecutor(ctx, executor)),
    })
  })

  server.registerResource('project-detail', new ResourceTemplateCtor('vibemux://projects/{projectId}', {
    list: async () => {
      const state = ctx.getState()
      return {
        resources: state.projects.map((project) => ({
          uri: `vibemux://projects/${project.id}`,
          name: project.name,
          title: project.name,
          mimeType: JSON_MIME_TYPE,
          description: `项目 ${project.name} 的详情`,
        })),
      }
    },
  }), {
    title: 'Project Detail',
    description: '按项目读取详情',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const state = ctx.getState()
    const project = requireProject(state, readEntityId(uri))
    const projectTasks = state.tasks.filter((task) => task.projectId === project.id)
    const workspaces = listProjectWorkspacesForUser(ctx.userId, project)
    return toJsonResource(uri, {
      project,
      tasks: projectTasks.map((task) => summarizeTask(task, project)),
      workspaces,
    })
  })

  server.registerResource('task-detail', new ResourceTemplateCtor('vibemux://tasks/{taskId}', {
    list: async () => {
      const state = ctx.getState()
      return {
        resources: state.tasks.map((task) => ({
          uri: `vibemux://tasks/${task.id}`,
          name: task.title,
          title: task.title,
          mimeType: JSON_MIME_TYPE,
          description: `任务 ${task.title} 的详情`,
        })),
      }
    },
  }), {
    title: 'Task Detail',
    description: '按任务读取详情',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const state = ctx.getState()
    const conversations = ctx.getConversations()
    const task = requireTask(state, readEntityId(uri))
    const project = requireProject(state, task.projectId)
    const taskConversation = conversations.find((item) => item.conversation.taskId === task.id)
    return toJsonResource(uri, {
      task,
      project: summarizeProject(project, state.tasks.filter((item) => item.projectId === project.id)),
      workspaces: listProjectWorkspacesForUser(ctx.userId, project),
      conversation: taskConversation ? summarizeConversation(taskConversation) : null,
    })
  })

  server.registerResource('workspace-detail', new ResourceTemplateCtor('vibemux://workspaces/{workspaceId}', {
    list: async () => {
      const workspaces = listVisibleWorkspaces(ctx)
      return {
        resources: workspaces.map((workspace) => ({
          uri: `vibemux://workspaces/${workspace.id}`,
          name: workspace.name,
          title: workspace.name,
          mimeType: JSON_MIME_TYPE,
          description: `工作区 ${workspace.name} 的详情`,
        })),
      }
    },
  }), {
    title: 'Workspace Detail',
    description: '按工作区读取详情',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const workspaceId = readEntityId(uri)
    const workspace = listVisibleWorkspaces(ctx).find((item) => item.id === workspaceId)
    if (!workspace) {
      throw new McpError(ErrorCode.InvalidParams, '工作区不存在。')
    }

    return toJsonResource(uri, {
      workspace,
    })
  })

  server.registerResource('conversation-detail', new ResourceTemplateCtor('vibemux://conversations/{conversationId}', {
    list: async () => {
      const conversations = ctx.getConversations()
      return {
        resources: conversations.map((item) => ({
          uri: `vibemux://conversations/${item.conversation.id}`,
          name: item.conversation.title,
          title: item.conversation.title,
          mimeType: JSON_MIME_TYPE,
          description: `${item.conversation.kind} 会话详情`,
        })),
      }
    },
  }), {
    title: 'Conversation Detail',
    description: '按会话读取消息和绑定详情',
    mimeType: JSON_MIME_TYPE,
  }, async (uri) => {
    const conversations = ctx.getConversations()
    const conversationId = readEntityId(uri)
    requireConversation(conversations, conversationId)
    const detail = getConversationDetail(conversationId)
    if (!detail) {
      throw new McpError(ErrorCode.InvalidParams, '会话不存在。')
    }
    return toJsonResource(uri, detail)
  })
}
