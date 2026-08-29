import { and, desc, eq, ne, sql } from 'drizzle-orm'

import type {
  ConversationChatMode as SharedConversationChatMode,
  ConversationExternalSyncMode,
  ConversationKind as SharedConversationKind,
  ConversationMessageContentType,
  ConversationMessageRecord as SharedConversationMessageRecord,
  ConversationRecord as SharedConversationRecord,
  ConversationStatus as SharedConversationStatus,
} from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import { cloneJson, schedulePersistence } from './helpers'
import { channelBindings, conversationMembers, conversations, messages, sessionShares } from './schema'
import { registerDriveFileReference } from '../../repositories/drive-store'
import { clearDriveFileReferencesByRef } from '../../repositories/drive-store'

/** 消息落库时登记 drive 引用附件（R8.3 孤儿判定基础）。 */
const registerDriveRefsFromMessage = (message: ConversationMessageRecord) => {
  const attachments = message.externalRef?.attachments
  if (!Array.isArray(attachments)) {
    return
  }
  for (const attachment of attachments) {
    const driveFileId = attachment?.driveFileId?.trim()
    if (!driveFileId) {
      continue
    }
    void registerDriveFileReference({
      fileId: driveFileId,
      refType: 'conversation_message',
      refId: message.id,
    }).catch((error) => {
      console.error('[conversation-store] failed to register drive reference', error)
    })
  }
}

export type ConversationKind = SharedConversationKind
export type ConversationChatMode = SharedConversationChatMode
export type ConversationStatus = SharedConversationStatus
export type ExternalSyncMode = ConversationExternalSyncMode
export type MessageSenderType = ConversationMessageRecord['role']
export type MessageContentType = ConversationMessageContentType
export type ChannelType = 'telegram' | 'feishu' | 'wechat' | 'discord' | 'slack' | 'wecom' | 'whatsapp' | 'dingtalk'
export type BindingMode = 'mirror' | 'bidirectional'
export type ConversationMemberType = 'user' | 'agent'
export type ConversationMemberRole = 'owner' | 'member' | 'orchestrator'
export type ConversationVisibility = 'public' | 'private'
export type ConversationShareSourceKind = 'conversation' | 'main_chat' | 'workspace_session'
export type ConversationShareTargetType = 'user' | 'agent' | 'link'
export type ConversationSharePermission = 'read' | 'comment'

export type ConversationRecord = SharedConversationRecord

export type ConversationMessageRecord = SharedConversationMessageRecord

export type ChannelBindingRecord = {
  id: string
  workspaceId?: string
  projectId?: string
  taskId?: string
  conversationId: string
  channelType: ChannelType
  externalChatId: string
  externalThreadId?: string
  bindingMode: BindingMode
  createdAt: string
  updatedAt: string
}

export type ConversationMemberRecord = {
  id: string
  conversationId: string
  memberType: ConversationMemberType
  memberId: string
  role: ConversationMemberRole
  /** 拉入该成员的会话成员（@临时拉群时记录） */
  invitedBy?: string
  /** 成员在场窗口起点；@临时拉群踢出后用 joinedAt/leftAt 过滤历史消息 */
  joinedAt: string
  /** 成员被踢出时间；undefined 表示仍在场 */
  leftAt?: string
  createdAt: string
  updatedAt: string
}

export type ConversationShareRecord = {
  id: string
  sourceKind: ConversationShareSourceKind
  sourceId: string
  workspaceId?: string
  targetType: ConversationShareTargetType
  targetId?: string
  permission: ConversationSharePermission
  shareTokenHash?: string
  createdBy: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
  expiresAt?: string
}

type ConversationRow = typeof conversations.$inferSelect
type ConversationMessageRow = typeof messages.$inferSelect
type ChannelBindingRow = typeof channelBindings.$inferSelect
type ConversationMemberRow = typeof conversationMembers.$inferSelect
type SessionShareRow = typeof sessionShares.$inferSelect

