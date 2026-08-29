// [INPUT]: 已鉴权应用壳 + 全局快捷键
// [OUTPUT]: 悬浮全局搜索面板（输入 + 分组结果 + 键盘导航）
// [POS]: /api/search 的 UI 消费端；Cmd/Ctrl+K 或 Ctrl+F（非输入态）唤起；Enter 跳转深链
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Boxes,
  CornerDownLeft,
  FolderGit2,
  HardDrive,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import type { GlobalSearchResult, GlobalSearchType } from '@shared/types'
import { api } from '../../lib/api'
import { useTranslation } from '../../lib/i18n/react'
import { cn } from '../../lib/utils'
import {
  flattenGroupedResults,
  GLOBAL_SEARCH_GROUP_LABELS,
  GLOBAL_SEARCH_GROUP_ORDER,
  GLOBAL_SEARCH_OPEN_EVENT,
  moveSelectionIndex,
  resolveGlobalSearchShortcut,
  resolveInitialSelectionIndex,
} from './global-search-nav'

const GROUP_ICONS: Record<GlobalSearchType, typeof MessageSquare> = {
  chat: MessageSquare,
  workspace: Boxes,
  agent: Bot,
  contact: Users,
  project: FolderGit2,
  task: ListTodo,
  drive: HardDrive,
  skill: Sparkles,
}

const SEARCH_DEBOUNCE_MS = 250

