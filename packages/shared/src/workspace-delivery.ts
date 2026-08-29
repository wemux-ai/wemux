// [INPUT]: 交付输入
// [OUTPUT]: 交付契约
// [POS]: 工作区交付类型
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

export type WorkspaceDeliveryPullRequestState = 'open' | 'merged' | 'closed' | 'unknown'

export interface WorkspaceDeliveryPullRequestSummary {
  state: WorkspaceDeliveryPullRequestState
  updatedAt: string
  url?: string
  number?: number
  compareBranch?: string
  workspaceId?: string
  workspaceSessionId?: string
}

export interface WorkspaceDeliverySummary {
  pullRequest?: WorkspaceDeliveryPullRequestSummary
}

type PullRequestSnapshot = {
  url?: string
  number?: number
  state?: string
  compareBranch?: string
  baseBranch?: string
}

type DeliveryResultSnapshot = {
  workspaceId?: string
  workspaceSessionId?: string
  completedAt?: string
  delivery?: {
    pullRequest?: PullRequestSnapshot
  }
}

export type WorkspaceDeliveryTaskSource = {
  result?: DeliveryResultSnapshot | null
  executionHistory?: Array<{
    result?: DeliveryResultSnapshot | null
    workspaceId?: string
    createdAt?: string
    updatedAt?: string
  }>
  updatedAt?: string
}

export type WorkspaceDeliverySessionSource = {
  id: string
  workspaceId: string
  deliverySummary?: WorkspaceDeliverySummary
  updatedAt?: string
  lastActiveAt?: string
}

type WorkspaceDeliveryPullRequestEntry = WorkspaceDeliveryPullRequestSummary & {
  key: string
}

const normalizeText = (value?: string | null) => value?.trim() || ''

export const normalizeWorkspaceDeliveryPullRequestState = (
  state?: string,
): WorkspaceDeliveryPullRequestState => {
  if (state === 'open' || state === 'merged' || state === 'closed') {
    return state
  }

  return 'unknown'
}

const hasPullRequestClue = (pullRequest?: PullRequestSnapshot) => Boolean(
  normalizeText(pullRequest?.url)
  || typeof pullRequest?.number === 'number'
  || normalizeText(pullRequest?.compareBranch),
)

const buildPullRequestEntryKey = (pullRequest: PullRequestSnapshot) => [
  normalizeText(pullRequest.url),
  typeof pullRequest.number === 'number' ? String(pullRequest.number) : '',
  normalizeText(pullRequest.compareBranch),
  normalizeText(pullRequest.baseBranch),
].filter(Boolean).join('\u0000')

const buildPullRequestEntry = (params: {
  result?: DeliveryResultSnapshot | null
  updatedAt?: string
}): WorkspaceDeliveryPullRequestEntry | null => {
  const pullRequest = params.result?.delivery?.pullRequest
  if (!pullRequest || !hasPullRequestClue(pullRequest)) {
    return null
  }

  const key = buildPullRequestEntryKey(pullRequest)
  if (!key) {
    return null
  }

  return {
    key,
    state: normalizeWorkspaceDeliveryPullRequestState(pullRequest.state),
    updatedAt: normalizeText(params.updatedAt) || normalizeText(params.result?.completedAt),
    url: normalizeText(pullRequest.url) || undefined,
    number: typeof pullRequest.number === 'number' ? pullRequest.number : undefined,
    compareBranch: normalizeText(pullRequest.compareBranch) || undefined,
    workspaceId: normalizeText(params.result?.workspaceId) || undefined,
    workspaceSessionId: normalizeText(params.result?.workspaceSessionId) || undefined,
  }
}

const mergePullRequestEntries = (
  left: WorkspaceDeliveryPullRequestEntry,
  right: WorkspaceDeliveryPullRequestEntry,
) => {
  const latest = right.updatedAt.localeCompare(left.updatedAt) >= 0 ? right : left
  const fallback = latest === right ? left : right

  return {
    ...latest,
    workspaceId: latest.workspaceId || fallback.workspaceId,
    workspaceSessionId: latest.workspaceSessionId || fallback.workspaceSessionId,
    url: latest.url || fallback.url,
    number: latest.number ?? fallback.number,
    compareBranch: latest.compareBranch || fallback.compareBranch,
  }
}

