// [INPUT]: PR 数据
// [OUTPUT]: 同步/创建结果
// [POS]: GitHub PR 服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { resolveGitProviderFromUrl } from '@shared/git-auth'
import type {
  GitProvider,
  ProjectGitHubWorkflowJobSummary,
  ProjectGitHubWorkflowRunSummary,
  ProjectIssueLabelSummary,
  ProjectIssueSummary,
  ProjectPullRequestFileSummary,
  TaskRuntimeGitIdentity,
} from '@shared/types'

const REQUEST_TIMEOUT_MS = 8000
const GITHUB_WORKFLOW_LOG_BLOB_RETRY_DELAYS_MS = [350, 1000]

type SupportedGitProvider = Extract<GitProvider, 'github' | 'gitlab'>

type GitRepoRef = {
  host: string
  namespace: string
  repo: string
}

type GitHubPullRequestPayload = {
  number: number
  html_url?: string
  state?: string
  title?: string
  body?: string
  merged?: boolean
  draft?: boolean
  user?: {
    login?: string
  } | null
  head?: {
    ref?: string
    repo?: {
      name?: string
      full_name?: string
      owner?: {
        login?: string
      } | null
    } | null
  }
  base?: {
    ref?: string
  }
  additions?: number
  deletions?: number
  changed_files?: number
  created_at?: string
  updated_at?: string
  merged_at?: string | null
  closed_at?: string | null
}

type GitHubPullRequestFilePayload = {
  filename?: string
  status?: string
  additions?: number
  deletions?: number
  previous_filename?: string
  patch?: string
  blob_url?: string
}

type GitHubWorkflowRunPayload = {
  id?: number
  name?: string | null
  display_title?: string | null
  run_number?: number
  run_attempt?: number
  status?: string | null
  conclusion?: string | null
  event?: string | null
  head_branch?: string | null
  head_sha?: string | null
  html_url?: string | null
  created_at?: string | null
  updated_at?: string | null
  run_started_at?: string | null
  pull_requests?: Array<{
    number?: number
    head?: {
      ref?: string | null
      sha?: string | null
    } | null
  }>
}

type GitHubWorkflowJobPayload = {
  id?: number
  run_id?: number
  html_url?: string | null
  status?: string | null
  conclusion?: string | null
  started_at?: string | null
  completed_at?: string | null
  name?: string | null
  runner_name?: string | null
  runner_group_name?: string | null
  steps?: Array<{
    name?: string | null
    number?: number
    status?: string | null
    conclusion?: string | null
    started_at?: string | null
    completed_at?: string | null
  }>
}

type GitHubWorkflowRunsPayload = {
  workflow_runs?: GitHubWorkflowRunPayload[]
}

type GitHubWorkflowJobsPayload = {
  jobs?: GitHubWorkflowJobPayload[]
}

type GitHubIssuePayload = {
  id?: number
  number?: number
  html_url?: string
  title?: string
  body?: string | null
  state?: string
  user?: {
    login?: string
  } | null
  labels?: Array<{
    name?: string
    color?: string
  } | string>
  assignees?: Array<{
    login?: string
  }>
  comments?: number
  created_at?: string
  updated_at?: string
  closed_at?: string | null
  pull_request?: unknown
}

type GitLabMergeRequestPayload = {
  iid: number
  web_url?: string
  state?: string
  title?: string
  description?: string
  merged_at?: string | null
  source_branch?: string
  target_branch?: string
}

export type PullRequestSnapshot = {
  number: number
  url?: string
  state: string
  title: string
  body: string
  baseBranch: string
  compareBranch: string
  merged: boolean
}

export type PullRequestLookupResult = {
  ok: boolean
  message: string
  provider: SupportedGitProvider | null
  pullRequest?: PullRequestSnapshot
}

export const parseGitRepoUrl = (repoUrl: string): GitRepoRef | null => {
  const trimmed = repoUrl.trim()
  if (!trimmed) {
    return null
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed)
      const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
      if (segments.length >= 2) {
        return {
          host: parsed.host.toLowerCase(),
          namespace: segments.slice(0, -1).join('/'),
          repo: segments.at(-1)?.replace(/\.git$/i, '') || '',
        }
      }
    }
  } catch {
    // Fall through to SSH/scp-style parsing.
  }

  const patterns = [
    /^git@([^:]+):(.+)\/([^/]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@([^/]+)\/(.+)\/([^/]+?)(?:\.git)?$/i,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (!match) {
      continue
    }

    return {
      host: match[1].toLowerCase(),
      namespace: match[2].replace(/\/+$/g, ''),
      repo: match[3].replace(/\.git$/i, ''),
    }
  }

  return null
}

const resolveGitHubApiBase = (host: string) => {
  const normalizedHost = host.trim().toLowerCase()
  if (!normalizedHost || normalizedHost === 'github.com') {
    return 'https://api.github.com'
  }

  return `https://${normalizedHost}/api/v3`
}

const resolveGitLabApiBase = (host: string) => {
  const normalizedHost = host.trim().toLowerCase()
  return `https://${normalizedHost || 'gitlab.com'}/api/v4`
}

const createGitHubHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'vibemux-pr-status',
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isGitHubWorkflowLogBlobNotReady = (status: number, detail: string) => (
  status === 404 && /BlobNotFound/i.test(detail)
)

const createGitLabHeaders = (token: string) => ({
  'PRIVATE-TOKEN': token,
  'User-Agent': 'vibemux-pr-status',
})

const normalizeGitLabState = (payload: GitLabMergeRequestPayload) => {
  if (payload.merged_at || payload.state?.trim().toLowerCase() === 'merged') {
    return 'merged'
  }

  if (payload.state?.trim().toLowerCase() === 'opened') {
    return 'open'
  }

  if (payload.state?.trim().toLowerCase() === 'closed') {
    return 'closed'
  }

  return payload.state?.trim().toLowerCase() || 'unknown'
}

const toGitHubPullRequestSnapshot = (payload: GitHubPullRequestPayload): PullRequestSnapshot => {
  const merged = Boolean(payload.merged)
  return {
    number: payload.number,
    url: payload.html_url?.trim() || undefined,
    state: merged ? 'merged' : payload.state?.trim() || 'unknown',
    title: payload.title?.trim() || '',
    body: payload.body ?? '',
    baseBranch: payload.base?.ref?.trim() || '',
    compareBranch: payload.head?.ref?.trim() || '',
    merged,
  }
}

const normalizeGitHubPullRequestState = (payload: GitHubPullRequestPayload): RepositoryPullRequestSnapshot['state'] => {
  if (payload.merged || payload.merged_at) {
    return 'merged'
  }

  const state = payload.state?.trim().toLowerCase()
  if (state === 'open' || state === 'closed') {
    return state
  }

  return 'unknown'
}

const normalizeGitHubFileStatus = (status?: string): ProjectPullRequestFileSummary['status'] => {
  if (
    status === 'added'
    || status === 'removed'
    || status === 'modified'
    || status === 'renamed'
    || status === 'copied'
  ) {
    return status
  }

  return 'changed'
}

const toGitHubPullRequestFileSummary = (file: GitHubPullRequestFilePayload): ProjectPullRequestFileSummary | null => {
  const path = file.filename?.trim()
  if (!path) {
    return null
  }

  return {
    path,
    status: normalizeGitHubFileStatus(file.status),
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    previousPath: file.previous_filename?.trim() || undefined,
    patch: file.patch?.trim() || undefined,
    blobUrl: file.blob_url?.trim() || undefined,
  }
}

export type RepositoryPullRequestSnapshot = {
  number: number
  url?: string
  state: 'open' | 'merged' | 'closed' | 'unknown'
  title: string
  body: string
  authorLogin?: string
  baseBranch: string
  compareBranch: string
  headOwner?: string
  headRepo?: string
  merged: boolean
  draft: boolean
  additions: number
  deletions: number
  changedFiles: number
  files: ProjectPullRequestFileSummary[]
  createdAt?: string
  updatedAt?: string
  mergedAt?: string
  closedAt?: string
}

export type RepositoryPullRequestListResult = {
  ok: boolean
  message: string
  provider: SupportedGitProvider | null
  repo?: GitRepoRef
  pullRequests: RepositoryPullRequestSnapshot[]
}

export type RepositoryWorkflowRunsResult = {
  ok: boolean
  message: string
  provider: SupportedGitProvider | null
  runs: ProjectGitHubWorkflowRunSummary[]
}

export type RepositoryWorkflowJobsResult = {
  ok: boolean
  message: string
  provider: SupportedGitProvider | null
  jobs: ProjectGitHubWorkflowJobSummary[]
}

export type RepositoryWorkflowJobLogsResult = {
  ok: boolean
  message: string
  provider: SupportedGitProvider | null
  excerpt: string
  lineCount: number
  truncated: boolean
}

export type RepositoryIssuesResult = {
  ok: boolean
  message: string
  provider: SupportedGitProvider | null
  issues: ProjectIssueSummary[]
}

const normalizeWorkflowRunStatus = (value?: string | null): ProjectGitHubWorkflowRunSummary['status'] => {
  if (
    value === 'queued'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'waiting'
    || value === 'requested'
    || value === 'pending'
  ) {
    return value
  }

  return 'unknown'
}

const normalizeWorkflowRunConclusion = (value?: string | null): ProjectGitHubWorkflowRunSummary['conclusion'] => {
  if (!value) {
    return undefined
  }

  if (
    value === 'success'
    || value === 'failure'
    || value === 'neutral'
    || value === 'cancelled'
    || value === 'skipped'
    || value === 'timed_out'
    || value === 'action_required'
    || value === 'startup_failure'
    || value === 'stale'
  ) {
    return value
  }

  return 'unknown'
}

const normalizeIssueState = (value?: string): ProjectIssueSummary['state'] => (
  value?.trim().toLowerCase() === 'closed' ? 'closed' : 'open'
)

