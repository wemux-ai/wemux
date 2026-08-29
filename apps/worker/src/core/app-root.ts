// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Worker module location, packaged metadata, package manifest, and optional runtime root.
// [OUTPUT]: Stable packaged-worker roots, identity, version, launcher, and channel-aware defaults.
// [POS]: Worker package identity boundary used before persisted configuration is available.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type WorkerPackageJson = {
  name?: string
  version?: string
}

type WorkerRuntimeMetadata = {
  channel?: string
  defaultCloudUrl?: string
  defaultLocalServerPort?: number
  disableNpmUpdateCheck?: boolean
}

let cachedAppRoot: string | null = null
let cachedPackageJson: WorkerPackageJson | null = null
let cachedRuntimeMetadata: WorkerRuntimeMetadata | null = null

const isPathInside = (targetPath: string, basePath: string) => {
  const relativePath = path.relative(basePath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const hasWorkerPackageJson = (targetPath: string) => {
  try {
    const parsed = JSON.parse(readFileSync(targetPath, 'utf8')) as WorkerPackageJson
    return Boolean(parsed.name && parsed.version)
  } catch {
    return false
  }
}

const resolveWorkerAppRoot = () => {
  const configuredRoot = process.env.VIBEMUX_RUNTIME_ROOT?.trim()
  if (configuredRoot) {
    const resolvedConfiguredRoot = path.resolve(configuredRoot)
    const currentModulePath = fileURLToPath(import.meta.url)
    if (isPathInside(currentModulePath, resolvedConfiguredRoot)) {
      return resolvedConfiguredRoot
    }
  }

  let currentDir = path.dirname(fileURLToPath(import.meta.url))
  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    if (existsSync(packageJsonPath) && hasWorkerPackageJson(packageJsonPath)) {
      return currentDir
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return process.cwd()
    }
    currentDir = parentDir
  }
}

export const getWorkerAppRoot = () => {
  if (!cachedAppRoot) {
    cachedAppRoot = resolveWorkerAppRoot()
  }

  return cachedAppRoot
}

export const getWorkerPackageJson = () => {
  if (!cachedPackageJson) {
    const packageJsonPath = path.join(getWorkerAppRoot(), 'package.json')
    cachedPackageJson = existsSync(packageJsonPath)
      ? (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as WorkerPackageJson)
      : {}
  }

  return cachedPackageJson
}

export const getWorkerRuntimeMetadata = () => {
  if (!cachedRuntimeMetadata) {
    const metadataPath = path.join(getWorkerAppRoot(), 'runtime', 'worker-release.json')
    cachedRuntimeMetadata = existsSync(metadataPath)
      ? (JSON.parse(readFileSync(metadataPath, 'utf8')) as WorkerRuntimeMetadata)
      : {}
  }

  return cachedRuntimeMetadata
}

export const getWorkerDefaultCloudUrl = () => {
  const packageName = getWorkerPackageJson().name
  // 兼容窗口：新老包名都识别；后续移除 vibemux-* 分支
  if (packageName === 'vibemux-worker-preview' || packageName === 'wemux-worker-preview') {
    return 'https://wemux.xyz'
  }
  if (packageName === 'vibemux-worker' || packageName === 'wemux-worker') {
    return 'https://wemux.ai'
  }

  const configured = getWorkerRuntimeMetadata().defaultCloudUrl?.trim()
  if (configured) {
    return configured
  }
  return 'https://wemux.ai'
}

export const getWorkerVersion = () => {
  return getWorkerPackageJson().version?.trim() || process.env.npm_package_version?.trim() || '0.0.0'
}

export const getWorkerEntryPath = () => {
  return path.join(getWorkerAppRoot(), 'dist-worker', 'apps', 'worker', 'src', 'index.js')
}

export const getWorkerConsoleRoot = () => {
  return path.join(getWorkerAppRoot(), 'dist-worker', 'apps', 'worker', 'web')
}

export const resolveNpmWorkerInstallPrefixFromAppRoot = (appRoot: string, packageName: string) => {
  const normalizedPackageName = packageName.trim()
  if (!normalizedPackageName) {
    return ''
  }

  const packageDir = path.resolve(appRoot)
  const nodeModulesDir = path.dirname(packageDir)
  const libDir = path.dirname(nodeModulesDir)
  if (
    path.basename(packageDir) === normalizedPackageName
    && path.basename(nodeModulesDir) === 'node_modules'
    && path.basename(libDir) === 'lib'
  ) {
    return path.dirname(libDir)
  }

  if (
    path.basename(packageDir) === normalizedPackageName
    && path.basename(nodeModulesDir) === 'node_modules'
  ) {
    return path.dirname(nodeModulesDir)
  }

  return ''
}

export const getWorkerNpmInstallPrefix = () => {
  const configuredPrefix = process.env.VIBEMUX_WORKER_INSTALL_PREFIX?.trim()
  if (configuredPrefix) {
    return path.resolve(configuredPrefix)
  }

  const packageName = getWorkerPackageJson().name?.trim()
  return packageName ? resolveNpmWorkerInstallPrefixFromAppRoot(getWorkerAppRoot(), packageName) : ''
}

export const getWorkerLauncherPath = () => {
  const packageName = getWorkerPackageJson().name?.trim()
  const binName = packageName === 'vibemux-worker-preview' ? 'vibemux-worker-preview' : 'vibemux-worker'
  const appRoot = getWorkerAppRoot()
  const npmPrefix = getWorkerNpmInstallPrefix()
  if (npmPrefix) {
    return process.platform === 'win32'
      ? path.join(npmPrefix, `${binName}.cmd`)
      : path.join(npmPrefix, 'bin', binName)
  }

  const launcherName = process.platform === 'win32' ? `${binName}.cmd` : binName
  return path.join(appRoot, 'bin', launcherName)
}
