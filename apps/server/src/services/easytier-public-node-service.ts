// [INPUT]: 公共节点请求
// [OUTPUT]: 节点管理
// [POS]: EasyTier 公共节点服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildEasyTierListenUrls, resolveEasyTierPortProfile } from '@shared/easytier-ports'
import { ensureEasyTierBinaries, resolveCachedEasyTierBinaries } from './easytier-binary-manager'

type EasyTierPublicNodeProcess = {
  kill: (signal?: NodeJS.Signals) => boolean
  killed: boolean
  pid?: number
  on: (event: 'exit', listener: (code: number | null) => void) => unknown
}

type StartEasyTierPublicNodeOptions = {
  spawnProcess?: (command: string, args: string[]) => EasyTierPublicNodeProcess
  resolveExecutable?: (command: string) => string
  ensureBinaries?: typeof ensureEasyTierBinaries
}

const truthy = new Set(['1', 'true', 'yes', 'on'])
const disabledValues = new Set(['0', 'false', 'off', 'no'])
let currentProcess: EasyTierPublicNodeProcess | null = null

const readEnv = (key: string, fallback = '') => process.env[key]?.trim() || fallback

const splitCsv = (value: string) => value
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const isExecutable = (targetPath: string) => {
  try {
    accessSync(targetPath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const runServerCommand = (command: string, args: string[], options?: { timeout?: number }) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: options?.timeout ?? 120000,
  })

  return {
    ok: result.status === 0,
    stderr: result.stderr?.trim() ?? '',
    error: result.error instanceof Error ? result.error.message : undefined,
  }
}

export const resolveEasyTierServerExecutable = (command: string) => {
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

export const shouldStartEmbeddedEasyTierPublicNode = () => {
  const embedded = readEnv('VIBEMUX_EASYTIER_SERVER_EMBEDDED_PUBLIC_NODE')
  if (disabledValues.has(embedded.toLowerCase())) {
    return false
  }
  return truthy.has(readEnv('VIBEMUX_MESH_ENABLED').toLowerCase())
}

export const buildEasyTierPublicNodeArgsFromEnv = () => {
  const ipv4 = readEnv('VIBEMUX_EASYTIER_SERVER_IPV4')
  const hostname = readEnv('VIBEMUX_EASYTIER_SERVER_HOSTNAME', readEnv('VIBEMUX_NODE_NAME', 'vibemux-server'))
  const portProfile = resolveEasyTierPortProfile({
    explicitProfile: readEnv('VIBEMUX_EASYTIER_PORT_PROFILE'),
    nodeEnv: process.env.NODE_ENV,
    releaseChannel: readEnv('VIBEMUX_WORKER_RELEASE_CHANNEL'),
    publicBaseUrl: readEnv('VIBEMUX_PUBLIC_BASE_URL'),
    cloudUrl: readEnv('VIBEMUX_CLOUD_URL'),
  })
  const listenUrls = splitCsv(readEnv(
    'VIBEMUX_EASYTIER_LISTEN_URLS',
    buildEasyTierListenUrls(portProfile).join(','),
  ))

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

  return {
    ok: true as const,
    args,
    ipv4,
    listenUrls,
  }
}

export const stopEmbeddedEasyTierPublicNode = () => {
  const processToStop = currentProcess
  currentProcess = null
  if (processToStop && !processToStop.killed) {
    processToStop.kill('SIGTERM')
  }
}

export const startEmbeddedEasyTierPublicNode = (options: StartEasyTierPublicNodeOptions = {}) => {
  void startEmbeddedEasyTierPublicNodeAsync(options)
  return currentProcess
    ? { started: true, reason: 'already-running' }
    : { started: true, reason: 'starting' }
}

export const startEmbeddedEasyTierPublicNodeAsync = async (options: StartEasyTierPublicNodeOptions = {}) => {
  if (!shouldStartEmbeddedEasyTierPublicNode()) {
    return { started: false, reason: 'disabled' }
  }
  if (currentProcess) {
    return { started: true, reason: 'already-running' }
  }

  const command = readEnv('VIBEMUX_EASYTIER_CORE_PATH', 'easytier-core')
  const resolveExecutableImpl = options.resolveExecutable ?? resolveEasyTierServerExecutable
  const autoDownload = !disabledValues.has(readEnv('VIBEMUX_EASYTIER_AUTO_DOWNLOAD', '1').toLowerCase())
  const cached = command === 'easytier-core' ? resolveCachedEasyTierBinaries() : null
  let corePath = command !== 'easytier-core'
    ? resolveExecutableImpl(command)
    : cached?.corePath || resolveExecutableImpl(command)
  if (!corePath) {
    if (autoDownload) {
      try {
        const binaries = await (options.ensureBinaries ?? ensureEasyTierBinaries)({
          resolveExecutable: resolveExecutableImpl,
          runCommand: (bin, args, extra) => runServerCommand(bin, args, { timeout: extra?.timeout }),
        })
        corePath = binaries.corePath
      } catch (error) {
        console.warn(`[easytier] embedded public node skipped: ${error instanceof Error ? error.message : 'EasyTier auto download failed.'}`)
        return { started: false, reason: 'missing-binary' }
      }
    } else {
      corePath = resolveExecutableImpl(command)
    }
  }

  if (!corePath) {
    console.warn('[easytier] embedded public node skipped: easytier-core was not found. Set VIBEMUX_EASYTIER_CORE_PATH, enable automatic download, or run a sidecar public node.')
    return { started: false, reason: 'missing-binary' }
  }

  const built = buildEasyTierPublicNodeArgsFromEnv()
  console.log('[easytier] starting embedded public node')
  console.log(`[easytier] core: ${corePath}`)
  console.log('[easytier] network: public shared node')
  console.log(`[easytier] ipv4: ${built.ipv4}`)
  console.log(`[easytier] listen: ${built.listenUrls.join(', ')}`)

  const spawnProcess = options.spawnProcess ?? ((commandToRun, args) => spawn(commandToRun, args, { stdio: 'inherit' }))
  const child = spawnProcess(corePath, built.args)
  currentProcess = child
  child.on('exit', (code) => {
    if (currentProcess !== child) {
      return
    }
    currentProcess = null
    if (code !== 0) {
      console.warn(`[easytier] embedded public node exited with code ${code ?? 'unknown'}`)
    }
  })

  return { started: true, reason: 'started' }
}
