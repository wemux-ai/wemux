// [INPUT]: GET /docs/{lang}（en / zh）——落地页
// [OUTPUT]: 文档落地页（语言化：hero + section 卡片）
// [POS]: 文档站落地页，挂在 docs.$lang 布局下。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { buildDocsLandingUrl, isDocsLocale, type DocsLocale } from '@shared/docs-content'
import { DocsChrome } from '../lib/docs/docs-route-shell'
import { getDocsIndex, getDocsModel } from '../lib/docs/docs-source'
import { DocsLanding } from '../lib/docs/docs-layout'

export const Route = createFileRoute('/docs/$lang/')({
  component: DocsLangLandingRoute,
})

function DocsLangLandingRoute() {
  const { lang } = Route.useParams()
  if (!isDocsLocale(lang)) {
    return null
  }
  const locale = lang
  const model = getDocsModel(locale)
  const index = getDocsIndex(locale)
  const indexUrl = index?.url ?? '/docs/en/docs'

  const langHref = (target: DocsLocale) => buildDocsLandingUrl(target)

  return (
    <DocsChrome
      locale={locale}
      brandHref={buildDocsLandingUrl(locale)}
      langHref={langHref}
      currentUrl={buildDocsLandingUrl(locale)}
      indexUrl={indexUrl}
      indexLabel={locale === 'zh' ? '欢迎使用 Wemux' : 'Welcome to Wemux'}
      sections={model.sections}
      content={<DocsLanding locale={locale} sections={model.sections} indexUrl={indexUrl} />}
      toc={null}
    />
  )
}
