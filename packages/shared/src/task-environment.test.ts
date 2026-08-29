import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceEnvironmentStatusSnapshot, getWorkspaceEnvironmentProbeUrl, resolveWorkspaceEnvironmentStatusFromProbe } from './task-environment'

test('getWorkspaceEnvironmentProbeUrl prefers health url over app url', () => {
  assert.equal(getWorkspaceEnvironmentProbeUrl({
    healthUrl: 'http://127.0.0.1:3000/healthz',
    appUrl: 'http://127.0.0.1:3000',
  }), 'http://127.0.0.1:3000/healthz')

  assert.equal(getWorkspaceEnvironmentProbeUrl({
    appUrl: 'http://127.0.0.1:3000',
  }), 'http://127.0.0.1:3000')
})

test('resolveWorkspaceEnvironmentStatusFromProbe maps reachable probe to running status', () => {
  const snapshot = resolveWorkspaceEnvironmentStatusFromProbe({
    probe: {
      ok: true,
      reachable: true,
      url: 'http://127.0.0.1:3000/healthz',
      statusCode: 200,
      finalUrl: 'http://127.0.0.1:3000/healthz',
      responseTimeMs: 120,
      at: '2026-05-11T10:00:00.000Z',
    },
  })

  assert.equal(snapshot.status, 'running')
  assert.equal(snapshot.httpStatus, 200)
  assert.equal(snapshot.url, 'http://127.0.0.1:3000/healthz')
})

test('resolveWorkspaceEnvironmentStatusFromProbe maps failed probe to unreachable status', () => {
  const snapshot = resolveWorkspaceEnvironmentStatusFromProbe({
    probe: {
      ok: false,
      reachable: false,
      url: 'http://127.0.0.1:3000/healthz',
      error: 'connect ECONNREFUSED 127.0.0.1:3000',
      responseTimeMs: 95,
      at: '2026-05-11T10:00:00.000Z',
    },
  })

  assert.equal(snapshot.status, 'unreachable')
  assert.match(snapshot.message, /ECONNREFUSED/)
})

test('createWorkspaceEnvironmentStatusSnapshot fills checkedAt by default', () => {
  const snapshot = createWorkspaceEnvironmentStatusSnapshot({
    status: 'starting',
    message: '环境启动命令已提交。',
  })

  assert.equal(snapshot.status, 'starting')
  assert.match(snapshot.checkedAt, /^\d{4}-\d{2}-\d{2}T/)
})
