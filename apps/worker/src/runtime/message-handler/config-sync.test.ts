import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { ControlPlaneToExecutorMessage, WorkerConfig } from '@shared/types'
import { loadWorkerConfig, saveWorkerConfig } from '../../core/config'
import { updateWorkerRuntimeState } from '../../core/runtime-state'
import { handleConfigSyncMessage } from './config-sync'
import type { ControlPlaneMessageHandlerParams } from './types'

const createWorkerConfig = (): WorkerConfig => ({
  cloudUrl: 'https://wemux.xyz',
  machineId: 'machine-1',
  machineName: 'worker-test',
  executorName: 'worker-test',
  executorId: 'executor-1',
  executorToken: 'token-1',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot: '/tmp/vibemux-worker-test',
  maxConcurrency: 1,
  labels: [],
  capabilities: [],
  localServerPort: 4310,
})

const withTempWorkerHome = (fn: () => void) => {
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME
  const workerHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-config-sync-'))
  process.env.VIBEMUX_WORKER_HOME = workerHome

  try {
    fn()
  } finally {
    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }
    rmSync(workerHome, { recursive: true, force: true })
  }
}

const createHandlerParams = (config: WorkerConfig) => {
  let currentConfig = config
  const shutdownReasons: string[] = []
  const params: ControlPlaneMessageHandlerParams = {
    expectedSocket: {} as WebSocket,
    getConnection: () => null,
    getCurrentSocket: () => undefined,
    send: () => true,
    requestShutdown: (reason?: string) => {
      shutdownReasons.push(reason ?? '')
    },
    openTerminalSession: (() => {
      throw new Error('not implemented')
    }) as ControlPlaneMessageHandlerParams['openTerminalSession'],
    runTerminalCommand: (() => {
      throw new Error('not implemented')
    }) as ControlPlaneMessageHandlerParams['runTerminalCommand'],
    terminalSessions: ({
      list: () => [],
      get: () => undefined,
      upsert: () => undefined,
      remove: () => undefined,
      clear: () => undefined,
    } as unknown) as ControlPlaneMessageHandlerParams['terminalSessions'],
    assignedTasks: new Map(),
    activeExecutions: new Map(),
    getConfig: () => currentConfig,
    setConfig: (nextConfig) => {
      currentConfig = nextConfig
    },
    getQueuedTaskIds: () => [],
    setQueuedTaskIds: () => undefined,
    getRunningTaskIds: () => [],
    setRunningTaskIds: () => undefined,
    syncRuntimeState: () => undefined,
    drainExecutionQueue: () => undefined,
  }

  return {
    params,
    getCurrentConfig: () => currentConfig,
    shutdownReasons,
  }
}

test('executor.unpair can request local worker shutdown after clearing pairing', () => {
  withTempWorkerHome(() => {
    const initialConfig = createWorkerConfig()
    saveWorkerConfig(initialConfig)
    const { params, getCurrentConfig, shutdownReasons } = createHandlerParams(initialConfig)
    const message: ControlPlaneToExecutorMessage = {
      type: 'executor.unpair',
      reason: 'worker was deleted from the control plane',
      shutdown: true,
      at: new Date().toISOString(),
    }

    const handled = handleConfigSyncMessage(message, params)
    const persistedConfig = loadWorkerConfig()

    assert.equal(handled, true)
    assert.equal(getCurrentConfig().executorId, undefined)
    assert.equal(getCurrentConfig().executorToken, undefined)
    assert.equal(persistedConfig.executorId, undefined)
    assert.equal(persistedConfig.executorToken, undefined)
    assert.deepEqual(shutdownReasons, ['worker was deleted from the control plane'])
  })
})

test('control-plane.ready preserves the runtime-selected local server port', () => {
  withTempWorkerHome(() => {
    const persistedConfig = {
      ...createWorkerConfig(),
      localServerPort: 48100,
    }
    const runtimeConfig = {
      ...persistedConfig,
      localServerPort: 48121,
    }
    saveWorkerConfig(persistedConfig)
    updateWorkerRuntimeState({ config: runtimeConfig })
    const { params, getCurrentConfig } = createHandlerParams(runtimeConfig)
    const message: ControlPlaneToExecutorMessage = {
      type: 'control-plane.ready',
      executorId: 'executor-1',
      heartbeatIntervalMs: 15000,
      now: new Date().toISOString(),
      maxConcurrency: 5,
      meshEnrollment: {
        enabled: true,
        peers: [],
        ipv4: '',
        previewProxyPort: 39080,
        terminalProxyPort: 39080,
      },
    }

    const handled = handleConfigSyncMessage(message, params)

    assert.equal(handled, true)
    assert.equal(getCurrentConfig().localServerPort, 48121)
    assert.equal(loadWorkerConfig().localServerPort, 48121)
    updateWorkerRuntimeState({ config: undefined })
  })
})

