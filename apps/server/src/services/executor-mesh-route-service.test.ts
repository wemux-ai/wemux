import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorDescriptor, ExecutorPresenceSnapshot, WorkerMeshStatus } from '@shared/types'
import type { PreviewSessionRecord } from './preview-session-record'
import {
  resolvePreviewAccessRoute,
  resolveTerminalAccessRoute,
} from './executor-mesh-route-service'

const now = new Date().toISOString()

const createExecutor = (patch: Partial<ExecutorDescriptor> = {}): ExecutorDescriptor => ({
  executorId: 'executor-a',
  machineId: 'machine-a',
  machineName: 'Machine A',
  name: 'Worker A',
  ownerUserId: 'user-1',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/tmp/vibemux',
  maxConcurrency: 5,
  capabilities: [],
  labels: [],
  createdAt: now,
  ...patch,
})

const createMesh = (patch: Partial<WorkerMeshStatus> = {}): WorkerMeshStatus => ({
  enabled: true,
  status: 'ready',
  meshNodeId: 'node-a',
  meshIpv4: '10.144.1.2',
  routeMode: 'unknown',
  peers: [],
  reportedAt: now,
  ...patch,
})

const createPresence = (mesh: WorkerMeshStatus): ExecutorPresenceSnapshot => ({
  runningTaskIds: [],
  queuedTaskIds: [],
  lastHeartbeatAt: now,
  mesh,
})

const createPreviewSession = (patch: Partial<PreviewSessionRecord> = {}): PreviewSessionRecord => ({
  id: 'preview-1',
  purpose: 'app',
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  workspaceSessionId: 'workspace-session-1',
  executorId: 'executor-b',
  ownerUserId: 'user-1',
  executionSurface: 'private-node',
  accessMode: 'tunnel',
  status: 'active',
  source: {
    appUrl: 'http://127.0.0.1:5173/app',
    targetProtocol: 'http',
    targetHost: '127.0.0.1',
    targetPort: 5173,
    targetBasePath: '/app',
  },
  additionalSources: [],
  additionalSourceBindings: [],
  publicHost: 'preview.example.com',
  publicUrl: 'https://preview.example.com',
  tunnelTokenHash: 'hash',
  createdAt: now,
  updatedAt: now,
  ...patch,
})

test('resolvePreviewAccessRoute chooses mesh-direct when both executors are ready peers in the same scope', () => {
  const sourceExecutor = createExecutor({
    executorId: 'executor-a',
    ownerUserId: 'user-1',
  })
  const targetExecutor = createExecutor({
    executorId: 'executor-b',
    ownerUserId: 'user-1',
  })
  const targetMesh = createMesh({
    meshNodeId: 'node-b',
    meshIpv4: '10.144.9.20',
  })
  const sourceMesh = createMesh({
    meshNodeId: 'node-a',
    meshIpv4: '10.144.1.2',
    peers: [{
      meshNodeId: 'node-b',
      meshIpv4: '10.144.9.20',
      routeMode: 'direct',
      latencyMs: 8,
      lastSeenAt: now,
    }],
  })

  const route = resolvePreviewAccessRoute({
    session: createPreviewSession(),
    sourceExecutorId: sourceExecutor.executorId,
    sourceExecutor,
    targetExecutor,
    sourcePresence: createPresence(sourceMesh),
    targetPresence: createPresence(targetMesh),
    meshPreviewProxyPort: 39080,
    targetPreviewProxySecret: 'secret',
    now,
  })

  assert.equal(route.mode, 'mesh-direct')
  assert.equal(route.meshIpv4, '10.144.9.20')
  assert.equal(route.port, 39080)
  assert.match(route.url ?? '', /^http:\/\/10\.144\.9\.20:39080\/api\/preview-mesh\/http\/preview-1\/app\?vmx_mesh_token=/)
  assert.ok(route.expiresAt)
})

test('resolvePreviewAccessRoute falls back to preview-gateway without a source mesh executor', () => {
  const route = resolvePreviewAccessRoute({
    session: createPreviewSession(),
    now,
  })

  assert.equal(route.mode, 'preview-gateway')
  assert.equal(route.url, 'https://preview.example.com')
})

test('resolvePreviewAccessRoute falls back when workers do not share a mesh trust scope', () => {
  const route = resolvePreviewAccessRoute({
    session: createPreviewSession(),
    sourceExecutorId: 'executor-a',
    sourceExecutor: createExecutor({ executorId: 'executor-a', ownerUserId: 'user-1' }),
    targetExecutor: createExecutor({ executorId: 'executor-b', ownerUserId: 'user-2' }),
    sourcePresence: createPresence(createMesh({ meshNodeId: 'node-a', meshIpv4: '10.144.1.2' })),
    targetPresence: createPresence(createMesh({ meshNodeId: 'node-b', meshIpv4: '10.144.9.20' })),
    now,
  })

  assert.equal(route.mode, 'preview-gateway')
})

