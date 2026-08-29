// [INPUT]: executor WS 入站消息（register/heartbeat/ack/event/result/response）
// [OUTPUT]: 消息分发处理与状态更新
// [POS]: executor WS 入站消息处理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { DistributedTask, ExecutorToControlPlaneMessage, WorkspaceTerminalSessionDescriptor } from '@shared/types'
import type { ExecutorAgentPromptAbortReason } from '@shared/types'
import { createWorkspaceEnvironmentStatusSnapshot, resolveWorkspaceEnvironmentStatusFromProbe } from '@shared/task-environment'
import { mergeWorkspaceSession, resolveWorkspaceSessionExecutorId, resolveWorkspaceWorkerId } from '@shared/task-workspace'
import { isWorkspaceRuntimeSnapshotFresh } from '@shared/workspace-runtime'
import { canAcceptWorkerTaskResult, isNewerWorkerTaskEvent, syncDistributedTaskEvent, syncDistributedTaskResult } from '../cluster/task-sync'
import { getWorkspaceSessionById, loadState, saveWorkspaceSession } from '../storage/app-state-store'
import { getDistributedTask, listWorkspaces, updateDistributedTask } from '../storage/distributed-task-store'
import {
  TASK_WORKSPACE_RUNTIME_HEARTBEAT_TIMEOUT_MS,
  hasActiveDistributedTaskRuntime,
  isWorkspaceSessionRuntimeTerminal,
  toAgentRunningStatusFromRuntimeStatus,
} from '../services/task-workspace-runtime-state'
import { publishTaskChatSessionUpdate } from '../services/task-chat-dispatch/runtime-state'
import { recoverPendingWorkspacePromptResponse } from '../services/task-chat-dispatch/workspace-prompt-recovery'
import { recoverPendingMainChatPromptResponse } from '../services/main-chat-prompt-recovery'
import { probeExecutorPreviewIngress } from '../services/preview-public-proxy'
import { previewSessionService } from '../services/preview-session-service'
import { executorRegistry } from './executor-registry'
import { executorWsRequests } from './executor-ws-requests'
import {
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
  pendingDesktopSandboxRequests,
  pendingRemoteCodeRequests,
  pendingConfigExports,
  pendingCodexOauthRequests,
  pendingDoctorRequests,
  pendingDirectoryBrowses,
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
  pendingGitStatuses,
  pendingGitFileDiffs,
  pendingGitChanges,
  pendingHttpProbes,
  pendingPatVerifications,
  pendingSshVerifications,
  pendingRepoBranches,
  pendingRepoProbes,
  pendingSkillScans,
  pendingTerminalLocalAttachTickets,
  pendingTerminalSessionAttaches,
  pendingTerminalSessionCloses,
  pendingTerminalSessionCreates,
  pendingTerminalSessionLists,
  pendingTelemetryRequests,
  pendingTerminalRequests,
  pendingWorktreeCleanups,
  pendingWorktreeEnsures,
  sendExecutorLatencyProbe,
  terminalBrowserClients,
  terminalSessionClientsByKey,
  terminalSessionSnapshotsByKey,
  terminalSessionsByKey,
  validateMessageExecutor,
} from './executor-ws-service-state'

const reconcileControlPlaneTaskQueue = () => import('./task-dispatch')
  .then(({ reconcileControlPlaneTaskQueue: reconcile }) => reconcile())
import { syncExecutorWorkspaceTerminalRuntimeSummaries } from './executor-terminal-runtime'

const EXECUTOR_SESSION_QUEUE_WAIT_MESSAGE = '执行节点执行队列已满，当前会话正在排队，等待空闲槽位后自动开始。'
const EXECUTOR_SESSION_RESUME_MESSAGE = '执行节点已接手当前会话，正在启动。'
const ENVIRONMENT_RUNTIME_PROBE_REFRESH_MS = 30_000
const environmentProbeInFlightBySessionId = new Map<string, Promise<void>>()
const TERMINAL_DISTRIBUTED_TASK_STATUSES = new Set<DistributedTask['status']>([
  'completed',
  'cancelled',
  'failed',
  'timed_out',
])
const TERMINAL_SNAPSHOT_CHUNK_LIMIT = 4000
const previewIngressProbeInFlightByExecutorId = new Map<string, Promise<void>>()

// 纯心跳场景下 workspace session 展示字段（lastHeartbeatAt/updatedAt 等）
// 的落库节流：状态未变化时 10s 写一次即可，避免每次心跳都触发写库。
// 心跳 5s 一次，10s 落库让 web 端拿到的 lastHeartbeatAt 足够新鲜，
// 配合 web 端心跳新鲜度判定在 worker 假死时及时显示异常。
const WORKSPACE_SESSION_HEARTBEAT_PERSIST_THROTTLE_MS = 10_000
const lastWorkspaceSessionHeartbeatPersistAt = new Map<string, number>()

const refreshExecutorPreviewIngressHealth = (executorId: string) => {
  const executor = executorRegistry.getExecutor(executorId)
  if (!executor || executor.previewExposureMode !== 'public-ingress' || !executor.previewIngressBaseUrl?.trim()) {
    return
  }

  if (previewIngressProbeInFlightByExecutorId.has(executorId)) {
    return
  }

  const request = probeExecutorPreviewIngress(executorId)
    .then((probe) => {
      executorRegistry.upsertExecutor(executorId, {
        previewIngressReachable: probe.reachable,
        previewIngressLastCheckedAt: probe.checkedAt,
        previewIngressLastError: probe.error || undefined,
      })
    })
    .catch((error) => {
      executorRegistry.upsertExecutor(executorId, {
        previewIngressReachable: false,
        previewIngressLastCheckedAt: new Date().toISOString(),
        previewIngressLastError: error instanceof Error ? error.message : 'preview ingress health check failed',
      })
    })
    .finally(() => {
      previewIngressProbeInFlightByExecutorId.delete(executorId)
    })

  previewIngressProbeInFlightByExecutorId.set(executorId, request)
}

