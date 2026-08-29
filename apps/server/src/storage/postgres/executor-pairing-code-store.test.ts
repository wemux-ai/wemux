import assert from 'node:assert/strict'
import test from 'node:test'
import { closePostgres, isPostgresConfigured, query } from './db'
import {
  consumePersistedExecutorPairingCode,
  createPersistedExecutorPairingCode,
} from './executor-pairing-code-store'

const testIfPostgres = isPostgresConfigured() ? test : test.skip
const createdPairingCodes = new Set<string>()

test.afterEach(async () => {
  for (const pairingCode of createdPairingCodes) {
    await query('DELETE FROM executor_pairing_codes WHERE pairing_code = $1', [pairingCode])
  }
  createdPairingCodes.clear()
})

test.after(async () => {
  await closePostgres()
})

testIfPostgres('consumePersistedExecutorPairingCode only succeeds once', async () => {
  const pairingCode = `PAIR-${crypto.randomUUID()}`
  createdPairingCodes.add(pairingCode)
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()

  await createPersistedExecutorPairingCode({
    pairingCode,
    ownerUserId: 'user-pairing-once',
    teamId: 'workspace-pairing-once',
    workspaceIds: ['workspace-pairing-once'],
    visibility: 'team',
    previewExposureMode: 'public-ingress',
    label: 'US MacBook',
    createdAt,
    expiresAt,
  })

  const first = await consumePersistedExecutorPairingCode(pairingCode, new Date().toISOString())
  const second = await consumePersistedExecutorPairingCode(pairingCode, new Date().toISOString())

  assert.equal(first.status, 'consumed')
  assert.equal(first.record.pairingCode, pairingCode)
  assert.equal(first.record.previewExposureMode, 'public-ingress')
  assert.ok(first.record.usedAt)
  assert.equal(second.status, 'used')
  assert.equal(second.record.pairingCode, pairingCode)
})

testIfPostgres('consumePersistedExecutorPairingCode rejects expired codes', async () => {
  const pairingCode = `PAIR-${crypto.randomUUID()}`
  createdPairingCodes.add(pairingCode)
  const createdAt = new Date(Date.now() - 15 * 60_000).toISOString()
  const expiresAt = new Date(Date.now() - 5 * 60_000).toISOString()

  await createPersistedExecutorPairingCode({
    pairingCode,
    ownerUserId: 'user-pairing-expired',
    visibility: 'private',
    createdAt,
    expiresAt,
  })

  const result = await consumePersistedExecutorPairingCode(pairingCode, new Date().toISOString())

  assert.equal(result.status, 'expired')
  assert.equal(result.record.pairingCode, pairingCode)
  assert.equal(result.record.ownerUserId, 'user-pairing-expired')
})
