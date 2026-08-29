// [INPUT]: 消息处理类型输入
// [OUTPUT]: 类型定义
// [POS]: 消息处理类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { ControlPlaneToExecutorMessage, DistributedTask, ExecutorToControlPlaneMessage, WorkerConfig } from '@shared/types'
import type { runWorkerAgentPrompt } from '../../execution/agent-runner'
import type { PersistentTerminalSessionStore } from '../persistent-terminal-session'
import type { WorkerConnection } from '../types'
import type { PromptQueueState } from './prompt-queue'

export type AgentPromptRequestMessage = Extract<ControlPlaneToExecutorMessage, { type: 'executor.agent.prompt.request' }>

export type ControlPlaneMessageHandlerParams = {
  expectedSocket: WebSocket
  getConnection: () => WorkerConnection | null
  getCurrentSocket: () => WebSocket | undefined
  send: (message: ExecutorToControlPlaneMessage) => boolean
  requestShutdown: (reason?: string) => void
  openTerminalSession: (typeof import('../terminal-session'))['openTerminalSession']
  runTerminalCommand: (typeof import('../terminal-session'))['runTerminalCommand']
  terminalSessions: PersistentTerminalSessionStore
  assignedTasks: Map<string, {
    task: DistributedTask
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    featureFlags?: import('@shared/user-experimental-settings').ExecutorFeatureFlags
  }>
  activeExecutions: Map<string, { abort: () => void }>
  getConfig: () => WorkerConfig
  setConfig: (config: WorkerConfig) => void
  getQueuedTaskIds: () => string[]
  setQueuedTaskIds: (taskIds: string[]) => void
  getRunningTaskIds: () => string[]
  setRunningTaskIds: (taskIds: string[]) => void
  isDrainingForUpdate?: () => boolean
  syncRuntimeState: () => void
  drainExecutionQueue: () => void
  promptQueueState?: PromptQueueState
}
