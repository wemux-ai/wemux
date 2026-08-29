import type { Project, Workspace } from '@shared/types'
import type { RuntimeEnvironmentConfig, RuntimeEnvironmentEffectiveSummary, RuntimeEnvironmentExecutionPayload, RuntimeEnvironmentSummary } from '@shared/runtime-environment'
import type {
  ApiResponse,
  GitHubResourceBinding,
  GitHubResourceBindingFilter,
  GitHubResourceBindingMutationPayload,
  GitHubResourceBindingResponse,
  ProjectGitHubWorkflowJobLogsResponse,
  ProjectGitHubWorkflowRunJobsResponse,
  ProjectGitHubWorkflowRunsResponse,
  ProjectIssuesResponse,
  ProjectPayload,
  ProjectPullRequestBulkSyncResult,
  ProjectPullRequestListResponse,
  ProjectPullRequestReviewWorkflowResponse,
  ProjectPullRequestSyncResult,
} from '../types'
import { request } from '../client'
import { createCachedRequestLoaderMap } from '../../request-cache'

export type RuntimeEnvironmentResponse = {
  config: RuntimeEnvironmentConfig | null
  summary: RuntimeEnvironmentSummary | null
  effectiveSummary?: RuntimeEnvironmentEffectiveSummary | null
  payload?: RuntimeEnvironmentExecutionPayload | null
  message?: string
  fileWrite?: {
    ok: boolean
    fileName?: string
    path?: string
    message?: string
  } | null
}

export type RuntimeEnvironmentUpdatePayload = {
  config: RuntimeEnvironmentConfig | null
  workspaceSessionId?: string
}

export type WorkspaceEnvironmentTemplateResponse = {
  workspace: Workspace
  template: Project['environmentTemplate'] | null
  effectiveTemplate: Project['environmentTemplate'] | null
  message?: string
}

const REVIEW_PULL_REQUEST_LIST_CACHE_TTL_MS = 1_000
const reviewPullRequestListLoader = createCachedRequestLoaderMap<string, ProjectPullRequestListResponse>({
  ttlMs: REVIEW_PULL_REQUEST_LIST_CACHE_TTL_MS,
  load: async (path) => request<ProjectPullRequestListResponse>(path),
})

export type ProjectMemberInfo = {
  userId: string
  accessType: 'owner' | 'member'
  name: string
  email: string
  avatarUrl?: string
}

export type ProjectMemberCandidate = {
  userId: string
  name: string
  email: string
  avatarUrl?: string
}

