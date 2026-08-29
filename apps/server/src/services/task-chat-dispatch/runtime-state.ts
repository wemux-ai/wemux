import { buildTaskChatSessionKey, type TaskChatSessionSnapshot } from '@shared/task-chat-session'
import { buildWorkspaceTaskExecutionView, mergeWorkspaceSession } from '@shared/task-workspace'
import type { WorkspaceSessionRuntimeSnapshot } from '@shared/workspace-session-history'
import type { ExecutionLog, Project, Task, WorkspaceSessionRuntimeStatus } from '@shared/types'
import { buildTaskChatSessionSnapshot } from '../../control-plane/task-chat-service'
import { writeTimelineEvent } from '../../integrations/opencode/task-chat-stream'
import { getWorkspaceSessionRecordForTaskContext } from '../../routes/task-route-support'
import {
  getWorkspaceSessionRuntimeSnapshot,
  upsertWorkspaceSessionRuntimeSnapshot,
} from '../../storage/postgres/workspace-session-history-store'
import { saveTask, saveWorkspaceSession } from '../../storage/app-state-store'
import { publishTaskChatPart } from '../task-chat-broadcast-service'
import { clusterConfig } from '../../cluster/config'
import { getNodeFresh } from '../../storage/postgres/distributed-task-store'
import {
  acquireTaskChatSessionLeaseDb,
  getTaskChatSessionLeaseDb,
  releaseTaskChatSessionLeaseDb,
  renewTaskChatSessionLeaseDb,
  type TaskChatSessionLease,
} from '../../storage/postgres/task-chat-queue-store'

export type TaskChatSessionSnapshotWithScope = TaskChatSessionSnapshot & {
  scope: TaskChatSessionSnapshot['scope'] & {
    workspaceSessionId?: string
  }
}

export const activeTaskChatDrainSessions = new Set<string>()
export const pendingTaskChatDrainSessions = new Set<string>()
const activeTaskChatAbortControllers = new Map<string, AbortController>()
const activeTaskChatExecutionSessions = new Map<string, { acquiredAt: number }>()
const pendingTaskChatStopReasons = new Map<string, { reason: 'user_stop'; message: string }>()
const workspaceRuntimeUpdateQueues = new Map<string, Promise<void>>()

const TASK_CHAT_EXECUTION_SLOT_CONTROLLER_GRACE_MS = 2_000

