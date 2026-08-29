/**
 * [INPUT]: Authenticated workspace group-chat requests, member catalogs, and Agent runtime streams.
 * [OUTPUT]: Group creation, membership, sessions, and explicitly mentioned-Agent chat APIs.
 * [POS]: Workspace group-chat protocol; legacy orchestrator fields remain compatible but are not required for chat.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { hasAllMention, resolveChatMentionTargetIds } from '@shared/chat-mentions'
import { resolveMentionedDocRefs } from '../services/chat-doc-mentions'
import type { AppState, ChatMessage, MainChatSession } from '@shared/types'
import type { WorkspaceBrainDecision } from '@shared/scheduling-brain'
import {
  addConversationMember,
  appendConversationMessage,
  clearWorkspaceGroupOrchestrator,
  createWorkspaceGroupConversation,
  createWorkspaceGroupSession,
  deleteWorkspaceGroup,
  getWorkspaceGroupConversationDetail,
  getWorkspaceGroupSessionDetail,
  leaveWorkspaceGroup,
  listWorkspaceGroupConversationSummaries,
  listWorkspaceGroupSessionDetails,
  removeConversationMember,
  resolveMentionedWorkspaceIds,
  saveWorkspaceGroupAgentSession,
  updateWorkspaceGroupAnnouncement,
  updateWorkspaceGroupOrchestrator,
  updateWorkspaceGroupProfile,
  updateWorkspaceGroupSessionExecutor,
} from '../control-plane/conversation-service'
import { filterMessagesForMembership, resolveMembershipWindow } from '../control-plane/conversation-access'
import { listVisibleExecutorsForUser } from '../control-plane/collaboration'
import { getAllAgents } from '../repositories/agent'
import { getUserById } from '../repositories/auth'
import { getWorkspaceById, listUserWorkspaces, listWorkspaceMembers } from '../repositories/workspace'
import { ensureMainChatState, requestMainChatExecutorReply } from './project-main-chat'
import { buildMainChatHandoffSnapshot, setMainChatRuntimeSessionId } from './project-main-chat-session'
import { ensureWorkspaceMember, getUserIdFromHeader, jsonError, getScopedState } from './shared'
import { buildDriveReferenceAttachment } from './drive-routes'
import { listConversationsByScope } from '../control-plane/conversation-service'
import { listWorkspaceGroups } from '../storage/postgres/workspace-group-store'
import { loadState, saveTaskAndWait } from '../storage/app-state-store'
import { resolveCustomAgentProjectAccess } from '../services/task-agent-assignment-service'
import { getWorkspaceBrainConfig, recordWorkspaceBrainContextItem } from '../services/workspace-brain-service'
import { resolveBrainGroupChatDispatch } from '../services/scheduling-brain/dispatch-brain'
import { createConversationMention } from '../repositories/conversation-share-store'
import { publishConversationMessageCreated } from '../services/conversation-ws-service'
import { getCommercialGate } from '../services/gate/commercial-gate'

export const createGroupSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  userMemberIds: z.array(z.string().trim().min(1)).default([]),
  agentMemberIds: z.array(z.string().trim().min(1)).default([]),
})

export const updateGroupSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  announcement: z.string().trim().max(2000).optional(),
  orchestratorAgentId: z.string().trim().min(1).optional(),
}).refine((payload) => Boolean(
  payload.title
  || payload.description !== undefined
  || payload.announcement !== undefined
  || payload.orchestratorAgentId
), {
  message: '至少需要一个群聊设置变更。',
})

const addMemberSchema = z.object({
  memberType: z.enum(['user', 'agent']),
  memberId: z.string().trim().min(1),
})

const messageSchema = z.object({
  message: z.string().trim().min(1),
  executorId: z.string().trim().min(1).optional(),
  /** 引用式回复（R8.1）：目标消息 id，群聊会话内。 */
  replyToMessageId: z.string().trim().min(1).optional(),
  clientMessageId: z.string().uuid().optional(),
})

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(80).default('新会话'),
})

const sessionMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  beforeMessageId: z.string().trim().min(1).optional(),
})

/**
 * 群聊选择器可见性：只列「当前用户自己的 Agent」或「已显式归属该组织的共享 Agent」。
 * 未绑定任何组织的旧数据（如每个新用户自动创建的首个 CEO Agent）只对创建者可见，
 * 避免把全库用户的默认 Agent 全部涌进同一个组织的群聊选择器。
 */
export const isAgentVisibleInWorkspaceChatPicker = (
  agentOwnerUserId: string | undefined,
  profileWorkspaceIds: readonly string[],
  scope: { userId: string; workspaceId: string },
) => {
  const isOwner = agentOwnerUserId?.trim() === scope.userId.trim()
  return isOwner || profileWorkspaceIds.includes(scope.workspaceId)
}

const buildAgentOptions = (userId: string, collaborationWorkspaceId: string) => {
  const allAgents = getAllAgents()
  const customAgents = allAgents
    .filter((agent) => agent.type.trim().toLowerCase() !== 'main')
    .flatMap((agent) => {
      const access = resolveCustomAgentProjectAccess({
        agent,
        userId,
        projectId: '',
        collaborationWorkspaceId,
        mode: 'mention',
      })
      if (!access.ok) return []
      if (!isAgentVisibleInWorkspaceChatPicker(agent.ownerUserId, access.profile.workspaceIds, {
        userId,
        workspaceId: collaborationWorkspaceId,
      })) {
        return []
      }
      return {
        id: agent.id,
        name: agent.name,
        role: access.profile.role || access.profile.category || '自定义 Agent',
        avatarUrl: access.profile.avatarUrl || undefined,
        status: agent.status,
        kind: 'custom' as const,
      }
    })

  return customAgents
}

