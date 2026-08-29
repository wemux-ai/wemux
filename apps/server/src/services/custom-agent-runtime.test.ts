import assert from 'node:assert/strict'
import test from 'node:test'

import { writeCustomAgentConfig } from '@shared/custom-agent'
import type { AgentRecord } from '@shared/types'
import { selectBoundCustomAgent } from './custom-agent-runtime'

const createAgent = (id: string, name: string, ownerUserId: string): AgentRecord => ({
  id,
  name,
  type: 'custom',
  status: 'offline',
  endpoint: null,
  config: writeCustomAgentConfig({}, { enabled: true, archived: false }),
  ownerUserId,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  lastHeartbeatAt: null,
  workDir: '',
  workDirStatus: 'missing',
})

test('legacy name fallback only resolves an Agent owned by the current user', () => {
  const catalog = [
    createAgent('agent-2', 'Planner', 'user-2'),
    createAgent('agent-1', 'Planner', 'user-1'),
  ]

  assert.equal(selectBoundCustomAgent(catalog, { customAgentName: 'Planner' }, 'user-1')?.agent.id, 'agent-1')
  assert.equal(selectBoundCustomAgent(catalog, { customAgentName: 'Planner' })?.agent, undefined)
})

test('stable Agent IDs preserve explicitly bound cross-owner sessions', () => {
  const sharedAgent = createAgent('shared-agent', 'Planner', 'user-2')

  assert.equal(
    selectBoundCustomAgent([sharedAgent], { customAgentId: sharedAgent.id }, 'user-1')?.agent.id,
    sharedAgent.id,
  )
})
