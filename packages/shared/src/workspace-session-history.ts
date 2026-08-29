// [INPUT]: 历史输入
// [OUTPUT]: 历史契约
// [POS]: 会话历史类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { TaskChatAttachment } from './task-chat-attachment'
import type { AgentRunningStatus, CreatorIdentity, WorkspaceSession, WorkspaceSessionRuntimeStatus, ToolCall } from './types'
import type { ChatTimelineEvent, ChatTimelineInteraction } from './timeline'
import type { ModelTokenUsage, TaskResultDelivery, WorkspaceSessionPendingRevision } from './types/task-domain'
import type { TaskGitChangeSummary } from './task-git-ops'

export const WORKSPACE_SESSION_HISTORY_PROTOCOL_VERSION = 'v1alpha1'

export type WorkspaceSessionEventVisibility = 'transcript' | 'diagnostic' | 'hidden'

export const workspaceLifecycleSystemMessagePatterns = [
  /^正在检查原始项目目录：/,
  /^原始目录不存在，正在 clone：/,
  /^原始项目目录已准备：/,
  /^正在准备工作目录：/,
  /^已准备项目目录：/,
  /^正在基于本地 Git 仓库创建 worktree：/,
  /^正在 fetch base 分支：/,
  /^已 fetch base 分支：/,
  /^本节点尚未准备 repo，正在 clone：/,
  /^repo clone 完成：/,
  /^正在创建 worktree：/,
  /^worktree 创建完成：/,
  /^已基于 .+ 创建 worktree /,
  /^正在清理工作区/,
  /^正在清理 worktree：/,
  /^原始目录模式无需清理 worktree/,
  /^当前目录项目无需清理 worktree/,
  /^正在删除 worktree 目录：/,
  /^已删除本地分支：/,
  /^已删除远端分支：/,
  /^worktree 清理完成：/,
  /^已清理 worktree /,
  /^正在提交改动并推送分支：/,
  /^正在提交本地改动：/,
  /^已推送远端分支 /,
  /^已提交 /,
  /^自动提交 \/ 推送失败：/,
  /^工作区目录准备失败：/,
  /^工作区目录清理失败：/,
  /^已复用本地目录 /,
] as const

export const isWorkspaceLifecycleSystemMessage = (message: string) => {
  const normalizedMessage = message.trim()
  return workspaceLifecycleSystemMessagePatterns.some((pattern) => pattern.test(normalizedMessage))
}

export const resolveWorkspaceSessionSystemMessageVisibility = (params: {
  message: string
  turnId?: string
}): WorkspaceSessionEventVisibility => {
  if (params.turnId?.trim().startsWith('system:') && isWorkspaceLifecycleSystemMessage(params.message)) {
    return 'diagnostic'
  }

  return 'transcript'
}

type WorkspaceSessionEventBase = {
  id: string
  sessionId: string
  turnId: string
  sessionSeq: number
  turnSeq: number
  createdAt: string
  visibility: WorkspaceSessionEventVisibility
}

