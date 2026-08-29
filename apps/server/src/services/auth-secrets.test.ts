import assert from 'node:assert/strict'
import test from 'node:test'
import { assertBetterAuthSecretConfigured, resolveBetterAuthSecret } from './auth-secrets'

const originalNodeEnv = process.env.NODE_ENV
const originalTokenSecret = process.env.TOKEN_SECRET
const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET

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

  if (originalBetterAuthSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET
  } else {
    process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret
  }
})

test('resolveBetterAuthSecret uses the configured value when present', () => {
  process.env.NODE_ENV = 'production'
  process.env.BETTER_AUTH_SECRET = 'shared-better-auth-secret'

  assert.equal(resolveBetterAuthSecret(), 'shared-better-auth-secret')
})

test('resolveBetterAuthSecret falls back to shared token secret in development', () => {
  process.env.NODE_ENV = 'development'
  process.env.TOKEN_SECRET = 'dev-shared-token-secret'
  delete process.env.BETTER_AUTH_SECRET

  assert.equal(resolveBetterAuthSecret(), 'dev-shared-token-secret')
})

test('assertBetterAuthSecretConfigured throws when production BETTER_AUTH_SECRET is missing', () => {
  process.env.NODE_ENV = 'production'
  process.env.TOKEN_SECRET = 'shared-prod-token-secret'
  delete process.env.BETTER_AUTH_SECRET

  assert.throws(() => assertBetterAuthSecretConfigured(), /BETTER_AUTH_SECRET is required in production/)
})
