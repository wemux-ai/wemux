/**
 * [INPUT]: Worker runtime path, platform, and optional Zellij release download overrides.
 * [OUTPUT]: A locally executable Zellij binary for persistent terminal sessions.
 * [POS]: Worker-owned Zellij installer that verifies the upstream executable checksum after extraction.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getWorkspaceNodeDir, normalizeWorkspaceRoot } from '@shared/workspace-paths'
import { resolveExecutable, runCommand } from '../core/command-utils'

export type ZellijBinary = {
  binaryPath: string
  version: string
  target: string
}

export type EnsureZellijBinaryOptions = {
  workspaceRoot?: string
  version?: string
  downloadBaseUrl?: string
  fetchImpl?: typeof fetch
  resolveExecutable?: (command: string) => string | null
  runCommand?: typeof runCommand
}

const DEFAULT_ZELLIJ_VERSION = 'v0.44.3'
const DEFAULT_ZELLIJ_DOWNLOAD_BASE_URL = 'https://github.com/zellij-org/zellij/releases/download'
const ZELLIJ_DOWNLOAD_BASE_URL_ENV = 'VIBEMUX_ZELLIJ_DOWNLOAD_BASE_URL'
const ZELLIJ_VERSION_ENV = 'VIBEMUX_ZELLIJ_VERSION'
const zellijEnsurePromises = new Map<string, Promise<ZellijBinary>>()

/**
 * Mirror support. Resolution order is explicit option → env → upstream default, so
 * a deployment can point at an internal mirror without touching code. The mirror
 * must serve `<baseUrl>/<version>/<assetName>` (see buildZellijDownloadUrl) and
 * should also carry the matching `.sha256sum` files — without them the integrity
 * check degrades to a warning, since it has nothing to compare against.
 */
export const resolveZellijDownloadBaseUrl = (
  explicitBaseUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
) => (
  explicitBaseUrl?.trim()
    || env[ZELLIJ_DOWNLOAD_BASE_URL_ENV]?.trim()
    || DEFAULT_ZELLIJ_DOWNLOAD_BASE_URL
)

const normalizeZellijVersion = (value?: string, env: NodeJS.ProcessEnv = process.env) => {
  const version = value?.trim() || env[ZELLIJ_VERSION_ENV]?.trim() || DEFAULT_ZELLIJ_VERSION
  return version.startsWith('v') ? version : `v${version}`
}

export const resolveZellijTarget = (
  platform: string | undefined = process.platform,
  arch: string | undefined = process.arch,
) => {
  if (platform === 'linux' && arch === 'x64') {
    return 'x86_64-unknown-linux-musl'
  }
  if (platform === 'linux' && arch === 'arm64') {
    return 'aarch64-unknown-linux-musl'
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'x86_64-apple-darwin'
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'aarch64-apple-darwin'
  }
  // No win32 target: Windows uses the plain PTY backend (see
  // shouldUseZellijTerminalBackend), so nothing here should try to fetch a Zellij
  // build for it. Returning '' makes an accidental attempt fail fast and locally
  // instead of after two 404s.
  return ''
}

const getArchiveExtension = (platform: string | undefined = process.platform) => platform === 'win32' ? 'zip' : 'tar.gz'

const getExecutableName = (platform: string | undefined = process.platform) => platform === 'win32' ? 'zellij.exe' : 'zellij'

export const buildZellijAssetName = (params: {
  version?: string
  platform?: string
  arch?: string
  noWeb?: boolean
}) => {
  const target = resolveZellijTarget(params.platform, params.arch)
  if (!target) {
    return ''
  }
  const prefix = params.noWeb === false ? 'zellij' : 'zellij-no-web'
  return `${prefix}-${target}.${getArchiveExtension(params.platform)}`
}

