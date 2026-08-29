import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { MeetingSegmentUpload } from '@shared/meeting-intelligence'
import { registerMeetingIntelligenceRoutes } from './meeting-intelligence-routes'

const requireAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: '未登录' }, 401)
  }
  c.set('userId', 'test-user')
  await next()
}

const createApp = () => {
  const app = new Hono()
  registerMeetingIntelligenceRoutes(app, requireAuth)
  return app
}

const buildUpload = (): MeetingSegmentUpload => ({
  segmentId: 'seg-valid-1',
  deviceId: 'dev-phone-a',
  startedAt: '2026-08-12T09:00:00.000Z',
  endedAt: '2026-08-12T09:03:00.000Z',
  durationSec: 150,
  transcript: '我们要把下周的发布提前到周三。',
  speakerId: 'spk0',
  valueLabel: 'decision',
  confidence: 0.86,
  channels: ['cloud_db', 'cloud_agent'],
  isMeeting: true,
  meetingId: 'meet-1',
  meetingTitle: '周会',
})

test('未登录返回 401', async () => {
  const app = createApp()
  const res = await app.request('/api/meeting-intelligence/segments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload: buildUpload() }),
  })
  assert.equal(res.status, 401)
})

test('非法片段（缺必填字段）返回 400，不触发分发', async () => {
  const app = createApp()
  const invalid = buildUpload()
  invalid.transcript = ''
  const res = await app.request('/api/meeting-intelligence/segments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({ upload: invalid }),
  })
  assert.equal(res.status, 400)
  const body = (await res.json()) as { issues?: unknown }
  assert.ok(body.issues)
})

test('完全非法 body 返回 400', async () => {
  const app = createApp()
  const res = await app.request('/api/meeting-intelligence/segments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({ nope: true }),
  })
  assert.equal(res.status, 400)
})

test('实验性开关关闭时拒绝片段上传', async () => {
  const app = createApp()
  const res = await app.request('/api/meeting-intelligence/segments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({ upload: buildUpload() }),
  })
  assert.equal(res.status, 403)
  assert.match((await res.json() as { message?: string }).message ?? '', /实验性功能/)
})

test('会议列表与详情未登录返回 401', async () => {
  const app = createApp()
  const listRes = await app.request('/api/meeting-intelligence/meetings')
  assert.equal(listRes.status, 401)
  const detailRes = await app.request('/api/meeting-intelligence/meetings/meet-1')
  assert.equal(detailRes.status, 401)
})
