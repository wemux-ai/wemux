import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

type SearchableSelectVariant = 'dark' | 'light'

/** 模态 Dialog 的滚动锁在 document 上监听 wheel/touchmove（冒泡阶段）。
 * 菜单 portal 到 body 下：事件先到达菜单，再冒泡到 document。
 * 在这里截断冒泡，避免滚动锁把菜单自身的滚动误判为“弹窗外滚动”而 preventDefault。 */
const stopMenuScrollIsolation = (event: { stopPropagation: () => void }) => {
  event.stopPropagation()
}

const triggerVariantClassName: Record<SearchableSelectVariant, string> = {
  dark:
    'border-zinc-800 bg-zinc-950/90 text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:border-zinc-700 focus:border-zinc-700 focus:ring-zinc-700 disabled:bg-zinc-950/70 disabled:text-zinc-500',
  light:
    'border-stone-200 bg-white text-stone-900 shadow-sm hover:border-stone-300 focus:border-stone-300 focus:ring-stone-300 disabled:bg-stone-100 disabled:text-stone-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600 dark:focus:border-zinc-600 dark:focus:ring-zinc-600 dark:disabled:bg-zinc-800/70 dark:disabled:text-zinc-500',
}

const contentVariantClassName: Record<SearchableSelectVariant, string> = {
  dark: 'border-zinc-800 bg-[#0b0b0d] text-zinc-100 shadow-2xl shadow-black/40',
  light: 'border-stone-200 bg-white text-stone-900 shadow-xl shadow-stone-950/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-black/40',
}

const searchWrapVariantClassName: Record<SearchableSelectVariant, string> = {
  dark: 'border-zinc-800 bg-zinc-950/90',
  light: 'border-stone-200 bg-stone-50 dark:border-zinc-700 dark:bg-zinc-800',
}

const searchInputVariantClassName: Record<SearchableSelectVariant, string> = {
  dark: 'text-zinc-100 placeholder:text-zinc-500',
  light: 'text-stone-900 placeholder:text-stone-400 dark:text-zinc-100 dark:placeholder:text-zinc-500',
}

const itemVariantClassName: Record<SearchableSelectVariant, { idle: string; active: string; desc: string; icon: string }> = {
  dark: {
    idle: 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50',
    active: 'bg-emerald-500/12 text-zinc-50',
    desc: 'text-zinc-500',
    icon: 'text-emerald-300',
  },
  light: {
    idle: 'text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
    active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200',
    desc: 'text-stone-400 dark:text-zinc-500',
    icon: 'text-emerald-500 dark:text-emerald-200',
  },
}

const stateVariantClassName: Record<SearchableSelectVariant, string> = {
  dark: 'text-zinc-500',
  light: 'text-stone-400 dark:text-zinc-500',
}

export type SearchableSelectOption = {
  value: string
  label: string
  description?: string
  badgeLabel?: string
  color?: string
  icon?: ReactNode
  keywords?: Array<string | undefined>
  disabled?: boolean
}

interface SearchableSelectProps {
  value: string
  options: SearchableSelectOption[]
  placeholder: string
  emptyText: string
  searchPlaceholder?: string
  disabled?: boolean
  variant?: SearchableSelectVariant
  triggerClassName?: string
  contentClassName?: string
  portalContainer?: HTMLElement | null
  onChange: (value: string) => void
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  emptyText,
  searchPlaceholder,
  disabled = false,
  variant = 'dark',
  triggerClassName,
  contentClassName,
  portalContainer,
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        if (!normalizedQuery) return true
        const haystack = [option.label, option.description, ...(option.keywords ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedQuery)
      }),
    [normalizedQuery, options],
  )
  const itemTone = itemVariantClassName[variant]

  const renderOptionMark = (option: SearchableSelectOption) => {
    if (option.color) {
      return (
        <span
          aria-hidden
          className="size-3.5 shrink-0 rounded-sm"
          style={{ backgroundColor: option.color }}
        />
      )
    }

    if (option.icon) {
      return <span className="shrink-0">{option.icon}</span>
    }

    return null
  }

  return (
    <Popover
      // 模态 Dialog 打开时 react-remove-scroll 会在 document 上拦截滚轮/触摸：
      // 菜单保持 portal 到 body（不被弹窗 overflow 裁剪、不影响触发按钮布局），
      // 通过 pointer-events-auto + 冒泡截断让菜单在弹窗内仍可交互、可滚动。
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled) return
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-left text-sm outline-none transition-[border-color,background-color,box-shadow] focus:ring-2 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
            triggerVariantClassName[variant],
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedOption ? renderOptionMark(selectedOption) : null}
            <span className={cn('min-w-0 truncate', selectedOption ? '' : variant === 'dark' ? 'text-zinc-500' : 'text-stone-400 dark:text-zinc-500')}>
              {selectedOption?.label ?? placeholder}
            </span>
            {selectedOption?.badgeLabel ? (
              <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                {selectedOption.badgeLabel}
              </span>
            ) : null}
          </span>
          <ChevronDown className={cn('ml-3 h-4 w-4 shrink-0', variant === 'dark' ? 'text-zinc-500' : 'text-stone-400 dark:text-zinc-500')} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        container={portalContainer ?? undefined}
        onWheel={stopMenuScrollIsolation}
        onTouchMove={stopMenuScrollIsolation}
        className={cn(
          // Portal to body (default) so dialog overflow-hidden does not clip the menu.
          // pointer-events-auto：模态 Dialog 会把 body 置为 pointer-events: none，
          // 不加这一条连菜单点击都收不到。
          // z-[100] keeps the menu above Dialog/Drawer layers that also use z-50.
          'pointer-events-auto z-[100] flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),14rem)] max-w-[min(24rem,var(--radix-popover-content-available-width))] flex-col overflow-hidden rounded-lg p-0',
          contentVariantClassName[variant],
          contentClassName,
        )}
      >
        <div className={cn('border-b p-2', variant === 'dark' ? 'border-zinc-800' : 'border-stone-200 dark:border-zinc-800')}>
          <div className={cn('flex items-center gap-1.5 rounded-lg border px-2.5', searchWrapVariantClassName[variant])}>
            <Search className={cn('h-3.5 w-3.5', variant === 'dark' ? 'text-zinc-500' : 'text-stone-400 dark:text-zinc-500')} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder ?? `搜索${placeholder}`}
              className={cn('h-8 w-full bg-transparent text-xs outline-none', searchInputVariantClassName[variant])}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {filteredOptions.length === 0 ? (
            <div className={cn('px-3 py-4 text-center text-xs', stateVariantClassName[variant])}>{emptyText}</div>
          ) : (
            filteredOptions.map((option) => {
              const active = option.value === value
              const disabled = Boolean(option.disabled)
              return (
                <button
                  key={`${option.value || 'empty'}-${option.label}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return
                    onChange(option.value)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active ? itemTone.active : itemTone.idle,
                    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {renderOptionMark(option)}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{option.label}</span>
                      {option.description ? (
                        <span className={cn('mt-0.5 block text-[11px]', itemTone.desc)}>{option.description}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {option.badgeLabel ? (
                      <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                        {option.badgeLabel}
                      </span>
                    ) : null}
                    {active ? <Check className={cn('h-3.5 w-3.5', itemTone.icon)} /> : null}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