const cache = {
  conversations: [] as ConversationRecord[],
  messages: new Map<string, ConversationMessageRecord[]>(),
  channelBindings: [] as ChannelBindingRecord[],
  members: new Map<string, ConversationMemberRecord[]>(),
  shares: [] as ConversationShareRecord[],
}

const compareUpdatedAtDesc = (left: { updatedAt: string }, right: { updatedAt: string }) => {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
}

const sortConversationsByUpdatedAt = () => {
  cache.conversations.sort(compareUpdatedAtDesc)
}

const touchConversation = (conversationId: string, updatedAt: string) => {
  const index = cache.conversations.findIndex((conversation) => conversation.id === conversationId)
  if (index < 0) {
    return
  }

  const current = cache.conversations[index]
  const nextConversation: ConversationRecord = {
    ...current,
    updatedAt: updatedAt > current.updatedAt ? updatedAt : current.updatedAt,
  }

  cache.conversations[index] = nextConversation
  sortConversationsByUpdatedAt()
  schedulePersistence(
    `touch-conversation:${nextConversation.id}`,
    getDrizzleDb()
      .update(conversations)
      .set({ updatedAt: nextConversation.updatedAt })
      .where(eq(conversations.id, nextConversation.id)),
  )
}

const mapConversationRow = (row: ConversationRow): ConversationRecord => ({
  id: row.id,
  workspaceId: row.workspaceId ?? undefined,
  workspaceSessionId: row.workspaceSessionId ?? undefined,
  projectId: row.projectId ?? undefined,
  taskId: row.taskId ?? undefined,
  groupId: row.groupId ?? undefined,
  title: row.title,
  kind: row.kind,
  chatMode: row.chatMode,
  status: row.status,
  externalSyncMode: row.externalSyncMode,
  orchestratorAgentId: row.orchestratorAgentId ?? undefined,
  executorId: row.executorId ?? undefined,
  createdBy: row.createdBy ?? undefined,
  visibility: row.visibility ?? 'public',
  description: row.description ?? undefined,
  announcement: row.announcement ?? undefined,
  announcementUpdatedAt: row.announcementUpdatedAt ?? undefined,
  announcementUpdatedBy: row.announcementUpdatedBy ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapConversationMessageRow = (row: ConversationMessageRow): ConversationMessageRecord => ({
  id: row.id,
  conversationId: row.conversationId,
  role: row.role ?? 'assistant',
  senderId: row.senderId ?? undefined,
  authorName: row.authorName ?? undefined,
  content: row.content,
  contentType: row.contentType,
  replyToMessageId: row.replyToMessageId ?? undefined,
  externalRef: row.externalRefJson ?? undefined,
  reactions: row.reactionsJson?.length ? row.reactionsJson : undefined,
  createdAt: row.createdAt,
})

const mapChannelBindingRow = (row: ChannelBindingRow): ChannelBindingRecord => ({
  id: row.id,
  workspaceId: row.workspaceId ?? undefined,
  projectId: row.projectId ?? undefined,
  taskId: row.taskId ?? undefined,
  conversationId: row.conversationId,
  channelType: row.channelType,
  externalChatId: row.externalChatId,
  externalThreadId: row.externalThreadId ?? undefined,
  bindingMode: row.bindingMode,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapConversationMemberRow = (row: ConversationMemberRow): ConversationMemberRecord => ({
  id: row.id,
  conversationId: row.conversationId,
  memberType: row.memberType,
  memberId: row.memberId,
  role: row.role,
  invitedBy: row.invitedBy ?? undefined,
  joinedAt: row.joinedAt,
  leftAt: row.leftAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const mapSessionShareRow = (row: SessionShareRow): ConversationShareRecord => ({
  id: row.id,
  sourceKind: row.sourceKind,
  sourceId: row.sourceId,
  workspaceId: row.workspaceId ?? undefined,
  targetType: row.targetType,
  targetId: row.targetId ?? undefined,
  permission: row.permission,
  shareTokenHash: row.shareTokenHash ?? undefined,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  revokedAt: row.revokedAt ?? undefined,
  expiresAt: row.expiresAt ?? undefined,
})

export const initConversationStore = async () => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  // 主对话（kind='main'）由 thread-message-store 独立管理并已进 uiStateCache，
  // 这里排除掉，避免同一份数据在两个内存 cache 里重复，也防止它泄漏进群聊/任务会话列表。
  const [conversationRows, messageRows, bindingRows, memberRows, shareRows] = await Promise.all([
    db.select().from(conversations).where(ne(conversations.kind, 'main')).orderBy(desc(conversations.updatedAt)),
    db.select().from(messages).where(sql`${messages.conversationId} NOT IN (SELECT id FROM ${conversations} WHERE kind = 'main')`).orderBy(messages.createdAt),
    db.select().from(channelBindings).orderBy(desc(channelBindings.updatedAt)),
    db.select().from(conversationMembers).orderBy(desc(conversationMembers.updatedAt)),
    db.select().from(sessionShares).orderBy(desc(sessionShares.updatedAt)),
  ])

  cache.conversations = conversationRows.map(mapConversationRow)
  cache.messages = new Map()
  for (const row of messageRows) {
    const message = mapConversationMessageRow(row)
    cache.messages.set(
      message.conversationId,
      [...(cache.messages.get(message.conversationId) ?? []), message],
    )
  }
  cache.channelBindings = bindingRows.map(mapChannelBindingRow)
  cache.members = new Map()
  for (const row of memberRows) {
    const member = mapConversationMemberRow(row)
    cache.members.set(
      member.conversationId,
      [...(cache.members.get(member.conversationId) ?? []), member],
    )
  }
  cache.shares = shareRows.map(mapSessionShareRow)
}

export const listConversations = () => cloneJson(cache.conversations)

export const getConversation = (conversationId: string) => {
  return cloneJson(cache.conversations.find((conversation) => conversation.id === conversationId) ?? null)
}

/** 轻量消息摘要：只返回计数与最后一条，避免群列表场景深克隆整段消息数组。 */
export const getConversationMessageSummary = (conversationId: string) => {
  const messages = cache.messages.get(conversationId) ?? []
  const latestMessage = messages.at(-1)
  return {
    messageCount: messages.length,
    latestMessage: latestMessage ? cloneJson(latestMessage) : undefined,
  }
}

/** 轻量判断：会话里是否已存在某个 turnId 的消息（不深克隆整段消息数组）。 */
export const hasConversationMessageWithTurnId = (conversationId: string, turnId: string) => {
  const normalizedTurnId = turnId.trim()
  if (!normalizedTurnId) {
    return false
  }

  const messages = cache.messages.get(conversationId) ?? []
  return messages.some((message) => {
    const messageTurnId = message.externalRef?.turnId
    return typeof messageTurnId === 'string' && messageTurnId.trim() === normalizedTurnId
  })
}

export const getTaskConversation = (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
  return cloneJson(
    cache.conversations.find((conversation) => (
      conversation.kind === 'task'
      && conversation.taskId === taskId
      && ((workspaceSessionId?.trim()) ? conversation.workspaceSessionId === workspaceSessionId.trim() : true)
      && (workspaceId ? conversation.workspaceId === workspaceId : !conversation.workspaceId)
    ))
    ?? null,
  )
}

export const listWorkspaceGroupConversations = (workspaceId: string) => {
  const normalizedWorkspaceId = workspaceId.trim()
  return cloneJson(
    cache.conversations.filter((conversation) => {
      return conversation.workspaceId === normalizedWorkspaceId
        && conversation.kind === 'workspace'
        && conversation.chatMode === 'group'
        && ((conversation.groupId?.trim() || conversation.id) === conversation.id)
    }),
  )
}

export const listGroupSessions = (groupId: string) => {
  const normalizedGroupId = groupId.trim()
  return cloneJson(
    cache.conversations.filter((conversation) => {
      return conversation.kind === 'workspace'
        && conversation.chatMode === 'group'
        && ((conversation.groupId?.trim() || conversation.id) === normalizedGroupId)
    }).sort(compareUpdatedAtDesc),
  )
}

export const getConversationByChannelBinding = (
  channelType: ChannelType,
  externalChatId: string,
  externalThreadId?: string,
) => {
  const binding = cache.channelBindings.find((item) => (
    item.channelType === channelType
    && item.externalChatId === externalChatId
    && (item.externalThreadId ?? '') === (externalThreadId ?? '')
  ))

  if (!binding) {
    return null
  }

  return getConversation(binding.conversationId)
}

export const listConversationMessages = (conversationId: string) => {
  return cloneJson(cache.messages.get(conversationId) ?? [])
}

export const listConversationChannelBindings = (conversationId: string) => {
  return cloneJson(
    cache.channelBindings.filter((binding) => binding.conversationId === conversationId),
  )
}

/** 在场成员（@临时拉群踢出后不再出现）。 */
export const listConversationMembers = (conversationId: string) => {
  return cloneJson((cache.members.get(conversationId) ?? []).filter((member) => !member.leftAt))
}

/** 全部成员（含已踢出成员），用于成员在场窗口计算与重新拉入。 */
export const listAllConversationMembers = (conversationId: string) => {
  return cloneJson(cache.members.get(conversationId) ?? [])
}

export const getChannelBinding = (
  channelType: ChannelType,
  externalChatId: string,
  externalThreadId?: string,
) => {
  return cloneJson(
    cache.channelBindings.find((item) => (
      item.channelType === channelType
      && item.externalChatId === externalChatId
      && (item.externalThreadId ?? '') === (externalThreadId ?? '')
    )) ?? null,
  )
}

export const listTaskChannelBindings = (taskId: string) => {
  return cloneJson(cache.channelBindings.filter((binding) => binding.taskId === taskId))
}

export const saveConversation = (conversation: ConversationRecord) => {
  const nextConversation = cloneJson(conversation)
  cache.conversations = cache.conversations
    .filter((item) => item.id !== nextConversation.id)
    .concat(nextConversation)

  sortConversationsByUpdatedAt()

  schedulePersistence(
    `save-conversation:${nextConversation.id}`,
    getDrizzleDb()
      .insert(conversations)
      .values({
        id: nextConversation.id,
        workspaceId: nextConversation.workspaceId ?? null,
        workspaceSessionId: nextConversation.workspaceSessionId ?? null,
        projectId: nextConversation.projectId ?? null,
        taskId: nextConversation.taskId ?? null,
        groupId: nextConversation.groupId ?? null,
        title: nextConversation.title,
        kind: nextConversation.kind,
        chatMode: nextConversation.chatMode,
        status: nextConversation.status,
        externalSyncMode: nextConversation.externalSyncMode,
        orchestratorAgentId: nextConversation.orchestratorAgentId ?? null,
        executorId: nextConversation.executorId ?? null,
        createdBy: nextConversation.createdBy ?? null,
        visibility: nextConversation.visibility ?? 'public',
        description: nextConversation.description ?? null,
        announcement: nextConversation.announcement ?? null,
        announcementUpdatedAt: nextConversation.announcementUpdatedAt ?? null,
        announcementUpdatedBy: nextConversation.announcementUpdatedBy ?? null,
        pinnedAt: nextConversation.pinnedAt ?? null,
        createdAt: nextConversation.createdAt,
        updatedAt: nextConversation.updatedAt,
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          workspaceId: nextConversation.workspaceId ?? null,
          workspaceSessionId: nextConversation.workspaceSessionId ?? null,
          projectId: nextConversation.projectId ?? null,
          taskId: nextConversation.taskId ?? null,
          groupId: nextConversation.groupId ?? null,
          title: nextConversation.title,
          kind: nextConversation.kind,
          chatMode: nextConversation.chatMode,
          status: nextConversation.status,
          externalSyncMode: nextConversation.externalSyncMode,
          orchestratorAgentId: nextConversation.orchestratorAgentId ?? null,
          executorId: nextConversation.executorId ?? null,
          createdBy: nextConversation.createdBy ?? null,
          visibility: nextConversation.visibility ?? 'public',
          description: nextConversation.description ?? null,
          announcement: nextConversation.announcement ?? null,
          announcementUpdatedAt: nextConversation.announcementUpdatedAt ?? null,
          announcementUpdatedBy: nextConversation.announcementUpdatedBy ?? null,
          pinnedAt: nextConversation.pinnedAt ?? null,
          updatedAt: nextConversation.updatedAt,
        },
      }),
  )
}

export const deleteConversation = (conversationId: string) => {
  cache.conversations = cache.conversations.filter((conversation) => conversation.id !== conversationId)
  cache.messages.delete(conversationId)
  cache.members.delete(conversationId)
  cache.channelBindings = cache.channelBindings.filter((binding) => binding.conversationId !== conversationId)
  cache.shares = cache.shares.filter((share) => share.sourceKind === 'conversation' && share.sourceId !== conversationId)

  schedulePersistence(
    `delete-conversation:${conversationId}`,
    withDrizzleTransaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.conversationId, conversationId))
      await tx.delete(conversationMembers).where(eq(conversationMembers.conversationId, conversationId))
      await tx.delete(channelBindings).where(eq(channelBindings.conversationId, conversationId))
      await tx.delete(sessionShares).where(and(eq(sessionShares.sourceKind, 'conversation'), eq(sessionShares.sourceId, conversationId)))
      await tx.delete(conversations).where(eq(conversations.id, conversationId))
    }),
  )
}

