// [INPUT]: 模型画像输入
// [OUTPUT]: 画像契约
// [POS]: 模型画像类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getRuntimeDescriptor, resolveRuntimeIdForAgentType, type RuntimeId } from './agent-type'
import type {
  AgentType,
  ClaudeCodeAgentSettings,
  CodexAgentSettings,
  ExecutionModelOption,
  ModelProfile,
  ModelProfileBinding,
  ModelProfileRuntimeSettings,
  OpenCodeAgentSettings,
  PiAgentSettings,
} from './types'

/**
 * 模型 provider 对应的运行时 env 前缀（server 注入 runtimeEnv 与 worker 消费侧共用）。
 * Codex/ClaudeCode 固定映射到其原生前缀，其余按 providerId 归一化。
 */
export const resolveModelEnvPrefix = (agentType: AgentType, providerId: string) => {
  if (agentType === 'Codex') {
    return 'OPENAI'
  }

  if (agentType === 'ClaudeCode') {
    return 'ANTHROPIC'
  }

  const normalizedProvider = providerId.trim().toLowerCase()
  if (normalizedProvider === 'openai') {
    return 'OPENAI'
  }
  if (normalizedProvider === 'anthropic' || normalizedProvider === 'claude') {
    return 'ANTHROPIC'
  }
  if (normalizedProvider === 'google' || normalizedProvider === 'gemini') {
    return 'GOOGLE'
  }
  if (normalizedProvider === 'grok' || normalizedProvider === 'xai') {
    return 'XAI'
  }
  if (normalizedProvider === 'kimi' || normalizedProvider === 'moonshot') {
    return 'MOONSHOT'
  }
  if (normalizedProvider === 'dashscope' || normalizedProvider === 'qwen') {
    return 'QWEN'
  }
  if (normalizedProvider === 'glm' || normalizedProvider === 'zhipu') {
    return 'ZHIPU'
  }
  if (normalizedProvider === 'volcengine' || normalizedProvider === 'doubao') {
    return 'DOUBAO'
  }
  if (normalizedProvider === 'minimax') {
    return 'MINIMAX'
  }
  if (normalizedProvider === 'minimax-cn') {
    return 'MINIMAX_CN'
  }

  const normalized = providerId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'MODEL'
}

export const buildExecutionModelId = (providerId: string, modelId: string) => {
  const normalizedProviderId = providerId.trim()
  const normalizedModelId = modelId.trim()
  return normalizedProviderId && normalizedModelId ? `${normalizedProviderId}/${normalizedModelId}` : ''
}

// Present only when a control-plane model binding owns the runtime credentials.
export const MANAGED_MODEL_RUNTIME_ENV = {
  enabled: 'WEMUX_MANAGED_MODEL_ENABLED',
  bindingId: 'WEMUX_MANAGED_MODEL_BINDING_ID',
  providerId: 'WEMUX_MANAGED_MODEL_PROVIDER_ID',
  modelId: 'WEMUX_MANAGED_MODEL_ID',
  baseUrl: 'WEMUX_MANAGED_MODEL_BASE_URL',
  apiKey: 'WEMUX_MANAGED_MODEL_API_KEY',
} as const

