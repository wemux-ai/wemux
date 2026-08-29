import path from 'node:path'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const mode = process.argv[2] || 'full'
const validModes = new Set(['full', 'stack', 'up'])

if (!validModes.has(mode)) {
  console.error(`[hybrid] unsupported mode: ${mode}`)
  process.exit(1)
}

const readEnv = (key, fallback = '') => {
  const wemuxKey = key.startsWith('VIBEMUX_') ? `WEMUX_${key.slice('VIBEMUX_'.length)}` : key
  return process.env[wemuxKey]?.trim() || process.env[key]?.trim() || fallback
}
const trimTrailingSlash = (value) => value.replace(/\/+$/, '')
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const bindOnlyHosts = new Set(['0.0.0.0', '::', '[::]'])
const isLoopbackHost = (value) => loopbackHosts.has(value.trim().toLowerCase())
const isBindOnlyHost = (value) => bindOnlyHosts.has(value.trim().toLowerCase())
const isClientReachableHost = (value) => {
  const normalized = value.trim()
  return normalized && !isLoopbackHost(normalized) && !isBindOnlyHost(normalized)
}
const loopbackServerOrigin = (port) => `http://127.0.0.1:${port}`
const defaultHybridPublicHost = '127.0.0.1'

const parseIpv4 = (address) => {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null
  }

  return parts
}

const resolveUrlHostname = (value) => {
  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

const isLocalPreviewHostname = (value) => value.trim().toLowerCase().endsWith('.localtest.me')

const splitCsv = (value) => value.split(',').map((item) => item.trim()).filter(Boolean)

const mergeCsv = (...values) => [...new Set(values.flatMap(splitCsv))].join(',')

const hybridBindHost = readEnv('HYBRID_BIND_HOST', '0.0.0.0')
const hybridWebPort = readEnv('HYBRID_WEB_PORT', '15173')
const hybridServerPort = readEnv('HYBRID_SERVER_PORT', '18989')
const resolvedEnvHmrHost = readEnv('VITE_HMR_HOST')
const publicHost = readEnv('HYBRID_PUBLIC_HOST')
  || (isClientReachableHost(resolvedEnvHmrHost) ? resolvedEnvHmrHost : '')
  || defaultHybridPublicHost

const normalizeOrigin = (value, port) => {
  if (!value) {
    return `http://${publicHost}:${port}`
  }

  try {
    return trimTrailingSlash(new URL(value).toString())
  } catch {
    return trimTrailingSlash(value)
  }
}

const normalizeServerOrigin = (value, port) => {
  if (!value) {
    return loopbackServerOrigin(port)
  }

  try {
    return trimTrailingSlash(new URL(value).toString())
  } catch {
    return trimTrailingSlash(value)
  }
}

const webOrigin = normalizeOrigin(
  readEnv('VITE_APP_BASE_URL') || readEnv('APP_BASE_URL') || readEnv('VIBEMUX_PUBLIC_BASE_URL'),
  hybridWebPort,
)
const browserServerOrigin = normalizeOrigin(
  readEnv('VITE_API_BASE_URL') || readEnv('BETTER_AUTH_URL') || readEnv('APP_URL') || readEnv('VIBEMUX_CLOUD_URL'),
  hybridServerPort,
)
const browserApiOrigin = webOrigin
const browserAuthClientOrigin = `${webOrigin}/api/identity`
const stackServerProxyTarget = `http://server:${hybridServerPort}`
const directServerOrigin = normalizeServerOrigin(
  readEnv('APP_URL') || readEnv('VIBEMUX_CLOUD_URL'),
  hybridServerPort,
)
const authOrigin = (() => {
  const configuredAuthOrigin = trimTrailingSlash(readEnv('BETTER_AUTH_URL'))
  if (configuredAuthOrigin) {
    const configuredHostname = resolveUrlHostname(configuredAuthOrigin)
    const browserHostname = resolveUrlHostname(browserServerOrigin)
    if (isLoopbackHost(configuredHostname) && isLocalPreviewHostname(browserHostname)) {
      return browserServerOrigin
    }
    return configuredAuthOrigin
  }

  const hostname = resolveUrlHostname(browserServerOrigin)
  if (hostname && !isLoopbackHost(hostname) && parseIpv4(hostname)) {
    return loopbackServerOrigin(hybridServerPort)
  }

  return browserServerOrigin
})()
const trustedOrigins = mergeCsv(
  readEnv('BETTER_AUTH_TRUSTED_ORIGINS'),
  webOrigin,
  browserServerOrigin,
  directServerOrigin,
  authOrigin,
  `http://127.0.0.1:${hybridWebPort}`,
  `http://localhost:${hybridWebPort}`,
  `http://127.0.0.1:${hybridServerPort}`,
  `http://localhost:${hybridServerPort}`,
)

const hybridEnv = {
  ...process.env,
  HYBRID_BIND_HOST: hybridBindHost,
  HYBRID_PUBLIC_HOST: publicHost,
  VITE_HMR_HOST: isClientReachableHost(resolvedEnvHmrHost) ? resolvedEnvHmrHost : publicHost,
  VITE_API_BASE_URL: browserApiOrigin,
  VITE_APP_BASE_URL: webOrigin,
  VITE_BETTER_AUTH_URL: browserAuthClientOrigin,
  APP_BASE_URL: webOrigin,
  APP_URL: directServerOrigin,
  VIBEMUX_PUBLIC_BASE_URL: webOrigin,
  VIBEMUX_CLOUD_URL: directServerOrigin,
  BETTER_AUTH_URL: authOrigin,
  BETTER_AUTH_TRUSTED_ORIGINS: trustedOrigins,
  VITE_SERVER_PROXY_TARGET: stackServerProxyTarget,
}

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: hybridEnv,
    stdio: 'inherit',
  })

  child.on('error', reject)
  child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
})