export const saveConversationMember = (member: ConversationMemberRecord) => {
  const nextMember = cloneJson(member)
  const previous = cache.members.get(nextMember.conversationId) ?? []
  const nextMembers = previous
    .filter((item) => item.id !== nextMember.id && !(item.memberType === nextMember.memberType && item.memberId === nextMember.memberId))
    .concat(nextMember)
    .sort(compareUpdatedAtDesc)

  cache.members.set(nextMember.conversationId, nextMembers)

  schedulePersistence(
    `save-conversation-member:${nextMember.id}`,
    getDrizzleDb()
      .insert(conversationMembers)
      .values({
        id: nextMember.id,
        conversationId: nextMember.conversationId,
        memberType: nextMember.memberType,
        memberId: nextMember.memberId,
        role: nextMember.role,
        invitedBy: nextMember.invitedBy ?? null,
        joinedAt: nextMember.joinedAt,
        leftAt: nextMember.leftAt ?? null,
        createdAt: nextMember.createdAt,
        updatedAt: nextMember.updatedAt,
      })
      .onConflictDoUpdate({
        target: [conversationMembers.conversationId, conversationMembers.memberType, conversationMembers.memberId],
        set: {
          role: nextMember.role,
          invitedBy: nextMember.invitedBy ?? null,
          joinedAt: nextMember.joinedAt,
          leftAt: nextMember.leftAt ?? null,
          updatedAt: nextMember.updatedAt,
        },
      }),
  )
}

