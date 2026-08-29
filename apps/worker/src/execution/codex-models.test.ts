import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureCodexProviderEnvKeyInConfig,
  ensureCodexProviderNameInConfig,
  hasCodexAuthDotJsonContent,
  listCodexAvailableModels,
  parseCodexCredentialEnvironment,
  resolveCodexProviderConfig,
} from './codex-models'

test('recognizes official ChatGPT OAuth AuthDotJson without exposing metadata as env', () => {
  const authContent = JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    },
    last_refresh: '2026-08-13T00:00:00.000Z',
  })

  assert.equal(hasCodexAuthDotJsonContent(authContent), true)
  assert.deepEqual(parseCodexCredentialEnvironment(authContent), {})
  assert.equal(hasCodexAuthDotJsonContent(JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'access-token' },
  })), false)
})

test('parseCodexCredentialEnvironment maps legacy access_token into CODEX_ACCESS_TOKEN', () => {
  const parsed = parseCodexCredentialEnvironment(JSON.stringify({
    access_token: 'legacy-token',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
  }))

  assert.equal(parsed.CODEX_ACCESS_TOKEN, 'legacy-token')
  assert.equal(parsed.OPENAI_BASE_URL, 'https://api.openai.com/v1')
})

test('ensureCodexProviderNameInConfig adds missing provider name for custom providers', () => {
  const source = [
    'model = "gpt-5.4-mini"',
    'model_provider = "codexzh"',
    '',
    '[model_providers.codexzh]',
    'base_url = "https://api.codexzh.com/v1"',
    'env_key = "OPENAI_API_KEY"',
  ].join('\n')

  const rewritten = ensureCodexProviderNameInConfig(source, 'codexzh')

  assert.equal(rewritten.changed, true)
  assert.match(rewritten.content, /\[model_providers\.codexzh\]\nbase_url = "https:\/\/api\.codexzh\.com\/v1"\nenv_key = "OPENAI_API_KEY"\nname = "codexzh"/)
})

test('ensureCodexProviderEnvKeyInConfig adds missing provider env_key for custom providers', () => {
  const source = [
    'model = "gpt-5.4-mini"',
    'model_provider = "codexzh"',
    '',
    '[model_providers.codexzh]',
    'name = "codexzh"',
    'base_url = "https://api.codexzh.com/v1"',
  ].join('\n')

  const rewritten = ensureCodexProviderEnvKeyInConfig(source, 'codexzh', 'OPENAI_API_KEY')

  assert.equal(rewritten.changed, true)
  assert.match(rewritten.content, /\[model_providers\.codexzh\]\nname = "codexzh"\nbase_url = "https:\/\/api\.codexzh\.com\/v1"\nenv_key = "OPENAI_API_KEY"/)
})

test('resolveCodexProviderConfig reads configured provider section and auth token', () => {
  const parsed = resolveCodexProviderConfig({
    authContent: JSON.stringify({
      CODEXZH_API_KEY: 'provider-key',
    }),
    configContent: [
      'model = "gpt-5.4"',
      'model_provider = "codexzh"',
      '',
      '[model_providers.codexzh]',
      'base_url = "https://api.codexzh.example/v1"',
      'env_key = "CODEXZH_API_KEY"',
    ].join('\n'),
  })

  assert.equal(parsed.providerId, 'codexzh')
  assert.equal(parsed.baseUrl, 'https://api.codexzh.example/v1')
  assert.equal(parsed.apiToken, 'provider-key')
  assert.equal(parsed.configuredModel, 'gpt-5.4')
  assert.equal(parsed.envKey, 'CODEXZH_API_KEY')
})

test('listCodexAvailableModels loads provider models from the OpenAI-compatible models endpoint', async () => {
  let requestUrl = ''
  let requestInit: RequestInit | undefined

  const result = await listCodexAvailableModels({
    authContent: JSON.stringify({
      CODEXZH_API_KEY: 'provider-key',
    }),
    configContent: [
      'model = "gpt-5.4"',
      'model_provider = "codexzh"',
      '',
      '[model_providers.codexzh]',
      'base_url = "https://api.codexzh.example/v1"',
      'env_key = "CODEXZH_API_KEY"',
    ].join('\n'),
  }, {
    fetchImpl: async (input, init) => {
      requestUrl = String(input)
      requestInit = init
      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-5.5' },
          { id: 'gpt-5.4-mini' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.equal(requestUrl, 'https://api.codexzh.example/v1/models')
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer provider-key')
  assert.equal(result.defaultModel, 'gpt-5.4')
  assert.deepEqual(result.models.map((model) => model.modelId), ['gpt-5.4', 'gpt-5.5', 'gpt-5.4-mini'])
  assert.deepEqual(result.models.map((model) => model.id), ['codexzh/gpt-5.4', 'codexzh/gpt-5.5', 'codexzh/gpt-5.4-mini'])
  assert.equal(result.models[0]?.isDefault, true)
  assert.equal(result.models[1]?.providerId, 'codexzh')
})
