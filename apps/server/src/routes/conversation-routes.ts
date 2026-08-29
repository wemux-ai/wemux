// [INPUT]: 已鉴权 Hono app，conversation 查询参数
// [OUTPUT]: /api/conversations、/api/conversations/:id 路由
// [POS]: 统一会话（Conversation）HTTP 查询协议层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  appendConversationMessage,
  createDmConversation,
  ensureDmConversation,
  getConversationDetail,
  listConversationsByScope,
  listDmConversationsForUser,
  renameConversation,
  resolveMentionedConversationIdsForUser,
  resolveMentionedWorkspaceIds,
  updateConversationPinned,
} from '../control-plane/conversation-service'
import { deleteConversation } from '../storage/postgres/conversation-store'
import { resolveConversationAccess } from '../control-plane/conversation-access'
import { isWorkspaceMember, listUserWorkspaces } from '../repositories/workspace'
import { loadState } from '../storage/app-state-store'
import { listConversationMembers, listConversationMessages, updateConversationMessageReactions } from '../storage/postgres/conversation-store'
import { hasMessageReaction, toggleMessageReaction } from '@shared/message-reactions'
import { publishConversationMessageCreated, publishConversationMessageReactionChanged } from '../services/conversation-ws-service'
import { canSeeUser } from '../services/user-visibility-service'
import { getUserById } from '../storage/postgres/auth-store'
import { getScopedState, getUserIdFromHeader, jsonError } from './shared'
import { countConversationUnread, markConversationRead } from '../services/conversation-unread-service'
import { resolveMentionedDocRefs } from '../services/chat-doc-mentions'
import { createConversationMention } from '../repositories/conversation-share-store'

const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(32),
  active: z.boolean(),
})

const dmCreateSchema = z.object({
  peerUserId: z.string().trim().min(1),
  workspaceId: z.string().trim().optional(),
  /** 为 true 时不做查重，直接新建会话（同一私聊对象可开多个会话）。 */
  createNew: z.boolean().optional(),
  title: z.string().trim().max(120).optional(),
})

const messageSendSchema = z.object({
  content: z.string().trim().min(1).max(20000),
  replyToMessageId: z.string().trim().min(1).optional(),
  clientMessageId: z.string().uuid().optional(),
})

const conversationRenameSchema = z.object({
  title: z.string().trim().min(1).max(120),
})

const resolveDmPeer = (conversationId: string, viewerUserId: string) => {
  const peer = listConversationMembers(conversationId).find((member) => (
    member.memberType === 'user' && member.memberId !== viewerUserId && !member.leftAt
  ))
  if (peer) {
    const user = getUserById(peer.memberId)
    if (user) {
      return {
        userId: user.id,
        name: user.name,
        username: user.username ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
      }
    }
  }
  // 自己私聊（个人备忘会话）：成员只有 viewer 自己，peer 回退为自己，便于前端 DM 列表展示。
  const self = getUserById(viewerUserId)
  if (!self) {
    return null
  }
  return {
    userId: self.id,
    name: self.name,
    username: self.username ?? undefined,
    avatarUrl: self.avatarUrl ?? undefined,
  }
}

