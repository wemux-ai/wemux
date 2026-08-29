// [INPUT]: 用户 id + 时间范围（today / 7d）
// [OUTPUT]: 用户时间线（可跳转动作条目 + 会话参与时长列表 + 合计）、用户卡片摘要
// [POS]: 时间线确定性装配层；turn 时长求和为主（准确），消息跨度兜底（估算）；零 LLM；可见性由路由层控制
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { and, eq, sql } from 'drizzle-orm'
import type {
  AgentTimelineDetail,
  SessionParticipation,
  TimelineActivityItem,
  UserCardSummary,
  UserTimelineDetail,
} from '@shared/types'
import { getDrizzleDb } from '../storage/postgres/drizzle-db'
import { conversationMembers, conversations, messages } from '../storage/postgres/schema-core'
import { getUserById } from '../storage/postgres/auth-store'
import { getUserProfile, listWorkRecords } from '../repositories/profile-store'

export type TimelineRange = 'today' | '7d'

/** 时间范围起点（UTC ISO；today = 本地自然日 0 点，7d = 6 天前 0 点，含今天共 7 天） */
export const resolveRangeStart = (range: TimelineRange, now = new Date()): string => {
  const start = new Date(now)
  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  }
  return start.toISOString()
}

/** 会话参与目标类型（用户 / Agent） */
export type TimelineTargetType = 'user' | 'agent'

type TurnSecondsRow = { conversation_id: string; seconds: number }
type MessageStatsRow = { conversation_id: string; message_count: number; first_at: string; last_at: string }

const mapRecordToItem = (record: {
  id: string
  recordType: TimelineActivityItem['recordType']
  targetType: TimelineActivityItem['targetType']
  targetId: string | null
  title: string
  occurredAt: string
  metadataJson?: unknown
}): TimelineActivityItem => ({
  id: record.id,
  recordType: record.recordType,
  targetType: record.targetType,
  targetId: record.targetId,
  title: record.title,
  occurredAt: record.occurredAt,
  metadataJson: record.metadataJson,
})

/**
 * 会话参与时长（目标 × 会话，活跃时长估算）：
 * - turn 时长求和为主：该目标在会话对应 workspace_session 上发起的消息事件所在 turn 的 (finishedAt - startedAt) 之和；
 * - 消息跨度兜底：无 turn 数据的会话用消息时间跨度估算（活跃时长上限）。
 * user：conversation_members.memberType='user' + turn authorId/messages.sender_id=userId；
 * agent：memberType='agent' + turn authorId/messages.sender_id=agentId。
 */
