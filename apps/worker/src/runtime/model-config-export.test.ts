import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { PiAgentSettings, WorkerConfig } from '@shared/types'
import { resolveExportedModelBindings } from './model-config-export'

const createWorkerConfig = (overrides?: Partial<WorkerConfig>): WorkerConfig => ({
  cloudUrl: 'https://example.com',
  machineId: 'machine-1',
  machineName: 'worker-1',
  opencodeConfigContent: '',
  codexConfigContent: '',
  codexAuthContent: '',
  claudeCodeConfigContent: '',
  piAgentDir: '',
  defaultModel: '',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot: '/tmp/workspace',
  maxConcurrency: 1,
  labels: [],
  capabilities: [],
  localServerPort: 3000,
  ...overrides,
})

test('resolveExportedModelBindings ignores local Pi defaults when Vibemux has no Pi default model', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-pi-export-'))

  try {
    const localPiDir = path.join(root, 'pi-local')
    mkdirSync(localPiDir, { recursive: true })
    writeFileSync(path.join(localPiDir, 'settings.json'), `${JSON.stringify({
      defaultProvider: 'minimax-cn',
      defaultModel: 'M2.7-highspeed',
    }, null, 2)}\n`, 'utf8')

    const bindings = resolveExportedModelBindings({
      config: createWorkerConfig({
        piAgentDir: localPiDir,
      }),
      agentType: 'Pi',
      availableModels: [],
    })

    assert.deepEqual(bindings, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveExportedModelBindings uses Vibemux Pi default model without leaking local Pi directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibemux-pi-export-default-'))

  try {
    // 空的本地 Pi 目录：无 auth/registry，枚举不出模型，bindings 应只包含控制面配置的默认模型。
    const localPiDir = path.join(root, 'pi-local-empty')
    mkdirSync(localPiDir, { recursive: true })

    const bindings = resolveExportedModelBindings({
      config: createWorkerConfig({
        piAgentDir: localPiDir,
        agentSettings: normalizeAgentSettings({
          Pi: {
            _runtime: 'Pi' as const,
            defaultModel: 'openai/gpt-5',
            agentDir: '',
          },
        }),
      }),
      agentType: 'Pi',
      availableModels: [],
    })

    assert.equal(bindings.length, 1)
    assert.equal(bindings[0]?.providerId, 'openai')
    assert.equal(bindings[0]?.modelId, 'gpt-5')
    assert.equal(bindings[0]?.runtimeSettings?.defaultModel, 'openai/gpt-5')
    assert.equal((bindings[0]?.runtimeSettings as Partial<PiAgentSettings> | undefined)?.agentDir, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveExportedModelBindings expands discovered Codex provider models into runtime bindings', () => {
  const bindings = resolveExportedModelBindings({
    config: createWorkerConfig({
      codexAuthContent: JSON.stringify({
        CODEXZH_API_KEY: 'provider-key',
      }),
      codexConfigContent: [
        'model = "gpt-5.4"',
        'model_provider = "codexzh"',
        '',
        '[model_providers.codexzh]',
        'base_url = "https://api.codexzh.example/v1"',
        'env_key = "CODEXZH_API_KEY"',
      ].join('\n'),
    }),
    agentType: 'Codex',
    availableModels: [
      {
        id: 'gpt-5.4',
        label: 'codexzh/gpt-5.4',
        providerId: 'codexzh',
        modelId: 'gpt-5.4',
        isDefault: true,
      },
      {
        id: 'gpt-5.5',
        label: 'codexzh/gpt-5.5',
        providerId: 'codexzh',
        modelId: 'gpt-5.5',
        isDefault: false,
      },
    ],
  })

  assert.deepEqual(bindings.map((binding) => binding.modelId), ['gpt-5.4', 'gpt-5.5'])
  assert.equal(bindings[0]?.providerId, 'codexzh')
  assert.equal(bindings[0]?.baseUrl, 'https://api.codexzh.example/v1')
  assert.equal(bindings[0]?.apiToken, 'provider-key')
  assert.equal(bindings[1]?.runtimeSettings?.defaultModel, 'gpt-5.5')
})

test('resolveExportedModelBindings reads OpenCode provider secrets from options', () => {
  const bindings = resolveExportedModelBindings({
    config: createWorkerConfig({
      opencodeConfigContent: JSON.stringify({
        provider: {
          hs: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'https://ark.cn-beijing.volces.com/api/coding',
              apiKey: 'hs-test-key',
            },
            models: {
              'glm-5.2': {
                name: 'glm-5.2',
              },
            },
          },
        },
      }),
    }),
    agentType: 'OpenCode',
    availableModels: [
      {
        id: 'hs/glm-5.2',
        label: 'hs/glm-5.2',
        providerId: 'hs',
        modelId: 'glm-5.2',
      },
    ],
  })

  assert.equal(bindings.length, 1)
  assert.equal(bindings[0]?.providerId, 'hs')
  assert.equal(bindings[0]?.modelId, 'glm-5.2')
  assert.equal(bindings[0]?.baseUrl, 'https://ark.cn-beijing.volces.com/api/coding')
  assert.equal(bindings[0]?.apiToken, 'hs-test-key')
})
