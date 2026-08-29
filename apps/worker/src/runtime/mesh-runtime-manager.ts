// [INPUT]: mesh 运行时管理输入
// [OUTPUT]: mesh 连接管理
// [POS]: mesh 运行时管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { getEasyTierRpcPortal, resolveEasyTierPortProfile } from '@shared/easytier-ports'
import type { WorkerConfig, WorkerMeshEnrollmentConfig, WorkerMeshPeer, WorkerMeshRouteMode, WorkerMeshStatus } from '@shared/types'
import { resolveExecutable, runCommand } from '../core/command-utils'
import { getWorkerHome } from '../core/config'
import { ensureEasyTierBinaries, resolveCachedEasyTierBinaries } from './easytier-binary-manager'
import { getWorkerReleaseChannel } from '../update/worker-release'

type EasyTierProcess = Pick<ChildProcessWithoutNullStreams, 'kill' | 'killed' | 'pid' | 'stderr' | 'stdout' | 'on'>

export type WorkerMeshRuntimeConfig = {
  enabled: boolean
  corePath?: string
  cliPath?: string
  workspaceRoot?: string
  networkName?: string
  networkSecret?: string
  peers: string[]
  ipv4?: string
  hostname?: string
}

type StartWorkerMeshRuntimeOptions = {
  spawnProcess?: (command: string, args: string[]) => EasyTierProcess
  ensureBinaries?: typeof ensureEasyTierBinaries
  probeExistingRuntime?: (config: WorkerMeshRuntimeConfig, cliPath: string) => WorkerMeshStatus | undefined
}

const truthyEnvValues = new Set(['1', 'true', 'yes', 'on'])
const routeModes = new Set<WorkerMeshRouteMode>(['direct', 'relayed', 'unknown'])

let currentMeshStatus: WorkerMeshStatus = {
  enabled: false,
  status: 'disabled',
  reportedAt: new Date().toISOString(),
}
let currentProcess: EasyTierProcess | null = null
let currentProcessKey = ''
let currentProcessOutput = ''

const nowIso = () => new Date().toISOString()

const splitEnvList = (value?: string) => (value ?? '')
  .split(/[,\n]/)
  .map((item) => item.trim())
  .filter(Boolean)

const shouldAutoDownloadEasyTier = () => {
  const value = process.env.VIBEMUX_EASYTIER_AUTO_DOWNLOAD?.trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

const truthyConfigValues = new Set(['1', 'true', 'yes', 'on'])
const falsyConfigValues = new Set(['0', 'false', 'no', 'off'])

export const shouldUseEasyTierSmoltcp = (platform = process.platform) => {
  const configured = process.env.VIBEMUX_EASYTIER_USE_SMOLTCP?.trim().toLowerCase()
  if (configured && truthyConfigValues.has(configured)) {
    return true
  }
  if (configured && falsyConfigValues.has(configured)) {
    return false
  }

  return platform === 'win32'
}

export const shouldUseEasyTierNoTun = (platform = process.platform) => {
  const configured = process.env.VIBEMUX_EASYTIER_NO_TUN?.trim().toLowerCase()
  if (configured && truthyConfigValues.has(configured)) {
    return true
  }
  if (configured && falsyConfigValues.has(configured)) {
    return false
  }

  return platform === 'win32'
}

export const resolveWorkerEasyTierRpcPortal = () => {
  const configured = process.env.VIBEMUX_EASYTIER_RPC_PORTAL?.trim()
  if (configured) {
    return configured
  }

  const profile = resolveEasyTierPortProfile({
    explicitProfile: process.env.VIBEMUX_EASYTIER_PORT_PROFILE,
    nodeEnv: process.env.NODE_ENV,
    releaseChannel: getWorkerReleaseChannel(),
    cloudUrl: process.env.VIBEMUX_CLOUD_URL,
  })
  return getEasyTierRpcPortal(profile)
}

const updateMeshStatus = (patch: Omit<WorkerMeshStatus, 'reportedAt'> & { reportedAt?: string }) => {
  currentMeshStatus = {
    ...patch,
    reportedAt: patch.reportedAt ?? nowIso(),
  }
  return getWorkerMeshStatus()
}

const buildDisabledMeshStatus = (): WorkerMeshStatus => ({
  enabled: false,
  status: 'disabled',
  reportedAt: nowIso(),
})

const buildProcessKey = (config: WorkerMeshRuntimeConfig) => JSON.stringify({
  corePath: config.corePath,
  cliPath: config.cliPath,
  workspaceRoot: config.workspaceRoot,
  networkName: config.networkName,
  networkSecret: config.networkSecret ? '[configured]' : '',
  peers: config.peers,
  ipv4: config.ipv4,
  hostname: config.hostname,
})

const rememberProcessOutput = (message: string) => {
  currentProcessOutput = `${currentProcessOutput}\n${message}`.trim().slice(-2000)
}

const normalizeRouteMode = (value?: string): WorkerMeshRouteMode => {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'p2p' || normalized === 'direct') {
    return 'direct'
  }
  if (normalized === 'relay' || normalized === 'relayed') {
    return 'relayed'
  }
  return normalized && routeModes.has(normalized as WorkerMeshRouteMode)
    ? normalized as WorkerMeshRouteMode
    : 'unknown'
}

