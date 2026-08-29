import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LIFECYCLE_POLICY,
  DEFAULT_VAD_CONFIG,
  formatSpeakerLabel,
  isLocalSegmentExpired,
  normalizeMeetingValueChannels,
  validateMeetingSegmentUpload,
  type MeetingSegmentUpload,
} from './meeting-intelligence'

const DAY_MS = 24 * 60 * 60 * 1000

const baseUpload = (): MeetingSegmentUpload => ({
  segmentId: 'seg-1',
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
  meetingTitle: '周会',
})

test('validateMeetingSegmentUpload 通过合法载荷', () => {
  assert.deepEqual(validateMeetingSegmentUpload(baseUpload()), [])
})

test('validateMeetingSegmentUpload 报缺失必填字段', () => {
  const upload = baseUpload()
  const broken = {
    ...upload,
    transcript: undefined,
    channels: [],
  } as unknown as MeetingSegmentUpload
  const errors = validateMeetingSegmentUpload(broken)
  assert.ok(errors.includes('missing:transcript'))
  assert.ok(errors.includes('empty:channels'))
})

test('validateMeetingSegmentUpload 报时间区间错误', () => {
  const upload = baseUpload()
  upload.endedAt = '2026-08-12T08:00:00.000Z'
  assert.ok(validateMeetingSegmentUpload(upload).includes('invalid:timeRange'))
})

test('normalizeMeetingValueChannels 去重保序', () => {
  assert.deepEqual(
    normalizeMeetingValueChannels(['cloud_agent', 'cloud_db', 'cloud_agent', 'memory_doc']),
    ['cloud_agent', 'cloud_db', 'memory_doc'],
  )
})

test('isLocalSegmentExpired 按音频保留天数过期', () => {
  const now = Date.now()
  assert.equal(isLocalSegmentExpired(now, DEFAULT_LIFECYCLE_POLICY, now + 1000), false)
  assert.equal(
    isLocalSegmentExpired(now, DEFAULT_LIFECYCLE_POLICY, now + 8 * DAY_MS),
    true,
  )
  // 恰好等于保留期不算过期
  assert.equal(
    isLocalSegmentExpired(now, DEFAULT_LIFECYCLE_POLICY, now + 7 * DAY_MS),
    false,
  )
})

test('formatSpeakerLabel 渲染说话人标签', () => {
  assert.equal(formatSpeakerLabel('spk0'), '说话人 0')
  assert.equal(formatSpeakerLabel('SPK2'), '说话人 2')
  assert.equal(formatSpeakerLabel('自定义名'), '自定义名')
})

test('DEFAULT_VAD_CONFIG 满足 feature 参数区间', () => {
  assert.ok(DEFAULT_VAD_CONFIG.silenceMs >= 1500 && DEFAULT_VAD_CONFIG.silenceMs <= 3000)
  assert.ok(DEFAULT_VAD_CONFIG.maxSegmentMs >= 5 * 60 * 1000 && DEFAULT_VAD_CONFIG.maxSegmentMs <= 10 * 60 * 1000)
  assert.ok(DEFAULT_VAD_CONFIG.dropShorterThanMs >= 3000)
  assert.ok(DEFAULT_VAD_CONFIG.paddingMs >= 300 && DEFAULT_VAD_CONFIG.paddingMs <= 500)
})
