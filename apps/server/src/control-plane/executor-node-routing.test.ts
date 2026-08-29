import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ClusterNode,
  ExecutorDescriptor,
  ExecutorTerminalResult,
  ExecutorTerminalSessionCreateResult,
} from '@shared/types'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import { executorRequestRoutingDeps, forwardExecutorClusterRequest, resolveExecutorRequestTarget } from './executor-node-routing'

const createExecutor = (overrides: Partial<ExecutorDescriptor> = {}): ExecutorDescriptor => ({
  executorId: 'executor-1',
  machineId: 'machine-1',
  machineName: 'Machine 1',
  name: 'Worker 1',
  ownerUserId: 'user-1',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/tmp/vibemux',
  maxConcurrency: 5,
  capabilities: [],
  labels: [],
  createdAt: '2026-06-04T00:00:00.000Z',
  ...overrides,
})

const createNode = (overrides: Partial<ClusterNode> = {}): ClusterNode => ({
  nodeId: 'us-node-1',
  name: 'US Node 1',
  url: 'https://us.wemux.ai',
  relayUrl: 'https://relay.example.com',
  status: 'online',
  capabilities: ['code-execution'],
  activeTasks: 0,
  maxConcurrentTasks: 5,
  lastHeartbeatAt: new Date().toISOString(),
  ...overrides,
})

test('resolveExecutorRequestTarget keeps local executors on the current node', async () => {
  const socket = {
    OPEN: 1,
    readyState: 1,
    send: () => undefined,
    close: () => undefined,
  }
  const getSocketRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalSocket', () => socket)
  const getExecutorRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalExecutor', () => createExecutor())

  const target = await resolveExecutorRequestTarget('executor-1')

  getExecutorRestore.mock.restore()
  getSocketRestore.mock.restore()

  assert.equal(target.mode, 'local')
  assert.equal(target.executor.executorId, 'executor-1')
})

test('resolveExecutorRequestTarget forwards online executors to their connected node', async () => {
  const getSocketRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalSocket', () => null)
  const getExecutorRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalExecutor', () => null)
  const getPersistedExecutorFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getPersistedExecutorFresh',
    async () => ({
      executor: createExecutor({
        connectedNodeId: 'us-node-1',
      }),
      tokenHash: 'hash',
    }),
  )
  const getNodeFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getNodeFresh',
    async () => createNode(),
  )

  const target = await resolveExecutorRequestTarget('executor-1')

  getNodeFreshRestore.mock.restore()
  getPersistedExecutorFreshRestore.mock.restore()
  getExecutorRestore.mock.restore()
  getSocketRestore.mock.restore()

  assert.deepEqual(target, {
    mode: 'remote',
    executor: createExecutor({
      connectedNodeId: 'us-node-1',
    }),
    nodeId: 'us-node-1',
    relayUrl: 'https://relay.example.com',
  })
})

test('resolveExecutorRequestTarget reports node relay url gaps before forwarding', async () => {
  const getSocketRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalSocket', () => null)
  const getExecutorRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalExecutor', () => null)
  const getPersistedExecutorFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getPersistedExecutorFresh',
    async () => ({
      executor: createExecutor({
        connectedNodeId: 'eu-node-1',
      }),
      tokenHash: 'hash',
    }),
  )
  const getNodeFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getNodeFresh',
    async () => createNode({
      nodeId: 'eu-node-1',
      url: undefined,
      relayUrl: undefined,
    }),
  )

  const target = await resolveExecutorRequestTarget('executor-1')

  getNodeFreshRestore.mock.restore()
  getPersistedExecutorFreshRestore.mock.restore()
  getExecutorRestore.mock.restore()
  getSocketRestore.mock.restore()

  assert.deepEqual(target, {
    mode: 'unavailable',
    executor: createExecutor({
      connectedNodeId: 'eu-node-1',
    }),
    nodeId: 'eu-node-1',
    reason: 'node-relay-url-missing',
  })
})

test('resolveExecutorRequestTarget falls back to node public url when relay url is not configured yet', async () => {
  const getSocketRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalSocket', () => null)
  const getExecutorRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalExecutor', () => null)
  const getPersistedExecutorFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getPersistedExecutorFresh',
    async () => ({
      executor: createExecutor({
        connectedNodeId: 'eu-node-1',
      }),
      tokenHash: 'hash',
    }),
  )
  const getNodeFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getNodeFresh',
    async () => createNode({
      nodeId: 'eu-node-1',
      relayUrl: undefined,
      url: 'https://eu.wemux.ai',
    }),
  )

  const target = await resolveExecutorRequestTarget('executor-1')

  getNodeFreshRestore.mock.restore()
  getPersistedExecutorFreshRestore.mock.restore()
  getExecutorRestore.mock.restore()
  getSocketRestore.mock.restore()

  assert.deepEqual(target, {
    mode: 'remote',
    executor: createExecutor({
      connectedNodeId: 'eu-node-1',
    }),
    nodeId: 'eu-node-1',
    relayUrl: 'https://eu.wemux.ai',
  })
})