const parseNumber = (value?: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const stripIpv4Cidr = (value?: string) => value?.trim().replace(/\/\d+$/, '') || ''

const buildMeshConfigMismatchMessage = (params: {
  configuredIpv4?: string
  reportedIpv4?: string
  configuredHostname?: string
  reportedHostname?: string
}) => {
  const configuredIpv4 = stripIpv4Cidr(params.configuredIpv4)
  const reportedIpv4 = stripIpv4Cidr(params.reportedIpv4)
  if (configuredIpv4 && reportedIpv4 && configuredIpv4 !== reportedIpv4) {
    return `Mesh helper is using ${params.reportedIpv4}, but the control plane assigned ${params.configuredIpv4}. Restart or reinstall the mesh helper to apply the latest mesh enrollment.`
  }

  const configuredHostname = params.configuredHostname?.trim()
  const reportedHostname = params.reportedHostname?.trim()
  if (configuredHostname && reportedHostname && configuredHostname !== reportedHostname) {
    return `Mesh helper is using hostname ${reportedHostname}, but the control plane assigned ${configuredHostname}. Restart or reinstall the mesh helper to apply the latest mesh enrollment.`
  }

  return ''
}

const meshStatusMatchesConfig = (status: WorkerMeshStatus | undefined, config: WorkerMeshRuntimeConfig) => {
  if (!status?.enabled || status.status === 'disabled' || status.status === 'error') {
    return false
  }

  const configuredIpv4 = stripIpv4Cidr(config.ipv4)
  const reportedIpv4 = stripIpv4Cidr(status.meshIpv4)
  if (configuredIpv4 && reportedIpv4 && configuredIpv4 !== reportedIpv4) {
    return false
  }

  const configuredHostname = config.hostname?.trim()
  const reportedHostname = status.meshHostname?.trim()
  if (configuredHostname && reportedHostname && configuredHostname !== reportedHostname) {
    return false
  }

  return Boolean(reportedIpv4 || reportedHostname || status.peers?.length)
}

const splitTableLine = (line: string) => {
  const cells = line.split('|').map((item) => item.trim())
  if (cells[0] === '') {
    cells.shift()
  }
  if (cells[cells.length - 1] === '') {
    cells.pop()
  }
  return cells
}

const findHeaderIndex = (headers: string[], candidates: string[]) => {
  const normalizedCandidates = new Set(candidates.map((candidate) => candidate.toLowerCase()))
  return headers.findIndex((header) => normalizedCandidates.has(header.toLowerCase()))
}

const normalizeNodeInfoKey = (key: string) => key.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

const parseNodeInfoRows = (raw: string) => {
  const pairs = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes('|')) {
      continue
    }
    const cells = splitTableLine(line)
    if (cells.length !== 2) {
      continue
    }
    const [label, value] = cells
    if (!label || !value || /^-+$/.test(label) || /^-+$/.test(value)) {
      continue
    }
    pairs.set(normalizeNodeInfoKey(label), value)
  }
  return pairs
}

