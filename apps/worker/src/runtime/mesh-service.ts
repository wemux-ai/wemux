// [INPUT]: mesh 服务请求
// [OUTPUT]: P2P mesh 操作
// [POS]: EasyTier mesh 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { WorkerConfig } from '@shared/types'
import { getWorkerPackageJson } from '../core/app-root'
import { getWorkerConfigPath, getWorkerHome, loadWorkerConfig } from '../core/config'
import {
  buildEasyTierCoreArgs,
  getWorkerMeshStatus,
  loadWorkerMeshRuntimeConfig,
  refreshWorkerMeshRuntimeStatus,
  resolveWorkerEasyTierRpcPortal,
  type WorkerMeshRuntimeConfig,
} from './mesh-runtime-manager'
import { ensureEasyTierBinaries, resolveCachedEasyTierBinaries } from './easytier-binary-manager'

type MeshServiceStatus = {
  installed: boolean
  running: boolean
  serviceName: string
  detail?: string
}

export type MeshSupervisorChild = {
  killed: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'exit', listener: () => void): unknown
}

type MeshSupervisorState = {
  child: MeshSupervisorChild | null
  childKey: string
}

type MeshSupervisorOptions = {
  readWorkerConfig?: () => WorkerConfig | null
  resolveCorePath?: (config: WorkerMeshRuntimeConfig) => string | Promise<string>
  spawnProcess?: (command: string, args: string[]) => MeshSupervisorChild
  onLog?: (message: string) => void
}

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const runCommand = (command: string, args: string[], timeout = 30000) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout,
  })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    error: result.error instanceof Error ? result.error.message : '',
  }
}

