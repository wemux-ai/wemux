// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Packaged runtime metadata, package identity, and source-mode release overrides.
// [OUTPUT]: The authoritative worker release channel and update target metadata.
// [POS]: Worker release boundary; packaged preview/production identity must not be changed by ambient shell variables.

import { getWorkerPackageJson, getWorkerRuntimeMetadata, getWorkerVersion } from '../core/app-root'
import { resolveDefaultCloudUrl } from '../core/default-cloud-url'
import { getEnv } from '@shared/env'

type WorkerReleaseMetadata = {
  channel?: string
  defaultCloudUrl?: string
  disableNpmUpdateCheck?: boolean
}

type NpmPackageMetadata = {
  'dist-tags'?: Record<string, string>
}

type WorkerInstallerManifest = {
  packageName?: string
  packageVersion?: string
}

export type WorkerReleaseAsset = {
  name: string
  platform: string
  arch: string
  url: string
  sha256?: string
}

export type WorkerReleaseManifest = {
  channel: string
  version: string
  publishedAt: string
  notes?: string
  assets: WorkerReleaseAsset[]
}

export type WorkerUpdateCheckResult = {
  ok: boolean
  currentVersion: string
  latestVersion?: string
  channel?: string
  available: boolean
  asset?: WorkerReleaseAsset
  packageName?: string
  packageTag?: string
  packageUrl?: string
  message: string
}

let cachedReleaseMetadata: WorkerReleaseMetadata | null = null

const getReleaseMetadata = () => {
  if (cachedReleaseMetadata) {
    return cachedReleaseMetadata
  }

  cachedReleaseMetadata = getWorkerRuntimeMetadata()

  return cachedReleaseMetadata
}

const normalizeReleaseChannel = (value?: string) => {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'preview' || normalized === 'production' ? normalized : undefined
}

export const resolveWorkerReleaseChannel = (params: {
  metadataChannel?: string
  packageName?: string
  environmentChannel?: string
}) => {
  // 兼容窗口：新老包名都识别，后续移除 vibemux-* 分支
  if (params.packageName === 'vibemux-worker-preview' || params.packageName === 'wemux-worker-preview') {
    return 'preview'
  }
  if (params.packageName === 'vibemux-worker' || params.packageName === 'wemux-worker') {
    return 'production'
  }

  const metadataChannel = normalizeReleaseChannel(params.metadataChannel)
  if (metadataChannel) {
    return metadataChannel
  }

  return normalizeReleaseChannel(params.environmentChannel) || 'production'
}

export const getPackagedWorkerReleaseChannel = () => {
  const packageName = getWorkerPackageJson().name?.trim()
  if (packageName === 'vibemux-worker-preview' || packageName === 'wemux-worker-preview') {
    return 'preview'
  }
  if (packageName === 'vibemux-worker' || packageName === 'wemux-worker') {
    return 'production'
  }

  return normalizeReleaseChannel(getReleaseMetadata().channel)
}

export const getWorkerReleaseChannel = () => {
  return resolveWorkerReleaseChannel({
    metadataChannel: getReleaseMetadata().channel,
    packageName: getWorkerPackageJson().name,
    environmentChannel: process.env.VIBEMUX_WORKER_RELEASE_CHANNEL,
  })
}

const getTargetPackageName = (channel: string, currentPackageName?: string) => {
  const suffix = channel === 'preview' ? 'worker-preview' : 'worker'
  // 兼容窗口：存量 vibemux-worker 安装继续查旧包，新装 wemux-worker 查新包
  if (currentPackageName === `vibemux-${suffix}`) {
    return `vibemux-${suffix}`
  }
  return `wemux-${suffix}`
}

const getTargetPackageTag = (channel: string) => {
  return channel === 'preview' ? 'preview' : 'latest'
}

const getRegistryUrl = () => {
  return (process.env.npm_config_registry?.trim() || 'https://registry.npmjs.org').replace(/\/$/, '')
}

const loadNpmPackageMetadata = async (packageName: string) => {
  const response = await fetch(`${getRegistryUrl()}/${packageName}`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`查询 npm 包失败，HTTP ${response.status}`)
  }

  return (await response.json()) as NpmPackageMetadata
}

const getInstallerServerUrl = () => {
  const explicitUrl = getEnv('WEMUX_WORKER_INSTALLER_URL')?.trim() || getEnv('WEMUX_INSTALL_URL')?.trim()
  if (explicitUrl) {
    return explicitUrl.replace(/\/(?:install(?:\/worker\.sh)?|install\/worker(?:\/manifest\.json)?)?$/, '')
  }

  const defaultUrl = getReleaseMetadata().defaultCloudUrl?.trim().replace(/\/$/, '') || 'https://wemux.ai'
  return resolveDefaultCloudUrl(defaultUrl)
}

