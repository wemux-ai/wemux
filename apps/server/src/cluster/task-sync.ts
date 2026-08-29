// [INPUT]: Sequenced distributed-task events/results from worker executors.
// [OUTPUT]: Persisted task, run, and workspace-session runtime state with ordered broadcasts.
// [POS]: Control-plane convergence boundary for worker execution outcomes.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createExecutionLog } from '@shared/task-orchestrator'
import { attachTaskResultDelivery } from '@shared/distributed-task-result'
import { mergeWorkspaceSession } from '@shared/task-workspace'
import type { DistributedTask, Task } from '@shared/types'
import { getTaskRunByDistributedTaskId, getWorkspaceSession, hydrateClusterState, loadState, saveTaskAndWait, saveTaskRunAndWait, saveWorkspaceSessionAndWait } from '../storage/app-state-store'
import { recordUsageEvent } from '../services/usage-event-service'
import { track } from '../services/telemetry-service'
import { getServerAgentLabel } from '../services/server-agent'
import { broadcastState } from '../services/state-stream'
import {
  toAgentRunningStatusFromRuntimeStatus,
  toWorkspaceSessionRuntimeStatusFromDistributedStatus,
} from '../services/task-workspace-runtime-state'
import { getDistributedTask, getWorkspace, updateDistributedTaskAndWait } from '../storage/distributed-task-store'
import {
  finishWorkspaceRunTimeline,
  recordWorkspaceRunTimelineProgress,
} from '../services/workspace-session-operation-timeline'

const recentEventFingerprints = new Map<string, number>()
export const createTaskSyncSerializer = () => {
  const taskSyncTails = new Map<string, Promise<void>>()

  return <T>(taskId: string, operation: () => Promise<T>) => {
    const previous = taskSyncTails.get(taskId)
    const current = previous ? previous.then(operation) : operation()
    const tail = current.then(() => undefined, () => undefined)
    taskSyncTails.set(taskId, tail)
    void tail.finally(() => {
      if (taskSyncTails.get(taskId) === tail) {
        taskSyncTails.delete(taskId)
      }
    })
    return current
  }
}

export const persistBeforeBroadcast = async (
  persistence: Array<() => Promise<unknown>>,
  broadcast: () => void,
) => {
  for (const persist of persistence) {
    await persist()
  }
  broadcast()
}

const serializeTaskSync = createTaskSyncSerializer()

export const isNewerWorkerTaskEvent = (
  task: Pick<DistributedTask, 'workerEventSequence'>,
  sequence?: number,
) => {
  if (typeof sequence === 'undefined') {
    return true
  }

  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    return false
  }

  return sequence > (task.workerEventSequence ?? 0)
}

export const canAcceptWorkerTaskResult = (
  task: Pick<DistributedTask, 'status' | 'workerEventSequence'>,
  sequence?: number,
) => {
  if (task.status === 'lost') {
    return typeof sequence === 'number' && isNewerWorkerTaskEvent(task, sequence)
  }

  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed' || task.status === 'timed_out') {
    return false
  }

  return isNewerWorkerTaskEvent(task, sequence)
}

const shouldSuppressEvent = (taskId: string, status: DistributedTask['status'], message: string, at: string) => {
  const fingerprint = `${taskId}:${status}:${message}`
  const nextAt = new Date(at).getTime()
  const previousAt = recentEventFingerprints.get(fingerprint)
  recentEventFingerprints.set(fingerprint, nextAt)

  if (previousAt && nextAt - previousAt < 1500) {
    return true
  }

  if (recentEventFingerprints.size > 500) {
    const threshold = Date.now() - 60_000
    for (const [key, value] of recentEventFingerprints.entries()) {
      if (value < threshold) {
        recentEventFingerprints.delete(key)
      }
    }
  }

  return false
}

const upsertTaskLog = (task: Task, role: 'system' | 'agent' | 'review', content: string, updatedAt: string): Task => ({
  ...task,
  updatedAt,
  logs: [...task.logs, createExecutionLog(role, content)],
})

const broadcastClusterState = () => {
  broadcastState(hydrateClusterState(loadState()))
}

const toTaskRunningStatus = (status: DistributedTask['status']): Task['agentRunningStatus'] => {
  if (status === 'completed') return 'complete'
  if (status === 'failed' || status === 'lost' || status === 'timed_out') return 'error'
  if (status === 'cancelled') return 'idle'
  if (status === 'queued' || status === 'draft') return 'thinking'
  return 'executing'
}

const toTaskStatus = (status: DistributedTask['status'], current: Task['status']): Task['status'] => {
  if (status === 'completed') return 'in_review'
  if (status === 'assigned' || status === 'preparing' || status === 'executing' || status === 'syncing_back') return 'in_progress'
  if (status === 'queued' || status === 'draft' || status === 'lost' || status === 'failed' || status === 'cancelled' || status === 'timed_out') {
    return current === 'done' ? current : 'todo'
  }
  return current
}

