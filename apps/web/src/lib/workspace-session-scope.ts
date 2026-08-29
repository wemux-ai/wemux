import { sortWorkspaceSessions } from '@shared/task-workspace'
import type { WorkspaceSession } from '@shared/types'

type WorkspaceSessionsForWorkspaceParams = {
  workspaceId?: string | null
  workspaceSessions?: WorkspaceSession[]
}

const resolveWorkspaceSessionsInput = (params: WorkspaceSessionsForWorkspaceParams): WorkspaceSession[] => (
  params.workspaceSessions ?? []
)

export const listWorkspaceSessionsForWorkspace = (params: WorkspaceSessionsForWorkspaceParams): WorkspaceSession[] => {
  const {
    workspaceId,
  } = params
  const normalizedWorkspaceId = workspaceId?.trim() || ''
  if (!normalizedWorkspaceId) {
    return []
  }

  const workspaceSessions = resolveWorkspaceSessionsInput(params).filter((session) => session.workspaceId === normalizedWorkspaceId)
  return sortWorkspaceSessions(workspaceSessions)
}

export const resolveWorkspaceSessionForWorkspace = (params: WorkspaceSessionsForWorkspaceParams & {
  workspaceSessionId?: string | null
}): WorkspaceSession | null => {
  const scopedSessions = listWorkspaceSessionsForWorkspace(params)
  if (scopedSessions.length === 0) {
    return null
  }

  const normalizedWorkspaceSessionId = params.workspaceSessionId?.trim() || ''
  if (!normalizedWorkspaceSessionId) {
    return scopedSessions[0]
  }

  return scopedSessions.find((session) => session.id === normalizedWorkspaceSessionId) ?? scopedSessions[0]
}
