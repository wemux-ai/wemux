// [INPUT]: 已鉴权 Hono app + 会话分享/@ 请求
// [OUTPUT]: /api/sessions/*（转发、定向分享、可见性、搜索）与 /api/conversations/:id/share、/api/shared/:token、/api/mentions/*
// [POS]: 会话分享与 @ 机制 HTTP 协议层；分享生成需会话成员，匿名访问走 token
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { resolveConversationAccess, resolveMainChatSessionAccess } from '../control-plane/conversation-access'
import { getConversationDetail, listConversationsByScope } from '../control-plane/conversation-service'
import {
  forwardSessions,
  issueShareLink,
  listSharedWithViewer,
  listSharesForSource,
  resolveShareToken,
  revokeShare,
  setConversationVisibility,
  setMainChatSessionVisibility,
  shareSession,
} from '../services/conversation-share-service'
import { searchSessions } from '../services/session-search-service'
import { getShare, getConversation, listConversationMembers, listConversationMessages, type ConversationShareSourceKind } from '../storage/conversation-store'
import { getAuthorizedProject, getScopedState, getUserIdFromHeader, jsonError } from './shared'
import { getWorkspaceSessionById, loadState } from '../storage/app-state-store'
import { getWorkspace } from '../storage/distributed-task-store'
import {
  createConversationMention,
  createConversationShare,
  deleteConversationShare,
  getConversationShareById,
  getConversationShareByToken,
  listConversationMentions,
  listConversationShares,
  listPendingMentionsFor,
  updateMentionStatus,
} from '../repositories/conversation-share-store'

const shareTargetSchema = z.object({
  targetType: z.enum(['user', 'agent']),
  targetId: z.string().trim().min(1),
})

const forwardSchema = z.object({
  conversationIds: z.array(z.string().trim().min(1)).optional(),
  mainChatSessionIds: z.array(z.string().trim().min(1)).optional(),
  workspaceSessionIds: z.array(z.string().trim().min(1)).optional(),
  targets: z.array(shareTargetSchema).min(1),
  permission: z.enum(['read', 'comment']).optional(),
}).refine((data) => (data.conversationIds?.length ?? 0) + (data.mainChatSessionIds?.length ?? 0) + (data.workspaceSessionIds?.length ?? 0) > 0, {
  message: '缺少要转发的会话。',
})

const createShareSchema = z.object({
  targetType: z.enum(['user', 'agent', 'link']),
  targetId: z.string().trim().min(1).optional(),
  permission: z.enum(['read', 'comment']).optional(),
  expiresInMinutes: z.number().int().positive().max(60 * 24 * 30).optional(),
})

const visibilitySchema = z.object({
  visibility: z.enum(['public', 'private']),
})

const shareSchema = z.object({
  messageId: z.string().trim().optional().nullable(),
  expiresAt: z.string().nullable().optional(),
  accessScope: z.enum(['members', 'link', 'public']).optional(),
})

const isSourceKind = (value: string): value is ConversationShareSourceKind => (
  value === 'conversation' || value === 'main_chat' || value === 'workspace_session'
)

const ensureConversationEditor = async (conversationId: string, userId: string) => {
  const access = await resolveConversationAccess({ conversationId, viewer: { type: 'user', id: userId } })
  if (!access.ok) {
    return access
  }
  if (access.level !== 'member') {
    return { ok: false as const, status: 403 as const, message: '仅会话成员可以分享或转发该会话。' }
  }
  return access
}

const ensureMainChatSessionEditor = (sessionId: string, userId: string) => {
  const access = resolveMainChatSessionAccess({ sessionId, viewer: { type: 'user', id: userId } })
  if (!access.ok) {
    return access
  }
  return access
}

