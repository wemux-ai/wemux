// [INPUT]: agent runner 共享参数
// [OUTPUT]: runner 共享工具
// [POS]: agent runner 共享逻辑
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AgentPromptResultBase } from '@shared/types/agent-prompt'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { McpServerPolicy } from '@shared/mcp'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { AgentRuntimeSettings, AgentType, ExecutorAgentPromptAbortReason, ExecutorAgentPromptEvent, ExecutorSkillPackage, OpenCodeExecutionConfig } from '@shared/types'
import type { MaterializedPromptAttachment } from './prompt-attachments'
import { resolveExecutable as resolveExecutablePath, shouldSpawnWithShellOnWindows } from '../core/command-utils'

export type WorkerAgentPromptResult = AgentPromptResultBase & {
  filesChanged?: string[]
}

/** Shared base for all worker agent execution parameters. */
export type WorkerAgentParamsBase = {
  agentType: AgentType
  actingUserId?: string
  runtimeAgentId?: string
  cwd: string
  title: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  opencodeConfig?: OpenCodeExecutionConfig
  mcpServers?: McpServerPolicy[]
  skipRuntimeCheck?: boolean
  runtimeSkillPackages?: ExecutorSkillPackage[]
  runtimeEnv?: Record<string, string>
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  runtimeArgs?: string[]
  runtimePrepared?: boolean
  signal?: AbortSignal
  /** 执行工作区 id（workspaces 表），用于官方连接器多租户隔离上下文 */
  workspaceId?: string
}

export type WorkerAgentPromptParams = WorkerAgentParamsBase & {
  resumeSessionId?: string
  prompt: string
  attachments?: TaskChatAttachment[]
  preparedAttachments?: MaterializedPromptAttachment[]
  cloudUrl?: string
  onEvent?: (event: ExecutorAgentPromptEvent) => void
}

export type WorkerAgentTaskParams = WorkerAgentParamsBase & {
  description: string
}

export const resolveExecutable = (command: string) => {
  return resolveExecutablePath(command)
}

export { shouldSpawnWithShellOnWindows }

export const readJsonLine = <T>(line: string) => {
  try {
    return JSON.parse(line) as T
  } catch {
    return null
  }
}

export const emitAgentEvent = (
  agentType: AgentType,
  onEvent: WorkerAgentPromptParams['onEvent'],
  event: Omit<ExecutorAgentPromptEvent, 'agentType'>,
) => {
  onEvent?.({
    agentType,
    ...event,
  })
}

export const resolveAbortReason = (signal?: AbortSignal): ExecutorAgentPromptAbortReason => {
  const reason = signal?.reason
  if (typeof reason === 'string') {
    return reason as ExecutorAgentPromptAbortReason
  }
  if (reason && typeof reason === 'object' && 'reason' in reason && typeof reason.reason === 'string') {
    return reason.reason as ExecutorAgentPromptAbortReason
  }
  return 'unknown'
}

export const resolveAbortMessage = (signal?: AbortSignal) => {
  const reason = signal?.reason
  if (typeof reason === 'string') {
    return reason === 'user_stop' ? '已停止' : '任务已取消'
  }
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' && reason.message.trim()) {
    return reason.message
  }

  const abortReason = resolveAbortReason(signal)
  switch (abortReason) {
    case 'user_stop':
      return '已停止'
    case 'server_timeout':
      return '请求超时，已中止本次回复。'
    case 'executor_disconnected':
      return '执行器心跳超时，已中止本次回复。'
    case 'executor_reconnect':
      return '执行器连接已断开，已中止本次回复。'
    case 'control_plane_disconnect':
      return '执行器与控制面连接已断开，本次回复已中止。'
    case 'server_abort':
      return '请求已中止'
    default:
      return '任务已取消'
  }
}

export const toAbortError = (signal?: AbortSignal) => {
  const error = new Error(resolveAbortMessage(signal))
  error.name = 'AbortError'
  ;(error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason = resolveAbortReason(signal)
  return error
}

export const normalizeExecutionModel = (value?: string) => {
  const normalized = value?.trim()
  if (!normalized || normalized === 'default') {
    return undefined
  }

  return normalized
}
