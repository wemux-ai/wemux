/**
 * [INPUT]: Inbox delivery intents from comments, group chat, assignments and Agent events.
 * [OUTPUT]: Durable inbox items for user or Agent recipients, grouped reads, badge counts and read-state mutations.
 * [POS]: Single inbox persistence boundary; replaces the per-source notification services.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, countDistinct, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import {
  INBOX_WAKING_KINDS,
  resolveInboxSection,
  type InboxActorType,
  type InboxGroupListResponse,
  type InboxGroupSummary,
  type InboxItem,
  type InboxItemKind,
  type InboxItemListResponse,
  type InboxItemReason,
  type InboxQueryScope,
  type InboxRecipientType,
  type InboxReplyTarget,
  type InboxScope,
  type InboxSection,
} from '@shared/inbox'
import { ensurePostgresReady } from '../storage/postgres/db'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { inboxItems } from '../storage/postgres/schema'
import { publishInboxChange } from './inbox-stream'
import { notifyInboxPushIfEnabled } from './web-push-service'

export type InboxPublishInput = {
  recipientType: InboxRecipientType
  recipientId: string
  kind: InboxItemKind
  reason: InboxItemReason
  eventType: string
  actor: { type: InboxActorType; id?: string; name?: string }
  itemId?: string
  title: string
  body: string
  scope: InboxScope
  groupKey: string
  replyTo: InboxReplyTarget
  dedupeKey: string
  traceId?: string
  chainStartedAt?: string
  sourceInboxItemId?: string
  hopCount?: number
  createdAt?: string
}

const mapRow = (row: typeof inboxItems.$inferSelect): InboxItem => ({
  id: row.id,
  recipientType: row.recipientType,
  recipientId: row.recipientId,
  kind: row.kind,
  reason: row.reason,
  eventType: row.eventType,
  actorType: row.actorType,
  actorId: row.actorId ?? undefined,
  actorName: row.actorName,
  title: row.title,
  body: row.body,
  scope: row.scopeJson,
  groupKey: row.groupKey,
  replyTo: row.replyToJson,
  traceId: row.traceId,
  chainStartedAt: row.chainStartedAt,
  sourceInboxItemId: row.sourceInboxItemId ?? undefined,
  hopCount: row.hopCount,
  dedupeKey: row.dedupeKey,
  readAt: row.readAt ?? undefined,
  snoozedUntil: row.snoozedUntil ?? undefined,
  archivedAt: row.archivedAt ?? undefined,
  createdAt: row.createdAt,
})

const resolveActorName = (actor: InboxPublishInput['actor']) => (
  actor.name?.trim() || (actor.type === 'agent' ? 'Agent' : actor.type === 'system' ? '系统' : '团队成员')
)

/** 自己的动作不进自己的收件箱。 */
export const isSelfDelivery = (params: {
  recipientType: InboxRecipientType
  recipientId: string
  actor: { type: InboxActorType; id?: string }
}) => (
  params.actor.type === params.recipientType && params.actor.id === params.recipientId
)

export const buildInboxItem = (input: InboxPublishInput): InboxItem => ({
  id: input.itemId?.trim() || crypto.randomUUID(),
  recipientType: input.recipientType,
  recipientId: input.recipientId,
  kind: input.kind,
  reason: input.reason,
  eventType: input.eventType,
  actorType: input.actor.type,
  actorId: input.actor.id?.trim() || undefined,
  actorName: resolveActorName(input.actor),
  title: input.title,
  body: input.body,
  scope: input.scope,
  groupKey: input.groupKey,
  replyTo: input.replyTo,
  traceId: input.traceId?.trim() || crypto.randomUUID(),
  chainStartedAt: input.chainStartedAt?.trim() || input.createdAt || new Date().toISOString(),
  sourceInboxItemId: input.sourceInboxItemId?.trim() || undefined,
  hopCount: input.hopCount ?? 0,
  dedupeKey: input.dedupeKey,
  createdAt: input.createdAt || new Date().toISOString(),
})

export type InboxPublishResult = {
  item: InboxItem
  created: boolean
}

/**
 * 投递一条 inbox item。人只落库并推 SSE；Agent 侧由 agent-event-runtime 建立执行关系。
 * 去重时返回已有 item，调用方因此可以稳定建立 AgentTask 关系。
 *
 * 幂等策略：ON CONFLICT 不指定 target，任何唯一约束冲突（主键 id 或 recipient+dedupeKey）
 * 都视为「已存在」；回查时先按 dedupeKey 再按 itemId。这是因为重试任务会复用原 inboxItemId
 * 但丢失 idempotencyKey（dedupeKey 因此不同），若只按 dedupeKey 冲突会漏掉主键冲突直接报 23505。
 */
