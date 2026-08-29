import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorDescriptor } from '@shared/types'
import {
  buildExecutorMeshIpv4,
  buildExecutorMeshNetworkName,
  buildExecutorMeshScope,
  resolveExecutorMeshEnrollment,
  resolveExecutorMeshPreviewProxyPort,
  resolveExecutorMeshTerminalProxyPort,
} from './executor-mesh-service'

const buildExecutor = (patch: Partial<ExecutorDescriptor> = {}): ExecutorDescriptor => ({
  executorId: 'executor-1',
  machineId: 'machine-1',
  machineName: 'Machine 1',
  name: 'Worker 1',
  ownerUserId: 'user_abc',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/tmp/vibemux',
  maxConcurrency: 5,
  capabilities: [],
  labels: [],
  createdAt: '2026-06-13T00:00:00.000Z',
  ...patch,
})

const withEnv = (patch: Record<string, string | undefined>, run: () => void) => {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key])
    if (patch[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = patch[key]
    }
  }

  try {
    run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('resolveExecutorMeshEnrollment returns disabled config when feature flag is off', () => {
  withEnv({
    VIBEMUX_MESH_ENABLED: undefined,
  }, () => {
    assert.deepEqual(resolveExecutorMeshEnrollment(buildExecutor()), {
      enabled: false,
      peers: [],
    })
  })
})

test('resolveExecutorMeshEnrollment builds a stable enrollment from server env', () => {
  withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_NETWORK_NAME: undefined,
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-dev',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_PEERS: 'tcp://server.example.com:11010, udp://server.example.com:11010',
    VIBEMUX_EASYTIER_IPV4_PREFIX: '10.200',
    VIBEMUX_EASYTIER_PREVIEW_PROXY_PORT: '39081',
  }, () => {
    const enrollment = resolveExecutorMeshEnrollment(buildExecutor({
      executorId: 'executor-stable',
      ownerUserId: 'User ABC',
      name: 'Mac Studio',
    }))

    assert.equal(enrollment?.enabled, true)
    assert.equal(enrollment?.networkName, 'vmx-dev-user-user-abc')
    assert.equal(enrollment?.networkSecret, 'secret')
    assert.deepEqual(enrollment?.peers, ['tcp://server.example.com:11010', 'udp://server.example.com:11010'])
    assert.match(enrollment?.ipv4 ?? '', /^10\.200\.\d+\.\d+$/)
    assert.equal(enrollment?.hostname, 'Mac Studio')
    assert.equal(enrollment?.previewProxyPort, 39081)
    assert.equal(enrollment?.terminalProxyPort, 39081)
  })
})

test('resolveExecutorMeshEnrollment uses explicit network name when configured', () => {
  withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_NETWORK_NAME: 'vmx-dev-user-shared',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-dev',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_PEERS: 'tcp://server.example.com:11010',
  }, () => {
    const enrollment = resolveExecutorMeshEnrollment(buildExecutor({
      ownerUserId: 'different-user',
    }))

    assert.equal(enrollment?.networkName, 'vmx-dev-user-shared')
  })
})

test('buildExecutorMeshNetworkName uses workspace scope before team and owner scope', () => {
  withEnv({
    VIBEMUX_EASYTIER_NETWORK_NAME: undefined,
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx',
  }, () => {
    assert.equal(buildExecutorMeshNetworkName(buildExecutor({
      visibility: 'team',
      teamId: 'team_123',
      workspaceIds: ['workspace-1'],
    })), 'vmx-workspace-workspace-1')
  })
})

test('buildExecutorMeshScope prefers a stable workspace scope', () => {
  assert.equal(buildExecutorMeshScope(buildExecutor({
    workspaceIds: ['workspace-1'],
    ownerUserId: 'user-a',
  })), 'workspace-workspace-1')

  assert.equal(buildExecutorMeshScope(buildExecutor({
    workspaceIds: ['workspace-2', 'workspace-1'],
    ownerUserId: 'user-a',
  })), 'workspace-workspace-1')
})

