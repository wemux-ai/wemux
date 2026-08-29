// [INPUT]: Admin 用户管理请求参数
// [OUTPUT]: /api/admin/* 用户管理与总账号体系请求方法
// [POS]: web 控制面 admin 客户端；业务校验在 server
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  AdminAccountSystemResponse,
  AdminAuthEventsResponse,
  AdminAuthEventRecord,
  AdminTokenQuotaPolicy,
  AdminUserActivityResponse,
  AdminUserAuditResponse,
  AdminUserDetailResponse,
  AdminUserListResponse,
  AdminUserRecord,
  AdminUserRole,
  AdminUserStatus,
  AdminCommunityChannelsResponse,
  CommunityChannelsConfig,
  FeedbackListResponse,
} from '../types'
import { request } from '../client'

export type AdminUserListQuery = {
  status?: string
  role?: string
  provider?: string
  plan?: string
  q?: string
  limit?: number
  offset?: number
}

export const adminMethods = {
  listUsers: (query: AdminUserListQuery = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value))
      }
    }
    const qs = params.toString()
    return request<AdminUserListResponse>(`/api/admin/users${qs ? `?${qs}` : ''}`)
  },
  getUserDetail: (userId: string, period: '7d' | '30d' | 'all' = '30d') =>
    request<AdminUserDetailResponse>(`/api/admin/users/${encodeURIComponent(userId)}?period=${period}`),
  getUserActivity: (userId: string) =>
    request<AdminUserActivityResponse>(`/api/admin/users/${encodeURIComponent(userId)}/activity`),
  getUserAudit: (userId: string) =>
    request<AdminUserAuditResponse>(`/api/admin/users/${encodeURIComponent(userId)}/audit`),
  updateUserStatus: (userId: string, payload: { status: AdminUserStatus; reason?: string; suspendedUntil?: string }) =>
    request<{ user: AdminUserRecord; ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  updateUserRole: (userId: string, role: AdminUserRole) =>
    request<{ user: AdminUserRecord; ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  updateUserTokenQuota: (userId: string, payload: { period?: 'day' | 'month'; limitTokens: number; action?: 'warn' | 'block'; enabled?: boolean }) =>
    request<{ ok: boolean; policy: AdminTokenQuotaPolicy }>(`/api/admin/users/${encodeURIComponent(userId)}/token-quota`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  listUserAuthEvents: (userId: string, limit = 50) =>
    request<AdminAuthEventsResponse>(`/api/admin/users/${encodeURIComponent(userId)}/auth-events?limit=${limit}`),
  revokeUserSessions: (userId: string) =>
    request<{ ok: boolean; revokedSessions: number }>(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST' }),
  updateUserNote: (userId: string, note: string, status?: 'pending' | 'in_progress' | 'resolved') =>
    request<{ user: AdminUserRecord; ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/note`, {
      method: 'PUT',
      body: JSON.stringify({ note, status }),
    }),
  getUserFeedback: (userId: string) =>
    request<FeedbackListResponse>(`/api/admin/users/${encodeURIComponent(userId)}/feedback`),
  getAccountSystemSettings: () => request<AdminAccountSystemResponse>('/api/admin/settings/account-system'),
  updateAccountSystemSettings: (payload: { openRegistration?: boolean }) =>
    request<{ settings: { openRegistration?: boolean }; ok: boolean }>('/api/admin/settings/account-system', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getCommunityChannelSettings: () => request<AdminCommunityChannelsResponse>('/api/admin/settings/community-channels'),
  updateCommunityChannelSettings: (payload: CommunityChannelsConfig) =>
    request<AdminCommunityChannelsResponse>('/api/admin/settings/community-channels', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  uploadCommunityWechatQr: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<{ url: string; ok: boolean }>('/api/admin/settings/community-channels/qr-upload', {
      method: 'POST',
      body: formData,
    })
  },
  listAdmins: () => request<{ admins: AdminUserRecord[] }>('/api/admin/admins'),
  listAuthEvents: (limit = 50) => request<AdminAuthEventsResponse>(`/api/admin/auth-events?limit=${limit}`),
  getAdminNodes: () => request<AdminNodesResponse>('/api/admin/nodes'),
}

export type AdminNodeRecord = {
  nodeId: string
  name: string
  region: string | null
  status: string
  url: string | null
  relayUrl: string | null
  version: string | null
  maxConcurrentTasks: number
  activeTasks: number
  hasProjectBinding: boolean
  capabilities: string[]
  lastHeartbeatAt: string
  heartbeatAgeMs: number | null
  isCurrent: boolean
  executorCount: number
  probe: { nodeId: string; ready: boolean | null; error: string | null } | null
}

export type AdminNodesResponse = {
  currentNodeId: string
  nodes: AdminNodeRecord[]
}

export type { AdminAuthEventRecord }