const parseTableRows = (raw: string) => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
  if (lines.length < 2) {
    return []
  }

  const headerLine = lines.find((line) => !/^\|?\s*-+/.test(line))
  if (!headerLine) {
    return []
  }

  const headers = splitTableLine(headerLine)
  const rows = lines.slice(lines.indexOf(headerLine) + 1)
    .filter((line) => !/^\|?\s*:?-+/.test(line))
    .map(splitTableLine)
    .filter((cells) => cells.length > 0)

  return rows.map((cells) => ({ headers, cells }))
}

export const parseEasyTierNodeOutput = (raw: string): Partial<WorkerMeshStatus> => {
  const infoRows = parseNodeInfoRows(raw)
  if (infoRows.size > 0) {
    return {
      meshIpv4: infoRows.get('virtual ip') || infoRows.get('ipv4') || infoRows.get('ip'),
      meshHostname: infoRows.get('hostname') || infoRows.get('host'),
      natType: infoRows.get('udp stun type') || infoRows.get('nat type') || infoRows.get('nat'),
      meshNodeId: infoRows.get('peer id') || infoRows.get('id') || infoRows.get('node id'),
    }
  }

  const rows = parseTableRows(raw)
  const row = rows[0]
  if (!row) {
    return {}
  }

  const ipv4Index = findHeaderIndex(row.headers, ['ipv4', 'ip'])
  const hostnameIndex = findHeaderIndex(row.headers, ['hostname', 'host'])
  const natIndex = findHeaderIndex(row.headers, ['nat_type', 'nat type', 'nat'])
  const idIndex = findHeaderIndex(row.headers, ['id', 'node_id', 'node id'])

  return {
    meshIpv4: ipv4Index >= 0 ? row.cells[ipv4Index] : undefined,
    meshHostname: hostnameIndex >= 0 ? row.cells[hostnameIndex] : undefined,
    natType: natIndex >= 0 ? row.cells[natIndex] : undefined,
    meshNodeId: idIndex >= 0 ? row.cells[idIndex] : undefined,
  }
}

export const parseEasyTierPeerOutput = (raw: string): WorkerMeshPeer[] => {
  const rows = parseTableRows(raw)
  return rows.map(({ headers, cells }) => {
    const idIndex = findHeaderIndex(headers, ['id', 'node_id', 'node id'])
    const ipv4Index = findHeaderIndex(headers, ['ipv4', 'ip'])
    const hostnameIndex = findHeaderIndex(headers, ['hostname', 'host'])
    const costIndex = findHeaderIndex(headers, ['cost'])
    const latencyIndex = findHeaderIndex(headers, ['lat_ms', 'latency', 'latency_ms'])
    const lossRateIndex = findHeaderIndex(headers, ['loss_rate', 'loss rate'])
    const protoIndex = findHeaderIndex(headers, ['tunnel_proto', 'proto', 'protocol'])
    const meshNodeId = idIndex >= 0 ? cells[idIndex] : undefined
    const routeMode = normalizeRouteMode(costIndex >= 0 ? cells[costIndex] : undefined)

    return {
      meshNodeId: meshNodeId || (hostnameIndex >= 0 ? cells[hostnameIndex] : 'unknown'),
      meshIpv4: ipv4Index >= 0 ? cells[ipv4Index] : undefined,
      routeMode,
      latencyMs: latencyIndex >= 0 ? parseNumber(cells[latencyIndex]) : undefined,
      lossRate: lossRateIndex >= 0 ? parseNumber(cells[lossRateIndex]) : undefined,
      tunnelProto: protoIndex >= 0 ? cells[protoIndex] : undefined,
      lastSeenAt: nowIso(),
    }
  }).filter((peer) => peer.meshNodeId !== 'unknown' || peer.meshIpv4)
}