const normalizeIssueLabels = (labels?: GitHubIssuePayload['labels']): ProjectIssueLabelSummary[] => {
  if (!Array.isArray(labels)) {
    return []
  }

  return labels.map((label) => {
    if (typeof label === 'string') {
      return { name: label }
    }

    const name = label.name?.trim()
    if (!name) {
      return null
    }

    return {
      name,
      color: label.color?.trim() || undefined,
    }
  }).filter((label): label is ProjectIssueLabelSummary => Boolean(label))
}

const toGitHubRepositoryPullRequestSnapshot = (
  payload: GitHubPullRequestPayload,
  files: ProjectPullRequestFileSummary[],
): RepositoryPullRequestSnapshot => {
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const state = normalizeGitHubPullRequestState(payload)
  return {
    number: payload.number,
    url: payload.html_url?.trim() || undefined,
    state,
    title: payload.title?.trim() || '',
    body: payload.body ?? '',
    authorLogin: payload.user?.login?.trim() || undefined,
    baseBranch: payload.base?.ref?.trim() || '',
    compareBranch: payload.head?.ref?.trim() || '',
    headOwner: payload.head?.repo?.owner?.login?.trim() || undefined,
    headRepo: payload.head?.repo?.name?.trim() || payload.head?.repo?.full_name?.trim() || undefined,
    merged: state === 'merged',
    draft: Boolean(payload.draft),
    additions: payload.additions ?? additions,
    deletions: payload.deletions ?? deletions,
    changedFiles: payload.changed_files ?? files.length,
    files,
    createdAt: payload.created_at?.trim() || undefined,
    updatedAt: payload.updated_at?.trim() || undefined,
    mergedAt: payload.merged_at?.trim() || undefined,
    closedAt: payload.closed_at?.trim() || undefined,
  }
}

const toGitLabPullRequestSnapshot = (payload: GitLabMergeRequestPayload): PullRequestSnapshot => {
  const state = normalizeGitLabState(payload)
  return {
    number: payload.iid,
    url: payload.web_url?.trim() || undefined,
    state,
    title: payload.title?.trim() || '',
    body: payload.description ?? '',
    baseBranch: payload.target_branch?.trim() || '',
    compareBranch: payload.source_branch?.trim() || '',
    merged: state === 'merged',
  }
}

