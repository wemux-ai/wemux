/**
 * [INPUT]: Canonical GitHub resource identities and local resource bindings.
 * [OUTPUT]: Shared contracts for linking pull requests, issues, and workflow runs to Wemux context.
 * [POS]: Pure cross-app domain boundary; remote resource facts remain in their provider-specific records.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */

export type GitHubResourceType = 'pull_request' | 'issue' | 'workflow_run'

export type GitHubResourceBindingStatus = 'suggested' | 'confirmed' | 'rejected'

export type GitHubResourceBindingRole = 'delivery' | 'reference' | 'review' | 'execution'

export type GitHubResourceBindingSource =
  | 'agent_output'
  | 'branch_match'
  | 'manual'
  | 'github_webhook'
  | 'review_workflow'
  | 'legacy_migration'

export type GitHubResourceBindingTarget = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

export type GitHubResourceBinding = GitHubResourceBindingTarget & {
  id: string
  provider: 'github'
  resourceType: GitHubResourceType
  resourceId: string
  projectId: string
  role: GitHubResourceBindingRole
  status: GitHubResourceBindingStatus
  source: GitHubResourceBindingSource
  confidence?: number
  createdByUserId?: string
  createdAt: string
  updatedAt: string
}

export type GitHubResourceBindingUpsertInput = GitHubResourceBindingTarget & {
  provider?: 'github'
  resourceType: GitHubResourceType
  resourceId: string
  projectId: string
  role?: GitHubResourceBindingRole
  status?: GitHubResourceBindingStatus
  source: GitHubResourceBindingSource
  confidence?: number
  createdByUserId?: string
}

export type GitHubResourceBindingFilter = {
  projectId?: string
  projectIds?: string[]
  resourceType?: GitHubResourceType
  resourceId?: string
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  status?: GitHubResourceBindingStatus
}

export interface GitHubResourceBindingListResponse {
  bindings: GitHubResourceBinding[]
}

export const buildGitHubRepositoryResourceId = (params: {
  repoHost: string
  repoOwner: string
  repoName: string
  nativeId: string | number
}) => [
  'github',
  params.repoHost.trim().toLowerCase(),
  params.repoOwner.trim().toLowerCase(),
  params.repoName.trim().toLowerCase(),
  String(params.nativeId).trim(),
].join(':')

export const buildGitHubResourceBindingContextKey = (
  target: GitHubResourceBindingTarget,
) => {
  const taskId = target.taskId?.trim() || ''
  const workspaceId = target.workspaceId?.trim() || ''
  const workspaceSessionId = target.workspaceSessionId?.trim() || ''

  if (!taskId && !workspaceId && !workspaceSessionId) {
    throw new Error('GitHub resource binding requires a task, workspace, or workspace session target.')
  }

  return [
    `task:${taskId}`,
    `workspace:${workspaceId}`,
    `session:${workspaceSessionId}`,
  ].join('|')
}

export const resolveGitHubResourceBindingStatus = (
  current: GitHubResourceBindingStatus | undefined,
  incoming: GitHubResourceBindingStatus,
) => {
  if (!current || incoming === 'confirmed' || incoming === 'rejected') {
    return incoming
  }

  return current
}

export const isActiveGitHubResourceBinding = (
  binding: Pick<GitHubResourceBinding, 'status'>,
) => binding.status !== 'rejected'