test('resolvePreviewAccessRoute allows workers that share one workspace scope', () => {
  const route = resolvePreviewAccessRoute({
    session: createPreviewSession(),
    sourceExecutorId: 'executor-a',
    sourceExecutor: createExecutor({
      executorId: 'executor-a',
      ownerUserId: 'user-1',
      workspaceIds: ['workspace-shared'],
    }),
    targetExecutor: createExecutor({
      executorId: 'executor-b',
      ownerUserId: 'user-2',
      workspaceIds: ['workspace-shared'],
    }),
    sourcePresence: createPresence(createMesh({
      meshNodeId: 'node-a',
      meshIpv4: '10.144.9.2',
      peers: [{
        meshNodeId: 'node-b',
        meshIpv4: '10.144.9.20',
        routeMode: 'direct',
        lastSeenAt: now,
      }],
    })),
    targetPresence: createPresence(createMesh({
      meshNodeId: 'node-b',
      meshIpv4: '10.144.9.20',
    })),
    meshPreviewProxyPort: 39080,
    targetPreviewProxySecret: 'secret',
    now,
  })

  assert.equal(route.mode, 'mesh-direct')
})

test('resolvePreviewAccessRoute can select mesh-relayed from peer route quality', () => {
  const route = resolvePreviewAccessRoute({
    session: createPreviewSession(),
    sourceExecutorId: 'executor-a',
    sourceExecutor: createExecutor({ executorId: 'executor-a' }),
    targetExecutor: createExecutor({ executorId: 'executor-b' }),
    sourcePresence: createPresence(createMesh({
      meshNodeId: 'node-a',
      meshIpv4: '10.144.1.2',
      peers: [{
        meshNodeId: 'node-b',
        meshIpv4: '10.144.9.20',
        routeMode: 'relayed',
        lastSeenAt: now,
      }],
    })),
    targetPresence: createPresence(createMesh({
      meshNodeId: 'node-b',
      meshIpv4: '10.144.9.20',
    })),
    meshPreviewProxyPort: 39080,
    targetPreviewProxySecret: 'secret',
    now,
  })

  assert.equal(route.mode, 'mesh-relayed')
  assert.match(route.url ?? '', /^http:\/\/10\.144\.9\.20:39080\/api\/preview-mesh\/http\/preview-1\/app\?vmx_mesh_token=/)
})

test('resolvePreviewAccessRoute ignores stale peer routes', () => {
  const staleAt = new Date(Date.now() - 120_000).toISOString()
  const route = resolvePreviewAccessRoute({
    session: createPreviewSession(),
    sourceExecutorId: 'executor-a',
    sourceExecutor: createExecutor({ executorId: 'executor-a' }),
    targetExecutor: createExecutor({ executorId: 'executor-b' }),
    sourcePresence: createPresence(createMesh({
      meshNodeId: 'node-a',
      meshIpv4: '10.144.1.2',
      peers: [{
        meshNodeId: 'node-b',
        meshIpv4: '10.144.9.20',
        routeMode: 'direct',
        lastSeenAt: staleAt,
      }],
    })),
    targetPresence: createPresence(createMesh({
      meshNodeId: 'node-b',
      meshIpv4: '10.144.9.20',
    })),
    now,
  })

  assert.equal(route.mode, 'preview-gateway')
})

test('resolveTerminalAccessRoute keeps control-plane fallback until source and peer route are known', () => {
  const fallback = resolveTerminalAccessRoute({
    workspaceId: 'workspace-1',
    terminalId: 'terminal-1',
    targetExecutorId: 'executor-b',
    sourceExecutorId: 'executor-a',
    now,
  })

  assert.equal(fallback.mode, 'control-plane-ws')

  const meshRoute = resolveTerminalAccessRoute({
    workspaceId: 'workspace-1',
    terminalId: 'terminal-1',
    targetExecutorId: 'executor-b',
    sourceExecutorId: 'executor-a',
    meshPort: 39001,
    sourceExecutor: createExecutor({ executorId: 'executor-a' }),
    targetExecutor: createExecutor({ executorId: 'executor-b' }),
    sourcePresence: createPresence(createMesh({
      meshNodeId: 'node-a',
      meshIpv4: '10.144.1.2',
      peers: [{
        meshNodeId: 'node-b',
        meshIpv4: '10.144.9.20',
        routeMode: 'direct',
        lastSeenAt: now,
      }],
    })),
    targetPresence: createPresence(createMesh({
      meshNodeId: 'node-b',
      meshIpv4: '10.144.9.20',
    })),
    meshTerminalProxyPort: 39080,
    targetPreviewProxySecret: 'secret',
    now,
  })

  assert.equal(meshRoute.mode, 'mesh-direct')
  assert.equal(meshRoute.port, 39080)
  assert.match(meshRoute.url ?? '', /^ws:\/\/10\.144\.9\.20:39080\/api\/terminal-mesh\/ws\?vmx_mesh_token=/)
  assert.ok(meshRoute.expiresAt)
})
