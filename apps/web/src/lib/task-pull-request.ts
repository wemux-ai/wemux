import { syncTaskStatusFromReviewReady, syncTaskStatusFromWorkMerged, touchTaskStatus } from '@shared/task-status-flow'
import {
  isActiveGitHubResourceBinding,
  type GitHubResourceBinding,
  type ProjectPullRequestReviewSummary,
  type Task,
  type TaskExecutionResult,
} from '@shared/types'
import type { WorkspaceDeliveryPullRequestSummary } from '@shared/workspace-delivery'

export type TaskPullRequestSource = Pick<Task, 'result'> & Partial<Pick<Task, 'executionHistory' | 'updatedAt'>>

export type TaskPullRequestDisplay = {
  url?: string
  number?: number
  compareBranch?: string
  state: 'open' | 'merged' | 'closed' | 'unknown'
  label: string
  compactLabel: string
  toneClassName: string
  icon: 'open' | 'merged' | 'closed' | 'unknown'
}

export type TaskPullRequestSummary = {
  totalCount: number
  openCount: number
  mergedCount: number
  closedCount: number
  unknownCount: number
  latestDisplay: TaskPullRequestDisplay | null
}

type TaskPullRequestEntry = {
  key: string
  updatedAt: string
  workspaceId?: string
  workspaceSessionId?: string
  display: TaskPullRequestDisplay
}

type WorkspaceListPullRequestMatch = {
  display: TaskPullRequestDisplay
  matchedBy: 'workspace' | 'fallback'
}

type TaskPullRequestDisplaySource = {
  baseBranch?: string
  compareBranch?: string
  number?: number
  state?: string
  url?: string
}

type IdentifiedTaskPullRequest = TaskPullRequestDisplaySource & (
  | { number: number }
  | { url: string }
)

type TaskPullRequestUpdate = TaskPullRequestDisplaySource & {
  title: string
  body: string
  baseBranch: string
}

const resolveTaskPullRequestState = (state?: string): TaskPullRequestDisplay['state'] => {
  if (state === 'open' || state === 'merged' || state === 'closed') {
    return state
  }

  return 'unknown'
}

const hasPullRequestIdentity = (
  pullRequest?: TaskPullRequestDisplaySource | null,
): pullRequest is IdentifiedTaskPullRequest => {
  return Boolean(
    pullRequest?.url?.trim()
    || typeof pullRequest?.number === 'number',
  )
}

const buildTaskPullRequestDisplay = (
  pullRequest: TaskPullRequestDisplaySource,
): TaskPullRequestDisplay => {
  const state = resolveTaskPullRequestState(pullRequest.state)
  if (state === 'merged') {
    return {
      url: pullRequest.url,
      number: pullRequest.number,
      compareBranch: pullRequest.compareBranch?.trim() || undefined,
      state,
      label: 'PR 已合并',
      compactLabel: '已合并',
      toneClassName: 'bg-violet-500/10 text-violet-300',
      icon: 'merged',
    }
  }

  if (state === 'open') {
    return {
      url: pullRequest.url,
      number: pullRequest.number,
      compareBranch: pullRequest.compareBranch?.trim() || undefined,
      state,
      label: 'PR 审核中',
      compactLabel: 'PR',
      toneClassName: 'bg-emerald-500/10 text-emerald-300',
      icon: 'open',
    }
  }

  if (state === 'closed') {
    return {
      url: pullRequest.url,
      number: pullRequest.number,
      compareBranch: pullRequest.compareBranch?.trim() || undefined,
      state,
      label: 'PR 已关闭',
      compactLabel: '已关闭',
      toneClassName: 'bg-zinc-500/10 text-zinc-300',
      icon: 'closed',
    }
  }

  return {
    url: pullRequest.url,
    number: pullRequest.number,
    compareBranch: pullRequest.compareBranch?.trim() || undefined,
    state,
    label: 'PR 状态未知',
    compactLabel: 'PR',
    toneClassName: 'bg-zinc-500/10 text-zinc-300',
    icon: 'unknown',
  }
}

