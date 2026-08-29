// [INPUT]: SEO 构建输入
// [OUTPUT]: SEO 元数据
// [POS]: 站点 SEO 工具
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildPageUrl, siteLogoUrl, siteOgImageUrl, siteOrigin } from './site-seo-config'
import { listSeoIndexedMarketingPages } from './marketing-site-seo'

export type IndexedMarketingPagePath = string

export type IndexedMarketingPage = {
  changeFrequency: 'weekly'
  description: string
  lastModified: string
  path: IndexedMarketingPagePath
  priority: number
  title: string
}

const indexedMarketingPages = listSeoIndexedMarketingPages()

const indexedMarketingPageMap = new Map(
  indexedMarketingPages.map((page) => [page.path, page] satisfies [IndexedMarketingPagePath, IndexedMarketingPage]),
)

export { buildPageUrl, siteLogoUrl, siteOgImageUrl, siteOrigin }

export function getIndexedMarketingPage(path: IndexedMarketingPagePath) {
  return indexedMarketingPageMap.get(path) ?? null
}

export function requireIndexedMarketingPage(path: IndexedMarketingPagePath) {
  const page = getIndexedMarketingPage(path)
  if (!page) {
    throw new Error(`Missing indexed marketing page for path: ${path}`)
  }

  return page
}

export function resolveIndexedMarketingPage(path: string) {
  return indexedMarketingPageMap.get(path as IndexedMarketingPagePath) ?? null
}

export function isIndexedMarketingPath(path: string) {
  return indexedMarketingPageMap.has(path as IndexedMarketingPagePath)
}

export function listIndexedMarketingPages() {
  return indexedMarketingPages
}

export function buildIndexedMarketingSitemapXml() {
  const urls = indexedMarketingPages.map((page) => [
    '  <url>',
    `    <loc>${buildPageUrl(page.path)}</loc>`,
    `    <lastmod>${page.lastModified}</lastmod>`,
    `    <changefreq>${page.changeFrequency}</changefreq>`,
    `    <priority>${page.priority.toFixed(1)}</priority>`,
    '  </url>',
  ].join('\n')).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
