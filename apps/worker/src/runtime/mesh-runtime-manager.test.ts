import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { WorkerConfig } from '@shared/types'
import {
  buildEasyTierCoreArgs,
  loadWorkerMeshRuntimeConfig,
  loadWorkerMeshRuntimeConfigFromEnv,
  markWorkerMeshDisabled,
  parseEasyTierNodeOutput,
  parseEasyTierPeerOutput,
  refreshWorkerMeshRuntimeStatus,
  resolveWorkerEasyTierRpcPortal,
  shouldRestartWorkerMeshRuntime,
  shouldUseEasyTierNoTun,
  shouldUseEasyTierSmoltcp,
  startWorkerMeshRuntime,
  startWorkerMeshRuntimeAsync,
} from './mesh-runtime-manager'

class FakeEasyTierProcess extends EventEmitter {
  killed = false
  pid = 12345
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  kill() {
    this.killed = true
    this.emit('exit', 0)
    return true
  }
}

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
    markWorkerMeshDisabled()
  }
}

const withEnvAsync = async (patch: Record<string, string | undefined>, run: () => Promise<void>) => {
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
    await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    markWorkerMeshDisabled()
  }
}

test('loadWorkerMeshRuntimeConfigFromEnv keeps mesh disabled by default', () => {
  withEnv({
    VIBEMUX_MESH_ENABLED: undefined,
    VIBEMUX_EASYTIER_NETWORK_NAME: undefined,
    VIBEMUX_EASYTIER_NETWORK_SECRET: undefined,
    VIBEMUX_EASYTIER_PEERS: undefined,
  }, () => {
    const config = loadWorkerMeshRuntimeConfigFromEnv()
    assert.equal(config.enabled, false)
    assert.deepEqual(config.peers, [])
  })
})

test('buildEasyTierCoreArgs uses argv array without shell interpolation', () => {
  withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, () => {
    assert.deepEqual(buildEasyTierCoreArgs({
      enabled: true,
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010', 'udp://server.example.com:11010'],
      ipv4: '10.144.0.2',
      hostname: 'worker-a',
    }, 'linux'), [
      '--network-name',
      'vmx-user-1',
      '--network-secret',
      'secret',
      '--rpc-portal',
      '127.0.0.1:15888',
      '--no-listener',
      '-i',
      '10.144.0.2',
      '--hostname',
      'worker-a',
      '-p',
      'tcp://server.example.com:11010',
      '-p',
      'udp://server.example.com:11010',
    ])
  })
})

test('buildEasyTierCoreArgs uses smoltcp and no-tun by default on Windows current-user workers', () => {
  withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
    VIBEMUX_EASYTIER_USE_SMOLTCP: undefined,
    VIBEMUX_EASYTIER_NO_TUN: undefined,
  }, () => {
    const args = buildEasyTierCoreArgs({
      enabled: true,
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010'],
      ipv4: '10.144.0.2',
      hostname: 'worker-a',
    }, 'win32')

    assert.equal(shouldUseEasyTierSmoltcp('win32'), true)
    assert.equal(shouldUseEasyTierNoTun('win32'), true)
    assert.ok(args.includes('--use-smoltcp'))
    assert.ok(args.includes('--no-tun'))
    assert.equal(args.includes('-i'), false)
    assert.equal(args.includes('10.144.0.2'), false)
  })
})

test('buildEasyTierCoreArgs allows smoltcp and no-tun overrides', () => {
  withEnv({
    VIBEMUX_EASYTIER_USE_SMOLTCP: '1',
    VIBEMUX_EASYTIER_NO_TUN: '1',
  }, () => {
    assert.equal(shouldUseEasyTierSmoltcp('linux'), true)
    assert.equal(shouldUseEasyTierNoTun('linux'), true)
  })

  withEnv({
    VIBEMUX_EASYTIER_USE_SMOLTCP: '0',
    VIBEMUX_EASYTIER_NO_TUN: '0',
  }, () => {
    assert.equal(shouldUseEasyTierSmoltcp('win32'), false)
    assert.equal(shouldUseEasyTierNoTun('win32'), false)
  })
})

test('resolveWorkerEasyTierRpcPortal separates defaults by environment and allows override', () => {
  withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'development',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, () => {
    assert.equal(resolveWorkerEasyTierRpcPortal(), '127.0.0.1:15890')
  })

  withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'production',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, () => {
    assert.equal(resolveWorkerEasyTierRpcPortal(), '127.0.0.1:15889')
  })

  withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'production',
    VIBEMUX_EASYTIER_RPC_PORTAL: '127.0.0.1:15999',
  }, () => {
    assert.equal(resolveWorkerEasyTierRpcPortal(), '127.0.0.1:15999')
  })
})

