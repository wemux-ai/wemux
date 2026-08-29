/**
 * [INPUT]: Current snooze state and group/item snooze mutations.
 * [OUTPUT]: Compact preset and custom DateTimePicker control.
 * [POS]: Reusable Inbox action control for group headers and timeline items.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useState } from 'react'
import { AlarmClock, Clock3, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { DateTimePicker } from '../ui/date-time-picker'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { resolveInboxSnoozeUntil, type InboxSnoozePreset } from './inbox-model'

const toLocalDateTimeValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function InboxSnoozeControl({
  busy,
  compact = false,
  language,
  snoozedUntil,
  onSnooze,
  onUnsnooze,
}: {
  busy: boolean
  compact?: boolean
  language: string
  snoozedUntil?: string
  onSnooze: (until: string) => Promise<void>
  onUnsnooze: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [customValue, setCustomValue] = useState(() => toLocalDateTimeValue(new Date(Date.now() + 60 * 60_000)))
  const tr = (zh: string, en: string) => language === 'zh' ? zh : en

  const applyPreset = async (preset: InboxSnoozePreset) => {
    await onSnooze(resolveInboxSnoozeUntil(preset))
    setOpen(false)
  }

  if (snoozedUntil) {
    return (
      <Button
        type="button"
        variant="outline"
        size={compact ? 'icon' : 'sm'}
        disabled={busy}
        onClick={() => void onUnsnooze()}
        className={compact
          ? 'h-7 w-7 rounded-md border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100'
          : 'h-7 gap-1.5 rounded-md border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'}
        aria-label={tr('取消稍后提醒', 'Unsnooze')}
        title={tr('取消稍后提醒', 'Unsnooze')}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {!compact ? tr('取消稍后提醒', 'Unsnooze') : null}
      </Button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? 'icon' : 'sm'}
          disabled={busy}
          className={compact
            ? 'h-7 w-7 rounded-md border-zinc-800 bg-zinc-950 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100'
            : 'h-7 gap-1.5 rounded-md border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'}
          aria-label={tr('稍后提醒', 'Snooze')}
          title={tr('稍后提醒', 'Snooze')}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}
          {!compact ? tr('稍后提醒', 'Snooze') : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-zinc-800 bg-[#09090b] p-2 text-zinc-100 shadow-2xl shadow-black/40">
        <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {tr('稍后提醒', 'Snooze until')}
        </p>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <Button type="button" variant="ghost" className="h-7 rounded-md px-2 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100" onClick={() => void applyPreset('hour')}>
            {tr('1 小时', '1 hour')}
          </Button>
          <Button type="button" variant="ghost" className="h-7 rounded-md px-2 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100" onClick={() => void applyPreset('tomorrow')}>
            {tr('明天', 'Tomorrow')}
          </Button>
          <Button type="button" variant="ghost" className="h-7 rounded-md px-2 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100" onClick={() => void applyPreset('week')}>
            {tr('下周', 'Next week')}
          </Button>
        </div>
        <div className="mt-2 border-t border-zinc-900 pt-2">
          <DateTimePicker
            value={customValue}
            onChange={setCustomValue}
            placeholder={tr('选择日期和时间', 'Choose date and time')}
            triggerClassName="h-8 rounded-md text-xs"
          />
          <Button
            type="button"
            disabled={!customValue}
            onClick={async () => {
              const date = new Date(customValue)
              if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return
              await onSnooze(date.toISOString())
              setOpen(false)
            }}
            className="mt-2 h-7 w-full gap-1.5 rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
          >
            <AlarmClock className="h-3.5 w-3.5" />
            {tr('设置提醒', 'Schedule')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
