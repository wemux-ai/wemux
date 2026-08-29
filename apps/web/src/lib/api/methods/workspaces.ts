import type {
  AgentRuntimeSettings,
  AppState,
  ExecutionModelOption,
  ExecutorTerminalSessionCloseResult,
  ExecutorTerminalSessionCreateResult,
  ExecutorTerminalSessionsResult,
  ExecutorTerminalResult,
  ExecutorTerminalRequestMode,
  Project,
  ResolveWorkspacePreviewSourceResponse,
  Task,
  WorkspacePresenceState,
  WorkspacePresenceUser,
  WorkspaceSessionTitleOrigin,
  Workspace,
  WorkspacePreviewSummary,
} from '@shared/types'
import type { TaskChatAttachment } from '@shared/task-chat-attachment'
import type { TaskChatContextRef } from '@shared/task-chat-context'
import type { TaskChatMessageRuntimeConfig, TaskChatSessionSnapshot } from '@shared/task-chat-session'
import type {
  ApiResponse,
  CreateWorkspaceResponse,
  EnqueueTaskChatMessageResponse,
  TaskWorkspaceBindingResponse,
  WorkspaceSessionDeleteTurnResponse,
  WorkspaceSessionEventsPage,
  WorkspaceSessionRuntimeSnapshot,
  WorkspaceSessionSnapshot,
  WorkspaceTitleSuggestionResponse,
  WorkspaceSessionTurnRecord,
} from '../types'
import { request } from '../client'

