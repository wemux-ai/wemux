import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSession } from '@shared/types'
import {
  getWorkspaceSessionDisplayStatus,
  isWorkspaceSessionAwaitingConfirmation,
  isWorkspaceSessionBusy,
} from './workspace-session-status'

const createSession = (
  patch: Partial<Pick<WorkspaceSession, 'agentRunningStatus' | 'needsHumanConfirm' | 'runtimeStatus' | 'lastHeartbeatAt'>> = {},
): Pick<WorkspaceSession, 'agentRunningStatus' | 'needsHumanConfirm' | 'runtimeStatus' | 'lastHeartbeatAt'> => ({
  agentRunningStatus: 'idle',
  needsHumanConfirm: false,
  runtimeStatus: 'idle',
  lastHeartbeatAt: '',
  ...patch,
})

test('running workspace sessions stay in running state', () => {
  const session = createSession({ agentRunningStatus: 'executing', runtimeStatus: 'running' })

  assert.equal(isWorkspaceSessionBusy(session), true)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'running')
})

test('busy agent status is not hidden by stale idle runtime status', () => {
  const session = createSession({ agentRunningStatus: 'executing', runtimeStatus: 'idle' })

  assert.equal(isWorkspaceSessionBusy(session), true)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'running')
})

test('worker-confirmed completed runtime status is not hidden by stale busy agent status', () => {
  // worker 反馈 runtimeStatus='completed' 时，即使 agentRunningStatus 还是陈旧的 executing，
  // 也按 worker 反馈显示完成——运行与否以 worker 反馈为准，不被本地/页面推断覆盖。
  const session = createSession({ agentRunningStatus: 'executing', runtimeStatus: 'completed' })

  assert.equal(isWorkspaceSessionBusy(session), true)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'complete')
})

test('queued workspace sessions surface queued state without looking idle', () => {
  const session = createSession({ agentRunningStatus: 'thinking', runtimeStatus: 'queued' })

  assert.equal(isWorkspaceSessionBusy(session), false)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'queued')
})

test('completed workspace sessions waiting for confirmation show attention state', () => {
  const session = createSession({
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
    runtimeStatus: 'completed',
  })

  assert.equal(isWorkspaceSessionAwaitingConfirmation(session), true)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'attention')
})

test('completed workspace sessions without confirmation stay completed', () => {
  const session = createSession({ agentRunningStatus: 'complete', runtimeStatus: 'completed' })

  assert.equal(getWorkspaceSessionDisplayStatus(session), 'complete')
})

test('stale complete agent status does not hide an active running runtime status', () => {
  // PR 合并/交付刷新等路径只写 agentRunningStatus='complete' 而保留 runtimeStatus='running'，
  // 与 executor 心跳交替写入时若让 complete 优先，卡片会在「运行中」和「已完成」之间来回跳。
  const session = createSession({ agentRunningStatus: 'complete', runtimeStatus: 'running' })

  assert.equal(isWorkspaceSessionBusy(session), false)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'running')
})

test('stale complete agent status does not hide an active running runtime status while waiting for confirmation', () => {
  const session = createSession({
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
    runtimeStatus: 'running',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session), 'running')
})

test('running sessions with a fresh worker heartbeat stay running', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z')
  const session = createSession({
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    lastHeartbeatAt: '2026-08-20T11:59:30.000Z',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session, now), 'running')
})

test('running sessions with a stale worker heartbeat show error instead of running', () => {
  // worker 心跳超过 45s 未更新 → 反馈断了，不再显示「运行中」。
  const now = Date.parse('2026-08-20T12:00:00.000Z')
  const session = createSession({
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    lastHeartbeatAt: '2026-08-20T11:58:00.000Z',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session, now), 'error')
})

test('running sessions without a heartbeat record are not judged stale', () => {
  // 直连执行路径无心跳维持（lastHeartbeatAt 为空）→ 不做新鲜度判定。
  const now = Date.parse('2026-08-20T12:00:00.000Z')
  const session = createSession({
    agentRunningStatus: 'executing',
    runtimeStatus: 'running',
    lastHeartbeatAt: '',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session, now), 'running')
})

test('completed runtime status is not affected by a stale heartbeat', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z')
  const session = createSession({
    agentRunningStatus: 'complete',
    runtimeStatus: 'completed',
    lastHeartbeatAt: '2026-08-20T10:00:00.000Z',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session, now), 'complete')
})

test('failed agent status wins over stale running runtime status', () => {
  const session = createSession({ agentRunningStatus: 'error', runtimeStatus: 'running' })

  assert.equal(isWorkspaceSessionBusy(session), false)
  assert.equal(getWorkspaceSessionDisplayStatus(session), 'error')
})

test('completed agent status still wins when runtime status is completed', () => {
  const session = createSession({
    agentRunningStatus: 'complete',
    needsHumanConfirm: true,
    runtimeStatus: 'completed',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session), 'attention')
})

test('lost workspace sessions show error state', () => {
  const session = createSession({ runtimeStatus: 'lost' })

  assert.equal(getWorkspaceSessionDisplayStatus(session), 'error')
})

test('runtime errors override stale completed agent status', () => {
  const session = createSession({
    agentRunningStatus: 'complete',
    runtimeStatus: 'lost',
  })

  assert.equal(getWorkspaceSessionDisplayStatus(session), 'error')
})
