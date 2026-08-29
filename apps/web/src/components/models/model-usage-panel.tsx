import type { ModelUsageSummaryResponse } from '../../lib/api'
import { cn } from '../../lib/utils'
import { ChartCard } from '../dashboard/dashboard-sections'

const formatTokenCount = (value: number) => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return String(value)
}

const formatPercent = (value: number) => `${Math.round(value)}%`

const formatRatio = (value: number, total: number) => {
  if (total <= 0) {
    return '0%'
  }
  return formatPercent((value / total) * 100)
}

const buildArcPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
  const startX = cx + r * Math.cos(startAngle)
  const startY = cy + r * Math.sin(startAngle)
  const endX = cx + r * Math.cos(endAngle)
  const endY = cy + r * Math.sin(endAngle)
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}`
}

const tokenMixPalette = [
  { key: 'inputTokens', tone: 'stroke-cyan-400 text-cyan-300 bg-cyan-400/15' },
  { key: 'outputTokens', tone: 'stroke-emerald-400 text-emerald-300 bg-emerald-400/15' },
  { key: 'reasoningTokens', tone: 'stroke-amber-400 text-amber-300 bg-amber-400/15' },
  { key: 'cacheReadTokens', tone: 'stroke-violet-400 text-violet-300 bg-violet-400/15' },
  { key: 'cacheWriteTokens', tone: 'stroke-fuchsia-400 text-fuchsia-300 bg-fuchsia-400/15' },
] as const

const providerPalette = [
  'bg-cyan-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-violet-400',
  'bg-fuchsia-400',
  'bg-rose-400',
] as const

function TrendLineChart({
  summary,
  language,
}: {
  summary: ModelUsageSummaryResponse['summary']
  language: 'zh' | 'en'
}) {
  const points = summary.daily.map((bucket) => {
    const date = new Date(`${bucket.date}T00:00:00.000Z`)
    const label = Number.isNaN(date.getTime())
      ? bucket.date
      : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`

    return {
      label,
      totalTokens: bucket.totalTokens,
      runCount: bucket.runCount,
    }
  })
  const values = points.map((point) => point.totalTokens)
  const maxValue = Math.max(...values, 0)
  const hasData = values.some((value) => value > 0)

  if (!hasData) {
    return <p className="text-xs text-zinc-500">{language === 'zh' ? '当前时间范围内还没有 token 趋势数据。' : 'No token trend data in this period yet.'}</p>
  }

  const width = 320
  const height = 96
  const paddingLeft = 8
  const paddingRight = 8
  const paddingTop = 8
  const paddingBottom = 14
  const innerWidth = width - paddingLeft - paddingRight
  const innerHeight = height - paddingTop - paddingBottom
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0
  const coordinates = values.map((value, index) => {
    const x = paddingLeft + step * index
    const y = paddingTop + innerHeight - (maxValue > 0 ? (value / maxValue) * innerHeight : 0)
    return { x, y, value, label: points[index]?.label ?? '' }
  })
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const areaPath = `${linePath} L ${paddingLeft + innerWidth} ${paddingTop + innerHeight} L ${paddingLeft} ${paddingTop + innerHeight} Z`
  const middlePoint = points[Math.floor(points.length / 2)]

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible">
        <defs>
          <linearGradient id="model-usage-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(34,211,238,0.22)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0)" />
          </linearGradient>
        </defs>

        {[0.2, 0.5, 0.8].map((offset) => {
          const y = paddingTop + innerHeight * offset
          return <line key={offset} x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y} y2={y} stroke="rgba(63,63,70,0.65)" strokeDasharray="4 5" />
        })}

        <path d={areaPath} fill="url(#model-usage-trend-fill)" />
        <path d={linePath} fill="none" stroke="#22d3ee" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" />

        {coordinates.map((point, index) => (
          <circle
            key={`${point.label}-${index}`}
            cx={point.x}
            cy={point.y}
            r={index === coordinates.length - 1 ? 4 : 3}
            fill={index === coordinates.length - 1 ? '#67e8f9' : '#a5f3fc'}
            opacity={point.value > 0 ? 1 : 0.45}
          />
        ))}
      </svg>
      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
        <span className="truncate text-left">{points[0]?.label ?? ''}</span>
        <span className="truncate text-center">{middlePoint?.label ?? ''}</span>
        <span className="truncate text-right">{points.at(-1)?.label ?? ''}</span>
      </div>
    </div>
  )
}