test('loadWorkerMeshRuntimeConfig prefers server enrollment over local env enrollment', () => {
  withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_NETWORK_NAME: 'env-network',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'env-secret',
    VIBEMUX_EASYTIER_PEERS: 'tcp://env.example.com:11010',
  }, () => {
    const workerConfig: WorkerConfig = {
      cloudUrl: 'http://127.0.0.1:8989',
      machineId: 'machine-1',
      machineName: 'Machine 1',
      agentSettings: normalizeAgentSettings(),
      workspaceRoot: '/tmp/vibemux',
      maxConcurrency: 5,
      labels: [],
      capabilities: [],
      localServerPort: 48121,
      meshEnrollment: {
        enabled: true,
        networkName: 'server-network',
        networkSecret: 'server-secret',
        peers: ['tcp://server.example.com:11010'],
        ipv4: '10.144.0.2',
      },
    }
    const config = loadWorkerMeshRuntimeConfig(workerConfig)

    assert.equal(config.networkName, 'server-network')
    assert.equal(config.networkSecret, 'server-secret')
    assert.deepEqual(config.peers, ['tcp://server.example.com:11010'])
    assert.equal(config.ipv4, '10.144.0.2')
  })
})

test('startWorkerMeshRuntime does not spawn EasyTier when disabled', () => {
  let spawned = false
  const status = startWorkerMeshRuntime({
    enabled: false,
    peers: [],
  }, {
    spawnProcess: () => {
      spawned = true
      return new FakeEasyTierProcess() as any
    },
  })

  assert.equal(spawned, false)
  assert.equal(status.status, 'disabled')
})

test('startWorkerMeshRuntime reports missing enrollment config', () => {
  const status = startWorkerMeshRuntime({
    enabled: true,
    peers: [],
  })

  assert.equal(status.enabled, true)
  assert.equal(status.status, 'error')
  assert.match(status.errorMessage ?? '', /network name, secret, or bootstrap peers/)
})

test('startWorkerMeshRuntimeAsync spawns easytier-core with configured enrollment', async () => {
  await withEnvAsync({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, async () => {
    const spawned: Array<{ command: string; args: string[]; process: FakeEasyTierProcess }> = []
    const status = await startWorkerMeshRuntimeAsync({
      enabled: true,
      corePath: '/bin/easytier-core',
      cliPath: '/bin/easytier-cli',
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010'],
      ipv4: '10.144.0.2',
    }, {
      probeExistingRuntime: () => undefined,
      spawnProcess: (command, args) => {
        const process = new FakeEasyTierProcess()
        spawned.push({ command, args, process })
        return process as any
      },
    })

    assert.equal(status.status, 'connecting')
    assert.equal(status.meshIpv4, '10.144.0.2')
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].command, '/bin/easytier-core')
    assert.deepEqual(spawned[0].args, [
      '--network-name',
      'vmx-user-1',
      '--network-secret',
      'secret',
      '--rpc-portal',
      '127.0.0.1:15888',
      '--no-listener',
      '-i',
      '10.144.0.2',
      '-p',
      'tcp://server.example.com:11010',
    ])
    markWorkerMeshDisabled()
    assert.equal(spawned[0].process.killed, true)
  })
})

