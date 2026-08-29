import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultExecutorFeatureFlags,
  type ExecutorFeatureFlags,
} from '@shared/user-experimental-settings'
import {
  assertExperimentalFeatureEnabled,
  resolveExperimentalFeatureAvailability,
} from './feature-flag-gate'

const flagsWith = (overrides: Partial<ExecutorFeatureFlags>): ExecutorFeatureFlags => ({
  ...defaultExecutorFeatureFlags(),
  ...overrides,
})

test('默认关（用户开关 false）→ 拒绝', () => {
  const availability = resolveExperimentalFeatureAvailability({
    flag: 'browserUse',
    featureFlags: defaultExecutorFeatureFlags(),
  })
  assert.equal(availability.enabled, false)
  assert.equal(availability.reason, 'experimental.browserUse.disabled_by_user')

  const gate = assertExperimentalFeatureEnabled({
    flag: 'browserUse',
    featureFlags: defaultExecutorFeatureFlags(),
  })
  assert.deepEqual(gate, { ok: false, code: 'feature_disabled', reason: 'experimental.browserUse.disabled_by_user' })
})

test('用户开关打开 → 放行', () => {
  const gate = assertExperimentalFeatureEnabled({
    flag: 'browserUse',
    featureFlags: flagsWith({ browserUse: true }),
  })
  assert.deepEqual(gate, { ok: true })
})

test('featureFlags 缺省（老消息）→ 拒绝（安全兜底）', () => {
  const gate = assertExperimentalFeatureEnabled({ flag: 'computerUse' })
  assert.equal(gate.ok, false)
  if (!gate.ok) {
    assert.equal(gate.code, 'feature_disabled')
  }
})

test('全局 env 闸门关闭 → 拒绝并提示 env', () => {
  const gate = assertExperimentalFeatureEnabled({
    flag: 'browserUse',
    featureFlags: flagsWith({ browserUse: true }),
    globalEnvEnabled: false,
  })
  assert.equal(gate.ok, false)
  if (!gate.ok) {
    assert.equal(gate.reason, 'experimental.browserUse.disabled_by_env')
  }
})

test('节点能力缺失 → 拒绝并提示 unsupported_by_node', () => {
  const gate = assertExperimentalFeatureEnabled({
    flag: 'computerUse',
    featureFlags: flagsWith({ computerUse: true }),
    capabilities: ['git', 'terminal'],
  })
  assert.equal(gate.ok, false)
  if (!gate.ok) {
    assert.equal(gate.reason, 'experimental.computerUse.unsupported_by_node')
  }
})

test('节点能力包含 experimental.<flag> → 放行', () => {
  const gate = assertExperimentalFeatureEnabled({
    flag: 'computerUse',
    featureFlags: flagsWith({ computerUse: true }),
    capabilities: ['git', 'experimental.computerUse'],
  })
  assert.deepEqual(gate, { ok: true })
})

test('注册表中的 web/端侧 flag 同样可判定', () => {
  for (const flag of ['openConnector', 'brain', 'railway', 'meetingListening'] as const) {
    const off = assertExperimentalFeatureEnabled({ flag, featureFlags: defaultExecutorFeatureFlags() })
    assert.equal(off.ok, false, `${flag} 默认应拒绝`)
    const on = assertExperimentalFeatureEnabled({ flag, featureFlags: flagsWith({ [flag]: true }) })
    assert.deepEqual(on, { ok: true }, `${flag} 打开应放行`)
  }
})
