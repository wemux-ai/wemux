// [INPUT]: 云端 URL 输入
// [OUTPUT]: 解析
// [POS]: 运行时云端 URL
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkerConfig } from '@shared/types'
import { loadWorkerConfig } from './config'
import { getWorkerRuntimeState } from './runtime-state'

const normalizeLabel = (value: string) => value.trim().toLowerCase()

export const getWorkerEffectiveCloudUrl = (config?: Pick<WorkerConfig, 'cloudUrl'>) => {
  const runtimeCloudUrl = getWorkerRuntimeState().effectiveCloudUrl?.trim()
  if (runtimeCloudUrl) {
    return runtimeCloudUrl
  }

  if (config?.cloudUrl?.trim()) {
    return config.cloudUrl.trim()
  }

  return loadWorkerConfig().cloudUrl
}

export const withWorkerEffectiveCloudUrl = <T extends WorkerConfig>(config: T): T => {
  const cloudUrl = getWorkerEffectiveCloudUrl(config)
  if (!cloudUrl || cloudUrl === config.cloudUrl) {
    return config
  }

  return {
    ...config,
    cloudUrl,
  }
}

export const loadWorkerRuntimeConfig = () => {
  return withWorkerEffectiveCloudUrl(loadWorkerConfig())
}

export const mergeWorkerRoutingLabels = (params: {
  labels: string[]
  assignedLabels: string[]
  managedRoutingLabels: string[]
}) => {
  const managedLabels = new Set(params.managedRoutingLabels.map((label) => normalizeLabel(label)))
  const merged = [
    ...params.labels.filter((label) => !managedLabels.has(normalizeLabel(label))),
    ...params.assignedLabels,
  ]

  return Array.from(new Set(merged.map((label) => label.trim()).filter(Boolean)))
}