const enqueueWorkspaceRuntimeUpdate = (workspaceSessionId: string, update: () => Promise<void>) => {
  const previousUpdate = workspaceRuntimeUpdateQueues.get(workspaceSessionId) ?? Promise.resolve()
  const nextUpdate = previousUpdate
    .catch(() => undefined)
    .then(update)
    .finally(() => {
      if (workspaceRuntimeUpdateQueues.get(workspaceSessionId) === nextUpdate) {
        workspaceRuntimeUpdateQueues.delete(workspaceSessionId)
      }
    })
  workspaceRuntimeUpdateQueues.set(workspaceSessionId, nextUpdate)
  void nextUpdate.catch((error) => {
    console.warn('[task-chat-runtime] failed to persist workspace runtime update', {
      workspaceSessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

export const expireStaleTaskChatExecutionSlots = (
  now = Date.now(),
  controllerGraceMs = TASK_CHAT_EXECUTION_SLOT_CONTROLLER_GRACE_MS,
) => {
  for (const [sessionKey, slot] of activeTaskChatExecutionSessions) {
    if (activeTaskChatAbortControllers.has(sessionKey)) {
      continue
    }

    if (now - slot.acquiredAt <= controllerGraceMs) {
      continue
    }

    activeTaskChatExecutionSessions.delete(sessionKey)
    pendingTaskChatStopReasons.delete(sessionKey)
  }
}

export const normalizeTaskChatSessionSnapshot = (
  snapshot: TaskChatSessionSnapshot,
  workspaceId?: string,
  workspaceSessionId?: string,
): TaskChatSessionSnapshotWithScope => {
  const normalizedQueueItems = snapshot.queue.items.map((item: TaskChatSessionSnapshot['queue']['items'][number]) => ({
    ...item,
    workspaceId,
    workspaceSessionId,
  }))

  return {
    ...snapshot,
    scope: {
      ...snapshot.scope,
      workspaceId,
      workspaceSessionId,
    },
    queue: {
      ...snapshot.queue,
      items: normalizedQueueItems,
    },
  }
}

export const isTaskChatRuntimeBusy = (status: Task['agentRunningStatus'], runtimeStatus?: WorkspaceSessionRuntimeStatus) => {
  if (status === 'complete' || status === 'error') {
    return false
  }

  if (runtimeStatus === 'queued') {
    return false
  }

  if (status === 'thinking' || status === 'executing' || status === 'waiting') {
    return true
  }

  if (runtimeStatus) {
    return runtimeStatus === 'running' || runtimeStatus === 'waiting'
  }

  return false
}

export const bindTaskChatExecutionAbortSignal = (sessionKeys: string | string[], upstreamSignal?: AbortSignal) => {
  const normalizedSessionKeys = Array.from(new Set(
    (Array.isArray(sessionKeys) ? sessionKeys : [sessionKeys])
      .map((value) => value.trim())
      .filter(Boolean),
  ))
  const localController = new AbortController()
  const combinedController = new AbortController()

  const abortCombined = (reason?: unknown) => {
    if (!combinedController.signal.aborted) {
      combinedController.abort(reason)
    }
  }

  const handleLocalAbort = () => {
    abortCombined(localController.signal.reason)
  }

  const handleUpstreamAbort = () => {
    abortCombined(upstreamSignal?.reason)
  }

  localController.signal.addEventListener('abort', handleLocalAbort, { once: true })
  upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true })
  for (const sessionKey of normalizedSessionKeys) {
    activeTaskChatAbortControllers.set(sessionKey, localController)
  }

  const pendingStopReason = normalizedSessionKeys
    .map((sessionKey) => pendingTaskChatStopReasons.get(sessionKey))
    .find((reason) => reason !== undefined)
  if (pendingStopReason) {
    for (const sessionKey of normalizedSessionKeys) {
      pendingTaskChatStopReasons.delete(sessionKey)
    }
    localController.abort(pendingStopReason)
  }

  if (upstreamSignal?.aborted) {
    abortCombined(upstreamSignal.reason)
  }

  return {
    signal: combinedController.signal,
    cleanup() {
      localController.signal.removeEventListener('abort', handleLocalAbort)
      upstreamSignal?.removeEventListener('abort', handleUpstreamAbort)
      for (const sessionKey of normalizedSessionKeys) {
        pendingTaskChatStopReasons.delete(sessionKey)
        if (activeTaskChatAbortControllers.get(sessionKey) === localController) {
          activeTaskChatAbortControllers.delete(sessionKey)
        }
      }
    },
  }
}

export const stopTaskChatExecution = (params: {
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  const controller = activeTaskChatAbortControllers.get(sessionKey)
  if (!controller) {
    if (!activeTaskChatExecutionSessions.has(sessionKey)) {
      return false
    }

    pendingTaskChatStopReasons.set(sessionKey, { reason: 'user_stop', message: '已停止' })
    return true
  }

  controller.abort({ reason: 'user_stop', message: '已停止' })
  return true
}

// 跨节点 stop 路由依赖：测试可替换（单测不依赖真实 fetch 与节点表）。
export const taskChatStopRoutingDeps = {
  getLease: getTaskChatSessionLeaseDb,
  getNodeFresh: (nodeId: string) => getNodeFresh(nodeId),
  fetchRemoteStop: async (params: {
    relayUrl: string
    taskId: string
    workspaceId?: string
    workspaceSessionId?: string
  }): Promise<{ ok: boolean; stopped: boolean }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(
        `${params.relayUrl}/api/internal/cluster/task-chat/stop`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(clusterConfig.sharedToken ? { 'x-cluster-token': clusterConfig.sharedToken } : {}),
          },
          body: JSON.stringify({
            taskId: params.taskId,
            workspaceId: params.workspaceId,
            workspaceSessionId: params.workspaceSessionId,
          }),
          signal: controller.signal,
        },
      )
      const payload = await response.json().catch(() => null) as { stopped?: boolean } | null
      return { ok: response.ok, stopped: payload?.stopped === true }
    } finally {
      clearTimeout(timer)
    }
  },
}

// 跨节点 stop：执行租约的 owning node 才持有 AbortController。
// 本节点持有 → 本地 abort；远端持有 → 走 authenticated internal relay；无租约 → 退化为本地尝试。
export const stopTaskChatExecutionAcrossNodes = async (params: {
  taskId: string
  workspaceId?: string
  workspaceSessionId?: string
}): Promise<{ stopped: boolean; remote: boolean }> => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  const lease = await taskChatStopRoutingDeps.getLease(sessionKey)
  if (lease && lease.claimedByNodeId !== clusterConfig.nodeId) {
    const node = await taskChatStopRoutingDeps.getNodeFresh(lease.claimedByNodeId)
    const relayUrl = (node?.relayUrl || node?.url || '').replace(/\/+$/, '')
    if (!relayUrl) {
      console.warn('[task-chat-stop] owning node relay url missing', {
        sessionKey,
        owningNodeId: lease.claimedByNodeId,
      })
      return { stopped: stopTaskChatExecution(params), remote: false }
    }

    try {
      const remote = await taskChatStopRoutingDeps.fetchRemoteStop({
        relayUrl,
        taskId: params.taskId,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId,
      })
      if (!remote.ok) {
        console.warn('[task-chat-stop] remote stop relay failed', {
          sessionKey,
          owningNodeId: lease.claimedByNodeId,
        })
        return { stopped: false, remote: true }
      }
      return { stopped: remote.stopped, remote: true }
    } catch (error) {
      console.warn('[task-chat-stop] remote stop relay error', {
        sessionKey,
        owningNodeId: lease.claimedByNodeId,
        error: error instanceof Error ? error.message : String(error),
      })
      return { stopped: false, remote: true }
    }
  }

  return { stopped: stopTaskChatExecution(params), remote: false }
}

