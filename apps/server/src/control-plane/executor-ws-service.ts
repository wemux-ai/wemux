/**
 * [INPUT]: Authenticated executor WebSocket lifecycle events and executor protocol messages.
 * [OUTPUT]: Control-plane dispatch, request completion, and disconnect cleanup for executor operations.
 * [POS]: WebSocket orchestration boundary between executor routes and control-plane services.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type {
  ControlPlaneToExecutorMessage,
  ExecutorAgentPromptEvent,
  ExecutorAgentPromptResult,
  ExecutorDirectoryBrowseResult,
  ExecutorGitCommitDiffResult,
  ExecutorGitDiffResult,
  ExecutorGitGraphResult,
  ExecutorGitPullRequestResult,
  ExecutorGitPushResult,
  ExecutorGitRebaseResult,
  ExecutorSkillScanResult,
  ExecutorTerminalResult,
  ExecutorToControlPlaneMessage,
  ExecutorWorktreeResult,
  GitProvider,
  LocalPathProbeResult,
  PatVerificationResult,
  RepoBranchSnapshotResult,
  TaskRuntimeGitIdentity,
  WorkspaceTerminalSessionDescriptor,
  WorkspaceTerminalSessionScope,
} from '@shared/types'
import { buildWorkspaceTerminalSessionKey } from '@shared/types'
import { syncDistributedTaskEvent, syncDistributedTaskResult } from '../cluster/task-sync'
import { getDistributedTask, listExecutorDistributedTasks, updateDistributedTask } from '../storage/distributed-task-store'
import { loadState } from '../storage/app-state-store'
import {
  resolveTaskRuntimeCapabilitySnapshot,
  withoutRuntimeCapabilitySnapshotEnv,
} from '../services/custom-agent-runtime'
import { getPrimaryAgentMcpServers } from '../services/primary-agent-mcp'
import { resolveUserFeatureFlags } from '../services/user-experimental-settings-service'
import { resolveProjectRuntimeEnvironment, resolveWorkspaceRuntimeEnvironment } from '../services/runtime-environment-service'
import { getServerAgentSettings } from '../services/server-agent'
import { getUserExperimentalSettings } from '../services/user-experimental-settings-service'
import { resolveExecutorMeshEnrollment } from '../services/executor-mesh-service'
import { executorRegistry } from './executor-registry'
import { dispatchExecutorTaskMessage } from './executor-task-message'
import { reconcileControlPlaneTaskQueue } from './task-dispatch'
import { hydrateTaskGitIdentity } from './task-git-identity'
import { executorWsRequests } from './executor-ws-requests'
import { handleExecutorMessage, registerExecutorMessageHandlerListeners } from './executor-ws-message-handler'
import { clearPendingMainChatPrompt } from '../services/main-chat-prompt-recovery'
import { clearPendingWorkspacePrompt } from '../services/task-chat-dispatch/workspace-prompt-recovery'
import { buildWorktreeEnsureFailureMessage } from './worktree-ensure-failure-message'

import {
  buildTerminalSessionEnsureDedupeKey,
  buildWorktreeEnsureDedupeKey,
  inflightTerminalSessionEnsures,
  inflightWorktreeEnsures,
  isSocketOpen,
  logExecutorEvent,
  logTerminalDebug,
  pendingAgentPrompts,
  pendingAgentSessionLists,
  pendingAgentSessionReads,
  pendingAgentWorkdirDownloads,
  pendingAgentWorkdirReads,
  pendingAgentWorkdirRequests,
  pendingConfigExports,
  pendingDoctorRequests,
  pendingDirectoryBrowses,
  pendingDesktopSandboxRequests,
  pendingFileReads,
  pendingFileWrites,
  pendingGitCommits,
  pendingGitCheckouts,
  pendingGitBaselineDiffs,
  pendingGitBaselineSnapshots,
  pendingGitCommitDiffs,
  pendingGitDiffs,
  pendingGitGraphs,
  pendingGitPullRequests,
  pendingGitPushes,
  pendingGitRebases,
  pendingGitWorkingTreeDiffs,
  pendingHttpProbes,
  pendingPatVerifications,
  pendingSshVerifications,
  pendingRepoBranches,
  pendingRepoProbes,
  pendingRemoteCodeRequests,
  pendingSkillScans,
  pendingTerminalSessionAttaches,
  pendingTerminalSessionCloses,
  pendingTerminalSessionCreates,
  pendingTerminalSessionLists,
  pendingTerminalLocalAttachTickets,
  pendingTelemetryRequests,
  pendingTerminalRequests,
  pendingWorktreeCleanups,
  pendingWorktreeEnsures,
  send,
  sendExecutorLatencyProbe,
  sendWithLogging,
  terminalBrowserClients,
  terminalSessionClientsByKey,
  terminalSessionSnapshotsByKey,
  terminalSessionsByKey,
  validateMessageExecutor,
  type BrowserTerminalSocket,
  type ExecutorSocket,
} from './executor-ws-service-state'

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const registerTerminalBrowserClient = (params: {
  clientId: string
  executorId: string
  scope: WorkspaceTerminalSessionDescriptor['scope']
  terminalId: string
  terminalKey: string
  workspaceId?: string
  socket: BrowserTerminalSocket
}) => {
  terminalBrowserClients.set(params.clientId, {
    executorId: params.executorId,
    scope: params.scope,
    terminalKey: params.terminalKey,
    terminalId: params.terminalId,
    workspaceId: params.workspaceId,
    buffering: true,
    bufferedMessages: [],
    socket: params.socket,
  })

  const attachedClients = terminalSessionClientsByKey.get(params.terminalKey) ?? new Set<string>()
  attachedClients.add(params.clientId)
  terminalSessionClientsByKey.set(params.terminalKey, attachedClients)
}

const clearTerminalSessionCache = (terminalKey: string) => {
  terminalSessionsByKey.delete(terminalKey)
  terminalSessionSnapshotsByKey.delete(terminalKey)
  terminalSessionClientsByKey.delete(terminalKey)
}

const unregisterTerminalBrowserClient = (clientId: string) => {
  const client = terminalBrowserClients.get(clientId)
  if (!client) {
    return null
  }

  terminalBrowserClients.delete(clientId)
  const attachedClients = terminalSessionClientsByKey.get(client.terminalKey)
  if (attachedClients) {
    attachedClients.delete(clientId)
    if (attachedClients.size === 0) {
      terminalSessionClientsByKey.delete(client.terminalKey)
    }
  }

  return client
}

const sendTerminalBrowserPayload = (
  client: {
    socket: BrowserTerminalSocket
  },
  payload: Record<string, unknown>,
) => {
  if (!isSocketOpen(client.socket)) {
    return
  }

  client.socket.send(JSON.stringify(payload))
}

const flushTerminalBrowserClientInitialState = (params: {
  clientId: string
  session: WorkspaceTerminalSessionDescriptor
  snapshot?: import('@shared/types').WorkspaceTerminalSessionSnapshot
}) => {
  const client = terminalBrowserClients.get(params.clientId)
  if (!client) {
    return
  }
  if (!isSocketOpen(client.socket)) {
    unregisterTerminalBrowserClient(params.clientId)
    return
  }

  if (params.snapshot) {
    sendTerminalBrowserPayload(client, {
      type: 'snapshot',
      snapshot: params.snapshot,
      at: new Date().toISOString(),
    })
  }

  const hasBufferedTerminalEnd = client.bufferedMessages.some((message) => (
    message.type === 'exit'
    || message.type === 'unavailable'
  ))
  const hasBufferedReady = client.bufferedMessages.some((message) => message.type === 'ready')
  if (!hasBufferedTerminalEnd) {
    if (params.session.exitedAt) {
      sendTerminalBrowserPayload(client, {
        type: 'exit',
        terminalId: params.session.terminalId,
        terminalKey: params.session.terminalKey,
        exitCode: params.session.exitCode ?? 0,
        at: params.session.exitedAt,
      })
    } else if (!hasBufferedReady) {
      sendTerminalBrowserPayload(client, {
        type: 'ready',
        terminalId: params.session.terminalId,
        terminalKey: params.session.terminalKey,
        clientId: params.clientId,
        cwd: params.session.cwd,
        mode: params.session.mode,
        at: new Date().toISOString(),
      })
    }
  }

  for (const payload of client.bufferedMessages) {
    sendTerminalBrowserPayload(client, payload)
  }

  client.bufferedMessages = []
  client.buffering = false

  if (client.pendingCloseReason && isSocketOpen(client.socket)) {
    const reason = client.pendingCloseReason
    const closeCode = client.pendingCloseCode ?? 1000
    unregisterTerminalBrowserClient(params.clientId)
    client.socket.close(closeCode, reason)
  }
}

export const executorWsService = {
  async onOpen(executorId: string, socket: ExecutorSocket) {
    registerExecutorMessageHandlerListeners()
    const previousSocket = executorRegistry.getRegisteredSocket(executorId)
    if (previousSocket && previousSocket !== socket) {
      executorWsService.onClose(executorId, previousSocket, { replacement: true })
    }
    const previous = executorRegistry.getExecutor(executorId)
    await executorRegistry.registerSocket(executorId, socket)
    const state = loadState()
    const executor = executorRegistry.getExecutor(executorId)
    send(socket, {
      type: 'control-plane.ready',
      executorId,
      heartbeatIntervalMs: 15000,
      now: new Date().toISOString(),
      opencodeConfigContent: state.config.opencodeConfigContent,
      codexConfigContent: state.config.codexConfigContent,
      codexAuthContent: state.config.codexAuthContent,
      claudeCodeConfigContent: state.config.claudeCodeConfigContent,
      claudeCodeCredentialsContent: state.config.claudeCodeCredentialsContent,
      defaultModel: state.config.defaultModel,
      agentSettings: state.config.agentSettings,
      workerUpdateSettings: state.config.workerUpdateSettings,
      mcpServers: getPrimaryAgentMcpServers(state.config, executor?.ownerUserId),
      maxConcurrency: executor?.maxConcurrency,
      previewExposureMode: executor?.previewExposureMode,
      previewIngressPort: executor?.previewIngressPort,
      previewProxySecret: executor ? executorRegistry.getPreviewProxySecret(executor.executorId) : undefined,
      meshEnrollment: resolveExecutorMeshEnrollment(executor),
      featureFlags: resolveUserFeatureFlags(executor?.ownerUserId),
    })
    sendExecutorLatencyProbe(executorId, socket)

    if (previous?.status === 'offline') {
      logExecutorEvent({
        executorId,
        eventType: 'reconnect',
        message: '执行器已重新连回控制面。',
        payload: {
          previousStatus: previous.status,
        },
      })
    }

    for (const task of listExecutorDistributedTasks(executorId).filter((item) => item.status === 'assigned')) {
      const capabilitySnapshot = resolveTaskRuntimeCapabilitySnapshot({
        projectId: task.projectId,
        workspaceId: task.workspaceId,
        userId: task.requestedByUserId,
        runtimeEnv: task.runtimeEnv,
        runtimeSkillPackages: task.runtimeSkillPackages,
        mcpServers: task.mcpServers ?? task.opencodeConfig?.mcpServers ?? getPrimaryAgentMcpServers(state.config, task.requestedByUserId),
        opencodeConfig: task.opencodeConfig,
      })
      const preparedTask = {
        ...task,
        mcpServers: capabilitySnapshot.mcpServers,
        opencodeConfig: capabilitySnapshot.opencodeConfig,
        runtimeEnv: capabilitySnapshot.runtimeEnv,
        runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
      }
      if (
        !sameJson(task.mcpServers, preparedTask.mcpServers)
        || !sameJson(task.opencodeConfig, preparedTask.opencodeConfig)
        || !sameJson(task.runtimeEnv, preparedTask.runtimeEnv)
        || !sameJson(task.runtimeSkillPackages, preparedTask.runtimeSkillPackages)
      ) {
        updateDistributedTask(preparedTask)
      }
      const gitIdentity = await hydrateTaskGitIdentity({
        userId: preparedTask.requestedByUserId,
        projectId: preparedTask.projectId,
        mode: preparedTask.gitIdentityMode,
        repoUrl: preparedTask.repoUrl,
        identity: preparedTask.gitIdentity,
      }).catch(() => undefined)
      const runtimeEnvironment = preparedTask.workspaceId
        ? await resolveWorkspaceRuntimeEnvironment(preparedTask.workspaceId).then((result) => result?.payload).catch(() => undefined)
        : await resolveProjectRuntimeEnvironment(preparedTask.projectId).then((result) => result?.payload).catch(() => undefined)
      sendWithLogging(executorId, socket, {
        type: 'task.assign',
        task: {
          ...preparedTask,
          agentSettings: preparedTask.agentSettings ?? getServerAgentSettings(state.config, preparedTask.agentType),
          gitIdentity,
          mcpServers: capabilitySnapshot.mcpServers,
          runtimeEnv: withoutRuntimeCapabilitySnapshotEnv(preparedTask.runtimeEnv),
          runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
        },
        runtimeEnvironment,
        featureFlags: resolveUserFeatureFlags(preparedTask.requestedByUserId),
      })
    }

    void reconcileControlPlaneTaskQueue()
  },

  onClose(executorId: string, socket: ExecutorSocket, options: { replacement?: boolean } = {}) {
    if (!options.replacement && !executorRegistry.shouldHandleSocketClose(socket)) {
      return
    }
    if (!options.replacement) {
      void executorRegistry.unregisterSocket(executorId, socket)
    }
    for (const [requestId, pending] of pendingConfigExports.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingConfigExports.delete(requestId)
    }
    for (const [requestId, pending] of pendingRepoProbes.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingRepoProbes.delete(requestId)
    }
    for (const [requestId, pending] of pendingPatVerifications.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingPatVerifications.delete(requestId)
    }
    for (const [requestId, pending] of pendingSshVerifications.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingSshVerifications.delete(requestId)
    }
    for (const [requestId, pending] of pendingTelemetryRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTelemetryRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingDoctorRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingDoctorRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingDirectoryBrowses.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingDirectoryBrowses.delete(requestId)
    }
    for (const [requestId, pending] of pendingFileReads.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingFileReads.delete(requestId)
    }
    for (const [requestId, pending] of pendingFileWrites.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingFileWrites.delete(requestId)
    }
    for (const [requestId, pending] of pendingAgentWorkdirRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingAgentWorkdirRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingAgentWorkdirDownloads.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingAgentWorkdirDownloads.delete(requestId)
    }
    for (const [requestId, pending] of pendingAgentWorkdirReads.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingAgentWorkdirReads.delete(requestId)
    }
    for (const [requestId, pending] of pendingAgentSessionLists.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingAgentSessionLists.delete(requestId)
    }
    for (const [requestId, pending] of pendingAgentSessionReads.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingAgentSessionReads.delete(requestId)
    }
    for (const [requestId, pending] of pendingSkillScans.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingSkillScans.delete(requestId)
    }
    for (const [requestId, pending] of pendingRepoBranches.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingRepoBranches.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitCheckouts.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitCheckouts.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitCommits.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitCommits.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitDiffs.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitDiffs.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitWorkingTreeDiffs.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitWorkingTreeDiffs.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitCommitDiffs.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitCommitDiffs.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitBaselineSnapshots.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitBaselineSnapshots.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitBaselineDiffs.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitBaselineDiffs.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitRebases.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitRebases.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitGraphs.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitGraphs.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitPushes.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitPushes.delete(requestId)
    }
    for (const [requestId, pending] of pendingGitPullRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingGitPullRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingTerminalRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTerminalRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingHttpProbes.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingHttpProbes.delete(requestId)
    }
    for (const [requestId, pending] of pendingDesktopSandboxRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingDesktopSandboxRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingRemoteCodeRequests.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingRemoteCodeRequests.delete(requestId)
    }
    for (const [requestId, pending] of pendingTerminalSessionLists.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTerminalSessionLists.delete(requestId)
    }
    for (const [requestId, pending] of pendingTerminalSessionCreates.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTerminalSessionCreates.delete(requestId)
    }
    for (const [requestId, pending] of pendingTerminalSessionAttaches.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTerminalSessionAttaches.delete(requestId)
    }
    for (const [requestId, pending] of pendingTerminalLocalAttachTickets.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTerminalLocalAttachTickets.delete(requestId)
    }
    for (const [requestId, pending] of pendingTerminalSessionCloses.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingTerminalSessionCloses.delete(requestId)
    }
    for (const [requestId, pending] of pendingWorktreeEnsures.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error(buildWorktreeEnsureFailureMessage(
        '执行器已断开连接。',
        pending.lastOperationEvent,
      )))
      inflightWorktreeEnsures.delete(pending.dedupeKey)
      pendingWorktreeEnsures.delete(requestId)
    }
    for (const [requestId, pending] of pendingWorktreeCleanups.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.reject(new Error('执行器已断开连接。'))
      pendingWorktreeCleanups.delete(requestId)
    }
    for (const [requestId, pending] of pendingAgentPrompts.entries()) {
      if (pending.executorId !== executorId) continue
      clearTimeout(pending.timer)
      pending.cleanupAbortListener?.()
      pendingAgentPrompts.delete(requestId)
      void clearPendingWorkspacePrompt(requestId)
      void clearPendingMainChatPrompt(requestId)
      const error = new Error('执行器已断开连接，本次回复已中止。')
      error.name = 'AbortError'
      ;(error as Error & { abortReason?: string }).abortReason = 'executor_disconnected'
      pending.reject(error)
    }
    for (const [clientId, client] of terminalBrowserClients.entries()) {
      if (client.executorId !== executorId) continue
      try {
        client.socket.close(1011, 'executor offline')
      } catch {
        // ignore
      }
      unregisterTerminalBrowserClient(clientId)
    }
    for (const [terminalKey, session] of terminalSessionsByKey.entries()) {
      if (session.executorId !== executorId) {
        continue
      }
      terminalSessionsByKey.delete(terminalKey)
      terminalSessionClientsByKey.delete(terminalKey)
      terminalSessionSnapshotsByKey.delete(terminalKey)
    }
    if (!options.replacement) {
      void reconcileControlPlaneTaskQueue()
    }
  },

  handleMessage(executorId: string, raw: string) {
    handleExecutorMessage(executorId, raw)
  },

  dispatchTask(executorId: string, message: ControlPlaneToExecutorMessage) {
    return dispatchExecutorTaskMessage(executorId, message)
  },

  ...executorWsRequests,

  async ensureTerminalSession(params: {
    executorId: string
    scope: WorkspaceTerminalSessionScope
    terminalId: string
    workspaceId?: string
    cwd?: string
    title?: string
    ownerUserId?: string
    cols?: number
    rows?: number
    runtimeEnvironment?: import('@shared/runtime-environment').RuntimeEnvironmentExecutionPayload
    forceRefresh?: boolean
  }) {
    const executorSocket = executorRegistry.getSocket(params.executorId)
    if (!executorSocket || !isSocketOpen(executorSocket)) {
      throw new Error('执行器当前未在线，无法建立终端会话。')
    }

    const terminalKey = buildWorkspaceTerminalSessionKey({
      scope: params.scope,
      executorId: params.executorId,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })

    const existing = terminalSessionsByKey.get(terminalKey)
    if (existing && !params.forceRefresh) {
      return existing
    }

    if (params.forceRefresh) {
      clearTerminalSessionCache(terminalKey)
    }

    const dedupeKey = buildTerminalSessionEnsureDedupeKey({
      executorId: params.executorId,
      scope: params.scope,
      workspaceId: params.workspaceId,
      terminalId: params.terminalId,
    })
    const inflight = inflightTerminalSessionEnsures.get(dedupeKey)
    if (inflight) {
      return inflight
    }

    const pendingEnsure = executorWsRequests.requestTerminalSessionCreate(params.executorId, {
      terminalId: params.terminalId,
      scope: params.scope,
      workspaceId: params.workspaceId,
      cwd: params.cwd,
      title: params.title,
      ownerUserId: params.ownerUserId,
      cols: params.cols,
      rows: params.rows,
      runtimeEnvironment: params.runtimeEnvironment,
    }).then((result) => {
      if (!result.ok || !result.session) {
        throw new Error(result.message || '终端会话创建失败。')
      }

      terminalSessionsByKey.set(result.session.terminalKey, result.session)
      return result.session
    }).finally(() => {
      inflightTerminalSessionEnsures.delete(dedupeKey)
    })

    inflightTerminalSessionEnsures.set(dedupeKey, pendingEnsure)
    return pendingEnsure
  },

  async attachTerminalSession(params: {
    executorId: string
    socket: BrowserTerminalSocket
    clientId: string
    scope: WorkspaceTerminalSessionScope
    terminalId: string
    workspaceId?: string
    cwd?: string
    title?: string
    ownerUserId?: string
    cols?: number
    rows?: number
    runtimeEnvironment?: import('@shared/runtime-environment').RuntimeEnvironmentExecutionPayload
  }) {
    const attachWithSession = async (forceRefresh = false) => {
      const session = await this.ensureTerminalSession({
        executorId: params.executorId,
        scope: params.scope,
        terminalId: params.terminalId,
        workspaceId: params.workspaceId,
        cwd: params.cwd,
        title: params.title,
        ownerUserId: params.ownerUserId,
        cols: params.cols,
        rows: params.rows,
        runtimeEnvironment: params.runtimeEnvironment,
        forceRefresh,
      })

      registerTerminalBrowserClient({
        clientId: params.clientId,
        executorId: params.executorId,
        scope: session.scope,
        terminalId: session.terminalId,
        terminalKey: session.terminalKey,
        workspaceId: session.workspaceId,
        socket: params.socket,
      })

      try {
        const attachResult = await executorWsRequests.requestTerminalSessionAttach(params.executorId, {
          clientId: params.clientId,
          terminalId: session.terminalId,
          scope: params.scope,
          workspaceId: params.workspaceId,
        })

        if (!attachResult.ok || !attachResult.session) {
          throw new Error(attachResult.message || '终端会话附着失败。')
        }

        terminalSessionsByKey.set(attachResult.session.terminalKey, attachResult.session)
        if (attachResult.snapshot) {
          terminalSessionSnapshotsByKey.set(attachResult.session.terminalKey, attachResult.snapshot)
        }
        flushTerminalBrowserClientInitialState({
          clientId: params.clientId,
          session: attachResult.session,
          snapshot: attachResult.snapshot,
        })
        return attachResult
      } catch (error) {
        unregisterTerminalBrowserClient(params.clientId)
        if (forceRefresh) {
          throw error
        }
        if (error instanceof Error && error.message === '终端会话不存在。') {
          clearTerminalSessionCache(session.terminalKey)
          return attachWithSession(true)
        }
        throw error
      }
    }

    return attachWithSession()
  },

  detachTerminalSession(clientId: string) {
    const client = unregisterTerminalBrowserClient(clientId)
    if (!client) {
      return
    }

    executorWsRequests.notifyTerminalSessionDetach(client.executorId, {
      clientId,
      terminalId: client.terminalId,
      scope: client.scope,
      workspaceId: client.workspaceId,
    })
  },

  sendTerminalSessionInput(clientId: string, input: string) {
    const client = terminalBrowserClients.get(clientId)
    if (!client) {
      throw new Error('终端会话不存在。')
    }
    const executorSocket = executorRegistry.getSocket(client.executorId)
    if (!executorSocket || !isSocketOpen(executorSocket)) {
      throw new Error('执行器当前未在线。')
    }
    logTerminalDebug('forwarding terminal input', {
      executorId: client.executorId,
      terminalId: client.terminalId,
      inputLength: input.length,
      preview: input.slice(0, 80),
    })
    send(executorSocket, {
      type: 'executor.terminal.session.input',
      terminalId: client.terminalId,
      scope: client.scope,
      workspaceId: client.workspaceId,
      input,
    })
  },

  resizeTerminalSession(clientId: string, cols: number, rows: number) {
    const client = terminalBrowserClients.get(clientId)
    if (!client) return
    const executorSocket = executorRegistry.getSocket(client.executorId)
    if (!executorSocket || !isSocketOpen(executorSocket)) return
    logTerminalDebug('forwarding terminal resize', {
      executorId: client.executorId,
      terminalId: client.terminalId,
      cols,
      rows,
    })
    send(executorSocket, {
      type: 'executor.terminal.session.resize',
      terminalId: client.terminalId,
      scope: client.scope,
      workspaceId: client.workspaceId,
      cols,
      rows,
    })
  },

  async closeTerminalSession(params: {
    executorId: string
    scope: WorkspaceTerminalSessionScope
    terminalId: string
    workspaceId?: string
  }) {
    return executorWsRequests.requestTerminalSessionClose(params.executorId, {
      terminalId: params.terminalId,
      scope: params.scope,
      workspaceId: params.workspaceId,
    })
  },
}