const buildTaskPullRequestEntryKey = (
  pullRequest: TaskPullRequestDisplaySource,
) => {
  const parts = [
    pullRequest.url?.trim() || '',
    typeof pullRequest.number === 'number' ? String(pullRequest.number) : '',
    pullRequest.compareBranch?.trim() || '',
    pullRequest.baseBranch?.trim() || '',
  ].filter(Boolean)

  return parts.join('\u0000')
}

const buildTaskPullRequestEntry = (params: {
  result?: Pick<TaskExecutionResult, 'workspaceId' | 'workspaceSessionId' | 'delivery'>
  updatedAt?: string
}) => {
  const pullRequest = params.result?.delivery?.pullRequest
  if (!hasPullRequestIdentity(pullRequest)) {
    return null
  }

  const key = buildTaskPullRequestEntryKey(pullRequest)
  if (!key) {
    return null
  }

  return {
    key,
    updatedAt: params.updatedAt?.trim() || '',
    workspaceId: params.result?.workspaceId?.trim() || undefined,
    workspaceSessionId: params.result?.workspaceSessionId?.trim() || undefined,
    display: buildTaskPullRequestDisplay(pullRequest),
  } satisfies TaskPullRequestEntry
}

const mergeTaskPullRequestEntry = (left: TaskPullRequestEntry, right: TaskPullRequestEntry) => {
  const latest = right.updatedAt.localeCompare(left.updatedAt) >= 0 ? right : left
  const fallback = latest === right ? left : right

  return {
    ...latest,
    workspaceId: latest.workspaceId || fallback.workspaceId,
    workspaceSessionId: latest.workspaceSessionId || fallback.workspaceSessionId,
    display: {
      ...latest.display,
      url: latest.display.url || fallback.display.url,
      number: latest.display.number ?? fallback.display.number,
      compareBranch: latest.display.compareBranch || fallback.display.compareBranch,
    },
  } satisfies TaskPullRequestEntry
}

const compareTaskPullRequestEntriesDesc = (left: TaskPullRequestEntry, right: TaskPullRequestEntry) => (
  right.updatedAt.localeCompare(left.updatedAt)
  || (right.workspaceId || '').localeCompare(left.workspaceId || '')
  || (right.display.url || '').localeCompare(left.display.url || '')
  || String(right.display.number ?? '').localeCompare(String(left.display.number ?? ''))
)

export const listTaskPullRequestEntries = (
  task?: TaskPullRequestSource | null,
) => {
  const entriesByKey = new Map<string, TaskPullRequestEntry>()

  const upsertEntry = (entry: TaskPullRequestEntry | null) => {
    if (!entry) {
      return
    }

    const current = entriesByKey.get(entry.key)
    if (!current) {
      entriesByKey.set(entry.key, entry)
      return
    }

    entriesByKey.set(entry.key, mergeTaskPullRequestEntry(current, entry))
  }

  for (const executionRun of task?.executionHistory ?? []) {
    const updatedAt = executionRun.updatedAt?.trim()
      || executionRun.result?.completedAt?.trim()
      || executionRun.createdAt?.trim()
      || ''
    upsertEntry(buildTaskPullRequestEntry({
      result: executionRun.result
        ? {
            ...executionRun.result,
            workspaceId: executionRun.result.workspaceId?.trim() || executionRun.workspaceId?.trim() || undefined,
            workspaceSessionId: executionRun.result.workspaceSessionId?.trim() || undefined,
          }
        : undefined,
      updatedAt,
    }))
  }

  upsertEntry(buildTaskPullRequestEntry({
    result: task?.result,
    updatedAt: task?.updatedAt?.trim() || task?.result?.completedAt?.trim() || '',
  }))

  return [...entriesByKey.values()].sort(compareTaskPullRequestEntriesDesc)
}

