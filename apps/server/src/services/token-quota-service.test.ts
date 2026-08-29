import assert from 'node:assert/strict'
import test from 'node:test'
import { closePostgres, ensurePostgresReady } from '../storage/postgres/db'
import { clearTokenQuotaPolicy, getTokenQuotaPolicy, isQuotaManagedByAdmin, resolveTokenQuotaPeriodStart, setTokenQuotaPolicy } from './token-quota-service'

test('resolveTokenQuotaPeriodStart returns UTC day start for daily quotas', () => {
  assert.equal(
    resolveTokenQuotaPeriodStart('day', new Date('2026-08-08T15:30:00.000Z')),
    '2026-08-08T00:00:00.000Z',
  )
  assert.equal(
    resolveTokenQuotaPeriodStart('day', new Date('2026-08-08T00:00:00.000Z')),
    '2026-08-08T00:00:00.000Z',
  )
})

test('resolveTokenQuotaPeriodStart returns UTC month start for monthly quotas', () => {
  assert.equal(
    resolveTokenQuotaPeriodStart('month', new Date('2026-08-08T15:30:00.000Z')),
    '2026-08-01T00:00:00.000Z',
  )
  assert.equal(
    resolveTokenQuotaPeriodStart('month', new Date('2026-12-31T23:59:59.000Z')),
    '2026-12-01T00:00:00.000Z',
  )
})

const quotaTestUserId = `quota-test-${Date.now().toString(36)}`

test.after(async () => {
  clearTokenQuotaPolicy(quotaTestUserId)
  await closePostgres()
})

test('setBy defaults to self and old data without setBy falls back to self', async () => {
  await ensurePostgresReady()
  setTokenQuotaPolicy({ userId: quotaTestUserId, period: 'month', limitTokens: 10_000, action: 'block' })
  const policy = getTokenQuotaPolicy(quotaTestUserId)
  assert.equal(policy?.setBy, 'self')
  assert.equal(isQuotaManagedByAdmin(policy), false)

  // 旧数据（无 setBy 字段）按 self 处理，不锁定用户自设入口
  assert.equal(isQuotaManagedByAdmin({ ...policy!, setBy: undefined }), false)
})

test('setBy team_admin / platform_admin marks policy as admin managed', async () => {
  await ensurePostgresReady()
  setTokenQuotaPolicy({ userId: quotaTestUserId, period: 'day', limitTokens: 5_000, action: 'warn', setBy: 'team_admin' })
  const teamPolicy = getTokenQuotaPolicy(quotaTestUserId)
  assert.equal(teamPolicy?.setBy, 'team_admin')
  assert.equal(isQuotaManagedByAdmin(teamPolicy), true)

  setTokenQuotaPolicy({ userId: quotaTestUserId, period: 'month', limitTokens: 20_000, action: 'block', setBy: 'platform_admin' })
  const platformPolicy = getTokenQuotaPolicy(quotaTestUserId)
  assert.equal(platformPolicy?.setBy, 'platform_admin')
  assert.equal(isQuotaManagedByAdmin(platformPolicy), true)
})

test('setting limit 0 clears policy regardless of setBy', async () => {
  await ensurePostgresReady()
  setTokenQuotaPolicy({ userId: quotaTestUserId, period: 'month', limitTokens: 20_000, action: 'block', setBy: 'team_admin' })
  assert.equal(getTokenQuotaPolicy(quotaTestUserId)?.setBy, 'team_admin')
  setTokenQuotaPolicy({ userId: quotaTestUserId, period: 'month', limitTokens: 0, action: 'block' })
  assert.equal(getTokenQuotaPolicy(quotaTestUserId), null)
})
