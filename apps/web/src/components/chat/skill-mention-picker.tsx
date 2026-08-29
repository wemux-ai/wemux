import { useMemo, useState } from 'react'
import { AtSign, Check, Search } from 'lucide-react'
import { isGlobalSkill, type SkillRecord } from '@shared/skill'
import { cn } from '../../lib/utils'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

export function SkillMentionPicker({
  disabled,
  loading,
  onOpen,
  skills,
  value,
  onSelectSkill,
}: {
  disabled?: boolean
  loading?: boolean
  onOpen?: () => void
  skills: SkillRecord[]
  value: string
  onSelectSkill: (skill: SkillRecord) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return skills
    }

    return skills.filter((skill) => {
      const haystack = [skill.name, skill.slug, skill.description ?? ''].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [query, skills])

  const normalizedValue = value.toLowerCase()

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          onOpen?.()
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AtSign className="h-3 w-3 text-violet-400/80" />
          <span>@Skill</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-80 rounded-xl border-zinc-800 bg-[#0f0f11] p-2 text-zinc-100 shadow-2xl shadow-black/40">
        <div className="mb-2 px-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">插入 Skill Mention</p>
          <p className="mt-1 text-[10px] text-zinc-500">
            这里只会把 <code>@skill</code> 插入消息，不代表立即为当前会话挂载该 skill。
          </p>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 skill 名称或 slug"
              className="h-9 border-zinc-800 bg-zinc-950 pl-8 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>
        </div>

        <div className="max-h-80 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {loading ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-500">
              正在加载 skills...
            </div>
          ) : null}

          {!loading && filteredSkills.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-3 text-xs text-zinc-500">
              没有可用的 skill。
            </div>
          ) : null}

          {filteredSkills.map((skill) => {
            const mentioned = normalizedValue.includes(`@${skill.slug.toLowerCase()}`)

            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => {
                  onSelectSkill(skill)
                  setOpen(false)
                  setQuery('')
                }}
                className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{skill.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <span>@{skill.slug}</span>
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5',
                      isGlobalSkill(skill) ? 'bg-emerald-500/10 text-emerald-300' : 'bg-sky-500/10 text-sky-300',
                    )}>
                      {isGlobalSkill(skill) ? '全局' : '项目'}
                    </span>
                  </span>
                  {skill.description ? (
                    <span className="mt-1 block line-clamp-2 text-[10px] text-zinc-500">{skill.description}</span>
                  ) : null}
                </span>
                <span className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px]',
                  mentioned ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-500',
                )}>
                  {mentioned ? <Check className="h-3 w-3" /> : '插入'}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