export const markTaskChatRuntimeStopped = (params: {
  task: Task
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const stoppedAt = new Date().toISOString()
  if (!params.workspaceId) {
    const nextTask: Task = {
      ...params.task,
      needsHumanConfirm: false,
      agentRunningStatus: 'idle',
      currentStep: '已停止',
      updatedAt: stoppedAt,
    }
    saveTask(nextTask)
    return {
      task: nextTask,
      session: undefined,
    }
  }

  const workspaceSession = getWorkspaceSessionRecordForTaskContext(
    params.task.id,
    params.workspaceId,
    params.workspaceSessionId,
  )
  if (!workspaceSession) {
    return {
      task: params.task,
      session: undefined,
    }
  }

  const nextSession = mergeWorkspaceSession(params.task, workspaceSession, {
    needsHumanConfirm: false,
    agentRunningStatus: 'idle',
    runtimeStatus: 'cancelled',
    terminalReason: '已停止',
    currentStep: '已停止',
    lastRuntimeEventAt: stoppedAt,
    runtimeSequence: workspaceSession.runtimeSequence + 1,
    updatedAt: stoppedAt,
    lastActiveAt: stoppedAt,
  })
  saveWorkspaceSession(nextSession)
  return {
    task: params.task,
    session: nextSession,
  }
}

export const tryAcquireTaskChatExecutionSlot = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  expireStaleTaskChatExecutionSlots()
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  if (activeTaskChatExecutionSessions.has(sessionKey)) {
    return false
  }

  activeTaskChatExecutionSessions.set(sessionKey, { acquiredAt: Date.now() })
  return true
}

// 多节点执行租约：DB lease 是跨节点硬裁决，本地 slot 只做同进程快速提示。
// 两者都拿到才算成功；DB lease 失败（其他节点执行中）时本地 slot 不占用。
export const tryAcquireTaskChatExecutionLease = async (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}): Promise<TaskChatSessionLease | null> => {
  expireStaleTaskChatExecutionSlots()
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  if (activeTaskChatExecutionSessions.has(sessionKey)) {
    return null
  }

  const lease = await acquireTaskChatSessionLeaseDb({
    sessionKey,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })
  if (!lease) {
    return null
  }

  activeTaskChatExecutionSessions.set(sessionKey, { acquiredAt: Date.now() })
  return lease
}

export const releaseTaskChatExecutionLease = async (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  lease?: TaskChatSessionLease | null
}) => {
  releaseTaskChatExecutionSlot({
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
  })
  if (params.lease) {
    await releaseTaskChatSessionLeaseDb({
      sessionKey: params.lease.sessionKey,
      leaseId: params.lease.leaseId,
    })
  }
}

export const renewTaskChatExecutionLease = async (lease: TaskChatSessionLease) => {
  const renewed = await renewTaskChatSessionLeaseDb({
    sessionKey: lease.sessionKey,
    leaseId: lease.leaseId,
  })
  if (!renewed) {
    console.warn('[task-chat-runtime] session lease renewal lost', {
      sessionKey: lease.sessionKey,
      leaseId: lease.leaseId,
    })
  }
  return renewed
}

export const releaseTaskChatExecutionSlot = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const sessionKey = buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId)
  activeTaskChatExecutionSessions.delete(sessionKey)
  pendingTaskChatStopReasons.delete(sessionKey)
}