test('buildExecutorMeshScope uses team scope when no workspace is bound', () => {
  assert.equal(buildExecutorMeshScope(buildExecutor({
    visibility: 'team',
    teamId: 'team_123',
    ownerUserId: 'user-a',
  })), 'team-team_123')
})

test('buildExecutorMeshIpv4 is stable for the same executor', () => {
  assert.equal(buildExecutorMeshIpv4(buildExecutor({ executorId: 'executor-1' })), buildExecutorMeshIpv4(buildExecutor({ executorId: 'executor-1' })))
  assert.notEqual(buildExecutorMeshIpv4(buildExecutor({ executorId: 'executor-1' })), buildExecutorMeshIpv4(buildExecutor({ executorId: 'executor-2' })))
})

test('buildExecutorMeshIpv4 keeps executors in the same mesh scope on one /24', () => {
  withEnv({
    VIBEMUX_EASYTIER_NETWORK_NAME: undefined,
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-dev',
    VIBEMUX_EASYTIER_IPV4_PREFIX: '10.144',
  }, () => {
    const mbpIp = buildExecutorMeshIpv4(buildExecutor({
      executorId: 'mbp',
      workspaceIds: ['workspace-1'],
      ownerUserId: 'user-a',
    }))
    const miniIp = buildExecutorMeshIpv4(buildExecutor({
      executorId: 'mini',
      workspaceIds: ['workspace-1'],
      ownerUserId: 'user-a',
    }))
    const otherWorkspaceIp = buildExecutorMeshIpv4(buildExecutor({
      executorId: 'other',
      workspaceIds: ['workspace-2'],
      ownerUserId: 'user-a',
    }))

    assert.equal(mbpIp.split('.').slice(0, 3).join('.'), miniIp.split('.').slice(0, 3).join('.'))
    assert.notEqual(mbpIp.split('.').slice(0, 3).join('.'), otherWorkspaceIp.split('.').slice(0, 3).join('.'))
  })
})

test('buildExecutorMeshIpv4 respects a configured /24 prefix', () => {
  withEnv({
    VIBEMUX_EASYTIER_IPV4_PREFIX: '10.200.7',
  }, () => {
    assert.match(buildExecutorMeshIpv4(buildExecutor({ executorId: 'executor-1' })), /^10\.200\.7\.\d+$/)
  })
})

test('resolveExecutorMesh proxy ports stay stable per executor when no env override is set', () => {
  withEnv({
    VIBEMUX_EASYTIER_PREVIEW_PROXY_PORT: undefined,
    VIBEMUX_EASYTIER_TERMINAL_PROXY_PORT: undefined,
  }, () => {
    const first = buildExecutor({ executorId: 'executor-a' })
    const second = buildExecutor({ executorId: 'executor-b' })
    assert.equal(resolveExecutorMeshPreviewProxyPort(first), resolveExecutorMeshPreviewProxyPort(first))
    assert.equal(resolveExecutorMeshTerminalProxyPort(first), resolveExecutorMeshTerminalProxyPort(first))
    assert.notEqual(resolveExecutorMeshPreviewProxyPort(first), resolveExecutorMeshPreviewProxyPort(second))
    assert.notEqual(resolveExecutorMeshTerminalProxyPort(first), resolveExecutorMeshTerminalProxyPort(second))
  })
})

test('resolveExecutorMesh proxy ports follow the local worker console port when reported', () => {
  withEnv({
    VIBEMUX_EASYTIER_PREVIEW_PROXY_PORT: undefined,
    VIBEMUX_EASYTIER_TERMINAL_PROXY_PORT: undefined,
  }, () => {
    const executor = buildExecutor({
      executorId: 'executor-a',
      localServerPort: 48121,
    })

    assert.equal(resolveExecutorMeshPreviewProxyPort(executor), 39121)
    assert.equal(resolveExecutorMeshTerminalProxyPort(executor), 39121)
  })
})
