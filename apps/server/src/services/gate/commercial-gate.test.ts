// [INPUT]: CommercialGate 默认实现语义验证
// [OUTPUT]: 开源默认实现恒放行（放行类禁抛错红线）的回归防线
// [POS]: gate 语义单测——公开版 BYOK 链路依赖「计费准入恒放行」，ensureSufficientBalance 抛错会误伤主链路，在此拦截。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCreditInsufficientError,
  getCommercialGate,
  isCreditInsufficientError,
  openSourceCommercialGate,
  registerCommercialGate,
} from './commercial-gate'

test('billing access resolves to always-allowed without throwing', async () => {
  const access = await openSourceCommercialGate.resolveUserBillingAccess('user-1', 'create_task')
  assert.equal(access.allowed, true)
  const feature = await openSourceCommercialGate.resolveBillingFeatureAccess('user-1', 'create_task')
  assert.equal(feature.allowed, true)
  const seat = await openSourceCommercialGate.resolveTeamSeatAccess('team-1', 'owner')
  assert.equal(seat.allowed, true)
})

test('policy snapshot falls back to free plan with enforcement disabled', async () => {
  const snapshot = await openSourceCommercialGate.resolveBillingPolicySnapshot('user-1')
  assert.equal(snapshot.plan, 'free')
  assert.equal(snapshot.enforcementEnabled, false)
})

test('free execution quota access stays allowed with unlimited quota shape', async () => {
  for (const quota of [
    await openSourceCommercialGate.resolveFreeExecutionQuotaAccess('user-1'),
    await openSourceCommercialGate.resolveFreeWorkspaceQuotaAccess('user-1'),
  ]) {
    const record = quota as Record<string, unknown>
    assert.equal(record.allowed, true)
    assert.equal(record.limit, null)
    assert.equal(record.remaining, null)
  }
})

test('startFreeExecutionSession returns placeholder token so main chat path passes', async () => {
  const session = await openSourceCommercialGate.startFreeExecutionSession({
    userId: 'user-1',
    sessionKey: 'session-1',
    kind: 'main_chat',
  })
  const record = session as Record<string, unknown>
  assert.equal(record.allowed, true)
  assert.ok(typeof record.token === 'string' && record.token.length > 0)
  await assert.doesNotReject(() =>
    openSourceCommercialGate.finishFreeExecutionSession({ token: String(record.token) }),
  )
})

test('ensureSufficientBalance must NOT throw (BYOK red line)', async () => {
  await assert.doesNotReject(() =>
    openSourceCommercialGate.ensureSufficientBalance('user', 'user-1'),
  )
  await assert.doesNotReject(() =>
    openSourceCommercialGate.ensureSufficientBalance('workspace', 'ws-1'),
  )
})

test('credit admin queries return empty shapes instead of throwing', async () => {
  const accounts = await openSourceCommercialGate.listAllAccounts()
  assert.deepEqual(accounts, { items: [], hasMore: false })
  assert.deepEqual(await openSourceCommercialGate.listTransactions(), [])
  assert.deepEqual(
    await openSourceCommercialGate.enrichAccountsWithOwner([
      { ownerType: 'user', ownerId: 'user-1' },
    ]),
    [{ ownerType: 'user', ownerId: 'user-1', ownerName: '', ownerEmail: '' }],
  )
})

test('adjustBalance is intentionally unavailable (disappeared capability)', async () => {
  await assert.rejects(() => openSourceCommercialGate.adjustBalance({}))
})

test('credit insufficient error helpers work with and without registered ctor', () => {
  const error = createCreditInsufficientError('balance too low')
  assert.equal(isCreditInsufficientError(error), true)
  assert.equal(isCreditInsufficientError(new Error('other')), false)
  assert.equal(isCreditInsufficientError(null), false)
})

test('registerCommercialGate swaps implementation and getter reflects it', () => {
  const original = getCommercialGate()
  try {
    registerCommercialGate({ ...original })
    assert.notEqual(getCommercialGate(), original)
  } finally {
    registerCommercialGate(original)
  }
  assert.equal(getCommercialGate(), original)
})
