// [INPUT]: Visible project scope, Task↔Workspace bindings, route focus, and directory API responses.
// [OUTPUT]: /workspaces query keys, load order, cache normalization, and query hooks.
// [POS]: Web query boundary; project priority derives task scope only from task_workspace_bindings.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { GitHubResourceBinding, Project, ProjectPullRequestListResponse, ProjectPullRequestReviewSummary, RailwayDeploymentSummary, RailwayResourceBinding, Task, TaskWorkspaceBinding, WorkspacePresenceUser, WorkspacePreviewSummary, WorkspaceSession, Workspace } from '@shared/types'
import { api, type ManagedCloudRuntimeStatus } from '../../lib/api'
import { NormalizedEntityCollectionStore } from '../../lib/app-entity-store'
import { useExecutorRuntimeData } from '../../lib/use-executor-runtime-data'
import { loadAvailableAgents } from '../../lib/use-available-agents'

export type WorkspacesPageDirectoryData = {
  archivedWorkspaceCountByProject: Record<string, number>
  executors: Awaited<ReturnType<typeof api.listExecutors>>['executors']
  managedCloudRuntime: ManagedCloudRuntimeStatus | null
  presenceByWorkspaceId: Record<string, WorkspacePresenceUser[]>
  previewByWorkspaceId: Record<string, WorkspacePreviewSummary>
  updatedProjects: Project[]
  workspacesByProject: Record<string, Workspace[]>
}

export const workspacesPageQueryKeys = {
  agents: ['workspaces', 'agents'] as const,
  directory: (projectIds: string, includeArchived = false) => ['workspaces', 'directory', projectIds, includeArchived ? 'with-archived' : 'active-only'] as const,
  reviewPullRequests: (projectIds: string) => ['workspaces', 'github-pull-requests', projectIds] as const,
  githubResourceBindings: (projectIds: string) => ['workspaces', 'github-resource-bindings', projectIds] as const,
  railwayDeployments: (projectIds: string) => ['workspaces', 'railway-deployments', projectIds] as const,
  railwayResourceBindings: (projectIds: string) => ['workspaces', 'railway-resource-bindings', projectIds] as const,
}

const WORKSPACES_PAGE_DIRECTORY_CACHE_TTL_MS = 30_000
const workspaceEntityStore = new NormalizedEntityCollectionStore<Workspace>()

export const resolveWorkspacesPageDirectoryProjectIds = (params: {
  projects: Pick<Project, 'id'>[]
  routeProjectId?: string
  selectedProjectId?: string
  routeTaskId?: string
  routeWorkspaceId?: string
  tasks: Pick<Task, 'id' | 'projectId'>[]
  taskWorkspaceBindings: Pick<TaskWorkspaceBinding, 'id' | 'taskId' | 'workspaceId' | 'status'>[]
  workspaceSessions: Pick<WorkspaceSession, 'workspaceId'>[]
}) => {
  const visibleProjectIds = new Set(params.projects.map((project) => project.id))
  const projectIds: string[] = []
  const addProjectId = (projectId?: string) => {
    const normalizedProjectId = projectId?.trim() || ''
    if (!normalizedProjectId || !visibleProjectIds.has(normalizedProjectId) || projectIds.includes(normalizedProjectId)) {
      return
    }

    projectIds.push(normalizedProjectId)
  }

  const taskById = new Map(params.tasks.map((task) => [task.id, task] as const))
  const addTaskProjectId = (taskId?: string) => {
    addProjectId(taskById.get(taskId?.trim() || '')?.projectId)
  }
  const routeWorkspaceId = params.routeWorkspaceId?.trim() || ''

  addProjectId(params.routeProjectId)
  addTaskProjectId(params.routeTaskId)

  if (routeWorkspaceId) {
    for (const binding of params.taskWorkspaceBindings) {
      if (binding.status === 'active' && binding.workspaceId === routeWorkspaceId) {
        addTaskProjectId(binding.taskId)
      }
    }
  }

  addProjectId(params.selectedProjectId)
  addProjectId(params.projects[0]?.id)

  return projectIds
}

export const resolveWorkspacesPageDirectoryLoadOrder = (
  projects: Pick<Project, 'id'>[],
  priorityProjectIds: string[],
) => {
  const projectIds = projects.map((project) => project.id)
  const visibleProjectIds = new Set(projectIds)
  const orderedProjectIds: string[] = []
  const append = (projectId?: string) => {
    const normalizedProjectId = projectId?.trim() || ''
    if (!normalizedProjectId || !visibleProjectIds.has(normalizedProjectId) || orderedProjectIds.includes(normalizedProjectId)) {
      return
    }

    orderedProjectIds.push(normalizedProjectId)
  }

  for (const projectId of priorityProjectIds) {
    append(projectId)
  }
  for (const projectId of projectIds) {
    append(projectId)
  }

  return orderedProjectIds
}

