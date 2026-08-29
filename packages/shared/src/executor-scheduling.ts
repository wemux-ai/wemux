// [INPUT]: 调度输入
// [OUTPUT]: 调度契约
// [POS]: executor 调度类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { DistributedTask, ExecutorRecord, ProjectBinding } from './types'

const ACTIVE_TASK_STATUSES: DistributedTask['status'][] = ['assigned', 'preparing', 'executing', 'syncing_back']
const FAILURE_TASK_STATUSES: DistributedTask['status'][] = ['failed', 'lost', 'timed_out']
const SUCCESS_TASK_STATUSES: DistributedTask['status'][] = ['completed']

const PRIORITY_RANK: Record<DistributedTask['priority'], number> = {
  none: 3,
  high: 0,
  medium: 1,
  low: 2,
}

export type ExecutorSchedulingCandidate = {
  executor: ExecutorRecord
  projectBindingHit: boolean
  online: boolean
  availableSlots: number
  runningCount: number
  localQueuedCount: number
  activeCount: number
  controlPlaneQueuedCount: number
  failureRate: number
  busyScore: number
  reasons: string[]
}

export type DistributedTaskQueueInsight = {
  executor: ExecutorRecord | null
  candidate: ExecutorSchedulingCandidate | null
  schedulingReasons: string[]
  aheadOfTaskCount: number
  controlPlaneAheadCount: number
  executorAheadCount: number
}

export const sortDistributedTasksForScheduling = <T extends Pick<DistributedTask, 'priority' | 'createdAt'>>(tasks: T[]) => {
  return [...tasks].sort((left, right) => {
    const priorityDiff = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
    if (priorityDiff !== 0) {
      return priorityDiff
    }

    return left.createdAt.localeCompare(right.createdAt)
  })
}

const clampFailureRate = (failures: number, successes: number) => {
  const total = failures + successes
  if (total === 0) {
    return 0
  }

  return failures / total
}

