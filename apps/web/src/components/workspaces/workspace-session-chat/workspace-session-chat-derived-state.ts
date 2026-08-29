// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
// INPUT: raw workspace-session chat state and async runtime-setting state
// OUTPUT: agent/model/view projections plus composer send availability
// POS: shared derived-state boundary for workspace session chat

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { McpServerPolicy } from '@shared/mcp'
import type { TaskChatQueueEntry, TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  AgentRunningStatus,
  ExecutionModelOption,
  ExecutorRecord,
  Project,
  Task,
  WorkspaceSessionRole,
  ToolCall,
} from '@shared/types'
import type { AgentRecord, ConversationMessageRecord } from '../../../lib/api'
import type { ChatTimelineEvent } from '../../../lib/workspace-session-chat-ui'
import type { WorkspaceSessionModelMenuPreferences } from '../../../lib/workspace-session-model-menu-preferences'
import type { ChatImage } from './workspace-session-chat-types'
import { useTaskChatAgentDerived } from './workspace-session-chat-agent-derived'
import { useTaskChatModelDerived } from './workspace-session-chat-model-derived'
import { useTaskChatViewDerived } from './workspace-session-chat-view-derived'

type TaskChatDerivedStateParams = {
  agentSaving: boolean
  availableAgents: AgentRecord[]
  chatSession: TaskChatSessionSnapshot | null
  composerCaret: number
  conversationMessages: ConversationMessageRecord[]
  defaultModel: string
  delegateAgentId: string
  delegateSessionRole: WorkspaceSessionRole
  effectiveExecutorId: string
  executorSaving: boolean
  executors: ExecutorRecord[]
  images: ChatImage[]
  injectedTesterContextIdsRef: MutableRefObject<string[]>
  input: string
  isSendingMessage: boolean
  liveStatus: AgentRunningStatus
  liveStep: string
  liveTools: ToolCall[]
  mcpServers?: McpServerPolicy[]
  mcpSettingsSaving: boolean
  modelLoading: boolean
  modelMenuPreferences: WorkspaceSessionModelMenuPreferences
  modelOptions: ExecutionModelOption[]
  modelSaving: boolean
  preflightAgentType: Task['agentType']
  preflightExecutorId: string
  preflightModel: string
  preflightOpen: boolean
  preparingWorkspace: boolean
  project?: Project | null
  queuedMessages: TaskChatQueueEntry[]
  runtimeSettingsSaving: boolean
  selectedAgentType: Task['agentType']
  selectedModel: string
  setComposerCaret: Dispatch<SetStateAction<number>>
  setInput: Dispatch<SetStateAction<string>>
  socketStatus: 'connecting' | 'open' | 'closed' | 'error'
  task: Task
  timeline: ChatTimelineEvent[]
  workspaceId?: string
  workspaceSessionId?: string
}

export function useTaskChatDerivedState(params: TaskChatDerivedStateParams) {
  const view = useTaskChatViewDerived({
    chatSession: params.chatSession,
    executors: params.executors,
    liveStatus: params.liveStatus,
    liveStep: params.liveStep,
    liveTools: params.liveTools,
    preparingWorkspace: params.preparingWorkspace,
    queuedMessages: params.queuedMessages,
    socketStatus: params.socketStatus,
    task: params.task,
    timeline: params.timeline,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  const agent = useTaskChatAgentDerived({
    availableAgents: params.availableAgents,
    chatSession: params.chatSession,
    composerCaret: params.composerCaret,
    conversationMessages: params.conversationMessages,
    delegateAgentId: params.delegateAgentId,
    delegateSessionRole: params.delegateSessionRole,
    injectedTesterContextIdsRef: params.injectedTesterContextIdsRef,
    input: params.input,
    mcpServers: params.mcpServers,
    project: params.project,
    setComposerCaret: params.setComposerCaret,
    setInput: params.setInput,
    systemLogs: view.systemLogs,
    task: params.task,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })

  const model = useTaskChatModelDerived({
    agentSaving: params.agentSaving,
    defaultModel: params.defaultModel,
    effectiveExecutorId: params.effectiveExecutorId,
    executors: params.executors,
    mcpSettingsSaving: params.mcpSettingsSaving,
    modelLoading: params.modelLoading,
    modelMenuPreferences: params.modelMenuPreferences,
    modelOptions: params.modelOptions,
    modelSaving: params.modelSaving,
    preflightAgentType: params.preflightAgentType,
    preflightExecutorId: params.preflightExecutorId,
    preflightModel: params.preflightModel,
    preflightOpen: params.preflightOpen,
    runtimeSettingsSaving: params.runtimeSettingsSaving,
    selectedAgentType: params.selectedAgentType,
    selectedModel: params.selectedModel,
    workspaceId: params.workspaceId,
  })

  const sendDisabled = view.isSessionBusy
    ? false
    : params.executorSaving
      || params.isSendingMessage
      || params.images.some((image) => image.uploadState === 'uploading')
      || (!params.input.trim() && params.images.length === 0)

  return {
    ...agent,
    ...model,
    ...view,
    sendDisabled,
  }
}
