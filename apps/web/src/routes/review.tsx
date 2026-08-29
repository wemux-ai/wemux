// [INPUT]: 评审请求
// [OUTPUT]: 评审页
// [POS]: 评审页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Code2, Eye, FileText, GitBranch, GitMerge, GitPullRequest, Loader2, MessageSquare, MoreHorizontal, PlayCircle, RefreshCw, Search, SquareArrowOutUpRight, WandSparkles, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import type { ProjectGitHubWorkflowRunSummary, ProjectIssuesResponse, ProjectIssueSummary, ProjectPullRequestFileSummary, ProjectPullRequestReviewSummary } from '@shared/types'
import { GitHubAppConnectionLoadingState, GitHubAppConnectionOverlay, useGitHubAppConnectionStatus } from '../components/github/github-app-connection-state'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { useApp } from '../lib/app-provider'
import { api } from '../lib/api'
import { useTranslation } from '../lib/i18n/react'
import { isReviewCenterEnabled } from '../lib/runtime-config'
import { cn } from '../lib/utils'

type ReviewSearch = {
  projectId?: string
  pullRequestId?: string
  issueId?: string
  mode?: ReviewMode
}

type ReviewMode = 'pull-requests' | 'issues'
type ReviewStateFilter = 'all' | ProjectPullRequestReviewSummary['state']
type IssueStateFilter = 'open' | 'closed' | 'all'
type PullRequestDescriptionMode = 'preview' | 'markdown'

type ParsedDiffLine = {
  content: string
  oldLine?: number
  newLine?: number
}

const REVIEW_MOBILE_MEDIA_QUERY = '(max-width: 767px)'
const REVIEW_PULL_REQUEST_PAGE_SIZE = 30
const REVIEW_GITHUB_REPOSITORY_PAGE_SIZE = 5

export const Route = createFileRoute('/review' as never)({
  validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
    pullRequestId: typeof search.pullRequestId === 'string' ? search.pullRequestId : undefined,
    issueId: typeof search.issueId === 'string' ? search.issueId : undefined,
    mode: search.mode === 'issues' || search.mode === 'pull-requests' ? search.mode : undefined,
  }),
  component: ReviewRoute,
})

const stateMeta: Record<ProjectPullRequestReviewSummary['state'], {
  label: string
  className: string
  icon: typeof GitPullRequest
}> = {
  open: {
    label: 'Open',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    icon: GitPullRequest,
  },
  merged: {
    label: 'Merged',
    className: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
    icon: GitMerge,
  },
  closed: {
    label: 'Closed',
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
    icon: GitPullRequest,
  },
  unknown: {
    label: 'Recorded',
    className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
    icon: GitPullRequest,
  },
}

const formatRelativeDate = (value?: string) => {
  if (!value) {
    return ''
  }

  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) {
    return ''
  }

  const diffMs = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < hour) {
    return `${Math.max(1, Math.round(diffMs / minute))}m`
  }
  if (diffMs < day) {
    return `${Math.round(diffMs / hour)}h`
  }
  return `${Math.round(diffMs / day)}d`
}

const groupPullRequests = (pullRequests: ProjectPullRequestReviewSummary[]) => {
  const waiting = pullRequests.filter((item) => item.state === 'open' && !item.merged)
  const merged = pullRequests.filter((item) => item.state === 'merged' || item.merged)
  const closed = pullRequests.filter((item) => item.state === 'closed')
  const recorded = pullRequests.filter((item) => item.state === 'unknown')
  return [
    { id: 'waiting', label: 'Waiting for review', items: waiting },
    { id: 'merged', label: 'Merging and recently merged', items: merged },
    { id: 'closed', label: 'Closed', items: closed },
    { id: 'recorded', label: 'Recorded', items: recorded },
  ].filter((group) => group.items.length > 0)
}

const formatPullRequestBody = (value: string) => {
  return value.replace(/\\n/g, '\n').trim()
}

const getPullRequestFileKey = (file: ProjectPullRequestFileSummary) => `${file.path}:${file.previousPath ?? ''}`

const mergePullRequests = (
  current: ProjectPullRequestReviewSummary[],
  next: ProjectPullRequestReviewSummary[],
) => {
  const seen = new Set<string>()
  return [...current, ...next].filter((pullRequest) => {
    if (seen.has(pullRequest.id)) {
      return false
    }

    seen.add(pullRequest.id)
    return true
  })
}

const mergeIssues = (
  current: ProjectIssueSummary[],
  next: ProjectIssueSummary[],
) => {
  const seen = new Set<string>()
  return [...current, ...next].filter((issue) => {
    if (seen.has(issue.id)) {
      return false
    }

    seen.add(issue.id)
    return true
  })
}

const parsePatchLines = (patch: string): ParsedDiffLine[] => {
  let oldLine = 0
  let newLine = 0

  return patch.split('\n').map((content) => {
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(content)
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[2], 10)
      return { content }
    }

    if (content.startsWith('\\')) {
      return { content }
    }

    if (content.startsWith('+')) {
      const currentNewLine = newLine
      newLine += 1
      return { content, newLine: currentNewLine || undefined }
    }

    if (content.startsWith('-')) {
      const currentOldLine = oldLine
      oldLine += 1
      return { content, oldLine: currentOldLine || undefined }
    }

    const currentOldLine = oldLine
    const currentNewLine = newLine
    if (oldLine > 0) {
      oldLine += 1
    }
    if (newLine > 0) {
      newLine += 1
    }
    return {
      content,
      oldLine: currentOldLine || undefined,
      newLine: currentNewLine || undefined,
    }
  })
}

const countPullRequestStates = (pullRequests: ProjectPullRequestReviewSummary[]) => ({
  all: pullRequests.length,
  open: pullRequests.filter((item) => item.state === 'open' && !item.merged).length,
  merged: pullRequests.filter((item) => item.state === 'merged' || item.merged).length,
  closed: pullRequests.filter((item) => item.state === 'closed').length,
  unknown: pullRequests.filter((item) => item.state === 'unknown').length,
})

const countIssueStates = (issues: ProjectIssueSummary[]) => ({
  all: issues.length,
  open: issues.filter((item) => item.state === 'open').length,
  closed: issues.filter((item) => item.state === 'closed').length,
})

const workflowRunStatusClassName = (run: ProjectGitHubWorkflowRunSummary) => {
  if (run.status !== 'completed') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
  }

  if (run.conclusion === 'success') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  }

  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure') {
    return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  }

  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') {
    return 'border-zinc-700 bg-zinc-900 text-zinc-300'
  }

  return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

