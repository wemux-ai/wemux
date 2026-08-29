// [INPUT]: meeting-intelligence-routes 的片段/会议读写调用点
// [OUTPUT]: meeting_entities / meeting_segments 表的读写
// [POS]: Postgres repository for 会议智能云端三通道（feature §8）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { and, desc, eq } from 'drizzle-orm'
import type { MeetingValueChannel } from '@shared/meeting-intelligence'
import { ensurePostgresReady } from './db'
import { getDrizzleDb } from './drizzle-db'
import { meetingEntities, meetingSegments } from './schema'

type MeetingEntityRow = typeof meetingEntities.$inferSelect
type MeetingSegmentRow = typeof meetingSegments.$inferSelect

export type MeetingEntityInput = {
  id: string
  userId: string
  title: string
  roomId?: string
  deviceId: string
  startedAt: string
  endedAt?: string
  speakerIds: string[]
  status: 'active' | 'closed'
  summary?: string
  createdAt: string
}

export type MeetingSegmentInput = {
  id: string
  meetingId?: string
  userId: string
  deviceId: string
  roomId?: string
  startedAt: string
  endedAt: string
  durationSec: number
  transcript: string
  speakerId?: string
  valueLabel?: string
  confidence?: number
  channels: MeetingValueChannel[]
  isMeeting: boolean
  meetingTitle?: string
  createdAt: string
}

/** 会议实体 upsert（幂等：同一端侧会议 ID 多次片段到达时刷新窗口与说话人集合） */
export const upsertMeetingEntity = async (input: MeetingEntityInput): Promise<void> => {
  await ensurePostgresReady()
  const row: MeetingEntityRow = {
    id: input.id,
    userId: input.userId,
    title: input.title,
    roomId: input.roomId ?? null,
    deviceId: input.deviceId,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    speakerIds: input.speakerIds,
    status: input.status,
    summary: input.summary ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
  await getDrizzleDb()
    .insert(meetingEntities)
    .values(row)
    .onConflictDoUpdate({
      target: meetingEntities.id,
      set: {
        title: row.title,
        endedAt: row.endedAt,
        speakerIds: row.speakerIds,
        status: row.status,
        updatedAt: row.updatedAt,
      },
    })
}

/** 插入价值片段（通道① cloud_db 结构化落库） */
export const insertMeetingSegment = async (input: MeetingSegmentInput): Promise<void> => {
  await ensurePostgresReady()
  const row: MeetingSegmentRow = {
    id: input.id,
    meetingId: input.meetingId ?? null,
    userId: input.userId,
    deviceId: input.deviceId,
    roomId: input.roomId ?? null,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationSec: input.durationSec,
    transcript: input.transcript,
    speakerId: input.speakerId ?? null,
    valueLabel: input.valueLabel ?? null,
    confidence: input.confidence ?? null,
    channels: input.channels,
    isMeeting: input.isMeeting,
    meetingTitle: input.meetingTitle ?? null,
    createdAt: input.createdAt,
  }
  await getDrizzleDb().insert(meetingSegments).values(row)
}

/** 会议列表（按开始时间倒序） */
export const listMeetings = async (userId: string, limit = 50): Promise<MeetingEntityRow[]> => {
  await ensurePostgresReady()
  return getDrizzleDb()
    .select()
    .from(meetingEntities)
    .where(eq(meetingEntities.userId, userId))
    .orderBy(desc(meetingEntities.startedAt))
    .limit(limit)
}

/** 会议详情 + 其片段列表 */
export const getMeetingDetail = async (
  userId: string,
  meetingId: string,
): Promise<{ meeting: MeetingEntityRow | null; segments: MeetingSegmentRow[] }> => {
  await ensurePostgresReady()
  const db = getDrizzleDb()
  const [meeting] = await db
    .select()
    .from(meetingEntities)
    .where(and(eq(meetingEntities.id, meetingId), eq(meetingEntities.userId, userId)))
    .limit(1)
  if (!meeting) {
    return { meeting: null, segments: [] }
  }
  const segments = await db
    .select()
    .from(meetingSegments)
    .where(and(eq(meetingSegments.meetingId, meetingId), eq(meetingSegments.userId, userId)))
    .orderBy(desc(meetingSegments.startedAt))
  return { meeting, segments }
}
