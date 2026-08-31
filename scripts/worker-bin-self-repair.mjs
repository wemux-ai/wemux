// 打包进 worker bin/ 的自修复逻辑（零第三方依赖：仅 node 内置 + 系统 tar）。
//
// 背景：2026-08-23 故障复盘——安装目录损坏时 daemon 在 import 阶段即崩溃，
// 而自动更新等自救逻辑都在 daemon 代码里，永远执行不到，只能无限崩溃循环。
// 本脚本由 bin/cli.mjs 在入口加载失败时调用，在 wrapper 层完成：
//   1. 写崩溃标记 <workerHome>/node/last-crash.json
//   2. 从控制面重新下载自包含包，rm -rf 后解包替换损坏目录
//   3. 以非零码退出，交给 launchd/systemd 重启进修复后的安装
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

export const REPAIR_THROTTLE_MS = 15 * 60 * 1000
const PACKAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const ENTRY_RELATIVE_PATH = path.join('dist-worker', 'apps', 'worker', 'src', 'index.js')

export const isRecoverableModuleLoadError = (error) => {
  const code = error?.code
  return code === 'ERR_MODULE_NOT_FOUND'
    || code === 'MODULE_NOT_FOUND'
    || code === 'ERR_FILE_NOT_FOUND'
}

export const shouldAttemptRepair = (marker, now = Date.now(), throttleMs = REPAIR_THROTTLE_MS) => {
  if (!marker || typeof marker.repairAt !== 'number') return true
  return now - marker.repairAt >= throttleMs
}

export const resolveChannelSuffixFromCliName = (cliName) => {
  if (typeof cliName !== 'string') return ''
  if (cliName.includes('-preview')) return '-preview'
  if (cliName.includes('-dev')) return '-dev'
  return ''
}

export const resolveWorkerHomeDir = ({ env = process.env, homedir = os.homedir(), channelSuffix = '' } = {}) => {
  const configured = env.WEMUX_WORKER_HOME?.trim()
  if (configured) return path.resolve(configured)
  return path.join(homedir, `.wemux${channelSuffix}`)
}

export const readCloudUrlFromWorkerHome = (workerHome) => {
  for (const relativePath of [path.join('node', 'config.json'), 'config.json']) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(workerHome, relativePath), 'utf8'))
      const cloudUrl = parsed.cloudUrl?.trim()
      if (cloudUrl) return cloudUrl.replace(/\/+$/, '')
    } catch {
      // 尝试下一个候选路径
    }
  }
  return ''
}

export const defaultCloudUrlForChannelSuffix = (channelSuffix) => {
  if (channelSuffix === '-preview') return 'https://wemux.xyz'
  return 'https://wemux.ai'
}

const writeCrashMarker = (markerPath, patch) => {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    let previous = {}
    try {
      previous = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    } catch {
      previous = {}
    }
    fs.writeFileSync(markerPath, `${JSON.stringify({ ...previous, ...patch }, null, 2)}\n`)
  } catch {
    // 标记写入失败不阻塞主流程
  }
}

const readCrashMarker = (markerPath) => {
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  } catch {
    return null
  }
}

const TAR_ENTRY_RELATIVE_PATH = 'dist-worker/apps/worker/src/index.js'

const verifyPackageArchive = ({ spawnSyncImpl, archivePath, expectedDirName }) => {
  // 精确探测成员而非全量列举：包内文件数以万计，tar 全量清单会超出 spawnSync 默认 maxBuffer（1MB）
  const members = [
    `${expectedDirName}/${TAR_ENTRY_RELATIVE_PATH}`,
    `package/${TAR_ENTRY_RELATIVE_PATH}`,
  ]
  for (const member of members) {
    const probe = spawnSyncImpl('tar', ['-tzf', archivePath, member], { encoding: 'utf8', timeout: 120_000 })
    if (probe.status === 0 && (probe.stdout || '').includes(TAR_ENTRY_RELATIVE_PATH)) return true
  }
  return false
}

const locateExtractedPackageRoot = ({ extractDir, expectedDirName }) => {
  const preferred = path.join(extractDir, expectedDirName)
  if (fs.existsSync(path.join(preferred, ENTRY_RELATIVE_PATH))) return preferred
  const fallback = path.join(extractDir, 'package')
  if (fs.existsSync(path.join(fallback, ENTRY_RELATIVE_PATH))) return fallback
  return ''
}

const replaceBrokenInstall = ({ appRoot, extractedPkgRoot }) => {
  fs.rmSync(appRoot, { recursive: true, force: true })
  try {
    fs.renameSync(extractedPkgRoot, appRoot)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    fs.cpSync(extractedPkgRoot, appRoot, { recursive: true })
    fs.rmSync(path.dirname(extractedPkgRoot), { recursive: true, force: true })
  }
  try {
    for (const entry of fs.readdirSync(path.join(appRoot, 'bin'))) {
      if (entry.endsWith('.mjs')) fs.chmodSync(path.join(appRoot, 'bin', entry), 0o755)
    }
  } catch {
    // 可执行位缺失不致命：入口都通过 node 显式执行
  }
}

