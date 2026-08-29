import { getWorkerConsolePortBase } from '@shared/worker-console-ports'
import { getApiBaseUrl, getAppBaseUrl, getBetterAuthBaseUrl, isDevEnvironment, resolveAbsoluteApiUrl } from './runtime-config'

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')
const PREVIEW_HOSTNAMES = ['vibemux.xyz', 'wemux.xyz']
const RAILWAY_PREVIEW_HOST_SUFFIX = '.up.railway.app'
const PREVIEW_WORKER_PACKAGE_NAME = 'wemux-worker-preview'
const PRODUCTION_WORKER_PACKAGE_NAME = 'wemux-worker'
const PREVIEW_WORKER_INSTALL_PREFIX = '$HOME/.wemux-preview-worker'
const PRODUCTION_WORKER_INSTALL_PREFIX = '$HOME/.wemux-worker'

export type WorkerRunMode = 'local' | 'docker'
export type WorkerLocalInstallTarget = 'unix' | 'windows'
export type WorkerConnectCommandOptions = {
  displayName?: string
  installTarget?: WorkerLocalInstallTarget
}

const shellQuote = (value: string) => {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

const isPreviewUrl = (value: string) => {
  if (!value) {
    return false
  }

  try {
    const hostname = new URL(value).hostname
    return PREVIEW_HOSTNAMES.includes(hostname) || hostname.endsWith(RAILWAY_PREVIEW_HOST_SUFFIX)
  } catch {
    return PREVIEW_HOSTNAMES.some((hostname) => value.includes(hostname))
      || value.includes(RAILWAY_PREVIEW_HOST_SUFFIX)
  }
}

export const isPreviewWorkerEnvironment = () => {
  return [getAppBaseUrl(), getBetterAuthBaseUrl(), getApiBaseUrl()].some(isPreviewUrl)
}

export const getWorkerPackageName = () => {
  return isPreviewWorkerEnvironment() ? PREVIEW_WORKER_PACKAGE_NAME : PRODUCTION_WORKER_PACKAGE_NAME
}

export const getWorkerInstallPrefix = () => {
  return isPreviewWorkerEnvironment() ? PREVIEW_WORKER_INSTALL_PREFIX : PRODUCTION_WORKER_INSTALL_PREFIX
}

export const getWorkerBinaryCommand = () => {
  return `${getWorkerInstallPrefix()}/bin/wemux`
}

export const isWorkerInstallerEnvironment = () => {
  return true
}

export const getWorkerRestartCommand = () => {
  return getWorkerBinaryCommand()
}

export const getWorkerOpenCommand = () => {
  return `${getWorkerRestartCommand()} worker open`
}

export const getWorkerDaemonCommand = () => {
  return `${getWorkerRestartCommand()} worker daemon`
}

export const getWorkerLocalConsolePort = () => {
  if (isPreviewWorkerEnvironment()) {
    return getWorkerConsolePortBase('preview')
  }

  return getWorkerConsolePortBase(isDevEnvironment() ? 'development' : 'production')
}

export const getWorkerLocalConsoleUrl = () => {
  return `http://127.0.0.1:${getWorkerLocalConsolePort()}`
}

export const buildWorkerConnectCommand = (pairingCode: string) => {
  const normalizedPairingCode = pairingCode.trim()

  return trimTrailingSlash(`${getWorkerRestartCommand()} worker connect --pairing-code ${shellQuote(normalizedPairingCode || '<PAIRING_CODE>')}`)
}

const resolveWorkerInstallerUrl = (path: string) => {
  const installerUrl = resolveAbsoluteApiUrl(path)

  try {
    const url = new URL(installerUrl)
    if ((url.hostname.endsWith('.vibemux.localtest.me') || url.hostname.endsWith('.wemux.localtest.me')) && url.port === '15173') {
      url.hostname = '127.0.0.1'
      url.port = '18989'
      return trimTrailingSlash(url.toString())
    }
  } catch {
    return installerUrl
  }

  return installerUrl
}

export const buildWorkerInstallerConnectCommand = (pairingCode: string) => {
  const normalizedPairingCode = pairingCode.trim() || '<PAIRING_CODE>'
  const installerUrl = resolveWorkerInstallerUrl('/install')
  return `curl -fsSL ${shellQuote(installerUrl)} | bash -s -- --pairing-code ${shellQuote(normalizedPairingCode)}`
}

export const buildWorkerInstallerPowerShellConnectCommand = (
  pairingCode: string,
  options: WorkerConnectCommandOptions = {},
) => {
  const normalizedPairingCode = pairingCode.trim() || '<PAIRING_CODE>'
  const installerUrl = resolveWorkerInstallerUrl('/install.ps1')
  const nameArg = options.displayName?.trim()
    ? ` -WorkerName ${shellQuoteForPowerShell(options.displayName.trim())}`
    : ''
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm '${escapePowerShellSingleQuoted(installerUrl)}'))) -PairingCode ${shellQuoteForPowerShell(normalizedPairingCode)}${nameArg}"`
}