const fetchGitHubJson = async <T>(url: string, token: string, resourceLabel = 'GitHub PR 状态') => {
  let response: Response
  try {
    response = await fetch(url, {
      headers: createGitHubHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (
      error.name === 'TimeoutError'
      || error.name === 'AbortError'
      || /timed out|timeout/i.test(error.message)
    )
    return {
      ok: false as const,
      status: 0,
      message: timedOut
        ? `${resourceLabel} 请求超时（>${REQUEST_TIMEOUT_MS}ms）。`
        : (error instanceof Error ? error.message : `读取 ${resourceLabel} 失败。`),
    }
  }

  if (response.status === 401 || response.status === 403) {
    const detail = await response.text().catch(() => '')
    const permissionHint = resourceLabel === 'GitHub Issues'
      ? '如果当前项目绑定的是 GitHub App，请确认 App 已开启 Issues: Read-only 权限，并重新安装/授权到目标仓库。'
      : '请确认它仍然可用且具备目标仓库访问权限。'
    return {
      ok: false as const,
      status: response.status,
      message: `当前 GitHub 访问身份无法读取该仓库的 ${resourceLabel}。${permissionHint}${detail ? ` GitHub: ${detail.slice(0, 180)}` : ''}`,
    }
  }

  if (response.status === 404) {
    return {
      ok: false as const,
      status: response.status,
      message: `没有找到对应的 ${resourceLabel}。`,
    }
  }

  if (response.status === 410 && resourceLabel === 'GitHub Issues') {
    return {
      ok: false as const,
      status: response.status,
      message: '这个仓库没有开启 GitHub Issues，或当前访问身份没有读取 Issues 的权限。',
    }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return {
      ok: false as const,
      status: response.status,
      message: `${resourceLabel} 查询失败（HTTP ${response.status}）。${detail ? ` GitHub: ${detail.slice(0, 180)}` : ''}`,
    }
  }

  return {
    ok: true as const,
    status: response.status,
    data: await response.json() as T,
  }
}

const toGitHubWorkflowRunSummary = (params: {
  payload: GitHubWorkflowRunPayload
  projectId: string
  repoFullName: string
}): ProjectGitHubWorkflowRunSummary | null => {
  if (!Number.isFinite(params.payload.id)) {
    return null
  }

  const name = params.payload.name?.trim() || 'Workflow'
  return {
    id: String(params.payload.id),
    projectId: params.projectId,
    repoFullName: params.repoFullName,
    name,
    displayTitle: params.payload.display_title?.trim() || name,
    runNumber: params.payload.run_number ?? 0,
    runAttempt: params.payload.run_attempt ?? 1,
    status: normalizeWorkflowRunStatus(params.payload.status),
    conclusion: normalizeWorkflowRunConclusion(params.payload.conclusion),
    event: params.payload.event?.trim() || 'unknown',
    headBranch: params.payload.head_branch?.trim() || '',
    headSha: params.payload.head_sha?.trim() || '',
    url: params.payload.html_url?.trim() || undefined,
    createdAt: params.payload.created_at?.trim() || undefined,
    updatedAt: params.payload.updated_at?.trim() || undefined,
    runStartedAt: params.payload.run_started_at?.trim() || undefined,
  }
}

const toGitHubWorkflowJobSummary = (params: {
  payload: GitHubWorkflowJobPayload
  projectId: string
}): ProjectGitHubWorkflowJobSummary | null => {
  if (!Number.isFinite(params.payload.id)) {
    return null
  }

  return {
    id: String(params.payload.id),
    runId: String(params.payload.run_id ?? ''),
    projectId: params.projectId,
    name: params.payload.name?.trim() || `Job ${params.payload.id}`,
    status: normalizeWorkflowRunStatus(params.payload.status),
    conclusion: normalizeWorkflowRunConclusion(params.payload.conclusion),
    url: params.payload.html_url?.trim() || undefined,
    startedAt: params.payload.started_at?.trim() || undefined,
    completedAt: params.payload.completed_at?.trim() || undefined,
    runnerName: params.payload.runner_name?.trim() || undefined,
    runnerGroupName: params.payload.runner_group_name?.trim() || undefined,
    steps: (params.payload.steps ?? []).map((step) => ({
      name: step.name?.trim() || `Step ${step.number ?? 0}`,
      number: step.number ?? 0,
      status: normalizeWorkflowRunStatus(step.status),
      conclusion: normalizeWorkflowRunConclusion(step.conclusion),
      startedAt: step.started_at?.trim() || undefined,
      completedAt: step.completed_at?.trim() || undefined,
    })),
  }
}

const toGitHubIssueSummary = (params: {
  payload: GitHubIssuePayload
  projectId: string
  repoFullName: string
}): ProjectIssueSummary | null => {
  if (!Number.isFinite(params.payload.id) || !Number.isFinite(params.payload.number)) {
    return null
  }

  return {
    id: String(params.payload.id),
    projectId: params.projectId,
    repoFullName: params.repoFullName,
    number: params.payload.number ?? 0,
    title: params.payload.title?.trim() || `Issue #${params.payload.number}`,
    body: params.payload.body ?? '',
    state: normalizeIssueState(params.payload.state),
    url: params.payload.html_url?.trim() || undefined,
    authorLogin: params.payload.user?.login?.trim() || undefined,
    labels: normalizeIssueLabels(params.payload.labels),
    assigneeLogins: params.payload.assignees
      ?.map((assignee) => assignee.login?.trim())
      .filter((login): login is string => Boolean(login)) ?? [],
    comments: params.payload.comments ?? 0,
    createdAt: params.payload.created_at?.trim() || undefined,
    updatedAt: params.payload.updated_at?.trim() || undefined,
    closedAt: params.payload.closed_at?.trim() || undefined,
  }
}

const fetchGitLabJson = async <T>(url: string, token: string) => {
  const response = await fetch(url, {
    headers: createGitLabHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false as const,
      status: response.status,
      message: '当前 GitLab PAT 无法读取该仓库的 MR 状态，请确认它仍然可用且具备目标仓库访问权限。',
    }
  }

  if (response.status === 404) {
    return {
      ok: false as const,
      status: response.status,
      message: '没有找到对应的 GitLab MR。',
    }
  }

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      message: `GitLab MR 状态查询失败（HTTP ${response.status}）。`,
    }
  }

  return {
    ok: true as const,
    status: response.status,
    data: await response.json() as T,
  }
}

const lookupGitHubPullRequest = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  number?: number
  baseBranch?: string
  compareBranch?: string
}): Promise<PullRequestLookupResult> => {
  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (
    !token
    || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
    || params.gitIdentity?.provider !== 'github'
  ) {
    return {
      ok: false,
      provider: 'github',
      message: '查询 PR 状态目前需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'github',
      message: '当前仓库地址无法解析 GitHub 仓库信息，暂时不能查询 PR 状态。',
    }
  }

  try {
    const apiBase = resolveGitHubApiBase(repo.host)
    const prNumber = Number.isFinite(params.number) ? Number(params.number) : 0

    if (prNumber > 0) {
      const byNumber = await fetchGitHubJson<GitHubPullRequestPayload>(
        `${apiBase}/repos/${repo.namespace}/${repo.repo}/pulls/${prNumber}`,
        token,
      )
      if (byNumber.ok) {
        return {
          ok: true,
          provider: 'github',
          message: 'PR 状态已刷新。',
          pullRequest: toGitHubPullRequestSnapshot(byNumber.data),
        }
      }

      if (byNumber.status !== 404) {
        return {
          ok: false,
          provider: 'github',
          message: byNumber.message,
        }
      }
    }

    const compareBranch = params.compareBranch?.trim() || ''
    if (!compareBranch) {
      return {
        ok: false,
        provider: 'github',
        message: '缺少 compare branch，暂时无法刷新 PR 状态。',
      }
    }

    const search = new URLSearchParams({
      state: 'all',
      head: `${repo.namespace}:${compareBranch}`,
      per_page: '20',
    })
    if (params.baseBranch?.trim()) {
      search.set('base', params.baseBranch.trim())
    }

    const byBranch = await fetchGitHubJson<GitHubPullRequestPayload[]>(
      `${apiBase}/repos/${repo.namespace}/${repo.repo}/pulls?${search.toString()}`,
      token,
    )
    if (!byBranch.ok) {
      return {
        ok: false,
        provider: 'github',
        message: byBranch.message,
      }
    }

    const matched = byBranch.data.find((item) => {
      const headRef = item.head?.ref?.trim() || ''
      const baseRef = item.base?.ref?.trim() || ''
      return headRef === compareBranch && (!params.baseBranch?.trim() || baseRef === params.baseBranch.trim())
    }) ?? byBranch.data[0]

    if (!matched) {
      return {
        ok: false,
        provider: 'github',
        message: '没有找到与当前工作分支对应的 GitHub PR。',
      }
    }

    return {
      ok: true,
      provider: 'github',
      message: 'PR 状态已刷新。',
      pullRequest: toGitHubPullRequestSnapshot(matched),
    }
  } catch (error) {
    return {
      ok: false,
      provider: 'github',
      message: error instanceof Error ? error.message : '查询 GitHub PR 状态失败。',
    }
  }
}

