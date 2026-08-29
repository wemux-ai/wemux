// [INPUT]: runtime 模型配置
// [OUTPUT]: canonical 模型导出
// [POS]: 模型配置导出
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseOpencodeConfigContent } from '@shared/opencode-config'
import type { ExecutionModelOption, ModelProfileRuntimeSettings, ResolvedModelImportBinding, WorkerConfig } from '@shared/types'
import { resolveCodexProviderConfig } from '../execution/codex-models'
import { resolvePiModelBindings } from '../execution/pi-models'

const readEnvPlaceholder = (value: string) => {
  const match = value.trim().match(/^\$\{([A-Z0-9_]+)\}$/i)
  if (!match) {
    return value.trim()
  }

  return process.env[match[1]]?.trim() || ''
}

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }

  return readEnvPlaceholder(value).trim()
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const pickString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = normalizeString(record[key])
    if (value) {
      return value
    }
  }

  return ''
}

const readJsonObject = (filePath: string) => {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const pickClaudeModelId = (parsed: { model?: unknown; env?: Record<string, unknown> }) => {
  const directModel = normalizeString(parsed.model)
  if (directModel) {
    return directModel
  }

  const env = parsed.env && typeof parsed.env === 'object' ? parsed.env : {}
  return pickString(env, [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ])
}

const parseOpenCodeBindings = (config: WorkerConfig, availableModels: ExecutionModelOption[]): ResolvedModelImportBinding[] => {
  const parsed = parseOpencodeConfigContent(config.opencodeConfigContent)
  const providerEntries = Object.entries((parsed.provider ?? parsed.providers ?? {}) as Record<string, unknown>)
  const providerSecrets = new Map<string, { baseUrl?: string; apiToken?: string }>()

  for (const [providerId, value] of providerEntries) {
    if (!value || typeof value !== 'object') {
      continue
    }

    const record = value as Record<string, unknown>
    const options = isRecord(record.options) ? record.options : {}
    const baseUrl = pickString(options, ['baseURL', 'baseUrl', 'base_url', 'url', 'endpoint'])
      || pickString(record, ['baseURL', 'baseUrl', 'base_url', 'url', 'endpoint'])
    const apiToken = pickString(options, ['apiKey', 'api_key', 'token', 'authToken', 'apiToken'])
      || pickString(record, ['apiKey', 'api_key', 'token', 'authToken', 'apiToken'])
    providerSecrets.set(providerId, {
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiToken ? { apiToken } : {}),
    })
  }

  return availableModels.map((model) => ({
    providerId: model.providerId,
    modelId: model.modelId,
    label: `OpenCode · ${model.id}`,
    ...providerSecrets.get(model.providerId),
    runtimeSettings: {
      defaultModel: model.id,
    } satisfies ModelProfileRuntimeSettings,
  }))
}