const fanoutTerminalMessage = (terminalKey: string, executorId: string, payload: Record<string, unknown>) => {
  const clientIds = terminalSessionClientsByKey.get(terminalKey)
  if (!clientIds || clientIds.size === 0) {
    return
  }

  for (const clientId of clientIds) {
    const client = terminalBrowserClients.get(clientId)
    if (!client || client.executorId !== executorId || !isSocketOpen(client.socket)) {
      continue
    }
    if (client.buffering) {
      client.bufferedMessages.push(payload)
      continue
    }
    client.socket.send(JSON.stringify(payload))
  }
}

const closeTerminalBrowserClients = (
  terminalKey: string,
  executorId: string,
  payload?: Record<string, unknown>,
  reason = 'terminal closed',
) => {
  const clientIds = terminalSessionClientsByKey.get(terminalKey)
  if (!clientIds || clientIds.size === 0) {
    terminalSessionClientsByKey.delete(terminalKey)
    return
  }

  for (const clientId of [...clientIds]) {
    const client = terminalBrowserClients.get(clientId)
    if (!client || client.executorId !== executorId) {
      terminalBrowserClients.delete(clientId)
      clientIds.delete(clientId)
      continue
    }
    if (client.buffering) {
      if (payload) {
        client.bufferedMessages.push(payload)
      }
      client.pendingCloseCode = 1000
      client.pendingCloseReason = reason
      continue
    }
    if (payload && isSocketOpen(client.socket)) {
      client.socket.send(JSON.stringify(payload))
    }
    terminalBrowserClients.delete(clientId)
    clientIds.delete(clientId)
    if (isSocketOpen(client.socket)) {
      client.socket.close(1000, reason)
    }
  }
  terminalSessionClientsByKey.delete(terminalKey)
}

const reconcileExecutorTerminalSessionsFromFullSnapshot = (
  executorId: string,
  sessions: import('@shared/types').WorkspaceTerminalSessionDescriptor[],
) => {
  const reportedKeys = new Set(sessions.map((session) => session.terminalKey))

  for (const [terminalKey, session] of terminalSessionsByKey.entries()) {
    if (session.executorId !== executorId || reportedKeys.has(terminalKey)) {
      continue
    }

    closeTerminalBrowserClients(terminalKey, executorId, {
      type: 'unavailable',
      terminalId: session.terminalId,
      terminalKey,
      message: '终端暂时不可用，可能是 worker 重连后未恢复该会话。',
      at: session.exitedAt ?? new Date().toISOString(),
    }, 'terminal unavailable')
    terminalSessionsByKey.delete(terminalKey)
    terminalSessionSnapshotsByKey.delete(terminalKey)
    terminalSessionClientsByKey.delete(terminalKey)
  }

  for (const session of sessions) {
    terminalSessionsByKey.set(session.terminalKey, session)
  }
}

const mergeReportedTerminalSessions = (sessions: import('@shared/types').WorkspaceTerminalSessionDescriptor[]) => {
  for (const session of sessions) {
    terminalSessionsByKey.set(session.terminalKey, session)
  }
}

const refreshExecutorWorkspaceEnvironmentRuntimeSummaries = (executorId: string) => {
  const workspaceExecutorById = new Map(listWorkspaces().map((workspace) => [workspace.id, resolveWorkspaceWorkerId(workspace)] as const))
  const state = loadState()

  for (const session of state.workspaceSessions) {
    const workspaceExecutorId = workspaceExecutorById.get(session.workspaceId)
    const environment = session.runtimeSummary?.environment
    const environmentUrl = environment?.url?.trim()
    if (
      session.status !== 'active'
      || workspaceExecutorId !== executorId
      || !environmentUrl
      || isWorkspaceRuntimeSnapshotFresh(environment?.checkedAt, Date.now(), ENVIRONMENT_RUNTIME_PROBE_REFRESH_MS)
      || environmentProbeInFlightBySessionId.has(session.id)
    ) {
      continue
    }

    const request = executorWsRequests.requestHttpProbe(executorId, environmentUrl, { timeoutMs: 5_000 })
      .then((probe) => {
        const currentSession = getWorkspaceSessionById(session.id)
        if (!currentSession || currentSession.runtimeSummary?.environment?.url?.trim() !== environmentUrl) {
          return
        }

        saveWorkspaceSession({
          ...currentSession,
          runtimeSummary: {
            ...currentSession.runtimeSummary,
            environment: {
              ...resolveWorkspaceEnvironmentStatusFromProbe({
                probe,
                url: environmentUrl,
              }),
              source: 'worker-probe',
              workspaceSessionId: currentSession.id,
              reportedByExecutorId: executorId,
            },
          },
        })
      })
      .catch((error) => {
        const currentSession = getWorkspaceSessionById(session.id)
        if (!currentSession || currentSession.runtimeSummary?.environment?.url?.trim() !== environmentUrl) {
          return
        }

        saveWorkspaceSession({
          ...currentSession,
          runtimeSummary: {
            ...currentSession.runtimeSummary,
            environment: {
              ...createWorkspaceEnvironmentStatusSnapshot({
                status: 'unreachable',
                message: error instanceof Error ? `环境地址暂时不可达：${error.message}` : '环境地址暂时不可达。',
                url: environmentUrl,
              }),
              source: 'worker-probe',
              workspaceSessionId: currentSession.id,
              reportedByExecutorId: executorId,
            },
          },
        })
      })
      .finally(() => {
        environmentProbeInFlightBySessionId.delete(session.id)
      })

    environmentProbeInFlightBySessionId.set(session.id, request)
  }
}

