/**
 * [INPUT]: Agent id
 * [OUTPUT]: 定时心跳计划的配置面板（间隔预设/自定义 cron + 启停 + 最近心跳留痕）
 * [POS]: Agent 设置页「配置」tab 内的定时心跳区；直接走 crons/heartbeats API
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Check, HeartPulse, Loader2, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { api } from '../../lib/api'
import type { AgentCronRecord, AgentHeartbeatRecord } from '../../lib/api/types'
import { formatDate } from '../../lib/utils'
import { useTranslation } from '../../lib/i18n/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { NativeSelect } from '../ui/native-select'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { SectionHeader } from './custom-agent-detail-panel-shared'
import { cn } from '../../lib/utils'

const HEARTBEAT_INTERVAL_PRESETS: Array<{ value: string; label: string; cron: string }> = [
  { value: 'daily', label: '每天一次（00:00 UTC）', cron: '0 0 * * *' },
  { value: '12h', label: '每 12 小时', cron: '0 */12 * * *' },
  { value: '6h', label: '每 6 小时', cron: '0 */6 * * *' },
  { value: '3h', label: '每 3 小时', cron: '0 */3 * * *' },
  { value: '1h', label: '每小时', cron: '0 * * * *' },
  { value: 'custom', label: '自定义 cron（UTC）', cron: '' },
]

const HEARTBEAT_TIME_ZONES = ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles', 'America/New_York']

const tr = (language: 'zh' | 'en', zh: string, en: string) => (language === 'zh' ? zh : en)

