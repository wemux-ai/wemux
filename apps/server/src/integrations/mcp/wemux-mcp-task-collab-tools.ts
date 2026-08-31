// [INPUT]: Authenticated task-collaboration MCP calls and runtime Agent identity.
// [OUTPUT]: Agent-attributed subtask creation plus task chat, model, and Agent collaboration tools.
// [POS]: MCP adapter over task-collaboration services; creator identity comes from trusted runtime context.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { z } from 'zod'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import type { Task } from '@shared/types'
import { ErrorCode, McpError, type McpServer } from './sdk'
import {
  requireTask,
  resolveMcpCreatorIdentity,
  summarizeTask,
  toToolResult,
  type WemuxMcpContext,
} from './wemux-mcp-context'
import {
  createSubtaskForUser,
  getTaskChatSessionSnapshotForUser,
  listTaskChatSessionsForUser,
  sendTaskChatMessageForUser,
  updateTaskAgentForUser,
  updateTaskModelForUser,
} from '../../services/task-collaboration-service'
import { SERVER_AGENT_TYPES } from '../../services/server-agent'

const serverAgentTypeSchema = z.enum(SERVER_AGENT_TYPES)

const taskSubtaskSchema = z.object({
  parentTaskId: z.string().min(1),
  description: z.string().min(1),
  title: z.string().trim().optional(),
  agentManaged: z.enum(['ai', 'none']).optional(),
  agentType: serverAgentTypeSchema.optional(),
  executionModel: z.string().trim().optional(),
  acceptanceCriteria: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
})

const taskChatSessionScopeSchema = z.object({
  taskId: z.string().min(1),
  workspaceId: z.string().trim().optional(),
  workspaceSessionId: z.string().trim().optional(),
})

const taskChatSessionGetSchema = taskChatSessionScopeSchema.extend({
  recentTurns: z.number().int().min(1).max(20).optional(),
})

const taskSendSchema = taskChatSessionScopeSchema.extend({
  message: z.string().min(1),
})

const taskModelUpdateSchema = taskChatSessionScopeSchema.extend({
  executionModel: z.string().trim().optional(),
  executorNodeId: z.string().trim().optional(),
})

const taskAgentUpdateSchema = taskChatSessionScopeSchema.extend({
  agentType: serverAgentTypeSchema,
  executorNodeId: z.string().trim().optional(),
})

export const registerWemuxMcpTaskCollabTools = (server: McpServer, ctx: WemuxMcpContext) => {
  server.registerTool('task.create_subtask', {
    title: 'Create Task Subtask',
    description: '从父任务拆分并创建一个子任务',
    inputSchema: taskSubtaskSchema,
  }, async (input) => {
    const result = await createSubtaskForUser({
      userId: ctx.userId,
      createdBy: resolveMcpCreatorIdentity(ctx),
      ...input,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    return toToolResult({
      ok: true,
      task: summarizeTask(result.task),
      inheritedWorkspaceCount: result.inheritedWorkspaceCount,
    })
  })

  server.registerTool('task.chat_session.list', {
    title: 'Task Chat Session List',
    description: '列出任务在各工作区下的会话',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      taskId: z.string().min(1).describe('任务 ID'),
      workspaceId: z.string().trim().optional().describe('可选，工作区 ID'),
    },
  }, async ({ taskId, workspaceId }) => {
    requireTask(ctx.getState(), taskId)
    const result = listTaskChatSessionsForUser({
      userId: ctx.userId,
      taskId,
      workspaceId,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    return toToolResult({
      taskId,
      workspaceId: workspaceId || null,
      sessions: result.sessions,
    })
  })

  server.registerTool('task.chat_session.get', {
    title: 'Task Chat Session Detail',
    description: '读取任务或某个工作区会话的聊天快照与消息',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: taskChatSessionGetSchema,
  }, async ({ taskId, workspaceId, workspaceSessionId, recentTurns }) => {
    requireTask(ctx.getState(), taskId)
    const result = getTaskChatSessionSnapshotForUser({
      userId: ctx.userId,
      taskId,
      workspaceId,
      workspaceSessionId,
      recentTurns: recentTurns ?? 6,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    return toToolResult({
      taskId,
      workspaceId: workspaceId || null,
      workspaceSessionId: workspaceSessionId || null,
      recentTurns: recentTurns ?? 6,
      snapshot: result.snapshot,
      conversation: result.conversation,
    })
  })

  server.registerTool('task.send', {
    title: 'Send Task Message',
    description: '继续给任务或指定工作区会话发送下一条消息',
    inputSchema: taskSendSchema,
  }, async ({ taskId, workspaceId, workspaceSessionId, message }) => {
    requireTask(ctx.getState(), taskId)
    const result = await sendTaskChatMessageForUser({
      userId: ctx.userId,
      taskId,
      workspaceId,
      workspaceSessionId,
      message,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    return toToolResult({
      ok: true,
      queued: result.queued,
      message: result.message,
      result: result.result,
      snapshot: result.snapshot,
    })
  })

  server.registerTool('task.model.update', {
    title: 'Update Task Model',
    description: '更新任务或指定工作区会话的模型',
    inputSchema: taskModelUpdateSchema,
  }, async ({ taskId, workspaceId, workspaceSessionId, executionModel, executorNodeId }) => {
    requireTask(ctx.getState(), taskId)
    const result = await updateTaskModelForUser({
      userId: ctx.userId,
      taskId,
      workspaceId,
      workspaceSessionId,
      executionModel,
      executorNodeId,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    return toToolResult({
      ok: true,
      message: result.message,
      task: summarizeTask(result.task),
      session: result.session,
    })
  })

  server.registerTool('task.agent.update', {
    title: 'Update Task Agent',
    description: '更新任务或指定工作区会话的执行端',
    inputSchema: taskAgentUpdateSchema,
  }, async ({ taskId, workspaceId, workspaceSessionId, agentType, executorNodeId }) => {
    requireTask(ctx.getState(), taskId)
    const result = await updateTaskAgentForUser({
      userId: ctx.userId,
      taskId,
      workspaceId,
      workspaceSessionId,
      agentType: agentType as Task['agentType'],
      executorNodeId,
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }

    return toToolResult({
      ok: true,
      message: result.message,
      task: summarizeTask(result.task),
      session: result.session,
    })
  })
}
