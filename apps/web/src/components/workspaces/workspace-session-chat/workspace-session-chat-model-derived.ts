import { useMemo } from 'react'
import { parseExecutionModelId, resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import type { ExecutionModelOption, ExecutorRecord, Task } from '@shared/types'
import { isNodeVersionOutdated } from '../../../lib/node-version'
import type { WorkspaceSessionModelMenuPreferences } from '../../../lib/workspace-session-model-menu-preferences'
import { formatExecutionModelLabel, formatExecutionModelProviderLabel } from '../../../lib/utils'
import type { ExecutorCardItem, GroupedModelOptionGroup } from './workspace-session-chat-selectors'

const STATIC_PROVIDER_PRIORITY = [
  'codexzh',
  'ccodezh',
  'minimax-cn-coding-plan',
  'google',
  'opencode',
]

const FEATURED_MODEL_KEYWORDS = [
  'gpt-5',
  'claude-sonnet',
  'claude-opus',
  'minimax-m2.7',
  'gemini-3',
  'gemini-2.5',
]

const findModelOptionById = (
  modelOptions: ExecutionModelOption[],
  modelId: string,
) => {
  return modelOptions.find((model) => model.id === modelId)
}

const findRecentRank = (recentValues: string[], value: string) => {
  const index = recentValues.indexOf(value)
  return index === -1 ? null : index
}

export const resolveTaskChatEffectiveModel = (
  visibleSelectedModel: string,
  visibleDefaultModel: string,
) => visibleSelectedModel.trim() || visibleDefaultModel.trim()

type BuildWorkspaceSessionGroupedModelOptionsParams = {
  modelMenuPreferences: WorkspaceSessionModelMenuPreferences
  modelOptions: ExecutionModelOption[]
  visibleDefaultModel: string
  visibleSelectedModel: string
}

export const buildWorkspaceSessionGroupedModelOptions = ({
  modelMenuPreferences,
  modelOptions,
  visibleDefaultModel,
  visibleSelectedModel,
}: BuildWorkspaceSessionGroupedModelOptionsParams): GroupedModelOptionGroup[] => {
  const selectedModelOption = visibleSelectedModel
    ? findModelOptionById(modelOptions, visibleSelectedModel)
    : undefined
  const defaultModelOption = visibleDefaultModel
    ? findModelOptionById(modelOptions, visibleDefaultModel)
    : undefined
  const selectedProviderLabel = selectedModelOption
    ? formatExecutionModelProviderLabel(selectedModelOption)
    : ''
  const defaultProviderLabel = defaultModelOption
    ? formatExecutionModelProviderLabel(defaultModelOption)
    : ''

  const modelRank = (model: ExecutionModelOption) => {
    if (model.id === visibleSelectedModel) {
      return -4
    }

    const recentModelRank = findRecentRank(modelMenuPreferences.recentModelIds, model.id)
    if (recentModelRank !== null) {
      return recentModelRank - 3
    }

    if (model.id === visibleDefaultModel) {
      return 46
    }

    if (model.isDefault) {
      return 47
    }

    const label = `${model.providerId}/${model.modelId}`.toLowerCase()
    if (FEATURED_MODEL_KEYWORDS.some((keyword) => label.includes(keyword))) {
      return 48
    }

    return 49
  }

  const groups = modelOptions.reduce<GroupedModelOptionGroup[]>((items, model) => {
    const providerLabel = formatExecutionModelProviderLabel(model)
    const current = items.find((group) => group.providerLabel === providerLabel)
    if (current) {
      current.models.push(model)
      return items
    }

    items.push({
      providerId: model.providerId,
      providerLabel,
      models: [model],
    })
    return items
  }, [])

  const providerRank = (group: GroupedModelOptionGroup) => {
    if (group.providerLabel === selectedProviderLabel) {
      return -3
    }

    const recentProviderRank = findRecentRank(modelMenuPreferences.recentProviderLabels, group.providerLabel)
    if (recentProviderRank !== null) {
      return recentProviderRank - 2
    }

    if (group.providerLabel === defaultProviderLabel) {
      return 22
    }

    const staticPriorityIndex = STATIC_PROVIDER_PRIORITY.indexOf(group.providerId)
    if (staticPriorityIndex !== -1) {
      return 23 + staticPriorityIndex
    }

    return 23 + STATIC_PROVIDER_PRIORITY.length
  }

  return groups
    .map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => {
        const rankDiff = modelRank(left) - modelRank(right)
        if (rankDiff !== 0) {
          return rankDiff
        }

        return left.modelId.localeCompare(right.modelId)
      }),
    }))
    .sort((left, right) => {
      const rankDiff = providerRank(left) - providerRank(right)
      if (rankDiff !== 0) {
        return rankDiff
      }

      return left.providerLabel.localeCompare(right.providerLabel)
    })
}

