// [INPUT]: PR 评审输入
// [OUTPUT]: 评审契约
// [POS]: PR 评审类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type ProjectPullRequestProvider = 'github'

export type ProjectPullRequestState = 'open' | 'merged' | 'closed' | 'unknown'

export interface ProjectPullRequestFileSummary {
  path: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed'
  additions: number
  deletions: number
  previousPath?: string
  patch?: string
  blobUrl?: string
}

export interface ProjectPullRequestReviewSummary {
  id: string
  provider: ProjectPullRequestProvider
  projectId: string
  repoHost: string
  repoOwner: string
  repoName: string
  repoFullName: string
  repoUrl: string
  number: number
  url?: string
  title: string
  body: string
  authorLogin?: string
  state: ProjectPullRequestState
  merged: boolean
  draft: boolean
  baseBranch: string
  compareBranch: string
  headOwner?: string
  headRepo?: string
  additions: number
  deletions: number
  changedFiles: number
  files: ProjectPullRequestFileSummary[]
  matchedWorkspaceId?: string
  matchedWorkspaceSessionId?: string
  matchedTaskId?: string
  matchedTaskTitle?: string
  syncedAt: string
  createdAt?: string
  updatedAt?: string
  mergedAt?: string
  closedAt?: string
}

export interface ProjectPullRequestSyncResult {
  ok: boolean
  message: string
  projectId?: string
  syncedAt?: string
  pullRequestCount: number
  pullRequests: ProjectPullRequestReviewSummary[]
}

export interface ProjectPullRequestBulkSyncProjectResult {
  projectId: string
  ok: boolean
  message: string
  pullRequestCount: number
}

export interface ProjectPullRequestBulkSyncResult {
  ok: boolean
  message: string
  syncedAt?: string
  pullRequestCount: number
  projectResults: ProjectPullRequestBulkSyncProjectResult[]
  pullRequests: ProjectPullRequestReviewSummary[]
}

export interface ProjectPullRequestListResponse {
  pullRequests: ProjectPullRequestReviewSummary[]
  lastSyncedAt?: string
  nextCursor?: string
  hasMore?: boolean
}

export interface ProjectPullRequestReviewWorkflowResponse {
  ok: boolean
  message: string
  pullRequest: ProjectPullRequestReviewSummary
  taskId: string
  workspaceId: string
  workspaceSessionId: string
  createdTask: boolean
  createdWorkspaceSession: boolean
}

export type ProjectGitHubWorkflowRunStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending' | 'unknown'
export type ProjectGitHubWorkflowRunConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'startup_failure' | 'stale' | 'unknown'

export interface ProjectGitHubWorkflowRunSummary {
  id: string
  resourceId?: string
  projectId: string
  repoFullName: string
  name: string
  displayTitle: string
  runNumber: number
  runAttempt: number
  status: ProjectGitHubWorkflowRunStatus
  conclusion?: ProjectGitHubWorkflowRunConclusion
  event: string
  headBranch: string
  headSha: string
  url?: string
  createdAt?: string
  updatedAt?: string
  runStartedAt?: string
}

export interface ProjectGitHubWorkflowJobStepSummary {
  name: string
  number: number
  status: ProjectGitHubWorkflowRunStatus
  conclusion?: ProjectGitHubWorkflowRunConclusion
  startedAt?: string
  completedAt?: string
}

export interface ProjectGitHubWorkflowJobSummary {
  id: string
  runId: string
  projectId: string
  name: string
  status: ProjectGitHubWorkflowRunStatus
  conclusion?: ProjectGitHubWorkflowRunConclusion
  url?: string
  startedAt?: string
  completedAt?: string
  runnerName?: string
  runnerGroupName?: string
  steps: ProjectGitHubWorkflowJobStepSummary[]
}

export interface ProjectGitHubWorkflowRunJobsResponse {
  ok: boolean
  message: string
  jobs: ProjectGitHubWorkflowJobSummary[]
}

export interface ProjectGitHubWorkflowJobLogsResponse {
  ok: boolean
  message: string
  jobId: string
  excerpt: string
  lineCount: number
  truncated: boolean
}

export interface ProjectGitHubWorkflowRunsResponse {
  ok: boolean
  message: string
  nextCursor?: string
  hasMore?: boolean
  projectResults?: Array<{
    projectId: string
    projectName: string
    ok: boolean
    message: string
    runCount: number
  }>
  runs: ProjectGitHubWorkflowRunSummary[]
}

export type ProjectIssueState = 'open' | 'closed'

export interface ProjectIssueLabelSummary {
  name: string
  color?: string
}

export interface ProjectIssueSummary {
  id: string
  projectId: string
  repoFullName: string
  number: number
  title: string
  body: string
  state: ProjectIssueState
  url?: string
  authorLogin?: string
  labels: ProjectIssueLabelSummary[]
  assigneeLogins: string[]
  comments: number
  createdAt?: string
  updatedAt?: string
  closedAt?: string
}

export interface ProjectIssuesResponse {
  ok: boolean
  message: string
  nextCursor?: string
  hasMore?: boolean
  projectResults?: Array<{
    projectId: string
    projectName: string
    ok: boolean
    message: string
    issueCount: number
  }>
  issues: ProjectIssueSummary[]
}
