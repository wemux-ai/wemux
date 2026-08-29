// [INPUT]: PR 评审输入
// [OUTPUT]: 评审结果
// [POS]: 项目 PR 评审服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import type {
  ProjectGitHubWorkflowJobLogsResponse,
  ProjectGitHubWorkflowRunJobsResponse,
  AppState,
  Project,
  ProjectGitHubWorkflowRunSummary,
  ProjectGitHubWorkflowRunsResponse,
  ProjectIssuesResponse,
  ProjectIssueSummary,
  ProjectPullRequestBulkSyncResult,
  ProjectPullRequestReviewSummary,
  ProjectPullRequestSyncResult,
  GitHubResourceBinding,
  GitHubResourceBindingRole,
  GitHubResourceBindingSource,
  WorkspaceSession,
} from '@shared/types'
import {
  buildGitHubRepositoryResourceId,
  isActiveGitHubResourceBinding,
} from '@shared/types'
import { resolveGitProviderFromUrl } from '@shared/git-auth'
import { resolveUserProjectGitIdentity } from '../control-plane/task-git-identity'
import { loadState } from '../storage/app-state-store'
import { listWorkspaces } from '../storage/distributed-task-store'
import {
  listGitHubResourceBindings,
  upsertGitHubResourceBinding,
} from '../storage/postgres/github-resource-binding-store'
import { upsertProjectIssues } from '../storage/postgres/project-issue-store'
import { listProjectPullRequests, upsertProjectPullRequests, type ProjectPullRequestListOptions } from '../storage/postgres/project-pull-request-store'
import { upsertProjectWorkflowRuns } from '../storage/postgres/project-workflow-run-store'
import { createGitHubAppInstallationAccessToken, fetchGitHubAppInstallationRepositories, type GitHubAppRepositorySummary } from './github-app-service'
import { listGitHubAppInstallationSummariesForUser, type GitHubAppInstallationSummary } from './github-app-installation-store'
import {
  getRepositoryWorkflowJobLogs,
  listRepositoryWorkflowJobs,
  listRepositoryIssues,
  listRepositoryPullRequests,
  listRepositoryWorkflowRuns,
  parseGitRepoUrl,
  type RepositoryPullRequestSnapshot,
} from './github-pull-request-service'

type PullRequestMatch = Pick<
  ProjectPullRequestReviewSummary,
  'matchedWorkspaceId' | 'matchedWorkspaceSessionId' | 'matchedTaskId' | 'matchedTaskTitle'
>

const normalizeBranch = (value?: string | null) => value?.trim() || ''
const normalizeRepoFullName = (value: string) => value.trim().toLowerCase()
const DEFAULT_GITHUB_REPOSITORY_PAGE_SIZE = 5
const MAX_GITHUB_REPOSITORY_PAGE_SIZE = 20

type GitHubAppReviewRepositoryTarget = {
  installation: GitHubAppInstallationSummary
  repo: GitHubAppRepositorySummary
  projectId: string
  projectName: string
  gitIdentity: {
    mode: 'personal'
    authMode: 'github-app'
    authSourceType: 'github-app-installation'
    provider: 'github'
    host: string
    userId: string
    githubInstallationId: number
    githubRepositoryId: number
    githubRepositoryName: string
    githubAccountLogin: string
    githubAccountType: string
    credentialToken: string
  }
}

