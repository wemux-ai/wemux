import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Loader2, Radio, Search, Server } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

export type ExecutorSelectStatusTone = 'busy' | 'neutral' | 'offline' | 'online'

/** 模态 Dialog 的滚动锁在 document 上监听 wheel/touchmove（冒泡阶段）。
 * 菜单 portal 到 body 下：事件先到达菜单，再冒泡到 document。
 * 在这里截断冒泡，避免滚动锁把菜单自身的滚动误判为“弹窗外滚动”而 preventDefault。 */
const stopMenuScrollIsolation = (event: { stopPropagation: () => void }) => {
  event.stopPropagation()
}

export interface ExecutorSelectOption {
  value: string
  label: string
  description?: string
  badgeLabel?: string
  keywords?: Array<string | undefined>
  disabled?: boolean
  statusTone?: ExecutorSelectStatusTone | string
}

interface ExecutorSelectProps {
  value: string
  options: ExecutorSelectOption[]
  placeholder: string
  emptyText: string
  searchPlaceholder?: string
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onChange: (value: string) => void
  title?: string
  meta?: string
  hint?: string
  headerAction?: ReactNode
  compact?: boolean
  searchable?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  align?: 'start' | 'center' | 'end'
  triggerClassName?: string
  contentClassName?: string
  selectedLabelOverride?: string
  selectedMetaLabel?: string
  selectedStatusLabel?: string
  selectedStatusTone?: ExecutorSelectStatusTone | string
  loading?: boolean
}

const toneDotClassName: Record<ExecutorSelectStatusTone, string> = {
  online: 'bg-emerald-400',
  busy: 'bg-amber-400',
  offline: 'bg-zinc-600',
  neutral: 'bg-zinc-600',
}

const toneBadgeClassName: Record<ExecutorSelectStatusTone, string> = {
  online: 'border-emerald-500/15 bg-emerald-500/8 text-emerald-400/80',
  busy: 'border-amber-500/15 bg-amber-500/8 text-amber-400/80',
  offline: 'border-zinc-700/50 bg-zinc-800/50 text-zinc-500',
  neutral: 'border-zinc-700/50 bg-zinc-800/50 text-zinc-500',
}

const toneTriggerIconClassName: Record<ExecutorSelectStatusTone, string> = {
  online: 'text-emerald-500/70',
  busy: 'text-amber-400/80',
  offline: 'text-zinc-500',
  neutral: 'text-zinc-500',
}

const resolveStatusTone = (tone?: string): ExecutorSelectStatusTone => {
  if (tone === 'online' || tone === 'busy' || tone === 'offline') {
    return tone
  }

  return 'neutral'
}

