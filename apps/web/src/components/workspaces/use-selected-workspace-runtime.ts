import { useMemo } from 'react'
import type { AppState, ExecutorRecord, WorkspaceSession } from '@shared/types'
import { buildWorkspaceRepoPath } from '@shared/workspace-paths'
import {
  normalizeManagedCloudExecutorForDisplay,
} from '../../lib/managed-cloud-executor'
import type { ManagedCloudRuntimeStatus } from '../../lib/api'
import { resolveWorkspaceSessionRuntime } from '../../lib/workspace-session-runtime'
import type { WorkspaceListItem } from './workspaces-page-utils'

type UseSelectedWorkspaceRuntimeOptions = {
  defaultWorkspaceRoot: AppState['config']['workspaceRoot']
  executors: ExecutorRecord[]
  managedCloudRuntime: ManagedCloudRuntimeStatus | null
  projectBindings: AppState['projectBindings']
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceSession: WorkspaceSession | null
}

export function useSelectedWorkspaceRuntime({
  defaultWorkspaceRoot,
  executors,
  managedCloudRuntime,
  projectBindings,
  selectedItem,
  selectedWorkspaceSession,
}: UseSelectedWorkspaceRuntimeOptions) {
  const selectedWorkspaceExecutorIdFromWorkspace = selectedItem?.workspace.executorNodeId?.trim() || ''
  const selectedWorkspaceRuntime = useMemo(() => {
    if (!selectedItem) {
      return null
    }

    const bindingPathHint = projectBindings.find((binding) => (
      binding.isActive
      && binding.projectId === selectedItem.project.id
      && binding.nodeId === selectedWorkspaceExecutorIdFromWorkspace
    ))?.pathHint

    return resolveWorkspaceSessionRuntime({
      bindingPathHint,
      defaultWorkspaceRoot,
      executors: executors.map((executor) => normalizeManagedCloudExecutorForDisplay(executor, managedCloudRuntime)),
      project: selectedItem.project,
      workspace: selectedItem.workspace,
      workspaceSession: selectedWorkspaceSession,
    })
  }, [
    defaultWorkspaceRoot,
    executors,
    managedCloudRuntime,
    projectBindings,
    selectedItem,
    selectedWorkspaceExecutorIdFromWorkspace,
    selectedWorkspaceSession,
  ])
  const selectedWorkspaceExecutor = selectedWorkspaceRuntime?.executor ?? null
  const selectedWorkspaceExecutorId = selectedWorkspaceRuntime?.executorId || selectedWorkspaceExecutorIdFromWorkspace
  const selectedWorkspaceExecutorName = selectedWorkspaceRuntime?.executorName
    || selectedWorkspaceExecutor?.name
    || selectedItem?.workspace.executorName
    || selectedWorkspaceExecutorIdFromWorkspace
  const selectedWorkspaceFileExplorerRootPath = selectedWorkspaceRuntime?.fileExplorerRootPath
  const selectedWorkspaceCwd = selectedWorkspaceRuntime?.terminalCwd
  const selectedWorkspaceTerminalTargetCwd = selectedWorkspaceRuntime?.terminalTargetCwd
  const selectedWorkspaceCandidateCwds = selectedWorkspaceRuntime?.candidateCwds ?? []
  const selectedWorkspaceFileScopeRootPaths = useMemo(
    () => (selectedWorkspaceFileExplorerRootPath ? [selectedWorkspaceFileExplorerRootPath] : []),
    [selectedWorkspaceFileExplorerRootPath],
  )
  const selectedWorkspaceBinding = useMemo(() => {
    if (!selectedItem || !selectedWorkspaceExecutorId) {
      return null
    }

    return projectBindings.find((binding) => (
      binding.isActive
      && binding.projectId === selectedItem.project.id
      && binding.nodeId === selectedWorkspaceExecutorId
    )) ?? null
  }, [projectBindings, selectedItem, selectedWorkspaceExecutorId])
  const selectedWorkspaceDefaultRepoPath = useMemo(() => {
    if (!selectedItem || selectedItem.project.versionControl !== 'git-remote') {
      return undefined
    }

    return buildWorkspaceRepoPath(selectedWorkspaceRuntime?.workspaceRoot, selectedItem.project, selectedItem.workspace.id, selectedItem.workspace.ownerUserId)
  }, [selectedItem, selectedWorkspaceRuntime?.workspaceRoot])

  return {
    selectedWorkspaceBinding,
    selectedWorkspaceCandidateCwds,
    selectedWorkspaceCwd,
    selectedWorkspaceDefaultRepoPath,
    selectedWorkspaceExecutor,
    selectedWorkspaceExecutorId,
    selectedWorkspaceExecutorName,
    selectedWorkspaceFileExplorerRootPath,
    selectedWorkspaceFileScopeRootPaths,
    selectedWorkspaceRuntime,
    selectedWorkspaceTerminalTargetCwd,
  }
}