test('resolveExecutorRequestTarget reports owning node lease expiry before forwarding', async () => {
  const getSocketRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalSocket', () => null)
  const getExecutorRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalExecutor', () => null)
  const getPersistedExecutorFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getPersistedExecutorFresh',
    async () => ({
      executor: createExecutor({
        connectedNodeId: 'dead-node',
      }),
      tokenHash: 'hash',
    }),
  )
  const getNodeFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getNodeFresh',
    async () => createNode({
      nodeId: 'dead-node',
      lastHeartbeatAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    }),
  )

  const target = await resolveExecutorRequestTarget('executor-1')

  getNodeFreshRestore.mock.restore()
  getPersistedExecutorFreshRestore.mock.restore()
  getExecutorRestore.mock.restore()
  getSocketRestore.mock.restore()

  assert.deepEqual(target, {
    mode: 'unavailable',
    executor: createExecutor({
      connectedNodeId: 'dead-node',
    }),
    nodeId: 'dead-node',
    reason: 'owning-node-offline',
  })
})

test('resolveExecutorRequestTarget reports missing owning node before forwarding', async () => {
  const getSocketRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalSocket', () => null)
  const getExecutorRestore = test.mock.method(executorRequestRoutingDeps, 'getLocalExecutor', () => null)
  const getPersistedExecutorFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getPersistedExecutorFresh',
    async () => ({
      executor: createExecutor({
        connectedNodeId: 'gone-node',
      }),
      tokenHash: 'hash',
    }),
  )
  const getNodeFreshRestore = test.mock.method(
    executorRequestRoutingDeps,
    'getNodeFresh',
    async () => null,
  )

  const target = await resolveExecutorRequestTarget('executor-1')

  getNodeFreshRestore.mock.restore()
  getPersistedExecutorFreshRestore.mock.restore()
  getExecutorRestore.mock.restore()
  getSocketRestore.mock.restore()

  assert.deepEqual(target, {
    mode: 'unavailable',
    executor: createExecutor({
      connectedNodeId: 'gone-node',
    }),
    nodeId: 'gone-node',
    reason: 'owning-node-offline',
  })
})

test('forwardExecutorClusterRequest posts terminal command payloads to the owning node', async () => {
  const runtimeEnvironment: RuntimeEnvironmentExecutionPayload = {
    mode: 'process-env',
    variables: {
      OPENAI_API_KEY: 'test-key',
    },
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://relay.example.com/api/internal/cluster/executors/executor-1/request')
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      operation: 'terminal-command',
      command: 'pnpm dev',
      cwd: '/tmp/worktree',
      mode: 'background',
      runtimeEnvironment,
      timeoutMs: 25000,
    })

    return new Response(JSON.stringify({
      result: {
        command: 'pnpm dev',
        cwd: '/tmp/worktree',
        stdout: '',
        stderr: '',
        exitCode: 0,
        mode: 'background',
        detached: true,
        at: '2026-06-04T00:00:00.000Z',
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  try {
    const result = await forwardExecutorClusterRequest<ExecutorTerminalResult>({
      executorId: 'executor-1',
      target: {
        mode: 'remote',
        executor: createExecutor({
          connectedNodeId: 'us-node-1',
        }),
        nodeId: 'us-node-1',
        relayUrl: 'https://relay.example.com',
      },
      request: {
        operation: 'terminal-command',
        command: 'pnpm dev',
        cwd: '/tmp/worktree',
        mode: 'background',
        runtimeEnvironment,
        timeoutMs: 25000,
      },
    })

    assert.equal(result.mode, 'background')
    assert.equal(result.detached, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('forwardExecutorClusterRequest posts terminal session creation payloads to the owning node', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      operation: 'terminal-session-create',
      terminalId: 'default',
      scope: 'workspace',
      workspaceId: 'workspace-1',
      title: 'Workspace Shell',
      cwd: '/tmp/worktree',
      cols: 120,
      rows: 40,
      ownerUserId: 'user-1',
      timeoutMs: 15000,
    })

    return new Response(JSON.stringify({
      result: {
        ok: true,
        created: true,
        session: {
          terminalId: 'default',
          terminalKey: 'workspace:executor-1:workspace-1:default',
          scope: 'workspace',
          workspaceId: 'workspace-1',
          status: 'running',
          title: 'Workspace Shell',
          createdAt: '2026-06-04T00:00:00.000Z',
          updatedAt: '2026-06-04T00:00:00.000Z',
        },
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  try {
    const result = await forwardExecutorClusterRequest<ExecutorTerminalSessionCreateResult>({
      executorId: 'executor-1',
      target: {
        mode: 'remote',
        executor: createExecutor({
          connectedNodeId: 'us-node-1',
        }),
        nodeId: 'us-node-1',
        relayUrl: 'https://relay.example.com',
      },
      request: {
        operation: 'terminal-session-create',
        terminalId: 'default',
        scope: 'workspace',
        workspaceId: 'workspace-1',
        title: 'Workspace Shell',
        cwd: '/tmp/worktree',
        cols: 120,
        rows: 40,
        ownerUserId: 'user-1',
        timeoutMs: 15000,
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.created, true)
    assert.equal(result.session?.terminalId, 'default')
  } finally {
    globalThis.fetch = originalFetch
  }
})
