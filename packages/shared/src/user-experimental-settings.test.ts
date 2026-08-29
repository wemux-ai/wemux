import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPERIMENTAL_FEATURE_FLAG_KEYS,
  defaultExecutorFeatureFlags,
  defaultUserExperimentalSettings,
  normalizeUserExperimentalSettings,
  toExecutorFeatureFlags,
  type UserExperimentalSettings,
} from './user-experimental-settings'

test('defaultUserExperimentalSettings 全部默认 false', () => {
  const defaults = defaultUserExperimentalSettings()
  for (const key of EXPERIMENTAL_FEATURE_FLAG_KEYS) {
    assert.equal(defaults[key], false, `${key} 应默认 false`)
  }
})

test('normalize 对缺失字段回落 false', () => {
  const normalized = normalizeUserExperimentalSettings({})
  for (const key of EXPERIMENTAL_FEATURE_FLAG_KEYS) {
    assert.equal(normalized[key], false, `${key} 缺省应回落 false`)
  }
})

test('normalize 对非对象输入回落默认', () => {
  for (const value of [null, undefined, 42, 'browserUse', true]) {
    const normalized = normalizeUserExperimentalSettings(value)
    for (const key of EXPERIMENTAL_FEATURE_FLAG_KEYS) {
      assert.equal(normalized[key], false, `输入 ${String(value)} 时 ${key} 应回落 false`)
    }
  }
})

test('normalize 对非 boolean 值回落 false', () => {
  const normalized = normalizeUserExperimentalSettings({
    browserUse: 'yes',
    computerUse: 1,
    openConnector: null,
    railway: {},
    brain: [],
  })
  for (const key of EXPERIMENTAL_FEATURE_FLAG_KEYS) {
    assert.equal(normalized[key], false)
  }
})

test('normalize 保留合法 boolean', () => {
  const normalized = normalizeUserExperimentalSettings({
    browserUse: true,
    computerUse: false,
    openConnector: true,
  })
  assert.equal(normalized.browserUse, true)
  assert.equal(normalized.computerUse, false)
  assert.equal(normalized.openConnector, true)
})

test('normalize 部分更新不影响其他 flag（PUT partial 语义）', () => {
  const full: UserExperimentalSettings = defaultUserExperimentalSettings()
  full.browserUse = true
  const normalized = normalizeUserExperimentalSettings({ ...full, computerUse: true })
  assert.equal(normalized.browserUse, true)
  assert.equal(normalized.computerUse, true)
  assert.equal(normalized.railway, false)
})

test('defaultExecutorFeatureFlags 与 defaultUserExperimentalSettings 等价', () => {
  assert.deepEqual(defaultExecutorFeatureFlags(), defaultUserExperimentalSettings())
})

test('toExecutorFeatureFlags 与 normalize 等价', () => {
  const input = { browserUse: true }
  assert.deepEqual(toExecutorFeatureFlags(input), normalizeUserExperimentalSettings(input))
  assert.deepEqual(toExecutorFeatureFlags(undefined), normalizeUserExperimentalSettings(undefined))
})
