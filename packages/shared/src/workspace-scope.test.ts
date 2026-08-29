import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkspaceResourceVisible } from './workspace-scope'

test('isWorkspaceResourceVisible: system resources are global', () => {
  assert.equal(isWorkspaceResourceVisible({ ownerUserId: null }, { userId: 'u-1', workspaceId: 'ws-1' }), true)
  assert.equal(isWorkspaceResourceVisible({ ownerUserId: 'u-2', managedBySystem: true, workspaceId: 'ws-2' }, { userId: 'u-1', workspaceId: 'ws-1' }), true)
})

test('isWorkspaceResourceVisible: owner always sees own resource', () => {
  const resource = { ownerUserId: 'u-1', workspaceId: 'ws-1', visibility: 'private' }
  assert.equal(isWorkspaceResourceVisible(resource, { userId: 'u-1', workspaceId: 'ws-1' }), true)
  assert.equal(isWorkspaceResourceVisible(resource, { userId: 'u-1', workspaceId: 'ws-2' }), true)
})

test('isWorkspaceResourceVisible: workspace shared is scoped to its workspace', () => {
  const resource = { ownerUserId: 'u-2', workspaceId: 'ws-1', visibility: 'workspace' }
  assert.equal(isWorkspaceResourceVisible(resource, { userId: 'u-1', workspaceId: 'ws-1' }), true)
  assert.equal(isWorkspaceResourceVisible(resource, { userId: 'u-1', workspaceId: 'ws-2' }), false)
  assert.equal(isWorkspaceResourceVisible(resource, { userId: 'u-1' }), false)
})

test('isWorkspaceResourceVisible: private is never visible to others', () => {
  const resource = { ownerUserId: 'u-2', workspaceId: 'ws-1', visibility: 'private' }
  assert.equal(isWorkspaceResourceVisible(resource, { userId: 'u-1', workspaceId: 'ws-1' }), false)
  // 默认 private
  const legacy = { ownerUserId: 'u-2', workspaceId: 'ws-1' }
  assert.equal(isWorkspaceResourceVisible(legacy, { userId: 'u-1', workspaceId: 'ws-1' }), false)
  assert.equal(isWorkspaceResourceVisible(legacy, { userId: 'u-2', workspaceId: 'ws-1' }), true)
})
