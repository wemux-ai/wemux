import './lib/env-bridge.mjs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { getEnv } from '@shared/env'

const rootDir = process.cwd()
const args = process.argv.slice(2)

const readArg = (name, fallback = '') => {
  const index = args.indexOf(name)
  if (index === -1) {
    return fallback
  }

  return args[index + 1] || fallback
}

const defaultServerUrl = getEnv('WEMUX_CLOUD_URL')?.trim() || 'http://host.docker.internal:18989'
const defaultWorkerPort = '48111'
const npmRegistry = process.env.NPM_REGISTRY?.trim() || ''
const serverUrl = readArg('--server-url', defaultServerUrl)
const pairingCode = readArg('--pairing-code', getEnv('WEMUX_PAIRING_CODE')?.trim() || '')
const workerName = readArg('--name', getEnv('WEMUX_WORKER_NAME')?.trim() || '')
const containerName = readArg('--container-name', '')
const hasFlag = (name) => args.includes(name)

const normalizePort = (value) => {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid worker port: ${value}`)
  }

  return String(port)
}

const workerPort = normalizePort(readArg('--worker-port', getEnv('WEMUX_WORKER_PORT')?.trim() || defaultWorkerPort))
const workspaceKey = createHash('sha1').update(rootDir).digest('hex').slice(0, 10)
const imageTag = `wemux-worker-dev-deps-${workspaceKey}:local`
const nodeModulesVolume = `wemux-worker-dev-node-modules-${workspaceKey}`
const pnpmStoreVolume = `wemux-worker-dev-pnpm-store-${workspaceKey}`
const workerHomeVolume = `wemux-worker-dev-home-${workspaceKey}-${workerPort}`

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? rootDir,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: options.env ?? process.env,
  })

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim()
    throw new Error(detail || `${command} ${commandArgs.join(' ')} failed`)
  }

  return result
}

const assertDockerAvailable = () => {
  run('docker', ['version', '--format', '{{.Server.Version}}'])
}

const buildDepsImage = () => {
  console.log(`[worker:docker:dev] building deps image: ${imageTag}`)
  console.log('[worker:docker:dev] first build can take a few minutes while Docker installs dependencies.')

  const dockerArgs = [
    'build',
    '-f', 'deploy/docker/Dockerfile.control-plane',
    '--target', 'worker-dev-deps',
    '-t', imageTag,
  ]

  if (npmRegistry) {
    dockerArgs.push('--build-arg', `NPM_REGISTRY=${npmRegistry}`)
  }

  dockerArgs.push('.')
  run('docker', dockerArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      BUILDKIT_PROGRESS: process.env.BUILDKIT_PROGRESS || 'plain',
    },
  })
}

const main = async () => {
  const localConsoleUrl = `http://127.0.0.1:${workerPort}`

  console.log('[worker:docker:dev] checking Docker daemon...')
  console.log(`[worker:docker:dev] control plane: ${serverUrl}`)
  console.log(`[worker:docker:dev] local console: ${localConsoleUrl}`)
  if (workerName) {
    console.log(`[worker:docker:dev] worker name: ${workerName}`)
  }
  if (pairingCode) {
    console.log('[worker:docker:dev] pairing: enabled by --pairing-code')
  }
  console.log(`[worker:docker:dev] health: ${localConsoleUrl}/health`)
  console.log(`[worker:docker:dev] deps image: ${imageTag}`)
  console.log(`[worker:docker:dev] node_modules volume: ${nodeModulesVolume}`)
  console.log('[worker:docker:dev] wait for the worker to print its local console line before opening the browser.')

  assertDockerAvailable()
  buildDepsImage()

  const dockerArgs = [
    'run',
    '--rm',
    '-i',
  ]

  if (containerName) {
    dockerArgs.push('--name', containerName)
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    dockerArgs.push('-t')
  }

  console.log('[worker:docker:dev] starting worker container...')
  console.log('[worker:docker:dev] wait for the worker to print its local console line before opening the browser.')

  const startWorkerCommand = pairingCode
    ? [
      'exec pnpm exec tsx watch apps/worker/src/index.ts connect',
      '--pairing-code "$WEMUX_PAIRING_CODE"',
      '--server-url "$WEMUX_CLOUD_URL"',
      workerName ? '--name "$WEMUX_WORKER_NAME"' : '',
    ].filter(Boolean).join(' ')
    : 'exec pnpm exec tsx watch apps/worker/src/index.ts daemon'

  const containerCommand = [
    'set -euo pipefail',
    'node scripts/dev-ensure-deps.mjs /app',
    'pnpm build:worker:console',
    startWorkerCommand,
  ].join('\n')

  dockerArgs.push(
    '--add-host', 'host.docker.internal:host-gateway',
    '--cap-add', 'NET_ADMIN',
    '--device', '/dev/net/tun',
    '-e', 'NODE_ENV=development',
    '-e', `WEMUX_CLOUD_URL=${serverUrl}`,
    '-e', 'DOTENV_CONFIG_PATH=.env.development.local',
    '-e', 'WEMUX_WORKER_HOST=0.0.0.0',
    '-e', `WEMUX_WORKER_PORT=${workerPort}`,
    '-e', 'WEMUX_WORKER_HOME=/data/wemux-worker',
    '-e', 'WEMUX_WORKER_AUTO_INSTALL=true',
    '-e', 'WEMUX_WORKER_AUTO_UPDATE=1',
    '-e', 'WEMUX_WORKER_RESTART_STRATEGY=docker',
    '-e', `WEMUX_EASYTIER_VERSION=${getEnv('WEMUX_EASYTIER_VERSION')?.trim() || 'v2.6.4'}`,
    '-e', `WEMUX_EASYTIER_DOWNLOAD_BASE_URL=${getEnv('WEMUX_EASYTIER_DOWNLOAD_BASE_URL')?.trim() || 'https://github.com/EasyTier/EasyTier/releases/download'}`,
    '-v', `${rootDir}:/app`,
    '-v', `${nodeModulesVolume}:/app/node_modules`,
    '-v', `${pnpmStoreVolume}:/pnpm/store`,
    '-v', `${workerHomeVolume}:/data/wemux-worker`,
    '-w', '/app',
    imageTag,
    'bash',
    '-lc',
    containerCommand,
  )

  if (!hasFlag('--no-publish')) {
    dockerArgs.splice(dockerArgs.indexOf('-e'), 0, '-p', `${workerPort}:${workerPort}`)
  }

  for (const envName of [
    'WEMUX_MESH_ENABLED',
    'WEMUX_EASYTIER_NETWORK_NAME',
    'WEMUX_EASYTIER_NETWORK_PREFIX',
    'WEMUX_EASYTIER_NETWORK_SECRET',
    'WEMUX_EASYTIER_PEERS',
    'WEMUX_EASYTIER_IPV4_PREFIX',
    'WEMUX_EASYTIER_PREVIEW_PROXY_PORT',
    'WEMUX_EASYTIER_TERMINAL_PROXY_PORT',
    'WEMUX_EASYTIER_AUTO_DOWNLOAD',
  ]) {
    const value = process.env[envName]?.trim()
    if (value) {
      dockerArgs.splice(dockerArgs.indexOf('-v'), 0, '-e', `${envName}=${value}`)
    }
  }

  if (pairingCode) {
    dockerArgs.splice(dockerArgs.indexOf('-v'), 0, '-e', `WEMUX_PAIRING_CODE=${pairingCode}`)
  }

  if (workerName) {
    dockerArgs.splice(dockerArgs.indexOf('-v'), 0, '-e', `WEMUX_WORKER_NAME=${workerName}`)
  }

  run('docker', dockerArgs, {
    stdio: 'inherit',
  })
}

main().catch((error) => {
  console.error(`[worker:docker:dev] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
