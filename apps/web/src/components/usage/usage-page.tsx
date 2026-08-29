// @ts-nocheck - feature rebase workaround: dev missing recharts dep
// [INPUT]: 用量统计 API（个人 / Agent / 团队三视角）
// [OUTPUT]: Token 用量看板：统计卡 + 趋势 + 维度明细
// [POS]: /usage 页面；团队视角仅 owner/admin 可见，其余视角服务端按当前用户隔离
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useCallback, useMemo, useState } from 'react'
import { Loader2, TrendingUp, Bot, Users, User as UserIcon, ShieldCheck, Lock, Plus, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '../../lib/api'
import type {
  TeamAgentDto,
  TeamMemberUsageDto,
  TeamModelPolicyDto,
  TokenQuotaSnapshotDto,
  UsagePeriod,
  UsageSummaryDto,
  UsageTotalsDto,
} from '../../lib/api/methods/usage'
import { cn } from '../../lib/utils'
import { useTranslation } from '../../lib/i18n/react'
import { getCommercialUiSection } from '../commercial-ui-gate'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

type UsageTabId = 'summary' | 'agents' | 'team'

const PERIOD_OPTIONS: Array<{ value: UsagePeriod; label: string }> = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
]

const formatTokenCount = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

const formatPercent = (value: number) => `${Math.round(value)}%`

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="h-full px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  )
}

function PanelHeader({ icon: Icon, title, subtitle }: { icon?: React.ComponentType<{ className?: string }>; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> : null}
      <div>
        <h3 className="text-xs font-medium text-zinc-400">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[10px] text-zinc-600">{subtitle}</p> : null}
      </div>
    </div>
  )
}

