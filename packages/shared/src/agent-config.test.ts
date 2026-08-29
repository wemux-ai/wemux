import assert from 'node:assert/strict'
import test from 'node:test'
import { listBundledAgentModels, normalizeAgentConfig, normalizeAgentSettings, normalizeManagedCloudConfig, normalizeWorkerUpdateSettings } from './agent-config'
import { coerceAgentType } from './agent-type'

test('normalizeWorkerUpdateSettings defaults to auto and preserves explicit choices', () => {
  assert.deepEqual(normalizeWorkerUpdateSettings(), { exitMode: 'auto' })
  assert.deepEqual(normalizeWorkerUpdateSettings({ exitMode: 'auto' }), { exitMode: 'auto' })
  assert.deepEqual(normalizeWorkerUpdateSettings({ exitMode: 'manual' }), { exitMode: 'manual' })
})

test('normalizeAgentConfig preserves valid workspace execution defaults', () => {
  const config = normalizeAgentConfig({
    workspaceExecutionDefaults: {
      executorNodeId: ' executor-1 ',
      agentType: 'Codex',
      executionModel: ' gpt-5.6-terra ',
    },
  })

  assert.deepEqual(config.workspaceExecutionDefaults, {
    executorNodeId: 'executor-1',
    agentType: 'Codex',
    executionModel: 'gpt-5.6-terra',
  })
})

test('normalizeAgentSettings migrates legacy CodexDesktop settings to Codex', () => {
  const settings = normalizeAgentSettings({
    CodexDesktop: {
      _runtime: 'Codex',
      defaultModel: 'gpt-5.6-terra',
      sandbox: 'danger-full-access',
      approval: 'never',
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
    },
  } as never)

  assert.equal(settings.Codex.defaultModel, 'gpt-5.6-terra')
  assert.equal(settings.Codex.sandbox, 'danger-full-access')
  assert.equal('CodexDesktop' in settings, false)
})

test('coerceAgentType maps legacy CodexDesktop tasks to Codex', () => {
  assert.equal(coerceAgentType('CodexDesktop'), 'Codex')
})

test('listBundledAgentModels exposes Claude Fable 5 to Claude Code', () => {
  const fable = listBundledAgentModels('ClaudeCode').find((model) => model.modelId === 'claude-fable-5')

  assert.deepEqual(fable, {
    id: 'anthropic/claude-fable-5',
    label: 'anthropic/claude-fable-5',
    providerId: 'anthropic',
    modelId: 'claude-fable-5',
    isDefault: false,
  })
})

test('normalizeManagedCloudConfig trims fields and filters invalid docker pool targets', () => {
  const config = normalizeManagedCloudConfig({
    runtimeProvider: 'docker-cli',
    allowLocalDocker: true,
    dockerImage: ' ghcr.io/vibemux/managed-worker:2026-05-09 ',
    dockerHost: ' ssh://docker-user@runtime-host ',
    dockerContext: ' ',
    dockerEgressMode: 'none',
    dockerNetwork: ' ',
    dockerCpus: ' 6 ',
    dockerMemory: ' 12g ',
    dockerWorkerHomeInContainer: ' /srv/vibemux-worker ',
    dockerPool: [
      {
        id: ' runtime-a ',
        name: ' Shanghai Runtime A ',
        enabled: false,
        egressMode: 'none',
        host: ' ssh://docker-user@runtime-a ',
        image: ' ghcr.io/vibemux/runtime-a:latest ',
        network: ' managed-a ',
        cpus: ' 8 ',
        memory: ' 16g ',
        workerHomeInContainer: ' /srv/runtime-a ',
      },
      {
        id: 'runtime-b',
        context: ' production-runtime-b ',
      },
      {
        id: '   ',
        host: 'ssh://docker-user@invalid',
      } as never,
      {
        host: 'ssh://docker-user@missing-id',
      } as never,
    ],
  })

  assert.equal(config.runtimeProvider, 'docker-cli')
  assert.equal(config.idleAutoStopMinutes, '30')
  assert.equal(config.allowLocalDocker, true)
  assert.equal(config.allowLocalControlPlaneRuntime, true)
  assert.equal(config.dockerImage, 'ghcr.io/vibemux/managed-worker:2026-05-09')
  assert.equal(config.dockerHost, 'ssh://docker-user@runtime-host')
  assert.equal(config.dockerContext, '')
  assert.equal(config.dockerEgressMode, 'none')
  assert.equal(config.dockerNetwork, 'bridge')
  assert.equal(config.dockerCpus, '6')
  assert.equal(config.dockerMemory, '12g')
  assert.equal(config.dockerWorkerHomeInContainer, '/srv/vibemux-worker')
  assert.deepEqual(config.dockerPool, [
    {
      id: 'runtime-a',
      name: 'Shanghai Runtime A',
      enabled: false,
      egressMode: 'none',
      host: 'ssh://docker-user@runtime-a',
      context: undefined,
      image: 'ghcr.io/vibemux/runtime-a:latest',
      network: 'managed-a',
      cpus: '8',
      memory: '16g',
      workerHomeInContainer: '/srv/runtime-a',
    },
    {
      id: 'runtime-b',
      name: undefined,
      enabled: true,
      egressMode: undefined,
      host: undefined,
      context: 'production-runtime-b',
      image: undefined,
      network: undefined,
      cpus: undefined,
      memory: undefined,
      workerHomeInContainer: undefined,
    },
  ])
  assert.equal(config.boxliteUrl, '')
  assert.equal(config.boxliteHome, '')
  assert.equal(config.boxliteImage, '')
  assert.equal(config.boxliteCpus, '2')
  assert.equal(config.boxliteMemory, '4096')
  assert.equal(config.boxliteWorkerHomeInContainer, '/var/lib/vibemux-worker')
  assert.deepEqual(config.boxlitePool, [])
})