export const getSessionParticipations = async (
  targetType: TimelineTargetType,
  targetId: string,
  range: TimelineRange,
  now = new Date(),
): Promise<SessionParticipation[]> => {
  const from = resolveRangeStart(range, now)
  const db = getDrizzleDb()

  // 目标参与的会话
  const convRows = await db
    .select({
      conversationId: conversations.id,
      title: conversations.title,
      kind: conversations.kind,
      workspaceSessionId: conversations.workspaceSessionId,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversationMembers.memberType, targetType), eq(conversationMembers.memberId, targetId)))

  const conversationIds = convRows.map((row) => row.conversationId)
  if (conversationIds.length === 0) return []

  // turn 时长求和（该用户发起的 turn，通过 events.kind=user_message + authorId 定位）
  // 注意：pg 驱动下 db.execute 返回 { rows: [...] }，必须先取 .rows 才能按数组处理
  const { rows: turnRows } = await db.execute(sql`
    SELECT c.id AS conversation_id, COALESCE(SUM(EXTRACT(EPOCH FROM (t.finished_at::timestamptz - t.started_at::timestamptz))), 0)::int AS seconds
      FROM conversations c
      JOIN workspace_session_history_turns t ON t.session_id = c.workspace_session_id
      JOIN workspace_session_history_events e ON e.turn_id = t.id AND e.session_id = t.session_id
     WHERE c.workspace_session_id IS NOT NULL
       AND e.kind = 'user_message'
       AND e.payload_json->>'authorId' = ${targetId}
       AND t.started_at >= ${from}
       AND t.finished_at IS NOT NULL
     GROUP BY c.id
  `)
  const turnSeconds = turnRows as unknown as TurnSecondsRow[]

  // 消息统计（数量 + 首末时间，兜底 + 展示消息数）
  const { rows: statsRows } = await db.execute(sql`
    SELECT m.conversation_id,
           COUNT(*)::int AS message_count,
           MIN(m.created_at) AS first_at,
           MAX(m.created_at) AS last_at
      FROM messages m
     WHERE m.sender_id = ${targetId}
       AND m.created_at >= ${from}
     GROUP BY m.conversation_id
  `)
  const messageStats = statsRows as unknown as MessageStatsRow[]

  const turnMap = new Map(turnSeconds.map((row) => [row.conversation_id, row.seconds]))
  const messageMap = new Map(messageStats.map((row) => [row.conversation_id, row]))

  return convRows
    .map((conv) => {
      const turnSec = turnMap.get(conv.conversationId) ?? 0
      const stats = messageMap.get(conv.conversationId)
      let activeMinutes: number
      if (turnSec > 0) {
        activeMinutes = Math.max(1, Math.round(turnSec / 60))
      } else if (stats) {
        // 消息跨度兜底（估算）：首末消息间隔分钟数
        const spanMin = (new Date(stats.last_at).getTime() - new Date(stats.first_at).getTime()) / 60_000
        activeMinutes = Math.max(1, Math.round(spanMin))
      } else {
        return null
      }
      return {
        conversationId: conv.conversationId,
        title: conv.title,
        kind: String(conv.kind),
        messageCount: stats?.message_count ?? 0,
        activeMinutes,
      }
    })
    .filter((item): item is SessionParticipation => item !== null)
    .filter((item) => item.activeMinutes > 0)
    .sort((a, b) => b.activeMinutes - a.activeMinutes)
}

/** 用户时间线详情（活动条目 + 会话参与） */
export const getUserTimeline = async (
  userId: string,
  range: TimelineRange,
  now = new Date(),
): Promise<UserTimelineDetail> => {
  const from = resolveRangeStart(range, now)
  const records = await listWorkRecords('user', userId, 50, { from })
  const sessions = await getSessionParticipations('user', userId, range, now)
  return {
    userId,
    range,
    activities: records.map(mapRecordToItem),
    sessions,
    totalSessionMinutes: sessions.reduce((sum, item) => sum + item.activeMinutes, 0),
  }
}

/** Agent 时间线详情（活动条目为主；会话参与时长对 Agent 语义弱且 JSON authorId 全表扫在大数据量下慢，暂不聚合） */
export const getAgentTimeline = async (
  agentId: string,
  range: TimelineRange,
  now = new Date(),
): Promise<AgentTimelineDetail> => {
  const from = resolveRangeStart(range, now)
  const records = await listWorkRecords('agent', agentId, 50, { from })
  return {
    agentId,
    range,
    activities: records.map(mapRecordToItem),
    sessions: [],
    totalSessionMinutes: 0,
  }
}

/** 用户卡片摘要（Popover 卡片数据：基本资料 + 今日时间线摘要） */
export const getUserCardSummary = async (userId: string, now = new Date()): Promise<UserCardSummary | null> => {
  const user = getUserById(userId)
  if (!user) return null
  const profile = await getUserProfile(userId)
  const today = await getUserTimeline(userId, 'today', now)
  return {
    userId,
    name: user.name,
    username: user.username ?? null,
    avatarUrl: user.avatarUrl ?? null,
    title: profile?.title ?? null,
    department: profile?.department ?? null,
    today: today.activities,
    todaySessionMinutes: today.totalSessionMinutes,
  }
}
