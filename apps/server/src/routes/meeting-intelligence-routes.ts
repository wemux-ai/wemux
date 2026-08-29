// [INPUT]: 已鉴权 Hono app + requireAuth；端侧录音 APP 的上传与会议查询请求
// [OUTPUT]: /api/meeting-intelligence/segments|meetings|meetings/:id
// [POS]: 会议智能（feature）云端三通道的 HTTP 协议层；端侧只传文本，音频不出设备
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  validateMeetingSegmentUpload,
  type MeetingSegmentUpload,
} from '@shared/meeting-intelligence'
import { ingestMeetingSegment } from '../services/meeting-intelligence-service'
import { isWorkspaceMember } from '../repositories/workspace'
import { getUserExperimentalSettings } from '../services/user-experimental-settings-service'
import {
  getMeetingDetail,
  listMeetings,
} from '../storage/postgres/meeting-intelligence-store'
import { getUserIdFromHeader } from './shared'

const segmentUploadSchema = z.object({
  upload: z.custom<MeetingSegmentUpload>((value) => validateMeetingSegmentUpload(value as MeetingSegmentUpload).length === 0),
  agentId: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
})

export const registerMeetingIntelligenceRoutes = (app: Hono, requireAuth: MiddlewareHandler) => {
  // 端侧上传价值片段（仅文本），三通道分发
  app.post('/api/meeting-intelligence/segments', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }

    const body = await c.req.json().catch(() => null)
    const parsed = segmentUploadSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ message: '片段不合法', issues: parsed.error.flatten() }, 400)
    }
    if (!getUserExperimentalSettings(userId).meetingListening) {
      return c.json({ message: '背后听写是实验性功能，请先在设置中开启。' }, 403)
    }
    if (parsed.data.workspaceId && !(await isWorkspaceMember(parsed.data.workspaceId, userId))) {
      return c.json({ message: '无权限访问这个组织。' }, 403)
    }

    const result = await ingestMeetingSegment({
      userId,
      upload: parsed.data.upload,
      agentId: parsed.data.agentId,
      workspaceId: parsed.data.workspaceId,
    })

    const status = result.errors.length === 0 ? 201 : 207
    return c.json({ result }, status)
  })

  // 会议列表（按开始时间倒序）
  app.get('/api/meeting-intelligence/meetings', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const limit = Number(c.req.query('limit') ?? '50')
    const meetings = await listMeetings(userId, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50)
    return c.json({ meetings })
  })

  // 会议详情 + 片段
  app.get('/api/meeting-intelligence/meetings/:id', requireAuth, async (c) => {
    const userId = getUserIdFromHeader(c)
    if (!userId) {
      return c.json({ message: '未登录' }, 401)
    }
    const meetingId = c.req.param('id')?.trim()
    if (!meetingId) {
      return c.json({ message: '会议 ID 缺失' }, 400)
    }
    const detail = await getMeetingDetail(userId, meetingId)
    if (!detail.meeting) {
      return c.json({ message: '会议不存在' }, 404)
    }
    return c.json(detail)
  })
}