function UsageBarList({
  rows,
  total,
  emptyLabel,
}: {
  rows: Array<{ label: string; value: number; meta: string; tone?: string }>
  total: number
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-zinc-500">{emptyLabel}</p>
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        const width = total > 0 ? Math.max(6, (row.value / total) * 100) : 0
        return (
          <div key={`${row.label}-${index}`} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <span className="truncate text-zinc-200">{row.label}</span>
              </div>
              <span className="shrink-0 text-zinc-500">{row.meta}</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-900">
              <div
                className={cn('h-2 rounded-full bg-cyan-400 transition-[width]', row.tone)}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TokenMixDonut({
  summary,
  language,
}: {
  summary: ModelUsageSummaryResponse['summary']
  language: 'zh' | 'en'
}) {
  const tokenMixRows = tokenMixPalette.map((entry) => {
    const value = summary.totals[entry.key] ?? 0
    const label = language === 'zh'
      ? ({
          inputTokens: '输入',
          outputTokens: '输出',
          reasoningTokens: '推理',
          cacheReadTokens: '缓存读取',
          cacheWriteTokens: '缓存写入',
        } as const)[entry.key]
      : ({
          inputTokens: 'Input',
          outputTokens: 'Output',
          reasoningTokens: 'Reasoning',
          cacheReadTokens: 'Cache Read',
          cacheWriteTokens: 'Cache Write',
        } as const)[entry.key]

    return {
      label,
      value,
      tone: entry.tone,
    }
  }).filter((row) => row.value > 0)

  const total = tokenMixRows.reduce((sum, row) => sum + row.value, 0)

  if (total <= 0) {
    return <p className="text-xs text-zinc-500">{language === 'zh' ? '还没有可视化的 token 明细。' : 'No token detail available yet.'}</p>
  }

  let cursor = -Math.PI / 2
  const arcs = tokenMixRows.map((row, index) => {
    const ratio = row.value / total
    const nextCursor = cursor + ratio * Math.PI * 2
    const path = buildArcPath(60, 60, 42, cursor, nextCursor)
    cursor = nextCursor
    return {
      ...row,
      path,
      ratio,
      strokeClassName: tokenMixPalette[index]?.tone.split(' ')[0] ?? 'stroke-cyan-400',
    }
  })

  return (
    <div className="grid gap-3 md:grid-cols-[148px_minmax(0,1fr)] md:items-center">
      <div className="mx-auto flex w-[148px] flex-col items-center justify-center">
        <svg viewBox="0 0 120 120" className="h-32 w-32">
          <circle cx="60" cy="60" r="42" className="stroke-zinc-900" strokeWidth="12" fill="none" />
          {arcs.map((arc) => (
            <path
              key={arc.label}
              d={arc.path}
              className={cn('fill-none', arc.strokeClassName)}
              strokeWidth="12"
              strokeLinecap="round"
            />
          ))}
        </svg>
        <div className="-mt-20 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{language === 'zh' ? '总 Token' : 'Total Tokens'}</p>
          <p className="mt-1 text-lg font-semibold text-zinc-50">{formatTokenCount(summary.totals.totalTokens)}</p>
        </div>
      </div>
      <div className="space-y-2">
        {arcs.map((arc) => (
          <div key={arc.label} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', arc.strokeClassName.replace('stroke-', 'bg-'))} />
              <span className="truncate text-sm text-zinc-200">{arc.label}</span>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-zinc-100">{formatTokenCount(arc.value)}</p>
              <p className="text-[11px] text-zinc-500">{formatPercent(arc.ratio * 100)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function UsageCompositionBars({
  summary,
  language,
}: {
  summary: ModelUsageSummaryResponse['summary']
  language: 'zh' | 'en'
}) {
  const totalTokens = summary.totals.totalTokens
  const rows = summary.byProvider.slice(0, 6).map((item, index) => ({
    label: item.providerId,
    value: item.usage.totalTokens || item.runCount,
    runs: item.runCount,
    colorClassName: providerPalette[index % providerPalette.length],
  }))
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0)

  if (rows.length === 0) {
    return <p className="text-xs text-zinc-500">{language === 'zh' ? '还没有供应商分布数据。' : 'No provider distribution data yet.'}</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-900">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn('h-full min-w-[10px]', row.colorClassName)}
            style={{ width: `${totalValue > 0 ? (row.value / totalValue) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', row.colorClassName)} />
              <span className="truncate text-zinc-200">{row.label}</span>
            </div>
            <span className="shrink-0 text-zinc-500">
              {formatTokenCount(row.value)} · {formatRatio(row.value, totalTokens || totalValue)} · {row.runs} {language === 'zh' ? '次' : 'runs'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EfficiencyCards({
  summary,
  language,
}: {
  summary: ModelUsageSummaryResponse['summary']
  language: 'zh' | 'en'
}) {
  const averageTokensPerRun = summary.totals.recordedTokenRunCount > 0
    ? Math.round(summary.totals.totalTokens / summary.totals.recordedTokenRunCount)
    : 0
  const trackingCoverage = summary.totals.runCount > 0
    ? (summary.totals.recordedTokenRunCount / summary.totals.runCount) * 100
    : 0
  const outputRatio = summary.totals.totalTokens > 0
    ? (summary.totals.outputTokens / summary.totals.totalTokens) * 100
    : 0

  const cards = [
    {
      label: language === 'zh' ? '单次平均 Token' : 'Avg Tokens / Run',
      value: formatTokenCount(averageTokensPerRun),
      hint: language === 'zh' ? '按已记录 token 的调用计算' : 'Across tracked token runs',
    },
    {
      label: language === 'zh' ? '记录覆盖率' : 'Tracking Coverage',
      value: formatPercent(trackingCoverage),
      hint: language === 'zh' ? '已记录 usage 的调用占比' : 'Runs with usage detail',
    },
    {
      label: language === 'zh' ? '输出占比' : 'Output Share',
      value: formatPercent(outputRatio),
      hint: language === 'zh' ? '输出 token / 总 token' : 'Output tokens over total',
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 px-3.5 py-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{card.label}</p>
          <p className="mt-2 text-lg font-semibold text-zinc-50">{card.value}</p>
          <p className="mt-1 text-[11px] text-zinc-500">{card.hint}</p>
        </div>
      ))}
    </div>
  )
}

export function ModelUsagePanel({
  summary,
  language,
}: {
  summary: ModelUsageSummaryResponse['summary'] | null
  language: 'zh' | 'en'
}) {
  if (!summary) {
    return null
  }

  const topModels = summary.byModel.slice(0, 6).map((item) => ({
    label: item.executionModel,
    value: item.usage.totalTokens || item.runCount,
    tone: 'bg-cyan-400',
    meta: `${formatTokenCount(item.usage.totalTokens)} tokens · ${item.runCount} ${language === 'zh' ? '次' : 'runs'}`,
  }))
  const topProviders = summary.byProvider.slice(0, 6).map((item, index) => ({
    label: item.providerId,
    value: item.usage.totalTokens || item.runCount,
    tone: providerPalette[index % providerPalette.length],
    meta: `${formatTokenCount(item.usage.totalTokens)} tokens · ${item.runCount} ${language === 'zh' ? '次' : 'runs'}`,
  }))
  const modelTotal = Math.max(...topModels.map((item) => item.value), 0)
  const providerTotal = Math.max(...topProviders.map((item) => item.value), 0)
  const topProviderValue = topProviders[0]?.value ?? 0
  const totalReference = summary.totals.totalTokens || summary.totals.runCount
  const trendPeak = Math.max(...summary.daily.map((bucket) => bucket.totalTokens), 0)
  const trendLatest = summary.daily.at(-1)?.totalTokens ?? 0

  return (
    <div className="space-y-3">
      <EfficiencyCards summary={summary} language={language} />
      <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <ChartCard
          title={language === 'zh' ? 'Token 趋势' : 'Token Trend'}
          subtitle={language === 'zh'
            ? `峰值 ${formatTokenCount(trendPeak)} tokens，最近一天 ${formatTokenCount(trendLatest)}`
            : `Peak ${formatTokenCount(trendPeak)} tokens, latest day ${formatTokenCount(trendLatest)}`}
          className="xl:col-span-2"
        >
          <TrendLineChart summary={summary} language={language} />
        </ChartCard>
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <ChartCard
          title={language === 'zh' ? 'Token 构成' : 'Token Composition'}
          subtitle={language === 'zh'
            ? `已记录 ${summary.totals.totalTokens.toLocaleString()} tokens，覆盖 ${summary.totals.recordedTokenRunCount}/${summary.totals.runCount} 次调用`
            : `${summary.totals.totalTokens.toLocaleString()} recorded tokens across ${summary.totals.recordedTokenRunCount}/${summary.totals.runCount} runs`}
        >
          <TokenMixDonut summary={summary} language={language} />
        </ChartCard>
        <ChartCard
          title={language === 'zh' ? '供应商占比' : 'Provider Share'}
          subtitle={language === 'zh'
            ? `Top Provider 占比 ${formatRatio(topProviderValue, totalReference)}`
            : `Top provider share ${formatRatio(topProviderValue, totalReference)}`}
        >
          <UsageCompositionBars summary={summary} language={language} />
        </ChartCard>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title={language === 'zh' ? '模型 Token 用量' : 'Model Token Usage'}
          subtitle={language === 'zh'
            ? '按模型查看累计 token 与调用次数'
            : 'Top models by tokens and run count'}
        >
          <UsageBarList
            rows={topModels}
            total={modelTotal}
            emptyLabel={language === 'zh' ? '还没有模型调用记录' : 'No model usage yet'}
          />
        </ChartCard>
        <ChartCard
          title={language === 'zh' ? '供应商明细' : 'Provider Breakdown'}
          subtitle={language === 'zh'
            ? '按供应商查看 token 消耗与调用量'
            : 'Token consumption by provider'}
        >
          <UsageBarList
            rows={topProviders}
            total={providerTotal}
            emptyLabel={language === 'zh' ? '还没有供应商调用记录' : 'No provider usage yet'}
          />
        </ChartCard>
      </div>
    </div>
  )
}
