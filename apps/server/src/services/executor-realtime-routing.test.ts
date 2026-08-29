import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClusterNode, ExecutorDescriptor } from '@shared/types'
import { executorRealtimeRoutingDeps, resolveExecutorRealtimeBaseUrl } from './executor-realtime-routing'

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

test('resolveExecutorRealtimeBaseUrl prefers connected node public url instead of relay url', () => {
  const getNodeRestore = test.mock.method(executorRealtimeRoutingDeps, 'getNode', () => ({
    nodeId: 'us-node-1',
    name: 'US Node 1',
    url: 'https://us.wemux.ai',
    relayUrl: 'https://relay.example.com',
    status: 'online',
    capabilities: [],
    activeTasks: 0,
    maxConcurrentTasks: 5,
    lastHeartbeatAt: new Date().toISOString(),
  } satisfies ClusterNode))

  const baseUrl = resolveExecutorRealtimeBaseUrl(createExecutor({
    connectedNodeId: 'us-node-1',
    labels: ['route:us'],
  }))

  getNodeRestore.mock.restore()

  assert.equal(baseUrl, 'https://us.wemux.ai')
})

test('resolveExecutorRealtimeBaseUrl falls back when the owning node heartbeat is stale', () => {
  const previousRules = process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON
  process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = JSON.stringify([
    {
      id: 'us',
      cloudUrl: 'https://us.wemux.ai',
      labels: ['route:us', 'realtime:us'],
      continents: ['NA'],
    },
  ])
  const getNodeRestore = test.mock.method(executorRealtimeRoutingDeps, 'getNode', () => ({
    nodeId: 'us-node-1',
    name: 'US Node 1',
    url: 'https://us-node-1.dead.example',
    relayUrl: 'https://relay.example.com',
    status: 'online',
    capabilities: [],
    activeTasks: 0,
    maxConcurrentTasks: 5,
    lastHeartbeatAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  } satisfies ClusterNode))

  try {
    const baseUrl = resolveExecutorRealtimeBaseUrl(createExecutor({
      connectedNodeId: 'us-node-1',
      labels: ['route:us'],
    }))

    assert.equal(baseUrl, 'https://us.wemux.ai')
  } finally {
    getNodeRestore.mock.restore()
    if (previousRules === undefined) {
      delete process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON
    } else {
      process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = previousRules
    }
  }
})

test('resolveExecutorRealtimeBaseUrl falls back to region rule labels when node url is unavailable', () => {
  const previousRules = process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON
  process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = JSON.stringify([
    {
      id: 'us',
      cloudUrl: 'https://us.wemux.ai',
      labels: ['route:us', 'realtime:us'],
      continents: ['NA'],
    },
  ])
  const getNodeRestore = test.mock.method(executorRealtimeRoutingDeps, 'getNode', () => null)

  try {
    const baseUrl = resolveExecutorRealtimeBaseUrl(createExecutor({
      labels: ['route:us'],
    }))

    assert.equal(baseUrl, 'https://us.wemux.ai')
  } finally {
    getNodeRestore.mock.restore()
    if (previousRules === undefined) {
      delete process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON
    } else {
      process.env.VIBEMUX_EXECUTOR_ROUTE_RULES_JSON = previousRules
    }
  }
})
