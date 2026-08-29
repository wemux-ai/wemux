import assert from 'node:assert/strict'
import test from 'node:test'
import { testModelProfileAvailability } from './model-profile-availability'

test('testModelProfileAvailability uses OpenAI-compatible chat completions endpoint', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  const result = await testModelProfileAvailability({
    providerId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiToken: 'test-key',
    compatibility: 'openai',
    modelIds: ['openai/gpt-5'],
    timeoutMs: 1000,
  }, {
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ id: 'chatcmpl_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(requestUrl, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(requestInit?.method, 'POST')
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer test-key')
  assert.equal(result.testedModelId, 'openai/gpt-5')
})

test('testModelProfileAvailability uses Anthropic messages endpoint', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  const result = await testModelProfileAvailability({
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiToken: 'anthropic-key',
    compatibility: 'anthropic',
    modelIds: ['claude-sonnet-4-20250514'],
    timeoutMs: 1000,
  }, {
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({ id: 'msg_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(requestUrl, 'https://api.anthropic.com/v1/messages')
  assert.equal((requestInit?.headers as Record<string, string>)['x-api-key'], 'anthropic-key')
  assert.equal((requestInit?.headers as Record<string, string>)['anthropic-version'], '2023-06-01')
  assert.equal(result.providerId, 'anthropic')
})

test('testModelProfileAvailability surfaces upstream API errors', async () => {
  await assert.rejects(
    () => testModelProfileAvailability({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiToken: 'bad-key',
      compatibility: 'openai',
      modelIds: ['gpt-5'],
      timeoutMs: 1000,
    }, {
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          message: 'Invalid API key',
        },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /Invalid API key/,
  )
})
