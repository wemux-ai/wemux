// [INPUT]: 已鉴权 MCP 上下文（Agent 身份）+ 发送目标（群聊会话 / 目标用户）
// [OUTPUT]: Agent 主动向平台内聊天发送消息（群聊会话追加 Agent 气泡；目标用户主聊天追加 assistant 消息）
// [POS]: Agent 主动发消息（提醒/通知/派活）服务；`chat.send` MCP 工具的落库与实时通道
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { ChatMessage } from '@shared/types'
import {
  appendConversationMessage,
  getWorkspaceGroupConversationDetail,
  getWorkspaceGroupSessionDetail,
} from '../control-plane/conversation-service'
import { getAgent } from '../repositories/agent'
import { getUserById } from '../storage/postgres/auth-store'
import { listGroupSessions, listWorkspaceGroupConversations } from '../storage/postgres/conversation-store'
import { listConversationMembers } from '../storage/postgres/conversation-store'
import { listUserWorkspaces, listWorkspaceMembers } from '../repositories/workspace'
import { loadState } from '../storage/app-state-store'
import { ensureMainChatState } from '../routes/project-main-chat'
import { createMainChatSession } from '../routes/project-main-chat-session'
import { withState } from '../routes/shared'
import { publishConversationMessageCreated } from './conversation-ws-service'
import { publishMainChatEvent } from './main-chat-ws-service'
import { publishAgentEvent } from './agent-event-runtime'

export type ChatSendTarget = 'group' | 'user' | 'agent'

export type ChatSendResult =
  | { ok: true; target: ChatSendTarget; conversationId: string; messageId: string }
  | { ok: false; status: number; message: string }

const isAgentGroupMember = (groupId: string, agentId: string) => {
  const members = listConversationMembers(groupId)
  return members.some((member) => (
    member.memberType === 'agent' && member.memberId === agentId && !member.leftAt
  ))
}

/** 纯参数校验（不触 DB），供发送前快速失败与单测覆盖。 */
export const validateChatSendParams = (params: {
  target: ChatSendTarget
  workspaceId?: string
  groupId?: string
  sessionId?: string
  targetUserId?: string
  targetAgentId?: string
  message: string
}): { ok: true } | { ok: false; status: number; message: string } => {
  if (!params.message.trim()) {
    return { ok: false, status: 400, message: '消息不能为空。' }
  }
  if (params.target === 'group' && !(params.workspaceId?.trim() && params.groupId?.trim() && params.sessionId?.trim())) {
    return { ok: false, status: 400, message: 'target=group 需要 workspaceId / groupId / sessionId。' }
  }
  if (params.target === 'user' && !params.targetUserId?.trim()) {
    return { ok: false, status: 400, message: 'target=user 需要 userId。' }
  }
  if (params.target === 'agent' && !params.targetAgentId?.trim()) {
    return { ok: false, status: 400, message: 'target=agent 需要 agentId。' }
  }
  return { ok: true }
}

/**
 * Agent 主动向平台内聊天发送消息。
 * - target='group'：发到工作区群聊会话（Agent 身份气泡，成员实时可见 + 未读）。
 * - target='user'：发到目标用户与当前 Agent 的主聊天会话（不存在则创建），
 *   消息镜像 messages 表后用户主聊天未读自然生效。
 */