const comparePullRequestEntriesDesc = (
  left: WorkspaceDeliveryPullRequestEntry,
  right: WorkspaceDeliveryPullRequestEntry,
) => (
  right.updatedAt.localeCompare(left.updatedAt)
  || (right.workspaceId || '').localeCompare(left.workspaceId || '')
  || (right.url || '').localeCompare(left.url || '')
  || String(right.number ?? '').localeCompare(String(left.number ?? ''))
)

const buildSessionPullRequestEntry = (
  session: WorkspaceDeliverySessionSource,
): WorkspaceDeliveryPullRequestEntry | null => {
  const pullRequest = session.deliverySummary?.pullRequest
  if (!pullRequest) {
    return null
  }

  const key = [
    normalizeText(pullRequest.url),
    typeof pullRequest.number === 'number' ? String(pullRequest.number) : '',
    normalizeText(pullRequest.compareBranch),
    normalizeText(session.id),
  ].filter(Boolean).join('\u0000')
  if (!key) {
    return null
  }

  return {
    key,
    state: normalizeWorkspaceDeliveryPullRequestState(pullRequest.state),
    updatedAt: normalizeText(pullRequest.updatedAt)
      || normalizeText(session.updatedAt)
      || normalizeText(session.lastActiveAt),
    url: normalizeText(pullRequest.url) || undefined,
    number: typeof pullRequest.number === 'number' ? pullRequest.number : undefined,
    compareBranch: normalizeText(pullRequest.compareBranch) || undefined,
    workspaceId: normalizeText(pullRequest.workspaceId) || normalizeText(session.workspaceId) || undefined,
    workspaceSessionId: normalizeText(pullRequest.workspaceSessionId) || normalizeText(session.id) || undefined,
  }
}

export const listWorkspaceDeliveryPullRequestEntries = (
  tasks: WorkspaceDeliveryTaskSource[],
  sessions: WorkspaceDeliverySessionSource[] = [],
) => {
  const entriesByKey = new Map<string, WorkspaceDeliveryPullRequestEntry>()

  const upsertEntry = (entry: WorkspaceDeliveryPullRequestEntry | null) => {
    if (!entry) {
      return
    }

    const current = entriesByKey.get(entry.key)
    entriesByKey.set(entry.key, current ? mergePullRequestEntries(current, entry) : entry)
  }

  for (const task of tasks) {
    for (const executionRun of task.executionHistory ?? []) {
      const updatedAt = normalizeText(executionRun.updatedAt)
        || normalizeText(executionRun.result?.completedAt)
        || normalizeText(executionRun.createdAt)
      upsertEntry(buildPullRequestEntry({
        result: executionRun.result
          ? {
              ...executionRun.result,
              workspaceId: normalizeText(executionRun.result.workspaceId) || normalizeText(executionRun.workspaceId) || undefined,
            }
          : undefined,
        updatedAt,
      }))
    }

    upsertEntry(buildPullRequestEntry({
      result: task.result,
      updatedAt: normalizeText(task.updatedAt) || normalizeText(task.result?.completedAt),
    }))
  }

  for (const session of sessions) {
    upsertEntry(buildSessionPullRequestEntry(session))
  }

  return [...entriesByKey.values()].sort(comparePullRequestEntriesDesc)
}

export const buildWorkspaceDeliverySummary = (
  tasks: WorkspaceDeliveryTaskSource[],
  workspaceId?: string,
  sessions: WorkspaceDeliverySessionSource[] = [],
): WorkspaceDeliverySummary | undefined => {
  const normalizedWorkspaceId = normalizeText(workspaceId)
  const entries = listWorkspaceDeliveryPullRequestEntries(tasks, sessions)
  const pullRequest = normalizedWorkspaceId
    ? entries.find((entry) => entry.workspaceId === normalizedWorkspaceId)
      ?? (entries.filter((entry) => !entry.workspaceId).length === 1
        ? entries.find((entry) => !entry.workspaceId)
        : undefined)
    : entries[0]

  if (!pullRequest) {
    return undefined
  }

  return {
    pullRequest: {
      state: pullRequest.state,
      updatedAt: pullRequest.updatedAt,
      url: pullRequest.url,
      number: pullRequest.number,
      compareBranch: pullRequest.compareBranch,
      workspaceId: pullRequest.workspaceId,
      workspaceSessionId: pullRequest.workspaceSessionId,
    },
  }
}
