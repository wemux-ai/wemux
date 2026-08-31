// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { getEnv } from '@shared/env'
// [INPUT]: Current packaged worker identity, host runtime paths, and explicit service overrides.
// [OUTPUT]: Platform-neutral worker service commands, paths, and a minimal persistent environment.
// [POS]: Worker service boundary; ambient application secrets and environment selection must not leak into system services.

import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { resolveGitCertificateAuthorityEnv } from '@shared/git-auth'
import { getWorkerConsolePortBase, type WorkerConsolePortEnvironment } from '@shared/worker-console-ports'
import { getWorkerPackageJson } from '../core/app-root'
import { getWorkerHome, getWorkerNodeDir } from '../core/config'
import { resolveExecutable } from '../core/command-utils'
import { getWorkerReleaseChannel } from '../update/worker-release'

const WORKER_SERVICE_HOST_ENV_KEYS = [
  'ALL_PROXY',
  'APPDATA',
  'ComSpec',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NO_PROXY',
  'PATHEXT',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'SHELL',
  'SSL_CERT_DIR',
  'SystemRoot',
  'SSH_AUTH_SOCK',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const

export const pickWorkerServiceHostEnv = (source: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const key of WORKER_SERVICE_HOST_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined) {
      env[key] = value
    }
  }

  for (const [key, value] of Object.entries(resolveGitCertificateAuthorityEnv(source))) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  return env
}

export const getDefaultWorkerServiceName = () => {
  const packageName = getWorkerPackageJson().name?.trim()
  // 兼容窗口：wemux-* 新包名按自身命名服务，存量 vibemux-* 与源码模式沿用旧名
  if (packageName === 'wemux-worker-preview' || packageName === 'vibemux-worker-preview') {
    return packageName
  }
  if (packageName === 'wemux-worker') {
    return 'vibemux-worker'
  }
  return 'wemux-worker'
}

export const getDefaultWorkerBinName = () => getDefaultWorkerServiceName()

const getWorkerServicePortEnvironment = (): WorkerConsolePortEnvironment => {
  return getDefaultWorkerServiceName().endsWith('-preview') ? 'preview' : 'production'
}

export const getWorkerServiceLogDir = () => {
  return path.join(getWorkerNodeDir(), 'logs', 'service')
}

export const getInstalledWorkerExecutableCandidates = (
  installPrefix: string,
  binName = getDefaultWorkerBinName(),
  platform = process.platform,
) => {
  const resolvedPrefix = path.resolve(installPrefix)
  if (platform === 'win32') {
    return [
      path.join(resolvedPrefix, `${binName}.cmd`),
      path.join(resolvedPrefix, 'bin', `${binName}.cmd`),
    ]
  }

  return [path.join(resolvedPrefix, 'bin', binName)]
}

export const getInstalledWorkerExecutablePath = (
  installPrefix: string,
  binName = getDefaultWorkerBinName(),
  platform = process.platform,
) => {
  const candidates = getInstalledWorkerExecutableCandidates(installPrefix, binName, platform)
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export const getInstalledWorkerNodeWrapperCandidates = (
  installPrefix: string,
  binName = getDefaultWorkerBinName(),
  platform = process.platform,
) => {
  const resolvedPrefix = path.resolve(installPrefix)
  if (platform === 'win32') {
    return [
      path.join(resolvedPrefix, `${binName}-node-wrapper.cmd`),
      path.join(resolvedPrefix, 'bin', `${binName}-node-wrapper.cmd`),
    ]
  }

  return [path.join(resolvedPrefix, 'bin', `${binName}-node-wrapper`)]
}

export const getInstalledWorkerNodeWrapperPath = (
  installPrefix: string,
  binName = getDefaultWorkerBinName(),
  platform = process.platform,
) => {
  const candidates = getInstalledWorkerNodeWrapperCandidates(installPrefix, binName, platform)
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0]
}

export const resolveWorkerInstallPrefix = (workerPath?: string) => {
  const configured = getEnv('WEMUX_WORKER_INSTALL_PREFIX')?.trim()
  if (configured) {
    return path.resolve(configured)
  }

  const normalizedWorkerPath = workerPath?.trim()
  if (normalizedWorkerPath) {
    const resolvedWorkerPath = path.resolve(normalizedWorkerPath)
    const parentDir = path.dirname(resolvedWorkerPath)
    return path.basename(parentDir).toLowerCase() === 'bin'
      ? path.resolve(path.dirname(parentDir))
      : parentDir
  }

  return ''
}

