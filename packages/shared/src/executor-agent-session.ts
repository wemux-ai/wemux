// [INPUT]: Agent 会话输入
// [OUTPUT]: 会话契约
// [POS]: executor Agent 会话类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorAgentSessionEntry } from './types/executor'

const EXECUTOR_AGENT_SESSION_BOILERPLATE_MARKERS = [
  '# AGENTS.md instructions',
  '<environment_context>',
  '<INSTRUCTIONS>',
  '<local-command-caveat>',
  '<local-command-stdout>',
]

export const isExecutorAgentSessionBoilerplatePrompt = (value: string) => {
  const normalized = value.trim()
  if (!normalized) {
    return false
  }

  return EXECUTOR_AGENT_SESSION_BOILERPLATE_MARKERS.some((marker) => normalized.includes(marker))
}

export const isImportableExecutorAgentSessionEntry = (
  entry: Pick<ExecutorAgentSessionEntry, 'role' | 'text'>,
) => {
  return (entry.role === 'user' || entry.role === 'assistant')
    && !isExecutorAgentSessionBoilerplatePrompt(entry.text)
}

export const getImportableExecutorAgentSessionEntries = <
  T extends Pick<ExecutorAgentSessionEntry, 'role' | 'text'>
>(
  entries: readonly T[],
) => {
  return entries.filter((entry) => isImportableExecutorAgentSessionEntry(entry))
}
