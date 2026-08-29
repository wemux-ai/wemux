// [INPUT]: 对比列表
// [OUTPUT]: 对比索引页
// [POS]: 对比索引页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { MarketingContentIndex, MarketingFeaturedContent } from '../components/marketing/marketing-content-page'
import { MarketingPageLayout } from '../components/marketing/marketing-page-layout'
import { listFeaturedMarketingContentDocumentsByCollection, listMarketingContentDocumentsByCollection } from '../lib/marketing-content'
import { buildMarketingCollectionStructuredData } from '../lib/marketing-content-seo'
import { buildMarketingHead } from '../lib/marketing-site'

const compareDocuments = listMarketingContentDocumentsByCollection('compare')
const featuredCompareDocuments = listFeaturedMarketingContentDocumentsByCollection('compare')

export const Route = createFileRoute('/compare/')({
  head: () => buildMarketingHead({
    description: 'Comparison pages that explain the difference between AI chat interfaces and accountable AI delivery systems.',
    path: '/compare',
    structuredData: buildMarketingCollectionStructuredData({
      description: 'Comparison pages that explain the difference between AI chat interfaces and accountable AI delivery systems.',
      documents: compareDocuments,
      path: '/compare',
      title: 'Wemux Compare Pages',
    }),
    title: 'Wemux Compare Pages',
  }),
  component: CompareIndexRoute,
})

function CompareIndexRoute() {
  return (
    <MarketingPageLayout
      description="Comparison pages make the positioning explicit: where chat helps, where delivery becomes the real problem, and why Wemux focuses on execution."
      eyebrow="Library"
      title="Wemux compare pages"
    >
      <MarketingFeaturedContent documents={featuredCompareDocuments} title="Featured comparisons" />
      <MarketingContentIndex collectionLabel="Compare" documents={compareDocuments} />
    </MarketingPageLayout>
  )
}
