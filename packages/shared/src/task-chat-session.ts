// [INPUT]: 任务对话会话输入
// [OUTPUT]: 会话契约
// [POS]: 任务对话会话类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { DEFAULT_AGENT_SETTINGS, mergeAgentRuntimeSettings } from './agent-config'
import { isAgentType } from './agent-type'
import type { TaskChatAttachment } from './task-chat-attachment'
import type { TaskChatContextRef } from './task-chat-context'
import type {
  AgentRunningStatus,
  AgentRuntimeSettings,
  CreatorIdentity,
  WorkspaceGitAuthPreference,
  WorkspacePublishPolicy,
  WorkspaceSessionAgentInvocationMode,
  WorkspaceSessionKind,
  WorkspaceSessionRuntimeStatus,
  WorkspaceSessionRole,
  Task,
} from './types'

export const TASK_CHAT_PROTOCOL_VERSION = 'v1alpha1'
export const TASK_CHAT_STREAM_PROTOCOL = 'task-chat-ws'
export const TASK_CHAT_HISTORY_PROTOCOL = 'conversation-http'
export const TASK_CHAT_QUEUE_PROTOCOL = 'http-resource'

const buildWorkspaceScope = (workspaceId?: string, workspaceSessionId?: string) => {
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  const normalizedWorkspaceSessionId = workspaceSessionId?.trim() || ''
  if (normalizedWorkspaceSessionId) {
    return `${normalizedWorkspaceId || 'workspace'}::${normalizedWorkspaceSessionId}`
  }

  return normalizedWorkspaceId
}

export const buildTaskChatSessionKey = (taskId?: string, workspaceId?: string, workspaceSessionId?: string) => {
  const workspaceScope = buildWorkspaceScope(workspaceId, workspaceSessionId)
  if (!taskId?.trim() && workspaceSessionId?.trim()) {
    return `workspace-session:${workspaceSessionId.trim()}`
  }

  if (!taskId?.trim()) {
    throw new Error('任务聊天必须提供 taskId 或 workspaceSessionId。')
  }

  return workspaceScope
    ? `task:${taskId}:workspace:${workspaceScope}`
    : `task:${taskId}`
}

export const resolveTaskChatSessionMode = (workspaceId?: string, workspaceSessionId?: string) => {
  return workspaceId || workspaceSessionId ? 'workspace' as const : 'task' as const
}

const normalizeOptionalString = (value: unknown) => {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const normalizeOptionalStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = Array.from(new Set(
    value
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean),
  ))

  return normalized.length > 0 ? normalized : []
}

export interface TaskChatMessageRuntimeConfig {
  agentType: Task['agentType']
  executorNodeId?: string
  executionModel?: string
  agentSettings?: AgentRuntimeSettings
  enabledMcpServerIds?: string[]
  publishPolicy?: WorkspacePublishPolicy
  gitAuthPreference?: WorkspaceGitAuthPreference
}

const normalizeWorkspacePublishPolicy = (value: unknown): WorkspacePublishPolicy | undefined => {
  if (value === 'none' || value === 'push-branch' || value === 'pull-request') {
    return value
  }
  return undefined
}

const normalizeWorkspaceGitAuthPreference = (value: unknown): WorkspaceGitAuthPreference | undefined => {
  if (value === 'project-default' || value === 'github-app' || value === 'credential') {
    return value
  }
  return undefined
}

export const normalizeTaskChatMessageRuntimeConfig = (value: unknown): TaskChatMessageRuntimeConfig | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const agentType = normalizeOptionalString(record.agentType)
  if (!isAgentType(agentType)) {
    return undefined
  }

  return {
    agentType,
    executorNodeId: normalizeOptionalString(record.executorNodeId),
    executionModel: normalizeOptionalString(record.executionModel),
    agentSettings: record.agentSettings
      ? mergeAgentRuntimeSettings(agentType, DEFAULT_AGENT_SETTINGS[agentType], record.agentSettings)
      : undefined,
    enabledMcpServerIds: normalizeOptionalStringArray(record.enabledMcpServerIds),
    publishPolicy: normalizeWorkspacePublishPolicy(record.publishPolicy),
    gitAuthPreference: normalizeWorkspaceGitAuthPreference(record.gitAuthPreference),
  }
}

export interface TaskChatQueueEntry {
  id: string
  sessionKey: string
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  taskRunId?: string
  requestedByAgentId?: string
  sourceAgentEventId?: string
  author?: CreatorIdentity
  dedupeKey?: string
  message: string
  attachments?: TaskChatAttachment[]
  contextRefs?: TaskChatContextRef[]
  runtimeConfig?: TaskChatMessageRuntimeConfig
  createdAt: string
  createdBy?: string
  retryCount?: number
}

export type TaskChatExecutionIdentity = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

export interface TaskChatQueueState {
  sessionKey: string
  status: 'empty' | 'queued'
  items: TaskChatQueueEntry[]
}

export interface TaskChatSessionSnapshot {
  protocol: {
    version: typeof TASK_CHAT_PROTOCOL_VERSION
    stream: typeof TASK_CHAT_STREAM_PROTOCOL
    history: typeof TASK_CHAT_HISTORY_PROTOCOL
    queue: typeof TASK_CHAT_QUEUE_PROTOCOL
  }
  scope: {
    mode: 'task' | 'workspace'
    taskId?: string
    workspaceId?: string
    workspaceSessionId?: string
    sessionKey: string
  }
    runtime: {
      agentRunningStatus: AgentRunningStatus
      runtimeStatus?: WorkspaceSessionRuntimeStatus
      currentStep: string
      needsHumanConfirm: boolean
      agentSessionId?: string
      opencodeSessionId?: string
      executorNodeId?: string
      runtimeOwnerExecutorId?: string
      runtimeSessionId?: string
      runtimeStartedAt?: string
      lastHeartbeatAt?: string
      lastRuntimeEventAt?: string
      terminalReason?: string
      runtimeSequence?: number
      sessionKind?: WorkspaceSessionKind
      sessionRole?: WorkspaceSessionRole
      parentSessionId?: string
      rootSessionId?: string
    customAgentId?: string
    customAgentName?: string
    agentInvocationMode?: WorkspaceSessionAgentInvocationMode
    mountedSkillNames?: string[]
    mountedMcpServerNames?: string[]
  }
  conversation: {
    conversationId?: string
    messageCount: number
    latestMessageAt?: string
  }
  queue: TaskChatQueueState
}