const loadInstallerManifest = async (serverUrl: string) => {
  const response = await fetch(`${serverUrl}/install/worker/manifest.json`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`查询 installer manifest 失败，HTTP ${response.status}`)
  }

  return (await response.json()) as WorkerInstallerManifest
}

export const checkInstallerPackageUpdate = async (
  currentVersion: string,
  channel: string,
  packageName: string,
  packageTag: string,
): Promise<WorkerUpdateCheckResult> => {
  try {
    const serverUrl = getInstallerServerUrl()
    const manifest = await loadInstallerManifest(serverUrl)
    const latestVersion = manifest.packageVersion?.trim()
    if (manifest.packageName?.trim()) {
      // 兼容窗口：vibemux-* 与 wemux-* 包名同属一个 channel，只校验通道一致
      const manifestChannel = resolveWorkerReleaseChannel({ packageName: manifest.packageName })
      if (manifestChannel !== channel) {
        return {
          ok: false,
          currentVersion,
          channel,
          available: false,
          packageName,
          packageTag,
          message: `installer 包名通道不匹配: ${manifest.packageName}`,
        }
      }
    }

    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        channel,
        available: false,
        packageName,
        packageTag,
        message: 'installer manifest 缺少 packageVersion。',
      }
    }

    if (latestVersion === currentVersion) {
      return {
        ok: true,
        currentVersion,
        latestVersion,
        channel,
        available: false,
        packageName,
        packageTag,
        packageUrl: `${serverUrl}/install/worker/package.tgz`,
        message: `当前已是最新版本 ${currentVersion}。`,
      }
    }

    return {
      ok: true,
      currentVersion,
      latestVersion,
      channel,
      available: true,
      packageName,
      packageTag,
      packageUrl: `${serverUrl}/install/worker/package.tgz`,
      message: `检测到 installer 新版本 ${latestVersion}。`,
    }
  } catch (error) {
    return {
      ok: false,
      currentVersion,
      channel,
      available: false,
      packageName,
      packageTag,
      message: error instanceof Error ? error.message : '查询 installer 更新失败',
    }
  }
}

export const checkNpmPackageUpdate = async (
  currentVersion: string,
  channel: string,
  packageName: string,
  packageTag: string,
  options: {
    loadPackageMetadata?: typeof loadNpmPackageMetadata
    checkInstallerFallback?: typeof checkInstallerPackageUpdate
  } = {},
): Promise<WorkerUpdateCheckResult> => {
  const checkInstallerFallback = async (fallbackMessage?: string) => {
    const installerResult = await (options.checkInstallerFallback ?? checkInstallerPackageUpdate)(currentVersion, channel, packageName, packageTag)
    if (!installerResult.ok && fallbackMessage) {
      return {
        ...installerResult,
        message: `${fallbackMessage}; ${installerResult.message}`,
      }
    }
    return installerResult
  }

  try {
    const metadata = await (options.loadPackageMetadata ?? loadNpmPackageMetadata)(packageName)
    const latestVersion = metadata['dist-tags']?.[packageTag]?.trim()
    if (!latestVersion) {
      return checkInstallerFallback(`未找到 npm dist-tag: ${packageTag}`)
    }

    if (latestVersion === currentVersion) {
      return {
        ok: true,
        currentVersion,
        latestVersion,
        channel,
        available: false,
        packageName,
        packageTag,
        message: `当前已是最新版本 ${currentVersion}。`,
      }
    }

    return {
      ok: true,
      currentVersion,
      latestVersion,
      channel,
      available: true,
      packageName,
      packageTag,
      message: `检测到新版本 ${latestVersion}。`,
    }
  } catch (error) {
    return checkInstallerFallback(error instanceof Error ? error.message : '查询 npm 更新失败')
  }
}

export const checkForWorkerUpdate = async (): Promise<WorkerUpdateCheckResult> => {
  const currentVersion = getWorkerVersion()
  const channel = getWorkerReleaseChannel()
  const currentPackageName = getWorkerPackageJson().name?.trim() || ''
  const packageName = getTargetPackageName(channel, currentPackageName)
  const packageTag = getTargetPackageTag(channel)

  if (currentPackageName !== packageName) {
    return {
      ok: true,
      currentVersion,
      channel,
      available: false,
      packageName,
      packageTag,
      message: '当前是源码模式或非 npm Worker 包，跳过版本更新检查。',
    }
  }

  // worker 更新统一走 server installer（HTTP）通道，npm registry 不再参与。
  // 存量 vibemux-* 包与 wemux-* 包都能从各自 server 的 manifest / package.tgz 更新。
  return checkInstallerPackageUpdate(currentVersion, channel, packageName, packageTag)
}
