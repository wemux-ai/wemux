import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const importConfigModule = async () => {
  return import(`./config.ts?test=${Date.now()}-${Math.random()}`)
}

const withWorkerEnv = async (
  env: NodeJS.ProcessEnv,
  run: () => Promise<void>,
) => {
  const previous = {
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV,
    VIBEMUX_CLOUD_URL: process.env.VIBEMUX_CLOUD_URL,
    VIBEMUX_WORKER_RELEASE_CHANNEL: process.env.VIBEMUX_WORKER_RELEASE_CHANNEL,
    VIBEMUX_WORKER_HOME: process.env.VIBEMUX_WORKER_HOME,
    VIBEMUX_HOME: process.env.VIBEMUX_HOME,
    WEMUX_HOME: process.env.WEMUX_HOME,
  }

  Object.assign(process.env, env)

  for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
    if (!env[key]) {
      delete process.env[key]
    }
  }

  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }

      process.env[key] = value
    }
  }
}

test('getWorkerHome uses ~/.wemux-dev for local development worker', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-dev-'))

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'http://127.0.0.1:8989',
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, '.wemux-dev'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('getWorkerHome keeps using an existing legacy ~/.vibemux-dev home', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-legacy-dev-'))
  const legacyHome = path.join(tempHome, '.vibemux-dev')
  mkdirSync(path.join(legacyHome, 'node'), { recursive: true })

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'http://127.0.0.1:8989',
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), legacyHome)
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('getWorkerHome uses ~/.wemux-preview for preview worker even during local development', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-preview-'))

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'https://wemux.xyz/',
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, '.wemux-preview'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('getWorkerHome uses ~/.wemux for production worker', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-production-'))

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'production',
      VIBEMUX_CLOUD_URL: 'https://wemux.ai/',
      VIBEMUX_WORKER_RELEASE_CHANNEL: 'production',
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, '.wemux'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('packaged production environment ignores an ambient preview cloud URL', async () => {
  const { resolveWorkerEnvironmentFromRuntime } = await importConfigModule()
  assert.equal(resolveWorkerEnvironmentFromRuntime({
    cloudUrl: 'https://wemux.xyz',
    releaseChannel: 'production',
    packagedReleaseChannel: 'production',
    nodeEnv: 'production',
  }), 'production')
})

test('getWorkerHome does not inherit another release channel default home', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-home-channel-isolation-'))

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'production',
      VIBEMUX_CLOUD_URL: 'https://wemux.ai/',
      VIBEMUX_WORKER_RELEASE_CHANNEL: 'production',
      VIBEMUX_WORKER_HOME: path.join(tempHome, '.vibemux-preview'),
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, '.wemux'))
    })

    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'production',
      VIBEMUX_CLOUD_URL: 'https://wemux.xyz/',
      VIBEMUX_WORKER_RELEASE_CHANNEL: 'preview',
      VIBEMUX_WORKER_HOME: path.join(tempHome, '.vibemux'),
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, '.wemux-preview'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('getWorkerHome expands an unexpanded ~ prefix in WEMUX_WORKER_HOME and WEMUX_HOME', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-home-tilde-'))

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_WORKER_HOME: '~/worker-data',
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, 'worker-data'))
    })

    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      WEMUX_HOME: '~/wemux-home',
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), path.join(tempHome, 'wemux-home', 'worker'))
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('getWorkerHome preserves an explicit custom home across release channels', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'vibemux-worker-home-custom-'))
  const customWorkerHome = path.join(tempHome, 'worker-data')

  try {
    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'production',
      VIBEMUX_CLOUD_URL: 'https://wemux.ai/',
      VIBEMUX_WORKER_RELEASE_CHANNEL: 'production',
      VIBEMUX_WORKER_HOME: customWorkerHome,
    }, async () => {
      const { getWorkerHome } = await importConfigModule()
      assert.equal(getWorkerHome(), customWorkerHome)
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('loadWorkerConfig rewrites obsolete workspaceRoot suffix inside the current worker home', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-normalize-root-'))
  const workerHome = path.join(tempHome, '.wemux-dev')

  try {
    const nodeDir = path.join(workerHome, 'node')
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(path.join(nodeDir, 'machine-id'), 'machine-id\n', 'utf8')
    writeFileSync(path.join(nodeDir, 'config.json'), `${JSON.stringify({
      machineId: 'machine-id',
      machineName: 'worker',
      workspaceRoot: path.join(workerHome, 'workspace'),
      maxConcurrency: 5,
      labels: [],
      capabilities: ['code-execution', 'git-operations'],
      localServerPort: 48121,
      projectBindings: [],
      agentSettings: {},
    }, null, 2)}\n`, 'utf8')

    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'http://127.0.0.1:8989',
    }, async () => {
      const { loadWorkerConfig } = await importConfigModule()
      const config = loadWorkerConfig()

      assert.equal(config.workspaceRoot, workerHome)
      assert.equal(
        JSON.parse(readFileSync(path.join(nodeDir, 'config.json'), 'utf8')).workspaceRoot,
        workerHome,
      )
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('loadWorkerConfig does not migrate legacy preview worker state into the current home', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-no-migrate-'))
  const legacyHome = path.join(tempHome, '.vibemux', 'worker-dev-preview')
  const targetHome = path.join(tempHome, '.wemux-preview')

  try {
    mkdirSync(path.join(legacyHome, 'workspace'), { recursive: true })
    writeFileSync(path.join(legacyHome, 'machine-id'), 'legacy-machine-id\n', 'utf8')
    writeFileSync(path.join(legacyHome, 'config.json'), `${JSON.stringify({
      cloudUrl: 'https://wemux.xyz/',
      machineId: 'legacy-machine-id',
      machineName: 'legacy-worker',
      workspaceRoot: path.join(legacyHome, 'workspace'),
      maxConcurrency: 5,
      labels: [],
      capabilities: ['code-execution', 'git-operations'],
      localServerPort: 48123,
      projectBindings: [],
      agentSettings: {},
    }, null, 2)}\n`, 'utf8')

    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'development',
      VIBEMUX_CLOUD_URL: 'https://wemux.xyz/',
    }, async () => {
      const { getWorkerHome, loadWorkerConfig } = await importConfigModule()
      const config = loadWorkerConfig()

      assert.equal(getWorkerHome(), targetHome)
      assert.equal(config.workspaceRoot, targetHome)
      assert.equal(config.machineId === 'legacy-machine-id', false)
      assert.equal(readFileSync(path.join(targetHome, 'node', 'machine-id'), 'utf8').trim(), config.machineId)
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('loadWorkerConfig keeps a remote preview cloudUrl instead of replacing it with the packaged default', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-remote-preview-'))
  const workerHome = path.join(tempHome, '.wemux-preview')

  try {
    const nodeDir = path.join(workerHome, 'node')
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(path.join(nodeDir, 'machine-id'), 'machine-id\n', 'utf8')
    writeFileSync(path.join(nodeDir, 'config.json'), `${JSON.stringify({
      cloudUrl: 'https://vibemux-vibemux-pr-52.up.railway.app',
      machineId: 'machine-id',
      machineName: 'worker',
      workspaceRoot: workerHome,
      maxConcurrency: 5,
      labels: [],
      capabilities: ['code-execution', 'git-operations'],
      localServerPort: 48123,
      projectBindings: [],
      agentSettings: {},
    }, null, 2)}\n`, 'utf8')

    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'production',
      VIBEMUX_WORKER_RELEASE_CHANNEL: 'preview',
    }, async () => {
      const { loadWorkerConfig } = await importConfigModule()
      const config = loadWorkerConfig()

      assert.equal(config.cloudUrl, 'https://vibemux-vibemux-pr-52.up.railway.app')
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test('loadWorkerConfig keeps paired local dev cloudUrl for preview worker', async () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-home-paired-local-preview-'))
  const workerHome = path.join(tempHome, '.wemux-preview')

  try {
    const nodeDir = path.join(workerHome, 'node')
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(path.join(nodeDir, 'machine-id'), 'machine-id\n', 'utf8')
    writeFileSync(path.join(nodeDir, 'config.json'), `${JSON.stringify({
      cloudUrl: 'http://127.0.0.1:18989',
      executorId: 'executor-local-dev',
      executorToken: 'executor-token-local-dev',
      machineId: 'machine-id',
      machineName: 'worker',
      workspaceRoot: workerHome,
      maxConcurrency: 5,
      labels: [],
      capabilities: ['code-execution', 'git-operations'],
      localServerPort: 48123,
      projectBindings: [],
      agentSettings: {},
    }, null, 2)}\n`, 'utf8')

    await withWorkerEnv({
      HOME: tempHome,
      NODE_ENV: 'production',
      VIBEMUX_WORKER_RELEASE_CHANNEL: 'preview',
    }, async () => {
      const { loadWorkerConfig } = await importConfigModule()
      const config = loadWorkerConfig()

      assert.equal(config.cloudUrl, 'http://127.0.0.1:18989')
    })
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})
