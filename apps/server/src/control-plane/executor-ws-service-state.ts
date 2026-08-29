// [INPUT]: executor WS 连接状态与消息类型
// [OUTPUT]: 连接状态容器与类型定义
// [POS]: executor WS 连接状态模型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { randomUUID } from 'node:crypto'

import { getEnv } from '@shared/env'
import type {
  ControlPlaneToExecutorMessage,
  ExecutorAgentSessionReadResult,
  ExecutorAgentSessionsResult,
  ExecutorAgentPromptEvent,
  ExecutorAgentWorkdirDownloadResult,
  ExecutorAgentWorkdirReadResult,
  ExecutorAgentWorkdirResult,
  ExecutorAgentPromptResult,
  WorkspaceRemoteCodeResult,
  WorkspaceDesktopSandboxResult,
  ExecutorDirectoryBrowseResult,
  ExecutorFileReadResult,
  ExecutorFileWriteResult,
  ExecutorGitBaselineDiffResult,
  ExecutorGitBaselineSnapshotResult,
  ExecutorGitCommitResult,
  ExecutorGitCheckoutResult,
  ExecutorGitCommitDiffResult,
  ExecutorGitDiffResult,
  ExecutorGitGraphResult,
  ExecutorGitPullRequestResult,
  ExecutorGitPushResult,
  ExecutorGitRebaseResult,
  ExecutorGitWorkingTreeDiffResult,
  ExecutorHttpProbeResult,
  ExecutorWorktreeStartPointMode,
  ExecutorSkillScanResult,
  ExecutorTerminalRequestMode,
  ExecutorTerminalResult,
  ExecutorTerminalLocalAttachTicketResult,
  ExecutorTerminalSessionAttachResult,
  ExecutorTerminalSessionCloseResult,
  ExecutorTerminalSessionCreateResult,
  ExecutorTerminalSessionsResult,
  ExecutorWorkspaceOperationEvent,
  ExecutorWorktreeResult,
  LocalPathProbeResult,
  PatVerificationResult,
  RepoBranchSnapshotResult,
  SshVerificationResult,
  WorkerDoctorPayload,
} from '@shared/types'
import type { WorkspaceTerminalSessionDescriptor, WorkspaceTerminalSessionSnapshot } from '@shared/types'
import { buildWorkspaceTerminalSessionKey } from '@shared/types'
import { createExecutionEvent } from '../storage/execution-event-store'
import { executorRegistry } from './executor-registry'

export type ExecutorSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: () => void
}

export type BrowserTerminalSocket = {
  OPEN: number
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
}

export const isSocketOpen = (socket: ExecutorSocket | null | undefined) => {
  if (!socket) {
    return false
  }

  return socket.readyState === 1 || socket.readyState === socket.OPEN
}

