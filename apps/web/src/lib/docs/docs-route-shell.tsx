// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
//
// INPUT: 当前语言、品牌/语言切换链接、侧边栏与 TOC 内容、正文内容
// OUTPUT: 文档页组合壳：顶部栏 + 桌面侧栏/TOC + 移动端导航抽屉 + 搜索对话框 + AI 助手
// POS: 文档站路由级装配。搜索与 AI 助手只在此层挂载一次，避免每个文档页重复。

import { useState, type ReactNode } from 'react'
import type { DocsLocale, DocsPage, DocsSection } from '@shared/docs-content'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { getDocsSearchEntries } from './docs-source'
import { DocsAiChat } from './docs-ai-chat'
import { DocsHeader, DocsShell, DocsSidebar } from './docs-layout'
import { DocsMarkdown } from './docs-markdown'
import { DocsSearchDialog, useDocsSearchShortcut } from './docs-search'
import { cn } from '../utils'

export function DocsChrome({
  locale,
  brandHref,
  langHref,
  currentUrl,
  indexUrl,
  indexLabel,
  sections,
  content,
  toc,
  prevNext,
}: {
  locale: DocsLocale
  brandHref: string
  langHref: (lang: DocsLocale) => string
  currentUrl: string
  indexUrl: string
  indexLabel: string
  sections: DocsSection[]
  content: ReactNode
  toc: ReactNode
  prevNext?: ReactNode
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useDocsSearchShortcut(() => setSearchOpen(true))

  const zh = locale === 'zh'
  const searchEntries = getDocsSearchEntries(locale)

  const sidebar = (
    <DocsSidebar
      locale={locale}
      sections={sections}
      indexUrl={indexUrl}
      indexLabel={indexLabel}
      currentUrl={currentUrl}
    />
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DocsHeader
        locale={locale}
        brandHref={brandHref}
        langHref={langHref}
        onOpenSidebar={() => setMobileNavOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <DocsShell sidebar={sidebar} toc={toc} content={content} />
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 md:px-6 lg:px-8">{prevNext}</div>

      <DocsSearchDialog open={searchOpen} onOpenChange={setSearchOpen} locale={locale} entries={searchEntries} />

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="left-4 top-4 h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] translate-x-0 translate-y-0 p-0 sm:max-w-xs">
          <DialogHeader className="sr-only">
            <DialogTitle>{zh ? '文档导航' : 'Docs navigation'}</DialogTitle>
          </DialogHeader>
          {sidebar}
        </DialogContent>
      </Dialog>

      <DocsAiChat locale={locale} />
    </div>
  )
}

export function DocsPageContent({ page }: { page: DocsPage }) {
  return (
    <article className="min-w-0">
      <h1 className="scroll-m-20 text-2xl font-semibold tracking-tight text-foreground">{page.title}</h1>
      {page.description ? (
        <p className={cn('mt-2 text-sm text-muted-foreground')}>{page.description}</p>
      ) : null}
      <div className="mt-6">
        <DocsMarkdown markdown={page.markdown} />
      </div>
    </article>
  )
}
