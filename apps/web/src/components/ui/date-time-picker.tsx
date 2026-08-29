import { CalendarIcon, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { Calendar } from './calendar'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

function parseDateTimeLocalValue(value: string) {
  if (!value.trim()) {
    return undefined
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function formatDateTimeInputPart(value: number) {
  return String(value).padStart(2, '0')
}

function buildDateTimeLocalValue(date: Date, timeValue: string) {
  const [hours = '00', minutes = '00'] = timeValue.split(':')
  const nextDate = new Date(date)
  nextDate.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0)

  return [
    nextDate.getFullYear(),
    formatDateTimeInputPart(nextDate.getMonth() + 1),
    formatDateTimeInputPart(nextDate.getDate()),
  ].join('-') + `T${formatDateTimeInputPart(nextDate.getHours())}:${formatDateTimeInputPart(nextDate.getMinutes())}`
}

function formatTaskDate(date: Date) {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function DateTimePicker({
  value,
  disabled = false,
  placeholder = '选择日期和时间',
  onChange,
  className,
  triggerClassName,
  trigger,
  side = 'bottom',
  sideOffset = 8,
}: {
  value: string
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
  className?: string
  triggerClassName?: string
  trigger?: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  sideOffset?: number
}) {
  const selectedDate = parseDateTimeLocalValue(value)
  const timeValue = value ? value.slice(11, 16) || '09:00' : '09:00'

  const handleDateChange = (date?: Date) => {
    if (!date) {
      return
    }

    onChange(buildDateTimeLocalValue(date, timeValue))
  }

  const handleTimeChange = (nextTime: string) => {
    if (!selectedDate) {
      onChange('')
      return
    }

    onChange(buildDateTimeLocalValue(selectedDate, nextTime || '00:00'))
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
  }

  const buttonHeightClass = triggerClassName?.match(/\bh-\d+/)?.[0] || 'h-8'

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger || (
          <div className={cn('flex gap-1', className)}>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className={cn(
                'min-w-0 flex-1 justify-start rounded-md border-zinc-800 bg-zinc-950/80 px-2.5 text-left text-[13px] font-normal text-zinc-300 shadow-none hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:border-zinc-700 focus-visible:ring-1 focus-visible:ring-violet-500/40 focus-visible:ring-offset-0',
                'h-8',
                !selectedDate && 'text-zinc-600',
                triggerClassName,
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              <span className="ml-1.5 truncate">{selectedDate ? formatTaskDate(selectedDate) : placeholder}</span>
            </Button>

            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={handleClear}
                className={cn(
                  'w-8 shrink-0 rounded-md text-zinc-600 hover:bg-zinc-900 hover:text-zinc-300',
                  buttonHeightClass,
                )}
                aria-label="清空时间"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent side={side} sideOffset={sideOffset} align="start" className="w-[280px] overflow-hidden rounded-lg border border-zinc-800 bg-[#111113] p-0 text-zinc-100 shadow-[0_8px_32px_rgba(0,0,0,0.56),0_2px_8px_rgba(0,0,0,0.34)]">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateChange}
          buttonVariant="ghost"
          className="p-2 text-zinc-100"
          classNames={{
            months: 'flex flex-col gap-0',
            month: 'flex flex-col gap-2',
            month_caption: 'flex items-center justify-between px-1 py-1',
            caption_label: 'text-[13px] font-medium text-zinc-200',
            nav: 'flex items-center gap-1',
            button_previous: 'h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
            button_next: 'h-6 w-6 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
            weekday: 'flex-1 text-center text-[11px] font-medium text-zinc-600 py-1',
            week: 'flex gap-0 mt-0',
            day: 'relative flex items-center justify-center h-8 w-8',
            today: 'rounded-md bg-zinc-900 text-zinc-100 font-medium',
            selected: 'rounded-md bg-violet-600 text-white font-medium hover:bg-violet-600',
            outside: 'text-zinc-700',
            disabled: 'text-zinc-800 opacity-40',
            range_start: 'rounded-l-md',
            range_end: 'rounded-r-md',
            range_middle: 'rounded-none',
          }}
        />
        <div className="border-t border-zinc-800/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-zinc-500">时间</span>
            <Input
              type="time"
              value={timeValue}
              disabled={disabled || !selectedDate}
              onChange={(event) => handleTimeChange(event.target.value)}
              className="h-7 flex-1 rounded-md border-zinc-800 bg-zinc-950 px-2 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:ring-violet-500/20"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
