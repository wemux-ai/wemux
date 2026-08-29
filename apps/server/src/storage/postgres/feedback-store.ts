// [INPUT]: feedback-routes 的提交与管理调用点
// [OUTPUT]: feedback_items 表的 CRUD
// [POS]: Postgres repository for feedback_items; 用户反馈唯一读写路径
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  FeedbackItem,
  FeedbackStatus,
  FeedbackType,
  FeedbackSource,
  FeedbackOriginRef,
  FeedbackRoutingTarget,
  FeedbackGithubRef,
  FeedbackNormalized,
} from '@shared/types'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { feedbackItems } from './schema'

type FeedbackRow = typeof feedbackItems.$inferSelect

export type FeedbackQuery = {
  status?: FeedbackStatus
  type?: FeedbackType
  userId?: string
  limit?: number
}

export const createFeedbackItem = async (input: {
  id: string
  type: FeedbackType
  title: string
  body: string
  userId?: string | null
  userEmail?: string | null
  conversationId?: string
  /** 来源渠道；缺省 'product'（产品内表单）。 */
  source?: FeedbackSource
  /** 渠道消息锚点（原路回复用）。 */
  originRef?: FeedbackOriginRef
  /** 分诊去向；缺省未分诊。 */
  routing?: FeedbackRoutingTarget
  /** 用户同意脱敏后公开到社区提案。 */
  consentPublic?: boolean
  createdAt: string
}): Promise<FeedbackItem> => {
  await ensurePostgresReady()
  const row: FeedbackRow = {
    id: input.id,
    type: input.type,
    title: input.title,
    body: input.body,
    status: 'open',
    userId: input.userId ?? null,
    userEmail: input.userEmail ?? null,
    conversationId: input.conversationId ?? null,
    source: input.source ?? 'product',
    originRef: input.originRef ?? null,
    normalized: null,
    routing: input.routing ?? null,
    githubRef: null,
    consentPublic: input.consentPublic ?? false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
  await getDrizzleDb().insert(feedbackItems).values(row)
  return mapRow(row)
}

export const listFeedbackItems = async (query: FeedbackQuery = {}): Promise<FeedbackItem[]> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const conditions = []
  if (query.status) {
    conditions.push(eq(feedbackItems.status, query.status))
  }
  if (query.type) {
    conditions.push(eq(feedbackItems.type, query.type))
  }
  if (query.userId) {
    conditions.push(eq(feedbackItems.userId, query.userId))
  }
  const base = db.select().from(feedbackItems)
  const statement = conditions.length > 0 ? base.where(and(...conditions)) : base
  const rows = await statement
    .orderBy(desc(feedbackItems.createdAt))
    .limit(query.limit ?? 200)
  return rows.map(mapRow)
}

export const getFeedbackItem = async (id: string): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb().select().from(feedbackItems).where(eq(feedbackItems.id, id)).limit(1)
  return row ? mapRow(row) : null
}

export const updateFeedbackStatus = async (id: string, status: FeedbackStatus): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb()
    .update(feedbackItems)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(feedbackItems.id, id))
    .returning()
  return row ? mapRow(row) : null
}

export const updateFeedbackConversation = async (id: string, conversationId: string): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb()
    .update(feedbackItems)
    .set({ conversationId, updatedAt: new Date().toISOString() })
    .where(eq(feedbackItems.id, id))
    .returning()
  return row ? mapRow(row) : null
}

/** 写入 AI 规范化产物（分类/查重/结构化草稿）。 */
export const setFeedbackNormalized = async (id: string, normalized: FeedbackNormalized): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb()
    .update(feedbackItems)
    .set({ normalized, updatedAt: new Date().toISOString() })
    .where(eq(feedbackItems.id, id))
    .returning()
  return row ? mapRow(row) : null
}

/** promote 完成后写回 GitHub 引用（issue/discussion 落点）。 */
export const setFeedbackGithubRef = async (id: string, ref: FeedbackGithubRef): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb()
    .update(feedbackItems)
    .set({ githubRef: ref, updatedAt: new Date().toISOString() })
    .where(eq(feedbackItems.id, id))
    .returning()
  return row ? mapRow(row) : null
}

/** 按渠道消息锚点查重（webhook at-least-once 重投递幂等用）；找不到返回 null。 */
export const getFeedbackItemByOriginRef = async (channel: string, messageId: string): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb()
    .select()
    .from(feedbackItems)
    .where(
      sql`${feedbackItems.originRef} ->> 'channel' = ${channel} and ${feedbackItems.originRef} ->> 'messageId' = ${messageId}`,
    )
    .limit(1)
  return row ? mapRow(row) : null
}

/** 管理员设置分诊去向（internal=受限维护队列 / community=公开仓 / none=仅客服闭环）。 */
export const updateFeedbackRouting = async (id: string, routing: FeedbackRoutingTarget): Promise<FeedbackItem | null> => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb()
    .update(feedbackItems)
    .set({ routing, updatedAt: new Date().toISOString() })
    .where(eq(feedbackItems.id, id))
    .returning()
  return row ? mapRow(row) : null
}

const mapRow = (row: FeedbackRow): FeedbackItem => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  status: row.status,
  userId: row.userId ?? null,
  userEmail: row.userEmail ?? null,
  conversationId: row.conversationId ?? undefined,
  source: row.source,
  originRef: row.originRef ?? undefined,
  normalized: row.normalized ?? undefined,
  routing: row.routing ?? undefined,
  githubRef: row.githubRef ?? undefined,
  consentPublic: row.consentPublic,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
