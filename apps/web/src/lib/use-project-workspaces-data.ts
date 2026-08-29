import type { Project, Workspace } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, type SetStateAction } from 'react'
import { api } from './api'
import { workspaceQueryKeys } from './workspace-query-keys'

const PROJECT_WORKSPACES_CACHE_TTL_MS = 30_000

type ProjectWorkspacesPayload = {
  project: Project | null
  workspaces: Workspace[]
}

const emptyProjectWorkspacesPayload: ProjectWorkspacesPayload = {
  project: null,
  workspaces: [],
}

const loadProjectWorkspaces = async (projectId: string): Promise<ProjectWorkspacesPayload> => {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) {
    return emptyProjectWorkspacesPayload
  }

  const response = await api.listProjectWorkspaces(normalizedProjectId)
  return {
    project: response.project ?? null,
    workspaces: response.workspaces,
  }
}

export const useProjectWorkspacesData = (projectId: string) => {
  const normalizedProjectId = projectId.trim()
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => workspaceQueryKeys.projectWorkspaces(normalizedProjectId),
    [normalizedProjectId],
  )
  const query = useQuery({
    queryKey,
    enabled: Boolean(normalizedProjectId),
    placeholderData: (previousData) => previousData,
    staleTime: PROJECT_WORKSPACES_CACHE_TTL_MS,
    queryFn: () => loadProjectWorkspaces(normalizedProjectId),
  })

  const payload = normalizedProjectId ? query.data ?? emptyProjectWorkspacesPayload : emptyProjectWorkspacesPayload
  const project = payload.project
  const workspaces = payload.workspaces
  const loading = Boolean(normalizedProjectId) && query.isLoading

  const refreshProjectWorkspaces = useCallback(async (force = false) => {
    if (!normalizedProjectId) {
      return emptyProjectWorkspacesPayload
    }

    if (force) {
      await queryClient.invalidateQueries({ queryKey })
    }

    return queryClient.fetchQuery({
      queryKey,
      queryFn: () => loadProjectWorkspaces(normalizedProjectId),
      staleTime: force ? 0 : PROJECT_WORKSPACES_CACHE_TTL_MS,
    }).catch(() => queryClient.getQueryData<ProjectWorkspacesPayload>(queryKey) ?? emptyProjectWorkspacesPayload)
  }, [normalizedProjectId, queryClient, queryKey])

  const setCachedWorkspaces = useCallback((nextWorkspaces: SetStateAction<Workspace[]>) => {
    if (!normalizedProjectId) {
      return
    }

    queryClient.setQueryData<ProjectWorkspacesPayload>(queryKey, (current) => {
      const previous = current ?? {
        project,
        workspaces: [],
      }
      const resolvedWorkspaces = typeof nextWorkspaces === 'function'
        ? nextWorkspaces(previous.workspaces)
        : nextWorkspaces

      return {
        project: previous.project ?? project,
        workspaces: resolvedWorkspaces,
      }
    })
  }, [normalizedProjectId, project, queryClient, queryKey])

  return {
    project,
    refreshProjectWorkspaces,
    setWorkspaces: setCachedWorkspaces,
    workspaces,
    workspacesLoading: loading,
  }
}