const ensureWorkspaceSessionEditor = async (sessionId: string, userId: string) => {
  const workspaceSession = getWorkspaceSessionById(sessionId)
  if (!workspaceSession) {
    return { ok: false as const, status: 404 as const, message: '工作区会话不存在。' }
  }

  const workspace = getWorkspace(workspaceSession.workspaceId)
  if (!workspace) {
    return { ok: false as const, status: 404 as const, message: '工作区不存在。' }
  }

  const projectResult = getAuthorizedProject(loadState(), userId, workspace.projectId)
  if (!projectResult.project) {
    return { ok: false as const, status: projectResult.status as 403 | 404, message: projectResult.message }
  }

  return { ok: true as const, workspaceSession }
}

const ensureSourceEditor = async (sourceKind: ConversationShareSourceKind, sourceId: string, userId: string) => {
  if (sourceKind === 'conversation') {
    return ensureConversationEditor(sourceId, userId)
  }
  if (sourceKind === 'workspace_session') {
    return ensureWorkspaceSessionEditor(sourceId, userId)
  }
  return ensureMainChatSessionEditor(sourceId, userId)
}

/** 校验用户是否为会话成员（会话在其可见范围内） */
const isConversationVisible = (userId: string, conversationId: string) => {
  const state = loadState()
  const scopedState = getScopedState(state, userId)
  const conversations = listConversationsByScope({
    projectIds: scopedState.projects.map((project) => project.id),
    taskIds: scopedState.tasks.map((task) => task.id),
  })
  if (conversations.some((item) => item.conversation.id === conversationId)) {
    return true
  }

  // 工作区群聊（kind='workspace' + chatMode='group'）不在 project/task 作用域内，
  // 按群聊会话成员校验（成员在场且是用户）。
  const conversation = getConversation(conversationId)
  if (!conversation || conversation.kind !== 'workspace' || conversation.chatMode !== 'group') {
    return false
  }
  return listConversationMembers(conversationId).some(
    (member) => member.memberType === 'user' && member.memberId === userId,
  )
}

