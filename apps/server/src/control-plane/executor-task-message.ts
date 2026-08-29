/**
 * [INPUT]: Executor id and a typed task control-plane message.
 * [OUTPUT]: Best-effort delivery result for task assignment and cancellation messages.
 * [POS]: Cycle-free task message primitive shared by queue dispatch and WebSocket services.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import type { ControlPlaneToExecutorMessage } from '@shared/types'
import { executorRegistry } from './executor-registry'
import {
  isSocketOpen,
  logExecutorEvent,
  sendWithLogging,
} from './executor-ws-service-state'

export const dispatchExecutorTaskMessage = (
  executorId: string,
  message: ControlPlaneToExecutorMessage,
) => {
  const socket = executorRegistry.getSocket(executorId)
  if (!socket || !isSocketOpen(socket)) {
    if (message.type === 'task.assign') {
      logExecutorEvent({
        executorId,
        eventType: 'error',
        message: '任务派发失败：执行器当前不在线。',
        payload: {
          type: message.type,
          taskId: message.task.id,
        },
        taskId: message.task.id,
        originTaskId: message.task.originTaskId,
        projectId: message.task.projectId,
        isFailure: true,
      })
    }
    return false
  }

  sendWithLogging(executorId, socket, message)
  return true
}
