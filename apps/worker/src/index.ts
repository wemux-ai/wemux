/**
 * [INPUT]: Worker CLI arguments, local service state, pairing config, and update commands.
 * [OUTPUT]: Worker command dispatch, service management, and safe update forwarding to the live daemon.
 * [POS]: Worker executable entry point; delegates runtime execution to the daemon and domain-specific CLI modules.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import dotenv from 'dotenv'
import { getEnv, bridgeWemuxEnvToLegacy } from '@shared/env'
import { buildWorkerConsolePortCandidates, resolveWorkerConsolePortEnvironment } from '@shared/worker-console-ports'
import { pairWithControlPlane } from './control-plane/pair-client'
import {
  buildSavedPairingCodeReuseMessage,
  hasSavedWorkerPairing,
  normalizeReusablePairingCode,
  shouldReuseSavedWorkerPairing,
} from './control-plane/pairing-code-reuse'
import {
  buildConnectPairingFailureMessage,
  buildMissingPairingCodeMessage,
} from './control-plane/pairing-error'
import { getWorkerPackageJson, getWorkerVersion } from './core/app-root'
import { warmDefaultCloudUrlFallback } from './core/default-cloud-url'
import { clearWorkerPairing, loadWorkerConfig, resetWorkerConfig, saveWorkerConfig } from './core/config'
import { getLocalWorkerConsoleUrl } from './core/local-console'
import {
  ensureWorkerRuntimeReady,
  ensureWorkerRuntimeReadyInteractive,
  type WorkerRuntimeTarget,
} from './core/runtime-bootstrap'
import { updateWorkerRuntimeState } from './core/runtime-state'
import { runDesktopSandboxCli } from './runtime/desktop-sandbox-cli'
import { runWorkerDaemon, runWorkerDoctor, runWorkerOpen } from './runtime/daemon'
import { runWorkerMeshCli } from './runtime/mesh-service'
import { runWorkerRuntimeSmokeCli } from './runtime/runtime-smoke'
import { runMcpStdioBridge } from './cli/mcp-stdio'
import { runMcpConnectorStdioBridge } from './cli/mcp-connector-stdio'
import { applyWorkerSelfUpdate, beginWorkerSelfUpdate, WORKER_ENTRY_SMOKE_COMMAND, type WorkerUpdateStartResult } from './update/worker-updater'
import { checkForWorkerUpdate, getWorkerReleaseChannel } from './update/worker-release'
import { getNumberFlag, getStringFlag, hasFlag, parseCliFlags } from './cli-flags'
import { runCli } from './cli'
import { getCliName, hasHelpFlag, hasVersionFlag, isCanonicalCliName, isHelpFlag, isVersionFlag } from './cli/help'
import { confirmDangerousAction } from './cli/confirm'
import { createPlatformService } from './service/service-factory'
import {
  buildWorkerServiceEnv,
  ensureServiceLogDir,
  formatServiceStatus,
  getDefaultWorkerServiceName,
  getWorkerServiceLogDir,
  resolveWorkerInstallPrefix,
  resolveWorkerServiceCommand,
} from './service/service-common'

const loadWorkerEnv = () => {
  const dotenvPath = process.env.DOTENV_CONFIG_PATH?.trim()
  if (dotenvPath) {
    dotenv.config({ path: dotenvPath, quiet: true })
    bridgeWemuxEnvToLegacy()
    return
  }

  // Installed npm workers should not inherit a random repo's .env by cwd.
  if (getWorkerPackageJson().name?.trim() === 'vibemux') {
    dotenv.config({ quiet: true })
    bridgeWemuxEnvToLegacy()
  }
}

const rawCliArgs = process.argv.slice(2)
const usesWorkerNamespace = rawCliArgs[0] === 'worker'
const normalizedCliArgs = usesWorkerNamespace ? rawCliArgs.slice(1) : rawCliArgs
const isCanonicalCli = isCanonicalCliName(getEnv('WEMUX_CLI_NAME'))
const command = normalizedCliArgs[0] || (isCanonicalCli ? 'help' : 'daemon')
const commandArgs = normalizedCliArgs.slice(1)

const workerCommands = new Set([
  'bootstrap',
  'connect',
  'daemon',
  'desktop-sandbox',
  'doctor',
  'mcp-connector-stdio',
  'mcp-stdio',
  'mesh',
  'open',
  'reset',
  'runtime-smoke',
  'service',
  'status',
  'unpair',
  'update',
])

const getCliHelpArgs = () => {
  if (usesWorkerNamespace) {
    return normalizedCliArgs.length > 0 ? ['worker', ...normalizedCliArgs] : ['worker', '--help']
  }
  if (workerCommands.has(command) && (hasHelpFlag(commandArgs) || hasVersionFlag(commandArgs))) {
    return ['worker', command, ...commandArgs]
  }
  return rawCliArgs
}

if (command !== 'mcp-stdio') {
  loadWorkerEnv()
}

const initialConfig = loadWorkerConfig()
updateWorkerRuntimeState({
  daemonMode: 'idle',
  paired: Boolean(initialConfig.executorId && initialConfig.executorToken),
  connected: false,
  executorId: initialConfig.executorId,
  config: initialConfig,
})

const runtimeGuardedCommands = new Set(['daemon', 'open'])
const skipRuntimeGuard = getEnv('WEMUX_WORKER_SKIP_RUNTIME_GUARD') === 'true'
const requestExit = () => {
  setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGTERM')
    } catch {
      process.exit(0)
    }
  }, 250)
}

const resolveBootstrapTarget = (rawTarget: string): WorkerRuntimeTarget => {
  if (rawTarget === 'all' || rawTarget === 'base' || rawTarget === 'Codex' || rawTarget === 'ClaudeCode' || rawTarget === 'Pi' || rawTarget === 'OpenCode') {
    return rawTarget
  }

  throw new Error(`Unknown bootstrap target: ${rawTarget}`)
}

const startWorkerDaemonAfterConnect = async () => {
  const bootstrap = await ensureWorkerRuntimeReadyInteractive('connect', 'all')
  if (bootstrap.status !== 'ready') {
    process.exitCode = 1
    return
  }

  await runWorkerDaemon()
}

const runWorkerConnect = async (args: string[]) => {
  const flags = parseCliFlags(args)
  const pairingCode = getStringFlag(flags, 'pairing-code')
  const serverUrl = getStringFlag(flags, 'server-url')
  const executorName = getStringFlag(flags, 'name')
  const noStart = hasFlag(flags, 'no-start') || hasFlag(flags, 'pair-only')
  const current = loadWorkerConfig()
  const normalizedPairingCode = normalizeReusablePairingCode(pairingCode)

  if (!pairingCode) {
    throw new Error(buildMissingPairingCodeMessage(hasSavedWorkerPairing(current)))
  }

  if (shouldReuseSavedWorkerPairing(pairingCode, current)) {
    const nextConfig = {
      ...current,
      cloudUrl: serverUrl || current.cloudUrl,
      executorName: executorName || current.executorName?.trim() || `worker-${process.pid}`,
    }

    saveWorkerConfig(nextConfig)
    updateWorkerRuntimeState({
      daemonMode: 'starting',
      paired: true,
      connected: false,
      executorId: nextConfig.executorId,
      config: nextConfig,
      lastError: undefined,
    })
    console.log(`[worker] ${buildSavedPairingCodeReuseMessage()}`)
    if (noStart) {
      console.log('[worker] pairing saved; daemon start skipped by --no-start')
      return
    }
    await startWorkerDaemonAfterConnect()
    return
  }

  const requestedExecutorName = executorName || current.executorName?.trim() || `worker-${process.pid}`
  const nextBaseConfig = {
    ...current,
    cloudUrl: serverUrl || current.cloudUrl,
  }

  let paired: Awaited<ReturnType<typeof pairWithControlPlane>>

  try {
    paired = await pairWithControlPlane({
      pairingCode,
      machineId: nextBaseConfig.machineId,
      machineName: nextBaseConfig.machineName,
      name: requestedExecutorName,
      workspaceRoot: nextBaseConfig.workspaceRoot,
      maxConcurrency: nextBaseConfig.maxConcurrency,
      labels: nextBaseConfig.labels,
      capabilities: nextBaseConfig.capabilities,
      platform: process.platform,
      version: getWorkerVersion(),
    }, nextBaseConfig.cloudUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pair request failed.'
    throw new Error(buildConnectPairingFailureMessage(message, hasSavedWorkerPairing(current)))
  }

  const nextConfig = {
    ...nextBaseConfig,
    executorName: requestedExecutorName,
    executorId: paired.executorId,
    executorToken: paired.executorToken,
    lastPairedPairingCode: normalizedPairingCode,
  }

  saveWorkerConfig(nextConfig)
  updateWorkerRuntimeState({
    daemonMode: 'starting',
    paired: true,
    connected: false,
    executorId: paired.executorId,
    config: nextConfig,
    lastError: undefined,
  })
  console.log(`[worker] paired ${nextConfig.machineName} to ${nextConfig.cloudUrl} as ${requestedExecutorName}`)
  if (noStart) {
    console.log('[worker] pairing saved; daemon start skipped by --no-start')
    return
  }
  await startWorkerDaemonAfterConnect()
}

const runWorkerService = async (args: string[]) => {
  const subcommand = args[0] || 'status'
  const flags = parseCliFlags(args.slice(1))
  const serviceName = getStringFlag(flags, 'name') || getDefaultWorkerServiceName()
  const service = await createPlatformService(serviceName)

  switch (subcommand) {
    case 'install': {
      const serviceCommand = resolveWorkerServiceCommand(getStringFlag(flags, 'worker-path'), getStringFlag(flags, 'install-prefix'))
      const logDir = ensureServiceLogDir(getStringFlag(flags, 'log-dir') || getWorkerServiceLogDir())
      await service.install({
        serviceName,
        workerPath: serviceCommand.workerPath,
        args: [...serviceCommand.args, ...(isCanonicalCli ? ['worker', 'daemon'] : ['daemon'])],
        env: buildWorkerServiceEnv({
          workerPath: serviceCommand.executablePath,
          installPrefix: getStringFlag(flags, 'install-prefix') || serviceCommand.installPrefix || resolveWorkerInstallPrefix(serviceCommand.executablePath),
        }),
        logDir,
        restartOnFailure: !hasFlag(flags, 'no-restart'),
        restartDelayMs: getNumberFlag(flags, 'restart-delay-ms', 5000),
        autoStart: !hasFlag(flags, 'no-start'),
      })
      console.log(`[worker] service installed: ${serviceName}`)
      return
    }
    case 'uninstall': {
      await service.uninstall()
      console.log(`[worker] service uninstalled: ${serviceName}`)
      return
    }
    case 'start': {
      await service.start()
      console.log(`[worker] service started: ${serviceName}`)
      return
    }
    case 'stop': {
      await service.stop()
      console.log(`[worker] service stopped: ${serviceName}`)
      return
    }
    case 'restart': {
      await service.restart()
      console.log(`[worker] service restarted: ${serviceName}`)
      return
    }
    case 'status': {
      console.log(formatServiceStatus(await service.status()))
      return
    }
    case 'logs': {
      const lines = getNumberFlag(flags, 'lines', getNumberFlag(flags, 'n', 100))
      for await (const line of service.logs({
        lines,
        follow: hasFlag(flags, 'follow') || hasFlag(flags, 'f'),
        errorsOnly: hasFlag(flags, 'errors-only'),
      })) {
        console.log(line)
      }
      return
    }
    case 'supervisor': {
      if (process.platform !== 'win32') {
        throw new Error('The service supervisor command is only supported on Windows.')
      }
      const { WindowsService } = await import('./service/windows-service')
      await new WindowsService(serviceName).runSupervisorLoop()
      return
    }
    default:
      throw new Error(`Unknown service command: ${subcommand}`)
  }
}

const runWorkerUpdate = async (args: string[]) => {
  const flags = parseCliFlags(args)
  if (hasFlag(flags, 'check')) {
    const result = await checkForWorkerUpdate()
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const serviceName = getStringFlag(flags, 'service-name') || getStringFlag(flags, 'name') || getDefaultWorkerServiceName()
  const config = loadWorkerConfig()
  const candidates = buildWorkerConsolePortCandidates({
    environment: resolveWorkerConsolePortEnvironment({
      explicitEnvironment: getEnv('WEMUX_WORKER_PORT_PROFILE'),
      nodeEnv: process.env.NODE_ENV,
      releaseChannel: getWorkerReleaseChannel(),
      cloudUrl: config.cloudUrl,
    }),
    preferredPort: config.localServerPort,
  })
  const activeWorkerUrls = await Promise.all(candidates.map(async (port) => {
    const localUrl = getLocalWorkerConsoleUrl(port)
    try {
      const response = await fetch(`${localUrl}/api/local-access/identity`, {
        signal: AbortSignal.timeout(750),
      })
      const identity = response.ok ? await response.json() as { executorId?: string } : null
      return identity?.executorId && identity.executorId === config.executorId ? localUrl : null
    } catch {
      return null
    }
  }))
  const activeWorkerUrl = activeWorkerUrls.find((url): url is string => Boolean(url))
  if (activeWorkerUrl) {
    const response = await fetch(`${activeWorkerUrl}/api/update`, { method: 'POST' })
    const result = await response.json() as WorkerUpdateStartResult
    if (!response.ok) {
      throw new Error(result.message || `Worker 更新请求失败，HTTP ${response.status}`)
    }
    console.log(`[worker] ${result.message}`)
    return
  }

  const service = await createPlatformService(serviceName)
  if ((await service.status()).running) {
    throw new Error('Worker 服务正在运行，但本地管理接口不可用；为避免中断执行，本次更新已取消。')
  }

  const result = await beginWorkerSelfUpdate(undefined, {
    restartServiceAfterApply: true,
    serviceName,
  })
  console.log(`[worker] ${result.message}`)
  if (result.applied) {
    requestExit()
  }
}

const main = async () => {
  // 更新管线冒烟检查：模块图能完整加载到此处即代表依赖解析成功；
  // 不做任何副作用，由 worker-updater 在 staging 换入前调用（见 2026-08-23 故障复盘）。
  if (command === WORKER_ENTRY_SMOKE_COMMAND) {
    return
  }

  if (isHelpFlag(command) || isVersionFlag(command) || command === 'help' || hasHelpFlag(commandArgs) || hasVersionFlag(commandArgs)) {
    await runCli(getCliHelpArgs())
    return
  }

  // 品牌迁移兼容：wemux 域名未上线期间，默认 cloud URL 自动回退 vibemux（探测不阻塞主流程，超时后按乐观默认处理）
  await Promise.race([
    warmDefaultCloudUrlFallback(),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ])

  if (isCanonicalCli && !usesWorkerNamespace && workerCommands.has(command)) {
    throw new Error(`Worker commands live under "${getCliName()} worker". Run "${getCliName()} worker ${command}" instead.`)
  }

  if (runtimeGuardedCommands.has(command) && !skipRuntimeGuard) {
    const bootstrap = await ensureWorkerRuntimeReadyInteractive(command, 'all')
    if (bootstrap.status !== 'ready') {
      process.exitCode = 1
      return
    }
  }

  switch (command) {
    case 'connect': {
      await runWorkerConnect(commandArgs)
      return
    }
    case 'daemon': {
      await runWorkerDaemon()
      return
    }
    case 'open': {
      await runWorkerOpen()
      return
    }
    case 'doctor': {
      await runWorkerDoctor()
      return
    }
    case 'bootstrap': {
      const flags = parseCliFlags(commandArgs)
      const target = resolveBootstrapTarget(getStringFlag(flags, 'target') || 'base')
      const report = await ensureWorkerRuntimeReady({
        autoInstall: true,
        target,
      })

      if (hasFlag(flags, 'json')) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        console.log(`[worker] ${report.message}`)
        for (const item of report.items) {
          console.log(`- ${item.label}: ${item.detail}`)
        }
      }

      if (!report.ok) {
        process.exitCode = 1
      }
      return
    }
    case 'desktop-sandbox': {
      await runDesktopSandboxCli(commandArgs)
      return
    }
    case 'runtime-smoke': {
      await runWorkerRuntimeSmokeCli(commandArgs)
      return
    }
    case 'reset': {
      await confirmDangerousAction(parseCliFlags(commandArgs), 'Clear all local worker configuration')
      resetWorkerConfig()
      console.log('[worker] local config cleared')
      return
    }
    case 'unpair': {
      clearWorkerPairing()
      console.log('[worker] pairing cleared')
      return
    }
    case 'service': {
      await runWorkerService(commandArgs)
      return
    }
    case 'mesh': {
      await runWorkerMeshCli(commandArgs)
      return
    }
    case 'mcp-stdio': {
      await runMcpStdioBridge()
      return
    }
    case 'mcp-connector-stdio': {
      await runMcpConnectorStdioBridge()
      return
    }
    case 'update': {
      await runWorkerUpdate(commandArgs)
      return
    }
    case 'apply-update-internal': {
      const archivePath = process.argv[3]
      const targetRoot = process.argv[4]
      const parentPid = Number(process.argv[5] || '0')
      const restartServiceFlagIndex = process.argv.indexOf('--restart-service')
      await applyWorkerSelfUpdate(archivePath, targetRoot, parentPid, {
        stagingPrefix: process.argv.includes('--staging-prefix'),
        serviceManaged: process.argv.includes('--service-managed'),
        restartServiceName: restartServiceFlagIndex >= 0 ? process.argv[restartServiceFlagIndex + 1] : undefined,
      })
      return
    }
    // Platform resource commands use the control-plane CLI router.
    case 'project':
    case 'task':
    case 'workspace':
    case 'agent':
    case 'node':
    case 'mcp':
    case 'skill': {
      await runCli(normalizedCliArgs)
      return
    }
    case 'status': {
      await runCli(['status', ...commandArgs])
      return
    }
    default: {
      if (usesWorkerNamespace) {
        throw new Error(`Unknown command "worker ${command}". Run "${getCliName()} worker --help" for usage.`)
      }
      await runCli(normalizedCliArgs)
      return
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'worker command failed')
  process.exitCode = 1
})
