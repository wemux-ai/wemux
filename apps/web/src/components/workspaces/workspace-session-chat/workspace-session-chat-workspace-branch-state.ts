import type { Project, Workspace } from '@shared/types'

export const resolveDisplayedWorkspaceBranchName = (params: {
  versionControl?: Project['versionControl']
  workingDirectoryMode?: Workspace['workingDirectoryMode']
  currentRepoBranch?: string
  workspaceSessionBranchName?: string
}) => {
  if (params.versionControl === 'none') {
    return ''
  }

  return params.currentRepoBranch?.trim() || params.workspaceSessionBranchName?.trim() || ''
}
