import assert from 'node:assert/strict'
import test from 'node:test'
import { getLiveWorkerStatus } from './status'

const config = {
  cloudUrl: 'https://wemux.ai',
  executorId: 'executor-expected',
  localServerPort: 49000,
}

test('getLiveWorkerStatus reads runtime state from the matching local daemon', async () => {
  const requests: string[] = []
  const status = await getLiveWorkerStatus(config, {
    portEnvironment: 'production',
    fetchImpl: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url === 'http://127.0.0.1:49000/api/local-access/identity') {
        return Response.json({ executorId: 'executor-expected' })
      }
      if (url === 'http://127.0.0.1:49000/api/status') {
        return Response.json({
          runtime: {
            daemonMode: 'running',
            paired: true,
            connected: true,
            runningTaskIds: ['task-1'],
            queuedTaskIds: [],
          },
        })
      }
      return new Response(null, { status: 404 })
    },
  })

  assert.equal(status.reachable, true)
  assert.equal(status.url, 'http://127.0.0.1:49000')
  assert.equal(status.runtime?.connected, true)
  assert.deepEqual(status.runtime?.runningTaskIds, ['task-1'])
  assert.ok(requests.includes('http://127.0.0.1:49000/api/status'))
})

test('getLiveWorkerStatus refuses a daemon owned by another executor', async () => {
  const requests: string[] = []
  const status = await getLiveWorkerStatus(config, {
    portEnvironment: 'production',
    fetchImpl: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url === 'http://127.0.0.1:49000/api/local-access/identity') {
        return Response.json({ executorId: 'executor-other' })
      }
      if (url === 'http://127.0.0.1:49000/api/status') {
        throw new Error('the status endpoint must not be queried for another executor')
      }
      return new Response(null, { status: 404 })
    },
  })

  assert.equal(status.reachable, false)
  assert.equal(status.executorId, 'executor-other')
  assert.match(status.message, /does not match/)
  assert.ok(!requests.includes('http://127.0.0.1:49000/api/status'))
})