function TrendBars({ daily, total }: { daily: UsageSummaryDto['daily']; total: number }) {
  const max = Math.max(...daily.map((bucket) => bucket.totalTokens), 0)
  if (max <= 0) {
    return <p className="py-6 text-center text-xs text-zinc-500">当前时间范围内还没有 token 消耗数据。</p>
  }

  const chartData = daily.map((bucket) => ({
    date: bucket.date.slice(5), // MM-DD
    fullDate: bucket.date,
    tokens: bucket.totalTokens,
  }))

  // 根据数据量决定显示间隔
  const showInterval = daily.length > 15 ? 3 : daily.length > 10 ? 2 : 1

  return (
    <div className="h-52 w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 20 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={showInterval - 1}
          />
          <YAxis
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatTokenCount(value)}
          />
          <Tooltip
            cursor={{ fill: 'rgba(63, 63, 70, 0.3)' }}
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: '0.375rem',
              padding: '0.5rem 0.625rem',
            }}
            labelStyle={{ color: '#71717a', fontSize: 10, marginBottom: 2 }}
            itemStyle={{ color: '#22d3ee', fontSize: 11, fontWeight: 600 }}
            formatter={(value) => [formatTokenCount(Number(value)), 'Tokens']}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.fullDate || label}
          />
          <Bar dataKey="tokens" radius={[4, 4, 0, 0]}>
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill="url(#barGradient)" />
            ))}
          </Bar>
          <defs>
            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={1} />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function TokenMixRow({ totals }: { totals: UsageTotalsDto }) {
  const rows = [
    { key: '输入', value: totals.inputTokens, tone: '#22d3ee' },
    { key: '输出', value: totals.outputTokens, tone: '#6ee7b7' },
    { key: '推理', value: totals.reasoningTokens, tone: '#fbbf24' },
    { key: '缓存读', value: totals.cacheReadTokens, tone: '#a78bfa' },
    { key: '缓存写', value: totals.cacheWriteTokens, tone: '#f472b6' },
  ].filter((row) => row.value > 0)

  const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (total <= 0) {
    return <p className="py-4 text-center text-xs text-zinc-500">暂无 token 构成明细。</p>
  }

  // 构造单行堆叠数据
  const chartData = [
    rows.reduce((acc, row) => {
      acc[row.key] = row.value
      return acc
    }, {} as Record<string, number>),
  ]

  return (
    <div className="space-y-4">
      <div className="h-3 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis type="category" hide />
            <Tooltip
              cursor={false}
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
                borderRadius: '0.375rem',
                padding: '0.5rem 0.625rem',
              }}
              formatter={(value, name) => [
                `${formatTokenCount(Number(value))} (${((Number(value) / total) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
            {rows.map((row, index) => (
              <Bar
                key={row.key}
                dataKey={row.key}
                stackId="tokens"
                fill={row.tone}
                radius={index === 0 ? [999, 0, 0, 999] : index === rows.length - 1 ? [0, 999, 999, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2">
        {rows.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.tone }} />
              <span className="text-zinc-300">{item.key}</span>
            </div>
            <span className="shrink-0 text-zinc-500">
              {formatTokenCount(item.value)} · {((item.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function UsageBarList({
  rows,
  emptyLabel,
}: {
  rows: Array<{ label: string; value: number; meta: string }>
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-xs text-zinc-500">{emptyLabel}</p>
  }
  const max = Math.max(...rows.map((row) => row.value), 0)
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-zinc-200">{row.label}</span>
            <span className="shrink-0 text-zinc-500">{row.meta}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
            <div className="h-2 rounded-full bg-cyan-400/80" style={{ width: `${max > 0 ? Math.max(6, (row.value / max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

const quotaLabel = (quota?: TokenQuotaSnapshotDto) => {
  const policy = quota?.policy
  if (!policy?.enabled || !policy.limitTokens) {
    return '未设置'
  }
  const period = policy.period === 'day' ? '每日' : '每月'
  return `${period} ${formatTokenCount(policy.limitTokens)} · 已用 ${quota?.usagePercent ?? 0}%`
}

function MemberTable({ members, isAdmin, onSetQuota }: {
  members: TeamMemberUsageDto[]
  isAdmin: boolean
  onSetQuota: (member: TeamMemberUsageDto) => void
}) {
  if (members.length === 0) {
    return <p className="py-6 text-center text-xs text-zinc-500">协作区还没有成员。</p>
  }
  const total = members.reduce((sum, member) => sum + member.totalTokens, 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
            <th className="py-2 pr-4 font-medium">成员</th>
            <th className="py-2 pr-4 font-medium">角色</th>
            <th className="py-2 pr-4 font-medium">运行次数</th>
            <th className="py-2 pr-4 font-medium">总 Token</th>
            <th className="py-2 pr-4 font-medium">配额</th>
            <th className="py-2 font-medium">占比</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.userId} className="border-b border-zinc-800/60 last:border-0">
              <td className="py-2.5 pr-4 text-zinc-200">{member.userName}</td>
              <td className="py-2.5 pr-4 text-zinc-500">{member.role ?? '—'}</td>
              <td className="py-2.5 pr-4 text-zinc-300">{member.runCount}</td>
              <td className="py-2.5 pr-4 font-medium text-zinc-100">{formatTokenCount(member.totalTokens)}</td>
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">{quotaLabel(member.quota)}</span>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => onSetQuota(member)}
                      className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                    >
                      设置
                    </button>
                  ) : null}
                </div>
              </td>
              <td className="py-2.5 text-zinc-500">{total > 0 ? formatPercent((member.totalTokens / total) * 100) : '0%'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QuotaPanel({
  quota,
  limit,
  period,
  action,
  saving,
  managedBy,
  onLimitChange,
  onPeriodChange,
  onActionChange,
  onSave,
}: {
  quota: TokenQuotaSnapshotDto | null
  limit: string
  period: 'day' | 'month'
  action: 'warn' | 'block'
  saving: boolean
  managedBy: string | null
  onLimitChange: (value: string) => void
  onPeriodChange: (value: 'day' | 'month') => void
  onActionChange: (value: 'warn' | 'block') => void
  onSave: () => Promise<void>
}) {
  const enabled = Boolean(quota?.policy?.enabled && quota?.limitTokens)
  const percent = quota?.usagePercent ?? 0
  const barTone = percent >= 100 ? 'bg-rose-400' : percent >= 80 ? 'bg-amber-400' : 'bg-cyan-400'
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Token 配额</span>
          {enabled ? (
            <span className="text-xs text-zinc-500">
              {quota?.policy?.period === 'day' ? '每日' : '每月'}上限 {formatTokenCount(quota?.limitTokens ?? 0)} · 已用 {formatTokenCount(quota?.usedTokens ?? 0)}（{percent}%）·
              {quota?.policy?.action === 'warn' ? '超限仅告警' : '超限阻断执行'}
            </span>
          ) : (
            <span className="text-xs text-zinc-600">未设置（不限量）</span>
          )}
        </div>
        {quota?.message ? <span className="text-xs text-zinc-500">{quota.message}</span> : null}
      </div>
      {enabled ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900">
          <div className={cn('h-full rounded-full', barTone)} style={{ width: `${Math.max(4, percent)}%` }} />
        </div>
      ) : null}
      {managedBy ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          配额由{managedBy}统一管理，成员不可自行修改。如有调整需求请联系管理员。
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">上限（token）</span>
            <input
              type="number"
              min={0}
              value={limit}
              onChange={(event) => onLimitChange(event.target.value)}
              placeholder="例如 1000000"
              className="h-8 w-36 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">周期</span>
            <select
              value={period}
              onChange={(event) => onPeriodChange(event.target.value as 'day' | 'month')}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
            >
              <option value="month">每月</option>
              <option value="day">每日</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">超限动作</span>
            <select
              value={action}
              onChange={(event) => onActionChange(event.target.value as 'warn' | 'block')}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
            >
              <option value="block">阻断执行</option>
              <option value="warn">仅告警</option>
            </select>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave()}
            className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {saving ? '保存中…' : limit === '0' || limit === '' ? '关闭配额' : '保存配额'}
          </button>
        </div>
      )}
    </div>
  )
}

function MemberQuotaDialog({ member, teamId, open, onOpenChange, onSaved }: {
  member: TeamMemberUsageDto | null
  teamId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [limit, setLimit] = useState('')
  const [period, setPeriod] = useState<'day' | 'month'>('month')
  const [action, setAction] = useState<'warn' | 'block'>('block')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !member) {
      return
    }
    const policy = member.quota?.policy
    setLimit(policy?.enabled && policy.limitTokens ? String(policy.limitTokens) : '')
    setPeriod(policy?.period ?? 'month')
    setAction(policy?.action ?? 'block')
    setError('')
  }, [open, member])

  const save = async () => {
    if (!member) {
      return
    }
    const parsed = Number(limit.trim())
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('请输入非负整数上限。')
      return
    }
    setSaving(true)
    try {
      const response = await api.setTeamMemberQuota({ teamId, userId: member.userId, period, limitTokens: parsed, action })
      if (response?.ok) {
        onOpenChange(false)
        onSaved()
      } else {
        setError(response?.message || '保存失败，请重试。')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>设置成员 Token 配额</DialogTitle>
          <DialogDescription>
            {member ? `为 ${member.userName} 设置用量上限；管理员设置后成员无法自行修改。` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">上限（token，0 关闭配额）</span>
            <input
              type="number"
              min={0}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              placeholder="例如 1000000"
              className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">周期</span>
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as 'day' | 'month')}
                className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
              >
                <option value="month">每月</option>
                <option value="day">每日</option>
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">超限动作</span>
              <select
                value={action}
                onChange={(event) => setAction(event.target.value as 'warn' | 'block')}
                className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
              >
                <option value="block">阻断执行</option>
                <option value="warn">仅告警</option>
              </select>
            </label>
          </div>
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : limit === '0' || limit === '' ? '关闭配额' : '保存配额'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TeamModelPolicyCard({ teamId }: { teamId: string }) {
  const [policy, setPolicy] = useState<TeamModelPolicyDto | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.getTeamModelPolicy(teamId)
      .then((response) => {
        if (cancelled || !response?.ok) {
          return
        }
        setPolicy(response.policy)
        setDraft(response.policy.allowedModelIds)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [teamId])

  const enabled = Boolean(policy?.enabled)

  const save = async (nextEnabled: boolean, nextDraft: string[]) => {
    setSaving(true)
    try {
      const response = await api.setTeamModelPolicy({ teamId, allowedModelIds: nextEnabled ? nextDraft : null })
      if (response?.ok) {
        setPolicy(response.policy)
        setDraft(response.policy.allowedModelIds)
      }
    } finally {
      setSaving(false)
    }
  }

  const addModel = () => {
    const value = input.trim()
    if (!value || draft.includes(value)) {
      return
    }
    setDraft((prev) => [...prev, value])
    setInput('')
  }

  if (!loaded) {
    return null
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">组织模型白名单</span>
          {enabled ? (
            <span className="text-xs text-zinc-500">已启用 · {draft.length} 个允许模型</span>
          ) : (
            <span className="text-xs text-zinc-600">未启用（成员可使用可见的全部模型）</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {enabled ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(false, [])}
              className="h-7 rounded-md border border-zinc-800 px-2.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              关闭白名单
            </button>
          ) : null}
        </div>
      </div>
      {enabled ? (
        <div className="mt-3 space-y-2.5">
          <p className="text-[11px] text-zinc-500">
            启用后，组织工作区会话与组织共享聊天只能使用以下模型执行；成员个人私有会话不受影响。
          </p>
          {draft.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {draft.map((modelId) => (
                <span key={modelId} className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300">
                  {modelId}
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => prev.filter((id) => id !== modelId))}
                    className="text-zinc-600 transition-colors hover:text-zinc-300"
                    aria-label={`移除 ${modelId}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-amber-400/90">白名单为空：启用后团队执行将被全部拦截，请先添加允许的模型。</p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addModel()
                }
              }}
              placeholder="输入执行模型 id（如 opencode/gpt-4.1）后回车添加"
              className="h-8 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-700"
            />
            <button
              type="button"
              onClick={addModel}
              className="flex h-8 items-center gap-1 rounded-md border border-zinc-800 px-2.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              <Plus className="h-3 w-3" />
              添加
            </button>
            <Button size="sm" disabled={saving} onClick={() => void save(true, draft)}>
              {saving ? '保存中…' : '保存白名单'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TeamAgentsCard({ teamId, period }: { teamId: string; period: UsagePeriod }) {
  const [agents, setAgents] = useState<TeamAgentDto[] | null>(null)
  const [error, setError] = useState('')
  const [togglingId, setTogglingId] = useState('')

  const load = useCallback(async () => {
    const response = await api.getTeamAgents(teamId, period)
    if (response?.ok) {
      setAgents(response.agents)
      setError('')
    } else {
      setError(response?.message || '无法加载团队 Agent')
    }
  }, [teamId, period])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (agent: TeamAgentDto, nextEnabled: boolean) => {
    setTogglingId(agent.agentId)
    try {
      const response = await api.setTeamAgentEnabled({ teamId, agentId: agent.agentId, enabled: nextEnabled })
      if (response?.ok) {
        await load()
      } else {
        setError(response?.message || '操作失败')
      }
    } finally {
      setTogglingId('')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <div>
            <h3 className="text-xs font-medium text-zinc-400">团队 Agent</h3>
            <p className="mt-0.5 text-[10px] text-zinc-600">协作区成员拥有的 Agent；管理员可启停，Agent 仍归成员所有</p>
          </div>
        </div>
      </div>
      {error ? <p className="px-4 py-4 text-xs text-rose-400 sm:px-5">{error}</p> : null}
      {agents !== null && agents.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-500 sm:px-5">协作区成员还没有创建 Agent。</p>
      ) : null}
      {agents !== null && agents.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pl-4 pr-4 font-medium sm:pl-5">Agent</th>
                <th className="py-2 pr-4 font-medium">归属成员</th>
                <th className="py-2 pr-4 font-medium">状态</th>
                <th className="py-2 pr-4 font-medium">运行次数</th>
                <th className="py-2 pr-4 font-medium">总 Token</th>
                <th className="py-2 pr-4 font-medium">治理</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agentId} className="border-b border-zinc-800/60 last:border-0">
                  <td className="py-2.5 pl-4 pr-4 text-zinc-200 sm:pl-5">{agent.name}</td>
                  <td className="py-2.5 pr-4 text-zinc-500">{agent.ownerName ?? '—'}</td>
                  <td className="py-2.5 pr-4">
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      agent.enabled
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-zinc-800/80 text-zinc-500',
                    )}>
                      {agent.enabled ? '启用中' : '已停用'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-300">{agent.runCount}</td>
                  <td className="py-2.5 pr-4 font-medium text-zinc-100">{formatTokenCount(agent.totalTokens)}</td>
                  <td className="py-2.5 pr-4">
                    <button
                      type="button"
                      disabled={togglingId === agent.agentId}
                      onClick={() => void toggle(agent, !agent.enabled)}
                      className={cn(
                        'rounded border px-2 py-1 text-[10px] transition-colors disabled:opacity-50',
                        agent.enabled
                          ? 'border-zinc-800 text-zinc-400 hover:border-rose-800/60 hover:text-rose-300'
                          : 'border-zinc-800 text-zinc-400 hover:border-emerald-800/60 hover:text-emerald-300',
                      )}
                    >
                      {togglingId === agent.agentId ? '处理中…' : agent.enabled ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export function UsagePage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<UsageTabId>('summary')
  const [period, setPeriod] = useState<UsagePeriod>('30d')
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null)
  const [agentSummary, setAgentSummary] = useState<UsageSummaryDto | null>(null)
  const [teamData, setTeamData] = useState<{ teamId: string; members: TeamMemberUsageDto[]; summary: UsageSummaryDto } | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamRefreshKey, setTeamRefreshKey] = useState(0)
  const [quotaDialogMember, setQuotaDialogMember] = useState<TeamMemberUsageDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedPeriod, setLoadedPeriod] = useState<Partial<Record<UsageTabId, UsagePeriod>>>({})
  const [quota, setQuota] = useState<TokenQuotaSnapshotDto | null>(null)
  const [quotaLimit, setQuotaLimit] = useState('')
  const [quotaPeriod, setQuotaPeriod] = useState<'day' | 'month'>('month')
  const [quotaAction, setQuotaAction] = useState<'warn' | 'block'>('block')
  const [quotaSaving, setQuotaSaving] = useState(false)

  const loadQuota = useCallback(async () => {
    try {
      const response = await api.getUsageQuota()
      if (response?.ok) {
        setQuota(response.quota)
        if (response.quota.policy) {
          setQuotaLimit(String(response.quota.policy.limitTokens))
          setQuotaPeriod(response.quota.policy.period)
          setQuotaAction(response.quota.policy.action)
        }
      }
    } catch {
      // 配额接口不可用时静默降级，不影响用量展示。
    }
  }, [])

  useEffect(() => {
    void loadQuota()
  }, [loadQuota])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const loadTab = async (target: UsageTabId) => {
      try {
        if (target === 'summary') {
          const response = await api.getUsageSummary(period)
          if (!cancelled && response?.ok) {
            setSummary(response.summary)
            setLoadedPeriod((prev) => ({ ...prev, summary: period }))
          }
        } else if (target === 'agents') {
          const response = await api.getAgentUsage(period)
          if (!cancelled && response?.ok) {
            setAgentSummary(response.summary)
            setLoadedPeriod((prev) => ({ ...prev, agents: period }))
          }
        } else {
          const response = await api.getTeamUsage(undefined, period)
          if (!cancelled) {
            if (response?.ok) {
              setTeamData({ teamId: response.teamId, members: response.members, summary: response.summary })
              setTeamError(null)
              setLoadedPeriod((prev) => ({ ...prev, team: period }))
            } else {
              setTeamData(null)
              setTeamError(response?.message || '无法查看团队用量')
            }
          }
        }
      } catch {
        if (!cancelled && target === 'team') {
          setTeamData(null)
          setTeamError('无法查看团队用量')
        }
      }
    }
    // 三个 tab 并行加载/预取，切 tab 时直接命中缓存，刷新后的首次切换也不会闪加载态
    void Promise.all([loadTab('summary'), loadTab('agents'), loadTab('team')]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [period, teamRefreshKey])

  const activeSummary = tab === 'summary' ? summary : tab === 'agents' ? agentSummary : teamData?.summary ?? null
  const totals = activeSummary?.totals
  const hasActiveData = tab === 'summary' ? summary !== null : tab === 'agents' ? agentSummary !== null : teamData !== null
  const refreshingStale = loading && hasActiveData && loadedPeriod[tab] !== period
  const isTeamAdminView = teamData !== null
  const adminTeamId = teamData?.teamId ?? null
  const quotaManagedBy = quota?.policy?.setBy === 'team_admin'
    ? '协作区管理员'
    : quota?.policy?.setBy === 'platform_admin'
      ? '平台管理员'
      : null

  const tabs: Array<{ id: UsageTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'summary', label: '我的用量', icon: UserIcon },
    { id: 'agents', label: '我的 Agent', icon: Bot },
    { id: 'team', label: '团队用量', icon: Users },
  ]

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-50">{t('nav.usage')}</h1>
          <p className="mt-0.5 text-xs text-zinc-500">Token 用量统计：个人、Agent 与团队维度</p>
        </div>
        <div className="flex items-center gap-1 self-start rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] transition-colors',
                period === option.value
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-1 border-b border-zinc-900">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs transition-colors',
              tab === item.id
                ? 'border-zinc-100 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            )}
            aria-pressed={tab === item.id}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <QuotaPanel
        quota={quota}
        limit={quotaLimit}
        period={quotaPeriod}
        action={quotaAction}
        saving={quotaSaving}
        managedBy={quotaManagedBy}
        onLimitChange={setQuotaLimit}
        onPeriodChange={setQuotaPeriod}
        onActionChange={setQuotaAction}
        onSave={async () => {
          const parsed = Number(quotaLimit.trim())
          if (!Number.isFinite(parsed) || parsed < 0) {
            return
          }
          setQuotaSaving(true)
          try {
            const response = await api.setUsageQuota({
              period: quotaPeriod,
              limitTokens: parsed,
              action: quotaAction,
            })
            if (response?.ok) {
              setQuota(response.quota)
              await loadQuota()
            }
          } finally {
            setQuotaSaving(false)
          }
        }}
      />

      {isTeamAdminView && adminTeamId ? <TeamModelPolicyCard teamId={adminTeamId} /> : null}
      {isTeamAdminView && adminTeamId ? <TeamAgentsCard teamId={adminTeamId} period={period} /> : null}

      <MemberQuotaDialog
        member={quotaDialogMember}
        teamId={adminTeamId ?? ''}
        open={quotaDialogMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setQuotaDialogMember(null)
          }
        }}
        onSaved={() => setTeamRefreshKey((key) => key + 1)}
      />

      {(() => {
        const renderCreditsPanel = getCommercialUiSection('usage.credits-panel')
        return renderCreditsPanel ? renderCreditsPanel() : null
      })()}

      {loading && !hasActiveData ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/55 p-10 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载用量数据…
        </div>
      ) : tab === 'team' && teamError && !teamData ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-10 text-center">
          <p className="text-sm text-zinc-400">{teamError}</p>
        </div>
      ) : activeSummary && totals ? (
        <div className={cn('space-y-5 transition-opacity duration-200', refreshingStale && 'opacity-60')}>
          <section className="overflow-hidden rounded-xl border border-zinc-800">
            <div className="grid grid-cols-2 gap-px xl:grid-cols-4">
              <StatCard label="总 Token" value={formatTokenCount(totals.totalTokens)} hint={`${totals.runCount} 次运行`} />
              <StatCard label="输入" value={formatTokenCount(totals.inputTokens)} />
              <StatCard label="输出" value={formatTokenCount(totals.outputTokens)} />
              <StatCard label="推理" value={formatTokenCount(totals.reasoningTokens)} />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800">
            <div className="grid gap-px xl:grid-cols-2">
              <div className="min-w-0 p-4 sm:p-5">
                <PanelHeader icon={TrendingUp} title="Token 趋势" subtitle="每日消耗" />
                <div className="mt-4">
                  <TrendBars daily={activeSummary.daily} total={totals.totalTokens} />
                </div>
              </div>
              <div className="min-w-0 border-t border-zinc-800 p-4 sm:p-5 xl:border-l xl:border-t-0">
                <PanelHeader icon={TrendingUp} title="Token 构成" subtitle="输入 / 输出 / 推理 / 缓存" />
                <div className="mt-4">
                  <TokenMixRow totals={totals} />
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800">
            <div className="grid gap-px xl:grid-cols-2">
              <div className="min-w-0 p-4 sm:p-5">
                <PanelHeader title="按工作区" />
                <div className="mt-4">
                  <UsageBarList
                    rows={activeSummary.byWorkspace.map((row) => ({
                      label: row.workspaceName ?? row.workspaceId ?? '未知工作区',
                      value: row.totals.totalTokens,
                      meta: `${formatTokenCount(row.totals.totalTokens)} tokens · ${row.runCount} 次`,
                    }))}
                    emptyLabel="还没有工作区执行记录"
                  />
                </div>
              </div>
              <div className="min-w-0 border-t border-zinc-800 p-4 sm:p-5 xl:border-l xl:border-t-0">
                <PanelHeader title={tab !== 'team' ? '按 Agent' : '成员用量'} />
                <div className="mt-4">
                  {tab !== 'team' ? (
                    <UsageBarList
                      rows={activeSummary.byAgent.map((row) => ({
                        label: row.agentName ?? row.agentId ?? '未命名 Agent',
                        value: row.totals.totalTokens,
                        meta: `${formatTokenCount(row.totals.totalTokens)} tokens · ${row.runCount} 次`,
                      }))}
                      emptyLabel="还没有 Agent 调用记录"
                    />
                  ) : (
                    <MemberTable members={teamData?.members ?? []} isAdmin={isTeamAdminView} onSetQuota={setQuotaDialogMember} />
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800">
            <div className="grid gap-px xl:grid-cols-2">
              <div className="min-w-0 p-4 sm:p-5">
                <PanelHeader title="按模型" />
                <div className="mt-4">
                  <UsageBarList
                    rows={activeSummary.byModel.map((row) => ({
                      label: row.executionModel ?? '未知模型',
                      value: row.totals.totalTokens,
                      meta: `${formatTokenCount(row.totals.totalTokens)} tokens · ${row.runCount} 次`,
                    }))}
                    emptyLabel="还没有模型调用记录"
                  />
                </div>
              </div>
              <div className="min-w-0 border-t border-zinc-800 p-4 sm:p-5 xl:border-l xl:border-t-0">
                <PanelHeader title="按供应商" />
                <div className="mt-4">
                  <UsageBarList
                    rows={activeSummary.byProvider.map((row) => ({
                      label: row.providerId ?? '未知',
                      value: row.totals.totalTokens,
                      meta: `${formatTokenCount(row.totals.totalTokens)} tokens · ${row.runCount} 次`,
                    }))}
                    emptyLabel="还没有供应商记录"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800">
            <div className="p-4 sm:p-5">
              <PanelHeader title="执行入口" />
              <div className="mt-4">
                <UsageBarList
                  rows={activeSummary.byRunKind.map((row) => ({
                    label: RUN_KIND_LABEL[row.runKind] ?? row.runKind,
                    value: row.totals.totalTokens,
                    meta: `${formatTokenCount(row.totals.totalTokens)} tokens · ${row.runCount} 次`,
                  }))}
                  emptyLabel="还没有执行记录"
                />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/55 p-10 text-center text-sm text-zinc-500">
          还没有 token 消耗数据。Agent 执行产生用量后这里会显示统计。
        </div>
      )}
    </div>
  )
}

const RUN_KIND_LABEL: Record<string, string> = {
  task: '任务执行',
  main_chat: '主聊天',
  workspace_turn: '工作区会话',
  agent_event: 'Agent 事件',
  direct_chat: '直聊',
  group_chat: '群聊',
}
