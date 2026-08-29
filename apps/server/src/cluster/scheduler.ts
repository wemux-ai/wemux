import type { TaskExecutionMode } from '@shared/types'
import { clusterConfig } from './config'
import { listNodes, listProjectBindings } from '../storage/distributed-task-store'

export const chooseExecutorNode = (
  projectId: string,
  executionMode: TaskExecutionMode,
  excludeNodeIds: string[] = [],
) => {
  const excluded = new Set(excludeNodeIds)
  const nodes = listNodes().filter((node) => (node.status === 'online' || node.status === 'busy') && !excluded.has(node.nodeId))
  const bindings = listProjectBindings().filter((binding) => binding.projectId === projectId)

  const candidates = nodes
    .map((node) => ({
      node,
      hasBinding: bindings.some((binding) => binding.nodeId === node.nodeId),
      capacity: node.maxConcurrentTasks - node.activeTasks,
    }))
    .filter((item) => item.capacity > 0)
    .sort((left, right) => {
      if (left.node.nodeId === clusterConfig.nodeId && right.node.nodeId !== clusterConfig.nodeId) {
        return executionMode === 'remote' ? 1 : -1
      }
      if (right.node.nodeId === clusterConfig.nodeId && left.node.nodeId !== clusterConfig.nodeId) {
        return executionMode === 'remote' ? -1 : 1
      }
      if (left.hasBinding !== right.hasBinding) {
        return left.hasBinding ? -1 : 1
      }
      return right.capacity - left.capacity
    })

  return candidates[0]?.node.nodeId ?? (excludeNodeIds.includes(clusterConfig.nodeId) ? undefined : clusterConfig.nodeId)
}
