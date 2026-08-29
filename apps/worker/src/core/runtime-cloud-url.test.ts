import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeWorkerRoutingLabels } from './runtime-cloud-url'

test('mergeWorkerRoutingLabels strips managed labels before applying current assignment', () => {
  const labels = mergeWorkerRoutingLabels({
    labels: ['self-hosted', 'route:hk', 'realtime:hk'],
    assignedLabels: [],
    managedRoutingLabels: ['route:hk', 'realtime:hk'],
  })

  assert.deepEqual(labels, ['self-hosted'])
})

test('mergeWorkerRoutingLabels appends current assigned labels without duplicates', () => {
  const labels = mergeWorkerRoutingLabels({
    labels: ['self-hosted', 'route:hk'],
    assignedLabels: ['route:hk', 'realtime:hk'],
    managedRoutingLabels: ['route:hk', 'realtime:hk'],
  })

  assert.deepEqual(labels, ['self-hosted', 'route:hk', 'realtime:hk'])
})
