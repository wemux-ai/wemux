import { cn } from '../../lib/utils'

type CapabilitySummaryItem = {
  className?: string
  label: string
  value: string
}

export function CapabilitySummaryStrip({
  items,
  className,
}: {
  items: CapabilitySummaryItem[]
  className?: string
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className={cn('grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {items.map((item) => (
        <div key={item.label} className={cn('rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2', item.className)}>
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{item.label}</p>
          <p className="mt-0.5 text-xs font-medium text-zinc-200">{item.value}</p>
        </div>
      ))}
    </div>
  )
}
