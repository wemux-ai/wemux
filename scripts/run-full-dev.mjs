import { spawn } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const mode = process.argv[2] || 'full'
const validModes = new Set(['full', 'stack', 'up'])

if (!validModes.has(mode)) {
  console.error(`[full-dev] unsupported mode: ${mode}`)
  process.exit(1)
}

const COMPOSE_FILE = 'deploy/docker/docker-compose.dev-full.yml'

const readEnv = (key, fallback = '') => {
  const wemuxKey = key.startsWith('WEMUX_') ? `WEMUX_${key.slice('WEMUX_'.length)}` : key
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
const defaultHybridPreviewAppHost = 'app.wemux.localtest.me'

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
  || defaultHybridPreviewAppHost

const normalizeOrigin = (value, port) => {
  if (!value) {
    return `http://${publicHost}:${port}`
  }

  try {
    const url = new URL(value)
    if (hybridBindHost !== '127.0.0.1' && isLoopbackHost(url.hostname)) {
      url.hostname = publicHost
    }
    return trimTrailingSlash(url.toString())
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
  readEnv('VITE_APP_BASE_URL') || readEnv('APP_BASE_URL') || readEnv('WEMUX_PUBLIC_BASE_URL'),
  hybridWebPort,
)
const browserServerOrigin = normalizeOrigin(
  readEnv('VITE_API_BASE_URL') || readEnv('BETTER_AUTH_URL') || readEnv('APP_URL') || readEnv('WEMUX_CLOUD_URL'),
  hybridServerPort,
)
const browserApiOrigin = webOrigin
const browserAuthClientOrigin = `${webOrigin}/api/identity`
const stackServerProxyTarget = `http://server:${hybridServerPort}`
const directServerOrigin = normalizeServerOrigin(
  readEnv('APP_URL') || readEnv('WEMUX_CLOUD_URL'),
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

const fullEnv = {
  ...process.env,
  HYBRID_BIND_HOST: hybridBindHost,
  HYBRID_PUBLIC_HOST: publicHost,
  VITE_HMR_HOST: isClientReachableHost(resolvedEnvHmrHost) ? resolvedEnvHmrHost : publicHost,
  VITE_API_BASE_URL: browserApiOrigin,
  VITE_APP_BASE_URL: webOrigin,
  VITE_BETTER_AUTH_URL: browserAuthClientOrigin,
  APP_BASE_URL: webOrigin,
  APP_URL: directServerOrigin,
  WEMUX_PUBLIC_BASE_URL: webOrigin,
  WEMUX_CLOUD_URL: directServerOrigin,
  BETTER_AUTH_URL: authOrigin,
  BETTER_AUTH_TRUSTED_ORIGINS: trustedOrigins,
  VITE_SERVER_PROXY_TARGET: stackServerProxyTarget,
}

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: fullEnv,
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

const logUrls = () => {
  console.log(`[full-dev] bind host: ${fullEnv.HYBRID_BIND_HOST}`)
  console.log(`[full-dev] public host: ${publicHost}`)
  console.log(`[full-dev] web: ${webOrigin}`)
  console.log(`[full-dev] docs: ${webOrigin}/docs (由 web 应用自身提供)`)
  console.log(`[full-dev] server (browser proxy): ${browserApiOrigin}/api -> ${stackServerProxyTarget}`)
  console.log(`[full-dev] server (browser direct): ${browserServerOrigin}`)
  console.log(`[full-dev] server (direct): ${directServerOrigin}`)
  console.log(`[full-dev] auth (browser): ${browserAuthClientOrigin}`)
  console.log(`[full-dev] auth (server): ${authOrigin}`)
  console.log(`[full-dev] worker: http://${fullEnv.HYBRID_BIND_HOST === '0.0.0.0' ? '127.0.0.1' : fullEnv.HYBRID_BIND_HOST}:${readEnv('WEMUX_WORKER_PORT', '48121')} (inside Docker)`)
}

try {
  await run('node', ['scripts/check-docker-daemon.mjs'])
  await run('node', ['scripts/prepare-hybrid-images.mjs'])
  logUrls()

  if (mode === 'stack') {
    process.exit(await run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '--remove-orphans']))
  }

  if (mode === 'up') {
    process.exit(await run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--remove-orphans']))
  }

  // In full mode, worker runs inside Docker — only start compose stack
  process.exit(await run(packageManagerArgs[0], [
    ...packageManagerArgs.slice(1),
    'exec',
    'concurrently',
    '-k',
    '-n',
    'stack',
    '-c',
    'magenta',
    `docker compose -f ${COMPOSE_FILE} up --remove-orphans`,
  ]))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
