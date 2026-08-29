// [INPUT]: Pi 运行时本地配置（agentDir / auth.json / settings.json / models.json）+ 控制面 Pi 默认模型
// [OUTPUT]: Pi 可用模型清单与默认模型（模型选择器 + config export 共用）
// [POS]: Pi 模型枚举
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import type { ExecutionModelOption, ModelProfileRuntimeSettings, ResolvedModelImportBinding, WorkerConfig } from '@shared/types'
import { loadWorkerConfig } from '../core/config'

const readPiJson = (filePath: string) => {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const resolveHomeRelativePath = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}

const resolvePiAgentDir = (config?: WorkerConfig) => {
  const configuredAgentDir = config?.agentSettings?.Pi?.agentDir?.trim() || config?.piAgentDir?.trim()
  if (configuredAgentDir) {
    return path.resolve(resolveHomeRelativePath(configuredAgentDir))
  }

  return path.join(os.homedir(), '.pi', 'agent')
}

const readLocalPiDefaultModel = (agentDir: string) => {
  const settings = readPiJson(path.join(agentDir, 'settings.json'))
  const provider = typeof settings?.defaultProvider === 'string' ? settings.defaultProvider.trim() : ''
  const model = typeof settings?.defaultModel === 'string' ? settings.defaultModel.trim() : ''
  return provider && model ? `${provider}/${model}` : ''
}

const resolvePiDefaultModel = (config: WorkerConfig) => {
  return config.agentSettings?.Pi?.defaultModel?.trim() || readLocalPiDefaultModel(resolvePiAgentDir(config))
}

const createPiModelRegistry = (agentDir: string) => {
  const authStorage = AuthStorage.create(path.join(agentDir, 'auth.json'))
  const registry = ModelRegistry.create(authStorage, path.join(agentDir, 'models.json'))
  return registry.getAvailable()
}

const parseCanonicalExecutionModel = (value: string) => {
  const slashIndex = value.indexOf('/')
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return null
  }

  return {
    providerId: value.slice(0, slashIndex),
    modelId: value.slice(slashIndex + 1),
  }
}

const buildPiExecutionModelOption = (
  providerId: string,
  modelId: string,
  defaultModel: string,
): ExecutionModelOption => {
  const id = `${providerId}/${modelId}`
  return {
    id,
    label: id,
    providerId,
    modelId,
    isDefault: Boolean(defaultModel) && id === defaultModel,
  }
}

export const listWorkerAvailablePiModels = (config = loadWorkerConfig()): {
  models: ExecutionModelOption[]
  defaultModel?: string
  message?: string
} => {
  const agentDir = resolvePiAgentDir(config)
  const defaultModel = resolvePiDefaultModel(config)
  const configuredDefault = config.agentSettings?.Pi?.defaultModel?.trim() || ''
  const models: ExecutionModelOption[] = []

  try {
    for (const model of createPiModelRegistry(agentDir)) {
      models.push(buildPiExecutionModelOption(model.provider, model.id, defaultModel))
    }
  } catch (error) {
    if (configuredDefault) {
      models.push(buildPiExecutionModelOption(
        parseCanonicalExecutionModel(configuredDefault)?.providerId || 'pi',
        parseCanonicalExecutionModel(configuredDefault)?.modelId || configuredDefault,
        defaultModel,
      ))
    }
    return {
      models,
      defaultModel,
      message: error instanceof Error ? error.message : 'Pi 模型列表读取失败。',
    }
  }

  if (
    configuredDefault
    && !models.some((model) => model.id === configuredDefault)
  ) {
    const parsed = parseCanonicalExecutionModel(configuredDefault)
    if (parsed) {
      models.push(buildPiExecutionModelOption(parsed.providerId, parsed.modelId, defaultModel))
    }
  }

  return {
    models,
    defaultModel,
    message: models.length > 0 ? undefined : 'Pi 运行时暂无可用的已认证模型（未登录或未配置 API Key）。',
  }
}

export const resolvePiModelBindings = (config = loadWorkerConfig()): ResolvedModelImportBinding[] => {
  const agentDir = resolvePiAgentDir(config)
  const defaultModel = resolvePiDefaultModel(config)
  const configuredDefault = config.agentSettings?.Pi?.defaultModel?.trim() || ''
  const bindings: ResolvedModelImportBinding[] = []

  try {
    for (const model of createPiModelRegistry(agentDir)) {
      bindings.push({
        providerId: model.provider,
        modelId: model.id,
        label: `Pi · ${model.provider}/${model.id}`,
        ...(model.baseUrl?.trim() ? { baseUrl: model.baseUrl.trim() } : {}),
      })
    }
  } catch {
    // 本地 Pi 配置不可读时，仍保留控制面配置的默认模型。
  }

  if (
    configuredDefault
    && !bindings.some((binding) => `${binding.providerId}/${binding.modelId}` === configuredDefault)
  ) {
    const parsed = parseCanonicalExecutionModel(configuredDefault)
    if (parsed) {
      bindings.push({
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        label: `Pi · ${configuredDefault}`,
      })
    }
  }

  return bindings.map((binding) => ({
    ...binding,
    runtimeSettings: {
      defaultModel,
    } satisfies ModelProfileRuntimeSettings,
  }))
}
