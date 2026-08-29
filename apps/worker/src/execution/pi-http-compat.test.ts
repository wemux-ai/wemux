import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPiFetchWithOpenAiCompatibleHeaderSanitizer,
  sanitizePiOpenAiCompatibleHeaders,
} from './pi-http-compat'

test('sanitizePiOpenAiCompatibleHeaders removes OpenAI SDK telemetry headers for blocked gateways', () => {
  const headers = sanitizePiOpenAiCompatibleHeaders({
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
    'User-Agent': 'OpenAI/JS 6.26.0',
    'x-stainless-lang': 'js',
    'x-stainless-runtime': 'node',
  })

  assert.equal(headers.get('authorization'), 'Bearer test-key')
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(headers.get('x-stainless-lang'), null)
  assert.equal(headers.get('x-stainless-runtime'), null)
  assert.match(headers.get('user-agent') ?? '', /Mozilla\/5\.0/)
})

test('createPiFetchWithOpenAiCompatibleHeaderSanitizer only patches blackai requests', async () => {
  const captured: Array<{ url: string; headers: Headers }> = []
  const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
      headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
    })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const fetch = createPiFetchWithOpenAiCompatibleHeaderSanitizer(baseFetch)

  await fetch('https://blackaicoding.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-key',
      'x-stainless-lang': 'js',
      'User-Agent': 'OpenAI/JS 6.26.0',
    },
  })
  await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-key',
      'x-stainless-lang': 'js',
      'User-Agent': 'OpenAI/JS 6.26.0',
    },
  })

  assert.equal(captured[0]?.headers.get('x-stainless-lang'), null)
  assert.match(captured[0]?.headers.get('user-agent') ?? '', /Mozilla\/5\.0/)
  assert.equal(captured[1]?.headers.get('x-stainless-lang'), 'js')
  assert.equal(captured[1]?.headers.get('user-agent'), 'OpenAI/JS 6.26.0')
})
