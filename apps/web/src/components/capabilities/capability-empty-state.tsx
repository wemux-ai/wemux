import type { ReactNode } from 'react'

export function CapabilityEmptyState({
  description,
  icon,
  title,
}: {
  description: string
  icon: ReactNode
  title: string
}) {
  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-950/70 px-6 text-center">
      <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2.5 text-zinc-400">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1.5 max-w-md text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  )
}
