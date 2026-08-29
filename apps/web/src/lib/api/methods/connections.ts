// [INPUT]: 无（API 方法组）
// [OUTPUT]: 用户连接（好友）API：列表/请求/接受/拒绝/取消/状态
// [POS]: 跨协作空间连接（好友）协议客户端；可见性规则见 server user-visibility-service
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { request } from '../client'

export type ConnectionUserBrief = {
  id: string
  name: string
  username?: string
  avatarUrl?: string
  workspaceId?: string
}

export type ConnectionStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'self'

export const connectionMethods = {
  listConnections: (workspaceId?: string) => request<{ users: ConnectionUserBrief[] }>(`/api/connections${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),
  listPendingRequests: (workspaceId?: string) => request<{ users: ConnectionUserBrief[] }>(`/api/connections/requests${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),
  listPendingSent: (workspaceId?: string) => request<{ users: ConnectionUserBrief[] }>(`/api/connections/requests/sent${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),
  requestConnection: (userId: string, workspaceId?: string) =>
    request<{ ok: boolean; created: boolean }>('/api/connections/requests', { method: 'POST', body: JSON.stringify({ userId, ...(workspaceId?.trim() ? { workspaceId: workspaceId.trim() } : {}) }) }),
  acceptConnection: (requesterId: string, workspaceId?: string) =>
    request<{ ok: boolean }>(`/api/connections/requests/${encodeURIComponent(requesterId)}/accept${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { method: 'POST' }),
  rejectConnection: (requesterId: string, workspaceId?: string) =>
    request<{ ok: boolean }>(`/api/connections/requests/${encodeURIComponent(requesterId)}/reject${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { method: 'POST' }),
  cancelConnection: (addresseeId: string, workspaceId?: string) =>
    request<{ ok: boolean }>(`/api/connections/requests/${encodeURIComponent(addresseeId)}/cancel${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { method: 'POST' }),
  getConnectionStatus: (userId: string, workspaceId?: string) =>
    request<{ status: ConnectionStatus }>(`/api/connections/status/${encodeURIComponent(userId)}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`),
}
