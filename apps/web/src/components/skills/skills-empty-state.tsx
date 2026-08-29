import { Boxes } from 'lucide-react'

export function SkillsEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-[#09090b] px-6 text-center">
      <div className="rounded-xl bg-zinc-100 p-3 text-zinc-950">
        <Boxes size={22} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-zinc-50">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
    </div>
  )
}
