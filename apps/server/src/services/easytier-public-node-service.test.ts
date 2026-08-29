import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  buildEasyTierPublicNodeArgsFromEnv,
  shouldStartEmbeddedEasyTierPublicNode,
  startEmbeddedEasyTierPublicNodeAsync,
  stopEmbeddedEasyTierPublicNode,
} from './easytier-public-node-service'

class FakeProcess extends EventEmitter {
  killed = false
  pid = 123

  kill() {
    this.killed = true
    this.emit('exit', 0)
    return true
  }
}

const withEnv = async (patch: Record<string, string | undefined>, run: () => void | Promise<void>) => {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    await run()
  } finally {
    stopEmbeddedEasyTierPublicNode()
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('shouldStartEmbeddedEasyTierPublicNode follows mesh and embedded flags', async () => {
  await withEnv({
    VIBEMUX_MESH_ENABLED: undefined,
    VIBEMUX_EASYTIER_SERVER_EMBEDDED_PUBLIC_NODE: undefined,
  }, () => {
    assert.equal(shouldStartEmbeddedEasyTierPublicNode(), false)
  })

  await withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_SERVER_EMBEDDED_PUBLIC_NODE: undefined,
  }, () => {
    assert.equal(shouldStartEmbeddedEasyTierPublicNode(), true)
  })

  await withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_SERVER_EMBEDDED_PUBLIC_NODE: '0',
  }, () => {
    assert.equal(shouldStartEmbeddedEasyTierPublicNode(), false)
  })
})

test('buildEasyTierPublicNodeArgsFromEnv builds argv without shell interpolation', async () => {
  await withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-hybrid',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_SERVER_IPV4: '10.144.0.1',
    VIBEMUX_EASYTIER_SERVER_HOSTNAME: 'server-a',
    VIBEMUX_EASYTIER_LISTEN_URLS: 'tcp://0.0.0.0:11010,udp://0.0.0.0:11010',
  }, () => {
    const built = buildEasyTierPublicNodeArgsFromEnv()
    assert.equal(built.ok, true)
    assert.deepEqual(built.args, [
      '-d',
      '--hostname',
      'server-a',
      '-i',
      '10.144.0.1',
      '-l',
      'tcp://0.0.0.0:11010',
      '-l',
      'udp://0.0.0.0:11010',
    ])
  })
})

test('buildEasyTierPublicNodeArgsFromEnv starts a shared public node without worker network credentials', async () => {
  await withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-hybrid',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_SERVER_IPV4: undefined,
    VIBEMUX_EASYTIER_SERVER_HOSTNAME: 'server-a',
    VIBEMUX_EASYTIER_LISTEN_URLS: 'tcp://0.0.0.0:11010',
  }, () => {
    const built = buildEasyTierPublicNodeArgsFromEnv()
    assert.equal(built.ok, true)
    assert.deepEqual(built.args.slice(0, 4), [
      '-d',
      '--hostname',
      'server-a',
      '--no-tun',
    ])
    assert.equal(built.args.includes('--network-name'), false)
    assert.equal(built.args.includes('--network-secret'), false)
  })
})

test('buildEasyTierPublicNodeArgsFromEnv separates default listen ports by environment', async () => {
  await withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'development',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-dev',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_LISTEN_URLS: undefined,
  }, () => {
    const built = buildEasyTierPublicNodeArgsFromEnv()
    assert.equal(built.ok, true)
    assert.deepEqual(built.listenUrls, [
      'tcp://0.0.0.0:11030',
      'udp://0.0.0.0:11030',
      'ws://0.0.0.0:11031',
      'wss://0.0.0.0:11032',
    ])
  })

  await withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'production',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-prod',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_LISTEN_URLS: undefined,
  }, () => {
    const built = buildEasyTierPublicNodeArgsFromEnv()
    assert.equal(built.ok, true)
    assert.deepEqual(built.listenUrls, [
      'tcp://0.0.0.0:11020',
      'udp://0.0.0.0:11020',
      'ws://0.0.0.0:11021',
      'wss://0.0.0.0:11022',
    ])
  })
})

test('buildEasyTierPublicNodeArgsFromEnv defaults embedded public node to no-tun mode', async () => {
  await withEnv({
    VIBEMUX_EASYTIER_PORT_PROFILE: 'preview',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-hybrid',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
    VIBEMUX_EASYTIER_SERVER_IPV4: undefined,
    VIBEMUX_EASYTIER_SERVER_HOSTNAME: 'server-a',
    VIBEMUX_EASYTIER_LISTEN_URLS: 'tcp://0.0.0.0:11010,udp://0.0.0.0:11010',
  }, () => {
    const built = buildEasyTierPublicNodeArgsFromEnv()
    assert.equal(built.ok, true)
    assert.deepEqual(built.args, [
      '-d',
      '--hostname',
      'server-a',
      '--no-tun',
      '-l',
      'tcp://0.0.0.0:11010',
      '-l',
      'udp://0.0.0.0:11010',
    ])
  })
})

test('startEmbeddedEasyTierPublicNodeAsync starts and stops the managed process', async () => {
  await withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-hybrid',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
  }, async () => {
    const spawned: Array<{ command: string; args: string[]; process: FakeProcess }> = []
    const result = await startEmbeddedEasyTierPublicNodeAsync({
      resolveExecutable: () => '/bin/easytier-core',
      spawnProcess: (command, args) => {
        const process = new FakeProcess()
        spawned.push({ command, args, process })
        return process
      },
    })

    assert.equal(result.started, true)
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].command, '/bin/easytier-core')
    assert.deepEqual(spawned[0].args.slice(0, 4), [
      '-d',
      '--hostname',
      'vibemux-server',
      '--no-tun',
    ])

    stopEmbeddedEasyTierPublicNode()
    assert.equal(spawned[0].process.killed, true)
  })
})

test('startEmbeddedEasyTierPublicNodeAsync auto downloads binaries when none are preinstalled', async () => {
  await withEnv({
    VIBEMUX_MESH_ENABLED: '1',
    VIBEMUX_EASYTIER_NETWORK_PREFIX: 'vmx-hybrid',
    VIBEMUX_EASYTIER_NETWORK_SECRET: 'secret',
  }, async () => {
    const spawned: Array<{ command: string; args: string[] }> = []
    const result = await startEmbeddedEasyTierPublicNodeAsync({
      resolveExecutable: () => '',
      ensureBinaries: async () => ({
        corePath: '/tmp/vibemux-runtime/easytier/v2.6.4/linux-x86_64/easytier-core',
        cliPath: '/tmp/vibemux-runtime/easytier/v2.6.4/linux-x86_64/easytier-cli',
        version: 'v2.6.4',
        platform: 'linux',
        arch: 'x86_64',
      }),
      spawnProcess: (command, args) => {
        spawned.push({ command, args })
        return new FakeProcess()
      },
    })

    assert.equal(result.started, true)
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0].command, '/tmp/vibemux-runtime/easytier/v2.6.4/linux-x86_64/easytier-core')
  })
})
