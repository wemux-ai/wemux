// [INPUT]: 已鉴权 MCP 上下文（Agent 身份）+ 发送目标参数
// [OUTPUT]: Agent 平台内聊天工具：chat.group.list（可发群聊目标）+ chat.send（发消息到群聊/用户）
// [POS]: Agent 主动发消息（提醒/通知/派活）MCP 适配层；复用 chat-send-service 落库与实时通道
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { z } from 'zod'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { ErrorCode, McpError, type McpServer } from './sdk'
import { toToolResult, type WemuxMcpContext } from './wemux-mcp-context'
import { listAgentGroupChatTargets, listChatUserTargets, sendAgentChatMessage } from '../../services/chat-send-service'

/**
 * opencode 等 runtime 可能以「文本参数」调用 MCP 工具（LLM 输出 `target: user` 行文本而非 JSON 对象）。
 * 这里把字符串参数解析为对象：优先 JSON，失败则按 `key: value` 行解析。
 */
export const normalizeMcpArguments = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') {
    return (value ?? {}) as Record<string, unknown>
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  } catch {
    // not JSON → 按行解析
  }

  const result: Record<string, unknown> = {}
  for (const line of trimmed.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) {
      continue
    }
    const key = line.slice(0, separator).trim()
    const valuePart = line.slice(separator + 1).trim()
    if (key) {
      result[key] = valuePart
    }
  }
  return result
}

const chatAttachmentSchema = z.object({
  id: z.string().optional().describe('附件 id（缺省时服务端自动生成）'),
  url: z.string().min(1).describe('附件访问 URL（/api/... 或 http(s) 链接）'),
  filename: z.string().min(1).describe('附件文件名'),
  contentType: z.string().optional().describe('MIME 类型'),
  kind: z.enum(['file', 'drive']).optional().describe('file=上传副本；drive=Drive 文件引用'),
  driveFileId: z.string().optional().describe('kind=drive 时的 Drive 文件 id'),
  driveWorkspaceId: z.string().nullable().optional().describe('kind=drive 时归属组织（null=个人）'),
})

const chatSendSchema = {
  target: z.enum(['group', 'user', 'agent']).describe('发送目标：group=工作区群聊会话；user=目标用户主聊天；agent=目标 Agent Inbox'),
  workspaceId: z.string().trim().optional().describe('target=group 必填：组织 ID（chat.group.list 可查）'),
  groupId: z.string().trim().optional().describe('target=group 必填：群聊 ID（chat.group.list 可查）'),
  sessionId: z.string().trim().optional().describe('target=group 必填：群聊内会话 ID（chat.group.list 可查）'),
  userId: z.string().trim().optional().describe('target=user 必填：目标用户 ID（chat.user.list 可查）'),
  agentId: z.string().trim().optional().describe('target=agent 必填：目标 Agent ID（agent.list 可查）'),
  message: z.string().trim().min(1).max(20000).describe('要发送的消息内容'),
  attachments: z.array(chatAttachmentSchema).optional().describe('可选附件（图片/文件/Dive 引用）'),
}

export const registerWemuxMcpChatTools = (server: McpServer, ctx: WemuxMcpContext) => {
  server.registerTool('chat.group.list', {
    title: 'List Agent Group Chat Targets',
    description: '列出当前 Agent 所属的全部群聊及其会话（Agent 可主动发消息的目标），返回 workspaceId / groupId / sessionId 供 chat.send 使用。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {},
  }, async () => {
    const runtimeAgentId = ctx.runtimeAgentId?.trim()
    if (!runtimeAgentId) {
      throw new McpError(ErrorCode.InvalidParams, '当前调用不是 Agent 身份。')
    }
    const targets = await listAgentGroupChatTargets({ userId: ctx.userId, agentId: runtimeAgentId })
    return toToolResult({ targets })
  })

  server.registerTool('chat.user.list', {
    title: 'List Chat User Targets',
    description: '列出当前 Agent 可发消息的「人」目标：Agent owner 所属协作区的全部成员（去重，按姓名/邮箱过滤，不枚举全平台用户）。返回 userId 供 chat.send target=user 使用。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      query: z.string().trim().optional().describe('可选：按姓名/邮箱过滤'),
    },
  }, async ({ query }) => {
    const users = await listChatUserTargets({ userId: ctx.userId, query })
    return toToolResult({ users })
  })

  server.registerTool('chat.send', {
    title: 'Send Platform Chat Message',
    description: '以当前 Agent 身份向平台内聊天发送消息。必须一次性传全目标参数：target=group 时同时传 workspaceId+groupId+sessionId；target=user 时同时传 userId；target=agent 时同时传 agentId；message 必传。示例：chat.send(target="user", userId="xxx", message="你好")。发送后对方在对应会话可见，无需再次调用。',
    inputSchema: chatSendSchema,
  }, async (input) => {
    const runtimeAgentId = ctx.runtimeAgentId?.trim()
    if (!runtimeAgentId) {
      throw new McpError(ErrorCode.InvalidParams, '当前调用不是 Agent 身份，无法发送消息。')
    }
    const result = await sendAgentChatMessage({
      userId: ctx.userId,
      agentId: runtimeAgentId,
      target: input.target,
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      sessionId: input.sessionId,
      targetUserId: input.userId,
      targetAgentId: input.agentId,
      message: input.message,
      attachments: input.attachments?.map((attachment) => ({
        ...attachment,
        id: attachment.id?.trim() || `chat-send-${crypto.randomUUID()}`,
      })),
    })
    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message)
    }
    return toToolResult({
      ok: true,
      target: result.target,
      conversationId: result.conversationId,
      messageId: result.messageId,
      message: '消息已发送。',
    })
  })
}
