import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeAgentSettings } from '@shared/agent-config'
import type { WorkerConfig } from '@shared/types'
import { runClaudeCodePrompt } from './claude-runner'
import { runCodexPrompt } from './codex-runner'
import { prepareWorkerAgentRuntime } from './runtime-context'

const createTempDir = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix))

const createWorkerConfig = (workspaceRoot: string): WorkerConfig => ({
  cloudUrl: 'http://127.0.0.1:8989',
  machineId: 'test-machine',
  machineName: 'Test Machine',
  agentSettings: normalizeAgentSettings(),
  workspaceRoot,
  maxConcurrency: 1,
  labels: [],
  capabilities: ['code-execution'],
  localServerPort: 48100,
  mcpServers: [],
  opencodeConfigContent: '',
  codexConfigContent: '',
  codexAuthContent: '',
  claudeCodeConfigContent: '',
  piAgentDir: path.join(workspaceRoot, '.pi-agent'),
  defaultModel: '',
  projectBindings: [],
})

const writeExecutable = async (targetPath: string, source: string) => {
  await writeFile(targetPath, source, 'utf8')
  await chmod(targetPath, 0o755)
}

const readJson = async <T>(targetPath: string) => {
  return JSON.parse(await readFile(targetPath, 'utf8')) as T
}

