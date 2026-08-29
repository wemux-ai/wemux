import assert from 'node:assert/strict'
import test from 'node:test'
import { applyProjectOrderToProjects, mergeReorderedWorkspaceIdsIntoProjectOrder } from './use-workspaces-reorder-actions'

test('mergeReorderedWorkspaceIdsIntoProjectOrder keeps hidden workspaces in place while reordering visible ones', () => {
  assert.deepEqual(
    mergeReorderedWorkspaceIdsIntoProjectOrder(
      ['workspace-a', 'workspace-hidden', 'workspace-b'],
      ['workspace-b', 'workspace-a'],
    ),
    ['workspace-b', 'workspace-hidden', 'workspace-a'],
  )
})

test('mergeReorderedWorkspaceIdsIntoProjectOrder returns null when the effective order is unchanged', () => {
  assert.equal(
    mergeReorderedWorkspaceIdsIntoProjectOrder(
      ['workspace-a', 'workspace-hidden', 'workspace-b'],
      ['workspace-a', 'workspace-b'],
    ),
    null,
  )
})

test('applyProjectOrderToProjects updates display order for the provided project ids', () => {
  const reordered = applyProjectOrderToProjects(
    [
      { id: 'project-a', name: 'A', displayOrder: 0 },
      { id: 'project-b', name: 'B', displayOrder: 1 },
      { id: 'project-c', name: 'C', displayOrder: 2 },
    ] as any,
    ['project-c', 'project-a', 'project-b'],
  )

  assert.deepEqual(
    reordered.map((project) => project.id),
    ['project-c', 'project-a', 'project-b'],
  )
})
