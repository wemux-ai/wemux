// [INPUT]: 场景列表
// [OUTPUT]: 场景索引页
// [POS]: 场景索引页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { MarketingContentIndex, MarketingFeaturedContent } from '../components/marketing/marketing-content-page'
import { MarketingPageLayout } from '../components/marketing/marketing-page-layout'
import { listFeaturedMarketingContentDocumentsByCollection, listMarketingContentDocumentsByCollection } from '../lib/marketing-content'
import { buildMarketingCollectionStructuredData } from '../lib/marketing-content-seo'
import { buildMarketingHead } from '../lib/marketing-site'

const useCaseDocuments = listMarketingContentDocumentsByCollection('use-cases')
const featuredUseCaseDocuments = listFeaturedMarketingContentDocumentsByCollection('use-cases')

export const Route = createFileRoute('/use-cases/')({
  head: () => buildMarketingHead({
    description: 'Browse Wemux use-case pages for AI coding delivery, small engineering teams, and multi-agent orchestration.',
    path: '/use-cases',
    structuredData: buildMarketingCollectionStructuredData({
      description: 'Browse Wemux use-case pages for AI coding delivery, small engineering teams, and multi-agent orchestration.',
      documents: useCaseDocuments,
      path: '/use-cases',
      title: 'Wemux Use Cases',
    }),
    title: 'Wemux Use Cases',
  }),
  component: UseCasesIndexRoute,
})

function UseCasesIndexRoute() {
  return (
    <MarketingPageLayout
      description="Use-case pages explain where Wemux fits best in real engineering teams and AI delivery workflows."
      eyebrow="Library"
      title="Wemux use cases"
    >
      <MarketingFeaturedContent documents={featuredUseCaseDocuments} title="Featured use cases" />
      <MarketingContentIndex collectionLabel="Use cases" documents={useCaseDocuments} />
    </MarketingPageLayout>
  )
}
