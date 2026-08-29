// [INPUT]: Hono app，GitHub Webhook 事件（签名校验）
// [OUTPUT]: POST /api/github/webhooks 入站路由
// [POS]: GitHub Webhook 入站协议层（PR/Issue/Workflow Run 同步）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Hono } from 'hono'
import type {
  ProjectGitHubWorkflowRunConclusion,
  ProjectGitHubWorkflowRunStatus,
  ProjectIssueLabelSummary,
  ProjectIssueSummary,
  ProjectPullRequestReviewSummary,
} from '@shared/types'
import { buildGitHubRepositoryResourceId } from '@shared/types'
import { loadState } from '../storage/app-state-store'
import { upsertProjectPullRequests } from '../storage/postgres/project-pull-request-store'
import {
  type ProjectIssueUpsertInput,
  upsertProjectIssues,
} from '../storage/postgres/project-issue-store'
import {
  type ProjectWorkflowRunUpsertInput,
  upsertProjectWorkflowRuns,
} from '../storage/postgres/project-workflow-run-store'
import {
  persistSuggestedPullRequestBinding,
  persistSuggestedWorkflowRunBinding,
} from '../services/project-pull-request-review-service'
import { parseGitRepoUrl } from '../services/github-pull-request-service'

// ─── Signature verification ──────────────────────────────────────────

const verifyGitHubWebhookSignature = (rawBody: string, signatureHeader: string | null): boolean => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return false
  }

  const candidate = signatureHeader?.replace(/^sha256=/, '')?.trim() || ''
  if (!candidate) {
    return false
  }

  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'))
  } catch {
    return false
  }
}

// ─── Normalizers ─────────────────────────────────────────────────────

const normalizePrState = (state?: string, merged?: boolean): ProjectPullRequestReviewSummary['state'] => {
  if (merged) return 'merged'
  if (state === 'open') return 'open'
  if (state === 'closed') return 'closed'
  return 'unknown'
}

const normalizeIssueState = (state?: string): ProjectIssueSummary['state'] => (
  state?.trim().toLowerCase() === 'closed' ? 'closed' : 'open'
)

const normalizeIssueLabels = (labels?: Array<{ name?: string; color?: string } | string>): ProjectIssueLabelSummary[] => {
  if (!Array.isArray(labels)) return []
  return labels.map((label) => {
    if (typeof label === 'string') return { name: label }
    const name = label.name?.trim()
    if (!name) return null
    return { name, color: label.color?.trim() || undefined }
  }).filter((label): label is ProjectIssueLabelSummary => Boolean(label))
}

