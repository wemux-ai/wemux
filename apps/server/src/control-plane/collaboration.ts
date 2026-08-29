// [INPUT]: executor 的 workspaceIds/teamId 归属数据
// [OUTPUT]: 工作区/团队协作归属判断 helper
// [POS]: executor 协作归属逻辑（workspaceIds/teamId 过滤）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorRecord } from '@shared/types'
import { getTeamProjects, getUserTeams } from '../repositories/auth'
import { executorRegistry } from './executor-registry'
import { resolveExecutorRealtimeBaseUrl } from '../services/executor-realtime-routing'
import { getManagedCloudGate } from '../services/gate/managed-cloud-gate'

const getExecutorWorkspaceIds = (executor: Pick<ExecutorRecord, 'workspaceIds' | 'teamId'>) => {
  const workspaceIds = executor.workspaceIds?.filter((value) => typeof value === 'string' && value.trim().length > 0) ?? []
  if (workspaceIds.length > 0) {
    return workspaceIds
  }
  return executor.teamId ? [executor.teamId] : []
}

/**
 * 节点可见性：自己的机器跨空间可用；共享节点在传了 workspaceId 时必须归属该 workspace；
 * 未传 workspaceId 时保持 team 兼容（共享节点对 team 成员可见）。
 */
export const isExecutorVisibleToUser = (
  executor: Pick<ExecutorRecord, 'ownerUserId' | 'visibility' | 'workspaceIds' | 'teamId'>,
  userId: string,
  options?: {
    workspaceId?: string
    teamIds?: Set<string>
  },
) => {
  if (executor.ownerUserId === userId) {
    return true
  }

  if (executor.visibility !== 'team') {
    return false
  }

  const workspaceIds = getExecutorWorkspaceIds(executor)
  if (options?.workspaceId?.trim()) {
    return workspaceIds.includes(options.workspaceId.trim())
  }

  const teamIds = options?.teamIds
  return workspaceIds.length === 0 || (teamIds ? workspaceIds.some((workspaceId) => teamIds.has(workspaceId)) : true)
}

export const listVisibleExecutorsForUser = (userId: string, workspaceId?: string): ExecutorRecord[] => {
  const teamIds = new Set(getUserTeams(userId).map((team) => team.id))
  const managedCloudLifecycleByExecutorId = getManagedCloudGate().buildLifecycleSnapshotByExecutorId()
  return executorRegistry.listExecutorsWithPresence().filter((executor) => {
    if (!getManagedCloudGate().isExecutorAllowed(executor)) {
      return false
    }

    return isExecutorVisibleToUser(executor, userId, {
      workspaceId,
      teamIds,
    })
  }).map((executor) => ({
    ...executor,
    realtimeBaseUrl: resolveExecutorRealtimeBaseUrl(executor) || undefined,
    managedCloudLifecycle: managedCloudLifecycleByExecutorId.get(executor.executorId),
  }))
}

export const canUserUseExecutorForProject = (params: { userId: string; projectId: string; executorId: string }) => {
  const executor = executorRegistry.getExecutor(params.executorId)
  if (!executor) {
    return { ok: false as const, message: '执行器不存在。' }
  }

  if (executor.ownerUserId === params.userId) {
    return { ok: true as const, executor }
  }

  const workspaceIds = getExecutorWorkspaceIds(executor)
  if (executor.visibility !== 'team' || workspaceIds.length === 0) {
    return { ok: false as const, message: '无权限使用该执行器。' }
  }

  const team = getUserTeams(params.userId).find((item) => workspaceIds.includes(item.id))
  if (!team) {
    return { ok: false as const, message: '无权限使用该组织共享执行器。' }
  }

  const authorized = workspaceIds.some((workspaceId) => {
    if (!workspaceId) {
      return false
    }
    const projectIds = new Set(getTeamProjects(workspaceId).map((project) => project.projectId))
    return projectIds.has(params.projectId)
  })
  if (!authorized) {
    return { ok: false as const, message: '该组织共享执行器仅可用于已授权给组织的项目。' }
  }

  return { ok: true as const, executor }
}

export const listTeamSharedExecutors = (teamId: string) => {
  const sharedProjectIds = getTeamProjects(teamId).map((project) => project.projectId)
  return executorRegistry
    .listExecutorsWithPresence()
    .filter((executor) => executor.visibility === 'team' && getExecutorWorkspaceIds(executor).includes(teamId))
    .map((executor) => ({
      ...executor,
      sharedProjectIds,
      sharedWorkspaceIds: getExecutorWorkspaceIds(executor),
    }))
}
