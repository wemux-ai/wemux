import assert from 'node:assert/strict'
import test from 'node:test'
import { writeCustomAgentConfig } from '@shared/custom-agent'
import type { AgentRecord } from '@shared/types'
import { resolveCustomAgentProjectAccess, resolveWorkspaceGroupLeaderId } from './task-agent-assignment-service'

const agent = (params: {
  ownerUserId?: string
  workspaceIds?: string[]
  projectIds?: string[]
  visibility?: 'private' | 'workspace'
  allowedModes?: Array<'mention' | 'delegate'>
}) => ({
  id: 'agent-1',
  name: 'Developer Agent',
  type: 'custom',
  status: 'offline',
  endpoint: null,
  ownerUserId: params.ownerUserId,
  config: writeCustomAgentConfig({}, {
    enabled: true,
    archived: false,
    allowedModes: params.allowedModes ?? ['mention', 'delegate'],
    workspaceIds: params.workspaceIds ?? [],
    projectIds: params.projectIds ?? [],
    visibility: params.visibility ?? 'private',
  }),
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  lastHeartbeatAt: null,
  workDir: '',
  workDirStatus: 'missing',
}) satisfies AgentRecord

const detail = (orchestratorAgentId?: string) => ({
  conversation: { orchestratorAgentId },
  members: [
    { memberType: 'agent' as const, memberId: 'agent-a' },
    { memberType: 'agent' as const, memberId: 'agent-b' },
  ],
})

test('Squad leader is explicit and never inferred from member order', () => {
  assert.equal(resolveWorkspaceGroupLeaderId(detail()), null)
  assert.equal(resolveWorkspaceGroupLeaderId(detail('agent-b')), 'agent-b')
  assert.equal(resolveWorkspaceGroupLeaderId(detail('agent-missing')), null)
})

test('private Agent is available to its owner but hidden from other users', () => {
  const privateAgent = agent({ ownerUserId: 'owner-1' })
  assert.equal(resolveCustomAgentProjectAccess({
    agent: privateAgent,
    userId: 'owner-1',
    projectId: 'project-1',
    collaborationWorkspaceId: 'workspace-1',
    mode: 'delegate',
  }).ok, true)
  assert.equal(resolveCustomAgentProjectAccess({
    agent: privateAgent,
    userId: 'member-2',
    projectId: 'project-1',
    collaborationWorkspaceId: 'workspace-1',
    mode: 'delegate',
  }).ok, false)
})

test('Agent explicitly shared to a workspace is assignable by another project member', () => {
  const sharedAgent = agent({ ownerUserId: 'owner-1', workspaceIds: ['workspace-1'], visibility: 'workspace' })
  assert.equal(resolveCustomAgentProjectAccess({
    agent: sharedAgent,
    userId: 'member-2',
    projectId: 'project-1',
    collaborationWorkspaceId: 'workspace-1',
    mode: 'delegate',
  }).ok, true)
  assert.equal(resolveCustomAgentProjectAccess({
    agent: sharedAgent,
    userId: 'member-2',
    projectId: 'project-1',
    collaborationWorkspaceId: 'workspace-2',
    mode: 'delegate',
  }).ok, false)
  // 归属 workspace 但私有：非 owner 即使 workspace 匹配也不可用
  const scopedPrivate = agent({ ownerUserId: 'owner-1', workspaceIds: ['workspace-1'], visibility: 'private' })
  assert.equal(resolveCustomAgentProjectAccess({
    agent: scopedPrivate,
    userId: 'member-2',
    projectId: 'project-1',
    collaborationWorkspaceId: 'workspace-1',
    mode: 'delegate',
  }).ok, false)
})

test('project sharing and invocation mode are both enforced', () => {
  const mentionOnlyAgent = agent({
    ownerUserId: 'owner-1',
    projectIds: ['project-1'],
    visibility: 'workspace',
    allowedModes: ['mention'],
  })
  assert.equal(resolveCustomAgentProjectAccess({
    agent: mentionOnlyAgent,
    userId: 'member-2',
    projectId: 'project-1',
    mode: 'mention',
  }).ok, true)
  assert.equal(resolveCustomAgentProjectAccess({
    agent: mentionOnlyAgent,
    userId: 'member-2',
    projectId: 'project-1',
    mode: 'delegate',
  }).ok, false)
})
