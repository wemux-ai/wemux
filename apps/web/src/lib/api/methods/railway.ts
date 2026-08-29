// [INPUT]: Railway 连接/同步/部署/绑定请求参数。
// [OUTPUT]: Typed Railway API methods。
// [POS]: Web 侧 Railway 插件 HTTP 客户端方法。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  RailwayResourceBinding,
  RailwayResourceBindingFilter,
  RailwayResourceBindingMutationPayload,
  RailwayConnectionResponse,
  RailwayDeploymentListResponse,
  RailwayResourceBindingResponse,
  ApiResponse,
} from '../types'
import { request } from '../client'

export const railwayMethods = {
  getRailwayConnection: () =>
    request<RailwayConnectionResponse>('/api/railway/connection'),
  connectRailway: (token: string) =>
    request<RailwayConnectionResponse>('/api/railway/connection', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  disconnectRailway: () =>
    request<ApiResponse>('/api/railway/connection', { method: 'DELETE' }),
  syncRailway: () =>
    request<{ ok: boolean; projectCount?: number; message?: string }>('/api/railway/sync', { method: 'POST' }),
  listRailwayDeployments: (projectIds: string[]) => {
    const search = new URLSearchParams()
    for (const projectId of projectIds) {
      const normalizedProjectId = projectId.trim()
      if (normalizedProjectId) {
        search.append('projectId', normalizedProjectId)
      }
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<RailwayDeploymentListResponse>(`/api/railway/deployments${suffix}`)
  },
  listRailwayResourceBindings: (filter?: RailwayResourceBindingFilter) => {
    const search = new URLSearchParams()
    for (const projectId of filter?.projectIds ?? []) {
      const normalizedProjectId = projectId.trim()
      if (normalizedProjectId) {
        search.append('projectId', normalizedProjectId)
      }
    }
    for (const [key, value] of [
      ['projectId', filter?.projectId],
      ['resourceType', filter?.resourceType],
      ['resourceId', filter?.resourceId],
      ['taskId', filter?.taskId],
      ['workspaceId', filter?.workspaceId],
      ['workspaceSessionId', filter?.workspaceSessionId],
      ['status', filter?.status],
    ] as const) {
      if (value?.trim()) {
        search.set(key, value.trim())
      }
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{ bindings: RailwayResourceBinding[] }>(`/api/railway/resource-bindings${suffix}`)
  },
  createRailwayResourceBinding: (payload: RailwayResourceBindingMutationPayload) =>
    request<RailwayResourceBindingResponse>('/api/railway/resource-bindings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
