import assert from 'node:assert/strict'
import test from 'node:test'
import { buildClusterTerminalRelayWebSocketUrl, resolveTerminalOpenFailure } from './executor-ws-route'

test('buildClusterTerminalRelayWebSocketUrl converts relay url to ws relay endpoint with query context', () => {
  assert.equal(
    buildClusterTerminalRelayWebSocketUrl({
      relayUrl: 'https://relay.example.com/base',
      executorId: 'executor-1',
      cwd: '/tmp/worktree',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      terminalId: 'default',
      terminalScope: 'workspace',
      terminalTitle: 'Workspace Shell',
    }),
    'wss://relay.example.com/api/internal/cluster/executors/executor-1/terminal-relay/ws?cwd=%2Ftmp%2Fworktree&projectId=project-1&workspaceId=workspace-1&terminalId=default&terminalScope=workspace&terminalTitle=Workspace+Shell',
  )
})

test('buildClusterTerminalRelayWebSocketUrl preserves ws scheme for plain http relay urls', () => {
  assert.equal(
    buildClusterTerminalRelayWebSocketUrl({
      relayUrl: 'http://127.0.0.1:18989',
      executorId: 'executor-1',
      terminalId: 'default',
      terminalScope: 'executor',
    }),
    'ws://127.0.0.1:18989/api/internal/cluster/executors/executor-1/terminal-relay/ws?terminalId=default&terminalScope=executor',
  )
})

test('terminal session misses become a non-retrying unavailable frame', () => {
  assert.deepEqual(
    resolveTerminalOpenFailure(new Error('终端会话不存在。'), '2026-07-17T00:00:00.000Z'),
    {
      frame: {
        type: 'unavailable',
        message: '终端会话不存在。',
        at: '2026-07-17T00:00:00.000Z',
      },
      closeCode: 1000,
      closeReason: 'terminal unavailable',
    },
  )
})
