// [INPUT]: GET /docs/{lang}/docs/{slug...}（含空 slug 的 index 页）
// [OUTPUT]: 文档页：侧边栏 + 正文 + TOC + 上下页导航
// [POS]: 文档站正文页，URL 与旧站一致（/docs/{lang}/docs/{section}/{slug}）。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  buildDocsLandingUrl,
  buildDocsPageUrl,
  isDocsLocale,
  type DocsLocale,
  type DocsPage,
} from '@shared/docs-content'
import { DocsChrome, DocsPageContent } from '../lib/docs/docs-route-shell'
import { getDocsIndex, getDocsModel, getDocsPageBySlugs } from '../lib/docs/docs-source'
import { DocsPrevNext, DocsToc } from '../lib/docs/docs-layout'
import { buildMarketingHead, buildPageUrl } from '../lib/marketing-site'

export const Route = createFileRoute('/docs/$lang/docs/$')({
  head: ({ params }) => {
    const { lang, _splat } = params
    const locale: DocsLocale = isDocsLocale(lang) ? lang : 'en'
    const slugs = (_splat ?? '').split('/').filter(Boolean)
    const page = getDocsPageBySlugs(locale, slugs)
    if (!page) {
      return buildMarketingHead({
        description: 'The requested documentation page could not be found.',
        path: buildDocsLandingUrl(locale),
        title: locale === 'zh' ? '文档页未找到' : 'Docs Page Not Found',
      })
    }
    return buildMarketingHead({
      description: page.description ?? page.title,
      path: page.url,
      title: `${page.title} — Wemux Docs`,
    })
  },
  component: DocsPageRoute,
})

function DocsPageRoute() {
  const { lang, _splat } = Route.useParams()
  if (!isDocsLocale(lang)) {
    throw notFound()
  }
  const locale = lang
  const slugs = (_splat ?? '').split('/').filter(Boolean)
  const page = getDocsPageBySlugs(locale, slugs)
  if (!page) {
    throw notFound()
  }

  const model = getDocsModel(locale)
  const index = getDocsIndex(locale)
  const indexUrl = index?.url ?? '/docs/en/docs'
  const zh = locale === 'zh'

  // 语言切换：同页面切语言；index 页（空 slug）保持 index。
  const langHref = (target: DocsLocale) => {
    if (slugs.length === 0) {
      return buildDocsPageUrl(target, '', 'index')
    }
    const [section, slug] = slugs
    return buildDocsPageUrl(target, section, slug)
  }

  const pageIndex = model.pages.findIndex((item) => item.url === page.url)
  const previous = pageIndex > 0 ? model.pages[pageIndex - 1] : undefined
  const next = pageIndex >= 0 && pageIndex < model.pages.length - 1 ? model.pages[pageIndex + 1] : undefined

  const toc = (
    <DocsToc label={zh ? '本页目录' : 'On this page'} toc={page.toc} />
  )
  const prevNext = <DocsPrevNext previous={previous} next={next} labels={{ previous: zh ? '上一篇' : 'Previous', next: zh ? '下一篇' : 'Next' }} />

  return (
    <DocsChrome
      locale={locale}
      brandHref={buildDocsLandingUrl(locale)}
      langHref={langHref}
      currentUrl={page.url}
      indexUrl={indexUrl}
      indexLabel={zh ? '欢迎使用 Wemux' : 'Welcome to Wemux'}
      sections={model.sections}
      content={<DocsPageContent page={page} />}
      toc={toc}
      prevNext={prevNext}
    />
  )
}
