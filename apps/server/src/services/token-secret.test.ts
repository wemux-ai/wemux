import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSharedTokenSecretConfigured, resolveSharedTokenSecret } from './token-secret'

const originalNodeEnv = process.env.NODE_ENV
const originalTokenSecret = process.env.TOKEN_SECRET

test.afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }

  if (originalTokenSecret === undefined) {
    delete process.env.TOKEN_SECRET
  } else {
    process.env.TOKEN_SECRET = originalTokenSecret
  }
})

test('resolveSharedTokenSecret uses the configured value when present', () => {
  process.env.NODE_ENV = 'production'
  process.env.TOKEN_SECRET = 'shared-prod-secret'

  assert.equal(resolveSharedTokenSecret(), 'shared-prod-secret')
})

test('resolveSharedTokenSecret uses the dev fallback outside production', () => {
  process.env.NODE_ENV = 'development'
  delete process.env.TOKEN_SECRET

  assert.equal(resolveSharedTokenSecret(), 'vibemux-dev-token-secret')
})

test('assertSharedTokenSecretConfigured throws when production TOKEN_SECRET is missing', () => {
  process.env.NODE_ENV = 'production'
  delete process.env.TOKEN_SECRET

  assert.throws(() => assertSharedTokenSecretConfigured(), /TOKEN_SECRET is required in production/)
})