const reconcileExecutorReportedTasks = (executorId: string, runningTaskIds: string[], queuedTaskIds: string[], at: string) => {
  const runningTaskIdSet = new Set(runningTaskIds)
  const queuedTaskIdSet = new Set(queuedTaskIds)
  const reportedTaskIds = new Set([...runningTaskIds, ...queuedTaskIds])

  for (const taskId of reportedTaskIds) {
    const task = getDistributedTask(taskId)
    if (!task || task.executorNodeId !== executorId || TERMINAL_DISTRIBUTED_TASK_STATUSES.has(task.status)) {
      continue
    }

    if (runningTaskIdSet.has(taskId) && task.status !== 'executing' && task.status !== 'syncing_back') {
      syncDistributedTaskEvent({
        taskId,
        status: 'executing',
        message: task.status === 'lost'
          ? '执行器已重新连回控制面，任务仍在运行。'
          : '执行器确认任务正在运行。',
        at,
      })
      continue
    }

    if (queuedTaskIdSet.has(taskId) && (task.status === 'queued' || task.status === 'lost')) {
      syncDistributedTaskEvent({
        taskId,
        status: 'assigned',
        message: task.status === 'lost'
          ? '执行器已重新连回控制面，任务仍在本地队列等待执行。'
          : '执行器确认任务仍在本地队列等待执行。',
        at,
      })
    }
  }
}

const syncExecutorWorkspaceSessionHeartbeats = (executorId: string, runningTaskIds: string[], queuedTaskIds: string[], at: string) => {
  const state = loadState()
  const runningTaskIdSet = new Set(runningTaskIds)
  const queuedTaskIdSet = new Set(queuedTaskIds)

  for (const session of state.workspaceSessions) {
    if (session.runtimeOwnerExecutorId !== executorId || !session.distributedTaskId) {
      continue
    }

    if (isWorkspaceSessionRuntimeTerminal(session.runtimeStatus)) {
      // 会话已终止：清理心跳节流状态，避免 Map 残留。
      lastWorkspaceSessionHeartbeatPersistAt.delete(session.id)
      continue
    }

    const binding = state.taskWorkspaceBindings.find((item) => (
      item.workspaceId === session.workspaceId && item.status === 'active'
    ))
    const task = binding ? state.tasks.find((item) => item.id === binding.taskId) : undefined
    if (!task) {
      continue
    }

    const distributedTask = getDistributedTask(session.distributedTaskId)
    if (!distributedTask || distributedTask.workspaceSessionId !== session.id) {
      continue
    }

    const isReportedRunning = runningTaskIdSet.has(distributedTask.id)
    const isReportedQueued = queuedTaskIdSet.has(distributedTask.id)
    const wasActivelyRunning = session.runtimeStatus === 'running' || session.runtimeStatus === 'waiting'
    // 任务消失检测：任务已派发给 worker（assigned/preparing/executing/syncing_back）但不再被上报，
    // 且会话仍标着运行中 → 任务被 worker 侧终止但未返回结果（异常 kill / 进程丢失）。
    // 立即标记 lost 并推送，而不是保持「运行中」直到假死超时。
    // 未派发（queued/draft）或已终态的任务不在上报列表是正常的，不触发。
    const nextRuntimeStatus = isReportedRunning
      ? session.needsHumanConfirm ? 'waiting' : 'running'
      : isReportedQueued
        ? 'queued'
        : wasActivelyRunning && hasActiveDistributedTaskRuntime(distributedTask)
          ? 'lost'
          : session.runtimeStatus
    const nextCurrentStep = isReportedQueued
      ? EXECUTOR_SESSION_QUEUE_WAIT_MESSAGE
      : isReportedRunning && session.currentStep === EXECUTOR_SESSION_QUEUE_WAIT_MESSAGE
        ? EXECUTOR_SESSION_RESUME_MESSAGE
        : nextRuntimeStatus === 'lost'
          ? '执行节点已停止该任务但未返回结果，会话状态已标记为异常。'
          : session.currentStep
    const shouldPublishSessionUpdate = nextRuntimeStatus !== session.runtimeStatus
      || nextCurrentStep !== session.currentStep

    if (!shouldPublishSessionUpdate) {
      // 纯心跳（runtimeStatus / currentStep 均未变化）：只低频刷新展示字段，
      // 避免每次心跳都 saveWorkspaceSession → 写库 + storage_change 全量刷新
      // （workspace_sessions 每 ~5s 一次 UPDATE 的来源）。
      const lastPersistAt = lastWorkspaceSessionHeartbeatPersistAt.get(session.id) ?? 0
      if (Date.now() - lastPersistAt < WORKSPACE_SESSION_HEARTBEAT_PERSIST_THROTTLE_MS) {
        continue
      }
      lastWorkspaceSessionHeartbeatPersistAt.set(session.id, Date.now())
    }

    const nextSession = mergeWorkspaceSession(task, session, {
      runtimeStatus: nextRuntimeStatus,
      lastHeartbeatAt: isReportedRunning ? at : session.lastHeartbeatAt,
      lastRuntimeEventAt: at,
      runtimeSequence: session.runtimeSequence + 1,
      agentRunningStatus: toAgentRunningStatusFromRuntimeStatus(nextRuntimeStatus),
      currentStep: nextCurrentStep,
      updatedAt: at,
      lastActiveAt: at,
    })
    saveWorkspaceSession(nextSession)

    if (shouldPublishSessionUpdate) {
      const project = state.projects.find((item) => item.id === task.projectId)
      if (project) {
        publishTaskChatSessionUpdate(task.id, nextSession.workspaceId, nextSession.id, task, project)
      }
    }
  }
}

