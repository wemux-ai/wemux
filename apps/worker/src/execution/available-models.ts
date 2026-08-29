// [INPUT]: 各 runtime 可用模型源
// [OUTPUT]: 模型清单
// [POS]: 可用模型列表
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { Task } from '@shared/types'
import { CLAUDE_CODE_MODEL_IDS } from '@shared/agent-config'
import { loadWorkerConfig } from '../core/config'
import { listWorkerAvailableCodexModels } from './codex-models'
import { listWorkerAvailableModels as listWorkerOpenCodeModels } from './opencode'
import { listWorkerAvailablePiModels } from './pi-models'
import type { ExecutionModelOption } from '@shared/types'

const listClaudeCodeModels = (): { models: ExecutionModelOption[]; defaultModel?: string; message?: string } => {
  const models: ExecutionModelOption[] = CLAUDE_CODE_MODEL_IDS.map((id) => ({
    id,
    label: id,
    providerId: 'anthropic',
    modelId: id,
    isDefault: id === 'default',
  }))
  return { models, defaultModel: 'default' }
}

export const listWorkerAvailableModels = async (agentType?: Task['agentType']) => {
  const config = loadWorkerConfig()

  if (agentType === 'Codex') {
    return listWorkerAvailableCodexModels(config)
  }

  if (agentType === 'ClaudeCode') {
    return listClaudeCodeModels()
  }

  if (agentType === 'Pi') {
    return listWorkerAvailablePiModels(config)
  }

  return listWorkerOpenCodeModels()
}
