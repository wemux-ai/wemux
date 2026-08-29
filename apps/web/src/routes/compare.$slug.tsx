// [INPUT]: 对比 slug
// [OUTPUT]: 对比页
// [POS]: 对比详情页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, notFound } from '@tanstack/react-router'
import { MarketingContentPage, MarketingRelatedLinks, MarketingTopicSiblingLinks } from '../components/marketing/marketing-content-page'
import { MarketingPageLayout } from '../components/marketing/marketing-page-layout'
import { getMarketingContentDocumentByCollectionSlug } from '../lib/marketing-content'
import { buildMarketingContentStructuredData } from '../lib/marketing-content-seo'
import { buildMarketingHead, buildPageUrl } from '../lib/marketing-site'

export const Route = createFileRoute('/compare/$slug')({
  head: ({ params }) => {
    const document = getMarketingContentDocumentByCollectionSlug('compare', params.slug)
    if (!document) {
      return buildMarketingHead({
        description: 'The requested comparison page could not be found.',
        path: '/compare',
        title: 'Comparison Not Found',
      })
    }

    return buildMarketingHead({
      description: document.description,
      imageAlt: document.imageAlt,
      imageUrl: buildPageUrl(document.imagePath),
      path: document.path,
      structuredData: buildMarketingContentStructuredData(document),
      title: document.title,
    })
  },
  component: CompareSlugRoute,
})

function CompareSlugRoute() {
  const { slug } = Route.useParams()
  const document = getMarketingContentDocumentByCollectionSlug('compare', slug)

  if (!document) {
    throw notFound()
  }

  return (
    <MarketingPageLayout
      description={document.heroDescription}
      eyebrow={document.eyebrow}
      title={document.heroTitle}
    >
      <MarketingContentPage document={document} />
      <MarketingTopicSiblingLinks document={document} />
      <MarketingRelatedLinks currentPath={document.path} relatedPaths={document.relatedPaths} />
    </MarketingPageLayout>
  )
}
