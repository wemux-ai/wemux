// [INPUT]: Workspace directory data, route selection, sessions, bindings, and tasks.
// [OUTPUT]: Stable workspace, workspace-level task binding, and taskless session selection.
// [POS]: Web selection boundary; tasks may bind to a workspace but never to an inner session/component.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useMemo, useRef } from 'react'
import type { AppState, ExecutorRecord, Project, WorkspaceSession } from '@shared/types'
import { listWorkspaceSessionsForWorkspace } from '../../lib/workspace-session-scope'
import {
  buildWorkspaceItems,
  filterWorkspaceItems,
  reconcileWorkspaceItems,
  resolveWorkspaceListSelection,
} from './workspaces-page-utils'
import type { WorkspacesPageDirectoryData } from './workspaces-page-queries'

type WorkspaceTabEntry = {
  workspaceId: string
  workspaceSessionId?: string
}

type UseWorkspacesSelectionModelOptions = {
  executors: ExecutorRecord[]
  language: string
  openWorkspaceTabs: WorkspaceTabEntry[]
  optimisticWorkspaceSession: WorkspaceSession | null
  routeWorkspaceId: string
  searchQuery: string
  searchWorkspaceSessionId?: string
  selectedWorkspaceId: string
  selectedWorkspaceSessionId: string
  state: AppState
  workspaceDirectoryLoading: boolean
  presenceByWorkspaceId: WorkspacesPageDirectoryData['presenceByWorkspaceId']
  previewByWorkspaceId: WorkspacesPageDirectoryData['previewByWorkspaceId']
  directoryScopedProjects: Project[]
  workspacesByProject: WorkspacesPageDirectoryData['workspacesByProject']
  workspaceSessionUnreadState: {
    acknowledgedSessionAttentionById: Record<string, string>
    manuallyUnreadSessionAttentionById: Record<string, string>
    sessionAttentionById: Record<string, string>
  }
}

export const resolveSelectedWorkspaceTask = (
  selectedItem: ReturnType<typeof buildWorkspaceItems>[number] | null,
) => selectedItem?.activeTask ?? null

