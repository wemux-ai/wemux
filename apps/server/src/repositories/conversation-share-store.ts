// [INPUT]: 会话分享与 @ 记录领域输入
// [OUTPUT]: conversation_shares / conversation_mentions 表 CRUD
// [POS]: 会话分享与 @ 记录存储层；鉴权在路由层
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type {
  ConversationMentionRecord,
  ConversationMentionScope,
  ConversationMentionStatus,
  ConversationMentionType,
  ConversationShareRecord,
  ConversationShareType,
} from '@shared/types'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { conversationMentions, conversationShares } from '../storage/postgres/schema-core'

const nowIso = () => new Date().toISOString()

// ---------- 会话分享 ----------

export const createConversationShare = async (input: {
  conversationId: string
  messageId?: string | null
  sharedBy: string
  sharedByType: 'user' | 'agent'
  shareType?: ConversationShareType
  targetConversationId?: string | null
  accessScope?: ConversationShareRecord['accessScope']
  shareToken?: string | null
  expiresAt?: string | null
  metadataJson?: unknown | null
}): Promise<ConversationShareRecord> => {
  const record: ConversationShareRecord = {
    id: randomUUID(),
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    sharedBy: input.sharedBy,
    sharedByType: input.sharedByType,
    shareType: input.shareType ?? 'link',
    targetConversationId: input.targetConversationId ?? null,
    accessScope: input.accessScope ?? 'members',
    shareToken: input.shareToken ?? null,
    expiresAt: input.expiresAt ?? null,
    metadataJson: input.metadataJson ?? null,
    createdAt: nowIso(),
  }
  await getDrizzleDb().insert(conversationShares).values(record)
  return record
}

export const listConversationShares = async (conversationId: string): Promise<ConversationShareRecord[]> => {
  return getDrizzleDb()
    .select()
    .from(conversationShares)
    .where(eq(conversationShares.conversationId, conversationId))
    .orderBy(desc(conversationShares.createdAt))
}

export const getConversationShareById = async (shareId: string): Promise<ConversationShareRecord | null> => {
  const rows = await getDrizzleDb().select().from(conversationShares).where(eq(conversationShares.id, shareId)).limit(1)
  return rows[0] ?? null
}

export const getConversationShareByToken = async (token: string): Promise<ConversationShareRecord | null> => {
  const rows = await getDrizzleDb().select().from(conversationShares).where(eq(conversationShares.shareToken, token)).limit(1)
  return rows[0] ?? null
}

export const deleteConversationShare = async (shareId: string): Promise<void> => {
  await getDrizzleDb().delete(conversationShares).where(eq(conversationShares.id, shareId))
}

// ---------- @ 记录 ----------

export const createConversationMention = async (input: {
  conversationId: string
  messageId?: string | null
  mentionerId: string
  mentionerType: 'user' | 'agent'
  mentionedId: string
  mentionedType: ConversationMentionType
  mentionScope?: ConversationMentionScope
  contextJson?: unknown | null
}): Promise<ConversationMentionRecord> => {
  const record: ConversationMentionRecord = {
    id: randomUUID(),
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    mentionerId: input.mentionerId,
    mentionerType: input.mentionerType,
    mentionedId: input.mentionedId,
    mentionedType: input.mentionedType,
    mentionScope: input.mentionScope ?? 'agent_in_chat',
    contextJson: input.contextJson ?? null,
    status: 'pending',
    createdAt: nowIso(),
  }
  await getDrizzleDb().insert(conversationMentions).values(record)
  return record
}

export const listPendingMentionsFor = async (mentionedId: string): Promise<ConversationMentionRecord[]> => {
  return getDrizzleDb()
    .select()
    .from(conversationMentions)
    .where(and(eq(conversationMentions.mentionedId, mentionedId), eq(conversationMentions.status, 'pending')))
    .orderBy(asc(conversationMentions.createdAt))
}

export const updateMentionStatus = async (mentionId: string, status: ConversationMentionStatus): Promise<boolean> => {
  const result = await getDrizzleDb()
    .update(conversationMentions)
    .set({ status })
    .where(eq(conversationMentions.id, mentionId))
  return (result.rowCount ?? 0) > 0
}

export const listConversationMentions = async (conversationId: string): Promise<ConversationMentionRecord[]> => {
  return getDrizzleDb()
    .select()
    .from(conversationMentions)
    .where(eq(conversationMentions.conversationId, conversationId))
    .orderBy(desc(conversationMentions.createdAt))
}