const reconcileLostWorkspaceSessionsForExecutor = (executorId: string, reason: string) => {
  const state = loadState()
  const updatedAt = new Date().toISOString()
  for (const session of state.workspaceSessions) {
    if (session.runtimeOwnerExecutorId !== executorId || (session.runtimeStatus !== 'running' && session.runtimeStatus !== 'waiting')) {
      continue
    }

    const binding = state.taskWorkspaceBindings.find((item) => (
      item.workspaceId === session.workspaceId && item.status === 'active'
    ))
    const task = binding ? state.tasks.find((item) => item.id === binding.taskId) : undefined
    if (!task) {
      continue
    }

    const nextSession = mergeWorkspaceSession(task, session, {
      runtimeStatus: 'lost',
      terminalReason: reason,
      lastRuntimeEventAt: updatedAt,
      runtimeSequence: session.runtimeSequence + 1,
      agentRunningStatus: 'error',
      currentStep: '执行器已离线，会话状态已标记为异常。',
      needsHumanConfirm: false,
      updatedAt,
      lastActiveAt: updatedAt,
    })
    saveWorkspaceSession(nextSession)

    const project = state.projects.find((item) => item.id === task.projectId)
    if (project) {
      publishTaskChatSessionUpdate(task.id, nextSession.workspaceId, nextSession.id, task, project)
    }
  }
}

let executorOfflineListenerRegistered = false

export const registerExecutorMessageHandlerListeners = () => {
  if (executorOfflineListenerRegistered) {
    return
  }
  executorOfflineListenerRegistered = true

  executorRegistry.onExecutorOffline((executorId, reason) => {
    const timeoutSeconds = Math.floor(TASK_WORKSPACE_RUNTIME_HEARTBEAT_TIMEOUT_MS / 1000)
    const normalizedReason = reason.includes('heartbeat')
      ? `执行器心跳已超时（>${timeoutSeconds}s）。`
      : '执行器已离线，当前会话已失联。'

    reconcileLostWorkspaceSessionsForExecutor(executorId, normalizedReason)
    if (!reason.includes('heartbeat')) {
      syncExecutorWorkspaceSessionHeartbeats(executorId, [], [], new Date().toISOString())
    }
    for (const [requestId, pending] of pendingAgentPrompts.entries()) {
      if (pending.executorId !== executorId) {
        continue
      }

      if (pending.timer) {
        clearTimeout(pending.timer)
      }
      pending.cleanupAbortListener?.()
      pendingAgentPrompts.delete(requestId)
      const abortReason: ExecutorAgentPromptAbortReason = reason.includes('heartbeat')
        ? 'executor_disconnected'
        : 'executor_reconnect'
      const error = new Error(reason.includes('heartbeat') ? `执行器心跳已超时（>${timeoutSeconds}s）。` : '执行器已断开连接。')
      error.name = 'AbortError'
      ;(error as Error & { abortReason?: ExecutorAgentPromptAbortReason }).abortReason = abortReason
      pending.reject(error)
    }
    void reconcileControlPlaneTaskQueue()
  })
}

export const getExecutorHeartbeatVersionPatch = (version?: string) => {
  return version?.trim() ? { version } : {}
}