export const resolveTaskWorkspacePullRequestDisplay = (params: {
  task?: TaskPullRequestSource | null
  workspaceId?: string
}) => {
  const workspaceId = params.workspaceId?.trim() || ''
  const entries = listTaskPullRequestEntries(params.task)
  if (workspaceId) {
    const scopedEntry = entries.find((entry) => entry.workspaceId === workspaceId)
    if (scopedEntry) {
      return scopedEntry.display
    }

    const unscopedEntries = entries.filter((entry) => !entry.workspaceId)
    return unscopedEntries.length === 1 ? unscopedEntries[0]?.display ?? null : null
  }

  return entries[0]?.display ?? null
}

export const resolveLinkedWorkspacePullRequestDisplay = (params: {
  tasks: TaskPullRequestSource[]
  workspaceId?: string
}) => {
  return resolveLinkedWorkspacePullRequestMatch(params)?.display ?? null
}

const resolveLinkedWorkspacePullRequestMatch = (params: {
  tasks: TaskPullRequestSource[]
  workspaceId?: string
}): WorkspaceListPullRequestMatch | null => {
  const workspaceId = params.workspaceId?.trim() || ''
  const entries = params.tasks.flatMap((task) => listTaskPullRequestEntries(task))

  if (workspaceId) {
    const scopedEntry = entries
      .filter((entry) => entry.workspaceId === workspaceId)
      .sort(compareTaskPullRequestEntriesDesc)[0]
    if (scopedEntry) {
      return {
        display: scopedEntry.display,
        matchedBy: 'workspace',
      }
    }

    const unscopedEntries = entries
      .filter((entry) => !entry.workspaceId)
      .sort(compareTaskPullRequestEntriesDesc)

    return unscopedEntries.length === 1 && unscopedEntries[0]
      ? {
          display: unscopedEntries[0].display,
          matchedBy: 'fallback',
        }
      : null
  }

  const latestEntry = entries.sort(compareTaskPullRequestEntriesDesc)[0]
  return latestEntry
    ? {
        display: latestEntry.display,
        matchedBy: 'fallback',
      }
    : null
}

export const resolveWorkspaceDeliveryPullRequestDisplay = (
  pullRequest?: WorkspaceDeliveryPullRequestSummary | null,
) => {
  if (!hasPullRequestIdentity(pullRequest)) {
    return null
  }

  return buildTaskPullRequestDisplay({
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    compareBranch: pullRequest.compareBranch,
  })
}

const githubPullRequestUrlPattern = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d+)/i

export const resolveWorkspaceSessionPreviewPullRequestDisplay = (params: {
  text?: string
  compareBranch?: string
}): TaskPullRequestDisplay | null => {
  const text = params.text?.trim() || ''
  if (!text) {
    return null
  }

  const match = githubPullRequestUrlPattern.exec(text)
  if (!match?.[0]) {
    return null
  }

  const number = Number.parseInt(match[1] ?? '', 10)
  const normalizedCompareBranch = normalizePullRequestBranch(params.compareBranch)
  const state = /已合并|merged/i.test(text)
    ? 'merged'
    : /已关闭|closed/i.test(text)
      ? 'closed'
      : 'open'

  return buildTaskPullRequestDisplay({
    url: match[0],
    number: Number.isFinite(number) ? number : undefined,
    state,
    compareBranch: normalizedCompareBranch || undefined,
  })
}

const normalizePullRequestBranch = (value?: string | null) => value?.trim() || ''

const compareProjectPullRequestsDesc = (
  left: ProjectPullRequestReviewSummary,
  right: ProjectPullRequestReviewSummary,
) => {
  const rightUpdatedAt = right.updatedAt || right.mergedAt || right.closedAt || right.syncedAt
  const leftUpdatedAt = left.updatedAt || left.mergedAt || left.closedAt || left.syncedAt
  return rightUpdatedAt.localeCompare(leftUpdatedAt)
    || right.syncedAt.localeCompare(left.syncedAt)
    || right.number - left.number
}

export const resolveProjectPullRequestDisplay = (
  pullRequest?: ProjectPullRequestReviewSummary | null,
) => {
  if (!pullRequest) {
    return null
  }

  return buildTaskPullRequestDisplay({
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    compareBranch: pullRequest.compareBranch,
  })
}

