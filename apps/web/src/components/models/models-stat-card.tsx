import { cn } from '../../lib/utils'

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-[#09090b] px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-zinc-100">{value}</p>
        </div>
        <p className="max-w-[8rem] text-right text-[11px] leading-5 text-zinc-500">{hint}</p>
      </div>
    </div>
  )
}