/** 软删除成员：记录 leftAt，之后该成员不可再看其在场窗口之外的历史。 */
export const deleteConversationMember = (conversationId: string, memberType: ConversationMemberType, memberId: string) => {
  const previous = cache.members.get(conversationId) ?? []
  const target = previous.find((member) => member.memberType === memberType && member.memberId === memberId)
  if (!target) {
    return
  }

  const timestamp = new Date().toISOString()
  const nextMember: ConversationMemberRecord = { ...target, leftAt: timestamp, updatedAt: timestamp }
  cache.members.set(
    conversationId,
    previous.map((member) => (member.id === nextMember.id ? nextMember : member)),
  )

  schedulePersistence(
    `delete-conversation-member:${conversationId}:${memberType}:${memberId}`,
    getDrizzleDb()
      .update(conversationMembers)
      .set({ leftAt: timestamp, updatedAt: timestamp })
      .where(and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.memberType, memberType),
        eq(conversationMembers.memberId, memberId),
      )),
  )
}

/** 重新拉入此前被踢出的成员：清除 leftAt 并重置 joinedAt。 */
export const restoreConversationMember = (conversationId: string, memberType: ConversationMemberType, memberId: string) => {
  const previous = cache.members.get(conversationId) ?? []
  const target = previous.find((member) => member.memberType === memberType && member.memberId === memberId)
  if (!target) {
    return null
  }

  const timestamp = new Date().toISOString()
  const nextMember: ConversationMemberRecord = { ...target, joinedAt: timestamp, leftAt: undefined, updatedAt: timestamp }
  saveConversationMember(nextMember)
  return nextMember
}

