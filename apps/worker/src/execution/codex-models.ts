// [INPUT]: Codex 模型源
// [OUTPUT]: Codex 模型清单
// [POS]: Codex 模型列表
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildExecutionModelId } from '@shared/model-profile'
import type { ExecutionModelOption, WorkerConfig } from '@shared/types'
import { getWorkerLocalCodexAuthContent, getWorkerLocalCodexConfigContent, loadWorkerConfig } from '../core/config'

type ParsedCodexProviderConfig = {
  apiToken: string
  baseUrl: string
  providerId: string
  configuredModel: string
  envKey: string
}

type CodexModelListResult = {
  models: ExecutionModelOption[]
  defaultModel?: string
  message?: string
}

const DEFAULT_CODEX_PROVIDER_ID = 'openai'
const DEFAULT_CODEX_ENV_KEY = 'OPENAI_API_KEY'
const DEFAULT_TIMEOUT_MS = 10_000

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const normalizeString = (value: unknown) => {
  return typeof value === 'string' ? value.trim() : ''
}

const escapeTomlString = (value: string) => {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const normalizeTomlSectionName = (value: string) => {
  return value
    .split('.')
    .map((segment) => segment.trim().replace(/^"(.*)"$/, '$1'))
    .join('.')
}

export const parseCodexCredentialEnvironment = (content?: string) => {
  const normalized = content?.trim() || ''
  if (!normalized) {
    return {} as Record<string, string>
  }

  try {
    const parsed = JSON.parse(normalized) as unknown
    if (!isRecord(parsed)) {
      return {}
    }

    // Official `codex login` credentials are AuthDotJson. They must be
    // materialized as CODEX_HOME/auth.json, not injected as environment keys.
    if (parsed.auth_mode === 'chatgpt' && isRecord(parsed.tokens)) {
      return {}
    }

    const env = Object.entries(parsed).reduce<Record<string, string>>((result, [key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        result[key] = value.trim()
      }
      return result
    }, {})

    const legacyAccessToken = normalizeString(parsed.access_token) || normalizeString(parsed.accessToken)
    if (legacyAccessToken && !env.CODEX_ACCESS_TOKEN) {
      env.CODEX_ACCESS_TOKEN = legacyAccessToken
    }

    return env
  } catch {
    return {}
  }
}

/** Returns true for the official ChatGPT OAuth AuthDotJson shape. */
export const hasCodexAuthDotJsonContent = (content?: string) => {
  const normalized = content?.trim() || ''
  if (!normalized) {
    return false
  }

  try {
    const parsed = JSON.parse(normalized) as unknown
    if (!isRecord(parsed) || parsed.auth_mode !== 'chatgpt' || !isRecord(parsed.tokens)) {
      return false
    }

    return Boolean(
      normalizeString(parsed.tokens.access_token)
      && normalizeString(parsed.tokens.refresh_token),
    )
  } catch {
    return false
  }
}

export const hasLegacyCodexAccessTokenContent = (content?: string) => {
  const normalized = content?.trim() || ''
  if (!normalized) {
    return false
  }

  try {
    const parsed = JSON.parse(normalized) as unknown
    if (!isRecord(parsed)) {
      return false
    }

    const hasLegacyAccessToken = Boolean(normalizeString(parsed.access_token) || normalizeString(parsed.accessToken))
    if (!hasLegacyAccessToken) {
      return false
    }

    const hasExplicitEnvKey = Object.keys(parsed).some((key) => /^[A-Z0-9_]+$/.test(key.trim()))
    return !hasExplicitEnvKey
  } catch {
    return false
  }
}

export const ensureCodexProviderNameInConfig = (content: string, providerId?: string) => {
  const normalizedProviderId = providerId?.trim()
  if (!content.trim() || !normalizedProviderId) {
    return { content, changed: false }
  }

  const targetSection = `model_providers.${normalizedProviderId}`
  const output: string[] = []
  let currentSection = ''
  let targetSectionOpen = false
  let targetSectionHasName = false
  let changed = false

  const flushTargetSection = () => {
    if (!targetSectionOpen) {
      return
    }

    if (!targetSectionHasName) {
      output.push(`name = "${escapeTomlString(normalizedProviderId)}"`)
      changed = true
    }

    targetSectionOpen = false
    targetSectionHasName = false
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      flushTargetSection()
      currentSection = normalizeTomlSectionName(sectionMatch[1] ?? '')
      targetSectionOpen = currentSection === targetSection
      output.push(rawLine)
      continue
    }

    if (targetSectionOpen) {
      const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/)
      if (keyMatch?.[1] === 'name') {
        targetSectionHasName = true
      }
    }

    output.push(rawLine)
  }

  flushTargetSection()

  return {
    content: changed ? output.join('\n') : content,
    changed,
  }
}