export const loadWorkerMeshRuntimeConfigFromEnv = (): WorkerMeshRuntimeConfig => ({
  enabled: truthyEnvValues.has(process.env.VIBEMUX_MESH_ENABLED?.trim().toLowerCase() || ''),
  corePath: process.env.VIBEMUX_EASYTIER_CORE_PATH?.trim() || process.env.EASYTIER_CORE_PATH?.trim() || undefined,
  cliPath: process.env.VIBEMUX_EASYTIER_CLI_PATH?.trim() || process.env.EASYTIER_CLI_PATH?.trim() || undefined,
  networkName: process.env.VIBEMUX_EASYTIER_NETWORK_NAME?.trim() || undefined,
  networkSecret: process.env.VIBEMUX_EASYTIER_NETWORK_SECRET?.trim() || undefined,
  peers: splitEnvList(process.env.VIBEMUX_EASYTIER_PEERS),
  ipv4: process.env.VIBEMUX_EASYTIER_IPV4?.trim() || undefined,
  hostname: process.env.VIBEMUX_EASYTIER_HOSTNAME?.trim() || undefined,
})

const fromEnrollment = (enrollment: WorkerMeshEnrollmentConfig): WorkerMeshRuntimeConfig => ({
  ...loadWorkerMeshRuntimeConfigFromEnv(),
  enabled: enrollment.enabled,
  networkName: enrollment.networkName?.trim() || undefined,
  networkSecret: enrollment.networkSecret?.trim() || undefined,
  peers: [...enrollment.peers],
  ipv4: enrollment.ipv4?.trim() || undefined,
  hostname: enrollment.hostname?.trim() || undefined,
})

export const loadWorkerMeshRuntimeConfig = (workerConfig?: WorkerConfig): WorkerMeshRuntimeConfig => {
  if (workerConfig?.meshEnrollment) {
    return {
      ...fromEnrollment(workerConfig.meshEnrollment),
      workspaceRoot: workerConfig.workspaceRoot,
    }
  }

  return {
    ...loadWorkerMeshRuntimeConfigFromEnv(),
    workspaceRoot: workerConfig?.workspaceRoot,
  }
}

export const buildEasyTierCoreArgs = (config: WorkerMeshRuntimeConfig, platform = process.platform) => {
  const noTun = shouldUseEasyTierNoTun(platform)
  const args = [
    '--network-name',
    config.networkName?.trim() || '',
    '--network-secret',
    config.networkSecret?.trim() || '',
    '--rpc-portal',
    resolveWorkerEasyTierRpcPortal(),
    '--no-listener',
  ]

  if (noTun) {
    args.push('--no-tun')
  } else if (config.ipv4?.trim()) {
    args.push('-i', config.ipv4.trim())
  }

  if (config.hostname?.trim()) {
    args.push('--hostname', config.hostname.trim())
  }

  if (shouldUseEasyTierSmoltcp(platform)) {
    args.push('--use-smoltcp')
  }

  for (const peer of config.peers) {
    args.push('-p', peer)
  }

  return args
}

export const isEasyTierRpcUnavailableMessage = (message?: string) => {
  const normalized = message?.trim().toLowerCase() || ''
  return Boolean(normalized) && (
    normalized.includes('connection refused')
    || normalized.includes('actively refused')
    || normalized.includes('os error 10061')
    || normalized.includes('failed to connect to server')
    || normalized.includes('failed to get manage client')
  )
}

export const shouldRestartWorkerMeshRuntime = (status: WorkerMeshStatus, config = loadWorkerMeshRuntimeConfigFromEnv()) => {
  return Boolean(
    config.enabled
      && status.enabled
      && !currentProcess
      && (status.status === 'error' || status.status === 'degraded')
      && isEasyTierRpcUnavailableMessage(status.errorMessage),
  )
}

export const getWorkerMeshStatus = (): WorkerMeshStatus => ({
  ...currentMeshStatus,
  peers: currentMeshStatus.peers?.map((peer) => ({ ...peer })),
})

