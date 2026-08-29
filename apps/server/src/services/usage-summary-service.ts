// [INPUT]: usage_events 事件记录（recordUsageEvent 落库后）。
// [OUTPUT]: 多维 token 用量汇总（totals / daily / byAgent / byModel / byProvider / byWorkspace / byRunKind）。
// [POS]: 用量统计服务；供 Phase 3 API 与 Phase 4 看板消费，纯聚合函数可单测。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import type { UsageEventRecord } from '@shared/usage-events'

export type UsageSummaryPeriod = '7d' | '30d' | 'all'

export type UsageTotals = {
  runCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

export type UsageSummary = {
  totals: UsageTotals
  daily: Array<{ date: string; runCount: number; totalTokens: number }>
  byAgent: Array<{ agentId: string | null; agentName: string | null; runCount: number; totals: UsageTotals }>
  byModel: Array<{ executionModel: string | null; providerId: string | null; runCount: number; totals: UsageTotals }>
  byProvider: Array<{ providerId: string | null; runCount: number; totals: UsageTotals }>
  byWorkspace: Array<{ workspaceId: string | null; workspaceName: string | null; runCount: number; totals: UsageTotals }>
  byRunKind: Array<{ runKind: UsageEventRecord['runKind']; runCount: number; totals: UsageTotals }>
}

const emptyTotals = (): UsageTotals => ({
  runCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
})

const addTotals = (target: UsageTotals, event: UsageEventRecord) => {
  target.runCount += 1
  target.inputTokens += event.inputTokens
  target.outputTokens += event.outputTokens
  target.reasoningTokens += event.reasoningTokens
  target.cacheReadTokens += event.cacheReadTokens
  target.cacheWriteTokens += event.cacheWriteTokens
  target.totalTokens += event.totalTokens
  return target
}

const sortByTokensDesc = <T extends { totals: UsageTotals }>(rows: T[]) => (
  [...rows].sort((left, right) => right.totals.totalTokens - left.totals.totalTokens)
)

const resolvePeriodBucketCount = (period: UsageSummaryPeriod) => {
  if (period === '7d') return 7
  if (period === '30d') return 30
  return 0
}

const toUtcDateKey = (value: string) => value.slice(0, 10)

const withinPeriod = (createdAt: string, period: UsageSummaryPeriod, now: Date) => {
  if (period === 'all') return true
  const timestamp = Date.parse(createdAt)
  if (Number.isNaN(timestamp)) return false
  const days = period === '7d' ? 7 : 30
  return timestamp >= now.getTime() - days * 24 * 60 * 60 * 1000
}

export const summarizeUsageEvents = (
  events: UsageEventRecord[],
  period: UsageSummaryPeriod = 'all',
  now = new Date(),
): UsageSummary => {
  const relevant = events.filter((event) => withinPeriod(event.createdAt, period, now))
  const totals = emptyTotals()
  const dailyByDate = new Map<string, { date: string; runCount: number; totalTokens: number }>()
  const byAgent = new Map<string | null, { agentId: string | null; agentName: string | null; runCount: number; totals: UsageTotals }>()
  const byModel = new Map<string | null, { executionModel: string | null; providerId: string | null; runCount: number; totals: UsageTotals }>()
  const byProvider = new Map<string | null, { providerId: string | null; runCount: number; totals: UsageTotals }>()
  const byWorkspace = new Map<string | null, { workspaceId: string | null; workspaceName: string | null; runCount: number; totals: UsageTotals }>()
  const byRunKind = new Map<UsageEventRecord['runKind'], { runKind: UsageEventRecord['runKind']; runCount: number; totals: UsageTotals }>()

  for (const event of relevant) {
    addTotals(totals, event)

    const dateKey = toUtcDateKey(event.createdAt)
    const dailyBucket = dailyByDate.get(dateKey) ?? { date: dateKey, runCount: 0, totalTokens: 0 }
    dailyBucket.runCount += 1
    dailyBucket.totalTokens += event.totalTokens
    dailyByDate.set(dateKey, dailyBucket)

    const agentKey = event.agentId?.trim() || null
    const agentEntry = byAgent.get(agentKey) ?? {
      agentId: agentKey,
      agentName: event.agentName?.trim() || null,
      runCount: 0,
      totals: emptyTotals(),
    }
    if (event.agentName?.trim() && agentEntry.agentName !== event.agentName.trim()) {
      agentEntry.agentName = event.agentName.trim()
    }
    addTotals(agentEntry.totals, event)
    agentEntry.runCount += 1
    byAgent.set(agentKey, agentEntry)

    const modelKey = event.executionModel?.trim() || null
    const modelEntry = byModel.get(modelKey) ?? {
      executionModel: modelKey,
      providerId: event.providerId?.trim() || null,
      runCount: 0,
      totals: emptyTotals(),
    }
    addTotals(modelEntry.totals, event)
    modelEntry.runCount += 1
    byModel.set(modelKey, modelEntry)

    const providerKey = event.providerId?.trim() || null
    const providerEntry = byProvider.get(providerKey) ?? { providerId: providerKey, runCount: 0, totals: emptyTotals() }
    addTotals(providerEntry.totals, event)
    providerEntry.runCount += 1
    byProvider.set(providerKey, providerEntry)

    const workspaceKey = event.workspaceId?.trim() || null
    const workspaceEntry = byWorkspace.get(workspaceKey) ?? { workspaceId: workspaceKey, workspaceName: null, runCount: 0, totals: emptyTotals() }
    addTotals(workspaceEntry.totals, event)
    workspaceEntry.runCount += 1
    byWorkspace.set(workspaceKey, workspaceEntry)

    const runKindEntry = byRunKind.get(event.runKind) ?? { runKind: event.runKind, runCount: 0, totals: emptyTotals() }
    addTotals(runKindEntry.totals, event)
    runKindEntry.runCount += 1
    byRunKind.set(event.runKind, runKindEntry)
  }

  const bucketCount = resolvePeriodBucketCount(period)
  const endOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const effectiveBucketCount = bucketCount > 0
    ? bucketCount
    : (() => {
        const timestamps = relevant.map((event) => Date.parse(event.createdAt)).filter((value) => Number.isFinite(value))
        const earliest = timestamps.length > 0 ? Math.min(...timestamps) : endOfTodayUtc
        return Math.max(1, Math.floor((endOfTodayUtc - earliest) / (24 * 60 * 60 * 1000)) + 1)
      })()

  const daily = Array.from({ length: effectiveBucketCount }, (_, index) => {
    const date = new Date(endOfTodayUtc - (effectiveBucketCount - index - 1) * 24 * 60 * 60 * 1000)
    const dateKey = date.toISOString().slice(0, 10)
    return dailyByDate.get(dateKey) ?? { date: dateKey, runCount: 0, totalTokens: 0 }
  })

  return {
    totals,
    daily,
    byAgent: sortByTokensDesc([...byAgent.values()]),
    byModel: sortByTokensDesc([...byModel.values()]),
    byProvider: sortByTokensDesc([...byProvider.values()]),
    byWorkspace: sortByTokensDesc([...byWorkspace.values()]),
    byRunKind: sortByTokensDesc([...byRunKind.values()]),
  }
}

export const resolveUsagePeriod = (value: string | undefined): UsageSummaryPeriod => {
  const normalized = value?.trim()
  if (normalized === '7d' || normalized === '30d' || normalized === 'all') {
    return normalized
  }
  return 'all'
}
