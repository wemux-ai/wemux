// [INPUT]: 结构化数据输入
// [OUTPUT]: JSON-LD 输出
// [POS]: 营销结构化数据
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { buildPageUrl } from './site-seo-config'
import type { MarketingContentCollection, MarketingContentEntry } from './marketing-content'
import type { MarketingTopic } from './marketing-topics'

type MarketingStructuredDataDocument = Pick<
  MarketingContentEntry,
  'author'
  | 'collection'
  | 'description'
  | 'imagePath'
  | 'path'
  | 'publishedAt'
  | 'title'
  | 'topicSlugs'
  | 'updatedAt'
>

type MarketingCollectionStructuredDataOptions = {
  description: string
  documents: MarketingStructuredDataDocument[]
  path: string
  title: string
}

type MarketingTopicStructuredData = MarketingTopic & {
  documents: MarketingStructuredDataDocument[]
}

const collectionLabelByCollection: Record<MarketingContentCollection, string> = {
  blog: 'Blog',
  compare: 'Compare',
  'use-cases': 'Use Cases',
}

const collectionPathByCollection: Record<MarketingContentCollection, string> = {
  blog: '/blog',
  compare: '/compare',
  'use-cases': '/use-cases',
}

const startCase = (value: string) => value
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ')

const buildBreadcrumbList = (items: Array<{ item: string; name: string }>) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    item: item.item,
    name: item.name,
    position: index + 1,
  })),
})

const buildItemList = (documents: MarketingStructuredDataDocument[]) => ({
  '@type': 'ItemList',
  itemListElement: documents.map((document, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: buildPageUrl(document.path),
    name: document.title,
  })),
})

export function buildMarketingContentStructuredData(document: MarketingStructuredDataDocument) {
  const breadcrumbName = startCase(document.path.split('/').at(-1) || document.title)
  const collectionLabel = collectionLabelByCollection[document.collection]
  const collectionPath = collectionPathByCollection[document.collection]
  const topicNames = document.topicSlugs.map(startCase)

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': document.collection === 'blog' ? 'BlogPosting' : 'Article',
        author: {
          '@type': 'Person',
          name: document.author,
        },
        publisher: {
          '@type': 'Organization',
          name: 'wemux',
          url: buildPageUrl('/'),
        },
        dateModified: document.updatedAt,
        datePublished: document.publishedAt,
        description: document.description,
        headline: document.title,
        image: buildPageUrl(document.imagePath),
        keywords: topicNames,
        mainEntityOfPage: buildPageUrl(document.path),
        about: topicNames.map((name) => ({
          '@type': 'Thing',
          name,
        })),
      },
      buildBreadcrumbList([
        { item: buildPageUrl('/'), name: 'Home' },
        { item: buildPageUrl(collectionPath), name: collectionLabel },
        { item: buildPageUrl(document.path), name: breadcrumbName },
      ]),
    ],
  }
}

export function buildMarketingCollectionStructuredData({
  description,
  documents,
  path,
  title,
}: MarketingCollectionStructuredDataOptions) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        description,
        name: title,
        url: buildPageUrl(path),
        mainEntity: buildItemList(documents),
      },
      buildItemList(documents),
      buildBreadcrumbList([
        { item: buildPageUrl('/'), name: 'Home' },
        { item: buildPageUrl(path), name: title },
      ]),
    ],
  }
}

export function buildMarketingTopicStructuredData(topic: MarketingTopicStructuredData) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        description: topic.description,
        name: topic.title,
        url: buildPageUrl(`/topics/${topic.slug}`),
        about: {
          '@type': 'Thing',
          name: topic.title,
        },
        mainEntity: buildItemList(topic.documents),
      },
      buildItemList(topic.documents),
      buildBreadcrumbList([
        { item: buildPageUrl('/'), name: 'Home' },
        { item: buildPageUrl('/topics'), name: 'Topics' },
        { item: buildPageUrl(`/topics/${topic.slug}`), name: topic.title },
      ]),
    ],
  }
}

export function buildMarketingTopicDirectoryStructuredData(topics: MarketingTopicStructuredData[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        description: 'Topic clusters that connect wemux blog posts, use cases, and compare pages into reusable SEO hubs.',
        name: 'wemux SEO Topics',
        url: buildPageUrl('/topics'),
        mainEntity: {
          '@type': 'ItemList',
          itemListElement: topics.map((topic, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: buildPageUrl(`/topics/${topic.slug}`),
            name: topic.title,
          })),
        },
      },
      buildBreadcrumbList([
        { item: buildPageUrl('/'), name: 'Home' },
        { item: buildPageUrl('/topics'), name: 'Topics' },
      ]),
    ],
  }
}
