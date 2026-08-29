import { useState } from 'react'
import { sortProjectsByDisplayOrder, sortWorkspacesByDisplayOrder } from '@shared/project-workspace-order'
import type { AppState, Project, Workspace } from '@shared/types'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import type { WorkspacesPageDirectoryData } from './workspaces-page-queries'
import type { WorkspaceListItem } from './workspaces-page-utils'

type UseWorkspacesReorderActionsOptions = {
  selectedItem: WorkspaceListItem | null
  setState: (updater: AppState | ((state: AppState) => AppState)) => void
  stateProjects: Project[]
  t: (key: string, options?: Record<string, unknown>) => string
  updateWorkspaceDirectoryCache: (
    updater: (current: WorkspacesPageDirectoryData | undefined) => WorkspacesPageDirectoryData | undefined,
  ) => void
  workspaceScopedProjects: Project[]
  workspacesByProject: Record<string, Workspace[]>
}

export const applyProjectOrderToProjects = (
  projects: Project[],
  orderedProjectIds: string[],
) => {
  const projectOrderById = new Map(orderedProjectIds.map((projectId, index) => [projectId, index] as const))
  return sortProjectsByDisplayOrder(projects.map((project) => {
    const displayOrder = projectOrderById.get(project.id)
    return typeof displayOrder === 'number'
      ? { ...project, displayOrder }
      : project
  }))
}

export const mergeReorderedWorkspaceIdsIntoProjectOrder = (
  allWorkspaceIds: string[],
  reorderedWorkspaceIds: string[],
) => {
  const validWorkspaceIds = new Set(allWorkspaceIds)
  const normalizedReorderedWorkspaceIds = reorderedWorkspaceIds.filter((workspaceId, index, list) => (
    validWorkspaceIds.has(workspaceId) && list.indexOf(workspaceId) === index
  ))

  if (normalizedReorderedWorkspaceIds.length === 0) {
    return null
  }

  if (normalizedReorderedWorkspaceIds.length === allWorkspaceIds.length) {
    return normalizedReorderedWorkspaceIds.every((workspaceId, index) => workspaceId === allWorkspaceIds[index])
      ? null
      : normalizedReorderedWorkspaceIds
  }

  const reorderedWorkspaceIdSet = new Set(normalizedReorderedWorkspaceIds)
  let reorderedIndex = 0
  const nextOrderedWorkspaceIds = allWorkspaceIds.map((workspaceId) => {
    if (!reorderedWorkspaceIdSet.has(workspaceId)) {
      return workspaceId
    }

    const nextWorkspaceId = normalizedReorderedWorkspaceIds[reorderedIndex]
    reorderedIndex += 1
    return nextWorkspaceId ?? workspaceId
  })

  return nextOrderedWorkspaceIds.every((workspaceId, index) => workspaceId === allWorkspaceIds[index])
    ? null
    : nextOrderedWorkspaceIds
}

export function useWorkspacesReorderActions({
  selectedItem,
  setState,
  stateProjects,
  t,
  updateWorkspaceDirectoryCache,
  workspaceScopedProjects,
  workspacesByProject,
}: UseWorkspacesReorderActionsOptions) {
  const [reorderingWorkspaceSessions, setReorderingWorkspaceSessions] = useState(false)

  const handleReorderWorkspaceSessions = async (orderedWorkspaceSessionIds: string[]) => {
    if (!selectedItem || orderedWorkspaceSessionIds.length <= 1) {
      return
    }

    setReorderingWorkspaceSessions(true)
    try {
      const response = await api.reorderWorkspaceSessions(selectedItem.workspace.id, {
        orderedSessionIds: orderedWorkspaceSessionIds,
      })
      setState(response.state)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.reorderSessionFailed', { defaultValue: '更新会话顺序失败。' }))
      throw error
    } finally {
      setReorderingWorkspaceSessions(false)
    }
  }

  const handleReorderProjects = async (orderedProjectIds: string[]) => {
    const visibleProjectIdSet = new Set(workspaceScopedProjects.map((project) => project.id))
    const visibleProjectOrder = orderedProjectIds.filter((projectId) => visibleProjectIdSet.has(projectId))
    if (visibleProjectOrder.length <= 1 || visibleProjectOrder.length !== workspaceScopedProjects.length) {
      return
    }

    const previousProjects = stateProjects
    const previousUpdatedProjects = workspaceScopedProjects
    setState((current) => ({
      ...current,
      projects: applyProjectOrderToProjects(current.projects, visibleProjectOrder),
    }))
    updateWorkspaceDirectoryCache((current) => current
      ? {
          ...current,
          updatedProjects: applyProjectOrderToProjects(current.updatedProjects, visibleProjectOrder),
        }
      : current)

    try {
      const response = await api.reorderProjects({ orderedProjectIds: visibleProjectOrder })
      setState(response.state)
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            updatedProjects: current.updatedProjects.map((project) => (
              response.state.projects.find((candidate) => candidate.id === project.id) ?? project
            )),
          }
        : current)
    } catch (error) {
      setState((current) => ({ ...current, projects: previousProjects }))
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            updatedProjects: previousUpdatedProjects,
          }
        : current)
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.loadFailed'))
      throw error
    }
  }

  const handleReorderProjectWorkspaces = async (projectId: string, orderedWorkspaceIds: string[]) => {
    const previousProjectWorkspaces = workspacesByProject[projectId] ?? []
    const previousProjectWorkspaceIds = previousProjectWorkspaces.map((workspace) => workspace.id)
    const nextOrderedWorkspaceIds = mergeReorderedWorkspaceIdsIntoProjectOrder(
      previousProjectWorkspaceIds,
      orderedWorkspaceIds,
    )

    if (orderedWorkspaceIds.length <= 1 || !nextOrderedWorkspaceIds) {
      return
    }

    const workspaceOrderById = new Map(nextOrderedWorkspaceIds.map((workspaceId, index) => [workspaceId, index] as const))
    updateWorkspaceDirectoryCache((current) => current
      ? {
          ...current,
          workspacesByProject: {
            ...current.workspacesByProject,
            [projectId]: sortWorkspacesByDisplayOrder((current.workspacesByProject[projectId] ?? []).map((workspace) => {
              const displayOrder = workspaceOrderById.get(workspace.id)
              return typeof displayOrder === 'number'
                ? { ...workspace, displayOrder }
                : workspace
            })),
          },
        }
      : current)

    try {
      const response = await api.reorderProjectWorkspaces(projectId, { orderedWorkspaceIds: nextOrderedWorkspaceIds })
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            workspacesByProject: {
              ...current.workspacesByProject,
              [projectId]: response.workspaces,
            },
          }
        : current)
    } catch (error) {
      updateWorkspaceDirectoryCache((current) => current
        ? {
            ...current,
            workspacesByProject: {
              ...current.workspacesByProject,
              [projectId]: previousProjectWorkspaces,
            },
          }
        : current)
      toast.error(error instanceof Error ? error.message : t('workspace.page.errors.loadFailed'))
      throw error
    }
  }

  return {
    handleReorderProjectWorkspaces,
    handleReorderProjects,
    handleReorderWorkspaceSessions,
    reorderingWorkspaceSessions,
  }
}
