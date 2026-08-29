// [INPUT]: task 消息（assign/cancel/retry）
// [OUTPUT]: 幂等处理/本地队列
// [POS]: task 消息处理
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ControlPlaneToExecutorMessage } from '@shared/types'
import { buildCancelledTask, clearWorkerTaskTimers } from '../task-lifecycle'
import type { ControlPlaneMessageHandlerParams } from './types'

export const handleTaskMessage = (
  message: ControlPlaneToExecutorMessage,
  params: ControlPlaneMessageHandlerParams,
) => {
  const config = params.getConfig()

  if (message.type === 'task.assign') {
    const runningTaskIds = params.getRunningTaskIds()
    const queuedTaskIds = params.getQueuedTaskIds()
    if (params.assignedTasks.has(message.task.id) || runningTaskIds.includes(message.task.id) || queuedTaskIds.includes(message.task.id)) {
      params.assignedTasks.set(message.task.id, {
        task: message.task,
        runtimeEnvironment: message.runtimeEnvironment,
        featureFlags: message.featureFlags,
      })
      return true
    }

    params.assignedTasks.set(message.task.id, {
      task: message.task,
      runtimeEnvironment: message.runtimeEnvironment,
      featureFlags: message.featureFlags,
    })
    params.setQueuedTaskIds([...queuedTaskIds, message.task.id])
    params.syncRuntimeState()
    params.send({
      type: 'task.ack',
      taskId: message.task.id,
      idempotencyKey: message.task.idempotencyKey,
      executorId: config.executorId!,
      accepted: true,
    })
    params.drainExecutionQueue()
    return true
  }

  if (message.type === 'task.cancel') {
    const assignedTask = params.assignedTasks.get(message.taskId)
    params.activeExecutions.get(message.taskId)?.abort()
    params.activeExecutions.delete(message.taskId)
    clearWorkerTaskTimers(message.taskId)
    params.assignedTasks.delete(message.taskId)
    params.setQueuedTaskIds(params.getQueuedTaskIds().filter((taskId) => taskId !== message.taskId))
    params.setRunningTaskIds(params.getRunningTaskIds().filter((taskId) => taskId !== message.taskId))
    params.syncRuntimeState()
    params.drainExecutionQueue()
    if (assignedTask) {
      params.send({
        type: 'task.result',
        executorId: config.executorId!,
        task: buildCancelledTask(assignedTask.task, config.executorId!, message.reason),
      })
    }
    return true
  }

  return false
}
