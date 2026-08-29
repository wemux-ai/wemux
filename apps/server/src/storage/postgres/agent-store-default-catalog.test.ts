import assert from 'node:assert/strict'
import test from 'node:test'

import { readCustomAgentConfig, writeCustomAgentConfig } from '@shared/custom-agent'
import type { AgentRecord } from '@shared/types'
import { isLegacyInitialAgentMissingAvatar, resolveInitialUserAgentProvisionPlan, selectUserAgents } from './agent-store'

const createAgent = (params: {
  id: string
  name: string
  ownerUserId?: string
  customAgent?: Record<string, unknown>
}) => ({
  id: params.id,
  name: params.name,
  type: 'custom',
  status: 'offline',
  endpoint: null,
  ownerUserId: params.ownerUserId,
  config: writeCustomAgentConfig({}, params.customAgent ?? {}),
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  lastHeartbeatAt: null,
  workDir: '',
  workDirStatus: 'missing',
}) satisfies AgentRecord

test('a new user with no Agents receives one ordinary CEO template', () => {
  const plan = resolveInitialUserAgentProvisionPlan(
    [],
    'user-1',
    null,
    '2026-07-22T01:00:00.000Z',
  )

  assert.equal(plan.agent?.name, 'CEO Agent')
  assert.equal(plan.agent?.ownerUserId, 'user-1')
  assert.equal(plan.agent?.config.systemAgentKey, undefined)
  const config = readCustomAgentConfig(plan.agent?.config)
  assert.equal(config.role, 'CEO Agent')
  // CEO 模板固定头像（内置第一个），不随机、不落空
  assert.equal(config.avatarUrl, '/agents/avatars/agent-01.png')
  assert.equal(plan.provisionedAt, '2026-07-22T01:00:00.000Z')
})

test('an existing user Agent completes initial provisioning without creating a CEO duplicate', () => {
  const privateAgent = createAgent({
    id: 'existing-agent',
    name: 'My Agent',
    ownerUserId: 'user-1',
  })

  const plan = resolveInitialUserAgentProvisionPlan(
    [privateAgent],
    'user-1',
    null,
    '2026-07-22T01:00:00.000Z',
  )

  assert.equal(plan.agent, null)
  assert.equal(plan.provisionedAt, '2026-07-22T01:00:00.000Z')
})

test('a deleted initial Agent is not recreated after provisioning has been recorded', () => {
  const plan = resolveInitialUserAgentProvisionPlan(
    [],
    'user-1',
    '2026-07-22T00:30:00.000Z',
    '2026-07-22T01:00:00.000Z',
  )

  assert.equal(plan.agent, null)
  assert.equal(plan.provisionedAt, '2026-07-22T00:30:00.000Z')
})

test('another users Agent does not suppress initial provisioning', () => {
  const otherUsersAgent = createAgent({
    id: 'other-agent',
    name: 'CEO Agent',
    ownerUserId: 'user-2',
  })

  const plan = resolveInitialUserAgentProvisionPlan(
    [otherUsersAgent],
    'user-1',
    null,
    '2026-07-22T01:00:00.000Z',
  )

  assert.equal(plan.agent?.ownerUserId, 'user-1')
})

test('Agent catalogs are isolated by owner regardless of Agent name', () => {
  const userAgent = createAgent({ id: 'user-agent', name: 'My Agent', ownerUserId: 'user-1' })
  const sameNamedAgent = createAgent({ id: 'other-ceo', name: 'CEO Agent', ownerUserId: 'user-2' })
  const legacyOwnerlessAgent = createAgent({ id: 'legacy-general', name: 'General Agent' })

  assert.deepEqual(
    selectUserAgents([sameNamedAgent, legacyOwnerlessAgent, userAgent], 'user-1').map((agent) => agent.id),
    ['user-agent'],
  )
})

test('legacy CEO Agent without avatarUrl is detected for avatar backfill', () => {
  const legacyCeo = createAgent({ id: 'legacy-ceo', name: 'CEO Agent', customAgent: { role: 'CEO Agent' } })

  assert.equal(isLegacyInitialAgentMissingAvatar(legacyCeo), true)
})

test('CEO Agent with avatarUrl is not backfilled', () => {
  const ceoWithAvatar = createAgent({
    id: 'ceo-with-avatar',
    name: 'CEO Agent',
    customAgent: { role: 'CEO Agent', avatarUrl: '/agents/avatars/agent-01.png' },
  })

  assert.equal(isLegacyInitialAgentMissingAvatar(ceoWithAvatar), false)
})

test('renamed or re-roled custom Agents are not backfilled', () => {
  const renamed = createAgent({ id: 'renamed', name: '我的 CEO', customAgent: { role: 'CEO Agent' } })
  const reRoled = createAgent({ id: 're-roled', name: 'CEO Agent', customAgent: { role: '技术负责人' } })
  const generic = createAgent({ id: 'generic', name: 'CEO Agent' })

  assert.equal(isLegacyInitialAgentMissingAvatar(renamed), false)
  assert.equal(isLegacyInitialAgentMissingAvatar(reRoled), false)
  assert.equal(isLegacyInitialAgentMissingAvatar(generic), false)
})

test('non-custom Agent is never avatar-backfilled', () => {
  const mainAgent = {
    ...createAgent({ id: 'main', name: 'CEO Agent', customAgent: { role: 'CEO Agent' } }),
    type: 'main',
  } satisfies AgentRecord

  assert.equal(isLegacyInitialAgentMissingAvatar(mainAgent), false)
})