test('runCodexPrompt launches codex with isolated config home and runtime provider env', async () => {
  const tempRoot = await createTempDir('vibemux-codex-launch-')
  const previousPath = process.env.PATH
  const previousCapture = process.env.VIBEMUX_TEST_CAPTURE

  try {
    const cwd = path.join(tempRoot, 'cwd')
    const binDir = path.join(tempRoot, 'bin')
    const capturePath = path.join(tempRoot, 'codex-capture.json')
    await mkdir(cwd, { recursive: true })
    await mkdir(binDir, { recursive: true })

    await writeExecutable(path.join(binDir, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const capturePath = process.env.VIBEMUX_TEST_CAPTURE
const codexHome = process.env.CODEX_HOME || ''
const capture = {
  argv: process.argv.slice(2),
  requests: [],
  env: {
    CODEX_HOME: process.env.CODEX_HOME || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '',
  },
  config: codexHome ? fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8') : '',
  authExists: codexHome ? fs.existsSync(path.join(codexHome, 'auth.json')) : false,
}
fs.writeFileSync(capturePath, JSON.stringify(capture, null, 2))
const rl = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
const notify = (method, params) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  capture.requests.push({ method: message.method, params: message.params || null })
  fs.writeFileSync(capturePath, JSON.stringify(capture, null, 2))
  if (message.method === 'initialize') {
    respond(message.id, {})
    return
  }
  if (message.method === 'account/read') {
    respond(message.id, { account: { id: 'acct-1' }, requiresOpenaiAuth: false })
    return
  }
  if (message.method === 'thread/start') {
    respond(message.id, { thread: { id: 'thread-1' }, model: 'gpt-5.4' })
    return
  }
  if (message.method === 'turn/start') {
    respond(message.id, {})
    notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } })
    notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'assistant-1', delta: 'codex smoke ok' })
    notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } })
    setTimeout(() => process.exit(0), 25)
  }
})`)

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_TEST_CAPTURE = capturePath

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        agentSettings: normalizeAgentSettings({
          Codex: {
            ...normalizeAgentSettings().Codex,
            defaultModel: 'openai/gpt-5.4',
          },
        }),
        codexConfigContent: 'model = "gpt-5.4"\nmodel_provider = "openai"\n',
        codexAuthContent: '{\n  "OPENAI_API_KEY": "codex-provider-token"\n}\n',
      },
    })

    try {
      const result = await runCodexPrompt({
        agentType: 'Codex',
        cwd,
        title: 'Codex Smoke',
        prompt: 'hello from smoke test',
        runtimeEnv: {
          ...runtime.runtimeEnv,
          OPENAI_API_KEY: 'runtime-openai-key',
          OPENAI_BASE_URL: 'https://provider.example/v1',
        },
        runtimeArgs: runtime.runtimeArgs,
        agentSettings: {
          ...normalizeAgentSettings().Codex,
          defaultModel: 'openai/gpt-5.4',
        },
      })

      assert.equal(result.output, 'codex smoke ok')

      const captured = await readJson<{
        argv: string[]
        requests: Array<{ method: string; params: Record<string, unknown> | null }>
        env: Record<string, string>
        config: string
        authExists: boolean
      }>(capturePath)

      assert.deepEqual(captured.argv, ['app-server'])
      assert.ok(captured.env.CODEX_HOME)
      assert.equal(captured.env.OPENAI_API_KEY, 'runtime-openai-key')
      assert.equal(captured.env.OPENAI_BASE_URL, 'https://provider.example/v1')
      assert.match(captured.config, /model = "gpt-5\.4"/)
      assert.match(captured.config, /model_provider = "openai"/)
      assert.match(captured.config, /\[model_providers\.openai\]/)
      assert.match(captured.config, /base_url = "http:\/\/127\.0\.0\.1:\d+\/v1"/)
      assert.match(captured.config, /env_key = "OPENAI_API_KEY"/)
      assert.match(captured.config, /\[projects\.".*cwd"\]/)
      assert.equal(captured.authExists, false)
      const threadStartIndex = captured.requests.findIndex((request) => request.method === 'thread/start')
      const turnStartIndex = captured.requests.findIndex((request) => request.method === 'turn/start')
      assert.ok(threadStartIndex >= 0)
      assert.ok(
        threadStartIndex < turnStartIndex,
      )
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }

    if (previousCapture === undefined) {
      delete process.env.VIBEMUX_TEST_CAPTURE
    } else {
      process.env.VIBEMUX_TEST_CAPTURE = previousCapture
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})


test('runCodexPrompt continues when account/read requires OpenAI auth but provider env is present', async () => {
  const tempRoot = await createTempDir('vibemux-codex-launch-provider-auth-')
  const previousPath = process.env.PATH
  const previousCapture = process.env.VIBEMUX_TEST_CAPTURE

  try {
    const cwd = path.join(tempRoot, 'cwd')
    const binDir = path.join(tempRoot, 'bin')
    const capturePath = path.join(tempRoot, 'codex-provider-auth-capture.json')
    await mkdir(cwd, { recursive: true })
    await mkdir(binDir, { recursive: true })

    await writeExecutable(path.join(binDir, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const capturePath = process.env.VIBEMUX_TEST_CAPTURE
const codexHome = process.env.CODEX_HOME || ''
const capture = {
  argv: process.argv.slice(2),
  env: {
    CODEX_HOME: process.env.CODEX_HOME || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  },
  config: codexHome ? fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8') : '',
}
fs.writeFileSync(capturePath, JSON.stringify(capture, null, 2))
const rl = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
const notify = (method, params) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    respond(message.id, {})
    return
  }
  if (message.method === 'account/read') {
    respond(message.id, { account: null, requiresOpenaiAuth: true })
    return
  }
  if (message.method === 'thread/start') {
    respond(message.id, { thread: { id: 'thread-2' }, model: 'gpt-5.4-mini' })
    return
  }
  if (message.method === 'turn/start') {
    respond(message.id, {})
    notify('turn/started', { threadId: 'thread-2', turn: { id: 'turn-2' } })
    notify('item/agentMessage/delta', { threadId: 'thread-2', turnId: 'turn-2', itemId: 'assistant-2', delta: 'provider auth ok' })
    notify('turn/completed', { threadId: 'thread-2', turn: { id: 'turn-2', status: 'completed' } })
    setTimeout(() => process.exit(0), 25)
  }
})`)

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_TEST_CAPTURE = capturePath

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'Codex',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        codexConfigContent: [
          'model = "gpt-5.4"',
          'model_provider = "codexzh"',
          '',
          '[model_providers.codexzh]',
          'base_url = "https://api.codexzh.example/v1"',
        ].join('\n'),
        codexAuthContent: '{\n  "OPENAI_API_KEY": "codex-provider-token"\n}\n',
      },
    })

    try {
      const result = await runCodexPrompt({
        agentType: 'Codex',
        cwd,
        title: 'Codex Provider Auth Smoke',
        prompt: 'hello from provider auth smoke test',
        executionModel: 'codexzh/gpt-5.4-mini',
        runtimeEnv: {
          ...runtime.runtimeEnv,
          OPENAI_API_KEY: 'runtime-openai-key',
        },
        runtimeArgs: runtime.runtimeArgs,
      })

      assert.equal(result.output, 'provider auth ok')

      const captured = await readJson<{
        env: Record<string, string>
        config: string
      }>(capturePath)

      assert.equal(captured.env.OPENAI_API_KEY, 'runtime-openai-key')
      assert.match(captured.config, /env_key = "OPENAI_API_KEY"/)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }

    if (previousCapture === undefined) {
      delete process.env.VIBEMUX_TEST_CAPTURE
    } else {
      process.env.VIBEMUX_TEST_CAPTURE = previousCapture
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runCodexPrompt fails fast when codex startup rpc stops responding', async () => {
  const tempRoot = await createTempDir('vibemux-codex-startup-timeout-')
  const previousPath = process.env.PATH
  const previousTimeout = process.env.VIBEMUX_CODEX_STARTUP_RPC_TIMEOUT_MS

  try {
    const cwd = path.join(tempRoot, 'cwd')
    const binDir = path.join(tempRoot, 'bin')
    await mkdir(cwd, { recursive: true })
    await mkdir(binDir, { recursive: true })

    await writeExecutable(path.join(binDir, 'codex'), `#!/usr/bin/env node
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    respond(message.id, {})
    return
  }
  if (message.method === 'account/read') {
    respond(message.id, { account: { id: 'acct-timeout' }, requiresOpenaiAuth: false })
    return
  }
  if (message.method === 'thread/start') {
    return
  }
})`)

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_CODEX_STARTUP_RPC_TIMEOUT_MS = '2000'

    await assert.rejects(
      runCodexPrompt({
        agentType: 'Codex',
        cwd,
        title: 'Codex Startup Timeout',
        prompt: 'hello from timeout test',
        runtimeEnv: {},
      }),
      /Codex 启动超时：thread\/start 在 2000ms 内没有响应/,
    )
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }

    if (previousTimeout === undefined) {
      delete process.env.VIBEMUX_CODEX_STARTUP_RPC_TIMEOUT_MS
    } else {
      process.env.VIBEMUX_CODEX_STARTUP_RPC_TIMEOUT_MS = previousTimeout
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('runClaudeCodePrompt launches claude with isolated home, runtime args, and provider env', async () => {
  const tempRoot = await createTempDir('vibemux-claude-launch-')
  const previousPath = process.env.PATH
  const previousCapture = process.env.VIBEMUX_TEST_CAPTURE

  try {
    const cwd = path.join(tempRoot, 'cwd')
    const binDir = path.join(tempRoot, 'bin')
    const capturePath = path.join(tempRoot, 'claude-capture.json')
    await mkdir(cwd, { recursive: true })
    await mkdir(binDir, { recursive: true })

    await writeExecutable(path.join(binDir, 'claude'), `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const capturePath = process.env.VIBEMUX_TEST_CAPTURE
const claudeHome = process.env.CLAUDE_HOME || ''
const mcpIndex = process.argv.indexOf('--mcp-config')
const mcpConfigPath = mcpIndex >= 0 ? process.argv[mcpIndex + 1] : ''
const capture = {
  argv: process.argv.slice(2),
  env: {
    CLAUDE_HOME: process.env.CLAUDE_HOME || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '',
  },
  settings: claudeHome ? fs.readFileSync(path.join(claudeHome, 'settings.json'), 'utf8') : '',
  mcpConfig: mcpConfigPath ? fs.readFileSync(mcpConfigPath, 'utf8') : '',
}
fs.writeFileSync(capturePath, JSON.stringify(capture, null, 2))
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type === 'control_request' && message.request?.subtype === 'initialize') {
    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-1' }) + '\\n')
    return
  }
  if (message.type === 'user') {
    process.stdout.write(JSON.stringify({
      type: 'assistant',
      session_id: 'claude-session-1',
      message: {
        id: 'assistant-1',
        content: [{ type: 'text', text: 'claude smoke ok' }],
      },
    }) + '\\n')
    process.stdout.write(JSON.stringify({
      type: 'result',
      session_id: 'claude-session-1',
      result: 'claude smoke ok',
      is_error: false,
    }) + '\\n')
    setTimeout(() => process.exit(0), 25)
  }
})`)

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_TEST_CAPTURE = capturePath

    const runtime = prepareWorkerAgentRuntime({
      agentType: 'ClaudeCode',
      cwd,
      actingUserId: 'user-a',
      workerConfig: {
        ...createWorkerConfig(path.join(tempRoot, 'workspace')),
        claudeCodeConfigContent: JSON.stringify({
          env: {
            ANTHROPIC_API_KEY: 'managed-claude-key',
            ANTHROPIC_BASE_URL: 'https://managed.example/v1',
          },
        }, null, 2),
      },
    })

    try {
      const result = await runClaudeCodePrompt({
        agentType: 'ClaudeCode',
        cwd,
        title: 'Claude Smoke',
        prompt: 'hello from smoke test',
        executionModel: 'anthropic/claude-sonnet-4-20250514',
        runtimeEnv: {
          ...runtime.runtimeEnv,
          ANTHROPIC_API_KEY: 'runtime-claude-key',
          ANTHROPIC_BASE_URL: 'https://runtime.example/v1',
        },
        runtimeArgs: runtime.runtimeArgs,
      })

      assert.equal(result.output, 'claude smoke ok')

      const captured = await readJson<{
        argv: string[]
        env: Record<string, string>
        settings: string
        mcpConfig: string
      }>(capturePath)

      assert.ok(captured.argv.includes('-p'))
      assert.ok(captured.argv.includes('--permission-mode'))
      assert.ok(captured.argv.includes('--mcp-config'))
      assert.ok(captured.argv.includes('--model'))
      assert.ok(captured.argv.includes('claude-sonnet-4-20250514'))
      assert.ok(captured.env.CLAUDE_HOME)
      assert.equal(captured.env.ANTHROPIC_API_KEY, 'runtime-claude-key')
      assert.equal(captured.env.ANTHROPIC_BASE_URL, 'https://runtime.example/v1')
      assert.match(captured.settings, /managed-claude-key/)
      assert.match(captured.mcpConfig, /mcpServers/)
    } finally {
      runtime.cleanup()
    }
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }

    if (previousCapture === undefined) {
      delete process.env.VIBEMUX_TEST_CAPTURE
    } else {
      process.env.VIBEMUX_TEST_CAPTURE = previousCapture
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})
