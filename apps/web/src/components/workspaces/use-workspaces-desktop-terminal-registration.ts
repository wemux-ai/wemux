import { useMemo } from 'react'
import type { WorkspaceOpenTarget } from '@shared/workspace-open-command'
import type { WorkspaceTerminalCommandRequest } from './workspace-terminal-panel'
import { useDesktopPersistentWorkspaceTerminal } from './persistent-workspace-terminal'
import type { WorkspaceListItem } from './workspaces-page-utils'

type UseWorkspacesDesktopTerminalRegistrationOptions = {
  activeWorkspaceOpenTarget: WorkspaceOpenTarget
  clearWorkspaceEnvironmentRunningForWorkspace: (workspaceId: string) => void
  currentWorkspaceTerminalCollapsed: boolean
  environmentLogsCommand?: string
  environmentStartCommand?: string
  installWorkspaceCommand: string
  isMobile: boolean
  markEnvironmentTerminalClosed: () => void
  openCurrentWorkspaceInTarget: (target: WorkspaceOpenTarget) => Promise<void>
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceCwd?: string
  selectedWorkspaceExecutorId: string
  selectedWorkspaceExecutorName: string
  setTerminalCollapsed: (collapsed: boolean) => void
  setTerminalMaximized: (maximized: boolean) => void
  setWorkspaceTerminalOpenUi: (workspaceId: string, open: boolean) => void
  terminalCommandRequest: WorkspaceTerminalCommandRequest | null
  terminalMaximized: boolean
}

export function useWorkspacesDesktopTerminalRegistration({
  activeWorkspaceOpenTarget,
  clearWorkspaceEnvironmentRunningForWorkspace,
  currentWorkspaceTerminalCollapsed,
  environmentLogsCommand,
  environmentStartCommand,
  installWorkspaceCommand,
  isMobile,
  markEnvironmentTerminalClosed,
  openCurrentWorkspaceInTarget,
  selectedItem,
  selectedWorkspaceCwd,
  selectedWorkspaceExecutorId,
  selectedWorkspaceExecutorName,
  setTerminalCollapsed,
  setTerminalMaximized,
  setWorkspaceTerminalOpenUi,
  terminalCommandRequest,
  terminalMaximized,
}: UseWorkspacesDesktopTerminalRegistrationOptions) {
  const desktopPersistentTerminal = useMemo(() => {
    if (isMobile || !selectedItem) {
      return null
    }

    return {
      collapsed: currentWorkspaceTerminalCollapsed,
      cwd: selectedWorkspaceCwd,
      executorId: selectedWorkspaceExecutorId,
      executorName: selectedWorkspaceExecutorName,
      projectId: selectedItem.project.id,
      workspaceId: selectedItem.workspace.id,
      installCommand: installWorkspaceCommand,
      startCommand: environmentStartCommand,
      logsCommand: environmentLogsCommand,
      maximized: terminalMaximized,
      panelKey: selectedItem.workspace.id,
      commandRequest: terminalCommandRequest,
      onCollapsedChange: setTerminalCollapsed,
      onMaximizedChange: setTerminalMaximized,
      onOpenStateChange: (open: boolean) => {
        setWorkspaceTerminalOpenUi(selectedItem.workspace.id, open)
        if (!open) {
          markEnvironmentTerminalClosed()
          clearWorkspaceEnvironmentRunningForWorkspace(selectedItem.workspace.id)
        }
      },
      onOpenWorkspaceTarget: async () => {
        await openCurrentWorkspaceInTarget(activeWorkspaceOpenTarget)
      },
    }
  }, [
    activeWorkspaceOpenTarget,
    currentWorkspaceTerminalCollapsed,
    clearWorkspaceEnvironmentRunningForWorkspace,
    environmentLogsCommand,
    environmentStartCommand,
    installWorkspaceCommand,
    isMobile,
    markEnvironmentTerminalClosed,
    openCurrentWorkspaceInTarget,
    selectedItem,
    selectedWorkspaceCwd,
    selectedWorkspaceExecutorId,
    selectedWorkspaceExecutorName,
    setTerminalCollapsed,
    setTerminalMaximized,
    setWorkspaceTerminalOpenUi,
    terminalCommandRequest,
    terminalMaximized,
  ])

  useDesktopPersistentWorkspaceTerminal(desktopPersistentTerminal)
}
