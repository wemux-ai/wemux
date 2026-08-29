// [INPUT]: 执行配置输入
// [OUTPUT]: 执行配置契约
// [POS]: OpenCode 执行配置
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { OpenCodeExecutionConfig } from './types'
import type { McpServerPolicy } from './mcp'

type OpenCodeExecutionConfigCarrier = {
  executionModel?: string
  opencodeConfig?: OpenCodeExecutionConfigInput
}

type OpenCodeExecutionConfigInput = Omit<OpenCodeExecutionConfig, 'provider'> & {
  provider?: OpenCodeExecutionConfig['provider'] | Record<string, unknown>
}

const normalizeText = (value?: string | null) => {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

const normalizeEnv = (env?: Record<string, string>) => {
  if (!env) {
    return undefined
  }

  const nextEntries = Object.entries(env)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key, value]) => key.length > 0 && typeof value === 'string')
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value.length > 0)

  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const normalizeProviderModels = (models?: unknown) => {
  if (Array.isArray(models)) {
    const normalizedEntries = models
      .map((model) => {
        if (!isRecord(model)) {
          return null
        }

        const id = typeof model.id === 'string' ? model.id.trim() : ''
        if (!id) {
          return null
        }

        const rest = { ...model }
        delete rest.id
        return [id, Object.keys(rest).length > 0 ? rest : { name: id }] as const
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry))

    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined
  }

  if (!isRecord(models)) {
    return undefined
  }

  const normalizedEntries = Object.entries(models)
    .map(([modelId, model]) => {
      const normalizedModelId = modelId.trim()
      if (!normalizedModelId) {
        return null
      }

      return [normalizedModelId, isRecord(model) ? model : { name: normalizedModelId }] as const
    })
    .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry))

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined
}

const normalizeProviderOptions = (options?: unknown) => {
  if (!isRecord(options)) {
    return undefined
  }

  const normalizedEntries = Object.entries(options)
    .map(([key, value]) => {
      const normalizedKey = key.trim()
      if (!normalizedKey) {
        return null
      }

      if (typeof value === 'string') {
        const normalizedValue = value.trim()
        return normalizedValue ? [normalizedKey, normalizedValue] as const : null
      }

      return [normalizedKey, value] as const
    })
    .filter((entry): entry is readonly [string, unknown] => Boolean(entry))

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined
}

const normalizeProviderConfig = (provider?: OpenCodeExecutionConfigInput['provider']) => {
  if (!provider || typeof provider !== 'object') {
    return undefined
  }

  const normalizedEntries = Object.entries(provider)
    .map(([providerId, config]) => {
      const normalizedProviderId = providerId.trim()
      if (!normalizedProviderId || !isRecord(config)) {
        return null
      }

      const normalizedModels = normalizeProviderModels(config.models)
      const options = normalizeProviderOptions(config.options)
      const rest = { ...config }
      delete rest.models
      delete rest.options

      const normalizedProviderConfig = {
        ...rest,
        ...(normalizedModels ? { models: normalizedModels } : {}),
        ...(options ? { options } : {}),
      }

      if (Object.keys(normalizedProviderConfig).length === 0) {
        return null
      }

      return [normalizedProviderId, normalizedProviderConfig] as const
    })
    .filter((entry): entry is readonly [string, NonNullable<OpenCodeExecutionConfig['provider']>[string]] => Boolean(entry))

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined
}

const normalizeMcpServers = (servers?: McpServerPolicy[]) => {
  if (!Array.isArray(servers)) {
    return undefined
  }

  const next = servers
    .filter((server): server is McpServerPolicy => Boolean(server?.name?.trim()) && Boolean(server?.target?.trim()))
    .map((server) => ({
      ...server,
      id: server.id?.trim() || `${server.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'mcp'}-${server.transport}`,
      name: server.name.trim(),
      target: server.target.trim(),
    }))

  return next.length > 0 ? next : undefined
}

export const normalizeOpenCodeExecutionConfig = (
  config?: OpenCodeExecutionConfigInput | null,
  legacyExecutionModel?: string,
): OpenCodeExecutionConfig | undefined => {
  const model = normalizeText(config?.model) ?? normalizeText(legacyExecutionModel)
  const agent = normalizeText(config?.agent)
  const variant = normalizeText(config?.variant)
  const permissionPolicy = normalizeText(config?.permissionPolicy)
  const env = normalizeEnv(config?.env)
  const provider = normalizeProviderConfig(config?.provider)
  const mcpServers = normalizeMcpServers(config?.mcpServers)

  if (!model && !agent && !variant && !permissionPolicy && !env && !provider && !mcpServers) {
    return undefined
  }

  return {
    ...(model ? { model } : {}),
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
    ...(permissionPolicy ? { permissionPolicy } : {}),
    ...(env ? { env } : {}),
    ...(provider ? { provider } : {}),
    ...(mcpServers ? { mcpServers } : {}),
  }
}

export const mergeOpenCodeExecutionConfig = (
  baseConfig?: OpenCodeExecutionConfigInput | null,
  overrideConfig?: OpenCodeExecutionConfigInput | null,
  legacyExecutionModel?: string,
): OpenCodeExecutionConfig | undefined => {
  const normalizedBase = normalizeOpenCodeExecutionConfig(baseConfig)
  const normalizedOverride = normalizeOpenCodeExecutionConfig(overrideConfig)

  const env = normalizedBase?.env || normalizedOverride?.env
    ? {
        ...(normalizedBase?.env ?? {}),
        ...(normalizedOverride?.env ?? {}),
      }
    : undefined
  const provider = normalizedBase?.provider || normalizedOverride?.provider
    ? {
        ...(normalizedBase?.provider ?? {}),
        ...(normalizedOverride?.provider ?? {}),
      }
    : undefined
  const mcpServers = normalizedBase?.mcpServers || normalizedOverride?.mcpServers
    ? [...(normalizedBase?.mcpServers ?? []), ...(normalizedOverride?.mcpServers ?? [])]
    : undefined

  return normalizeOpenCodeExecutionConfig(
    {
      ...normalizedBase,
      ...normalizedOverride,
      ...(env ? { env } : {}),
      ...(provider ? { provider } : {}),
      ...(mcpServers ? { mcpServers } : {}),
    },
    legacyExecutionModel,
  )
}

export const resolveOpenCodeExecutionConfig = (carrier: OpenCodeExecutionConfigCarrier) => {
  return normalizeOpenCodeExecutionConfig(carrier.opencodeConfig, carrier.executionModel)
}

export const resolveOpenCodeExecutionModel = (carrier: OpenCodeExecutionConfigCarrier) => {
  return resolveOpenCodeExecutionConfig(carrier)?.model
}

export const withOpenCodeExecutionModel = (
  config?: OpenCodeExecutionConfigInput | null,
  executionModel?: string,
) => {
  const normalizedModel = normalizeText(executionModel)
  return normalizeOpenCodeExecutionConfig(
    {
      ...(config ?? {}),
      ...(normalizedModel ? { model: normalizedModel } : { model: undefined }),
    },
  )
}
