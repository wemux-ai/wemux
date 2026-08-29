/**
 * [INPUT]: Workspace session mutation responses and the web API client.
 * [OUTPUT]: Shared rename execution and deterministic post-mutation session selection.
 * [POS]: UI-free workspace-session mutation logic shared by /workspace and /workspaces; owns no route or cache state.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

import type { WorkspaceSession } from '@shared/types'
import { api } from './api'
import { listWorkspaceSessionsForWorkspace } from './workspace-session-scope'

export type WorkspaceSessionRenameRequest = {
  kind: 'update-workspace-session'
  workspaceId: string
  workspaceSessionId: string
  title: string
}

export function resolveWorkspaceSessionRenameRequest(params: {
  workspaceSessionId: string
  workspaceId: string
  title: string
}): WorkspaceSessionRenameRequest {
  const nextTitle = params.title.trim()
  return {
    kind: 'update-workspace-session',
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    title: nextTitle,
  }
}

export const renameWorkspaceSession = (params: Parameters<typeof resolveWorkspaceSessionRenameRequest>[0]) => {
  const request = resolveWorkspaceSessionRenameRequest(params)
  return api.createWorkspaceSession(request.workspaceId, {
    workspaceSessionId: request.workspaceSessionId,
    createNewSession: false,
    title: request.title,
    titleOrigin: 'manual',
  })
}

export const resolveCreatedWorkspaceSession = (params: {
  workspaceId: string
  previousSessionIds: ReadonlySet<string>
  response: {
    state: { workspaceSessions: WorkspaceSession[] }
    workspaceSessionId?: string
    workspaceSession?: WorkspaceSession
  }
}) => {
  const workspaceSessions = listWorkspaceSessionsForWorkspace({
    workspaceId: params.workspaceId,
    workspaceSessions: params.response.state.workspaceSessions,
  })
  return params.response.workspaceSession
    ?? workspaceSessions.find((session) => session.id === params.response.workspaceSessionId)
    ?? workspaceSessions.find((session) => !params.previousSessionIds.has(session.id))
    ?? workspaceSessions[0]
}
