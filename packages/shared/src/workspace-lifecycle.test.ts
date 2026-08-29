import assert from 'node:assert/strict'
import test from 'node:test'
import { canDeleteWorkspaceRecord } from './workspace-lifecycle'

test('workspace records can be deleted unless they are binding-owned', () => {
  assert.equal(canDeleteWorkspaceRecord({ source: 'manual' }), true)
  assert.equal(canDeleteWorkspaceRecord({ source: 'workspace-root' }), true)
  assert.equal(canDeleteWorkspaceRecord({ source: 'binding' }), false)
})