export function GlobalSearchPalette() {
  const { language } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<GlobalSearchType | undefined>(undefined)
  const [results, setResults] = useState<GlobalSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)
  const requestSeqRef = useRef(0)

  const flat = useMemo(() => flattenGroupedResults(results), [results])

  const close = () => {
    setOpen(false)
  }

  const navigateTo = (route: string) => {
    close()
    // 全量跳转：目标页（/kanban、/workspace、/agents…）重新挂载并执行自身 search 校验
    window.location.href = route
  }

  // 全局快捷键：Cmd/Ctrl+K 或 Ctrl+F（非输入态）开合；Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveGlobalSearchShortcut(event)
      if (action === 'toggle') {
        event.preventDefault()
        setOpen((previous) => {
          if (!previous) {
            setQuery('')
            setTypeFilter(undefined)
            setResults([])
            setSelectedIndex(-1)
            setError(null)
          }
          return !previous
        })
        return
      }
      if (open && event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    // 侧边栏搜索按钮等外部入口
    const handleExternalOpen = () => {
      setQuery('')
      setTypeFilter(undefined)
      setResults([])
      setSelectedIndex(-1)
      setError(null)
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, handleExternalOpen)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, handleExternalOpen)
    }
  }, [open])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  // 防抖搜索
  useEffect(() => {
    if (!open) {
      return
    }
    const q = query.trim()
    if (!q) {
      setResults([])
      setSelectedIndex(-1)
      setLoading(false)
      return
    }

    setLoading(true)
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(async () => {
      const seq = ++requestSeqRef.current
      try {
        const response = await api.globalSearch({ q, type: typeFilter })
        if (seq !== requestSeqRef.current) {
          return
        }
        setResults(response.results)
        setSelectedIndex(resolveInitialSelectionIndex(flattenGroupedResults(response.results).length))
        setError(null)
      } catch (searchError) {
        if (seq !== requestSeqRef.current) {
          return
        }
        setResults([])
        setError(searchError instanceof Error ? searchError.message : '搜索失败')
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
        }
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [query, open, typeFilter])

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => moveSelectionIndex(current, flat.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => moveSelectionIndex(current, flat.length, -1))
    } else if (event.key === 'Enter') {
      const entry = flat[selectedIndex]
      if (entry) {
        event.preventDefault()
        navigateTo(entry.result.route)
      }
    }
  }

  if (!open) {
    return null
  }

  const lastGroupByIndex = new Map<string, number>()
  for (let index = 0; index < flat.length; index += 1) {
    const group = flat[index]?.group
    if (group && !lastGroupByIndex.has(group)) {
      lastGroupByIndex.set(group, index)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="全局搜索"
      data-testid="global-search-palette"
    >
      <div className="mt-[10vh] w-full max-w-xl overflow-hidden rounded-lg border border-zinc-800 bg-[#09090b] shadow-2xl shadow-black/50">
        {/* 输入行 */}
        <div className="flex items-center gap-2.5 border-b border-zinc-900 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            data-testid="global-search-input"
            placeholder={language === 'zh' ? '搜索会话、工作区、Agent、联系人、项目…' : 'Search chats, workspaces, agents, contacts, projects…'}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            spellCheck={false}
          />
          {loading ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-600" /> : null}
          <kbd className="hidden shrink-0 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500 sm:block">Esc</kbd>
        </div>

        {/* 类型过滤 chips */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-900 px-4 py-2">
          <button
            type="button"
            onClick={() => setTypeFilter(undefined)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              typeFilter === undefined ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            )}
          >
            {language === 'zh' ? '全部' : 'All'}
          </button>
          {GLOBAL_SEARCH_GROUP_ORDER.map((type) => {
            const label = GLOBAL_SEARCH_GROUP_LABELS[type]
            return (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter((current) => (current === type ? undefined : type))}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                  typeFilter === type ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
                )}
              >
                {language === 'zh' ? label.zh : label.en}
              </button>
            )
          })}
        </div>

        {/* 结果区 */}
        <div className="max-h-[46vh] min-h-[8rem] overflow-y-auto py-1.5">
          {error ? (
            <div className="px-4 py-6 text-center text-xs text-rose-300" data-testid="global-search-error">{error}</div>
          ) : !query.trim() ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">
              {language === 'zh' ? '输入关键词搜索全部内容，方向键选择，Enter 跳转。' : 'Type to search everything. Use arrows to navigate, Enter to jump.'}
            </div>
          ) : flat.length === 0 && !loading ? (
            <div className="mx-3 my-3 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-8 text-center text-xs text-zinc-500" data-testid="global-search-empty">
              {language === 'zh' ? `没有找到与「${query}」相关的内容` : `No results for "${query}"`}
            </div>
          ) : null}

          {flat.map((entry, index) => {
            const Icon = GROUP_ICONS[entry.group]
            const isSelected = index === selectedIndex
            const showGroupHeader = lastGroupByIndex.get(entry.group) === index
            const label = GLOBAL_SEARCH_GROUP_LABELS[entry.group]
            return (
              <div key={`${entry.result.type}:${entry.result.id}`}>
                {showGroupHeader ? (
                  <div
                    data-testid="global-search-group"
                    data-group={entry.group}
                    className="px-4 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600"
                  >
                    {language === 'zh' ? label.zh : label.en}
                  </div>
                ) : null}
                <button
                  type="button"
                  ref={(element) => {
                    if (isSelected) {
                      element?.scrollIntoView({ block: 'nearest' })
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => navigateTo(entry.result.route)}
                  data-testid="global-search-result"
                  data-result-type={entry.result.type}
                  className={cn(
                    'group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                    isSelected ? 'bg-zinc-900/80' : 'hover:bg-zinc-900/40',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-zinc-300' : 'text-zinc-600')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">{entry.result.title}</span>
                    {entry.result.snippet ? (
                      <span className="block truncate text-[11px] text-zinc-500">{entry.result.snippet}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-600">{entry.result.route}</span>
                </button>
              </div>
            )
          })}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center gap-3 border-t border-zinc-900 px-4 py-2 text-[11px] text-zinc-600">
          <span className="flex items-center gap-1"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" />{language === 'zh' ? '选择' : 'Navigate'}</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" />{language === 'zh' ? '跳转' : 'Open'}</span>
          <span className="ml-auto">{language === 'zh' ? 'Cmd/Ctrl+K 随时唤起' : 'Cmd/Ctrl+K anytime'}</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
