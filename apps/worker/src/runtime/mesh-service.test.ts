import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { WorkerConfig } from '@shared/types'
import { reconcileMacOSMeshSupervisorOnce, type MeshSupervisorChild } from './mesh-service'

class FakeSupervisorChild extends EventEmitter implements MeshSupervisorChild {
  killed = false

  kill() {
    this.killed = true
    this.emit('exit', 0)
    return true
  }
}

const buildWorkerConfig = (ipv4: string): WorkerConfig => ({
  cloudUrl: 'https://wemux.xyz',
  machineId: 'machine-1',
  machineName: 'Machine 1',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot: '/tmp/vibemux-worker',
  maxConcurrency: 5,
  labels: [],
  capabilities: [],
  localServerPort: 48123,
  meshEnrollment: {
    enabled: true,
    networkName: 'vmx-preview-workspace-1',
    networkSecret: 'secret',
    peers: ['tcp://server.example.com:11010'],
    ipv4,
    hostname: 'worker-a',
  },
})

test('reconcileMacOSMeshSupervisorOnce restarts EasyTier when backend mesh enrollment changes', async () => {
  let workerConfig = buildWorkerConfig('10.144.1.2')
  const spawned: Array<{ command: string; args: string[]; child: FakeSupervisorChild }> = []
  const state = {
    child: null,
    childKey: '',
  }

  const options = {
    readWorkerConfig: () => workerConfig,
    resolveCorePath: () => '/bin/easytier-core',
    spawnProcess: (command: string, args: string[]): MeshSupervisorChild => {
      const child = new FakeSupervisorChild()
      spawned.push({ command, args, child })
      return child
    },
    onLog: () => undefined,
  }

  await reconcileMacOSMeshSupervisorOnce(state, options)
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].command, '/bin/easytier-core')
  assert.deepEqual(spawned[0].args.slice(spawned[0].args.indexOf('-i'), spawned[0].args.indexOf('-i') + 2), ['-i', '10.144.1.2'])

  await reconcileMacOSMeshSupervisorOnce(state, options)
  assert.equal(spawned.length, 1)

  workerConfig = buildWorkerConfig('10.144.1.3')
  await reconcileMacOSMeshSupervisorOnce(state, options)
  assert.equal(spawned.length, 2)
  assert.equal(spawned[0].child.killed, true)
  assert.deepEqual(spawned[1].args.slice(spawned[1].args.indexOf('-i'), spawned[1].args.indexOf('-i') + 2), ['-i', '10.144.1.3'])
})

test('reconcileMacOSMeshSupervisorOnce stops EasyTier when mesh enrollment is disabled', async () => {
  let workerConfig = buildWorkerConfig('10.144.1.2')
  const state = {
    child: null,
    childKey: '',
  }

  await reconcileMacOSMeshSupervisorOnce(state, {
    readWorkerConfig: () => workerConfig,
    resolveCorePath: () => '/bin/easytier-core',
    spawnProcess: (): MeshSupervisorChild => new FakeSupervisorChild(),
    onLog: () => undefined,
  })

  const child = state.child as unknown as FakeSupervisorChild
  workerConfig = {
    ...workerConfig,
    meshEnrollment: {
      enabled: false,
      peers: [],
    },
  }
  await reconcileMacOSMeshSupervisorOnce(state, {
    readWorkerConfig: () => workerConfig,
    resolveCorePath: () => '/bin/easytier-core',
    spawnProcess: (): MeshSupervisorChild => new FakeSupervisorChild(),
    onLog: () => undefined,
  })

  assert.equal(child.killed, true)
  assert.equal(state.child, null)
})