export const ensureCodexProviderEnvKeyInConfig = (content: string, providerId?: string, envKey?: string) => {
  const normalizedProviderId = providerId?.trim()
  const normalizedEnvKey = envKey?.trim()
  if (!content.trim() || !normalizedProviderId || !normalizedEnvKey) {
    return { content, changed: false }
  }

  const targetSection = `model_providers.${normalizedProviderId}`
  const output: string[] = []
  let currentSection = ''
  let targetSectionOpen = false
  let targetSectionHasEnvKey = false
  let changed = false

  const flushTargetSection = () => {
    if (!targetSectionOpen) {
      return
    }

    if (!targetSectionHasEnvKey) {
      output.push(`env_key = "${escapeTomlString(normalizedEnvKey)}"`)
      changed = true
    }

    targetSectionOpen = false
    targetSectionHasEnvKey = false
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      flushTargetSection()
      currentSection = normalizeTomlSectionName(sectionMatch[1] ?? '')
      targetSectionOpen = currentSection === targetSection
      output.push(rawLine)
      continue
    }

    if (targetSectionOpen) {
      const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/)
      if (keyMatch?.[1] === 'env_key') {
        targetSectionHasEnvKey = true
      }
    }

    output.push(rawLine)
  }

  flushTargetSection()

  return {
    content: changed ? output.join('\n') : content,
    changed,
  }
}

const parseTomlString = (line: string) => {
  const match = line.match(/^[A-Za-z0-9_.-]+\s*=\s*["']([^"']+)["']/)
  return match?.[1]?.trim() || ''
}

const parseCanonicalProvider = (modelId: string) => {
  const slashIndex = modelId.indexOf('/')
  if (slashIndex < 0) {
    return ''
  }

  return modelId.slice(0, slashIndex).trim()
}

const inferProviderFromBaseUrl = (baseUrl: string) => {
  if (!baseUrl) {
    return ''
  }

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    const segments = hostname.split('.').filter(Boolean)
    const ignored = new Set(['api', 'www', 'cn', 'com', 'net', 'org', 'io', 'ai'])
    return segments.find((segment) => !ignored.has(segment)) || ''
  } catch {
    return ''
  }
}

const resolveCodexConfigSource = (config?: WorkerConfig) => {
  const workerConfig = config ?? loadWorkerConfig()
  return {
    authContent: getWorkerLocalCodexAuthContent() || workerConfig.codexAuthContent,
    configContent: getWorkerLocalCodexConfigContent() || workerConfig.codexConfigContent,
    fallbackDefaultModel: workerConfig.agentSettings?.Codex?.defaultModel?.trim() || '',
  }
}

export const resolveCodexProviderConfig = (params: {
  configContent?: string
  authContent?: string
  env?: Record<string, string | undefined>
}): ParsedCodexProviderConfig => {
  const lines = (params.configContent?.trim() || '').split(/\r?\n/)
  const authRecord = parseCodexCredentialEnvironment(params.authContent)
  const envRecord = params.env ?? process.env
  let currentSection = ''
  let configuredModel = ''
  let configuredProviderId = ''
  let topLevelBaseUrl = ''
  let providerBaseUrl = ''
  let providerEnvKey = ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() || ''
      continue
    }

    const keyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["'][^"']+["']/)
    const key = keyMatch?.[1]?.trim() || ''
    const value = parseTomlString(line)
    if (!key || !value) {
      continue
    }

    if (!currentSection) {
      if (key === 'model') {
        configuredModel = value
      } else if (key === 'model_provider') {
        configuredProviderId = value
      } else if (key === 'base_url' || key === 'openai_base_url') {
        topLevelBaseUrl = value
      }
      continue
    }

    if (currentSection === `model_providers.${configuredProviderId}`) {
      if (key === 'base_url') {
        providerBaseUrl = value
      } else if (key === 'env_key') {
        providerEnvKey = value
      }
    }
  }

  const providerId = configuredProviderId
    || parseCanonicalProvider(configuredModel)
    || inferProviderFromBaseUrl(providerBaseUrl || topLevelBaseUrl)
    || DEFAULT_CODEX_PROVIDER_ID
  const envKey = providerEnvKey || DEFAULT_CODEX_ENV_KEY
  const authToken = normalizeString(authRecord[envKey])
    || normalizeString(envRecord[envKey])
    || normalizeString(authRecord[DEFAULT_CODEX_ENV_KEY])
    || normalizeString(envRecord[DEFAULT_CODEX_ENV_KEY])
    || normalizeString(authRecord.CODEX_ACCESS_TOKEN)
    || normalizeString(envRecord.CODEX_ACCESS_TOKEN)

  return {
    apiToken: authToken,
    baseUrl: providerBaseUrl || topLevelBaseUrl || normalizeString(envRecord.OPENAI_BASE_URL),
    providerId,
    configuredModel,
    envKey,
  }
}