export function ExecutorSelect({
  value,
  options,
  placeholder,
  emptyText,
  searchPlaceholder,
  disabled = false,
  open,
  onOpenChange,
  onChange,
  title,
  meta,
  hint,
  headerAction,
  compact = false,
  searchable = true,
  side = 'bottom',
  sideOffset = 8,
  align = 'start',
  triggerClassName,
  contentClassName,
  selectedLabelOverride,
  selectedMetaLabel,
  selectedStatusLabel,
  selectedStatusTone,
  loading = false,
}: ExecutorSelectProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [query, setQuery] = useState('')
  const resolvedOpen = open ?? uncontrolledOpen
  const activeItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!resolvedOpen) return

    const scrollActive = () => {
      const el = activeItemRef.current
      if (!el) return
      el.scrollIntoView({ block: 'center' })
    }

    const timer = setTimeout(scrollActive, 150)
    return () => clearTimeout(timer)
  }, [resolvedOpen])

  const setResolvedOpen = (nextOpen: boolean) => {
    if (disabled) {
      return
    }

    if (open === undefined) {
      setUncontrolledOpen(nextOpen)
    }

    onOpenChange?.(nextOpen)

    if (!nextOpen) {
      setQuery('')
    }
  }

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        if (!normalizedQuery) {
          return true
        }

        const haystack = [option.label, option.description, ...(option.keywords ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return haystack.includes(normalizedQuery)
      }),
    [normalizedQuery, options],
  )
  const selectedTone = resolveStatusTone(selectedOption?.statusTone)
  const selectedStatusBadgeTone = resolveStatusTone(selectedStatusTone)
  const headerVisible = Boolean(title || meta || hint || headerAction || searchable)

  return (
    <div>
      <Popover open={resolvedOpen} onOpenChange={setResolvedOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-busy={loading || undefined}
            title={title}
            className={cn(
              compact
                ? 'flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-2 py-1 text-xs text-zinc-400 transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-800/60 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60'
                : 'flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3.5 text-left text-sm text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none transition-[border-color,background-color,box-shadow] hover:border-zinc-700 focus:ring-2 focus:ring-zinc-700 focus:ring-offset-0 disabled:cursor-not-allowed disabled:bg-zinc-950/70 disabled:text-zinc-500 disabled:opacity-60',
              triggerClassName,
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {loading ? (
                <Loader2 className={cn(compact ? 'h-3 w-3' : 'h-4 w-4', 'shrink-0 animate-spin text-sky-400 motion-reduce:animate-none')} />
              ) : (
                <Radio className={cn(compact ? 'h-3 w-3' : 'h-4 w-4', toneTriggerIconClassName[selectedTone], 'shrink-0')} />
              )}
              <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                {selectedStatusLabel ? (
                  <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium', toneBadgeClassName[selectedStatusBadgeTone])}>
                    {selectedStatusLabel}
                  </span>
                ) : null}
                <span className={cn('min-w-0 truncate', selectedOption || selectedLabelOverride ? '' : 'text-zinc-500')}>
                  {selectedLabelOverride ?? selectedOption?.label ?? placeholder}
                </span>
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {selectedMetaLabel ? (
                <span className={cn(
                  compact ? 'text-[10px]' : 'text-xs',
                  'font-medium text-zinc-500',
                )}
                >
                  {selectedMetaLabel}
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  compact ? 'h-3 w-3' : 'h-4 w-4',
                  'shrink-0 opacity-60 transition-transform',
                  resolvedOpen && 'rotate-180',
                )}
              />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          side={side}
          sideOffset={sideOffset}
          onWheel={stopMenuScrollIsolation}
          onTouchMove={stopMenuScrollIsolation}
          className={cn(
            // pointer-events-auto：模态 Dialog 会把 body 置为 pointer-events: none，
            // 不加这一条连菜单点击都收不到（滚轮也会被滚动锁拦截，见 stopMenuScrollIsolation）。
            'pointer-events-auto flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),12rem)] max-w-[min(20rem,var(--radix-popover-content-available-width))] flex-col overflow-hidden rounded-lg border-zinc-800/60 bg-[#0f0f11] p-0 text-zinc-100 shadow-xl shadow-black/40 backdrop-blur-sm',
            contentClassName,
          )}
        >
          {headerVisible ? (
            <div className="border-b border-zinc-800/60 px-2 py-1">
              {(title || meta || headerAction) ? (
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Server className="h-2.5 w-2.5 text-zinc-600" />
                    <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-zinc-500">{title || placeholder}</p>
                  </div>
                  {headerAction || (meta ? <span className="text-[9px] text-zinc-500">{meta}</span> : null)}
                </div>
              ) : null}

              {hint ? <p className="mb-1 text-[9px] leading-3 text-zinc-500">{hint}</p> : null}

              {searchable ? (
                <div className="rounded-md border border-zinc-800/60 bg-zinc-950/90 px-2">
                  <div className="flex items-center gap-1.5">
                    <Search className="h-2.5 w-2.5 text-zinc-600" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={searchPlaceholder ?? `搜索${placeholder}`}
                      className="h-6 w-full bg-transparent text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-500">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const active = option.value === value
                const tone = resolveStatusTone(option.statusTone)

                return (
                  <button
                    key={`${option.value || 'empty'}-${option.label}`}
                    ref={active ? activeItemRef : undefined}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) {
                        return
                      }

                      onChange(option.value)
                      setResolvedOpen(false)
                    }}
                    className={cn(
                      'group flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-all duration-150',
                      active
                        ? 'bg-zinc-800/80 text-zinc-50'
                        : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100',
                      option.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <span className={cn(
                        'h-1 w-1 shrink-0 rounded-full transition-colors',
                        toneDotClassName[tone],
                        active && 'ring-1 ring-current/20',
                      )} />
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="block truncate text-[11px] font-medium leading-tight">{option.label}</span>
                        {option.description ? (
                          <span className="mt-px block text-[10px] leading-tight text-zinc-500 transition-colors group-hover:text-zinc-400">{option.description}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {active ? (
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500/10">
                          <Check className="h-2.5 w-2.5 text-emerald-400" />
                        </span>
                      ) : null}
                      {option.badgeLabel ? (
                        <span className={cn(
                          'rounded-full border px-1.5 py-px text-[9px] font-medium transition-colors',
                          toneBadgeClassName[tone],
                          active && 'border-emerald-500/30',
                        )}>
                          {option.badgeLabel}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
