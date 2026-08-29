import type { Team } from '../../lib/api'
import { WorkspaceAdminPanelContent } from './workspace-admin-panel-content'
import { WorkspaceAdminPanelDialogs } from './workspace-admin-panel-dialogs'
import { useWorkspaceAdminPanelState } from './use-workspace-admin-panel-state'

export function WorkspaceAdminPanel({
  initialTeams = [],
  requestedWorkspaceId,
  onWorkspaceSelectionChange,
}: {
  initialTeams?: Team[]
  requestedWorkspaceId?: string
  onWorkspaceSelectionChange?: (workspaceId?: string) => void
}) {
  const workspaceAdmin = useWorkspaceAdminPanelState({
    initialTeams,
    requestedWorkspaceId,
    onWorkspaceSelectionChange,
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <WorkspaceAdminPanelContent
        workspaceAdmin={workspaceAdmin}
      />
      <WorkspaceAdminPanelDialogs workspaceAdmin={workspaceAdmin} />
    </div>
  )
}