const normalizeWorkflowStatus = (value?: string | null): ProjectGitHubWorkflowRunStatus => {
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

const normalizeWorkflowConclusion = (value?: string | null): ProjectGitHubWorkflowRunConclusion | undefined => {
  if (!value) return undefined
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

// ─── Project matching ────────────────────────────────────────────────

const findMatchingProjects = (repoUrl: string) => {
  const repo = parseGitRepoUrl(repoUrl)
  if (!repo) return []

  const state = loadState()
  return state.projects.filter((project) => {
    if (project.versionControl !== 'git-remote' || !project.gitUrl.trim()) return false
    const projectRepo = parseGitRepoUrl(project.gitUrl)
    if (!projectRepo) return false
    return (
      projectRepo.host === repo.host
      && projectRepo.namespace.toLowerCase() === repo.namespace.toLowerCase()
      && projectRepo.repo.toLowerCase() === repo.repo.toLowerCase()
    )
  })
}

// ─── Event handlers ──────────────────────────────────────────────────

const handlePullRequestEvent = async (payload: Record<string, unknown>) => {
  const pr = payload.pull_request as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  if (!pr || !repo) return

  const cloneUrl = (repo.clone_url as string) || (repo.html_url as string) || ''
  const repoRef = parseGitRepoUrl(cloneUrl)
  if (!repoRef) return

  const repoFullName = (repo.full_name as string) || `${repoRef.namespace}/${repoRef.repo}`
  const repoUrl = cloneUrl
  const projects = findMatchingProjects(cloneUrl)
  if (projects.length === 0) return

  const number = pr.number as number
  const state = pr.state as string
  const merged = pr.merged as boolean
  const head = pr.head as Record<string, unknown> | undefined
  const base = pr.base as Record<string, unknown> | undefined

  const snapshot = {
    number,
    url: (pr.html_url as string) || undefined,
    state: normalizePrState(state, merged),
    title: (pr.title as string) || `PR #${number}`,
    body: (pr.body as string) || '',
    authorLogin: (pr.user as Record<string, unknown>)?.login as string | undefined,
    baseBranch: (base?.ref as string) || '',
    compareBranch: (head?.ref as string) || '',
    headOwner: (head?.user as Record<string, unknown>)?.login as string | undefined,
    headRepo: (head?.repo as Record<string, unknown>)?.full_name as string | undefined,
    merged,
    draft: pr.draft as boolean ?? false,
    additions: pr.additions as number ?? 0,
    deletions: pr.deletions as number ?? 0,
    changedFiles: pr.changed_files as number ?? 0,
    files: [],
    createdAt: (pr.created_at as string) || undefined,
    updatedAt: (pr.updated_at as string) || undefined,
    mergedAt: (pr.merged_at as string) || undefined,
    closedAt: (pr.closed_at as string) || undefined,
  }

  const stateObj = loadState()
  const syncedAt = new Date().toISOString()

  const pullRequests: ProjectPullRequestReviewSummary[] = projects.map((project) => {
    return {
      id: buildGitHubRepositoryResourceId({
        repoHost: repoRef.host,
        repoOwner: repoRef.namespace,
        repoName: repoRef.repo,
        nativeId: number,
      }),
      provider: 'github',
      projectId: project.id,
      repoHost: repoRef.host,
      repoOwner: repoRef.namespace,
      repoName: repoRef.repo,
      repoFullName,
      repoUrl,
      number,
      url: snapshot.url,
      title: snapshot.title,
      body: snapshot.body,
      authorLogin: snapshot.authorLogin,
      state: snapshot.state,
      merged: snapshot.merged,
      draft: snapshot.draft,
      baseBranch: snapshot.baseBranch,
      compareBranch: snapshot.compareBranch,
      headOwner: snapshot.headOwner,
      headRepo: snapshot.headRepo,
      additions: snapshot.additions,
      deletions: snapshot.deletions,
      changedFiles: snapshot.changedFiles,
      files: [],
      syncedAt,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      mergedAt: snapshot.mergedAt,
      closedAt: snapshot.closedAt,
    }
  })

  const saved = await upsertProjectPullRequests(pullRequests)
  await Promise.all(saved.map((pullRequest) => {
    const project = projects.find((item) => item.id === pullRequest.projectId)
    return project
      ? persistSuggestedPullRequestBinding({
          state: stateObj,
          project,
          pullRequest,
          source: 'github_webhook',
        })
      : null
  }))
}

const handleIssueEvent = async (payload: Record<string, unknown>) => {
  const issue = payload.issue as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  if (!issue || !repo) return

  // Skip pull requests (GitHub sends PRs as issues too)
  if (issue.pull_request) return

  const cloneUrl = (repo.clone_url as string) || (repo.html_url as string) || ''
  const repoRef = parseGitRepoUrl(cloneUrl)
  if (!repoRef) return

  const repoFullName = (repo.full_name as string) || `${repoRef.namespace}/${repoRef.repo}`
  const repoUrl = cloneUrl
  const projects = findMatchingProjects(cloneUrl)
  if (projects.length === 0) return

  const number = issue.number as number
  const now = new Date().toISOString()

  const issues: ProjectIssueUpsertInput[] = projects.map((project) => ({
    id: buildGitHubRepositoryResourceId({
      repoHost: repoRef.host,
      repoOwner: repoRef.namespace,
      repoName: repoRef.repo,
      nativeId: number,
    }),
    provider: 'github',
    projectId: project.id,
    repoHost: repoRef.host,
    repoOwner: repoRef.namespace,
    repoName: repoRef.repo,
    repoFullName,
    repoUrl,
    number,
    title: (issue.title as string) || `Issue #${number}`,
    body: (issue.body as string) || '',
    state: normalizeIssueState(issue.state as string),
    url: (issue.html_url as string) || undefined,
    authorLogin: (issue.user as Record<string, unknown>)?.login as string | undefined,
    labels: normalizeIssueLabels(issue.labels as Array<{ name?: string; color?: string } | string> | undefined),
    assigneeLogins: ((issue.assignees as Array<{ login?: string }> | undefined) ?? [])
      .map((a) => a.login?.trim())
      .filter((login): login is string => Boolean(login)),
    comments: (issue.comments as number) ?? 0,
    createdAt: (issue.created_at as string) || undefined,
    updatedAt: (issue.updated_at as string) || undefined,
    closedAt: (issue.closed_at as string) || undefined,
  }))

  await upsertProjectIssues(issues)
}

const handleWorkflowRunEvent = async (payload: Record<string, unknown>) => {
  const run = payload.workflow_run as Record<string, unknown> | undefined
  const repo = payload.repository as Record<string, unknown> | undefined
  if (!run || !repo) return

  const cloneUrl = (repo.clone_url as string) || (repo.html_url as string) || ''
  const repoRef = parseGitRepoUrl(cloneUrl)
  if (!repoRef) return

  const repoFullName = (repo.full_name as string) || `${repoRef.namespace}/${repoRef.repo}`
  const repoUrl = cloneUrl
  const projects = findMatchingProjects(cloneUrl)
  if (projects.length === 0) return

  const runId = run.id as number
  if (!Number.isFinite(runId)) return

  const name = (run.name as string) || 'Workflow'
  const runs: ProjectWorkflowRunUpsertInput[] = projects.map((project) => ({
    id: String(runId),
    provider: 'github',
    projectId: project.id,
    repoHost: repoRef.host,
    repoOwner: repoRef.namespace,
    repoName: repoRef.repo,
    repoFullName,
    repoUrl,
    name,
    displayTitle: (run.display_title as string) || name,
    runNumber: (run.run_number as number) ?? 0,
    runAttempt: (run.run_attempt as number) ?? 1,
    status: normalizeWorkflowStatus(run.status as string),
    conclusion: normalizeWorkflowConclusion(run.conclusion as string | undefined),
    event: (run.event as string) || 'unknown',
    headBranch: (run.head_branch as string) || '',
    headSha: (run.head_sha as string) || '',
    url: (run.html_url as string) || undefined,
    createdAt: (run.created_at as string) || undefined,
    updatedAt: (run.updated_at as string) || undefined,
    runStartedAt: (run.run_started_at as string) || undefined,
  }))

  const saved = await upsertProjectWorkflowRuns(runs)
  const state = loadState()
  await Promise.all(saved.map((workflowRun) => {
    const project = projects.find((item) => item.id === workflowRun.projectId)
    return project
      ? persistSuggestedWorkflowRunBinding({
          state,
          project,
          workflowRun,
          source: 'github_webhook',
        })
      : null
  }))
}

// ─── Route registration ──────────────────────────────────────────────

export const registerGitHubWebhookRoutes = (app: Hono) => {
  app.post('/api/github/webhooks', async (c) => {
    const rawBody = await c.req.text()
    const signature = c.req.header('X-Hub-Signature-256') ?? null
    const event = c.req.header('X-GitHub-Event')?.trim() || ''

    if (!verifyGitHubWebhookSignature(rawBody, signature)) {
      return c.json({ ok: false, message: 'Webhook 签名验证失败。' }, 401)
    }

    if (event === 'ping') {
      return c.json({ ok: true, message: 'pong' })
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return c.json({ ok: false, message: 'Webhook payload 格式不正确。' }, 400)
    }

    try {
      switch (event) {
        case 'pull_request':
          await handlePullRequestEvent(payload)
          break
        case 'issues':
          await handleIssueEvent(payload)
          break
        case 'workflow_run':
          await handleWorkflowRunEvent(payload)
          break
        default:
          return c.json({ ok: true, skipped: true, event })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理 Webhook 事件失败。'
      console.error(`[GitHub Webhook] Error handling ${event}:`, message)
      return c.json({ ok: false, message }, 500)
    }

    return c.json({ ok: true, event })
  })
}