const parseTomlString = (content: string, key: string) => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*["']([^"']+)["']`, 'mi'))
  return match?.[1]?.trim() || ''
}

const parseCanonicalModel = (value?: string) => {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return null
  }

  const slashIndex = normalized.indexOf('/')
  if (slashIndex < 0) {
    return null
  }

  const providerId = normalized.slice(0, slashIndex).trim()
  const modelId = normalized.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) {
    return null
  }

  return {
    providerId,
    modelId,
  }
}

const PROVIDER_ID_ALIASES = new Map<string, string>([
  ['claude', 'anthropic'],
  ['dashscope', 'qwen'],
  ['gemini', 'google'],
  ['glm', 'zhipu'],
  ['grok', 'xai'],
  ['kimi', 'moonshot'],
  ['volcengine', 'doubao'],
])

const CANONICAL_PROVIDER_IDS = new Set([
  'anthropic',
  'baichuan',
  'deepseek',
  'doubao',
  'google',
  'groq',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshot',
  'openai',
  'openrouter',
  'pi',
  'qwen',
  'xai',
  'zhipu',
])

const OFFICIAL_PROVIDER_HOSTNAMES = [
  { providerId: 'anthropic', hostname: 'api.anthropic.com' },
  { providerId: 'deepseek', hostname: 'api.deepseek.com' },
  { providerId: 'google', hostname: 'generativelanguage.googleapis.com' },
  { providerId: 'groq', hostname: 'api.groq.com' },
  { providerId: 'minimax-cn', hostname: 'api.minimaxi.com' },
  { providerId: 'minimax', hostname: 'api.minimax.io' },
  { providerId: 'mistral', hostname: 'api.mistral.ai' },
  { providerId: 'moonshot', hostname: 'api.moonshot.ai' },
  { providerId: 'openai', hostname: 'api.openai.com' },
  { providerId: 'openrouter', hostname: 'openrouter.ai' },
  { providerId: 'qwen', hostname: 'dashscope.aliyuncs.com' },
  { providerId: 'xai', hostname: 'x.ai' },
  { providerId: 'zhipu', hostname: 'open.bigmodel.cn' },
] as const

const normalizeProviderId = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const canonicalizeProviderId = (value?: string) => {
  const trimmed = value?.trim() || ''
  if (!trimmed) {
    return ''
  }

  const normalized = normalizeProviderId(trimmed)
  return PROVIDER_ID_ALIASES.get(normalized)
    || (CANONICAL_PROVIDER_IDS.has(normalized) ? normalized : trimmed)
}

const matchesHostname = (hostname: string, expectedHostname: string) => {
  return hostname === expectedHostname || hostname.endsWith(`.${expectedHostname}`)
}

const inferOfficialProviderFromHostname = (hostname: string) => {
  const match = OFFICIAL_PROVIDER_HOSTNAMES.find((provider) => matchesHostname(hostname, provider.hostname))
  return match?.providerId || ''
}

const inferProviderFromBaseUrl = (baseUrl?: string) => {
  const normalized = baseUrl?.trim()
  if (!normalized) {
    return ''
  }

  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase()
    const officialProvider = inferOfficialProviderFromHostname(hostname)
    if (officialProvider) {
      return officialProvider
    }

    const knownProviders = [
      'minimax',
      'openrouter',
      'anthropic',
      'openai',
      'deepseek',
      'moonshot',
      'kimi',
      'gemini',
      'google',
      'xai',
      'grok',
      'groq',
      'qwen',
      'dashscope',
      'doubao',
      'volcengine',
      'baichuan',
      'zhipu',
      'glm',
      'mistral',
    ]

    const matchedProvider = knownProviders.find((provider) => hostname.includes(provider))
    if (matchedProvider) {
      if (matchedProvider === 'kimi') return 'moonshot'
      if (matchedProvider === 'gemini') return 'google'
      if (matchedProvider === 'grok') return 'xai'
      if (matchedProvider === 'dashscope') return 'qwen'
      if (matchedProvider === 'volcengine') return 'doubao'
      if (matchedProvider === 'glm') return 'zhipu'
      return matchedProvider
    }

    const segments = hostname.split('.').filter(Boolean)
    const ignoredSegments = new Set(['api', 'www', 'chat', 'cn', 'com', 'net', 'org', 'io', 'ai'])
    const candidate = segments.find((segment) => !ignoredSegments.has(segment))
    return candidate ? normalizeProviderId(candidate) : ''
  } catch {
    return ''
  }
}

const inferProviderFromModelId = (modelId?: string) => {
  const normalized = modelId?.trim().toLowerCase() || ''
  if (!normalized) {
    return ''
  }

  if (normalized.includes('minimax')) return 'minimax'
  if (normalized.includes('claude')) return 'anthropic'
  if (normalized.includes('gpt')) return 'openai'
  if (normalized.includes('gemini')) return 'google'
  if (normalized.includes('deepseek')) return 'deepseek'
  if (normalized.includes('kimi') || normalized.includes('moonshot')) return 'moonshot'
  if (normalized.includes('grok')) return 'xai'
  if (normalized.includes('qwen')) return 'qwen'
  if (normalized.includes('doubao')) return 'doubao'
  if (normalized.includes('glm')) return 'zhipu'
  return ''
}

const shouldPreferBaseUrlProvider = (explicitProviderId: string, baseUrlProviderId: string) => {
  if (!explicitProviderId || !baseUrlProviderId || explicitProviderId === baseUrlProviderId) {
    return false
  }

  if (!CANONICAL_PROVIDER_IDS.has(baseUrlProviderId)) {
    return false
  }

  if (explicitProviderId === 'openai' || explicitProviderId === 'anthropic') {
    return true
  }

  return explicitProviderId === 'minimax' && baseUrlProviderId === 'minimax-cn'
}

const resolveCompatibleProviderId = (params: {
  explicitProviderId?: string
  baseUrl?: string
  modelId: string
  fallbackProviderId: string
}) => {
  const explicitProviderId = canonicalizeProviderId(params.explicitProviderId)
  const baseUrlProviderId = inferProviderFromBaseUrl(params.baseUrl)
  if (shouldPreferBaseUrlProvider(explicitProviderId, baseUrlProviderId)) {
    return baseUrlProviderId
  }

  if (explicitProviderId) {
    return explicitProviderId
  }

  return baseUrlProviderId || inferProviderFromModelId(params.modelId) || params.fallbackProviderId.trim()
}

const buildProviderModelLabel = (providerId: string, modelId: string) => {
  const normalizedProviderId = providerId.trim()
  const normalizedModelId = modelId.trim()
  if (!normalizedProviderId || !normalizedModelId) {
    return normalizedModelId || normalizedProviderId
  }

  return normalizedModelId.toLowerCase().startsWith(`${normalizedProviderId.toLowerCase()}/`)
    ? normalizedModelId
    : `${normalizedProviderId}/${normalizedModelId}`
}

const buildResolvedBindingLabel = (runtimeLabel: string, providerId: string, modelId: string) => {
  return `${runtimeLabel} · ${buildProviderModelLabel(providerId, modelId)}`
}

const resolveCodexBinding = (
  config: WorkerConfig,
  availableModels: ExecutionModelOption[],
): ResolvedModelImportBinding[] => {
  const content = config.codexConfigContent?.trim() || ''
  const resolvedProvider = resolveCodexProviderConfig({
    authContent: config.codexAuthContent,
    configContent: content,
  })
  const modelId = resolvedProvider.configuredModel
  const baseUrl = resolvedProvider.baseUrl
  const apiToken = resolvedProvider.apiToken
  const explicitProviderId = parseCanonicalModel(modelId)?.providerId || resolvedProvider.providerId
  const providerId = resolveCompatibleProviderId({
    explicitProviderId,
    baseUrl,
    modelId,
    fallbackProviderId: 'openai',
  })
  const discoveredModels = availableModels.filter((model) => {
    return model.providerId.trim().toLowerCase() === providerId.trim().toLowerCase()
  })

  if (discoveredModels.length > 0) {
    return discoveredModels.map((model) => ({
      providerId,
      modelId: model.modelId,
      label: buildResolvedBindingLabel('Codex', providerId, model.modelId),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiToken ? { apiToken } : {}),
      runtimeSettings: {
        defaultModel: model.modelId,
      } satisfies ModelProfileRuntimeSettings,
    }))
  }

  if (!modelId) {
    return []
  }

  return [{
    providerId,
    modelId,
    label: buildResolvedBindingLabel('Codex', providerId, modelId),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiToken ? { apiToken } : {}),
    runtimeSettings: {
      defaultModel: modelId,
    } satisfies ModelProfileRuntimeSettings,
  }]
}

const resolveClaudeBinding = (config: WorkerConfig): ResolvedModelImportBinding[] => {
  const content = config.claudeCodeConfigContent?.trim() || ''
  if (!content) {
    return []
  }

  try {
    const parsed = JSON.parse(content) as {
      model?: unknown
      env?: Record<string, unknown>
    }
    const modelId = pickClaudeModelId(parsed)
    if (!modelId) {
      return []
    }

    const env = parsed.env && typeof parsed.env === 'object' ? parsed.env : {}
    const baseUrl = pickString(env, ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL']) || process.env.ANTHROPIC_BASE_URL?.trim() || ''
    const apiToken = pickString(env, ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'])
      || process.env.ANTHROPIC_AUTH_TOKEN?.trim()
      || process.env.ANTHROPIC_API_KEY?.trim()
      || ''
    const explicitProviderId = parseCanonicalModel(modelId)?.providerId
    const providerId = resolveCompatibleProviderId({
      explicitProviderId,
      baseUrl,
      modelId,
      fallbackProviderId: 'anthropic',
    })

    return [{
      providerId,
      modelId,
      label: buildResolvedBindingLabel('ClaudeCode', providerId, modelId),
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiToken ? { apiToken } : {}),
      runtimeSettings: {
        defaultModel: modelId,
      } satisfies ModelProfileRuntimeSettings,
    }]
  } catch {
    return []
  }
}

const resolvePiBinding = (config: WorkerConfig): ResolvedModelImportBinding[] => {
  return resolvePiModelBindings(config)
}

export const resolveExportedModelBindings = (params: {
  config: WorkerConfig
  agentType?: 'OpenCode' | 'Codex' | 'ClaudeCode' | 'Pi'
  availableModels: ExecutionModelOption[]
}) => {
  if (params.agentType === 'OpenCode') {
    return parseOpenCodeBindings(params.config, params.availableModels)
  }

  if (params.agentType === 'Codex') {
    return resolveCodexBinding(params.config, params.availableModels)
  }

  if (params.agentType === 'ClaudeCode') {
    return resolveClaudeBinding(params.config)
  }

  if (params.agentType === 'Pi') {
    return resolvePiBinding(params.config)
  }

  return []
}