export const publishInboxItem = async (input: InboxPublishInput): Promise<InboxPublishResult> => {
  const item = buildInboxItem(input)

  await ensurePostgresReady()
  // on conflict do nothing 不带 target：同时吞掉 dedupe 唯一约束与 id 主键冲突。
  // 显式 itemId 重放（如 agent-event reconciliation）时 dedupeKey 可能因 payload 漂移
  // 而不同于首次插入，此时靠主键幂等返回已有 item，而不是向 Postgres 抛出 23505。
  const inserted = await getDrizzleDb().insert(inboxItems).values({
    id: item.id,
    recipientType: item.recipientType,
    recipientId: item.recipientId,
    kind: item.kind,
    reason: item.reason,
    eventType: item.eventType,
    actorType: item.actorType,
    actorId: item.actorId ?? null,
    actorName: item.actorName,
    title: item.title,
    body: item.body,
    scopeJson: item.scope,
    groupKey: item.groupKey,
    replyToJson: item.replyTo,
    traceId: item.traceId,
    chainStartedAt: item.chainStartedAt,
    sourceInboxItemId: item.sourceInboxItemId ?? null,
    hopCount: item.hopCount,
    dedupeKey: item.dedupeKey,
    readAt: null,
    snoozedUntil: null,
    archivedAt: null,
    createdAt: item.createdAt,
  }).onConflictDoNothing().returning({ id: inboxItems.id })

  if (inserted.length === 0) {
    const [byDedupe] = await getDrizzleDb().select().from(inboxItems).where(and(
      eq(inboxItems.recipientType, item.recipientType),
      eq(inboxItems.recipientId, item.recipientId),
      or(
        eq(inboxItems.dedupeKey, item.dedupeKey),
        eq(inboxItems.id, item.id),
      ),
    )).limit(1)
    if (byDedupe) return { item: mapRow(byDedupe), created: false }
    // dedupe 未命中时按主键回退：处理同 id、不同 dedupeKey 的重放。
    const [byId] = await getDrizzleDb().select().from(inboxItems)
      .where(eq(inboxItems.id, item.id))
      .limit(1)
    if (byId) return { item: mapRow(byId), created: false }
    throw new Error('Inbox item deduplication completed without a persisted item.')
  }
  publishInboxChange(
    item.recipientId,
    { item, unreadGroups: await countUnreadGroups(item.recipientId, item.recipientType) },
    item.recipientType,
  )
  // feature P3：新 inbox item → Web Push（页面关闭也能收；按设置矩阵 browserEnabled 过滤）。
  notifyInboxPushIfEnabled(item)
  return { item, created: true }
}

/**
 * 客服通道事件不进产品全局收件箱：用户侧由问号红点承载，
 * Admin SLA 升级则在 /admin/feedback 工作台处理。
 */
export const SUPPORT_CHANNEL_EVENT_TYPES = ['support.reply', 'support.escalation', 'support.escalation.admin'] as const

export const notSupportChannelEvent = notInArray(inboxItems.eventType, [...SUPPORT_CHANNEL_EVENT_TYPES])

const openItemFilter = (recipientType: InboxRecipientType, recipientId: string) => and(
  eq(inboxItems.recipientType, recipientType),
  eq(inboxItems.recipientId, recipientId),
  isNull(inboxItems.archivedAt),
  notSupportChannelEvent,
)

const activeItemFilter = (recipientType: InboxRecipientType, recipientId: string, now: string) => and(
  openItemFilter(recipientType, recipientId),
  or(isNull(inboxItems.snoozedUntil), sql`${inboxItems.snoozedUntil} <= ${now}`),
)

const sectionFilter = (
  recipientType: InboxRecipientType,
  recipientId: string,
  section: InboxQueryScope,
  now: string,
) => {
  // 全部：待处理 + 关注 + 未到期 snooze 的一条时间线，行内仍按各自真实 section 展示。
  // 已归档不进来 —— 归档表示「处理完了」，混进默认视图会让列表越用越长。
  if (section === 'all') {
    return openItemFilter(recipientType, recipientId)
  }
  if (section === 'archived') {
    return and(
      eq(inboxItems.recipientType, recipientType),
      eq(inboxItems.recipientId, recipientId),
      isNotNull(inboxItems.archivedAt),
      notSupportChannelEvent,
    )
  }
  if (section === 'snoozed') {
    return and(
      openItemFilter(recipientType, recipientId),
      isNotNull(inboxItems.snoozedUntil),
      gt(inboxItems.snoozedUntil, now),
    )
  }
  return and(
    activeItemFilter(recipientType, recipientId, now),
    section === 'following'
      ? eq(inboxItems.kind, 'observe')
      : inArray(inboxItems.kind, [...INBOX_WAKING_KINDS]),
  )
}