export const resolveTaskChatModelSummaryLabel = (modelId: string, modelOptions: ExecutionModelOption[]) => {
  const matchedModel = modelOptions.find((model) => model.id === modelId)
  if (matchedModel?.modelId) {
    return `${formatExecutionModelProviderLabel(matchedModel)} / ${matchedModel.modelId}`
  }

  const parsedModelId = parseExecutionModelId(modelId)
  if (parsedModelId) {
    return `${parsedModelId.providerId} / ${parsedModelId.modelId}`
  }

  return modelId
}

type TaskChatModelDerivedParams = {
  agentSaving: boolean
  defaultModel: string
  effectiveExecutorId: string
  executors: ExecutorRecord[]
  mcpSettingsSaving: boolean
  modelLoading: boolean
  modelMenuPreferences: WorkspaceSessionModelMenuPreferences
  modelOptions: ExecutionModelOption[]
  modelSaving: boolean
  preflightAgentType: Task['agentType']
  preflightExecutorId: string
  preflightModel: string
  preflightOpen: boolean
  runtimeSettingsSaving: boolean
  selectedAgentType: Task['agentType']
  selectedModel: string
  workspaceId?: string
}

type TaskChatModelSummary = {
  modelSummary: string
  modelSummaryTitle: string
}

const findExecutionModelOption = (
  modelOptions: ExecutionModelOption[],
  modelId: string,
) => modelOptions.find((option) => option.id === modelId)

const formatTaskChatModelSummaryLabel = (
  model?: Pick<ExecutionModelOption, 'providerId' | 'modelId'> | null,
  fallbackModelId?: string,
) => {
  if (model?.providerId && model.modelId) {
    return `${model.providerId} / ${model.modelId}`
  }

  const parsedModel = parseExecutionModelId(fallbackModelId)
  if (parsedModel) {
    return `${parsedModel.providerId} / ${parsedModel.modelId}`
  }

  return formatExecutionModelLabel(fallbackModelId)
}

export const resolveTaskChatModelSummary = ({
  modelOptions,
  visibleSelectedModel,
  visibleDefaultModel,
}: {
  modelOptions: ExecutionModelOption[]
  visibleSelectedModel: string
  visibleDefaultModel: string
}): TaskChatModelSummary => {
  const selectedModelOption = findExecutionModelOption(modelOptions, visibleSelectedModel)
  if (visibleSelectedModel) {
    return {
      modelSummary: formatTaskChatModelSummaryLabel(selectedModelOption, visibleSelectedModel),
      modelSummaryTitle: `当前已固定模型：${selectedModelOption?.providerId && selectedModelOption.modelId ? `${selectedModelOption.providerId}/${selectedModelOption.modelId}` : visibleSelectedModel}`,
    }
  }

  const defaultModelOption = findExecutionModelOption(modelOptions, visibleDefaultModel)
  if (visibleDefaultModel) {
    return {
      modelSummary: formatTaskChatModelSummaryLabel(defaultModelOption, visibleDefaultModel),
      modelSummaryTitle: `当前使用默认模型：${defaultModelOption?.providerId && defaultModelOption.modelId ? `${defaultModelOption.providerId}/${defaultModelOption.modelId}` : visibleDefaultModel}`,
    }
  }

  return {
    modelSummary: '模型',
    modelSummaryTitle: '当前未设置模型',
  }
}