export function AgentHeartbeatSchedulePanel({ agentId }: { agentId: string }) {
  const { language } = useTranslation()
  const [crons, setCrons] = useState<AgentCronRecord[]>([])
  const [heartbeats, setHeartbeats] = useState<AgentHeartbeatRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('daily')
  const [customCron, setCustomCron] = useState('')
  const [instructions, setInstructions] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [activeWindowEnabled, setActiveWindowEnabled] = useState(false)
  const [activeWindowStart, setActiveWindowStart] = useState('09:00')
  const [activeWindowEnd, setActiveWindowEnd] = useState('21:00')
  const [activeWindowTz, setActiveWindowTz] = useState('Asia/Shanghai')
  const [dailyLimit, setDailyLimit] = useState(0)
  const [cronTimezone, setCronTimezone] = useState('UTC')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cronResult, heartbeatResult] = await Promise.all([
        api.getAgentCrons(agentId),
        api.getAgentHeartbeats(agentId),
      ])
      setCrons(cronResult.crons)
      setHeartbeats(heartbeatResult.heartbeats)
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(language, '读取心跳计划失败。', 'Failed to load heartbeat schedules.'))
    } finally {
      setLoading(false)
    }
  }, [agentId, language])

  useEffect(() => {
    void load()
  }, [load])

  const buildPayload = () => ({
    kind: 'heartbeat' as const,
    ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    timezone: cronTimezone,
    ...(activeWindowEnabled && activeWindowStart && activeWindowEnd
      ? { activeWindow: { start: activeWindowStart, end: activeWindowEnd, timezone: activeWindowTz } }
      : {}),
    ...(dailyLimit > 0 ? { dailyLimit } : {}),
  })

  const saveSchedule = async () => {
    const cronExpression = preset === 'custom' ? customCron.trim() : HEARTBEAT_INTERVAL_PRESETS.find((item) => item.value === preset)?.cron ?? ''
    if (!cronExpression) {
      setError(tr(language, '请填写 cron 表达式。', 'Please provide a cron expression.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        const result = await api.updateAgentCron(editingId, { name: editingName, cronExpression, payload: buildPayload() })
        setCrons((current) => current.map((item) => item.id === editingId ? result.cron : item))
        setEditingId(null)
      } else {
        const heartbeatCount = crons.filter((item) => item.payload?.kind === 'heartbeat').length
        const result = await api.createAgentCron(agentId, {
          name: tr(language, `定时心跳${heartbeatCount > 0 ? ` ${heartbeatCount + 1}` : ''}`, `Heartbeat${heartbeatCount > 0 ? ` ${heartbeatCount + 1}` : ''}`),
          cronExpression,
          payload: buildPayload(),
        })
        setCrons((current) => [result.cron, ...current])
      }
      setCustomCron('')
      setInstructions('')
      setActiveWindowEnabled(false)
      setActiveWindowStart('')
      setActiveWindowEnd('')
      setActiveWindowTz('Asia/Shanghai')
      setDailyLimit(0)
      setCronTimezone('UTC')
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(language, '保存失败。', 'Failed to save schedule.'))
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (cron: AgentCronRecord) => {
    setEditingId(cron.id)
    setEditingName(cron.name)
    const presetMatch = HEARTBEAT_INTERVAL_PRESETS.find((item) => item.cron && item.cron === cron.cronExpression)
    setPreset(presetMatch ? presetMatch.value : 'custom')
    setCustomCron(presetMatch ? '' : cron.cronExpression)
    const window = cron.payload?.activeWindow
    const windowRecord = window && typeof window === 'object' && !Array.isArray(window) ? window as Record<string, unknown> : null
    setActiveWindowEnabled(Boolean(windowRecord?.start && windowRecord?.end))
    setActiveWindowStart(typeof windowRecord?.start === 'string' ? windowRecord.start : '')
    setActiveWindowEnd(typeof windowRecord?.end === 'string' ? windowRecord.end : '')
    setActiveWindowTz(typeof windowRecord?.timezone === 'string' ? windowRecord.timezone : 'Asia/Shanghai')
    setDailyLimit(typeof cron.payload?.dailyLimit === 'number' ? cron.payload.dailyLimit : 0)
    setCronTimezone(typeof cron.payload?.timezone === 'string' ? cron.payload.timezone : 'UTC')
    setInstructions(typeof cron.payload?.instructions === 'string' ? cron.payload.instructions : '')
    setError('')
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingName('')
    setCustomCron('')
    setInstructions('')
    setActiveWindowEnabled(false)
    setActiveWindowStart('')
    setActiveWindowEnd('')
    setActiveWindowTz('Asia/Shanghai')
    setDailyLimit(0)
    setCronTimezone('UTC')
  }

  const toggleSchedule = async (cron: AgentCronRecord) => {
    try {
      await api.toggleAgentCron(cron.id, !cron.enabled)
      setCrons((current) => current.map((item) => item.id === cron.id ? { ...item, enabled: !cron.enabled } : item))
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(language, '操作失败。', 'Operation failed.'))
    }
  }

  const triggerSchedule = async (cron: AgentCronRecord) => {
    setError('')
    try {
      const result = await api.triggerAgentCron(cron.id)
      if (result.skipped) {
        setError(tr(language, '已有进行中的心跳，本次跳过。', 'A heartbeat is already in flight; skipped.'))
      } else if (result.eventId) {
        await load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(language, '触发失败。', 'Failed to trigger.'))
    }
  }

  const deleteSchedule = async (cron: AgentCronRecord) => {
    try {
      await api.deleteAgentCron(cron.id)
      setCrons((current) => current.filter((item) => item.id !== cron.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(language, '删除失败。', 'Failed to delete schedule.'))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 border border-zinc-800 bg-[#09090b] p-3">
      <SectionHeader
        icon={<CalendarClock className="h-4 w-4" />}
        title={tr(language, '定时心跳', 'Scheduled Heartbeat')}
        description={tr(
          language,
          '按计划定时唤醒 Agent 巡检收件箱与待办。每次唤醒都会消耗模型 token，建议从低频开始（默认每天一次，间隔不低于 5 分钟）。',
          'Wake the agent on a schedule to check its inbox and pending work. Every wake-up consumes model tokens; start low-frequency (daily by default, min 5-minute interval).',
        )}
      />

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          {tr(language, '加载中…', 'Loading…')}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '间隔', 'Interval')}</span>
                <NativeSelect value={preset} onChange={(event) => setPreset(event.target.value)}>
                  {HEARTBEAT_INTERVAL_PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </NativeSelect>
              </div>
              {preset === 'custom' ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">cron</span>
                  <Input value={customCron} onChange={(event) => setCustomCron(event.target.value)} placeholder="0 */6 * * *" className="font-mono" />
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '时区', 'Timezone')}</span>
                <NativeSelect value={cronTimezone} onChange={(event) => setCronTimezone(event.target.value)} className="w-36">
                  {HEARTBEAT_TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </NativeSelect>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void saveSchedule()} disabled={saving} className="border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900">
                {saving ? <Loader2 className="size-4 animate-spin" /> : editingId ? <Check className="size-4" /> : <Plus className="size-4" />}
                {saving
                  ? tr(language, '保存中…', 'Saving…')
                  : editingId
                    ? tr(language, '保存', 'Save')
                    : tr(language, '添加', 'Add')}
              </Button>
              {editingId ? (
                <Button type="button" variant="ghost" size="sm" onClick={cancelEditing} className="text-zinc-400 hover:text-zinc-100">
                  {tr(language, '取消', 'Cancel')}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">{tr(language, '唤醒时提示（可选）', 'Wake-up instructions (optional)')}</span>
              <Textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={2}
                placeholder={tr(language, '例如：检查收件箱与待办，维护记忆；无事则简短汇报。', 'e.g. Check inbox and pending work, maintain memory; report briefly if nothing to do.')}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={activeWindowEnabled}
                  onChange={(event) => setActiveWindowEnabled(event.target.checked)}
                  className="size-3.5 accent-zinc-200"
                />
                {tr(language, '活跃时段', 'Active window')}
              </label>
              {activeWindowEnabled ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Start</span>
                    <Input type="time" value={activeWindowStart} onChange={(event) => setActiveWindowStart(event.target.value)} className="w-28 bg-zinc-950" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">End</span>
                    <Input type="time" value={activeWindowEnd} onChange={(event) => setActiveWindowEnd(event.target.value)} className="w-28 bg-zinc-950" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Timezone</span>
                    <NativeSelect value={activeWindowTz} onChange={(event) => setActiveWindowTz(event.target.value)} className="w-36">
                      {HEARTBEAT_TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                    </NativeSelect>
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{tr(language, '每日上限（0=不限）', 'Daily limit (0 = unlimited)')}</span>
                <Input type="number" min={0} max={1000} value={dailyLimit} onChange={(event) => setDailyLimit(Number(event.target.value) || 0)} className="w-24 bg-zinc-950" />
              </div>
            </div>
          </div>

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}

          {crons.length === 0 ? (
            <p className="py-3 text-sm text-zinc-500">{tr(language, '还没有定时心跳计划。', 'No heartbeat schedules yet.')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {crons.map((cron) => (
                <div key={cron.id} className="flex items-center justify-between gap-3 border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100">{cron.name}</span>
                      <code className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-400">{cron.cronExpression}</code>
                    </div>
                    <span className="text-[11px] text-zinc-500">
                      {tr(language, '上次', 'Last')}: {cron.lastRunAt ? formatDate(cron.lastRunAt) : '—'} · {tr(language, '下次', 'Next')}: {cron.nextRunAt ? formatDate(cron.nextRunAt) : '—'}
                    </span>
                    {(() => {
                      const window = cron.payload?.activeWindow
                      const windowRecord = window && typeof window === 'object' && !Array.isArray(window) ? window as Record<string, unknown> : null
                      const tags: string[] = []
                      if (typeof cron.payload?.timezone === 'string' && cron.payload.timezone !== 'UTC') {
                        tags.push(cron.payload.timezone)
                      }
                      if (windowRecord?.start && windowRecord?.end) {
                        tags.push(`${String(windowRecord.start)}-${String(windowRecord.end)} ${String(windowRecord.timezone ?? 'UTC')}`)
                      }
                      if (typeof cron.payload?.dailyLimit === 'number' && cron.payload.dailyLimit > 0) {
                        tags.push(`${tr(language, '日上限', 'daily')} ${cron.payload.dailyLimit}`)
                      }
                      return tags.length > 0 ? (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {tags.map((tag) => (
                            <code key={tag} className="rounded border border-zinc-800 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-500">{tag}</code>
                          ))}
                        </span>
                      ) : null
                    })()}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" variant="ghost" size="icon-sm" title={tr(language, '编辑', 'Edit')} onClick={() => startEditing(cron)} className="text-zinc-500 hover:text-zinc-100">
                      <Pencil className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" title={tr(language, '立即触发一次', 'Trigger now')} onClick={() => void triggerSchedule(cron)} className="text-zinc-500 hover:text-sky-400">
                      <Zap className="size-4" />
                    </Button>
                    <Switch checked={cron.enabled} onCheckedChange={() => void toggleSchedule(cron)} />
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void deleteSchedule(cron)} className="text-zinc-500 hover:text-rose-400">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-zinc-500">
              <HeartPulse className="size-3.5" />
              {tr(language, '最近心跳', 'Recent heartbeats')}
              <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100">
                <RefreshCw className="size-3" />
              </button>
            </div>
            {heartbeats.length === 0 ? (
              <p className="text-xs text-zinc-600">{tr(language, '暂无心跳记录。', 'No heartbeat records yet.')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {heartbeats.slice(0, 8).map((heartbeat) => (
                  <span key={heartbeat.id} className={cn(
                    'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
                    heartbeat.status === 'online'
                      ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                      : 'border-rose-800/60 bg-rose-950/40 text-rose-300',
                  )}>
                    <span className={cn('size-1.5 rounded-full', heartbeat.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400')} />
                    {formatDate(heartbeat.createdAt)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