const listTaskIndexedPullRequests = (params: {
  pullRequests: ProjectPullRequestReviewSummary[]
  bindings?: GitHubResourceBinding[]
  projectId?: string
  taskId?: string
}) => {
  const projectId = params.projectId?.trim() || ''
  const taskId = params.taskId?.trim() || ''
  if (!taskId) {
    return []
  }

  const projectPullRequests = params.pullRequests
    .filter((pullRequest) => !projectId || pullRequest.projectId === projectId)
    .sort(compareProjectPullRequestsDesc)
  if (params.bindings) {
    const resourceIds = new Set(
      params.bindings
        .filter(isActiveGitHubResourceBinding)
        .filter((binding) => (
          binding.resourceType === 'pull_request'
          && binding.taskId === taskId
          && (!projectId || binding.projectId === projectId)
        ))
        .map((binding) => binding.resourceId),
    )
    return projectPullRequests.filter((pullRequest) => resourceIds.has(pullRequest.id))
  }

  // Compatibility for callers that have not moved to the canonical binding API yet.
  return projectPullRequests.filter((pullRequest) => pullRequest.matchedTaskId === taskId)
}

export const resolveTaskIndexedPullRequestDisplay = (params: {
  pullRequests: ProjectPullRequestReviewSummary[]
  bindings?: GitHubResourceBinding[]
  projectId?: string
  taskId?: string
}) => {
  return resolveProjectPullRequestDisplay(listTaskIndexedPullRequests(params)[0])
}

export const summarizeTaskIndexedPullRequests = (params: {
  pullRequests: ProjectPullRequestReviewSummary[]
  bindings: GitHubResourceBinding[]
  projectId?: string
  taskId?: string
}): TaskPullRequestSummary => {
  const matchedPullRequests = listTaskIndexedPullRequests(params)
  const summary: TaskPullRequestSummary = {
    totalCount: matchedPullRequests.length,
    openCount: 0,
    mergedCount: 0,
    closedCount: 0,
    unknownCount: 0,
    latestDisplay: resolveProjectPullRequestDisplay(matchedPullRequests[0]),
  }

  for (const pullRequest of matchedPullRequests) {
    const state = resolveTaskPullRequestState(pullRequest.state)
    if (state === 'open') summary.openCount += 1
    else if (state === 'merged') summary.mergedCount += 1
    else if (state === 'closed') summary.closedCount += 1
    else summary.unknownCount += 1
  }

  return summary
}

export const resolveWorkspaceIndexedPullRequestDisplay = (params: {
  pullRequests: ProjectPullRequestReviewSummary[]
  bindings?: GitHubResourceBinding[]
  projectId?: string
  workspaceId?: string
  workspaceSessionIds?: string[]
  compareBranch?: string
}) => {
  const projectId = params.projectId?.trim() || ''
  const workspaceId = params.workspaceId?.trim() || ''
  const workspaceSessionIds = new Set(
    (params.workspaceSessionIds ?? [])
      .map((workspaceSessionId) => workspaceSessionId.trim())
      .filter(Boolean),
  )
  const compareBranch = normalizePullRequestBranch(params.compareBranch)
  const projectPullRequests = params.pullRequests
    .filter((pullRequest) => !projectId || pullRequest.projectId === projectId)
    .sort(compareProjectPullRequestsDesc)

  if (params.bindings) {
    const resourceIds = new Set(
      params.bindings
        .filter(isActiveGitHubResourceBinding)
        .filter((binding) => (
          binding.resourceType === 'pull_request'
          && (!projectId || binding.projectId === projectId)
          && (
            (workspaceId && binding.workspaceId === workspaceId)
            || (
              binding.workspaceSessionId
              && workspaceSessionIds.has(binding.workspaceSessionId)
            )
          )
        ))
        .map((binding) => binding.resourceId),
    )
    return resolveProjectPullRequestDisplay(
      projectPullRequests.find((pullRequest) => resourceIds.has(pullRequest.id)),
    )
  }

  if (workspaceId) {
    const matchedWorkspacePullRequest = projectPullRequests.find((pullRequest) => (
      pullRequest.matchedWorkspaceId === workspaceId
    ))
    if (matchedWorkspacePullRequest) {
      return resolveProjectPullRequestDisplay(matchedWorkspacePullRequest)
    }
  }

  if (workspaceSessionIds.size > 0) {
    const matchedSessionPullRequest = projectPullRequests.find((pullRequest) => (
      pullRequest.matchedWorkspaceSessionId
      && workspaceSessionIds.has(pullRequest.matchedWorkspaceSessionId)
    ))
    if (matchedSessionPullRequest) {
      return resolveProjectPullRequestDisplay(matchedSessionPullRequest)
    }
  }

  if (compareBranch) {
    const matchedBranchPullRequest = projectPullRequests.find((pullRequest) => (
      normalizePullRequestBranch(pullRequest.compareBranch) === compareBranch
    ))
    if (matchedBranchPullRequest) {
      return resolveProjectPullRequestDisplay(matchedBranchPullRequest)
    }
  }

  return null
}

