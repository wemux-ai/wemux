// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// [INPUT]: Packaged worker channel, process environment, and persisted node configuration.
// [OUTPUT]: Environment-isolated worker paths plus normalized runtime configuration.
// [POS]: Worker configuration boundary; known dev/preview/production homes must never leak across channels.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { normalizeAgentSettings, normalizeWorkerUpdateSettings } from '@shared/agent-config'
import { bridgeWemuxEnvToLegacy } from '@shared/env'
import { buildOpencodeConfigWithMcp } from '@shared/mcp'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import type { WorkerConfig } from '@shared/types'
import { getWorkerConsolePortBase } from '@shared/worker-console-ports'
import { getEnv } from '@shared/env'
import { getWorkspaceNodeDir, normalizeWorkspaceRoot } from '@shared/workspace-paths'
import { resolveWemuxHomeDir, type WemuxHomeProfile } from '@shared/wemux-home'
import { resolveDefaultCloudUrl } from './default-cloud-url'
import { getWorkerRuntimeMetadata } from './app-root'
import { getWorkerRuntimeState } from './runtime-state'
import { getPackagedWorkerReleaseChannel, getWorkerReleaseChannel } from '../update/worker-release'

// 兼容窗口：新默认 `~/.wemux*`；存量 `~/.vibemux*` 目录存在时沿用
const DEFAULT_WORKER_HOMES = new Set(
  (['development', 'preview', 'production'] as const).flatMap((profile) => {
    const suffix = profile === 'development' ? '-dev' : profile === 'preview' ? '-preview' : ''
    return [
      path.resolve(path.join(os.homedir(), `.wemux${suffix}`)),
      path.resolve(path.join(os.homedir(), `.vibemux${suffix}`)),
    ]
  }),
)
const DEFAULT_LOCAL_CLOUD_URL = 'http://127.0.0.1:8989'
const LEGACY_LOCAL_CLOUD_URLS = new Set([
  'http://127.0.0.1:8989',
  'http://localhost:8989',
  'http://127.0.0.1:18989',
  'http://localhost:18989',
  'ws://127.0.0.1:8989',
  'ws://localhost:8989',
  'ws://127.0.0.1:18989',
  'ws://localhost:18989',
])

const hasManagedCloudUrlOverride = () => {
  return Boolean(process.env.VIBEMUX_CLOUD_URL?.trim())
}

const getManagedCloudUrl = () => {
  const explicit = getEnv('WEMUX_CLOUD_URL')?.trim()
  if (explicit) {
    return explicit
  }
  const runtimeDefault = getWorkerRuntimeMetadata().defaultCloudUrl?.trim()
  return resolveDefaultCloudUrl(runtimeDefault || DEFAULT_LOCAL_CLOUD_URL)
}

const PREVIEW_CLOUD_HOSTNAMES = ['vibemux.xyz', 'wemux.xyz']

const isPreviewCloudUrl = (cloudUrl: string) => {
  return PREVIEW_CLOUD_HOSTNAMES.some((hostname) => cloudUrl.includes(hostname))
}

const shouldReplaceLegacyLocalCloudUrl = (params: {
  cloudUrl?: string
  hasSavedPairing: boolean
}) => {
  if (process.env.NODE_ENV === 'development' || hasManagedCloudUrlOverride()) {
    return false
  }

  if (params.hasSavedPairing) {
    return false
  }

  if (LEGACY_LOCAL_CLOUD_URLS.has(params.cloudUrl?.trim() || '')) {
    return true
  }

  return false
}

type WorkerEnvironment = 'development' | 'preview' | 'production'

export const resolveWorkerEnvironmentFromRuntime = (params: {
  cloudUrl: string
  releaseChannel: string
  packagedReleaseChannel?: string
  nodeEnv?: string
}): WorkerEnvironment => {
  if (params.packagedReleaseChannel === 'preview' || params.packagedReleaseChannel === 'production') {
    return params.packagedReleaseChannel
  }

  if (params.releaseChannel === 'preview' || isPreviewCloudUrl(params.cloudUrl)) {
    return 'preview'
  }

  if (params.nodeEnv === 'development') {
    return 'development'
  }

  return 'production'
}

const resolveWorkerEnvironment = (): WorkerEnvironment => resolveWorkerEnvironmentFromRuntime({
  cloudUrl: getManagedCloudUrl(),
  releaseChannel: getWorkerReleaseChannel(),
  packagedReleaseChannel: getPackagedWorkerReleaseChannel(),
  nodeEnv: process.env.NODE_ENV,
})

