// [INPUT]: 实时路由请求
// [OUTPUT]: baseUrl 解析结果
// [POS]: executor 实时路由
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { ExecutorDescriptor } from '@shared/types'
import { getNode } from '../storage/postgres/distributed-task-store'
import { isClusterNodeHeartbeatFresh } from '../control-plane/executor-registry'
import { resolveExecutorRealtimeBaseUrlFromLabels } from './executor-connection-route'

export const executorRealtimeRoutingDeps = {
  getNode: (nodeId: string) => getNode(nodeId),
}

export const resolveExecutorRealtimeBaseUrl = (
  executor?: Pick<ExecutorDescriptor, 'connectedNodeId' | 'labels'> | null,
) => {
  const connectedNodeId = executor?.connectedNodeId?.trim()
  if (connectedNodeId) {
    const connectedNode = executorRealtimeRoutingDeps.getNode(connectedNodeId)
    // 归属节点心跳过期时不再向其直连入口转发，回退到 label 路由或统一入口。
    if (isClusterNodeHeartbeatFresh(connectedNode)) {
      const publicUrl = connectedNode?.url?.trim()
      if (publicUrl) {
        return publicUrl
      }
    }
  }

  return resolveExecutorRealtimeBaseUrlFromLabels(executor?.labels)
}
