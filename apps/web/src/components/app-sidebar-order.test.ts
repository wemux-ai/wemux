import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeProjectSectionOrder,
  reorderProjectIds,
  resolveSidebarProjectDropPositionFromOffset,
} from './app-sidebar-project-order'

test('resolveSidebarProjectDropPositionFromOffset returns before for the upper half', () => {
  assert.equal(resolveSidebarProjectDropPositionFromOffset(10, 40), 'before')
})

test('resolveSidebarProjectDropPositionFromOffset returns after for the lower half', () => {
  assert.equal(resolveSidebarProjectDropPositionFromOffset(30, 40), 'after')
})

test('reorderProjectIds moves dragged project before target project', () => {
  assert.deepEqual(
    reorderProjectIds(['todo', 'vibemux', 'shopping'], 'shopping', 'vibemux'),
    ['todo', 'shopping', 'vibemux'],
  )
})

test('reorderProjectIds moves dragged project after target project', () => {
  assert.deepEqual(
    reorderProjectIds(['todo', 'vibemux', 'shopping'], 'todo', 'vibemux', 'after'),
    ['vibemux', 'todo', 'shopping'],
  )
})

test('reorderProjectIds ignores self-drop', () => {
  assert.equal(
    reorderProjectIds(['todo', 'vibemux', 'shopping'], 'vibemux', 'vibemux'),
    null,
  )
})

test('reorderProjectIds returns null when dropping without changing order', () => {
  assert.equal(
    reorderProjectIds(['todo', 'vibemux', 'shopping'], 'todo', 'vibemux', 'before'),
    null,
  )
})

test('mergeProjectSectionOrder applies a reordered section back into the full visible order', () => {
  assert.deepEqual(
    mergeProjectSectionOrder(['workspace-a', 'personal-a', 'workspace-b', 'personal-b'], ['workspace-b', 'workspace-a']),
    ['workspace-b', 'personal-a', 'workspace-a', 'personal-b'],
  )
})

test('mergeProjectSectionOrder returns null when the section order did not change', () => {
  assert.equal(
    mergeProjectSectionOrder(['workspace-a', 'personal-a', 'workspace-b'], ['workspace-a', 'workspace-b']),
    null,
  )
})
