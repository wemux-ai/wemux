import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRailwayResourceBindingContextKey,
  buildRailwayResourceId,
  isActiveRailwayResourceBinding,
  isRailwayDeploymentActive,
  isRailwayDeploymentStatus,
  resolveRailwayDeploymentStatusGroup,
  resolveRailwayResourceBindingStatus,
} from './railway-resources'

test('builds stable Railway resource identities and context keys', () => {
  assert.equal(buildRailwayResourceId({
    railwayProjectId: 'prj-1',
    environmentId: 'env-2',
    deploymentId: 'dep-3',
  }), 'railway:prj-1:env-2:dep-3')

  assert.equal(buildRailwayResourceBindingContextKey({
    taskId: ' task-1 ',
    workspaceId: ' workspace-1 ',
    workspaceSessionId: ' session-1 ',
  }), 'task:task-1|workspace:workspace-1|session:session-1')
})

test('requires a concrete local context for a Railway resource binding', () => {
  assert.throws(
    () => buildRailwayResourceBindingContextKey({}),
    /requires a task, workspace, or workspace session target/,
  )
})

test('heuristic suggestions never overwrite a confirmed or rejected decision', () => {
  assert.equal(resolveRailwayResourceBindingStatus(undefined, 'suggested'), 'suggested')
  assert.equal(resolveRailwayResourceBindingStatus('suggested', 'confirmed'), 'confirmed')
  assert.equal(resolveRailwayResourceBindingStatus('suggested', 'rejected'), 'rejected')
  assert.equal(resolveRailwayResourceBindingStatus('confirmed', 'suggested'), 'confirmed')
  assert.equal(resolveRailwayResourceBindingStatus('rejected', 'suggested'), 'rejected')
  assert.equal(resolveRailwayResourceBindingStatus('rejected', 'confirmed'), 'confirmed')
})

test('rejected bindings are inactive', () => {
  assert.equal(isActiveRailwayResourceBinding({ status: 'suggested' }), true)
  assert.equal(isActiveRailwayResourceBinding({ status: 'confirmed' }), true)
  assert.equal(isActiveRailwayResourceBinding({ status: 'rejected' }), false)
})

test('recognizes Railway deployment statuses', () => {
  assert.equal(isRailwayDeploymentStatus('SUCCESS'), true)
  assert.equal(isRailwayDeploymentStatus('FAILED'), true)
  assert.equal(isRailwayDeploymentStatus('NOPE'), false)
  assert.equal(isRailwayDeploymentStatus(null), false)
})

test('groups deployment statuses into display buckets', () => {
  assert.equal(resolveRailwayDeploymentStatusGroup('SUCCESS'), 'success')
  assert.equal(resolveRailwayDeploymentStatusGroup('FAILED'), 'failed')
  assert.equal(resolveRailwayDeploymentStatusGroup('CRASHED'), 'failed')
  assert.equal(resolveRailwayDeploymentStatusGroup('BUILDING'), 'building')
  assert.equal(resolveRailwayDeploymentStatusGroup('DEPLOYING'), 'building')
  assert.equal(resolveRailwayDeploymentStatusGroup('QUEUED'), 'building')
  assert.equal(resolveRailwayDeploymentStatusGroup('WAITING'), 'building')
  assert.equal(resolveRailwayDeploymentStatusGroup('INITIALIZING'), 'building')
  assert.equal(resolveRailwayDeploymentStatusGroup('NEEDS_APPROVAL'), 'building')
  assert.equal(resolveRailwayDeploymentStatusGroup('SLEEPING'), 'sleeping')
  assert.equal(resolveRailwayDeploymentStatusGroup('REMOVED'), 'removed')
  assert.equal(resolveRailwayDeploymentStatusGroup('REMOVING'), 'removed')
  assert.equal(resolveRailwayDeploymentStatusGroup('SKIPPED'), 'removed')
  assert.equal(resolveRailwayDeploymentStatusGroup(undefined), 'removed')
  assert.equal(resolveRailwayDeploymentStatusGroup('UNKNOWN'), 'removed')
})

test('removed states are inactive deployments', () => {
  assert.equal(isRailwayDeploymentActive('SUCCESS'), true)
  assert.equal(isRailwayDeploymentActive('FAILED'), true)
  assert.equal(isRailwayDeploymentActive('BUILDING'), true)
  assert.equal(isRailwayDeploymentActive('SLEEPING'), true)
  assert.equal(isRailwayDeploymentActive('REMOVED'), false)
  assert.equal(isRailwayDeploymentActive('SKIPPED'), false)
})
