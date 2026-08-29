import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, GitBranch, Loader2, Search } from 'lucide-react'
import type { Workspace } from '@shared/types'
import { cn } from '../../../lib/utils'
import { useTranslation } from '../../../lib/i18n/react'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'

interface TaskChatWorkspaceBranchControlProps {
  mode: Workspace['workingDirectoryMode']
  value: string
  selectedBranch?: string
  options: string[]
  branchSources?: Record<string, 'remote' | 'local-only'>
  remoteOnly?: boolean
  disabled?: boolean
  loading?: boolean
  saving?: boolean
  message?: string
  triggerClassName?: string
  onChange: (branchName: string) => void | Promise<void>
}

export function TaskChatWorkspaceBranchControl({
  mode,
  value,
  selectedBranch,
  options,
  branchSources,
  remoteOnly = false,
  disabled = false,
  loading = false,
  saving = false,
  message,
  triggerClassName,
  onChange,
}: TaskChatWorkspaceBranchControlProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const activeItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const scrollActive = () => {
      const el = activeItemRef.current
      if (!el) return
      el.scrollIntoView({ block: 'center' })
    }

    // 等待 Popover 动画完成后再滚动
    const timer = setTimeout(scrollActive, 150)
    return () => clearTimeout(timer)
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = useMemo(() => {
    const visibleOptions = remoteOnly && branchSources
      ? options.filter((branch) => branchSources[branch] !== 'local-only')
      : options
    if (!normalizedQuery) {
      return visibleOptions
    }

    return visibleOptions.filter((branch) => branch.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, options, remoteOnly, branchSources])

  const label = value || (mode === 'original-dir' ? '当前分支' : '选择分支')
  const helperText = saving
    ? '切换中…'
    : mode === 'original-dir'
      ? '会直接切换当前工作区目录的实际分支。'
      : '下方列表用于切换工作区代码基线，并重新准备当前隔离目录。'

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      if (disabled) {
        return
      }

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
          title={`工作区代码分支：${label}`}
          className={cn(
            'flex min-w-max max-w-none shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200',
            disabled && 'cursor-not-allowed opacity-50',
            triggerClassName,
          )}
        >
          {saving || loading ? (
            <Loader2 className="h-3 w-3 animate-spin text-emerald-400/80" />
          ) : (
            <GitBranch className="h-3 w-3 text-zinc-500" />
          )}
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-64 rounded-lg border-zinc-800/60 bg-[#0f0f11] p-1.5 text-zinc-100 shadow-xl shadow-black/40">
        <div className="mb-1.5 px-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">
              分支
            </p>
            <span className="text-[9px] text-zinc-500">{saving ? '切换中' : loading ? '读取中' : value ? '当前' : '未设置'}</span>
          </div>
          <p className="mt-px text-[9px] leading-3 text-zinc-500">{message || helperText}</p>
        </div>

        <div className="mb-1.5 px-1">
          <div className="flex items-center gap-1.5 rounded-md border border-zinc-800/60 bg-zinc-950/90 px-2">
            <Search className="h-2.5 w-2.5 text-zinc-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索分支"
              className="h-6 w-full bg-transparent text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div ref={listRef} className="max-h-60 overflow-y-auto overscroll-contain px-1 pb-0.5">
          {loading ? (
            <div className="flex items-center gap-1.5 rounded-md px-2 py-2 text-[11px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              读取中…
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="rounded-md px-2 py-2 text-[11px] text-zinc-500">没有匹配的分支</div>
          ) : (
            filteredOptions.map((branch) => {
              const active = branch === selectedBranch || branch === value
              return (
                <button
                  key={branch}
                  ref={active ? activeItemRef : undefined}
                  type="button"
                  disabled={disabled || saving}
                  onClick={() => {
                    if (branch === selectedBranch) {
                      setOpen(false)
                      setQuery('')
                      return
                    }

                    void onChange(branch)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                    active
                      ? 'bg-zinc-800/80 text-zinc-50'
                      : 'text-zinc-300 hover:bg-zinc-900/50 hover:text-zinc-100',
                    (disabled || saving) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <GitBranch className="h-2.5 w-2.5 shrink-0 text-zinc-500" />
                    <span className="truncate">{branch}</span>
                    {branchSources?.[branch] === 'local-only' ? (
                      <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[8px] leading-none text-amber-400">
                        {t('workspace.branchSources.unpushed')}
                      </span>
                    ) : null}
                  </span>
                  {active ? <Check className="h-3 w-3 shrink-0 text-emerald-400" /> : null}
                </button>
              )
            })
          )}
        </div>

        {remoteOnly ? (
          <p className="mt-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[9px] leading-3 text-sky-300/90">
            {t('workspace.branchSources.cloudOnlyHint')}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
