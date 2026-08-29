import type { AppState, ExecutionModelOption, MainChatSession, TaskProposal } from '@shared/types'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { AgentRecord, ApiResponse, MainChatStreamEvent } from '../types'
import { request, streamChatRequest } from '../client'

export const chatMethods = {
  getProjectsWithContext: () => request<{ projects: Array<{ id: string; name: string; gitUrl: string; taskCount: number; recentTaskTitles: string[] }>; context: string }>('/api/projects/with-context'),
  createMainChatSession: (payload?: {
    title?: string
    workspaceId?: string
    executorId?: string
    cwd?: string
    executionModel?: string
  }) => request<ApiResponse>('/api/ai/sessions', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  }),
  getMainChatSession: (sessionId: string, params?: { limit?: number; beforeMessageId?: string; afterMessageId?: string }) => {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', String(params.limit))
    if (params?.beforeMessageId) searchParams.set('beforeMessageId', params.beforeMessageId)
    if (params?.afterMessageId) searchParams.set('afterMessageId', params.afterMessageId)
    const query = searchParams.toString()
    return request<{ session: MainChatSession; hasMoreBefore?: boolean; returnedMessageCount?: number }>(
      `/api/ai/sessions/${sessionId}${query ? `?${query}` : ''}`
    )
  },
  selectMainChatSession: (sessionId: string) => request<ApiResponse>(`/api/ai/sessions/${sessionId}/select`, { method: 'POST' }),
  stopMainChatSession: (sessionId: string) => request<ApiResponse>(`/api/ai/sessions/${sessionId}/stop`, { method: 'POST' }),
  deleteMainChatSession: (sessionId: string) => request<ApiResponse>(`/api/ai/sessions/${sessionId}`, { method: 'DELETE' }),
  updateMainChatSessionPinned: (sessionId: string, pinned: boolean) =>
    request<ApiResponse>(`/api/ai/sessions/${sessionId}/pin`, { method: 'POST', body: JSON.stringify({ pinned }) }),
  updateMainChatSessionExecutor: (sessionId: string, executorId?: string) =>
    request<ApiResponse>(`/api/ai/sessions/${sessionId}/executor`, { method: 'POST', body: JSON.stringify({ executorId: executorId ?? '' }) }),
  updateMainChatSessionAgent: (sessionId: string, customAgentId?: string) =>
    request<ApiResponse>(`/api/ai/sessions/${sessionId}/agent`, { method: 'POST', body: JSON.stringify({ customAgentId: customAgentId ?? '' }) }),
  /** R10.1-B：与 Agent 对话默认公开，可取消公开（private）。 */
  updateMainChatSessionVisibility: (sessionId: string, visibility: 'public' | 'private') =>
    request<ApiResponse>(`/api/ai/sessions/${sessionId}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility }) }),
  listMainChatSessionModels: (sessionId: string) =>
    request<{ ok: boolean; models: ExecutionModelOption[]; defaultModel?: string; message?: string }>(`/api/ai/sessions/${sessionId}/models`),
  updateMainChatSessionModel: (sessionId: string, executionModel?: string) =>
    request<ApiResponse>(`/api/ai/sessions/${sessionId}/model`, { method: 'POST', body: JSON.stringify({ executionModel: executionModel ?? '' }) }),
  createCustomAgentChatSession: (agentId: string, payload?: {
    title?: string
    executorId?: string
    executionModel?: string
    workspaceId?: string
  }) => request<ApiResponse>(`/api/agents/${agentId}/chat/sessions`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  }),
  deleteCustomAgentChatSession: (agentId: string, sessionId: string) => request<ApiResponse>(`/api/agents/${agentId}/chat/sessions/${sessionId}`, { method: 'DELETE' }),
  updateCustomAgentChatSessionExecutor: (agentId: string, sessionId: string, executorId?: string) =>
    request<ApiResponse>(`/api/agents/${agentId}/chat/sessions/${sessionId}/executor`, { method: 'POST', body: JSON.stringify({ executorId: executorId ?? '' }) }),
  listCustomAgentChatSessionModels: (agentId: string, sessionId: string) =>
    request<{ ok: boolean; models: ExecutionModelOption[]; defaultModel?: string; message?: string }>(`/api/agents/${agentId}/chat/sessions/${sessionId}/models`),
  updateCustomAgentChatSessionModel: (agentId: string, sessionId: string, executionModel?: string) =>
    request<ApiResponse>(`/api/agents/${agentId}/chat/sessions/${sessionId}/model`, { method: 'POST', body: JSON.stringify({ executionModel: executionModel ?? '' }) }),
  aiChat: (message: string, sessionId?: string) => request<ApiResponse>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message, sessionId: sessionId ?? '' }) }),
  aiChatStream: async (sessionId: string, message: string, onMessage: (data: MainChatStreamEvent) => void, signal?: AbortSignal, attachments?: TaskChatAttachment[], clientMessageId?: string, replyToMessageId?: string) =>
    streamChatRequest('/api/ai/chat-stream', { sessionId, message, attachments, clientMessageId, replyToMessageId }, onMessage, signal),
  customAgentChatStream: async (agentId: string, sessionId: string, message: string, onMessage: (data: MainChatStreamEvent) => void, signal?: AbortSignal, attachments?: TaskChatAttachment[], clientMessageId?: string, replyToMessageId?: string) =>
    streamChatRequest(`/api/agents/${agentId}/chat/sessions/${sessionId}/stream`, { message, attachments, clientMessageId, replyToMessageId }, onMessage, signal),
  confirmTask: (proposal: TaskProposal) =>
    request<ApiResponse>('/api/ai/confirm-task', {
      method: 'POST',
      body: JSON.stringify({
        taskProposalId: proposal.id,
        projectId: proposal.projectId,
        title: proposal.title,
        description: proposal.description,
        difficulty: proposal.difficulty,
        agentManaged: proposal.agentManaged,
      }),
    }),
  // ---------- 会话分享与 @ 记录 ----------
  createConversationShare: (conversationId: string, payload?: { messageId?: string | null; expiresAt?: string | null }) =>
    request<{ share: import('@shared/types').ConversationShareRecord; url: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/share`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  listConversationShares: (conversationId: string) =>
    request<{ shares: import('@shared/types').ConversationShareRecord[] }>(`/api/conversations/${encodeURIComponent(conversationId)}/shares`),
  deleteConversationShare: (conversationId: string, shareId: string) =>
    request<{ message: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
  // ---------- 会话多选转发 / 定向分享 / 可见性 / 搜索（wemux-session-canvas-2 功能） ----------
  searchSessions: (query: string, limit?: number) => {
    const search = new URLSearchParams({ query })
    if (typeof limit === 'number' && Number.isFinite(limit)) {
      search.set('limit', String(limit))
    }
    return request<import('../types').SessionSearchResponse>(`/api/sessions/search?${search.toString()}`)
  },
  forwardSessions: (payload: import('../types').ForwardSessionsPayload) =>
    request<import('../types').ForwardSessionsResponse>('/api/sessions/forward', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listSessionShares: (kind: import('../types').ConversationShareSourceKind, sourceId: string) =>
    request<{ shares: import('../types').ConversationShareRecord[] }>(`/api/sessions/${kind}/${sourceId}/shares`),
  createSessionShare: (kind: import('../types').ConversationShareSourceKind, sourceId: string, payload: import('../types').CreateSessionSharePayload) =>
    request<import('../types').CreateSessionShareResponse>(`/api/sessions/${kind}/${sourceId}/shares`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  revokeSessionShare: (shareId: string) =>
    request<{ share: import('../types').ConversationShareRecord }>(`/api/sessions/shares/${shareId}`, {
      method: 'DELETE',
    }),
  setSessionVisibility: (kind: import('../types').ConversationShareSourceKind, sourceId: string, visibility: import('../types').ConversationVisibility) =>
    request<{ conversation: import('../types').ConversationRecord } | { session: MainChatSession }>(`/api/sessions/${kind}/${sourceId}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    }),
  getSharedWithMe: () => request<{ shares: import('../types').SharedWithMeEntry[] }>('/api/shared-with-me'),
  getPublicSession: (token: string) => request<import('../types').PublicSessionPayload>(`/api/public/session/${encodeURIComponent(token)}`),
  // ---------- 把工作区会话链接发到聊天（纯文本消息，不触发 Agent） ----------
  sendWorkspaceLinkToMainChat: (sessionId: string, text: string) =>
    request<ApiResponse>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/messages/link`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  sendWorkspaceLinkToGroupChat: (workspaceId: string, conversationId: string, sessionId: string, text: string) =>
    request<{ message: import('../types').ConversationMessageRecord }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/chat/groups/${encodeURIComponent(conversationId)}/sessions/${encodeURIComponent(sessionId)}/messages/link`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
}
