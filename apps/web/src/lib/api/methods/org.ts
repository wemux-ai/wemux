// [INPUT]: 图谱/时间线 API 请求/响应契约
// [OUTPUT]: 组织 HTTP 方法（图谱 / 用户时间线 / 用户卡片摘要）
// [POS]: Web 组织客户端；时间线第一版所有人可见，图谱按 workspace 成员隔离（服务端保证）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  AgentTimelineDetail,
  OrgGraph,
  UserCardSummary,
  UserTimelineDetail,
} from '@shared/types'
import { request } from '../client'

export type TimelineRangeQuery = 'today' | '7d'

export const orgMethods = {
  getOrgGraph: (workspaceId: string) =>
    request<{ graph: OrgGraph }>(`/api/org/graph?workspaceId=${encodeURIComponent(workspaceId)}`),
  getUserTimeline: (userId: string, range: TimelineRangeQuery = 'today') =>
    request<{ timeline: UserTimelineDetail }>(`/api/users/${userId}/timeline?range=${range}`),
  getAgentTimeline: (agentId: string, range: TimelineRangeQuery = 'today') =>
    request<{ timeline: AgentTimelineDetail }>(`/api/agents/${agentId}/timeline?range=${range}`),
  getUserCard: (userId: string) => request<{ summary: UserCardSummary }>(`/api/users/${userId}/card`),
}