export const resolveWorkerExecutablePath = (explicitPath?: string, installPrefix?: string) => {
  const configured = explicitPath?.trim() || getEnv('WEMUX_WORKER_EXECUTABLE_PATH')?.trim()
  if (configured) {
    return path.resolve(configured)
  }

  const binName = getDefaultWorkerBinName()
  const prefix = installPrefix?.trim() || getEnv('WEMUX_WORKER_INSTALL_PREFIX')?.trim()
  if (prefix) {
    for (const candidate of getInstalledWorkerExecutableCandidates(prefix, binName)) {
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  return resolveExecutable(binName) || process.argv[1]
}

const resolveWorkerPackageRoot = (installPrefix: string, binName: string) => {
  const normalizedPrefix = installPrefix.trim()
  if (!normalizedPrefix) {
    return ''
  }

  const candidates = [
    path.join(normalizedPrefix, 'node_modules', binName),
    path.join(normalizedPrefix, 'lib', 'node_modules', binName),
  ]
  return candidates.find((candidate) => existsSync(candidate)) || ''
}

export const resolveWorkerServiceCommand = (explicitPath?: string, installPrefix?: string) => {
  const executablePath = resolveWorkerExecutablePath(explicitPath, installPrefix)
  const resolvedInstallPrefix = installPrefix?.trim() || resolveWorkerInstallPrefix(executablePath)

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)) {
    const executableName = path.basename(executablePath).replace(/\.(cmd|bat)$/i, '')
    const packageRoot = resolveWorkerPackageRoot(resolvedInstallPrefix, executableName || getDefaultWorkerBinName())
    const cliPath = packageRoot ? path.join(packageRoot, 'bin', 'cli.mjs') : ''
    if (existsSync(cliPath)) {
      return {
        workerPath: process.execPath,
        args: [cliPath],
        executablePath,
        installPrefix: resolvedInstallPrefix,
      }
    }
  }

  return {
    workerPath: executablePath,
    args: [] as string[],
    executablePath,
    installPrefix: resolvedInstallPrefix,
  }
}

export const buildWorkerServiceEnv = (params: {
  workerPath: string
  installPrefix?: string
  extraEnv?: Record<string, string>
}) => {
  const installPrefix = params.installPrefix?.trim() || resolveWorkerInstallPrefix(params.workerPath)
  return {
    ...pickWorkerServiceHostEnv(process.env),
    PATH: process.env.PATH || '',
    HOME: os.homedir(),
    WEMUX_WORKER_HOME: getWorkerHome(),
    WEMUX_WORKER_RELEASE_CHANNEL: getWorkerReleaseChannel(),
    WEMUX_WORKER_PORT_PROFILE: getWorkerServicePortEnvironment(),
    WEMUX_WORKER_PORT: String(getWorkerConsolePortBase(getWorkerServicePortEnvironment())),
    WEMUX_WORKER_EXECUTABLE_PATH: params.workerPath,
    WEMUX_WORKER_INSTALL_PREFIX: installPrefix || '',
    WEMUX_WORKER_RESTART_STRATEGY: 'system-service',
    WEMUX_WORKER_AUTO_UPDATE: getEnv('WEMUX_WORKER_AUTO_UPDATE') || '1',
    ...params.extraEnv,
  }
}

export const ensureServiceLogDir = (logDir = getWorkerServiceLogDir()) => {
  mkdirSync(logDir, { recursive: true })
  return logDir
}

export const runServiceCommand = (command: string, args: string[], timeout = 30000) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    timeout,
  })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    error: result.error instanceof Error ? result.error.message : '',
  }
}

export const streamCommandLines = async function* (
  command: string,
  args: string[],
): AsyncIterable<string> {
  const child = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const queue: string[] = []
  let done = false
  let notify: (() => void) | null = null
  const push = (chunk: Buffer) => {
    queue.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean))
    notify?.()
    notify = null
  }

  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('close', () => {
    done = true
    notify?.()
    notify = null
  })

  while (!done || queue.length > 0) {
    const next = queue.shift()
    if (next) {
      yield next
      continue
    }
    await new Promise<void>((resolve) => {
      notify = resolve
    })
  }
}

export const formatServiceStatus = (status: import('./platform-service').ServiceStatus) => {
  const rows = [
    ['Service', status.serviceName],
    ['Mode', status.mode || 'system-service'],
    ['Installed', status.installed ? 'yes' : 'no'],
    ['Running', status.running ? 'yes' : 'no'],
    ['PID', status.pid ? String(status.pid) : '-'],
    ['Autostart', status.autostart === undefined ? '-' : status.autostart ? 'enabled' : 'disabled'],
  ]
  if (status.runsAs) {
    rows.push(['Runs as', status.runsAs])
  }
  if (status.adminRequired !== undefined) {
    rows.push(['Admin required', status.adminRequired ? 'yes' : 'no'])
  }
  if (status.detail) {
    rows.push(['Detail', status.detail])
  }

  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join('\n')
}
