// [INPUT]: 画像 API 请求/响应契约
// [OUTPUT]: 用户/Agent 画像 HTTP 方法（我的画像 + 他人画像 + Agent 画像）
// [POS]: Web 控制面画像客户端；可见性隔离由服务端（private/team 共同组织/public）保证
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  AgentProfileRecord,
  UpdateAgentProfileInput,
  UpdateUserProfileInput,
  UserProfileRecord,
  WorkRecord,
} from '@shared/types'
import { request } from '../client'

export type UserProfileBasic = {
  id: string
  name: string
  username?: string | null
  avatarUrl: string | null
  bio: string | null
}

export const profileMethods = {
  /** 用户搜索（跨空间私聊发起）：姓名/邮箱模糊匹配，服务端限制条数防枚举。 */
  searchUsers: (query: string, workspaceId?: string, options?: { forConnection?: boolean }) =>
    request<{ users: Array<{ id: string; name: string; username?: string; email: string; avatarUrl?: string }> }>(
      `/api/users/search?q=${encodeURIComponent(query)}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ''}${options?.forConnection ? '&connection=1' : ''}`,
    ),
  getMyProfile: () => request<{ profile: UserProfileRecord | null; workRecords: WorkRecord[] }>('/api/my/profile'),
  updateMyProfile: (payload: UpdateUserProfileInput) =>
    request<{ profile: UserProfileRecord }>('/api/my/profile', { method: 'PUT', body: JSON.stringify(payload) }),
  getUserProfile: (userId: string) =>
    request<{ profile: UserProfileRecord | null; user: UserProfileBasic }>(`/api/users/${userId}/profile`),
  getAgentProfile: (agentId: string) =>
    request<{ profile: AgentProfileRecord | null }>(`/api/agents/${agentId}/profile`),
  updateAgentProfile: (agentId: string, payload: UpdateAgentProfileInput) =>
    request<{ profile: AgentProfileRecord }>(`/api/agents/${agentId}/profile`, { method: 'PUT', body: JSON.stringify(payload) }),
}
