import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMeetingSegmentUploads } from './meeting-listening-client'

test('buildMeetingSegmentUploads only forwards valuable local-runtime text', () => {
  const uploads = buildMeetingSegmentUploads({
    deviceId: 'desktop-a',
    meetingId: 'meeting-a',
    meetingTitle: '背后听写',
    segments: [
      {
        startedAt: '2026-08-27T09:00:00.000Z',
        endedAt: '2026-08-27T09:00:12.000Z',
        transcript: '我们确认周五发布。',
        speakerId: 'S01',
        valuable: true,
        valueLabel: 'decision',
        confidence: 0.91,
        channels: ['cloud_agent'],
      },
      {
        startedAt: '2026-08-27T09:00:12.000Z',
        endedAt: '2026-08-27T09:00:20.000Z',
        transcript: '今天天气不错。',
        valuable: false,
      },
    ],
  })

  assert.equal(uploads.length, 1)
  assert.equal(uploads[0]?.durationSec, 12)
  assert.equal(uploads[0]?.speakerId, 'S01')
  assert.deepEqual(uploads[0]?.channels, ['cloud_db', 'cloud_agent'])
})