const escapePowerShellSingleQuoted = (value: string) => value.replace(/'/g, "''")
const shellQuoteForPowerShell = (value: string) => `'${escapePowerShellSingleQuoted(value)}'`

export const buildPreferredWorkerLocalConnectCommand = (pairingCode: string) => {
  return isWorkerInstallerEnvironment()
    ? buildWorkerInstallerConnectCommand(pairingCode)
    : buildWorkerConnectCommand(pairingCode)
}

export const buildWorkerLocalConnectCommand = (
  pairingCode: string,
  options: WorkerConnectCommandOptions = {},
) => {
  if (options.installTarget === 'windows') {
    return buildWorkerInstallerPowerShellConnectCommand(pairingCode, options)
  }

  return isWorkerInstallerEnvironment()
    ? buildWorkerInstallerConnectCommand(pairingCode)
    : buildWorkerConnectCommand(pairingCode)
}

const resolveWorkerDockerCloudUrl = () => {
  const apiBaseUrl = getApiBaseUrl().trim()
  const appBaseUrl = getAppBaseUrl().trim()
  const candidate = apiBaseUrl || appBaseUrl

  if (!candidate && typeof window === 'undefined') {
    return ''
  }

  try {
    const url = new URL(candidate || window.location.origin)
    const hostname = url.hostname.toLowerCase()

    if ((hostname === 'localhost' || hostname === '127.0.0.1') && (url.port === '8989' || url.port === '18989')) {
      url.hostname = 'host.docker.internal'
      return trimTrailingSlash(url.toString())
    }

    if ((hostname.endsWith('.vibemux.localtest.me') || hostname.endsWith('.wemux.localtest.me')) && url.port === '15173') {
      url.hostname = 'host.docker.internal'
      url.port = '18989'
      return trimTrailingSlash(url.toString())
    }

    return trimTrailingSlash(url.toString())
  } catch {
    return trimTrailingSlash(candidate)
  }
}

export const buildWorkerDockerConnectCommand = (pairingCode: string, options: WorkerConnectCommandOptions = {}) => {
  const normalizedPairingCode = pairingCode.trim() || '<PAIRING_CODE>'
  const installerUrl = resolveWorkerInstallerUrl('/install/docker')
  const cloudUrl = resolveWorkerDockerCloudUrl()
  const displayName = options.displayName?.trim()

  return [
    `curl -fsSL ${shellQuote(installerUrl)} | bash -s --`,
    `--pairing-code ${shellQuote(normalizedPairingCode)}`,
    cloudUrl ? `--server-url ${shellQuote(cloudUrl)}` : '',
    displayName ? `--name ${shellQuote(displayName)}` : '',
  ].filter(Boolean).join(' ')
}

export const buildWorkerRunCommand = (
  pairingCode: string,
  runMode: WorkerRunMode,
  options: WorkerConnectCommandOptions = {},
) => {
  return runMode === 'docker'
    ? buildWorkerDockerConnectCommand(pairingCode, options)
    : buildWorkerLocalConnectCommand(pairingCode, options)
}