export const buildZellijDownloadUrl = (params: {
  version?: string
  platform?: string
  arch?: string
  baseUrl?: string
  noWeb?: boolean
}) => {
  const version = normalizeZellijVersion(params.version)
  const assetName = buildZellijAssetName(params)
  if (!assetName) {
    return ''
  }
  const baseUrl = resolveZellijDownloadBaseUrl(params.baseUrl)
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(version)}/${encodeURIComponent(assetName)}`
}

export const resolveZellijInstallDir = (params: {
  workspaceRoot?: string
  version?: string
  platform?: string
  arch?: string
}) => {
  const version = normalizeZellijVersion(params.version)
  const target = resolveZellijTarget(params.platform, params.arch)
  const nodeDir = getWorkspaceNodeDir(normalizeWorkspaceRoot(params.workspaceRoot))
  return join(nodeDir, 'runtime', 'zellij', version, target || 'unsupported')
}

const findInstalledZellijBinary = (installDir: string) => {
  const executableName = getExecutableName()
  const candidates = [
    join(installDir, executableName),
    join(installDir, 'zellij', executableName),
  ]

  if (!existsSync(installDir)) {
    return ''
  }

  for (const entry of readdirSync(installDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      candidates.push(join(installDir, entry.name, executableName))
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return ''
}

export const resolveCachedZellijBinary = (options: EnsureZellijBinaryOptions = {}): ZellijBinary | null => {
  const version = normalizeZellijVersion(options.version)
  const target = resolveZellijTarget()
  if (!target) {
    return null
  }
  const installDir = resolveZellijInstallDir({ ...options, version })
  const binaryPath = findInstalledZellijBinary(installDir)
  return binaryPath ? { binaryPath, version, target } : null
}

const readResponseBuffer = async (response: Response) => {
  const body = response.body
  if (!body) {
    throw new Error('Zellij download response did not include a body.')
  }
  const chunks: Buffer[] = []
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const writeResponseToFile = async (response: Response, targetPath: string) => {
  const buffer = await readResponseBuffer(response)
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, buffer)
}

const parseSha256Sum = (content: string) => {
  const match = content.match(/\b[a-fA-F0-9]{64}\b/)
  return match?.[0]?.toLowerCase() || ''
}

const buildZellijChecksumUrl = (downloadUrl: string) => {
  if (downloadUrl.endsWith('.tar.gz')) {
    return `${downloadUrl.slice(0, -'.tar.gz'.length)}.sha256sum`
  }
  if (downloadUrl.endsWith('.zip')) {
    return `${downloadUrl.slice(0, -'.zip'.length)}.sha256sum`
  }
  return `${downloadUrl}.sha256sum`
}

const fetchZellijBinaryChecksum = async (params: {
  assetName: string
  checksumUrl: string
  fetchImpl: typeof fetch
}) => {
  // A missing checksum file downgrades to "no verification" rather than failing the
  // install. Warn loudly: on a self-hosted mirror this is the difference between a
  // verified binary and an unverified one, and silence made it invisible.
  let response: Response
  try {
    response = await params.fetchImpl(params.checksumUrl)
  } catch (error) {
    console.warn(`[zellij] checksum unavailable for ${params.assetName}, installing without integrity verification: ${error instanceof Error ? error.message : 'fetch failed'}`)
    return
  }

  if (!response.ok) {
    console.warn(`[zellij] checksum unavailable for ${params.assetName} (HTTP ${response.status}), installing without integrity verification`)
    return
  }

  const expected = parseSha256Sum(Buffer.from(await response.arrayBuffer()).toString('utf8'))
  if (!expected) {
    throw new Error(`Zellij checksum file for ${params.assetName} did not include a SHA-256 digest.`)
  }

  return expected
}

const verifyExtractedZellijBinaryChecksum = (params: {
  binaryPath: string
  expected: string
  assetName: string
}) => {
  const actual = createHash('sha256').update(readFileSync(params.binaryPath)).digest('hex')
  if (actual !== params.expected) {
    throw new Error(`Zellij checksum mismatch for ${params.assetName}.`)
  }
}

const chmodIfExists = (targetPath: string) => {
  if (existsSync(targetPath) && process.platform !== 'win32') {
    chmodSync(targetPath, 0o755)
  }
}

const psSingleQuote = (value: string) => `'${value.replace(/'/g, "''")}'`

