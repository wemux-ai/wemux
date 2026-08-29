// [INPUT]: 组织概览请求
// [OUTPUT]: 组织组织概览 + 成员/Agent 工作记录时间线方法
// [POS]: Web 工作记录可见性客户端
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type { WorkRecord } from '@shared/types'
import { request } from '../client'

export type WorkspaceOverviewTask = { id: string; title: string; status: string }

export type WorkspaceOverviewMember = {
  userId: string
  name: string
  avatarUrl: string | null
  role: string
  inProgressTasks: WorkspaceOverviewTask[]
  attentionTasks: WorkspaceOverviewTask[]
  recent: Array<{
    id: string
    recordType: WorkRecord['recordType']
    title: string
    targetType: WorkRecord['targetType']
    targetId: string | null
    occurredAt: string
  }>
}

export type WorkspaceOverviewAgent = {
  agentId: string
  name: string
  avatarUrl: string | null
  ownerUserId: string | null
  healthScore: number | null
  /** 完成率样本（近 200 条工作记录）；无任何记录时为 null */
  healthSample: { completed: number; dispatched: number } | null
  inProgressTasks: WorkspaceOverviewTask[]
  attentionTasks: WorkspaceOverviewTask[]
  recent: WorkspaceOverviewMember['recent']
}

export const overviewMethods = {
  getWorkspaceOverview: (workspaceId: string) =>
    request<{ overview: { workspaceId: string; members: WorkspaceOverviewMember[]; agents: WorkspaceOverviewAgent[] } }>(
      `/api/collab/workspaces/${workspaceId}/overview`,
    ),
  getUserWorkRecords: (userId: string) =>
    request<{ workRecords: WorkRecord[] }>(`/api/users/${userId}/work-records`),
  getAgentWorkRecords: (agentId: string) =>
    request<{ workRecords: WorkRecord[] }>(`/api/agents/${agentId}/work-records`),
}
