import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import type { AppState, WorkspaceSession } from '@shared/types'
import { toast } from 'sonner'
import { api } from '../../lib/api'
import { isLikelyWorkspaceFileLinkHref, resolveWorkspaceFileLinkPath } from '../../lib/workspace-file-link'
import { workspaceQueryKeys } from '../../lib/workspace-query-keys'
import type { WorkspacesPageDirectoryData } from './workspaces-page-queries'
import type { WorkspaceListItem } from './workspaces-page-utils'
import { GIT_WORKING_TREE_REFRESH_MS } from './workspaces-page-helpers'

type ConfirmOptions = {
  title: string
  description: string
  confirmText: string
  cancelText: string
  tone: 'danger'
}

type UseWorkspacesPageSecondaryActionsOptions = {
  candidateRootPaths: string[]
  confirm: (options: ConfirmOptions) => Promise<boolean>
  gitPanelEnabled: boolean
  selectedItem: WorkspaceListItem | null
  selectedWorkspaceBaseDirectoryPath?: string
  selectedWorkspaceCwd?: string
  selectedWorkspaceExecutorId: string
  selectedWorkspaceSession: WorkspaceSession | null
  selectedWorkspaceTask: AppState['tasks'][number] | null
  runMutation: <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => Promise<T | undefined>
  setActivePrimaryView: (view: 'files') => void
  t: (key: string, options?: Record<string, unknown>) => string
  updateWorkspaceDirectoryCache: (
    updater: (current: WorkspacesPageDirectoryData | undefined) => WorkspacesPageDirectoryData | undefined,
  ) => void
}

export function useWorkspacesPageSecondaryActions({
  candidateRootPaths,
  confirm,
  gitPanelEnabled,
  selectedItem,
  selectedWorkspaceBaseDirectoryPath,
  selectedWorkspaceCwd,
  selectedWorkspaceExecutorId,
  selectedWorkspaceSession,
  selectedWorkspaceTask,
  runMutation,
  setActivePrimaryView,
  t,
  updateWorkspaceDirectoryCache,
}: UseWorkspacesPageSecondaryActionsOptions) {
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] = useState<{
    filePath: string
    requestId: number
  } | null>(null)
  const workspaceFileRequestIdRef = useRef(0)

  const selectedWorkspaceGitScopeKey = useMemo(() => {
    if (!selectedWorkspaceTask || !selectedItem) {
      return ''
    }

    const workspaceCodeBranch = selectedItem.workspace.codeBranchName || selectedWorkspaceSession?.branchName || ''
    const workspaceBaseBranch = selectedItem.workspace.codeBaseBranch
      || selectedWorkspaceSession?.baseBranch
      || selectedWorkspaceTask.baseBranch
      || selectedWorkspaceTask.baseBranchHint
      || selectedItem.workspace.suggestedBaseBranch
      || selectedItem.workspace.defaultBranch
      || selectedItem.project.defaultBranch
      || 'main'

    return [
      selectedWorkspaceTask.id,
      selectedItem.workspace.id,
      selectedWorkspaceSession?.id || '',
      workspaceCodeBranch,
      selectedWorkspaceSession?.worktreeStatus || '',
      workspaceBaseBranch,
    ].join(':')
  }, [selectedItem, selectedWorkspaceSession, selectedWorkspaceTask])
  const gitWorkingTreeQuery = useQuery({
    queryKey: selectedWorkspaceTask && selectedItem
      ? workspaceQueryKeys.gitWorkingTreeDiff(
          selectedWorkspaceTask.id,
          selectedItem.workspace.id,
          selectedWorkspaceSession?.id,
          selectedWorkspaceGitScopeKey,
        )
      : workspaceQueryKeys.gitWorkingTreeDiff('', '', undefined, ''),
    queryFn: () => api.getTaskGitWorkingTreeDiff(
      selectedWorkspaceTask!.id,
      selectedItem!.workspace.id,
      selectedWorkspaceSession?.id,
    ),
    enabled: Boolean(gitPanelEnabled && selectedItem && selectedWorkspaceTask),
    refetchInterval: typeof document !== 'undefined' && document.hidden ? false : GIT_WORKING_TREE_REFRESH_MS,
    staleTime: GIT_WORKING_TREE_REFRESH_MS,
  })
  const gitWorkingTreeSummary = gitWorkingTreeQuery.data?.ok
    ? gitWorkingTreeQuery.data.files.reduce((accumulator, file) => ({
        additions: accumulator.additions + file.additions,
        deletions: accumulator.deletions + file.deletions,
      }), { additions: 0, deletions: 0 })
    : null

  const handleDeleteWorkspace = async (item: WorkspaceListItem) => {
    const confirmed = await confirm({
      title: t('workspace.page.deleteDialog.title', { name: item.workspace.name }),
      description: t('workspace.page.deleteDialog.description'),
      confirmText: t('workspace.page.deleteDialog.confirm'),
      cancelText: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) {
      return
    }

    const response = await runMutation(() => api.deleteWorkspace(item.workspace.id))
    if (!response) return

    updateWorkspaceDirectoryCache((current) => current
      ? {
          ...current,
          workspacesByProject: {
            ...current.workspacesByProject,
            [item.project.id]: (current.workspacesByProject[item.project.id] ?? []).filter((workspace) => workspace.id !== item.workspace.id),
          },
        }
      : current)
  }

  const handleOpenWorkspaceFileLink = (href: string) => {
    if (!isLikelyWorkspaceFileLinkHref(href)) {
      return false
    }

    const resolvedFilePath = resolveWorkspaceFileLinkPath({
      href,
      baseDirectoryPath: selectedWorkspaceBaseDirectoryPath || selectedWorkspaceCwd,
      candidateRootPaths,
    })

    if (!resolvedFilePath) {
      toast.error(t('workspace.files.errors.outOfScope', { defaultValue: '该文件不在当前工作区目录内。' }))
      return true
    }

    if (!selectedWorkspaceExecutorId) {
      toast.error(t('workspace.files.noDirectory', { defaultValue: '当前没有可浏览目录。' }))
      return true
    }

    workspaceFileRequestIdRef.current += 1
    setWorkspaceFileOpenRequest({
      filePath: resolvedFilePath,
      requestId: workspaceFileRequestIdRef.current,
    })
    setActivePrimaryView('files')
    return true
  }

  return {
    gitWorkingTreeSummary,
    handleDeleteWorkspace,
    handleOpenWorkspaceFileLink,
    workspaceFileOpenRequest,
  }
}
