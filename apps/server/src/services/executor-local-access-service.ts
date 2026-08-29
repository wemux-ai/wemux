// [INPUT]: 本地访问请求
// [OUTPUT]: 访问计划
// [POS]: executor 本地访问服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorLocalAccessPlan, ExecutorRecord } from '@shared/types'

const MAX_LOCAL_ACCESS_CANDIDATES = 4

const isValidLocalServerPort = (port?: number) => (
  typeof port === 'number'
  && Number.isInteger(port)
  && port > 0
  && port <= 65_535
)

const canBeBrowserLocal = (executor: ExecutorRecord) => (
  executor.status === 'online'
  && executor.executorSource !== 'managed-cloud'
  && executor.runtimeClass !== 'managed-worker'
  && isValidLocalServerPort(executor.localServerPort)
)

export const buildExecutorLocalAccessPlan = (params: {
  allowMesh: boolean
  executors: ExecutorRecord[]
  now?: number
  targetExecutorId?: string
  userId: string
}): ExecutorLocalAccessPlan => {
  const targetExecutorId = params.targetExecutorId?.trim() || undefined
  const eligibleExecutors = params.executors.filter(canBeBrowserLocal)
  const target = targetExecutorId
    ? eligibleExecutors.find((executor) => executor.executorId === targetExecutorId)
    : undefined
  const candidates: ExecutorLocalAccessPlan['candidates'] = []
  const seenExecutorIds = new Set<string>()
  const addCandidate = (executor: ExecutorRecord, role: 'target' | 'mesh-source') => {
    if (seenExecutorIds.has(executor.executorId) || candidates.length >= MAX_LOCAL_ACCESS_CANDIDATES) {
      return
    }
    seenExecutorIds.add(executor.executorId)
    candidates.push({
      executorId: executor.executorId,
      instanceId: executor.localServerInstanceId,
      port: executor.localServerPort!,
      role,
    })
  }

  if (target) {
    addCandidate(target, 'target')
  }
  if (params.allowMesh) {
    eligibleExecutors
      .filter((executor) => executor.ownerUserId === params.userId)
      .forEach((executor) => addCandidate(executor, 'mesh-source'))
  }

  return {
    targetExecutorId,
    candidates,
    expiresAt: new Date((params.now ?? Date.now()) + 30_000).toISOString(),
  }
}