export const projectsMethods = {
  createProject: (payload: ProjectPayload) => request<ApiResponse>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  cloneProject: (payload: ProjectPayload) =>
    request<ApiResponse>('/api/projects/clone', { method: 'POST', body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: ProjectPayload) =>
    request<ApiResponse>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  listReviewPullRequests: (params?: { projectId?: string; projectIds?: string[]; cursor?: string; limit?: number; scope?: 'full' | 'summary' } | string) => {
    const options = typeof params === 'string' ? { projectId: params } : (params ?? {})
    const search = new URLSearchParams()
    if (options.projectId?.trim()) {
      search.append('projectId', options.projectId.trim())
    }
    for (const projectId of options.projectIds ?? []) {
      const normalizedProjectId = projectId.trim()
      if (normalizedProjectId) {
        search.append('projectId', normalizedProjectId)
      }
    }
    if (options.cursor?.trim()) {
      search.set('cursor', options.cursor.trim())
    }
    if (options.limit) {
      search.set('limit', String(options.limit))
    }
    if (options.scope) {
      search.set('scope', options.scope)
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    const path = `/api/review/pull-requests${suffix}`
    return reviewPullRequestListLoader(path)
  },
  listProjectGitHubPullRequests: (params?: { projectId?: string; projectIds?: string[]; cursor?: string; limit?: number; scope?: 'full' | 'summary' } | string) => {
    const options = typeof params === 'string' ? { projectId: params } : (params ?? {})
    const search = new URLSearchParams()
    if (options.projectId?.trim()) {
      search.append('projectId', options.projectId.trim())
    }
    for (const projectId of options.projectIds ?? []) {
      const normalizedProjectId = projectId.trim()
      if (normalizedProjectId) {
        search.append('projectId', normalizedProjectId)
      }
    }
    if (options.cursor?.trim()) {
      search.set('cursor', options.cursor.trim())
    }
    if (options.limit) {
      search.set('limit', String(options.limit))
    }
    if (options.scope) {
      search.set('scope', options.scope)
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return reviewPullRequestListLoader(`/api/github/pull-requests${suffix}`)
  },
  listGitHubResourceBindings: (filter?: GitHubResourceBindingFilter) => {
    const search = new URLSearchParams()
    for (const projectId of filter?.projectIds ?? []) {
      const normalizedProjectId = projectId.trim()
      if (normalizedProjectId) {
        search.append('projectId', normalizedProjectId)
      }
    }
    for (const [key, value] of [
      ['projectId', filter?.projectId],
      ['resourceType', filter?.resourceType],
      ['resourceId', filter?.resourceId],
      ['taskId', filter?.taskId],
      ['workspaceId', filter?.workspaceId],
      ['workspaceSessionId', filter?.workspaceSessionId],
      ['status', filter?.status],
    ] as const) {
      if (value?.trim()) {
        search.set(key, value.trim())
      }
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<{ bindings: GitHubResourceBinding[] }>(`/api/github/resource-bindings${suffix}`)
  },
  createGitHubResourceBinding: (payload: GitHubResourceBindingMutationPayload) =>
    request<GitHubResourceBindingResponse>('/api/github/resource-bindings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  syncProjectPullRequests: (projectId: string) =>
    request<ProjectPullRequestSyncResult>(`/api/projects/${projectId}/pull-requests/sync`, { method: 'POST' }),
  syncReviewPullRequests: (projectIds?: string[]) =>
    request<ProjectPullRequestBulkSyncResult>('/api/review/pull-requests/sync', {
      method: 'POST',
      body: JSON.stringify({
        projectIds: projectIds?.map((projectId) => projectId.trim()).filter(Boolean),
      }),
    }),
  startPullRequestReviewWorkflow: (pullRequestId: string) =>
    request<ProjectPullRequestReviewWorkflowResponse & ApiResponse>(`/api/review/pull-requests/${encodeURIComponent(pullRequestId)}/workflow/start`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'ai-review' }),
    }),
  listPullRequestWorkflowRuns: (pullRequestId: string) =>
    request<ProjectGitHubWorkflowRunsResponse>(`/api/review/pull-requests/${encodeURIComponent(pullRequestId)}/actions`),
  getReviewWorkflowRunJobs: (payload: { projectId: string; runId: string }) =>
    request<ProjectGitHubWorkflowRunJobsResponse>(`/api/review/actions/${encodeURIComponent(payload.projectId)}/${encodeURIComponent(payload.runId)}/jobs`),
  getReviewWorkflowJobLogs: (payload: { projectId: string; runId: string; jobId: string }) =>
    request<ProjectGitHubWorkflowJobLogsResponse>(`/api/review/actions/${encodeURIComponent(payload.projectId)}/${encodeURIComponent(payload.runId)}/jobs/${encodeURIComponent(payload.jobId)}/logs`),
  listReviewWorkflowRuns: (params?: { projectId?: string; cursor?: string; limit?: number; refresh?: boolean } | string) => {
    const options = typeof params === 'string' ? { projectId: params } : (params ?? {})
    const search = new URLSearchParams()
    if (options.projectId?.trim()) {
      search.set('projectId', options.projectId.trim())
    }
    if (options.cursor?.trim()) {
      search.set('cursor', options.cursor.trim())
    }
    if (options.limit) {
      search.set('limit', String(options.limit))
    }
    if (options.refresh) {
      search.set('refresh', '1')
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ProjectGitHubWorkflowRunsResponse>(`/api/review/actions${suffix}`)
  },
  listReviewIssues: (params?: { projectId?: string; state?: 'open' | 'closed' | 'all'; cursor?: string; limit?: number; refresh?: boolean }) => {
    const search = new URLSearchParams()
    if (params?.projectId?.trim()) {
      search.set('projectId', params.projectId.trim())
    }
    if (params?.state) {
      search.set('state', params.state)
    }
    if (params?.cursor?.trim()) {
      search.set('cursor', params.cursor.trim())
    }
    if (params?.limit) {
      search.set('limit', String(params.limit))
    }
    if (params?.refresh) {
      search.set('refresh', '1')
    }
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<ProjectIssuesResponse>(`/api/review/issues${suffix}`)
  },
  reorderProjects: (payload: { orderedProjectIds: string[] }) =>
    request<ApiResponse>('/api/projects/reorder', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getProjectRuntimeEnvironment: (projectId: string) =>
    request<RuntimeEnvironmentResponse>(`/api/projects/${projectId}/runtime-env`),
  updateProjectRuntimeEnvironment: (projectId: string, payload: RuntimeEnvironmentUpdatePayload) =>
    request<RuntimeEnvironmentResponse>(`/api/projects/${projectId}/runtime-env`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  importProjectRuntimeEnvironment: (projectId: string) =>
    request<RuntimeEnvironmentResponse & { message?: string }>(`/api/projects/${projectId}/runtime-env/import`, { method: 'POST' }),
  syncProjectSettings: (projectId: string, payload?: { executorId?: string }) => {
    const query = payload?.executorId ? `?executorId=${encodeURIComponent(payload.executorId)}` : ''
    return request<ApiResponse>(`/api/projects/${projectId}/settings/sync${query}`, { method: 'POST' })
  },
  getWorkspaceEnvironmentTemplate: (workspaceId: string) =>
    request<WorkspaceEnvironmentTemplateResponse>(`/api/workspaces/${workspaceId}/environment-template`),
  updateWorkspaceEnvironmentTemplate: (workspaceId: string, payload: { template: Project['environmentTemplate'] | null }) =>
    request<WorkspaceEnvironmentTemplateResponse>(`/api/workspaces/${workspaceId}/environment-template`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  importWorkspaceEnvironmentTemplate: (workspaceId: string, payload?: { workspaceSessionId?: string }) =>
    request<WorkspaceEnvironmentTemplateResponse>(`/api/workspaces/${workspaceId}/environment-template/import`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  syncWorkspaceSettings: (workspaceId: string, payload?: { workspaceSessionId?: string }) =>
    request<WorkspaceEnvironmentTemplateResponse>(`/api/workspaces/${workspaceId}/settings/sync`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  getWorkspaceRuntimeEnvironment: (workspaceId: string) =>
    request<RuntimeEnvironmentResponse>(`/api/workspaces/${workspaceId}/runtime-env`),
  updateWorkspaceRuntimeEnvironment: (workspaceId: string, payload: RuntimeEnvironmentUpdatePayload) =>
    request<RuntimeEnvironmentResponse>(`/api/workspaces/${workspaceId}/runtime-env`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  importProjectEnvironmentTemplate: (id: string) =>
    request<ApiResponse>(`/api/projects/${id}/environment-template/import`, { method: 'POST' }),
  deleteProject: (id: string, options: { projectName: string; deleteProjectDirectory?: boolean }) =>
    request<ApiResponse>(`/api/projects/${id}`, {
      method: 'DELETE',
      body: JSON.stringify(options ?? {}),
    }),
  saveProjectBinding: (payload: { projectId: string; nodeId: string; pathHint?: string }) =>
    request<ApiResponse>('/api/project-bindings', { method: 'POST', body: JSON.stringify(payload) }),
  deleteProjectBinding: (projectId: string, nodeId: string) => request<ApiResponse>(`/api/project-bindings/${projectId}/${nodeId}`, { method: 'DELETE' }),
  validateProjectBinding: (projectId: string, nodeId: string) => request<{ ok: boolean; name?: string; gitUrl?: string; message: string }>(`/api/project-bindings/${projectId}/validate?nodeId=${encodeURIComponent(nodeId)}`, { method: 'POST' }),
  getProjectMembers: (id: string) =>
    request<{ members: ProjectMemberInfo[] }>(`/api/projects/${encodeURIComponent(id)}/members`),
  getProjectMemberCandidates: (id: string) =>
    request<{ candidates: ProjectMemberCandidate[] }>(`/api/projects/${encodeURIComponent(id)}/member-candidates`),
  addProjectMember: (id: string, userId: string) =>
    request<ApiResponse>(`/api/projects/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  removeProjectMember: (id: string, memberUserId: string) =>
    request<ApiResponse>(`/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(memberUserId)}`, { method: 'DELETE' }),
}