export const isTaskChatExecutionActive = (params: {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  expireStaleTaskChatExecutionSlots()
  return activeTaskChatExecutionSessions.has(buildTaskChatSessionKey(params.taskId, params.workspaceId, params.workspaceSessionId))
}

export const isWorkspaceSessionExecutionActive = (workspaceId?: string, workspaceSessionId?: string) => {
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  const normalizedWorkspaceSessionId = workspaceSessionId?.trim() || ''
  if (!normalizedWorkspaceId || !normalizedWorkspaceSessionId) {
    return false
  }

  const workspaceScopeSuffix = `:workspace:${normalizedWorkspaceId}::${normalizedWorkspaceSessionId}`
  const workspaceSessionKey = `workspace-session:${normalizedWorkspaceSessionId}`
  expireStaleTaskChatExecutionSlots()
  for (const sessionKey of activeTaskChatExecutionSessions.keys()) {
    if (sessionKey === workspaceSessionKey || sessionKey.endsWith(workspaceScopeSuffix)) {
      return true
    }
  }

  return false
}

export const publishTaskChatTimelineEvent = (
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  event: Parameters<typeof writeTimelineEvent>[1],
) => {
  publishTaskChatPart(buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId), {
    type: 'timeline_event',
    data: event,
  })
}

export const publishTaskChatTaskUpdate = (
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  data: {
    id: string
    agentRunningStatus: Task['agentRunningStatus']
    currentStep: string
    toolCalls?: Task['toolCalls']
    logs?: ExecutionLog[]
  },
) => {
  publishTaskChatPart(buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId), {
    type: 'task',
    data,
  })

  if (workspaceId && workspaceSessionId) {
    const runtimeStatus = data.agentRunningStatus === 'waiting'
      ? 'waiting'
      : data.agentRunningStatus === 'executing'
        ? 'running'
        : data.agentRunningStatus === 'thinking'
          ? 'queued'
          : data.agentRunningStatus === 'complete'
            ? 'completed'
            : data.agentRunningStatus === 'error'
              ? 'error'
              : 'idle'

    enqueueWorkspaceRuntimeUpdate(workspaceSessionId, async () => {
      const current = await getWorkspaceSessionRuntimeSnapshot(workspaceSessionId)
      await upsertWorkspaceSessionRuntimeSnapshot({
        sessionId: workspaceSessionId,
        taskId,
        workspaceId,
        agentRunningStatus: data.agentRunningStatus,
        runtimeStatus,
        currentStep: data.currentStep,
        queueStatus: data.agentRunningStatus === 'thinking' ? 'queued' : isTaskChatRuntimeBusy(data.agentRunningStatus, runtimeStatus) ? 'running' : 'idle',
        activeToolCalls: (data.toolCalls ?? []).filter((toolCall) => !toolCall.finishedAt),
        lastEventSeq: current?.lastEventSeq ?? 0,
        lastEventAt: current?.lastEventAt,
        updatedAt: new Date().toISOString(),
      })
    })
  }
}

export const publishTaskChatSessionUpdate = (
  taskId: string,
  workspaceId: string | undefined,
  workspaceSessionId: string | undefined,
  task: Task,
  project: Project,
) => {
  const snapshot = normalizeTaskChatSessionSnapshot(buildTaskChatSessionSnapshot({
    task,
    project,
    workspaceId,
    workspaceSessionId,
  }), workspaceId, workspaceSessionId)

  publishTaskChatPart(buildTaskChatSessionKey(taskId, workspaceId, workspaceSessionId), {
    type: 'session',
    data: snapshot,
  })

  if (workspaceId && workspaceSessionId) {
    enqueueWorkspaceRuntimeUpdate(workspaceSessionId, async () => {
      const current = await getWorkspaceSessionRuntimeSnapshot(workspaceSessionId)
      const runtimeBusy = isTaskChatRuntimeBusy(snapshot.runtime.agentRunningStatus, snapshot.runtime.runtimeStatus)
      const runtimeSnapshot: WorkspaceSessionRuntimeSnapshot = {
        sessionId: workspaceSessionId,
        taskId,
        workspaceId,
        agentRunningStatus: snapshot.runtime.agentRunningStatus,
        runtimeStatus: snapshot.runtime.runtimeStatus,
        currentStep: snapshot.runtime.currentStep,
        queueStatus: snapshot.queue.status === 'queued'
          ? 'queued'
          : runtimeBusy
            ? 'running'
            : 'idle',
        activeToolCalls: runtimeBusy ? (current?.activeToolCalls ?? []) : [],
        lastEventSeq: current?.lastEventSeq ?? 0,
        lastEventAt: current?.lastEventAt ?? snapshot.conversation.latestMessageAt,
        updatedAt: new Date().toISOString(),
      }
      await upsertWorkspaceSessionRuntimeSnapshot(runtimeSnapshot)
    })
  }
}

export const resolveScopedRuntimeTask = (task: Task, workspaceId?: string, workspaceSessionId?: string) => {
  if (!workspaceId) {
    return task
  }

  const session = getWorkspaceSessionRecordForTaskContext(task.id, workspaceId, workspaceSessionId)
  return buildWorkspaceTaskExecutionView(task, session)
}