export const registerConversationShareRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // ---------- 会话搜索 ----------
  app.get('/api/sessions/search', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const query = c.req.query('query')?.trim() ?? ''
    if (!query) {
      return jsonError(c, '缺少搜索关键词。', 400)
    }

    const limitParam = c.req.query('limit')
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
    const hits = await searchSessions({
      query,
      viewer: { type: 'user', id: userId },
      limit: Number.isFinite(limit) ? limit : undefined,
    })

    return c.json({ hits })
  })

  // ---------- 多选转发 ----------
  app.post('/api/sessions/forward', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = forwardSchema.parse(await c.req.json().catch(() => ({})))

    const sources: Array<{ sourceKind: ConversationShareSourceKind, sourceId: string }> = [
      ...(payload.conversationIds ?? []).map((sourceId) => ({ sourceKind: 'conversation' as const, sourceId })),
      ...(payload.mainChatSessionIds ?? []).map((sourceId) => ({ sourceKind: 'main_chat' as const, sourceId })),
      ...(payload.workspaceSessionIds ?? []).map((sourceId) => ({ sourceKind: 'workspace_session' as const, sourceId })),
    ]

    for (const source of sources) {
      const access = await ensureSourceEditor(source.sourceKind, source.sourceId, userId)
      if (!access.ok) {
        return jsonError(c, access.message, access.status)
      }
    }

    const results = forwardSessions({
      sources,
      targets: payload.targets,
      permission: payload.permission,
      createdBy: userId,
    })

    const shares = results.filter((result) => result.ok).map((result) => (result as { ok: true, share: unknown }).share)
    return c.json({ shares }, 201)
  })

  // ---------- 分享列表 / 创建 / 撤销（conversation / main_chat / workspace_session 三来源） ----------
  app.get('/api/sessions/:kind/:id/shares', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const kind = c.req.param('kind')
    if (!isSourceKind(kind)) {
      return jsonError(c, '暂不支持该类型的分享查询。', 400)
    }

    const sourceId = c.req.param('id')
    const access = await ensureSourceEditor(kind, sourceId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    return c.json({ shares: listSharesForSource(kind, sourceId) })
  })

  app.post('/api/sessions/:kind/:id/shares', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const kind = c.req.param('kind')
    if (!isSourceKind(kind)) {
      return jsonError(c, '暂不支持该类型的分享。', 400)
    }

    const sourceId = c.req.param('id')
    const access = await ensureSourceEditor(kind, sourceId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const payload = createShareSchema.parse(await c.req.json().catch(() => ({})))
    const workspaceId = kind === 'conversation' && access.ok && 'conversation' in access
      ? access.conversation.workspaceId
      : kind === 'workspace_session' && access.ok && 'workspaceSession' in access
        ? access.workspaceSession.workspaceId
        : undefined

    if (payload.targetType === 'link') {
      const result = issueShareLink({
        sourceKind: kind,
        sourceId,
        workspaceId,
        permission: payload.permission,
        createdBy: userId,
        expiresInMinutes: payload.expiresInMinutes,
      })
      if (!result.ok) {
        return jsonError(c, result.message, result.status)
      }
      return c.json({ share: result.share, token: result.token }, 201)
    }

    if (!payload.targetId) {
      return jsonError(c, '缺少分享目标。', 400)
    }

    const result = shareSession({
      sourceKind: kind,
      sourceId,
      workspaceId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      permission: payload.permission,
      createdBy: userId,
    })
    if (!result.ok) {
      return jsonError(c, result.message, result.status)
    }

    return c.json({ share: result.share }, 201)
  })

  app.delete('/api/sessions/shares/:shareId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const shareId = c.req.param('shareId')
    const existingShare = getShare(shareId)
    if (!existingShare) {
      return jsonError(c, '分享不存在。', 404)
    }

    const access = await ensureSourceEditor(existingShare.sourceKind, existingShare.sourceId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const result = revokeShare(shareId)
    if (!result.ok) {
      return jsonError(c, result.message, result.status)
    }

    return c.json({ share: result.share })
  })

  // ---------- 可见性（默认公开，可设私密） ----------
  app.patch('/api/sessions/:kind/:id/visibility', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const kind = c.req.param('kind')
    if (!isSourceKind(kind)) {
      return jsonError(c, '暂不支持修改该类型的可见性。', 400)
    }

    const sourceId = c.req.param('id')
    const access = await ensureSourceEditor(kind, sourceId, userId)
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const payload = visibilitySchema.parse(await c.req.json().catch(() => ({})))

    if (kind === 'workspace_session') {
      return jsonError(c, '工作区会话暂不支持修改可见性。', 400)
    }

    if (kind === 'main_chat') {
      const session = setMainChatSessionVisibility(sourceId, payload.visibility)
      return c.json({ session })
    }

    const conversation = setConversationVisibility(sourceId, payload.visibility)
    return c.json({ conversation })
  })

  // ---------- 分享给我 ----------
  app.get('/api/shared-with-me', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const entries = listSharedWithViewer('user', userId)
    return c.json({ shares: entries })
  })

  // ---------- 匿名访问分享会话（本分支实现：/api/public/session/:token） ----------
  app.get('/api/public/session/:token', async (c) => {
    const token = c.req.param('token')
    const result = resolveShareToken(token)
    if (!result.ok) {
      return jsonError(c, result.message, result.status)
    }

    if (result.sourceKind === 'main_chat') {
      return c.json({
        sourceKind: 'main_chat',
        session: result.mainChatSession,
        messages: result.mainChatSession.messages,
        permission: result.share.permission,
      })
    }

    return c.json({
      sourceKind: 'conversation',
      conversation: result.conversation,
      messages: listConversationMessages(result.conversation.id),
      permission: result.share.permission,
    })
  })

  // ---------- dev 已有的会话分享/@（conversation 链接分享 + @ 记录） ----------
  // 生成分享链接（鉴权：会话成员）
  app.post('/api/conversations/:id/share', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const parsed = shareSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    if (!isConversationVisible(userId, conversationId)) return jsonError(c, '无权限访问会话。', 403)

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '').slice(0, 32)
    const share = await createConversationShare({
      conversationId,
      messageId: parsed.data.messageId ?? null,
      sharedBy: userId,
      sharedByType: 'user',
      shareType: 'link',
      accessScope: parsed.data.accessScope ?? 'link',
      shareToken: token,
      expiresAt: parsed.data.expiresAt ?? null,
    })
    return c.json({ share, url: `/api/shared/${share.shareToken}` }, 201)
  })

  // 分享记录列表
  app.get('/api/conversations/:id/shares', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    if (!isConversationVisible(userId, conversationId)) return jsonError(c, '无权限访问会话。', 403)
    const shares = await listConversationShares(conversationId)
    return c.json({ shares })
  })

  // 关闭分享
  app.delete('/api/conversations/:id/shares/:shareId', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    if (!isConversationVisible(userId, conversationId)) return jsonError(c, '无权限访问会话。', 403)
    const share = await getConversationShareById(c.req.param('shareId'))
    if (!share || share.conversationId !== conversationId) return jsonError(c, '分享不存在。', 404)
    if (share.sharedBy !== userId) return jsonError(c, '只能关闭自己创建的分享。', 403)
    await deleteConversationShare(share.id)
    return c.json({ message: '已关闭分享。' })
  })

  // 匿名访问分享会话（token；link 范围或 public；校验过期）
  app.get('/api/shared/:token', async (c) => {
    const share = await getConversationShareByToken(c.req.param('token'))
    if (!share) return jsonError(c, '分享链接无效。', 404)
    if (share.expiresAt && share.expiresAt < new Date().toISOString()) {
      return jsonError(c, '分享链接已过期。', 403)
    }
    if (share.accessScope === 'members') {
      const userId = getUserIdFromHeader(c)
      if (!userId || !isConversationVisible(userId, share.conversationId)) {
        return jsonError(c, '该分享仅限成员访问。', 403)
      }
    }
    const detail = getConversationDetail(share.conversationId)
    if (!detail) return jsonError(c, '会话不存在。', 404)
    return c.json({ share, conversation: detail })
  })

  // 记录 @（群聊派发时落库，或手动）
  app.post('/api/conversations/:id/mentions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const parsed = z.object({
      mentionedId: z.string().min(1),
      mentionedType: z.enum(['user', 'agent', 'conversation', 'doc']),
      messageId: z.string().optional().nullable(),
      mentionScope: z.enum(['agent_in_chat', 'share_conversation', 'reference_doc']).optional(),
      contextJson: z.unknown().optional().nullable(),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, '参数错误。', 400)
    if (!isConversationVisible(userId, conversationId)) return jsonError(c, '无权限访问会话。', 403)
    const mention = await createConversationMention({
      conversationId,
      messageId: parsed.data.messageId ?? null,
      mentionerId: userId,
      mentionerType: 'user',
      mentionedId: parsed.data.mentionedId,
      mentionedType: parsed.data.mentionedType,
      mentionScope: parsed.data.mentionScope ?? 'agent_in_chat',
      contextJson: parsed.data.contextJson ?? null,
    })
    return c.json({ mention }, 201)
  })

  // 待处理 @ 列表（本人或我的 Agent）
  app.get('/api/mentions/pending', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const mentionedId = c.req.query('mentionedId') ?? userId
    const mentions = await listPendingMentionsFor(mentionedId)
    return c.json({ mentions })
  })

  // 确认 @
  app.post('/api/mentions/:id/acknowledge', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const mentionId = c.req.param('id')
    const updated = await updateMentionStatus(mentionId, 'acknowledged')
    if (!updated) return jsonError(c, '@ 记录不存在。', 404)
    void userId
    return c.json({ message: '已确认。' })
  })

  // 会话内的 @ 记录列表
  app.get('/api/conversations/:id/mentions', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    if (!isConversationVisible(userId, conversationId)) return jsonError(c, '无权限访问会话。', 403)
    const mentions = await listConversationMentions(conversationId)
    return c.json({ mentions })
  })
}
