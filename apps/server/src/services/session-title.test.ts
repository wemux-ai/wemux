import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSessionTitle } from './session-title'

test('buildSessionTitle normalizes whitespace before truncation', () => {
  assert.equal(buildSessionTitle('  修复   workspace   标题   问题  '), '修复 workspace 标题 问题')
})

test('buildSessionTitle truncates long first messages', () => {
  assert.equal(buildSessionTitle('012345678901234567890123456789'), '012345678901234567890123...')
})

test('buildSessionTitle falls back for empty messages', () => {
  assert.equal(buildSessionTitle('   '), '新会话')
})
