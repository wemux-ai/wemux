import assert from 'node:assert/strict'
import test from 'node:test'

import { selectWorkbenchResourceEvictionKeys } from './workbench-resource-registry'

test('resource registry evicts the least recently active paused resource', () => {
  assert.deepEqual(selectWorkbenchResourceEvictionKeys([
    { key: 'active', type: 'iframe', status: 'active', lastActiveAt: 1 },
    { key: 'old', type: 'terminal', status: 'paused', lastActiveAt: 2 },
    { key: 'new', type: 'terminal', status: 'paused', lastActiveAt: 3 },
  ], 2), ['old'])
})
