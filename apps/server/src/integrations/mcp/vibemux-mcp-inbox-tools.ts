// [INPUT]: 已鉴权 MCP 上下文（用户身份）+ inbox 工具调用参数。
// [OUTPUT]: 用户收件箱的查询、已读与回复工具。
// [POS]: 用户视角 inbox MCP 适配层；数据与投递复用 inbox-service（recipientType='user'），
//        Agent 视角的 agent.inbox.* 保持不变。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { INBOX_QUERY_SCOPES, type InboxQueryScope } from '@shared/inbox'
import { ErrorCode, McpError, type McpServer } from './sdk'
import { requireTask, toToolResult, type VibemuxMcpContext } from './vibemux-mcp-context'
import { getUserById } from '../../repositories/auth'
import { appendTaskComment, publishTaskCommentEvent } from '../../services/task-comment-service'
import { getInboxItemByIdInternal, listInboxGroups, listInboxItems, markInboxGroupRead, markInboxItemRead } from '../../services/inbox-service'
import { saveTask } from '../../storage/app-state-store'

const inboxSectionSchema = z.enum(INBOX_QUERY_SCOPES as [InboxQueryScope, ...InboxQueryScope[]]).optional()

const requireUserInboxItem = async (ctx: VibemuxMcpContext, itemId: string) => {
  const item = await getInboxItemByIdInternal(itemId)
  if (!item || item.recipientType !== 'user' || item.recipientId !== ctx.userId) {
    throw new McpError(ErrorCode.InvalidParams, '收件箱条目不存在或无权访问。')
  }
  return item
}

export const registerVibemuxMcpInboxTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  server.registerTool('inbox.list', {
    title: 'List User Inbox Items',
    description: '列出当前用户的收件箱条目（任务指派、评论提及、工作区需要输入等），按时间倒序，含未读分组计数。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('条数上限，默认 40'),
      unreadOnly: z.boolean().optional().describe('只看未读'),
      workspaceId: z.string().trim().optional().describe('按工作区过滤'),
    },
  }, async ({ limit, unreadOnly, workspaceId }) => {
    return toToolResult(await listInboxItems({
      recipientId: ctx.userId,
      recipientType: 'user',
      limit,
      unreadOnly,
      workspaceId,
    }))
  })

  server.registerTool('inbox.groups', {
    title: 'List User Inbox Groups',
    description: '按分组列出当前用户的收件箱（action=待办 / following=跟进 / snoozed=稍后 / archived=归档），适合扫一眼有哪些事要处理。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      section: inboxSectionSchema.describe('分组范围，默认 action'),
      limit: z.number().int().min(1).max(100).optional(),
      workspaceId: z.string().trim().optional(),
    },
  }, async ({ section, limit, workspaceId }) => {
    return toToolResult(await listInboxGroups({
      recipientId: ctx.userId,
      recipientType: 'user',
      section,
      limit,
      workspaceId,
    }))
  })

  server.registerTool('inbox.get', {
    title: 'Get User Inbox Item',
    description: '读取一条收件箱条目的完整内容与回信地址（replyTo）。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      itemId: z.string().min(1),
    },
  }, async ({ itemId }) => {
    const item = await requireUserInboxItem(ctx, itemId)
    return toToolResult({ item })
  })

  server.registerTool('inbox.read', {
    title: 'Mark User Inbox Item Read',
    description: '把当前用户的一条收件箱条目标为已读。',
    inputSchema: {
      itemId: z.string().min(1),
    },
  }, async ({ itemId }) => {
    await requireUserInboxItem(ctx, itemId)
    await markInboxItemRead(ctx.userId, itemId, 'user')
    return toToolResult({ ok: true, itemId })
  })

  server.registerTool('inbox.read_group', {
    title: 'Mark User Inbox Group Read',
    description: '把一个分组的全部未读条目标为已读。',
    inputSchema: {
      groupKey: z.string().min(1),
    },
  }, async ({ groupKey }) => {
    const updated = await markInboxGroupRead({
      recipientId: ctx.userId,
      recipientType: 'user',
      groupKey,
    })
    return toToolResult({ ok: true, groupKey, updated })
  })

  server.registerTool('inbox.reply', {
    title: 'Reply To User Inbox Item',
    description: '以当前用户身份回复一条收件箱条目。当前支持任务评论回信（replyTo.kind=task_comment）。',
    inputSchema: {
      itemId: z.string().min(1),
      content: z.string().trim().min(1).max(8000),
    },
  }, async ({ itemId, content }) => {
    const item = await requireUserInboxItem(ctx, itemId)
    if (item.replyTo.kind !== 'task_comment') {
      throw new McpError(ErrorCode.InvalidParams, '该收件箱条目不支持直接回复（仅任务评论回信可用）。')
    }

    const task = requireTask(ctx.getState(), item.replyTo.taskId)
    const profile = getUserById(ctx.userId)
    const commentAuthor = {
      type: 'user' as const,
      id: ctx.userId,
      name: profile?.name,
      avatarUrl: profile?.avatarUrl,
    }
    const nextTask = appendTaskComment(task, commentAuthor, content, {
      parentCommentId: item.replyTo.parentCommentId,
    })
    const comment = nextTask.comments.at(-1)
    if (!comment) {
      throw new McpError(ErrorCode.InternalError, '评论保存失败。')
    }
    if (nextTask !== task) saveTask(nextTask)
    await publishTaskCommentEvent(nextTask, commentAuthor, comment)
    return toToolResult({ ok: true, taskId: item.replyTo.taskId, comment })
  })
}
