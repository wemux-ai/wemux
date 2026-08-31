/**
 * [INPUT]: Main chat sessions from app state plus the shared thread diff planner and codecs.
 * [OUTPUT]: Authoritative read/write of main chat against conversations/messages (including per-message finish reasons), backfill, and retention.
 * [POS]: Main chat persistence boundary; app_meta blob is legacy backfill source only.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import { isEmptyThreadMirrorPlan, planThreadMirror } from '@shared/thread-message-sync'
import type { MessageUpsertPlan, ThreadMirrorSnapshot, ThreadUpsertPlan } from '@shared/thread-message-sync'
import { buildMainChatSessionFromThread } from '@shared/thread-message-sync'
import type { ThreadMessageRowExtras, ThreadRow } from '@shared/thread-message-sync'
import { threadMessageToChatMessage } from '@shared/thread-message-codec'
import type { MainChatSession, MessagePart, MessageReaction, ThreadMessage } from '@shared/types'
import { clearDriveFileReferencesByRef, registerDriveFileReference } from '../../repositories/drive-store'

import { ensurePostgresReady } from './db'
import { getDrizzleDb, withDrizzleTransaction } from './drizzle-db'
import { appMeta, conversations, messages } from './schema'
import { getCommercialGate } from '../../services/gate/commercial-gate'

/** 指纹快照放内存：进程重启后首轮做一次全量重建，代价可接受且避免额外持久化面。 */
let syncSnapshot: ThreadMirrorSnapshot = {}
let inFlight: Promise<void> | null = null

export const resetThreadStoreSnapshot = () => {
  syncSnapshot = {}
  inFlight = null
}

/**
 * 用已知与关系表一致的会话初始化快照，不产生任何写入。
 * 启动时从关系表读完后调用，避免首次 saveStateMeta 把全量重写一遍。
 */
export const syncSnapshotFromSessions = (sessions: MainChatSession[]) => {
  syncSnapshot = planThreadMirror(sessions, {}).snapshot
}

/** 等待挂起的写入落地。用于回填后与测试中需要确定性的场景。 */
export const flushThreadWrites = async () => {
  while (inFlight !== null) {
    const pending = inFlight
    await pending
    if (inFlight === pending) {
      inFlight = null
      break
    }
  }
}

const toMessageRow = (plan: MessageUpsertPlan) => {
  const { message } = plan
  return {
    id: message.id,
    conversationId: message.threadId,
    senderId: message.author?.id ?? null,
    content: plan.contentProjection,
    contentType: 'markdown' as const,
    replyToMessageId: message.replyToId ?? null,
    externalRefJson: plan.externalRef ?? {},
    partsJson: message.parts,
    role: message.role,
    authorName: plan.authorName ?? message.author?.name ?? null,
    usageJson: plan.extras.usage ?? null,
    runtimeStatusJson: plan.extras.agentRunningStatus === undefined && plan.extras.currentStep === undefined
      ? null
      : {
          ...(plan.extras.agentRunningStatus === undefined ? {} : { agentRunningStatus: plan.extras.agentRunningStatus }),
          ...(plan.extras.currentStep === undefined ? {} : { currentStep: plan.extras.currentStep }),
        },
    finishReason: plan.extras.finishReason ?? null,
    reactionsJson: message.reactions ?? [],
    createdAt: message.createdAt,
  }
}

const toConversationRow = (plan: ThreadUpsertPlan) => ({
  id: plan.threadId,
  workspaceId: plan.workspaceId ?? null,
  workspaceSessionId: null,
  projectId: null,
  taskId: null,
  groupId: null,
  title: plan.title,
  kind: 'main' as const,
  chatMode: 'direct' as const,
  status: 'active' as const,
  externalSyncMode: plan.sourceChannel === undefined ? 'internal' as const : 'mirror' as const,
  orchestratorAgentId: plan.customAgentId ?? null,
  executorId: plan.executorId ?? null,
  executionModel: plan.executionModel ?? null,
  pinnedAt: plan.pinnedAt ?? null,
  sourceChannel: plan.sourceChannel ?? null,
  externalChatId: plan.externalChatId ?? null,
  externalThreadId: plan.externalThreadId ?? null,
  externalConversationId: plan.externalConversationId ?? null,
  externalUserId: plan.externalUserId ?? null,
  runtimeJson: plan.runtime ?? null,
  createdBy: plan.ownerUserId ?? null,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
})

