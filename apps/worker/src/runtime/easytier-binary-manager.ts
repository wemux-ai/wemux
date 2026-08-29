// [INPUT]: EasyTier 二进制管理输入
// [OUTPUT]: 二进制下载/校验
// [POS]: EasyTier 二进制管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getWorkspaceNodeDir, normalizeWorkspaceRoot } from '@shared/workspace-paths'
import { resolveExecutable, runCommand } from '../core/command-utils'

export type EasyTierBinarySet = {
  corePath: string
  cliPath: string
  version: string
  platform: string
  arch: string
}

export type EnsureEasyTierBinariesOptions = {
  workspaceRoot?: string
  version?: string
  downloadBaseUrl?: string
  fetchImpl?: typeof fetch
  resolveExecutable?: (command: string) => string | null
  runCommand?: typeof runCommand
}

const DEFAULT_EASYTIER_VERSION = 'v2.6.4'
const DEFAULT_EASYTIER_DOWNLOAD_BASE_URL = 'https://github.com/EasyTier/EasyTier/releases/download'

const normalizeEasyTierVersion = (value?: string) => {
  const version = value?.trim() || process.env.VIBEMUX_EASYTIER_VERSION?.trim() || DEFAULT_EASYTIER_VERSION
  return version.startsWith('v') ? version : `v${version}`
}

export const resolveEasyTierPlatform = (platform: string | undefined = process.platform) => {
  if (platform === 'darwin') {
    return 'macos'
  }
  if (platform === 'linux') {
    return 'linux'
  }
  if (platform === 'win32') {
    return 'windows'
  }
  return ''
}

export const resolveEasyTierArch = (arch: string | undefined = process.arch) => {
  if (arch === 'x64') {
    return 'x86_64'
  }
  if (arch === 'arm64') {
    return 'aarch64'
  }
  return ''
}

const getExecutableName = (baseName: string) => process.platform === 'win32' ? `${baseName}.exe` : baseName

export const buildEasyTierAssetName = (params: {
  version?: string
  platform?: string
  arch?: string
}) => {
  const version = normalizeEasyTierVersion(params.version)
  const platform = resolveEasyTierPlatform(params.platform)
  const arch = resolveEasyTierArch(params.arch)
  if (!platform || !arch) {
    return ''
  }

  return `easytier-${platform}-${arch}-${version}.zip`
}

export const buildEasyTierDownloadUrl = (params: {
  version?: string
  platform?: string
  arch?: string
  baseUrl?: string
}) => {
  const version = normalizeEasyTierVersion(params.version)
  const assetName = buildEasyTierAssetName({ ...params, version })
  if (!assetName) {
    return ''
  }

  const baseUrl = params.baseUrl?.trim() || process.env.VIBEMUX_EASYTIER_DOWNLOAD_BASE_URL?.trim() || DEFAULT_EASYTIER_DOWNLOAD_BASE_URL
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(version)}/${encodeURIComponent(assetName)}`
}

export const resolveEasyTierInstallDir = (params: {
  workspaceRoot?: string
  version?: string
  platform?: string
  arch?: string
}) => {
  const version = normalizeEasyTierVersion(params.version)
  const platform = resolveEasyTierPlatform(params.platform)
  const arch = resolveEasyTierArch(params.arch)
  const nodeDir = getWorkspaceNodeDir(normalizeWorkspaceRoot(params.workspaceRoot))
  return join(nodeDir, 'runtime', 'easytier', version, `${platform}-${arch}`)
}

const findInstalledBinary = (installDir: string, binaryName: string) => {
  const executableName = getExecutableName(binaryName)
  const candidates = [
    join(installDir, executableName),
    join(installDir, 'easytier', executableName),
  ]

  if (!existsSync(installDir)) {
    return ''
  }

  for (const entry of readdirSync(installDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    candidates.push(join(installDir, entry.name, executableName))
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return ''
}

export const resolveCachedEasyTierBinaries = (options: EnsureEasyTierBinariesOptions = {}): EasyTierBinarySet | null => {
  const version = normalizeEasyTierVersion(options.version)
  const platform = resolveEasyTierPlatform()
  const arch = resolveEasyTierArch()
  if (!platform || !arch) {
    return null
  }

  const installDir = resolveEasyTierInstallDir({ ...options, version })
  const corePath = findInstalledBinary(installDir, 'easytier-core')
  const cliPath = findInstalledBinary(installDir, 'easytier-cli')
  if (!corePath || !cliPath) {
    return null
  }

  return { corePath, cliPath, version, platform, arch }
}

const writeResponseToFile = async (response: Response, targetPath: string) => {
  const body = response.body
  if (!body) {
    throw new Error('EasyTier download response did not include a body.')
  }

  const chunks: Buffer[] = []
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, Buffer.concat(chunks))
}

const chmodIfExists = (targetPath: string) => {
  if (existsSync(targetPath) && process.platform !== 'win32') {
    chmodSync(targetPath, 0o755)
  }
}

const psSingleQuote = (value: string) => `'${value.replace(/'/g, "''")}'`

