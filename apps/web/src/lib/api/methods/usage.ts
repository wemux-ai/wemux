import { request } from '../client'

export type UsagePeriod = '7d' | '30d' | 'all'

export type UsageTotalsDto = {
  runCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

export type UsageSummaryDto = {
  totals: UsageTotalsDto
  daily: Array<{ date: string; runCount: number; totalTokens: number }>
  byAgent: Array<{ agentId: string | null; agentName: string | null; runCount: number; totals: UsageTotalsDto }>
  byModel: Array<{ executionModel: string | null; providerId: string | null; runCount: number; totals: UsageTotalsDto }>
  byProvider: Array<{ providerId: string | null; runCount: number; totals: UsageTotalsDto }>
  byWorkspace: Array<{ workspaceId: string | null; workspaceName: string | null; runCount: number; totals: UsageTotalsDto }>
  byRunKind: Array<{ runKind: string; runCount: number; totals: UsageTotalsDto }>
}

export type TeamMemberUsageDto = {
  userId: string
  userName: string
  role?: string
  runCount: number
  totalTokens: number
  quota?: TokenQuotaSnapshotDto
}

export type TeamModelPolicyDto = {
  teamId: string
  enabled: boolean
  allowedModelIds: string[]
  updatedAt: string | null
}

export type TeamAgentDto = {
  agentId: string
  name: string
  ownerUserId: string | null
  ownerName: string | null
  enabled: boolean
  status: string
  runCount: number
  totalTokens: number
}

export type TokenQuotaSnapshotDto = {
  policy: {
    userId: string
    period: 'day' | 'month'
    limitTokens: number
    action: 'warn' | 'block'
    enabled: boolean
    setBy?: 'self' | 'team_admin' | 'platform_admin'
    updatedAt: string
  } | null
  usedTokens: number
  limitTokens: number | null
  remainingTokens: number | null
  usagePercent: number | null
  allowed: boolean
  message: string
  periodStart: string | null
}

const withPeriod = (period?: UsagePeriod) => (period ? `?period=${period}` : '')

export const usageMethods = {
  getUsageSummary: (period?: UsagePeriod) =>
    request<{ ok: boolean; period: UsagePeriod; summary: UsageSummaryDto }>(`/api/usage/summary${withPeriod(period)}`),
  getAgentUsage: (period?: UsagePeriod) =>
    request<{ ok: boolean; period: UsagePeriod; summary: UsageSummaryDto }>(`/api/usage/agents${withPeriod(period)}`),
  getTeamUsage: (teamId?: string, period?: UsagePeriod) => {
    const search = new URLSearchParams()
    if (period) {
      search.set('period', period)
    }
    if (teamId) {
      search.set('teamId', teamId)
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{
      ok: boolean
      teamId: string
      period: UsagePeriod
      summary: UsageSummaryDto
      members: TeamMemberUsageDto[]
      message?: string
    }>(`/api/usage/team${suffix}`)
  },
  getUsageQuota: () => request<{ ok: boolean; quota: TokenQuotaSnapshotDto }>('/api/usage/quota'),
  setUsageQuota: (payload: { period: 'day' | 'month'; limitTokens: number; action: 'warn' | 'block' }) =>
    request<{ ok: boolean; message?: string; quota: TokenQuotaSnapshotDto }>('/api/usage/quota', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  setTeamMemberQuota: (payload: { teamId: string; userId: string; period: 'day' | 'month'; limitTokens: number; action: 'warn' | 'block' }) =>
    request<{ ok: boolean; message?: string; quota: TokenQuotaSnapshotDto }>('/api/usage/team/member-quota', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getTeamModelPolicy: (teamId: string) =>
    request<{ ok: boolean; teamId: string; policy: TeamModelPolicyDto }>(`/api/usage/team/models?teamId=${encodeURIComponent(teamId)}`),
  setTeamModelPolicy: (payload: { teamId: string; allowedModelIds: string[] | null }) =>
    request<{ ok: boolean; teamId: string; policy: TeamModelPolicyDto }>('/api/usage/team/models', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getTeamAgents: (teamId: string, period?: UsagePeriod) =>
    request<{ ok: boolean; teamId: string; period: UsagePeriod; agents: TeamAgentDto[]; message?: string }>(
      `/api/usage/team/agents?teamId=${encodeURIComponent(teamId)}${period ? `&period=${period}` : ''}`,
    ),
  setTeamAgentEnabled: (payload: { teamId: string; agentId: string; enabled: boolean }) =>
    request<{ ok: boolean; agentId: string; enabled: boolean; message?: string }>(
      `/api/usage/team/agents/${encodeURIComponent(payload.agentId)}/enabled?teamId=${encodeURIComponent(payload.teamId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ enabled: payload.enabled }),
      },
    ),
}
