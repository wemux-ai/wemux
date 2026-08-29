// [INPUT]: Model-center configuration draft and visible executor inventory.
// [OUTPUT]: Executor-scoped runtime model options and local import selection state.
// [POS]: Models-page state adapter for worker model discovery.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useMemo, useState } from 'react'
import { resolveMatchingAgentExecutionModelOptionId } from '@shared/model-profile'
import type { AgentConfig, ExecutionModelOption, ExecutorRecord } from '@shared/types'
import { api } from '../../lib/api'
import { prependCurrentModelOption, sortExecutionModelOptions } from './model-center-runtime-utils'

export type RuntimeTabId = 'OpenCode' | 'Codex' | 'ClaudeCode' | 'Pi'

type RuntimeModelOptionsMap = Record<RuntimeTabId, ExecutionModelOption[]>

const EMPTY_OPTIONS: RuntimeModelOptionsMap = {
  OpenCode: [],
  Codex: [],
  ClaudeCode: [],
  Pi: [],
}

export const useModelCenterRuntimeState = ({
  config,
  executors,
  onConfigChange,
}: {
  config: AgentConfig
  executors: ExecutorRecord[]
  onConfigChange: (config: AgentConfig) => void
}) => {
  const [activeRuntimeTab, setActiveRuntimeTab] = useState<RuntimeTabId>('OpenCode')
  const [modelLoading, setModelLoading] = useState(false)
  const [runtimeModelOptions, setRuntimeModelOptions] = useState<RuntimeModelOptionsMap>(EMPTY_OPTIONS)

  useEffect(() => {
    let cancelled = false
    setModelLoading(true)

    void Promise.all([
      api.listAgentModels('OpenCode', config.workspaceExecutionDefaults.executorNodeId).catch(() => api.listModels().catch(() => null)),
      api.listAgentModels('Codex', config.workspaceExecutionDefaults.executorNodeId).catch(() => null),
      api.listAgentModels('ClaudeCode', config.workspaceExecutionDefaults.executorNodeId).catch(() => null),
      api.listAgentModels('Pi', config.workspaceExecutionDefaults.executorNodeId).catch(() => null),
    ]).then(([openCodeResponse, codexResponse, claudeCodeResponse, piResponse]) => {
      if (cancelled) {
        return
      }

      setRuntimeModelOptions({
        OpenCode: sortExecutionModelOptions(openCodeResponse?.models ?? []),
        Codex: sortExecutionModelOptions(codexResponse?.models ?? []),
        ClaudeCode: sortExecutionModelOptions(claudeCodeResponse?.models ?? []),
        Pi: sortExecutionModelOptions(piResponse?.models ?? []),
      })
    }).finally(() => {
      if (!cancelled) {
        setModelLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [config.workspaceExecutionDefaults.executorNodeId])

  useEffect(() => {
    const nextOpenCodeDefaultModel = resolveMatchingAgentExecutionModelOptionId('OpenCode', runtimeModelOptions.OpenCode, config.agentSettings.OpenCode.defaultModel)
    const nextCodexDefaultModel = resolveMatchingAgentExecutionModelOptionId('Codex', runtimeModelOptions.Codex, config.agentSettings.Codex.defaultModel)
    const nextClaudeDefaultModel = resolveMatchingAgentExecutionModelOptionId('ClaudeCode', runtimeModelOptions.ClaudeCode, config.agentSettings.ClaudeCode.defaultModel)
    const nextPiDefaultModel = resolveMatchingAgentExecutionModelOptionId('Pi', runtimeModelOptions.Pi, config.agentSettings.Pi.defaultModel)
    const shouldUpdateOpenCode = Boolean(nextOpenCodeDefaultModel) && nextOpenCodeDefaultModel !== config.agentSettings.OpenCode.defaultModel
    const shouldUpdateCodex = Boolean(nextCodexDefaultModel) && nextCodexDefaultModel !== config.agentSettings.Codex.defaultModel
    const shouldUpdateClaude = Boolean(nextClaudeDefaultModel) && nextClaudeDefaultModel !== config.agentSettings.ClaudeCode.defaultModel
    const shouldUpdatePi = Boolean(nextPiDefaultModel) && nextPiDefaultModel !== config.agentSettings.Pi.defaultModel

    if (!shouldUpdateOpenCode && !shouldUpdateCodex && !shouldUpdateClaude && !shouldUpdatePi) {
      return
    }

    onConfigChange({
      ...config,
      defaultModel: shouldUpdateOpenCode ? nextOpenCodeDefaultModel : config.defaultModel,
      agentSettings: {
        ...config.agentSettings,
        OpenCode: shouldUpdateOpenCode
          ? {
              ...config.agentSettings.OpenCode,
              defaultModel: nextOpenCodeDefaultModel,
            }
          : config.agentSettings.OpenCode,
        Codex: shouldUpdateCodex
          ? {
              ...config.agentSettings.Codex,
              defaultModel: nextCodexDefaultModel,
            }
          : config.agentSettings.Codex,
        ClaudeCode: shouldUpdateClaude
          ? {
              ...config.agentSettings.ClaudeCode,
              defaultModel: nextClaudeDefaultModel,
            }
          : config.agentSettings.ClaudeCode,
        Pi: shouldUpdatePi
          ? {
              ...config.agentSettings.Pi,
              defaultModel: nextPiDefaultModel,
            }
          : config.agentSettings.Pi,
      },
    })
  }, [config, onConfigChange, runtimeModelOptions])

  const onlineExecutors = useMemo(
    () => executors.filter((executor) => executor.status === 'online'),
    [executors],
  )

  const modelOptions = useMemo<RuntimeModelOptionsMap>(() => ({
    OpenCode: prependCurrentModelOption(runtimeModelOptions.OpenCode, config.agentSettings.OpenCode.defaultModel),
    Codex: prependCurrentModelOption(runtimeModelOptions.Codex, config.agentSettings.Codex.defaultModel),
    ClaudeCode: prependCurrentModelOption(runtimeModelOptions.ClaudeCode, config.agentSettings.ClaudeCode.defaultModel),
    Pi: prependCurrentModelOption(runtimeModelOptions.Pi, config.agentSettings.Pi.defaultModel),
  }), [config.agentSettings, runtimeModelOptions])

  return {
    activeRuntimeTab,
    executors,
    modelLoading,
    modelOptions,
    onlineExecutors,
    setActiveRuntimeTab,
  }
}