export const normalizeModelProviderBaseUrl = (value?: string | null) => {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return ''
  }

  try {
    const parsed = new URL(normalized)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}`
  } catch {
    return normalized.replace(/\/+$/, '')
  }
}

export const toNativeRuntimeModelId = (
  runtimeId: RuntimeId,
  providerId: string,
  executionModel?: string | null,
) => {
  return getRuntimeDescriptor(runtimeId).modelIdStrategy === 'canonical'
    ? executionModel?.trim() || ''
    : normalizeNativeRuntimeExecutionModelId(providerId, executionModel)
}

export const parseExecutionModelId = (value?: string | null) => {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return null
  }

  const [providerId, ...rest] = normalized.split('/')
  const modelId = rest.join('/')
  if (!providerId || !modelId) {
    return null
  }

  return {
    providerId,
    modelId,
  }
}

const normalizeProviderIdForMatch = (value?: string | null) => {
  return value?.trim().toLowerCase() || ''
}

const normalizeNativeRuntimeExecutionModelId = (
  providerId: string,
  executionModel?: string | null,
) => {
  const normalizedExecutionModel = executionModel?.trim() || ''
  if (!normalizedExecutionModel) {
    return ''
  }

  const parsed = parseExecutionModelId(normalizedExecutionModel)
  if (!parsed) {
    return normalizedExecutionModel
  }

  return normalizeProviderIdForMatch(parsed.providerId) === normalizeProviderIdForMatch(providerId)
    ? parsed.modelId
    : normalizedExecutionModel
}

const normalizeExecutionModelForOption = (
  runtimeId: RuntimeId,
  option: Pick<ExecutionModelOption, 'id' | 'providerId'>,
  executionModel?: string | null,
) => {
  const normalizedExecutionModel = executionModel?.trim() || ''
  if (!normalizedExecutionModel) {
    return ''
  }

  if (getRuntimeDescriptor(runtimeId).modelIdStrategy === 'canonical') {
    return normalizedExecutionModel
  }

  return normalizeNativeRuntimeExecutionModelId(option.providerId, normalizedExecutionModel)
}

export const buildRuntimeExecutionModelId = (
  runtimeId: RuntimeId,
  binding: Pick<ModelProfileBinding, 'providerId' | 'modelId'>,
) => {
  if (getRuntimeDescriptor(runtimeId).modelIdStrategy === 'canonical') {
    return buildExecutionModelId(binding.providerId, binding.modelId)
  }

  const nativeModelId = normalizeNativeRuntimeExecutionModelId(binding.providerId, binding.modelId)
  return buildExecutionModelId(binding.providerId, nativeModelId)
}

export const buildAgentExecutionModelId = (
  agentType: AgentType,
  binding: Pick<ModelProfileBinding, 'providerId' | 'modelId'>,
) => {
  return buildRuntimeExecutionModelId(resolveRuntimeIdForAgentType(agentType), binding)
}

export const matchesRuntimeExecutionModelOption = (
  runtimeId: RuntimeId,
  executionModel: string | undefined,
  option: Pick<ExecutionModelOption, 'id' | 'providerId'>,
) => {
  const normalizedExecutionModel = executionModel?.trim() || ''
  if (!normalizedExecutionModel) {
    return false
  }

  return normalizeExecutionModelForOption(runtimeId, option, normalizedExecutionModel)
    === normalizeExecutionModelForOption(runtimeId, option, option.id)
}

export const matchesAgentExecutionModelOption = (
  agentType: AgentType,
  executionModel: string | undefined,
  option: Pick<ExecutionModelOption, 'id' | 'providerId'>,
) => {
  return matchesRuntimeExecutionModelOption(resolveRuntimeIdForAgentType(agentType), executionModel, option)
}

export const findMatchingRuntimeExecutionModelOption = <T extends Pick<ExecutionModelOption, 'id' | 'providerId'>>(
  runtimeId: RuntimeId,
  options: T[],
  executionModel?: string,
) => {
  return options.find((option) => matchesRuntimeExecutionModelOption(runtimeId, executionModel, option))
}

export const findMatchingAgentExecutionModelOption = <T extends Pick<ExecutionModelOption, 'id' | 'providerId'>>(
  agentType: AgentType,
  options: T[],
  executionModel?: string,
) => {
  return findMatchingRuntimeExecutionModelOption(resolveRuntimeIdForAgentType(agentType), options, executionModel)
}

export const resolveMatchingAgentExecutionModelOptionId = (
  agentType: AgentType,
  options: Array<Pick<ExecutionModelOption, 'id' | 'providerId'>>,
  executionModel?: string,
) => {
  return findMatchingAgentExecutionModelOption(agentType, options, executionModel)?.id.trim() || ''
}

export const parseCodexConfigModel = (content?: string | null) => {
  const normalized = content?.trim() || ''
  if (!normalized) {
    return ''
  }

  const match = normalized.match(/^\s*model\s*=\s*["']([^"']+)["']/m)
  return match?.[1]?.trim() || ''
}

export const parseClaudeCodeConfigModel = (content?: string | null) => {
  const normalized = content?.trim() || ''
  if (!normalized) {
    return ''
  }

  try {
    const parsed = JSON.parse(normalized) as {
      model?: unknown
      env?: Record<string, unknown>
    }
    if (typeof parsed.model === 'string' && parsed.model.trim()) {
      return parsed.model.trim()
    }

    const env = parsed.env && typeof parsed.env === 'object' ? parsed.env : {}
    const envModelKeys = [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    ]

    for (const key of envModelKeys) {
      const value = env[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return ''
  } catch {
    return ''
  }
}

const buildBindingTitle = (profile: Pick<ModelProfile, 'name'>, binding: Pick<ModelProfileBinding, 'agentType' | 'label'>) => {
  const normalizedLabel = binding.label.trim()
  const normalizedName = profile.name.trim()
  if (!normalizedName) {
    return normalizedLabel
  }

  return normalizedLabel === normalizedName ? normalizedLabel : `${normalizedName} · ${binding.agentType}`
}

export const toExecutionModelOption = (
  profile: Pick<ModelProfile, 'id' | 'name'>,
  binding: ModelProfileBinding,
): ExecutionModelOption => ({
  id: buildAgentExecutionModelId(binding.agentType, binding),
  label: buildBindingTitle(profile, binding),
  providerId: binding.providerId,
  modelId: binding.modelId,
  baseUrl: normalizeModelProviderBaseUrl(binding.baseUrl) || undefined,
  isDefault: binding.isDefault,
  source: 'catalog',
  profileId: profile.id,
  profileName: profile.name,
})

export const findModelProfileBinding = (
  profiles: ModelProfile[],
  agentType: AgentType,
  executionModel?: string,
) => {
  const normalizedExecutionModel = executionModel?.trim()
  if (!normalizedExecutionModel) {
    return null
  }

  const parsedExecutionModel = parseExecutionModelId(normalizedExecutionModel)
  if (parsedExecutionModel) {
    for (const profile of profiles) {
      const binding = profile.bindings.find((item) => (
        item.agentType === agentType
        && item.providerId.trim() === parsedExecutionModel.providerId
        && matchesAgentExecutionModelOption(agentType, normalizedExecutionModel, {
          id: buildAgentExecutionModelId(agentType, item),
          providerId: item.providerId,
        })
      ))

      if (binding) {
        return { profile, binding }
      }
    }
  }

  for (const profile of profiles) {
    const binding = profile.bindings.find((item) => (
      item.agentType === agentType
      && matchesAgentExecutionModelOption(agentType, normalizedExecutionModel, {
        id: buildAgentExecutionModelId(agentType, item),
        providerId: item.providerId,
      })
    ))

    if (binding) {
      return { profile, binding }
    }
  }

  return null
}

export const findPreferredModelProfileBinding = (
  profiles: ModelProfile[],
  agentType: AgentType,
  executionModel?: string,
  fallbackExecutionModel?: string,
) => {
  const matched = findModelProfileBinding(profiles, agentType, executionModel)
  if (matched || executionModel?.trim()) {
    return matched
  }

  return findModelProfileBinding(profiles, agentType, fallbackExecutionModel)
}

const isOpenCodeRuntimeSettingsPartial = (value: ModelProfileRuntimeSettings): value is Partial<OpenCodeAgentSettings> => {
  return !('_runtime' in value) || (value as { _runtime?: string })._runtime === 'OpenCode'
}

const isCodexRuntimeSettingsPartial = (value: ModelProfileRuntimeSettings): value is Partial<CodexAgentSettings> => {
  return !('_runtime' in value) || (value as { _runtime?: string })._runtime === 'Codex'
}

const isClaudeCodeRuntimeSettingsPartial = (value: ModelProfileRuntimeSettings): value is Partial<ClaudeCodeAgentSettings> => {
  return !('_runtime' in value) || (value as { _runtime?: string })._runtime === 'ClaudeCode'
}

export const normalizeModelProfileRuntimeSettings = (
  runtimeId: RuntimeId,
  runtimeSettings?: ModelProfileRuntimeSettings,
) => {
  if (!runtimeSettings) {
    return undefined
  }

  if (runtimeId === 'OpenCode' && isOpenCodeRuntimeSettingsPartial(runtimeSettings)) {
    return {
      ...(runtimeSettings.defaultModel?.trim() ? { defaultModel: runtimeSettings.defaultModel.trim() } : {}),
      ...(runtimeSettings.agent?.trim() ? { agent: runtimeSettings.agent.trim() } : {}),
      ...(runtimeSettings.permissionPolicy?.trim() ? { permissionPolicy: runtimeSettings.permissionPolicy.trim() } : {}),
    }
  }

  if (runtimeId === 'Codex' && isCodexRuntimeSettingsPartial(runtimeSettings)) {
    return {
      ...(runtimeSettings.defaultModel?.trim() ? { defaultModel: runtimeSettings.defaultModel.trim() } : {}),
      ...(runtimeSettings.sandbox ? { sandbox: runtimeSettings.sandbox } : {}),
      ...(runtimeSettings.approval ? { approval: runtimeSettings.approval } : {}),
      ...(runtimeSettings.reasoningEffort ? { reasoningEffort: runtimeSettings.reasoningEffort } : {}),
      ...(runtimeSettings.reasoningSummary ? { reasoningSummary: runtimeSettings.reasoningSummary } : {}),
    }
  }

  if (runtimeId === 'ClaudeCode' && isClaudeCodeRuntimeSettingsPartial(runtimeSettings)) {
    return {
      ...(runtimeSettings.defaultModel?.trim() ? { defaultModel: runtimeSettings.defaultModel.trim() } : {}),
      ...(runtimeSettings.permissionMode ? { permissionMode: runtimeSettings.permissionMode } : {}),
      ...(typeof runtimeSettings.planMode === 'boolean' ? { planMode: runtimeSettings.planMode } : {}),
    }
  }

  if (runtimeId === 'Pi') {
    const settings = runtimeSettings as Partial<PiAgentSettings>
    return {
      ...(settings.defaultModel?.trim() ? { defaultModel: settings.defaultModel.trim() } : {}),
      ...(settings.agentDir?.trim() ? { agentDir: settings.agentDir.trim() } : {}),
    }
  }

  return undefined
}
