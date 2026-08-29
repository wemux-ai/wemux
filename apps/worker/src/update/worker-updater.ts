/**
 * [INPUT]: Release checks, installed worker layout, service restart strategy, and update policy.
 * [OUTPUT]: Staged worker updates, package replacement, and restart handoff results.
 * [POS]: Worker update installer; daemon lifecycle code decides when it is safe to invoke updates.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path, { delimiter } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { normalizeWorkerUpdateSettings } from '@shared/agent-config'
import { createSafeGitProcessEnv } from '@shared/git-auth'
import { getWorkerAppRoot, getWorkerEntryPath, getWorkerLauncherPath, getWorkerPackageJson, resolveNpmWorkerInstallPrefixFromAppRoot } from '../core/app-root'
import { loadWorkerConfig } from '../core/config'
import { getProcessPathValue, setProcessPathValue } from '../core/command-utils'
import { checkForWorkerUpdate, type WorkerUpdateCheckResult } from './worker-release'
import {
  buildWorkerServiceEnv,
  ensureServiceLogDir,
  getDefaultWorkerBinName,
  getDefaultWorkerServiceName,
  getInstalledWorkerExecutablePath,
  resolveWorkerInstallPrefix,
  resolveWorkerServiceCommand,
} from '../service/service-common'
import { createPlatformService } from '../service/service-factory'

export type WorkerUpdateStartResult = {
  ok: boolean
  applied: boolean
  scheduled?: boolean
  currentVersion: string
  latestVersion?: string
  message: string
}

type WorkerSelfUpdateOptions = {
  restartServiceAfterApply?: boolean
  serviceName?: string
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Clean up stale staging and backup directories left behind by failed or
 * interrupted previous update attempts. Each directory is ~500MB+ so they
 * accumulate quickly and can fill the disk.
 */
export const cleanupStaleWorkerUpdateDirs = () => {
  const prefixes = resolveInstalledNpmWorkerPrefix()
  const searchDirs: string[] = []

  // npm-installed worker: stage/backup sit next to the install prefix
  if (prefixes) {
    searchDirs.push(path.dirname(prefixes))
  }

  // Also check home directory for legacy or standalone installs
  searchDirs.push(os.homedir())

  for (const dir of searchDirs) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (
        entry.startsWith('.vibemux-worker-stage-')
        || entry.startsWith('.vibemux-worker-backup-')
        || entry.startsWith('.vibemux-worker-stage_')
        || entry.startsWith('.vibemux-worker-backup_')
      ) {
        const fullPath = path.join(dir, entry)
        try {
          rmSync(fullPath, { recursive: true, force: true })
          console.log(`[worker] 清理旧更新残留: ${fullPath}`)
        } catch {
          // Best-effort cleanup, don't block the update
        }
      }
    }
  }
}

let updateCheckInFlight = false
let lastNotifiedVersion: string | null = null

const AUTO_UPDATE_DISABLED_VALUES = new Set(['0', 'false', 'off'])
const AUTO_UPDATE_ENABLED_VALUES = new Set(['1', 'true', 'on'])

const ensurePackagedWorker = () => {
  return existsSync(getWorkerLauncherPath()) && existsSync(getWorkerEntryPath())
}

const isNpmWorkerPackage = () => {
  const packageName = getWorkerPackageJson().name?.trim() || ''
  // 兼容窗口：存量 vibemux-* 与迁移后的 wemux-* 包名都按 npm 安装包处理
  return packageName === 'vibemux-worker'
    || packageName === 'vibemux-worker-preview'
    || packageName === 'wemux-worker'
    || packageName === 'wemux-worker-preview'
}

const hasNpmWorkerPackageInPrefix = (installPrefix: string) => {
  const packageName = getWorkerPackageJson().name?.trim() || ''
  return Boolean(packageName && (
    existsSync(path.join(installPrefix, 'lib', 'node_modules', packageName, 'package.json'))
    || existsSync(path.join(installPrefix, 'node_modules', packageName, 'package.json'))
  ))
}

