import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveEffectiveWorkspaceRuntimeStatus,
  toAgentRunningStatusFromRuntimeStatus,
} from './task-workspace-runtime-state'

test('resolveEffectiveWorkspaceRuntimeStatus marks stale running workspaces lost', () => {
  const staleAt = new Date(Date.now() - 60_000).toISOString()

  assert.equal(
    resolveEffectiveWorkspaceRuntimeStatus({
      runtimeStatus: 'running',
      lastHeartbeatAt: staleAt,
    }),
    'lost',
  )

  assert.equal(
    resolveEffectiveWorkspaceRuntimeStatus({
      runtimeStatus: 'waiting',
      lastHeartbeatAt: staleAt,
    }),
    'lost',
  )
})

test('toAgentRunningStatusFromRuntimeStatus maps lost to error', () => {
  assert.equal(toAgentRunningStatusFromRuntimeStatus('lost'), 'error')
})
