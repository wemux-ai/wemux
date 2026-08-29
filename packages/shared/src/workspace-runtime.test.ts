import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isWorkspaceEnvironmentRuntimeVisible,
  normalizeWorkspaceSessionRuntimeSummary,
  resolveWorkspaceTerminalRuntimeStatus,
} from './workspace-runtime'

const nowMs = Date.parse('2026-06-01T10:00:00.000Z')

test('marks an old open terminal snapshot as stale', () => {
  assert.equal(resolveWorkspaceTerminalRuntimeStatus({
    status: 'open',
    sessionCount: 1,
    reportedAt: '2026-06-01T09:58:00.000Z',
  }, nowMs), 'stale')
})

test('keeps a recent terminal snapshot open', () => {
  assert.equal(resolveWorkspaceTerminalRuntimeStatus({
    status: 'open',
    sessionCount: 1,
    reportedAt: '2026-06-01T09:59:30.000Z',
  }, nowMs), 'open')
})

test('shows only fresh active environment snapshots', () => {
  assert.equal(isWorkspaceEnvironmentRuntimeVisible({
    status: 'running',
    message: 'reachable',
    checkedAt: '2026-06-01T09:59:30.000Z',
  }, nowMs), true)
  assert.equal(isWorkspaceEnvironmentRuntimeVisible({
    status: 'running',
    message: 'reachable',
    checkedAt: '2026-06-01T09:58:00.000Z',
  }, nowMs), false)
  assert.equal(isWorkspaceEnvironmentRuntimeVisible({
    status: 'stopped',
    message: 'stopped',
    checkedAt: '2026-06-01T09:59:30.000Z',
  }, nowMs), false)
})

test('normalizes persisted session runtime summaries', () => {
  assert.deepEqual(normalizeWorkspaceSessionRuntimeSummary({
    terminal: {
      status: 'open',
      sessionCount: 2,
      reportedAt: '2026-06-01T09:59:30.000Z',
      executorId: 'executor-1',
    },
    environment: {
      status: 'running',
      message: 'reachable',
      checkedAt: '2026-06-01T09:59:30.000Z',
      source: 'server-probe',
      workspaceSessionId: 'session-1',
    },
  }), {
    terminal: {
      status: 'open',
      sessionCount: 2,
      reportedAt: '2026-06-01T09:59:30.000Z',
      executorId: 'executor-1',
    },
    environment: {
      status: 'running',
      message: 'reachable',
      checkedAt: '2026-06-01T09:59:30.000Z',
      source: 'server-probe',
      workspaceSessionId: 'session-1',
      reportedByExecutorId: undefined,
      url: undefined,
      httpStatus: undefined,
    },
  })
})

