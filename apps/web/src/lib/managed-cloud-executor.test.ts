import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorRecord } from '@shared/types'
import { buildExecutorOptionsWithManagedCloud } from './managed-cloud-executor'

const createExecutor = (overrides: Partial<ExecutorRecord> = {}): ExecutorRecord => ({
  executorId: 'executor-1',
  machineId: 'machine-1',
  machineName: 'Machine 1',
  name: 'Executor 1',
  ownerUserId: 'user-1',
  visibility: 'private',
  status: 'online',
  workspaceRoot: '/tmp/workspaces',
  maxConcurrency: 2,
  capabilities: [],
  labels: [],
  createdAt: '2026-05-12T00:00:00.000Z',
  ...overrides,
} as ExecutorRecord)

test('includes offline executors when requested for workspace chat selection', () => {
  const executors = [
    createExecutor({ executorId: 'executor-online', name: 'Online Node', status: 'online' }),
    createExecutor({ executorId: 'executor-offline', name: 'Offline Node', status: 'offline' }),
  ]

  const result = buildExecutorOptionsWithManagedCloud(executors, null, { includeOffline: true })

  assert.deepEqual(result.map((executor) => executor.executorId), ['executor-online', 'executor-offline'])
})

test('keeps offline executors hidden by default', () => {
  const executors = [
    createExecutor({ executorId: 'executor-online', name: 'Online Node', status: 'online' }),
    createExecutor({ executorId: 'executor-offline', name: 'Offline Node', status: 'offline' }),
  ]

  const result = buildExecutorOptionsWithManagedCloud(executors, null)

  assert.deepEqual(result.map((executor) => executor.executorId), ['executor-online'])
})