const lookupGitLabMergeRequest = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  number?: number
  baseBranch?: string
  compareBranch?: string
}): Promise<PullRequestLookupResult> => {
  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (!token || params.gitIdentity?.authMode !== 'pat' || params.gitIdentity.provider !== 'gitlab') {
    return {
      ok: false,
      provider: 'gitlab',
      message: '查询 PR 状态目前需要为当前项目绑定一个可用的 GitLab PAT 身份。',
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'gitlab',
      message: '当前仓库地址无法解析 GitLab 仓库信息，暂时不能查询 PR 状态。',
    }
  }

  try {
    const apiBase = resolveGitLabApiBase(repo.host)
    const projectId = encodeURIComponent(`${repo.namespace}/${repo.repo}`)
    const mrNumber = Number.isFinite(params.number) ? Number(params.number) : 0

    if (mrNumber > 0) {
      const byNumber = await fetchGitLabJson<GitLabMergeRequestPayload>(
        `${apiBase}/projects/${projectId}/merge_requests/${mrNumber}`,
        token,
      )
      if (byNumber.ok) {
        return {
          ok: true,
          provider: 'gitlab',
          message: 'PR 状态已刷新。',
          pullRequest: toGitLabPullRequestSnapshot(byNumber.data),
        }
      }

      if (byNumber.status !== 404) {
        return {
          ok: false,
          provider: 'gitlab',
          message: byNumber.message,
        }
      }
    }

    const compareBranch = params.compareBranch?.trim() || ''
    if (!compareBranch) {
      return {
        ok: false,
        provider: 'gitlab',
        message: '缺少 compare branch，暂时无法刷新 PR 状态。',
      }
    }

    const search = new URLSearchParams({
      state: 'all',
      source_branch: compareBranch,
      per_page: '20',
    })
    if (params.baseBranch?.trim()) {
      search.set('target_branch', params.baseBranch.trim())
    }

    const byBranch = await fetchGitLabJson<GitLabMergeRequestPayload[]>(
      `${apiBase}/projects/${projectId}/merge_requests?${search.toString()}`,
      token,
    )
    if (!byBranch.ok) {
      return {
        ok: false,
        provider: 'gitlab',
        message: byBranch.message,
      }
    }

    const matched = byBranch.data.find((item) => {
      const headRef = item.source_branch?.trim() || ''
      const baseRef = item.target_branch?.trim() || ''
      return headRef === compareBranch && (!params.baseBranch?.trim() || baseRef === params.baseBranch.trim())
    }) ?? byBranch.data[0]

    if (!matched) {
      return {
        ok: false,
        provider: 'gitlab',
        message: '没有找到与当前工作分支对应的 GitLab MR。',
      }
    }

    return {
      ok: true,
      provider: 'gitlab',
      message: 'PR 状态已刷新。',
      pullRequest: toGitLabPullRequestSnapshot(matched),
    }
  } catch (error) {
    return {
      ok: false,
      provider: 'gitlab',
      message: error instanceof Error ? error.message : '查询 GitLab MR 状态失败。',
    }
  }
}