const packageManagerArgs = process.env.npm_execpath?.trim()
  ? [process.execPath, process.env.npm_execpath.trim()]
  : ['corepack', 'pnpm']

const toShellArg = (value) => (/[^\w./-]/.test(value) ? JSON.stringify(value) : value)
const buildShellCommand = (args) => args.map(toShellArg).join(' ')

const logHybridUrls = () => {
  console.log(`[hybrid] bind host: ${hybridEnv.HYBRID_BIND_HOST}`)
  console.log(`[hybrid] public host: ${publicHost}`)
  console.log(`[hybrid] web: ${webOrigin}`)
  console.log(`[hybrid] docs: ${webOrigin}/docs (由 web 应用自身提供)`)
  console.log(`[hybrid] server (browser proxy): ${browserApiOrigin}/api -> ${stackServerProxyTarget}`)
  console.log(`[hybrid] server (browser direct): ${browserServerOrigin}`)
  console.log(`[hybrid] server (direct): ${directServerOrigin}`)
  console.log(`[hybrid] auth (browser): ${browserAuthClientOrigin}`)
  console.log(`[hybrid] auth (server): ${authOrigin}`)
}

try {
  await run('node', ['scripts/check-docker-daemon.mjs'])
  await run('node', ['scripts/prepare-hybrid-images.mjs'])
  await run(packageManagerArgs[0], [
    ...packageManagerArgs.slice(1),
    'build:worker:preview-installer',
  ])
  logHybridUrls()

  if (mode === 'stack') {
    process.exit(await run('docker', ['compose', '-f', 'deploy/docker/docker-compose.dev-hybrid.yml', 'up', '--remove-orphans']))
  }

  if (mode === 'up') {
    process.exit(await run('docker', ['compose', '-f', 'deploy/docker/docker-compose.dev-hybrid.yml', 'up', '-d', '--remove-orphans']))
  }

  const concurrentNames = 'stack,worker'
  const concurrentColors = 'magenta,cyan'
  const concurrentCommands = [
    'docker compose -f deploy/docker/docker-compose.dev-hybrid.yml up --remove-orphans',
    `${buildShellCommand(packageManagerArgs)} dev:worker:hybrid`,
  ]

  process.exit(await run(packageManagerArgs[0], [
    ...packageManagerArgs.slice(1),
    'exec',
    'concurrently',
    '-k',
    '-n',
    concurrentNames,
    '-c',
    concurrentColors,
    ...concurrentCommands,
  ]))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
