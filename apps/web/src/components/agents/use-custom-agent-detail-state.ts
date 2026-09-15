/**
 * [INPUT]: Custom Agent runtime/model draft plus the selected execution node.
 * [OUTPUT]: Executor-scoped model options, refresh state, and runtime-change normalization for the Agent detail model selector.
 * [POS]: Keeps Agent model discovery aligned with the Worker that will execute it.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useState } from 'react'
import type { ExecutionModelOption, RuntimeId } from '@shared/types'
import type { SearchableSelectOption } from '../ui/searchable-select'
import { api } from '../../lib/api'
import { formatExecutionModelProviderLabel } from '../../lib/utils'
import type { CustomAgentDetailPanelProps } from './custom-agent-detail-panel-shared'

const RUNTIME_MODEL_REFRESH_DELAY_MS = 2_000

export const resolveCustomAgentModelRequest = (
  draft: Pick<CustomAgentDetailPanelProps['draft'], 'defaultExecutorId' | 'preferredRuntime'>,
) => ({
  agentType: draft.preferredRuntime,
  executorId: draft.defaultExecutorId.trim() || undefined,
})

export const applyCustomAgentRuntimeChange = <T extends {
  preferredRuntime: RuntimeId
  preferredModel: string
}>(draft: T, preferredRuntime: RuntimeId): T => {
  if (draft.preferredRuntime === preferredRuntime) {
    return draft
  }

  return {
    ...draft,
    preferredRuntime,
    preferredModel: '',
  }
}

const mapModelOptions = (
  models: ExecutionModelOption[],
  runtimeLabel: string,
): SearchableSelectOption[] => {
  return models.map((model) => ({
    value: model.id,
    label: model.id,
    description: model.isDefault
      ? `${resolveModelSourceLabel(model, runtimeLabel)} · 默认模型`
      : resolveModelSourceLabel(model, runtimeLabel),
    keywords: [model.id, model.label, model.modelId, model.providerId, formatExecutionModelProviderLabel(model), model.profileName, runtimeLabel],
  }))
}

const resolveModelSourceLabel = (model: ExecutionModelOption, runtimeLabel: string) => {
  if (model.source === 'catalog') {
    return model.profileName ? `模型库 · ${model.profileName}` : '模型库'
  }

  if (model.source === 'runtime') {
    return `${runtimeLabel} 运行时 · ${formatExecutionModelProviderLabel(model)}`
  }

  return `${runtimeLabel} 内置目录`
}

const dedupeModelOptions = (options: SearchableSelectOption[]) => {
  const seen = new Set<string>()
  return options.filter((option) => {
    if (seen.has(option.value)) {
      return false
    }
    seen.add(option.value)
    return true
  })
}

const prependCurrentModelOption = (options: SearchableSelectOption[], currentModel: string) => {
  const normalized = currentModel.trim()
  if (!normalized || options.some((option) => option.value === normalized)) {
    return options
  }

  return [
    {
      value: normalized,
      label: normalized,
      description: '当前已保存值',
      keywords: [normalized],
    },
    ...options,
  ]
}

const prependEmptyModelOption = (options: SearchableSelectOption[], label: string, description: string) => {
  return [
    {
      value: '',
      label,
      description,
      keywords: [label, description],
    },
    ...options,
  ]
}

export const useCustomAgentDetailState = ({
  draft,
  state,
}: Pick<CustomAgentDetailPanelProps, 'draft' | 'state'>) => {
  const [openCodeModelOptions, setOpenCodeModelOptions] = useState<SearchableSelectOption[]>([])
  const [codexModelOptions, setCodexModelOptions] = useState<SearchableSelectOption[]>([])
  const [claudeCodeModelOptions, setClaudeCodeModelOptions] = useState<SearchableSelectOption[]>([])
  const [piModelOptions, setPiModelOptions] = useState<SearchableSelectOption[]>([])
  const [openCodeDefaultModel, setOpenCodeDefaultModel] = useState('')
  const [piDefaultModel, setPiDefaultModel] = useState('')
  const [modelLoading, setModelLoading] = useState(false)
  const [modelRefreshKey, setModelRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined

    const { agentType, executorId } = resolveCustomAgentModelRequest(draft)
    const shouldLoadOpenCode = agentType === 'OpenCode'
    const shouldLoadCodex = agentType === 'Codex'
    const shouldLoadClaudeCode = agentType === 'ClaudeCode'
    const shouldLoadPi = agentType === 'Pi'

    if (!shouldLoadOpenCode && !shouldLoadCodex && !shouldLoadClaudeCode && !shouldLoadPi) {
      return
    }

    setModelLoading(true)

    const applyModelResponse = (response: {
      models: ExecutionModelOption[]
      defaultModel?: string
    } | null) => {
      if (!response) {
        return
      }

      if (shouldLoadOpenCode) {
        setOpenCodeModelOptions(mapModelOptions(response.models, 'OpenCode'))
        setOpenCodeDefaultModel(response.defaultModel ?? '')
      } else if (shouldLoadCodex) {
        setCodexModelOptions(mapModelOptions(response.models, 'Codex'))
      } else if (shouldLoadClaudeCode) {
        setClaudeCodeModelOptions(mapModelOptions(response.models, 'Claude Code'))
      } else if (shouldLoadPi) {
        setPiModelOptions(mapModelOptions(response.models, 'Pi'))
        setPiDefaultModel(response.defaultModel ?? '')
      }
    }

    void Promise.all([
      shouldLoadOpenCode
        ? api.listAgentModels('OpenCode', executorId).catch(() => api.listModels().catch(() => null))
        : Promise.resolve(null),
      shouldLoadCodex ? api.listAgentModels('Codex', executorId).catch(() => null) : Promise.resolve(null),
      shouldLoadClaudeCode ? api.listAgentModels('ClaudeCode', executorId).catch(() => null) : Promise.resolve(null),
      shouldLoadPi ? api.listAgentModels('Pi', executorId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([openCodeResponse, codexResponse, claudeCodeResponse, piResponse]) => {
        if (cancelled) {
          return
        }

        const selectedResponse = openCodeResponse ?? codexResponse ?? claudeCodeResponse ?? piResponse
        applyModelResponse(selectedResponse)
        if (!selectedResponse || !('runtimePending' in selectedResponse) || !selectedResponse.runtimePending) {
          setModelLoading(false)
          return
        }

        refreshTimer = setTimeout(() => {
          if (cancelled) {
            return
          }

          void api.listAgentModels(agentType, executorId, { waitRuntime: true })
            .then((refreshed) => {
              if (cancelled) {
                return
              }

              if (!refreshed.runtimePending) {
                applyModelResponse(refreshed)
              }
            })
            .catch(() => {
              // Keep the initial catalog while this executor is unavailable.
            })
            .finally(() => {
              if (!cancelled) {
                setModelLoading(false)
              }
            })
        }, RUNTIME_MODEL_REFRESH_DELAY_MS)
      })

    return () => {
      cancelled = true
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
    }
  }, [draft.defaultExecutorId, draft.preferredRuntime, modelRefreshKey])

  const preferredModelOptions = useMemo(() => {
    const openCodeFallbackDefaultModel = openCodeDefaultModel || state.config.agentSettings.OpenCode.defaultModel
    const piFallbackDefaultModel = piDefaultModel || state.config.agentSettings.Pi.defaultModel
    const emptyLabel = draft.preferredRuntime === 'Codex'
      ? `留空，使用 Codex 默认模型${state.config.agentSettings.Codex.defaultModel ? `（${state.config.agentSettings.Codex.defaultModel}）` : ''}`
      : draft.preferredRuntime === 'ClaudeCode'
        ? `留空，使用 Claude Code 默认模型${state.config.agentSettings.ClaudeCode.defaultModel ? `（${state.config.agentSettings.ClaudeCode.defaultModel}）` : ''}`
        : draft.preferredRuntime === 'Pi'
          ? `留空，使用 Pi 默认模型${piFallbackDefaultModel ? `（${piFallbackDefaultModel}）` : ''}`
          : `留空，使用 OpenCode 默认模型${openCodeFallbackDefaultModel ? `（${openCodeFallbackDefaultModel}）` : ''}`
    const emptyDescription = draft.preferredRuntime === 'Pi'
      ? '不固定模型，交给 Pi 默认模型或当前绑定的模型 Profile。'
      : '不固定模型，交给对应执行端默认配置。'

    const runtimeScopedOptions = draft.preferredRuntime === 'Codex'
      ? codexModelOptions
      : draft.preferredRuntime === 'ClaudeCode'
        ? claudeCodeModelOptions
        : draft.preferredRuntime === 'OpenCode'
          ? openCodeModelOptions
          : piModelOptions

    return prependEmptyModelOption(
      prependCurrentModelOption(runtimeScopedOptions, draft.preferredModel),
      emptyLabel,
      emptyDescription,
    )
  }, [
    draft.preferredModel,
    draft.preferredRuntime,
    openCodeDefaultModel,
    openCodeModelOptions,
    piDefaultModel,
    piModelOptions,
    codexModelOptions,
    claudeCodeModelOptions,
    state.config.agentSettings.ClaudeCode.defaultModel,
    state.config.agentSettings.Codex.defaultModel,
    state.config.agentSettings.OpenCode.defaultModel,
    state.config.agentSettings.Pi.defaultModel,
  ])

  return {
    modelLoading,
    preferredModelOptions,
    refreshPreferredModels: () => setModelRefreshKey((current) => current + 1),
  }
}