const BRAIN_INTENT_LABELS: Record<WorkspaceBrainDecision['intent'], string> = {
  task_request: '任务请求',
  agent_request: 'Agent 请求',
  question: '提问',
  chat: '闲聊',
  none: '未识别',
}

const buildBrainStatusText = (result: { decision: WorkspaceBrainDecision }, targetAgentName?: string) => {
  const { action, intent } = result.decision
  if (action.kind === 'run_agent') {
    return `调度大脑：识别为「${BRAIN_INTENT_LABELS[intent]}」，自动调度给 ${targetAgentName || action.targetAgentId}（${action.reason}）`
  }
  if (action.kind === 'direct_reply') {
    return `调度大脑：识别为「${BRAIN_INTENT_LABELS[intent]}」，已直接回复（${action.reason}）`
  }
  return `调度大脑：识别为「${BRAIN_INTENT_LABELS[intent]}」，仅记录（${action.reason}）`
}

const isWorkspaceGroupOwner = (
  members: ReadonlyArray<{ memberType: 'user' | 'agent'; memberId: string; role: string }>,
  userId: string,
) => members.some((member) => (
  member.memberType === 'user'
  && member.memberId === userId.trim()
  && member.role === 'owner'
))

const normalizeGroupAgentId = (agentId?: string) => {
  const normalized = agentId?.trim()
  return normalized || undefined
}

const readExternalRefString = (message: { externalRef?: Record<string, unknown> }, key: string) => {
  const value = message.externalRef?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const buildProjectedHistoryContent = (
  message: {
    id: string
    role: string
    content: string
    externalRef?: Record<string, unknown>
  },
) => {
  if (message.role === 'user') {
    const senderName = readExternalRefString(message, 'senderName')
    return senderName ? `[用户 ${senderName}] ${message.content}` : message.content
  }

  if (message.role === 'assistant') {
    const agentName = readExternalRefString(message, 'agentName') || 'Agent'
    return `[Agent ${agentName}] ${message.content}`
  }

  return message.content
}

const toChatMessage = (
  message: {
    id: string
    role: string
    senderId?: string
    content: string
    createdAt: string
    externalRef?: Record<string, unknown>
  },
): ChatMessage | null => {
  if (message.role === 'user') {
    return {
      id: message.id,
      role: 'user',
      content: buildProjectedHistoryContent(message),
      createdAt: message.createdAt,
      authorType: 'user',
      authorId: message.senderId,
      authorName: readExternalRefString(message, 'senderName'),
    }
  }

  if (message.role === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      content: buildProjectedHistoryContent(message),
      createdAt: message.createdAt,
      authorType: 'agent',
      authorId: readExternalRefString(message, 'agentId') || message.senderId,
      authorName: readExternalRefString(message, 'agentName'),
    }
  }

  return null
}

const buildSyntheticMainChatState = (
  state: AppState,
  session: MainChatSession,
) => {
  const nextState = ensureMainChatState(state)
  return {
    ...nextState,
    mainChatSessions: [session],
    selectedMainChatSessionId: session.id,
    messages: session.messages,
  }
}

export const resolveMentionedAgentIds = (
  message: string,
  availableAgents: ReadonlyArray<{ id: string; name: string }>,
) => resolveChatMentionTargetIds(message, availableAgents)

export const resolveMentionedUserIds = (
  message: string,
  availableUsers: ReadonlyArray<{ id: string; name: string }>,
) => resolveChatMentionTargetIds(message, availableUsers)

/** 解析 @组名：按空间内分组名匹配，返回命中的分组 id。 */
export const resolveMentionedGroupIds = (
  message: string,
  groups: ReadonlyArray<{ id: string; name: string }>,
): Set<string> => {
  const targets = groups
    .filter((group) => group.name.trim())
    .map((group) => ({ id: group.id, name: group.name.trim() }))
  return new Set(resolveChatMentionTargetIds(message, targets))
}

/** 解析 @会话：按会话标题匹配 */
export const resolveMentionedConversationIds = (
  message: string,
  conversations: ReadonlyArray<{ id: string; title: string }>,
): Set<string> => {
  const targets = conversations
    .filter((conversation) => conversation.title?.trim())
    .map((conversation) => ({ id: conversation.id, name: conversation.title.trim() }))
  return new Set(resolveChatMentionTargetIds(message, targets))
}

const buildGroupSession = (params: {
  conversationId: string
  title: string
  executorId?: string
  customAgentId?: string
  executionModel?: string
  runtimeSessionIds?: MainChatSession['runtimeSessionIds']
  runtimeContinuations?: MainChatSession['runtimeContinuations']
  handoffSnapshot?: MainChatSession['handoffSnapshot']
  excludedMessageId?: string
  messages: Array<{
    id: string
    role: string
    senderId?: string
    content: string
    createdAt: string
    externalRef?: Record<string, unknown>
  }>
  createdAt: string
  updatedAt: string
}): MainChatSession => {
  return {
    id: params.conversationId,
    title: params.title,
    customAgentId: params.customAgentId,
    executorId: params.executorId,
    executionModel: params.executionModel,
    runtimeSessionIds: params.runtimeSessionIds,
    runtimeContinuations: params.runtimeContinuations,
    handoffSnapshot: params.handoffSnapshot,
    messages: params.messages
      .filter((message) => message.id !== params.excludedMessageId)
      .map((message) => toChatMessage(message))
      .filter(Boolean) as ChatMessage[],
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  }
}

