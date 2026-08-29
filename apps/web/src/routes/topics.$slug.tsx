// [INPUT]: 主题 slug
// [OUTPUT]: 主题文章页
// [POS]: 主题详情页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute, notFound } from '@tanstack/react-router'
import { MarketingContentIndex } from '../components/marketing/marketing-content-page'
import { MarketingPageLayout, MarketingSection } from '../components/marketing/marketing-page-layout'
import { getMarketingTopicWithDocuments } from '../lib/marketing-content'
import { buildMarketingTopicStructuredData } from '../lib/marketing-content-seo'
import { buildMarketingHead } from '../lib/marketing-site'

export const Route = createFileRoute('/topics/$slug')({
  head: ({ params }) => {
    const topic = getMarketingTopicWithDocuments(params.slug)
    if (!topic) {
      return buildMarketingHead({
        description: 'The requested topic cluster could not be found.',
        path: '/topics',
        title: 'Topic Not Found',
      })
    }

    return buildMarketingHead({
      description: topic.description,
      path: `/topics/${topic.slug}`,
      structuredData: buildMarketingTopicStructuredData(topic),
      title: `${topic.title} | Wemux Topic`,
    })
  },
  component: TopicsSlugRoute,
})

function TopicsSlugRoute() {
  const { slug } = Route.useParams()
  const topic = getMarketingTopicWithDocuments(slug)

  if (!topic) {
    throw notFound()
  }

  return (
    <MarketingPageLayout
      description={topic.description}
      eyebrow="Topic"
      title={topic.title}
    >
      <MarketingSection
        description="Every topic hub should gather multiple page types around one search intent. That gives Wemux a cleaner pillar-and-cluster structure."
        title="Why this topic exists"
      >
        <p className="text-sm leading-8 text-zinc-300">{topic.description}</p>
        <div className="mt-6 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/topics">
            All topics
          </a>
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/blog">
            Blog
          </a>
          <a className="border border-white/[0.12] px-4 py-3 text-zinc-300 transition hover:border-white/30 hover:text-white" href="/use-cases">
            Use cases
          </a>
        </div>
      </MarketingSection>
      <MarketingContentIndex collectionLabel={topic.title} documents={topic.documents} />
    </MarketingPageLayout>
  )
}
