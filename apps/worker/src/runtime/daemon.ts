/**
 * [INPUT]: Paired worker config, local runtime capabilities, control-plane messages, and task assignments.
 * [OUTPUT]: Long-lived worker daemon lifecycle, executor connection, task execution, and status reporting.
 * [POS]: Primary worker runtime coordinator; local server readiness precedes control-plane connection.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { spawn } from 'node:child_process'
import type http from 'node:http'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { DistributedTask, ExecutorToControlPlaneMessage } from '@shared/types'
import { connectWorkerWebSocket, resolveWorkerConnectionRoute } from '../control-plane'
import { selectWorkerConnectionRoute } from '../control-plane/route-selection'
import { getWorkerVersion } from '../core/app-root'
import { getWorkerHome, loadWorkerConfig } from '../core/config'
import { getLocalWorkerConsoleUrl } from '../core/local-console'
import { mergeWorkerRoutingLabels } from '../core/runtime-cloud-url'
import { getWorkerRuntimeState, updateWorkerRuntimeState } from '../core/runtime-state'
import { ensureWorkspaceLayout } from '../core/workspace'
import { startLocalWorkerServer } from '../local-api/server'
import { previewIngressController } from '../preview-ingress/controller'
import { previewTunnelManager } from '../preview-tunnel/manager'
import { checkForWorkerUpdate, getWorkerReleaseChannel, type WorkerUpdateCheckResult } from '../update/worker-release'
import {
  beginWorkerSelfUpdate,
  maybeAutoApplyWorkerUpdate,
  resolveWorkerUpdateExitMode,
  type WorkerUpdateStartResult,
} from '../update/worker-updater'
import { shutdownOpencodeServers } from '../execution/opencode/client'
import { getWorkerDoctor, runWorkerDoctor } from './doctor'
import { getDefaultWorkerServiceName } from '../service/service-common'
import { shouldRunIdleWorkerAutoUpdate } from './daemon-auto-update'
import { desktopSandboxProvider, resolveDesktopSandboxProvider } from './desktop-sandbox-provider'
import { buildExecutorTelemetrySnapshot } from './executor-resource-snapshot'
import { createControlPlaneMessageHandler } from './message-handler'
import { buildTerminalSessionCallbacks } from './message-handler/terminal'
import { createPromptQueueState } from './message-handler/prompt-queue'
import { getWorkerMeshStatus, loadWorkerMeshRuntimeConfig, refreshWorkerMeshRuntimeStatus, shouldRestartWorkerMeshRuntime, startWorkerMeshRuntime, stopWorkerMeshRuntime } from './mesh-runtime-manager'
import { registerLocalTerminalDirectStore } from './local-terminal-direct'
import { PersistentTerminalSessionStore } from './persistent-terminal-session'
import { getWorkerSshPublicKey } from './ssh-key'
import { openTerminalSession, runTerminalCommand, terminateAllBackgroundTerminalCommands } from './terminal-session'
import { startTaskLifecycle } from './task-lifecycle'
import type { WorkerConnection } from './types'
import { loadRestorableZellijTerminalMetadata } from './zellij-terminal-metadata'

const daemonController: {
  connection: WorkerConnection | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  stopped: boolean
  connect: null | (() => void)
  requestUpdate: null | (() => Promise<WorkerUpdateStartResult>)
} = {
  connection: null,
  reconnectTimer: null,
  stopped: false,
  connect: null,
  requestUpdate: null,
}

const terminalSessions = new PersistentTerminalSessionStore()
registerLocalTerminalDirectStore(terminalSessions)

const getWorkerPackageName = () => {
  return getDefaultWorkerServiceName()
}

const buildTelemetrySnapshot = (workspaceRoot: string) => {
  return buildExecutorTelemetrySnapshot({
    workspaceRoot,
    workerVersion: getWorkerVersion(),
  })
}

const openUrl = (url: string) => {
  const command = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url]

  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: 'ignore',
  })

  child.unref()
}

type WorkerStartupBannerMode = 'daemon' | 'open'

type WorkerVersionStatus = {
  currentVersion: string
  latestVersion: string
  check: WorkerUpdateCheckResult
}

const loadWorkerVersionStatus = async (): Promise<WorkerVersionStatus> => {
  const currentVersion = getWorkerVersion()
  const check = await checkForWorkerUpdate()

  return {
    currentVersion,
    latestVersion: check.latestVersion || currentVersion,
    check,
  }
}

const printWorkerBanner = (
  mode: WorkerStartupBannerMode,
  cloudUrl: string,
  localUrl: string | undefined,
  versionStatus: WorkerVersionStatus,
) => {
  const channel = versionStatus.check.channel || getWorkerReleaseChannel()
  const title = channel === 'preview' ? 'wemux Worker Preview' : 'wemux Worker'
  const updateExitMode = resolveWorkerUpdateExitMode()
  const rows = [
    ['Mode', mode],
    ['Channel', channel],
    ['Current', versionStatus.currentVersion],
    ['Latest', versionStatus.latestVersion],
    ['Update Policy', updateExitMode === 'auto' ? 'auto-exit' : 'manual-exit'],
    ['Cloud', cloudUrl],
    ['Local', localUrl ?? 'disabled'],
  ]
  const footer = mode === 'open'
    ? 'Opening cloud and local consoles in your browser...'
    : 'Worker daemon is ready and waiting for tasks.'
  const labelWidth = Math.max(...rows.map(([label]) => label.length))
  const bodyLines = [title, '', ...rows.map(([label, value]) => `${label.padEnd(labelWidth)} : ${value}`), '', footer]
  const width = Math.max(...bodyLines.map((line) => line.length))
  const border = `+${'-'.repeat(width + 2)}+`

  console.log(border)
  for (const line of bodyLines) {
    console.log(`| ${line.padEnd(width)} |`)
  }
  console.log(border)
}

export const runWorkerOpen = async () => {
  const config = loadWorkerConfig()
  const localServer = await startLocalWorkerServer()
  const localUrl = localServer.localUrl!

  void loadWorkerVersionStatus()
    .then((versionStatus) => {
      printWorkerBanner('open', config.cloudUrl, localUrl, versionStatus)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'worker version check failed'
      console.error('[worker] version check failed', message)
    })

  setTimeout(() => {
    openUrl(config.cloudUrl)
    openUrl(localUrl)
  }, 250)
}

export { getWorkerDoctor, runWorkerDoctor }

export const disconnectWorkerControlPlane = () => {
  daemonController.stopped = true
  if (daemonController.reconnectTimer) {
    clearTimeout(daemonController.reconnectTimer)
    daemonController.reconnectTimer = null
  }

  daemonController.connection?.socket?.close(1000, 'manual disconnect')
  daemonController.connection = null
  updateWorkerRuntimeState({
    daemonMode: 'disconnected',
    connected: false,
    effectiveCloudUrl: undefined,
    lastDisconnectAt: new Date().toISOString(),
    lastError: 'Control plane connection was disconnected manually.',
  })
}

export const reconnectWorkerControlPlane = () => {
  const config = loadWorkerConfig()
  if (!config.executorId || !config.executorToken) {
    throw new Error('This worker is not paired yet, so it cannot connect to the control plane.')
  }

  daemonController.stopped = false
  if (daemonController.reconnectTimer) {
    clearTimeout(daemonController.reconnectTimer)
    daemonController.reconnectTimer = null
  }

  daemonController.connection?.socket?.close(1000, 'manual reconnect')
  daemonController.connection = null
  daemonController.connect?.()
}

export const requestWorkerSelfUpdateWhenIdle = async () => {
  return daemonController.requestUpdate?.() ?? beginWorkerSelfUpdate()
}

export const runWorkerDaemon = async () => {
  daemonController.stopped = false
  let config = loadWorkerConfig()
  let assignedCloudUrl = ''
  let assignedRoutingLabels: string[] = []
  let managedRoutingLabels: string[] = []
  let runningTaskIds: string[] = []
  let queuedTaskIds: string[] = []
  const assignedTasks = new Map<string, {
    task: DistributedTask
    runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
    featureFlags?: import('@shared/user-experimental-settings').ExecutorFeatureFlags
  }>()
  const activeExecutions = new Map<string, { abort: () => void }>()
  let connection: WorkerConnection | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let shuttingDown = false
  let connectAttemptSeq = 0
  let updateCheckInterval: ReturnType<typeof setInterval> | null = null
  let autoUpdateCheckInFlight = false
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null
  let meshStatusInterval: ReturnType<typeof setInterval> | null = null
  const promptQueueState = createPromptQueueState()
  const reliableOutboundQueue: ExecutorToControlPlaneMessage[] = []
  let requestWorkerUpdateExit: (() => void) | null = null
  let workerUpdateExitRequested = false
  let updateDrainRequested = false
  let pendingWorkerUpdate: { mode: 'manual' | 'auto'; check?: WorkerUpdateCheckResult } | null = null
  let updateApplyPromise: Promise<WorkerUpdateStartResult | null> | null = null
  const exitForWorkerUpdate = () => {
    workerUpdateExitRequested = true
    requestWorkerUpdateExit?.()
  }
  ensureWorkspaceLayout(config.workspaceRoot)
  const localServer = await startLocalWorkerServer({ optional: true, rejectDuplicateExecutor: true })
  let activeLocalServerPort = localServer.port
  const localServerInstanceId = localServer.instanceId
  const applyActiveLocalServerPort = (nextConfig: typeof config) => activeLocalServerPort
    ? {
        ...nextConfig,
        localServerPort: activeLocalServerPort,
      }
    : nextConfig
  config = {
    ...config,
    localServerPort: localServer.port ?? config.localServerPort,
  }
  const startedAt = new Date().toISOString()
  updateWorkerRuntimeState({
    daemonMode: 'starting',
    paired: Boolean(config.executorId && config.executorToken),
    executorId: config.executorId,
    config,
    mesh: startWorkerMeshRuntime(loadWorkerMeshRuntimeConfig(config)),
    startedAt,
    lastConnectAttemptAt: startedAt,
    lastError: localServer.disabledReason,
  })
  const localUrl = activeLocalServerPort ? getLocalWorkerConsoleUrl(activeLocalServerPort) : undefined
  void loadWorkerVersionStatus()
    .then((versionStatus) => {
      printWorkerBanner('daemon', config.cloudUrl, localUrl, versionStatus)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'worker startup banner failed'
      console.error('[worker] startup banner failed', message)
    })
  let previewIngressState = {
    previewIngressBaseUrl: '',
    detectedPublicIp: '',
    detectedLanIp: '',
  }
  const refreshPreviewIngressState = async () => {
    if (!activeLocalServerPort) {
      previewIngressState = {
        previewIngressBaseUrl: '',
        detectedPublicIp: '',
        detectedLanIp: '',
      }
      return
    }
    try {
      const result = await previewIngressController.reconcile(config)
      previewIngressState = {
        previewIngressBaseUrl: result.previewIngressBaseUrl,
        detectedPublicIp: result.detectedPublicIp,
        detectedLanIp: result.detectedLanIp,
      }
    } catch {
      previewIngressState = {
        previewIngressBaseUrl: '',
        detectedPublicIp: '',
        detectedLanIp: '',
      }
    }
  }
  void refreshPreviewIngressState()

  void desktopSandboxProvider.prepare()
    .then((result) => {
      if (!result) {
        return
      }
      const provider = result.provider || resolveDesktopSandboxProvider()
      const status = result.ok ? 'ready' : 'failed'
      console.log('[worker] desktop sandbox startup prepare', JSON.stringify({
        provider,
        status,
        phase: result.phase,
        message: result.message,
        image: result.image,
        platform: result.platform,
        controlUrl: result.controlUrl,
      }))
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'desktop sandbox startup prepare failed'
      console.error('[worker] desktop sandbox startup prepare failed', message)
    })

  const applyAssignedRouteToConfig = (nextConfig: typeof config) => {
    const cloudUrl = assignedCloudUrl.trim() || nextConfig.cloudUrl
    const labels = mergeWorkerRoutingLabels({
      labels: nextConfig.labels,
      assignedLabels: assignedRoutingLabels,
      managedRoutingLabels,
    })

    return applyActiveLocalServerPort({
      ...nextConfig,
      cloudUrl,
      labels,
    })
  }

  const resolveConnectionRouteConfig = async (bootstrapConfig: typeof config) => {
    const executorToken = bootstrapConfig.executorToken?.trim()
    if (!executorToken) {
      assignedCloudUrl = ''
      assignedRoutingLabels = []
      managedRoutingLabels = []
      updateWorkerRuntimeState({
        routeSelection: undefined,
      })
      return applyAssignedRouteToConfig(bootstrapConfig)
    }

    try {
      const route = await resolveWorkerConnectionRoute({
        bootstrapCloudUrl: bootstrapConfig.cloudUrl,
        executorToken,
      })
      const selection = await selectWorkerConnectionRoute({
        bootstrapCloudUrl: bootstrapConfig.cloudUrl,
        route,
      })
      assignedCloudUrl = selection.cloudUrl.trim() || route.assignedCloudUrl.trim() || bootstrapConfig.cloudUrl
      assignedRoutingLabels = [...selection.labels]
      managedRoutingLabels = [...route.managedRoutingLabels]
      updateWorkerRuntimeState({
        routeSelection: {
          bootstrapCloudUrl: bootstrapConfig.cloudUrl,
          assignedCloudUrl: route.assignedCloudUrl.trim() || undefined,
          selectedCloudUrl: assignedCloudUrl || undefined,
          countryCode: route.countryCode ?? undefined,
          continentCode: route.continentCode ?? undefined,
          matchedRouteId: route.matchedRouteId ?? undefined,
          assignedLabels: [...route.assignedLabels],
          selectedLabels: [...selection.labels],
          managedRoutingLabels: [...route.managedRoutingLabels],
          candidateResults: selection.probeResults.map((result) => ({
            id: result.candidate.id,
            cloudUrl: result.candidate.cloudUrl,
            labels: [...result.candidate.labels],
            reachable: result.reachable,
            latencyMs: result.latencyMs,
            statusCode: result.statusCode,
            error: result.error,
          })),
          updatedAt: new Date().toISOString(),
        },
      })
      const nextConfig = applyAssignedRouteToConfig(bootstrapConfig)
      if (nextConfig.cloudUrl !== bootstrapConfig.cloudUrl || (route.candidates?.length ?? 0) > 1) {
        console.log('[worker] assigned realtime route', JSON.stringify({
          bootstrapCloudUrl: bootstrapConfig.cloudUrl,
          assignedCloudUrl: route.assignedCloudUrl,
          selectedCloudUrl: nextConfig.cloudUrl,
          countryCode: route.countryCode ?? null,
          continentCode: route.continentCode ?? null,
          matchedRouteId: route.matchedRouteId ?? null,
          assignedLabels: route.assignedLabels,
          selectedLabels: selection.labels,
          candidateResults: selection.probeResults.map((result) => ({
            id: result.candidate.id,
            cloudUrl: result.candidate.cloudUrl,
            reachable: result.reachable,
            latencyMs: result.latencyMs ?? null,
            statusCode: result.statusCode ?? null,
            error: result.error ?? null,
          })),
        }))
      }
      return nextConfig
    } catch (error) {
      assignedCloudUrl = bootstrapConfig.cloudUrl
      assignedRoutingLabels = []
      managedRoutingLabels = []
      const resolutionError = error instanceof Error ? error.message : 'unknown error'
      updateWorkerRuntimeState({
        routeSelection: {
          bootstrapCloudUrl: bootstrapConfig.cloudUrl,
          assignedCloudUrl: bootstrapConfig.cloudUrl,
          selectedCloudUrl: bootstrapConfig.cloudUrl,
          assignedLabels: [],
          selectedLabels: [],
          managedRoutingLabels: [],
          candidateResults: [],
          resolutionError,
          updatedAt: new Date().toISOString(),
        },
      })
      console.error('[worker] connection route resolution failed', resolutionError)
      return applyAssignedRouteToConfig(bootstrapConfig)
    }
  }

  const closeLocalServer = async (server: http.Server) => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  const shutdown = async (
    signal: NodeJS.Signals | 'manual',
    reason?: string,
  ) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    daemonController.stopped = true
    stopped = true

    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (daemonController.reconnectTimer) {
      clearTimeout(daemonController.reconnectTimer)
      daemonController.reconnectTimer = null
    }

    updateWorkerRuntimeState({
      daemonMode: 'disconnected',
      connected: false,
      effectiveCloudUrl: undefined,
      lastDisconnectAt: new Date().toISOString(),
      lastError: reason || (signal === 'manual' ? 'Worker shutting down.' : `Worker shutting down by ${signal}.`),
    })

    for (const execution of activeExecutions.values()) {
      execution.abort()
    }
    activeExecutions.clear()

    terminalSessions.detachPersistentAndCloseOthers()
    await terminateAllBackgroundTerminalCommands()
    await shutdownOpencodeServers()

    connection?.socket?.close(1000, reason || `worker shutdown: ${signal}`)
    daemonController.connection?.socket?.close(1000, reason || `worker shutdown: ${signal}`)
    connection = null
    daemonController.connection = null

    if (updateCheckInterval) {
      clearInterval(updateCheckInterval)
      updateCheckInterval = null
    }

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }

    if (meshStatusInterval) {
      clearInterval(meshStatusInterval)
      meshStatusInterval = null
    }

    if (localServer.server) {
      await closeLocalServer(localServer.server)
    }
    await previewIngressController.shutdown()
    stopWorkerMeshRuntime()
  }

  requestWorkerUpdateExit = () => {
    setTimeout(() => {
      void shutdown('manual', 'Worker is applying a version update.').finally(() => process.exit(0))
    }, 250)
  }
  if (workerUpdateExitRequested) {
    requestWorkerUpdateExit()
  }

  const handleShutdownSignal = (signal: NodeJS.Signals) => {
    void shutdown(signal).finally(() => process.exit(0))
  }

  const requestShutdown = (reason?: string) => {
    console.log(`[worker] ${reason || 'control plane requested worker shutdown'}`)
    void shutdown('manual', reason).finally(() => process.exit(0))
  }

  process.once('SIGINT', handleShutdownSignal)
  process.once('SIGTERM', handleShutdownSignal)
  process.once('SIGHUP', handleShutdownSignal)

  const syncRuntimeState = () => {
    updateWorkerRuntimeState({
      queuedTaskIds,
      runningTaskIds,
      lastTaskAt: new Date().toISOString(),
      mesh: getWorkerMeshStatus(),
    })
  }

  const startPendingWorkerUpdate = () => {
    if (
      !pendingWorkerUpdate
      || updateApplyPromise
      || runningTaskIds.length > 0
      || queuedTaskIds.length > 0
    ) {
      return updateApplyPromise
    }

    const pending = pendingWorkerUpdate
    pendingWorkerUpdate = null
    updateApplyPromise = (async () => {
      try {
        if (pending.mode === 'auto') {
          const applied = await maybeAutoApplyWorkerUpdate(pending.check)
          if (applied) {
            exitForWorkerUpdate()
          } else {
            updateDrainRequested = false
          }
          return null
        }

        const result = await beginWorkerSelfUpdate(pending.check)
        if (result.applied) {
          exitForWorkerUpdate()
        } else {
          updateDrainRequested = false
        }
        return result
      } catch (error) {
        updateDrainRequested = false
        throw error
      } finally {
        updateApplyPromise = null
      }
    })()
    updateApplyPromise.catch((error) => {
      console.error('[worker] drained update failed', error instanceof Error ? error.message : error)
    })
    return updateApplyPromise
  }

  daemonController.requestUpdate = async () => {
    if (updateApplyPromise) {
      return (await updateApplyPromise) ?? {
        ok: true,
        applied: false,
        currentVersion: getWorkerVersion(),
        message: 'Worker 自动更新检查已完成。',
      }
    }

    updateDrainRequested = true
    pendingWorkerUpdate = {
      mode: 'manual',
      check: pendingWorkerUpdate?.check,
    }
    const updatePromise = startPendingWorkerUpdate()
    if (updatePromise) {
      return (await updatePromise) ?? {
        ok: true,
        applied: false,
        currentVersion: getWorkerVersion(),
        message: 'Worker 自动更新检查已完成。',
      }
    }

    return {
      ok: true,
      applied: false,
      scheduled: true,
      currentVersion: getWorkerVersion(),
      message: 'Worker 更新已安排，将在当前任务和排队任务完成后自动重启。',
    }
  }

  const drainAssignedQueue = () => {
    config = applyAssignedRouteToConfig(loadWorkerConfig())

    while (runningTaskIds.length < Math.max(1, config.maxConcurrency) && queuedTaskIds.length > 0) {
      const taskId = queuedTaskIds[0]
      queuedTaskIds = queuedTaskIds.slice(1)
      const assigned = assignedTasks.get(taskId)
      if (!assigned) {
        continue
      }
      const { task, runtimeEnvironment, featureFlags } = assigned

      runningTaskIds = [...runningTaskIds, taskId]
      syncRuntimeState()
      const execution = startTaskLifecycle({
        task,
        runtimeEnvironment,
        featureFlags,
        executorId: config.executorId!,
        workspaceRoot: config.workspaceRoot,
        projectBindings: config.projectBindings,
        send: sendToControlPlane,
        onStart() {
          return
        },
        onFinish(finishedTaskId) {
          assignedTasks.delete(finishedTaskId)
          activeExecutions.delete(finishedTaskId)
          runningTaskIds = runningTaskIds.filter((id) => id !== finishedTaskId)
          syncRuntimeState()
          drainExecutionQueue()
        },
      })
      activeExecutions.set(taskId, execution)
    }
  }

  let controlPlaneHandler: ReturnType<typeof createControlPlaneMessageHandler> | null = null

  const drainExecutionQueue = () => {
    drainAssignedQueue()
    controlPlaneHandler?.drainPromptQueue()
    void startPendingWorkerUpdate()
  }

  const isReliableOutboundMessage = (message: ExecutorToControlPlaneMessage) => {
    return message.type === 'task.ack'
      || message.type === 'task.event'
      || message.type === 'task.result'
      || message.type === 'executor.agent.prompt.event'
      || message.type === 'executor.agent.prompt.response'
  }

  const isTerminalReliableOutboundMessage = (message: ExecutorToControlPlaneMessage) => {
    return message.type === 'task.ack'
      || message.type === 'task.result'
      || message.type === 'executor.agent.prompt.response'
  }

  const enqueueReliableOutboundMessage = (message: ExecutorToControlPlaneMessage) => {
    if (!isReliableOutboundMessage(message)) {
      return
    }

    const maxQueuedMessages = 1000
    if (reliableOutboundQueue.length >= maxQueuedMessages) {
      const removableIndex = reliableOutboundQueue.findIndex((item) => !isTerminalReliableOutboundMessage(item))
      reliableOutboundQueue.splice(removableIndex === -1 ? 0 : removableIndex, 1)
    }
    reliableOutboundQueue.push(message)
  }

  const flushReliableOutboundQueue = () => {
    while (reliableOutboundQueue.length > 0) {
      const next = reliableOutboundQueue[0]
      if (!next || !daemonController.connection?.send(next)) {
        return
      }
      reliableOutboundQueue.shift()
    }
  }

  const sendToControlPlane = (message: ExecutorToControlPlaneMessage) => {
    const sent = daemonController.connection?.send(message) ?? false
    if (!sent) {
      enqueueReliableOutboundMessage(message)
    }
    return sent
  }

  const restoreZellijTerminalSessions = async () => {
    if (!config.executorId) {
      return
    }

    try {
      const records = await loadRestorableZellijTerminalMetadata(getWorkerHome(), config.executorId)
      for (const record of records) {
        terminalSessions.ensure({
          executorId: record.executorId,
          scope: record.scope,
          terminalId: record.terminalId,
          workspaceId: record.workspaceId,
          title: record.title,
          cwd: record.cwd,
          ownerUserId: record.ownerUserId,
          workspaceRoot: config.workspaceRoot,
          ...buildTerminalSessionCallbacks({ config, send: sendToControlPlane, ownerUserId: record.ownerUserId }),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      console.warn('[worker] failed to restore zellij terminal sessions', message)
    }
  }

  const buildExecutorRegisterMessage = (): ExecutorToControlPlaneMessage => ({
    type: 'executor.register',
    executorId: config.executorId!,
    capabilities: config.capabilities,
    labels: config.labels,
    workspaceRoot: config.workspaceRoot,
    maxConcurrency: config.maxConcurrency,
    localServerPort: activeLocalServerPort,
    localServerInstanceId,
    previewExposureMode: config.previewExposureMode,
    previewIngressPort: config.previewIngressPort,
    previewIngressBaseUrl: previewIngressState.previewIngressBaseUrl || undefined,
    previewIngressDetectedPublicIp: previewIngressState.detectedPublicIp || undefined,
    previewIngressDetectedLanIp: previewIngressState.detectedLanIp || undefined,
    projectBindings: config.projectBindings,
    sshPubkey: getWorkerSshPublicKey(),
    platform: process.platform,
    version: getWorkerVersion(),
    telemetry: buildTelemetrySnapshot(config.workspaceRoot),
    mesh: getWorkerMeshStatus(),
    runningTaskIds,
    queuedTaskIds,
    terminalSessions: terminalSessions.list({
      executorId: config.executorId!,
      includeClosing: true,
    }),
  })

  const buildExecutorHeartbeatMessage = (at: string): ExecutorToControlPlaneMessage => ({
    type: 'executor.heartbeat',
    executorId: config.executorId!,
    runningTaskIds,
    queuedTaskIds,
    localServerPort: activeLocalServerPort,
    localServerInstanceId,
    previewExposureMode: config.previewExposureMode,
    previewIngressPort: config.previewIngressPort,
    previewIngressBaseUrl: previewIngressState.previewIngressBaseUrl || undefined,
    previewIngressDetectedPublicIp: previewIngressState.detectedPublicIp || undefined,
    previewIngressDetectedLanIp: previewIngressState.detectedLanIp || undefined,
    projectBindings: config.projectBindings,
    sshPubkey: getWorkerSshPublicKey(),
    version: getWorkerVersion(),
    at,
    telemetry: buildTelemetrySnapshot(config.workspaceRoot),
    mesh: getWorkerMeshStatus(),
    terminalSessions: terminalSessions.list({
      executorId: config.executorId!,
      includeClosing: true,
    }),
  })

  const scheduleReconnect = (reason: string) => {
    stopped = daemonController.stopped
    if (stopped || reconnectTimer) {
      return
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      daemonController.reconnectTimer = null
      connect()
    }, 5000)
    daemonController.reconnectTimer = reconnectTimer

    updateWorkerRuntimeState({
      daemonMode: 'disconnected',
      connected: false,
      paired: true,
      effectiveCloudUrl: undefined,
      lastDisconnectAt: new Date().toISOString(),
      lastError: reason,
    })
  }

  const connect = () => {
    if (daemonController.stopped) {
      return
    }

    void (async () => {
      const connectAttemptId = ++connectAttemptSeq
      const bootstrapConfig = loadWorkerConfig()
      if (!bootstrapConfig.executorId || !bootstrapConfig.executorToken) {
        updateWorkerRuntimeState({
          daemonMode: 'unpaired',
          paired: false,
          connected: false,
          executorId: undefined,
          config: bootstrapConfig,
          effectiveCloudUrl: undefined,
          lastError: 'This worker is not paired yet, so it cannot connect to the control plane.',
        })
        return
      }

      updateWorkerRuntimeState({
        daemonMode: 'starting',
        connected: false,
        paired: true,
        executorId: bootstrapConfig.executorId,
        config: bootstrapConfig,
        effectiveCloudUrl: undefined,
        lastConnectAttemptAt: new Date().toISOString(),
      })

      config = await resolveConnectionRouteConfig(bootstrapConfig)
      if (daemonController.stopped || connectAttemptId !== connectAttemptSeq) {
        return
      }
      await restoreZellijTerminalSessions()
      if (daemonController.stopped || connectAttemptId !== connectAttemptSeq) {
        return
      }

      updateWorkerRuntimeState({
        daemonMode: 'starting',
        connected: false,
        paired: true,
        executorId: config.executorId,
        config,
        effectiveCloudUrl: config.cloudUrl,
        lastConnectAttemptAt: new Date().toISOString(),
      })

      try {
        const nextConnection = connectWorkerWebSocket(config, {
          onOpen() {
            if (daemonController.connection?.socket !== nextConnection.socket) {
              return
            }

            config = applyAssignedRouteToConfig(loadWorkerConfig())
            updateWorkerRuntimeState({
              daemonMode: 'running',
              paired: true,
              connected: true,
              executorId: config.executorId,
              config,
              effectiveCloudUrl: config.cloudUrl,
              lastError: undefined,
            })
            console.log('[worker] connected to the control plane')
            void refreshPreviewIngressState().finally(() => {
              if (daemonController.connection?.socket !== nextConnection.socket) {
                return
              }
              nextConnection.send(buildExecutorRegisterMessage())
              flushReliableOutboundQueue()
              drainExecutionQueue()
            })
          },
          onMessage(message) {
            if (daemonController.connection?.socket !== nextConnection.socket) {
              return
            }

            controlPlaneHandler?.handleMessage(message)
          },
          onError(message) {
            if (daemonController.connection?.socket !== nextConnection.socket) {
              return
            }

            if (config.executorId) {
              terminalSessions.clearClientAttachments({ executorId: config.executorId })
            }
            controlPlaneHandler?.abortActivePrompts()
            previewTunnelManager.closeAll('control plane websocket error')
            connection = null
            daemonController.connection = null
            controlPlaneHandler = null
            console.error('[worker] websocket error', message)
            scheduleReconnect(message)
          },
          onClose(event) {
            if (daemonController.connection?.socket !== nextConnection.socket) {
              return
            }

            if (config.executorId) {
              terminalSessions.clearClientAttachments({ executorId: config.executorId })
            }
            controlPlaneHandler?.abortActivePrompts()
            previewTunnelManager.closeAll('control plane websocket closed')
            connection = null
            daemonController.connection = null
            controlPlaneHandler = null
            const reason = event.reason?.trim() || `code=${event.code}`
            console.log('[worker] websocket disconnected from control plane', reason)
            scheduleReconnect(`Control plane connection closed (${reason})`)
          },
        })
        connection = nextConnection
        daemonController.connection = nextConnection
        controlPlaneHandler = createControlPlaneMessageHandler({
          expectedSocket: nextConnection.socket,
          getConnection: () => connection,
          getCurrentSocket: () => daemonController.connection?.socket,
          send: sendToControlPlane,
          requestShutdown,
          openTerminalSession,
          runTerminalCommand,
          terminalSessions,
          assignedTasks,
          activeExecutions,
          getConfig: () => config,
          setConfig: (nextConfig) => {
            config = applyAssignedRouteToConfig(nextConfig)
          },
          getQueuedTaskIds: () => queuedTaskIds,
          setQueuedTaskIds: (taskIds) => {
            queuedTaskIds = taskIds
          },
          getRunningTaskIds: () => runningTaskIds,
          setRunningTaskIds: (taskIds) => {
            runningTaskIds = taskIds
          },
          isDrainingForUpdate: () => updateDrainRequested,
          syncRuntimeState,
          drainExecutionQueue,
          promptQueueState,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'worker websocket init failed'
        console.error('[worker] failed to start websocket connection', message)
        scheduleReconnect(message)
      }
    })()
  }

  daemonController.connect = connect

  if (!config.executorId || !config.executorToken) {
    updateWorkerRuntimeState({
      daemonMode: 'unpaired',
      paired: false,
      connected: false,
      effectiveCloudUrl: undefined,
    })
    console.log(`[worker] not paired yet; run \`npx ${getWorkerPackageName()} connect --pairing-code <CODE>\` or use the local setup page first`)
  } else {
    connect()
  }

  updateCheckInterval = setInterval(() => {
    if (updateDrainRequested || autoUpdateCheckInFlight || !shouldRunIdleWorkerAutoUpdate({
      connected: getWorkerRuntimeState().connected,
      paired: Boolean(config.executorId && config.executorToken),
      queuedTaskCount: queuedTaskIds.length,
      runningTaskCount: runningTaskIds.length,
    })) {
      return
    }

    autoUpdateCheckInFlight = true
    void checkForWorkerUpdate().then((check) => {
      if (updateDrainRequested || !check.ok || !check.available) {
        return
      }

      updateDrainRequested = true
      pendingWorkerUpdate ??= { mode: 'auto', check }
      return startPendingWorkerUpdate()
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'worker auto update failed'
      console.error('[worker] auto update failed', message)
    }).finally(() => {
      autoUpdateCheckInFlight = false
    })
  }, 10000)

  heartbeatInterval = setInterval(() => {
    const activeConnection = connection
    if (!activeConnection || !getWorkerRuntimeState().connected) {
      return
    }

    const at = new Date().toISOString()
    updateWorkerRuntimeState({
      daemonMode: 'running',
      connected: true,
      paired: true,
      effectiveCloudUrl: config.cloudUrl,
      lastHeartbeatAt: at,
      queuedTaskIds,
      runningTaskIds,
      mesh: getWorkerMeshStatus(),
    })
    void refreshPreviewIngressState().finally(() => {
      if (connection?.socket !== activeConnection.socket) {
        return
      }
      activeConnection.send(buildExecutorHeartbeatMessage(at))
    })
  }, 5000)

  meshStatusInterval = setInterval(() => {
    const meshConfig = loadWorkerMeshRuntimeConfig(config)
    const mesh = refreshWorkerMeshRuntimeStatus(meshConfig)
    if (shouldRestartWorkerMeshRuntime(mesh, meshConfig)) {
      console.warn('[worker] EasyTier RPC is unavailable; restarting managed mesh runtime.')
      startWorkerMeshRuntime(meshConfig)
    }
    updateWorkerRuntimeState({
      mesh: getWorkerMeshStatus(),
    })
  }, 15000)
}
