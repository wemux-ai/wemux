// [INPUT]: GET /docs/{lang}（en / zh）——布局层
// [OUTPUT]: <Outlet /> 承载子路由：docs.$lang.index（落地页）与 docs.$lang.docs.$（文档页）
// [POS]: 文档站语言布局。URL 与旧站一致。注意：子路由依赖本层 Outlet，勿改成直接渲染内容。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import { buildDocsLandingUrl, isDocsLocale, type DocsLocale } from '@shared/docs-content'
import { buildMarketingHead } from '../lib/marketing-site'

export const Route = createFileRoute('/docs/$lang')({
  head: ({ params }) => {
    const { lang } = params
    const locale: DocsLocale = isDocsLocale(lang) ? lang : 'en'
    return buildMarketingHead({
      description:
        locale === 'zh'
          ? 'Wemux（AI 编程交付平台）文档：协调真实仓库、Worker、分支、日志与审核流程。'
          : 'Wemux documentation: an AI coding delivery platform that orchestrates work across real repositories, workers, branches, logs, and review flows.',
      path: buildDocsLandingUrl(locale),
      title: locale === 'zh' ? 'Wemux 文档' : 'Wemux Docs',
    })
  },
  component: DocsLangLayoutRoute,
})

function DocsLangLayoutRoute() {
  const { lang } = Route.useParams()
  if (!isDocsLocale(lang)) {
    throw notFound()
  }
  return <Outlet />
}
