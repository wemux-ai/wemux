// [INPUT]: meeting-intelligence-routes 的片段上传请求
// [OUTPUT]: 三通道分发（feature v4 决策②）——cloud_db / cloud_agent / memory_doc
// [POS]: 端侧有价值片段（仅文本）的云端入口；音频不出设备红线由端侧保证
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import {
  normalizeMeetingValueChannels,
  validateMeetingSegmentUpload,
  type MeetingSegmentUpload,
} from '@shared/meeting-intelligence'
import { publishAgentEvent } from './agent-event-runtime'
import { downloadDriveObject, uploadDriveObject } from './drive-storage'
import { insertMeetingSegment, upsertMeetingEntity } from '../storage/postgres/meeting-intelligence-store'
import { recordWorkspaceBrainContextItem, resolveWorkspaceBrainAgentForEvent } from './workspace-brain-service'

export type SegmentIngestResult = {
  /** 通道①：结构化落库 */
  stored: boolean
  /** 通道②：云端 Agent 事件派发 */
  agentDispatched: boolean
  /** 通道③：记忆文档追加 */
  memoryAppended: boolean
  /** 会议实体 upsert（isMeeting 时） */
  meetingUpserted: boolean
  errors: string[]
}

/** 记忆文档 key（每用户一份会议记录，追加式；非 Drive 前缀，属 meeting-intelligence 专属空间） */
const memoryDocKey = (userId: string) => `meetings/${userId.slice(0, 12)}/meeting-record.md`

const appendMemoryDoc = async (userId: string, content: string): Promise<void> => {
  let existing = ''
  try {
    const bytes = await downloadDriveObject(memoryDocKey(userId))
    existing = new TextDecoder().decode(bytes)
  } catch {
    // 首次创建：无历史文档
  }
  const updated = existing.trim() ? `${existing.trim()}\n\n${content}` : content
  await uploadDriveObject(memoryDocKey(userId), new TextEncoder().encode(updated), 'text/markdown')
}

const buildMemoryDocEntry = (upload: MeetingSegmentUpload): string => {
  const lines = [
    `### ${upload.startedAt}${upload.meetingTitle ? ` · ${upload.meetingTitle}` : ''}`,
    upload.speakerId ? `说话人：${upload.speakerId}` : '',
    upload.valueLabel ? `标签：${upload.valueLabel}` : '',
    upload.transcript,
  ]
  return lines.filter(Boolean).join('\n')
}

const buildWorkspaceContextEntry = (upload: MeetingSegmentUpload): string => {
  const lines = [
    `会议：${upload.meetingTitle?.trim() || '未命名会议'}`,
    upload.speakerId ? `说话人：${upload.speakerId}` : '',
    upload.valueLabel ? `标签：${upload.valueLabel}` : '',
    upload.transcript.trim(),
  ]
  return lines.filter(Boolean).join('\n')
}

export type MeetingIntelligenceDependencies = {
  insertSegment?: typeof insertMeetingSegment
  upsertMeeting?: typeof upsertMeetingEntity
  recordWorkspaceContext?: typeof recordWorkspaceBrainContextItem
  resolveWorkspaceBrain?: typeof resolveWorkspaceBrainAgentForEvent
  publishAgentEvent?: typeof publishAgentEvent
  appendMemoryDocument?: typeof appendMemoryDoc
}

/**
 * 摄取一条端侧价值片段并做三通道分发。
 * - 通道① cloud_db：片段落库 + isMeeting 时 upsert 会议实体（幂等）
 * - 通道② cloud_agent：向指定 Agent 或工作区 Brain Agent 派发 meeting.segment.valuable 事件
 * - 通道③ memory_doc：追加到用户会议记录文档
 * 返回各通道结果与错误；任一通道失败不阻断其余通道（尽量送达）。
 */
