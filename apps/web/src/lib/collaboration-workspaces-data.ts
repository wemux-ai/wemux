import { api, type CollaborationWorkspace } from './api'

const COLLABORATION_WORKSPACES_CACHE_TTL_MS = 30_000

let cachedCollaborationWorkspaces: {
  expiresAt: number
  workspaces: CollaborationWorkspace[]
} | null = null
let pendingCollaborationWorkspacesRequest: Promise<CollaborationWorkspace[]> | null = null

export const loadCollaborationWorkspaces = async () => {
  const now = Date.now()
  if (cachedCollaborationWorkspaces && cachedCollaborationWorkspaces.expiresAt > now) {
    return cachedCollaborationWorkspaces.workspaces
  }

  if (pendingCollaborationWorkspacesRequest) {
    return pendingCollaborationWorkspacesRequest
  }

  pendingCollaborationWorkspacesRequest = api.listCollaborationWorkspaces()
    .then((response) => {
      cachedCollaborationWorkspaces = {
        expiresAt: Date.now() + COLLABORATION_WORKSPACES_CACHE_TTL_MS,
        workspaces: response.workspaces,
      }
      return response.workspaces
    })
    .finally(() => {
      pendingCollaborationWorkspacesRequest = null
    })

  return pendingCollaborationWorkspacesRequest
}
