import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readLocalWorkerExecutorId,
  buildLocalWorkerPreviewMeshBridgeUrl,
  isAllowedPreviewMeshRouteHost,
  readLocalWorkerExecutor,
  normalizeLocalNetworkAccessStatus,
  probeLocalWorkerHealth,
  resolveLocalWorkerEndpoints,
  type LocalNetworkAccessStatus,
} from './browser-local-network-access'

test('normalizeLocalNetworkAccessStatus covers supported status labels', () => {
  const cases: Array<[Parameters<typeof normalizeLocalNetworkAccessStatus>[0], LocalNetworkAccessStatus]> = [
    ['unsupported', 'unsupported'],
    ['unknown', 'unknown'],
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['prompt', 'unknown'],
  ]

  for (const [input, expected] of cases) {
    assert.equal(normalizeLocalNetworkAccessStatus(input), expected)
  }
})

test('probeLocalWorkerHealth reads local worker health payloads', async () => {
  const result = await probeLocalWorkerHealth({
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      service: 'worker-local-server',
      executorId: 'executor-local',
    }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.readable, true)
  assert.equal(result.status, 200)
  assert.equal(result.executorId, 'executor-local')
})

test('probeLocalWorkerHealth falls back to opaque reachability checks', async () => {
  let calls = 0
  const result = await probeLocalWorkerHealth({
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) {
        throw new TypeError('Failed to fetch')
      }

      return {
        type: 'opaque',
        status: 0,
        statusText: '',
      } as Response
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.readable, false)
})

test('readLocalWorkerExecutorId reads runtime executor id from local worker status', async () => {
  const executorId = await readLocalWorkerExecutorId({
    fetchImpl: async () => new Response(JSON.stringify({
      runtime: {
        executorId: 'executor-local',
      },
    }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    }),
  })

  assert.equal(executorId, 'executor-local')
})

test('resolveLocalWorkerEndpoints orders ports by page environment', () => {
  const developmentPorts = resolveLocalWorkerEndpoints({ currentEnvironment: 'development' }).map((endpoint) => endpoint.port)
  const previewPorts = resolveLocalWorkerEndpoints({ currentEnvironment: 'preview' }).map((endpoint) => endpoint.port)
  const productionPorts = resolveLocalWorkerEndpoints({ currentEnvironment: 'production' }).map((endpoint) => endpoint.port)

  assert.deepEqual(developmentPorts.slice(0, 3), [48121, 48123, 48100])
  assert.deepEqual(previewPorts.slice(0, 3), [48123, 48121, 48100])
  assert.deepEqual(productionPorts.slice(0, 3), [48100, 48121, 48123])
  assert.equal(new Set(developmentPorts).size, developmentPorts.length)
  assert.equal(previewPorts.includes(48121), true)
  assert.equal(productionPorts.includes(48123), true)
})