export const extractEasyTierArchive = (
  archivePath: string,
  installDir: string,
  options: Pick<EnsureEasyTierBinariesOptions, 'resolveExecutable' | 'runCommand'> = {},
  platform = process.platform,
) => {
  const resolveExecutableImpl = options.resolveExecutable ?? resolveExecutable
  const runCommandImpl = options.runCommand ?? runCommand

  if (platform === 'win32') {
    const powershellPath = resolveExecutableImpl('powershell.exe') || resolveExecutableImpl('powershell')
    if (!powershellPath) {
      throw new Error('EasyTier auto download on Windows requires PowerShell Expand-Archive. Install PowerShell or set VIBEMUX_EASYTIER_CORE_PATH and VIBEMUX_EASYTIER_CLI_PATH.')
    }

    const result = runCommandImpl(powershellPath, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${psSingleQuote(archivePath)} -DestinationPath ${psSingleQuote(installDir)} -Force`,
    ], { timeout: 120000 })
    if (!result.ok) {
      throw new Error(result.stderr || result.error || 'EasyTier archive extraction failed with PowerShell Expand-Archive.')
    }
    return
  }

  const unzipPath = resolveExecutableImpl('unzip')
  if (!unzipPath) {
    throw new Error('EasyTier auto download requires unzip. Install unzip or set VIBEMUX_EASYTIER_CORE_PATH and VIBEMUX_EASYTIER_CLI_PATH.')
  }

  const unzip = runCommandImpl(unzipPath, ['-oq', archivePath, '-d', installDir], { timeout: 120000 })
  if (!unzip.ok) {
    throw new Error(unzip.stderr || unzip.error || 'EasyTier archive extraction failed.')
  }
}

export const ensureEasyTierBinaries = async (options: EnsureEasyTierBinariesOptions = {}): Promise<EasyTierBinarySet> => {
  const cached = resolveCachedEasyTierBinaries(options)
  if (cached) {
    return cached
  }

  const version = normalizeEasyTierVersion(options.version)
  const platform = resolveEasyTierPlatform()
  const arch = resolveEasyTierArch()
  if (!platform || !arch) {
    throw new Error(`EasyTier auto download does not support ${process.platform}/${process.arch}.`)
  }

  const installDir = resolveEasyTierInstallDir({ ...options, version })
  const assetName = buildEasyTierAssetName({ version })
  const downloadUrl = buildEasyTierDownloadUrl({
    version,
    baseUrl: options.downloadBaseUrl,
  })
  if (!assetName || !downloadUrl) {
    throw new Error(`EasyTier auto download does not support ${process.platform}/${process.arch}.`)
  }

  const archivePath = join(installDir, assetName)
  const fetchImpl = options.fetchImpl ?? fetch
  mkdirSync(installDir, { recursive: true })
  const response = await fetchImpl(downloadUrl)
  if (!response.ok) {
    throw new Error(`EasyTier download failed: HTTP ${response.status} ${response.statusText}`.trim())
  }
  await writeResponseToFile(response, archivePath)

  rmSync(join(installDir, 'easytier'), { recursive: true, force: true })
  extractEasyTierArchive(archivePath, installDir, options)

  const corePath = findInstalledBinary(installDir, 'easytier-core')
  const cliPath = findInstalledBinary(installDir, 'easytier-cli')
  if (!corePath || !cliPath) {
    throw new Error('EasyTier archive did not include easytier-core and easytier-cli.')
  }

  chmodIfExists(corePath)
  chmodIfExists(cliPath)
  return { corePath, cliPath, version, platform, arch }
}