/** badge 计数：只算待处理（directive/mention/handoff）的未读 group 数，observe 不计入。 */
export const countUnreadGroups = async (recipientId: string, recipientType: InboxRecipientType = 'user') => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const rows = await getDrizzleDb()
    .select({ value: countDistinct(inboxItems.groupKey) })
    .from(inboxItems)
    .where(and(
      openItemFilter(recipientType, recipientId),
      isNull(inboxItems.readAt),
      inArray(inboxItems.kind, [...INBOX_WAKING_KINDS]),
      or(isNull(inboxItems.snoozedUntil), sql`${inboxItems.snoozedUntil} <= ${now}`),
    ))
  return Number(rows[0]?.value ?? 0)
}

export const listInboxItems = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  limit?: number
  unreadOnly?: boolean
  kinds?: InboxItemKind[]
  workspaceId?: string
}) => {
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100)
  const conditions = [activeItemFilter(recipientType, params.recipientId, new Date().toISOString())]
  if (params.unreadOnly) conditions.push(isNull(inboxItems.readAt))
  if (params.kinds?.length) conditions.push(inArray(inboxItems.kind, params.kinds))
  if (params.workspaceId?.trim()) conditions.push(eq(sql`${inboxItems.scopeJson}->>'workspaceId'`, params.workspaceId.trim()))

  const [rows, unreadGroups] = await Promise.all([
    getDrizzleDb().select().from(inboxItems)
      .where(and(...conditions))
      .orderBy(desc(inboxItems.createdAt))
      .limit(limit),
    countUnreadGroups(params.recipientId, recipientType),
  ])
  return { items: rows.map(mapRow), unreadGroups }
}

export const listInboxGroups = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  section?: InboxQueryScope
  cursor?: string
  limit?: number
  workspaceId?: string
}): Promise<InboxGroupListResponse> => {
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const section = params.section ?? 'action'
  const now = new Date().toISOString()
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100)
  const conditions = [sectionFilter(recipientType, params.recipientId, section, now)]
  if (params.cursor) conditions.push(lt(inboxItems.createdAt, params.cursor))
  if (params.workspaceId?.trim()) conditions.push(eq(sql`${inboxItems.scopeJson}->>'workspaceId'`, params.workspaceId.trim()))

  // Pull a bounded item window, then group in memory. The table is indexed by recipient and createdAt;
  // cursor pagination prevents one active inbox from loading its full history.
  const rows = await getDrizzleDb().select().from(inboxItems)
    .where(and(...conditions))
    .orderBy(desc(inboxItems.createdAt))
    .limit(Math.min(limit * 20, 1_000))

  const grouped = new Map<string, InboxItem[]>()
  for (const row of rows) {
    const item = mapRow(row)
    const group = grouped.get(item.groupKey) ?? []
    group.push(item)
    grouped.set(item.groupKey, group)
  }

  const groups: InboxGroupSummary[] = [...grouped.entries()].slice(0, limit).map(([groupKey, items]) => {
    const latestItem = items[0]!
    return {
      groupKey,
      section: resolveInboxSection(latestItem, now),
      latestItem,
      itemCount: items.length,
      unreadCount: items.filter((item) => !item.readAt).length,
      actionableUnreadCount: items.filter((item) => (
        !item.readAt && INBOX_WAKING_KINDS.includes(item.kind)
      )).length,
      snoozedUntil: items.map((item) => item.snoozedUntil).filter(Boolean).sort().at(-1),
    }
  })
  const lastGroup = groups.at(-1)
  const nextCursor = grouped.size > limit && lastGroup ? lastGroup.latestItem.createdAt : undefined

  return {
    groups,
    unreadGroups: await countUnreadGroups(params.recipientId, recipientType),
    nextCursor,
  }
}

export const listInboxGroupItems = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  groupKey: string
  section?: InboxQueryScope
  cursor?: string
  limit?: number
  workspaceId?: string
}): Promise<InboxItemListResponse> => {
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const section = params.section ?? 'action'
  const now = new Date().toISOString()
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200)
  const conditions = [
    sectionFilter(recipientType, params.recipientId, section, now),
    eq(inboxItems.groupKey, params.groupKey),
  ]
  if (params.cursor) conditions.push(lt(inboxItems.createdAt, params.cursor))
  if (params.workspaceId?.trim()) conditions.push(eq(sql`${inboxItems.scopeJson}->>'workspaceId'`, params.workspaceId.trim()))
  const rows = await getDrizzleDb().select().from(inboxItems)
    .where(and(...conditions))
    .orderBy(desc(inboxItems.createdAt))
    .limit(limit + 1)
  const visible = rows.slice(0, limit).map(mapRow)
  return {
    items: visible,
    unreadGroups: await countUnreadGroups(params.recipientId, recipientType),
    nextCursor: rows.length > limit ? visible.at(-1)?.createdAt : undefined,
  }
}

