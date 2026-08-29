import assert from 'node:assert/strict'
import test from 'node:test'

import type { RailwayDeploymentSummary, RailwayResourceBinding } from '@shared/types'

import {
  resolveRailwayDeploymentDisplay,
  resolveWorkspaceIndexedRailwayDeploymentDisplay,
} from './railway-deployment'

const deployment = (overrides: Partial<RailwayDeploymentSummary> = {}): RailwayDeploymentSummary => ({
  id: 'dep-1',
  railwayProjectId: 'rp-1',
  environmentId: 'env-1',
  environmentName: 'preview',
  isEphemeral: false,
  status: 'SUCCESS',
  isLatest: true,
  syncedAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  ...overrides,
})

test('resolves a successful deployment display with green tone', () => {
  const display = resolveRailwayDeploymentDisplay(deployment({ status: 'SUCCESS', prNumber: 42, url: 'https://railway.app/x' }))
  assert.ok(display)
  assert.equal(display?.label, '已部署')
  assert.equal(display?.compactLabel, '已部署')
  assert.equal(display?.prNumber, 42)
  assert.equal(display?.url, 'https://railway.app/x')
  assert.match(display?.toneClassName ?? '', /emerald/)
  assert.equal(display?.icon, 'success')
})

test('maps status groups to tone and icon', () => {
  assert.equal(resolveRailwayDeploymentDisplay(deployment({ status: 'FAILED' }))?.toneClassName, 'bg-red-500/10 text-red-300')
  assert.equal(resolveRailwayDeploymentDisplay(deployment({ status: 'BUILDING' }))?.icon, 'building')
  assert.match(resolveRailwayDeploymentDisplay(deployment({ status: 'DEPLOYING' }))?.toneClassName ?? '', /amber/)
  assert.equal(resolveRailwayDeploymentDisplay(deployment({ status: 'SLEEPING' }))?.icon, 'sleeping')
})

test('removed deployments are not displayed', () => {
  assert.equal(resolveRailwayDeploymentDisplay(deployment({ status: 'REMOVED' })), null)
  assert.equal(resolveRailwayDeploymentDisplay(deployment({ status: 'SKIPPED' })), null)
  assert.equal(resolveRailwayDeploymentDisplay(null), null)
})

test('workspace resolution prefers latest successful deployment by branch match', () => {
  const deployments = [
    deployment({ id: 'old-fail', status: 'FAILED', branch: 'feat/x', updatedAt: '2026-08-14T02:00:00.000Z' }),
    deployment({ id: 'new-ok', status: 'SUCCESS', branch: 'feat/x', updatedAt: '2026-08-14T03:00:00.000Z' }),
    deployment({ id: 'other', status: 'SUCCESS', branch: 'main', updatedAt: '2026-08-14T04:00:00.000Z' }),
  ]
  const display = resolveWorkspaceIndexedRailwayDeploymentDisplay({
    deployments,
    compareBranch: 'feat/x',
  })
  assert.equal(display?.status, 'SUCCESS')
  assert.equal(display?.label, '已部署')
})

test('workspace resolution prefers an active binding over branch match', () => {
  const deployments = [
    deployment({ id: 'dep-a', status: 'FAILED', branch: 'feat/x', railwayProjectId: 'rp-1', environmentId: 'env-1' }),
    deployment({ id: 'dep-b', status: 'SUCCESS', branch: 'main', railwayProjectId: 'rp-1', environmentId: 'env-2' }),
  ]
  const bindings: RailwayResourceBinding[] = [{
    id: 'b1',
    provider: 'railway',
    resourceType: 'deployment',
    resourceId: 'railway:rp-1:env-2:dep-b',
    projectId: 'p1',
    role: 'delivery',
    status: 'confirmed',
    source: 'manual',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    workspaceId: 'w1',
  }]
  const display = resolveWorkspaceIndexedRailwayDeploymentDisplay({
    deployments,
    bindings,
    workspaceId: 'w1',
    compareBranch: 'feat/x',
  })
  assert.equal(display?.label, '已部署')
  assert.equal(display?.status, 'SUCCESS')
})

test('workspace resolution returns null when nothing matches', () => {
  const deployments = [deployment({ status: 'SUCCESS', branch: 'main' })]
  assert.equal(resolveWorkspaceIndexedRailwayDeploymentDisplay({
    deployments,
    compareBranch: 'feat/nothing',
  }), null)
})
