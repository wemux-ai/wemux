import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type {
  AgentRuntimeSettings,
  ExecutorAgentSessionSource,
  ExecutorGitCommitDiffResult,
  ExecutorGitChangeActionResult,
  ExecutorGitDiffResult,
  ExecutorGitFileDiffResult,
  ExecutorGitGraphResult,
  ExecutorGitRebaseResult,
  ExecutorGitWorkingTreeDiffResult,
  ExecutorGitStatusResult,
  MainChatSession,
  OpenPreviewRequest,
  OpenPreviewResponse,
  WorkspaceRemoteCodeResponse,
  CreatePreviewShareRequest,
  CreatePreviewShareResponse,
  GetPreviewResponse,
  GetTaskPreviewResponse,
  RevokePreviewShareResponse,
  StopPreviewResponse,
  Task,
  TaskRun,
  WorkspaceSessionAgentInvocationMode,
  WorkspaceSessionKind,
  WorkspaceSessionRole,
  WorkspaceSessionTitleOrigin,
  Workspace,
} from '@shared/types'
import type { TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  AddTaskCommentPayload,
  AddTaskCommentResponse,
  TaskCommentPreviewResponse,
  TaskCommentMutationResponse,
  TaskCommentReactionPayload,
  TaskCommentResolutionPayload,
  TaskSubscriberPayload,
  UpdateTaskCommentPayload,
  ApiResponse,
  CreateTaskPayload,
  TaskQuickCreatePayload,
  TaskQuickCreateResponse,
  TaskQuickCreateStatusResponse,
  ExecuteTaskPayload,
  TaskAssignmentOptions,
  TaskAgentActivityRecord,
  RecordTaskObservationPayload,
  StartAssignedAgentPayload,
  TaskConversationPayload,
  TaskEnvironmentActionResponse,
  TaskEnvironmentStatusResponse,
  TaskGitPullRequestResult,
  TaskImportAgentSessionResponse,
  TaskImportableAgentSessionPayload,
  TaskImportableAgentSessionsPayload,
  TaskMutationResponse,
  TaskAgentRetrySessionMode,
  TaskWorkspaceBindingResponse,
  WorkspaceDesktopSandboxActionPayload,
  WorkspaceDesktopSandboxCommandPayload,
  WorkspaceDesktopSandboxOpenPayload,
  WorkspaceDesktopSandboxResponse,
  WorkspaceDesktopSandboxScopePayload,
  UpdateTaskPayload,
} from '../types'

/** 轻量可见任务摘要（供「分享到聊天」会话选择器） */
export type TaskSummary = {
  id: string
  title: string
  status: string
  updatedAt: string
}
import { request } from '../client'