const listGitHubRepositoryPullRequests = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  maxPages?: number
  perPage?: number
}): Promise<RepositoryPullRequestListResult> => {
  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (
    !token
    || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
    || params.gitIdentity?.provider !== 'github'
  ) {
    return {
      ok: false,
      provider: 'github',
      message: '同步 PR 列表需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
      pullRequests: [],
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'github',
      message: '当前仓库地址无法解析 GitHub 仓库信息，暂时不能同步 PR 列表。',
      pullRequests: [],
    }
  }

  try {
    const apiBase = resolveGitHubApiBase(repo.host)
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 50))
    const maxPages = Math.min(5, Math.max(1, params.maxPages ?? 2))
    const pullRequests: GitHubPullRequestPayload[] = []

    for (let page = 1; page <= maxPages; page += 1) {
      const search = new URLSearchParams({
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: String(perPage),
        page: String(page),
      })
      const response = await fetchGitHubJson<GitHubPullRequestPayload[]>(
        `${apiBase}/repos/${repo.namespace}/${repo.repo}/pulls?${search.toString()}`,
        token,
      )
      if (!response.ok) {
        return {
          ok: false,
          provider: 'github',
          repo,
          message: response.message,
          pullRequests: [],
        }
      }

      pullRequests.push(...response.data)
      if (response.data.length < perPage) {
        break
      }
    }

    const snapshots: RepositoryPullRequestSnapshot[] = []
    for (const pullRequest of pullRequests) {
      const filesResponse = await fetchGitHubJson<GitHubPullRequestFilePayload[]>(
        `${apiBase}/repos/${repo.namespace}/${repo.repo}/pulls/${pullRequest.number}/files?per_page=100`,
        token,
      )
      const files = filesResponse.ok
        ? filesResponse.data.map(toGitHubPullRequestFileSummary).filter((file): file is ProjectPullRequestFileSummary => Boolean(file))
        : []
      snapshots.push(toGitHubRepositoryPullRequestSnapshot(pullRequest, files))
    }

    return {
      ok: true,
      provider: 'github',
      repo,
      message: 'PR 列表已同步。',
      pullRequests: snapshots,
    }
  } catch (error) {
    return {
      ok: false,
      provider: 'github',
      repo,
      message: error instanceof Error ? error.message : '同步 GitHub PR 列表失败。',
      pullRequests: [],
    }
  }
}

const listGitHubRepositoryWorkflowRuns = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  projectId: string
  branch?: string
  headSha?: string
  pullRequestNumber?: number
  maxPages?: number
  perPage?: number
}): Promise<RepositoryWorkflowRunsResult> => {
  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (
    !token
    || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
    || params.gitIdentity?.provider !== 'github'
  ) {
    return {
      ok: false,
      provider: 'github',
      message: '读取 GitHub Actions 需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
      runs: [],
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'github',
      message: '当前仓库地址无法解析 GitHub 仓库信息，暂时不能读取 Actions。',
      runs: [],
    }
  }

  try {
    const apiBase = resolveGitHubApiBase(repo.host)
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 30))
    const maxPages = Math.min(3, Math.max(1, params.maxPages ?? 1))
    const workflowRuns: GitHubWorkflowRunPayload[] = []
    const branch = params.branch?.trim() || ''

    for (let page = 1; page <= maxPages; page += 1) {
      const search = new URLSearchParams({
        per_page: String(perPage),
        page: String(page),
      })
      if (branch) {
        search.set('branch', branch)
      }

      const response = await fetchGitHubJson<GitHubWorkflowRunsPayload>(
        `${apiBase}/repos/${repo.namespace}/${repo.repo}/actions/runs?${search.toString()}`,
        token,
        'GitHub Actions workflow runs',
      )
      if (!response.ok) {
        return {
          ok: false,
          provider: 'github',
          message: response.message,
          runs: [],
        }
      }

      const pageRuns = response.data.workflow_runs ?? []
      workflowRuns.push(...pageRuns)
      if (pageRuns.length < perPage) {
        break
      }
    }

    const headSha = params.headSha?.trim() || ''
    const pullRequestNumber = Number.isFinite(params.pullRequestNumber) ? params.pullRequestNumber : 0
    const filteredRuns = workflowRuns.filter((run) => {
      if (headSha && run.head_sha?.trim() === headSha) {
        return true
      }

      if (pullRequestNumber && run.pull_requests?.some((pullRequest) => pullRequest.number === pullRequestNumber)) {
        return true
      }

      return branch ? run.head_branch?.trim() === branch : true
    })

    return {
      ok: true,
      provider: 'github',
      message: 'GitHub Actions 已刷新。',
      runs: filteredRuns
        .map((payload) => toGitHubWorkflowRunSummary({
          payload,
          projectId: params.projectId,
          repoFullName: `${repo.namespace}/${repo.repo}`,
        }))
        .filter((run): run is ProjectGitHubWorkflowRunSummary => Boolean(run)),
    }
  } catch (error) {
    return {
      ok: false,
      provider: 'github',
      message: error instanceof Error ? error.message : '读取 GitHub Actions 失败。',
      runs: [],
    }
  }
}

