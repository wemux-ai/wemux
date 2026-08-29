// [INPUT]: 用量事件
// [OUTPUT]: 汇总结果
// [POS]: 模型用量服务
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { parseExecutionModelId } from '@shared/model-profile'
import type { ModelTokenUsage, TaskRun } from '@shared/types'
import { listTaskRuns } from '../storage/app-state-store'

export type ModelUsageSummary = {
  totals: {
    runCount: number
    recordedTokenRunCount: number
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
  }
  daily: Array<{
    date: string
    runCount: number
    recordedTokenRunCount: number
    totalTokens: number
  }>
  byModel: Array<{
    executionModel: string
    providerId: string
    modelId: string
    runCount: number
    recordedTokenRunCount: number
    usage: ModelTokenUsage
    lastUsedAt: string
  }>
  byProvider: Array<{
    providerId: string
    runCount: number
    recordedTokenRunCount: number
    usage: ModelTokenUsage
    lastUsedAt: string
  }>
}

export type ModelUsagePeriod = '7d' | '30d' | 'all'
export type ModelUsageScope = {
  taskId?: string
  workspaceId?: string
  workspaceSessionId?: string
}

const emptyUsage = (): ModelTokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
})

const resolvePeriodBucketCount = (period: ModelUsagePeriod) => {
  if (period === '7d') {
    return 7
  }
  if (period === '30d') {
    return 30
  }
  return 0
}

const toUtcDateKey = (value: Date) => value.toISOString().slice(0, 10)