export const resolveWorkspacesPageDirectoryProjectIdsKey = (projectIds: string[]) => {
  return Array.from(new Set(
    projectIds
      .map((projectId) => projectId.trim())
      .filter(Boolean),
  ))
    .sort()
    .join('|')
}

export const resolveWorkspacesPageDirectoryRefetchInterval = (
  hasCloningProjects: boolean,
  isDocumentHidden = typeof document !== 'undefined' ? document.hidden : false,
) => {
  if (isDocumentHidden) {
    return false
  }

  return hasCloningProjects ? 5_000 : 30_000
}

export const resolveWorkspacesPageDirectoryLoading = (params: {
  workspaceScopeLoading: boolean
  directoryLoading: boolean
}) => {
  return params.workspaceScopeLoading || params.directoryLoading
}

export const resolvePreferredWorkspacesPageDirectoryData = (params: {
  activeDirectoryData: WorkspacesPageDirectoryData | undefined
  archivedDirectoryData: WorkspacesPageDirectoryData | undefined
  archivedDirectoryLoaded: boolean
}) => {
  if (!params.archivedDirectoryLoaded) {
    return params.activeDirectoryData
  }

  return params.archivedDirectoryData ?? params.activeDirectoryData
}

export const normalizeWorkspacesPageDirectoryCache = (
  current: WorkspacesPageDirectoryData,
  includeArchived: boolean,
): WorkspacesPageDirectoryData => {
  const archivedWorkspaceCountByProject = { ...current.archivedWorkspaceCountByProject }
  const workspacesByProject = Object.fromEntries(
    Object.entries(current.workspacesByProject).map(([projectId, projectWorkspaces]) => {
      if (includeArchived) {
        archivedWorkspaceCountByProject[projectId] = projectWorkspaces.filter((workspace) => workspace.status === 'archived').length
      }
      return [
        projectId,
        includeArchived
          ? projectWorkspaces
          : projectWorkspaces.filter((workspace) => workspace.status !== 'archived'),
      ]
    }),
  ) as Record<string, Workspace[]>

  return {
    ...current,
    archivedWorkspaceCountByProject,
    workspacesByProject,
  }
}

export const useWorkspacesPageDirectoryQuery = (
  projects: Project[],
  projectIdsKey: string,
  enabled = true,
  options?: { includeArchived?: boolean },
) => {
  // executors/managedCloudRuntime 复用共享的 react-query 缓存和轮询（useExecutorRuntimeData），
  // 不再在这里各自定义一份同 key 的 useQuery，避免重复的查询定义和潜在的配置漂移。
  const { executors, managedCloudRuntime, executorsLoading } = useExecutorRuntimeData()
  const hasCloningProjects = projects.some((project) => project.repositoryCloneStatus === 'cloning')
  const includeArchived = options?.includeArchived ?? false
  const directoryQuery = useQuery<WorkspacesPageDirectoryData>({
    queryKey: workspacesPageQueryKeys.directory(projectIdsKey, includeArchived),
    enabled: enabled && projects.length > 0,
    queryFn: async () => {
      const response = await api.listWorkspaceDirectory(projects.map((project) => project.id), { includeArchived })
      return {
        archivedWorkspaceCountByProject: Object.fromEntries(
          projects.map((project) => [project.id, response.archivedWorkspaceCountByProject?.[project.id] ?? 0]),
        ) as Record<string, number>,
        executors: [],
        managedCloudRuntime: null,
        presenceByWorkspaceId: response.presenceByWorkspaceId ?? {},
        previewByWorkspaceId: response.previewByWorkspaceId ?? {},
        updatedProjects: response.projects,
        workspacesByProject: Object.fromEntries(
          projects.map((project) => [
            project.id,
            workspaceEntityStore.reconcile(response.workspacesByProject[project.id] ?? [] as Workspace[]),
          ]),
        ) as Record<string, Workspace[]>,
      }
    },
    staleTime: hasCloningProjects ? 5_000 : WORKSPACES_PAGE_DIRECTORY_CACHE_TTL_MS,
    refetchInterval: () => resolveWorkspacesPageDirectoryRefetchInterval(hasCloningProjects),
  })
  const cachedDirectoryData = directoryQuery.data
  const data = useMemo(() => ({
    archivedWorkspaceCountByProject: Object.fromEntries(
      projects.map((project) => [project.id, cachedDirectoryData?.archivedWorkspaceCountByProject[project.id] ?? 0]),
    ) as Record<string, number>,
    executors: executors.length > 0 ? executors : cachedDirectoryData?.executors ?? [],
    managedCloudRuntime: managedCloudRuntime ?? cachedDirectoryData?.managedCloudRuntime ?? null,
    presenceByWorkspaceId: cachedDirectoryData?.presenceByWorkspaceId ?? {},
    previewByWorkspaceId: cachedDirectoryData?.previewByWorkspaceId ?? {},
    updatedProjects: cachedDirectoryData?.updatedProjects ?? [],
    workspacesByProject: Object.fromEntries(
      projects.map((project) => [project.id, cachedDirectoryData?.workspacesByProject[project.id] ?? [] as Workspace[]]),
    ) as Record<string, Workspace[]>,
  } satisfies WorkspacesPageDirectoryData), [
    cachedDirectoryData,
    executors,
    managedCloudRuntime,
    projects,
  ])

  return {
    data,
    error: directoryQuery.error ?? null,
    hasDirectoryData: Boolean(directoryQuery.data),
    isFetching: executorsLoading || directoryQuery.isFetching,
    isLoading: enabled && projects.length > 0 && (
      executorsLoading
      || directoryQuery.isLoading
    ),
  }
}

