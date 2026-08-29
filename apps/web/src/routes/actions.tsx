// [INPUT]: 操作请求
// [OUTPUT]: 页面操作
// [POS]: 操作页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Loader2, PlayCircle, RefreshCw, ScrollText, Search, SquareArrowOutUpRight, Workflow, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type {
  ProjectGitHubWorkflowJobLogsResponse,
  ProjectGitHubWorkflowJobSummary,
  ProjectGitHubWorkflowRunsResponse,
  ProjectGitHubWorkflowRunSummary,
} from '@shared/types'
import { GitHubAppConnectionLoadingState, GitHubAppConnectionOverlay, useGitHubAppConnectionStatus } from '../components/github/github-app-connection-state'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Textarea } from '../components/ui/textarea'
import { useApp } from '../lib/app-provider'
import { api } from '../lib/api'
import { isReviewCenterEnabled } from '../lib/runtime-config'
import { cn } from '../lib/utils'

type ActionsSearch = {
  projectId?: string
  runId?: string
}

type RunFilter = 'all' | 'running' | 'success' | 'failure' | 'other'
type WorkflowJobsState = {
  loading: boolean
  message: string
  jobs: ProjectGitHubWorkflowJobSummary[]
}
type WorkflowJobLogsState = {
  loadingJobId: string
  message: string
  logsByJobId: Record<string, ProjectGitHubWorkflowJobLogsResponse | undefined>
}

const ACTIONS_MOBILE_MEDIA_QUERY = '(max-width: 767px)'
const ACTIONS_GITHUB_TARGET_PAGE_SIZE = 20
const PENDING_JOB_LOGS_MESSAGE = 'GitHub workflow job logs 暂未就绪。'

export const Route = createFileRoute('/actions' as never)({
  validateSearch: (search: Record<string, unknown>): ActionsSearch => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
    runId: typeof search.runId === 'string' ? search.runId : undefined,
  }),
  component: ActionsRoute,
})

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

