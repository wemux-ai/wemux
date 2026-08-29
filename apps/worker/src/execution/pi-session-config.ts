// [INPUT]: Pi 会话配置输入
// [OUTPUT]: 规范化会话配置
// [POS]: Pi 会话配置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AuthStorage, ModelRegistry, SessionManager, SettingsManager } from '@mariozechner/pi-coding-agent'
import type { PiAgentSettings } from '@shared/types'
import { loadWorkerConfig } from '../core/config'

type PiResolvedModel = {
  providerId: string
  modelId: string
}

type PiSessionConfigResult = {
  agentDir: string
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  selectedModel: ReturnType<ModelRegistry['find']> | undefined
  sessionManager: SessionManager
  settingsManager: SettingsManager
  cleanup: () => void
}

type PiSessionEntry = {
  id?: string
  type?: string
  message?: {
    role?: string
    content?: unknown
    stopReason?: string
    errorMessage?: string
    toolCallId?: string
    toolName?: string
  }
}

const DEFAULT_MODEL_INPUT = ['text'] as const
const DEFAULT_MODEL_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
}
const PI_BUILT_IN_PROVIDER_IDS = new Set([
  'amazon-bedrock',
  'anthropic',
  'azure-openai-responses',
  'cerebras',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'github-copilot',
  'google',
  'google-antigravity',
  'google-gemini-cli',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'mistral',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'vercel-ai-gateway',
  'xai',
  'zai',
])
const CONSERVATIVE_OPENAI_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: 'max_tokens',
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
} as const
const PROVIDER_ID_ALIASES = new Map<string, string>([
  ['claude', 'anthropic'],
  ['dashscope', 'qwen'],
  ['gemini', 'google'],
  ['glm', 'zhipu'],
  ['grok', 'xai'],
  ['kimi', 'moonshot'],
  ['volcengine', 'doubao'],
])

const canonicalizeProviderId = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return PROVIDER_ID_ALIASES.get(normalized) || normalized
}

const normalizeProviderEnvPrefix = (providerId: string) => {
  const normalized = providerId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'MODEL'
}

const resolveEnvPrefix = (providerId: string) => {
  const normalized = providerId.trim().toLowerCase()
  if (normalized === 'openai') return 'OPENAI'
  if (normalized === 'anthropic' || normalized === 'claude') return 'ANTHROPIC'
  if (normalized === 'google' || normalized === 'gemini') return 'GOOGLE'
  if (normalized === 'minimax') return 'MINIMAX'
  if (normalized === 'minimax-cn') return 'MINIMAX_CN'
  return normalizeProviderEnvPrefix(providerId)
}

const parseExecutionModel = (value?: string) => {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return null
  }

  const slashIndex = normalized.indexOf('/')
  if (slashIndex < 0) {
    return null
  }

  const providerId = canonicalizeProviderId(normalized.slice(0, slashIndex))
  const modelId = normalized.slice(slashIndex + 1).trim()
  if (!providerId || !modelId) {
    return null
  }

  return {
    providerId,
    modelId,
  } satisfies PiResolvedModel
}

const resolvePiAgentDir = (settings: PiAgentSettings | undefined, runtimeEnv?: Record<string, string>) => {
  const runtimeAgentDir = runtimeEnv?.WEMUX_PI_AGENT_DIR?.trim()
  if (runtimeAgentDir) {
    return runtimeAgentDir
  }

  const configuredAgentDir = settings?.agentDir?.trim() || loadWorkerConfig().piAgentDir?.trim()
  if (configuredAgentDir) {
    return configuredAgentDir
  }

  return path.join(os.homedir(), '.pi', 'agent')
}

const buildManagedSessionDir = (cwd: string, agentDir: string, executionModel?: string) => {
  const digest = createHash('sha1').update(`${agentDir}::${cwd}::${executionModel?.trim() || ''}`).digest('hex').slice(0, 16)
  return path.join(agentDir, 'sessions-vibemux', digest)
}

const resolveRuntimeProviderConfig = (model: PiResolvedModel, runtimeEnv?: Record<string, string>) => {
  const prefix = resolveEnvPrefix(model.providerId)
  return {
    apiKey: runtimeEnv?.[`${prefix}_API_KEY`]?.trim() || '',
    baseUrl: runtimeEnv?.[`${prefix}_BASE_URL`]?.trim() || '',
  }
}

const inferModelApi = (model: PiResolvedModel, baseUrl?: string) => {
  const combined = `${model.providerId} ${model.modelId} ${baseUrl || ''}`.toLowerCase()
  if (combined.includes('anthropic') || combined.includes('claude')) {
    return 'anthropic-messages'
  }
  if (combined.includes('google') || combined.includes('gemini')) {
    return 'google-generative-ai'
  }
  return 'openai-completions'
}

