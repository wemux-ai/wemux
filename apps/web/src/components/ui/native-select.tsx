import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type OptionHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '../../lib/utils'

type NativeSelectVariant = 'dark' | 'light'

type NativeSelectOption = {
  id: string
  value: string
  label: ReactNode
  disabled: boolean
}

const triggerVariantClassName: Record<NativeSelectVariant, string> = {
  dark:
    'border-zinc-800 bg-zinc-950/90 text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus:border-zinc-700 focus:ring-zinc-700 disabled:bg-zinc-950/70 disabled:text-zinc-500',
  light:
    'border-stone-200 bg-white text-stone-900 shadow-sm focus:border-stone-300 focus:ring-stone-300 disabled:bg-stone-100 disabled:text-stone-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-600 dark:focus:ring-zinc-600 dark:disabled:bg-zinc-800/70 dark:disabled:text-zinc-500',
}

const contentVariantClassName: Record<NativeSelectVariant, string> = {
  dark: 'border-zinc-800 bg-[#0b0b0d] text-zinc-100 shadow-2xl shadow-black/40',
  light: 'border-stone-200 bg-white text-stone-900 shadow-xl shadow-stone-950/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:shadow-black/40',
}

const optionVariantClassName: Record<NativeSelectVariant, { idle: string; active: string; icon: string }> = {
  dark: {
    idle: 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50',
    active: 'bg-emerald-500/12 text-zinc-50',
    icon: 'text-emerald-300',
  },
  light: {
    idle: 'text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
    active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200',
    icon: 'text-emerald-500 dark:text-emerald-200',
  },
}

const emptyVariantClassName: Record<NativeSelectVariant, string> = {
  dark: 'text-zinc-500',
  light: 'text-stone-400 dark:text-zinc-500',
}

export interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'multiple' | 'size'> {
  children?: ReactNode
  onValueChange?: (value: string) => void
  options?: Array<{
    value: string
    label: ReactNode
    disabled?: boolean
  }>
  placeholder?: string
  wrapperClassName?: string
  variant?: NativeSelectVariant
}

const getNodeText = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (isValidElement<{ children?: ReactNode }>(child)) return getNodeText(child.props.children)
      return ''
    })
    .join('')

const normalizeValue = (value: NativeSelectProps['value'] | NativeSelectProps['defaultValue']) => {
  if (Array.isArray(value)) return String(value[0] ?? '')
  if (value === undefined || value === null) return ''
  return String(value)
}

const createChangeEvent = (value: string, name?: string): ChangeEvent<HTMLSelectElement> => {
  const target = { name, value } as HTMLSelectElement
  return { currentTarget: target, target } as ChangeEvent<HTMLSelectElement>
}

const parseOptions = (children: ReactNode) => {
  const options: NativeSelectOption[] = []

  const visit = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return

      if (child.type === Fragment || child.type === 'optgroup') {
        visit((child.props as { children?: ReactNode }).children)
        return
      }

      if (child.type !== 'option') return

      const optionProps = child.props as OptionHTMLAttributes<HTMLOptionElement>
      const label = optionProps.children ?? optionProps.label ?? ''
      const value = optionProps.value === undefined ? getNodeText(label) : String(optionProps.value)

      options.push({
        id: `option-${options.length}`,
        value,
        label,
        disabled: Boolean(optionProps.disabled),
      })
    })
  }

  visit(children)
  return options
}

const normalizeOptions = (options?: NativeSelectProps['options']) => {
  if (!options?.length) {
    return []
  }

  return options.map((option, index) => ({
    id: `option-${index}`,
    value: option.value,
    label: option.label,
    disabled: Boolean(option.disabled),
  }))
}

export const NativeSelect = forwardRef<HTMLButtonElement, NativeSelectProps>(function NativeSelect(
  {
    children,
    className,
    defaultValue,
    disabled = false,
    id,
    name,
    onChange,
    onValueChange,
    options: optionItems,
    placeholder = '请选择',
    required,
    value,
    wrapperClassName,
    variant = 'dark',
    ...props
  },
  ref,
) {
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [innerValue, setInnerValue] = useState(() => normalizeValue(defaultValue))
  const options = useMemo(
    () => optionItems?.length ? normalizeOptions(optionItems) : parseOptions(children),
    [children, optionItems],
  )
  const currentValue = value === undefined ? innerValue : normalizeValue(value)
  const selectedOption = options.find((option) => option.value === currentValue) ?? null
  const selectedId = selectedOption?.id ?? ''
  const optionTone = optionVariantClassName[variant]

  const commitValue = (option: NativeSelectOption) => {
    if (option.disabled) return
    if (value === undefined) setInnerValue(option.value)
    onChange?.(createChangeEvent(option.value, name))
    onValueChange?.(option.value)
    setOpen(false)
  }

  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) return
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger asChild>
          <button
            {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
            ref={ref}
            id={id}
            type="button"
            disabled={disabled}
            aria-controls={listboxId}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-required={required || undefined}
            className={cn(
              'flex h-11 w-full items-center justify-between rounded-xl border px-3.5 pr-3 text-left text-sm outline-none transition-[border-color,background-color,box-shadow] focus:ring-2 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
              triggerVariantClassName[variant],
              className,
            )}
          >
            <span className={cn('min-w-0 truncate', selectedOption ? '' : emptyVariantClassName[variant])}>
              {selectedOption?.label ?? (currentValue || placeholder)}
            </span>
            <ChevronDown className={cn('ml-3 h-4 w-4 shrink-0', emptyVariantClassName[variant])} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={cn(
            // Portal to body so parent overflow does not clip the menu; sit above Dialog (z-50).
            'z-[100] max-h-[min(22rem,var(--radix-popover-content-available-height))] w-max min-w-[var(--radix-popover-trigger-width)] max-w-[min(28rem,var(--radix-popover-content-available-width))] overflow-y-auto rounded-xl p-1.5',
            contentVariantClassName[variant],
          )}
        >
          <div id={listboxId} role="listbox" aria-required={required || undefined} className="space-y-1">
            {options.length === 0 ? (
              <div className={cn('px-3 py-6 text-center text-sm', emptyVariantClassName[variant])}>暂无选项</div>
            ) : (
              options.map((option) => {
                const active = option.id === selectedId
                return (
                  <button
                    key={`${option.id}-${option.value}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    onClick={() => commitValue(option)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors focus:ring-2 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50',
                      active ? optionTone.active : optionTone.idle,
                    )}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {active ? <Check className={cn('h-4 w-4 shrink-0', optionTone.icon)} /> : null}
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
})
