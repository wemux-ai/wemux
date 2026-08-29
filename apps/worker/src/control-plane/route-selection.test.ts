import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutorConnectionRouteResponse } from '@shared/types'
import { selectWorkerConnectionRoute, workerRouteSelectionDeps } from './route-selection'

const createRoute = (overrides: Partial<ExecutorConnectionRouteResponse> = {}): ExecutorConnectionRouteResponse => ({
  assignedCloudUrl: 'https://us.wemux.ai',
  assignedLabels: ['route:us', 'realtime:us'],
  managedRoutingLabels: ['route:hk', 'realtime:hk', 'route:us', 'realtime:us'],
  matchedRouteId: 'us',
  candidates: [
    {
      id: 'us',
      cloudUrl: 'https://us.wemux.ai',
      labels: ['route:us', 'realtime:us'],
    },
    {
      id: 'public-default',
      cloudUrl: 'https://wemux.ai',
      labels: [],
    },
  ],
  ...overrides,
})

test('selectWorkerConnectionRoute picks the lowest-latency reachable candidate', async () => {
  const timestamps = [0, 0, 15, 40]
  const nowRestore = test.mock.method(workerRouteSelectionDeps, 'now', () => timestamps.shift() ?? 40)
  const fetchRestore = test.mock.method(workerRouteSelectionDeps, 'fetch', async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  const selection = await selectWorkerConnectionRoute({
    bootstrapCloudUrl: 'https://wemux.ai',
    route: createRoute(),
  })

  fetchRestore.mock.restore()
  nowRestore.mock.restore()

  assert.equal(selection.cloudUrl, 'https://us.wemux.ai')
  assert.deepEqual(selection.labels, ['route:us', 'realtime:us'])
  assert.equal(selection.probeResults.length, 2)
  assert.equal(selection.selectedCandidate.id, 'us')
})

test('selectWorkerConnectionRoute falls back to bootstrap/public candidate when assigned route is unreachable', async () => {
  const fetchRestore = test.mock.method(workerRouteSelectionDeps, 'fetch', async (input: string) => {
    if (`${input}`.includes('us.wemux.ai')) {
      throw new Error('connect timeout')
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  const selection = await selectWorkerConnectionRoute({
    bootstrapCloudUrl: 'https://wemux.ai',
    route: createRoute(),
  })

  fetchRestore.mock.restore()

  assert.equal(selection.cloudUrl, 'https://wemux.ai')
  assert.deepEqual(selection.labels, [])
  assert.equal(selection.selectedCandidate.id, 'public-default')
})

test('selectWorkerConnectionRoute falls back to assigned route when all probes fail', async () => {
  const fetchRestore = test.mock.method(workerRouteSelectionDeps, 'fetch', async () => {
    throw new Error('network down')
  })

  const selection = await selectWorkerConnectionRoute({
    bootstrapCloudUrl: 'https://wemux.ai',
    route: createRoute(),
  })

  fetchRestore.mock.restore()

  assert.equal(selection.cloudUrl, 'https://us.wemux.ai')
  assert.deepEqual(selection.labels, ['route:us', 'realtime:us'])
  assert.equal(selection.selectedCandidate.id, 'us')
})
