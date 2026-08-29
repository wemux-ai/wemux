// [INPUT]: server 侧 Agent 编排输入
// [OUTPUT]: Agent 编排输出
// [POS]: server Agent 编排
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import {
  AGENT_TYPES,
  coerceAgentType,
  DEFAULT_AGENT_TYPE,
  getRuntimeDescriptor,
  isAgentType,
  resolveAgentTypeForRuntimeId,
} from '@shared/agent-type'
import {
  getRuntimeFallbackSettings,
  getAgentSettings,
  listBundledAgentModels,
  mergeAgentRuntimeSettings,
} from '@shared/agent-config'
import { parseExecutionModelId } from '@shared/model-profile'
import type {
  AgentConfig,
  AgentRuntimeSettings,
  ExecutionModelOption,
  RuntimeId,
  Task,
} from '@shared/types'

export const SERVER_AGENT_TYPES = AGENT_TYPES

export type ServerAgentType = (typeof SERVER_AGENT_TYPES)[number]

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const isServerAgentType = (value: string | undefined | null): value is ServerAgentType => {
  return isAgentType(value)
}

export const coerceServerAgentType = (value: string | undefined | null): Task['agentType'] => {
  return coerceAgentType(value) as Task['agentType']
}

export const resolveServerAgentTypeForRuntimeId = (runtimeId: RuntimeId): ServerAgentType | null => {
  return resolveAgentTypeForRuntimeId(runtimeId)
}

export const getServerAgentLabel = (agentType: ServerAgentType) => {
  return getRuntimeDescriptor(agentType).label
}

export const getServerAgentSettings = (
  config: Pick<AgentConfig, 'agentSettings' | 'defaultModel'>,
  agentType: ServerAgentType,
): AgentRuntimeSettings => {
  if (agentType === 'Pi') {
    const piSettings = isRecord(config.agentSettings)
      ? (config.agentSettings as Record<string, unknown>).Pi
      : undefined
    return mergeAgentRuntimeSettings('Pi', getRuntimeFallbackSettings('Pi'), piSettings)
  }

  return getAgentSettings(config, agentType)
}

export const getServerAgentDefaultModel = (
  config: Pick<AgentConfig, 'agentSettings' | 'defaultModel'>,
  agentType: ServerAgentType,
) => {
  return getServerAgentSettings(config, agentType).defaultModel.trim()
}

export const listServerBundledAgentModels = (
  agentType: ServerAgentType,
  preferredDefaultModel?: string,
): ExecutionModelOption[] => {
  if (agentType === 'OpenCode') {
    return []
  }

  if (agentType !== 'Pi') {
    return listBundledAgentModels(agentType, preferredDefaultModel)
  }

  const normalizedDefaultModel = preferredDefaultModel?.trim() || ''
  if (!normalizedDefaultModel) {
    return []
  }

  const parsed = parseExecutionModelId(normalizedDefaultModel)
  return [{
    id: normalizedDefaultModel,
    label: normalizedDefaultModel,
    providerId: parsed?.providerId || 'pi',
    modelId: parsed?.modelId || normalizedDefaultModel,
    isDefault: true,
  }]
}
