import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorRecord } from '@shared/types'
import { buildExecutorLocalAccessPlan } from './executor-local-access-service'

const executor = (overrides: Partial<ExecutorRecord> = {}): ExecutorRecord => ({
  executorId: 'executor-local',
  machineId: 'machine-local',
  machineName: 'Local machine',
  name: 'Local worker',
  ownerUserId: 'user-1',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/tmp/workspace',
  maxConcurrency: 1,
  localServerPort: 48_123,
  localServerInstanceId: 'instance-1',
  capabilities: [],
  labels: [],
  createdAt: '2026-07-10T00:00:00.000Z',
  ...overrides,
})

test('local access plan puts the exact target before owned mesh sources', () => {
  const plan = buildExecutorLocalAccessPlan({
    allowMesh: true,
    executors: [
      executor(),
      executor({ executorId: 'executor-target', ownerUserId: 'user-2', localServerPort: 48_124 }),
    ],
    now: 1_000,
    targetExecutorId: 'executor-target',
    userId: 'user-1',
  })

  assert.deepEqual(plan.candidates.map((candidate) => [candidate.executorId, candidate.port, candidate.role]), [
    ['executor-target', 48_124, 'target'],
    ['executor-local', 48_123, 'mesh-source'],
  ])
  assert.equal(plan.expiresAt, '1970-01-01T00:00:31.000Z')
})

test('local access plan excludes managed, offline, and invalid-port executors', () => {
  const plan = buildExecutorLocalAccessPlan({
    allowMesh: true,
    executors: [
      executor({ executorId: 'managed', executorSource: 'managed-cloud' }),
      executor({ executorId: 'offline', status: 'offline' }),
      executor({ executorId: 'invalid-port', localServerPort: 70_000 }),
    ],
    targetExecutorId: 'managed',
    userId: 'user-1',
  })

  assert.deepEqual(plan.candidates, [])
})