export const workspacesMethods = {
  createWorkspaceSession: (
    workspaceId: string,
    options?: {
      baseBranch?: string
      workspaceSessionId?: string
      createNewSession?: boolean
      agentType?: Task['agentType']
      executionModel?: Task['executionModel']
      agentSettings?: AgentRuntimeSettings
      title?: string
      titleOrigin?: WorkspaceSessionTitleOrigin
    },
  ) =>
    request<TaskWorkspaceBindingResponse>(`/api/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        baseBranch: options?.baseBranch,
        workspaceSessionId: options?.workspaceSessionId,
        createNewSession: options?.createNewSession,
        agentType: options?.agentType,
        executionModel: options?.executionModel,
        agentSettings: options?.agentSettings,
        title: options?.title,
        titleOrigin: options?.titleOrigin,
      }),
    }),
  deleteWorkspaceSession: (workspaceId: string, workspaceSessionId: string) =>
    request<TaskWorkspaceBindingResponse>(`/api/workspaces/${workspaceId}/sessions/${workspaceSessionId}`, {
      method: 'DELETE',
    }),
  reorderWorkspaceSessions: (workspaceId: string, payload: { orderedSessionIds: string[] }) =>
    request<TaskWorkspaceBindingResponse>(`/api/workspaces/${workspaceId}/sessions/reorder`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateWorkspaceSessionPinned: (workspaceId: string, workspaceSessionId: string, pinned: boolean) =>
    request<TaskWorkspaceBindingResponse>(`/api/workspaces/${workspaceId}/sessions/${workspaceSessionId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }),
  autoRenameWorkspaceSession: (workspaceId: string, workspaceSessionId: string, payload: { taskId?: string; message: string }) =>
    request<TaskWorkspaceBindingResponse>(`/api/workspaces/${workspaceId}/sessions/${workspaceSessionId}/title/auto`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  forkWorkspaceSession: (
    workspaceId: string,
    workspaceSessionId: string,
    payload: {
      taskId?: string
      sourceMessageId: string
      mode: 'local' | 'worktree'
      title?: string
      revision?: {
        kind: 'rewrite-user-turn' | 'retry-assistant-turn'
        sourceTurnId?: string
        sourceUserMessageId: string
        sourceAssistantMessageId?: string
      }
    },
  ) =>
    request<TaskWorkspaceBindingResponse>(`/api/workspaces/${workspaceId}/sessions/${workspaceSessionId}/fork`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createWorkspace: (
    projectId: string,
    payload: {
      executorNodeId: string
      agentType: Task['agentType']
      executionModel?: Task['executionModel']
      agentSettings?: AgentRuntimeSettings
      name: string
      initialPrompt?: string
      imageFilename?: string
      imageDataUrl?: string
      workingDirectoryMode: Workspace['workingDirectoryMode']
      autoCommitEnabled?: boolean
      suggestedBaseBranch?: string
      taskId?: string
      nameOrigin?: WorkspaceSessionTitleOrigin
      titleOrigin?: WorkspaceSessionTitleOrigin
      deferInitialization?: boolean
    },
  ) =>
    request<CreateWorkspaceResponse>(`/api/projects/${projectId}/workspaces`, { method: 'POST', body: JSON.stringify(payload) }),
  suggestWorkspaceTitle: (
    projectId: string,
    payload: {
      executorNodeId?: string
      initialPrompt?: string
      imageFilename?: string
      imageDataUrl?: string
      fallbackTitle?: string
    },
  ) =>
    request<WorkspaceTitleSuggestionResponse>(`/api/projects/${projectId}/workspace-title-suggestion`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reorderProjectWorkspaces: (projectId: string, payload: { orderedWorkspaceIds: string[] }) =>
    request<{ workspaces: Workspace[]; message?: string }>(`/api/projects/${projectId}/workspaces/reorder`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateWorkspace: (workspaceId: string, payload: {
    name: string
    executorNodeId?: string
    autoCommitEnabled?: boolean
    taskId?: string
    workspaceSessionId?: string
  }) =>
    request<{ state: AppState; workspace: Workspace; workspaces: Workspace[]; message: string }>(`/api/workspaces/${workspaceId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  transferWorkspace: (workspaceId: string, payload: {
    executorNodeId: string
    workspaceSessionId?: string
    taskId?: string
  }) =>
    request<{ state: AppState; workspace: Workspace; workspaces: Workspace[]; message: string }>(`/api/workspaces/${workspaceId}/transfer`, { method: 'POST', body: JSON.stringify(payload) }),
  transferExecutorSessions: (executorId: string, payload: {
    targetExecutorNodeId: string
  }) =>
    request<{ transferred: number; failed: number; message: string }>(`/api/executors/${executorId}/transfer`, { method: 'POST', body: JSON.stringify(payload) }),
  archiveWorkspace: (workspaceId: string, archived: boolean) =>
    request<{ state: AppState; workspace: Workspace; workspaces: Workspace[]; message: string }>(`/api/workspaces/${workspaceId}/archive`, {
      method: 'POST',
      body: JSON.stringify({ archived }),
    }),
  deleteWorkspace: (
    workspaceId: string,
    payload?: {
      deleteLocalBranch?: boolean
      deleteRemoteBranch?: boolean
    },
  ) => request<ApiResponse>(`/api/workspaces/${workspaceId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload ?? {}),
  }),
  executeExecutorTerminal: (executorId: string, payload: { command: string; cwd?: string; mode?: ExecutorTerminalRequestMode }) =>
    request<{ ok: boolean; result: ExecutorTerminalResult }>(`/api/control-plane/executors/${executorId}/terminal`, { method: 'POST', body: JSON.stringify(payload) }),
  listExecutorTerminalSessions: (
    executorId: string,
    options?: {
      workspaceId?: string
      scope?: 'workspace' | 'executor'
    },
  ) => {
    const search = new URLSearchParams()
    if (options?.workspaceId?.trim()) {
      search.set('workspaceId', options.workspaceId.trim())
    }
    if (options?.scope?.trim()) {
      search.set('scope', options.scope.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ExecutorTerminalSessionsResult>(`/api/control-plane/executors/${executorId}/terminal-sessions${suffix}`)
  },
  createExecutorTerminalSession: (
    executorId: string,
    payload: {
      terminalId: string
      workspaceId?: string
      scope?: 'workspace' | 'executor'
      title?: string
      cwd?: string
    },
  ) => request<ExecutorTerminalSessionCreateResult>(`/api/control-plane/executors/${executorId}/terminal-sessions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  createExecutorTerminalLocalAttachTicket: (
    executorId: string,
    payload: {
      terminalId: string
      workspaceId?: string
      scope?: 'workspace' | 'executor'
      cwd?: string
      meshSourceExecutorId?: string
      transport?: 'local-direct' | 'mesh' | 'public-gateway'
    },
  ) => request<{
    ok: boolean
    ticket?: string
    expiresAt?: string
    wsUrl?: string
    transport?: 'local-direct' | 'mesh-direct' | 'mesh-relayed' | 'terminal-public-gateway'
    message?: string
  }>(`/api/control-plane/executors/${executorId}/terminal-local-attach-ticket`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  closeExecutorTerminalSession: (
    executorId: string,
    payload: {
      terminalId: string
      workspaceId?: string
      scope?: 'workspace' | 'executor'
    },
  ) => request<ExecutorTerminalSessionCloseResult>(`/api/control-plane/executors/${executorId}/terminal-sessions`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  }),
  getWorkspaceSessionSnapshot: (
    workspaceId: string,
    workspaceSessionId: string,
    options?: {
      afterSessionSeq?: number
      beforeSessionSeq?: number
      limit?: number
      visibility?: 'transcript' | 'diagnostic' | 'hidden' | 'all'
    },
  ) => {
    const search = new URLSearchParams()
    if (typeof options?.afterSessionSeq === 'number' && Number.isFinite(options.afterSessionSeq)) {
      search.set('afterSessionSeq', String(options.afterSessionSeq))
    }
    if (typeof options?.beforeSessionSeq === 'number' && Number.isFinite(options.beforeSessionSeq)) {
      search.set('beforeSessionSeq', String(options.beforeSessionSeq))
    }
    if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
      search.set('limit', String(options.limit))
    }
    if (options?.visibility) {
      search.set('visibility', options.visibility)
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<WorkspaceSessionSnapshot>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(workspaceSessionId)}${suffix}`,
    )
  },
  getWorkspaceSessionRuntime: (workspaceId: string, workspaceSessionId: string) => {
    return request<WorkspaceSessionRuntimeSnapshot>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(workspaceSessionId)}/runtime`,
    )
  },
  getWorkspaceSessionEvents: (
    workspaceId: string,
    workspaceSessionId: string,
    options?: {
      afterSessionSeq?: number
      beforeSessionSeq?: number
      limit?: number
      visibility?: 'transcript' | 'diagnostic' | 'hidden' | 'all'
    },
  ) => {
    const search = new URLSearchParams()
    if (typeof options?.afterSessionSeq === 'number' && Number.isFinite(options.afterSessionSeq)) {
      search.set('afterSessionSeq', String(options.afterSessionSeq))
    }
    if (typeof options?.beforeSessionSeq === 'number' && Number.isFinite(options.beforeSessionSeq)) {
      search.set('beforeSessionSeq', String(options.beforeSessionSeq))
    }
    if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
      search.set('limit', String(options.limit))
    }
    if (options?.visibility) {
      search.set('visibility', options.visibility)
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<WorkspaceSessionEventsPage>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(workspaceSessionId)}/events${suffix}`,
    )
  },
  getWorkspaceSessionTurns: (workspaceId: string, workspaceSessionId: string) => {
    return request<{ sessionId: string; turns: WorkspaceSessionTurnRecord[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(workspaceSessionId)}/turns`,
    )
  },
  deleteWorkspaceSessionTurn: (
    workspaceId: string,
    workspaceSessionId: string,
    payload: { turnId: string; messageId: string },
  ) => {
    return request<WorkspaceSessionDeleteTurnResponse>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(workspaceSessionId)}/history-delete-turn`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  },
  listTaskModels: (taskId: string, executorNodeId?: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (executorNodeId?.trim()) {
      search.set('executorId', executorNodeId.trim())
    }
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{ ok: boolean; models: ExecutionModelOption[]; defaultModel?: string; message?: string }>(`/api/tasks/${taskId}/models${suffix}`)
  },
  enqueueTaskChatMessage: (
    taskId: string,
    message: string,
    workspaceId?: string,
    workspaceSessionId?: string,
    attachments?: TaskChatAttachment[],
    contextRefs?: TaskChatContextRef[],
    runtimeConfig?: TaskChatMessageRuntimeConfig,
    options?: { deferUntilWorkspaceReady?: boolean; dedupeKey?: string },
  ) =>
    request<EnqueueTaskChatMessageResponse>(`/api/tasks/${taskId}/chat-queue`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        workspaceId,
        workspaceSessionId,
        attachments,
        contextRefs,
        runtimeConfig,
        deferUntilWorkspaceReady: options?.deferUntilWorkspaceReady,
        dedupeKey: options?.dedupeKey,
      }),
    }),
  removeTaskChatQueueMessage: (taskId: string, queueId: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<TaskChatSessionSnapshot>(`/api/tasks/${taskId}/chat-queue/${encodeURIComponent(queueId)}${suffix}`, {
      method: 'DELETE',
    })
  },
  deleteTaskChatMessage: (taskId: string, messageId: string, workspaceId?: string, workspaceSessionId?: string) => {
    const search = new URLSearchParams()
    if (workspaceId?.trim()) {
      search.set('workspaceId', workspaceId.trim())
    }
    if (workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<TaskChatSessionSnapshot>(`/api/tasks/${taskId}/messages/${encodeURIComponent(messageId)}${suffix}`, {
      method: 'DELETE',
    })
  },
  stopTaskChat: (taskId: string, workspaceId?: string, workspaceSessionId?: string) =>
    request<TaskChatSessionSnapshot>(`/api/tasks/${taskId}/chat-stop`, {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: workspaceId ?? '',
        workspaceSessionId: workspaceSessionId ?? '',
      }),
    }),
  listProjectWorkspaces: (projectId: string) => request<{ project?: Project; workspaces: Workspace[] }>(`/api/projects/${projectId}/workspaces`),
  listWorkspaceDirectory: (projectIds: string[], options?: { includeArchived?: boolean }) => {
    const search = new URLSearchParams()
    for (const projectId of projectIds) {
      const normalizedProjectId = projectId.trim()
      if (normalizedProjectId) {
        search.append('projectId', normalizedProjectId)
      }
    }
    if (options?.includeArchived) {
      search.set('includeArchived', '1')
    }

    const queryString = search.toString()
    return request<{
      projects: Project[]
      workspacesByProject: Record<string, Workspace[]>
      archivedWorkspaceCountByProject?: Record<string, number>
      presenceByWorkspaceId?: Record<string, WorkspacePresenceUser[]>
      previewByWorkspaceId?: Record<string, WorkspacePreviewSummary>
    }>(
      `/api/workspaces/directory${queryString ? `?${queryString}` : ''}`,
    )
  },
  resolveWorkspacePreviewSource: (workspaceId: string, port: number, meshSourceExecutorId?: string) => {
    const search = new URLSearchParams({ port: String(port) })
    if (meshSourceExecutorId?.trim()) {
      search.set('meshSourceExecutorId', meshSourceExecutorId.trim())
    }
    return request<ResolveWorkspacePreviewSourceResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/preview-source?${search.toString()}`)
  },
  recordWorkspacePresence: (
    workspaceId: string,
    payload: { state: WorkspacePresenceState; workspaceSessionId?: string },
    signal?: AbortSignal,
  ) =>
    request<{ presence: WorkspacePresenceUser | null }>(`/api/workspaces/${workspaceId}/presence`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  listWorkspaceBranches: (workspaceId: string, scope?: { taskId?: string; workspaceSessionId?: string }) => {
    const search = new URLSearchParams()
    if (scope?.taskId?.trim()) {
      search.set('taskId', scope.taskId.trim())
    }
    if (scope?.workspaceSessionId?.trim()) {
      search.set('workspaceSessionId', scope.workspaceSessionId.trim())
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{ ok: boolean; branches: string[]; defaultBranch: string; currentBranch?: string; versionControl?: Project['versionControl']; branchSources?: Record<string, 'remote' | 'local-only'>; message?: string }>(`/api/workspaces/${workspaceId}/branches${suffix}`)
  },
  switchTaskWorkspaceBranch: (taskId: string, payload: { workspaceId: string; workspaceSessionId: string; branchName: string }) =>
    request<TaskWorkspaceBindingResponse>(`/api/tasks/${taskId}/workspace-branch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listProjectBranches: (projectId: string, executorId?: string) => request<{ ok: boolean; branches: string[]; defaultBranch: string; versionControl?: Project['versionControl']; branchSources?: Record<string, 'remote' | 'local-only'>; message?: string }>(`/api/projects/${projectId}/branches${executorId ? `?executorId=${encodeURIComponent(executorId)}` : ''}`),
}
