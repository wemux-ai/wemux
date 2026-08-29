import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canUseLocalDirectWorkerScope,
  isLoopbackUrl,
  probeLocalEnvironmentUrl,
  readLocalWorkerDiagnostics,
} from './workspace-local-direct'

test('isLoopbackUrl accepts localhost and loopback urls only', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:3000/health'), true)
  assert.equal(isLoopbackUrl('http://localhost:5173/'), true)
  assert.equal(isLoopbackUrl('https://preview.wemux.xyz/'), false)
})

test('canUseLocalDirectWorkerScope requires executor id match', () => {
  assert.equal(canUseLocalDirectWorkerScope({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-1',
  }), true)
  assert.equal(canUseLocalDirectWorkerScope({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: 'executor-2',
  }), false)
  assert.equal(canUseLocalDirectWorkerScope({
    workspaceExecutorId: 'executor-1',
    localWorkerExecutorId: undefined,
  }), false)
})

test('readLocalWorkerDiagnostics reads local worker runtime details', async () => {
  let requestCount = 0
  const result = await readLocalWorkerDiagnostics({
    fetchImpl: async (input) => {
      requestCount += 1
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input)
      if (url.includes('/api/status')) {
        return new Response(JSON.stringify({
          runtime: {
            executorId: 'executor-local',
            daemonMode: 'running',
            connected: true,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        summary: {
          total: 4,
          passed: 3,
          failed: 1,
          ok: false,
        },
        items: [
          { ok: true, label: 'Git' },
          { ok: false, label: 'Codex Sign-In' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.executorId, 'executor-local')
  assert.equal(result.daemonMode, 'running')
  assert.equal(result.connected, true)
  assert.equal(result.summary?.failed, 1)
  assert.equal(result.firstFailureLabel, 'Codex Sign-In')
  assert.equal(requestCount, 2)
})

test('probeLocalEnvironmentUrl probes readable local health urls', async () => {
  const result = await probeLocalEnvironmentUrl({
    url: 'http://127.0.0.1:3000/health',
    fetchImpl: async () => new Response('ok', { status: 200 }),
  })

  assert.equal(result?.status, 'ok')
  assert.equal(result?.httpStatus, 200)
  assert.equal(result?.readable, true)
})

test('probeLocalEnvironmentUrl ignores non-loopback urls', async () => {
  const result = await probeLocalEnvironmentUrl({
    url: 'https://preview.wemux.xyz/health',
    fetchImpl: async () => new Response('ok', { status: 200 }),
  })

  assert.equal(result, null)
})
