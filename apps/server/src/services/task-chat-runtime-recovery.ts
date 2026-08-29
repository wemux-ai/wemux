// [INPUT]: 断线会话
// [OUTPUT]: 恢复结果
// [POS]: 任务对话运行时恢复
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { AgentRunningStatus, DistributedTask, Task, TaskWorkspaceBinding, WorkspaceSession } from '@shared/types'
import { mergeWorkspaceSession } from '@shared/task-workspace'
import { loadState, saveTask, saveWorkspaceSession } from '../storage/app-state-store'
import { getDistributedTask } from '../storage/distributed-task-store'
import {
  hasActiveDistributedTaskRuntime,
  isWorkspaceSessionRuntimeHeartbeatFresh,
  resolveEffectiveWorkspaceRuntimeStatus,
  toAgentRunningStatusFromRuntimeStatus,
} from './task-workspace-runtime-state'

const TERMINAL_DISTRIBUTED_TASK_STATUSES = new Set<DistributedTask['status']>([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'lost',
])

export const STALE_TASK_CHAT_RUNTIME_MESSAGE = '控制面已重启，上一次工作区对话没有完成回传。请重新发送消息。'

const isBusyRuntimeStatus = (status: AgentRunningStatus) => {
  return status === 'thinking' || status === 'executing' || status === 'waiting'
}

const hasActiveDistributedTask = (
  distributedTaskId: string | undefined,
  resolveDistributedTask: (distributedTaskId: string) => DistributedTask | null | undefined,
) => {
  const normalizedDistributedTaskId = distributedTaskId?.trim()
  if (!normalizedDistributedTaskId) {
    return false
  }

  const distributedTask = resolveDistributedTask(normalizedDistributedTaskId)
  if (!distributedTask) {
    return false
  }

  return !TERMINAL_DISTRIBUTED_TASK_STATUSES.has(distributedTask.status)
}

const shouldRecoverQueuedDirectWorkspaceChat = (session: WorkspaceSession) => {
  return session.runtimeStatus === 'queued' && !session.distributedTaskId?.trim()
}

const buildRecoveredSession = (
  task: Task | undefined,
  session: WorkspaceSession,
  updatedAt: string,
) => {
  const patch = {
    agentRunningStatus: 'error' as const,
    runtimeStatus: 'lost' as const,
    terminalReason: STALE_TASK_CHAT_RUNTIME_MESSAGE,
    lastRuntimeEventAt: updatedAt,
    runtimeSequence: session.runtimeSequence + 1,
    currentStep: STALE_TASK_CHAT_RUNTIME_MESSAGE,
    needsHumanConfirm: false,
    updatedAt,
    lastActiveAt: updatedAt,
  }

  if (!task) {
    return {
      ...session,
      ...patch,
    }
  }

  return mergeWorkspaceSession(task, session, patch)
}

export const buildTaskChatRuntimeRecoveryPlan = (params: {
  tasks: Task[]
  taskWorkspaceBindings: TaskWorkspaceBinding[]
  workspaceSessions: WorkspaceSession[]
  resolveDistributedTask: (distributedTaskId: string) => DistributedTask | null | undefined
}) => {
  const updatedAt = new Date().toISOString()
  const taskIdByWorkspaceId = new Map(
    params.taskWorkspaceBindings
      .filter((binding) => binding.status === 'active')
      .map((binding) => [binding.workspaceId, binding.taskId] as const),
  )
  const taskById = new Map(params.tasks.map((task) => [task.id, task] as const))
  const recoveredTaskIds = new Set<string>()
  const recoveredSessions: WorkspaceSession[] = []

  for (const session of params.workspaceSessions) {
    if (!isBusyRuntimeStatus(session.agentRunningStatus)) {
      continue
    }
    const distributedTask = session.distributedTaskId ? params.resolveDistributedTask(session.distributedTaskId) : undefined
    const effectiveRuntimeStatus = resolveEffectiveWorkspaceRuntimeStatus(session)
    if (
      hasActiveDistributedTask(session.distributedTaskId, params.resolveDistributedTask)
      && hasActiveDistributedTaskRuntime(distributedTask)
      && isWorkspaceSessionRuntimeHeartbeatFresh(session)
    ) {
      continue
    }
    if (shouldRecoverQueuedDirectWorkspaceChat(session)) {
      const taskId = taskIdByWorkspaceId.get(session.workspaceId)
      if (taskId) {
        recoveredTaskIds.add(taskId)
      }

      recoveredSessions.push(buildRecoveredSession(taskId ? taskById.get(taskId) : undefined, session, updatedAt))
      continue
    }
    if (effectiveRuntimeStatus !== 'lost' && effectiveRuntimeStatus !== 'error') {
      continue
    }

    const taskId = taskIdByWorkspaceId.get(session.workspaceId)
    if (taskId) {
      recoveredTaskIds.add(taskId)
    }

    recoveredSessions.push(buildRecoveredSession(taskId ? taskById.get(taskId) : undefined, session, updatedAt))
  }

  const recoveredTasks = params.tasks
    .filter((task) => recoveredTaskIds.has(task.id))
    .filter((task) => isBusyRuntimeStatus(task.agentRunningStatus))
    .map((task) => ({
      ...task,
      agentRunningStatus: toAgentRunningStatusFromRuntimeStatus('lost'),
      currentStep: STALE_TASK_CHAT_RUNTIME_MESSAGE,
      needsHumanConfirm: false,
      updatedAt,
    }))

  return {
    recoveredSessions,
    recoveredTasks,
  }
}

export const recoverStaleTaskChatRuntimeAfterBootstrap = () => {
  const state = loadState()
  const plan = buildTaskChatRuntimeRecoveryPlan({
    tasks: state.tasks,
    taskWorkspaceBindings: state.taskWorkspaceBindings,
    workspaceSessions: state.workspaceSessions,
    resolveDistributedTask: (distributedTaskId) => getDistributedTask(distributedTaskId),
  })

  for (const task of plan.recoveredTasks) {
    saveTask(task)
  }
  for (const session of plan.recoveredSessions) {
    saveWorkspaceSession(session)
  }

  if (plan.recoveredTasks.length > 0 || plan.recoveredSessions.length > 0) {
    console.warn('[task-chat-runtime-recovery] recovered stale workspace chat runtime state', JSON.stringify({
      taskCount: plan.recoveredTasks.length,
      sessionCount: plan.recoveredSessions.length,
    }))
  }
}
