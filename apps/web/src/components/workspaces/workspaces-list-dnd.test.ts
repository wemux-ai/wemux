import assert from 'node:assert/strict'
import test from 'node:test'
import {
  reorderWorkspaceListIds,
  resolveWorkspaceListDropPositionFromOffset,
} from './workspaces-list-dnd'

test('resolveWorkspaceListDropPositionFromOffset returns before for the upper half', () => {
  assert.equal(resolveWorkspaceListDropPositionFromOffset(10, 40), 'before')
})

test('resolveWorkspaceListDropPositionFromOffset returns after for the lower half', () => {
  assert.equal(resolveWorkspaceListDropPositionFromOffset(30, 40), 'after')
})

test('reorderWorkspaceListIds inserts the dragged workspace before the target', () => {
  assert.deepEqual(
    reorderWorkspaceListIds(['workspace-a', 'workspace-b', 'workspace-c'], 'workspace-c', 'workspace-b', 'before'),
    ['workspace-a', 'workspace-c', 'workspace-b'],
  )
})

test('reorderWorkspaceListIds inserts the dragged workspace after the target', () => {
  assert.deepEqual(
    reorderWorkspaceListIds(['workspace-a', 'workspace-b', 'workspace-c'], 'workspace-a', 'workspace-b', 'after'),
    ['workspace-b', 'workspace-a', 'workspace-c'],
  )
})

test('reorderWorkspaceListIds returns null when the order does not change', () => {
  assert.equal(
    reorderWorkspaceListIds(['workspace-a', 'workspace-b', 'workspace-c'], 'workspace-a', 'workspace-b', 'before'),
    null,
  )
})