export type WorkspaceSessionEventRecord =
  | WorkspaceSessionEventBase & {
      kind: 'user_message'
      payload: {
        messageId: string
        text: string
        authorId?: string
        author?: CreatorIdentity
        attachments?: TaskChatAttachment[]
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'assistant_message'
      payload: {
        messageId: string
        text: string
        authorName?: string
        executionModel?: string
        attachments?: TaskChatAttachment[]
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'system_message'
      payload: {
        message: string
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'delivery_result'
      payload: {
        message: string
        remoteBranchName?: string
        commitShas?: string[]
        delivery?: TaskResultDelivery
        changeSummary?: TaskGitChangeSummary
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'thinking'
      payload: {
        partId: string
        messageId?: string
        text: string
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'tool_call'
      payload: {
        toolCall: ToolCall
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'interaction'
      payload: {
        interaction: ChatTimelineInteraction
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'status'
      payload: {
        status: AgentRunningStatus
        step: string
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'error'
      payload: {
        message: string
      }
    }
  | WorkspaceSessionEventBase & {
      kind: 'turn_deleted'
      payload: {
        deletedTurnId: string
        deletedMessageId: string
      }
    }

export type WorkspaceSessionTurnRecord = {
  id: string
  sessionId: string
  status: 'running' | 'completed' | 'error' | 'cancelled'
  startedAt: string
  finishedAt?: string
  firstSessionSeq?: number
  lastSessionSeq?: number
  eventCount: number
  usage?: ModelTokenUsage
  lineage?: {
    sourceSessionId?: string
    sourceTurnId?: string
    sourceUserMessageId?: string
    sourceAssistantMessageId?: string
    revision?: WorkspaceSessionPendingRevision
  }
}

export type WorkspaceSessionRuntimeQueueStatus = 'idle' | 'queued' | 'running'

export type WorkspaceSessionRuntimeSnapshot = {
  sessionId: string
  taskId?: string
  workspaceId: string
  agentRunningStatus: AgentRunningStatus
  runtimeStatus?: WorkspaceSessionRuntimeStatus
  currentStep: string
  queueStatus: WorkspaceSessionRuntimeQueueStatus
  activeToolCalls: ToolCall[]
  lastEventSeq: number
  lastEventAt?: string
  updatedAt: string
}

export type WorkspaceSessionHistoryProjection = {
  sessionId: string
  taskId?: string
  workspaceId: string
  latestTurnId?: string
  latestEventKind?: WorkspaceSessionEventRecord['kind']
  latestEventSeq: number
  totalEventCount: number
  lastEventAt?: string
  latestUserMessageId?: string
  latestUserMessagePreview?: string
  latestAssistantMessageId?: string
  latestAssistantMessagePreview?: string
  lastPersistedTurnStartedAt?: string
  lastPersistedTurnFinishedAt?: string
  lastPersistedTurnStatus?: WorkspaceSessionTurnRecord['status']
  deletedTurnCount: number
  updatedAt: string
  hasPersistedHistory: boolean
  latestPreviewText?: string
}

export type WorkspaceSessionEventsPage = {
  protocolVersion: typeof WORKSPACE_SESSION_HISTORY_PROTOCOL_VERSION
  sessionId: string
  events: WorkspaceSessionEventRecord[]
  totalCount: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  visibility: WorkspaceSessionEventVisibility | 'all'
}

export type WorkspaceSessionSnapshot = {
  session: WorkspaceSession
  history: WorkspaceSessionEventsPage
  runtime: WorkspaceSessionRuntimeSnapshot | null
}

export const resolveWorkspaceSessionHistoryLatestPreviewText = (
  projection?: WorkspaceSessionHistoryProjection | null,
) => {
  if (!projection) {
    return undefined
  }

  return projection.latestAssistantMessagePreview
    || projection.latestUserMessagePreview
    || undefined
}

export const isWorkspaceSessionTurnDeletedEvent = (
  event: WorkspaceSessionEventRecord,
): event is Extract<WorkspaceSessionEventRecord, { kind: 'turn_deleted' }> => event.kind === 'turn_deleted'

export const isWorkspaceSessionConversationEvent = (
  event: WorkspaceSessionEventRecord,
): event is Extract<WorkspaceSessionEventRecord, { kind: 'user_message' | 'assistant_message' }> => (
  event.kind === 'user_message'
  || event.kind === 'assistant_message'
)

export const resolveWorkspaceSessionEventVisibility = (
  event: WorkspaceSessionEventRecord,
): WorkspaceSessionEventVisibility => event.visibility

export const isWorkspaceSessionTranscriptEvent = (
  event: WorkspaceSessionEventRecord,
) => event.visibility === 'transcript'

export const workspaceSessionEventRecordToTimelineEvent = (
  event: WorkspaceSessionEventRecord,
): ChatTimelineEvent | null => {
  const base = {
    id: event.id,
    ts: event.createdAt,
    turnId: event.turnId,
    seq: event.turnSeq,
  }

  switch (event.kind) {
    case 'user_message':
      return {
        ...base,
        kind: 'user_message',
        messageId: event.payload.messageId,
        text: event.payload.text,
        authorId: event.payload.authorId,
        author: event.payload.author,
        attachments: event.payload.attachments,
      }
    case 'assistant_message':
      return {
        ...base,
        kind: 'assistant_message',
        messageId: event.payload.messageId,
        text: event.payload.text,
        authorName: event.payload.authorName,
        executionModel: event.payload.executionModel,
        attachments: event.payload.attachments,
      }
    case 'system_message':
      return {
        ...base,
        kind: 'system_message',
        message: event.payload.message,
      }
    case 'delivery_result':
      return {
        ...base,
        kind: 'delivery_result',
        message: event.payload.message,
        remoteBranchName: event.payload.remoteBranchName,
        commitShas: event.payload.commitShas,
        delivery: event.payload.delivery,
        changeSummary: event.payload.changeSummary,
      }
    case 'thinking':
      return {
        ...base,
        kind: 'thinking',
        partId: event.payload.partId,
        messageId: event.payload.messageId,
        text: event.payload.text,
      }
    case 'tool_call':
      return {
        ...base,
        kind: 'tool_call',
        toolCall: event.payload.toolCall,
      }
    case 'interaction':
      return {
        ...base,
        kind: 'interaction',
        interaction: event.payload.interaction,
      }
    case 'status':
      return {
        ...base,
        kind: 'status',
        status: event.payload.status,
        step: event.payload.step,
      }
    case 'error':
      return {
        ...base,
        kind: 'error',
        message: event.payload.message,
      }
    case 'turn_deleted':
      return null
  }
}
