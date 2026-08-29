import { buildPageUrl, siteLogoUrl, siteOgImageUrl, siteOrigin } from '@shared/site-seo'
import { withDevDocumentTitlePrefix } from './document-title'

const HOME_PATH = '/'

type MarketingHeadOptions = {
  description: string
  imageAlt?: string
  imageUrl?: string
  path?: string
  structuredData?: Record<string, unknown>
  title: string
}

export const marketingSite = {
  homePath: HOME_PATH,
  homeUrl: buildPageUrl(HOME_PATH),
  logoUrl: siteLogoUrl,
  ogImageUrl: siteOgImageUrl,
  origin: siteOrigin,
}

export { buildPageUrl }

export function buildMarketingHead({
  description,
  imageAlt,
  imageUrl,
  path = HOME_PATH,
  structuredData,
  title,
}: MarketingHeadOptions) {
  const pageUrl = buildPageUrl(path)
  const resolvedTitle = withDevDocumentTitlePrefix(title)
  const resolvedImageUrl = imageUrl || marketingSite.ogImageUrl
  const resolvedImageAlt = imageAlt || resolvedTitle
  const meta: Array<Record<string, unknown>> = [
    { title: resolvedTitle },
    { name: 'description', content: description },
    { name: 'robots', content: 'index, follow, max-image-preview:large' },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Wemux' },
    { property: 'og:title', content: resolvedTitle },
    { property: 'og:description', content: description },
    { property: 'og:url', content: pageUrl },
    { property: 'og:image', content: resolvedImageUrl },
    { property: 'og:image:alt', content: resolvedImageAlt },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:locale', content: 'en_US' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: resolvedTitle },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: resolvedImageUrl },
    { name: 'twitter:image:alt', content: resolvedImageAlt },
    { name: 'author', content: 'Wemux' },
  ]

  if (structuredData) {
    meta.push({ 'script:ld+json': structuredData })
  }

  return {
    links: [{ rel: 'canonical', href: pageUrl }],
    meta,
  }
}

export function buildNoIndexHead({ description, title }: { description: string; title: string }) {
  const resolvedTitle = withDevDocumentTitlePrefix(title)

  return {
    meta: [
      { title: resolvedTitle },
      { name: 'description', content: description },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }
}