const formatCommandResult = (label: string, result: ReturnType<typeof runCommand>) => {
  const parts = [
    `${label}: ${result.ok ? 'ok' : 'failed'}`,
    result.stdout ? `stdout: ${result.stdout}` : '',
    result.stderr ? `stderr: ${result.stderr}` : '',
    result.error ? `error: ${result.error}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

const assertCommandOk = (label: string, result: ReturnType<typeof runCommand>) => {
  if (!result.ok) {
    throw new Error(formatCommandResult(label, result))
  }
}

const getDefaultMeshServiceName = () => {
  const packageName = getWorkerPackageJson().name?.trim()
  const workerName = packageName === 'vibemux-worker-preview' ? 'vibemux-worker-preview' : 'vibemux-worker'
  return `${workerName}-mesh`
}

const getMacOSLabel = (serviceName: string) => `com.vibemux.${serviceName}`
const getMacOSPlistPath = (serviceName: string) => `/Library/LaunchDaemons/${getMacOSLabel(serviceName)}.plist`
const getMacOSStdoutPath = (serviceName: string) => `/Library/Logs/wemux/${serviceName}.stdout.log`
const getMacOSStderrPath = (serviceName: string) => `/Library/Logs/wemux/${serviceName}.stderr.log`
const MESH_SUPERVISOR_POLL_MS = 5000

const ensureMeshConfigReady = (config: WorkerMeshRuntimeConfig) => {
  if (!config.enabled) {
    throw new Error('Mesh is disabled for this worker. Pair with a mesh-enabled control plane first.')
  }
  if (!config.networkName?.trim() || !config.networkSecret?.trim() || config.peers.length === 0) {
    throw new Error('Mesh enrollment is incomplete. Reconnect the worker and wait for control-plane config sync.')
  }
}

const resolveEasyTierCorePath = async (config: WorkerMeshRuntimeConfig) => {
  // EasyTier 是节点级 tool：二进制缓存固定落机器级 workerHome（AGENTS.md node/ = 节点级），
  // 不随 workspaceRoot 走——云节点沙箱 workspaceRoot 在 R2 挂载上时也不落 R2。
  const cached = resolveCachedEasyTierBinaries({ workspaceRoot: getWorkerHome() })
  if (config.corePath?.trim()) {
    return config.corePath.trim()
  }
  if (cached?.corePath) {
    return cached.corePath
  }
  const binaries = await ensureEasyTierBinaries({ workspaceRoot: getWorkerHome() })
  return binaries.corePath
}

const buildProcessEnv = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: process.env.HOME || '',
  ...extra,
})

const buildMacOSBootstrapFailureMessage = (params: {
  serviceName: string
  plistPath: string
  bootstrap: ReturnType<typeof runCommand>
}) => {
  const label = getMacOSLabel(params.serviceName)
  const diagnostics = [
    formatCommandResult('launchctl bootstrap', params.bootstrap),
    formatCommandResult('plutil -lint', runCommand('plutil', ['-lint', params.plistPath], 5000)),
    formatCommandResult('ls -lO', runCommand('ls', ['-lO', params.plistPath], 5000)),
    formatCommandResult('xattr -l', runCommand('xattr', ['-l', params.plistPath], 5000)),
    formatCommandResult('launchctl print', runCommand('launchctl', ['print', `system/${label}`], 5000)),
  ]
  return diagnostics.join('\n\n')
}

const buildMacOSPlist = (params: {
  serviceName: string
}) => {
  const label = getMacOSLabel(params.serviceName)
  const args = [
    process.execPath,
    process.argv[1],
    'mesh',
    'supervisor',
  ].map((arg) => `        <string>${escapeXml(arg)}</string>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>VIBEMUX_WORKER_HOME</key>
        <string>${escapeXml(getWorkerHome())}</string>
        <key>VIBEMUX_WORKER_EXECUTABLE_PATH</key>
        <string>${escapeXml(process.argv[1])}</string>
        <key>PATH</key>
        <string>${escapeXml(process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin')}</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>${escapeXml(getMacOSStdoutPath(params.serviceName))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(getMacOSStderrPath(params.serviceName))}</string>
</dict>
</plist>
`
}

const readWorkerConfigDirect = (): WorkerConfig | null => {
  const configPath = getWorkerConfigPath()
  if (!existsSync(configPath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as WorkerConfig
  } catch {
    return null
  }
}

const buildSupervisorProcessKey = (params: { corePath: string; config: WorkerMeshRuntimeConfig }) => JSON.stringify({
  corePath: params.corePath,
  args: buildEasyTierCoreArgs(params.config),
})

const stopSupervisorChild = (child: MeshSupervisorChild | null) => {
  if (!child || child.killed) {
    return
  }
  child.kill('SIGTERM')
}

export const reconcileMacOSMeshSupervisorOnce = async (
  state: MeshSupervisorState,
  options: MeshSupervisorOptions = {},
) => {
  const workerConfig = (options.readWorkerConfig ?? readWorkerConfigDirect)()
  if (!workerConfig) {
    stopSupervisorChild(state.child)
    state.child = null
    state.childKey = ''
    return
  }

  const config = loadWorkerMeshRuntimeConfig(workerConfig)
  if (!config.enabled || !config.networkName?.trim() || !config.networkSecret?.trim() || config.peers.length === 0) {
    stopSupervisorChild(state.child)
    state.child = null
    state.childKey = ''
    return
  }

  const corePath = await (options.resolveCorePath ?? resolveEasyTierCorePath)(config)
  if (!existsSync(corePath) && !options.resolveCorePath) {
    throw new Error(`EasyTier core not found: ${corePath}`)
  }

  const nextKey = buildSupervisorProcessKey({ corePath, config })
  if (state.child && state.childKey === nextKey) {
    return
  }

  stopSupervisorChild(state.child)
  const nextChild = (options.spawnProcess ?? ((command, args) => spawn(command, args, {
      env: buildProcessEnv(),
      stdio: ['ignore', 'inherit', 'inherit'],
    })))(corePath, buildEasyTierCoreArgs(config))
  state.child = nextChild
  state.childKey = nextKey
  ;(options.onLog ?? console.log)(`[worker] mesh supervisor started EasyTier ${config.ipv4 || ''}`)
  nextChild.on('exit', () => {
    if (state.child === nextChild) {
      state.child = null
      state.childKey = ''
    }
  })
}

const runMacOSMeshSupervisor = async () => {
  const state: MeshSupervisorState = {
    child: null,
    childKey: '',
  }
  let stopping = false

  const shutdown = () => {
    stopping = true
    stopSupervisorChild(state.child)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  while (!stopping) {
    try {
      await reconcileMacOSMeshSupervisorOnce(state)
    } catch (error) {
      console.error('[worker] mesh supervisor reconcile failed:', error instanceof Error ? error.message : error)
    }
    await new Promise((resolve) => setTimeout(resolve, MESH_SUPERVISOR_POLL_MS))
  }
}

const installMacOSMeshService = async (serviceName: string) => {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error(`Installing the macOS mesh service requires sudo. Run: sudo VIBEMUX_WORKER_HOME=${getWorkerHome()} ${process.argv[1]} mesh install-service`)
  }

  const workerConfig = loadWorkerConfig()
  const config = loadWorkerMeshRuntimeConfig(workerConfig)
  ensureMeshConfigReady(config)
  const corePath = await resolveEasyTierCorePath(config)
  if (!existsSync(corePath)) {
    throw new Error(`EasyTier core not found: ${corePath}`)
  }

  mkdirSync('/Library/Logs/wemux', { recursive: true })
  const plistPath = getMacOSPlistPath(serviceName)
  writeFileSync(plistPath, buildMacOSPlist({ serviceName }), 'utf8')
  runCommand('xattr', ['-c', plistPath], 5000)
  assertCommandOk('chown root:wheel', runCommand('chown', ['root:wheel', plistPath], 5000))
  assertCommandOk('chmod 644', runCommand('chmod', ['644', plistPath], 5000))

  const label = getMacOSLabel(serviceName)
  runCommand('launchctl', ['bootout', `system/${label}`], 15000)
  runCommand('launchctl', ['bootout', 'system', plistPath], 15000)
  runCommand('launchctl', ['remove', label], 15000)
  const bootstrap = runCommand('launchctl', ['bootstrap', 'system', plistPath], 15000)
  if (!bootstrap.ok && !/already bootstrapped/i.test(`${bootstrap.stdout}\n${bootstrap.stderr}`)) {
    throw new Error(buildMacOSBootstrapFailureMessage({ serviceName, plistPath, bootstrap }))
  }
  const kickstart = runCommand('launchctl', ['kickstart', '-k', `system/${label}`], 15000)
  if (!kickstart.ok) {
    throw new Error(kickstart.stderr || kickstart.error || 'launchctl kickstart failed')
  }
}

const uninstallMacOSMeshService = (serviceName: string) => {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error(`Uninstalling the macOS mesh service requires sudo. Run: sudo VIBEMUX_WORKER_HOME=${getWorkerHome()} ${process.argv[1]} mesh uninstall-service`)
  }

  const label = getMacOSLabel(serviceName)
  runCommand('launchctl', ['bootout', `system/${label}`], 15000)
  const rm = runCommand('rm', ['-f', getMacOSPlistPath(serviceName)])
  if (!rm.ok) {
    throw new Error(rm.stderr || rm.error || 'failed to remove mesh service plist')
  }
}

const getMacOSMeshServiceStatus = (serviceName: string): MeshServiceStatus => {
  const label = getMacOSLabel(serviceName)
  const result = runCommand('launchctl', ['print', `system/${label}`], 10000)
  const output = `${result.stdout}\n${result.stderr}`
  const pidMatch = output.match(/\bpid\s*=\s*(\d+)/i)
  return {
    installed: existsSync(getMacOSPlistPath(serviceName)),
    running: result.ok && Boolean(pidMatch),
    serviceName,
    detail: result.ok ? undefined : result.stderr || result.error || undefined,
  }
}

const formatMeshServiceStatus = (status: MeshServiceStatus) => {
  const rows = [
    ['Service', status.serviceName],
    ['Installed', status.installed ? 'yes' : 'no'],
    ['Running', status.running ? 'yes' : 'no'],
  ]
  if (status.detail) {
    rows.push(['Detail', status.detail])
  }
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join('\n')
}

export const runWorkerMeshCli = async (args: string[]) => {
  const subcommand = args[0] || 'status'
  const serviceName = args.includes('--name')
    ? args[args.indexOf('--name') + 1] || getDefaultMeshServiceName()
    : getDefaultMeshServiceName()

  switch (subcommand) {
    case 'status': {
      const config = loadWorkerMeshRuntimeConfig(loadWorkerConfig())
      const status = refreshWorkerMeshRuntimeStatus(config)
      console.log(JSON.stringify({
        rpcPortal: resolveWorkerEasyTierRpcPortal(),
        mesh: status,
        service: process.platform === 'darwin' ? getMacOSMeshServiceStatus(serviceName) : undefined,
      }, null, 2))
      return
    }
    case 'install-service': {
      if (process.platform !== 'darwin') {
        throw new Error('Mesh service install is currently implemented for macOS only.')
      }
      await installMacOSMeshService(serviceName)
      console.log(`[worker] mesh service installed: ${serviceName}`)
      return
    }
    case 'supervisor': {
      if (process.platform !== 'darwin') {
        throw new Error('Mesh supervisor is currently implemented for macOS only.')
      }
      await runMacOSMeshSupervisor()
      return
    }
    case 'uninstall-service': {
      if (process.platform !== 'darwin') {
        throw new Error('Mesh service uninstall is currently implemented for macOS only.')
      }
      uninstallMacOSMeshService(serviceName)
      console.log(`[worker] mesh service uninstalled: ${serviceName}`)
      return
    }
    case 'service-status': {
      if (process.platform !== 'darwin') {
        throw new Error('Mesh service status is currently implemented for macOS only.')
      }
      console.log(formatMeshServiceStatus(getMacOSMeshServiceStatus(serviceName)))
      return
    }
    default:
      console.log(JSON.stringify(getWorkerMeshStatus(), null, 2))
      throw new Error(`Unknown mesh command: ${subcommand}`)
  }
}
