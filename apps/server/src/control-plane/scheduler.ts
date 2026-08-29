// [INPUT]: 待调度任务与 executor 状态
// [OUTPUT]: 调度选择结果（绑定命中/在线/空槽/失败率/忙碌度）
// [POS]: 执行器调度器（双层队列调度）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildExecutorSchedulingCandidates } from '@shared/executor-scheduling'
import type { ExecutorDescriptor } from '@shared/types'
import { getTeamMemberRole } from '../repositories/auth'
import { listDistributedTasks, listProjectBindings } from '../storage/distributed-task-store'
import { executorRegistry } from './executor-registry'

const isExecutorVisibleToUser = (executor: ExecutorDescriptor, userId: string) => {
  if (executor.ownerUserId === userId) {
    return true
  }

  if (executor.visibility !== 'team' || !executor.teamId) {
    return false
  }

  return getTeamMemberRole(executor.teamId, userId) !== null
}

export const listVisibleOnlineExecutors = (userId: string) => {
  return executorRegistry
    .listExecutorsWithPresence()
    .filter((executor) => executor.status === 'online' && isExecutorVisibleToUser(executor, userId))
}

export const chooseControlPlaneExecutorForUser = (userId: string) => {
  return listVisibleOnlineExecutors(userId)[0] ?? null
}

export const chooseControlPlaneExecutorForTask = (params: {
  currentExecutorId?: string
  preferredExecutorId?: string
  projectId: string
  userId: string
}) => {
  const executors = executorRegistry
    .listExecutorsWithPresence()
    .filter((executor) => isExecutorVisibleToUser(executor, params.userId))
  const candidates = buildExecutorSchedulingCandidates({
    currentExecutorId: params.currentExecutorId,
    distributedTasks: listDistributedTasks(),
    executors,
    preferredExecutorId: params.preferredExecutorId,
    projectBindings: listProjectBindings(),
    projectId: params.projectId,
  })

  return {
    candidate: candidates[0] ?? null,
    candidates,
  }
}
