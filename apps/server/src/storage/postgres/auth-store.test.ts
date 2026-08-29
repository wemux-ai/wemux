import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveEffectiveUserStatus, resolveOAuthUserName } from './auth-store'

test('resolveOAuthUserName preserves an existing custom nickname', () => {
  assert.equal(
    resolveOAuthUserName('我自己改过的昵称', 'Google Default Name', 'user@example.com'),
    '我自己改过的昵称',
  )
})

test('resolveOAuthUserName falls back to the oauth profile name when no local nickname exists', () => {
  assert.equal(
    resolveOAuthUserName('   ', 'Google Default Name', 'user@example.com'),
    'Google Default Name',
  )
})

test('resolveOAuthUserName falls back to the email prefix when both names are empty', () => {
  assert.equal(
    resolveOAuthUserName('', '   ', 'user@example.com'),
    'user',
  )
})

test('resolveEffectiveUserStatus returns active when suspendedUntil has passed', () => {
  const past = new Date(Date.now() - 1000).toISOString()
  const result = resolveEffectiveUserStatus({
    id: 'u1',
    email: 'u1@test.com',
    name: 'U1',
    status: 'suspended',
    suspendedUntil: past,
    createdAt: new Date().toISOString(),
  })
  assert.equal(result, 'active')
})

test('resolveEffectiveUserStatus keeps suspended until the deadline', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const result = resolveEffectiveUserStatus({
    id: 'u1',
    email: 'u1@test.com',
    name: 'U1',
    status: 'suspended',
    suspendedUntil: future,
    createdAt: new Date().toISOString(),
  })
  assert.equal(result, 'suspended')
})

test('resolveEffectiveUserStatus keeps banned and active unchanged', () => {
  const now = new Date().toISOString()
  assert.equal(resolveEffectiveUserStatus({ id: 'u1', email: 'u1@t.com', name: 'U', status: 'banned', createdAt: now }), 'banned')
  assert.equal(resolveEffectiveUserStatus({ id: 'u2', email: 'u2@t.com', name: 'U2', status: 'active', createdAt: now }), 'active')
  assert.equal(resolveEffectiveUserStatus({ id: 'u3', email: 'u3@t.com', name: 'U3', createdAt: now }), 'active')
})