test('startWorkerMeshRuntimeAsync reuses an existing matching EasyTier runtime', async () => {
  await withEnvAsync({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, async () => {
    let spawned = false
    const status = await startWorkerMeshRuntimeAsync({
      enabled: true,
      corePath: '/bin/easytier-core',
      cliPath: '/bin/easytier-cli',
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010'],
      ipv4: '10.144.0.2',
      hostname: 'worker-a',
    }, {
      probeExistingRuntime: () => ({
        enabled: true,
        status: 'degraded',
        meshIpv4: '10.144.0.2/24',
        meshHostname: 'worker-a',
        routeMode: 'unknown',
        peers: [],
        reportedAt: new Date().toISOString(),
      }),
      spawnProcess: () => {
        spawned = true
        return new FakeEasyTierProcess() as any
      },
    })

    assert.equal(spawned, false)
    assert.equal(status.status, 'degraded')
    assert.equal(status.meshIpv4, '10.144.0.2/24')
  })
})

test('startWorkerMeshRuntimeAsync spawns when an existing runtime reports a different mesh IP', async () => {
  await withEnvAsync({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, async () => {
    let spawned = false
    const status = await startWorkerMeshRuntimeAsync({
      enabled: true,
      corePath: '/bin/easytier-core',
      cliPath: '/bin/easytier-cli',
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010'],
      ipv4: '10.144.0.2',
    }, {
      probeExistingRuntime: () => ({
        enabled: true,
        status: 'degraded',
        meshIpv4: '10.144.9.9/24',
        meshHostname: 'other-worker',
        routeMode: 'unknown',
        peers: [],
        reportedAt: new Date().toISOString(),
      }),
      spawnProcess: () => {
        spawned = true
        return new FakeEasyTierProcess() as any
      },
    })

    assert.equal(spawned, true)
    assert.equal(status.status, 'connecting')
    markWorkerMeshDisabled()
  })
})

test('startWorkerMeshRuntimeAsync auto prepares EasyTier binaries when PATH is missing', async () => {
  const spawned: Array<{ command: string; args: string[] }> = []
  // 节点级 tool 缓存固定落机器级 workerHome：临时指向不存在的目录，确保走自动下载分支
  await withEnvAsync({ WEMUX_WORKER_HOME: '/tmp/vibemux-worker' }, async () => {
    const status = await startWorkerMeshRuntimeAsync({
      enabled: true,
      workspaceRoot: '/tmp/vibemux-worker',
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010'],
      ipv4: '10.144.0.2',
    }, {
      probeExistingRuntime: () => undefined,
      ensureBinaries: async (options) => {
        // EasyTier 是节点级 tool：缓存根 = 机器级 workerHome，不随 workspaceRoot 透传
        assert.equal(options?.workspaceRoot, '/tmp/vibemux-worker')
        return {
          corePath: '/tmp/vibemux-worker/node/runtime/easytier/v2.6.4/linux-x86_64/easytier-core',
          cliPath: '/tmp/vibemux-worker/node/runtime/easytier/v2.6.4/linux-x86_64/easytier-cli',
          version: 'v2.6.4',
          platform: 'linux',
          arch: 'x86_64',
        }
      },
      spawnProcess: (command, args) => {
        spawned.push({ command, args })
        return new FakeEasyTierProcess() as any
      },
    })

    assert.equal(status.status, 'connecting')
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].command, '/tmp/vibemux-worker/node/runtime/easytier/v2.6.4/linux-x86_64/easytier-core')
  })
  markWorkerMeshDisabled()
})