export const ingestMeetingSegment = async (params: {
  userId: string
  upload: MeetingSegmentUpload
  agentId?: string
  workspaceId?: string
}, dependencies: MeetingIntelligenceDependencies = {}): Promise<SegmentIngestResult> => {
  const { userId, upload, agentId } = params
  const workspaceId = params.workspaceId?.trim() || ''
  const insertSegment = dependencies.insertSegment ?? insertMeetingSegment
  const upsertMeeting = dependencies.upsertMeeting ?? upsertMeetingEntity
  const recordWorkspaceContext = dependencies.recordWorkspaceContext ?? recordWorkspaceBrainContextItem
  const resolveWorkspaceBrain = dependencies.resolveWorkspaceBrain ?? resolveWorkspaceBrainAgentForEvent
  const publishEvent = dependencies.publishAgentEvent ?? publishAgentEvent
  const appendMemoryDocument = dependencies.appendMemoryDocument ?? appendMemoryDoc
  const result: SegmentIngestResult = {
    stored: false,
    agentDispatched: false,
    memoryAppended: false,
    meetingUpserted: false,
    errors: [],
  }

  const validationErrors = validateMeetingSegmentUpload(upload)
  if (validationErrors.length > 0) {
    result.errors.push(...validationErrors.map((error) => `validate:${error}`))
    return result
  }

  const channels = normalizeMeetingValueChannels(upload.channels)
  const createdAt = new Date().toISOString()

  let resolvedBrain: Awaited<ReturnType<typeof resolveWorkspaceBrain>> = null
  if (workspaceId) {
    try {
      resolvedBrain = await resolveWorkspaceBrain(workspaceId)
    } catch (error) {
      result.errors.push(`workspace_brain_resolve:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (workspaceId && resolvedBrain && upload.transcript.trim()) {
    try {
      recordWorkspaceContext(workspaceId, {
        kind: 'event',
        source: upload.valueLabel || 'meeting.segment.valuable',
        text: buildWorkspaceContextEntry(upload),
      })
    } catch (error) {
      result.errors.push(`workspace_brain_context:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (channels.includes('cloud_db')) {
    try {
      await insertSegment({
        id: upload.segmentId,
        meetingId: upload.meetingId,
        userId,
        deviceId: upload.deviceId,
        roomId: upload.roomId,
        startedAt: upload.startedAt,
        endedAt: upload.endedAt,
        durationSec: upload.durationSec,
        transcript: upload.transcript,
        speakerId: upload.speakerId,
        valueLabel: upload.valueLabel,
        confidence: upload.confidence,
        channels,
        isMeeting: upload.isMeeting,
        meetingTitle: upload.meetingTitle,
        createdAt,
      })
      result.stored = true
    } catch (error) {
      result.errors.push(`cloud_db:${error instanceof Error ? error.message : String(error)}`)
    }

    if (upload.isMeeting && upload.meetingId) {
      try {
        await upsertMeeting({
          id: upload.meetingId,
          userId,
          title: upload.meetingTitle?.trim() || '未命名会议',
          roomId: upload.roomId,
          deviceId: upload.deviceId,
          startedAt: upload.startedAt,
          speakerIds: upload.speakerId ? [upload.speakerId] : [],
          status: 'active',
          createdAt,
        })
        result.meetingUpserted = true
      } catch (error) {
        result.errors.push(`meeting_upsert:${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  if (channels.includes('cloud_agent')) {
    try {
      const targetAgentId = agentId?.trim() || resolvedBrain?.brainAgentId
      if (targetAgentId) await publishEvent({
        type: 'meeting.segment.valuable',
        targetAgentId,
        actingUserId: userId,
        actor: { type: 'user', id: userId },
        scope: {
          ...(workspaceId ? { workspaceId } : {}),
          ...(upload.meetingId ? { meetingId: upload.meetingId } : {}),
        },
        payload: {
          segmentId: upload.segmentId,
          transcript: upload.transcript,
          speakerId: upload.speakerId,
          valueLabel: upload.valueLabel,
          confidence: upload.confidence,
          startedAt: upload.startedAt,
          meetingTitle: upload.meetingTitle,
          ...(resolvedBrain?.instructions ? { brainInstructions: resolvedBrain.instructions } : {}),
        },
        conversationKey: upload.meetingId ? `meeting:${upload.meetingId}` : `meeting:device:${upload.deviceId}`,
        idempotencyKey: `meeting-segment:${upload.segmentId}`,
      })
      result.agentDispatched = true
    } catch (error) {
      result.errors.push(`cloud_agent:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (channels.includes('memory_doc')) {
    try {
      await appendMemoryDocument(userId, buildMemoryDocEntry(upload))
      result.memoryAppended = true
    } catch (error) {
      result.errors.push(`memory_doc:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}