const ensureGroupAccess = async (workspaceId: string, conversationId: string, userId: string) => {
  if (!(await ensureWorkspaceMember(workspaceId, userId))) {
    return { ok: false as const, status: 403 as const, message: '无权限访问该组织。' }
  }

  const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
  if (!detail) {
    return { ok: false as const, status: 404 as const, message: '群聊不存在。' }
  }

  if (!detail.members.some((member) => member.memberType === 'user' && member.memberId === userId)) {
    return { ok: false as const, status: 403 as const, message: '你不是该群成员。' }
  }

  return { ok: true as const, detail }
}

const ensureGroupSessionAccess = async (workspaceId: string, groupId: string, sessionId: string, userId: string) => {
  const groupAccess = await ensureGroupAccess(workspaceId, groupId, userId)
  if (!groupAccess.ok) {
    return groupAccess
  }

  const sessionDetail = getWorkspaceGroupSessionDetail(workspaceId, groupId, sessionId)
  if (!sessionDetail) {
    return { ok: false as const, status: 404 as const, message: '群聊会话不存在。' }
  }

  return {
    ok: true as const,
    groupDetail: groupAccess.detail,
    sessionDetail,
  }
}

export const registerWorkspaceGroupChatRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  app.get('/api/workspaces/:workspaceId/chat/groups/options', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限访问该组织。', 403)
    }

    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) {
      return jsonError(c, '组织不存在。', 404)
    }

    const members = await listWorkspaceMembers(workspaceId)
    const executors = listVisibleExecutorsForUser(userId)
    const agents = buildAgentOptions(userId, workspaceId)

    return c.json({ workspace, members, executors, agents })
  })

  app.get('/api/workspaces/:workspaceId/chat/groups', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限访问该组织。', 403)
    }

    const groups = listWorkspaceGroupConversationSummaries(workspaceId)
      .filter((summary) => summary.members.some((member) => member.memberType === 'user' && member.memberId === userId))

    return c.json({ groups })
  })

  app.post('/api/workspaces/:workspaceId/chat/groups', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    if (!(await ensureWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限访问该组织。', 403)
    }

    const payload = createGroupSchema.parse(await c.req.json().catch(() => ({})))
    const availableAgents = buildAgentOptions(userId, workspaceId)
    const validAgentIds = new Set(availableAgents.map((agent) => agent.id))
    const requestedAgentIds = new Set(payload.agentMemberIds.map((item) => item.trim()).filter(Boolean))
    if (requestedAgentIds.size === 0) {
      return jsonError(c, '请至少选择一个群内 Agent。', 400)
    }

    for (const agentId of requestedAgentIds) {
      if (!validAgentIds.has(agentId)) {
        return jsonError(c, `Agent ${agentId} 不存在或不可用。`, 404)
      }
    }
    const members = await listWorkspaceMembers(workspaceId)
    const validUserIds = new Set(members.map((member) => member.id))
    for (const memberId of payload.userMemberIds) {
      if (!validUserIds.has(memberId)) {
        return jsonError(c, '存在不属于当前组织的成员。', 400)
      }
    }

    const conversation = createWorkspaceGroupConversation({
      workspaceId,
      title: payload.title,
      createdBy: userId,
      description: payload.description,
    })

    addConversationMember({
      conversationId: conversation.id,
      memberType: 'user',
      memberId: userId,
      role: 'owner',
    })

    for (const memberId of payload.userMemberIds.filter((item) => item !== userId)) {
      addConversationMember({
        conversationId: conversation.id,
        memberType: 'user',
        memberId,
      })
    }

    for (const agentId of requestedAgentIds) {
      addConversationMember({
        conversationId: conversation.id,
        memberType: 'agent',
        memberId: agentId,
        role: 'member',
      })
    }

    const detail = getWorkspaceGroupConversationDetail(workspaceId, conversation.id)
    return c.json({ detail }, 201)
  })

  app.get('/api/workspaces/:workspaceId/chat/groups/:conversationId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const access = await ensureGroupAccess(c.req.param('workspaceId'), c.req.param('conversationId'), userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    return c.json({ detail: access.detail })
  })

  app.patch('/api/workspaces/:workspaceId/chat/groups/:conversationId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) return jsonError(c, access.message, access.status)
    if (!isWorkspaceGroupOwner(access.detail.members, userId)) {
      return jsonError(c, '只有群聊创建者可以管理群设置。', 403)
    }

    const payload = updateGroupSchema.parse(await c.req.json().catch(() => ({})))
    let detail = access.detail
    const hasProfileChange = Boolean(payload.title || payload.description !== undefined)
    if (hasProfileChange) {
      const updatedDetail = updateWorkspaceGroupProfile(workspaceId, conversationId, {
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
      })
      if (!updatedDetail) return jsonError(c, '群资料更新失败。', 409)
      detail = updatedDetail
    }

    if (payload.announcement !== undefined) {
      const updatedDetail = updateWorkspaceGroupAnnouncement(
        workspaceId,
        conversationId,
        payload.announcement,
        userId,
      )
      if (!updatedDetail) return jsonError(c, '群公告更新失败。', 409)
      detail = updatedDetail
    }

    if (payload.orchestratorAgentId) {
      if (!buildAgentOptions(userId, workspaceId).some((agent) => agent.id === payload.orchestratorAgentId)) {
        return jsonError(c, 'Agent 不存在或不可用。', 404)
      }
      if (!detail.members.some((member) => (
        member.memberType === 'agent' && member.memberId === payload.orchestratorAgentId
      ))) {
        return jsonError(c, '主持 Agent 必须是群内 Agent。', 400)
      }

      const updatedDetail = updateWorkspaceGroupOrchestrator(workspaceId, conversationId, payload.orchestratorAgentId)
      if (!updatedDetail) return jsonError(c, '主持 Agent 更新失败。', 409)
      detail = updatedDetail

      for (const task of loadState().tasks) {
        if (task.assigneeAgentGroupId !== conversationId || task.assigneeAgentId === payload.orchestratorAgentId) continue
        await saveTaskAndWait({
          ...task,
          assigneeAgentId: payload.orchestratorAgentId,
          updatedAt: new Date().toISOString(),
        })
      }
    }
    return c.json({ detail })
  })

  app.get('/api/workspaces/:workspaceId/chat/groups/:conversationId/sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    const sessions = listWorkspaceGroupSessionDetails(workspaceId, conversationId).map((item) => ({
      conversation: item.conversation,
      messageCount: item.messages.length,
      latestMessage: item.messages.at(-1),
    }))

    return c.json({ sessions })
  })

  app.post('/api/workspaces/:workspaceId/chat/groups/:conversationId/sessions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const payload = createSessionSchema.parse(await c.req.json().catch(() => ({})))
    const session = createWorkspaceGroupSession({
      workspaceId,
      groupId: conversationId,
      title: payload.title,
      createdBy: userId,
    })

    const detail = getWorkspaceGroupSessionDetail(workspaceId, conversationId, session.id)
    return c.json({ detail }, 201)
  })

  app.get('/api/workspaces/:workspaceId/chat/groups/:conversationId/sessions/:sessionId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const sessionId = c.req.param('sessionId')
    const access = await ensureGroupSessionAccess(
      workspaceId,
      conversationId,
      sessionId,
      userId,
    )
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const query = sessionMessagesQuerySchema.parse(c.req.query())
    const detail = getWorkspaceGroupSessionDetail(workspaceId, conversationId, sessionId, query)
    if (!detail) {
      return jsonError(c, '群聊会话不存在。', 404)
    }

    return c.json({ detail })
  })

  app.post('/api/workspaces/:workspaceId/chat/groups/:conversationId/members', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    if (!isWorkspaceGroupOwner(access.detail.members, userId)) {
      return jsonError(c, '只有群聊创建者可以管理成员。', 403)
    }

    const payload = addMemberSchema.parse(await c.req.json().catch(() => ({})))
    if (payload.memberType === 'user') {
      const members = await listWorkspaceMembers(workspaceId)
      if (!members.some((member) => member.id === payload.memberId)) {
        return jsonError(c, '用户不属于当前组织。', 400)
      }
    } else {
      const availableAgents = buildAgentOptions(userId, workspaceId)
      if (!availableAgents.some((agent) => agent.id === payload.memberId)) {
        return jsonError(c, 'Agent 不存在或不可用。', 404)
      }
    }

    addConversationMember({
      conversationId,
      memberType: payload.memberType,
      memberId: payload.memberId,
      role: 'member',
    })

    const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
    return c.json({ detail })
  })

  app.delete('/api/workspaces/:workspaceId/chat/groups/:conversationId/members/:memberType/:memberId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    if (!isWorkspaceGroupOwner(access.detail.members, userId)) {
      return jsonError(c, '只有群聊创建者可以管理成员。', 403)
    }

    const memberType = c.req.param('memberType') as 'user' | 'agent'
    const memberId = c.req.param('memberId')
    const currentDetail = access.detail
    const targetMember = currentDetail.members.find((member) => member.memberType === memberType && member.memberId === memberId)
    if (!targetMember) {
      return jsonError(c, '成员不存在。', 404)
    }
    if (targetMember.role === 'owner') {
      return jsonError(c, '不能移除群聊创建者。', 409)
    }

    if (memberType === 'agent') {
      const agentCount = currentDetail.members.filter((member) => member.memberType === 'agent').length
      if (agentCount <= 1) {
        return jsonError(c, '群里至少需要保留一个 Agent。', 400)
      }
      if (currentDetail.conversation.orchestratorAgentId === memberId) {
        const clearedDetail = clearWorkspaceGroupOrchestrator(workspaceId, conversationId)
        if (!clearedDetail) return jsonError(c, '历史群主持标记清理失败。', 409)
      }
    }

    removeConversationMember(conversationId, memberType, memberId)
    const detail = getWorkspaceGroupConversationDetail(workspaceId, conversationId)
    return c.json({ detail })
  })

  // 成员主动退出群聊（创建者不能直接退出，只能解散）
  app.post('/api/workspaces/:workspaceId/chat/groups/:conversationId/leave', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const updatedDetail = leaveWorkspaceGroup(workspaceId, conversationId, userId)
    if (!updatedDetail) {
      return jsonError(c, '群聊创建者不能直接退出，可解散群聊。', 409)
    }

    return c.json({ detail: updatedDetail })
  })

  // 解散群聊（仅创建者）
  app.delete('/api/workspaces/:workspaceId/chat/groups/:conversationId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const access = await ensureGroupAccess(workspaceId, conversationId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    if (!isWorkspaceGroupOwner(access.detail.members, userId)) {
      return jsonError(c, '只有群聊创建者可以解散群聊。', 403)
    }

    const result = deleteWorkspaceGroup(workspaceId, conversationId)
    if (!result) {
      return jsonError(c, '群聊不存在。', 404)
    }

    return c.json({ ok: true })
  })

  // 分享 Drive 文件到工作区群聊（8a 引用附件；追加消息，@Agent 时后续执行可读）
  app.post('/api/workspaces/:workspaceId/chat/groups/:conversationId/sessions/:sessionId/attachments/drive', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const sessionId = c.req.param('sessionId')
    const access = await ensureGroupSessionAccess(workspaceId, conversationId, sessionId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const body = await c.req.json().catch(() => ({})) as { driveFileId?: string }
    const driveFileId = body.driveFileId?.trim()
    if (!driveFileId) return jsonError(c, '缺少 Drive 文件。', 400)

    const built = await buildDriveReferenceAttachment({ driveFileId, userId, tokenScope: sessionId })
    if ('error' in built) return jsonError(c, built.error, built.status)

    const driveAttachmentMessage = appendConversationMessage({
      conversationId: sessionId,
      role: 'user',
      senderId: userId,
      content: '',
      contentType: 'json',
      externalRef: { attachments: [built.attachment] },
    })
    publishConversationMessageCreated(sessionId, driveAttachmentMessage)
    return c.json({ attachment: built.attachment }, 201)
  })

  // 分享工作区会话链接到工作区群聊（追加一条纯文本链接消息，不触发 Agent）
  app.post('/api/workspaces/:workspaceId/chat/groups/:conversationId/sessions/:sessionId/messages/link', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const sessionId = c.req.param('sessionId')
    const access = await ensureGroupSessionAccess(workspaceId, conversationId, sessionId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const payload = z.object({ text: z.string().trim().min(1).max(4000) }).parse(await c.req.json().catch(() => ({})))
    const user = getUserById(userId)
    const message = appendConversationMessage({
      conversationId: sessionId,
      role: 'user',
      senderId: userId,
      content: payload.text,
      externalRef: {
        senderName: user?.name || user?.email || '用户',
        sharedLink: { workspaceId, source: 'workspace_session' },
      },
    })
    publishConversationMessageCreated(sessionId, message)
    return c.json({ message }, 201)
  })

  app.post('/api/workspaces/:workspaceId/chat/groups/:conversationId/sessions/:sessionId/messages/stream', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const workspaceId = c.req.param('workspaceId')
    const conversationId = c.req.param('conversationId')
    const sessionId = c.req.param('sessionId')
    const access = await ensureGroupSessionAccess(workspaceId, conversationId, sessionId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const payload = messageSchema.parse(await c.req.json().catch(() => ({})))
    const availableAgents = buildAgentOptions(userId, workspaceId)
    const allowedAgentIds = new Set(access.groupDetail.members
      .filter((member) => member.memberType === 'agent')
      .map((member) => member.memberId))
    const mentionedAgentIds = resolveMentionedAgentIds(
      payload.message,
      availableAgents.filter((agent) => allowedAgentIds.has(agent.id)),
    )
    // 显式 @ 集合快照：@ 持久化记录只写用户真实 @ 到的 Agent，隐式分发不入 mention 目录
    const explicitMentionedAgentIds = mentionedAgentIds.slice()
    // —— 调度大脑（feature v2）：无显式 @ 且工作区开启大脑时，按意图隐式分发（协作空间级配置） ——
    const brainConfig = await getWorkspaceBrainConfig(workspaceId)
    const brainEnabled = Boolean(brainConfig?.enabled)
    const brainResult = mentionedAgentIds.length === 0 && brainEnabled
      ? await resolveBrainGroupChatDispatch({
          message: payload.message,
          availableAgents: availableAgents
            .filter((agent) => allowedAgentIds.has(agent.id))
            .map((agent) => ({ id: agent.id, name: agent.name, role: agent.role })),
          orchestratorAgentId: brainConfig?.brainAgentId?.trim()
            || access.groupDetail.conversation.orchestratorAgentId,
          enabled: true,
          timeoutMs: 6000,
        })
      : null
    if (brainResult) {
      mentionedAgentIds.push(...brainResult.implicitAgentIds)
    }
    const workspaceMembers = await listWorkspaceMembers(workspaceId)
    const groupUserIds = new Set(access.groupDetail.members
      .filter((member) => member.memberType === 'user')
      .map((member) => member.memberId))
    const mentionedUserIds = resolveMentionedUserIds(
      payload.message,
      workspaceMembers.filter((member) => groupUserIds.has(member.id)),
    )
    const allMentioned = hasAllMention(payload.message)
    // @组名（P2）：匹配当前空间的分组名，展开为组内 user 成员通知（组内 Agent 不额外唤醒）。
    const workspaceGroups = await listWorkspaceGroups(workspaceId)
    const mentionedGroupIds = resolveMentionedGroupIds(
      payload.message,
      workspaceGroups.map((group) => ({ id: group.id, name: group.name })),
    )
    const groupNotifiedUserIds = [...mentionedGroupIds].flatMap((groupId) => {
      const group = workspaceGroups.find((item) => item.id === groupId)
      return (group?.members ?? [])
        .filter((member) => member.memberType === 'user' && groupUserIds.has(member.memberId) && member.memberId !== userId)
        .map((member) => member.memberId)
    })
    const notifiedUserIds = allMentioned
      ? [...groupUserIds].filter((targetUserId) => targetUserId !== userId)
      : [...new Set([
          ...mentionedUserIds.filter((targetUserId) => targetUserId !== userId),
          ...groupNotifiedUserIds,
        ])]

    // @会话：匹配当前组织内用户可见的群聊会话（按标题）
    const scopedState = getScopedState(loadState(), userId)
    const visibleConversations = listConversationsByScope({
      projectIds: scopedState.projects.map((project) => project.id),
      taskIds: scopedState.tasks.map((task) => task.id),
    })
    const workspaceGroupConversations = visibleConversations
      .map((item) => item.conversation)
      .filter((conversation) => conversation.workspaceId === workspaceId && conversation.kind === 'workspace')
    const mentionedConversationIds = resolveMentionedConversationIds(
      payload.message,
      workspaceGroupConversations,
    )

    // @工作区：匹配用户可见的工作区名（引用型提及，不唤醒 Agent / 不通知成员）
    const userWorkspaces = await listUserWorkspaces(userId)
    const mentionedWorkspaceIds = resolveMentionedWorkspaceIds(
      payload.message,
      userWorkspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    )

    // @文档：匹配团队 + 个人 Drive 文件（reference_doc 引用，不唤醒 Agent）
    const mentionedDocRefs = await resolveMentionedDocRefs({
      message: payload.message,
      scopes: [
        { workspaceId, userId },
        { workspaceId: null, userId },
      ],
    })

    const shouldRunAgents = mentionedAgentIds.length > 0
    const billingSession = shouldRunAgents
      ? await getCommercialGate().startFreeExecutionSession({
          userId,
          sessionKey: sessionId,
          kind: 'workspace_group_chat',
        })
      : null
    if (billingSession && (!billingSession.allowed || !billingSession.token)) {
      return c.json({ message: billingSession.message }, 429)
    }

    const billingEventId = shouldRunAgents ? crypto.randomUUID() : undefined
    const user = getUserById(userId)
    const userMessage = appendConversationMessage({
      conversationId: sessionId,
      role: 'user',
      senderId: userId,
      content: payload.message,
      replyToMessageId: payload.replyToMessageId,
      externalRef: {
        senderName: user?.name || user?.email || '用户',
        ...(payload.clientMessageId ? { clientMessageId: payload.clientMessageId } : {}),
        mentions: [
          ...(allMentioned ? [{ targetType: 'all', targetId: '*' }] : []),
          ...explicitMentionedAgentIds.map((targetId) => ({ targetType: 'agent', targetId })),
          ...mentionedUserIds.map((targetId) => ({ targetType: 'user', targetId })),
          ...[...mentionedGroupIds].map((targetId) => ({ targetType: 'group', targetId })),
          ...[...mentionedConversationIds].map((targetId) => ({ targetType: 'conversation', targetId })),
          ...[...mentionedWorkspaceIds].map((targetId) => ({ targetType: 'workspace', targetId })),
          ...mentionedDocRefs.map((ref) => ({ targetType: 'doc', targetId: ref.id })),
        ],
        ...(mentionedDocRefs.length > 0 ? { referencedDocs: mentionedDocRefs } : {}),
        ...(brainResult ? { brainDecision: brainResult.decision } : {}),
      },
    })
    publishConversationMessageCreated(sessionId, userMessage)

    // 工作区上下文（feature v3.5）：无主消息 + 工作区大脑开启 → 追加上下文池（零模型调用，旁路）
    if (brainEnabled && mentionedAgentIds.length === 0) {
      recordWorkspaceBrainContextItem(workspaceId, {
        kind: 'group_chat',
        source: user?.name || user?.email || '用户',
        text: payload.message,
      })
    }

    // 聊天中的 @ 不进收件箱：消息页内由前端根据 externalRef.mentions 计算
    // 「有人 @ 你」红色提示（飞书式），服务端不再为此发布 inbox item。

    // @ 记录持久化（旁路，不阻塞主流程）：@Agent 派发 + @会话引用
    for (const agentId of explicitMentionedAgentIds) {
      void createConversationMention({
        conversationId: sessionId,
        messageId: userMessage.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: agentId,
        mentionedType: 'agent',
        mentionScope: 'agent_in_chat',
        contextJson: { workspaceId, groupId: conversationId },
      }).catch(() => {})
    }
    for (const conversation of workspaceGroupConversations) {
      if (!mentionedConversationIds.has(conversation.id)) continue
      void createConversationMention({
        conversationId: sessionId,
        messageId: userMessage.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: conversation.id,
        mentionedType: 'conversation',
        mentionScope: 'share_conversation',
        contextJson: { workspaceId, targetConversationId: conversation.id, targetTitle: conversation.title },
      }).catch(() => {})
    }
    // @工作区 记录持久化（旁路）：share_workspace 引用，供后续审计 / 通知扩展
    for (const targetWorkspaceId of mentionedWorkspaceIds) {
      const workspace = userWorkspaces.find((item) => item.id === targetWorkspaceId)
      void createConversationMention({
        conversationId: sessionId,
        messageId: userMessage.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: targetWorkspaceId,
        mentionedType: 'workspace',
        mentionScope: 'share_workspace',
        contextJson: { workspaceId, targetWorkspaceId, targetName: workspace?.name ?? '' },
      }).catch(() => {})
    }

    // @文档 记录持久化（旁路）：reference_doc 引用，供后续审计 / 通知扩展
    for (const docRef of mentionedDocRefs) {
      void createConversationMention({
        conversationId: sessionId,
        messageId: userMessage.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: docRef.id,
        mentionedType: 'doc',
        mentionScope: 'reference_doc',
        contextJson: { workspaceId, name: docRef.name },
      }).catch(() => {})
    }

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
        }
        let completed = false

        // 调度大脑决策透明回显（brain 事件 + 状态事件；web 端未知事件类型自动忽略）
        if (brainResult) {
          const brainAction = brainResult.decision.action
          const targetAgentName = brainAction.kind === 'run_agent'
            ? availableAgents.find((agent) => agent.id === brainAction.targetAgentId)?.name || brainAction.targetAgentId
            : undefined
          sendEvent({
            type: 'brain',
            intent: brainResult.decision.intent,
            action: brainAction.kind,
            targetAgentId: brainAction.kind === 'run_agent' ? brainAction.targetAgentId : undefined,
            targetAgentName,
            reason: brainAction.reason,
            confidence: brainAction.confidence,
            source: brainResult.decision.source,
            model: brainResult.decision.model,
          })
          sendEvent({
            type: 'status',
            content: buildBrainStatusText(brainResult, targetAgentName),
            status: 'thinking',
            currentStep: buildBrainStatusText(brainResult, targetAgentName),
          })
        }

        if (!shouldRunAgents) {
          if (brainResult?.directReply) {
            const brainReplyMessage = appendConversationMessage({
              conversationId: sessionId,
              role: 'assistant',
              senderId: 'scheduling-brain',
              content: brainResult.directReply,
              externalRef: {
                agentId: 'scheduling-brain',
                agentName: '调度大脑',
                brainReply: true,
                brainDecision: brainResult.decision,
              },
            })
            publishConversationMessageCreated(sessionId, brainReplyMessage)
            sendEvent({
              type: 'delta',
              content: brainResult.directReply,
              agentId: 'scheduling-brain',
            })
          }
          sendEvent({
            type: 'done',
            content: brainResult?.directReply ?? '',
            toolCalls: [],
            status: 'complete',
            currentStep: notifiedUserIds.length > 0
              ? `已通知 ${notifiedUserIds.length} 名成员`
              : brainResult?.directReply
                ? '调度大脑已直接回复'
                : '消息已记录',
          })
          controller.close()
          return
        }

        sendEvent({
          type: 'status',
          content: '群聊 Agent 正在分析上下文...',
          status: 'thinking',
          currentStep: '群聊 Agent 正在分析上下文...',
        })

        try {
          const latestDetail = access.groupDetail
          const sessionDetail = getWorkspaceGroupSessionDetail(workspaceId, conversationId, sessionId)
          const visibleExecutorIds = new Set(listVisibleExecutorsForUser(userId).map((executor) => executor.executorId))
          const requestedExecutorId = payload.executorId?.trim() || ''
          if (requestedExecutorId && !visibleExecutorIds.has(requestedExecutorId)) {
            sendEvent({
              type: 'error',
              content: '当前执行节点不可见或无权限访问。',
              status: 'error',
              currentStep: '执行节点不可访问',
            })
            controller.close()
            return
          }

          if (!latestDetail || !sessionDetail) {
            sendEvent({
              type: 'error',
              content: '群聊会话不存在。',
              status: 'error',
              currentStep: '群聊会话不存在',
            })
            controller.close()
            return
          }

          // 群聊不再要求会话级 executorId；各 Agent 使用自身 defaultExecutorId，由 resolveMainChatExecutor 自动回退
          const effectiveExecutorId = requestedExecutorId || sessionDetail?.conversation.executorId?.trim() || ''

          const sessionConversation = sessionDetail.conversation.executorId === effectiveExecutorId
            ? sessionDetail.conversation
            : updateWorkspaceGroupSessionExecutor(workspaceId, conversationId, sessionId, effectiveExecutorId) || sessionDetail.conversation

          let latestSessionDetail = sessionDetail
          const allToolCalls = []
          const appState = ensureMainChatState(loadState(), userId)
          for (const [index, targetAgentId] of mentionedAgentIds.entries()) {
            const selectedAgent = availableAgents.find((agent) => agent.id === targetAgentId)
            const agentName = selectedAgent?.name || 'Agent'
            sendEvent({
              type: 'status',
              content: `${agentName} 正在分析上下文...`,
              status: 'thinking',
              currentStep: `${agentName} 正在分析上下文...`,
              agentId: targetAgentId,
            })
            const savedAgentSession = latestSessionDetail.agentSessions.find((session) => session.agentId === targetAgentId)
            // 解析该 Agent 的 executor：群聊会话级 > Agent 已有主聊天会话 > Agent 默认配置
            let agentExecutorId = effectiveExecutorId
            if (!agentExecutorId) {
              const normalizedAgentId = normalizeGroupAgentId(targetAgentId)
              if (normalizedAgentId) {
                const agentMainSession = appState.mainChatSessions
                  .filter((s) => s.customAgentId === normalizedAgentId)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
                agentExecutorId = agentMainSession?.executorId?.trim() || ''
              }
            }
            const agentMembership = resolveMembershipWindow(conversationId, { type: 'agent', id: targetAgentId })
            const syntheticSession = buildGroupSession({
              conversationId: latestSessionDetail.conversation.id,
              title: sessionConversation.title,
              executorId: agentExecutorId,
              customAgentId: normalizeGroupAgentId(targetAgentId),
              executionModel: savedAgentSession?.executionModel,
              runtimeSessionIds: savedAgentSession?.runtimeSessionIds,
              runtimeContinuations: savedAgentSession?.runtimeContinuations,
              handoffSnapshot: savedAgentSession?.handoffSnapshot,
              excludedMessageId: userMessage.id,
              messages: filterMessagesForMembership(latestSessionDetail.messages, agentMembership),
              createdAt: sessionConversation.createdAt,
              updatedAt: latestSessionDetail.conversation.updatedAt,
            })
            const syntheticState = buildSyntheticMainChatState(appState, syntheticSession)
            const result = await requestMainChatExecutorReply({
              state: syntheticState,
              userId,
              message: payload.message,
              sessionId: syntheticSession.id,
              signal: c.req.raw.signal,
              onEvent: (event) => {
                if (event.type === 'delta') {
                  sendEvent({ type: 'delta', content: event.content, agentId: targetAgentId })
                  return
                }

                if (event.type === 'tool') {
                  sendEvent({ type: 'tool', content: event.toolCall.name, toolCall: event.toolCall, agentId: targetAgentId })
                  return
                }

                if (event.type === 'reasoning') {
                  return
                }

                if (event.type !== 'status') {
                  return
                }

                sendEvent({
                  type: 'status',
                  content: `${agentName}：${event.currentStep}`,
                  status: event.status,
                  currentStep: `${agentName}：${event.currentStep}`,
                  agentId: targetAgentId,
                })
              },
            })

            if (!result.ok) {
              sendEvent({
                type: 'error',
                content: result.output,
                toolCalls: result.toolCalls,
                status: 'error',
                currentStep: `${agentName} 回复失败`,
                agentId: targetAgentId,
              })
              controller.close()
              return
            }

            allToolCalls.push(...result.toolCalls)
            const agentReplyMessage = appendConversationMessage({
              conversationId: sessionId,
              role: 'assistant',
              senderId: targetAgentId,
              content: result.output,
              externalRef: {
                agentId: targetAgentId,
                agentName,
                mentionOrder: index + 1,
                ...(brainResult && brainResult.implicitAgentIds.includes(targetAgentId)
                  ? { brainRouted: true, brainDecision: brainResult.decision }
                  : {}),
              },
            })
            publishConversationMessageCreated(sessionId, agentReplyMessage)

            const nextSessionDetail = getWorkspaceGroupSessionDetail(workspaceId, conversationId, sessionId)
            if (nextSessionDetail) {
              const nextAgentSessionBase = buildGroupSession({
                conversationId: nextSessionDetail.conversation.id,
                title: nextSessionDetail.conversation.title,
                executorId: agentExecutorId,
                customAgentId: normalizeGroupAgentId(targetAgentId),
                executionModel: result.continuationScope.executionModel || syntheticSession.executionModel,
                runtimeSessionIds: syntheticSession.runtimeSessionIds,
                runtimeContinuations: syntheticSession.runtimeContinuations,
                handoffSnapshot: savedAgentSession?.handoffSnapshot,
                messages: filterMessagesForMembership(nextSessionDetail.messages, agentMembership),
                createdAt: nextSessionDetail.conversation.createdAt,
                updatedAt: nextSessionDetail.conversation.updatedAt,
              })
              const nextAgentSession = {
                ...nextAgentSessionBase,
                handoffSnapshot: buildMainChatHandoffSnapshot(nextAgentSessionBase.messages),
              }
              const persistedAgentSession = result.sessionId
                ? setMainChatRuntimeSessionId(nextAgentSession, result.continuationScope, result.sessionId)
                : nextAgentSession

              saveWorkspaceGroupAgentSession({
                conversationId: sessionId,
                agentId: targetAgentId,
                agentName,
                session: persistedAgentSession,
              })

              latestSessionDetail = getWorkspaceGroupSessionDetail(workspaceId, conversationId, sessionId) || nextSessionDetail
              continue
            }
          }

          sendEvent({
            type: 'done',
            content: '',
            toolCalls: allToolCalls,
            status: 'complete',
            currentStep: `已完成 ${mentionedAgentIds.length} 个 Agent 的顺序回复`,
          })
          completed = mentionedAgentIds.length > 0
        } catch (error) {
          sendEvent({
            type: 'error',
            content: error instanceof Error ? error.message : '群聊消息发送失败。',
            status: 'error',
            currentStep: '群聊消息发送失败',
          })
        } finally {
          if (billingSession?.token) {
            await getCommercialGate().finishFreeExecutionSession({
              token: billingSession.token,
              completed,
              eventId: billingEventId,
            })
          }
        }

        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })
}
