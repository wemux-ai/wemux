// [INPUT]: A persisted workspace session identity plus project/runtime metadata.
// [OUTPUT]: A transient Task-shaped adapter for legacy task-addressed execution APIs.
// [POS]: Shared compatibility boundary; the returned value must never be persisted or bound.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { DEFAULT_AGENT_TYPE } from './agent-type'
import { mergeOpenCodeExecutionConfig, resolveOpenCodeExecutionModel } from './opencode-execution-config'
import type { Project, Task } from './types'

// This is a transport adapter for legacy task-addressed execution APIs only.
// It is never saved as a Task and never creates a task/session binding.
export const buildWorkspaceSessionRuntimeTask = (params: {
  project: Project
  sessionId: string
  title?: string
  agentType?: Task['agentType']
  executionModel?: string
  baseBranch?: string
  currentStep?: string
  createdAt?: string
  updatedAt?: string
}): Task => {
  const timestamp = new Date().toISOString()
  const opencodeConfig = mergeOpenCodeExecutionConfig(undefined, undefined, params.executionModel)

  return {
    id: params.sessionId,
    projectId: params.project.id,
    parentTaskId: undefined,
    title: params.title?.trim() || '默认会话',
    description: '工作区会话运行上下文。',
    requirementType: 'task',
    status: 'todo',
    agentType: params.agentType ?? DEFAULT_AGENT_TYPE,
    executionModel: resolveOpenCodeExecutionModel({ opencodeConfig, executionModel: params.executionModel }),
    opencodeConfig,
    executionMode: 'auto',
    agentManaged: 'none',
    priority: 'none',
    retryCount: 0,
    createdAt: params.createdAt ?? timestamp,
    startedAt: undefined,
    dueAt: undefined,
    updatedAt: params.updatedAt ?? timestamp,
    baseBranch: params.baseBranch?.trim() || params.project.defaultBranch || 'main',
    needsHumanConfirm: false,
    agentRunningStatus: 'idle',
    currentStep: params.currentStep || '等待输入。',
    executionHistory: [],
    comments: [],
    toolCalls: [],
    logs: [],
    history: [],
    orchestration: [],
    validationChecks: [],
  }
}