const listGitHubRepositoryIssues = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  projectId: string
  state?: ProjectIssueSummary['state'] | 'all'
  maxPages?: number
  perPage?: number
}): Promise<RepositoryIssuesResult> => {
  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (
    !token
    || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
    || params.gitIdentity?.provider !== 'github'
  ) {
    return {
      ok: false,
      provider: 'github',
      message: '读取 GitHub Issues 需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
      issues: [],
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'github',
      message: '当前仓库地址无法解析 GitHub 仓库信息，暂时不能读取 Issues。',
      issues: [],
    }
  }

  try {
    const apiBase = resolveGitHubApiBase(repo.host)
    const perPage = Math.min(100, Math.max(1, params.perPage ?? 50))
    const maxPages = Math.min(3, Math.max(1, params.maxPages ?? 1))
    const issues: GitHubIssuePayload[] = []
    const state = params.state === 'closed' || params.state === 'all' ? params.state : 'open'

    for (let page = 1; page <= maxPages; page += 1) {
      const search = new URLSearchParams({
        state,
        sort: 'updated',
        direction: 'desc',
        per_page: String(perPage),
        page: String(page),
      })
      const response = await fetchGitHubJson<GitHubIssuePayload[]>(
        `${apiBase}/repos/${repo.namespace}/${repo.repo}/issues?${search.toString()}`,
        token,
        'GitHub Issues',
      )
      if (!response.ok) {
        return {
          ok: false,
          provider: 'github',
          message: response.message,
          issues: [],
        }
      }

      issues.push(...response.data)
      if (response.data.length < perPage) {
        break
      }
    }

    return {
      ok: true,
      provider: 'github',
      message: 'GitHub Issues 已刷新。',
      issues: issues
        .filter((issue) => !issue.pull_request)
        .map((payload) => toGitHubIssueSummary({
          payload,
          projectId: params.projectId,
          repoFullName: `${repo.namespace}/${repo.repo}`,
        }))
        .filter((issue): issue is ProjectIssueSummary => Boolean(issue)),
    }
  } catch (error) {
    return {
      ok: false,
      provider: 'github',
      message: error instanceof Error ? error.message : '读取 GitHub Issues 失败。',
      issues: [],
    }
  }
}

export const listRepositoryPullRequests = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  maxPages?: number
  perPage?: number
}): Promise<RepositoryPullRequestListResult> => {
  const provider = params.gitIdentity?.provider ?? resolveGitProviderFromUrl(params.repoUrl)
  if (provider === 'github') {
    return listGitHubRepositoryPullRequests(params)
  }

  return {
    ok: false,
    provider: provider === 'gitlab' ? 'gitlab' : null,
    message: '当前仓库平台暂不支持同步 PR 列表。',
    pullRequests: [],
  }
}

export const listRepositoryWorkflowRuns = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  projectId: string
  branch?: string
  headSha?: string
  pullRequestNumber?: number
  maxPages?: number
  perPage?: number
}): Promise<RepositoryWorkflowRunsResult> => {
  const provider = params.gitIdentity?.provider ?? resolveGitProviderFromUrl(params.repoUrl)
  if (provider === 'github') {
    return listGitHubRepositoryWorkflowRuns(params)
  }

  return {
    ok: false,
    provider: provider === 'gitlab' ? 'gitlab' : null,
    message: '当前仓库平台暂不支持读取 Actions。',
    runs: [],
  }
}

export const listRepositoryWorkflowJobs = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  projectId: string
  runId: string
}): Promise<RepositoryWorkflowJobsResult> => {
  const provider = params.gitIdentity?.provider ?? resolveGitProviderFromUrl(params.repoUrl)
  if (provider !== 'github') {
    return {
      ok: false,
      provider: provider === 'gitlab' ? 'gitlab' : null,
      message: '当前仓库平台暂不支持读取 workflow jobs。',
      jobs: [],
    }
  }

  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (
    !token
    || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
    || params.gitIdentity?.provider !== 'github'
  ) {
    return {
      ok: false,
      provider: 'github',
      message: '读取 workflow jobs 需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
      jobs: [],
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'github',
      message: '当前仓库地址无法解析 GitHub 仓库信息，暂时不能读取 workflow jobs。',
      jobs: [],
    }
  }

  const runId = Number.parseInt(params.runId, 10)
  if (!Number.isFinite(runId) || runId <= 0) {
    return {
      ok: false,
      provider: 'github',
      message: '无效的 workflow run id。',
      jobs: [],
    }
  }

  const apiBase = resolveGitHubApiBase(repo.host)
  const response = await fetchGitHubJson<GitHubWorkflowJobsPayload>(
    `${apiBase}/repos/${repo.namespace}/${repo.repo}/actions/runs/${runId}/jobs?per_page=100`,
    token,
    'GitHub workflow jobs',
  )
  if (!response.ok) {
    return {
      ok: false,
      provider: 'github',
      message: response.message,
      jobs: [],
    }
  }

  return {
    ok: true,
    provider: 'github',
    message: 'GitHub workflow jobs 已刷新。',
    jobs: (response.data.jobs ?? [])
      .map((payload) => toGitHubWorkflowJobSummary({
        payload,
        projectId: params.projectId,
      }))
      .filter((job): job is ProjectGitHubWorkflowJobSummary => Boolean(job)),
  }
}

