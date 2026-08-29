import assert from 'node:assert/strict'
import test from 'node:test'
import { isExecutorVisibleToUser } from './collaboration'

test('executor visibility: own nodes are available across workspaces', () => {
  const myNode = { ownerUserId: 'u-1', visibility: 'private' as const }
  assert.equal(isExecutorVisibleToUser(myNode, 'u-1', { workspaceId: 'ws-1' }), true)
  assert.equal(isExecutorVisibleToUser(myNode, 'u-1', { workspaceId: 'ws-2' }), true)
  assert.equal(isExecutorVisibleToUser(myNode, 'u-1'), true)
})

test('executor visibility: shared nodes are scoped to their workspace when workspace context is given', () => {
  const sharedNode = { ownerUserId: 'u-2', visibility: 'team' as const, workspaceIds: ['ws-1'] }
  assert.equal(isExecutorVisibleToUser(sharedNode, 'u-1', { workspaceId: 'ws-1' }), true)
  assert.equal(isExecutorVisibleToUser(sharedNode, 'u-1', { workspaceId: 'ws-2' }), false)
  // 无 workspace 上下文 → team 兼容
  assert.equal(isExecutorVisibleToUser(sharedNode, 'u-1', { teamIds: new Set(['team-a']) }), false)
  assert.equal(isExecutorVisibleToUser(sharedNode, 'u-1', { teamIds: new Set(['ws-1']) }), true)
})

test('executor visibility: private node of another user is never visible', () => {
  const otherPrivateNode = { ownerUserId: 'u-2', visibility: 'private' as const }
  assert.equal(isExecutorVisibleToUser(otherPrivateNode, 'u-1', { workspaceId: 'ws-1' }), false)
})

test('executor visibility: teamId fallback when workspaceIds are absent', () => {
  const legacySharedNode = { ownerUserId: 'u-2', visibility: 'team' as const, teamId: 'team-a' }
  assert.equal(isExecutorVisibleToUser(legacySharedNode, 'u-1', { workspaceId: 'team-a' }), true)
  assert.equal(isExecutorVisibleToUser(legacySharedNode, 'u-1', { workspaceId: 'ws-2' }), false)
})