export const useWorkspacesPageAgentsQuery = () => {
  return useQuery({
    queryKey: workspacesPageQueryKeys.agents,
    queryFn: loadAvailableAgents,
    staleTime: 60_000,
  })
}

type WorkspacesPageReviewPullRequestLoader = (params: {
  projectIds: string[]
  cursor?: string
  limit: number
  scope: 'summary'
}) => Promise<Pick<ProjectPullRequestListResponse, 'pullRequests' | 'nextCursor' | 'hasMore'>>

export const loadWorkspacesPageReviewPullRequests = async (
  projectIds: string[],
  loadPage: WorkspacesPageReviewPullRequestLoader = api.listProjectGitHubPullRequests,
) => {
  const pullRequests: ProjectPullRequestReviewSummary[] = []
  let cursor: string | undefined

  do {
    const response = await loadPage({
      projectIds,
      cursor,
      limit: 100,
      scope: 'summary',
    })
    pullRequests.push(...response.pullRequests)
    cursor = response.nextCursor?.trim() || undefined
    if (!response.hasMore) {
      break
    }
  } while (cursor)

  return pullRequests
}

export const useWorkspacesPageReviewPullRequestsQuery = (enabled: boolean, projectIds: string[], projectIdsKey: string) => {
  return useQuery({
    queryKey: workspacesPageQueryKeys.reviewPullRequests(projectIdsKey),
    enabled: enabled && projectIds.length > 0,
    queryFn: () => loadWorkspacesPageReviewPullRequests(projectIds),
    staleTime: 10_000,
    refetchInterval: 10_000,
  })
}

type WorkspacesPageGitHubResourceBindingLoader = (filter: {
  projectIds: string[]
  resourceType: 'pull_request'
}) => Promise<{ bindings: GitHubResourceBinding[] }>

export const loadWorkspacesPageGitHubResourceBindings = async (
  projectIds: string[],
  loadBindings: WorkspacesPageGitHubResourceBindingLoader = api.listGitHubResourceBindings,
) => {
  if (projectIds.length === 0) {
    return []
  }

  return (await loadBindings({
    projectIds,
    resourceType: 'pull_request',
  })).bindings
}

export const useWorkspacesPageGitHubResourceBindingsQuery = (
  enabled: boolean,
  projectIds: string[],
  projectIdsKey: string,
) => useQuery({
  queryKey: workspacesPageQueryKeys.githubResourceBindings(projectIdsKey),
  enabled: enabled && projectIds.length > 0,
  queryFn: () => loadWorkspacesPageGitHubResourceBindings(projectIds),
  staleTime: 10_000,
  refetchInterval: 10_000,
})

export const loadWorkspacesPageRailwayDeployments = async (
  projectIds: string[],
  loadDeployments: (projectIds: string[]) => Promise<{ deployments: RailwayDeploymentSummary[] }> = api.listRailwayDeployments,
) => {
  if (projectIds.length === 0) {
    return []
  }

  return (await loadDeployments(projectIds)).deployments
}

export const useWorkspacesPageRailwayDeploymentsQuery = (
  enabled: boolean,
  projectIds: string[],
  projectIdsKey: string,
) => useQuery({
  queryKey: workspacesPageQueryKeys.railwayDeployments(projectIdsKey),
  enabled: enabled && projectIds.length > 0,
  queryFn: () => loadWorkspacesPageRailwayDeployments(projectIds),
  staleTime: 10_000,
  refetchInterval: 10_000,
})

export const loadWorkspacesPageRailwayResourceBindings = async (
  projectIds: string[],
  loadBindings: (filter: { projectIds: string[]; resourceType: 'deployment' }) => Promise<{ bindings: RailwayResourceBinding[] }> = api.listRailwayResourceBindings,
) => {
  if (projectIds.length === 0) {
    return []
  }

  return (await loadBindings({
    projectIds,
    resourceType: 'deployment',
  })).bindings
}

export const useWorkspacesPageRailwayResourceBindingsQuery = (
  enabled: boolean,
  projectIds: string[],
  projectIdsKey: string,
) => useQuery({
  queryKey: workspacesPageQueryKeys.railwayResourceBindings(projectIdsKey),
  enabled: enabled && projectIds.length > 0,
  queryFn: () => loadWorkspacesPageRailwayResourceBindings(projectIds),
  staleTime: 10_000,
  refetchInterval: 10_000,
})