const resolveInstalledNpmWorkerPrefix = () => {
  const candidateFromEnvPrefix = process.env.VIBEMUX_WORKER_INSTALL_PREFIX?.trim()
  if (candidateFromEnvPrefix && hasNpmWorkerPackageInPrefix(candidateFromEnvPrefix)) {
    return path.resolve(candidateFromEnvPrefix)
  }

  const candidateFromExecutable = resolveWorkerInstallPrefix(process.env.VIBEMUX_WORKER_EXECUTABLE_PATH || process.argv[1])
  if (candidateFromExecutable && hasNpmWorkerPackageInPrefix(candidateFromExecutable)) {
    return candidateFromExecutable
  }

  const packageName = getWorkerPackageJson().name?.trim() || ''
  const candidateFromAppRoot = resolveNpmWorkerInstallPrefixFromAppRoot(getWorkerAppRoot(), packageName)
  if (candidateFromAppRoot && hasNpmWorkerPackageInPrefix(candidateFromAppRoot)) {
    return candidateFromAppRoot
  }

  return ''
}

const shouldUseSupervisorRestart = () => {
  const strategy = process.env.VIBEMUX_WORKER_RESTART_STRATEGY?.trim().toLowerCase()
  if (strategy === 'pm2' || strategy === 'supervisor' || strategy === 'system-service' || strategy === 'service' || strategy === 'docker') {
    return true
  }

  return Boolean(process.env.pm_id?.trim())
}

export const canAutoApplyWorkerUpdateInCurrentProcess = () => shouldUseSupervisorRestart()

const isServiceRestartStrategy = () => {
  const strategy = process.env.VIBEMUX_WORKER_RESTART_STRATEGY?.trim().toLowerCase()
  return strategy === 'system-service' || strategy === 'service'
}

export const resolveAutoUpdateApplyOptions = (): WorkerSelfUpdateOptions | undefined => {
  if (!isServiceRestartStrategy()) {
    return undefined
  }

  return {
    restartServiceAfterApply: true,
    serviceName: getDefaultWorkerServiceName(),
  }
}

const waitForProcessExit = async (pid: number) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      process.kill(pid, 0)
      await wait(500)
    } catch {
      return
    }
  }

  throw new Error(`等待旧 Worker 退出超时: ${pid}`)
}

