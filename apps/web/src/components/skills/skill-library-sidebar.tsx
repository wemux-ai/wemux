import { Bot, ChevronDown, Import } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SkillRecord } from '@shared/skill'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { ScrollArea } from '../ui/scroll-area'
import { sourceMeta } from './skill-page-utils'

const tr = (language: string, zh: string, en: string) => language === 'zh' ? zh : en

export function SkillLibrarySidebar({
  filteredSkills,
  loading,
  selectedSkillId,
  skillFilter,
  skills,
  importAction,
  onFilterChange,
  onSelectSkill,
}: {
  filteredSkills: SkillRecord[]
  loading: boolean
  selectedSkillId: string
  skillFilter: string
  skills: SkillRecord[]
  importAction?: ReactNode
  onFilterChange: (value: string) => void
  onSelectSkill: (skillId: string) => void
}) {
  const { language } = useTranslation()

  return (
    <aside className="flex min-h-0 flex-col border-b border-zinc-800 xl:border-b-0 xl:border-r">
      <div className="border-b border-zinc-800 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{tr(language, '技能库', 'Skill Library')}</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-50">{tr(language, '组织技能库', 'Organization Skill Library')}</h2>
          </div>
          <div className="rounded-2xl bg-zinc-100 p-2 text-zinc-950">
            <Bot size={18} />
          </div>
        </div>
        <div className="mt-4">
          {importAction ?? (
            <Button className="w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200">
              <Import size={16} />
              {tr(language, '引入 Skill', 'Import Skill')}
            </Button>
          )}
        </div>
        <Input
          value={skillFilter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={tr(language, '按名称、slug、来源过滤', 'Filter by name, slug, or source')}
          className="mt-4 border-zinc-800 bg-[#09090b] text-zinc-100 placeholder:text-zinc-500"
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-[0.22em] text-zinc-500">
            <ChevronDown size={12} />
            {tr(language, '技能', 'Skills')}
          </div>
          {loading ? <div className="px-2 py-6 text-sm text-zinc-500">{tr(language, '正在加载 skills...', 'Loading skills...')}</div> : null}
          {!loading && filteredSkills.length === 0 ? (
            <div className="px-2 py-6 text-sm text-zinc-500">
              {skills.length === 0
                ? tr(language, '还没有任何 skill，先在左侧导入一个。', 'No skills yet. Import one from the left first.')
                : tr(language, '没有匹配的 skill。', 'No matching skills.')}
            </div>
          ) : null}
          {filteredSkills.map((skill) => {
            const source = sourceMeta(skill.sourceType, language)
            const active = selectedSkillId === skill.id

            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => onSelectSkill(skill.id)}
                className={cn(
                  'w-full rounded-[1.25rem] border px-4 py-4 text-left transition-colors',
                  active
                    ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
                    : 'border-zinc-800 bg-[#09090b] text-zinc-100 hover:border-zinc-700 hover:bg-zinc-900',
                )}
              >
                <div className="truncate text-sm font-semibold">{skill.name}</div>
                <div className={cn('mt-2 line-clamp-2 text-xs leading-5', active ? 'text-zinc-700' : 'text-zinc-500')}>
                  {skill.description || tr(language, '还没有补充简介。', 'No summary yet.')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className={cn('text-[10px]', active ? 'border-zinc-300 bg-zinc-200 text-zinc-900' : source.className)}>
                    {source.label}
                  </Badge>
                  <span className={cn('text-[11px]', active ? 'text-zinc-700' : 'text-zinc-500')}>
                    {skill.slug}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
