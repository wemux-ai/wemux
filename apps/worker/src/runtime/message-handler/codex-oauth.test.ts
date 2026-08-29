// [INPUT]: worker codex-oauth 消息处理器 + 隔离的临时 worker home。
// [OUTPUT]: WS 请求 → 本地 codex-oauth 函数 → WS 回包的正确性与错误路径覆盖。
// [POS]: 测试 message-handler/codex-oauth.ts 的分发与回包契约（网络层 fetch 打桩）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { ControlPlaneToExecutorMessage, ExecutorToControlPlaneMessage, WorkerConfig } from '@shared/types'
import { saveWorkerConfig } from '../../core/config'
import { handleCodexOauthMessage } from './codex-oauth'
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

const withTempWorkerHome = (fn: () => Promise<void>) => {
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME
  const workerHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-codex-oauth-'))
  process.env.VIBEMUX_WORKER_HOME = workerHome

  return Promise.resolve().then(async () => {
    try {
      await fn()
    } finally {
      if (previousWorkerHome === undefined) {
        delete process.env.VIBEMUX_WORKER_HOME
      } else {
        process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
      }
      rmSync(workerHome, { recursive: true, force: true })
    }
  })
}

const createHandler = (config: WorkerConfig) => {
  const sent: ExecutorToControlPlaneMessage[] = []
  const params: ControlPlaneMessageHandlerParams = {
    expectedSocket: {} as WebSocket,
    getConnection: () => null,
    getCurrentSocket: () => undefined,
    send: (message) => {
      sent.push(message)
      return true
    },
    requestShutdown: () => undefined,
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
    getConfig: () => config,
    setConfig: () => undefined,
    getQueuedTaskIds: () => [],
    setQueuedTaskIds: () => undefined,
    getRunningTaskIds: () => [],
    setRunningTaskIds: () => undefined,
    syncRuntimeState: () => undefined,
    drainExecutionQueue: () => undefined,
  }

  const request = (operation: string, overrides?: Record<string, unknown>) => {
    handleCodexOauthMessage({
      type: 'executor.codex-oauth.request',
      requestId: `req-${sent.length + 1}`,
      userId: 'user-1',
      operation,
      ...(overrides ?? {}),
      at: new Date().toISOString(),
    } as ControlPlaneToExecutorMessage, params)
  }

  const lastResponse = () => {
    const message = sent.at(-1)
    assert.ok(message && message.type === 'executor.codex-oauth.response')
    return message
  }

  return { params, request, lastResponse, sent }
}

const createDeviceCodeFetchStub = () => {
  const responses = new Map<string, { status: number, body: unknown }>()
  const setResponse = (url: string, status: number, body: unknown) => {
    responses.set(url, { status, body })
  }
  const stub = async (input: string | URL | Request) => {
    const url = String(input)
    const hit = responses.get(url)
    const match = [...responses.entries()].find(([key]) => key !== '' && url.includes(key))
    const selected = hit ?? match?.[1]
    const status = selected?.status ?? 404
    const body = selected?.body ?? {}
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }
  return { setResponse, stub }
}

const encodeJwtLike = (claims: Record<string, unknown>) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `header.${payload}.signature`
}

test('codex-oauth device.start 请求授权码成功后回包 pending 状态', async () => {
  await withTempWorkerHome(async () => {
    const config = createWorkerConfig()
    saveWorkerConfig(config)
    const { setResponse, stub } = createDeviceCodeFetchStub()
    setResponse('/api/accounts/deviceauth/usercode', 200, {
      device_auth_id: 'deviceauth_test',
      user_code: 'TEST-CODE',
      interval: '5',
    })
    setResponse('/api/accounts/deviceauth/token', 200, {
      authorization_code: 'auth-code-1',
      code_verifier: 'verifier-1',
    })
    setResponse('/oauth/token', 200, {
      id_token: encodeJwtLike({ email: 'test@example.com', chatgpt_plan_type: 'plus', chatgpt_user_id: 'u1', chatgpt_account_id: 'a1' }),
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = stub as unknown as typeof fetch
    try {
      const handler = createHandler(config)
      handler.request('device.start')

      // 等待后台轮询/交换完成后回包
      await new Promise((resolve) => setTimeout(resolve, 50))
      const response = handler.lastResponse()
      assert.equal(response.type, 'executor.codex-oauth.response')
      assert.equal(response.ok, true)
      assert.equal(response.operation, 'device.start')
      assert.equal(response.error, undefined)
      assert.equal(response.payload && typeof response.payload === 'object' && 'userCode' in response.payload, true)
      assert.equal((response.payload as { userCode: string }).userCode, 'TEST-CODE')
      assert.equal((response.payload as { verificationUri: string }).verificationUri, 'https://auth.openai.com/codex/device')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('codex-oauth 本地操作：status/dismiss/accounts/select/remove/export', async () => {
  await withTempWorkerHome(async () => {
    const config = createWorkerConfig()
    saveWorkerConfig(config)
    const handler = createHandler(config)

    handler.request('device.status')
    assert.deepEqual(handler.lastResponse().payload, { state: 'idle' })

    handler.request('device.dismiss')
    assert.deepEqual(handler.lastResponse().payload, { ok: true })

    handler.request('accounts.list')
    assert.deepEqual(handler.lastResponse().payload, { accounts: [], activeAccountId: null })

    handler.request('accounts.select', { accountId: 'missing' })
    assert.equal(handler.lastResponse().payload, null)

    handler.request('accounts.remove', { accountId: 'missing' })
    assert.equal(handler.lastResponse().payload, null)

    handler.request('export')
    assert.deepEqual(handler.lastResponse().payload, { authContent: null, account: null })
  })
})

test('codex-oauth 请求缺少 userId 时报错回包', async () => {
  await withTempWorkerHome(async () => {
    const config = createWorkerConfig()
    saveWorkerConfig(config)
    const handler = createHandler(config)

    handleCodexOauthMessage({
      type: 'executor.codex-oauth.request',
      requestId: 'req-no-user',
      userId: '   ',
      operation: 'accounts.list',
      at: new Date().toISOString(),
    }, handler.params)

    const response = handler.lastResponse()
    assert.equal(response.ok, false)
    assert.equal(response.error, 'userId is required')
  })
})

test('codex-oauth 非 codex 请求不拦截', async () => {
  const config = createWorkerConfig()
  const handler = createHandler(config)
  const handled = handleCodexOauthMessage({
    type: 'config.sync',
    at: new Date().toISOString(),
  } as unknown as ControlPlaneToExecutorMessage, handler.params)
  assert.equal(handled, false)
})