const logStep = (message) => {
  console.error(`[worker-bin] ${new Date().toISOString()} ${message}`)
}

/**
 * 入口模块加载失败时的统一处理入口。
 * 返回时表示未做修复（不可恢复错误 / 节流跳过）；修复动作完成后进程会以非零码退出。
 */
export const handleEntryLoadFailure = async ({
  error,
  appRoot,
  cliName,
  env = process.env,
  homedir = os.homedir(),
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
  now = Date.now(),
} = {}) => {
  console.error(`[worker-bin] worker 入口加载失败: ${error?.code || ''} ${error?.message || error}`)

  if (!isRecoverableModuleLoadError(error)) {
    console.error('[worker-bin] 非依赖解析类错误，跳过自修复')
    return
  }

  const channelSuffix = resolveChannelSuffixFromCliName(cliName)
  const workerHome = resolveWorkerHomeDir({ env, homedir, channelSuffix })
  const markerPath = path.join(workerHome, 'node', 'last-crash.json')

  writeCrashMarker(markerPath, {
    lastCrashAt: new Date(now).toISOString(),
    lastError: `${error?.code || ''} ${error?.message || error}`.trim(),
    cliName,
  })

  const marker = readCrashMarker(markerPath)
  if (!shouldAttemptRepair(marker, now)) {
    logStep('距上次自修复尝试不足节流窗口，跳过本次（等待 supervisor 重启）')
    process.exit(1)
  }

  if (process.platform === 'win32') {
    logStep('Windows 布局暂不支持自修复，请重新运行安装器')
    process.exit(1)
  }

  // 先写 repairAt 再下载：崩溃循环中 supervisor 会频繁重入，防止并发下载风暴
  writeCrashMarker(markerPath, { repairAt: now })

  const cloudUrl = readCloudUrlFromWorkerHome(workerHome) || defaultCloudUrlForChannelSuffix(channelSuffix)
  const packageUrl = `${cloudUrl}/install/worker/package.tgz`
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wemux-worker-self-repair-'))
  const archivePath = path.join(workDir, 'package.tgz')
  const extractDir = path.join(workDir, 'extracted')

  let repairFailure = null
  try {
    logStep(`自修复：从 ${packageUrl} 下载自包含包...`)
    const response = await fetchImpl(packageUrl, { signal: AbortSignal.timeout(PACKAGE_DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok) {
      throw new Error(`下载更新包失败 HTTP ${response.status}`)
    }
    // 流式落盘：包体积 145MB+，整包缓冲在崩溃循环环境下易被系统内存压力杀掉（无任何日志的静默死亡）
    if (!response.body) {
      throw new Error('下载响应无内容')
    }
    let received = 0
    let lastLogged = 0
    const progress = new Transform({
      transform(chunk, _enc, callback) {
        received += chunk.length
        if (received - lastLogged >= 25 * 1024 * 1024) {
          lastLogged = received
          logStep(`已下载 ${Math.round(received / 1024 / 1024)}MB`)
        }
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(archivePath))
    const byteLength = fs.statSync(archivePath).size
    logStep(`下载完成：${byteLength} bytes`)
    if (byteLength < 1024 * 1024) {
      throw new Error(`下载内容异常（${byteLength} bytes），疑似非完整安装包`)
    }

    if (!verifyPackageArchive({ spawnSyncImpl, archivePath, expectedDirName: path.basename(appRoot) })) {
      throw new Error('下载包校验失败：缺少 worker 入口文件')
    }
    logStep('包校验通过，开始解压...')

    fs.mkdirSync(extractDir, { recursive: true })
    const extractResult = spawnSyncImpl('tar', ['-xzf', archivePath, '-C', extractDir], { encoding: 'utf8', timeout: 300_000 })
    if (extractResult.status !== 0) {
      throw new Error(`解压失败: ${extractResult.stderr?.trim() || extractResult.error?.message || 'tar exited non-zero'}`)
    }

    const extractedPkgRoot = locateExtractedPackageRoot({
      extractDir,
      expectedDirName: path.basename(appRoot),
    })
    if (!extractedPkgRoot) {
      throw new Error('解压结果中没有可识别的 worker 包')
    }

    replaceBrokenInstall({ appRoot, extractedPkgRoot })
    writeCrashMarker(markerPath, { repairedAt: new Date(Date.now()).toISOString() })
    logStep('自修复完成，退出后由服务管理器重启进新安装')
  } catch (repairError) {
    repairFailure = repairError
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }

  if (repairFailure) {
    logStep(`自修复失败: ${repairFailure?.message || repairFailure}`)
    process.exit(1)
  }
  process.exit(1)
}