test('control-plane.ready keeps worker-local opencode config when central config is empty', () => {
  withTempWorkerHome(() => {
    const localOpencodeConfig = '{"provider":{"codexzh":{"name":"codexzh"}}}'
    const persistedConfig = {
      ...createWorkerConfig(),
      opencodeConfigContent: localOpencodeConfig,
    }
    saveWorkerConfig(persistedConfig)
    const { params, getCurrentConfig } = createHandlerParams(persistedConfig)
    const message: ControlPlaneToExecutorMessage = {
      type: 'control-plane.ready',
      executorId: 'executor-1',
      heartbeatIntervalMs: 15000,
      now: new Date().toISOString(),
      // Central store has no opencode config -> server sends "" (not undefined).
      opencodeConfigContent: '',
      codexConfigContent: '',
      codexAuthContent: '',
      claudeCodeConfigContent: '',
      maxConcurrency: 5,
    }

    const handled = handleConfigSyncMessage(message, params)

    assert.equal(handled, true)
    assert.equal(getCurrentConfig().opencodeConfigContent, localOpencodeConfig)
    assert.equal(loadWorkerConfig().opencodeConfigContent, localOpencodeConfig)
    updateWorkerRuntimeState({ config: undefined })
  })
})

test('control-plane.ready overwrites worker-local opencode config when central config is non-empty', () => {
  withTempWorkerHome(() => {
    const persistedConfig = {
      ...createWorkerConfig(),
      opencodeConfigContent: '{"provider":{"local":{"name":"local"}}}',
    }
    saveWorkerConfig(persistedConfig)
    const { params, getCurrentConfig } = createHandlerParams(persistedConfig)
    const centralConfig = '{"provider":{"central":{"name":"central"}}}'
    const message: ControlPlaneToExecutorMessage = {
      type: 'control-plane.ready',
      executorId: 'executor-1',
      heartbeatIntervalMs: 15000,
      now: new Date().toISOString(),
      opencodeConfigContent: centralConfig,
      maxConcurrency: 5,
    }

    const handled = handleConfigSyncMessage(message, params)

    assert.equal(handled, true)
    assert.equal(getCurrentConfig().opencodeConfigContent, centralConfig)
    assert.equal(loadWorkerConfig().opencodeConfigContent, centralConfig)
    updateWorkerRuntimeState({ config: undefined })
  })
})

test('config.sync carries claudeCodeCredentialsContent to worker config', () => {
  withTempWorkerHome(() => {
    const persistedConfig = createWorkerConfig()
    saveWorkerConfig(persistedConfig)
    const { params, getCurrentConfig } = createHandlerParams(persistedConfig)
    const credentials = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-08-08T00:00:00.000Z',
        scopes: [],
        tokenType: 'Bearer',
      },
    })
    const message: ControlPlaneToExecutorMessage = {
      type: 'config.sync',
      opencodeConfigContent: '',
      codexConfigContent: '',
      codexAuthContent: '',
      claudeCodeConfigContent: '',
      claudeCodeCredentialsContent: credentials,
      maxConcurrency: 5,
      at: new Date().toISOString(),
    }

    const handled = handleConfigSyncMessage(message, params)

    assert.equal(handled, true)
    assert.equal(getCurrentConfig().claudeCodeCredentialsContent, credentials)
    assert.equal(loadWorkerConfig().claudeCodeCredentialsContent, credentials)
    updateWorkerRuntimeState({ config: undefined })
  })
})

test('control-plane.ready carries claudeCodeCredentialsContent on reconnect', () => {
  withTempWorkerHome(() => {
    const persistedConfig = createWorkerConfig()
    saveWorkerConfig(persistedConfig)
    const { params, getCurrentConfig } = createHandlerParams(persistedConfig)
    const credentials = JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'r' } })
    const message: ControlPlaneToExecutorMessage = {
      type: 'control-plane.ready',
      executorId: 'executor-1',
      heartbeatIntervalMs: 15000,
      now: new Date().toISOString(),
      opencodeConfigContent: '',
      codexConfigContent: '',
      codexAuthContent: '',
      claudeCodeConfigContent: '',
      claudeCodeCredentialsContent: credentials,
      maxConcurrency: 5,
    }

    const handled = handleConfigSyncMessage(message, params)

    assert.equal(handled, true)
    assert.equal(getCurrentConfig().claudeCodeCredentialsContent, credentials)
    assert.equal(loadWorkerConfig().claudeCodeCredentialsContent, credentials)
    updateWorkerRuntimeState({ config: undefined })
  })
})