export const sendAgentChatMessage = async (params: {
  userId: string
  agentId: string
  target: ChatSendTarget
  workspaceId?: string
  groupId?: string
  sessionId?: string
  targetUserId?: string
  targetAgentId?: string
  message: string
  attachments?: TaskChatAttachment[]
}): Promise<ChatSendResult> => {
  const normalizedMessage = params.message.trim()
  const validation = validateChatSendParams(params)
  if (!validation.ok) {
    return { ok: false, status: validation.status, message: validation.message }
  }

  const agent = getAgent(params.agentId)
  if (!agent || (agent.ownerUserId && agent.ownerUserId !== params.userId)) {
    return { ok: false, status: 403, message: 'Agent 不存在或无权使用。' }
  }
  const agentName = agent.name.trim() || agent.id
  const normalizedAttachments = (params.attachments ?? [])
    .filter((item) => item.url?.trim() && item.filename?.trim())
    .map((item) => ({ ...item, id: item.id?.trim() || `chat-send-${crypto.randomUUID()}` }))

  // ---------- 群聊会话 ----------
  if (params.target === 'group') {
    const workspaceId = params.workspaceId?.trim()
    const groupId = params.groupId?.trim()
    const sessionId = params.sessionId?.trim()

    const groupDetail = getWorkspaceGroupConversationDetail(workspaceId!, groupId!)
    if (!groupDetail) {
      return { ok: false, status: 404, message: '群聊不存在或无权访问。' }
    }
    if (!isAgentGroupMember(groupId!, params.agentId)) {
      return { ok: false, status: 403, message: 'Agent 不是该群聊成员，无法发送消息。' }
    }
    const sessionDetail = getWorkspaceGroupSessionDetail(workspaceId!, groupId!, sessionId!)
    if (!sessionDetail) {
      return { ok: false, status: 404, message: '群聊会话不存在。' }
    }

    const message = appendConversationMessage({
      conversationId: sessionId!,
      role: 'assistant',
      senderId: params.agentId,
      content: normalizedMessage,
      externalRef: {
        agentId: params.agentId,
        agentName,
        senderType: 'agent',
        ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      },
    })
    publishConversationMessageCreated(sessionId!, message)
    return { ok: true, target: 'group', conversationId: sessionId!, messageId: message.id }
  }

  // ---------- 目标 Agent（投递到 Agent Inbox，目标 Agent 自主决定后续动作） ----------
  if (params.target === 'agent') {
    const targetAgentId = params.targetAgentId?.trim()
    const targetAgent = getAgent(targetAgentId!)
    if (!targetAgent || (targetAgent.ownerUserId && targetAgent.ownerUserId !== params.userId)) {
      return { ok: false, status: 403, message: '目标 Agent 不存在或无权使用。' }
    }

    publishAgentEvent({
      type: 'chat.message',
      targetAgentId,
      actingUserId: params.userId,
      actor: { type: 'agent', id: params.agentId },
      payload: {
        message: normalizedMessage,
        senderAgentId: params.agentId,
        senderAgentName: agentName,
        ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      },
    })
    return { ok: true, target: 'agent', conversationId: targetAgentId!, messageId: '' }
  }

  // ---------- 目标用户主聊天 ----------
  const targetUserId = params.targetUserId?.trim()
  if (!targetUserId) {
    return { ok: false, status: 400, message: 'target=user 需要 userId。' }
  }
  const targetUser = getUserById(targetUserId)
  if (!targetUser) {
    return { ok: false, status: 404, message: '目标用户不存在。' }
  }

  const state = ensureMainChatState(loadState(), targetUserId)
  let session = [...state.mainChatSessions]
    .filter((item) => item.customAgentId === params.agentId && item.ownerUserId === targetUserId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  let nextState = state

  if (!session) {
    const created = createMainChatSession(`来自 ${agentName} 的消息`, {
      ownerUserId: targetUserId,
      customAgentId: params.agentId,
    })
    nextState = { ...state, mainChatSessions: [created, ...state.mainChatSessions] }
    session = created
  }

  const timestamp = new Date().toISOString()
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: normalizedMessage,
    createdAt: timestamp,
    authorType: 'agent',
    authorId: params.agentId,
    authorName: agentName,
    ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
  }
  const sessionId = session.id
  nextState = {
    ...nextState,
    mainChatSessions: nextState.mainChatSessions.map((item) => (
      item.id === sessionId
        ? { ...item, messages: [...(item.messages ?? []), assistantMessage], updatedAt: timestamp }
        : item
    )),
  }
  await withState(nextState, undefined, targetUserId)
  publishMainChatEvent(sessionId, 'message_saved', { content: normalizedMessage, status: 'complete' })
  return { ok: true, target: 'user', conversationId: sessionId, messageId: assistantMessage.id }
}

/** 列出当前用户协作区成员（Agent 可发消息的「人」目标），按姓名/邮箱过滤；不枚举全平台用户。 */
export const listChatUserTargets = async (params: {
  userId: string
  query?: string
}): Promise<Array<{ id: string; name: string; email: string; avatarUrl?: string }>> => {
  const rawQuery = params.query?.trim().toLowerCase() ?? ''
  const workspaces = await listUserWorkspaces(params.userId)
  const seen = new Set<string>()
  const users: Array<{ id: string; name: string; email: string; avatarUrl?: string }> = []

  for (const workspace of workspaces) {
    const members = await listWorkspaceMembers(workspace.id)
    for (const member of members) {
      if (member.id === params.userId || seen.has(member.id)) {
        continue
      }
      if (rawQuery && !(
        member.name.toLowerCase().includes(rawQuery)
        || (member.email ?? '').toLowerCase().includes(rawQuery)
      )) {
        continue
      }
      seen.add(member.id)
      users.push({
        id: member.id,
        name: member.name,
        email: member.email ?? '',
        ...(member.avatarUrl?.trim() ? { avatarUrl: member.avatarUrl.trim() } : {}),
      })
    }
  }

  return users.sort((left, right) => left.name.localeCompare(right.name)).slice(0, 30)
}

/** 列出当前 Agent 所属的全部群聊及其会话（`chat.group.list` 数据源）。 */
export const listAgentGroupChatTargets = async (params: {
  userId: string
  agentId: string
}): Promise<Array<{
  workspaceId: string
  workspaceName: string
  groupId: string
  groupTitle: string
  sessions: Array<{ id: string; title: string }>
}>> => {
  const workspaces = await listUserWorkspaces(params.userId)
  const targets: Array<{
    workspaceId: string
    workspaceName: string
    groupId: string
    groupTitle: string
    sessions: Array<{ id: string; title: string }>
  }> = []

  for (const workspace of workspaces) {
    const groups = listWorkspaceGroupConversations(workspace.id)
    for (const group of groups) {
      if (!isAgentGroupMember(group.id, params.agentId)) {
        continue
      }
      targets.push({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        groupId: group.id,
        groupTitle: group.title,
        sessions: listGroupSessions(group.id).map((session) => ({
          id: session.id,
          title: session.title,
        })),
      })
    }
  }

  return targets
}