export function useWorkspacesSelectionModel({
  executors,
  language,
  openWorkspaceTabs,
  optimisticWorkspaceSession,
  routeWorkspaceId,
  searchQuery,
  searchWorkspaceSessionId,
  selectedWorkspaceId,
  selectedWorkspaceSessionId,
  state,
  workspaceDirectoryLoading,
  directoryScopedProjects,
  workspacesByProject,
  presenceByWorkspaceId,
  previewByWorkspaceId,
  workspaceSessionUnreadState,
}: UseWorkspacesSelectionModelOptions) {
  const previousWorkspaceItemsRef = useRef<ReturnType<typeof buildWorkspaceItems>>([])
  const workspaceItems = useMemo(() => {
    const nextItems = buildWorkspaceItems(
      directoryScopedProjects,
      workspacesByProject,
      state.tasks,
      state.taskWorkspaceBindings,
      state.workspaceSessions,
      language,
      {
        sessionAttentionById: workspaceSessionUnreadState.sessionAttentionById,
        acknowledgedSessionAttentionById: workspaceSessionUnreadState.acknowledgedSessionAttentionById,
        manuallyUnreadSessionAttentionById: workspaceSessionUnreadState.manuallyUnreadSessionAttentionById,
        executors,
        selectedWorkspaceSessionId,
      },
      presenceByWorkspaceId,
      previewByWorkspaceId,
    )
    const reconciled = reconcileWorkspaceItems(previousWorkspaceItemsRef.current, nextItems)
    previousWorkspaceItemsRef.current = reconciled
    return reconciled
  }, [
      language,
      selectedWorkspaceSessionId,
      directoryScopedProjects,
      state.taskWorkspaceBindings,
      state.workspaceSessions,
      state.tasks,
      executors,
      presenceByWorkspaceId,
      previewByWorkspaceId,
      workspacesByProject,
      workspaceSessionUnreadState.acknowledgedSessionAttentionById,
      workspaceSessionUnreadState.manuallyUnreadSessionAttentionById,
      workspaceSessionUnreadState.sessionAttentionById,
    ])

  const activeFilteredItems = useMemo(
    () => filterWorkspaceItems(workspaceItems, searchQuery),
    [searchQuery, workspaceItems],
  )
  const archivedFilteredItems = useMemo(
    () => filterWorkspaceItems(workspaceItems, searchQuery, { includeArchived: true })
      .filter((item) => item.workspace.status === 'archived'),
    [searchQuery, workspaceItems],
  )
  const visibleWorkspaceItems = useMemo(
    () => [...activeFilteredItems, ...archivedFilteredItems],
    [activeFilteredItems, archivedFilteredItems],
  )
  const workspaceSelection = useMemo(
    () => resolveWorkspaceListSelection({
      filteredWorkspaceIds: visibleWorkspaceItems.map((item) => item.workspace.id),
      loading: workspaceDirectoryLoading,
      routeWorkspaceId,
      selectedWorkspaceId,
    }),
    [routeWorkspaceId, selectedWorkspaceId, visibleWorkspaceItems, workspaceDirectoryLoading],
  )
  const routeWorkspaceItem = useMemo(
    () => visibleWorkspaceItems.find((item) => item.workspace.id === routeWorkspaceId) ?? null,
    [routeWorkspaceId, visibleWorkspaceItems],
  )
  const selectedWorkspaceRouteFallback = openWorkspaceTabs.find((tab) => tab.workspaceId === selectedWorkspaceId)
  const selectedItem = useMemo(
    () => visibleWorkspaceItems.find((item) => item.workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, visibleWorkspaceItems],
  )
  const selectedWorkspaceTask = useMemo(
    () => resolveSelectedWorkspaceTask(selectedItem),
    [selectedItem],
  )
  const bindableTasks = useMemo(
    () => selectedItem
      ? state.tasks
        .filter((task) => task.projectId === selectedItem.project.id && task.requirementType !== 'requirement')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
      : [],
    [selectedItem, state.tasks],
  )
  const persistedWorkspaceSessions = useMemo<WorkspaceSession[]>(
    () => selectedItem
      ? listWorkspaceSessionsForWorkspace({
        workspaceId: selectedItem.workspace.id,
        workspaceSessions: state.workspaceSessions,
      })
      : [],
    [selectedItem, state.workspaceSessions],
  )
  const selectedWorkspaceSessions = useMemo<WorkspaceSession[]>(() => {
    if (
      !optimisticWorkspaceSession
      || optimisticWorkspaceSession.workspaceId !== selectedItem?.workspace.id
      || persistedWorkspaceSessions.some((session) => session.id === optimisticWorkspaceSession.id)
    ) {
      return persistedWorkspaceSessions
    }

    return [optimisticWorkspaceSession, ...persistedWorkspaceSessions]
  }, [optimisticWorkspaceSession, persistedWorkspaceSessions, selectedItem?.workspace.id])
  const selectedWorkspaceSession = useMemo(
    () => selectedWorkspaceSessions.find((session) => session.id === selectedWorkspaceSessionId)
      ?? selectedWorkspaceSessions.find((session) => session.id === selectedWorkspaceRouteFallback?.workspaceSessionId)
      ?? selectedWorkspaceSessions[0]
      ?? null,
    [selectedWorkspaceRouteFallback?.workspaceSessionId, selectedWorkspaceSessionId, selectedWorkspaceSessions],
  )
  const matchedWorkspaceSession = useMemo(
    () => selectedWorkspaceSessions.find((session) => session.id === searchWorkspaceSessionId) ?? null,
    [searchWorkspaceSessionId, selectedWorkspaceSessions],
  )
  const displayTask = null
  const searchTask = null

  return {
    activeFilteredItems,
    archivedFilteredItems,
    bindableTasks,
    displayTask,
    matchedWorkspaceSession,
    routeWorkspaceItem,
    searchTask,
    selectedItem,
    selectedWorkspaceRouteFallback,
    selectedWorkspaceSession,
    selectedWorkspaceSessions,
    selectedWorkspaceTask,
    visibleWorkspaceItems,
    workspaceItems,
    workspaceSelection,
  }
}