test('readLocalWorkerExecutor probes endpoints until one returns an executor id', async () => {
  const requestedUrls: string[] = []
  const result = await readLocalWorkerExecutor({
    endpoints: resolveLocalWorkerEndpoints({ currentEnvironment: 'preview' }),
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      requestedUrls.push(url)
      if (url.includes(':48123/')) {
        return new Response(JSON.stringify({
          runtime: {
            executorId: 'preview-executor',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    },
  })

  assert.equal(result.executorId, 'preview-executor')
  assert.equal(result.endpoint?.port, 48123)
  assert.equal(requestedUrls[0], 'http://127.0.0.1:48123/api/status')
})

test('readLocalWorkerExecutor prefers an expected executor on an environment base port', async () => {
  const requestedUrls: string[] = []
  const result = await readLocalWorkerExecutor({
    expectedExecutorId: 'executor-b',
    endpoints: resolveLocalWorkerEndpoints({ currentEnvironment: 'production' }),
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      requestedUrls.push(url)
      if (url.includes(':48100/')) {
        return new Response(JSON.stringify({
          runtime: {
            executorId: 'executor-a',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes(':48123/')) {
        return new Response(JSON.stringify({
          runtime: {
            executorId: 'executor-b',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    },
  })

  assert.equal(result.executorId, 'executor-b')
  assert.equal(result.endpoint?.port, 48123)
  assert.deepEqual(requestedUrls.slice(0, 3), [
    'http://127.0.0.1:48100/api/status',
    'http://127.0.0.1:48121/api/status',
    'http://127.0.0.1:48123/api/status',
  ])
})

test('readLocalWorkerExecutor stops after base ports when a worker can provide mesh access', async () => {
  const requestedUrls: string[] = []
  const result = await readLocalWorkerExecutor({
    expectedExecutorId: 'remote-executor',
    endpoints: resolveLocalWorkerEndpoints({ currentEnvironment: 'preview' }),
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      requestedUrls.push(url)
      return url.includes(':48123/')
        ? new Response(JSON.stringify({ runtime: { executorId: 'local-executor' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 404 })
    },
  })

  assert.equal(result.executorId, 'local-executor')
  assert.equal(result.endpoint?.port, 48123)
  assert.deepEqual(requestedUrls, [
    'http://127.0.0.1:48123/api/status',
    'http://127.0.0.1:48121/api/status',
    'http://127.0.0.1:48100/api/status',
  ])
})

test('readLocalWorkerExecutor shares an in-flight scan and caches its result', async () => {
  let calls = 0
  const fetchImpl: typeof fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({
      runtime: {
        executorId: 'executor-local',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const options = {
    endpoints: resolveLocalWorkerEndpoints({ currentEnvironment: 'preview' }),
    fetchImpl,
  }

  const [first, second] = await Promise.all([
    readLocalWorkerExecutor(options),
    readLocalWorkerExecutor(options),
  ])
  const third = await readLocalWorkerExecutor(options)

  assert.equal(first.executorId, 'executor-local')
  assert.equal(second.executorId, 'executor-local')
  assert.equal(third.executorId, 'executor-local')
  assert.equal(calls, 1)
})

test('readLocalWorkerExecutor uses the server plan instead of scanning port ranges', async () => {
  const requestedUrls: string[] = []
  const result = await readLocalWorkerExecutor({
    cacheTtlMs: 0,
    expectedExecutorId: 'executor-target',
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      requestedUrls.push(url)
      return new Response(JSON.stringify({
        executorId: 'executor-target',
        instanceId: 'instance-target',
        protocolVersion: 1,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    planLoader: async () => ({
      targetExecutorId: 'executor-target',
      candidates: [{
        executorId: 'executor-target',
        instanceId: 'instance-target',
        port: 49_321,
        role: 'target',
      }],
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }),
  })

  assert.equal(result.executorId, 'executor-target')
  assert.equal(result.endpoint?.port, 49_321)
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:49321/api/local-access/identity'])
})

test('readLocalWorkerExecutor rejects a process that does not match the server plan', async () => {
  const requestedUrls: string[] = []
  const result = await readLocalWorkerExecutor({
    cacheTtlMs: 0,
    expectedExecutorId: 'executor-target',
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      requestedUrls.push(url)
      return new Response(JSON.stringify({
        executorId: 'executor-other',
        instanceId: 'instance-other',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    planLoader: async () => ({
      targetExecutorId: 'executor-target',
      candidates: [{
        executorId: 'executor-target',
        instanceId: 'instance-target',
        port: 49_321,
        role: 'target',
      }],
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }),
  })

  assert.deepEqual(result, {})
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:49321/api/local-access/identity'])
})

test('buildLocalWorkerPreviewMeshBridgeUrl creates a same-site local worker bridge target', () => {
  const bridgeUrl = buildLocalWorkerPreviewMeshBridgeUrl({
    previewId: 'Preview_ABC',
    routeUrl: 'http://10.144.9.20:39080/api/preview-mesh/http/preview-abc/app?vmx_mesh_token=token',
    endpoint: {
      environment: 'preview',
      port: 48123,
      baseUrl: 'http://127.0.0.1:48123',
      healthUrl: 'http://127.0.0.1:48123/api/health',
      statusUrl: 'http://127.0.0.1:48123/api/status',
      doctorUrl: 'http://127.0.0.1:48123/api/doctor',
      terminalDirectWsUrl: 'ws://127.0.0.1:48123/api/terminal-direct/ws',
    },
  })

  assert.equal(
    bridgeUrl,
    'http://preview-preview-abc.127.0.0.1.nip.io:48123/api/preview-mesh-bridge/bootstrap?target=http%3A%2F%2F10.144.9.20%3A39080%2Fapi%2Fpreview-mesh%2Fhttp%2Fpreview-abc%2Fapp%3Fvmx_mesh_token%3Dtoken',
  )
})

test('isAllowedPreviewMeshRouteHost accepts private mesh hosts only', () => {
  assert.equal(isAllowedPreviewMeshRouteHost('10.144.9.20'), true)
  assert.equal(isAllowedPreviewMeshRouteHost('172.20.1.2'), true)
  assert.equal(isAllowedPreviewMeshRouteHost('192.168.1.2'), true)
  assert.equal(isAllowedPreviewMeshRouteHost('node-a.internal'), true)
  assert.equal(isAllowedPreviewMeshRouteHost('127.0.0.1'), false)
  assert.equal(isAllowedPreviewMeshRouteHost('localhost'), false)
  assert.equal(isAllowedPreviewMeshRouteHost('8.8.8.8'), false)
})

test('buildLocalWorkerPreviewMeshBridgeUrl rejects non-mesh targets', () => {
  assert.equal(buildLocalWorkerPreviewMeshBridgeUrl({
    previewId: 'preview-1',
    routeUrl: 'https://preview.example.com',
  }), '')
  assert.equal(buildLocalWorkerPreviewMeshBridgeUrl({
    previewId: 'preview-1',
    routeUrl: 'http://127.0.0.1:39080/api/preview-mesh/http/preview-1/app?vmx_mesh_token=token',
  }), '')
  assert.equal(buildLocalWorkerPreviewMeshBridgeUrl({
    previewId: 'preview-1',
    routeUrl: 'http://8.8.8.8:39080/api/preview-mesh/http/preview-1/app?vmx_mesh_token=token',
  }), '')
})
