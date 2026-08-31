import './lib/env-bridge.mjs'
import { existsSync } from 'node:fs'
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

const hasFlag = (name) => args.includes(name)

const readChannel = () => {
  const value = readArg('--channel', 'production').trim()
  if (value === 'production' || value === 'preview') {
    return value
  }

  throw new Error(`Unsupported channel: ${value}`)
}

const channel = readChannel()
const image = readArg('--image', 'node:22-bookworm-slim')
const serverUrl = readArg('--server-url', getEnv('WEMUX_CLOUD_URL')?.trim() || 'http://host.docker.internal:18989')
const defaultWorkerPort = '48111'
const outputDir = path.resolve(readArg('--output-dir', path.join(rootDir, '.artifacts', 'worker-npm-docker')))
const skipBuild = hasFlag('--skip-build')
const packageName = channel === 'preview' ? 'wemux-worker-preview' : 'wemux-worker'
const packageRoot = path.join(outputDir, packageName)

const normalizePort = (value) => {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid worker port: ${value}`)
  }

  return String(port)
}

const workerPort = normalizePort(readArg('--worker-port', getEnv('WEMUX_WORKER_PORT')?.trim() || defaultWorkerPort))
const workerHomeVolume = `wemux-worker-npm-home-${channel}-${workerPort}`

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

const buildWorkerPackage = () => {
  if (skipBuild) {
    if (!existsSync(packageRoot)) {
      throw new Error(`Expected packaged worker at ${packageRoot} when --skip-build is used.`)
    }
    return
  }

  run('node', ['scripts/build-worker-runtime.mjs', '--release'], { stdio: 'inherit' })
  run('node', ['scripts/build-worker-console.mjs', '--release'], { stdio: 'inherit' })
  run('node', ['scripts/package-worker-npm.mjs', '--channel', channel, '--output-dir', outputDir], { stdio: 'inherit' })
}

const packWorkerTarball = () => {
  const packed = run('npm', ['pack'], {
    cwd: packageRoot,
    stdio: 'pipe',
  })
  const filename = packed.stdout.trim().split('\n').filter(Boolean).at(-1)
  if (!filename) {
    throw new Error('npm pack did not return a package filename.')
  }

  return path.join(packageRoot, filename)
}

const main = async () => {
  assertDockerAvailable()
  buildWorkerPackage()
  const tarballPath = packWorkerTarball()
  const localConsoleUrl = `http://127.0.0.1:${workerPort}`
  const dockerArgs = [
    'run',
    '--rm',
    '-i',
  ]

  if (process.stdin.isTTY && process.stdout.isTTY) {
    dockerArgs.push('-t')
  }

  console.log(`[worker:docker] control plane: ${serverUrl}`)
  console.log(`[worker:docker] local console: ${localConsoleUrl}`)
  console.log(`[worker:docker] health: ${localConsoleUrl}/health`)
  console.log('[worker:docker] open the local console in your browser to pair manually.')

  const containerCommand = [
    'set -euo pipefail',
    'mkdir -p /data/wemux-worker/install',
    'cd /data/wemux-worker/install',
    'if [ ! -f package.json ]; then npm init -y >/dev/null 2>&1; fi',
    `npm install /work/${path.basename(tarballPath)} >/dev/null`,
    `exec ./node_modules/.bin/${packageName} daemon`,
  ].join('\n')

  dockerArgs.push(
    '--add-host', 'host.docker.internal:host-gateway',
    '--cap-add', 'NET_ADMIN',
    '--device', '/dev/net/tun',
    '-p', `${workerPort}:${workerPort}`,
    '-e', `NODE_ENV=production`,
    '-e', `WEMUX_CLOUD_URL=${serverUrl}`,
    '-e', `HOME=/data/wemux-worker`,
    '-e', `WEMUX_WORKER_HOME=/data/wemux-worker`,
    '-e', `WEMUX_WORKER_INSTALL_PREFIX=/data/wemux-worker/install`,
    '-e', `WEMUX_WORKER_HOST=0.0.0.0`,
    '-e', `WEMUX_WORKER_PORT=${workerPort}`,
    '-e', 'WEMUX_WORKER_AUTO_INSTALL=true',
    '-e', 'WEMUX_WORKER_AUTO_UPDATE=1',
    '-e', 'WEMUX_WORKER_RESTART_STRATEGY=docker',
    '-e', `WEMUX_EASYTIER_VERSION=${getEnv('WEMUX_EASYTIER_VERSION')?.trim() || 'v2.6.4'}`,
    '-e', `WEMUX_EASYTIER_DOWNLOAD_BASE_URL=${getEnv('WEMUX_EASYTIER_DOWNLOAD_BASE_URL')?.trim() || 'https://github.com/EasyTier/EasyTier/releases/download'}`,
    '-v', `${packageRoot}:/work`,
    '-v', `${workerHomeVolume}:/data/wemux-worker`,
    image,
    'bash',
    '-lc',
    containerCommand,
  )

  run('docker', dockerArgs, {
    stdio: 'inherit',
  })
}

main().catch((error) => {
  console.error(`[worker:docker] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