const runStatusClassName = (run: ProjectGitHubWorkflowRunSummary) => {
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

const runStatusLabel = (run: ProjectGitHubWorkflowRunSummary) => (
  run.status === 'completed' ? (run.conclusion || 'completed') : run.status
).replace(/_/g, ' ')

const runStatusIcon = (run: ProjectGitHubWorkflowRunSummary) => {
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

const getRunFilter = (run: ProjectGitHubWorkflowRunSummary): RunFilter => {
  if (run.status !== 'completed') {
    return 'running'
  }
  if (run.conclusion === 'success') {
    return 'success'
  }
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure') {
    return 'failure'
  }
  return 'other'
}

const countRuns = (runs: ProjectGitHubWorkflowRunSummary[]) => ({
  all: runs.length,
  running: runs.filter((run) => getRunFilter(run) === 'running').length,
  success: runs.filter((run) => getRunFilter(run) === 'success').length,
  failure: runs.filter((run) => getRunFilter(run) === 'failure').length,
  other: runs.filter((run) => getRunFilter(run) === 'other').length,
})

const getWorkflowRunKey = (run: ProjectGitHubWorkflowRunSummary) => `${run.projectId}:${run.id}`

const mergeWorkflowRuns = (
  current: ProjectGitHubWorkflowRunSummary[],
  next: ProjectGitHubWorkflowRunSummary[],
) => {
  const seen = new Set<string>()
  return [...current, ...next].filter((run) => {
    const key = getWorkflowRunKey(run)
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

const mergeProjectResults = (
  current: NonNullable<ProjectGitHubWorkflowRunsResponse['projectResults']>,
  next: NonNullable<ProjectGitHubWorkflowRunsResponse['projectResults']>,
) => {
  const seen = new Set<string>()
  return [...current, ...next].filter((result) => {
    const key = `${result.projectId}:${result.projectName}:${result.message}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function useActionsIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia(ACTIONS_MOBILE_MEDIA_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia(ACTIONS_MOBILE_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    setIsMobile(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}

function ActionsRoute() {
  if (!isReviewCenterEnabled()) {
    return <Navigate to="/dashboard" replace />
  }

  return <ActionsRouteGuard />
}

function ActionsRouteGuard() {
  const githubAppConnection = useGitHubAppConnectionStatus()

  if (githubAppConnection.loading) {
    return <GitHubAppConnectionLoadingState />
  }

  return <ActionsRouteEnabled githubAppConnection={githubAppConnection} />
}

function ActionsRouteEnabled({
  githubAppConnection,
}: {
  githubAppConnection: ReturnType<typeof useGitHubAppConnectionStatus>
}) {
  const navigate = useNavigate()
  const isMobile = useActionsIsMobile()
  const search = Route.useSearch() as ActionsSearch
  const { state } = useApp()
  const [runs, setRuns] = useState<ProjectGitHubWorkflowRunSummary[]>([])
  const [projectResults, setProjectResults] = useState<ProjectGitHubWorkflowRunsResponse['projectResults']>([])
  const [loadMessage, setLoadMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedProjectId, setSelectedProjectIdState] = useState(search.projectId || '')
  const [filter, setFilter] = useState<RunFilter>('all')
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [workflowJobsState, setWorkflowJobsState] = useState<WorkflowJobsState>({
    loading: false,
    message: '',
    jobs: [],
  })
  const [workflowJobLogsState, setWorkflowJobLogsState] = useState<WorkflowJobLogsState>({
    loadingJobId: '',
    message: '',
    logsByJobId: {},
  })

  const visibleProjects = state.projects.filter((project) => project.versionControl !== 'none')
  const projectNameById = useMemo(
    () => new Map(visibleProjects.map((project) => [project.id, project.name] as const)),
    [visibleProjects],
  )
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId) ?? null

  const loadRuns = async (projectId = selectedProjectId, options?: { silent?: boolean; cursor?: string; append?: boolean; refresh?: boolean }) => {
    if (options?.append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setNextCursor(undefined)
      setHasMore(false)
    }
    try {
      const response = await api.listReviewWorkflowRuns({
        projectId: projectId || undefined,
        cursor: options?.cursor,
        limit: ACTIONS_GITHUB_TARGET_PAGE_SIZE,
        refresh: options?.refresh,
      })
      setRuns((current) => (
        options?.append ? mergeWorkflowRuns(current, response.runs) : response.runs
      ))
      setProjectResults((current) => (
        options?.append
          ? mergeProjectResults(current ?? [], response.projectResults ?? [])
          : (response.projectResults ?? [])
      ))
      setLoadMessage(response.ok ? '' : response.message)
      setNextCursor(response.nextCursor)
      setHasMore(Boolean(response.hasMore))
      if (!response.ok && !options?.silent) {
        toast.warning(response.message)
      }
    } catch (error) {
      if (!options?.append) {
        setProjectResults([])
      }
      setLoadMessage(error instanceof Error ? error.message : 'Failed to load GitHub Actions')
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : 'Failed to load GitHub Actions')
      }
    } finally {
      if (options?.append) {
        setLoadingMore(false)
      } else {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!githubAppConnection.connected) {
      setRuns([])
      setProjectResults([])
      setLoadMessage('')
      setNextCursor(undefined)
      setHasMore(false)
      setLoading(false)
      return
    }

    void loadRuns(selectedProjectId, { silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubAppConnection.connected, selectedProjectId])

  useEffect(() => {
    if (isMobile && search.runId) {
      setMobileView('detail')
    }
  }, [isMobile, search.runId])

  const searchedRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return runs
    }

    return runs.filter((run) => [
      run.name,
      run.displayTitle,
      run.repoFullName,
      run.headBranch,
      run.headSha,
      run.event,
      String(run.runNumber),
    ].some((value) => value?.toLowerCase().includes(normalizedQuery)))
  }, [query, runs])
  const counts = useMemo(() => countRuns(searchedRuns), [searchedRuns])
  const filteredRuns = useMemo(() => (
    filter === 'all'
      ? searchedRuns
      : searchedRuns.filter((run) => getRunFilter(run) === filter)
  ), [filter, searchedRuns])
  const selectedRun = filteredRuns.find((run) => getWorkflowRunKey(run) === search.runId)
    ?? filteredRuns[0]
    ?? null

  useEffect(() => {
    if (!githubAppConnection.connected || !selectedRun) {
      setWorkflowJobsState({
        loading: false,
        message: '',
        jobs: [],
      })
      setWorkflowJobLogsState({
        loadingJobId: '',
        message: '',
        logsByJobId: {},
      })
      return
    }

    let cancelled = false
    setWorkflowJobsState({
      loading: true,
      message: '',
      jobs: [],
    })
    setWorkflowJobLogsState({
      loadingJobId: '',
      message: '',
      logsByJobId: {},
    })

    void api.getReviewWorkflowRunJobs({
      projectId: selectedRun.projectId,
      runId: selectedRun.id,
    }).then((response) => {
      if (cancelled) {
        return
      }

      setWorkflowJobsState({
        loading: false,
        message: response.ok ? '' : response.message,
        jobs: response.jobs,
      })
      if (!response.ok) {
        toast.warning(response.message)
      }
    }).catch((error) => {
      if (cancelled) {
        return
      }

      setWorkflowJobsState({
        loading: false,
        message: error instanceof Error ? error.message : 'Failed to load workflow jobs',
        jobs: [],
      })
    })

    return () => {
      cancelled = true
    }
  }, [githubAppConnection.connected, selectedRun])

  const loadJobLogs = async (jobId: string, options?: { force?: boolean }) => {
    if (!githubAppConnection.connected || !selectedRun) {
      return
    }
    const existingJobLogs = workflowJobLogsState.logsByJobId[jobId]
    if (workflowJobLogsState.loadingJobId === jobId) {
      return
    }
    if (existingJobLogs?.ok && !options?.force) {
      return
    }

    setWorkflowJobLogsState((current) => ({
      ...current,
      loadingJobId: jobId,
      message: '',
    }))

    try {
      const response = await api.getReviewWorkflowJobLogs({
        projectId: selectedRun.projectId,
        runId: selectedRun.id,
        jobId,
      })
      setWorkflowJobLogsState((current) => ({
        loadingJobId: '',
        message: response.ok ? '' : response.message,
        logsByJobId: {
          ...current.logsByJobId,
          [jobId]: response,
        },
      }))
      if (!response.ok && !response.message.startsWith(PENDING_JOB_LOGS_MESSAGE)) {
        toast.warning(response.message)
      }
    } catch (error) {
      setWorkflowJobLogsState((current) => ({
        ...current,
        loadingJobId: '',
        message: error instanceof Error ? error.message : 'Failed to load workflow logs',
      }))
    }
  }

  const setSelectedProjectId = (projectId: string) => {
    setSelectedProjectIdState(projectId)
    setMobileView('list')
    setFilter('all')
    void navigate({
      to: '/actions' as never,
      search: {
        projectId: projectId || undefined,
        runId: undefined,
      } as never,
    })
  }

  const setSelectedRun = (runKey: string) => {
    if (isMobile) {
      setMobileView('detail')
    }

    void navigate({
      to: '/actions' as never,
      search: {
        projectId: selectedProjectId || undefined,
        runId: runKey,
      } as never,
    })
  }

  const refreshRuns = async () => {
    if (!githubAppConnection.connected) {
      return
    }

    setRefreshing(true)
    try {
      await loadRuns(selectedProjectId, { refresh: true })
    } finally {
      setRefreshing(false)
    }
  }

  const loadMoreRuns = async () => {
    if (!githubAppConnection.connected || !hasMore || loadingMore) {
      return
    }

    await loadRuns(selectedProjectId, {
      cursor: nextCursor,
      append: true,
    })
  }

  const subtitle = selectedProject
    ? `${selectedProject.name} · ${selectedProject.gitUrl || 'no remote'}`
    : `${runs.length} workflow runs from GitHub App`
  const listPanel = (
    <ActionsListPanel
      counts={counts}
      filter={filter}
      loadMessage={loadMessage}
      loading={loading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      projectResults={projectResults ?? []}
      projectNameById={projectNameById}
      query={query}
      runs={filteredRuns}
      selectedRunId={selectedRun ? getWorkflowRunKey(selectedRun) : ''}
      onFilterChange={setFilter}
      onLoadMore={() => void loadMoreRuns()}
      onQueryChange={setQuery}
      onSelectRun={setSelectedRun}
    />
  )
  const infoPanel = (
    <ActionsInfoPanel
      jobCount={workflowJobsState.jobs.length}
      projectName={selectedRun ? projectNameById.get(selectedRun.projectId) : undefined}
      run={selectedRun}
    />
  )
  const detailPanel = (
    <ActionsDetailPanel
      compactActions={isMobile}
      infoPanel={infoPanel}
      jobs={workflowJobsState.jobs}
      jobsLoadMessage={workflowJobsState.message}
      jobsLoading={workflowJobsState.loading}
      jobLogsById={workflowJobLogsState.logsByJobId}
      jobLogsLoadMessage={workflowJobLogsState.message}
      jobLogsLoadingJobId={workflowJobLogsState.loadingJobId}
      onLoadJobLogs={loadJobLogs}
      run={selectedRun}
      onBack={isMobile ? () => setMobileView('list') : undefined}
    />
  )

  return (
    <div className="relative flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#050505] text-zinc-100">
      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-900 bg-[#070708] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Workflow className="h-4 w-4 shrink-0 text-sky-300" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-100">Actions</h1>
            <p className="truncate text-[11px] text-zinc-600">{subtitle}</p>
          </div>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          <select
            value={selectedProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-700 sm:w-64 sm:flex-none"
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
            onClick={() => void refreshRuns()}
            disabled={refreshing}
            className="h-7 w-7 rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            title="Refresh GitHub Actions"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
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
        <div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(240px,280px)] overflow-hidden max-[1180px]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
          <div className="h-full min-h-0 min-w-0 overflow-hidden border-r border-zinc-900">
            {listPanel}
          </div>
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            {detailPanel}
          </div>
          <div className="h-full min-h-0 min-w-0 overflow-hidden border-l border-zinc-900 max-[1180px]:hidden">
            {infoPanel}
          </div>
        </div>
      )}

      {!githubAppConnection.connected ? (
        <GitHubAppConnectionOverlay
          appSlug={githubAppConnection.appSlug}
          configured={githubAppConnection.configured}
          sectionLabel="Actions"
        />
      ) : null}
    </div>
  )
}

function ActionsListPanel({
  counts,
  filter,
  hasMore,
  loadMessage,
  loading,
  loadingMore,
  projectResults,
  projectNameById,
  query,
  runs,
  selectedRunId,
  onFilterChange,
  onLoadMore,
  onQueryChange,
  onSelectRun,
}: {
  counts: ReturnType<typeof countRuns>
  filter: RunFilter
  hasMore: boolean
  loadMessage: string
  loading: boolean
  loadingMore: boolean
  projectResults: NonNullable<ProjectGitHubWorkflowRunsResponse['projectResults']>
  projectNameById: Map<string, string>
  query: string
  runs: ProjectGitHubWorkflowRunSummary[]
  selectedRunId: string
  onFilterChange: (value: RunFilter) => void
  onLoadMore: () => void
  onQueryChange: (value: string) => void
  onSelectRun: (runId: string) => void
}) {
  const failedProjectResults = projectResults.filter((result) => !result.ok)
  const filterItems: Array<{ id: RunFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'running', label: 'Running', count: counts.running },
    { id: 'success', label: 'Success', count: counts.success },
    { id: 'failure', label: 'Failed', count: counts.failure },
    { id: 'other', label: 'Other', count: counts.other },
  ]

  return (
    <aside className="flex h-full max-h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#060607]">
      <div className="shrink-0 space-y-2 border-b border-zinc-900 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search workflow runs..."
            className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
          />
        </div>
        <div className="scrollbar-subtle flex gap-1 overflow-x-auto pb-0.5">
          {filterItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onFilterChange(item.id)}
              className={cn(
                'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
                filter === item.id
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
          {!loading && (failedProjectResults.length > 0 || loadMessage) ? (
            <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs leading-5">
              <div className="text-[10px] font-medium uppercase text-amber-300">GitHub sources that could not be read</div>
              <div className="mt-2 flex flex-col gap-2">
                {failedProjectResults.length > 0 ? failedProjectResults.map((result) => (
                  <div key={`${result.projectId}:${result.projectName}:${result.message}`}>
                    <div className="truncate text-[11px] font-medium text-amber-200">{result.projectName}</div>
                    <div className="mt-0.5 break-words text-[11px] text-zinc-500">{result.message}</div>
                  </div>
                )) : (
                  <div className="break-words text-[11px] text-zinc-500">{loadMessage}</div>
                )}
              </div>
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading workflow runs...
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-4 text-xs leading-5 text-zinc-500">
              {loadMessage ? 'No workflow runs were loaded from GitHub.' : 'No workflow runs match the current filters.'}
            </div>
          ) : (
            <>
              {runs.map((run) => {
                const selected = selectedRunId === getWorkflowRunKey(run)
                const Icon = runStatusIcon(run)
                return (
                  <button
                    key={`${run.projectId}:${run.id}`}
                    type="button"
                    onClick={() => onSelectRun(getWorkflowRunKey(run))}
                    className={cn(
                      'group flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      selected
                        ? 'bg-zinc-900/80 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200',
                    )}
                  >
                    <Icon className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0',
                      run.status !== 'completed'
                        ? 'text-sky-300'
                        : run.conclusion === 'success'
                          ? 'text-emerald-300'
                          : run.conclusion === 'failure'
                            ? 'text-rose-300'
                            : 'text-zinc-500',
                    )} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{run.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                        #{run.runNumber}.{run.runAttempt} · {formatRelativeDate(run.updatedAt || run.runStartedAt || run.createdAt)} · {projectNameById.get(run.projectId) || run.repoFullName}
                      </span>
                    </span>
                    <span className={cn('hidden shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium min-[1380px]:inline', runStatusClassName(run))}>
                      {runStatusLabel(run)}
                    </span>
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
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDot className="h-3.5 w-3.5" />}
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

function ActionsDetailPanel({
  compactActions,
  infoPanel,
  jobs,
  jobsLoadMessage,
  jobsLoading,
  jobLogsById,
  jobLogsLoadMessage,
  jobLogsLoadingJobId,
  onLoadJobLogs,
  run,
  onBack,
}: {
  compactActions: boolean
  infoPanel: ReactNode
  jobs: ProjectGitHubWorkflowJobSummary[]
  jobsLoadMessage: string
  jobsLoading: boolean
  jobLogsById: Record<string, ProjectGitHubWorkflowJobLogsResponse | undefined>
  jobLogsLoadMessage: string
  jobLogsLoadingJobId: string
  onLoadJobLogs: (jobId: string, options?: { force?: boolean }) => Promise<void>
  run: ProjectGitHubWorkflowRunSummary | null
  onBack?: () => void
}) {
  const [expandedJobId, setExpandedJobId] = useState('')

  useEffect(() => {
    setExpandedJobId('')
  }, [run?.id])

  if (!run) {
    return (
      <main className="flex h-full max-h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[#050505] px-4 text-sm text-zinc-500">
        Select a workflow run.
      </main>
    )
  }

  const Icon = runStatusIcon(run)

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
                  aria-label="Back to workflow run list"
                  title="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', runStatusClassName(run))}>
                <Icon className="h-3 w-3" />
                {runStatusLabel(run)}
              </span>
              <span className="min-w-0 max-w-full truncate rounded-md bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                {run.headBranch || 'unknown branch'}
              </span>
            </div>
            <h2 className="line-clamp-2 break-words text-[15px] font-semibold leading-5 text-zinc-100 sm:text-base">
              {run.name}
            </h2>
            <p className="mt-1 truncate text-[11px] text-zinc-500">
              {run.repoFullName} · #{run.runNumber}.{run.runAttempt} · {run.event}
            </p>
          </div>
          {run.url ? (
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              aria-label="Open workflow run on GitHub"
              title="Open workflow run on GitHub"
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </div>
      <ScrollArea className="h-0 min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-4 sm:px-5 sm:py-5">
          <section className="overflow-hidden rounded-md border border-zinc-900 bg-zinc-950/40">
            <div className="flex min-w-0 items-center gap-2 border-b border-zinc-900 bg-[#070708] px-3 py-2">
              <Workflow className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <h3 className="truncate text-sm font-semibold text-zinc-100">Workflow run</h3>
            </div>
            <div className="space-y-4 px-3 py-3">
              <div>
                <div className="text-[11px] font-medium uppercase text-zinc-500">Display title</div>
                <div className="mt-1 break-words text-sm leading-6 text-zinc-300">{run.displayTitle || run.name}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoBlock label="Status" value={runStatusLabel(run)} />
                <InfoBlock label="Event" value={run.event} />
                <InfoBlock label="Branch" value={run.headBranch || 'unknown'} />
                <InfoBlock label="Head SHA" value={run.headSha || 'unknown'} mono />
                <InfoBlock label="Started" value={run.runStartedAt || run.createdAt || 'unknown'} />
                <InfoBlock label="Updated" value={run.updatedAt || 'unknown'} />
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-md border border-zinc-900 bg-zinc-950/40">
            <div className="flex min-w-0 items-center gap-2 border-b border-zinc-900 bg-[#070708] px-3 py-2">
              <ScrollText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <h3 className="truncate text-sm font-semibold text-zinc-100">Jobs & logs</h3>
            </div>
            <div className="space-y-3 px-3 py-3">
              {jobsLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading workflow jobs...
                </div>
              ) : jobs.length === 0 ? (
                <div className="rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-4 text-xs leading-5 text-zinc-500">
                  {jobsLoadMessage || 'No workflow jobs available for this run.'}
                </div>
              ) : (
                jobs.map((job) => {
                  const expanded = expandedJobId === job.id
                  const jobLogs = jobLogsById[job.id]
                  const jobLogsLoading = jobLogsLoadingJobId === job.id
                  const canLoadDownloadableLogs = job.status === 'completed'
                  const JobIcon = runStatusIcon({
                    ...run,
                    status: job.status,
                    conclusion: job.conclusion,
                  })

                  return (
                    <div key={job.id} className="overflow-hidden rounded-md border border-zinc-900 bg-zinc-950/70">
                      <button
                        type="button"
                        onClick={() => {
                          const nextExpanded = expanded ? '' : job.id
                          setExpandedJobId(nextExpanded)
                          if (!expanded && canLoadDownloadableLogs && (!jobLogs || !jobLogs.ok)) {
                            void onLoadJobLogs(job.id)
                          }
                        }}
                        className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-zinc-900/40"
                      >
                        {expanded ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />}
                        <JobIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-zinc-100">{job.name}</span>
                            <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', runStatusClassName({
                              ...run,
                              status: job.status,
                              conclusion: job.conclusion,
                            }))}>
                              {runStatusLabel({
                                ...run,
                                status: job.status,
                                conclusion: job.conclusion,
                              })}
                            </span>
                          </span>
                          <span className="mt-1 block text-[11px] text-zinc-500">
                            {job.steps.length} steps
                            {job.runnerName ? ` · ${job.runnerName}` : ''}
                            {job.startedAt ? ` · ${job.startedAt}` : ''}
                          </span>
                        </span>
                      </button>
                      {expanded ? (
                        <div className="space-y-3 border-t border-zinc-900 px-3 py-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <InfoBlock label="Runner" value={job.runnerName || 'unknown'} />
                            <InfoBlock label="Runner group" value={job.runnerGroupName || 'unknown'} />
                            <InfoBlock label="Started" value={job.startedAt || 'unknown'} />
                            <InfoBlock label="Completed" value={job.completedAt || 'unknown'} />
                          </div>
                          <div className="space-y-2">
                            <div className="text-[11px] font-medium uppercase text-zinc-500">Steps</div>
                            <div className="space-y-2">
                              {job.steps.map((step) => (
                                <div key={`${job.id}:${step.number}:${step.name}`} className="flex items-start justify-between gap-3 rounded-md border border-zinc-900 bg-[#0b0b0d] px-3 py-2 text-xs">
                                  <div className="min-w-0">
                                    <div className="text-zinc-200">{step.number}. {step.name}</div>
                                    <div className="mt-1 text-zinc-500">{step.startedAt || 'unknown'} {step.completedAt ? `→ ${step.completedAt}` : ''}</div>
                                  </div>
                                  <span className="shrink-0 text-zinc-400">{runStatusLabel({
                                    ...run,
                                    status: step.status,
                                    conclusion: step.conclusion,
                                  })}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[11px] font-medium uppercase text-zinc-500">Log excerpt</div>
                              {job.url ? (
                                <a
                                  href={job.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200"
                                >
                                  <SquareArrowOutUpRight className="h-3 w-3" />
                                  Job
                                </a>
                              ) : null}
                            </div>
                            {!canLoadDownloadableLogs ? (
                              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs leading-5 text-zinc-400">
                                Live logs for in-progress jobs are not available from GitHub&apos;s downloadable logs API yet. Open the GitHub job for real-time output, or refresh after the job completes.
                              </div>
                            ) : jobLogsLoading ? (
                              <div className="flex items-center gap-2 text-xs text-zinc-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading logs...
                              </div>
                            ) : jobLogs?.ok ? (
                              <div className="space-y-2">
                                <div className="text-[11px] text-zinc-500">
                                  {jobLogs.lineCount} lines{jobLogs.truncated ? ' · showing latest excerpt' : ''}
                                </div>
                                <Textarea
                                  readOnly
                                  value={jobLogs.excerpt || 'No logs available.'}
                                  className="min-h-[18rem] resize-none border-zinc-900 bg-[#0b0b0d] font-mono text-[11px] leading-5 text-zinc-300"
                                />
                              </div>
                            ) : (
                              <div className="space-y-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs text-zinc-400">
                                <div>{jobLogs?.message || jobLogsLoadMessage || 'Logs are unavailable for this job.'}</div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void onLoadJobLogs(job.id, { force: true })}
                                  className="h-7 rounded-md border border-amber-500/20 bg-transparent px-2 text-[11px] text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                                >
                                  Retry
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </section>

          {compactActions ? (
            <section className="border-t border-zinc-900 pt-4">
              {infoPanel}
            </section>
          ) : (
            <div className="hidden max-[1180px]:block">
              {infoPanel}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  )
}

function ActionsInfoPanel({
  jobCount,
  projectName,
  run,
}: {
  jobCount: number
  projectName?: string
  run: ProjectGitHubWorkflowRunSummary | null
}) {
  return (
    <aside className="flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#060607]">
      <div className="shrink-0 border-b border-zinc-900 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Run</h2>
        <p className="mt-1 text-[11px] text-zinc-600">GitHub Actions observability</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {run ? (
          <>
            {run.url ? (
              <a
                href={run.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 w-full items-center justify-start rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              >
                <SquareArrowOutUpRight className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Go to run</span>
              </a>
            ) : null}
            <section className="space-y-2 border-t border-zinc-900 pt-4">
              <h3 className="text-[11px] font-medium uppercase text-zinc-500">Info</h3>
              <InfoRow label="Project" value={projectName || run.repoFullName} />
              <InfoRow label="Repository" value={run.repoFullName} />
              <InfoRow label="Workflow" value={run.name} />
              <InfoRow label="Run" value={`#${run.runNumber}.${run.runAttempt}`} />
              <InfoRow label="Status" value={runStatusLabel(run)} />
              <InfoRow label="Jobs" value={String(jobCount)} />
              <InfoRow label="Branch" value={run.headBranch || 'unknown'} />
              <InfoRow label="Updated" value={formatRelativeDate(run.updatedAt || run.runStartedAt || run.createdAt) || 'now'} />
            </section>
          </>
        ) : (
          <p className="text-xs text-zinc-500">No workflow run selected.</p>
        )}
      </div>
    </aside>
  )
}

function InfoBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-900 bg-zinc-950/70 px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-zinc-600">{label}</div>
      <div className={cn('mt-1 min-w-0 break-words text-xs text-zinc-300', mono && 'font-mono')}>
        {value}
      </div>
    </div>
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
