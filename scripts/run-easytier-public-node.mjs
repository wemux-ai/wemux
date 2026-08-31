import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const truthy = new Set(['1', 'true', 'yes', 'on'])

const readEnv = (key, fallback = '') => {
  const wemuxKey = key.startsWith('WEMUX_') ? `WEMUX_${key.slice('WEMUX_'.length)}` : key
  return process.env[wemuxKey]?.trim() || process.env[key]?.trim() || fallback
}

const resolvePortProfile = () => {
  const explicit = readEnv('WEMUX_EASYTIER_PORT_PROFILE').toLowerCase()
  if (['dev', 'development', 'local'].includes(explicit)) {
    return 'development'
  }
  if (['preview', 'staging'].includes(explicit)) {
    return 'preview'
  }
  if (['prod', 'production'].includes(explicit)) {
    return 'production'
  }

  const url = `${readEnv('WEMUX_PUBLIC_BASE_URL')} ${readEnv('WEMUX_CLOUD_URL')}`.toLowerCase()
  if (url.includes('wemux.xyz')) {
    return 'preview'
  }
  if (url.includes('wemux.com')) {
    return 'production'
  }
  return process.env.NODE_ENV === 'development' ? 'development' : 'production'
}

const getDefaultListenUrls = () => {
  switch (resolvePortProfile()) {
    case 'development':
      return 'tcp://0.0.0.0:11030,udp://0.0.0.0:11030,ws://0.0.0.0:11031,wss://0.0.0.0:11032'
    case 'preview':
      return 'tcp://0.0.0.0:11010,udp://0.0.0.0:11010,ws://0.0.0.0:11011,wss://0.0.0.0:11012'
    default:
      return 'tcp://0.0.0.0:11020,udp://0.0.0.0:11020,ws://0.0.0.0:11021,wss://0.0.0.0:11022'
  }
}

const splitCsv = (value) => value
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const isExecutable = (targetPath) => {
  try {
    accessSync(targetPath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const resolveExecutable = (command) => {
  if (!command) {
    return ''
  }
  if (command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    return isExecutable(command) ? command : ''
  }
  for (const entry of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(entry, command)
    if (isExecutable(candidate)) {
      return candidate
    }
  }
  return ''
}

const enabled = truthy.has(readEnv('WEMUX_MESH_ENABLED').toLowerCase())
const corePath = resolveExecutable(readEnv('WEMUX_EASYTIER_CORE_PATH', 'easytier-core'))
const ipv4 = readEnv('WEMUX_EASYTIER_SERVER_IPV4')
const hostname = readEnv('WEMUX_EASYTIER_SERVER_HOSTNAME', readEnv('WEMUX_NODE_NAME', 'wemux-server'))
const listenUrls = splitCsv(readEnv(
  'WEMUX_EASYTIER_LISTEN_URLS',
  getDefaultListenUrls(),
))

if (!enabled) {
  console.error('[easytier] WEMUX_MESH_ENABLED is not enabled. Set WEMUX_MESH_ENABLED=1 to start the public node.')
  process.exit(1)
}

if (!corePath) {
  console.error('[easytier] easytier-core was not found. Set WEMUX_EASYTIER_CORE_PATH or install EasyTier.')
  process.exit(1)
}

const args = [
  '-d',
  '--hostname',
  hostname,
]

if (ipv4) {
  args.push('-i', ipv4)
} else {
  args.push('--no-tun')
}

for (const listenUrl of listenUrls) {
  args.push('-l', listenUrl)
}

console.log('[easytier] starting public node')
console.log(`[easytier] core: ${corePath}`)
console.log('[easytier] network: public shared node')
console.log(`[easytier] ipv4: ${ipv4}`)
console.log(`[easytier] listen: ${listenUrls.join(', ')}`)

const child = spawn(corePath, args, {
  stdio: 'inherit',
})

const stop = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
