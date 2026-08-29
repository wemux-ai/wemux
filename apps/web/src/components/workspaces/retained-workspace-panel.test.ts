import assert from 'node:assert/strict'
import test from 'node:test'

import { touchRetainedWorkspacePanelKey } from './retained-workspace-panel'

test('retained workspace panel cache keeps the latest sixteen workspace panels', () => {
  const panelKeys = Array.from({ length: 16 }, (_, index) => `workspace-${index + 1}`)

  assert.deepEqual(
    touchRetainedWorkspacePanelKey(panelKeys, 'workspace-17'),
    Array.from({ length: 16 }, (_, index) => `workspace-${index + 2}`),
  )
})

test('retained workspace panel cache refreshes a workspace recency without duplicating it', () => {
  assert.deepEqual(
    touchRetainedWorkspacePanelKey(['workspace-1', 'workspace-2', 'workspace-3'], 'workspace-2'),
    ['workspace-1', 'workspace-3', 'workspace-2'],
  )
})
