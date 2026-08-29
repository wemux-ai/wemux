// [INPUT]: 任务生命周期事件
// [OUTPUT]: 定时器/状态管理
// [POS]: 任务生命周期管理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { attachTaskResultDelivery } from '@shared/distributed-task-result'
import type { RuntimeEnvironmentExecutionPayload } from '@shared/runtime-environment'
import type { DistributedTask, ExecutorToControlPlaneMessage, WorkerProjectBinding } from '@shared/types'
import { executeAssignedTask } from '../execution/task-executor'
import { createWorkerTaskEventSequence } from './task-event-sequence'

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>[]>()

const clearTaskTimers = (taskId: string) => {
  const timers = pendingTimers.get(taskId)
  if (!timers) {
    return
  }

  for (const timer of timers) {
    clearTimeout(timer)
  }
  pendingTimers.delete(taskId)
}

export const buildCancelledTask = (task: DistributedTask, executorId: string, reason?: string): DistributedTask => {
  const now = new Date().toISOString()
  return {
    ...task,
    status: 'cancelled',
    executorNodeId: executorId,
    completedAt: now,
    updatedAt: now,
    result: attachTaskResultDelivery({
      taskId: task.id,
      status: 'cancelled',
      returnMode: task.returnMode,
      summary: reason ?? '任务已取消',
      filesChanged: [],
      startedAt: task.startedAt ?? now,
      completedAt: now,
      durationSec: 0,
      executorNodeId: executorId,
    }, {
      repoUrl: task.repoUrl,
      baseBranch: task.defaultBranch,
      taskDescription: task.description,
    }),
  }
}

export const clearWorkerTaskTimers = clearTaskTimers

export const startTaskLifecycle = (params: {
  task: DistributedTask
  runtimeEnvironment?: RuntimeEnvironmentExecutionPayload
  featureFlags?: import('@shared/user-experimental-settings').ExecutorFeatureFlags
  executorId: string
  workspaceRoot: string
  projectBindings?: WorkerProjectBinding[]
  send: (message: ExecutorToControlPlaneMessage) => boolean
  onStart: (taskId: string) => void
  onFinish: (taskId: string) => void
}) => {
  const { task, executorId, workspaceRoot, projectBindings, send } = params
  const abortController = new AbortController()
  const nextEventSequence = createWorkerTaskEventSequence(task.workerEventSequence)

  const timers = [
    setTimeout(() => {
      params.onStart(task.id)
      void executeAssignedTask({
        task,
        runtimeEnvironment: params.runtimeEnvironment,
        featureFlags: params.featureFlags,
        executorId,
        workspaceRoot,
        projectBindings,
        signal: abortController.signal,
        emit(status, message) {
          if (abortController.signal.aborted) {
            return
          }

          send({
            type: 'task.event',
            taskId: task.id,
            idempotencyKey: task.idempotencyKey,
            executorId,
            sequence: nextEventSequence(),
            status,
            message,
            at: new Date().toISOString(),
          })
        },
      }).then(({ task: completedTask }) => {
        if (abortController.signal.aborted) {
          return
        }

        params.onFinish(task.id)
        send({
          type: 'task.result',
          executorId,
          sequence: nextEventSequence(),
          task: completedTask,
        })
        clearTaskTimers(task.id)
      })
    }, 20),
  ]

  pendingTimers.set(task.id, timers)

  return {
    abort() {
      abortController.abort()
      params.onFinish(task.id)
      clearTaskTimers(task.id)
    },
  }
}
