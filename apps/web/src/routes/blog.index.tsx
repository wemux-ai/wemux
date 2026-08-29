// [INPUT]: blog 列表
// [OUTPUT]: 博客列表页
// [POS]: 博客索引页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { MarketingContentIndex, MarketingFeaturedContent } from '../components/marketing/marketing-content-page'
import { MarketingPageLayout } from '../components/marketing/marketing-page-layout'
import { listFeaturedMarketingContentDocumentsByCollection, listMarketingContentDocumentsByCollection } from '../lib/marketing-content'
import { buildMarketingCollectionStructuredData } from '../lib/marketing-content-seo'
import { buildMarketingHead } from '../lib/marketing-site'

const blogDocuments = listMarketingContentDocumentsByCollection('blog')
const featuredBlogDocuments = listFeaturedMarketingContentDocumentsByCollection('blog')

export const Route = createFileRoute('/blog/')({
  head: () => buildMarketingHead({
    description: 'Wemux founder notes and SEO blog articles about AI coding delivery, persistent execution, and real workstation workflows.',
    path: '/blog',
    structuredData: buildMarketingCollectionStructuredData({
      description: 'Wemux founder notes and SEO blog articles about AI coding delivery, persistent execution, and real workstation workflows.',
      documents: blogDocuments,
      path: '/blog',
      title: 'Wemux Blog',
    }),
    title: 'Wemux Blog',
  }),
  component: BlogIndexRoute,
})

function BlogIndexRoute() {
  return (
    <MarketingPageLayout
      description="A growing content library for product thinking, market framing, and persistent AI coding workflows."
      eyebrow="Library"
      title="Wemux blog"
    >
      <MarketingFeaturedContent documents={featuredBlogDocuments} title="Featured blog posts" />
      <MarketingContentIndex collectionLabel="Blog" documents={blogDocuments} />
    </MarketingPageLayout>
  )
}
