import assert from 'node:assert/strict'
import test from 'node:test'
import { isExecutorTokenInvalidError } from './route-client'
import { requestJson, RequestJsonError } from './request-json'

test('requestJson preserves HTTP status for callers that need to classify auth failures', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'executor token 无效。' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    await assert.rejects(
      requestJson({
        url: 'http://127.0.0.1:18989/api/control-plane/executors/connection-route',
        errorMessage: 'route lookup failed',
      }),
      (error: unknown) => {
        assert.ok(error instanceof RequestJsonError)
        assert.equal(error.status, 401)
        assert.equal(error.message, 'executor token 无效。')
        assert.equal(isExecutorTokenInvalidError(error), true)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