export const handleExecutorMessage = (executorId: string, raw: string) => {
    registerExecutorMessageHandlerListeners()
    let message: ExecutorToControlPlaneMessage

    try {
      message = JSON.parse(raw) as ExecutorToControlPlaneMessage
    } catch (error) {
      logExecutorEvent({
        executorId,
        eventType: 'error',
        message: '执行器发送了无法解析的 WS 消息。',
        payload: {
          raw,
          error: error instanceof Error ? error.message : 'invalid json',
        },
        isFailure: true,
      })
      return
    }

    switch (message.type) {
      case 'executor.register': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const receivedAt = new Date().toISOString()
        executorRegistry.updatePresence({
          executorId: message.executorId,
          runningTaskIds: message.runningTaskIds,
          queuedTaskIds: message.queuedTaskIds,
          lastHeartbeatAt: receivedAt,
          telemetry: message.telemetry,
          mesh: message.mesh,
          projectBindings: message.projectBindings,
        })
        reconcileExecutorTerminalSessionsFromFullSnapshot(message.executorId, message.terminalSessions ?? [])
        syncExecutorWorkspaceTerminalRuntimeSummaries(message.executorId, message.terminalSessions ?? [], receivedAt)
        refreshExecutorWorkspaceEnvironmentRuntimeSummaries(message.executorId)
        executorRegistry.setProjectBindings(message.executorId, message.projectBindings)
        executorRegistry.upsertExecutor(message.executorId, {
          status: 'online',
          capabilities: message.capabilities,
          labels: message.labels,
          workspaceRoot: message.workspaceRoot,
          maxConcurrency: message.maxConcurrency,
          localServerPort: message.localServerPort,
          localServerInstanceId: message.localServerInstanceId,
          previewExposureMode: message.previewExposureMode,
          previewIngressPort: message.previewIngressPort,
          previewIngressBaseUrl: message.previewIngressBaseUrl,
          previewIngressDetectedPublicIp: message.previewIngressDetectedPublicIp,
          previewIngressDetectedLanIp: message.previewIngressDetectedLanIp,
          sshPubkey: message.sshPubkey,
          platform: message.platform,
          version: message.version,
          lastSeenAt: receivedAt,
        })
        refreshExecutorPreviewIngressHealth(message.executorId)
        reconcileExecutorReportedTasks(
          message.executorId,
          message.runningTaskIds ?? [],
          message.queuedTaskIds ?? [],
          receivedAt,
        )
        syncExecutorWorkspaceSessionHeartbeats(
          message.executorId,
          message.runningTaskIds ?? [],
          message.queuedTaskIds ?? [],
          receivedAt,
        )
        sendExecutorLatencyProbe(message.executorId)
        return
      }
      case 'executor.heartbeat': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        executorRegistry.updatePresence({
          executorId: message.executorId,
          runningTaskIds: message.runningTaskIds,
          queuedTaskIds: message.queuedTaskIds,
          lastHeartbeatAt: message.at,
          telemetry: message.telemetry,
          mesh: message.mesh,
          projectBindings: message.projectBindings,
        })
        reconcileExecutorTerminalSessionsFromFullSnapshot(message.executorId, message.terminalSessions ?? [])
        syncExecutorWorkspaceTerminalRuntimeSummaries(message.executorId, message.terminalSessions ?? [], message.at)
        refreshExecutorWorkspaceEnvironmentRuntimeSummaries(message.executorId)
        executorRegistry.updateExecutorHeartbeat(message.executorId, {
          status: 'online',
          localServerPort: message.localServerPort,
          localServerInstanceId: message.localServerInstanceId,
          previewExposureMode: message.previewExposureMode,
          previewIngressPort: message.previewIngressPort,
          previewIngressBaseUrl: message.previewIngressBaseUrl,
          previewIngressDetectedPublicIp: message.previewIngressDetectedPublicIp,
          previewIngressDetectedLanIp: message.previewIngressDetectedLanIp,
          sshPubkey: message.sshPubkey,
          ...getExecutorHeartbeatVersionPatch(message.version),
          lastSeenAt: message.at,
        })
        refreshExecutorPreviewIngressHealth(message.executorId)
        logExecutorEvent({
          executorId: message.executorId,
          eventType: 'heartbeat',
          message: '执行器心跳已更新。',
          payload: {
            runningTaskIds: message.runningTaskIds,
            queuedTaskIds: message.queuedTaskIds,
            at: message.at,
          },
        })
        reconcileExecutorReportedTasks(message.executorId, message.runningTaskIds, message.queuedTaskIds, message.at)
        syncExecutorWorkspaceSessionHeartbeats(message.executorId, message.runningTaskIds, message.queuedTaskIds, message.at)
        reconcileControlPlaneTaskQueue()
        sendExecutorLatencyProbe(message.executorId)
        return
      }
      case 'executor.latency.pong': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const sentAtMs = Date.parse(message.sentAt)
        if (!Number.isFinite(sentAtMs)) {
          return
        }

        executorRegistry.updateLatency(message.executorId, {
          roundTripMs: Math.max(0, Date.now() - sentAtMs),
          sampledAt: new Date().toISOString(),
        })
        return
      }
      case 'executor.capabilities.update': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        executorRegistry.upsertExecutor(message.executorId, {
          capabilities: message.capabilities,
          labels: message.labels,
          workspaceRoot: message.workspaceRoot,
          maxConcurrency: message.maxConcurrency,
          previewExposureMode: message.previewExposureMode,
          previewIngressPort: message.previewIngressPort,
          previewIngressBaseUrl: message.previewIngressBaseUrl,
          previewIngressDetectedLanIp: message.previewIngressDetectedLanIp,
          sshPubkey: message.sshPubkey,
          lastSeenAt: new Date().toISOString(),
        })
        refreshExecutorPreviewIngressHealth(message.executorId)
        executorRegistry.setProjectBindings(message.executorId, message.projectBindings)
        return
      }
      case 'preview.tunnel.status': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        previewSessionService.applyTunnelClientStatus(
          message.previewSessionId,
          message.status,
          message.message,
        )
        return
      }
      case 'task.ack': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const task = getDistributedTask(message.taskId)
        if (!task || task.executorNodeId !== executorId || task.idempotencyKey !== message.idempotencyKey) {
          logExecutorEvent({
            executorId,
            eventType: 'error',
            message: '收到 task.ack，但任务不存在或执行器不匹配。',
            payload: message as unknown as Record<string, unknown>,
            taskId: message.taskId,
            isFailure: true,
          })
          return
        }

        logExecutorEvent({
          executorId,
          eventType: 'task.ack',
          message: message.accepted ? '执行器已确认接收任务。' : `执行器拒绝任务：${message.reason || '未提供原因'}`,
          payload: message as unknown as Record<string, unknown>,
          taskId: task.id,
          originTaskId: task.originTaskId,
          projectId: task.projectId,
          isFailure: !message.accepted,
        })

        updateDistributedTask({
          ...task,
          status: message.accepted ? task.status : 'failed',
          errorMessage: message.accepted ? undefined : (message.reason || 'executor rejected task'),
          updatedAt: new Date().toISOString(),
        })
        if (!message.accepted) {
          reconcileControlPlaneTaskQueue()
        }
        return
      }
      case 'task.event': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const task = getDistributedTask(message.taskId)
        if (
          !task
          || task.executorNodeId !== executorId
          || task.idempotencyKey !== message.idempotencyKey
          || !isNewerWorkerTaskEvent(task, message.sequence)
          || ['completed', 'cancelled', 'failed', 'timed_out', 'lost'].includes(task.status)
        ) {
          logExecutorEvent({
            executorId,
            eventType: 'error',
            message: '收到 task.event，但任务不存在或执行器不匹配。',
            payload: message as unknown as Record<string, unknown>,
            taskId: message.taskId,
            isFailure: true,
          })
          return
        }

        logExecutorEvent({
          executorId,
          eventType: 'task.event',
          message: message.message,
          payload: message as unknown as Record<string, unknown>,
          taskId: task.id,
          originTaskId: task.originTaskId,
          projectId: task.projectId,
        })

        syncDistributedTaskEvent({
          taskId: message.taskId,
          sequence: message.sequence,
          status: message.status,
          message: message.message,
          at: message.at,
        })
        return
      }
      case 'task.result': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const task = getDistributedTask(message.task.id)
        if (
          !task
          || task.executorNodeId !== executorId
          || task.idempotencyKey !== message.task.idempotencyKey
          || !canAcceptWorkerTaskResult(task, message.sequence)
        ) {
          logExecutorEvent({
            executorId,
            eventType: 'error',
            message: '收到 task.result，但任务不存在或执行器不匹配。',
            payload: {
              taskId: message.task.id,
              status: message.task.status,
            },
            taskId: message.task.id,
            isFailure: true,
          })
          return
        }

        logExecutorEvent({
          executorId,
          eventType: 'task.result',
          message: message.task.result?.summary || `任务执行结束：${message.task.status}`,
          payload: {
            task: {
              id: message.task.id,
              status: message.task.status,
              returnMode: message.task.returnMode,
              errorMessage: message.task.errorMessage,
              result: message.task.result,
            },
          },
          taskId: task.id,
          originTaskId: task.originTaskId,
          projectId: task.projectId,
        })

        void syncDistributedTaskResult({
          ...message.task,
          updatedAt: new Date().toISOString(),
        }, message.sequence).then((persistedTask) => {
          if (persistedTask) {
            reconcileControlPlaneTaskQueue()
          }
        })
        return
      }
      case 'config.export.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingConfigExports.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingConfigExports.delete(message.requestId)
        pending.resolve({
          opencodeConfigContent: message.opencodeConfigContent,
          codexConfigContent: message.codexConfigContent,
          codexAuthContent: message.codexAuthContent,
          claudeCodeConfigContent: message.claudeCodeConfigContent,
          defaultModel: message.defaultModel,
          agentSettings: message.agentSettings,
          availableModels: message.availableModels,
          resolvedModelBindings: message.resolvedModelBindings,
          modelsMessage: message.modelsMessage,
          at: message.at,
        })
        return
      }
      case 'executor.codex-oauth.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingCodexOauthRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingCodexOauthRequests.delete(message.requestId)
        if (!message.ok || message.error) {
          pending.reject(new Error(message.error || '执行节点处理 ChatGPT 账号请求失败。'))
          return
        }
        if (message.payload === undefined) {
          pending.reject(new Error('执行节点未返回 ChatGPT 账号数据。'))
          return
        }
        pending.resolve(message.payload)
        return
      }
      case 'executor.repo-probe.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingRepoProbes.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingRepoProbes.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.pat.verify.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingPatVerifications.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingPatVerifications.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.ssh.verify.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingSshVerifications.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingSshVerifications.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.telemetry.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        executorRegistry.updatePresence({
          executorId: message.executorId,
          lastHeartbeatAt: executorRegistry.getPresence(message.executorId)?.lastHeartbeatAt ?? message.at,
          telemetry: message.telemetry,
        })
        executorRegistry.upsertExecutor(message.executorId, {
          status: 'online',
          lastSeenAt: message.at,
        })

        const pending = pendingTelemetryRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTelemetryRequests.delete(message.requestId)
        pending.resolve(message.telemetry)
        return
      }
      case 'executor.doctor.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingDoctorRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingDoctorRequests.delete(message.requestId)
        pending.resolve(message.doctor)
        return
      }
      case 'executor.directory-browse.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingDirectoryBrowses.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingDirectoryBrowses.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.file-read.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingFileReads.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingFileReads.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.file-write.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingFileWrites.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingFileWrites.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.agent.workdir.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentWorkdirRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingAgentWorkdirRequests.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.agent.workdir.download.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentWorkdirDownloads.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingAgentWorkdirDownloads.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.agent.workdir.read.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentWorkdirReads.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingAgentWorkdirReads.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.agent-sessions.list.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentSessionLists.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingAgentSessionLists.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.agent-sessions.read.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentSessionReads.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingAgentSessionReads.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.skills.scan.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingSkillScans.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingSkillScans.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.repo-branches.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingRepoBranches.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        console.log('[executor-repo-branches] response', JSON.stringify({
          executorId: message.executorId,
          requestId: message.requestId,
          ok: message.result.ok,
          branchCount: message.result.branches.length,
          defaultBranch: message.result.defaultBranch,
          message: message.result.message,
        }))

        clearTimeout(pending.timer)
        pendingRepoBranches.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.checkout.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitCheckouts.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitCheckouts.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.commit.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitCommits.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitCommits.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.diff.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitDiffs.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitDiffs.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.working-tree-diff.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitWorkingTreeDiffs.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitWorkingTreeDiffs.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.status.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) return
        const pending = pendingGitStatuses.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) return
        clearTimeout(pending.timer)
        pendingGitStatuses.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.file-diff.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) return
        const pending = pendingGitFileDiffs.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) return
        clearTimeout(pending.timer)
        pendingGitFileDiffs.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.change.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) return
        const pending = pendingGitChanges.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) return
        clearTimeout(pending.timer)
        pendingGitChanges.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.commit-diff.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitCommitDiffs.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitCommitDiffs.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.baseline-snapshot.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitBaselineSnapshots.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitBaselineSnapshots.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.baseline-diff.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitBaselineDiffs.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitBaselineDiffs.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.rebase.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitRebases.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitRebases.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.graph.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitGraphs.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitGraphs.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.push.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitPushes.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitPushes.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.git.pull-request.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingGitPullRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingGitPullRequests.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.worktree.ensure.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingWorktreeEnsures.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        inflightWorktreeEnsures.delete(pending.dedupeKey)
        pendingWorktreeEnsures.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.worktree.cleanup.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingWorktreeCleanups.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingWorktreeCleanups.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.workspace.operation.event': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pendingWorktreeEnsure = pendingWorktreeEnsures.get(message.requestId)
        if (pendingWorktreeEnsure && pendingWorktreeEnsure.executorId === message.executorId) {
          pendingWorktreeEnsure.lastOperationEvent = message.event
          pendingWorktreeEnsure.onOperationEvent?.(message.event)
          return
        }

        const pendingWorktreeCleanup = pendingWorktreeCleanups.get(message.requestId)
        if (pendingWorktreeCleanup && pendingWorktreeCleanup.executorId === message.executorId) {
          pendingWorktreeCleanup.onOperationEvent?.(message.event)
        }
        return
      }
      case 'executor.agent.prompt.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentPrompts.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          void recoverPendingWorkspacePromptResponse({
            requestId: message.requestId,
            executorId: message.executorId,
            result: message.result,
            at: message.at,
          }).then((recovered) => recovered || recoverPendingMainChatPromptResponse({
            requestId: message.requestId,
            executorId: message.executorId,
            result: message.result,
            at: message.at,
          })).catch((error) => {
            console.warn('[executor-agent] orphan-response-recovery-failed', JSON.stringify({
              executorId: message.executorId,
              requestId: message.requestId,
              error: error instanceof Error ? error.message : String(error),
            }))
          })
          return
        }

        console.log('[executor-agent] response', JSON.stringify({
          executorId: message.executorId,
          requestId: message.requestId,
          ok: message.result.ok,
          sessionId: message.result.sessionId,
          outputPreview: (message.result.output ?? '').slice(0, 200),
        }))

        if (pending.timer) {
          clearTimeout(pending.timer)
        }
        pending.cleanupAbortListener?.()
        pendingAgentPrompts.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.agent.prompt.event': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingAgentPrompts.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        try {
          pending.onEvent?.(message.event)
        } catch (error) {
          console.warn('[executor-agent] event-handler-failed', JSON.stringify({
            executorId: message.executorId,
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
        return
      }
      case 'executor.terminal.response': {
        const pending = pendingTerminalRequests.get(message.requestId)
        logTerminalDebug('received one-shot terminal response', {
          command: pending?.command,
          cwd: pending?.cwd,
          durationMs: pending ? Date.now() - pending.startedAt : undefined,
          executorId: message.executorId,
          requestId: message.requestId,
          exitCode: message.result.exitCode,
          mode: pending?.mode,
          stderr: message.result.stderr,
          stdout: message.result.stdout,
        })
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTerminalRequests.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.http.probe.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingHttpProbes.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingHttpProbes.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.desktop-sandbox.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingDesktopSandboxRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingDesktopSandboxRequests.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.remote-code.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingRemoteCodeRequests.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingRemoteCodeRequests.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.terminal.sessions.list.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingTerminalSessionLists.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTerminalSessionLists.delete(message.requestId)
        mergeReportedTerminalSessions(message.result.sessions)
        pending.resolve(message.result)
        return
      }
      case 'executor.terminal.session.create.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingTerminalSessionCreates.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTerminalSessionCreates.delete(message.requestId)
        if (message.result.session) {
          terminalSessionsByKey.set(message.result.session.terminalKey, message.result.session)
        }
        if (message.result.sessions) {
          mergeReportedTerminalSessions(message.result.sessions)
        }
        pending.resolve(message.result)
        return
      }
      case 'executor.terminal.session.attach.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingTerminalSessionAttaches.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTerminalSessionAttaches.delete(message.requestId)
        if (message.result.session) {
          terminalSessionsByKey.set(message.result.session.terminalKey, message.result.session)
        }
        if (message.result.snapshot?.session.terminalKey) {
          terminalSessionSnapshotsByKey.set(message.result.snapshot.session.terminalKey, message.result.snapshot)
        }
        pending.resolve(message.result)
        return
      }
      case 'executor.terminal.local-attach-ticket.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingTerminalLocalAttachTickets.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTerminalLocalAttachTickets.delete(message.requestId)
        pending.resolve(message.result)
        return
      }
      case 'executor.terminal.session.close.response': {
        if (!validateMessageExecutor(executorId, message.executorId)) {
          return
        }

        const pending = pendingTerminalSessionCloses.get(message.requestId)
        if (!pending || pending.executorId !== message.executorId) {
          return
        }

        clearTimeout(pending.timer)
        pendingTerminalSessionCloses.delete(message.requestId)
        if (message.result.session?.terminalKey) {
          closeTerminalBrowserClients(message.result.session.terminalKey, message.executorId, {
            type: 'exit',
            terminalId: message.result.session.terminalId,
            terminalKey: message.result.session.terminalKey,
            exitCode: message.result.session.exitCode ?? 0,
            at: message.at,
          })
          terminalSessionsByKey.delete(message.result.session.terminalKey)
          terminalSessionSnapshotsByKey.delete(message.result.session.terminalKey)
          terminalSessionClientsByKey.delete(message.result.session.terminalKey)
        }
        if (message.result.sessions) {
          mergeReportedTerminalSessions(message.result.sessions)
          syncExecutorWorkspaceTerminalRuntimeSummaries(message.executorId, message.result.sessions, message.at)
        }
        pending.resolve(message.result)
        return
      }
      case 'executor.terminal.session.snapshot': {
        logTerminalDebug('received terminal session snapshot', {
          executorId: message.executorId,
          terminalId: message.snapshot.session.terminalId,
          terminalKey: message.snapshot.session.terminalKey,
          clientId: message.clientId,
          chunkCount: message.snapshot.chunks.length,
        })

        terminalSessionsByKey.set(message.snapshot.session.terminalKey, message.snapshot.session)
        terminalSessionSnapshotsByKey.set(message.snapshot.session.terminalKey, message.snapshot)
        const client = terminalBrowserClients.get(message.clientId)
        if (!client || client.executorId !== message.executorId || !isSocketOpen(client.socket)) {
          return
        }
        if (client.buffering) {
          client.bufferedMessages.push({
            type: 'snapshot',
            snapshot: message.snapshot,
            at: message.at,
          })
          return
        }
        client.socket.send(JSON.stringify({
          type: 'snapshot',
          snapshot: message.snapshot,
          at: message.at,
        }))
        return
      }
      case 'executor.terminal.session.ready': {
        logTerminalDebug('received terminal session ready', {
          executorId: message.executorId,
          terminalId: message.terminalId,
          terminalKey: message.terminalKey,
          clientId: message.clientId,
          cwd: message.cwd,
          mode: message.mode,
        })
        const session = terminalSessionsByKey.get(message.terminalKey)
        if (session) {
          terminalSessionsByKey.set(message.terminalKey, {
            ...session,
            mode: message.mode,
          })
        }
        if (message.clientId) {
          const client = terminalBrowserClients.get(message.clientId)
          if (!client || client.executorId !== message.executorId || !isSocketOpen(client.socket)) {
            return
          }
          client.socket.send(JSON.stringify({
            type: 'ready',
            terminalId: message.terminalId,
            terminalKey: message.terminalKey,
            clientId: message.clientId,
            cwd: message.cwd,
            mode: message.mode,
            at: message.at,
          }))
          return
        }
        fanoutTerminalMessage(message.terminalKey, message.executorId, {
          type: 'ready',
          terminalId: message.terminalId,
          terminalKey: message.terminalKey,
          cwd: message.cwd,
          mode: message.mode,
          at: message.at,
        })
        return
      }
      case 'executor.terminal.session.output': {
        logTerminalDebug('received terminal session output', {
          executorId: message.executorId,
          terminalId: message.output.terminalId,
          terminalKey: message.output.terminalKey,
          stream: message.output.stream,
          chunkLength: message.output.chunk.length,
        })
        const snapshot = terminalSessionSnapshotsByKey.get(message.output.terminalKey)
        if (snapshot) {
          snapshot.chunks.push({
            stream: message.output.stream,
            chunk: message.output.chunk,
            at: message.output.at,
          })
          if (snapshot.chunks.length > TERMINAL_SNAPSHOT_CHUNK_LIMIT) {
            snapshot.chunks.splice(0, snapshot.chunks.length - TERMINAL_SNAPSHOT_CHUNK_LIMIT)
          }
        } else {
          terminalSessionSnapshotsByKey.set(message.output.terminalKey, {
            session: terminalSessionsByKey.get(message.output.terminalKey) ?? {
              terminalId: message.output.terminalId,
              terminalKey: message.output.terminalKey,
              scope: 'executor',
              executorId: message.executorId,
              cwd: '',
              title: message.output.terminalId,
              createdAt: message.output.at,
              lastActiveAt: message.output.at,
              attachCount: 0,
              clientIds: [],
            },
            chunks: [{
              stream: message.output.stream,
              chunk: message.output.chunk,
              at: message.output.at,
            }],
          })
        }
        fanoutTerminalMessage(message.output.terminalKey, message.executorId, {
          type: 'output',
          output: message.output,
        })
        return
      }
      case 'executor.terminal.session.exit': {
        logTerminalDebug('received terminal session exit', {
          executorId: message.executorId,
          terminalId: message.terminalId,
          terminalKey: message.terminalKey,
          exitCode: message.exitCode,
        })
        const existing = terminalSessionsByKey.get(message.terminalKey)
        if (existing) {
          terminalSessionsByKey.set(message.terminalKey, {
            ...existing,
            exitCode: message.exitCode,
            exitedAt: message.at,
            lastActiveAt: message.at,
          })
        }
        closeTerminalBrowserClients(message.terminalKey, message.executorId, {
          type: 'exit',
          terminalId: message.terminalId,
          terminalKey: message.terminalKey,
          exitCode: message.exitCode,
          at: message.at,
        })
        terminalSessionsByKey.delete(message.terminalKey)
        terminalSessionSnapshotsByKey.delete(message.terminalKey)
        terminalSessionClientsByKey.delete(message.terminalKey)
        return
      }
      default:
        return
    }
}