const buildDailyBuckets = (period: ModelUsagePeriod, now: Date, runs: TaskRun[]) => {
  const fixedBucketCount = resolvePeriodBucketCount(period)
  const endOfTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const bucketCount = fixedBucketCount > 0
    ? fixedBucketCount
    : (() => {
        const timestamps = runs
          .map((run) => new Date(run.updatedAt))
          .filter((date) => !Number.isNaN(date.getTime()))
          .map((date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
        const earliest = timestamps.length > 0 ? Math.min(...timestamps) : endOfTodayUtc
        return Math.max(1, Math.floor((endOfTodayUtc - earliest) / (24 * 60 * 60 * 1000)) + 1)
      })()

  return Array.from({ length: bucketCount }, (_, index) => {
    const offset = bucketCount - index - 1
    const date = new Date(endOfTodayUtc - offset * 24 * 60 * 60 * 1000)
    return {
      date: toUtcDateKey(date),
      runCount: 0,
      recordedTokenRunCount: 0,
      totalTokens: 0,
    }
  })
}

const addUsage = (target: ModelTokenUsage, usage?: ModelTokenUsage) => {
  if (!usage) {
    return target
  }

  target.inputTokens += usage.inputTokens || 0
  target.outputTokens += usage.outputTokens || 0
  target.reasoningTokens = (target.reasoningTokens || 0) + (usage.reasoningTokens || 0)
  target.cacheReadTokens = (target.cacheReadTokens || 0) + (usage.cacheReadTokens || 0)
  target.cacheWriteTokens = (target.cacheWriteTokens || 0) + (usage.cacheWriteTokens || 0)
  target.totalTokens += usage.totalTokens || 0
  return target
}

const pickRunUsage = (taskRun: TaskRun) => taskRun.usage ?? taskRun.result?.usage

const compareByRecentAndTokens = <T extends { lastUsedAt: string; usage: ModelTokenUsage }>(left: T, right: T) => {
  const tokenDelta = right.usage.totalTokens - left.usage.totalTokens
  if (tokenDelta !== 0) {
    return tokenDelta
  }
  return right.lastUsedAt.localeCompare(left.lastUsedAt)
}

const withinUsagePeriod = (updatedAt: string, period: ModelUsagePeriod, now = new Date()) => {
  if (period === 'all') {
    return true
  }

  const days = period === '7d' ? 7 : 30
  const timestamp = new Date(updatedAt).getTime()
  if (Number.isNaN(timestamp)) {
    return false
  }

  return timestamp >= (now.getTime() - days * 24 * 60 * 60 * 1000)
}

const matchesUsageScope = (run: TaskRun, scope?: ModelUsageScope) => {
  if (!scope) {
    return true
  }

  if (scope.taskId && run.taskId !== scope.taskId) {
    return false
  }
  if (scope.workspaceId && run.workspaceId !== scope.workspaceId) {
    return false
  }
  if (scope.workspaceSessionId && run.workspaceSessionId !== scope.workspaceSessionId) {
    return false
  }

  return true
}

export const summarizeModelUsage = (
  runs: TaskRun[],
  period: ModelUsagePeriod = 'all',
  now = new Date(),
  scope?: ModelUsageScope,
  isRunAccessible?: (run: TaskRun) => boolean,
): ModelUsageSummary => {
  const relevantRuns = runs.filter((run) => {
    if (!matchesUsageScope(run, scope)) {
      return false
    }
    if (!withinUsagePeriod(run.updatedAt, period, now)) {
      return false
    }
    if (!run.executionModel?.trim()) {
      return false
    }
    if (isRunAccessible && !isRunAccessible(run)) {
      return false
    }

    return true
  })
  const byModel = new Map<string, ModelUsageSummary['byModel'][number]>()
  const byProvider = new Map<string, ModelUsageSummary['byProvider'][number]>()
  const daily = buildDailyBuckets(period, now, relevantRuns)
  const dailyByDate = new Map(daily.map((bucket) => [bucket.date, bucket] as const))
  const totals = {
    runCount: 0,
    recordedTokenRunCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  }

  for (const run of relevantRuns) {
    const executionModel = run.executionModel?.trim() || ''

    const parsed = parseExecutionModelId(executionModel)
    const providerId = parsed?.providerId || 'unknown'
    const modelId = parsed?.modelId || executionModel
    const usage = pickRunUsage(run)

    totals.runCount += 1
    const runTimestamp = new Date(run.updatedAt)
    const runDateKey = Number.isNaN(runTimestamp.getTime()) ? '' : toUtcDateKey(runTimestamp)
    const dailyBucket = runDateKey ? dailyByDate.get(runDateKey) : undefined
    if (dailyBucket) {
      dailyBucket.runCount += 1
    }
    if (usage) {
      totals.recordedTokenRunCount += 1
      totals.inputTokens += usage.inputTokens || 0
      totals.outputTokens += usage.outputTokens || 0
      totals.reasoningTokens += usage.reasoningTokens || 0
      totals.cacheReadTokens += usage.cacheReadTokens || 0
      totals.cacheWriteTokens += usage.cacheWriteTokens || 0
      totals.totalTokens += usage.totalTokens || 0
      if (dailyBucket) {
        dailyBucket.recordedTokenRunCount += 1
        dailyBucket.totalTokens += usage.totalTokens || 0
      }
    }

    const modelEntry = byModel.get(executionModel) ?? {
      executionModel,
      providerId,
      modelId,
      runCount: 0,
      recordedTokenRunCount: 0,
      usage: emptyUsage(),
      lastUsedAt: run.updatedAt,
    }
    modelEntry.runCount += 1
    if (usage) {
      modelEntry.recordedTokenRunCount += 1
      addUsage(modelEntry.usage, usage)
    }
    if (run.updatedAt > modelEntry.lastUsedAt) {
      modelEntry.lastUsedAt = run.updatedAt
    }
    byModel.set(executionModel, modelEntry)

    const providerEntry = byProvider.get(providerId) ?? {
      providerId,
      runCount: 0,
      recordedTokenRunCount: 0,
      usage: emptyUsage(),
      lastUsedAt: run.updatedAt,
    }
    providerEntry.runCount += 1
    if (usage) {
      providerEntry.recordedTokenRunCount += 1
      addUsage(providerEntry.usage, usage)
    }
    if (run.updatedAt > providerEntry.lastUsedAt) {
      providerEntry.lastUsedAt = run.updatedAt
    }
    byProvider.set(providerId, providerEntry)
  }

  return {
    totals,
    daily,
    byModel: [...byModel.values()].sort(compareByRecentAndTokens),
    byProvider: [...byProvider.values()].sort(compareByRecentAndTokens),
  }
}

export const getModelUsageSummary = (period: ModelUsagePeriod = 'all', scope?: ModelUsageScope): ModelUsageSummary => {
  return summarizeModelUsage(listTaskRuns(), period, new Date(), scope)
}

export const buildUserUsageAccessFilter = (params: {
  userId: string
  accessibleWorkspaceIds: Set<string>
  accessibleProjectIds: Set<string>
}): (run: TaskRun) => boolean => {
  const { accessibleWorkspaceIds, accessibleProjectIds } = params
  return (run: TaskRun) => {
    const runWorkspaceId = run.workspaceId?.trim()
    const runProjectId = run.projectId?.trim()
    // 用户只能看到自己可访问的 workspace 或自己创建的 project 下的用量；
    // 无归属信息的旧 run 一律不可见，避免任何登录用户查看全站数据。
    const workspaceAccessible = Boolean(runWorkspaceId && accessibleWorkspaceIds.has(runWorkspaceId))
    const projectAccessible = Boolean(runProjectId && accessibleProjectIds.has(runProjectId))
    return workspaceAccessible || projectAccessible
  }
}

export const getModelUsageSummaryForUser = (params: {
  userId: string
  accessibleWorkspaceIds: Set<string>
  accessibleProjectIds: Set<string>
  period?: ModelUsagePeriod
  scope?: ModelUsageScope
}): ModelUsageSummary => {
  return summarizeModelUsage(
    listTaskRuns(),
    params.period ?? 'all',
    new Date(),
    params.scope,
    buildUserUsageAccessFilter(params),
  )
}