const workflowRunLabel = (run: ProjectGitHubWorkflowRunSummary) => (
  run.status === 'completed' ? (run.conclusion || 'completed') : run.status
).replace(/_/g, ' ')

const workflowRunIcon = (run: ProjectGitHubWorkflowRunSummary) => {
  if (run.status !== 'completed') {
    return PlayCircle
  }
  if (run.conclusion === 'success') {
    return CheckCircle2
  }
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure') {
    return XCircle
  }
  return CircleDot
}

const issueStateClassName = (issue: ProjectIssueSummary) => (
  issue.state === 'open'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-zinc-700 bg-zinc-900 text-zinc-300'
)

function PullRequestStateBadge({ pullRequest }: { pullRequest: ProjectPullRequestReviewSummary }) {
  const meta = stateMeta[pullRequest.state] ?? stateMeta.unknown
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', meta.className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

function PullRequestMarkdown({ content }: { content: string }) {
  return (
    <div className="review-markdown max-w-none break-words text-sm leading-6 text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-4 text-lg font-semibold text-zinc-100 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2.5 mt-4 text-base font-semibold text-zinc-100 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold text-zinc-100 first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-2 leading-6">{children}</p>,
          ul: ({ children }) => <ul className="my-2 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-200">
              {children}
            </a>
          ),
          input: ({ checked, type }) => (
            <input
              type={type}
              checked={checked}
              readOnly
              className="mr-1.5 align-middle accent-emerald-400"
            />
          ),
          img: ({ src, alt }) => (
            <img
              src={src || ''}
              alt={alt || ''}
              className="my-3 max-h-96 max-w-full rounded-md border border-zinc-800 object-contain"
            />
          ),
          hr: () => <hr className="my-4 border-zinc-800" />,
          code: ({ children, className }) => {
            const inline = !className
            return inline ? (
              <code className="rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 font-mono text-[0.9em] text-zinc-200">
                {children}
              </code>
            ) : (
              <code className={cn('font-mono text-xs', className)}>{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-300">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-zinc-700 pl-3 text-zinc-400">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-auto rounded-md border border-zinc-800">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-zinc-800 bg-zinc-950 px-2 py-1.5 text-left font-medium text-zinc-200">{children}</th>,
          td: ({ children }) => <td className="border-b border-zinc-900 px-2 py-1.5 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

const diffLineClassName = (line: string) => {
  if (line.startsWith('@@')) {
    return 'border-sky-500/10 bg-sky-500/10 text-sky-200'
  }
  if (line.startsWith('+')) {
    return 'border-emerald-500/10 bg-emerald-500/10 text-emerald-200'
  }
  if (line.startsWith('-')) {
    return 'border-rose-500/10 bg-rose-500/10 text-rose-200'
  }
  return 'border-transparent text-zinc-400'
}

function FilePatchView({ patch }: { patch: string }) {
  const lines = parsePatchLines(patch)
  return (
    <pre className="scrollbar-subtle max-h-[32rem] overflow-auto border-t border-zinc-900 bg-[#050506] py-2 text-[11px] leading-5">
      <div className="min-w-max">
        {lines.map((line, index) => (
          <div
            key={`${index}:${line.content}`}
            className={cn('grid grid-cols-[3.25rem_3.25rem_minmax(30rem,1fr)] border-l-2 px-2 font-mono', diffLineClassName(line.content))}
          >
            <span className="select-none pr-2 text-right text-zinc-700">{line.oldLine ?? ''}</span>
            <span className="select-none pr-3 text-right text-zinc-700">{line.newLine ?? ''}</span>
            <code className="min-w-0 whitespace-pre">{line.content || ' '}</code>
          </div>
        ))}
      </div>
    </pre>
  )
}

function useReviewIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia(REVIEW_MOBILE_MEDIA_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia(REVIEW_MOBILE_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}

function ReviewRoute() {
  if (!isReviewCenterEnabled()) {
    return <Navigate to="/dashboard" replace />
  }

  return <ReviewRouteGuard />
}

function ReviewRouteGuard() {
  const githubAppConnection = useGitHubAppConnectionStatus()

  if (githubAppConnection.loading) {
    return <GitHubAppConnectionLoadingState />
  }

  return <ReviewRouteEnabled githubAppConnection={githubAppConnection} />
}

function ReviewRouteEnabled({
  githubAppConnection,
}: {
  githubAppConnection: ReturnType<typeof useGitHubAppConnectionStatus>
}) {
  const { language } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useReviewIsMobile()
  const search = Route.useSearch() as ReviewSearch
  const { state, setState } = useApp()
  const [reviewMode, setReviewMode] = useState<ReviewMode>(search.mode ?? (search.issueId ? 'issues' : 'pull-requests'))
  const [pullRequests, setPullRequests] = useState<ProjectPullRequestReviewSummary[]>([])
  const [issues, setIssues] = useState<ProjectIssueSummary[]>([])
  const [issueProjectResults, setIssueProjectResults] = useState<ProjectIssuesResponse['projectResults']>([])
  const [loading, setLoading] = useState(true)
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [pullRequestNextCursor, setPullRequestNextCursor] = useState<string | undefined>()
  const [pullRequestHasMore, setPullRequestHasMore] = useState(false)
  const [pullRequestsLoadingMore, setPullRequestsLoadingMore] = useState(false)
  const [issueNextCursor, setIssueNextCursor] = useState<string | undefined>()
  const [issueHasMore, setIssueHasMore] = useState(false)
  const [issuesLoadingMore, setIssuesLoadingMore] = useState(false)
  const [syncingProjectId, setSyncingProjectId] = useState('')
  const [startingWorkflowPullRequestId, setStartingWorkflowPullRequestId] = useState('')
  const [query, setQuery] = useState('')
  const [selectedProjectId, setSelectedProjectIdState] = useState(search.projectId || '')
  const [stateFilter, setStateFilter] = useState<ReviewStateFilter>('all')
  const [issueStateFilter, setIssueStateFilter] = useState<IssueStateFilter>('open')
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  const visibleProjects = state.projects.filter((project) => project.versionControl !== 'none')
  const visibleProjectNameById = useMemo(
    () => new Map(visibleProjects.map((project) => [project.id, project.name] as const)),
    [visibleProjects],
  )
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId) ?? null

  const loadPullRequests = async (projectId = selectedProjectId, options?: { cursor?: string; append?: boolean }) => {
    if (options?.append) {
      setPullRequestsLoadingMore(true)
    } else {
      setLoading(true)
      setPullRequestNextCursor(undefined)
      setPullRequestHasMore(false)
    }
    try {
      const response = await api.listReviewPullRequests({
        projectId: projectId || undefined,
        cursor: options?.cursor,
        limit: REVIEW_PULL_REQUEST_PAGE_SIZE,
      })
      setPullRequests((current) => (
        options?.append ? mergePullRequests(current, response.pullRequests) : response.pullRequests
      ))
      setPullRequestNextCursor(response.nextCursor)
      setPullRequestHasMore(Boolean(response.hasMore))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === 'zh' ? '加载 PR 失败' : 'Failed to load pull requests')
    } finally {
      if (options?.append) {
        setPullRequestsLoadingMore(false)
      } else {
        setLoading(false)
      }
    }
  }

  const loadIssues = async (projectId = selectedProjectId, options?: { cursor?: string; append?: boolean; refresh?: boolean }) => {
    if (options?.append) {
      setIssuesLoadingMore(true)
    } else {
      setIssuesLoading(true)
      setIssueNextCursor(undefined)
      setIssueHasMore(false)
    }
    try {
      const response = await api.listReviewIssues({
        projectId: projectId || undefined,
        state: 'all',
        cursor: options?.cursor,
        limit: REVIEW_GITHUB_REPOSITORY_PAGE_SIZE,
        refresh: options?.refresh,
      })
      setIssues((current) => (
        options?.append ? mergeIssues(current, response.issues) : response.issues
      ))
      setIssueProjectResults((current) => (
        options?.append ? [...(current ?? []), ...(response.projectResults ?? [])] : (response.projectResults ?? [])
      ))
      setIssueNextCursor(response.nextCursor)
      setIssueHasMore(Boolean(response.hasMore))
      if (!response.ok) {
        toast.warning(response.message)
      }
    } catch (error) {
      setIssueProjectResults([])
      toast.error(error instanceof Error ? error.message : language === 'zh' ? '加载 Issues 失败' : 'Failed to load issues')
    } finally {
      if (options?.append) {
        setIssuesLoadingMore(false)
      } else {
        setIssuesLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!githubAppConnection.connected) {
      setPullRequests([])
      setPullRequestNextCursor(undefined)
      setPullRequestHasMore(false)
      setLoading(false)
      return
    }

    void loadPullRequests(selectedProjectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubAppConnection.connected, selectedProjectId])

  useEffect(() => {
    if (!githubAppConnection.connected) {
      setIssues([])
      setIssueProjectResults([])
      setIssueNextCursor(undefined)
      setIssueHasMore(false)
      setIssuesLoading(false)
      return
    }

    if (reviewMode !== 'issues') {
      return
    }

    void loadIssues(selectedProjectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubAppConnection.connected, reviewMode, selectedProjectId])

  useEffect(() => {
    const nextMode = search.mode ?? (search.issueId ? 'issues' : 'pull-requests')
    if (nextMode !== reviewMode) {
      setReviewMode(nextMode)
      setMobileView('list')
    }
  }, [reviewMode, search.issueId, search.mode])

  useEffect(() => {
    if (isMobile && (search.pullRequestId || search.issueId)) {
      setMobileView('detail')
    }
  }, [isMobile, search.pullRequestId, search.issueId])

  const searchedPullRequests = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return pullRequests
    }

    return pullRequests.filter((pullRequest) => [
      pullRequest.title,
      pullRequest.repoFullName,
      pullRequest.compareBranch,
      pullRequest.baseBranch,
      pullRequest.authorLogin,
      String(pullRequest.number),
    ].some((value) => value?.toLowerCase().includes(normalizedQuery)))
  }, [pullRequests, query])
  const stateCounts = useMemo(() => countPullRequestStates(searchedPullRequests), [searchedPullRequests])
  const filteredPullRequests = useMemo(() => {
    if (stateFilter === 'all') {
      return searchedPullRequests
    }

    return searchedPullRequests.filter((pullRequest) => (
      stateFilter === 'merged'
        ? pullRequest.state === 'merged' || pullRequest.merged
        : pullRequest.state === stateFilter && (stateFilter !== 'open' || !pullRequest.merged)
    ))
  }, [searchedPullRequests, stateFilter])

  const selectedPullRequest = filteredPullRequests.find((item) => item.id === search.pullRequestId)
    ?? filteredPullRequests[0]
    ?? null
  const groupedPullRequests = groupPullRequests(filteredPullRequests)
  const searchedIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return issues
    }

    return issues.filter((issue) => [
      issue.title,
      issue.body,
      issue.repoFullName,
      issue.authorLogin,
      String(issue.number),
      issue.labels.map((label) => label.name).join(' '),
    ].some((value) => value?.toLowerCase().includes(normalizedQuery)))
  }, [issues, query])
  const issueCounts = useMemo(() => countIssueStates(searchedIssues), [searchedIssues])
  const filteredIssues = useMemo(() => {
    if (issueStateFilter === 'all') {
      return searchedIssues
    }

    return searchedIssues.filter((issue) => issue.state === issueStateFilter)
  }, [searchedIssues, issueStateFilter])
  const selectedIssue = filteredIssues.find((item) => item.id === search.issueId)
    ?? filteredIssues[0]
    ?? null

  const setSelectedProjectId = (projectId: string) => {
    setSelectedProjectIdState(projectId)
    setMobileView('list')
    setStateFilter('all')
    void navigate({
      to: '/review' as never,
      search: {
        mode: reviewMode === 'issues' ? 'issues' : undefined,
        projectId: projectId || undefined,
        pullRequestId: undefined,
        issueId: undefined,
      } as never,
    })
  }

  const setSelectedPullRequest = (pullRequestId: string) => {
    if (isMobile) {
      setMobileView('detail')
    }

    void navigate({
      to: '/review' as never,
      search: {
        mode: undefined,
        projectId: selectedProjectId || undefined,
        pullRequestId,
        issueId: undefined,
      } as never,
    })
  }

  const setSelectedIssue = (issueId: string) => {
    if (isMobile) {
      setMobileView('detail')
    }

    void navigate({
      to: '/review' as never,
      search: {
        mode: 'issues',
        projectId: selectedProjectId || undefined,
        pullRequestId: undefined,
        issueId,
      } as never,
    })
  }

  const syncReviewPullRequests = async (options?: { silent?: boolean }) => {
    if (!githubAppConnection.connected) {
      return
    }

    const syncProjects = selectedProjectId
      ? visibleProjects.filter((project) => project.id === selectedProjectId)
      : visibleProjects
    if (syncProjects.length === 0) {
      return
    }

    setSyncingProjectId(selectedProjectId || '__all')
    try {
      const response = await api.syncReviewPullRequests(selectedProjectId ? [selectedProjectId] : undefined)
      setPullRequests(response.pullRequests.slice(0, REVIEW_PULL_REQUEST_PAGE_SIZE))
      setPullRequestNextCursor(response.pullRequests.length > REVIEW_PULL_REQUEST_PAGE_SIZE ? String(REVIEW_PULL_REQUEST_PAGE_SIZE) : undefined)
      setPullRequestHasMore(response.pullRequests.length > REVIEW_PULL_REQUEST_PAGE_SIZE)
      if (!response.ok) {
        if (!options?.silent) {
          toast.warning(response.message)
        }
        return
      }
      if (!options?.silent) {
        toast.success(response.message)
      }
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : language === 'zh' ? '同步 PR 失败' : 'Failed to sync pull requests')
      }
    } finally {
      setSyncingProjectId('')
    }
  }

  const refreshCurrentReviewMode = async () => {
    if (!githubAppConnection.connected) {
      return
    }

    if (reviewMode === 'issues') {
      setSyncingProjectId(selectedProjectId || '__issues')
      try {
        await loadIssues(selectedProjectId, { refresh: true })
      } finally {
        setSyncingProjectId('')
      }
      return
    }

    await syncReviewPullRequests()
  }

  const loadMoreCurrentReviewMode = async () => {
    if (!githubAppConnection.connected) {
      return
    }

    if (reviewMode === 'issues') {
      if (!issueHasMore || issuesLoadingMore) {
        return
      }

      await loadIssues(selectedProjectId, { cursor: issueNextCursor, append: true })
      return
    }

    if (!pullRequestHasMore || pullRequestsLoadingMore) {
      return
    }

    await loadPullRequests(selectedProjectId, { cursor: pullRequestNextCursor, append: true })
  }

  const openWorkspace = (pullRequest: ProjectPullRequestReviewSummary) => {
    if (!pullRequest.matchedWorkspaceId) {
      return
    }

    void navigate({
      to: '/workspaces' as never,
      search: {
        projectId: pullRequest.projectId,
        taskId: pullRequest.matchedTaskId,
        workspaceId: pullRequest.matchedWorkspaceId,
        workspaceSessionId: pullRequest.matchedWorkspaceSessionId,
      } as never,
    })
  }

  const openWorkflowTarget = (params: {
    projectId: string
    taskId?: string
    workspaceId?: string
    workspaceSessionId?: string
  }) => {
    if (!params.workspaceId) {
      return
    }

    void navigate({
      to: '/workspaces' as never,
      search: {
        projectId: params.projectId,
        taskId: params.taskId,
        workspaceId: params.workspaceId,
        workspaceSessionId: params.workspaceSessionId,
      } as never,
    })
  }

  const startReviewWorkflow = async (pullRequest: ProjectPullRequestReviewSummary) => {
    setStartingWorkflowPullRequestId(pullRequest.id)
    try {
      const response = await api.startPullRequestReviewWorkflow(pullRequest.id)
      setState(response.state)
      setPullRequests((current) => current.map((item) => (
        item.id === response.pullRequest.id ? response.pullRequest : item
      )))
      toast.success(response.message)
      openWorkflowTarget({
        projectId: response.pullRequest.projectId,
        taskId: response.taskId,
        workspaceId: response.workspaceId,
        workspaceSessionId: response.workspaceSessionId,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === 'zh' ? '启动 review workflow 失败' : 'Failed to start review workflow')
    } finally {
      setStartingWorkflowPullRequestId('')
    }
  }

  const pageTitle = reviewMode === 'issues' ? 'Issues' : 'Review'
  const projectSubtitle = selectedProject
    ? `${selectedProject.name} · ${selectedProject.gitUrl || 'no remote'}`
    : reviewMode === 'issues'
      ? `${issues.length} issues across ${visibleProjects.length} projects`
      : `${pullRequests.length} pull requests across ${visibleProjects.length} projects`
  const actionsPanel = (
    <ReviewActionsPanel
      pullRequest={selectedPullRequest}
      startingWorkflow={Boolean(selectedPullRequest && startingWorkflowPullRequestId === selectedPullRequest.id)}
      onOpenWorkspace={openWorkspace}
      onStartReviewWorkflow={startReviewWorkflow}
    />
  )
  const issueActionsPanel = (
    <IssueActionsPanel
      issue={selectedIssue}
      projectName={selectedIssue ? visibleProjectNameById.get(selectedIssue.projectId) : undefined}
    />
  )
  const listPanel = (
    reviewMode === 'issues'
      ? (
        <IssueListPanel
          issueCounts={issueCounts}
          issueStateFilter={issueStateFilter}
          projectResults={issueProjectResults ?? []}
          issues={filteredIssues}
          hasMore={issueHasMore}
          loading={issuesLoading}
          loadingMore={issuesLoadingMore}
          projectNameById={visibleProjectNameById}
          query={query}
          selectedIssueId={selectedIssue?.id || ''}
          onIssueStateFilterChange={setIssueStateFilter}
          onQueryChange={setQuery}
          onSelectIssue={setSelectedIssue}
          onLoadMore={() => void loadMoreCurrentReviewMode()}
        />
      )
      : (
        <ReviewListPanel
          groupedPullRequests={groupedPullRequests}
          hasMore={pullRequestHasMore}
          loading={loading}
          loadingMore={pullRequestsLoadingMore}
          projectNameById={visibleProjectNameById}
          query={query}
          selectedPullRequestId={selectedPullRequest?.id || ''}
          stateCounts={stateCounts}
          stateFilter={stateFilter}
          onQueryChange={setQuery}
          onSelectPullRequest={setSelectedPullRequest}
          onLoadMore={() => void loadMoreCurrentReviewMode()}
          onStateFilterChange={setStateFilter}
        />
      )
  )
  const detailPanel = (
    reviewMode === 'issues'
      ? (
        <IssueDetailPanel
          actions={issueActionsPanel}
          compactActions={isMobile}
          issue={selectedIssue}
          onBack={isMobile ? () => setMobileView('list') : undefined}
        />
      )
      : (
        <ReviewDetailPanel
          pullRequest={selectedPullRequest}
          actions={actionsPanel}
          compactActions={isMobile}
          onBack={isMobile ? () => setMobileView('list') : undefined}
        />
      )
  )
  const sidePanel = reviewMode === 'issues' ? issueActionsPanel : actionsPanel

  return (
    <div className="relative flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#050505] text-zinc-100">
      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-900 bg-[#070708] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {reviewMode === 'issues'
            ? <MessageSquare className="h-4 w-4 shrink-0 text-sky-300" />
            : <GitPullRequest className="h-4 w-4 shrink-0 text-emerald-300" />}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-100">{pageTitle}</h1>
            <p className="truncate text-[11px] text-zinc-600">
              {projectSubtitle}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5">
          <select
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-700 sm:w-56 sm:flex-none"
          >
            {visibleProjects.length === 0 ? <option value="">No remote projects</option> : <option value="">All Projects</option>}
            {visibleProjects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void refreshCurrentReviewMode()}
            disabled={visibleProjects.length === 0 || Boolean(syncingProjectId)}
            className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            title={reviewMode === 'issues' ? 'Refresh GitHub Issues' : 'Refresh pull requests from GitHub'}
          >
            {syncingProjectId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {isMobile ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className={mobileView === 'list' ? 'flex h-full min-h-0 overflow-hidden' : 'hidden'}>
            {listPanel}
          </div>
          <div className={mobileView === 'detail' ? 'flex h-full min-h-0 overflow-hidden' : 'hidden'}>
            {detailPanel}
          </div>
        </div>
      ) : (
        <div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(240px,260px)] overflow-hidden min-[1440px]:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(250px,280px)] max-[1180px]:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <div className="h-full min-h-0 min-w-0 overflow-hidden border-r border-zinc-900">
            {listPanel}
          </div>
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            {detailPanel}
          </div>
          <div className="h-full min-h-0 min-w-0 overflow-hidden border-l border-zinc-900 max-[1180px]:hidden">
            {sidePanel}
          </div>
        </div>
      )}

      {!githubAppConnection.connected ? (
        <GitHubAppConnectionOverlay
          appSlug={githubAppConnection.appSlug}
          configured={githubAppConnection.configured}
          sectionLabel={reviewMode === 'issues' ? 'Issues' : 'Reviews'}
        />
      ) : null}
    </div>
  )
}