const pullRequestDisplayMatchesCompareBranch = (
  display: TaskPullRequestDisplay | null,
  compareBranch?: string,
) => {
  const normalizedCompareBranch = normalizePullRequestBranch(compareBranch)
  if (!display || !normalizedCompareBranch || !display.compareBranch) {
    return display
  }

  return display.compareBranch === normalizedCompareBranch ? display : null
}

const resolveWorkspaceDeliveryPullRequestMatch = (params: {
  workspaceId?: string
  pullRequest?: WorkspaceDeliveryPullRequestSummary | null
}): WorkspaceListPullRequestMatch | null => {
  const display = resolveWorkspaceDeliveryPullRequestDisplay(params.pullRequest)
  if (!display) {
    return null
  }

  const workspaceId = params.workspaceId?.trim() || ''
  const matchedWorkspaceId = params.pullRequest?.workspaceId?.trim() || ''
  return {
    display,
    matchedBy: workspaceId && matchedWorkspaceId === workspaceId ? 'workspace' : 'fallback',
  }
}

export const resolveWorkspaceListPullRequestDisplay = (params: {
  tasks: TaskPullRequestSource[]
  workspaceId?: string
  compareBranch?: string
  pullRequest?: WorkspaceDeliveryPullRequestSummary | null
}) => {
  const linkedMatch = resolveLinkedWorkspacePullRequestMatch({
    tasks: params.tasks,
    workspaceId: params.workspaceId,
  })
  if (linkedMatch?.matchedBy === 'workspace') {
    return linkedMatch.display
  }

  const deliveryMatch = resolveWorkspaceDeliveryPullRequestMatch({
    workspaceId: params.workspaceId,
    pullRequest: params.pullRequest,
  })
  if (deliveryMatch?.matchedBy === 'workspace') {
    return deliveryMatch.display
  }

  return pullRequestDisplayMatchesCompareBranch(linkedMatch?.display ?? null, params.compareBranch)
    ?? pullRequestDisplayMatchesCompareBranch(deliveryMatch?.display ?? null, params.compareBranch)
}

export const summarizeTaskPullRequests = (
  task?: TaskPullRequestSource | null,
): TaskPullRequestSummary => {
  const latestEntries = new Map<string, TaskPullRequestEntry>()
  for (const entry of listTaskPullRequestEntries(task)) {
    const summaryKey = entry.workspaceId ? `workspace:${entry.workspaceId}` : `pr:${entry.key}`
    const current = latestEntries.get(summaryKey)
    latestEntries.set(summaryKey, current ? mergeTaskPullRequestEntry(current, entry) : entry)
  }

  const groupedEntries = [...latestEntries.values()].sort(compareTaskPullRequestEntriesDesc)
  const summary: TaskPullRequestSummary = {
    totalCount: groupedEntries.length,
    openCount: 0,
    mergedCount: 0,
    closedCount: 0,
    unknownCount: 0,
    latestDisplay: groupedEntries[0]?.display ?? null,
  }

  for (const entry of groupedEntries) {
    if (entry.display.state === 'open') {
      summary.openCount += 1
    } else if (entry.display.state === 'merged') {
      summary.mergedCount += 1
    } else if (entry.display.state === 'closed') {
      summary.closedCount += 1
    } else {
      summary.unknownCount += 1
    }
  }

  return summary
}