const resolveModelsEndpoint = (baseUrl: string) => {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/g, '')
  if (!normalizedBaseUrl) {
    return ''
  }

  return normalizedBaseUrl.endsWith('/models')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/models`
}

const buildExecutionModelOption = (
  providerId: string,
  modelId: string,
  defaultModel?: string,
): ExecutionModelOption => ({
  id: buildExecutionModelId(providerId, modelId),
  label: `${providerId}/${modelId}`,
  providerId,
  modelId,
  isDefault: modelId === defaultModel,
})

const dedupeModelIds = (modelIds: string[], defaultModel?: string) => {
  const seen = new Set<string>()
  const ordered = defaultModel?.trim() ? [defaultModel.trim(), ...modelIds] : modelIds
  return ordered.filter((modelId) => {
    const normalized = modelId.trim()
    if (!normalized || seen.has(normalized)) {
      return false
    }

    seen.add(normalized)
    return true
  })
}

const extractModelIds = (payload: unknown) => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return []
  }

  return payload.data
    .map((entry) => (isRecord(entry) ? normalizeString(entry.id) : ''))
    .filter(Boolean)
}

export const listCodexAvailableModels = async (params: {
  authContent?: string
  configContent?: string
  fallbackDefaultModel?: string
}, options: {
  fetchImpl?: typeof fetch
} = {}): Promise<CodexModelListResult> => {
  const parsed = resolveCodexProviderConfig({
    authContent: params.authContent,
    configContent: params.configContent,
  })
  const defaultModel = parsed.configuredModel || params.fallbackDefaultModel?.trim() || undefined
  const fallbackModels = dedupeModelIds(defaultModel ? [defaultModel] : [], defaultModel)
    .map((modelId) => buildExecutionModelOption(parsed.providerId, modelId, defaultModel))

  if (!params.configContent?.trim()) {
    return {
      models: fallbackModels,
      defaultModel,
      message: 'worker 未配置 Codex 模型。',
    }
  }

  const endpoint = resolveModelsEndpoint(parsed.baseUrl)
  const apiToken = parsed.apiToken

  if (!endpoint || !apiToken) {
    return {
      models: fallbackModels,
      defaultModel,
      message: fallbackModels.length > 0
        ? 'Codex provider 未声明可读取的模型列表，已回退为当前默认模型。'
        : 'Codex provider 缺少 Base URL 或 API Key，无法读取模型列表。',
    }
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = await response.json().catch(() => null)
    const modelIds = dedupeModelIds(extractModelIds(payload), defaultModel)
    const models = modelIds.map((modelId) => buildExecutionModelOption(parsed.providerId, modelId, defaultModel))
    return {
      models: models.length > 0 ? models : fallbackModels,
      defaultModel,
      message: models.length > 0
        ? '已从 Codex provider 读取模型列表。'
        : 'Codex provider 未返回模型列表，已回退为当前默认模型。',
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? `读取 Codex provider 模型超时（>${DEFAULT_TIMEOUT_MS}ms）。`
      : error instanceof Error
        ? error.message
        : '读取 Codex provider 模型失败。'
    return {
      models: fallbackModels,
      defaultModel,
      message: fallbackModels.length > 0
        ? `读取 Codex provider 模型失败，已回退为当前默认模型：${message}`
        : `读取 Codex provider 模型失败：${message}`,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export const listWorkerAvailableCodexModels = async (config?: WorkerConfig) => {
  const source = resolveCodexConfigSource(config)
  return listCodexAvailableModels(source)
}