export const tasksMethods = {
  createTask: (payload: CreateTaskPayload) =>
    request<ApiResponse>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  quickCreateTask: (payload: TaskQuickCreatePayload) =>
    request<TaskQuickCreateResponse>('/api/tasks/quick-create', { method: 'POST', body: JSON.stringify(payload) }),
  getQuickCreateTaskStatus: (creationRunId: string) =>
    request<TaskQuickCreateStatusResponse>(`/api/tasks/quick-create/${encodeURIComponent(creationRunId)}`),
  createSubtask: (taskId: string, payload: CreateTaskPayload) =>
    request<ApiResponse>(`/api/tasks/${taskId}/subtasks`, { method: 'POST', body: JSON.stringify(payload) }),
  executeTask: (taskId: string, payload: ExecuteTaskPayload) =>
    request<ApiResponse>(`/api/tasks/${taskId}/execute`, { method: 'POST', body: JSON.stringify(payload) }),
  bindTaskWorkspace: (
    taskId: string,
    workspaceId: string,
    options?: {
      baseBranch?: string
      agentType?: Task['agentType']
      includeResources?: boolean
      workingDirectoryMode?: Workspace['workingDirectoryMode']
      workspaceSessionId?: string
      createNewSession?: boolean
      title?: string
      customAgentId?: string
      customAgentName?: string
      agentInvocationMode?: WorkspaceSessionAgentInvocationMode
      sessionKind?: WorkspaceSessionKind
      sessionRole?: WorkspaceSessionRole
      titleOrigin?: WorkspaceSessionTitleOrigin
      parentSessionId?: string
      rootSessionId?: string
      delegatedPrompt?: string
    },
  ) =>
    request<TaskWorkspaceBindingResponse>(`/api/tasks/${taskId}/workspaces`, {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        baseBranch: options?.baseBranch,
        agentType: options?.agentType,
        includeResources: options?.includeResources ?? false,
        workingDirectoryMode: options?.workingDirectoryMode,
        workspaceSessionId: options?.workspaceSessionId,
        createNewSession: options?.createNewSession,
        title: options?.title,
        customAgentId: options?.customAgentId,
        customAgentName: options?.customAgentName,
        agentInvocationMode: options?.agentInvocationMode,
        sessionKind: options?.sessionKind,
        sessionRole: options?.sessionRole,
        titleOrigin: options?.titleOrigin,
        parentSessionId: options?.parentSessionId,
        rootSessionId: options?.rootSessionId,
        delegatedPrompt: options?.delegatedPrompt,
      }),
    }),
  listTaskRuns: (taskId: string) => request<{ runs: TaskRun[] }>(`/api/tasks/${taskId}/runs`),
  getTaskConversation: (
    taskId: string,
    workspaceId?: string,
    workspaceSessionId?: string,
    options?: {
      afterMessageId?: string
      beforeMessageId?: string
      limit?: number
      recentTurns?: number
    },
  ) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    if (options?.afterMessageId?.trim()) {
      search.set('afterMessageId', options.afterMessageId.trim())
    }
    if (options?.beforeMessageId?.trim()) {
      search.set('beforeMessageId', options.beforeMessageId.trim())
    }
    if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
      search.set('limit', String(options.limit))
    }
    if (typeof options?.recentTurns === 'number' && Number.isFinite(options.recentTurns)) {
      search.set('recentTurns', String(options.recentTurns))
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<TaskConversationPayload>(`/api/tasks/${taskId}/conversation${suffix}`)
  },
  listImportableAgentSessions: (taskId: string, workspaceId: string, workspaceSessionId?: string, executorId?: string) => {
    const search = new URLSearchParams({
      workspaceId: workspaceId.trim(),
    })
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    if (executorId?.trim()) {
      search.set('executorId', executorId.trim())
    }
    return request<TaskImportableAgentSessionsPayload>(`/api/tasks/${taskId}/importable-agent-sessions?${search.toString()}`)
  },
  getImportableAgentSession: (
    taskId: string,
    payload: {
      workspaceId: string
      workspaceSessionId?: string
      executorId?: string
      source: ExecutorAgentSessionSource
      sessionId: string
    },
  ) => {
    const search = new URLSearchParams({
      workspaceId: payload.workspaceId.trim(),
      source: payload.source,
      sessionId: payload.sessionId.trim(),
    })
    if (payload.workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', payload.workspaceSessionId.trim())
    }
    if (payload.executorId?.trim()) {
      search.set('executorId', payload.executorId.trim())
    }
    return request<TaskImportableAgentSessionPayload>(`/api/tasks/${taskId}/importable-agent-session?${search.toString()}`)
  },
  importAgentSessionToWorkspace: (
    taskId: string,
    payload: {
      workspaceId: string
      workspaceSessionId?: string
      executorId?: string
      source: ExecutorAgentSessionSource
      sessionId: string
    },
  ) =>
    request<TaskImportAgentSessionResponse>(`/api/tasks/${taskId}/import-agent-session`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTaskChatSession: (taskId: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<TaskChatSessionSnapshot>(`/api/tasks/${taskId}/chat-session${suffix}`)
  },
  /** 轻量可见任务摘要（供「分享到聊天」选择器） */
  listTaskSummaries: () => request<{ tasks: TaskSummary[] }>('/api/tasks/summaries'),
  /** 轻量主聊天会话摘要（供「分享到聊天」选择器；agentId 可选=按 Agent 过滤） */
  listMainChatSessionSummaries: (options?: { agentId?: string }) => {
    const query = options?.agentId?.trim() ? `?agentId=${encodeURIComponent(options.agentId.trim())}` : ''
    return request<{ sessions: Array<{ id: string; title: string; updatedAt: string }> }>(`/api/ai/sessions/summaries${query}`)
  },
  /** 发送 Drive 文件引用到任务会话（8a：不复制内容，Agent 读原文件） */
  sendDriveFileToTask: (taskId: string, driveFileId: string) =>
    request<{ attachment: TaskChatAttachment }>(`/api/tasks/${taskId}/attachments/drive`, {
      method: 'POST',
      body: JSON.stringify({ driveFileId }),
    }),
  /** 发送 Drive 文件引用到主聊天会话（8a） */
  sendDriveFileToMainChat: (sessionId: string, driveFileId: string) =>
    request<{ attachment: TaskChatAttachment }>(`/api/ai/sessions/${sessionId}/attachments/drive`, {
      method: 'POST',
      body: JSON.stringify({ driveFileId }),
    }),
  /** 发送 Drive 文件引用到工作区群聊会话（8a） */
  sendDriveFileToGroupChat: (workspaceId: string, conversationId: string, sessionId: string, driveFileId: string) =>
    request<{ attachment: TaskChatAttachment }>(`/api/workspaces/${workspaceId}/chat/groups/${conversationId}/sessions/${sessionId}/attachments/drive`, {
      method: 'POST',
      body: JSON.stringify({ driveFileId }),
    }),
  advanceTask: (id: string) => request<ApiResponse>(`/api/tasks/${id}/advance`, { method: 'POST' }),
  retryTask: (id: string) => request<ApiResponse>(`/api/tasks/${id}/retry`, { method: 'POST' }),
  cleanupTask: (id: string) => request<ApiResponse>(`/api/tasks/${id}/cleanup`, { method: 'POST' }),
  ensureTaskWorktree: (id: string, workspaceId?: string, workspaceSessionId?: string, createNewSession?: boolean, autoEnvironmentInstall?: boolean) =>
    request<ApiResponse>(`/api/tasks/${id}/ensure-worktree`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, workspaceSessionId, createNewSession, autoEnvironmentInstall }),
    }),
  runTaskEnvironmentAction: (id: string, action: 'start' | 'stop' | 'logs', workspaceId?: string, workspaceSessionId?: string, createNewSession?: boolean) =>
    request<TaskEnvironmentActionResponse>(`/api/tasks/${id}/environment/${action}`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId, workspaceSessionId, createNewSession }),
    }),
  getTaskEnvironmentStatus: (id: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<TaskEnvironmentStatusResponse>(`/api/tasks/${id}/environment/status${suffix}`)
  },
  openTaskPreview: (id: string, payload: OpenPreviewRequest) =>
    request<OpenPreviewResponse>(`/api/tasks/${id}/preview/open`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTaskPreview: (id: string, workspaceId?: string, workspaceSessionId?: string, meshSourceExecutorId?: string, expectedExecutorId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    if (meshSourceExecutorId?.trim()) {
      search.set('meshSourceExecutorId', meshSourceExecutorId.trim())
    }
    if (expectedExecutorId?.trim()) {
      search.set('expectedExecutorId', expectedExecutorId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<GetTaskPreviewResponse>(`/api/tasks/${id}/preview/current${suffix}`)
  },
  getTaskDesktopSandbox: (id: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<WorkspaceDesktopSandboxResponse>(`/api/tasks/${id}/desktop-sandbox/current${suffix}`)
  },
  openTaskDesktopSandbox: (id: string, payload: WorkspaceDesktopSandboxOpenPayload) =>
    request<WorkspaceDesktopSandboxResponse>(`/api/tasks/${id}/desktop-sandbox/open`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTaskRemoteCode: (id: string, workspaceId?: string, workspaceSessionId?: string, signal?: AbortSignal) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<WorkspaceRemoteCodeResponse>(`/api/tasks/${id}/remote-code/current${suffix}`, { signal })
  },
  openTaskRemoteCode: (id: string, payload: { workspaceId?: string; workspaceSessionId?: string }) =>
    request<WorkspaceRemoteCodeResponse>(`/api/tasks/${id}/remote-code/open`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopTaskRemoteCode: (id: string, payload: { workspaceId?: string; workspaceSessionId?: string }) =>
    request<WorkspaceRemoteCodeResponse>(`/api/tasks/${id}/remote-code/stop`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopTaskDesktopSandbox: (id: string, payload: WorkspaceDesktopSandboxScopePayload) =>
    request<WorkspaceDesktopSandboxResponse>(`/api/tasks/${id}/desktop-sandbox/stop`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),  runTaskDesktopSandboxAction: (id: string, payload: WorkspaceDesktopSandboxActionPayload) =>
    request<WorkspaceDesktopSandboxResponse>(`/api/tasks/${id}/desktop-sandbox/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runTaskDesktopSandboxCommand: (id: string, payload: WorkspaceDesktopSandboxCommandPayload) =>
    request<WorkspaceDesktopSandboxResponse>(`/api/tasks/${id}/desktop-sandbox/command`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPreview: (previewId: string, meshSourceExecutorId?: string) => {
    const search = new URLSearchParams()
    if (meshSourceExecutorId?.trim()) {
      search.set('meshSourceExecutorId', meshSourceExecutorId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<GetPreviewResponse>(`/api/previews/${previewId}${suffix}`)
  },
  stopPreview: (previewId: string) =>
    request<StopPreviewResponse>(`/api/previews/${previewId}/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  sharePreview: (previewId: string, payload?: CreatePreviewShareRequest) =>
    request<CreatePreviewShareResponse>(`/api/previews/${previewId}/share`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  revokePreviewShare: (previewId: string) =>
    request<RevokePreviewShareResponse>(`/api/previews/${previewId}/share/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  recordTaskObservation: (id: string, payload: RecordTaskObservationPayload) =>
    request<ApiResponse>(`/api/tasks/${id}/observations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTaskGitDiff: (id: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ExecutorGitDiffResult>(`/api/tasks/${id}/git/diff${suffix}`)
  },
  getTaskGitWorkingTreeDiff: (id: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ExecutorGitWorkingTreeDiffResult>(`/api/tasks/${id}/git/working-tree-diff${suffix}`)
  },
  getTaskGitStatus: (id: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) search.set('workspaceId', workspaceId.trim())
    if (workspaceSessionId?.trim()) search.set('workspaceSessionId', workspaceSessionId.trim())
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ExecutorGitStatusResult>(`/api/tasks/${id}/git/status${suffix}`)
  },
  getTaskGitFileDiff: (id: string, path: string, stage: 'staged' | 'unstaged', workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams({ path, stage })
    if (workspaceId?.trim()) search.set('workspaceId', workspaceId.trim())
    if (workspaceSessionId?.trim()) search.set('workspaceSessionId', workspaceSessionId.trim())
    return request<ExecutorGitFileDiffResult>(`/api/tasks/${id}/git/file-diff?${search.toString()}`)
  },
  applyTaskGitChange: (id: string, payload: {
    workspaceId?: string
    workspaceSessionId?: string
    action: 'stage' | 'unstage' | 'discard'
    paths: string[]
  }) => request<ExecutorGitChangeActionResult>(`/api/tasks/${id}/git/change`, { method: 'POST', body: JSON.stringify(payload) }),
  commitTaskGitStagedChanges: (id: string, payload: {
    workspaceId?: string
    workspaceSessionId?: string
    commitMessage: string
    push?: boolean
  }) => request<import('@shared/types').ExecutorGitCommitResult>(`/api/tasks/${id}/git/commit-staged`, { method: 'POST', body: JSON.stringify(payload) }),
  getTaskGitCommitDiff: (id: string, sha: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    search.set('sha', sha)
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    return request<ExecutorGitCommitDiffResult>(`/api/tasks/${id}/git/commit-diff?${search.toString()}`)
  },
  getTaskGitGraph: (id: string, workspaceId?: string, workspaceSessionId?: string, limit?: number) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    if (typeof limit === 'number') {
      search.set('limit', String(limit))
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ExecutorGitGraphResult>(`/api/tasks/${id}/git/graph${suffix}`)
  },
  rebaseTaskGit: (id: string, workspaceId?: string, workspaceSessionId?: string, baseBranch?: string) =>
    request<ExecutorGitRebaseResult>(`/api/tasks/${id}/git/rebase`, {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspaceId ?? '',
        workspaceSessionId: workspaceSessionId ?? '',
        baseBranch: baseBranch ?? '',
      }),
    }),
  createTaskPullRequest: (id: string, payload: { workspaceId?: string; workspaceSessionId?: string; title?: string; body?: string; baseBranch?: string }) =>
    request<TaskGitPullRequestResult>(`/api/tasks/${id}/git/pull-request`, { method: 'POST', body: JSON.stringify(payload) }),
  refreshTaskPullRequestStatus: (id: string, payload: { workspaceId?: string; workspaceSessionId?: string }) =>
    request<TaskGitPullRequestResult>(`/api/tasks/${id}/git/pull-request/status`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteTaskWorkspaces: (id: string) => request<ApiResponse>(`/api/tasks/${id}/workspaces`, { method: 'DELETE' }),
  openTaskInVSCode: (id: string) => request<ApiResponse>(`/api/tasks/${id}/open-vscode`, { method: 'POST' }),
  deleteTask: (id: string) => request<ApiResponse>(`/api/tasks/${id}`, { method: 'DELETE' }),
  updateTask: (id: string, payload: UpdateTaskPayload) => request<ApiResponse>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  moveTask: (id: string, status: Task['status']) => request<ApiResponse>(`/api/tasks/${id}/move`, { method: 'POST', body: JSON.stringify({ status }) }),
  acknowledgeTaskConfirmation: (id: string) => request<ApiResponse>(`/api/tasks/${id}/acknowledge-confirmation`, { method: 'POST' }),
  sendToTask: (taskId: string, message: string) => request<ApiResponse>(`/api/tasks/${taskId}/send`, { method: 'POST', body: JSON.stringify({ message }) }),
  updateTaskModel: (taskId: string, executionModel?: Task['executionModel'], executorNodeId?: string, workspaceId?: string, workspaceSessionId?: string) =>
    request<ApiResponse>(`/api/tasks/${taskId}/model`, { method: 'POST', body: JSON.stringify({ executionModel: executionModel ?? '', executorNodeId: executorNodeId ?? '', workspaceId: workspaceId ?? '', workspaceSessionId: workspaceSessionId ?? '' }) }),
  updateTaskModelCompact: (taskId: string, executionModel?: Task['executionModel'], executorNodeId?: string, workspaceId?: string, workspaceSessionId?: string) =>
    request<TaskMutationResponse>(`/api/tasks/${taskId}/model?compact=1`, { method: 'POST', body: JSON.stringify({ executionModel: executionModel ?? '', executorNodeId: executorNodeId ?? '', workspaceId: workspaceId ?? '', workspaceSessionId: workspaceSessionId ?? '' }) }),
  updateTaskAgent: (taskId: string, agentType: Task['agentType'], executorNodeId?: string, workspaceId?: string, workspaceSessionId?: string) =>
    request<TaskMutationResponse>(`/api/tasks/${taskId}/agent`, { method: 'POST', body: JSON.stringify({ agentType, executorNodeId: executorNodeId ?? '', workspaceId: workspaceId ?? '', workspaceSessionId: workspaceSessionId ?? '' }) }),
  updateTaskAgentSettings: (taskId: string, agentType: Task['agentType'], agentSettings: AgentRuntimeSettings, executorNodeId?: string, workspaceId?: string, workspaceSessionId?: string) =>
    request<ApiResponse>(`/api/tasks/${taskId}/agent-settings`, {
      method: 'POST',
      body: JSON.stringify({
        agentType,
        agentSettings,
        executorNodeId: executorNodeId ?? '',
        workspaceId: workspaceId ?? '',
        workspaceSessionId: workspaceSessionId ?? '',
      }),
    }),
  updateTaskAgentSettingsCompact: (taskId: string, agentType: Task['agentType'], agentSettings: AgentRuntimeSettings, executorNodeId?: string, workspaceId?: string, workspaceSessionId?: string) =>
    request<TaskMutationResponse>(`/api/tasks/${taskId}/agent-settings?compact=1`, {
      method: 'POST',
      body: JSON.stringify({
        agentType,
        agentSettings,
        executorNodeId: executorNodeId ?? '',
        workspaceId: workspaceId ?? '',
        workspaceSessionId: workspaceSessionId ?? '',
      }),
    }),
  updateTaskMcpSettings: (taskId: string, enabledMcpServerIds: string[], workspaceId?: string, workspaceSessionId?: string) =>
    request<ApiResponse>(`/api/tasks/${taskId}/mcp-settings`, {
      method: 'POST',
      body: JSON.stringify({
        enabledMcpServerIds,
        workspaceId: workspaceId ?? '',
        workspaceSessionId: workspaceSessionId ?? '',
      }),
    }),
  updateTaskMcpSettingsCompact: (taskId: string, enabledMcpServerIds: string[], workspaceId?: string, workspaceSessionId?: string) =>
    request<TaskMutationResponse>(`/api/tasks/${taskId}/mcp-settings?compact=1`, {
      method: 'POST',
      body: JSON.stringify({
        enabledMcpServerIds,
        workspaceId: workspaceId ?? '',
        workspaceSessionId: workspaceSessionId ?? '',
      }),
    }),
  updateTaskAgentManaged: (taskId: string, agentManaged: Task['agentManaged']) =>
    request<ApiResponse>(`/api/tasks/${taskId}/agent-managed`, { method: 'POST', body: JSON.stringify({ agentManaged }) }),
  addTaskComment: (taskId: string, payload: AddTaskCommentPayload) =>
    request<AddTaskCommentResponse>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify(payload) }),
  previewTaskComment: (taskId: string, payload: AddTaskCommentPayload) =>
    request<TaskCommentPreviewResponse>(`/api/tasks/${taskId}/comments/preview`, { method: 'POST', body: JSON.stringify(payload) }),
  updateTaskComment: (taskId: string, commentId: string, payload: UpdateTaskCommentPayload) =>
    request<TaskCommentMutationResponse>(`/api/tasks/${taskId}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTaskComment: (taskId: string, commentId: string) =>
    request<TaskCommentMutationResponse>(`/api/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' }),
  setTaskCommentReaction: (taskId: string, commentId: string, payload: TaskCommentReactionPayload) =>
    request<TaskCommentMutationResponse>(`/api/tasks/${taskId}/comments/${commentId}/reaction`, { method: 'PUT', body: JSON.stringify(payload) }),
  setTaskCommentResolution: (taskId: string, commentId: string, payload: TaskCommentResolutionPayload) =>
    request<TaskCommentMutationResponse>(`/api/tasks/${taskId}/comments/${commentId}/resolution`, { method: 'PUT', body: JSON.stringify(payload) }),
  setTaskSubscriber: (taskId: string, payload: TaskSubscriberPayload) =>
    request<ApiResponse>(`/api/tasks/${taskId}/subscriber`, { method: 'PUT', body: JSON.stringify(payload) }),
  getTaskAgentActivities: (taskId: string) =>
    request<{ activities: TaskAgentActivityRecord[] }>(`/api/tasks/${taskId}/agent-activities`),
  getTaskAgentActivityTranscript: (taskId: string, eventId: string) =>
    request<{ session: MainChatSession }>(`/api/tasks/${taskId}/agent-activities/${eventId}/transcript`),
  getProjectAgentActivitySummary: (projectId: string) =>
    request<{ activeTaskIds: string[] }>(`/api/projects/${projectId}/agent-activity-summary`),
  cancelTaskAgentActivity: (taskId: string, eventId: string) =>
    request<{ activities: TaskAgentActivityRecord[] }>(`/api/tasks/${taskId}/agent-activities/${eventId}/cancel`, { method: 'POST' }),
  retryTaskAgentActivity: (taskId: string, eventId: string, sessionMode: TaskAgentRetrySessionMode) =>
    request<{ activities: TaskAgentActivityRecord[] }>(`/api/tasks/${taskId}/agent-activities/${eventId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ sessionMode }),
    }),
  startTaskAssignedAgent: (taskId: string, payload: StartAssignedAgentPayload) =>
    request<{ message: string; activities: TaskAgentActivityRecord[] }>(`/api/tasks/${taskId}/agent-run`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTaskAssignee: (taskId: string, assigneeId?: string, options?: TaskAssignmentOptions) => {
    const agentId = assigneeId?.startsWith('agent:') ? assigneeId.slice('agent:'.length) : undefined
    return request<ApiResponse>(`/api/tasks/${taskId}/assignee`, {
      method: 'POST',
      body: JSON.stringify(agentId
        ? { assigneeAgentId: agentId, ...options }
        : { assigneeId: assigneeId ?? null }),
    })
  },
  createDistributedTask: (payload: { originTaskId: string; projectId: string; description: string; priority?: 'low' | 'medium' | 'high'; timeoutSec?: number; executorNodeId?: string; returnMode?: 'summary' | 'branch' | 'commit'; syncBackStrategy?: 'none' | 'pull-branch'; gitIdentityMode?: 'personal' }) =>
    request<ApiResponse>('/api/distributed-tasks', { method: 'POST', body: JSON.stringify(payload) }),
  assignDistributedTask: (id: string, executorNodeId: string) => request<ApiResponse>(`/api/distributed-tasks/${id}/assign`, { method: 'POST', body: JSON.stringify({ executorNodeId }) }),
  createDistributedTaskPullRequest: (id: string, payload: { title?: string; body?: string; baseBranch?: string }) =>
    request<ApiResponse & { pullRequest?: TaskGitPullRequestResult }>(`/api/distributed-tasks/${id}/pull-request`, { method: 'POST', body: JSON.stringify(payload) }),
  refreshDistributedTaskPullRequestStatus: (id: string) =>
    request<ApiResponse & { pullRequest?: TaskGitPullRequestResult }>(`/api/distributed-tasks/${id}/pull-request/status`, { method: 'POST', body: JSON.stringify({}) }),
  cancelDistributedTask: (id: string) => request<ApiResponse>(`/api/distributed-tasks/${id}/cancel`, { method: 'POST' }),
  retryDistributedTask: (id: string) => request<ApiResponse>(`/api/distributed-tasks/${id}/retry`, { method: 'POST' }),
  takeoverDistributedTask: (id: string, executorNodeId?: string) => request<ApiResponse>(`/api/distributed-tasks/${id}/takeover`, { method: 'POST', body: JSON.stringify({ executorNodeId }) }),
  // ---- R8.5 任务增强（表情/自定义字段/统计） ----
  updateTaskReaction: (taskId: string, payload: { emoji: string; active: boolean }) =>
    request<ApiResponse & { reactions: Array<{ emoji: string; userIds: string[] }> }>(`/api/tasks/${taskId}/reaction`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  listTaskCustomFieldDefinitions: (projectId: string, includeArchived = false) =>
    request<{ fields: TaskCustomFieldDefinition[] }>(`/api/projects/${projectId}/task-fields${includeArchived ? '?includeArchived=true' : ''}`),
  createTaskCustomFieldDefinition: (projectId: string, payload: TaskCustomFieldDefinitionInput) =>
    request<{ field: TaskCustomFieldDefinition }>(`/api/projects/${projectId}/task-fields`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTaskCustomFieldDefinition: (projectId: string, fieldId: string, payload: Partial<TaskCustomFieldDefinitionInput>) =>
    request<{ field: TaskCustomFieldDefinition }>(`/api/projects/${projectId}/task-fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  archiveTaskCustomFieldDefinition: (projectId: string, fieldId: string) =>
    request<{ message: string }>(`/api/projects/${projectId}/task-fields/${fieldId}`, { method: 'DELETE' }),
  getTaskCustomFieldValues: (taskId: string) =>
    request<{ values: Record<string, unknown> }>(`/api/tasks/${taskId}/fields`),
  updateTaskCustomFieldValues: (taskId: string, values: Record<string, unknown>) =>
    request<{ values: Record<string, unknown> }>(`/api/tasks/${taskId}/fields`, {
      method: 'PUT',
      body: JSON.stringify(values),
    }),
  getTaskFieldStats: (projectId: string) =>
    request<{
      totalCount: number
      statusCounts: Record<string, number>
      completedCount: number
      completedAtCount: number
      fields: Record<string, { type: string; count: number; sum?: number }>
    }>(`/api/projects/${projectId}/task-field-stats`),
}

export type TaskCustomFieldType = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'user' | 'duration' | 'checkbox' | 'url'

export interface TaskCustomFieldDefinition {
  id: string
  projectId: string
  name: string
  key: string
  type: TaskCustomFieldType
  options: Array<{ label: string; value: string; color?: string }>
  required: boolean
  defaultJson?: unknown
  displayOrder: number
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface TaskCustomFieldDefinitionInput {
  name: string
  key: string
  type: TaskCustomFieldType
  options?: Array<{ label: string; value: string; color?: string }>
  required?: boolean
  defaultJson?: unknown
  displayOrder?: number
}