const publishRecipientMutation = async (recipientType: InboxRecipientType, recipientId: string) => {
  publishInboxChange(
    recipientId,
    { unreadGroups: await countUnreadGroups(recipientId, recipientType) },
    recipientType,
  )
}

export const markInboxGroupRead = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  groupKey: string
}) => {
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ readAt: new Date().toISOString() })
    .where(and(
      openItemFilter(recipientType, params.recipientId),
      eq(inboxItems.groupKey, params.groupKey),
      isNull(inboxItems.readAt),
    ))
    .returning({ id: inboxItems.id })
  await publishRecipientMutation(recipientType, params.recipientId)
  return rows.length
}

export const archiveInboxGroup = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  groupKey: string
}) => {
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const now = new Date().toISOString()
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ archivedAt: now, readAt: sql`coalesce(${inboxItems.readAt}, ${now})` })
    .where(and(
      openItemFilter(recipientType, params.recipientId),
      eq(inboxItems.groupKey, params.groupKey),
    ))
    .returning({ id: inboxItems.id })
  await publishRecipientMutation(recipientType, params.recipientId)
  return rows.length
}

export const snoozeInboxGroup = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  groupKey: string
  until: string
}) => {
  const until = new Date(params.until)
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
    throw new Error('Snooze time must be a future ISO timestamp.')
  }
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ snoozedUntil: until.toISOString(), readAt: null })
    .where(and(
      openItemFilter(recipientType, params.recipientId),
      eq(inboxItems.groupKey, params.groupKey),
    ))
    .returning({ id: inboxItems.id })
  await publishRecipientMutation(recipientType, params.recipientId)
  return rows.length
}

export const unsnoozeInboxGroup = async (params: {
  recipientId: string
  recipientType?: InboxRecipientType
  groupKey: string
}) => {
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ snoozedUntil: null })
    .where(and(
      openItemFilter(recipientType, params.recipientId),
      eq(inboxItems.groupKey, params.groupKey),
      isNotNull(inboxItems.snoozedUntil),
    ))
    .returning({ id: inboxItems.id })
  await publishRecipientMutation(recipientType, params.recipientId)
  return rows.length
}

export const unsnoozeInboxItem = async (
  recipientId: string,
  itemId: string,
  recipientType: InboxRecipientType = 'user',
) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ snoozedUntil: null })
    .where(and(
      eq(inboxItems.id, itemId),
      eq(inboxItems.recipientType, recipientType),
      eq(inboxItems.recipientId, recipientId),
      isNull(inboxItems.archivedAt),
      isNotNull(inboxItems.snoozedUntil),
    ))
    .returning({ id: inboxItems.id })
  await publishRecipientMutation(recipientType, recipientId)
  return rows.length > 0
}

export const markInboxItemRead = async (
  recipientId: string,
  itemId: string,
  recipientType: InboxRecipientType = 'user',
) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ readAt: new Date().toISOString() })
    .where(and(
      eq(inboxItems.id, itemId),
      eq(inboxItems.recipientType, recipientType),
      eq(inboxItems.recipientId, recipientId),
    ))
    .returning({ id: inboxItems.id })
  if (rows.length === 0) return false
  publishInboxChange(
    recipientId,
    { itemId, unreadGroups: await countUnreadGroups(recipientId, recipientType) },
    recipientType,
  )
  return true
}

export const markAllInboxItemsRead = async (
  recipientId: string,
  recipientType: InboxRecipientType = 'user',
) => {
  await ensurePostgresReady()
  await getDrizzleDb().update(inboxItems)
    .set({ readAt: new Date().toISOString() })
    .where(and(openItemFilter(recipientType, recipientId), isNull(inboxItems.readAt)))
  publishInboxChange(
    recipientId,
    { unreadGroups: await countUnreadGroups(recipientId, recipientType) },
    recipientType,
  )
}