export const extractZellijArchive = (
  archivePath: string,
  installDir: string,
  options: Pick<EnsureZellijBinaryOptions, 'resolveExecutable' | 'runCommand'> = {},
  platform = process.platform,
) => {
  const resolveExecutableImpl = options.resolveExecutable ?? resolveExecutable
  const runCommandImpl = options.runCommand ?? runCommand

  if (platform === 'win32') {
    const powershellPath = resolveExecutableImpl('powershell.exe') || resolveExecutableImpl('powershell')
    if (!powershellPath) {
      throw new Error('Zellij auto download on Windows requires PowerShell Expand-Archive.')
    }
    const result = runCommandImpl(powershellPath, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${psSingleQuote(archivePath)} -DestinationPath ${psSingleQuote(installDir)} -Force`,
    ], { timeout: 120000 })
    if (!result.ok) {
      throw new Error(result.stderr || result.error || 'Zellij archive extraction failed with PowerShell Expand-Archive.')
    }
    return
  }

  const tarPath = resolveExecutableImpl('tar')
  if (!tarPath) {
    throw new Error('Zellij auto download requires tar.')
  }
  const result = runCommandImpl(tarPath, ['-xzf', archivePath, '-C', installDir], { timeout: 120000 })
  if (!result.ok) {
    throw new Error(result.stderr || result.error || 'Zellij archive extraction failed.')
  }
}

export const ensureZellijBinary = async (options: EnsureZellijBinaryOptions = {}): Promise<ZellijBinary> => {
  const version = normalizeZellijVersion(options.version)
  const target = resolveZellijTarget()
  const installDir = resolveZellijInstallDir({ ...options, version })
  const cacheKey = `${version}:${target || process.platform}-${process.arch}:${installDir}:${resolveZellijDownloadBaseUrl(options.downloadBaseUrl)}`
  const existingPromise = zellijEnsurePromises.get(cacheKey)
  if (existingPromise) {
    return existingPromise
  }

  const ensurePromise = ensureZellijBinaryUncached(options, version, target)
    .finally(() => {
      zellijEnsurePromises.delete(cacheKey)
    })
  zellijEnsurePromises.set(cacheKey, ensurePromise)
  return ensurePromise
}

const ensureZellijBinaryUncached = async (
  options: EnsureZellijBinaryOptions,
  version: string,
  target: string,
): Promise<ZellijBinary> => {
  const pathBinary = (options.resolveExecutable ?? resolveExecutable)('zellij')
  if (pathBinary) {
    return {
      binaryPath: pathBinary,
      version,
      target: target || `${process.platform}-${process.arch}`,
    }
  }

  const cached = resolveCachedZellijBinary(options)
  if (cached) {
    return cached
  }

  if (!target) {
    throw new Error(`Zellij auto download does not support ${process.platform}/${process.arch}.`)
  }

  const installDir = resolveZellijInstallDir({ ...options, version })
  const fetchImpl = options.fetchImpl ?? fetch
  mkdirSync(installDir, { recursive: true })
  let lastError: unknown

  for (const noWeb of [true, false]) {
    const assetName = buildZellijAssetName({ version, noWeb })
    const downloadUrl = buildZellijDownloadUrl({ version, baseUrl: options.downloadBaseUrl, noWeb })
    if (!assetName || !downloadUrl) {
      continue
    }
    try {
      const response = await fetchImpl(downloadUrl)
      if (!response.ok) {
        continue
      }
      await writeResponseToFile(response, join(installDir, assetName))
      const expectedBinaryChecksum = await fetchZellijBinaryChecksum({
        assetName,
        checksumUrl: buildZellijChecksumUrl(downloadUrl),
        fetchImpl,
      })

      rmSync(join(installDir, 'zellij'), { recursive: true, force: true })
      extractZellijArchive(join(installDir, assetName), installDir, options)

      const binaryPath = findInstalledZellijBinary(installDir)
      if (!binaryPath) {
        throw new Error('Zellij archive did not include zellij.')
      }
      if (expectedBinaryChecksum) {
        verifyExtractedZellijBinaryChecksum({ binaryPath, expected: expectedBinaryChecksum, assetName })
      }
      chmodIfExists(binaryPath)
      return { binaryPath, version, target }
    } catch (error) {
      const binaryPath = findInstalledZellijBinary(installDir)
      if (binaryPath) {
        rmSync(binaryPath, { force: true })
      }
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }
  throw new Error('Zellij download failed: no compatible release asset was available.')
}
