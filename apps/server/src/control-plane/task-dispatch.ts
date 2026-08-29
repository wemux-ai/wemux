// [INPUT]: 分布式任务与 workspace/executor 绑定
// [OUTPUT]: task.assign 派发
// [POS]: 分布式任务派发
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildExecutorSchedulingCandidates, sortDistributedTasksForScheduling } from '@shared/executor-scheduling'
import type { DistributedTask, ExecutorRecord } from '@shared/types'
import { syncDistributedTaskEvent } from '../cluster/task-sync'
import {
  resolveTaskRuntimeCapabilitySnapshot,
  withoutRuntimeCapabilitySnapshotEnv,
} from '../services/custom-agent-runtime'
import { getPrimaryAgentMcpServers } from '../services/primary-agent-mcp'
import { resolveUserFeatureFlags } from '../services/user-experimental-settings-service'
import { resolveProjectRuntimeEnvironment, resolveWorkspaceRuntimeEnvironment } from '../services/runtime-environment-service'
import { getServerAgentSettings } from '../services/server-agent'
import { listProjectBindings } from '../storage/distributed-task-store'
import {
  claimDistributedTaskForDispatch,
  getDistributedTask,
  listDistributedTasks,
  reclaimExpiredDistributedTaskLeases,
  updateDistributedTask,
} from '../storage/distributed-task-store'
import { loadState } from '../storage/app-state-store'
import { executorRegistry } from './executor-registry'
import { dispatchExecutorTaskMessage } from './executor-task-message'
import { hydrateTaskGitIdentity } from './task-git-identity'

const ACTIVE_TASK_STATUSES: DistributedTask['status'][] = ['assigned', 'preparing', 'executing', 'syncing_back']
const nextLeaseExpiry = () => new Date(Date.now() + 30_000).toISOString()
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const listExecutors = () => executorRegistry.listExecutorsWithPresence()

const buildCandidateMap = (task: DistributedTask, executors: ExecutorRecord[]) => {
  return buildExecutorSchedulingCandidates({
    currentExecutorId: task.executorNodeId,
    distributedTasks: listDistributedTasks(),
    executors,
    projectBindings: listProjectBindings(),
    projectId: task.projectId,
  })
}

const reclaimExpiredLeases = async () => {
  const updatedAt = new Date().toISOString()
  const reclaimedTasks = await reclaimExpiredDistributedTaskLeases(updatedAt)
  for (const task of reclaimedTasks) {
    syncDistributedTaskEvent({
      taskId: task.id,
      status: 'queued',
      message: '执行器在租约窗口内未确认启动，任务已回到控制面队列。',
      at: updatedAt,
    })
  }
}

const reserveTaskForDispatch = (task: DistributedTask, executorId: string) => {
  const now = new Date().toISOString()
  return claimDistributedTaskForDispatch({
    taskId: task.id,
    executorId,
    leaseExpiresAt: nextLeaseExpiry(),
    updatedAt: now,
  })
}

export const dispatchTaskToExecutor = async (task: DistributedTask) => {
  if (!task.executorNodeId) {
    return false
  }

  const state = loadState()
  const capabilitySnapshot = resolveTaskRuntimeCapabilitySnapshot({
    projectId: task.projectId,
    workspaceId: task.workspaceId,
    userId: task.requestedByUserId,
    runtimeEnv: task.runtimeEnv,
    runtimeSkillPackages: task.runtimeSkillPackages,
    mcpServers: task.mcpServers ?? task.opencodeConfig?.mcpServers ?? getPrimaryAgentMcpServers(state.config, task.requestedByUserId),
    opencodeConfig: task.opencodeConfig,
  })
  const preparedTask: DistributedTask = {
    ...task,
    mcpServers: capabilitySnapshot.mcpServers,
    opencodeConfig: capabilitySnapshot.opencodeConfig,
    runtimeEnv: capabilitySnapshot.runtimeEnv,
    runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
  }
  if (
    !sameJson(task.mcpServers, preparedTask.mcpServers)
    || !sameJson(task.opencodeConfig, preparedTask.opencodeConfig)
    || !sameJson(task.runtimeEnv, preparedTask.runtimeEnv)
    || !sameJson(task.runtimeSkillPackages, preparedTask.runtimeSkillPackages)
  ) {
    updateDistributedTask(preparedTask)
  }
  const gitIdentity = await hydrateTaskGitIdentity({
    userId: preparedTask.requestedByUserId,
    projectId: preparedTask.projectId,
    mode: preparedTask.gitIdentityMode,
    repoUrl: preparedTask.repoUrl,
    identity: preparedTask.gitIdentity,
  }).catch(() => undefined)
  const executorId = preparedTask.executorNodeId
  if (!executorId) {
    return false
  }
  const runtimeEnvironment = preparedTask.workspaceId
    ? await resolveWorkspaceRuntimeEnvironment(preparedTask.workspaceId).then((result) => result?.payload).catch(() => undefined)
    : await resolveProjectRuntimeEnvironment(preparedTask.projectId).then((result) => result?.payload).catch(() => undefined)

  return dispatchExecutorTaskMessage(executorId, {
    type: 'task.assign',
    task: {
      ...preparedTask,
      agentSettings: preparedTask.agentSettings ?? getServerAgentSettings(state.config, preparedTask.agentType),
      gitIdentity,
      mcpServers: capabilitySnapshot.mcpServers,
      runtimeEnv: withoutRuntimeCapabilitySnapshotEnv(preparedTask.runtimeEnv),
      runtimeSkillPackages: capabilitySnapshot.runtimeSkillPackages,
    },
    runtimeEnvironment,
    featureFlags: resolveUserFeatureFlags(preparedTask.requestedByUserId),
  })
}