export const archiveInboxItem = async (
  recipientId: string,
  itemId: string,
  recipientType: InboxRecipientType = 'user',
) => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ archivedAt: now, readAt: sql`coalesce(${inboxItems.readAt}, ${now})` })
    .where(and(
      eq(inboxItems.id, itemId),
      eq(inboxItems.recipientType, recipientType),
      eq(inboxItems.recipientId, recipientId),
    ))
    .returning({ id: inboxItems.id })
  if (rows.length === 0) return false
  publishInboxChange(
    recipientId,
    { itemId, unreadGroups: await countUnreadGroups(recipientId, recipientType) },
    recipientType,
  )
  return true
}

export const snoozeInboxItem = async (params: {
  recipientId: string
  itemId: string
  until: string
  recipientType?: InboxRecipientType
}) => {
  const until = new Date(params.until)
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
    throw new Error('Snooze time must be a future ISO timestamp.')
  }
  const normalizedUntil = until.toISOString()
  await ensurePostgresReady()
  const recipientType = params.recipientType ?? 'user'
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ snoozedUntil: normalizedUntil, readAt: null })
    .where(and(
      eq(inboxItems.id, params.itemId),
      eq(inboxItems.recipientType, recipientType),
      eq(inboxItems.recipientId, params.recipientId),
      isNull(inboxItems.archivedAt),
    ))
    .returning({ id: inboxItems.id })
  if (rows.length === 0) return false
  if (recipientType === 'user') {
    publishInboxChange(params.recipientId, { itemId: params.itemId, unreadGroups: await countUnreadGroups(params.recipientId) })
  }
  return true
}

/** snooze 到期：清空 snoozedUntil 让 item 回到未读并重新计入 badge。 */
export const releaseExpiredInboxSnoozes = async () => {
  await ensurePostgresReady()
  const now = new Date().toISOString()
  const rows = await getDrizzleDb().update(inboxItems)
    .set({ snoozedUntil: null })
    .where(and(
      sql`${inboxItems.snoozedUntil} is not null`,
      sql`${inboxItems.snoozedUntil} <= ${now}`,
    ))
    .returning({ recipientType: inboxItems.recipientType, recipientId: inboxItems.recipientId })

  const userIds = [...new Set(
    rows.filter((row) => row.recipientType === 'user').map((row) => row.recipientId),
  )]
  for (const userId of userIds) {
    publishInboxChange(userId, { unreadGroups: await countUnreadGroups(userId) })
  }
  return rows.length
}

export const getInboxItemByIdInternal = async (itemId: string) => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb().select().from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1)
  return row ? mapRow(row) : null
}

/** 按收件人与 dedupeKey 查收件箱条目（升级/幂等判定用）。 */
export const getInboxItemByDedupeKey = async (params: {
  recipientType: InboxRecipientType
  recipientId: string
  dedupeKey: string
}): Promise<InboxItem | null> => {
  if (!params.recipientId || !params.dedupeKey) {
    return null
  }
  await ensurePostgresReady()
  const [row] = await getDrizzleDb().select().from(inboxItems).where(and(
    eq(inboxItems.recipientType, params.recipientType),
    eq(inboxItems.recipientId, params.recipientId),
    eq(inboxItems.dedupeKey, params.dedupeKey),
  )).limit(1)
  return row ? mapRow(row) : null
}

export const countInboxTraceDeliveriesInternal = async (traceId: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().select({ value: countDistinct(inboxItems.id) }).from(inboxItems)
    .where(eq(inboxItems.traceId, traceId))
  return Number(rows[0]?.value ?? 0)
}

export const getInboxItem = async (params: {
  recipientType: InboxRecipientType
  recipientId: string
  itemId: string
}) => {
  await ensurePostgresReady()
  const [row] = await getDrizzleDb().select().from(inboxItems).where(and(
    eq(inboxItems.id, params.itemId),
    eq(inboxItems.recipientType, params.recipientType),
    eq(inboxItems.recipientId, params.recipientId),
  )).limit(1)
  return row ? mapRow(row) : null
}

export const listInboxItemsByTrace = async (params: {
  recipientType: InboxRecipientType
  recipientId: string
  traceId: string
}) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().select().from(inboxItems)
    .where(and(
      eq(inboxItems.recipientType, params.recipientType),
      eq(inboxItems.recipientId, params.recipientId),
      eq(inboxItems.traceId, params.traceId),
    ))
    .orderBy(inboxItems.createdAt)
  return rows.map(mapRow)
}

export const countOpenInboxItemsSince = async (recipientId: string, since: string) => {
  await ensurePostgresReady()
  const rows = await getDrizzleDb().select({ value: countDistinct(inboxItems.id) }).from(inboxItems)
    .where(and(openItemFilter('user', recipientId), gt(inboxItems.createdAt, since)))
  return Number(rows[0]?.value ?? 0)
}