export const pendingConfigExports = new Map<string, {
  executorId: string
  resolve: (value: {
    opencodeConfigContent?: string
    codexConfigContent?: string
    codexAuthContent?: string
    claudeCodeConfigContent?: string
    defaultModel?: string
    agentSettings?: import('@shared/types').AgentSettings
    availableModels?: import('@shared/types').ExecutionModelOption[]
    resolvedModelBindings?: import('@shared/types').ResolvedModelImportBinding[]
    modelsMessage?: string
    at: string
  }) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingCodexOauthRequests = new Map<string, {
  executorId: string
  resolve: (value: import('@shared/types').ExecutorCodexOauthResponsePayload) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingRepoProbes = new Map<string, {
  executorId: string
  resolve: (value: LocalPathProbeResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingPatVerifications = new Map<string, {
  executorId: string
  resolve: (value: PatVerificationResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingSshVerifications = new Map<string, {
  executorId: string
  resolve: (value: SshVerificationResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTelemetryRequests = new Map<string, {
  executorId: string
  resolve: (value: import('@shared/types').ExecutorTelemetrySnapshot) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingDoctorRequests = new Map<string, {
  executorId: string
  resolve: (value: WorkerDoctorPayload) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingDirectoryBrowses = new Map<string, {
  executorId: string
  resolve: (value: ExecutorDirectoryBrowseResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingFileReads = new Map<string, {
  executorId: string
  resolve: (value: ExecutorFileReadResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingFileWrites = new Map<string, {
  executorId: string
  resolve: (value: ExecutorFileWriteResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingAgentWorkdirRequests = new Map<string, {
  executorId: string
  resolve: (value: ExecutorAgentWorkdirResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingAgentWorkdirDownloads = new Map<string, {
  executorId: string
  resolve: (value: ExecutorAgentWorkdirDownloadResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingAgentWorkdirReads = new Map<string, {
  executorId: string
  resolve: (value: ExecutorAgentWorkdirReadResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingAgentSessionLists = new Map<string, {
  executorId: string
  resolve: (value: ExecutorAgentSessionsResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingAgentSessionReads = new Map<string, {
  executorId: string
  resolve: (value: ExecutorAgentSessionReadResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingSkillScans = new Map<string, {
  executorId: string
  resolve: (value: ExecutorSkillScanResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingRepoBranches = new Map<string, {
  executorId: string
  resolve: (value: RepoBranchSnapshotResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitCheckouts = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitCheckoutResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitCommits = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitCommitResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitDiffs = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitDiffResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitWorkingTreeDiffs = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitWorkingTreeDiffResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitStatuses = new Map<string, {
  executorId: string
  resolve: (value: import('@shared/types').ExecutorGitStatusResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitFileDiffs = new Map<string, {
  executorId: string
  resolve: (value: import('@shared/types').ExecutorGitFileDiffResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitChanges = new Map<string, {
  executorId: string
  resolve: (value: import('@shared/types').ExecutorGitChangeActionResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitCommitDiffs = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitCommitDiffResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitBaselineSnapshots = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitBaselineSnapshotResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitBaselineDiffs = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitBaselineDiffResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitRebases = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitRebaseResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitGraphs = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitGraphResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitPushes = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitPushResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingGitPullRequests = new Map<string, {
  executorId: string
  resolve: (value: ExecutorGitPullRequestResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTerminalRequests = new Map<string, {
  command: string
  cwd?: string
  executorId: string
  mode: ExecutorTerminalRequestMode
  resolve: (value: ExecutorTerminalResult) => void
  reject: (reason?: unknown) => void
  startedAt: number
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingHttpProbes = new Map<string, {
  executorId: string
  resolve: (value: ExecutorHttpProbeResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingDesktopSandboxRequests = new Map<string, {
  executorId: string
  resolve: (value: WorkspaceDesktopSandboxResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingRemoteCodeRequests = new Map<string, {
  executorId: string
  resolve: (value: WorkspaceRemoteCodeResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTerminalSessionLists = new Map<string, {
  executorId: string
  resolve: (value: ExecutorTerminalSessionsResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTerminalSessionCreates = new Map<string, {
  executorId: string
  resolve: (value: ExecutorTerminalSessionCreateResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTerminalSessionAttaches = new Map<string, {
  executorId: string
  resolve: (value: ExecutorTerminalSessionAttachResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTerminalLocalAttachTickets = new Map<string, {
  executorId: string
  resolve: (value: ExecutorTerminalLocalAttachTicketResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingTerminalSessionCloses = new Map<string, {
  executorId: string
  resolve: (value: ExecutorTerminalSessionCloseResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const inflightTerminalSessionEnsures = new Map<string, Promise<WorkspaceTerminalSessionDescriptor>>()

export const pendingWorktreeEnsures = new Map<string, {
  executorId: string
  resolve: (value: ExecutorWorktreeResult) => void
  reject: (reason?: unknown) => void
  onOperationEvent?: (event: ExecutorWorkspaceOperationEvent) => void
  lastOperationEvent?: ExecutorWorkspaceOperationEvent
  timer: ReturnType<typeof setTimeout>
  dedupeKey: string
}>()

export const pendingWorktreeCleanups = new Map<string, {
  executorId: string
  resolve: (value: ExecutorWorktreeResult) => void
  reject: (reason?: unknown) => void
  onOperationEvent?: (event: ExecutorWorkspaceOperationEvent) => void
  timer: ReturnType<typeof setTimeout>
}>()

export const pendingAgentPrompts = new Map<string, {
  executorId: string
  resolve: (value: ExecutorAgentPromptResult) => void
  reject: (reason?: unknown) => void
  onEvent?: (event: ExecutorAgentPromptEvent) => void
  timer?: ReturnType<typeof setTimeout>
  cleanupAbortListener?: () => void
}>()

export const terminalBrowserClients = new Map<string, {
  executorId: string
  scope: WorkspaceTerminalSessionDescriptor['scope']
  terminalKey: string
  terminalId: string
  workspaceId?: string
  buffering: boolean
  bufferedMessages: Record<string, unknown>[]
  pendingCloseCode?: number
  pendingCloseReason?: string
  socket: BrowserTerminalSocket
}>()

export const terminalSessionsByKey = new Map<string, WorkspaceTerminalSessionDescriptor>()

export const terminalSessionClientsByKey = new Map<string, Set<string>>()

export const terminalSessionSnapshotsByKey = new Map<string, WorkspaceTerminalSessionSnapshot>()

export const buildTerminalSessionEnsureDedupeKey = (input: {
  executorId: string
  scope: WorkspaceTerminalSessionDescriptor['scope']
  workspaceId?: string
  terminalId: string
}) => buildWorkspaceTerminalSessionKey({
  scope: input.scope,
  executorId: input.executorId,
  workspaceId: input.workspaceId,
  terminalId: input.terminalId,
})

export const inflightWorktreeEnsures = new Map<string, Promise<ExecutorWorktreeResult>>()

export const buildWorktreeEnsureDedupeKey = (input: {
  executorId: string
  workspaceId?: string
  ownerUserId?: string
  repoPath?: string
  repoUrl?: string
  preferredBranch?: string
  startPointMode?: ExecutorWorktreeStartPointMode
  branchName: string
  worktreePath: string
  workingDirectoryMode?: string
}) => {
  return [
    input.executorId,
    input.ownerUserId?.trim() || '',
    input.workspaceId?.trim() || '',
    input.repoPath?.trim() || '',
    input.repoUrl?.trim() || '',
    input.preferredBranch?.trim() || '',
    input.startPointMode?.trim() || '',
    input.branchName,
    input.worktreePath,
    input.workingDirectoryMode?.trim() || '',
  ].join('::')
}

export const send = (socket: ExecutorSocket, message: ControlPlaneToExecutorMessage) => {
  socket.send(JSON.stringify(message))
}

export const sendExecutorLatencyProbe = (executorId: string, socket?: ExecutorSocket | null) => {
  const targetSocket = socket ?? executorRegistry.getSocket(executorId)
  if (!targetSocket || !isSocketOpen(targetSocket)) {
    return false
  }

  send(targetSocket, {
    type: 'executor.latency.ping',
    executorId,
    requestId: randomUUID(),
    sentAt: new Date().toISOString(),
  })
  return true
}

const TERMINAL_DEBUG_PREFIX = '[server][terminal]'
const TERMINAL_DEBUG_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  (getEnv('WEMUX_TERMINAL_DEBUG') ?? '').trim().toLowerCase(),
)

const previewValue = (value?: unknown) => {
  if (typeof value !== 'string') {
    return value
  }

  return value.trim().replace(/\s+/g, ' ').slice(0, 160)
}

export const logTerminalDebug = (message: string, payload?: Record<string, unknown>) => {
  if (!TERMINAL_DEBUG_ENABLED) {
    return
  }

  if (!payload) {
    console.info(`${TERMINAL_DEBUG_PREFIX} ${message}`)
    return
  }

  const normalizedPayload = Object.fromEntries(Object.entries(payload).map(([key, value]) => {
    if (key === 'command' || key === 'stdout' || key === 'stderr') {
      return [key, previewValue(value)]
    }

    return [key, value]
  }))
  console.info(`${TERMINAL_DEBUG_PREFIX} ${message}`, normalizedPayload)
}

export const logExecutorEvent = (input: {
  executorId: string
  eventType: 'task.assign' | 'task.ack' | 'task.event' | 'task.result' | 'heartbeat' | 'reconnect' | 'error'
  message: string
  payload?: Record<string, unknown>
  taskId?: string
  originTaskId?: string
  projectId?: string
  isFailure?: boolean
}) => {
  const executor = executorRegistry.getExecutor(input.executorId)
  createExecutionEvent({
    eventType: input.eventType,
    executorId: input.executorId,
    executorName: executor?.name,
    ownerUserId: executor?.ownerUserId,
    teamId: executor?.teamId,
    message: input.message,
    payload: input.payload,
    taskId: input.taskId,
    originTaskId: input.originTaskId,
    projectId: input.projectId,
    isFailure: input.isFailure,
  })
}

export const sendWithLogging = (executorId: string, socket: ExecutorSocket, message: ControlPlaneToExecutorMessage) => {
  send(socket, message)

  if (message.type !== 'task.assign') {
    return
  }

  logExecutorEvent({
    executorId,
    eventType: 'task.assign',
    message: '控制面已向执行器派发任务。',
    payload: {
      type: message.type,
      taskId: message.task.id,
      status: message.task.status,
      returnMode: message.task.returnMode,
    },
    taskId: message.task.id,
    originTaskId: message.task.originTaskId,
    projectId: message.task.projectId,
  })
}

export const validateMessageExecutor = (socketExecutorId: string, messageExecutorId?: string) => {
  if (!messageExecutorId || messageExecutorId === socketExecutorId) {
    return true
  }

  logExecutorEvent({
    executorId: socketExecutorId,
    eventType: 'error',
    message: '执行器消息中的 executorId 与当前连接不一致。',
    payload: {
      socketExecutorId,
      messageExecutorId,
    },
    isFailure: true,
  })
  return false
}
