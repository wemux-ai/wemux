import assert from 'node:assert/strict'
import test from 'node:test'
import { getDevLoginAccounts, isDevLoginEnabled } from './dev-auth-service'

const originalNodeEnv = process.env.NODE_ENV
const originalDevLoginEnabled = process.env.VIBEMUX_ENABLE_DEV_LOGIN

test.afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }

  if (originalDevLoginEnabled === undefined) {
    delete process.env.VIBEMUX_ENABLE_DEV_LOGIN
  } else {
    process.env.VIBEMUX_ENABLE_DEV_LOGIN = originalDevLoginEnabled
  }
})

test('isDevLoginEnabled stays disabled in production unless explicitly enabled', () => {
  process.env.NODE_ENV = 'production'
  delete process.env.VIBEMUX_ENABLE_DEV_LOGIN

  assert.equal(isDevLoginEnabled(), false)

  process.env.VIBEMUX_ENABLE_DEV_LOGIN = 'true'

  assert.equal(isDevLoginEnabled(), true)
})

test('isDevLoginEnabled remains enabled by default outside production', () => {
  process.env.NODE_ENV = 'development'
  delete process.env.VIBEMUX_ENABLE_DEV_LOGIN

  assert.equal(isDevLoginEnabled(), true)

  process.env.VIBEMUX_ENABLE_DEV_LOGIN = 'false'

  assert.equal(isDevLoginEnabled(), false)
})

test('default dev login accounts expose demo plus two fresh and two legacy entries', () => {
  process.env.NODE_ENV = 'development'
  delete process.env.VIBEMUX_ENABLE_DEV_LOGIN
  delete process.env.VIBEMUX_DEV_LOGIN_ACCOUNTS

  assert.deepEqual(
    getDevLoginAccounts().map((account) => account.id),
    ['demo', 'fresh-quickstart', 'fresh-team', 'legacy-owner', 'legacy-builder', 'chat-test-a', 'chat-test-b', 'chat-test-c'],
  )
})