export const markWorkerMeshDisabled = () => {
  stopWorkerMeshRuntime()
  currentMeshStatus = buildDisabledMeshStatus()
  return getWorkerMeshStatus()
}

export const stopWorkerMeshRuntime = () => {
  if (!currentProcess) {
    currentProcessKey = ''
    return
  }

  const processToStop = currentProcess
  currentProcess = null
  currentProcessKey = ''
  currentProcessOutput = ''
  if (!processToStop.killed) {
    processToStop.kill('SIGTERM')
  }
}

export const refreshWorkerMeshRuntimeStatus = (config = loadWorkerMeshRuntimeConfigFromEnv()) => {
  const cached = !config.cliPath ? resolveCachedEasyTierBinaries({ workspaceRoot: getWorkerHome() }) : null
  const cliPath = config.cliPath || cached?.cliPath || resolveExecutable('easytier-cli')
  if (!config.enabled || !cliPath) {
    return getWorkerMeshStatus()
  }

  const rpcPortal = resolveWorkerEasyTierRpcPortal()
  const node = runCommand(cliPath, ['--rpc-portal', rpcPortal, 'node'], { timeout: 5000 })
  const peer = runCommand(cliPath, ['--rpc-portal', rpcPortal, 'peer'], { timeout: 5000 })
  if (!node.ok && !peer.ok) {
    const currentStatus = getWorkerMeshStatus()
    const probeError = node.error || node.stderr || peer.error || peer.stderr || 'EasyTier status probe failed.'
    const processExitedWithError = !currentProcess && currentStatus.status === 'error'
    return updateMeshStatus({
      ...currentStatus,
      enabled: true,
      status: processExitedWithError ? 'error' : 'degraded',
      errorMessage: processExitedWithError && currentStatus.errorMessage
        ? currentStatus.errorMessage
        : probeError,
    })
  }

  const nodePatch = node.ok ? parseEasyTierNodeOutput(node.stdout) : {}
  const peers = peer.ok ? parseEasyTierPeerOutput(peer.stdout) : getWorkerMeshStatus().peers
  const routeMode = peers?.some((item) => item.routeMode === 'direct')
    ? 'direct'
    : peers?.some((item) => item.routeMode === 'relayed')
      ? 'relayed'
      : 'unknown'
  const mismatchMessage = buildMeshConfigMismatchMessage({
    configuredIpv4: config.ipv4,
    reportedIpv4: nodePatch.meshIpv4,
    configuredHostname: config.hostname,
    reportedHostname: nodePatch.meshHostname,
  })

  return updateMeshStatus({
    enabled: true,
    status: peers?.some((item) => item.routeMode === 'direct') ? 'ready' : 'degraded',
    routeMode,
    peers,
    errorMessage: mismatchMessage || undefined,
    ...nodePatch,
  })
}

export const startWorkerMeshRuntime = (
  config = loadWorkerMeshRuntimeConfig(),
  options: StartWorkerMeshRuntimeOptions = {},
) => {
  void startWorkerMeshRuntimeAsync(config, options)
  return getWorkerMeshStatus()
}