type CursorPage<T> = {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

const parseOffsetCursor = (value?: string) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const normalizePageSize = (value: number | undefined, fallback: number, max: number) => {
  const parsed = Math.floor(value ?? fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.min(parsed, max)
}

const sliceCursorPage = <T>(items: T[], params: {
  cursor?: string
  limit?: number
  defaultLimit: number
  maxLimit: number
}): CursorPage<T> => {
  const offset = parseOffsetCursor(params.cursor)
  const limit = normalizePageSize(params.limit, params.defaultLimit, params.maxLimit)
  const pageItems = items.slice(offset, offset + limit)
  const nextOffset = offset + pageItems.length
  const hasMore = nextOffset < items.length

  return {
    items: pageItems,
    nextCursor: hasMore ? String(nextOffset) : undefined,
    hasMore,
  }
}

const githubAppPermissionAllowsRead = (
  permissions: Record<string, string>,
  key: string,
) => permissions[key] === 'read' || permissions[key] === 'write'

const getProjectRepoFullName = (project: Project) => {
  if (project.versionControl !== 'git-remote' || resolveGitProviderFromUrl(project.gitUrl) !== 'github') {
    return ''
  }

  const repo = parseGitRepoUrl(project.gitUrl)
  return repo ? normalizeRepoFullName(`${repo.namespace}/${repo.repo}`) : ''
}

const buildProjectLookupByRepoFullName = (projects: Project[]) => {
  const lookup = new Map<string, Project>()
  for (const project of projects) {
    const repoFullName = getProjectRepoFullName(project)
    if (repoFullName && !lookup.has(repoFullName)) {
      lookup.set(repoFullName, project)
    }
  }

  return lookup
}

const buildSyntheticGithubProjectId = (repoFullName: string) => `github:${normalizeRepoFullName(repoFullName)}`

const listGitHubAppReviewRepositoryTargets = async (params: {
  userId: string
  projects: Project[]
  requiredPermission: 'actions' | 'issues'
  projectFilterId?: string
  cursor?: string
  limit?: number
}) => {
  const projectLookup = buildProjectLookupByRepoFullName(params.projects)
  const projectFilter = params.projectFilterId
    ? params.projects.find((project) => project.id === params.projectFilterId) ?? null
    : null
  const projectFilterRepoFullName = projectFilter ? getProjectRepoFullName(projectFilter) : ''
  const allowedRepoFullNames = new Set(projectLookup.keys())
  const installations = (await listGitHubAppInstallationSummariesForUser(params.userId))
    .filter((installation) => installation.provider === 'github')
    .filter((installation) => !installation.suspendedAt)

  const targets: GitHubAppReviewRepositoryTarget[] = []
  const failures: string[] = []
  const seenRepoFullNames = new Set<string>()

  if (installations.length === 0) {
    return {
      targets,
      failures: ['当前账号还没有连接 GitHub App。请先在设置里连接 GitHub App 后再读取 GitHub Issues / Actions。'],
      hasMore: false,
    }
  }

  if (projectFilter && !projectFilterRepoFullName) {
    return {
      targets,
      failures: [`${projectFilter.name}: 当前项目不是 GitHub 远端仓库，无法用于 GitHub 筛选。`],
      hasMore: false,
    }
  }

  for (const installation of installations) {
    if (!githubAppPermissionAllowsRead(installation.permissions, params.requiredPermission)) {
      failures.push(`${installation.accountLogin}: GitHub App 缺少 ${params.requiredPermission === 'issues' ? 'Issues: Read-only' : 'Actions: Read-only'} 权限，请更新 App 权限并重新安装。`)
      continue
    }

    let accessToken: Awaited<ReturnType<typeof createGitHubAppInstallationAccessToken>>
    let repositories: GitHubAppRepositorySummary[]
    try {
      accessToken = await createGitHubAppInstallationAccessToken(installation.installationId)
      repositories = await fetchGitHubAppInstallationRepositories(installation.installationId)
    } catch (error) {
      failures.push(`${installation.accountLogin}: ${error instanceof Error ? error.message : 'GitHub App installation 仓库列表读取失败。'}`)
      continue
    }

    for (const repo of repositories) {
      const repoFullName = normalizeRepoFullName(repo.fullName)
      if (projectFilterRepoFullName && repoFullName !== projectFilterRepoFullName) {
        continue
      }
      if (!projectFilterRepoFullName && !allowedRepoFullNames.has(repoFullName)) {
        continue
      }
      if (seenRepoFullNames.has(repoFullName)) {
        continue
      }

      seenRepoFullNames.add(repoFullName)
      const matchedProject = projectLookup.get(repoFullName)
      targets.push({
        installation,
        repo,
        projectId: matchedProject?.id ?? buildSyntheticGithubProjectId(repo.fullName),
        projectName: matchedProject?.name ?? repo.fullName,
        gitIdentity: {
          mode: 'personal',
          authMode: 'github-app',
          authSourceType: 'github-app-installation',
          provider: 'github',
          host: installation.providerHost,
          userId: params.userId,
          githubInstallationId: installation.installationId,
          githubRepositoryId: repo.id,
          githubRepositoryName: repo.fullName,
          githubAccountLogin: installation.accountLogin,
          githubAccountType: installation.accountType,
          credentialToken: accessToken.token,
        },
      })
    }
  }

  const page = sliceCursorPage(targets, {
    cursor: params.cursor,
    limit: params.limit,
    defaultLimit: DEFAULT_GITHUB_REPOSITORY_PAGE_SIZE,
    maxLimit: MAX_GITHUB_REPOSITORY_PAGE_SIZE,
  })

  return {
    targets: page.items,
    failures,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

export const buildProjectPullRequestId = (params: {
  provider: ProjectPullRequestReviewSummary['provider']
  repoHost: string
  repoOwner: string
  repoName: string
  number: number
}) => params.provider === 'github'
  ? buildGitHubRepositoryResourceId({
      repoHost: params.repoHost,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      nativeId: params.number,
    })
  : [
      params.provider,
      params.repoHost.trim().toLowerCase(),
      params.repoOwner.trim().toLowerCase(),
      params.repoName.trim().toLowerCase(),
      String(params.number).trim(),
    ].join(':')

const selectTaskForWorkspace = (state: AppState, workspaceId: string) => {
  const binding = state.taskWorkspaceBindings.find((item) => item.workspaceId === workspaceId && item.status === 'active')
  if (binding) {
    return state.tasks.find((task) => task.id === binding.taskId) ?? null
  }

  return state.tasks.find((task) => (
    state.taskWorkspaceBindings.some((binding) => (
      binding.workspaceId === workspaceId
      && binding.taskId === task.id
      && binding.status === 'active'
    ))
  )) ?? null
}

const resolveSessionTask = (
  state: AppState,
  session: WorkspaceSession,
) => selectTaskForWorkspace(state, session.workspaceId)

export const resolvePullRequestMatch = (params: {
  state: AppState
  project: Project
  pullRequest: RepositoryPullRequestSnapshot
}): PullRequestMatch => {
  return resolveGitHubBranchContextMatch({
    state: params.state,
    project: params.project,
    compareBranch: params.pullRequest.compareBranch,
    baseBranch: params.pullRequest.baseBranch,
  })
}

export const resolveGitHubBranchContextMatch = (params: {
  state: AppState
  project: Project
  compareBranch?: string
  baseBranch?: string
}): PullRequestMatch => {
  const compareBranch = normalizeBranch(params.compareBranch)
  const baseBranch = normalizeBranch(params.baseBranch)
  if (!compareBranch) {
    return {}
  }

  const projectWorkspaces = listWorkspaces().filter((workspace) => workspace.projectId === params.project.id)
  const projectWorkspaceIds = new Set(projectWorkspaces.map((workspace) => workspace.id))
  const sessions = params.state.workspaceSessions
    .filter((session) => projectWorkspaceIds.has(session.workspaceId))
    .filter((session) => session.status !== 'archived')

  const exactSession = sessions.find((session) => (
    normalizeBranch(session.branchName) === compareBranch
    && (!baseBranch || !session.baseBranch || normalizeBranch(session.baseBranch) === baseBranch)
  )) ?? sessions.find((session) => normalizeBranch(session.branchName) === compareBranch)

  if (exactSession) {
    const task = resolveSessionTask(params.state, exactSession)
    return {
      matchedWorkspaceId: exactSession.workspaceId,
      matchedWorkspaceSessionId: exactSession.id,
      matchedTaskId: task?.id,
      matchedTaskTitle: task?.title,
    }
  }

  return {}
}

const bindingStatusRank = (binding: GitHubResourceBinding) => {
  if (binding.status === 'confirmed') return 3
  if (binding.status === 'suggested') return 2
  return 0
}

const bindingRoleRank = (binding: GitHubResourceBinding) => {
  if (binding.role === 'delivery') return 4
  if (binding.role === 'review') return 3
  if (binding.role === 'execution') return 2
  return 1
}

const comparePullRequestBindings = (
  left: GitHubResourceBinding,
  right: GitHubResourceBinding,
) => (
  bindingStatusRank(right) - bindingStatusRank(left)
  || bindingRoleRank(right) - bindingRoleRank(left)
  || right.updatedAt.localeCompare(left.updatedAt)
)

const hydratePullRequestsWithBindings = async (
  pullRequests: ProjectPullRequestReviewSummary[],
  state: AppState = loadState(),
) => {
  if (pullRequests.length === 0) {
    return pullRequests
  }

  const projectIds = [...new Set(pullRequests.map((pullRequest) => pullRequest.projectId))]
  const bindings = (await listGitHubResourceBindings({
    projectIds,
    resourceType: 'pull_request',
  }))
    .filter(isActiveGitHubResourceBinding)
  const bindingsByProjectResource = new Map<string, GitHubResourceBinding[]>()
  for (const binding of bindings) {
    const key = `${binding.projectId}\u0000${binding.resourceId}`
    const resourceBindings = bindingsByProjectResource.get(key) ?? []
    resourceBindings.push(binding)
    bindingsByProjectResource.set(key, resourceBindings)
  }

  return pullRequests.map((pullRequest) => {
    const unboundPullRequest = {
      ...pullRequest,
      matchedWorkspaceId: undefined,
      matchedWorkspaceSessionId: undefined,
      matchedTaskId: undefined,
      matchedTaskTitle: undefined,
    }
    const binding = bindingsByProjectResource.get(`${pullRequest.projectId}\u0000${pullRequest.id}`)
      ?.sort(comparePullRequestBindings)[0]
    if (!binding) {
      return unboundPullRequest
    }

    const task = binding.taskId
      ? state.tasks.find((item) => item.id === binding.taskId)
      : undefined
    return {
      ...unboundPullRequest,
      matchedWorkspaceId: binding.workspaceId,
      matchedWorkspaceSessionId: binding.workspaceSessionId,
      matchedTaskId: binding.taskId,
      matchedTaskTitle: task?.title ?? pullRequest.matchedTaskTitle,
    }
  })
}

export const persistSuggestedPullRequestBinding = async (params: {
  state: AppState
  project: Project
  pullRequest: ProjectPullRequestReviewSummary
  source?: Extract<GitHubResourceBindingSource, 'branch_match' | 'github_webhook'>
}) => {
  const match = resolvePullRequestMatch({
    state: params.state,
    project: params.project,
    pullRequest: params.pullRequest,
  })
  if (!match.matchedTaskId && !match.matchedWorkspaceId && !match.matchedWorkspaceSessionId) {
    return null
  }

  return upsertGitHubResourceBinding({
    resourceType: 'pull_request',
    resourceId: params.pullRequest.id,
    projectId: params.project.id,
    taskId: match.matchedTaskId,
    workspaceId: match.matchedWorkspaceId,
    workspaceSessionId: match.matchedWorkspaceSessionId,
    role: 'reference',
    status: 'suggested',
    source: params.source ?? 'branch_match',
    confidence: match.matchedWorkspaceSessionId ? 80 : 60,
  })
}

export const persistSuggestedWorkflowRunBinding = async (params: {
  state: AppState
  project: Project
  workflowRun: ProjectGitHubWorkflowRunSummary
  source?: Extract<GitHubResourceBindingSource, 'branch_match' | 'github_webhook'>
}) => {
  const match = resolveGitHubBranchContextMatch({
    state: params.state,
    project: params.project,
    compareBranch: params.workflowRun.headBranch,
  })
  if (!match.matchedTaskId && !match.matchedWorkspaceId && !match.matchedWorkspaceSessionId) {
    return null
  }

  const repo = parseGitRepoUrl(params.project.gitUrl)
  return upsertGitHubResourceBinding({
    resourceType: 'workflow_run',
    resourceId: params.workflowRun.resourceId ?? (repo
      ? buildGitHubRepositoryResourceId({
          repoHost: repo.host,
          repoOwner: repo.namespace,
          repoName: repo.repo,
          nativeId: params.workflowRun.id,
        })
      : params.workflowRun.id),
    projectId: params.project.id,
    taskId: match.matchedTaskId,
    workspaceId: match.matchedWorkspaceId,
    workspaceSessionId: match.matchedWorkspaceSessionId,
    role: 'execution',
    status: 'suggested',
    source: params.source ?? 'branch_match',
    confidence: match.matchedWorkspaceSessionId ? 80 : 60,
  })
}

export const registerProjectPullRequestContext = async (params: {
  project: Project
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
  userId?: string
  source: GitHubResourceBindingSource
  role?: GitHubResourceBindingRole
  pullRequest: {
    number?: number
    url?: string
    title?: string
    body?: string
    state?: ProjectPullRequestReviewSummary['state']
    merged?: boolean
    draft?: boolean
    baseBranch?: string
    compareBranch?: string
    updatedAt?: string
  }
}) => {
  const repo = parseGitRepoUrl(params.project.gitUrl)
  const number = Number(params.pullRequest.number)
  if (!repo || !Number.isFinite(number) || number <= 0) {
    return null
  }

  const id = buildProjectPullRequestId({
    provider: 'github',
    repoHost: repo.host,
    repoOwner: repo.namespace,
    repoName: repo.repo,
    number,
  })
  const existing = (await listProjectPullRequests(params.project.id))
    .find((pullRequest) => pullRequest.id === id)
  const syncedAt = new Date().toISOString()
  const state = params.pullRequest.state ?? existing?.state ?? 'unknown'
  const pullRequest: ProjectPullRequestReviewSummary = {
    id,
    provider: 'github',
    projectId: params.project.id,
    repoHost: repo.host,
    repoOwner: repo.namespace,
    repoName: repo.repo,
    repoFullName: `${repo.namespace}/${repo.repo}`,
    repoUrl: params.project.gitUrl,
    number,
    url: params.pullRequest.url ?? existing?.url,
    title: params.pullRequest.title?.trim() || existing?.title || `PR #${number}`,
    body: params.pullRequest.body ?? existing?.body ?? '',
    authorLogin: existing?.authorLogin,
    state,
    merged: params.pullRequest.merged ?? (state === 'merged' || existing?.merged === true),
    draft: params.pullRequest.draft ?? existing?.draft ?? false,
    baseBranch: params.pullRequest.baseBranch?.trim() || existing?.baseBranch || params.project.defaultBranch || 'main',
    compareBranch: params.pullRequest.compareBranch?.trim() || existing?.compareBranch || '',
    headOwner: existing?.headOwner,
    headRepo: existing?.headRepo,
    additions: existing?.additions ?? 0,
    deletions: existing?.deletions ?? 0,
    changedFiles: existing?.changedFiles ?? 0,
    files: existing?.files ?? [],
    syncedAt,
    createdAt: existing?.createdAt,
    updatedAt: params.pullRequest.updatedAt ?? existing?.updatedAt ?? syncedAt,
    mergedAt: state === 'merged' ? (existing?.mergedAt ?? syncedAt) : existing?.mergedAt,
    closedAt: state === 'closed' ? (existing?.closedAt ?? syncedAt) : existing?.closedAt,
  }
  const saved = (await upsertProjectPullRequests([pullRequest]))[0] ?? pullRequest
  await upsertGitHubResourceBinding({
    resourceType: 'pull_request',
    resourceId: saved.id,
    projectId: params.project.id,
    taskId: params.taskId,
    workspaceId: params.workspaceId,
    workspaceSessionId: params.workspaceSessionId,
    role: params.role ?? 'delivery',
    status: 'confirmed',
    source: params.source,
    confidence: 100,
    createdByUserId: params.userId,
  })

  return (await hydratePullRequestsWithBindings([saved]))[0] ?? saved
}

const toProjectPullRequest = (params: {
  project: Project
  repoHost: string
  repoOwner: string
  repoName: string
  repoFullName: string
  pullRequest: RepositoryPullRequestSnapshot
  syncedAt: string
}): ProjectPullRequestReviewSummary => {
  return {
    id: buildProjectPullRequestId({
      provider: 'github',
      repoHost: params.repoHost,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      number: params.pullRequest.number,
    }),
    provider: 'github',
    projectId: params.project.id,
    repoHost: params.repoHost,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    repoFullName: params.repoFullName,
    repoUrl: params.project.gitUrl,
    number: params.pullRequest.number,
    url: params.pullRequest.url,
    title: params.pullRequest.title,
    body: params.pullRequest.body,
    authorLogin: params.pullRequest.authorLogin,
    state: params.pullRequest.state,
    merged: params.pullRequest.merged,
    draft: params.pullRequest.draft,
    baseBranch: params.pullRequest.baseBranch,
    compareBranch: params.pullRequest.compareBranch,
    headOwner: params.pullRequest.headOwner,
    headRepo: params.pullRequest.headRepo,
    additions: params.pullRequest.additions,
    deletions: params.pullRequest.deletions,
    changedFiles: params.pullRequest.changedFiles,
    files: params.pullRequest.files,
    syncedAt: params.syncedAt,
    createdAt: params.pullRequest.createdAt,
    updatedAt: params.pullRequest.updatedAt,
    mergedAt: params.pullRequest.mergedAt,
    closedAt: params.pullRequest.closedAt,
  }
}

export const syncProjectPullRequests = async (params: {
  state: AppState
  userId: string
  project: Project
}): Promise<ProjectPullRequestSyncResult> => {
  if (params.project.versionControl !== 'git-remote' || !params.project.gitUrl.trim()) {
    return {
      ok: false,
      projectId: params.project.id,
      message: '当前项目不是远端 Git 仓库，暂时没有可同步的 PR。',
      pullRequestCount: 0,
      pullRequests: await listProjectPullRequests(params.project.id),
    }
  }

  const repo = parseGitRepoUrl(params.project.gitUrl)
  if (!repo) {
    return {
      ok: false,
      projectId: params.project.id,
      message: '当前项目仓库地址无法解析，暂时不能同步 PR。',
      pullRequestCount: 0,
      pullRequests: await listProjectPullRequests(params.project.id),
    }
  }

  const gitIdentity = await resolveUserProjectGitIdentity({
    userId: params.userId,
    projectId: params.project.id,
    mode: 'personal',
    repoUrl: params.project.gitUrl,
  }).catch(() => undefined)
  const synced = await listRepositoryPullRequests({
    repoUrl: params.project.gitUrl,
    gitIdentity,
  })
  if (!synced.ok) {
    return {
      ok: false,
      projectId: params.project.id,
      message: synced.message,
      pullRequestCount: 0,
      pullRequests: await listProjectPullRequests(params.project.id),
    }
  }

  const syncedAt = new Date().toISOString()
  const repoOwner = repo.namespace
  const repoName = repo.repo
  const pullRequests = synced.pullRequests.map((pullRequest) => toProjectPullRequest({
    project: params.project,
    repoHost: repo.host,
    repoOwner,
    repoName,
    repoFullName: `${repoOwner}/${repoName}`,
    pullRequest,
    syncedAt,
  }))
  const saved = await upsertProjectPullRequests(pullRequests)
  await Promise.all(saved.map((pullRequest) => persistSuggestedPullRequestBinding({
    state: params.state,
    project: params.project,
    pullRequest,
    source: 'branch_match',
  })))
  const hydrated = await hydratePullRequestsWithBindings(saved, params.state)

  return {
    ok: true,
    projectId: params.project.id,
    message: synced.message,
    syncedAt,
    pullRequestCount: hydrated.length,
    pullRequests: await listReviewPullRequests(params.project.id),
  }
}

export const syncReviewPullRequests = async (params: {
  state: AppState
  userId: string
  projects: Project[]
}): Promise<ProjectPullRequestBulkSyncResult> => {
  const remoteProjects = params.projects.filter((project) => (
    project.versionControl === 'git-remote'
    && Boolean(project.gitUrl.trim())
  ))
  if (remoteProjects.length === 0) {
    const pullRequests = await listReviewPullRequests()
    return {
      ok: false,
      message: '当前没有可同步 PR 的远端 Git 项目。',
      pullRequestCount: pullRequests.length,
      projectResults: [],
      pullRequests,
    }
  }

  const projectResults = []
  for (const project of remoteProjects) {
    const result = await syncProjectPullRequests({
      state: params.state,
      userId: params.userId,
      project,
    })
    projectResults.push({
      projectId: project.id,
      ok: result.ok,
      message: result.message,
      pullRequestCount: result.pullRequestCount,
    })
  }

  const projectIds = new Set(remoteProjects.map((project) => project.id))
  const pullRequests = (await listReviewPullRequests())
    .filter((pullRequest) => projectIds.has(pullRequest.projectId))
  const failedCount = projectResults.filter((result) => !result.ok).length
  const syncedAt = new Date().toISOString()

  return {
    ok: failedCount === 0,
    message: failedCount > 0
      ? `${failedCount} 个项目同步失败，其余 PR 已刷新。`
      : '所有项目 PR 已同步。',
    syncedAt,
    pullRequestCount: pullRequests.length,
    projectResults,
    pullRequests,
  }
}

export const listReviewPullRequests = async (options?: string | ProjectPullRequestListOptions) => {
  return hydratePullRequestsWithBindings(await listProjectPullRequests(options))
}

const resolveProjectGitIdentity = async (params: {
  userId: string
  project: Project
}) => resolveUserProjectGitIdentity({
  userId: params.userId,
  projectId: params.project.id,
  mode: 'personal',
  repoUrl: params.project.gitUrl,
}).catch(() => undefined)

export const listReviewPullRequestWorkflowRuns = async (params: {
  userId: string
  project: Project
  pullRequest: ProjectPullRequestReviewSummary
}): Promise<ProjectGitHubWorkflowRunsResponse> => {
  if (params.project.versionControl !== 'git-remote' || !params.project.gitUrl.trim()) {
    return {
      ok: false,
      message: '当前项目不是远端 Git 仓库，暂时不能读取 GitHub Actions。',
      runs: [],
    }
  }

  const result = await listRepositoryWorkflowRuns({
    repoUrl: params.project.gitUrl,
    gitIdentity: await resolveProjectGitIdentity({
      userId: params.userId,
      project: params.project,
    }),
    projectId: params.project.id,
    branch: params.pullRequest.compareBranch,
    pullRequestNumber: params.pullRequest.number,
  })

  return {
    ok: result.ok,
    message: result.message,
    runs: result.runs,
  }
}

export const getReviewWorkflowRunJobs = async (params: {
  userId: string
  project: Project
  runId: string
}): Promise<ProjectGitHubWorkflowRunJobsResponse> => {
  if (params.project.versionControl !== 'git-remote' || !params.project.gitUrl.trim()) {
    return {
      ok: false,
      message: '当前项目不是远端 Git 仓库，暂时不能读取 workflow jobs。',
      jobs: [],
    }
  }

  const result = await listRepositoryWorkflowJobs({
    repoUrl: params.project.gitUrl,
    gitIdentity: await resolveProjectGitIdentity({
      userId: params.userId,
      project: params.project,
    }),
    projectId: params.project.id,
    runId: params.runId,
  })

  return {
    ok: result.ok,
    message: result.message,
    jobs: result.jobs,
  }
}

export const getReviewWorkflowJobLogs = async (params: {
  userId: string
  project: Project
  runId: string
  jobId: string
}): Promise<ProjectGitHubWorkflowJobLogsResponse> => {
  if (params.project.versionControl !== 'git-remote' || !params.project.gitUrl.trim()) {
    return {
      ok: false,
      message: '当前项目不是远端 Git 仓库，暂时不能读取 workflow logs。',
      jobId: params.jobId,
      excerpt: '',
      lineCount: 0,
      truncated: false,
    }
  }

  const result = await getRepositoryWorkflowJobLogs({
    repoUrl: params.project.gitUrl,
    gitIdentity: await resolveProjectGitIdentity({
      userId: params.userId,
      project: params.project,
    }),
    runId: params.runId,
    jobId: params.jobId,
  })

  return {
    ok: result.ok,
    message: result.message,
    jobId: params.jobId,
    excerpt: result.excerpt,
    lineCount: result.lineCount,
    truncated: result.truncated,
  }
}

export const listReviewWorkflowRuns = async (params: {
  userId: string
  projects: Project[]
  projectFilterId?: string
  cursor?: string
  limit?: number
}): Promise<ProjectGitHubWorkflowRunsResponse> => {
  const targetResult = await listGitHubAppReviewRepositoryTargets({
    userId: params.userId,
    projects: params.projects,
    requiredPermission: 'actions',
    projectFilterId: params.projectFilterId,
    cursor: params.cursor,
    limit: params.limit,
  })

  if (targetResult.targets.length === 0) {
    return {
      ok: false,
      message: targetResult.failures[0] ?? '当前 GitHub App 没有可读取 Actions 的仓库。',
      hasMore: targetResult.hasMore,
      nextCursor: targetResult.nextCursor,
      projectResults: targetResult.failures.map((failure) => ({
        projectId: 'github-app',
        projectName: 'GitHub App',
        ok: false,
        message: failure,
        runCount: 0,
      })),
      runs: [],
    }
  }

  const runs: ProjectGitHubWorkflowRunsResponse['runs'] = []
  const failures = [...targetResult.failures]
  const projectResults: NonNullable<ProjectGitHubWorkflowRunsResponse['projectResults']> = []
  const workflowRunResults = await Promise.all(targetResult.targets.map(async (target) => {
    const result = await listRepositoryWorkflowRuns({
      repoUrl: target.repo.cloneUrl,
      gitIdentity: target.gitIdentity,
      projectId: target.projectId,
      perPage: 20,
      maxPages: 1,
    })

    return { target, result }
  }))

  for (const { target, result } of workflowRunResults) {
    if (result.ok) {
      const repo = parseGitRepoUrl(target.repo.cloneUrl)
      const savedRuns = repo
        ? await upsertProjectWorkflowRuns(result.runs.map((run) => ({
            ...run,
            provider: 'github',
            repoHost: repo.host,
            repoOwner: repo.namespace,
            repoName: repo.repo,
            repoUrl: target.repo.cloneUrl,
          })))
        : result.runs
      const project = params.projects.find((item) => item.id === target.projectId)
      if (project) {
        const state = loadState()
        await Promise.all(savedRuns.map((workflowRun) => persistSuggestedWorkflowRunBinding({
          state,
          project,
          workflowRun,
          source: 'branch_match',
        })))
      }
      runs.push(...savedRuns)
    } else {
      failures.push(`${target.projectName}: ${result.message}`)
    }
    projectResults.push({
      projectId: target.projectId,
      projectName: target.projectName,
      ok: result.ok,
      message: result.message,
      runCount: result.runs.length,
    })
  }

  for (const failure of targetResult.failures) {
    projectResults.push({
      projectId: 'github-app',
      projectName: 'GitHub App',
      ok: false,
      message: failure,
      runCount: 0,
    })
  }

  runs.sort((left, right) => (
    new Date(right.updatedAt || right.runStartedAt || right.createdAt || 0).getTime()
    - new Date(left.updatedAt || left.runStartedAt || left.createdAt || 0).getTime()
  ))

  return {
    ok: failures.length === 0,
    message: failures.length > 0
      ? `${failures.length} 个项目 Actions 读取失败，其余 Actions 已刷新。`
      : 'GitHub Actions 已刷新。',
    hasMore: targetResult.hasMore,
    nextCursor: targetResult.nextCursor,
    projectResults,
    runs,
  }
}

export const listReviewIssues = async (params: {
  userId: string
  projects: Project[]
  state?: ProjectIssueSummary['state'] | 'all'
  projectFilterId?: string
  cursor?: string
  limit?: number
}): Promise<ProjectIssuesResponse> => {
  const targetResult = await listGitHubAppReviewRepositoryTargets({
    userId: params.userId,
    projects: params.projects,
    requiredPermission: 'issues',
    projectFilterId: params.projectFilterId,
    cursor: params.cursor,
    limit: params.limit,
  })

  if (targetResult.targets.length === 0) {
    return {
      ok: false,
      message: targetResult.failures[0] ?? '当前 GitHub App 没有可读取 Issues 的仓库。',
      hasMore: targetResult.hasMore,
      nextCursor: targetResult.nextCursor,
      issues: [],
    }
  }

  const issues: ProjectIssueSummary[] = []
  const projectResults: NonNullable<ProjectIssuesResponse['projectResults']> = []
  for (const target of targetResult.targets) {
    const result = await listRepositoryIssues({
      repoUrl: target.repo.cloneUrl,
      gitIdentity: target.gitIdentity,
      projectId: target.projectId,
      state: params.state,
      perPage: 30,
      maxPages: 1,
    })

    if (result.ok) {
      const repo = parseGitRepoUrl(target.repo.cloneUrl)
      const savedIssues = repo
        ? await upsertProjectIssues(result.issues.map((issue) => ({
            ...issue,
            id: buildGitHubRepositoryResourceId({
              repoHost: repo.host,
              repoOwner: repo.namespace,
              repoName: repo.repo,
              nativeId: issue.number,
            }),
            provider: 'github',
            repoHost: repo.host,
            repoOwner: repo.namespace,
            repoName: repo.repo,
            repoUrl: target.repo.cloneUrl,
          })))
        : result.issues
      issues.push(...savedIssues)
    }
    projectResults.push({
      projectId: target.projectId,
      projectName: target.projectName,
      ok: result.ok,
      message: result.message,
      issueCount: result.issues.length,
    })
  }

  for (const failure of targetResult.failures) {
    projectResults.push({
      projectId: 'github-app',
      projectName: 'GitHub App',
      ok: false,
      message: failure,
      issueCount: 0,
    })
  }

  issues.sort((left, right) => (
    new Date(right.updatedAt || right.createdAt || 0).getTime()
    - new Date(left.updatedAt || left.createdAt || 0).getTime()
  ))

  const failedCount = projectResults.filter((result) => !result.ok).length
  return {
    ok: failedCount === 0,
    message: failedCount > 0
      ? `${failedCount} 个项目 Issues 读取失败，其余 Issues 已刷新。`
      : 'GitHub Issues 已刷新。',
    hasMore: targetResult.hasMore,
    nextCursor: targetResult.nextCursor,
    projectResults,
    issues,
  }
}
