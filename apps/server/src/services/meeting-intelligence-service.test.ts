import assert from 'node:assert/strict'
import test from 'node:test'
import type { MeetingSegmentUpload } from '@shared/meeting-intelligence'
import { ingestMeetingSegment } from './meeting-intelligence-service'

const upload: MeetingSegmentUpload = {
  segmentId: 'segment-meeting-1',
  meetingId: 'meeting-1',
  deviceId: 'desktop-1',
  startedAt: '2026-08-27T09:00:00.000Z',
  endedAt: '2026-08-27T09:00:30.000Z',
  durationSec: 30,
  transcript: '周三前完成客户发布方案。',
  speakerId: 'S01',
  valueLabel: 'commitment',
  confidence: 0.91,
  channels: ['cloud_db', 'cloud_agent', 'memory_doc'],
  isMeeting: true,
  meetingTitle: '客户发布会',
}

test('valuable segment records workspace context and dispatches the resolved Brain Agent', async () => {
  const contextItems: Array<{ workspaceId: string; text: string }> = []
  const events: Array<{ targetAgentId?: string; scope?: Record<string, string>; payload?: Record<string, unknown> }> = []
  const memoryEntries: string[] = []

  const result = await ingestMeetingSegment({ userId: 'user-1', upload, workspaceId: 'workspace-1' }, {
    insertSegment: async () => {},
    upsertMeeting: async () => {},
    recordWorkspaceContext: (workspaceId, item) => contextItems.push({ workspaceId, text: item.text }),
    resolveWorkspaceBrain: async () => ({ brainAgentId: 'brain-agent-1', instructions: 'keep context current' }),
    publishAgentEvent: (event) => {
      events.push(event)
      return []
    },
    appendMemoryDocument: async (_userId, content) => { memoryEntries.push(content) },
  })

  assert.deepEqual(result, {
    stored: true,
    agentDispatched: true,
    memoryAppended: true,
    meetingUpserted: true,
    errors: [],
  })
  assert.deepEqual(contextItems, [{ workspaceId: 'workspace-1', text: '会议：客户发布会\n说话人：S01\n标签：commitment\n周三前完成客户发布方案。' }])
  assert.equal(events[0]?.targetAgentId, 'brain-agent-1')
  assert.deepEqual(events[0]?.scope, { workspaceId: 'workspace-1', meetingId: 'meeting-1' })
  assert.equal(events[0]?.payload?.transcript, upload.transcript)
  assert.equal(memoryEntries.length, 1)
})

test('Brain metadata failures do not prevent database delivery', async () => {
  const result = await ingestMeetingSegment({ userId: 'user-1', upload: { ...upload, channels: ['cloud_db'] }, workspaceId: 'workspace-1' }, {
    insertSegment: async () => {},
    upsertMeeting: async () => {},
    recordWorkspaceContext: () => { throw new Error('metadata unavailable') },
    resolveWorkspaceBrain: async () => ({ brainAgentId: 'brain-agent-1', instructions: 'keep context current' }),
  })

  assert.equal(result.stored, true)
  assert.equal(result.meetingUpserted, true)
  assert.deepEqual(result.errors, ['workspace_brain_context:metadata unavailable'])
})

test('disabled Brain does not receive meeting context', async () => {
  const contextItems: string[] = []
  const result = await ingestMeetingSegment({ userId: 'user-1', upload: { ...upload, channels: ['cloud_db'] }, workspaceId: 'workspace-1' }, {
    insertSegment: async () => {},
    upsertMeeting: async () => {},
    recordWorkspaceContext: (_workspaceId, item) => { contextItems.push(item.text) },
    resolveWorkspaceBrain: async () => null,
  })

  assert.equal(result.stored, true)
  assert.equal(result.meetingUpserted, true)
  assert.deepEqual(contextItems, [])
})
