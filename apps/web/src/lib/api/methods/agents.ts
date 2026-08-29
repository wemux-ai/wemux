import type { CustomAgentTransferPackage } from '@shared/custom-agent'
import type {
  AgentChannelResponse,
  FeishuBindingSession,
  WechatBindingSession,
  AgentCronRecord,
  AgentHeartbeatRecord,
  AgentImportResult,
  AgentRecord,
  AgentWorkdirFileEntry,
  AgentWorkdirReadResult,
  AgentWorkdirSummary,
  AgentTaskRecord,
  AgentUpdatePayload,
  AgentMindFiles,
  AgentUniverseGraph,
} from '../types'
import { authFetch, extractErrorMessage, request, resolveApiUrl } from '../client'

export const agentsMethods = {
  listAgents: (workspaceId?: string) => {
    const suffix = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : ''
    return request<{ agents: AgentRecord[] }>(`/api/agents${suffix}`)
  },
  getAgentUniverseGraph: (workspaceId?: string) => {
    const suffix = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : ''
    return request<{ graph: AgentUniverseGraph }>(`/api/agent-universe/graph${suffix}`)
  },
  createAgent: (payload: { name: string; type: string; endpoint?: string; config?: Record<string, unknown>; workspaceId?: string }) => request<{ agent: AgentRecord; syncStatus?: AgentChannelResponse['syncStatus'] }>('/api/agents', { method: 'POST', body: JSON.stringify(payload) }),
  getAgent: (id: string) => request<{ agent: AgentRecord }>(`/api/agents/${id}`),
  getAgentMind: (id: string) => request<{ mind: AgentMindFiles }>(`/api/agents/${id}/mind`),
  getAgentMindFile: (id: string, file: 'soul' | 'user' | 'memory') => request<{ mind: AgentMindFiles }>(`/api/agents/${id}/mind?file=${file}`),
  updateAgentMind: (id: string, file: 'soul' | 'user' | 'memory', content: string) => request<{ ok: boolean; message?: string }>(`/api/agents/${id}/mind`, { method: 'PUT', body: JSON.stringify({ file, content }) }),
  getAgentWorkdir: (id: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    if (executorId?.trim()) search.set('executorId', executorId)
    if (workspaceId?.trim()) search.set('workspaceId', workspaceId)
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return request<{ workdir: AgentWorkdirSummary }>(`/api/agents/${id}/workdir${suffix}`)
  },
  ensureAgentWorkdir: (id: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    if (executorId?.trim()) search.set('executorId', executorId)
    if (workspaceId?.trim()) search.set('workspaceId', workspaceId)
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return request<{ workdir: AgentWorkdirSummary; files: AgentWorkdirFileEntry[]; message?: string }>(`/api/agents/${id}/workdir/ensure${suffix}`, { method: 'POST', body: JSON.stringify({}) })
  },
  rescanAgentWorkdir: (id: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    if (executorId?.trim()) search.set('executorId', executorId)
    if (workspaceId?.trim()) search.set('workspaceId', workspaceId)
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return request<{ workdir: AgentWorkdirSummary; files: AgentWorkdirFileEntry[]; message?: string }>(`/api/agents/${id}/workdir/rescan${suffix}`, { method: 'POST', body: JSON.stringify({}) })
  },
  listAgentWorkdirFiles: (id: string, refresh = false, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    if (refresh) {
      search.set('refresh', '1')
    }
    if (executorId?.trim()) {
      search.set('executorId', executorId)
    }
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId)
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return request<{ workdir: AgentWorkdirSummary; files: AgentWorkdirFileEntry[] }>(`/api/agents/${id}/workdir/files${suffix}`)
  },
  deleteAgentWorkdirFile: (id: string, relativePath: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    search.set('path', relativePath)
    if (executorId?.trim()) {
      search.set('executorId', executorId)
    }
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId)
    }
    return request<{ workdir: AgentWorkdirSummary; files: AgentWorkdirFileEntry[]; message?: string }>(`/api/agents/${id}/workdir/files?${search.toString()}`, { method: 'DELETE' })
  },
  cleanupAgentWorkdir: (id: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    if (executorId?.trim()) search.set('executorId', executorId)
    if (workspaceId?.trim()) search.set('workspaceId', workspaceId)
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    return request<{ workdir: AgentWorkdirSummary; message?: string }>(`/api/agents/${id}/workdir/cleanup${suffix}`, { method: 'POST', body: JSON.stringify({}) })
  },
  readAgentWorkdirFile: (id: string, relativePath: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    search.set('path', relativePath)
    if (executorId?.trim()) {
      search.set('executorId', executorId)
    }
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId)
    }
    return request<AgentWorkdirReadResult>(`/api/agents/${id}/workdir/read?${search.toString()}`)
  },
  downloadAgentWorkdirFile: async (id: string, relativePath: string, executorId?: string, workspaceId?: string) => {
    const search = new URLSearchParams()
    search.set('path', relativePath)
    if (executorId?.trim()) {
      search.set('executorId', executorId)
    }
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId)
    }
    const response = await authFetch(resolveApiUrl(`/api/agents/${id}/workdir/download?${search.toString()}`), {
      method: 'GET',
    })

    if (!response.ok) {
      const text = await response.text()
      if (text) {
        throw new Error(extractErrorMessage(text))
      }

      throw new Error(`Download failed: ${response.status}`)
    }

    return {
      blob: await response.blob(),
      filename: response.headers.get('Content-Disposition')?.match(/filename=\"?([^\";]+)\"?/)?.[1] || 'download',
    }
  },
  getAgentChannel: (id: string, workspaceId?: string) => {
    const suffix = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : ''
    return request<AgentChannelResponse>(`/api/agents/${id}/channel${suffix}`)
  },
  updateAgentChannel: (id: string, payload: { channels: Record<string, unknown> }) => request<{ agent: AgentRecord; message?: string } & AgentChannelResponse>(`/api/agents/${id}/channel`, { method: 'PUT', body: JSON.stringify(payload) }),
  beginAgentFeishuBinding: (id: string) => request<FeishuBindingSession>(`/api/agents/${id}/channel/feishu/connect`, { method: 'POST' }),
  getAgentFeishuBinding: (id: string, sessionId: string) => request<FeishuBindingSession>(`/api/agents/${id}/channel/feishu/connect/${sessionId}`),
  disconnectAgentFeishu: (id: string) => request<{ ok: boolean; agent: AgentRecord; message?: string } & AgentChannelResponse>(`/api/agents/${id}/channel/feishu/connect`, { method: 'DELETE' }),
  beginAgentWechatBinding: (id: string) => request<WechatBindingSession>(`/api/agents/${id}/channel/wechat/connect`, { method: 'POST' }),
  getAgentWechatBinding: (id: string, sessionId: string) => request<WechatBindingSession>(`/api/agents/${id}/channel/wechat/connect/${sessionId}`),
  submitAgentWechatVerifyCode: (id: string, sessionId: string, verifyCode: string) => request<{ ok: boolean; message?: string }>(`/api/agents/${id}/channel/wechat/connect/${sessionId}/verify-code`, { method: 'POST', body: JSON.stringify({ verifyCode }) }),
  disconnectAgentWechat: (id: string) => request<{ ok: boolean; agent: AgentRecord; message?: string } & AgentChannelResponse>(`/api/agents/${id}/channel/wechat/connect`, { method: 'DELETE' }),
  generateAgentTelegramDeepLink: (id: string) => request<{ deepLinkUrl: string }>(`/api/agents/${id}/channel/telegram/deep-link`, { method: 'POST' }),
  deleteAgentTelegramWebhook: (id: string) => request<{ ok: boolean; message?: string }>(`/api/agents/${id}/channel/telegram/webhook`, { method: 'DELETE' }),
  exportAgent: (id: string) => request<{ package: CustomAgentTransferPackage }>(`/api/agents/${id}/export`),
  importAgent: (payload: { package: CustomAgentTransferPackage | Record<string, unknown> }) => request<{ agent: AgentRecord; imported: AgentImportResult }>('/api/agents/import', { method: 'POST', body: JSON.stringify(payload) }),
  uploadAgentAvatar: async (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await authFetch(resolveApiUrl(`/api/agents/${id}/avatar`), {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      const text = await response.text()
      if (text) {
        throw new Error(extractErrorMessage(text))
      }

      throw new Error(`Upload failed: ${response.status}`)
    }

    return response.json() as Promise<{ agent: AgentRecord; avatarUrl: string; message?: string }>
  },
  updateAgent: (id: string, payload: AgentUpdatePayload) => request<{ agent: AgentRecord; syncStatus?: AgentChannelResponse['syncStatus'] }>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAgent: (id: string) => request<{ ok: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  sendAgentHeartbeat: (id: string, payload: { status?: 'online' | 'error'; metrics?: Record<string, unknown> }) => request<{ ok: boolean }>(`/api/agents/${id}/heartbeat`, { method: 'POST', body: JSON.stringify(payload) }),
  getAgentTasks: (id: string) => request<{ tasks: AgentTaskRecord[] }>(`/api/agents/${id}/tasks`),
  getAgentCrons: (id: string) => request<{ crons: AgentCronRecord[] }>(`/api/agents/${id}/crons`),
  createAgentCron: (id: string, payload: { name: string; cronExpression: string; payload?: Record<string, unknown> }) => request<{ cron: AgentCronRecord }>(`/api/agents/${id}/crons`, { method: 'POST', body: JSON.stringify(payload) }),
  updateAgentCron: (cronId: string, payload: { name?: string; cronExpression?: string; payload?: Record<string, unknown>; enabled?: boolean }) => request<{ cron: AgentCronRecord }>(`/api/agents/crons/${cronId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  toggleAgentCron: (cronId: string, enabled: boolean) => request<{ ok: boolean }>(`/api/agents/crons/${cronId}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  triggerAgentCron: (cronId: string) => request<{ ok: boolean; eventId?: string; skipped?: boolean; reason?: string }>(`/api/agents/crons/${cronId}/trigger`, { method: 'POST' }),
  deleteAgentCron: (cronId: string) => request<{ ok: boolean }>(`/api/agents/crons/${cronId}`, { method: 'DELETE' }),
  getAgentHeartbeats: (id: string) => request<{ heartbeats: AgentHeartbeatRecord[] }>(`/api/agents/${id}/heartbeats`),
}
