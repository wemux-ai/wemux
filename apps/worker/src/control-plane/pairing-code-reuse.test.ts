import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { WorkerConfig } from '@shared/types'
import {
  hasSavedWorkerPairing,
  normalizeReusablePairingCode,
  shouldReuseSavedWorkerPairing,
} from './pairing-code-reuse'

const createWorkerConfig = (overrides: Partial<WorkerConfig> = {}): WorkerConfig => ({
  cloudUrl: 'https://wemux.xyz',
  machineId: 'machine-1',
  machineName: 'worker-test',
  executorId: 'executor-1',
  executorToken: 'token-1',
  lastPairedPairingCode: '32928E9E',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot: '/tmp/vibemux-worker-test',
  maxConcurrency: 1,
  labels: [],
  capabilities: [],
  localServerPort: 48123,
  ...overrides,
})

test('normalizeReusablePairingCode trims and uppercases pairing codes', () => {
  assert.equal(normalizeReusablePairingCode(' 32928e9e '), '32928E9E')
})

test('shouldReuseSavedWorkerPairing returns true for the same previously used pairing code', () => {
  assert.equal(shouldReuseSavedWorkerPairing('32928e9e', createWorkerConfig()), true)
})

test('shouldReuseSavedWorkerPairing returns false for a different pairing code', () => {
  assert.equal(shouldReuseSavedWorkerPairing('A1B2C3D4', createWorkerConfig()), false)
})

test('shouldReuseSavedWorkerPairing returns false when the worker is no longer paired locally', () => {
  const config = createWorkerConfig({
    executorToken: undefined,
  })

  assert.equal(hasSavedWorkerPairing(config), false)
  assert.equal(shouldReuseSavedWorkerPairing('32928E9E', config), false)
})
