// [INPUT]: 主题列表
// [OUTPUT]: 主题索引页
// [POS]: 主题索引页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { MarketingTopicIndex } from '../components/marketing/marketing-content-page'
import { MarketingPageLayout } from '../components/marketing/marketing-page-layout'
import { listMarketingTopicsWithDocuments } from '../lib/marketing-content'
import { buildMarketingTopicDirectoryStructuredData } from '../lib/marketing-content-seo'
import { buildMarketingHead } from '../lib/marketing-site'

const topics = listMarketingTopicsWithDocuments()

export const Route = createFileRoute('/topics/')({
  head: () => buildMarketingHead({
    description: 'Topic clusters that connect Wemux blog posts, use cases, and compare pages into reusable SEO hubs.',
    path: '/topics',
    structuredData: buildMarketingTopicDirectoryStructuredData(topics),
    title: 'Wemux SEO Topics',
  }),
  component: TopicsIndexRoute,
})

function TopicsIndexRoute() {
  return (
    <MarketingPageLayout
      description="Topics turn isolated content pages into reusable clusters. This is where Wemux can build durable internal linking around AI coding delivery."
      eyebrow="Library"
      title="Wemux topic clusters"
    >
      <MarketingTopicIndex topics={topics} />
    </MarketingPageLayout>
  )
}