test('normalizeManagedCloudConfig accepts boxlite provider and trims boxlite pool targets', () => {
  const config = normalizeManagedCloudConfig({
    runtimeProvider: 'boxlite-cli',
    allowLocalControlPlaneRuntime: true,
    boxliteUrl: ' http://runtime-a:8100 ',
    boxliteHome: ' /srv/boxlite ',
    boxliteImage: ' ghcr.io/vibemux/managed-worker:boxlite ',
    boxliteCpus: ' 4 ',
    boxliteMemory: ' 8192 ',
    boxliteWorkerHomeInContainer: ' /srv/vibemux-worker ',
    boxlitePool: [
      {
        id: ' boxlite-a ',
        name: ' BoxLite A ',
        enabled: false,
        egressMode: 'default',
        url: ' http://boxlite-a:8100 ',
        image: ' ghcr.io/vibemux/runtime-a:latest ',
        cpus: ' 8 ',
        memory: ' 16384 ',
        workerHomeInContainer: ' /srv/runtime-a ',
      },
      {
        id: 'boxlite-b',
        home: ' /srv/boxlite-b ',
      },
      {
        id: ' ',
        url: 'http://invalid:8100',
      } as never,
    ],
  })

  assert.equal(config.runtimeProvider, 'boxlite-cli')
  assert.equal(config.allowLocalDocker, true)
  assert.equal(config.allowLocalControlPlaneRuntime, true)
  assert.equal(config.boxliteUrl, 'http://runtime-a:8100')
  assert.equal(config.boxliteHome, '/srv/boxlite')
  assert.equal(config.boxliteImage, 'ghcr.io/vibemux/managed-worker:boxlite')
  assert.equal(config.boxliteCpus, '4')
  assert.equal(config.boxliteMemory, '8192')
  assert.equal(config.boxliteWorkerHomeInContainer, '/srv/vibemux-worker')
  assert.deepEqual(config.boxlitePool, [
    {
      id: 'boxlite-a',
      name: 'BoxLite A',
      enabled: false,
      egressMode: 'default',
      url: 'http://boxlite-a:8100',
      home: undefined,
      image: 'ghcr.io/vibemux/runtime-a:latest',
      cpus: '8',
      memory: '16384',
      workerHomeInContainer: '/srv/runtime-a',
    },
    {
      id: 'boxlite-b',
      name: undefined,
      enabled: true,
      egressMode: undefined,
      url: undefined,
      home: '/srv/boxlite-b',
      image: undefined,
      cpus: undefined,
      memory: undefined,
      workerHomeInContainer: undefined,
    },
  ])
})

test('normalizeManagedCloudConfig accepts ascii box provider alias', () => {
  const config = normalizeManagedCloudConfig({
    runtimeProvider: 'ascii-box-cli',
    boxliteUrl: ' https://box.ascii.dev/runtime ',
    boxliteImage: ' ghcr.io/vibemux/managed-worker:ascii-box ',
  })

  assert.equal(config.runtimeProvider, 'ascii-box-cli')
  assert.equal(config.boxliteUrl, 'https://box.ascii.dev/runtime')
  assert.equal(config.boxliteImage, 'ghcr.io/vibemux/managed-worker:ascii-box')
})

test('normalizeManagedCloudConfig accepts ascii box sdk provider settings', () => {
  const config = normalizeManagedCloudConfig({
    runtimeProvider: 'ascii-box-sdk',
    idleAutoStopMinutes: ' 45 ',
    asciiBoxApiKey: ' api-key ',
    asciiBoxBaseUrl: ' https://ascii.dev/api/box/v1 ',
    asciiBoxTtlSeconds: ' 3600 ',
    asciiBoxBootstrapCommand: ' pnpm start:worker ',
  })

  assert.equal(config.runtimeProvider, 'ascii-box-sdk')
  assert.equal(config.idleAutoStopMinutes, '45')
  assert.equal(config.asciiBoxApiKey, 'api-key')
  assert.equal(config.asciiBoxBaseUrl, 'https://ascii.dev/api/box/v1')
  assert.equal(config.asciiBoxTtlSeconds, '3600')
  assert.equal(config.asciiBoxBootstrapCommand, 'pnpm start:worker')
})
