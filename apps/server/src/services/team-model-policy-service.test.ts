// [INPUT]: 团队模型白名单的验证需求。
// [OUTPUT]: 白名单开启/关闭、校验命中与未命中的断言。
// [POS]: team-model-policy-service 单测（真实 Postgres + 真实 meta 存储）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { closePostgres, ensurePostgresReady } from '../storage/postgres/db'
import { checkTeamModelAllowed, getTeamModelPolicyView, setTeamModelPolicy } from './team-model-policy-service'

const policyTeamId = `team-policy-test-${Date.now().toString(36)}`

test.after(async () => {
  setTeamModelPolicy(policyTeamId, null)
  await closePostgres()
})

test('unset policy means unlimited and allows any model', async () => {
  await ensurePostgresReady()
  const view = getTeamModelPolicyView(policyTeamId)
  assert.equal(view.enabled, false)
  assert.equal(checkTeamModelAllowed(policyTeamId, 'opencode/gpt-4.1'), null)
  assert.equal(checkTeamModelAllowed(policyTeamId, 'anything/else'), null)
})

test('enabling whitelist restricts allowed models only', async () => {
  await ensurePostgresReady()
  const view = setTeamModelPolicy(policyTeamId, ['opencode/gpt-4.1', 'claude/sonnet', 'opencode/gpt-4.1'])
  assert.equal(view.enabled, true)
  assert.deepEqual(view.allowedModelIds, ['opencode/gpt-4.1', 'claude/sonnet'])
  assert.equal(view.allowedModelIds.length, 2)

  assert.equal(checkTeamModelAllowed(policyTeamId, 'opencode/gpt-4.1'), null)
  assert.equal(checkTeamModelAllowed(policyTeamId, 'claude/sonnet'), null)
  const blocked = checkTeamModelAllowed(policyTeamId, 'gemini/flash')
  assert.ok(blocked && blocked.includes('gemini/flash'))
})

test('whitelist ignores empty model ids and trims duplicates', async () => {
  await ensurePostgresReady()
  setTeamModelPolicy(policyTeamId, ['  opencode/gpt-4.1  ', '', 'opencode/gpt-4.1'])
  const view = getTeamModelPolicyView(policyTeamId)
  assert.deepEqual(view.allowedModelIds, ['opencode/gpt-4.1'])
})

test('disabling whitelist (null or empty) restores unlimited', async () => {
  await ensurePostgresReady()
  setTeamModelPolicy(policyTeamId, ['opencode/gpt-4.1'])
  assert.equal(checkTeamModelAllowed(policyTeamId, 'gemini/flash') !== null, true)

  const view = setTeamModelPolicy(policyTeamId, null)
  assert.equal(view.enabled, false)
  assert.equal(checkTeamModelAllowed(policyTeamId, 'gemini/flash'), null)
})

test('missing teamId or model always allowed', async () => {
  assert.equal(checkTeamModelAllowed(undefined, 'opencode/gpt-4.1'), null)
  assert.equal(checkTeamModelAllowed('', 'opencode/gpt-4.1'), null)
  assert.equal(checkTeamModelAllowed(policyTeamId, undefined), null)
})