test('refreshWorkerMeshRuntimeStatus preserves EasyTier process exit root cause', async () => {
  await withEnvAsync({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, async () => {
    const process = new FakeEasyTierProcess()
    await startWorkerMeshRuntimeAsync({
      enabled: true,
      corePath: '/bin/easytier-core',
      cliPath: '/bin/easytier-cli',
      networkName: 'vmx-user-1',
      networkSecret: 'secret',
      peers: ['tcp://server.example.com:11010'],
      ipv4: '10.144.0.2',
    }, {
      probeExistingRuntime: () => undefined,
      spawnProcess: () => process as any,
    })

    process.stderr.emit('data', Buffer.from('tun device error Operation not permitted'))
    process.emit('exit', 1)

    const status = refreshWorkerMeshRuntimeStatus({
      enabled: true,
      cliPath: '/definitely/missing/easytier-cli',
      peers: ['tcp://server.example.com:11010'],
    })
    assert.equal(status.status, 'error')
    assert.match(status.errorMessage ?? '', /tun device error Operation not permitted/)
    assert.match(status.errorMessage ?? '', /EasyTier process exited/)
  })
})

test('shouldRestartWorkerMeshRuntime detects refused EasyTier RPC with no managed process', async () => {
  await withEnvAsync({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_RPC_PORTAL: undefined,
  }, async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'vibemux-mesh-refused-'))
    const cliPath = path.join(tempDir, 'easytier-cli')
    writeFileSync(cliPath, `#!/usr/bin/env node
console.error('Error: failed to get manage client Caused by: failed to connect to server: 由于目标计算机积极拒绝，无法连接。 (os error 10061)')
process.exit(1)
`, 'utf8')
    chmodSync(cliPath, 0o755)

    try {
      const process = new FakeEasyTierProcess()
      await startWorkerMeshRuntimeAsync({
        enabled: true,
        corePath: '/bin/easytier-core',
        cliPath,
        networkName: 'vmx-user-1',
        networkSecret: 'secret',
        peers: ['tcp://server.example.com:11010'],
        ipv4: '10.144.0.2',
      }, {
        probeExistingRuntime: () => undefined,
        spawnProcess: () => process as any,
      })

      process.emit('exit', 0)
      const status = refreshWorkerMeshRuntimeStatus({
        enabled: true,
        cliPath,
        networkName: 'vmx-user-1',
        networkSecret: 'secret',
        peers: ['tcp://server.example.com:11010'],
        ipv4: '10.144.0.2',
      })

      assert.equal(status.status, 'degraded')
      assert.equal(shouldRestartWorkerMeshRuntime(status, {
        enabled: true,
        networkName: 'vmx-user-1',
        networkSecret: 'secret',
        peers: ['tcp://server.example.com:11010'],
      }), true)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test('refreshWorkerMeshRuntimeStatus reports stale helper mesh IP', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'vibemux-mesh-'))
  const cliPath = path.join(tempDir, 'easytier-cli')
  writeFileSync(cliPath, `#!/usr/bin/env node
const command = process.argv.at(-1)
if (command === 'node') {
  console.log('| Virtual IP     | 10.144.92.26/24 |')
  console.log('|----------------|----------------- |')
  console.log('| Hostname       | MBP              |')
  process.exit(0)
}
if (command === 'peer') {
  console.log('| id | ipv4 | cost |')
  console.log('| -- | ---- | ---- |')
  console.log('| MBP | 10.144.92.26/24 | unknown |')
  process.exit(0)
}
process.exit(1)
`, 'utf8')
  chmodSync(cliPath, 0o755)

  try {
    const status = refreshWorkerMeshRuntimeStatus({
      enabled: true,
      cliPath,
      peers: ['tcp://wemux.xyz:11010'],
      ipv4: '10.144.161.94',
      hostname: 'MBP',
    })

    assert.equal(status.status, 'degraded')
    assert.equal(status.meshIpv4, '10.144.92.26/24')
    assert.match(status.errorMessage ?? '', /control plane assigned 10\.144\.161\.94/)
    assert.match(status.errorMessage ?? '', /latest mesh enrollment/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
    markWorkerMeshDisabled()
  }
})

test('parseEasyTierNodeOutput reads local mesh identity', () => {
  const status = parseEasyTierNodeOutput(`
| ipv4        | hostname | nat_type | id        |
| ----------- | -------- | -------- | --------- |
| 10.144.0.2  | worker-a | FullCone | 390879727 |
`)

  assert.equal(status.meshIpv4, '10.144.0.2')
  assert.equal(status.meshHostname, 'worker-a')
  assert.equal(status.natType, 'FullCone')
  assert.equal(status.meshNodeId, '390879727')
})

test('parseEasyTierNodeOutput reads EasyTier node key-value output', () => {
  const status = parseEasyTierNodeOutput(`
| Virtual IP     | 10.144.92.26/24                     |
|----------------|-------------------------------------|
| Hostname       | MBP                                 |
| Proxy CIDRs    |                                     |
| Peer ID        | 2154642186                          |
| Public IPv4    | 122.231.173.204                     |
| Public IPv4    | 66.90.98.34                         |
| UDP Stun Type  | PortRestricted                      |
| Interface IPv4 | 192.168.0.125                       |
`)

  assert.equal(status.meshIpv4, '10.144.92.26/24')
  assert.equal(status.meshHostname, 'MBP')
  assert.equal(status.natType, 'PortRestricted')
  assert.equal(status.meshNodeId, '2154642186')
})

test('parseEasyTierPeerOutput preserves blank cells and normalizes p2p route mode', () => {
  const peers = parseEasyTierPeerOutput(`
| ipv4        | hostname       | cost  | lat_ms | loss_rate | tunnel_proto | nat_type | id         |
| ----------- | -------------- | ----- | ------ | --------- | ------------ | -------- | ---------- |
| 10.144.0.1  | worker-a       | Local | *      | *         | udp          | FullCone | 439804259  |
| 10.144.0.2  | worker-b       | p2p   | 3.452  | 0         | udp          | FullCone | 390879727  |
|             | PublicServer_a | relay | 27.796 | 0.000     | tcp          | Unknown  | 3771642457 |
`)

  assert.equal(peers.length, 3)
  assert.equal(peers[1].meshIpv4, '10.144.0.2')
  assert.equal(peers[1].routeMode, 'direct')
  assert.equal(peers[1].latencyMs, 3.452)
  assert.equal(peers[2].meshIpv4, '')
  assert.equal(peers[2].routeMode, 'relayed')
})
