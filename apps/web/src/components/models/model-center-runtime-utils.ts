// [INPUT]: 模型中心执行选项的排序、展示标签与搜索关键词构建能力。
// [OUTPUT]: 默认配置面板的模型选项格式化（排序/标签/描述/关键词）。
// [POS]: 模型中心运行时模型选项的展示适配层。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildExecutionModelId, normalizeModelProviderBaseUrl } from '@shared/model-profile'
import type { ExecutionModelOption } from '@shared/types'

const formatModelOptionSource = (source?: ExecutionModelOption['source']) => {
  if (source === 'catalog') {
    return 'Model Center'
  }
  if (source === 'runtime') {
    return 'Worker runtime'
  }
  if (source === 'bundled') {
    return 'Bundled'
  }
  return ''
}

const toModelOptionHostname = (baseUrl?: string) => {
  const normalizedBaseUrl = normalizeModelProviderBaseUrl(baseUrl)
  if (!normalizedBaseUrl) {
    return ''
  }

  try {
    const parsed = new URL(normalizedBaseUrl)
    const pathSuffix = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''
    return `${parsed.hostname}${pathSuffix}`
  } catch {
    return normalizedBaseUrl
  }
}

export const prependCurrentModelOption = (options: ExecutionModelOption[], currentModel: string): ExecutionModelOption[] => {
  const normalizedModel = currentModel.trim()
  if (!normalizedModel || options.some((option) => option.id === normalizedModel)) {
    return options
  }

  const [providerId, ...rest] = normalizedModel.split('/')
  const modelId = rest.length > 0 ? rest.join('/') : normalizedModel

  return [{
    id: normalizedModel,
    label: normalizedModel,
    providerId: rest.length > 0 ? providerId : 'custom',
    modelId,
  }, ...options]
}

export const sortExecutionModelOptions = (options: ExecutionModelOption[]) => {
  return [...options].sort((left, right) => {
    const providerCompare = left.providerId.localeCompare(right.providerId)
    if (providerCompare !== 0) {
      return providerCompare
    }

    const baseUrlCompare = normalizeModelProviderBaseUrl(left.baseUrl).localeCompare(normalizeModelProviderBaseUrl(right.baseUrl))
    if (baseUrlCompare !== 0) {
      return baseUrlCompare
    }

    return left.modelId.localeCompare(right.modelId)
  })
}

export const buildModelOptionSelectLabel = (model: Pick<ExecutionModelOption, 'providerId' | 'modelId'>) => {
  return buildExecutionModelId(model.providerId, model.modelId) || model.modelId || model.providerId
}

export const buildModelOptionSelectDescription = (model: Pick<ExecutionModelOption, 'baseUrl' | 'profileName' | 'source'>) => {
  const profileName = model.profileName?.trim() || ''
  const hostname = toModelOptionHostname(model.baseUrl)
  const sourceLabel = formatModelOptionSource(model.source)
  const parts = [profileName]

  if (hostname && !profileName.toLowerCase().includes(hostname.toLowerCase())) {
    parts.push(hostname)
  }

  if (sourceLabel) {
    parts.push(sourceLabel)
  }

  return parts.join(' · ')
}

export const buildModelOptionKeywords = (model: Pick<ExecutionModelOption, 'id' | 'providerId' | 'modelId' | 'baseUrl' | 'profileName'>) => {
  return [
    model.id,
    model.providerId,
    model.modelId,
    model.profileName,
    model.baseUrl,
    toModelOptionHostname(model.baseUrl),
  ]
}