const toWorkspaceRunQueueStatus = (status: DistributedTask['status']) => {
  if (status === 'queued' || status === 'draft') return 'queued' as const
  if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'timed_out' || status === 'lost') return 'idle' as const
  return 'running' as const
}

const normalizeFailureMessage = (message?: string, fallback = '执行失败，未返回详细异常信息。') => {
  const normalized = message?.trim()
  return normalized && normalized.length > 0 ? normalized : fallback
}

const syncDistributedTaskEventNow = async (params: {
  taskId: string
  sequence?: number
  status: DistributedTask['status']
  message: string
  at: string
}) => {
  const distributedTask = getDistributedTask(params.taskId)
  if (!distributedTask) {
    return null
  }

  if (!isNewerWorkerTaskEvent(distributedTask, params.sequence)) {
    return distributedTask
  }

  if (shouldSuppressEvent(params.taskId, params.status, params.message, params.at)) {
    return distributedTask
  }

  const normalizedMessage = params.status === 'failed' || params.status === 'lost' || params.status === 'timed_out'
    ? normalizeFailureMessage(params.message)
    : params.message
  const nextDistributedTask: DistributedTask = {
    ...distributedTask,
    workerEventSequence: params.sequence ?? distributedTask.workerEventSequence,
    status: params.status,
    errorMessage: params.status === 'failed' || params.status === 'lost' || params.status === 'timed_out'
      ? normalizeFailureMessage(distributedTask.errorMessage ?? normalizedMessage)
      : undefined,
    updatedAt: params.at,
  }
  const persistence: Array<() => Promise<unknown>> = [() => updateDistributedTaskAndWait(nextDistributedTask)]
  const taskRun = getTaskRunByDistributedTaskId(params.taskId)
  if (taskRun) {
    persistence.push(() => saveTaskRunAndWait({
      ...taskRun,
      executorNodeId: distributedTask.executorNodeId,
      status: params.status,
      updatedAt: params.at,
    }))
  }

  const state = loadState()
  const originTask = state.tasks.find((item) => item.id === distributedTask.originTaskId)
  if (!originTask) {
    await persistBeforeBroadcast(persistence, broadcastClusterState)
    return nextDistributedTask
  }

  const nextTask = upsertTaskLog(originTask, params.status === 'failed' ? 'review' : 'system', `[分布式 ${params.status}] ${normalizedMessage}`, params.at)
  const runtimeStatus = toWorkspaceSessionRuntimeStatusFromDistributedStatus(params.status)
  if (distributedTask.workspaceId) {
    const session = distributedTask.workspaceSessionId
      ? state.workspaceSessions.find((item) => item.id === distributedTask.workspaceSessionId && item.workspaceId === distributedTask.workspaceId) ?? null
      : getWorkspaceSession(distributedTask.workspaceId)
    if (session) {
      persistence.push(() => saveWorkspaceSessionAndWait(mergeWorkspaceSession(originTask, session, {
        executorNodeId: distributedTask.executorNodeId,
        agentType: distributedTask.agentType,
        executionModel: distributedTask.executionModel,
        distributedTaskId: distributedTask.id,
        needsHumanConfirm: toTaskStatus(params.status, originTask.status) === 'in_review',
        runtimeStatus,
        runtimeOwnerExecutorId: distributedTask.executorNodeId,
        runtimeStartedAt: session.runtimeStartedAt ?? params.at,
        lastRuntimeEventAt: params.at,
        terminalReason: runtimeStatus === 'error' || runtimeStatus === 'lost' ? normalizeFailureMessage(normalizedMessage) : undefined,
        runtimeSequence: session.runtimeSequence + 1,
        currentStep: normalizedMessage,
        agentRunningStatus: toAgentRunningStatusFromRuntimeStatus(runtimeStatus),
        updatedAt: params.at,
        lastActiveAt: params.at,
      })))
    }
  }
  if (taskRun && distributedTask.workspaceId && distributedTask.workspaceSessionId) {
    persistence.push(() => recordWorkspaceRunTimelineProgress({
      taskId: distributedTask.originTaskId,
      workspaceId: distributedTask.workspaceId!,
      workspaceSessionId: distributedTask.workspaceSessionId!,
      taskRunId: taskRun.id,
      eventId: typeof params.sequence === 'number'
        ? `workspace-run:${taskRun.id}:worker:${params.sequence}`
        : undefined,
      message: normalizedMessage,
      at: params.at,
      agentRunningStatus: toAgentRunningStatusFromRuntimeStatus(runtimeStatus),
      runtimeStatus,
      queueStatus: toWorkspaceRunQueueStatus(params.status),
    }))
  }
  persistence.push(() => saveTaskAndWait({
    ...nextTask,
    status: toTaskStatus(params.status, originTask.status),
    needsHumanConfirm: toTaskStatus(params.status, originTask.status) === 'in_review',
    currentStep: normalizedMessage,
    agentRunningStatus: toTaskRunningStatus(params.status),
  }))
  // 产品一手 telemetry：任务首次进入审核中（首个交付），供激活/留存漏斗使用；
  // 只在状态从未审核变为审核中时记录，避免每次同步重复打点。
  if (toTaskStatus(params.status, originTask.status) === 'in_review' && originTask.status !== 'in_review') {
    void track({
      eventType: 'task_first_review',
      userId: originTask.createdBy?.type === 'user' ? originTask.createdBy.id : undefined,
      projectId: originTask.projectId,
      taskId: originTask.id,
      workspaceId: distributedTask.workspaceId ?? undefined,
      executorNodeId: distributedTask.executorNodeId ?? undefined,
    })
  }
  await persistBeforeBroadcast(persistence, broadcastClusterState)

  return nextDistributedTask
}

