/**
 * [INPUT]: Task field values and project assignee catalogs.
 * [OUTPUT]: Compact Linear-style task creation controls for status, priority, and human/Agent assignment.
 * [POS]: Presentational Kanban form controls; assignment validation remains server-side.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  Search,
} from 'lucide-react'
import type { PopoverContentProps } from '@radix-ui/react-popover'
import type { TaskStatus } from '@shared/types'
import { cn, statusMeta } from '../../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { priorityConfig } from './constants'
import { TaskStatusIcon } from '../task-status-icon'
import { useTranslation } from '../../lib/i18n/react'
import { resolveMediaUrl, type ProjectAssignee } from '../../lib/api'

export const MAX_RECENT_OPTION_COUNT = 8

export type SearchableSelectOption = {
  value: string
  label: string
  description?: string
  keywords?: Array<string | undefined>
  avatarUrl?: string
  shortcutHint?: string
  color?: string
}

export function Field({
  label,
  extra,
  children,
}: {
  label: string
  extra?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-zinc-300">{label}</label>
        {extra ? <span className="text-xs text-zinc-500">{extra}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function SelectField({
  label,
  caption,
  message,
  children,
}: {
  label: string
  caption?: string
  message?: string
  children: React.ReactNode
}) {
  return (
    <Field label={label}>
      <div>
        {children}
        {caption ? <p className="mt-3 text-xs text-zinc-500">{caption}</p> : null}
        {message ? <p className="mt-1 text-xs text-zinc-500">{message}</p> : null}
      </div>
    </Field>
  )
}

export function ModeOption({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-4 py-3 text-left transition',
        active
          ? 'border-emerald-500/35 bg-emerald-500/10 text-zinc-50'
          : 'border-zinc-800 bg-zinc-950/80 text-zinc-300 hover:border-zinc-700',
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
    </button>
  )
}

export function QuickBranchChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs transition',
        active
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
          : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      {label}
    </button>
  )
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  emptyText,
  recentStorageKey,
  leadingIcon,
  loading,
  loadingText,
  triggerClassName,
  popoverClassName,
  side = 'bottom',
  sideOffset = 4,
  onChange,
}: {
  value: string
  options: SearchableSelectOption[]
  placeholder: string
  emptyText: string
  recentStorageKey?: string
  leadingIcon?: React.ReactNode
  loading?: boolean
  loadingText?: string
  triggerClassName?: string
  popoverClassName?: string
  side?: PopoverContentProps['side']
  sideOffset?: number
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recentValues, setRecentValues] = useState<string[]>([])

  const selectedOption = options.find((option) => option.value === value) ?? null
  const normalizedQuery = query.trim().toLowerCase()
  const orderedOptions = useMemo(() => {
    if (!recentStorageKey || recentValues.length === 0) {
      return options
    }

    const recentOrder = new Map<string, number>(recentValues.map((item, index) => [item, index]))

    return [...options].sort((left, right) => {
      const leftRank = recentOrder.get(left.value)
      const rightRank = recentOrder.get(right.value)

      if (leftRank === undefined && rightRank === undefined) return 0
      if (leftRank === undefined) return 1
      if (rightRank === undefined) return -1
      return leftRank - rightRank
    })
  }, [options, recentStorageKey, recentValues])

  const filteredOptions = orderedOptions.filter((option) => {
    if (!normalizedQuery) return true
    const haystacks = [option.label, option.description, ...(option.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystacks.includes(normalizedQuery)
  })

  useEffect(() => {
    if (!recentStorageKey) {
      setRecentValues([])
      return
    }

    try {
      const raw = window.localStorage.getItem(recentStorageKey)
      if (!raw) {
        setRecentValues([])
        return
      }

      const parsed = JSON.parse(raw)
      setRecentValues(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
    } catch {
      setRecentValues([])
    }
  }, [recentStorageKey])

  const updateRecentValues = (nextValue: string) => {
    if (!recentStorageKey || !nextValue) {
      return
    }

    setRecentValues((current) => {
      const nextRecentValues = [nextValue, ...current.filter((item) => item !== nextValue)].slice(0, MAX_RECENT_OPTION_COUNT)

      try {
        window.localStorage.setItem(recentStorageKey, JSON.stringify(nextRecentValues))
      } catch {
        return nextRecentValues
      }

      return nextRecentValues
    })
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (!nextOpen) setQuery('')
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-left transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60',
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {leadingIcon ? <span className="shrink-0 text-zinc-500">{leadingIcon}</span> : null}
            <span className="min-w-0 truncate">{selectedOption?.label ?? placeholder}</span>
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align="start"
        className={cn(
          // Portal to body so modal overflow does not clip the menu; sit above Dialog (z-50).
          'z-[100] flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),20rem)] max-w-[min(28rem,var(--radix-popover-content-available-width))] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-xl shadow-black/30',
          popoverClassName,
        )}
      >
        <div className="border-b border-zinc-900 p-2">
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="h-9 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {loading ? <SearchableSelectState label={loadingText ?? '加载中...'} /> : null}
          {!loading && filteredOptions.length === 0 ? <SearchableSelectState label={emptyText} /> : null}
          {!loading ? filteredOptions.map((option) => {
            const active = option.value === value
            return (
              <button
                key={`${option.value || 'default'}-${option.label}`}
                type="button"
                onClick={() => {
                  updateRecentValues(option.value)
                  onChange(option.value)
                  setOpen(false)
                  setQuery('')
                }}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                  active ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/40 hover:text-zinc-100',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{option.label}</span>
                  {option.description ? <span className="mt-0.5 block truncate text-xs text-zinc-500">{option.description}</span> : null}
                </span>
                {active ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : null}
              </button>
            )
          }) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SearchableSelectState({ label }: { label: string }) {
  return <div className="px-3 py-6 text-center text-sm text-zinc-500">{label}</div>
}

export function PrioritySelect({
  value,
  disabled,
  triggerClassName,
  side = 'bottom',
  sideOffset = 4,
  onChange,
}: {
  value: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  disabled?: boolean
  triggerClassName?: string
  side?: PopoverContentProps['side']
  sideOffset?: number
  onChange: (value: 'none' | 'low' | 'medium' | 'high' | 'urgent') => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedOption = priorityConfig.find((item) => item.id === value)
    ?? priorityConfig.find((item) => item.id === 'medium')
    ?? priorityConfig[0]

  const getPriorityLabel = (id: string) => {
    return t(`createTask.priority.${id}`)
  }

  const triggerLabel = getPriorityLabel(selectedOption.id)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-left transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60',
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <PriorityGlyph priorityId={selectedOption.id} trigger />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-zinc-100">{triggerLabel}</span>
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align="start"
        className="w-[19rem] rounded-lg border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-xl shadow-black/30"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-900 px-3.5 py-2.5">
          <span className="text-[13px] text-zinc-400">{t('createTask.priority.changePrompt')}</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-[11px] text-zinc-500">P</span>
        </div>
        <div className="p-1">
          {priorityConfig.map((item) => {
          const active = item.id === value

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange(item.id as 'none' | 'low' | 'medium' | 'high' | 'urgent')
                setOpen(false)
              }}
              className={cn(
                'flex h-8 w-full items-center justify-between gap-2.5 rounded-md px-2.5 text-left transition-colors',
                active ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/40 hover:text-zinc-100',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <PriorityGlyph priorityId={item.id} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{getPriorityLabel(item.id)}</span>
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-zinc-100" /> : null}
                <span className={cn('text-[12px] font-medium tabular-nums', item.id === 'none' ? 'text-zinc-600' : 'text-zinc-400')}>
                  {item.id === 'none' ? '0' : item.id === 'urgent' ? '1' : item.id === 'high' ? '2' : item.id === 'medium' ? '3' : '4'}
                </span>
              </span>
            </button>
          )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const statusConfig = [
  { id: 'backlog', labelKey: 'status.backlog', color: 'bg-zinc-400' },
  { id: 'todo', labelKey: 'status.todo', color: 'bg-blue-400' },
  { id: 'in_progress', labelKey: 'status.inProgress', color: 'bg-amber-400' },
  { id: 'in_review', labelKey: 'status.inReview', color: 'bg-violet-400' },
  { id: 'done', labelKey: 'status.done', color: 'bg-emerald-400' },
  { id: 'blocked', labelKey: 'status.blocked', color: 'bg-rose-400' },
  { id: 'cancelled', labelKey: 'status.cancelled', color: 'bg-zinc-500' },
] as const

export function StatusSelect({
  value,
  disabled,
  triggerClassName,
  side = 'bottom',
  sideOffset = 4,
  onChange,
}: {
  value: string
  disabled?: boolean
  triggerClassName?: string
  side?: PopoverContentProps['side']
  sideOffset?: number
  onChange: (value: TaskStatus) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedOption = statusConfig.find((item) => item.id === value)
    ?? statusConfig[0]

  const getStatusLabel = (id: string) => {
    const config = statusConfig.find((item) => item.id === id)
    return config ? t(`createTask.${config.labelKey}`) : id
  }

  const triggerLabel = getStatusLabel(selectedOption.id)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-7 w-auto items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-left transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60',
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <TaskStatusIcon status={selectedOption.id as TaskStatus} size={14} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-zinc-100">{triggerLabel}</span>
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align="start"
        className="w-[16rem] rounded-lg border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-xl shadow-black/30"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-900 px-3.5 py-2.5">
          <span className="text-[13px] text-zinc-400">{t('createTask.status.changePrompt')}</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-[11px] text-zinc-500">S</span>
        </div>
        <div className="p-1">
          {statusConfig.map((item) => {
            const active = item.id === value
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(item.id as TaskStatus)
                  setOpen(false)
                }}
                className={cn(
                  'flex h-8 w-full items-center justify-between gap-2.5 rounded-md px-2.5 text-left transition-colors',
                  active ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/40 hover:text-zinc-100',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <TaskStatusIcon status={item.id as TaskStatus} size={14} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{getStatusLabel(item.id)}</span>
                  </span>
                </span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-zinc-100" /> : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function AssigneeSelect({
  assignees,
  value,
  disabled,
  triggerClassName,
  side = 'bottom',
  sideOffset = 4,
  onChange,
}: {
  assignees: ProjectAssignee[]
  value?: string
  disabled?: boolean
  triggerClassName?: string
  side?: PopoverContentProps['side']
  sideOffset?: number
  onChange: (value?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const assignableOptions = assignees.filter((assignee) => (
    assignee.kind === 'user' || assignee.kind === 'agent' || !assignee.kind
  ))
  const selected = assignableOptions.find((a) => a.id === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-7 w-full items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-left transition-colors hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60',
            triggerClassName,
          )}
        >
          <Avatar className="h-4 w-4 shrink-0 border-0">
            {selected?.avatarUrl ? <AvatarImage src={resolveMediaUrl(selected.avatarUrl)} /> : null}
            <AvatarFallback className="bg-zinc-800 text-[8px] font-medium text-zinc-400">
              {selected?.name ? selected.name.slice(0, 2).toUpperCase() : '?'}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate text-xs font-medium text-zinc-100">
            {selected?.name ?? '未指派'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={sideOffset}
        align="start"
        className="w-[16rem] rounded-lg border border-zinc-800 bg-[#09090b] p-0 text-zinc-100 shadow-xl shadow-black/30"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-900 px-3.5 py-2.5">
          <span className="text-[13px] text-zinc-400">更改负责人为...</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-[11px] text-zinc-500">A</span>
        </div>
        <div className="p-1">
          <button
            type="button"
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
            className={cn(
              'flex h-8 w-full items-center justify-between gap-2.5 rounded-md px-2.5 text-left transition-colors',
              !value ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/40 hover:text-zinc-100',
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[8px] text-zinc-400">?</span>
              <span className="text-[13px] font-medium text-zinc-400">未指派</span>
            </span>
            {!value ? <Check className="h-3.5 w-3.5 shrink-0 text-zinc-100" /> : null}
          </button>
          {assignableOptions.map((item) => {
            const active = item.id === value
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(item.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex h-8 w-full items-center justify-between gap-2.5 rounded-md px-2.5 text-left transition-colors',
                  active ? 'bg-zinc-900/80 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900/40 hover:text-zinc-100',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="h-4 w-4 shrink-0 border-0">
                    {item.avatarUrl ? <AvatarImage src={resolveMediaUrl(item.avatarUrl)} /> : null}
                    <AvatarFallback className="bg-zinc-800 text-[8px] font-medium text-zinc-400">
                      {item.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate text-[13px] font-medium">{item.name}</span>
                  {item.kind === 'agent' ? (
                    <span className="shrink-0 text-[10px] text-sky-400">Agent</span>
                  ) : null}
                </span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-zinc-100" /> : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const priorityColors: Record<string, string> = {
  none: 'text-zinc-500',
  low: 'text-emerald-400',
  medium: 'text-sky-400',
  high: 'text-amber-300',
  urgent: 'text-rose-400',
}

function PriorityGlyph({
  priorityId,
  trigger = false,
}: {
  priorityId: string
  trigger?: boolean
}) {
  const size = trigger ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const colorClass = priorityColors[priorityId] || 'text-zinc-500'
  
  if (priorityId === 'urgent') {
    return (
      <svg className={cn('shrink-0', size, colorClass)} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="7" y="4.5" width="2" height="5" rx="1" fill="currentColor" />
        <circle cx="8" cy="11.5" r="1" fill="currentColor" />
      </svg>
    )
  }

  if (priorityId === 'none') {
    return (
      <svg className={cn('shrink-0', size, colorClass)} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="6.5" width="12" height="2" rx="1" fill="currentColor" />
        <rect x="2" y="10" width="12" height="2" rx="1" fill="currentColor" />
      </svg>
    )
  }

  if (priorityId === 'high') {
    return (
      <svg className={cn('shrink-0', size, colorClass)} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="8" width="3" height="6" rx="1.5" fill="currentColor" />
        <rect x="6.5" y="4.5" width="3" height="9.5" rx="1.5" fill="currentColor" />
        <rect x="11" y="1" width="3" height="13" rx="1.5" fill="currentColor" />
      </svg>
    )
  }

  if (priorityId === 'medium') {
    return (
      <svg className={cn('shrink-0', size, colorClass)} viewBox="0 0 16 16" fill="none">
        <rect x="2" y="8" width="3" height="6" rx="1.5" fill="currentColor" />
        <rect x="6.5" y="4.5" width="3" height="9.5" rx="1.5" fill="currentColor" />
        <rect x="11" y="1" width="3" height="13" rx="1.5" fill="currentColor" opacity="0.35" />
      </svg>
    )
  }

  // low
  return (
    <svg className={cn('shrink-0', size, colorClass)} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="8" width="3" height="6" rx="1.5" fill="currentColor" />
      <rect x="6.5" y="4.5" width="3" height="9.5" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="11" y="1" width="3" height="13" rx="1.5" fill="currentColor" opacity="0.35" />
    </svg>
  )
}
