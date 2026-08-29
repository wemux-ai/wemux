import assert from 'node:assert/strict'
import test from 'node:test'

import { VibemuxClient } from './client'

test('VibemuxClient uses user token authentication when provided', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  let authorization = ''
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input)
    authorization = new Headers(init?.headers).get('Authorization') || ''
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'test', result: { tools: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await new VibemuxClient({ cloudUrl: 'https://example.com', apiToken: 'vbx-test' }).listTools()
    assert.equal(requestUrl, 'https://example.com/mcp')
    assert.equal(authorization, 'Bearer vbx-test')
  } finally {
    globalThis.fetch = originalFetch
  }
})
