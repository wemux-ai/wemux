import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeOpenCodeExecutionConfig, normalizeOpenCodeExecutionConfig } from './opencode-execution-config'

test('normalizeOpenCodeExecutionConfig keeps provider overlays', () => {
  const config = normalizeOpenCodeExecutionConfig({
    model: 'blackai/gpt-5.4',
    provider: {
      blackai: {
        models: {
          'gpt-5.4': {
            name: 'gpt-5.4',
          },
        },
        options: {
          baseURL: ' https://api.blackai.example/v1/ ',
          apiKey: ' blackai-key ',
        },
      },
    },
  })

  assert.deepEqual(config, {
    model: 'blackai/gpt-5.4',
    provider: {
      blackai: {
        models: {
          'gpt-5.4': {
            name: 'gpt-5.4',
          },
        },
        options: {
          baseURL: 'https://api.blackai.example/v1/',
          apiKey: 'blackai-key',
        },
      },
    },
  })
})

test('mergeOpenCodeExecutionConfig merges provider overlays by provider id', () => {
  const config = mergeOpenCodeExecutionConfig({
    provider: {
      openai: {
        models: {
          'gpt-5.1': {
            name: 'gpt-5.1',
          },
        },
      },
    },
  }, {
    provider: {
      blackai: {
        models: {
          'gpt-5.4': {
            name: 'gpt-5.4',
          },
        },
        options: {
          baseURL: 'https://api.blackai.example/v1',
        },
      },
    },
  })

  assert.deepEqual(config?.provider, {
    openai: {
      models: {
        'gpt-5.1': {
          name: 'gpt-5.1',
        },
      },
    },
    blackai: {
      models: {
        'gpt-5.4': {
          name: 'gpt-5.4',
        },
      },
      options: {
        baseURL: 'https://api.blackai.example/v1',
      },
    },
  })
})

test('normalizeOpenCodeExecutionConfig upgrades legacy provider model arrays', () => {
  const config = normalizeOpenCodeExecutionConfig({
    provider: {
      hs: {
        models: [{ id: 'glm-5.2' }],
      } as never,
    },
  })

  assert.deepEqual(config?.provider?.hs?.models, {
    'glm-5.2': {
      name: 'glm-5.2',
    },
  })
})
