// [INPUT]: feed 输入
// [OUTPUT]: feed 数据
// [POS]: 营销 feed
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildPageUrl, siteOrigin } from './site-seo-config'
import { listPublishedMarketingContentEntries } from './marketing-content'

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

export function buildMarketingRssXml() {
  const blogEntries = listPublishedMarketingContentEntries()
    .filter((entry) => entry.collection === 'blog')
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))

  const items = blogEntries.map((entry) => [
    '  <item>',
    `    <title>${escapeXml(entry.title)}</title>`,
    `    <link>${buildPageUrl(entry.path)}</link>`,
    `    <guid>${buildPageUrl(entry.path)}</guid>`,
    `    <pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>`,
    `    <description>${escapeXml(entry.description)}</description>`,
    '  </item>',
  ].join('\n')).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    '    <title>wemux Blog</title>',
    `    <link>${siteOrigin}/blog</link>`,
    '    <description>Founder notes and SEO articles about AI coding delivery, persistent execution, and real workstation workflows.</description>',
    '    <language>en-us</language>',
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