export const isWorkerDevelopmentEnvironment = () => resolveWorkerEnvironment() === 'development'
export const isWorkerDevelopmentOrPreviewEnvironment = () => {
  const environment = resolveWorkerEnvironment()
  return environment === 'development' || environment === 'preview'
}

const resolveDefaultWorkerHome = () => {
  const profile: WemuxHomeProfile = (() => {
    switch (resolveWorkerEnvironment()) {
      case 'development':
        return 'development'
      case 'preview':
        return 'preview'
      default:
        return 'production'
    }
  })()
  return resolveWemuxHomeDir(profile)
}

const getManagedLocalServerPort = () => {
  const envPort = Number(process.env.VIBEMUX_WORKER_PORT?.trim())
  if (Number.isFinite(envPort) && envPort > 0) {
    return envPort
  }

  const runtimePort = getWorkerRuntimeMetadata().defaultLocalServerPort
  if (Number.isFinite(runtimePort) && runtimePort) {
    return runtimePort
  }

  switch (resolveWorkerEnvironment()) {
    case 'development':
      return getWorkerConsolePortBase('development')
    case 'preview':
      return getWorkerConsolePortBase('preview')
    default:
      return getWorkerConsolePortBase('production')
  }
}

const getLocalOpencodeConfigPathCandidates = () => {
  const configuredPath = process.env.OPENCODE_CONFIG_PATH?.trim()
  if (configuredPath) {
    return [configuredPath]
  }

  const opencodeRoot = path.join(os.homedir(), '.config', 'opencode')
  return [
    path.join(opencodeRoot, 'opencode.json'),
    path.join(opencodeRoot, 'opencode.jsonc'),
  ]
}

const getLocalCodexConfigPath = () => {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')
  return path.join(codexHome, 'config.toml')
}

const getLocalCodexAuthPath = () => {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex')
  return path.join(codexHome, 'auth.json')
}

const getLocalClaudeSettingsPath = () => {
  const claudeHome = process.env.CLAUDE_HOME?.trim() || path.join(os.homedir(), '.claude')
  return path.join(claudeHome, 'settings.json')
}

const getLocalPiAgentDir = () => {
  return process.env.PI_AGENT_DIR?.trim() || path.join(os.homedir(), '.pi', 'agent')
}

