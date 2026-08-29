import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { inspectAgentCliRequirement } from './agent-cli-bootstrap'

const createTempDir = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix))

const writeExecutable = async (targetPath: string, source: string) => {
  await writeFile(targetPath, source, 'utf8')
  await chmod(targetPath, 0o755)
}

const writeCodexStub = async (binDir: string, scriptSource: string) => {
  await mkdir(binDir, { recursive: true })
  if (process.platform === 'win32') {
    // On Windows, resolveExecutable matches `codex.cmd` via PATHEXT. A bare
    // `codex` script would be skipped and the test could pick up the host's
    // real globally-installed Codex instead of this stub.
    const scriptPath = path.join(binDir, 'codex-stub.js')
    await writeFile(scriptPath, scriptSource, 'utf8')
    await writeFile(path.join(binDir, 'codex.cmd'), `@node "${scriptPath}" %*\r\n`, 'utf8')
    return
  }

  await writeExecutable(path.join(binDir, 'codex'), `#!/usr/bin/env node\n${scriptSource}`)
}

test('codex auth check uses managed worker credential env on fresh machines', async () => {
  const tempRoot = await createTempDir('vibemux-codex-auth-check-')
  const previousPath = process.env.PATH
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME
  const previousCapture = process.env.VIBEMUX_TEST_CAPTURE
  const previousCodexHome = process.env.CODEX_HOME

  try {
    const binDir = path.join(tempRoot, 'bin')
    const workerHome = path.join(tempRoot, 'worker-home')
    const workerNodeDir = path.join(workerHome, 'node')
    const capturePath = path.join(tempRoot, 'codex-auth-capture.json')
    await mkdir(workerNodeDir, { recursive: true })

    await writeCodexStub(binDir, `const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const capturePath = process.env.VIBEMUX_TEST_CAPTURE
const codexHome = process.env.CODEX_HOME || ''
fs.writeFileSync(capturePath, JSON.stringify({
  argv: process.argv.slice(2),
  codexHome,
  env: {
    CODEX_ACCESS_TOKEN: process.env.CODEX_ACCESS_TOKEN || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  },
}, null, 2))
const rl = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    respond(message.id, {})
    return
  }
  if (message.method === 'account/read') {
    const hasManagedAuth = process.env.CODEX_ACCESS_TOKEN === 'managed-codex-token'
    respond(message.id, {
      account: null,
      requiresOpenaiAuth: !hasManagedAuth,
    })
    return
  }
})`)

    await writeFile(path.join(workerNodeDir, 'config.json'), `${JSON.stringify({
      codexAuthContent: '{\n  "access_token": "managed-codex-token"\n}',
      codexConfigContent: '[profiles.default]\nmodel = "gpt-5.4"\n',
    }, null, 2)}\n`, 'utf8')

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_WORKER_HOME = workerHome
    process.env.VIBEMUX_TEST_CAPTURE = capturePath
    delete process.env.CODEX_HOME

    const result = await inspectAgentCliRequirement('codex-auth')

    assert.ok(result)
    assert.equal(result?.ok, true)
    assert.equal(result?.detail, 'Codex 登录状态正常。')

    const captured = JSON.parse(await readFile(capturePath, 'utf8')) as {
      argv: string[]
      codexHome: string
      env: Record<string, string>
    }

    assert.deepEqual(captured.argv, ['app-server'])
    assert.ok(captured.codexHome)
    assert.equal(captured.env.CODEX_ACCESS_TOKEN, 'managed-codex-token')
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }

    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    if (previousCapture === undefined) {
      delete process.env.VIBEMUX_TEST_CAPTURE
    } else {
      process.env.VIBEMUX_TEST_CAPTURE = previousCapture
    }

    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = previousCodexHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('codex auth check accepts managed provider env when Codex still requests OpenAI auth', async () => {
  const tempRoot = await createTempDir('vibemux-codex-provider-auth-check-')
  const previousPath = process.env.PATH
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME
  const previousCapture = process.env.VIBEMUX_TEST_CAPTURE
  const previousCodexHome = process.env.CODEX_HOME

  try {
    const binDir = path.join(tempRoot, 'bin')
    const workerHome = path.join(tempRoot, 'worker-home')
    const workerNodeDir = path.join(workerHome, 'node')
    const capturePath = path.join(tempRoot, 'codex-provider-auth-capture.json')
    await mkdir(workerNodeDir, { recursive: true })

    await writeCodexStub(binDir, `const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const capturePath = process.env.VIBEMUX_TEST_CAPTURE
const codexHome = process.env.CODEX_HOME || ''
fs.writeFileSync(capturePath, JSON.stringify({
  argv: process.argv.slice(2),
  codexHome,
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  },
  config: codexHome ? fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8') : '',
}, null, 2))
const rl = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    respond(message.id, {})
    return
  }
  if (message.method === 'account/read') {
    respond(message.id, {
      account: null,
      requiresOpenaiAuth: true,
    })
  }
})`)

    await writeFile(path.join(workerNodeDir, 'config.json'), `${JSON.stringify({
      codexAuthContent: '{\n  "OPENAI_API_KEY": "managed-provider-key"\n}',
      codexConfigContent: [
        'model = "gpt-5.4-mini"',
        'model_provider = "codexzh"',
        '',
        '[model_providers.codexzh]',
        'base_url = "https://api.codexzh.com/v1"',
        'env_key = "OPENAI_API_KEY"',
      ].join('\n'),
    }, null, 2)}\n`, 'utf8')

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_WORKER_HOME = workerHome
    process.env.VIBEMUX_TEST_CAPTURE = capturePath
    delete process.env.CODEX_HOME

    const result = await inspectAgentCliRequirement('codex-auth')

    assert.ok(result)
    assert.equal(result?.ok, true)
    assert.equal(result?.detail, 'Codex 已检测到运行时 provider 凭证。')

    const captured = JSON.parse(await readFile(capturePath, 'utf8')) as {
      argv: string[]
      codexHome: string
      env: Record<string, string>
      config: string
    }

    assert.deepEqual(captured.argv, ['app-server'])
    assert.ok(captured.codexHome)
    assert.equal(captured.env.OPENAI_API_KEY, 'managed-provider-key')
    assert.match(captured.config, /\[model_providers\.codexzh\]/)
    assert.match(captured.config, /name = "codexzh"/)
    assert.match(captured.config, /env_key = "OPENAI_API_KEY"/)
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = previousPath
    }

    if (previousWorkerHome === undefined) {
      delete process.env.VIBEMUX_WORKER_HOME
    } else {
      process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    }

    if (previousCapture === undefined) {
      delete process.env.VIBEMUX_TEST_CAPTURE
    } else {
      process.env.VIBEMUX_TEST_CAPTURE = previousCapture
    }

    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = previousCodexHome
    }

    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('codex auth check materializes managed ChatGPT OAuth credentials', async () => {
  const tempRoot = await createTempDir('vibemux-codex-oauth-auth-check-')
  const previousPath = process.env.PATH
  const previousWorkerHome = process.env.VIBEMUX_WORKER_HOME
  const previousCapture = process.env.VIBEMUX_TEST_CAPTURE
  const previousCodexHome = process.env.CODEX_HOME

  try {
    const binDir = path.join(tempRoot, 'bin')
    const workerHome = path.join(tempRoot, 'worker-home')
    const workerNodeDir = path.join(workerHome, 'node')
    const capturePath = path.join(tempRoot, 'codex-oauth-capture.json')
    await mkdir(workerNodeDir, { recursive: true })

    await writeCodexStub(binDir, `const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const capturePath = process.env.VIBEMUX_TEST_CAPTURE
const codexHome = process.env.CODEX_HOME || ''
const authPath = path.join(codexHome, 'auth.json')
const auth = fs.existsSync(authPath) ? JSON.parse(fs.readFileSync(authPath, 'utf8')) : null
fs.writeFileSync(capturePath, JSON.stringify({
  argv: process.argv.slice(2),
  codexHome,
  authMode: auth && auth.auth_mode,
  hasAccessToken: Boolean(auth && auth.tokens && auth.tokens.access_token),
  hasRefreshToken: Boolean(auth && auth.tokens && auth.tokens.refresh_token),
}, null, 2))
const rl = readline.createInterface({ input: process.stdin })
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    respond(message.id, {})
    return
  }
  if (message.method === 'account/read') {
    respond(message.id, {
      account: auth && auth.auth_mode === 'chatgpt' ? { type: 'chatgpt' } : null,
      requiresOpenaiAuth: true,
    })
  }
})`)

    await writeFile(path.join(workerNodeDir, 'config.json'), `${JSON.stringify({
      codexAuthContent: JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'account-id',
        },
        last_refresh: '2026-08-13T00:00:00.000Z',
      }),
      codexConfigContent: 'model = "gpt-5.6-terra"\n',
    }, null, 2)}\n`, 'utf8')

    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`
    process.env.VIBEMUX_WORKER_HOME = workerHome
    process.env.VIBEMUX_TEST_CAPTURE = capturePath
    delete process.env.CODEX_HOME

    const result = await inspectAgentCliRequirement('codex-auth')

    assert.ok(result)
    assert.equal(result?.ok, true)
    assert.equal(result?.detail, 'Codex 登录状态正常。')

    const captured = JSON.parse(await readFile(capturePath, 'utf8')) as {
      argv: string[]
      codexHome: string
      authMode: string
      hasAccessToken: boolean
      hasRefreshToken: boolean
    }
    assert.deepEqual(captured.argv, ['app-server'])
    assert.ok(captured.codexHome)
    assert.equal(captured.authMode, 'chatgpt')
    assert.equal(captured.hasAccessToken, true)
    assert.equal(captured.hasRefreshToken, true)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousWorkerHome === undefined) delete process.env.VIBEMUX_WORKER_HOME
    else process.env.VIBEMUX_WORKER_HOME = previousWorkerHome
    if (previousCapture === undefined) delete process.env.VIBEMUX_TEST_CAPTURE
    else process.env.VIBEMUX_TEST_CAPTURE = previousCapture
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodexHome
    await rm(tempRoot, { recursive: true, force: true })
  }
})
