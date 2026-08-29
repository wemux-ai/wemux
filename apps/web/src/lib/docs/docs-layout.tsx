// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: 文档模型（页面 / 侧边栏树 / TOC）+ 当前语言与页面 URL
// OUTPUT: 文档站布局：顶部栏（品牌 / 语言切换 / 搜索）、侧边栏树、正文、右侧 TOC、上下页导航、落地页
// POS: 文档站 UI 层。风格跟随 web 设计系统（Tailwind v3 + shadcn tokens），明暗主题自适应。

import type { ReactNode } from 'react'
import { Menu, Search } from 'lucide-react'
import type { DocsLocale, DocsPage, DocsSection } from '@shared/docs-content'
import { cn } from '../utils'

const localeLabels: Record<DocsLocale, string> = { en: 'English', zh: '中文' }

export function DocsHeader({
  locale,
  brandHref,
  langHref,
  onOpenSidebar,
  onOpenSearch,
}: {
  locale: DocsLocale
  brandHref: string
  langHref: (lang: DocsLocale) => string
  onOpenSidebar: () => void
  onOpenSearch: () => void
}) {
  const zh = locale === 'zh'
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur md:px-5">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </button>

      <a href={brandHref} className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex size-5 items-center justify-center rounded-md bg-violet-600 text-[10px] font-bold text-white">w</span>
        Wemux Docs
      </a>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSearch}
          className="inline-flex h-7 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">{zh ? '搜索文档' : 'Search docs'}</span>
          <kbd className="hidden rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground sm:inline">/</kbd>
        </button>

        <nav className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 text-xs" aria-label="Language">
          {(['en', 'zh'] as const).map((lang) => (
            <a
              key={lang}
              href={langHref(lang)}
              className={cn(
                'rounded-md px-2 py-1 font-medium transition',
                lang === locale ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              aria-current={lang === locale ? 'page' : undefined}
            >
              {localeLabels[lang]}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}

export function DocsSidebarLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      className={cn(
        'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition',
        active
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <span className={cn('size-1 rounded-full', active ? 'bg-violet-500' : 'bg-transparent')} />
      {label}
    </a>
  )
}

export function DocsSidebar({
  locale,
  sections,
  indexUrl,
  indexLabel,
  currentUrl,
  className,
}: {
  locale: DocsLocale
  sections: DocsSection[]
  indexUrl: string
  indexLabel: string
  currentUrl: string
  className?: string
}) {
  return (
    <nav className={cn('flex flex-col gap-6 overflow-y-auto px-3 py-5', className)} aria-label="Docs navigation">
      <div className="flex flex-col gap-0.5">
        <DocsSidebarLink label={indexLabel} href={indexUrl} active={currentUrl === indexUrl} />
      </div>
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">{section.title}</p>
          {section.pages.map((page) => (
            <DocsSidebarLink key={page.url} label={page.title} href={page.url} active={page.url === currentUrl} />
          ))}
        </div>
      ))}
    </nav>
  )
}

export function DocsToc({ label, toc }: { label: string; toc: Array<{ depth: number; id: string; title: string }> }) {
  if (toc.length === 0) {
    return null
  }

  return (
    <nav className="flex flex-col gap-1 border-l border-border pl-4 text-[13px]" aria-label="On this page">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">{label}</p>
      {toc.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={cn(
            'text-muted-foreground transition hover:text-foreground',
            item.depth === 2 && 'font-medium',
            item.depth === 3 && 'pl-3',
            item.depth === 4 && 'pl-6',
          )}
        >
          {item.title}
        </a>
      ))}
    </nav>
  )
}

export function DocsPrevNext({ previous, next, labels }: { previous?: DocsPage; next?: DocsPage; labels: { previous: string; next: string } }) {
  const cell = (page: DocsPage | undefined, align: 'left' | 'right') => {
    if (!page) {
      return <div className="flex-1" />
    }
    return (
      <a
        href={page.url}
        className={cn(
          'group flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border px-4 py-3 transition hover:border-violet-500/40 hover:bg-muted/40',
          align === 'right' && 'text-right',
        )}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {align === 'left' ? labels.previous : labels.next}
        </span>
        <span className="truncate text-sm font-medium text-foreground">{page.title}</span>
      </a>
    )
  }

  return (
    <div className="mt-12 flex gap-3 border-t border-border pt-6">
      {cell(previous, 'left')}
      {cell(next, 'right')}
    </div>
  )
}

export function DocsShell({
  content,
  sidebar,
  toc,
}: {
  content: ReactNode
  sidebar: ReactNode
  toc: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-8 px-4 py-6 md:px-6 lg:px-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto">{sidebar}</div>
      </aside>
      <main className="min-w-0 flex-1 pb-16">{content}</main>
      <aside className="hidden w-52 shrink-0 xl:block">
        <div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto py-1">{toc}</div>
      </aside>
    </div>
  )
}

export function DocsLanding({
  locale,
  sections,
  indexUrl,
}: {
  locale: DocsLocale
  sections: DocsSection[]
  indexUrl: string
}) {
  const zh = locale === 'zh'
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col px-6 py-16 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-violet-500">Wemux docs</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {zh ? 'AI 编程交付平台文档' : 'AI Coding Delivery Platform Docs'}
      </h1>
      <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
        {zh
          ? '协调真实仓库、Worker、分支、日志与审核流程中的工作。'
          : 'Orchestrate work across real repositories, workers, branches, logs, and review flows.'}
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <a
          href={indexUrl}
          className="inline-flex h-9 items-center rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          {zh ? '阅读文档' : 'Read the Docs'}
        </a>
      </div>

      <div className="mt-16 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <a
            key={section.title}
            href={section.pages[0].url}
            className="flex flex-col gap-2 rounded-lg border border-border p-5 transition hover:border-violet-500/40 hover:bg-muted/40"
          >
            <span className="text-sm font-semibold text-foreground">{section.title}</span>
            <span className="text-xs text-muted-foreground">
              {section.pages.length} {zh ? '篇文章' : 'pages'}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
