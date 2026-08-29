import { api } from './api'

type WorkspaceBranchesPayload = Awaited<ReturnType<typeof api.listWorkspaceBranches>>

const WORKSPACE_BRANCHES_CACHE_TTL_MS = 60_000

const workspaceBranchesCache = new Map<string, {
  expiresAt: number
  payload: WorkspaceBranchesPayload
}>()
const pendingWorkspaceBranchesRequests = new Map<string, Promise<WorkspaceBranchesPayload>>()
const workspaceBranchesCacheVersions = new Map<string, number>()

type WorkspaceBranchCacheScope = {
  taskId?: string
  workspaceSessionId?: string
}

const buildWorkspaceBranchCacheKey = (workspaceId: string, scope?: WorkspaceBranchCacheScope) => {
  const normalizedWorkspaceId = workspaceId.trim()
  const normalizedTaskId = scope?.taskId?.trim() || ''
  const normalizedWorkspaceSessionId = scope?.workspaceSessionId?.trim() || ''
  return [
    `workspace=${normalizedWorkspaceId}`,
    normalizedTaskId ? `task=${normalizedTaskId}` : '',
    normalizedWorkspaceSessionId ? `workspaceSession=${normalizedWorkspaceSessionId}` : '',
  ].filter(Boolean).join('|')
}

export const loadCachedWorkspaceBranches = async (workspaceId: string, scope?: WorkspaceBranchCacheScope) => {
  const normalizedWorkspaceId = workspaceId.trim()
  if (!normalizedWorkspaceId) {
    throw new Error('缺少工作区 ID，无法加载分支列表。')
  }
  const cacheKey = buildWorkspaceBranchCacheKey(normalizedWorkspaceId, scope)

  const now = Date.now()
  const cached = workspaceBranchesCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.payload
  }

  const pending = pendingWorkspaceBranchesRequests.get(cacheKey)
  if (pending) {
    return pending
  }

  const requestVersion = workspaceBranchesCacheVersions.get(cacheKey) ?? 0
  const request = api.listWorkspaceBranches(normalizedWorkspaceId, scope)
    .then((payload) => {
      if ((workspaceBranchesCacheVersions.get(cacheKey) ?? 0) === requestVersion) {
        workspaceBranchesCache.set(cacheKey, {
          expiresAt: Date.now() + WORKSPACE_BRANCHES_CACHE_TTL_MS,
          payload,
        })
      }
      return payload
    })
    .finally(() => {
      if (pendingWorkspaceBranchesRequests.get(cacheKey) === request) {
        pendingWorkspaceBranchesRequests.delete(cacheKey)
      }
    })

  pendingWorkspaceBranchesRequests.set(cacheKey, request)
  return request
}

export const clearCachedWorkspaceBranches = (workspaceId: string, scope?: WorkspaceBranchCacheScope) => {
  const normalizedWorkspaceId = workspaceId.trim()
  const cacheKey = buildWorkspaceBranchCacheKey(normalizedWorkspaceId, scope)
  workspaceBranchesCacheVersions.set(cacheKey, (workspaceBranchesCacheVersions.get(cacheKey) ?? 0) + 1)
  workspaceBranchesCache.delete(cacheKey)
  pendingWorkspaceBranchesRequests.delete(cacheKey)
}
