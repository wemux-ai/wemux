import type { Workspace } from '@shared/types'

export const isManualWorkspace = (workspace: Pick<Workspace, 'source'>) => workspace.source === 'manual'

export const isArchivedWorkspace = (workspace: Pick<Workspace, 'status'>) => workspace.status === 'archived'

export const shouldShowWorkspaceInUserLists = (
  workspace: Pick<Workspace, 'source'>,
  hasExistingActivity = false,
) => isManualWorkspace(workspace) || hasExistingActivity