const loadLocalTextConfig = (configPath: string) => {
  if (!existsSync(configPath)) {
    return ''
  }

  try {
    return readFileSync(configPath, 'utf8').trim()
  } catch {
    return ''
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const mergeJsonRecords = (base: Record<string, unknown>, incoming: Record<string, unknown>) => {
  return Object.entries(incoming).reduce<Record<string, unknown>>((result, [key, value]) => {
    const current = result[key]
    if (isRecord(current) && isRecord(value)) {
      result[key] = mergeJsonRecords({ ...current }, value)
      return result
    }

    result[key] = value
    return result
  }, { ...base })
}

const readLocalOpencodeConfigSnapshot = () => {
  const entries = getLocalOpencodeConfigPathCandidates()
    .map((configPath) => ({
      path: configPath,
      content: loadLocalTextConfig(configPath),
    }))
    .filter((entry) => entry.content.trim())

  if (entries.length === 0) {
    return {
      opencodeConfigContent: '',
      defaultModel: '',
      sourcePaths: [] as string[],
    }
  }

  try {
    if (entries.length === 1) {
      const parsed = parseOpencodeConfigContent(entries[0].content) as { default?: Record<string, string> }
      const defaultEntry = Object.entries(parsed.default ?? {}).find(([, modelId]) => typeof modelId === 'string' && modelId.trim())
      return {
        opencodeConfigContent: entries[0].content,
        defaultModel: defaultEntry ? `${defaultEntry[0]}/${String(defaultEntry[1]).trim()}` : '',
        sourcePaths: entries.map((entry) => entry.path),
      }
    }

    const merged = entries.reduce<Record<string, unknown>>((result, entry) => {
      const parsed = parseOpencodeConfigContent(entry.content) as Record<string, unknown>
      return mergeJsonRecords(result, parsed)
    }, {})
    const defaultMap = isRecord(merged.default) ? merged.default : {}
    const defaultEntry = Object.entries(defaultMap).find(([, modelId]) => typeof modelId === 'string' && modelId.trim())
    return {
      opencodeConfigContent: JSON.stringify(merged, null, 2),
      defaultModel: defaultEntry ? `${defaultEntry[0]}/${String(defaultEntry[1]).trim()}` : '',
      sourcePaths: entries.map((entry) => entry.path),
    }
  } catch {
    return {
      opencodeConfigContent: '',
      defaultModel: '',
      sourcePaths: entries.map((entry) => entry.path),
    }
  }
}

const loadLocalOpencodeConfig = () => {
  const snapshot = readLocalOpencodeConfigSnapshot()
  return {
    opencodeConfigContent: snapshot.opencodeConfigContent,
    defaultModel: snapshot.defaultModel,
  }
}

const expandHomeTilde = (value: string) => {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

const getConfiguredWorkerHome = () => {
  const vibemuxWorkerHome = getEnv('WEMUX_WORKER_HOME')?.trim()
  if (vibemuxWorkerHome) {
    const resolvedWorkerHome = path.resolve(expandHomeTilde(vibemuxWorkerHome))
    const defaultWorkerHome = path.resolve(resolveDefaultWorkerHome())
    return DEFAULT_WORKER_HOMES.has(resolvedWorkerHome) && resolvedWorkerHome !== defaultWorkerHome
      ? defaultWorkerHome
      : resolvedWorkerHome
  }

  const vibemuxHome = getEnv('WEMUX_HOME')?.trim()
  if (vibemuxHome) {
    return path.join(expandHomeTilde(vibemuxHome), 'worker')
  }

  return resolveDefaultWorkerHome()
}

const normalizeWorkerRunMode = () => {
  const value = process.env.VIBEMUX_WORKER_RUN_MODE?.trim().toLowerCase()
  if (value === 'docker' || value === 'container') {
    return 'docker'
  }
  if (value === 'local' || value === 'host') {
    return 'local'
  }
  return ''
}

const normalizeWorkerRunModeLabels = (labels?: string[]) => {
  const runMode = normalizeWorkerRunMode()
  const existingLabels = (labels ?? []).map((label) => label.trim()).filter(Boolean)
  const withoutRunMode = existingLabels.filter((label) => !/^runtime:(local|docker|container|host)$/i.test(label))
  const nextRunMode = runMode || 'local'
  return Array.from(new Set([...withoutRunMode, `runtime:${nextRunMode}`]))
}

export const getWorkerHome = () => {
  return path.resolve(getConfiguredWorkerHome())
}

export const getWorkerNodeDir = () => {
  return getWorkspaceNodeDir(getWorkerHome())
}

export const getWorkerConfigPath = () => {
  mkdirSync(getWorkerNodeDir(), { recursive: true })
  return path.join(getWorkerNodeDir(), 'config.json')
}

export const getWorkerMachineIdPath = () => {
  mkdirSync(getWorkerNodeDir(), { recursive: true })
  return path.join(getWorkerNodeDir(), 'machine-id')
}

const ensureWorkerMachineId = () => {
  const workerNodeDir = getWorkerNodeDir()
  const machineIdPath = getWorkerMachineIdPath()

  if (existsSync(machineIdPath)) {
    const machineId = readFileSync(machineIdPath, 'utf8').trim()
    if (machineId) {
      return machineId
    }
  }

  mkdirSync(workerNodeDir, { recursive: true })
  const machineId = randomUUID()
  writeFileSync(machineIdPath, `${machineId}\n`, 'utf8')
  return machineId
}

export const getDefaultWorkerConfig = (): WorkerConfig => ({
  cloudUrl: getManagedCloudUrl(),
  machineId: ensureWorkerMachineId(),
  machineName: os.hostname(),
  opencodeConfigContent: '',
  codexConfigContent: '',
  codexAuthContent: '',
  claudeCodeConfigContent: '',
  piAgentDir: getLocalPiAgentDir(),
  defaultModel: '',
  agentSettings: normalizeAgentSettings(),
  workerUpdateSettings: normalizeWorkerUpdateSettings(),
  mcpServers: [],
  workspaceRoot: getWorkerHome(),
  maxConcurrency: 5,
  labels: normalizeWorkerRunModeLabels(),
  capabilities: ['code-execution', 'git-operations'],
  localServerPort: Number(process.env.VIBEMUX_WORKER_PORT || getManagedLocalServerPort()),
  previewExposureMode: 'private',
  previewIngressPort: 38080,
  previewProxySecret: '',
  projectBindings: [],
})

export const loadWorkerConfig = (): WorkerConfig => {
  bridgeWemuxEnvToLegacy()
  const configPath = getWorkerConfigPath()
  const parsed = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8')) as Partial<WorkerConfig>
    : {}
  const config: WorkerConfig = {
    ...getDefaultWorkerConfig(),
    ...parsed,
  }
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(config.workspaceRoot)
  if (existsSync(configPath) && parsed.workspaceRoot && parsed.workspaceRoot !== normalizedWorkspaceRoot) {
    writeFileSync(configPath, `${JSON.stringify({ ...parsed, workspaceRoot: normalizedWorkspaceRoot }, null, 2)}\n`, 'utf8')
  }
  config.workspaceRoot = normalizedWorkspaceRoot
  const localOpencodeConfig = loadLocalOpencodeConfig()

  if (hasManagedCloudUrlOverride()) {
    config.cloudUrl = getManagedCloudUrl()
  }

  if (shouldReplaceLegacyLocalCloudUrl({
    cloudUrl: config.cloudUrl,
    hasSavedPairing: Boolean(config.executorId && config.executorToken),
  })) {
    config.cloudUrl = getManagedCloudUrl()
  }

  const managedLocalServerPort = Number(process.env.VIBEMUX_WORKER_PORT?.trim())
  if (Number.isFinite(managedLocalServerPort) && managedLocalServerPort > 0) {
    config.localServerPort = managedLocalServerPort
  }

  const managedPreviewIngressPort = Number(process.env.VIBEMUX_PREVIEW_INGRESS_PORT?.trim())
  if (Number.isFinite(managedPreviewIngressPort) && managedPreviewIngressPort > 0) {
    config.previewIngressPort = managedPreviewIngressPort
  }

  if (!config.opencodeConfigContent?.trim()) {
    config.opencodeConfigContent = localOpencodeConfig.opencodeConfigContent
  }

  if (!config.codexConfigContent?.trim()) {
    config.codexConfigContent = loadLocalTextConfig(getLocalCodexConfigPath())
  }

  if (!config.codexAuthContent?.trim()) {
    config.codexAuthContent = loadLocalTextConfig(getLocalCodexAuthPath())
  }

  if (!config.claudeCodeConfigContent?.trim()) {
    config.claudeCodeConfigContent = getWorkerLocalClaudeCodeConfigContent()
  }

  if (!config.piAgentDir?.trim()) {
    config.piAgentDir = getLocalPiAgentDir()
  }

  if (!config.defaultModel?.trim()) {
    config.defaultModel = localOpencodeConfig.defaultModel
  }

  config.agentSettings = normalizeAgentSettings(config.agentSettings, config.defaultModel)
  config.workerUpdateSettings = normalizeWorkerUpdateSettings(config.workerUpdateSettings)
  config.labels = normalizeWorkerRunModeLabels(config.labels)

  return config
}

export const saveWorkerConfig = (config: WorkerConfig) => {
  const workerHome = getWorkerHome()
  mkdirSync(workerHome, { recursive: true })
  writeFileSync(getWorkerConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export const getWorkerLocalOpencodeConfigContent = () => {
  return readLocalOpencodeConfigSnapshot().opencodeConfigContent
}

export const getWorkerLocalCodexConfigContent = () => {
  return loadLocalTextConfig(getLocalCodexConfigPath())
}

export const getWorkerLocalCodexAuthContent = () => {
  return loadLocalTextConfig(getLocalCodexAuthPath())
}

export const getWorkerLocalClaudeCodeConfigContent = () => {
  return loadLocalTextConfig(getLocalClaudeSettingsPath())
}

export const getWorkerEffectiveOpencodeConfigContent = (config = loadWorkerConfig(), actingUserId?: string, workspaceId?: string) => {
  const effectiveCloudUrl = getWorkerRuntimeState().effectiveCloudUrl?.trim() || config.cloudUrl
  return buildOpencodeConfigWithMcp(config.opencodeConfigContent, config.mcpServers ?? [], {
    cloudUrl: effectiveCloudUrl,
    executorToken: config.executorToken,
    actingUserId,
    workspaceId,
  })
}

export const resetWorkerConfig = () => {
  rmSync(getWorkerConfigPath(), { force: true })
}

export const clearWorkerPairing = () => {
  const next = {
    ...loadWorkerConfig(),
    executorName: undefined,
    executorId: undefined,
    executorToken: undefined,
    lastPairedPairingCode: undefined,
    previewProxySecret: undefined,
  }

  saveWorkerConfig(next)
  return next
}
