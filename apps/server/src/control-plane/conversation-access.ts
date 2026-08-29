import { isWorkspaceMember } from '../repositories/workspace'
import { getMainChatSessionById } from '../storage/app-state-store'
import {
  getConversation,
  listAllConversationMembers,
  listSharesBySource,
  type ConversationMemberRecord,
  type ConversationMemberType,
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationShareRecord,
  type ConversationShareSourceKind,
} from '../storage/conversation-store'
import type { MainChatSession } from '@shared/types'

export type ConversationViewer = {
  type: ConversationMemberType
  id: string
}

export type ConversationAccessResult =
  | {
      ok: true
      level: 'member' | 'share' | 'workspace'
      conversation: ConversationRecord
      membership?: ConversationMemberRecord
      share?: ConversationShareRecord
    }
  | {
      ok: false
      status: 403 | 404
      message: string
    }

export type MainChatSessionAccessResult =
  | {
      ok: true
      level: 'share' | 'public'
      session: MainChatSession
      share?: ConversationShareRecord
    }
  | {
      ok: false
      status: 403 | 404
      message: string
    }

const isShareUsable = (share: ConversationShareRecord, now: string) => {
  if (share.revokedAt) {
    return false
  }
  if (share.expiresAt && share.expiresAt <= now) {
    return false
  }
  return true
}

const findShareForViewer = (
  sourceKind: ConversationShareSourceKind,
  sourceId: string,
  viewer: ConversationViewer,
  now: string,
) => {
  const shares = listSharesBySource(sourceKind, sourceId)
  return shares.find((share) => (
    isShareUsable(share, now)
    && share.targetType === viewer.type
    && share.targetId === viewer.id
  ))
}

export const resolveConversationAccess = async (params: {
  conversationId: string
  viewer: ConversationViewer
  workspaceId?: string
}): Promise<ConversationAccessResult> => {
  const conversation = getConversation(params.conversationId)
  if (!conversation) {
    return { ok: false, status: 404, message: '会话不存在。' }
  }

  const members = listAllConversationMembers(conversation.id)
  const membership = members.find((member) => (
    !member.leftAt
    && member.memberType === params.viewer.type
    && member.memberId === params.viewer.id
  ))
  if (membership) {
    return { ok: true, level: 'member', conversation, membership }
  }

  const now = new Date().toISOString()
  const share = findShareForViewer('conversation', conversation.id, params.viewer, now)
  if (share) {
    return { ok: true, level: 'share', conversation, share }
  }

  if (
    conversation.visibility === 'public'
    && params.viewer.type === 'user'
    && conversation.workspaceId
    && (await isWorkspaceMember(conversation.workspaceId, params.viewer.id))
  ) {
    return { ok: true, level: 'workspace', conversation }
  }

  return { ok: false, status: 403, message: '无权限访问该会话。' }
}

export const resolveMainChatSessionAccess = (params: {
  sessionId: string
  viewer: ConversationViewer
}): MainChatSessionAccessResult => {
  const session = getMainChatSessionById(params.sessionId)
  if (!session) {
    return { ok: false, status: 404, message: '会话不存在。' }
  }

  const now = new Date().toISOString()
  const share = findShareForViewer('main_chat', params.sessionId, params.viewer, now)
  if (share) {
    return { ok: true, level: 'share', session, share }
  }

  // R10.1-B：private 会话仅 owner 与显式分享可见。
  if (params.viewer.type === 'user' && session.ownerUserId === params.viewer.id) {
    return { ok: true, level: 'share', session }
  }

  if (session.visibility !== 'private') {
    return { ok: true, level: 'public', session }
  }

  return { ok: false, status: 403, message: '无权限访问该会话。' }
}

export const filterMessagesForMembership = (
  messages: ConversationMessageRecord[],
  membership: ConversationMemberRecord | undefined,
) => {
  if (!membership) {
    return messages
  }

  return messages.filter((message) => (
    message.createdAt >= membership.joinedAt
    && (!membership.leftAt || message.createdAt < membership.leftAt)
  ))
}

export const resolveMembershipWindow = (conversationId: string, viewer: ConversationViewer) => {
  const members = listAllConversationMembers(conversationId)
  return members.find((member) => member.memberType === viewer.type && member.memberId === viewer.id)
}
