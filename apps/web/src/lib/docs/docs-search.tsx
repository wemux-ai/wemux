// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: 文档搜索条目（title/description/sectionTitle/content）+ 当前语言
// OUTPUT: 搜索对话框：`/` 快捷键唤起，客户端过滤文档索引
// POS: 文档站搜索 UI。索引随应用打包（与 marketing 内容同构），生产静态站同样可用。

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { DocsLocale, DocsSearchEntry } from '@shared/docs-content'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { cn } from '../utils'

export function useDocsSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpen])
}

function scoreEntry(entry: DocsSearchEntry, query: string): number {
  const q = query.toLowerCase()
  if (!q) {
    return 0
  }
  let score = 0
  const title = entry.title.toLowerCase()
  if (title === q) score += 100
  else if (title.startsWith(q)) score += 60
  else if (title.includes(q)) score += 30
  if (entry.sectionTitle.toLowerCase().includes(q)) score += 10
  if (entry.description.toLowerCase().includes(q)) score += 8
  if (entry.content.toLowerCase().includes(q)) score += 4
  return score
}

export function DocsSearchDialog({
  open,
  onOpenChange,
  locale,
  entries,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: DocsLocale
  entries: DocsSearchEntry[]
}) {
  const [query, setQuery] = useState('')
  const zh = locale === 'zh'

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      return []
    }
    return entries
      .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.entry)
  }, [query, entries])

  const highlight = (text: string) => text.slice(0, 160)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-24 max-w-xl gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{zh ? '搜索文档' : 'Search docs'}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={zh ? '搜索文档…' : 'Search documentation…'}
            className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {query.trim() && results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{zh ? '没有匹配的文档' : 'No matching documents'}</p>
          ) : null}
          {results.map((entry) => (
            <a
              key={entry.url}
              href={entry.url}
              onClick={() => onOpenChange(false)}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 transition hover:bg-muted"
            >
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-foreground">{entry.title}</span>
                {entry.sectionTitle ? (
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    {entry.sectionTitle}
                  </span>
                ) : null}
              </span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {entry.description || highlight(entry.content)}
              </span>
            </a>
          ))}
          {!query.trim() ? (
            <p className={cn('px-3 py-6 text-center text-sm text-muted-foreground')}>
              {zh ? `输入关键词搜索 ${entries.length} 篇文档` : `Search ${entries.length} documents`}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