export function useTaskChatModelDerived({
  agentSaving,
  defaultModel,
  effectiveExecutorId,
  executors,
  mcpSettingsSaving,
  modelLoading,
  modelMenuPreferences,
  modelOptions,
  modelSaving,
  preflightAgentType,
  preflightExecutorId,
  preflightModel,
  preflightOpen,
  runtimeSettingsSaving,
  selectedAgentType,
  selectedModel,
  workspaceId,
}: TaskChatModelDerivedParams) {
  const requiresExecutorBackedModel = (agentType: Task['agentType']) => {
    return agentType === 'OpenCode' || agentType === 'Pi'
  }

  const modelAgentType = preflightOpen ? preflightAgentType : selectedAgentType
  const modelExecutorId = (preflightOpen ? preflightExecutorId : effectiveExecutorId).trim()
  const visibleSelectedModel = resolveMatchingAgentExecutionModelOptionId(selectedAgentType, modelOptions, selectedModel)
  const visibleDefaultModel = resolveMatchingAgentExecutionModelOptionId(selectedAgentType, modelOptions, defaultModel) || defaultModel

  const groupedModelOptions = useMemo(() => {
    return buildWorkspaceSessionGroupedModelOptions({
      modelMenuPreferences,
      modelOptions,
      visibleDefaultModel,
      visibleSelectedModel,
    })
  }, [modelMenuPreferences, modelOptions, visibleDefaultModel, visibleSelectedModel])

  const hasUnavailableSelectedModel = Boolean(selectedModel) && !visibleSelectedModel

  const executorCards = useMemo<ExecutorCardItem[]>(() => {
    return executors
      .map((executor) => {
        const runningCount = executor.presence?.runningTaskIds.length ?? 0
        const queuedCount = executor.presence?.queuedTaskIds.length ?? 0
        const freeSlots = Math.max(0, executor.maxConcurrency - runningCount)
        const isOnline = executor.status === 'online' || executor.status === 'paired'
        const isBusy = executor.status === 'paired' || (executor.status === 'online' && freeSlots === 0)

        return {
          executor,
          runningCount,
          queuedCount,
          freeSlots,
          isOnline,
          isBusy,
          isOutdated: isNodeVersionOutdated(executor.version),
        }
      })
      .sort((left, right) => {
        if (Number(right.isOnline) !== Number(left.isOnline)) {
          return Number(right.isOnline) - Number(left.isOnline)
        }
        if (right.freeSlots !== left.freeSlots) {
          return right.freeSlots - left.freeSlots
        }
        if (left.isBusy !== right.isBusy) {
          return Number(left.isBusy) - Number(right.isBusy)
        }

        return left.executor.name.localeCompare(right.executor.name)
      })
  }, [executors])

  const canAssignExecutor = Boolean(workspaceId) && executorCards.length > 0
  const effectiveModel = resolveTaskChatEffectiveModel(visibleSelectedModel, visibleDefaultModel)
  const requiresModelSelection = requiresExecutorBackedModel(selectedAgentType)
    ? !effectiveModel && Boolean(effectiveExecutorId)
    : !effectiveModel
  const requiresExecutorSelection = canAssignExecutor && !effectiveExecutorId
  const effectivePreflightModel = preflightModel || visibleDefaultModel
  const shouldOpenModelField = requiresExecutorBackedModel(preflightAgentType) ? Boolean(preflightExecutorId) : true
  const preflightRequiresModelSelection = requiresExecutorBackedModel(preflightAgentType)
    ? !effectivePreflightModel && Boolean(preflightExecutorId)
    : !effectivePreflightModel

  const { modelSummary, modelSummaryTitle } = resolveTaskChatModelSummary({
    modelOptions,
    visibleSelectedModel,
    visibleDefaultModel,
  })
  const modelSummaryHint = selectedAgentType === 'ClaudeCode'
    ? 'Claude Code 支持手动切换模型；留空时使用当前默认模型。'
    : selectedAgentType === 'Codex'
      ? 'Codex 支持手动切换模型；留空时使用当前默认模型。'
      : selectedAgentType === 'Pi'
        ? 'Pi 使用 canonical provider/model 标识；留空时使用当前执行端或全局默认模型。'
      : 'OpenCode 留空时使用当前执行端默认模型。'
  const modelMeta = agentSaving ? '执行端切换中' : modelSaving ? '保存中' : modelLoading ? '加载中' : `${modelOptions.length} 个模型`
  const runtimeSettingsDisabled = agentSaving
    || modelSaving
    || runtimeSettingsSaving
    || mcpSettingsSaving
    || !workspaceId
  const modelDisabled = modelLoading || modelSaving || agentSaving
  const canConfirmPreflight = (!preflightRequiresModelSelection || Boolean(effectivePreflightModel))
    && (!requiresExecutorSelection || Boolean(preflightExecutorId))

  return {
    canAssignExecutor,
    canConfirmPreflight,
    effectiveModel,
    effectivePreflightModel,
    executorCards,
    groupedModelOptions,
    hasUnavailableSelectedModel,
    modelAgentType,
    modelDisabled,
    modelExecutorId,
    modelMeta,
    modelSummary,
    modelSummaryHint,
    modelSummaryTitle,
    preflightRequiresModelSelection,
    requiresExecutorSelection,
    requiresModelSelection,
    runtimeSettingsDisabled,
    shouldOpenModelField,
    visibleSelectedModel,
  }
}