export const syncDistributedTaskEvent = (params: Parameters<typeof syncDistributedTaskEventNow>[0]) => (
  serializeTaskSync(params.taskId, () => syncDistributedTaskEventNow(params)).catch((error) => {
    console.error('[task-sync] persist distributed task event failed', error)
    return null
  })
)

const syncDistributedTaskResultNow = async (task: DistributedTask, sequence?: number) => {
  const currentTask = getDistributedTask(task.id)
  if (currentTask && !canAcceptWorkerTaskResult(currentTask, sequence)) {
    return null
  }

  const sequencedTask: DistributedTask = {
    ...task,
    workerEventSequence: sequence ?? task.workerEventSequence ?? currentTask?.workerEventSequence,
  }
  const state = loadState()
  const originTask = state.tasks.find((item) => item.id === sequencedTask.originTaskId)
  const result = sequencedTask.result
    ? attachTaskResultDelivery(sequencedTask.result, {
        repoUrl: sequencedTask.repoUrl,
        baseBranch: originTask?.baseBranch || sequencedTask.defaultBranch,
        taskTitle: originTask?.title,
        taskDescription: originTask?.description || sequencedTask.description,
      })
    : undefined
  const nextDistributedTask = result ? { ...sequencedTask, result } : sequencedTask

  await updateDistributedTaskAndWait(nextDistributedTask)
  const taskRun = getTaskRunByDistributedTaskId(task.id)

  if (!originTask || !result) {
    broadcastClusterState()
    return nextDistributedTask
  }

  const success = result.status === 'completed'
  let persistedDistributedTask = nextDistributedTask

  if (success && nextDistributedTask.syncBackStrategy === 'pull-branch' && persistedDistributedTask.result?.delivery) {
    const branchUpdatedAt = new Date().toISOString()
    persistedDistributedTask = {
      ...persistedDistributedTask,
      updatedAt: branchUpdatedAt,
      result: {
        ...persistedDistributedTask.result,
        delivery: {
          ...persistedDistributedTask.result.delivery,
          syncFailureReason: '当前版本先展示 branch / PR 准备信息，暂不支持自动拉取远端分支。',
        },
      },
    }
  }

  if (persistedDistributedTask !== nextDistributedTask) {
    await updateDistributedTaskAndWait(persistedDistributedTask)
  }

  const resultSummary = result.summary.trim()
  const resultOutput = result.output?.trim()
  const fallbackFailureReason = normalizeFailureMessage(
    persistedDistributedTask.errorMessage ?? resultSummary ?? resultOutput,
  )
  const summary = resultSummary || fallbackFailureReason
  const chatOutput = result.output?.trim() || result.summary.trim() || summary
  const nextTask = upsertTaskLog(originTask, success ? 'agent' : 'review', chatOutput, persistedDistributedTask.updatedAt)
  const runtimeStatus = result.status === 'cancelled'
    ? 'cancelled'
    : success
      ? 'completed'
      : 'error'
  const persistence: Array<() => Promise<unknown>> = [() => saveTaskAndWait({
    ...nextTask,
    status: success ? 'in_review' : 'todo',
    needsHumanConfirm: success,
    currentStep: summary,
    agentRunningStatus: result.status === 'cancelled' ? 'idle' : success ? 'complete' : 'error',
  })]
  if (persistedDistributedTask.workspaceId) {
    const session = persistedDistributedTask.workspaceSessionId
      ? loadState().workspaceSessions.find((item) => item.id === persistedDistributedTask.workspaceSessionId && item.workspaceId === persistedDistributedTask.workspaceId) ?? null
      : getWorkspaceSession(persistedDistributedTask.workspaceId)
    if (session) {
      persistence.push(() => saveWorkspaceSessionAndWait(mergeWorkspaceSession(originTask, session, {
        executorNodeId: persistedDistributedTask.executorNodeId,
        agentType: persistedDistributedTask.agentType,
        executionModel: persistedDistributedTask.executionModel,
        distributedTaskId: persistedDistributedTask.id,
        agentSessionId: result.agentSessionId ?? result.opencodeSessionId ?? session.agentSessionId ?? session.opencodeSessionId,
        opencodeSessionId: result.opencodeSessionId ?? session.opencodeSessionId,
        needsHumanConfirm: success,
        runtimeStatus,
        runtimeOwnerExecutorId: persistedDistributedTask.executorNodeId,
        runtimeSessionId: result.agentSessionId ?? result.opencodeSessionId ?? session.runtimeSessionId,
        runtimeStartedAt: session.runtimeStartedAt ?? persistedDistributedTask.startedAt ?? persistedDistributedTask.updatedAt,
        lastRuntimeEventAt: persistedDistributedTask.updatedAt,
        terminalReason: result.status === 'cancelled' ? '任务已取消' : success ? undefined : fallbackFailureReason,
        runtimeSequence: session.runtimeSequence + 1,
        currentStep: summary,
        agentRunningStatus: toAgentRunningStatusFromRuntimeStatus(runtimeStatus),
        updatedAt: persistedDistributedTask.updatedAt,
        lastActiveAt: persistedDistributedTask.updatedAt,
      })))
    }
  }
  if (taskRun) {
    persistence.push(() => saveTaskRunAndWait({
      ...taskRun,
      executorNodeId: task.executorNodeId,
      agentSessionId: result.agentSessionId ?? result.opencodeSessionId ?? taskRun.agentSessionId ?? taskRun.opencodeSessionId,
      opencodeSessionId: result.opencodeSessionId ?? taskRun.opencodeSessionId,
      executionModel: task.executionModel ?? taskRun.executionModel,
      usage: result.usage ?? taskRun.usage,
      status: result.status,
      summary: result.summary,
      result,
      updatedAt: persistedDistributedTask.updatedAt,
    }))
    // 统一 usage 事件：分布式任务执行链路（发起人 = 任务创建者，回退 workspace owner）。
    const usageOwnerUserId = originTask.createdBy?.id?.trim()
      || (persistedDistributedTask.workspaceId ? getWorkspace(persistedDistributedTask.workspaceId)?.ownerUserId : undefined)
    if (usageOwnerUserId) {
      persistence.push(() => recordUsageEvent({
        runKind: 'task',
        runId: taskRun.id,
        agentName: persistedDistributedTask.agentType ? getServerAgentLabel(persistedDistributedTask.agentType) : undefined,
        userId: usageOwnerUserId,
        taskId: persistedDistributedTask.originTaskId,
        projectId: taskRun.projectId,
        workspaceId: persistedDistributedTask.workspaceId,
        workspaceSessionId: persistedDistributedTask.workspaceSessionId,
        executorNodeId: persistedDistributedTask.executorNodeId,
        executionModel: task.executionModel ?? taskRun.executionModel,
        usage: result.usage ?? taskRun.usage,
      }))
    }
  }
  if (taskRun && persistedDistributedTask.workspaceId && persistedDistributedTask.workspaceSessionId) {
    persistence.push(() => finishWorkspaceRunTimeline({
      taskId: persistedDistributedTask.originTaskId,
      workspaceId: persistedDistributedTask.workspaceId!,
      workspaceSessionId: persistedDistributedTask.workspaceSessionId!,
      taskRunId: taskRun.id,
      agentType: persistedDistributedTask.agentType,
      result,
      summary,
      output: chatOutput,
      startedAt: taskRun.createdAt,
      finishedAt: result.completedAt || persistedDistributedTask.updatedAt,
      sequence,
      usage: result.usage ?? taskRun.usage,
    }))
  }
  await persistBeforeBroadcast(persistence, broadcastClusterState)
  return persistedDistributedTask
}

export const syncDistributedTaskResult = (task: DistributedTask, sequence?: number) => (
  serializeTaskSync(task.id, () => syncDistributedTaskResultNow(task, sequence)).catch((error) => {
    console.error('[task-sync] persist distributed task result failed', error)
    return null
  })
)

export const markDistributedTaskLost = (task: DistributedTask, reason: string) => {
  const at = new Date().toISOString()
  const nextTask: DistributedTask = {
    ...task,
    status: 'lost',
    errorMessage: reason,
    updatedAt: at,
  }
  void syncDistributedTaskEvent({ taskId: task.id, status: 'lost', message: reason, at })
  return nextTask
}
