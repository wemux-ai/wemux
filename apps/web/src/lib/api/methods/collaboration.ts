import type { ExecutorRecord, DriveFileRecord, ConversationRecord, ConversationMessageRecord } from '@shared/types'
import type {
  CollaborationWorkspace,
  CollaborationWorkspaceCreatePayload,
  CollaborationWorkspaceUpdatePayload,
  MainChatStreamEvent,
  TeamMember,
  WorkspaceBrainBillingAccess,
  WorkspaceBrainConfig,
  WorkspaceBrainFile,
  WorkspaceBrainMyContext,
  WorkspaceBrainOverview,
  WorkspaceChatAgentOption,
  WorkspaceChatGroupDetail,
  WorkspaceChatGroupSessionDetail,
  WorkspaceChatGroupSessionSummary,
  WorkspaceChatGroupSummary,
  WorkspaceGroupWithMembers,
} from '../types'
import { request, streamChatRequest } from '../client'

export type DmPeerSummary = {
  userId: string
  name: string
  /** 用户 ID（@username） */
  username?: string
  avatarUrl?: string
}

export type DmConversationListItem = {
  conversation: ConversationRecord
  peer: DmPeerSummary | null
  messageCount: number
  latestMessage?: ConversationMessageRecord
}

export const collaborationMethods = {
  /** 私聊（DM）：get-or-create 会话（跨空间开放）；createNew=true 时不查重直接新建（同一对象可开多个会话）。 */
  ensureDmConversation: (peerUserId: string, workspaceId?: string, options?: { createNew?: boolean; title?: string }) =>
    request<{ conversation: ConversationRecord; created: boolean; peer: DmPeerSummary | null }>('/api/conversations/dm', {
      method: 'POST',
      body: JSON.stringify({
        peerUserId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(options?.createNew ? { createNew: true } : {}),
        ...(options?.title ? { title: options.title } : {}),
      }),
    }),
  /** 私聊列表（含对方摘要 + 最新消息）。 */
  listDmConversations: () =>
    request<{ conversations: DmConversationListItem[] }>('/api/conversations/dm'),
  /** 可见会话列表（工作区群聊 + 任务会话，按项目/任务作用域）。 */
  listScopedConversations: () =>
    request<{ conversations: Array<{ conversation: ConversationRecord; messageCount: number }> }>('/api/conversations'),
  /** 通用会话详情（含消息；私聊/群聊/任务会话共用）。 */
  getConversationDetail: (conversationId: string) =>
    request<{ conversation: ConversationRecord; messages: ConversationMessageRecord[]; channelBindings: Array<{ id: string; channelType: string; externalChatId?: string; externalThreadId?: string; bindingMode: string }> }>(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
    ),
  /** 通用会话消息发送（私聊/群聊/任务会话共用；权限按会话成员校验）。 */
  sendConversationMessage: (conversationId: string, payload: { content: string; replyToMessageId?: string; clientMessageId?: string }) =>
    request<{ message: ConversationMessageRecord }>(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  /** 会话重命名（私聊 DM 会话名可编辑）。 */
  renameConversation: (conversationId: string, title: string) =>
    request<{ conversation: ConversationRecord }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  /** 会话置顶 / 取消置顶（私聊、群聊会话）。 */
  updateConversationPinned: (conversationId: string, pinned: boolean) =>
    request<{ conversation: ConversationRecord }>(`/api/conversations/${encodeURIComponent(conversationId)}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),
  /** 删除私聊 / 群聊会话。 */
  deleteConversation: (conversationId: string) =>
    request<{ ok: boolean; message: string }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    }),
  listCollaborationWorkspaces: () => request<{ workspaces: CollaborationWorkspace[] }>('/api/collab/workspaces'),
  getCollaborationWorkspaceMembers: (workspaceId: string) =>
    request<{ members: TeamMember[] }>(`/api/collab/workspaces/${workspaceId}/members`),
  getWorkspaceChatGroupOptions: (workspaceId: string) =>
    request<{
      workspace: CollaborationWorkspace
      members: TeamMember[]
      executors: ExecutorRecord[]
      agents: WorkspaceChatAgentOption[]
    }>(`/api/workspaces/${workspaceId}/chat/groups/options`),
  listWorkspaceChatGroups: (workspaceId: string) =>
    request<{ groups: WorkspaceChatGroupSummary[] }>(`/api/workspaces/${workspaceId}/chat/groups`),
  createWorkspaceChatGroup: (workspaceId: string, payload: {
    title: string
    description?: string
    userMemberIds?: string[]
    agentMemberIds?: string[]
  }) =>
    request<{ detail: WorkspaceChatGroupDetail }>(`/api/workspaces/${workspaceId}/chat/groups`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWorkspaceChatGroupDetail: (workspaceId: string, conversationId: string) =>
    request<{ detail: WorkspaceChatGroupDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}`),
  updateWorkspaceChatGroup: (workspaceId: string, conversationId: string, payload: { title?: string; description?: string; announcement?: string }) =>
    request<{ detail: WorkspaceChatGroupDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  listWorkspaceChatGroupSessions: (workspaceId: string, conversationId: string) =>
    request<{ sessions: WorkspaceChatGroupSessionSummary[] }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/sessions`),
  createWorkspaceChatGroupSession: (workspaceId: string, conversationId: string, payload?: { title?: string }) =>
    request<{ detail: WorkspaceChatGroupSessionDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  getWorkspaceChatGroupSessionDetail: (
    workspaceId: string,
    conversationId: string,
    sessionId: string,
    options?: {
      limit?: number
      beforeMessageId?: string
    },
  ) => {
    const search = new URLSearchParams()
    if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
      search.set('limit', String(options.limit))
    }
    if (options?.beforeMessageId?.trim()) {
      search.set('beforeMessageId', options.beforeMessageId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{ detail: WorkspaceChatGroupSessionDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/sessions/${sessionId}${suffix}`)
  },
  addWorkspaceChatGroupMember: (workspaceId: string, conversationId: string, payload: { memberType: 'user' | 'agent'; memberId: string }) =>
    request<{ detail: WorkspaceChatGroupDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  removeWorkspaceChatGroupMember: (workspaceId: string, conversationId: string, memberType: 'user' | 'agent', memberId: string) =>
    request<{ detail: WorkspaceChatGroupDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/members/${memberType}/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    }),
  leaveWorkspaceChatGroup: (workspaceId: string, conversationId: string) =>
    request<{ detail: WorkspaceChatGroupDetail }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/leave`, {
      method: 'POST',
    }),
  deleteWorkspaceChatGroup: (workspaceId: string, conversationId: string) =>
    request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}`, {
      method: 'DELETE',
    }),
  streamWorkspaceChatGroupMessage: async (
    workspaceId: string,
    conversationId: string,
    sessionId: string,
    payload: { message: string; executorId?: string; replyToMessageId?: string; clientMessageId?: string },
    onMessage: (data: MainChatStreamEvent) => void,
    signal?: AbortSignal,
  ) =>
    streamChatRequest(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/sessions/${sessionId}/messages/stream`, payload, onMessage, signal),
  /** 上传文件到工作区 Drive（R8.2-C：附件一律走 Drive 云盘）。 */
  uploadDriveFile: (workspaceId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ file: DriveFileRecord; message: string }>(`/api/collab/workspaces/${workspaceId}/drive/upload`, {
      method: 'POST',
      body: form,
    })
  },
  /** 群聊消息表情回复/点赞 toggle（R8.1）。 */
  toggleConversationMessageReaction: (
    conversationId: string,
    messageId: string,
    payload: { emoji: string; active: boolean },
  ) =>
    request<{ reactions: Array<{ emoji: string; userIds: string[] }>; reacted: boolean }>(
      `/api/conversations/${conversationId}/messages/${messageId}/reaction`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    ),
  createCollaborationWorkspace: (payload: CollaborationWorkspaceCreatePayload) =>
    request<{ workspace: CollaborationWorkspace; message?: string }>('/api/collab/workspaces', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCollaborationWorkspace: (workspaceId: string, payload: CollaborationWorkspaceUpdatePayload) =>
    request<{ workspace: CollaborationWorkspace; message?: string }>(`/api/collab/workspaces/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  // Agent Brain（feature）：协作空间级配置
  getWorkspaceBrainConfig: (workspaceId: string) =>
    request<{ config: WorkspaceBrainConfig; billing: WorkspaceBrainBillingAccess }>(`/api/collab/workspaces/${workspaceId}/brain`),
  saveWorkspaceBrainConfig: (workspaceId: string, config: Partial<WorkspaceBrainConfig>) =>
    request<{ config: WorkspaceBrainConfig; billing: WorkspaceBrainBillingAccess; message?: string }>(`/api/collab/workspaces/${workspaceId}/brain`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  // 云盘文件纳入大脑上下文（P0）
  getWorkspaceBrainFiles: (workspaceId: string) =>
    request<{ files: WorkspaceBrainFile[] }>(`/api/collab/workspaces/${workspaceId}/brain/files`),
  setWorkspaceBrainFile: (workspaceId: string, fileId: string, enabled: boolean) =>
    request<{ files: WorkspaceBrainFile[]; message?: string }>(`/api/collab/workspaces/${workspaceId}/brain/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  // 大脑只读视图聚合（P1）
  getWorkspaceBrainOverview: (workspaceId: string) =>
    request<WorkspaceBrainOverview>(`/api/collab/workspaces/${workspaceId}/brain/overview`),
  // 大脑个人上下文聚合（P3）
  getWorkspaceBrainMyContext: (workspaceId: string) =>
    request<WorkspaceBrainMyContext>(`/api/collab/workspaces/${workspaceId}/brain/my-context`),
  // ---- 会话未读（feature P2）----
  // ids 可选：显式指定会话（主对话 kind='main' 会话不在 scoped 列表，需显式传入）。
  getConversationUnreadCounts: (ids?: string[]) => {
    const query = ids && ids.length > 0 ? `?ids=${ids.map(encodeURIComponent).join(',')}` : ''
    return request<{ counts: Record<string, number> }>(`/api/conversations/unread-counts${query}`)
  },
  markConversationRead: (conversationId: string, lastReadAt?: string) =>
    request<{ ok: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'POST',
      body: JSON.stringify(lastReadAt ? { lastReadAt } : {}),
    }),
  // ---- 空间内分组（P2）----
  listWorkspaceGroups: (workspaceId: string) =>
    request<{ groups: WorkspaceGroupWithMembers[] }>(`/api/collab/workspaces/${workspaceId}/groups`),
  createWorkspaceGroup: (workspaceId: string, payload: { name: string }) =>
    request<{ group: WorkspaceGroupWithMembers; message: string }>(`/api/collab/workspaces/${workspaceId}/groups`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  renameWorkspaceGroup: (workspaceId: string, groupId: string, payload: { name: string }) =>
    request<{ group: WorkspaceGroupWithMembers; message: string }>(`/api/collab/workspaces/${workspaceId}/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteWorkspaceGroup: (workspaceId: string, groupId: string) =>
    request<{ ok: boolean; message: string }>(`/api/collab/workspaces/${workspaceId}/groups/${groupId}`, { method: 'DELETE' }),
  addWorkspaceGroupMember: (workspaceId: string, groupId: string, payload: { memberType: 'user' | 'agent'; memberId: string }) =>
    request<{ ok: boolean; added: boolean; message: string }>(`/api/collab/workspaces/${workspaceId}/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  removeWorkspaceGroupMember: (workspaceId: string, groupId: string, memberType: 'user' | 'agent', memberId: string) =>
    request<{ ok: boolean; message: string }>(
      `/api/collab/workspaces/${workspaceId}/groups/${groupId}/members/${memberType}/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    ),

  /** 工作区共享授权（分享/协作）：scope=workspace|all_sessions|session，permission=read|edit|collaborate */
  grantWorkspaceShare: (workspaceId: string, payload: {
    scope: 'workspace' | 'all_sessions' | 'session'
    sessionId?: string
    targetType: 'user' | 'agent'
    targetId: string
    permission: 'read' | 'edit' | 'collaborate'
  }) =>
    request<{ share: import('@shared/types').WorkspaceShareRecord }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/shares`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listWorkspaceShares: (workspaceId: string) =>
    request<{ shares: import('@shared/types').WorkspaceShareRecord[] }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/shares`),
  revokeWorkspaceShare: (workspaceId: string, shareId: string) =>
    request<{ ok: boolean; share: import('@shared/types').WorkspaceShareRecord | null }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/shares/${encodeURIComponent(shareId)}`,
      { method: 'DELETE' },
    ),
  /** 对方视角：共享给我的工作区/会话 */
  getSharedWorkspaces: () => request<{ entries: import('../types').SharedWorkspaceEntry[] }>('/api/shared-workspaces'),
}