export const getRepositoryWorkflowJobLogs = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  runId: string
  jobId: string
}): Promise<RepositoryWorkflowJobLogsResult> => {
  const provider = params.gitIdentity?.provider ?? resolveGitProviderFromUrl(params.repoUrl)
  if (provider !== 'github') {
    return {
      ok: false,
      provider: provider === 'gitlab' ? 'gitlab' : null,
      message: '当前仓库平台暂不支持读取 workflow logs。',
      excerpt: '',
      lineCount: 0,
      truncated: false,
    }
  }

  const token = params.gitIdentity?.credentialToken?.trim() || ''
  if (
    !token
    || !['pat', 'github-app'].includes(params.gitIdentity?.authMode ?? '')
    || params.gitIdentity?.provider !== 'github'
  ) {
    return {
      ok: false,
      provider: 'github',
      message: '读取 workflow logs 需要为当前项目绑定一个可用的 GitHub 访问身份（PAT 或 GitHub App installation）。',
      excerpt: '',
      lineCount: 0,
      truncated: false,
    }
  }

  const repo = parseGitRepoUrl(params.repoUrl)
  if (!repo) {
    return {
      ok: false,
      provider: 'github',
      message: '当前仓库地址无法解析 GitHub 仓库信息，暂时不能读取 workflow logs。',
      excerpt: '',
      lineCount: 0,
      truncated: false,
    }
  }

  const jobId = Number.parseInt(params.jobId, 10)
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return {
      ok: false,
      provider: 'github',
      message: '无效的 workflow job id。',
      excerpt: '',
      lineCount: 0,
      truncated: false,
    }
  }

  const apiBase = resolveGitHubApiBase(repo.host)
  const logUrl = `${apiBase}/repos/${repo.namespace}/${repo.repo}/actions/jobs/${jobId}/logs`
  let response: Response | null = null
  let lastFailureDetail = ''

  for (let attempt = 0; attempt <= GITHUB_WORKFLOW_LOG_BLOB_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await fetch(logUrl, {
        headers: createGitHubHeaders(token),
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const timedOut = error instanceof Error && (
        error.name === 'TimeoutError'
        || error.name === 'AbortError'
        || /timed out|timeout/i.test(error.message)
      )
      return {
        ok: false,
        provider: 'github',
        message: timedOut
          ? `GitHub workflow job logs 请求超时（>${REQUEST_TIMEOUT_MS}ms）。`
          : (error instanceof Error ? error.message : '读取 workflow logs 失败。'),
        excerpt: '',
        lineCount: 0,
        truncated: false,
      }
    }

    if (response.ok) {
      break
    }

    lastFailureDetail = await response.text().catch(() => '')
    if (
      !isGitHubWorkflowLogBlobNotReady(response.status, lastFailureDetail)
      || attempt >= GITHUB_WORKFLOW_LOG_BLOB_RETRY_DELAYS_MS.length
    ) {
      break
    }

    await sleep(GITHUB_WORKFLOW_LOG_BLOB_RETRY_DELAYS_MS[attempt]!)
  }

  if (!response?.ok) {
    if (response && isGitHubWorkflowLogBlobNotReady(response.status, lastFailureDetail)) {
      return {
        ok: false,
        provider: 'github',
        message: 'GitHub workflow job logs 暂未就绪。当前 job 仍在运行，或 GitHub 还未生成可下载的日志文件；请稍后重试，或打开 GitHub 查看实时日志。',
        excerpt: '',
        lineCount: 0,
        truncated: false,
      }
    }

    return {
      ok: false,
      provider: 'github',
      message: `GitHub workflow job logs 查询失败（HTTP ${response?.status ?? 'unknown'}）。${lastFailureDetail ? ` GitHub: ${lastFailureDetail.slice(0, 180)}` : ''}`,
      excerpt: '',
      lineCount: 0,
      truncated: false,
    }
  }

  const rawLogs = await response.text()
  const normalized = rawLogs.replace(/\r\n/g, '\n').trim()
  const lines = normalized ? normalized.split('\n') : []
  const maxLines = 400
  const excerptLines = lines.slice(-maxLines)

  return {
    ok: true,
    provider: 'github',
    message: 'GitHub workflow job logs 已刷新。',
    excerpt: excerptLines.join('\n'),
    lineCount: lines.length,
    truncated: lines.length > excerptLines.length,
  }
}

export const listRepositoryIssues = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  projectId: string
  state?: ProjectIssueSummary['state'] | 'all'
  maxPages?: number
  perPage?: number
}): Promise<RepositoryIssuesResult> => {
  const provider = params.gitIdentity?.provider ?? resolveGitProviderFromUrl(params.repoUrl)
  if (provider === 'github') {
    return listGitHubRepositoryIssues(params)
  }

  return {
    ok: false,
    provider: provider === 'gitlab' ? 'gitlab' : null,
    message: '当前仓库平台暂不支持读取 Issues。',
    issues: [],
  }
}

export const lookupPullRequest = async (params: {
  repoUrl: string
  gitIdentity?: TaskRuntimeGitIdentity
  number?: number
  baseBranch?: string
  compareBranch?: string
}): Promise<PullRequestLookupResult> => {
  const provider = params.gitIdentity?.provider ?? resolveGitProviderFromUrl(params.repoUrl)
  if (provider === 'github') {
    return lookupGitHubPullRequest(params)
  }

  if (provider === 'gitlab') {
    return lookupGitLabMergeRequest(params)
  }

  return {
    ok: false,
    provider: null,
    message: '当前仓库平台暂不支持查询 PR 状态。',
  }
}