export const registerConversationRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 私聊（DM）：get-or-create 会话（跨空间开放，peerUserId 为任意注册用户）。
  app.post('/api/conversations/dm', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const payload = dmCreateSchema.parse(await c.req.json().catch(() => ({})))
    // 允许与自己私聊（个人备忘会话，类似文件传输助手）：底层 ensureDmConversation 已支持，
    // 此处不再拦截 peer === self。（2026-08-16）
    if (payload.peerUserId !== userId && !getUserById(payload.peerUserId)) {
      return jsonError(c, '私聊对象不存在。', 404)
    }
    const workspaceId = payload.workspaceId?.trim()
    if (workspaceId && !(await isWorkspaceMember(workspaceId, userId))) {
      return jsonError(c, '无权限在该组织发起私聊。', 403)
    }
    // 可见性（飞书式）：只能与本空间成员或本空间已连接好友私聊；未连接用户不可见。
    if (payload.peerUserId !== userId && !(await canSeeUser(userId, payload.peerUserId, workspaceId))) {
      return jsonError(c, '对方对当前组织不可见（需先添加该空间好友或加入该空间）。', 403)
    }

    try {
      const result = payload.createNew
        ? { conversation: createDmConversation({
          ownerUserId: userId,
          peerUserId: payload.peerUserId,
          workspaceId: payload.workspaceId,
          title: payload.title,
        }).conversation, created: true }
        : ensureDmConversation({
          ownerUserId: userId,
          peerUserId: payload.peerUserId,
          workspaceId: payload.workspaceId,
        })
      const peer = resolveDmPeer(result.conversation.id, userId)
      return c.json({
        conversation: result.conversation,
        created: result.created,
        peer,
      })
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : '创建私聊失败。', 400)
    }
  })

  // 会话重命名（私聊 DM 会话名可编辑；仅会话成员可改）。
  app.patch('/api/conversations/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const payload = conversationRenameSchema.parse(await c.req.json().catch(() => ({})))

    const access = await resolveConversationAccess({
      conversationId,
      viewer: { type: 'user', id: userId },
    })
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    if (access.conversation.kind !== 'dm') {
      return jsonError(c, '仅支持重命名私聊会话。', 400)
    }

    try {
      const conversation = renameConversation(conversationId, payload.title)
      return c.json({ conversation })
    } catch (error) {
      return jsonError(c, error instanceof Error ? error.message : '重命名失败。', 400)
    }
  })

  // 会话置顶 / 取消置顶（私聊、群聊会话）。
  app.patch('/api/conversations/:id/pin', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const payload = z.object({ pinned: z.boolean() }).parse(await c.req.json().catch(() => ({ pinned: true })))

    const access = await resolveConversationAccess({
      conversationId,
      viewer: { type: 'user', id: userId },
    })
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    if (access.conversation.kind !== 'dm' && access.conversation.kind !== 'workspace') {
      return jsonError(c, '仅支持置顶私聊与群聊会话。', 400)
    }

    const conversation = updateConversationPinned(conversationId, payload.pinned)
    if (!conversation) {
      return jsonError(c, '会话不存在。', 404)
    }
    return c.json({ conversation })
  })

  // 删除私聊 / 群聊会话（消息、成员、分享一并清除）。
  app.delete('/api/conversations/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')

    const access = await resolveConversationAccess({
      conversationId,
      viewer: { type: 'user', id: userId },
    })
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }
    if (access.conversation.kind !== 'dm' && access.conversation.kind !== 'workspace') {
      return jsonError(c, '仅支持删除私聊与群聊会话。', 400)
    }

    deleteConversation(conversationId)
    return c.json({ ok: true, message: '会话已删除。' })
  })

  // 私聊列表（含对方摘要 + 最新消息）。
  app.get('/api/conversations/dm', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const items = listDmConversationsForUser(userId).map((item) => {
      const peer = resolveDmPeer(item.conversation.id, userId)
      return {
        conversation: item.conversation,
        peer,
        messageCount: item.messageCount,
        latestMessage: item.latestMessage,
      }
    })
    return c.json({ conversations: items })
  })

  // 通用会话消息发送（私聊/群聊/任务会话共用；权限按会话成员校验）。
  app.post('/api/conversations/:id/messages', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const payload = messageSendSchema.parse(await c.req.json().catch(() => ({})))

    const access = await resolveConversationAccess({
      conversationId,
      viewer: { type: 'user', id: userId },
    })
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const user = getUserById(userId)

    // @文档：匹配个人 Drive 文件（reference_doc 引用）
    const mentionedDocRefs = await resolveMentionedDocRefs({
      message: payload.content,
      scopes: [{ workspaceId: null, userId }],
    })

    // @会话 / @工作区：引用型提及（不通知、不唤醒 Agent）
    const scopedState = getScopedState(loadState(), userId)
    const { mentionedIds: mentionedConversationIds, conversations: mentionableConversations } = resolveMentionedConversationIdsForUser({
      message: payload.content,
      userId,
      scopedState,
    })
    const userWorkspaces = await listUserWorkspaces(userId)
    const mentionedWorkspaceIds = resolveMentionedWorkspaceIds(
      payload.content,
      userWorkspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    )
    const hasMentions = mentionedDocRefs.length > 0 || mentionedConversationIds.size > 0 || mentionedWorkspaceIds.size > 0

    const message = appendConversationMessage({
      conversationId,
      role: 'user',
      senderId: userId,
      content: payload.content,
      contentType: 'text',
      replyToMessageId: payload.replyToMessageId,
      externalRef: {
        senderName: user?.name?.trim() || '用户',
        ...(payload.clientMessageId ? { clientMessageId: payload.clientMessageId } : {}),
        ...(hasMentions
          ? {
              mentions: [
                ...mentionedDocRefs.map((ref) => ({ targetType: 'doc' as const, targetId: ref.id })),
                ...[...mentionedConversationIds].map((targetId) => ({ targetType: 'conversation' as const, targetId })),
                ...[...mentionedWorkspaceIds].map((targetId) => ({ targetType: 'workspace' as const, targetId })),
              ],
              ...(mentionedDocRefs.length > 0 ? { referencedDocs: mentionedDocRefs } : {}),
            }
          : {}),
      },
    })
    publishConversationMessageCreated(conversationId, message)

    // @文档 记录持久化（旁路）：reference_doc 引用
    for (const docRef of mentionedDocRefs) {
      void createConversationMention({
        conversationId,
        messageId: message.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: docRef.id,
        mentionedType: 'doc',
        mentionScope: 'reference_doc',
        contextJson: { name: docRef.name },
      }).catch(() => {})
    }
    // @会话 / @工作区 记录持久化（旁路）：share_conversation / share_workspace 引用
    for (const targetConversationId of mentionedConversationIds) {
      const target = mentionableConversations.find((conversation) => conversation.id === targetConversationId)
      void createConversationMention({
        conversationId,
        messageId: message.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: targetConversationId,
        mentionedType: 'conversation',
        mentionScope: 'share_conversation',
        contextJson: { targetConversationId, targetTitle: target?.title ?? '' },
      }).catch(() => {})
    }
    for (const targetWorkspaceId of mentionedWorkspaceIds) {
      const target = userWorkspaces.find((workspace) => workspace.id === targetWorkspaceId)
      void createConversationMention({
        conversationId,
        messageId: message.id,
        mentionerId: userId,
        mentionerType: 'user',
        mentionedId: targetWorkspaceId,
        mentionedType: 'workspace',
        mentionScope: 'share_workspace',
        contextJson: { targetWorkspaceId, targetName: target?.name ?? '' },
      }).catch(() => {})
    }

    return c.json({ message })
  })

  app.get('/api/conversations', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const scopedState = getScopedState(loadState(), userId)
    const conversations = listConversationsByScope({
      projectIds: scopedState.projects.map((project) => project.id),
      taskIds: scopedState.tasks.map((task) => task.id),
    })

    return c.json({ conversations })
  })

  // feature P2：会话未读计数（按会话分组，返回 { [conversationId]: 未读数 }）。
  // 支持 ?ids=a,b,c 显式指定（主对话 kind='main' 会话不在 scoped 列表里，需显式传入）。
  app.get('/api/conversations/unread-counts', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const rawIds = c.req.query('ids')?.split(',').map((id) => id.trim()).filter(Boolean) ?? []
    let conversationIds: string[]
    if (rawIds.length > 0) {
      conversationIds = [...new Set(rawIds)]
    } else {
      const scopedState = getScopedState(loadState(), userId)
      const conversations = listConversationsByScope({
        projectIds: scopedState.projects.map((project) => project.id),
        taskIds: scopedState.tasks.map((task) => task.id),
      })
      conversationIds = conversations.map((item) => item.conversation.id)
    }
    const counts = await countConversationUnread({
      userId,
      conversationIds,
    })
    return c.json({ counts })
  })

  // feature P2：标记会话已读（打开会话时调用，lastReadAt 传会话最新消息时间）。
  app.post('/api/conversations/:id/read', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const payload = z.object({
      lastReadAt: z.string().optional(),
    }).parse(await c.req.json().catch(() => ({})))
    await markConversationRead({
      userId,
      conversationId,
      lastReadAt: payload.lastReadAt,
    })
    return c.json({ ok: true })
  })

  app.get('/api/conversations/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const detail = getConversationDetail(c.req.param('id'))
    if (!detail) {
      return jsonError(c, '会话不存在。', 404)
    }

    const scopedState = getScopedState(loadState(), userId)
    const conversations = listConversationsByScope({
      projectIds: scopedState.projects.map((project) => project.id),
      taskIds: scopedState.tasks.map((task) => task.id),
    })
    const scopedVisible = conversations.some((item) => item.conversation.id === detail.conversation.id)
    // 私聊（DM）不在 project/task scope 内：按会话成员校验（仅双方可见）。
    const dmAccess = detail.conversation.kind === 'dm'
      ? await resolveConversationAccess({
          conversationId: detail.conversation.id,
          viewer: { type: 'user', id: userId },
        })
      : null
    if (!scopedVisible && !(dmAccess?.ok)) {
      return jsonError(c, '无权限访问会话。', 403)
    }

    return c.json(detail)
  })

  // 消息表情回复/点赞 toggle（R8.1）：members/share/workspace-public 可见即可操作。
  app.put('/api/conversations/:id/messages/:messageId/reaction', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)!
    const conversationId = c.req.param('id')
    const messageId = c.req.param('messageId')
    const payload = reactionSchema.parse(await c.req.json().catch(() => ({})))

    const access = await resolveConversationAccess({
      conversationId,
      viewer: { type: 'user', id: userId },
    })
    if (!access.ok) {
      return jsonError(c, access.message, access.status)
    }

    const message = listConversationMessages(conversationId).find((item) => item.id === messageId)
    if (!message) {
      return jsonError(c, '消息不存在。', 404)
    }

    const nextReactions = toggleMessageReaction(message.reactions, payload.emoji, userId, payload.active)
    updateConversationMessageReactions({
      messageId,
      conversationId,
      reactions: nextReactions,
    })
    publishConversationMessageReactionChanged({
      conversationId,
      messageId,
      reactions: nextReactions,
    })

    return c.json({
      reactions: nextReactions,
      reacted: hasMessageReaction(nextReactions, payload.emoji, userId),
    })
  })
}