const createSyntheticTaskResult = (params: {
  task: Task
  updatedAt: string
  executorNodeId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => ({
  taskId: params.task.id,
  status: 'completed' as const,
  returnMode: 'commit' as const,
  summary: 'PR status recorded.',
  filesChanged: [],
  startedAt: params.updatedAt,
  completedAt: params.updatedAt,
  durationSec: 0,
  executorNodeId: params.executorNodeId ?? params.task.executionHistory.at(-1)?.executorNodeId ?? '',
  workspaceId: params.workspaceId,
  workspaceSessionId: params.workspaceSessionId,
})

export const resolveTaskPullRequestDisplay = (task?: TaskPullRequestSource | null): TaskPullRequestDisplay | null => {
  return listTaskPullRequestEntries(task)[0]?.display ?? null
}

export const applyTaskPullRequestResult = (params: {
  task: Task
  pullRequest: TaskPullRequestUpdate
  repoUrl: string
  updatedAt?: string
  executorNodeId?: string
  workspaceId?: string
  workspaceSessionId?: string
}) => {
  const updatedAt = params.updatedAt ?? new Date().toISOString()
  const pullRequestState = resolveTaskPullRequestState(params.pullRequest.state)
  const nextResult = params.task.result
    ? {
        ...params.task.result,
        workspaceId: params.workspaceId ?? params.task.result.workspaceId,
        workspaceSessionId: params.workspaceSessionId ?? params.task.result.workspaceSessionId,
        delivery: {
          ...(params.task.result.delivery ?? { mode: params.task.result.returnMode }),
          pullRequest: {
            ready: true,
            remoteReady: true,
            repoUrl: params.repoUrl,
            title: params.pullRequest.title,
            description: params.pullRequest.body,
            baseBranch: params.pullRequest.baseBranch,
            compareBranch: params.pullRequest.compareBranch,
            number: params.pullRequest.number,
            url: params.pullRequest.url,
            state: params.pullRequest.state,
          },
          syncFailureReason: undefined,
        },
      }
    : {
        ...createSyntheticTaskResult({
          task: params.task,
          updatedAt,
          executorNodeId: params.executorNodeId,
          workspaceId: params.workspaceId,
          workspaceSessionId: params.workspaceSessionId,
        }),
        delivery: {
          mode: 'commit' as const,
          pullRequest: {
            ready: true,
            remoteReady: true,
            repoUrl: params.repoUrl,
            title: params.pullRequest.title,
            description: params.pullRequest.body,
            baseBranch: params.pullRequest.baseBranch,
            compareBranch: params.pullRequest.compareBranch,
            number: params.pullRequest.number,
            url: params.pullRequest.url,
            state: params.pullRequest.state,
          },
        },
      }

  const nextTaskBase = {
    ...params.task,
    updatedAt,
    result: nextResult,
  }
  const currentStep = pullRequestState === 'merged'
    ? (params.pullRequest.url ? `PR 已合并：${params.pullRequest.url}` : `PR #${params.pullRequest.number} 已合并`)
    : pullRequestState === 'open'
      ? (params.pullRequest.url ? `PR 审核中：${params.pullRequest.url}` : `PR #${params.pullRequest.number} 审核中`)
      : (params.pullRequest.url ? `PR 已关闭：${params.pullRequest.url}` : `PR #${params.pullRequest.number} 已关闭`)

  const nextTask = pullRequestState === 'merged'
    ? syncTaskStatusFromWorkMerged(nextTaskBase, updatedAt)
    : pullRequestState === 'open'
      ? syncTaskStatusFromReviewReady(nextTaskBase, updatedAt)
      : touchTaskStatus(nextTaskBase, updatedAt)

  return {
    ...nextTask,
    currentStep,
    needsHumanConfirm: pullRequestState !== 'merged',
    agentRunningStatus: 'complete' as const,
  } satisfies Task
}
