import { normalizeModelProviderBaseUrl } from '@shared/model-profile'
import type { ExecutorRecord, ModelProfile } from '@shared/types'

export type GroupedBinding = {
  providerId: string
  baseUrl?: string
  modelIds: string[]
  hasApiToken: boolean
}

export type ModelProfileSourceExecutor = Pick<ExecutorRecord, 'executorId' | 'name' | 'machineName'>

export const resolveModelProfileSourceWorkerName = (
  profile: Pick<ModelProfile, 'source' | 'sourceExecutorId'>,
  executors: ModelProfileSourceExecutor[],
) => {
  if (profile.source !== 'worker-import') {
    return ''
  }

  const sourceExecutorId = profile.sourceExecutorId?.trim()
  if (!sourceExecutorId) {
    return ''
  }

  const executor = executors.find((item) => item.executorId === sourceExecutorId)
  return executor?.name?.trim() || executor?.machineName?.trim() || sourceExecutorId
}

export const groupProfileBindings = (profile: ModelProfile): GroupedBinding[] => {
  const grouped = new Map<string, GroupedBinding>()

  for (const binding of profile.bindings) {
    const normalizedBaseUrl = normalizeModelProviderBaseUrl(binding.baseUrl)
    const key = `${binding.providerId.trim()}::${normalizedBaseUrl}`
    const current = grouped.get(key) ?? {
      providerId: binding.providerId,
      baseUrl: normalizedBaseUrl || undefined,
      modelIds: [],
      hasApiToken: Boolean(binding.hasApiToken),
    }

    if (!current.modelIds.includes(binding.modelId)) {
      current.modelIds.push(binding.modelId)
      current.modelIds.sort((left, right) => left.localeCompare(right))
    }
    current.hasApiToken = current.hasApiToken || Boolean(binding.hasApiToken)
    grouped.set(key, current)
  }

  return Array.from(grouped.values()).sort((left, right) => {
    const providerCompare = left.providerId.localeCompare(right.providerId)
    if (providerCompare !== 0) {
      return providerCompare
    }
    return (left.baseUrl || '').localeCompare(right.baseUrl || '')
  })
}

export const formatBindingsSummary = (profile: ModelProfile): string => {
  return groupProfileBindings(profile)
    .map((binding) => `${binding.providerId}: ${binding.modelIds.join(', ')}`)
    .join(' · ')
}

export const formatBaseUrlSummary = (profile: ModelProfile): string => {
  return groupProfileBindings(profile)
    .map((binding) => binding.baseUrl?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' · ')
}