export const startWorkerMeshRuntimeAsync = async (
  config = loadWorkerMeshRuntimeConfig(),
  options: StartWorkerMeshRuntimeOptions = {},
) => {
  if (!config.enabled) {
    return markWorkerMeshDisabled()
  }

  if (!config.networkName?.trim() || !config.networkSecret?.trim() || config.peers.length === 0) {
    stopWorkerMeshRuntime()
    return updateMeshStatus({
      enabled: true,
      status: 'error',
      errorMessage: 'EasyTier mesh is enabled, but network name, secret, or bootstrap peers are missing.',
    })
  }

  const autoDownload = shouldAutoDownloadEasyTier()
  const cachedBinaries = (!config.corePath || !config.cliPath)
    ? resolveCachedEasyTierBinaries({ workspaceRoot: getWorkerHome() })
    : null
  const pathCore = autoDownload ? undefined : resolveExecutable('easytier-core') || undefined
  const pathCli = autoDownload ? undefined : resolveExecutable('easytier-cli') || undefined
  const configuredCorePath = config.corePath || cachedBinaries?.corePath || pathCore
  const configuredCliPath = config.cliPath || cachedBinaries?.cliPath || pathCli
  let corePath = configuredCorePath
  let cliPath = configuredCliPath
  if (!corePath || !cliPath) {
    updateMeshStatus({
      enabled: true,
      status: 'installing',
      meshIpv4: config.ipv4,
      meshHostname: config.hostname,
      errorMessage: undefined,
    })
    try {
      if (!autoDownload) {
        throw new Error('EasyTier executable was not found. Set VIBEMUX_EASYTIER_CORE_PATH and VIBEMUX_EASYTIER_CLI_PATH, or enable VIBEMUX_EASYTIER_AUTO_DOWNLOAD.')
      }
      const binaries = await (options.ensureBinaries ?? ensureEasyTierBinaries)({
        // 节点级 tool 缓存固定机器级 workerHome，不随 workspaceRoot（云节点 R2 挂载）走
        workspaceRoot: getWorkerHome(),
      })
      corePath = corePath || binaries.corePath
      cliPath = cliPath || binaries.cliPath
    } catch (error) {
      stopWorkerMeshRuntime()
      return updateMeshStatus({
        enabled: true,
        status: 'error',
        errorMessage: error instanceof Error
          ? error.message
          : 'EasyTier executable was not found and automatic download failed.',
      })
    }
  }

  if (!corePath) {
    stopWorkerMeshRuntime()
    return updateMeshStatus({
      enabled: true,
      status: 'error',
      errorMessage: 'EasyTier core executable was not found. Set VIBEMUX_EASYTIER_CORE_PATH or enable automatic download.',
    })
  }

  const processKey = buildProcessKey({ ...config, corePath, cliPath })
  if (currentProcess && currentProcessKey === processKey) {
    return getWorkerMeshStatus()
  }

  const probeExistingRuntime = options.probeExistingRuntime ?? ((runtimeConfig, resolvedCliPath) => (
    refreshWorkerMeshRuntimeStatus({
      ...runtimeConfig,
      cliPath: resolvedCliPath,
    })
  ))
  const existingStatus = probeExistingRuntime(config, cliPath)
  const matchingExistingStatus = meshStatusMatchesConfig(existingStatus, config) ? existingStatus : undefined
  if (matchingExistingStatus) {
    currentProcess = null
    currentProcessKey = processKey
    currentProcessOutput = ''
    updateMeshStatus(matchingExistingStatus)
    return getWorkerMeshStatus()
  }

  stopWorkerMeshRuntime()
  const args = buildEasyTierCoreArgs(config)
  const spawnProcess = options.spawnProcess ?? ((command, commandArgs) => spawn(command, commandArgs))
  currentProcess = spawnProcess(corePath, args)
  currentProcessKey = processKey
  currentProcessOutput = ''

  const onProcessOutput = (chunk: Buffer) => {
    const message = chunk.toString('utf8').trim()
    if (!message) {
      return
    }
    rememberProcessOutput(message)
    updateMeshStatus({
      ...getWorkerMeshStatus(),
      enabled: true,
      status: 'connecting',
      errorMessage: undefined,
    })
  }
  currentProcess.stdout?.on('data', onProcessOutput)
  currentProcess.stderr?.on('data', onProcessOutput)
  currentProcess.on('exit', (code) => {
    if (!currentProcess) {
      return
    }
    const output = currentProcessOutput
    currentProcess = null
    currentProcessKey = ''
    currentProcessOutput = ''
    updateMeshStatus({
      enabled: true,
      status: code === 0 ? 'disabled' : 'error',
      errorMessage: code === 0
        ? undefined
        : [`EasyTier process exited with code ${code ?? 'unknown'}.`, output].filter(Boolean).join(' '),
    })
  })

  return updateMeshStatus({
    enabled: true,
    status: 'connecting',
    meshIpv4: config.ipv4,
    meshHostname: config.hostname,
  })
}