export const buildExecutorSchedulingCandidates = (params: {
  currentExecutorId?: string
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  preferredExecutorId?: string
  projectBindings: ProjectBinding[]
  projectId: string
}) => {
  const activeTasks = params.distributedTasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status))
  const queuedTasks = params.distributedTasks.filter((task) => task.status === 'queued')
  const terminalTasks = params.distributedTasks.filter((task) => task.executorNodeId && [...FAILURE_TASK_STATUSES, ...SUCCESS_TASK_STATUSES].includes(task.status))

  return [...params.executors]
    .filter((executor) => executor.status !== 'disabled')
    .map((executor) => {
      const runningCount = executor.presence?.runningTaskIds.length ?? 0
      const localQueuedCount = executor.presence?.queuedTaskIds.length ?? 0
      const activeCount = activeTasks.filter((task) => task.executorNodeId === executor.executorId).length
      const controlPlaneQueuedCount = queuedTasks.filter((task) => task.executorNodeId === executor.executorId).length
      const recentTerminalTasks = terminalTasks.filter((task) => task.executorNodeId === executor.executorId).slice(0, 20)
      const failures = recentTerminalTasks.filter((task) => FAILURE_TASK_STATUSES.includes(task.status)).length
      const successes = recentTerminalTasks.filter((task) => SUCCESS_TASK_STATUSES.includes(task.status)).length
      const failureRate = clampFailureRate(failures, successes)
      const online = executor.status === 'online'
      const effectiveRunningCount = Math.max(activeCount, runningCount)
      const availableSlots = Math.max(0, executor.maxConcurrency - effectiveRunningCount)
      const projectBindingHit = params.projectBindings.some((binding) => binding.projectId === params.projectId && binding.nodeId === executor.executorId && binding.isActive)
      const busyScore = effectiveRunningCount + controlPlaneQueuedCount + localQueuedCount
      const reasons: string[] = []

      if (params.preferredExecutorId === executor.executorId) {
        reasons.push('手动指定执行器')
      }
      if (params.currentExecutorId === executor.executorId && params.currentExecutorId !== params.preferredExecutorId) {
        reasons.push('沿用当前执行器')
      }
      if (projectBindingHit) {
        reasons.push('命中项目绑定')
      }
      reasons.push(online ? '执行器在线' : '执行器离线，保留队列')
      reasons.push(availableSlots > 0 ? `剩余 ${availableSlots} 个并发槽位` : '当前无空闲槽位，先进入控制面队列')
      if (recentTerminalTasks.length > 0) {
        reasons.push(`近期失败率 ${Math.round(failureRate * 100)}%`)
      }
      reasons.push(`当前负载 ${effectiveRunningCount}/${executor.maxConcurrency}`)

      return {
        executor,
        projectBindingHit,
        online,
        availableSlots,
        runningCount,
        localQueuedCount,
        activeCount,
        controlPlaneQueuedCount,
        failureRate,
        busyScore,
        reasons,
      }
    })
    .sort((left, right) => {
      const preferredDiff = Number(right.executor.executorId === params.preferredExecutorId) - Number(left.executor.executorId === params.preferredExecutorId)
      if (preferredDiff !== 0) {
        return preferredDiff
      }

      const currentDiff = Number(right.executor.executorId === params.currentExecutorId) - Number(left.executor.executorId === params.currentExecutorId)
      if (currentDiff !== 0) {
        return currentDiff
      }

      const bindingDiff = Number(right.projectBindingHit) - Number(left.projectBindingHit)
      if (bindingDiff !== 0) {
        return bindingDiff
      }

      const onlineDiff = Number(right.online) - Number(left.online)
      if (onlineDiff !== 0) {
        return onlineDiff
      }

      const freeSlotDiff = Number(right.availableSlots > 0) - Number(left.availableSlots > 0)
      if (freeSlotDiff !== 0) {
        return freeSlotDiff
      }

      const availableSlotDiff = right.availableSlots - left.availableSlots
      if (availableSlotDiff !== 0) {
        return availableSlotDiff
      }

      const failureDiff = left.failureRate - right.failureRate
      if (failureDiff !== 0) {
        return failureDiff
      }

      const busyDiff = left.busyScore - right.busyScore
      if (busyDiff !== 0) {
        return busyDiff
      }

      return left.executor.name.localeCompare(right.executor.name)
    })
}

export const getDistributedTaskQueueInsight = (params: {
  distributedTasks: DistributedTask[]
  executors: ExecutorRecord[]
  projectBindings: ProjectBinding[]
  task: DistributedTask
}) => {
  const candidates = buildExecutorSchedulingCandidates({
    currentExecutorId: params.task.executorNodeId,
    distributedTasks: params.distributedTasks.filter((item) => item.id !== params.task.id),
    executors: params.executors,
    projectBindings: params.projectBindings,
    projectId: params.task.projectId,
  })
  const selectedCandidate = params.task.executorNodeId
    ? candidates.find((candidate) => candidate.executor.executorId === params.task.executorNodeId) ?? null
    : candidates[0] ?? null
  const queuedTasks = sortDistributedTasksForScheduling(
    params.distributedTasks.filter((item) => item.status === 'queued' && item.id !== params.task.id),
  )
  const controlPlaneAheadCount = sortDistributedTasksForScheduling([...queuedTasks, params.task]).findIndex((item) => item.id === params.task.id)
  const executorAheadCount = selectedCandidate
    ? sortDistributedTasksForScheduling([...queuedTasks.filter((item) => item.executorNodeId === selectedCandidate.executor.executorId), params.task]).findIndex((item) => item.id === params.task.id)
    : 0

  return {
    executor: selectedCandidate?.executor ?? null,
    candidate: selectedCandidate,
    schedulingReasons: selectedCandidate?.reasons ?? [],
    aheadOfTaskCount: selectedCandidate ? executorAheadCount : controlPlaneAheadCount,
    controlPlaneAheadCount,
    executorAheadCount,
  } satisfies DistributedTaskQueueInsight
}