export const listSharesBySource = (sourceKind: ConversationShareSourceKind, sourceId: string) => {
  return cloneJson(cache.shares.filter((share) => share.sourceKind === sourceKind && share.sourceId === sourceId))
}

export const listSharesByTarget = (targetType: ConversationShareTargetType, targetId: string) => {
  return cloneJson(cache.shares.filter((share) => share.targetType === targetType && share.targetId === targetId))
}

export const getShareByTokenHash = (shareTokenHash: string) => {
  return cloneJson(cache.shares.find((share) => share.shareTokenHash === shareTokenHash) ?? null)
}

export const getShare = (shareId: string) => {
  return cloneJson(cache.shares.find((share) => share.id === shareId) ?? null)
}

export const saveConversationShare = (share: ConversationShareRecord) => {
  const nextShare = cloneJson(share)
  cache.shares = cache.shares.filter((item) => item.id !== nextShare.id).concat(nextShare)

  schedulePersistence(
    `save-conversation-share:${nextShare.id}`,
    getDrizzleDb()
      .insert(sessionShares)
      .values({
        id: nextShare.id,
        sourceKind: nextShare.sourceKind,
        sourceId: nextShare.sourceId,
        workspaceId: nextShare.workspaceId ?? null,
        targetType: nextShare.targetType,
        targetId: nextShare.targetId ?? null,
        permission: nextShare.permission,
        shareTokenHash: nextShare.shareTokenHash ?? null,
        createdBy: nextShare.createdBy,
        createdAt: nextShare.createdAt,
        updatedAt: nextShare.updatedAt,
        revokedAt: nextShare.revokedAt ?? null,
        expiresAt: nextShare.expiresAt ?? null,
      })
      .onConflictDoUpdate({
        // 以 PK 为冲突目标：link 分享的 target_id 为 NULL，Postgres 的唯一约束不会
        // 命中 NULL（NULL != NULL），复合键只作数据完整性护栏。
        target: sessionShares.id,
        set: {
          sourceKind: nextShare.sourceKind,
          sourceId: nextShare.sourceId,
          workspaceId: nextShare.workspaceId ?? null,
          targetType: nextShare.targetType,
          targetId: nextShare.targetId ?? null,
          permission: nextShare.permission,
          shareTokenHash: nextShare.shareTokenHash ?? null,
          createdBy: nextShare.createdBy,
          revokedAt: nextShare.revokedAt ?? null,
          expiresAt: nextShare.expiresAt ?? null,
        },
      }),
  )
}

