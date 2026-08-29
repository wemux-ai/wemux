/**
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 * [INPUT]: Authenticated Wemux MCP context and Agent runtime tool calls.
 * [OUTPUT]: Agent event delivery, Inbox inspection, waits, and event-threaded idempotent comments/delivery.
 * [POS]: Product capability surface for the generic Agent event runtime.
 */
import { z } from 'zod'
import { readCustomAgentConfig } from '@shared/custom-agent'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { getAgent, getAgentTask, getAgentCrons, createAgentCron, updateAgentCron, toggleAgentCron, deleteAgentCron } from '../../repositories/agent'
import { validateHeartbeatCronFrequency } from '../../services/agent-heartbeat-scheduler'
import { saveTask } from '../../storage/app-state-store'
import { appendConversationMessage, getWorkspaceGroupConversationDetail } from '../../control-plane/conversation-service'
import { publishConversationMessageCreated } from '../../services/conversation-ws-service'
import {
  appendTaskComment,
  appendTaskDeliveryComment,
  buildAgentEventCommentIdempotencyKey,
  publishTaskCommentEvent,
} from '../../services/task-comment-service'
import { findRunningAgentEventContext, publishAgentEvent, setAgentEventWait } from '../../services/agent-event-runtime'
import { checkInboxLoopGuard, INBOX_MAX_FANOUT_PER_RUN } from '../../services/agent-event-inbox'
import {
  countInboxTraceDeliveriesInternal,
  getInboxItem,
  getInboxItemByIdInternal,
  listInboxItems,
  markInboxItemRead,
} from '../../services/inbox-service'
import { ErrorCode, McpError, type McpServer } from './sdk'
import { requireTask, toToolResult, type VibemuxMcpContext } from './vibemux-mcp-context'

const eventScopeSchema = z.record(z.string())
const eventPayloadSchema = z.record(z.unknown())

const requireUsableAgent = (ctx: VibemuxMcpContext, agentId: string) => {
  const agent = getAgent(agentId)
  if (!agent || (agent.ownerUserId && agent.ownerUserId !== ctx.userId && agent.id !== ctx.runtimeAgentId)) {
    throw new McpError(ErrorCode.InvalidParams, 'Agent 不存在或无权使用。')
  }
  return agent
}

const resolveRuntimeCommentAuthor = (ctx: VibemuxMcpContext, requestedAgentId?: string) => {
  const agentId = ctx.runtimeAgentId || requestedAgentId
  if (!agentId) {
    throw new McpError(ErrorCode.InvalidParams, '需要指定 Agent。')
  }

  const agent = requireUsableAgent(ctx, agentId)
  if (agent.type.trim().toLowerCase() === 'main') {
    throw new McpError(ErrorCode.InvalidParams, '系统主运行时不作为任务评论作者；请由实际执行的自定义 Agent 写入评论。')
  }
  const profile = readCustomAgentConfig(agent.config)
  return {
    id: agent.id,
    name: agent.name,
    avatarUrl: profile.avatarUrl.trim() || undefined,
  }
}

export const registerVibemuxMcpAgentRuntimeTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  server.registerTool('agent.schedule.list', {
    title: 'List Agent Heartbeat Schedules',
    description: '读取 Agent 的定时心跳计划列表（cron 表达式 / 启停 / 上次与下次运行）。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      agentId: z.string().min(1),
    },
  }, async ({ agentId }) => {
    requireUsableAgent(ctx, agentId)
    return toToolResult({ agentId, schedules: getAgentCrons(agentId) })
  })

  server.registerTool('agent.schedule.set', {
    title: 'Set Agent Heartbeat Schedule',
    description: '创建或更新 Agent 的定时心跳计划（同名更新）。cron 为 5 段式 UTC 表达式。',
    inputSchema: {
      agentId: z.string().min(1),
      name: z.string().trim().min(1).max(120),
      cronExpression: z.string().trim().min(1),
      instructions: z.string().trim().max(2000).optional().describe('每次心跳唤醒时附加给 Agent 的执行提示'),
    },
  }, async ({ agentId, name, cronExpression, instructions }) => {
    requireUsableAgent(ctx, agentId)
    const validationError = validateHeartbeatCronFrequency(cronExpression)
    if (validationError) throw new McpError(ErrorCode.InvalidParams, `Invalid cron expression: ${validationError}`)

    const existing = getAgentCrons(agentId).find((cron) => cron.name === name)
    const payload = { kind: 'heartbeat', ...(instructions ? { instructions } : {}) }
    const cron = existing
      ? updateAgentCron(existing.id, { name, cronExpression, payload })
      : createAgentCron(agentId, name, cronExpression, payload)
    if (!cron) throw new McpError(ErrorCode.InvalidParams, 'Heartbeat schedule not found.')
    return toToolResult({ ok: true, schedule: cron })
  })

  server.registerTool('agent.schedule.toggle', {
    title: 'Toggle Agent Heartbeat Schedule',
    description: '启用或停用 Agent 的定时心跳计划。',
    inputSchema: {
      agentId: z.string().min(1),
      scheduleId: z.string().min(1),
      enabled: z.boolean(),
    },
  }, async ({ agentId, scheduleId, enabled }) => {
    requireUsableAgent(ctx, agentId)
    if (!getAgentCrons(agentId).some((cron) => cron.id === scheduleId)) {
      throw new McpError(ErrorCode.InvalidParams, 'Heartbeat schedule not found.')
    }
    toggleAgentCron(scheduleId, enabled)
    return toToolResult({ ok: true, scheduleId, enabled })
  })

  server.registerTool('agent.schedule.delete', {
    title: 'Delete Agent Heartbeat Schedule',
    description: '删除 Agent 的定时心跳计划。',
    inputSchema: {
      agentId: z.string().min(1),
      scheduleId: z.string().min(1),
    },
  }, async ({ agentId, scheduleId }) => {
    requireUsableAgent(ctx, agentId)
    if (!getAgentCrons(agentId).some((cron) => cron.id === scheduleId)) {
      throw new McpError(ErrorCode.InvalidParams, 'Heartbeat schedule not found.')
    }
    deleteAgentCron(scheduleId)
    return toToolResult({ ok: true, scheduleId })
  })

  server.registerTool('agent.event.emit', {
    title: 'Emit Agent Event',
    description: '向 Agent Inbox 投递通用产品事件，由目标 Agent 自主决定后续动作',
    inputSchema: {
      agentId: z.string().min(1),
      eventType: z.string().min(1),
      scope: eventScopeSchema.optional(),
      payload: eventPayloadSchema.optional(),
      conversationKey: z.string().trim().optional(),
    },
  }, async ({ agentId, eventType, scope, payload, conversationKey }) => {
    requireUsableAgent(ctx, agentId)
    const events = publishAgentEvent({
      type: eventType,
      targetAgentId: agentId,
      actingUserId: ctx.userId,
      actor: { type: 'user', id: ctx.userId },
      scope,
      payload,
      conversationKey,
    })
    return toToolResult({ ok: true, events })
  })

  server.registerTool('agent.inbox.list', {
    title: 'List Agent Inbox',
    description: '读取 Agent 的统一 Inbox。directive/mention/handoff 会唤醒，observe 只作为未读动态。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      agentId: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      unreadOnly: z.boolean().optional(),
      kinds: z.array(z.enum(['directive', 'mention', 'handoff', 'observe'])).optional(),
    },
  }, async ({ agentId, limit, unreadOnly, kinds }) => {
    requireUsableAgent(ctx, agentId)
    return toToolResult({
      agentId,
      ...await listInboxItems({
        recipientType: 'agent',
        recipientId: agentId,
        limit: limit ?? 50,
        unreadOnly,
        kinds,
      }),
    })
  })

  server.registerTool('agent.inbox.read', {
    title: 'Mark Agent Inbox Item Read',
    description: '把当前 Agent 的一条 Inbox item 标为已读。只影响 acknowledgment，不改变执行结果。',
    inputSchema: {
      agentId: z.string().min(1),
      itemId: z.string().min(1),
    },
  }, async ({ agentId, itemId }) => {
    requireUsableAgent(ctx, agentId)
    if (!await markInboxItemRead(agentId, itemId, 'agent')) {
      throw new McpError(ErrorCode.InvalidParams, 'Inbox item 不存在。')
    }
    return toToolResult({ ok: true, agentId, itemId })
  })

  server.registerTool('agent.handoff', {
    title: 'Handoff To Agent',
    description: '把一个明确范围的请求投递给另一个 Agent Inbox。一次运行最多扇出 4 个目标，链最多 8 跳、30 分钟。',
    inputSchema: {
      targetAgentId: z.string().min(1),
      taskId: z.string().min(1).optional(),
      request: z.string().trim().min(1).max(4000),
      replyExpected: z.boolean().optional().default(true),
    },
  }, async ({ targetAgentId, taskId, request, replyExpected }) => {
    requireUsableAgent(ctx, targetAgentId)
    const sourceAgentId = ctx.runtimeAgentId
    if (!sourceAgentId) throw new McpError(ErrorCode.InvalidParams, 'A2A handoff 只能由正在运行的 Agent 发起。')
    if (sourceAgentId === targetAgentId) throw new McpError(ErrorCode.InvalidParams, '不能把 handoff 发给自己。')
    const task = taskId ? requireTask(ctx.getState(), taskId) : undefined
    const eventContext = taskId ? findRunningAgentEventContext(sourceAgentId, taskId) : undefined
    const sourceItem = eventContext?.inboxItemId
      ? await getInboxItemByIdInternal(eventContext.inboxItemId)
      : null
    const traceId = sourceItem?.traceId ?? crypto.randomUUID()
    const chainStartedAt = sourceItem?.chainStartedAt ?? new Date().toISOString()
    const fanoutCount = await countInboxTraceDeliveriesInternal(traceId)
    const guard = checkInboxLoopGuard({
      hopCount: sourceItem?.hopCount ?? 0,
      fanoutCount: Math.min(fanoutCount, INBOX_MAX_FANOUT_PER_RUN),
      chainStartedAt,
    })
    if (!guard.ok) throw new McpError(ErrorCode.InvalidParams, guard.message)

    const events = publishAgentEvent({
      type: 'agent.handoff.requested',
      targetAgentId,
      actingUserId: ctx.userId,
      actor: { type: 'agent', id: sourceAgentId },
      scope: {
        ...(task ? { projectId: task.projectId, taskId: task.id } : {}),
      },
      payload: { title: task?.title ?? 'Agent handoff', request, replyExpected },
      conversationKey: task ? `task:${task.id}` : `agent-handoff:${traceId}`,
      sourceInboxItemId: sourceItem?.id,
      traceId,
      chainStartedAt,
      hopCount: (sourceItem?.hopCount ?? -1) + 1,
      replyTo: replyExpected && sourceItem
        ? { kind: 'inbox_item', itemId: sourceItem.id }
        : task
          ? { kind: 'task_comment', taskId: task.id }
          : { kind: 'none' },
      idempotencyKey: `agent-handoff:${sourceAgentId}:${targetAgentId}:${traceId}:${fanoutCount}`,
    })
    return toToolResult({ ok: true, traceId, events })
  })

  server.registerTool('agent.inbox.reply', {
    title: 'Reply To Agent Inbox Item',
    description: '按 Inbox item 的 replyTo 回信。支持任务评论和内部 Agent 回执；渠道线程回复尚未接入时会明确报错。',
    inputSchema: {
      agentId: z.string().min(1),
      itemId: z.string().min(1),
      content: z.string().trim().min(1).max(4000),
    },
  }, async ({ agentId, itemId, content }) => {
    const agent = requireUsableAgent(ctx, agentId)
    if (ctx.runtimeAgentId && ctx.runtimeAgentId !== agentId) {
      throw new McpError(ErrorCode.InvalidParams, '当前 Agent 只能回复自己的 Inbox。')
    }
    const item = await getInboxItem({ recipientType: 'agent', recipientId: agentId, itemId })
    if (!item) throw new McpError(ErrorCode.InvalidParams, 'Inbox item 不存在。')

    if (item.replyTo.kind === 'channel') {
      throw new McpError(ErrorCode.InvalidParams, '渠道线程回复尚未接入；Inbox 已保留 replyTo，等待对应渠道适配器实现。')
    }
    if (item.replyTo.kind === 'none' || item.replyTo.kind === 'feedback_item') {
      await markInboxItemRead(agentId, itemId, 'agent')
      return toToolResult({ ok: true, delivered: false, message: '该 Inbox item 没有 Agent 可用的回信地址，已标记为已读。' })
    }
    if (item.replyTo.kind === 'task_comment') {
      const task = requireTask(ctx.getState(), item.replyTo.taskId)
      const profile = readCustomAgentConfig(agent.config)
      const author = {
        type: 'agent' as const,
        id: agent.id,
        name: agent.name,
        avatarUrl: profile.avatarUrl.trim() || undefined,
      }
      const nextTask = appendTaskComment(task, author, content, {
        parentCommentId: item.replyTo.parentCommentId,
        idempotencyKey: `inbox-reply:${item.id}`,
      })
      const comment = nextTask.comments.find((entry) => entry.idempotencyKey === `inbox-reply:${item.id}`)
      saveTask(nextTask)
      if (comment) await publishTaskCommentEvent(nextTask, author, comment)
      await markInboxItemRead(agentId, itemId, 'agent')
      return toToolResult({ ok: true, delivered: true, taskId: task.id, comment })
    }

    const sourceItem = await getInboxItemByIdInternal(item.replyTo.itemId)
    if (!sourceItem || sourceItem.recipientType !== 'agent') {
      throw new McpError(ErrorCode.InvalidParams, '上游 Agent Inbox item 不存在。')
    }
    const guard = checkInboxLoopGuard({
      hopCount: item.hopCount,
      fanoutCount: await countInboxTraceDeliveriesInternal(item.traceId),
      chainStartedAt: item.chainStartedAt,
    })
    if (!guard.ok) throw new McpError(ErrorCode.InvalidParams, guard.message)
    const events = publishAgentEvent({
      type: 'agent.handoff.returned',
      targetAgentId: sourceItem.recipientId,
      actingUserId: ctx.userId,
      actor: { type: 'agent', id: agentId },
      scope: item.scope as Record<string, string>,
      payload: { title: item.title, request: content },
      conversationKey: item.groupKey,
      sourceInboxItemId: item.id,
      traceId: item.traceId,
      chainStartedAt: item.chainStartedAt,
      hopCount: item.hopCount + 1,
      replyTo: sourceItem.replyTo,
      idempotencyKey: `agent-inbox-reply:${item.id}`,
    })
    await markInboxItemRead(agentId, itemId, 'agent')
    return toToolResult({ ok: true, delivered: true, events })
  })

  server.registerTool('agent.wait', {
    title: 'Wait For Agent Event',
    description: '暂停当前 Agent event，匹配到指定产品事件后恢复同一 Agent 会话；应作为本轮最后一个工具调用',
    inputSchema: {
      agentId: z.string().min(1),
      eventId: z.string().min(1),
      eventTypes: z.array(z.string().min(1)).min(1).max(20),
      match: eventScopeSchema.optional(),
    },
  }, async ({ agentId, eventId, eventTypes, match }) => {
    requireUsableAgent(ctx, agentId)
    const event = getAgentTask(eventId)
    if (!event || event.agentId !== agentId) {
      throw new McpError(ErrorCode.InvalidParams, 'Agent event 不存在。')
    }
    const ok = setAgentEventWait({ eventId, agentId, condition: { eventTypes, match } })
    if (!ok) throw new McpError(ErrorCode.InvalidParams, '当前事件不能进入等待状态。')
    return toToolResult({ ok: true, eventId, status: 'waiting', waitFor: { eventTypes, match } })
  })

  // v3.6：调度大脑/工作区 Agent 把结果插回工作区群聊（泛化协作闭环）
  server.registerTool('workspace.group_chat.send', {
    title: 'Send Workspace Group Chat Message',
    description: '向工作区群聊发送一条消息（Agent 把处理结果/结论插回聊天；仅限群成员 Agent）',
    inputSchema: {
      workspaceId: z.string().min(1).describe('协作工作区 id'),
      conversationId: z.string().min(1).describe('群聊会话 id（即群聊 conversation id）'),
      content: z.string().min(1).max(4000).describe('要发送的消息内容'),
    },
  }, async ({ workspaceId, conversationId, content }) => {
    const runtimeAgentId = ctx.runtimeAgentId?.trim()
    const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
    if (!detail) {
      throw new McpError(ErrorCode.InvalidParams, '群聊不存在。')
    }
    if (runtimeAgentId) {
      const isMember = detail.members.some((member) => member.memberType === 'agent' && member.memberId === runtimeAgentId)
      if (!isMember) {
        throw new McpError(ErrorCode.InvalidParams, '当前 Agent 不是该群聊成员，无法发送消息。')
      }
    }
    const message = appendConversationMessage({
      conversationId,
      role: 'assistant',
      senderId: runtimeAgentId,
      content,
      externalRef: runtimeAgentId ? { agentId: runtimeAgentId } : undefined,
    })
    publishConversationMessageCreated(conversationId, message)
    return toToolResult({ ok: true, messageId: message.id, conversationId })
  })

  server.registerTool('task.comment.add', {
    title: 'Add Task Comment',
    description: '以指定 Agent 身份给任务添加交付、进展或问题评论',
    inputSchema: {
      taskId: z.string().min(1),
      agentId: z.string().min(1).optional().describe('普通 MCP 调用必填；Agent 运行时会自动使用当前 Agent'),
      content: z.string().trim().min(1),
    },
  }, async ({ taskId, agentId, content }) => {
    const agent = resolveRuntimeCommentAuthor(ctx, agentId)
    const task = requireTask(ctx.getState(), taskId)
    const author = { type: 'agent' as const, ...agent }
    const eventContext = ctx.runtimeAgentId
      ? findRunningAgentEventContext(ctx.runtimeAgentId, taskId)
      : undefined
    const idempotencyKey = eventContext
      ? buildAgentEventCommentIdempotencyKey(eventContext.eventId)
      : undefined
    const existingComment = idempotencyKey
      ? task.comments.find((comment) => comment.idempotencyKey === idempotencyKey)
      : undefined
    const nextTask = appendTaskComment(task, author, content, {
      idempotencyKey,
      parentCommentId: eventContext?.replyParentCommentId,
    })
    const comment = idempotencyKey
      ? nextTask.comments.find((item) => item.idempotencyKey === idempotencyKey)
      : nextTask.comments.at(-1)
    saveTask(nextTask)
    if (!existingComment && comment) {
      await publishTaskCommentEvent(nextTask, author, comment)
    }
    return toToolResult({ ok: true, taskId, comment })
  })

  server.registerTool('task.delivery.report', {
    title: 'Report Task Delivery',
    description: '以 Agent 身份原子地写入任务交付评论并更新任务状态',
    inputSchema: {
      taskId: z.string().min(1),
      agentId: z.string().min(1).optional().describe('普通 MCP 调用必填；Agent 运行时会自动使用当前 Agent'),
      content: z.string().trim().min(1),
      status: z.enum(['in_progress', 'in_review', 'done', 'blocked']),
    },
  }, async ({ taskId, agentId, content, status }) => {
    const agent = resolveRuntimeCommentAuthor(ctx, agentId)
    const task = requireTask(ctx.getState(), taskId)
    const author = { type: 'agent' as const, ...agent }
    const eventContext = ctx.runtimeAgentId
      ? findRunningAgentEventContext(ctx.runtimeAgentId, taskId)
      : undefined
    const delivery = appendTaskDeliveryComment({
      task,
      author,
      content,
      eventId: eventContext?.eventId,
      parentCommentId: eventContext?.replyParentCommentId,
    })
    const nextTask = {
      ...delivery.task,
      status,
      updatedAt: new Date().toISOString(),
    }
    saveTask(nextTask)
    if (delivery.created && delivery.comment) {
      await publishTaskCommentEvent(nextTask, author, delivery.comment)
    }
    return toToolResult({ ok: true, taskId, status: nextTask.status, comment: delivery.comment })
  })
}
