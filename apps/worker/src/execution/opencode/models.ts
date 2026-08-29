// [INPUT]: OpenCode 模型输入
// [OUTPUT]: 模型映射
// [POS]: OpenCode 模型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { getWorkerEffectiveOpencodeConfigContent, loadWorkerConfig } from '../../core/config'
import { getRootOpencodeClient } from './client'
import { getErrorText, logWorkerOpencodeDebug } from './shared'
import type { ExecutionModelOption } from '@shared/types'

const buildExecutionModelOption = (
  providerId: string,
  modelId: string,
  defaultModel?: string,
): ExecutionModelOption => ({
  id: `${providerId}/${modelId}`,
  label: `${providerId}/${modelId}`,
  providerId,
  modelId,
  isDefault: defaultModel === `${providerId}/${modelId}`,
})

const getProviderModelIds = (models: unknown) => {
  if (Array.isArray(models)) {
    return models
      .map((model) => {
        if (!model || typeof model !== 'object') {
          return undefined
        }

        return 'id' in model && typeof model.id === 'string' ? model.id : undefined
      })
      .filter((modelId): modelId is string => Boolean(modelId))
  }

  if (!models || typeof models !== 'object') {
    return []
  }

  return Object.entries(models)
    .map(([modelId, model]) => {
      if (!model || typeof model !== 'object') {
        return modelId
      }

      return 'id' in model && typeof model.id === 'string' ? model.id : modelId
    })
    .filter((modelId): modelId is string => Boolean(modelId))
}

const normalizeModelResponse = (raw: unknown, defaultModel?: string): ExecutionModelOption[] => {
  if (!raw || typeof raw !== 'object') {
    return []
  }

  const data = raw as {
    providers?: Array<{ id?: string; name?: string; models?: unknown }> | Record<string, { id?: string; name?: string; models?: unknown }>
    provider?: Record<string, { id?: string; name?: string; models?: unknown }>
  }

  const excludedProviders = ['cloudflare', 'cf Workers', 'cf']
  const providers = Array.isArray(data.providers)
    ? data.providers
    : [
      ...Object.entries(data.providers ?? {}).map(([providerKey, provider]) => ({
        id: provider.id || provider.name || providerKey,
        models: provider.models,
      })),
      ...Object.entries(data.provider ?? {}).map(([providerKey, provider]) => ({
        id: provider.id || provider.name || providerKey,
        models: provider.models,
      })),
    ]

  return providers
    .filter((provider) => {
      const providerId = provider.id?.toLowerCase() ?? ''
      return !excludedProviders.some((excluded) => providerId.includes(excluded.toLowerCase()))
    })
    .flatMap((provider) => {
      const providerId = provider.id
      if (!providerId) {
        return []
      }

      return getProviderModelIds(provider.models)
        .map((modelId) => buildExecutionModelOption(providerId, modelId, defaultModel))
    })
    .sort((left, right) => {
      if (left.isDefault) return -1
      if (right.isDefault) return 1
      return left.label.localeCompare(right.label)
    })
}

export const listWorkerAvailableModels = async () => {
  const config = loadWorkerConfig()
  const normalizedConfig = getWorkerEffectiveOpencodeConfigContent(config).trim()
  const fallbackDefaultModel = config.defaultModel?.trim() || undefined

  if (!normalizedConfig) {
    return {
      models: [] as ExecutionModelOption[],
      defaultModel: fallbackDefaultModel,
      message: 'worker 未配置 OpenCode 提供商。',
    }
  }

  try {
    const client = await getRootOpencodeClient(normalizedConfig)
    const response = await client.config.providers()
    const raw = 'data' in response ? response.data : response
    const defaultEntry = Object.entries((raw as { default?: Record<string, string> } | undefined)?.default ?? {}).find(([, modelId]) => Boolean(modelId))
    const defaultModelId = defaultEntry ? `${defaultEntry[0]}/${defaultEntry[1]}` : fallbackDefaultModel
    return {
      models: normalizeModelResponse(raw, defaultModelId),
      defaultModel: defaultModelId,
      message: undefined,
    }
  } catch (error) {
    logWorkerOpencodeDebug('models:error', {
      error: getErrorText(error),
    })
    return {
      models: [] as ExecutionModelOption[],
      defaultModel: fallbackDefaultModel,
      message: getErrorText(error),
    }
  }
}