export const saveConversationMessage = (message: ConversationMessageRecord) => {
  const nextMessage = cloneJson(message)
  registerDriveRefsFromMessage(nextMessage)
  cache.messages.set(
    nextMessage.conversationId,
    [...(cache.messages.get(nextMessage.conversationId) ?? []), nextMessage],
  )
  touchConversation(nextMessage.conversationId, nextMessage.createdAt)

  schedulePersistence(
    `save-conversation-message:${nextMessage.id}`,
    withDrizzleTransaction(async (tx) => {
      /**
       * 对齐 thread-message-store 的 pg_advisory_xact_lock + MAX 模式：同一 conversation
       * 的多条消息可能连续触发未 await 的写入（如批量导入），必须串行分配 seq，
       * 否则会撞上 messages 表的 UNIQUE(conversation_id, seq) 约束导致静默丢消息。
       */
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${nextMessage.conversationId}))`)
      const rows = await tx
        .select({
          lastSeq: sql<number>`COALESCE(MAX(${messages.seq}), 0)`.mapWith(Number),
        })
        .from(messages)
        .where(eq(messages.conversationId, nextMessage.conversationId))
      const nextSeq = (rows[0]?.lastSeq ?? 0) + 1

      await tx
        .insert(messages)
        .values({
          id: nextMessage.id,
          conversationId: nextMessage.conversationId,
          role: nextMessage.role,
          senderId: nextMessage.senderId ?? null,
          authorName: nextMessage.authorName ?? null,
          content: nextMessage.content,
          contentType: nextMessage.contentType,
          replyToMessageId: nextMessage.replyToMessageId ?? null,
          externalRefJson: nextMessage.externalRef ?? {},
          reactionsJson: nextMessage.reactions ?? [],
          seq: nextSeq,
          createdAt: nextMessage.createdAt,
        })
    }),
  )
}

/**
 * 更新单条消息的 reactions（表情回复/点赞 toggle）。不改写 seq；同时刷新缓存供读路径即时可见。
 */
export const updateConversationMessageReactions = (params: {
  messageId: string
  conversationId: string
  reactions: ConversationMessageRecord['reactions']
}) => {
  const normalizedReactions = params.reactions ?? []
  const existing = cache.messages.get(params.conversationId) ?? []
  cache.messages.set(
    params.conversationId,
    existing.map((message) => (
      message.id === params.messageId
        ? { ...message, reactions: normalizedReactions.length ? normalizedReactions : undefined }
        : message
    )),
  )

  schedulePersistence(
    `update-conversation-message-reactions:${params.messageId}`,
    getDrizzleDb()
      .update(messages)
      .set({ reactionsJson: normalizedReactions })
      .where(and(eq(messages.id, params.messageId), eq(messages.conversationId, params.conversationId))),
  )
}

export const deleteConversationMessage = (messageId: string, conversationId: string) => {
  const existing = cache.messages.get(conversationId) ?? []
  cache.messages.set(
    conversationId,
    existing.filter((msg) => msg.id !== messageId),
  )

  void clearDriveFileReferencesByRef('conversation_message', messageId).catch((error) => {
    console.error('[conversation-store] failed to clear drive references', error)
  })

  schedulePersistence(
    `delete-conversation-message:${messageId}`,
    getDrizzleDb()
      .delete(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId))),
  )
}

export const saveChannelBinding = (binding: ChannelBindingRecord) => {
  const nextBinding = cloneJson(binding)
  const index = cache.channelBindings.findIndex((item) => item.id === nextBinding.id)

  if (index >= 0) {
    cache.channelBindings[index] = nextBinding
  } else {
    const existingIndex = cache.channelBindings.findIndex((item) => (
      item.channelType === nextBinding.channelType
      && item.externalChatId === nextBinding.externalChatId
      && (item.externalThreadId ?? '') === (nextBinding.externalThreadId ?? '')
    ))

    if (existingIndex >= 0) {
      cache.channelBindings[existingIndex] = nextBinding
    } else {
      cache.channelBindings.unshift(nextBinding)
    }
  }

  cache.channelBindings.sort(compareUpdatedAtDesc)

  schedulePersistence(
    `save-channel-binding:${nextBinding.id}`,
    getDrizzleDb()
      .insert(channelBindings)
      .values({
        id: nextBinding.id,
        workspaceId: nextBinding.workspaceId ?? null,
        projectId: nextBinding.projectId ?? null,
        taskId: nextBinding.taskId ?? null,
        conversationId: nextBinding.conversationId,
        channelType: nextBinding.channelType,
        externalChatId: nextBinding.externalChatId,
        externalThreadId: nextBinding.externalThreadId ?? null,
        bindingMode: nextBinding.bindingMode,
        createdAt: nextBinding.createdAt,
        updatedAt: nextBinding.updatedAt,
      })
      .onConflictDoUpdate({
        target: channelBindings.id,
        set: {
          workspaceId: nextBinding.workspaceId ?? null,
          projectId: nextBinding.projectId ?? null,
          taskId: nextBinding.taskId ?? null,
          conversationId: nextBinding.conversationId,
          channelType: nextBinding.channelType,
          externalChatId: nextBinding.externalChatId,
          externalThreadId: nextBinding.externalThreadId ?? null,
          bindingMode: nextBinding.bindingMode,
          updatedAt: nextBinding.updatedAt,
        },
      }),
  )
}
