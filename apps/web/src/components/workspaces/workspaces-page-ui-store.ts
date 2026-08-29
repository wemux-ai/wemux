import { useSyncExternalStore } from 'react'
import { Store } from '@tanstack/react-store'
import type { WorkspacePrimaryView } from '../../routes/-workspace-route-shared'

export type WorkspaceSessionListPlacement = 'side' | 'top'

type WorkspacesPageUiState = {
  openWorkspaceTabs: WorkspacePageTab[]
  primaryViewByWorkspaceId: Record<string, WorkspacePrimaryView>
  visitedPrimaryViewsByWorkspaceId: Record<string, WorkspacePrimaryView[]>
  workspaceSessionListPlacementByWorkspaceId: Record<string, WorkspaceSessionListPlacement>
  terminalCollapsedByWorkspaceId: Record<string, boolean>
  terminalOpenWorkspaceIds: Record<string, boolean>
}

export type WorkspacePageTab = {
  workspaceId: string
  projectId?: string
  workspaceSessionId?: string
  openedAt: number
  lastActiveAt: number
}

type OpenWorkspaceTabOptions = {
  workspaceId: string
  projectId?: string
  workspaceSessionId?: string
}

const MAX_OPEN_WORKSPACE_TABS = 8

const workspacesPageUiStore = new Store<WorkspacesPageUiState>({
  openWorkspaceTabs: [],
  primaryViewByWorkspaceId: {},
  visitedPrimaryViewsByWorkspaceId: {},
  workspaceSessionListPlacementByWorkspaceId: {},
  terminalCollapsedByWorkspaceId: {},
  terminalOpenWorkspaceIds: {},
})

const omitRecordKey = <TValue,>(record: Record<string, TValue>, key: string) => {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return record
  }

  const nextRecord = { ...record }
  delete nextRecord[key]
  return nextRecord
}

const hasOwnKey = <TRecord extends object>(record: TRecord, key: PropertyKey) => (
  Object.prototype.hasOwnProperty.call(record, key)
)

export const useWorkspacesPageUiStore = <TSelected,>(
  selector: (state: WorkspacesPageUiState) => TSelected,
) => {
  const getSnapshot = () => selector(workspacesPageUiStore.state)
  return useSyncExternalStore(
    (listener) => {
      const subscription = workspacesPageUiStore.subscribe(() => {
        listener()
      }) as unknown as (() => void) | { unsubscribe: () => void }
      return typeof subscription === 'function'
        ? subscription
        : () => subscription.unsubscribe()
    },
    getSnapshot,
    getSnapshot,
  )
}

export const setWorkspacePrimaryView = (workspaceId: string | undefined, view: WorkspacePrimaryView) => {
  if (!workspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => (
    current.primaryViewByWorkspaceId[workspaceId] === view
    && current.visitedPrimaryViewsByWorkspaceId[workspaceId]?.includes(view)
      ? current
      : {
          ...current,
          primaryViewByWorkspaceId: {
            ...current.primaryViewByWorkspaceId,
            [workspaceId]: view,
          },
          visitedPrimaryViewsByWorkspaceId: current.visitedPrimaryViewsByWorkspaceId[workspaceId]?.includes(view)
            ? current.visitedPrimaryViewsByWorkspaceId
            : {
                ...current.visitedPrimaryViewsByWorkspaceId,
                [workspaceId]: [...(current.visitedPrimaryViewsByWorkspaceId[workspaceId] ?? []), view],
              },
        }
  ))
}

export const setWorkspaceSessionListPlacement = (
  workspaceId: string | undefined,
  placement: WorkspaceSessionListPlacement,
) => {
  if (!workspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => (
    current.workspaceSessionListPlacementByWorkspaceId[workspaceId] === placement
      ? current
      : {
          ...current,
          workspaceSessionListPlacementByWorkspaceId: {
            ...current.workspaceSessionListPlacementByWorkspaceId,
            [workspaceId]: placement,
          },
        }
  ))
}

export const resolveWorkspaceSessionListPlacement = (
  workspaceId: string | undefined,
  placementByWorkspaceId: Record<string, WorkspaceSessionListPlacement>,
  fallback: WorkspaceSessionListPlacement,
) => {
  if (!workspaceId) {
    return fallback
  }

  return placementByWorkspaceId[workspaceId] ?? fallback
}

export const openWorkspaceTab = (options: OpenWorkspaceTabOptions) => {
  const workspaceId = options.workspaceId.trim()
  if (!workspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => {
    const now = Date.now()
    const existingTab = current.openWorkspaceTabs.find((tab) => tab.workspaceId === workspaceId)
    const nextProjectId = hasOwnKey(options, 'projectId') ? options.projectId : existingTab?.projectId
    const nextWorkspaceSessionId = hasOwnKey(options, 'workspaceSessionId') ? options.workspaceSessionId : existingTab?.workspaceSessionId
    if (
      existingTab
      && existingTab.projectId === nextProjectId
      && existingTab.workspaceSessionId === nextWorkspaceSessionId
    ) {
      return current
    }

    const nextTab: WorkspacePageTab = existingTab
      ? {
          ...existingTab,
          projectId: nextProjectId,
          workspaceSessionId: nextWorkspaceSessionId,
          lastActiveAt: now,
        }
      : {
          workspaceId,
          projectId: nextProjectId,
          workspaceSessionId: nextWorkspaceSessionId,
          openedAt: now,
          lastActiveAt: now,
        }

    const withoutCurrent = current.openWorkspaceTabs.filter((tab) => tab.workspaceId !== workspaceId)
    const nextTabs = [...withoutCurrent, nextTab]
      .sort((left, right) => left.openedAt - right.openedAt)

    return {
      ...current,
      openWorkspaceTabs: nextTabs.length > MAX_OPEN_WORKSPACE_TABS
        ? nextTabs.slice(nextTabs.length - MAX_OPEN_WORKSPACE_TABS)
        : nextTabs,
    }
  })
}

