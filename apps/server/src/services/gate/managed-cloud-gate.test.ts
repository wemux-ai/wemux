// [INPUT]: ManagedCloudGate 默认实现语义验证
// [OUTPUT]: 开源默认实现「本地 executor 放行 + 托管 executor 拦截」的回归防线
// [POS]: gate 语义单测——本地 executor 被误拦会打崩 executor 可见性/项目 sync/任务派发，在此拦截。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getManagedCloudGate,
  openSourceManagedCloudGate,
  registerManagedCloudGate,
} from './managed-cloud-gate'

test('local executors are always allowed (visibility/sync/dispatch red line)', () => {
  assert.equal(openSourceManagedCloudGate.isExecutorAllowed({ executorSource: 'local', managedBy: null }), true)
  assert.equal(openSourceManagedCloudGate.isExecutorAllowed({ executorSource: null, managedBy: null }), true)
  assert.equal(openSourceManagedCloudGate.isExecutorAllowed({}), true)
})

test('managed-cloud executors are blocked in the open-source edition', () => {
  assert.equal(openSourceManagedCloudGate.isExecutorAllowed({ executorSource: 'managed-cloud', managedBy: null }), false)
  assert.equal(openSourceManagedCloudGate.isExecutorAllowed({ executorSource: null, managedBy: 'vibemux' }), false)
  assert.equal(openSourceManagedCloudGate.isExecutorAllowed(null), false)
})

test('isManagedExecutor mirrors executor source detection', () => {
  assert.equal(openSourceManagedCloudGate.isManagedExecutor({ executorSource: 'managed-cloud' }), true)
  assert.equal(openSourceManagedCloudGate.isManagedExecutor({ managedBy: 'vibemux' }), true)
  assert.equal(openSourceManagedCloudGate.isManagedExecutor({ executorSource: 'local' }), false)
  assert.equal(openSourceManagedCloudGate.isManagedExecutor(null), false)
})

test('executor lifecycle calls throw for managed cloud (disappeared capability)', async () => {
  await assert.rejects(() => openSourceManagedCloudGate.startExecutor({}))
  await assert.rejects(() => openSourceManagedCloudGate.ensureExecutor({}))
})

test('non-blocking hooks stay silent and permissive', async () => {
  assert.doesNotThrow(() => openSourceManagedCloudGate.ensureDevOnlyAccess())
  assert.equal(await openSourceManagedCloudGate.reconcileExecutors({}), null)
  assert.equal(openSourceManagedCloudGate.buildUsageRecord({}), null)
  assert.doesNotThrow(() => openSourceManagedCloudGate.recordUsage({}))
  const usage = await openSourceManagedCloudGate.ensureUsageAccess({ userId: 'user-1' })
  assert.equal(usage.allowed, true)
  assert.equal(openSourceManagedCloudGate.isUsageLimitError(new Error('x')), false)
  assert.deepEqual(await openSourceManagedCloudGate.listExecutionModelOptions(), [])
  assert.deepEqual(openSourceManagedCloudGate.buildLifecycleSnapshotByExecutorId(), new Map())
})

test('registerManagedCloudGate swaps implementation and getter reflects it', () => {
  const original = getManagedCloudGate()
  try {
    registerManagedCloudGate({ ...original })
    assert.notEqual(getManagedCloudGate(), original)
  } finally {
    registerManagedCloudGate(original)
  }
  assert.equal(getManagedCloudGate(), original)
})

test('dev-only gate is disabled in the open-source edition', () => {
  assert.equal(openSourceManagedCloudGate.isDevOnlyEnabled(), false)
  assert.equal(openSourceManagedCloudGate.isDevOnlyEnabled({ NODE_ENV: 'development' }), false)
})

test('runtime inspection and prewarm return empty shapes (disappeared capability)', async () => {
  assert.equal(await openSourceManagedCloudGate.inspectRuntime({}), null)
  assert.deepEqual(await openSourceManagedCloudGate.inspectRuntimeTargets([], {}), [])
  assert.deepEqual(await openSourceManagedCloudGate.prewarmRuntimeTargets({}, []), [])
  assert.equal(openSourceManagedCloudGate.isRuntimeError(new Error('x')), false)
  assert.equal(openSourceManagedCloudGate.buildUsageResponse({}), null)
})

test('stop and wait-for-online stay silent no-ops', async () => {
  assert.equal(await openSourceManagedCloudGate.stopExecutor({}), null)
  assert.equal(await openSourceManagedCloudGate.waitForExecutorOnline('executor-1'), null)
})