function ReviewListPanel({
  groupedPullRequests,
  hasMore,
  loading,
  loadingMore,
  projectNameById,
  query,
  selectedPullRequestId,
  stateCounts,
  stateFilter,
  onQueryChange,
  onSelectPullRequest,
  onLoadMore,
  onStateFilterChange,
}: {
  groupedPullRequests: ReturnType<typeof groupPullRequests>
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  projectNameById: Map<string, string>
  query: string
  selectedPullRequestId: string
  stateCounts: ReturnType<typeof countPullRequestStates>
  stateFilter: ReviewStateFilter
  onQueryChange: (value: string) => void
  onSelectPullRequest: (pullRequestId: string) => void
  onLoadMore: () => void
  onStateFilterChange: (value: ReviewStateFilter) => void
}) {
  const filterItems: Array<{ id: ReviewStateFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: stateCounts.all },
    { id: 'open', label: 'Open', count: stateCounts.open },
    { id: 'merged', label: 'Merged', count: stateCounts.merged },
    { id: 'closed', label: 'Closed', count: stateCounts.closed },
    { id: 'unknown', label: 'Recorded', count: stateCounts.unknown },
  ]

  return (
    <aside className="flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#060607]">
      <div className="shrink-0 space-y-2 border-b border-zinc-900 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search pull requests..."
            className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
          />
        </div>
        <div className="scrollbar-subtle flex gap-1 overflow-x-auto pb-0.5">
          {filterItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onStateFilterChange(item.id)}
              className={cn(
                'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
                stateFilter === item.id
                  ? 'border-zinc-700 bg-zinc-900 text-zinc-100'
                  : 'border-zinc-900 bg-zinc-950 text-zinc-500 hover:border-zinc-800 hover:text-zinc-300',
              )}
            >
              <span>{item.label}</span>
              <span className="text-[10px] tabular-nums text-zinc-600">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="space-y-4 px-2 py-3">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading pull requests...
            </div>
          ) : groupedPullRequests.length === 0 ? (
            <div className="rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-4 text-xs leading-5 text-zinc-500">
              No pull requests match the current filters.
            </div>
          ) : (
            <>
              {groupedPullRequests.map((group) => (
                <section key={group.id} className="space-y-1">
                  <div className="px-2 text-[10px] font-medium uppercase text-zinc-600">{group.label}</div>
                  {group.items.map((pullRequest) => {
                    const selected = selectedPullRequestId === pullRequest.id
                    const meta = stateMeta[pullRequest.state] ?? stateMeta.unknown
                    const Icon = meta.icon
                    return (
                      <button
                        key={pullRequest.id}
                        type="button"
                        onClick={() => onSelectPullRequest(pullRequest.id)}
                        className={cn(
                          'group flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                          selected
                            ? 'bg-zinc-900/80 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                        )}
                      >
                        <Icon className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0',
                          pullRequest.state === 'merged'
                            ? 'text-violet-300'
                            : pullRequest.state === 'open'
                              ? 'text-emerald-300'
                              : 'text-zinc-500',
                        )} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {pullRequest.title} <span className="text-zinc-500">#{pullRequest.number}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                            {formatRelativeDate(pullRequest.updatedAt || pullRequest.syncedAt)} · {projectNameById.get(pullRequest.projectId) || pullRequest.repoFullName}
                          </span>
                        </span>
                        <span className="hidden shrink-0 text-[11px] tabular-nums min-[1380px]:inline">
                          <span className="text-emerald-300">+{pullRequest.additions}</span>
                          <span className="mx-1 text-zinc-700">/</span>
                          <span className="text-rose-300">-{pullRequest.deletions}</span>
                        </span>
                      </button>
                    )
                  })}
                </section>
              ))}
              {hasMore ? (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-900 bg-zinc-950 text-xs text-zinc-500 hover:border-zinc-800 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Load more
                </button>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function IssueListPanel({
  hasMore,
  issueCounts,
  issueStateFilter,
  issues,
  loading,
  loadingMore,
  projectResults,
  projectNameById,
  query,
  selectedIssueId,
  onIssueStateFilterChange,
  onLoadMore,
  onQueryChange,
  onSelectIssue,
}: {
  hasMore: boolean
  issueCounts: ReturnType<typeof countIssueStates>
  issueStateFilter: IssueStateFilter
  issues: ProjectIssueSummary[]
  loading: boolean
  loadingMore: boolean
  projectResults: NonNullable<ProjectIssuesResponse['projectResults']>
  projectNameById: Map<string, string>
  query: string
  selectedIssueId: string
  onIssueStateFilterChange: (value: IssueStateFilter) => void
  onLoadMore: () => void
  onQueryChange: (value: string) => void
  onSelectIssue: (issueId: string) => void
}) {
  const failedProjectResults = projectResults.filter((result) => !result.ok)
  const filterItems: Array<{ id: IssueStateFilter; label: string; count: number }> = [
    { id: 'open', label: 'Open', count: issueCounts.open },
    { id: 'closed', label: 'Closed', count: issueCounts.closed },
    { id: 'all', label: 'All', count: issueCounts.all },
  ]

  return (
    <aside className="flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#060607]">
      <div className="shrink-0 space-y-2 border-b border-zinc-900 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search issues..."
            className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
          />
        </div>
        <div className="scrollbar-subtle flex gap-1 overflow-x-auto pb-0.5">
          {filterItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onIssueStateFilterChange(item.id)}
              className={cn(
                'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
                issueStateFilter === item.id
                  ? 'border-zinc-700 bg-zinc-900 text-zinc-100'
                  : 'border-zinc-900 bg-zinc-950 text-zinc-500 hover:border-zinc-800 hover:text-zinc-300',
              )}
            >
              <span>{item.label}</span>
              <span className="text-[10px] tabular-nums text-zinc-600">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="space-y-1 px-2 py-3">
          {failedProjectResults.length > 0 ? (
            <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs leading-5">
              <div className="text-[10px] font-medium uppercase text-amber-300">Projects that could not be read</div>
              <div className="mt-2 flex flex-col gap-2">
                {failedProjectResults.map((result) => (
                  <div key={result.projectId}>
                    <div className="truncate text-[11px] font-medium text-amber-200">{result.projectName}</div>
                    <div className="mt-0.5 break-words text-[11px] text-zinc-500">{result.message}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading issues...
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-4 text-xs leading-5 text-zinc-500">
              <div>No issues match the current filters.</div>
            </div>
          ) : (
            <>
              {issues.map((issue) => {
                const selected = selectedIssueId === issue.id
                return (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => onSelectIssue(issue.id)}
                    className={cn(
                      'group flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      selected
                        ? 'bg-zinc-900/80 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                    )}
                  >
                    <MessageSquare className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      issue.state === 'open' ? 'text-emerald-300' : 'text-zinc-500',
                    )} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {issue.title} <span className="text-zinc-500">#{issue.number}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                        {formatRelativeDate(issue.updatedAt || issue.createdAt)} · {projectNameById.get(issue.projectId) || issue.repoFullName}
                      </span>
                    </span>
                    {issue.comments > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-zinc-500">
                        <MessageSquare className="h-3 w-3" />
                        {issue.comments}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {hasMore ? (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-900 bg-zinc-950 text-xs text-zinc-500 hover:border-zinc-800 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Load more
                </button>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function ReviewDetailPanel({
  pullRequest,
  actions,
  compactActions,
  onBack,
}: {
  pullRequest: ProjectPullRequestReviewSummary | null
  actions: ReactNode
  compactActions: boolean
  onBack?: () => void
}) {
  const [descriptionMode, setDescriptionMode] = useState<PullRequestDescriptionMode>('preview')
  const [expandedFileKeys, setExpandedFileKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const defaultFileKeys = pullRequest?.files
      .filter((file) => Boolean(file.patch))
      .slice(0, 2)
      .map(getPullRequestFileKey) ?? []
    setExpandedFileKeys(new Set(defaultFileKeys))
  }, [pullRequest?.id])

  if (!pullRequest) {
    return (
      <main className="flex h-full max-h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[#050505] px-4 text-sm text-zinc-500">
        Select a pull request.
      </main>
    )
  }

  const body = formatPullRequestBody(pullRequest.body)

  return (
    <main className="flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#050505]">
      <div className="shrink-0 border-b border-zinc-900 bg-[#070708] px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
              {onBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onBack}
                  className="mr-0.5 h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label="Back to pull request list"
                  title="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              <PullRequestStateBadge pullRequest={pullRequest} />
              <span className="min-w-0 max-w-full truncate rounded-md bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                {pullRequest.baseBranch} ← {pullRequest.compareBranch}
              </span>
            </div>
            <h2 className="line-clamp-2 break-words text-[15px] font-semibold leading-5 text-zinc-100 sm:text-base">
              #{pullRequest.number} {pullRequest.title}
            </h2>
            <p className="mt-1 truncate text-[11px] text-zinc-500">
              {pullRequest.authorLogin || 'unknown'} · {pullRequest.repoFullName} · {pullRequest.changedFiles} files
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="mx-auto w-full max-w-5xl space-y-5 px-3 py-4 sm:px-5 sm:py-5">
          <PullRequestDescriptionSection
            body={body}
            mode={descriptionMode}
            pullRequestUrl={pullRequest.url}
            onModeChange={setDescriptionMode}
          />

          <PullRequestFilesSection
            expandedFileKeys={expandedFileKeys}
            pullRequest={pullRequest}
            onExpandedFileKeysChange={setExpandedFileKeys}
          />

          {compactActions ? (
            <section className="border-t border-zinc-900 pt-4">
              {actions}
            </section>
          ) : (
            <div className="hidden max-[1180px]:block">
              {actions}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  )
}

function PullRequestDescriptionSection({
  body,
  mode,
  pullRequestUrl,
  onModeChange,
}: {
  body: string
  mode: PullRequestDescriptionMode
  pullRequestUrl?: string
  onModeChange: (mode: PullRequestDescriptionMode) => void
}) {
  return (
    <section className="overflow-hidden rounded-md border border-zinc-900 bg-zinc-950/40">
      <div className="flex min-w-0 flex-col gap-2 border-b border-zinc-900 bg-[#070708] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <h3 className="truncate text-sm font-semibold text-zinc-100">Description</h3>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex h-7 shrink-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
            <button
              type="button"
              onClick={() => onModeChange('preview')}
              className={cn(
                'inline-flex items-center gap-1 border-r border-zinc-800 px-2 text-[11px] transition-colors',
                mode === 'preview' ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => onModeChange('markdown')}
              className={cn(
                'inline-flex items-center gap-1 px-2 text-[11px] transition-colors',
                mode === 'markdown' ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Code2 className="h-3 w-3" />
              Markdown
            </button>
          </div>
          {pullRequestUrl ? (
            <a
              href={pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
              GitHub
            </a>
          ) : null}
        </div>
      </div>
      <div className="scrollbar-subtle max-h-[45vh] overflow-auto px-3 py-3">
        {body ? (
          mode === 'preview'
            ? <PullRequestMarkdown content={body} />
            : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
                {body}
              </pre>
            )
        ) : (
          <div className="text-sm text-zinc-500">No description.</div>
        )}
      </div>
    </section>
  )
}

function PullRequestFilesSection({
  expandedFileKeys,
  pullRequest,
  onExpandedFileKeysChange,
}: {
  expandedFileKeys: Set<string>
  pullRequest: ProjectPullRequestReviewSummary
  onExpandedFileKeysChange: (fileKeys: Set<string>) => void
}) {
  const allFileKeys = useMemo(() => pullRequest.files.map(getPullRequestFileKey), [pullRequest.files])
  const expandedCount = allFileKeys.filter((fileKey) => expandedFileKeys.has(fileKey)).length
  const allExpanded = allFileKeys.length > 0 && expandedCount === allFileKeys.length

  const toggleFile = (fileKey: string) => {
    const nextFileKeys = new Set(expandedFileKeys)
    if (nextFileKeys.has(fileKey)) {
      nextFileKeys.delete(fileKey)
    } else {
      nextFileKeys.add(fileKey)
    }
    onExpandedFileKeysChange(nextFileKeys)
  }

  const setAllExpanded = () => {
    onExpandedFileKeysChange(allExpanded ? new Set() : new Set(allFileKeys))
  }

  return (
    <section className="overflow-hidden rounded-md border border-zinc-900 bg-zinc-950/40">
      <div className="flex min-w-0 flex-col gap-2 border-b border-zinc-900 bg-[#070708] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <h3 className="truncate text-sm font-semibold text-zinc-100">Changed files</h3>
          <span className="shrink-0 text-[11px] text-zinc-500">
            {pullRequest.changedFiles} files · <span className="text-emerald-300">+{pullRequest.additions}</span> <span className="text-rose-300">-{pullRequest.deletions}</span>
          </span>
        </div>
        {pullRequest.files.length > 0 ? (
          <button
            type="button"
            onClick={setAllExpanded}
            className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        ) : null}
      </div>
      <div className="overflow-hidden">
        {pullRequest.files.length === 0 ? (
          <div className="px-3 py-4 text-xs text-zinc-500">No file list synced yet.</div>
        ) : pullRequest.files.map((file) => {
          const fileKey = getPullRequestFileKey(file)
          return (
            <PullRequestFileRow
              key={fileKey}
              expanded={expandedFileKeys.has(fileKey)}
              file={file}
              onToggle={() => toggleFile(fileKey)}
            />
          )
        })}
      </div>
    </section>
  )
}

function PullRequestFileRow({
  expanded,
  file,
  onToggle,
}: {
  expanded: boolean
  file: ProjectPullRequestFileSummary
  onToggle: () => void
}) {
  return (
    <div className="border-b border-zinc-900 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2 bg-zinc-950/40 px-3 py-2 hover:bg-zinc-900/40">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
          <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-xs text-zinc-300">{file.path}</span>
            {file.previousPath ? (
              <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
                renamed from {file.previousPath}
              </span>
            ) : null}
          </span>
        </button>
        <span className="hidden shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500 sm:inline">
          {file.status}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums">
          <span className="text-emerald-300">+{file.additions}</span>
          <span className="mx-1 text-zinc-700">/</span>
          <span className="text-rose-300">-{file.deletions}</span>
        </span>
        {file.blobUrl ? (
          <a
            href={file.blobUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label={`Open ${file.path} on GitHub`}
            title="Open file on GitHub"
          >
            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      {expanded ? (
        file.patch ? (
          <FilePatchView patch={file.patch} />
        ) : (
          <div className="border-t border-zinc-900 bg-[#050506] px-4 py-3 text-xs leading-5 text-zinc-500">
            No inline diff synced for this file.
            {file.blobUrl ? (
              <a
                href={file.blobUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"
              >
                Open file on GitHub
                <SquareArrowOutUpRight className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  )
}

function IssueDetailPanel({
  actions,
  compactActions,
  issue,
  onBack,
}: {
  actions: ReactNode
  compactActions: boolean
  issue: ProjectIssueSummary | null
  onBack?: () => void
}) {
  const [descriptionMode, setDescriptionMode] = useState<PullRequestDescriptionMode>('preview')

  if (!issue) {
    return (
      <main className="flex h-full max-h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[#050505] px-4 text-sm text-zinc-500">
        Select an issue.
      </main>
    )
  }

  const body = formatPullRequestBody(issue.body)

  return (
    <main className="flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#050505]">
      <div className="shrink-0 border-b border-zinc-900 bg-[#070708] px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
              {onBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onBack}
                  className="mr-0.5 h-7 w-7 rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                  aria-label="Back to issue list"
                  title="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', issueStateClassName(issue))}>
                <MessageSquare className="h-3 w-3" />
                {issue.state === 'open' ? 'Open' : 'Closed'}
              </span>
              {issue.labels.slice(0, 4).map((label) => (
                <span
                  key={label.name}
                  className="max-w-[9rem] truncate rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400"
                >
                  {label.name}
                </span>
              ))}
            </div>
            <h2 className="line-clamp-2 break-words text-[15px] font-semibold leading-5 text-zinc-100 sm:text-base">
              #{issue.number} {issue.title}
            </h2>
            <p className="mt-1 truncate text-[11px] text-zinc-500">
              {issue.authorLogin || 'unknown'} · {issue.repoFullName} · {issue.comments} comments
            </p>
          </div>
          {issue.url ? (
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label="Open issue on GitHub"
              title="Open issue on GitHub"
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-4 sm:px-5 sm:py-5">
          <PullRequestDescriptionSection
            body={body}
            mode={descriptionMode}
            pullRequestUrl={issue.url}
            onModeChange={setDescriptionMode}
          />

          {compactActions ? (
            <section className="border-t border-zinc-900 pt-4">
              {actions}
            </section>
          ) : (
            <div className="hidden max-[1180px]:block">
              {actions}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  )
}

function GitHubActionsSection({ pullRequest }: { pullRequest: ProjectPullRequestReviewSummary }) {
  const [runs, setRuns] = useState<ProjectGitHubWorkflowRunSummary[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [message, setMessage] = useState('')

  const loadRuns = async (silent = false) => {
    setLoadingRuns(true)
    try {
      const response = await api.listPullRequestWorkflowRuns(pullRequest.id)
      setRuns(response.runs)
      setMessage(response.ok ? '' : response.message)
      if (!response.ok && !silent) {
        toast.warning(response.message)
      }
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'Failed to load GitHub Actions'
      setMessage(nextMessage)
      if (!silent) {
        toast.error(nextMessage)
      }
    } finally {
      setLoadingRuns(false)
    }
  }

  useEffect(() => {
    void loadRuns(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullRequest.id])

  return (
    <section className="space-y-2 border-t border-zinc-900 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase text-zinc-500">GitHub Actions</h3>
        <button
          type="button"
          onClick={() => void loadRuns()}
          disabled={loadingRuns}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-60"
          aria-label="Refresh GitHub Actions"
          title="Refresh GitHub Actions"
        >
          {loadingRuns ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
      {loadingRuns && runs.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading workflow runs...
        </div>
      ) : message && runs.length === 0 ? (
        <div className="rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-3 text-xs leading-5 text-zinc-500">
          {message}
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-3 text-xs leading-5 text-zinc-500">
          No workflow runs found for this PR.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {runs.slice(0, 8).map((run) => {
            const Icon = workflowRunIcon(run)
            return (
              <a
                key={run.id}
                href={run.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md border border-zinc-900 bg-zinc-950/70 px-2.5 py-2 hover:border-zinc-800 hover:bg-zinc-900/60"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-zinc-200">{run.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                      #{run.runNumber}.{run.runAttempt} · {run.event} · {formatRelativeDate(run.updatedAt || run.createdAt)}
                    </div>
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', workflowRunStatusClassName(run))}>
                    <Icon className="h-3 w-3" />
                    {workflowRunLabel(run)}
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] text-zinc-600">{run.displayTitle}</div>
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ReviewActionsPanel({
  pullRequest,
  startingWorkflow,
  onOpenWorkspace,
  onStartReviewWorkflow,
}: {
  pullRequest: ProjectPullRequestReviewSummary | null
  startingWorkflow: boolean
  onOpenWorkspace: (pullRequest: ProjectPullRequestReviewSummary) => void
  onStartReviewWorkflow: (pullRequest: ProjectPullRequestReviewSummary) => void
}) {
  return (
    <aside className="flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#060607]">
      <div className="shrink-0 border-b border-zinc-900 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Actions</h2>
        <p className="mt-1 text-[11px] text-zinc-600">AI review, checks, links</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {pullRequest ? (
          <>
            <section className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase text-zinc-500">AI Review</h3>
              <Button
                type="button"
                disabled={startingWorkflow || pullRequest.state !== 'open'}
                onClick={() => onStartReviewWorkflow(pullRequest)}
                className="h-8 w-full justify-center rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
                title={pullRequest.state === 'open' ? 'Start AI review' : 'Only open pull requests can start AI review'}
              >
                {startingWorkflow ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="mr-1.5 h-3.5 w-3.5" />}
                {startingWorkflow ? 'Starting review...' : 'Start AI review'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenWorkspace(pullRequest)}
                disabled={!pullRequest.matchedWorkspaceId}
                className="h-8 w-full justify-start rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                <span className="truncate">{pullRequest.matchedTaskId ? 'Open review workspace' : 'Open workspace'}</span>
              </Button>
            </section>

            <GitHubActionsSection pullRequest={pullRequest} />

            {pullRequest.url ? (
              <section className="space-y-2 border-t border-zinc-900 pt-4">
                <h3 className="text-[11px] font-medium uppercase text-zinc-500">Links</h3>
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-8 w-full items-center justify-start rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                >
                  <SquareArrowOutUpRight className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Go to pull request</span>
                </a>
              </section>
            ) : null}

            <section className="space-y-2 border-t border-zinc-900 pt-4">
              <h3 className="text-[11px] font-medium uppercase text-zinc-500">Info</h3>
              <InfoRow label="Repository" value={pullRequest.repoFullName} />
              <InfoRow label="Base" value={pullRequest.baseBranch} />
              <InfoRow label="Compare" value={pullRequest.compareBranch} />
              <InfoRow label="Workspace" value={pullRequest.matchedWorkspaceId ? 'Matched' : 'No match'} />
              <InfoRow label="Task" value={pullRequest.matchedTaskTitle || pullRequest.matchedTaskId || 'No match'} />
              <InfoRow label="Synced" value={formatRelativeDate(pullRequest.syncedAt) || 'now'} />
            </section>
          </>
        ) : (
          <p className="text-xs text-zinc-500">No pull request selected.</p>
        )}
      </div>
    </aside>
  )
}

function IssueActionsPanel({
  issue,
  projectName,
}: {
  issue: ProjectIssueSummary | null
  projectName?: string
}) {
  return (
    <aside className="flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#060607]">
      <div className="shrink-0 border-b border-zinc-900 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Issue</h2>
        <p className="mt-1 text-[11px] text-zinc-600">GitHub issue observability</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {issue ? (
          <>
            {issue.url ? (
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 w-full items-center justify-start rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <SquareArrowOutUpRight className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Go to issue</span>
              </a>
            ) : null}
            <section className="space-y-2 border-t border-zinc-900 pt-4">
              <h3 className="text-[11px] font-medium uppercase text-zinc-500">Info</h3>
              <InfoRow label="Project" value={projectName || issue.repoFullName} />
              <InfoRow label="Repository" value={issue.repoFullName} />
              <InfoRow label="State" value={issue.state} />
              <InfoRow label="Author" value={issue.authorLogin || 'unknown'} />
              <InfoRow label="Assignees" value={issue.assigneeLogins.join(', ') || 'None'} />
              <InfoRow label="Comments" value={String(issue.comments)} />
              <InfoRow label="Updated" value={formatRelativeDate(issue.updatedAt || issue.createdAt) || 'now'} />
            </section>
            {issue.labels.length > 0 ? (
              <section className="space-y-2 border-t border-zinc-900 pt-4">
                <h3 className="text-[11px] font-medium uppercase text-zinc-500">Labels</h3>
                <div className="flex flex-wrap gap-1.5">
                  {issue.labels.map((label) => (
                    <span
                      key={label.name}
                      className="max-w-full truncate rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-zinc-500">No issue selected.</p>
        )}
      </div>
    </aside>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span className="min-w-0 break-words text-right text-zinc-300">{value}</span>
    </div>
  )
}
