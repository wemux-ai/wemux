// [INPUT]: /download 请求
// [OUTPUT]: 桌面端下载页
// [POS]: 下载页路由（feature 桌面端分发）
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { createFileRoute } from '@tanstack/react-router'
import { requireIndexedMarketingPage } from '@shared/site-seo'
import { DownloadPage, type DesktopDownloadsManifest } from '../components/download/download-page'
import { buildMarketingHead, buildPageUrl, marketingSite } from '../lib/marketing-site'
import downloadsManifest from '../data/desktop-downloads.json'

const seoPage = requireIndexedMarketingPage('/download')
const manifest = downloadsManifest as DesktopDownloadsManifest

export const Route = createFileRoute('/download')({
  head: () => {
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: 'Wemux',
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'macOS, Windows',
          url: buildPageUrl('/download'),
          image: marketingSite.ogImageUrl,
          description: seoPage.description,
          softwareVersion: manifest.version,
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
      path: '/download',
      structuredData,
      title: seoPage.title,
    })
  },
  component: DownloadRoute,
})

function DownloadRoute() {
  return <DownloadPage manifest={manifest} />
}