const downloadAsset = async (url: string) => {
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`下载更新包失败，HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const updateDir = path.join(os.tmpdir(), 'wemux-worker-updates')
  mkdirSync(updateDir, { recursive: true })
  const archivePath = path.join(updateDir, `worker-${Date.now()}.tar.gz`)
  writeFileSync(archivePath, buffer)
  return archivePath
}

const extractArchive = (archivePath: string, destinationDir: string) => {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destinationDir], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || '解压更新包失败')
  }
}

const restartUpdatedWorker = (targetRoot: string) => {
  spawn(getInstalledWorkerExecutablePath(targetRoot), ['daemon'], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}

const npmExecutableName = () => process.platform === 'win32' ? 'npm.cmd' : 'npm'

const isExecutableFile = (targetPath: string) => {
  if (!existsSync(targetPath)) {
    return false
  }

  try {
    accessSync(targetPath, constants.X_OK)
    return true
  } catch {
    return process.platform === 'win32'
  }
}

export const resolveNpmCommandForWorkerUpdate = (
  execPath = process.execPath,
) => {
  const adjacentNpmPath = path.join(path.dirname(execPath), npmExecutableName())
  if (isExecutableFile(adjacentNpmPath)) {
    return adjacentNpmPath
  }

  return npmExecutableName()
}

export const buildWorkerUpdateNpmEnv = (
  source: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
) => {
  const env = createSafeGitProcessEnv(source)
  const nodeBinDir = path.dirname(execPath)
  const currentPath = getProcessPathValue(env) || getProcessPathValue(source)
  const pathEntries = currentPath.split(delimiter).filter(Boolean)
  if (!pathEntries.includes(nodeBinDir)) {
    setProcessPathValue(env, currentPath ? `${nodeBinDir}${delimiter}${currentPath}` : nodeBinDir)
  }
  return env
}

/**
 * 更新管线冒烟参数：staging 安装完成后用该参数启动一次入口，
 * 模块图能完整加载到 main() 即代表依赖解析成功（防 2026-08-23 类型包损坏再发）。
 */
export const WORKER_ENTRY_SMOKE_COMMAND = '--update-smoke-check'

/**
 * 在给定安装根（npm prefix 或便携包目录）下定位 worker 入口文件。
 * 兼容三种布局：npm prefix（lib/node_modules/<pkg>）、扁平 node_modules、便携包目录。
 */
export const resolveWorkerEntryPathInRoot = (root: string, packageName: string) => {
  const entryRelativePath = path.join('dist-worker', 'apps', 'worker', 'src', 'index.js')
  const candidates = packageName
    ? [
        path.join(root, 'lib', 'node_modules', packageName, entryRelativePath),
        path.join(root, 'node_modules', packageName, entryRelativePath),
      ]
    : []
  candidates.push(path.join(root, entryRelativePath))
  return candidates.find((candidate) => existsSync(candidate)) || ''
}

export const smokeCheckStagedWorkerRoot = (params: {
  root: string
  packageName: string
  spawnSyncImpl?: typeof spawnSync
  timeoutMs?: number
}) => {
  const entryPath = resolveWorkerEntryPathInRoot(params.root, params.packageName)
  if (!entryPath) {
    throw new Error(`staging 中未找到 worker 入口文件，更新已中止: ${params.root}`)
  }

  const spawnSyncImpl = params.spawnSyncImpl ?? spawnSync
  const result = spawnSyncImpl(process.execPath, [entryPath, WORKER_ENTRY_SMOKE_COMMAND], {
    encoding: 'utf8',
    timeout: params.timeoutMs ?? 30_000,
    env: buildWorkerUpdateNpmEnv(),
  })

  if (result.error) {
    throw new Error(`worker staging 冒烟校验无法启动: ${result.error.message}`)
  }
  if (result.status !== 0 || result.signal) {
    const stderrTail = (result.stderr || '').trim().split('\n').slice(-6).join('\n')
    throw new Error(`worker staging 冒烟校验失败（exit=${result.status ?? result.signal}），已中止替换:\n${stderrTail}`)
  }
}

const installNpmPackageIntoPrefix = (packageName: string, version: string, targetPrefix: string, packageUrl?: string) => {
  mkdirSync(targetPrefix, { recursive: true })
  const packageSpec = packageUrl || `${packageName}@${version}`
  const npmCmd = resolveNpmCommandForWorkerUpdate()
  const npmArgs = ['install', '--silent', '--no-fund', '--no-audit', '-g', '--prefix', targetPrefix, packageSpec]
  const npmOpts = { encoding: 'utf8' as const, env: buildWorkerUpdateNpmEnv() }
  let result = spawnSync(npmCmd, npmArgs, npmOpts)
  if (process.platform === 'win32' && result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EINVAL') {
      result = spawnSync(npmCmd, npmArgs, { ...npmOpts, shell: true })
    }
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || 'npm install worker update failed')
  }

  const binPath = getInstalledWorkerExecutablePath(targetPrefix)
  if (!existsSync(binPath)) {
    throw new Error(`更新后的 Worker 可执行文件不存在: ${binPath}`)
  }

  // 换入前先证明 staging 能完整加载：npm 覆盖安装可能产出缺文件的合并树（见 2026-08-23 故障复盘）。
  smokeCheckStagedWorkerRoot({ root: targetPrefix, packageName })
}

export const shouldApplyNpmWorkerUpdateOutOfProcess = () => isServiceRestartStrategy() || process.platform === 'win32'

export const buildNpmWorkerUpdateApplyArgs = (params: {
  stagingPrefix: string
  installPrefix: string
  parentPid: number
  serviceName: string
}) => [
  getWorkerEntryPath(),
  'apply-update-internal',
  params.stagingPrefix,
  params.installPrefix,
  String(params.parentPid),
  '--staging-prefix',
  '--service-managed',
  '--restart-service',
  params.serviceName,
]

/**
 * Re-register the worker service against a freshly installed npm prefix.
 *
 * npm-layout updates replace the whole install prefix, so the existing service
 * registration can end up pointing at paths that no longer resolve (e.g. a
 * preserved standalone-layout node wrapper whose dist-worker was removed),
 * leaving the worker crash-looping after every update. Rewriting the
 * registration from the new install keeps the plist/systemd unit in sync.
 */
export const reinstallWorkerServiceRegistration = async (params: {
  service: import('../service/platform-service').PlatformService
  installPrefix: string
  serviceName: string
  logDir?: string
  workerPath?: string
}) => {
  const serviceCommand = resolveWorkerServiceCommand(params.workerPath, params.installPrefix)
  await params.service.install({
    serviceName: params.serviceName,
    workerPath: serviceCommand.workerPath,
    args: [...serviceCommand.args, 'daemon'],
    env: buildWorkerServiceEnv({
      workerPath: serviceCommand.executablePath,
      installPrefix: params.installPrefix,
    }),
    logDir: params.logDir ?? ensureServiceLogDir(),
    restartOnFailure: true,
    restartDelayMs: 5000,
    autoStart: true,
  })
  return serviceCommand
}

export const preserveWorkerInstallerWrapper = (backupRoot: string, targetRoot: string) => {
  const wrapperName = `${getDefaultWorkerBinName()}-node-wrapper`
  const backupWrapperPath = path.join(backupRoot, 'bin', wrapperName)
  if (!existsSync(backupWrapperPath)) {
    return false
  }

  const targetWrapperPath = path.join(targetRoot, 'bin', wrapperName)
  mkdirSync(path.dirname(targetWrapperPath), { recursive: true })
  rmSync(targetWrapperPath, { force: true })
  copyFileSync(backupWrapperPath, targetWrapperPath)
  chmodSync(targetWrapperPath, 0o755)
  return true
}

export const resolveWorkerUpdateExitMode = (
  config = loadWorkerConfig(),
): 'manual' | 'auto' => {
  const envValue = process.env.VIBEMUX_WORKER_AUTO_UPDATE?.trim().toLowerCase()
  if (envValue && AUTO_UPDATE_ENABLED_VALUES.has(envValue)) {
    return 'auto'
  }

  if (envValue && AUTO_UPDATE_DISABLED_VALUES.has(envValue)) {
    return 'manual'
  }

  return normalizeWorkerUpdateSettings(config.workerUpdateSettings).exitMode
}

export const beginWorkerSelfUpdate = async (
  prefetchedCheck?: WorkerUpdateCheckResult,
  options?: WorkerSelfUpdateOptions,
): Promise<WorkerUpdateStartResult> => {
  cleanupStaleWorkerUpdateDirs()

  const check = prefetchedCheck ?? await checkForWorkerUpdate()
  if (!check.ok || !check.available) {
    return {
      ok: check.ok,
      applied: false,
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      message: check.message,
    }
  }

  if (!check.asset) {
    if (!check.packageName || !check.latestVersion) {
      return {
        ok: false,
        applied: false,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: '缺少 npm 更新目标信息，无法自动更新。',
      }
    }

    if (!isNpmWorkerPackage()) {
      return {
        ok: false,
        applied: false,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: '当前不是 npm Worker 安装方式，无法自动更新。',
      }
    }

    const installPrefix = resolveInstalledNpmWorkerPrefix()
    if (isServiceRestartStrategy() || installPrefix) {
      if (!installPrefix) {
        return {
          ok: false,
          applied: false,
          currentVersion: check.currentVersion,
          latestVersion: check.latestVersion,
          message: '当前服务缺少 VIBEMUX_WORKER_INSTALL_PREFIX，无法安全自动更新。',
        }
      }

      const stagingPrefix = path.join(path.dirname(installPrefix), `.vibemux-worker-stage-${Date.now()}`)
      try {
        installNpmPackageIntoPrefix(check.packageName, check.latestVersion, stagingPrefix, check.packageUrl)
      } catch (error) {
        rmSync(stagingPrefix, { recursive: true, force: true })
        throw error
      }

      preserveWorkerInstallerWrapper(installPrefix, stagingPrefix)
      const serviceName = options?.serviceName || getDefaultWorkerServiceName()
      if (options?.restartServiceAfterApply && process.platform !== 'win32') {
        const oldPrefix = `${installPrefix}.old-${Date.now()}`
        renameSync(installPrefix, oldPrefix)
        renameSync(stagingPrefix, installPrefix)
        rmSync(oldPrefix, { recursive: true, force: true })
        const service = await createPlatformService(serviceName)
        await reinstallWorkerServiceRegistration({
          service,
          installPrefix,
          serviceName,
        })
      } else if (shouldApplyNpmWorkerUpdateOutOfProcess()) {
        spawn(process.execPath, buildNpmWorkerUpdateApplyArgs({
          stagingPrefix,
          installPrefix,
          parentPid: process.pid,
          serviceName,
        }), {
          detached: true,
          stdio: 'ignore',
          env: buildWorkerUpdateNpmEnv(),
        }).unref()
      } else {
        const oldPrefix = `${installPrefix}.old-${Date.now()}`
        renameSync(installPrefix, oldPrefix)
        renameSync(stagingPrefix, installPrefix)
        rmSync(oldPrefix, { recursive: true, force: true })
      }

      return {
        ok: true,
        applied: true,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: `已安装 ${check.latestVersion} 到 staging，Worker 即将退出并完成替换。`,
      }
    }

    if (shouldUseSupervisorRestart()) {
      return {
        ok: true,
        applied: true,
        currentVersion: check.currentVersion,
        latestVersion: check.latestVersion,
        message: `检测到新版本 ${check.latestVersion}，即将退出并交给外部 supervisor 重启。`,
      }
    }

    return {
      ok: false,
      applied: false,
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      message: '当前 Worker 不是 service/supervisor/docker restart policy 管理方式；请使用受管安装方式后再自动更新。',
    }
  }

  if (!ensurePackagedWorker()) {
    return {
      ok: false,
      applied: false,
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      message: '当前不是便携 Worker 安装目录，无法执行自更新。',
    }
  }

  const archivePath = await downloadAsset(check.asset.url)
  spawn(process.execPath, [
    getWorkerEntryPath(),
    'apply-update-internal',
    archivePath,
    getWorkerAppRoot(),
    String(process.pid),
    ...(isServiceRestartStrategy() ? ['--service-managed'] : []),
  ], {
    detached: true,
    stdio: 'ignore',
    env: createSafeGitProcessEnv(process.env),
  }).unref()

  return {
    ok: true,
    applied: true,
    currentVersion: check.currentVersion,
    latestVersion: check.latestVersion,
    message: `已开始更新到 ${check.latestVersion}，Worker 即将重启。`,
  }
}

export const maybeAutoApplyWorkerUpdate = async (prefetchedCheck?: WorkerUpdateCheckResult) => {
  if (updateCheckInFlight) {
    return false
  }

  updateCheckInFlight = true

  try {
    const check = prefetchedCheck ?? await checkForWorkerUpdate()
    if (!check.ok || !check.available || !check.latestVersion) {
      lastNotifiedVersion = null
      return false
    }

    if (lastNotifiedVersion === check.latestVersion) {
      return false
    }

    if (resolveWorkerUpdateExitMode() === 'manual') {
      lastNotifiedVersion = check.latestVersion
      console.log(`[worker] 检测到新版本 ${check.latestVersion}，当前策略为手动退出，请在方便时手动更新或重启节点。`)
      return false
    }

    if (!canAutoApplyWorkerUpdateInCurrentProcess()) {
      lastNotifiedVersion = check.latestVersion
      console.log(`[worker] 检测到新版本 ${check.latestVersion}，但当前 Worker 不是 service/supervisor/docker restart policy 管理方式，跳过后台自动更新以避免节点退出。`)
      return false
    }

    const result = await beginWorkerSelfUpdate(check, resolveAutoUpdateApplyOptions())
    console.log(`[worker] ${result.message}`)
    lastNotifiedVersion = result.applied ? check.latestVersion : null
    return result.applied
  } catch (error) {
    lastNotifiedVersion = null
    throw error
  } finally {
    updateCheckInFlight = false
  }
}

export const applyWorkerSelfUpdate = async (
  archivePathOrStagingPrefix: string,
  targetRoot: string,
  parentPid: number,
  options?: { stagingPrefix?: boolean; serviceManaged?: boolean; restartServiceName?: string },
) => {
  await waitForProcessExit(parentPid)
  const service = options?.restartServiceName
    ? await createPlatformService(options.restartServiceName)
    : null
  if (service) {
    await service.stop().catch(() => undefined)
    await wait(1000)
  }

  const parentDir = path.dirname(targetRoot)
  const stagingDir = options?.stagingPrefix ? archivePathOrStagingPrefix : path.join(parentDir, `.vibemux-worker-stage-${Date.now()}`)
  const backupDir = path.join(parentDir, `.vibemux-worker-backup-${Date.now()}`)
  if (!options?.stagingPrefix) {
    mkdirSync(stagingDir, { recursive: true })
    extractArchive(archivePathOrStagingPrefix, stagingDir)
  }

  const extractedRoot = options?.stagingPrefix
    ? stagingDir
    : path.join(stagingDir, readdirSync(stagingDir)[0] || '')
  if (!extractedRoot || !existsSync(extractedRoot)) {
    throw new Error('更新包内容为空')
  }
  if (!options?.stagingPrefix) {
    smokeCheckStagedWorkerRoot({ root: extractedRoot, packageName: getWorkerPackageJson().name?.trim() || '' })
  }
  renameSync(targetRoot, backupDir)

  try {
    renameSync(extractedRoot, targetRoot)
  } catch (error) {
    renameSync(backupDir, targetRoot)
    throw error
  }
  preserveWorkerInstallerWrapper(backupDir, targetRoot)

  if (service) {
    await service.start()
  } else if (!options?.serviceManaged) {
    restartUpdatedWorker(targetRoot)
  }
  rmSync(backupDir, { recursive: true, force: true })
  if (!options?.stagingPrefix) {
    rmSync(stagingDir, { recursive: true, force: true })
    rmSync(archivePathOrStagingPrefix, { force: true })
  }
}