const inferReasoningSupport = (model: PiResolvedModel) => {
  const normalized = `${model.providerId}/${model.modelId}`.toLowerCase()
  return normalized.includes('gpt-5')
    || normalized.includes('claude')
    || normalized.includes('gemini')
    || normalized.includes('deepseek')
    || normalized.includes('qwen')
    || normalized.includes('kimi')
}

const inferInputModes = (model: PiResolvedModel) => {
  const normalized = `${model.providerId}/${model.modelId}`.toLowerCase()
  return normalized.includes('vision')
    || normalized.includes('omni')
    || normalized.includes('gemini')
    || normalized.includes('claude')
    || normalized.includes('gpt-4')
    || normalized.includes('gpt-5')
    ? ['text', 'image']
    : [...DEFAULT_MODEL_INPUT]
}

const readJsonObject = (filePath: string) => {
  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

const pickConfigString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

const pickExistingProviderConfig = (providers: Record<string, unknown>, providerId: string) => {
  const existing = providers[providerId]
  return isRecord(existing) ? existing : {}
}

const mergeCompatConfig = (...items: Array<unknown>) => {
  const merged: Record<string, unknown> = {}
  let changed = false

  for (const item of items) {
    if (!isRecord(item)) {
      continue
    }

    Object.assign(merged, item)
    changed = true
  }

  return changed ? merged : undefined
}

const resolveProviderCompat = (params: {
  api: string
  existingProviderConfig: Record<string, unknown>
  model: PiResolvedModel
}) => {
  const existingCompat = isRecord(params.existingProviderConfig.compat)
    ? params.existingProviderConfig.compat
    : undefined
  if (params.api !== 'openai-completions' || PI_BUILT_IN_PROVIDER_IDS.has(params.model.providerId)) {
    return existingCompat
  }

  // Unknown OpenAI-compatible gateways often reject OpenAI-only payload fields
  // such as developer role, store, reasoning_effort, strict, or stream_options.
  return mergeCompatConfig(CONSERVATIVE_OPENAI_COMPAT, existingCompat)
}

const buildOverlayModelDefinition = (params: {
  baseModel: ReturnType<ModelRegistry['find']> | undefined
  existingModelConfig?: unknown
  model: PiResolvedModel
}) => {
  const existingModel = isRecord(params.existingModelConfig) ? params.existingModelConfig : {}
  return {
    ...existingModel,
    id: params.model.modelId,
    name: pickConfigString(existingModel, ['name']) || params.baseModel?.name || params.model.modelId,
    reasoning: typeof existingModel.reasoning === 'boolean'
      ? existingModel.reasoning
      : params.baseModel?.reasoning ?? inferReasoningSupport(params.model),
    input: Array.isArray(existingModel.input)
      ? existingModel.input
      : params.baseModel?.input ?? inferInputModes(params.model),
    contextWindow: typeof existingModel.contextWindow === 'number'
      ? existingModel.contextWindow
      : params.baseModel?.contextWindow ?? 128000,
    maxTokens: typeof existingModel.maxTokens === 'number'
      ? existingModel.maxTokens
      : params.baseModel?.maxTokens ?? 16384,
    cost: isRecord(existingModel.cost)
      ? existingModel.cost
      : params.baseModel?.cost ?? DEFAULT_MODEL_COST,
    ...(params.baseModel?.headers && !existingModel.headers ? { headers: params.baseModel.headers } : {}),
    ...(params.baseModel?.compat && !existingModel.compat ? { compat: params.baseModel.compat } : {}),
  }
}

const upsertOverlayModel = (models: unknown, nextModel: Record<string, unknown>) => {
  const existingModels = Array.isArray(models)
    ? models.filter((model): model is Record<string, unknown> => isRecord(model))
    : []
  const nextModelId = typeof nextModel.id === 'string' ? nextModel.id : ''
  let replaced = false
  const nextModels = existingModels.map((model) => {
    if (typeof model.id !== 'string' || model.id !== nextModelId) {
      return model
    }

    replaced = true
    return nextModel
  })

  if (!replaced) {
    nextModels.push(nextModel)
  }

  return nextModels
}

const mergeProviderConfig = (params: {
  agentDir: string
  baseRegistry: ModelRegistry
  model: PiResolvedModel
  apiKey?: string
  baseUrl?: string
}) => {
  const existingModelsPath = path.join(params.agentDir, 'models.json')
  const existingModels = readJsonObject(existingModelsPath)
  const existingProviders = existingModels.providers && typeof existingModels.providers === 'object'
    ? existingModels.providers as Record<string, unknown>
    : {}
  const baseModel = params.baseRegistry.find(params.model.providerId, params.model.modelId)
  const existingProviderConfig = pickExistingProviderConfig(existingProviders, params.model.providerId)
  const existingModelConfig = Array.isArray(existingProviderConfig.models)
    ? existingProviderConfig.models.find((model) => isRecord(model) && model.id === params.model.modelId)
    : undefined
  const api = pickConfigString(existingProviderConfig, ['api'])
    || baseModel?.api
    || inferModelApi(params.model, params.baseUrl)
  const baseUrl = params.baseUrl || pickConfigString(existingProviderConfig, ['baseUrl', 'baseURL', 'base_url', 'url', 'endpoint'])
  const apiKey = params.apiKey || pickConfigString(existingProviderConfig, ['apiKey'])
  const compat = resolveProviderCompat({
    api,
    existingProviderConfig,
    model: params.model,
  })
  const modelConfig = buildOverlayModelDefinition({
    baseModel,
    existingModelConfig,
    model: params.model,
  })
  const providerConfig = {
    ...existingProviderConfig,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    api,
    ...(compat ? { compat } : {}),
    models: upsertOverlayModel(existingProviderConfig.models, modelConfig),
  }

  return {
    providers: {
      ...existingProviders,
      [params.model.providerId]: providerConfig,
    },
  }
}

const createOverlayModelRegistry = (params: {
  agentDir: string
  authStorage: AuthStorage
  baseRegistry: ModelRegistry
  model: PiResolvedModel
  apiKey?: string
  baseUrl?: string
}) => {
  const runtimeRoot = path.join(os.tmpdir(), `vibemux-pi-models-${randomUUID()}`)
  mkdirSync(runtimeRoot, { recursive: true })

  const overlay = mergeProviderConfig({
    agentDir: params.agentDir,
    baseRegistry: params.baseRegistry,
    model: params.model,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
  })
  const overlayPath = path.join(runtimeRoot, 'models.json')
  writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8')

  return {
    modelRegistry: ModelRegistry.create(params.authStorage, overlayPath),
    cleanup: () => {
      rmSync(runtimeRoot, { recursive: true, force: true })
    },
  }
}

const resolveSessionManager = async (params: {
  agentDir: string
  cwd: string
  executionModel?: string
  resumeSessionId?: string
}) => {
  const sessionDir = buildManagedSessionDir(params.cwd, params.agentDir, params.executionModel)
  mkdirSync(sessionDir, { recursive: true })

  const sessionId = params.resumeSessionId?.trim()
  if (!sessionId) {
    const sessionManager = SessionManager.continueRecent(params.cwd, sessionDir)
    recoverPiSessionManagerIfNeeded(sessionManager)
    return sessionManager
  }

  if (existsSync(sessionId)) {
    const sessionManager = SessionManager.open(sessionId, sessionDir, params.cwd)
    recoverPiSessionManagerIfNeeded(sessionManager)
    return sessionManager
  }

  const sessions = await SessionManager.list(params.cwd, sessionDir)
  const matched = sessions.find((item) => item.id === sessionId)
  const sessionManager = matched
    ? SessionManager.open(matched.path, sessionDir, params.cwd)
    : SessionManager.continueRecent(params.cwd, sessionDir)
  recoverPiSessionManagerIfNeeded(sessionManager)
  return sessionManager
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const hasTextContent = (content: unknown) => {
  if (typeof content === 'string') {
    return content.trim().length > 0
  }

  if (!Array.isArray(content)) {
    return false
  }

  return content.some((item) => {
    return isRecord(item) && item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0
  })
}

const hasInvalidToolCallContent = (content: unknown) => {
  if (!Array.isArray(content)) {
    return false
  }

  return content.some((item) => {
    return isRecord(item)
      && item.type === 'toolCall'
      && (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim())
  })
}

const hasPoisonedImageContent = (message: PiSessionEntry['message']) => {
  if ((message?.role !== 'user' && message?.role !== 'toolResult') || !Array.isArray(message.content)) {
    return false
  }

  return message.content.some((item) => {
    if (!isRecord(item)) {
      return false
    }

    if (item.type === 'input_image' || item.type === 'image_url') {
      return true
    }

    if (item.type !== 'image') {
      return false
    }

    return typeof item.data !== 'string'
      || !item.data.trim()
      || typeof item.mimeType !== 'string'
      || !item.mimeType.trim()
      || typeof item.url === 'string'
      || typeof item.image_url === 'string'
      || isRecord(item.source)
  })
}

const isInvalidToolResultMessage = (message: PiSessionEntry['message']) => {
  return message?.role === 'toolResult'
    && (typeof message.toolCallId !== 'string' || !message.toolCallId.trim() || typeof message.toolName !== 'string' || !message.toolName.trim())
}

const isPoisonedProviderError = (message: PiSessionEntry['message']) => {
  const errorMessage = message?.errorMessage?.trim().toLowerCase() || ''
  return message?.role === 'assistant'
    && message.stopReason === 'error'
    && (
      (errorMessage.includes('call_id') && errorMessage.includes('empty string'))
      || (errorMessage.includes('unknown parameter') && errorMessage.includes('content[') && errorMessage.includes('.url'))
    )
}

const isPiSessionPoisonEntry = (entry: PiSessionEntry) => {
  if (entry.type !== 'message') {
    return false
  }

  const message = entry.message
  return hasInvalidToolCallContent(message?.content)
    || hasPoisonedImageContent(message)
    || isInvalidToolResultMessage(message)
    || isPoisonedProviderError(message)
}

const isStableAssistantEntry = (entry: PiSessionEntry) => {
  const message = entry.message
  return entry.type === 'message'
    && Boolean(entry.id)
    && message?.role === 'assistant'
    && message.stopReason !== 'error'
    && hasTextContent(message.content)
}

export const findPiSessionRecoveryEntryId = (entries: PiSessionEntry[]) => {
  let latestStableAssistantEntryId = ''

  for (const entry of entries) {
    if (isPiSessionPoisonEntry(entry)) {
      return latestStableAssistantEntryId || null
    }

    if (isStableAssistantEntry(entry)) {
      latestStableAssistantEntryId = entry.id ?? ''
    }
  }

  return undefined
}

export const recoverPiSessionManagerIfNeeded = (sessionManager: SessionManager) => {
  const recoveryEntryId = findPiSessionRecoveryEntryId(sessionManager.getBranch() as PiSessionEntry[])
  if (recoveryEntryId === undefined) {
    return false
  }

  if (recoveryEntryId) {
    sessionManager.createBranchedSession(recoveryEntryId)
  } else {
    sessionManager.newSession()
  }

  return true
}

export const preparePiSessionConfig = async (params: {
  cwd: string
  executionModel?: string
  resumeSessionId?: string
  runtimeEnv?: Record<string, string>
  settings?: PiAgentSettings
}): Promise<PiSessionConfigResult> => {
  const agentDir = resolvePiAgentDir(params.settings, params.runtimeEnv)
  mkdirSync(agentDir, { recursive: true })

  const authStorage = AuthStorage.create(path.join(agentDir, 'auth.json'))
  const resolvedModel = parseExecutionModel(params.executionModel)
  const runtimeProviderConfig = resolvedModel
    ? resolveRuntimeProviderConfig(resolvedModel, params.runtimeEnv)
    : { apiKey: '', baseUrl: '' }

  if (resolvedModel && runtimeProviderConfig.apiKey) {
    authStorage.setRuntimeApiKey(resolvedModel.providerId, runtimeProviderConfig.apiKey)
  }

  const baseRegistry = ModelRegistry.create(authStorage, path.join(agentDir, 'models.json'))
  const overlay = resolvedModel && (runtimeProviderConfig.baseUrl || !baseRegistry.find(resolvedModel.providerId, resolvedModel.modelId))
    ? createOverlayModelRegistry({
        agentDir,
        authStorage,
        baseRegistry,
        model: resolvedModel,
        apiKey: runtimeProviderConfig.apiKey || undefined,
        baseUrl: runtimeProviderConfig.baseUrl || undefined,
      })
    : null
  const modelRegistry = overlay?.modelRegistry ?? baseRegistry
  const settingsManager = SettingsManager.create(params.cwd, agentDir)

  if (resolvedModel) {
    settingsManager.applyOverrides({
      defaultProvider: resolvedModel.providerId,
      defaultModel: resolvedModel.modelId,
    })
  }

  const selectedModel = resolvedModel
    ? modelRegistry.find(resolvedModel.providerId, resolvedModel.modelId)
    : undefined
  if (selectedModel && runtimeProviderConfig.apiKey) {
    authStorage.setRuntimeApiKey(selectedModel.provider, runtimeProviderConfig.apiKey)
  }

  return {
    agentDir,
    authStorage,
    modelRegistry,
    selectedModel,
    sessionManager: await resolveSessionManager({
      agentDir,
      cwd: params.cwd,
      executionModel: params.executionModel,
      resumeSessionId: params.resumeSessionId,
    }),
    settingsManager,
    cleanup: () => {
      overlay?.cleanup()
    },
  }
}