export const requestExecutorTaskCancellation = (task: DistributedTask, reason?: string) => {
  if (!task.executorNodeId) {
    return false
  }

  return dispatchExecutorTaskMessage(task.executorNodeId, {
    type: 'task.cancel',
    taskId: task.id,
    reason,
  })
}

export const reconcileControlPlaneTaskQueue = async () => {
  await reclaimExpiredLeases()
  const executors = listExecutors()
  const queuedTasks = sortDistributedTasksForScheduling(listDistributedTasks().filter((task) => task.status === 'queued'))

  for (const queuedTask of queuedTasks) {
    const latestTask = getDistributedTask(queuedTask.id)
    if (!latestTask || latestTask.status !== 'queued') {
      continue
    }

    const candidates = buildCandidateMap(latestTask, executors)
    const selected = latestTask.executorNodeId
      ? candidates.find((candidate) => candidate.executor.executorId === latestTask.executorNodeId) ?? null
      : candidates[0] ?? null

    if (!selected) {
      continue
    }

    if (!latestTask.executorNodeId || latestTask.executorNodeId !== selected.executor.executorId) {
      updateDistributedTask({
        ...latestTask,
        executorNodeId: selected.executor.executorId,
        updatedAt: new Date().toISOString(),
      })
    }

    if (!selected.online || selected.availableSlots <= 0) {
      continue
    }

    const reservedTask = await reserveTaskForDispatch(latestTask, selected.executor.executorId)
    if (!reservedTask) {
      continue
    }
    let dispatched = false
    try {
      dispatched = await dispatchTaskToExecutor(reservedTask)
    } catch {
      dispatched = false
    }
    if (!dispatched) {
      updateDistributedTask({
        ...reservedTask,
        status: 'queued',
        leaseExpiresAt: undefined,
        updatedAt: new Date().toISOString(),
      })
      continue
    }

    syncDistributedTaskEvent({
      taskId: reservedTask.id,
      status: 'assigned',
      message: `调度到 ${selected.executor.name}：${selected.reasons.slice(0, 3).join('，')}`,
      at: reservedTask.updatedAt,
    })
  }
}

export const requeueExecutorDispatchTasks = (executorId: string, reason: string) => {
  const now = new Date().toISOString()

  for (const task of listDistributedTasks().filter((item) => item.executorNodeId === executorId)) {
    if (task.status === 'assigned' || task.status === 'preparing') {
      updateDistributedTask({
        ...task,
        status: 'queued',
        leaseExpiresAt: undefined,
        updatedAt: now,
      })
      syncDistributedTaskEvent({
        taskId: task.id,
        status: 'queued',
        message: `${reason}，任务回到控制面队列。`,
        at: now,
      })
    }
  }

  void reconcileControlPlaneTaskQueue()
}

export const countExecutorActiveTasks = (executorId: string) => {
  return listDistributedTasks().filter((task) => task.executorNodeId === executorId && ACTIVE_TASK_STATUSES.includes(task.status)).length
}