const writeThreads = async (plans: ThreadUpsertPlan[]) => {
  if (plans.length === 0) {
    return
  }

  const db = getDrizzleDb()
  for (const plan of plans) {
    const row = toConversationRow(plan)
    await db
      .insert(conversations)
      .values(row)
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          title: row.title,
          kind: row.kind,
          status: row.status,
          externalSyncMode: row.externalSyncMode,
          orchestratorAgentId: row.orchestratorAgentId,
          executorId: row.executorId,
          executionModel: row.executionModel,
          pinnedAt: row.pinnedAt,
          sourceChannel: row.sourceChannel,
          externalChatId: row.externalChatId,
          externalThreadId: row.externalThreadId,
          externalConversationId: row.externalConversationId,
          externalUserId: row.externalUserId,
          runtimeJson: row.runtimeJson,
          workspaceId: row.workspaceId,
          updatedAt: row.updatedAt,
        },
      })
  }
}

/**
 * 在写入事务内获取线程级排他锁，再查询当前最大 seq，返回下一个可用值。
 * 对齐 workspace-session-history-store 的 pg_advisory_xact_lock + MAX 模式，
 * 保证同一线程内的 seq 分配串行化，不会因为并发写入产生重复或间隙。
 */
const lockThreadAndGetNextSeq = async (tx: Parameters<Parameters<ReturnType<typeof getDrizzleDb>['transaction']>[0]>[0], threadId: string): Promise<number> => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${threadId}))`)
  const rows = await tx
    .select({
      lastSeq: sql<number>`COALESCE(MAX(${messages.seq}), 0)`.mapWith(Number),
    })
    .from(messages)
    .where(eq(messages.conversationId, threadId))
  return (rows[0]?.lastSeq ?? 0) + 1
}

/**
 * 写入消息：新消息走 insert（DB 分配 seq），已有消息走 onConflictDoUpdate（不改写 seq）。
 * 新消息按线程分组，在单个事务内通过 pg_advisory_xact_lock(hashtext(threadId))
 * + COALESCE(MAX(seq),0)+1 分配 seq，保证同一线程内 seq 严格递增且不冲突。
 */
const writeMessages = async (plans: MessageUpsertPlan[]) => {
  if (plans.length === 0) {
    return
  }

  // R8.3：主聊天消息落库时登记 drive 引用附件（孤儿判定基础）。
  for (const plan of plans) {
    if (!plan.isNew) {
      continue
    }
    for (const part of plan.message.parts) {
      if (part.type !== 'attachment') {
        continue
      }
      const driveFileId = part.attachment.driveFileId?.trim()
      if (!driveFileId) {
        continue
      }
      void registerDriveFileReference({
        fileId: driveFileId,
        refType: 'conversation_message',
        refId: plan.message.id,
      }).catch((error) => {
        console.error('[thread-message-store] failed to register drive reference', error)
      })
    }
  }

  /** 内容更新的 set 子句，不含 seq —— 更新永不改写 seq。 */
  const contentSet = (row: ReturnType<typeof toMessageRow>) => ({
    content: row.content,
    contentType: row.contentType,
    partsJson: row.partsJson,
    role: row.role,
    senderId: row.senderId,
    authorName: row.authorName,
    usageJson: row.usageJson,
    runtimeStatusJson: row.runtimeStatusJson,
    finishReason: row.finishReason,
  })

  const newPlans = plans.filter((p) => p.isNew)
  const existingPlans = plans.filter((p) => !p.isNew)

  if (newPlans.length > 0) {
    /** 按 threadId 分组，每组在一个事务内分配 seq。 */
    const byThread = new Map<string, MessageUpsertPlan[]>()
    for (const plan of newPlans) {
      const threadId = plan.message.threadId
      const group = byThread.get(threadId)
      if (group !== undefined) {
        group.push(plan)
      } else {
        byThread.set(threadId, [plan])
      }
    }

    for (const [threadId, group] of byThread) {
      await withDrizzleTransaction(async (tx) => {
        let nextSeq = await lockThreadAndGetNextSeq(tx, threadId)
        for (const plan of group) {
          const row = toMessageRow(plan)
          await tx
            .insert(messages)
            .values({ ...row, seq: nextSeq })
            .onConflictDoUpdate({
              target: messages.id,
              set: contentSet(row),
            })
          nextSeq += 1
        }
      })
    }
  }

  if (existingPlans.length > 0) {
    const db = getDrizzleDb()
    for (const plan of existingPlans) {
      const row = toMessageRow(plan)
      // seq: 0 是占位值——这些消息已存在于 DB，insert 必然冲突，
      // onConflictDoUpdate 只更新内容字段，不改写 seq。
      await db
        .insert(messages)
        .values({ ...row, seq: 0 })
        .onConflictDoUpdate({
          target: messages.id,
          set: contentSet(row),
        })
    }
  }
}

const deleteRows = async (threadIds: string[], messageIds: string[]) => {
  const db = getDrizzleDb()
  // 0 行 DELETE 也会触发 wemux_storage_change 语句级触发器，而 storage_change
  // 又会触发 initAppStateStore → syncMainChatThreads 重算 plan——若 plan 包含
  // 已被 retention/其他路径删掉的行，就会形成每轮重复发 0 行 DELETE 的自反馈循环。
  // 这里先取实存行，只在确有目标时执行 DELETE。
  if (messageIds.length > 0) {
    const existingMessageIds = (await db
      .select({ id: messages.id })
      .from(messages)
      .where(inArray(messages.id, messageIds)))
      .map((row) => row.id)
    if (existingMessageIds.length > 0) {
      await db.delete(messages).where(inArray(messages.id, existingMessageIds))
      // R8.3：主聊天消息删除时清理其 drive 引用附件登记，避免残留导致孤儿判定失效。
      for (const messageId of existingMessageIds) {
        void clearDriveFileReferencesByRef('conversation_message', messageId).catch((error) => {
          console.error('[thread-message-store] failed to clear drive references', error)
        })
      }
    }
  }
  if (threadIds.length > 0) {
    const existingThreadIds = (await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(inArray(conversations.id, threadIds)))
      .map((row) => row.id)
    if (existingThreadIds.length > 0) {
      const existingMessageIdsForThreads = (await db
        .select({ id: messages.id })
        .from(messages)
        .where(inArray(messages.conversationId, existingThreadIds)))
        .map((row) => row.id)
      if (existingMessageIdsForThreads.length > 0) {
        await db.delete(messages).where(inArray(messages.id, existingMessageIdsForThreads))
      }
      await db.delete(conversations).where(inArray(conversations.id, existingThreadIds))
    }
  }
}

/**
 * 把主对话写入关系表。差分由 shared 的 planThreadMirror 负责，
 * 只有真正变化的会话与消息才产生写入，避免把全量保存放大成全量 upsert。
 * 快照仅在写入成功后推进，失败时下一轮会重试同一批。
 */
export const syncMainChatThreads = (sessions: MainChatSession[]) => {
  const plan = planThreadMirror(sessions, syncSnapshot)
  if (isEmptyThreadMirrorPlan(plan)) {
    syncSnapshot = plan.snapshot
    return
  }

  const previous = inFlight ?? Promise.resolve()
  inFlight = previous
    .then(async () => {
      await writeThreads(plan.threads)
      await writeMessages(plan.messages)
      await deleteRows(plan.deletedThreadIds, plan.deletedMessageIds)
      syncSnapshot = plan.snapshot
    })
    .catch((error) => {
      console.error('[postgres] sync-main-chat-threads failed', error)
    })
}

const toThreadRow = (row: typeof conversations.$inferSelect): ThreadRow => ({
  id: row.id,
  title: row.title,
  ...(row.createdBy === null ? {} : { ownerUserId: row.createdBy }),
  ...(row.orchestratorAgentId === null ? {} : { orchestratorAgentId: row.orchestratorAgentId }),
  ...(row.executorId === null ? {} : { executorId: row.executorId }),
  ...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
  ...(row.executionModel === null ? {} : { executionModel: row.executionModel }),
  ...(row.pinnedAt === null ? {} : { pinnedAt: row.pinnedAt }),
  ...(row.sourceChannel === null ? {} : { sourceChannel: row.sourceChannel }),
  ...(row.externalChatId === null ? {} : { externalChatId: row.externalChatId }),
  ...(row.externalThreadId === null ? {} : { externalThreadId: row.externalThreadId }),
  ...(row.externalConversationId === null ? {} : { externalConversationId: row.externalConversationId }),
  ...(row.externalUserId === null ? {} : { externalUserId: row.externalUserId }),
  ...(row.runtimeJson === null ? {} : { runtime: row.runtimeJson }),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toThreadMessage = (row: typeof messages.$inferSelect): ThreadMessage => ({
  id: row.id,
  threadId: row.conversationId,
  role: row.role ?? 'assistant',
  ...(row.senderId === null && row.authorName === null
    ? {}
    : {
        author: {
          type: row.role === 'system' ? 'system' as const : row.role === 'user' ? 'user' as const : 'agent' as const,
          ...(row.senderId === null ? {} : { id: row.senderId }),
          ...(row.authorName === null ? {} : { name: row.authorName }),
        },
      }),
  parts: (row.partsJson ?? []) as MessagePart[],
  ...(row.replyToMessageId === null ? {} : { replyToId: row.replyToMessageId }),
  ...(row.reactionsJson?.length ? { reactions: row.reactionsJson as MessageReaction[] } : {}),
  ...(row.externalRefJson && typeof row.externalRefJson === 'object' && Object.keys(row.externalRefJson).length > 0
    ? { externalRef: row.externalRefJson as Record<string, unknown> }
    : {}),
  createdAt: row.createdAt,
})

const toExtras = (row: typeof messages.$inferSelect): ThreadMessageRowExtras => ({
  ...(row.usageJson === null ? {} : { usage: row.usageJson }),
  ...(row.runtimeStatusJson?.agentRunningStatus === undefined
    ? {}
    : { agentRunningStatus: row.runtimeStatusJson.agentRunningStatus }),
  ...(row.runtimeStatusJson?.currentStep === undefined
    ? {}
    : { currentStep: row.runtimeStatusJson.currentStep }),
  ...(row.finishReason === null ? {} : { finishReason: row.finishReason }),
  ...(row.seq === null ? {} : { seq: row.seq }),
})

/**
 * 从关系表读回主对话会话。这是主对话的线上读路径：
 * initAppStateStore 启动时调用它填 uiStateCache，之后前端读的都是这份内存缓存。
 * 不传 threadIds 时读全部 kind='main'。
 */
export const readMainChatSessionsFromThreads = async (threadIds?: string[]): Promise<MainChatSession[]> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()

  const conversationRows = threadIds === undefined
    ? await db.select().from(conversations).where(eq(conversations.kind, 'main'))
    : threadIds.length === 0
      ? []
      : await db.select().from(conversations).where(inArray(conversations.id, threadIds))

  if (conversationRows.length === 0) {
    return []
  }

  const messageRows = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, conversationRows.map((row) => row.id)))
    // seq 优先：同一 tick 创建的消息 createdAt 相同，仅靠时间戳会打乱提问/回答顺序。
    .orderBy(asc(messages.seq), asc(messages.createdAt), asc(messages.id))

  const messagesByThread = messageRows.reduce<Record<string, typeof messageRows>>((result, row) => {
    result[row.conversationId] = [...(result[row.conversationId] ?? []), row]
    return result
  }, {})

  return conversationRows.map((conversationRow) => {
    const rows = messagesByThread[conversationRow.id] ?? []
    const extrasByMessageId = rows.reduce<Record<string, ThreadMessageRowExtras>>((result, row) => {
      result[row.id] = toExtras(row)
      return result
    }, {})

    return buildMainChatSessionFromThread(
      toThreadRow(conversationRow),
      rows.map(toThreadMessage),
      extrasByMessageId,
    )
  })
}

/**
 * 回填完成标记。不能用「关系表已有 kind='main' 行」推断完成 ——
 * 若回填写了 5 个会话中的 1 个然后崩溃，那种推断会让剩余 4 个永久丢失。
 */
const BACKFILL_DONE_KEY = 'mainChatThreadBackfillCompletedAt'

/**
 * 跳过的会话落库而非只打日志。日志会滚掉，且远端库常常连不上，
 * 「哪些会话没迁过来」必须是可查询状态。
 */
const BACKFILL_SKIPPED_KEY = 'mainChatThreadBackfillSkipped'

export type BackfillSkippedSession = {
  sessionId: string
  reason: string
}

export type BackfillReport = {
  status: 'skipped-already-done' | 'skipped-empty-blob' | 'completed'
  sessionCount: number
  messageCount: number
  skipped: BackfillSkippedSession[]
}

/** 查询回填时跳过的会话。运维接口：不依赖日志留存。 */
export const readBackfillSkippedSessions = async (): Promise<BackfillSkippedSession[]> => {
  const rows = await getDrizzleDb()
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, BACKFILL_SKIPPED_KEY))
  const value = rows[0]?.value
  return Array.isArray(value) ? value as BackfillSkippedSession[] : []
}

const isBackfillDone = async () => {
  const rows = await getDrizzleDb()
    .select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, BACKFILL_DONE_KEY))
  return rows.length > 0 && rows[0]?.value !== null
}

/**
 * 一次性把旧 blob 会话迁入关系表。
 *
 * 按会话隔离：每个会话独立事务，转不动的只跳过它自己并记录原因，
 * 其余照常迁入。整批单事务的话，一条畸形老消息就会让服务起不来 ——
 * 回填在启动路径上，抛异常等于启动失败，且标记不落、每次重启复现。
 *
 * 完成标记在全部会话处理完后落，因此进程崩溃时下次启动会完整重做。
 */
export const backfillMainChatThreads = async (blobSessions: MainChatSession[]): Promise<BackfillReport> => {
  if (await isBackfillDone()) {
    return { status: 'skipped-already-done', sessionCount: 0, messageCount: 0, skipped: [] }
  }

  const markDone = async (skipped: BackfillSkippedSession[]) => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    await db
      .insert(appMeta)
      .values({ key: BACKFILL_DONE_KEY, value: now })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: now } })
    if (skipped.length > 0) {
      await db
        .insert(appMeta)
        .values({ key: BACKFILL_SKIPPED_KEY, value: skipped })
        .onConflictDoUpdate({ target: appMeta.key, set: { value: skipped } })
    }
  }

  if (blobSessions.length === 0) {
    // 空 blob 也要落标记，否则每次启动都重新尝试。
    await markDone([])
    return { status: 'skipped-empty-blob', sessionCount: 0, messageCount: 0, skipped: [] }
  }

  const skipped: BackfillSkippedSession[] = []
  let sessionCount = 0
  let messageCount = 0

  for (const session of blobSessions) {
    try {
      const plan = planThreadMirror([session], {})
      await withDrizzleTransaction(async (tx) => {
        for (const threadPlan of plan.threads) {
          const row = toConversationRow(threadPlan)
          await tx.insert(conversations).values(row).onConflictDoUpdate({
            target: conversations.id,
            set: { title: row.title, kind: row.kind, updatedAt: row.updatedAt },
          })
        }
        if (plan.messages.length > 0) {
          const rows = plan.messages.map((planItem, index) => ({
            ...toMessageRow(planItem),
            seq: index + 1,
          }))
          await tx.insert(messages).values(rows).onConflictDoUpdate({
            target: messages.id,
            set: {
              content: sql`excluded.content`,
              partsJson: sql`excluded.parts_json`,
              role: sql`excluded.role`,
            },
          })
        }
      })
      sessionCount += 1
      messageCount += plan.messages.length
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      skipped.push({ sessionId: session?.id ?? '(missing id)', reason })
      console.error(`[postgres] backfill skipped session ${session?.id ?? '(missing id)'}: ${reason}`)
    }
  }

  await markDone(skipped)
  return { status: 'completed', sessionCount, messageCount, skipped }
}

/**
 * 保留期扫描间隔。blob 时代裁剪挂在每次 saveStateMeta 上，改成按行删除后
 * 若只在启动时跑一次，长期运行的实例就再也不会执行 35 天限制。
 */
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000

let retentionTimer: ReturnType<typeof setInterval> | null = null

export const startMainChatRetentionSchedule = () => {
  if (retentionTimer !== null) {
    return
  }

  retentionTimer = setInterval(() => {
    void applyMainChatRetention()
      .then((report) => {
        if (report.deletedMessageCount > 0 || report.deletedThreadCount > 0) {
          console.log(`[postgres] Main chat retention swept ${report.deletedMessageCount} messages, ${report.deletedThreadCount} threads`)
        }
      })
      .catch((error) => {
        console.error('[postgres] main-chat-retention sweep failed', error)
      })
  }, RETENTION_SWEEP_INTERVAL_MS)
  retentionTimer.unref?.()
}

export const stopMainChatRetentionSchedule = () => {
  if (retentionTimer !== null) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }
}

export const FREE_MESSAGE_RETENTION_DAYS = 180

/** 单会话消息条数上限（防失控兜底，PM 暂定启用）：免费用户超限删除最旧。 */
export const CONVERSATION_MESSAGE_LIMIT = 5000
export type RetentionReport = {
  deletedMessageCount: number
  deletedThreadCount: number
}

/**
 * 消息保留裁剪（R8.3 v4 定稿）：免费用户所有 kind 会话统一 6 个月；付费用户永久保存。
 * - TTL：免费用户（conversation.createdBy 的 plan === 'free'，createdBy 为 null 视为免费）过期消息删除
 * - 条数上限：免费用户单会话超过 CONVERSATION_MESSAGE_LIMIT 删除最旧
 * - 空会话清理：免费且无消息的会话删除（付费保留）
 * 按行删除而非重写整块；付费用户由 paidOwnerIds 跳过，永久保留。
 */
/**
 * 存量 main thread owner 回填（R10.1-B）：历史会话 conversations.created_by 为 null，
 * 无法判定 owner（也就不能取消公开）。取该线程最早一条 user 消息的 sender_id 作为归属。
 * 幂等：只处理 created_by 为 null 的 main 会话；返回回填数量。
 */
export const backfillMainChatOwnerFromMessages = async (): Promise<number> => {
  const db = getDrizzleDb()
  const orphans = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.kind, 'main'), isNull(conversations.createdBy)))

  let backfilled = 0
  for (const conversation of orphans) {
    const rows = await db
      .select({ senderId: messages.senderId })
      .from(messages)
      .where(and(
        eq(messages.conversationId, conversation.id),
        eq(messages.role, 'user'),
      ))
      .orderBy(asc(messages.seq))
      .limit(1)
    const ownerUserId = rows[0]?.senderId?.trim()
    if (!ownerUserId) {
      continue
    }
    await db
      .update(conversations)
      .set({ createdBy: ownerUserId })
      .where(eq(conversations.id, conversation.id))
    backfilled += 1
  }
  return backfilled
}

export const applyMessageRetention = async (now = new Date()): Promise<RetentionReport> => {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - FREE_MESSAGE_RETENTION_DAYS)
  const cutoffIso = cutoff.toISOString()
  const db = getDrizzleDb()

  // 免费/付费判定：conversation.createdBy（owner，批1 落库）→ user plan；付费（plan !== 'free'）永久保留。
  const conversationRows = await db
    .select({ id: conversations.id, createdBy: conversations.createdBy })
    .from(conversations)
  const ownerIds = [...new Set(conversationRows.map((row) => row.createdBy).filter((id): id is string => Boolean(id)))]
  const paidOwnerIds = new Set<string>()
  for (const ownerId of ownerIds) {
    const snapshot = await getCommercialGate().resolveBillingPolicySnapshot(ownerId).catch(() => null)
    if (snapshot && snapshot.plan !== 'free') {
      paidOwnerIds.add(ownerId)
    }
  }
  const retainConversationIds = new Set(
    conversationRows
      .filter((row) => row.createdBy !== null && paidOwnerIds.has(row.createdBy))
      .map((row) => row.id),
  )
  const freeConversationIds = conversationRows
    .filter((row) => !retainConversationIds.has(row.id))
    .map((row) => row.id)

  let deletedMessages: Array<{ id: string }> = []
  if (freeConversationIds.length > 0) {
    // TTL：免费会话过期消息。
    // 先取可删行再 DELETE：0 行 DELETE 也会触发 wemux_storage_change
    // 语句级触发器（storage_change_events + pg_notify），而 initAppStateStore
    // 每次 storage_change 都会重跑本 retention——无条件 DELETE 会形成自反馈
    // 死循环（8/8 事故同款机制），这里必须只在确有可删行时执行 DELETE。
    const expirableMessageIds = (await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(
        inArray(messages.conversationId, freeConversationIds),
        lt(messages.createdAt, cutoffIso),
      ))
      .limit(5000))
      .map((row) => row.id)
    if (expirableMessageIds.length > 0) {
      deletedMessages = await db
        .delete(messages)
        .where(inArray(messages.id, expirableMessageIds))
        .returning({ id: messages.id })
    }

    // 条数上限兜底：免费会话超过上限删除最旧（seq 序）。
    for (const conversationId of freeConversationIds) {
      const ids = (await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.seq)))
        .map((row) => row.id)
      if (ids.length <= CONVERSATION_MESSAGE_LIMIT) {
        continue
      }
      const excess = ids.slice(0, ids.length - CONVERSATION_MESSAGE_LIMIT)
      const removed = await db
        .delete(messages)
        .where(inArray(messages.id, excess))
        .returning({ id: messages.id })
      deletedMessages = [...deletedMessages, ...removed]
    }
  }

  // 空会话清理：免费且已无消息、且自身已过期的会话删除（付费保留）。
  // 同样只在确有可删行时执行 DELETE（0 行 DELETE 触发 storage_change 自反馈）。
  let deletedThreads: Array<{ id: string }> = []
  if (freeConversationIds.length > 0) {
    const expirableThreadRows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(
        inArray(conversations.id, freeConversationIds),
        lt(conversations.updatedAt, cutoffIso),
        lt(conversations.createdAt, cutoffIso),
        sql`NOT EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.conversationId} = ${conversations.id})`,
      ))
      .limit(5000)
    if (expirableThreadRows.length > 0) {
      deletedThreads = await db
        .delete(conversations)
        .where(inArray(conversations.id, expirableThreadRows.map((row) => row.id)))
        .returning({ id: conversations.id })
    }
  }

  if (deletedMessages.length > 0 || deletedThreads.length > 0) {
    // 精确从快照中摘除被删消息/线程的指纹，而不是清空整个快照。
    // 清空快照会导致下一轮 syncMainChatThreads 重新 upsert 全量消息（含刚被删的幸存者），
    // 等于裁剪白做。
    const deletedMessageIdSet = new Set(deletedMessages.map((row) => row.id))
    const deletedThreadIdSet = new Set(deletedThreads.map((row) => row.id))

    const nextSnapshot: ThreadMirrorSnapshot = {}
    for (const [threadId, fingerprint] of Object.entries(syncSnapshot)) {
      if (deletedThreadIdSet.has(threadId)) {
        continue
      }
      const nextMessages: typeof fingerprint.messages = {}
      for (const [messageId, messageFingerprint] of Object.entries(fingerprint.messages)) {
        if (!deletedMessageIdSet.has(messageId)) {
          nextMessages[messageId] = messageFingerprint
        }
      }
      nextSnapshot[threadId] = { ...fingerprint, messages: nextMessages }
    }
    syncSnapshot = nextSnapshot
  }

  return { deletedMessageCount: deletedMessages.length, deletedThreadCount: deletedThreads.length }
}

/** 兼容别名：旧名指向泛化后的消息保留裁剪。 */
export const applyMainChatRetention = applyMessageRetention

// retention 是重活（全表查 conversations + 逐 owner billing 判定），
// initAppStateStore 会被每个 storage_change 事件触发，若每次重跑会把
// 事件风暴放大成全表扫描。节流窗口内复用最近一次结果。
const MAIN_CHAT_RETENTION_THROTTLE_MS = 30 * 60 * 1000
let lastMainChatRetentionAt = 0
let lastMainChatRetentionResult: RetentionReport = {
  deletedMessageCount: 0,
  deletedThreadCount: 0,
}

export const runMainChatRetentionThrottled = async (): Promise<RetentionReport> => {
  const now = Date.now()
  if (now - lastMainChatRetentionAt < MAIN_CHAT_RETENTION_THROTTLE_MS) {
    return lastMainChatRetentionResult
  }
  lastMainChatRetentionAt = now
  lastMainChatRetentionResult = await applyMessageRetention().catch((error) => {
    console.error('[postgres] main-chat-retention throttled sweep failed', error)
    return { deletedMessageCount: 0, deletedThreadCount: 0 }
  })
  return lastMainChatRetentionResult
}

export interface MainChatThreadMessagesResult {
  messages: MainChatSession['messages']
  totalMessageCount: number
  returnedMessageCount: number
  hasMoreBefore: boolean
}

/**
 * 游标分页读取主对话线程消息。用 seq 做游标，直接 SQL 层面完成窗口查询。
 * 对齐 getTaskConversationWithMessages 的返回形状，方便前端复用同一套游标分页 hook。
 */
export const getMainChatThreadMessages = async (params: {
  threadId: string
  limit?: number
  beforeSeq?: number
  afterSeq?: number
}): Promise<MainChatThreadMessagesResult> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const effectiveLimit = Math.min(Math.max(params.limit ?? 50, 1), 500)

  // 获取总消息数
  const countRows = await db
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(messages)
    .where(eq(messages.conversationId, params.threadId))
  const totalMessageCount = countRows[0]?.count ?? 0

  // 构建查询条件
  const conditions = [eq(messages.conversationId, params.threadId)]
  let orderDirection: typeof asc | typeof desc = desc
  let hasMoreBefore = false

  if (params.beforeSeq !== undefined) {
    conditions.push(lt(messages.seq, params.beforeSeq))
    orderDirection = desc
  } else if (params.afterSeq !== undefined) {
    conditions.push(gt(messages.seq, params.afterSeq))
    orderDirection = asc
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(orderDirection(messages.seq))
    .limit(effectiveLimit + 1)

  const hasExtra = rows.length > effectiveLimit
  const trimmedRows = hasExtra ? rows.slice(0, effectiveLimit) : rows

  if (params.beforeSeq !== undefined) {
    hasMoreBefore = hasExtra
    // beforeSeq 查询返回的是降序，需要反转为升序
    trimmedRows.reverse()
  } else if (params.afterSeq !== undefined) {
    hasMoreBefore = false
  } else {
    // 默认（无游标）：返回最新消息，降序后反转
    hasMoreBefore = hasExtra
    trimmedRows.reverse()
  }

  const resultMessages = trimmedRows.map((row) => threadMessageToChatMessage(toThreadMessage(row), toExtras(row)))

  return {
    messages: resultMessages,
    totalMessageCount,
    returnedMessageCount: resultMessages.length,
    hasMoreBefore,
  }
}