export const rememberWorkspaceTabRoute = (
  workspaceId: string | undefined,
  patch: Pick<OpenWorkspaceTabOptions, 'projectId' | 'workspaceSessionId'>,
) => {
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  if (!normalizedWorkspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => {
    const existingTab = current.openWorkspaceTabs.find((tab) => tab.workspaceId === normalizedWorkspaceId)
    if (!existingTab) {
      return current
    }

    const nextProjectId = hasOwnKey(patch, 'projectId') ? patch.projectId : existingTab.projectId
    const nextWorkspaceSessionId = hasOwnKey(patch, 'workspaceSessionId') ? patch.workspaceSessionId : existingTab.workspaceSessionId
    if (
      existingTab.projectId === nextProjectId
      && existingTab.workspaceSessionId === nextWorkspaceSessionId
    ) {
      return current
    }

    const nextTab = {
      ...existingTab,
      projectId: nextProjectId,
      workspaceSessionId: nextWorkspaceSessionId,
      lastActiveAt: Date.now(),
    }

    return {
      ...current,
      openWorkspaceTabs: current.openWorkspaceTabs.map((tab) => (
        tab.workspaceId === normalizedWorkspaceId ? nextTab : tab
      )),
    }
  })
}

export const resetWorkspacesPageUiStoreForTests = () => {
  workspacesPageUiStore.setState(() => ({
    openWorkspaceTabs: [],
    primaryViewByWorkspaceId: {},
    visitedPrimaryViewsByWorkspaceId: {},
    workspaceSessionListPlacementByWorkspaceId: {},
    terminalCollapsedByWorkspaceId: {},
    terminalOpenWorkspaceIds: {},
  }))
}

export const getWorkspacesPageUiStateForTests = () => workspacesPageUiStore.state

export const closeWorkspaceTab = (workspaceId: string | undefined) => {
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  if (!normalizedWorkspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => {
    const nextOpenWorkspaceTabs = current.openWorkspaceTabs.filter((tab) => tab.workspaceId !== normalizedWorkspaceId)
    if (nextOpenWorkspaceTabs.length === current.openWorkspaceTabs.length) {
      return current
    }

    return {
      ...current,
      openWorkspaceTabs: nextOpenWorkspaceTabs,
      primaryViewByWorkspaceId: omitRecordKey(current.primaryViewByWorkspaceId, normalizedWorkspaceId),
      visitedPrimaryViewsByWorkspaceId: omitRecordKey(current.visitedPrimaryViewsByWorkspaceId, normalizedWorkspaceId),
      workspaceSessionListPlacementByWorkspaceId: omitRecordKey(current.workspaceSessionListPlacementByWorkspaceId, normalizedWorkspaceId),
      terminalCollapsedByWorkspaceId: omitRecordKey(current.terminalCollapsedByWorkspaceId, normalizedWorkspaceId),
      terminalOpenWorkspaceIds: omitRecordKey(current.terminalOpenWorkspaceIds, normalizedWorkspaceId),
    }
  })
}

export const setWorkspaceTerminalCollapsed = (workspaceId: string | undefined, collapsed: boolean) => {
  if (!workspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => (
    current.terminalCollapsedByWorkspaceId[workspaceId] === collapsed
      ? current
      : {
          ...current,
          terminalCollapsedByWorkspaceId: {
            ...current.terminalCollapsedByWorkspaceId,
            [workspaceId]: collapsed,
          },
        }
  ))
}

export const setWorkspaceTerminalOpen = (workspaceId: string | undefined, open: boolean) => {
  if (!workspaceId) {
    return
  }

  workspacesPageUiStore.setState((current) => (
    current.terminalOpenWorkspaceIds[workspaceId] === open
      ? current
      : {
          ...current,
          terminalOpenWorkspaceIds: {
            ...current.terminalOpenWorkspaceIds,
            [workspaceId]: open,
          },
        }
  ))
}

export const clearWorkspaceTerminalRunning = (
  workspaceSessions: Array<{ id: string; workspaceId: string }>,
  workspaceId: string,
  setRunningBySessionId: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void,
) => {
  setRunningBySessionId((current) => {
    let changed = false
    const next = { ...current }

    for (const workspaceSession of workspaceSessions) {
      if (workspaceSession.workspaceId !== workspaceId || !next[workspaceSession.id]) {
        continue
      }

      next[workspaceSession.id] = false
      changed = true
    }

    return changed ? next : current
  })
}
