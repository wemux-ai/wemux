// [INPUT]: 首页请求
// [OUTPUT]: 首页
// [POS]: 首页
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { requireIndexedMarketingPage } from '@shared/site-seo'
import { LandingPage } from '../components/marketing/landing-page'
import { buildMarketingHead, marketingSite } from '../lib/marketing-site'

const seoPage = requireIndexedMarketingPage('/')

export const Route = createFileRoute('/')({
  head: () => {
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: 'Wemux',
          url: marketingSite.homeUrl,
          logo: marketingSite.logoUrl,
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Wemux',
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Web, macOS, Linux',
          url: marketingSite.homeUrl,
          image: marketingSite.ogImageUrl,
          description: seoPage.description,
          offers: {
            '@type': 'Offer',
            availability: 'https://schema.org/InStock',
            price: '0',
            priceCurrency: 'USD',
          },
        },
      ],
    }

    return buildMarketingHead({
      description: seoPage.description,
      structuredData,
      title: seoPage.title,
    })
  },
  component: IndexRoute,
})

function IndexRoute() {
  return <LandingPage />
}
