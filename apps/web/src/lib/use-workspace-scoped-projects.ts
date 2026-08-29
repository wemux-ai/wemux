import { useEffect, useMemo, useState } from 'react'
import { isPlaygroundProjectId } from '@shared/playground-workspace'
import type { Project } from '@shared/types'
import type { CollaborationWorkspace } from './api'
import {
  COLLABORATION_WORKSPACE_CHANGE_EVENT,
  getStoredCollaborationWorkspaceId,
  resolveCollaborationWorkspaceId,
  setStoredCollaborationWorkspaceId,
} from './collaboration-workspace'
import { loadCollaborationWorkspaces } from './collaboration-workspaces-data'
import { loadWorkspaceScopedTeamProjects } from './project-collaboration-data'

const DEFAULT_PERSONAL_WORKSPACE_DESCRIPTION = '个人默认工作区'

const normalizeWorkspaceScopedId = (value?: string | null) => value?.trim() || ''

export const normalizeWorkspaceScopedPinnedProjectIds = (projectIds?: string[]) => {
  return [...new Set(
    (projectIds ?? [])
      .map((projectId) => projectId.trim())
      .filter(Boolean),
  )].sort()
}

export const resolveWorkspaceScopedWorkspaceId = (
  preferredWorkspaceId?: string | null,
  storedWorkspaceId?: string | null,
) => {
  return normalizeWorkspaceScopedId(preferredWorkspaceId) || normalizeWorkspaceScopedId(storedWorkspaceId)
}

export const resolveWorkspaceScopedActiveWorkspaceId = (
  workspaces: CollaborationWorkspace[],
  preferredWorkspaceId?: string | null,
  storedWorkspaceId?: string | null,
) => {
  return resolveCollaborationWorkspaceId(
    workspaces,
    resolveWorkspaceScopedWorkspaceId(preferredWorkspaceId, storedWorkspaceId),
  )
}

const isDefaultPersonalWorkspace = (workspace: CollaborationWorkspace | null) => {
  return workspace?.description?.trim() === DEFAULT_PERSONAL_WORKSPACE_DESCRIPTION
}

export const resolveWorkspaceScopedVisibleProjectIds = (
  projects: Project[],
  currentWorkspace: CollaborationWorkspace | null,
  selectedWorkspaceId: string,
  sharedProjectIds: string[],
  options: {
    pinnedProjectIds?: string[]
    workspaceScopePending?: boolean
  } = {},
) => {
  const projectIds = new Set(projects.map((project) => project.id))
  const pinnedVisibleIds = new Set(
    (options.pinnedProjectIds ?? [])
      .map((projectId) => projectId.trim())
      .filter((projectId) => projectIds.has(projectId)),
  )
  const normalizedWorkspaceId = normalizeWorkspaceScopedId(selectedWorkspaceId)
  if (!normalizedWorkspaceId) {
    if (options.workspaceScopePending) {
      return pinnedVisibleIds
    }

    return new Set(projects.map((project) => project.id))
  }

  const visibleIds = new Set([...sharedProjectIds, ...pinnedVisibleIds])
  const includePersonalProjects = isDefaultPersonalWorkspace(currentWorkspace)

  for (const project of projects) {
    const projectWorkspaceId = normalizeWorkspaceScopedId(project.workspaceId)
    if (projectWorkspaceId) {
      if (projectWorkspaceId === normalizedWorkspaceId) {
        visibleIds.add(project.id)
      }
      continue
    }

    if (includePersonalProjects) {
      visibleIds.add(project.id)
    }
  }

  return visibleIds
}

export function useWorkspaceScopedProjects(
  projects: Project[],
  preferredWorkspaceId?: string | null,
  options: {
    pinnedProjectIds?: string[]
  } = {},
) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(() => {
    return resolveWorkspaceScopedWorkspaceId(preferredWorkspaceId, getStoredCollaborationWorkspaceId())
  })
  const [workspaces, setWorkspaces] = useState<CollaborationWorkspace[]>([])
  const [sharedProjectIds, setSharedProjectIds] = useState<string[]>([])
  const [workspaceScopeLoading, setWorkspaceScopeLoading] = useState(true)
  const pinnedProjectIdsKey = JSON.stringify(normalizeWorkspaceScopedPinnedProjectIds(options.pinnedProjectIds))

  useEffect(() => {
    setSelectedWorkspaceId(resolveWorkspaceScopedWorkspaceId(
      preferredWorkspaceId,
      getStoredCollaborationWorkspaceId(),
    ))
  }, [preferredWorkspaceId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncSelectedWorkspaceId = () => {
      setSelectedWorkspaceId(resolveWorkspaceScopedWorkspaceId(
        preferredWorkspaceId,
        getStoredCollaborationWorkspaceId(),
      ))
    }

    window.addEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, syncSelectedWorkspaceId)
    window.addEventListener('focus', syncSelectedWorkspaceId)

    return () => {
      window.removeEventListener(COLLABORATION_WORKSPACE_CHANGE_EVENT, syncSelectedWorkspaceId)
      window.removeEventListener('focus', syncSelectedWorkspaceId)
    }
  }, [preferredWorkspaceId])

  useEffect(() => {
    const normalizedWorkspaceId = normalizeWorkspaceScopedId(selectedWorkspaceId)

    let cancelled = false
    setWorkspaceScopeLoading(true)
    setSharedProjectIds([])

    void loadCollaborationWorkspaces()
      .catch(() => [] as CollaborationWorkspace[])
      .then(async (workspaceResponse) => {
        const resolvedWorkspaceId = resolveWorkspaceScopedActiveWorkspaceId(
          workspaceResponse,
          normalizedWorkspaceId,
        )

        if (cancelled) {
          return
        }

        setWorkspaces(workspaceResponse)

        if (!resolvedWorkspaceId) {
          setSharedProjectIds([])
          setWorkspaceScopeLoading(false)
          return
        }

        if (resolvedWorkspaceId !== normalizedWorkspaceId) {
          setSelectedWorkspaceId(resolvedWorkspaceId)
          if (getStoredCollaborationWorkspaceId() !== resolvedWorkspaceId) {
            setStoredCollaborationWorkspaceId(resolvedWorkspaceId)
          }
          setSharedProjectIds([])
          return
        }

        const teamProjects = await loadWorkspaceScopedTeamProjects(resolvedWorkspaceId)
          .catch(() => [] as Project[])

        if (cancelled) {
          return
        }

        setSharedProjectIds(teamProjects.map((project) => project.id))
        setWorkspaceScopeLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedWorkspaceId])

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  )

  const visibleProjectIds = useMemo(() => {
    return resolveWorkspaceScopedVisibleProjectIds(
      projects,
      currentWorkspace,
      selectedWorkspaceId,
      sharedProjectIds,
      {
        pinnedProjectIds: JSON.parse(pinnedProjectIdsKey) as string[],
        workspaceScopePending: !normalizeWorkspaceScopedId(selectedWorkspaceId),
      },
    )
  }, [currentWorkspace, pinnedProjectIdsKey, projects, selectedWorkspaceId, sharedProjectIds])

  const visibleProjects = useMemo(
    () => projects.filter((project) => visibleProjectIds.has(project.id) && !isPlaygroundProjectId(project.id)),
    [projects, visibleProjectIds],
  )

  return {
    currentWorkspace,
    selectedWorkspaceId,
    visibleProjectIds,
    visibleProjects,
    workspaceScopeLoading,
  }
}
